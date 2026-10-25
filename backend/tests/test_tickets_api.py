import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.time import as_utc
from app.models.ticket import Ticket


def create(client, payload):
    response = client.post("/api/tickets", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_reviewed_creation_hashes_token_and_minimizes_public_data(client, ticket_payload):
    ticket_payload["context"] = "a private prompt never saved"
    ticket_payload["latitude"] = 12.3456
    ticket_payload["recipient"]["display_name"] = "  Sam  "
    result = create(client, ticket_payload)
    token = result["token"]
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    assert re.fullmatch(r"[0-9a-f-]{36}", result["ticket_id"])
    assert result["created_at"] == "2026-10-25T12:00:00.000Z"
    assert result["expires_at"] == "2026-11-24T12:00:00.000Z"
    assert result["share_path"] == f"/t/{token}"
    assert result["accept_path"] == f"/api/tickets/{token}/accept"
    assert result["ics_path"] == f"/api/tickets/{token}/raincheck.ics"
    with client.app.state.session_factory() as session:
        stored = session.scalar(select(Ticket))
        assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert stored.relationship == "group"
        assert token not in str(stored.__dict__)
        assert "context" not in stored.__dict__
        assert "latitude" not in stored.__dict__
    response = client.get(f"/api/tickets/{token}")
    assert response.status_code == 200
    body = response.json()
    assert body["recipient"]["display_name"] == "Sam"
    assert body["weather"] is None
    assert body["status"] == "open"
    assert body["availability"]["confirmed"] is False
    assert body["accepted_at"] is None
    for private in (
        token,
        "token_hash",
        "context",
        "latitude",
        "longitude",
        "generation_id",
        "model",
    ):
        assert private not in response.text
    for header, value in {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
        "x-content-type-options": "nosniff",
    }.items():
        assert response.headers[header] == value


@pytest.mark.parametrize("reviewed", [False, None, "true", 1])
def test_review_gate_is_enforced(client, ticket_payload, reviewed):
    ticket_payload["reviewed"] = reviewed
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == (
        "review_required" if reviewed is False else "validation_error"
    )
    with client.app.state.session_factory() as session:
        assert session.scalar(select(Ticket)) is None


def test_missing_review_gate(client, ticket_payload):
    del ticket_payload["reviewed"]
    assert client.post("/api/tickets", json=ticket_payload).status_code == 422


@pytest.mark.parametrize("message", ["", "   \n\t", "x" * 1201, 123])
def test_message_is_required_and_bounded(client, ticket_payload, message):
    ticket_payload["message"] = message
    assert client.post("/api/tickets", json=ticket_payload).status_code == 422


def test_text_cleaning_preserves_newlines_and_blank_optional_is_null(client, ticket_payload):
    ticket_payload["message"] = " \x00Hi\r\nSam\tthere\u202e! "
    ticket_payload["sender_name"] = "   "
    ticket_payload["plan"]["title"] = " \t "
    ticket_payload["recipient"]["display_name"] = "\n"
    result = create(client, ticket_payload)
    body = client.get(f"/api/tickets/{result['token']}").json()
    assert body["message"] == "Hi\nSam\tthere!"
    assert body["sender_name"] is None
    assert body["plan"]["title"] is None
    assert body["recipient"]["display_name"] is None


def test_ticket_window_and_timezone_local_expiry_date(client, ticket_payload, clock):
    client.app.state.settings.ticket_ttl_days = 1
    clock[0] = datetime(2026, 10, 25, 23, 30, tzinfo=UTC)
    ticket_payload["proposed"].update(date="2026-10-28", timezone="Asia/Kolkata")
    rejected = client.post("/api/tickets", json=ticket_payload)
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "date_out_of_ticket_window"
    ticket_payload["proposed"]["date"] = "2026-10-27"
    assert client.post("/api/tickets", json=ticket_payload).status_code == 201


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("date", "2026-10-24"),
        ("date", "2027-10-26"),
        ("date", 1793000000),
        ("date", "2026-02-30"),
        ("date", "20261030"),
        ("timezone", "Invalid/Zone"),
        ("timezone", "+05:30"),
        ("timezone", "localtime"),
        ("timezone", "posix/Europe/London"),
        ("start_time", "24:00"),
        ("start_time", "3:00"),
        ("start_time", "15:00:00"),
        ("end_time", "14:00"),
        ("end_time", "15:00"),
    ],
)
def test_invalid_proposed_fields(client, ticket_payload, field, value):
    ticket_payload["proposed"][field] = value
    assert client.post("/api/tickets", json=ticket_payload).status_code == 422


@pytest.mark.parametrize("token", ["short", "a" * 42, "a" * 44, "a" * 43, "!" * 43])
def test_unknown_and_malformed_tokens_uniform_404(client, token):
    outcomes = [
        client.get(f"/api/tickets/{token}"),
        client.post(f"/api/tickets/{token}/accept"),
        client.get(f"/api/tickets/{token}/raincheck.ics"),
    ]
    for response in outcomes:
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "ticket_not_found"
        assert token not in response.text
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-robots-tag"] == "noindex, nofollow"


def test_expiry_on_read_accept_and_calendar_is_exact(client, ticket_payload, clock):
    result = create(client, ticket_payload)
    clock[0] = datetime.fromisoformat(result["expires_at"])
    for method, suffix in (("get", ""), ("post", "/accept"), ("get", "/raincheck.ics")):
        response = getattr(client, method)(f"/api/tickets/{result['token']}{suffix}")
        assert response.status_code == 410
        assert response.json()["error"]["code"] == "ticket_expired"
    with client.app.state.session_factory() as session:
        stored = session.scalar(select(Ticket))
        assert stored.accepted_at is None


def test_accept_empty_then_repeated_is_idempotent(client, ticket_payload, clock):
    result = create(client, ticket_payload)
    path = result["accept_path"]
    first = client.post(path)
    assert first.status_code == 200
    assert first.json()["already_accepted"] is False
    accepted_at = first.json()["accepted_at"]
    clock[0] += timedelta(minutes=1)
    for body in ({}, {"ignored": "not persisted"}):
        later = client.post(path, json=body)
        assert later.status_code == 200
        assert later.json()["already_accepted"] is True
        assert later.json()["accepted_at"] == accepted_at
    ticket = client.get(f"/api/tickets/{result['token']}").json()
    assert ticket["status"] == "accepted"
    assert ticket["availability"]["confirmed"] is False
    with client.app.state.session_factory() as session:
        assert as_utc(session.scalar(select(Ticket)).accepted_at) == datetime.fromisoformat(
            accepted_at
        )


def test_concurrent_accepts_never_overwrite_first_timestamp(client, ticket_payload):
    result = create(client, ticket_payload)
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: client.post(result["accept_path"]), range(12)))
    assert all(response.status_code == 200 for response in responses)
    bodies = [response.json() for response in responses]
    assert sum(not body["already_accepted"] for body in bodies) == 1
    assert len({body["accepted_at"] for body in bodies}) == 1


def test_weather_proof_overrides_untrusted_label_and_object(
    client, ticket_payload, upstream, weather_query
):
    weather = client.get("/api/weather", params=weather_query).json()
    ticket_payload["weather_token"] = weather["weather_token"]
    ticket_payload["weather"] = {"summary": "fake weather", "latitude": 1}
    ticket_payload["proposed"]["location_label"] = "Invented label"
    result = create(client, ticket_payload)
    body = client.get(f"/api/tickets/{result['token']}").json()
    assert body["proposed"]["location_label"] == weather["location"]["label"]
    assert body["weather"]["summary"] == weather["summary"]
    assert body["weather"]["source"] == "open-meteo"
    assert body["weather"]["attribution"]["text"] == "Weather data by Open-Meteo.com"
    assert not {"weather_token", "iat", "exp", "latitude", "longitude"} & body["weather"].keys()
    with client.app.state.session_factory() as session:
        serialized = json.dumps(session.scalar(select(Ticket)).weather_json)
        assert "latitude" not in serialized
        assert weather["weather_token"] not in serialized


@pytest.mark.parametrize("clock_field", ["start_time", "end_time"])
def test_nonexistent_dst_wall_times_rejected(client, ticket_payload, clock, clock_field):
    clock[0] = datetime(2027, 3, 1, 12, tzinfo=UTC)
    ticket_payload["proposed"].update(date="2027-03-14", start_time="01:00", end_time="04:00")
    ticket_payload["proposed"][clock_field] = "02:30"
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_local_time"


@pytest.mark.parametrize(
    "relationship", ["friend", "group", "coworker", "family", "date", "neighbor", "other"]
)
def test_relationships_remain_additive(client, ticket_payload, relationship):
    ticket_payload["recipient"]["relationship"] = relationship
    result = create(client, ticket_payload)
    body = client.get(f"/api/tickets/{result['token']}").json()
    assert body["recipient"]["relationship"] == relationship


def test_acceptance_does_not_revive_expired_accepted_ticket(client, ticket_payload, clock):
    result = create(client, ticket_payload)
    first = client.post(result["accept_path"]).json()
    clock[0] = datetime.fromisoformat(result["expires_at"])
    response = client.post(result["accept_path"])
    assert response.status_code == 410
    with client.app.state.session_factory() as session:
        assert as_utc(session.scalar(select(Ticket)).accepted_at) == datetime.fromisoformat(
            first["accepted_at"]
        )
