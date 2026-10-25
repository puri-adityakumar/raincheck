import base64
import hashlib
import hmac
import json
from datetime import timedelta

import pytest


def encode(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode_token(token):
    encoded = token[4:].split(".")[0]
    return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))


def sign(settings, payload):
    encoded = encode(json.dumps(payload, separators=(",", ":")).encode())
    signature = encode(
        hmac.digest(settings.weather_token_secret.encode(), encoded.encode(), hashlib.sha256)
    )
    return f"wxs_{encoded}.{signature}"


@pytest.fixture
def proof(client, upstream, weather_query):
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 200
    return response.json()["weather_token"]


@pytest.mark.parametrize("change", ["prefix", "payload", "signature", "padding", "extra_separator"])
def test_weather_token_tampering_is_rejected(client, ticket_payload, proof, change):
    if change == "prefix":
        token = proof.replace("wxs_", "bad_", 1)
    elif change == "payload":
        token = proof[:8] + ("A" if proof[8] != "A" else "B") + proof[9:]
    elif change == "signature":
        encoded, signature = proof.rsplit(".", 1)
        token = encoded + "." + ("A" if signature[0] != "A" else "B") + signature[1:]
    elif change == "padding":
        token = proof + "="
    else:
        token = proof + ".extra"
    ticket_payload["weather_token"] = token
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weather_token_invalid"
    assert response.json()["error"]["details"]["reason"] == "invalid"
    assert token not in response.text


def test_token_expiry_is_exclusive_at_exact_boundary(client, ticket_payload, proof, clock):
    ticket_payload["weather_token"] = proof
    clock[0] += timedelta(seconds=1799)
    assert client.post("/api/tickets", json=ticket_payload).status_code == 201
    clock[0] += timedelta(seconds=1)
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["details"] == {"reason": "expired"}


def test_token_cannot_move_to_a_different_date(client, ticket_payload, proof):
    ticket_payload["weather_token"] = proof
    ticket_payload["proposed"]["date"] = "2026-10-31"
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["details"] == {"reason": "date_mismatch"}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("v", True),
        ("v", 2),
        ("iat", "1792929600"),
        ("iat", False),
        ("exp", None),
        ("exp", 0),
        ("date", "2026-02-30"),
        ("date", 123),
        ("location_label", ""),
        ("location_label", 123),
        ("location_label", "A\nATTENDEE:evil"),
        ("location_label", "x" * 121),
        ("weather_code", "61"),
        ("weather_code", True),
        ("condition", "Invented"),
        ("temperature_min_c", None),
        ("temperature_max_c", float("nan")),
        ("temperature_min_c", 69.0),
        ("precipitation_probability_max", -1),
        ("precipitation_probability_max", True),
        ("precipitation_sum_mm", None),
        ("wind_speed_max_kmh", 501.0),
        ("summary", "Invented summary"),
        ("source", "invented"),
        ("fetched_at", "not-a-time"),
        ("fetched_at", "2026-10-25T12:00:00"),
        ("fetched_at", "2027-01-01T00:00:00Z"),
        ("latitude", 40.0),
    ],
)
def test_even_signed_payloads_require_every_field_and_type(
    client, ticket_payload, proof, test_settings, field, value
):
    payload = decode_token(proof)
    payload[field] = value
    ticket_payload["weather_token"] = sign(test_settings, payload)
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weather_token_invalid"


@pytest.mark.parametrize(
    "field",
    [
        "v",
        "iat",
        "exp",
        "date",
        "location_label",
        "weather_code",
        "condition",
        "temperature_min_c",
        "temperature_max_c",
        "precipitation_probability_max",
        "precipitation_sum_mm",
        "wind_speed_max_kmh",
        "summary",
        "source",
        "fetched_at",
    ],
)
def test_token_requires_all_fields(client, ticket_payload, proof, test_settings, field):
    payload = decode_token(proof)
    del payload[field]
    ticket_payload["weather_token"] = sign(test_settings, payload)
    response = client.post("/api/tickets", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weather_token_invalid"


def test_future_issue_time_rejected(client, ticket_payload, proof, test_settings):
    payload = decode_token(proof)
    payload["iat"] += 1
    payload["exp"] += 1
    ticket_payload["weather_token"] = sign(test_settings, payload)
    assert client.post("/api/tickets", json=ticket_payload).status_code == 422
