from datetime import UTC, datetime

import pytest


def unfold(response):
    return response.content.decode("utf-8").replace("\r\n ", "")


@pytest.mark.parametrize(
    ("day", "zone", "start", "end", "expected_start", "expected_end"),
    [
        (
            "2026-10-30",
            "America/New_York",
            "15:00",
            "16:00",
            "20261030T190000Z",
            "20261030T200000Z",
        ),
        (
            "2026-11-01",
            "America/New_York",
            "01:30",
            "02:30",
            "20261101T053000Z",
            "20261101T073000Z",
        ),
        ("2026-10-30", "Asia/Kolkata", "15:00", "16:00", "20261030T093000Z", "20261030T103000Z"),
        ("2026-10-30", "Australia/Adelaide", "15:00", None, "20261030T043000Z", "20261030T053000Z"),
        ("2026-10-30", "UTC", "23:30", None, "20261030T233000Z", "20261031T003000Z"),
    ],
)
def test_ics_utc_timezone_dst_and_default_hour(
    client, ticket_payload, day, zone, start, end, expected_start, expected_end
):
    ticket_payload["proposed"].update(date=day, timezone=zone, start_time=start, end_time=end)
    created = client.post("/api/tickets", json=ticket_payload)
    assert created.status_code == 201, created.text
    result = created.json()
    # Acceptance never turns the download into a calendar confirmation/invite.
    client.post(result["accept_path"])
    response = client.get(result["ics_path"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/calendar; charset=utf-8"
    assert response.headers["content-disposition"] == (
        f'attachment; filename="raincheck-{result["ticket_id"][:8]}.ics"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    text = unfold(response)
    assert f"DTSTART:{expected_start}\r\n" in text
    assert f"DTEND:{expected_end}\r\n" in text
    assert f"UID:raincheck-{result['ticket_id']}@raincheck\r\n" in text
    assert "STATUS:TENTATIVE\r\n" in text
    assert "TRANSP:TRANSPARENT\r\n" in text
    assert "not confirmed" in text
    assert "The recipient has not accepted via this calendar file." in text
    assert "Open the ticket to accept." in text
    for forbidden in (
        "ATTENDEE",
        "ORGANIZER",
        "METHOD:",
        "SEQUENCE",
        "VALARM",
        "VTIMEZONE",
        result["token"],
        "/t/",
    ):
        assert forbidden not in text
    assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
    assert text.endswith("END:VEVENT\r\nEND:VCALENDAR\r\n")
    assert b"\n" not in response.content.replace(b"\r\n", b"")
    assert b"\r" not in response.content.replace(b"\r\n", b"")


def test_ics_unicode_byte_folding_and_property_injection(client, ticket_payload):
    ticket_payload["message"] = "你好 café 🌧️ " * 60 + "\r\nATTENDEE:injected@example.test"
    ticket_payload["plan"]["title"] = "Tea\\coffee, pastries; chats\r\nORGANIZER:evil"
    ticket_payload["tone"] = "theatrical"
    result = client.post("/api/tickets", json=ticket_payload).json()
    response = client.get(result["ics_path"])
    text = unfold(response)
    physical = response.content.split(b"\r\n")
    assert all(len(line) <= 75 for line in physical)
    assert any(line.startswith(b" ") for line in physical)
    for line in physical:
        line.decode("utf-8")
    assert "你好 café" in text
    assert "\\nATTENDEE:injected@example.test" in text
    assert "\r\nATTENDEE:" not in text
    assert "\\nORGANIZER:evil" in text
    assert "\r\nORGANIZER:" not in text
    assert r"Tea\\coffee\, pastries\; chats\nORGANIZER:evil" in text
    assert r"Clearly theatrical — a joke\, not a real excuse." in text
    public = client.get(f"/api/tickets/{result['token']}").json()
    assert public["theatrical"] is True


def test_ics_spring_dst_and_cross_year(client, ticket_payload, clock):
    clock[0] = datetime(2027, 3, 1, 12, tzinfo=UTC)
    ticket_payload["proposed"].update(date="2027-03-14", start_time="01:30", end_time="03:30")
    result = client.post("/api/tickets", json=ticket_payload).json()
    text = unfold(client.get(result["ics_path"]))
    assert "DTSTART:20270314T063000Z\r\n" in text
    assert "DTEND:20270314T073000Z\r\n" in text
    clock[0] = datetime(2026, 12, 25, 12, tzinfo=UTC)
    ticket_payload["proposed"].update(
        date="2027-01-01", start_time="00:30", end_time=None, timezone="Asia/Kolkata"
    )
    result = client.post("/api/tickets", json=ticket_payload).json()
    text = unfold(client.get(result["ics_path"]))
    assert "DTSTART:20261231T190000Z\r\n" in text
    assert "DTEND:20261231T200000Z\r\n" in text


def test_ics_includes_only_verified_weather(client, ticket_payload, upstream, weather_query):
    weather = client.get("/api/weather", params=weather_query).json()
    ticket_payload["weather_token"] = weather["weather_token"]
    result = client.post("/api/tickets", json=ticket_payload).json()
    text = unfold(client.get(result["ics_path"]))
    assert weather["summary"] in text.replace("\\,", ",")
    assert "Weather data by Open-Meteo.com" in text
    assert weather["weather_token"] not in text
