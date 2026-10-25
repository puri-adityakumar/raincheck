import base64
import json
from datetime import UTC, datetime

import httpx
import pytest

from app.services.open_meteo import BoundedCache


def test_city_search_validates_maps_and_caches(client, upstream):
    _, calls = upstream
    first = client.get("/api/locations/search", params={"q": "  New   York ", "limit": 3})
    assert first.status_code == 200
    body = first.json()
    assert body["query"] == "New York"
    city = body["results"][0]
    assert city["id"] == "om:5128581"
    assert city["latitude"] == 40.7143
    assert city["longitude"] == -74.006
    assert body["attribution"]["text"] == "Location search by Open-Meteo.com"
    assert first.headers["cache-control"] == "no-store"
    assert calls[0].url.host == "geocoding-api.open-meteo.com"
    assert calls[0].url.path == "/v1/search"
    assert dict(calls[0].url.params) == {
        "name": "New York",
        "count": "3",
        "language": "en",
        "format": "json",
    }
    assert calls[0].extensions["timeout"]["read"] == 5.0
    assert (
        client.get("/api/locations/search", params={"q": "new york", "limit": 3}).status_code == 200
    )
    assert len(calls) == 1


@pytest.mark.parametrize(
    "query", ["x", "   ", "city123", "https://example.test", "a" * 81, "<city>", "New\tYork"]
)
def test_city_search_rejects_invalid_queries(client, query):
    response = client.get("/api/locations/search", params={"q": query})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert query not in response.json()["error"]["message"]


@pytest.mark.parametrize("limit", [0, 9, "nope"])
def test_city_search_validates_limit(client, limit):
    assert (
        client.get("/api/locations/search", params={"q": "Paris", "limit": limit}).status_code
        == 422
    )


def test_city_search_empty_and_unicode(client, upstream):
    responses, _ = upstream
    responses["search"] = {}
    response = client.get("/api/locations/search", params={"q": "São Tomé"})
    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.parametrize(
    "changes",
    [
        {"id": None},
        {"id": 0},
        {"id": True},
        {"id": "123"},
        {"timezone": "Invalid/Zone"},
        {"latitude": float("nan")},
        {"longitude": 200},
        {"country_code": "USA"},
        {"name": None},
        {"country": None},
        {"name": "A\r\nInjected"},
    ],
)
def test_invalid_upstream_city_records_are_dropped(client, upstream, city, changes):
    responses, _ = upstream
    responses["search"] = {"results": [{**city, **changes}, city]}
    response = client.get("/api/locations/search", params={"q": "Paris"})
    assert response.status_code == 200
    assert len(response.json()["results"]) == 1


@pytest.mark.parametrize(
    ("value", "status", "code"),
    [
        (httpx.Response(500, text="upstream-secret"), 502, "location_lookup_unavailable"),
        (
            httpx.Response(302, headers={"location": "http://127.0.0.1/private"}),
            502,
            "location_lookup_unavailable",
        ),
        (httpx.ReadTimeout("upstream-secret"), 504, "upstream_timeout"),
        (httpx.Response(200, text="upstream-secret"), 502, "location_lookup_unavailable"),
    ],
)
def test_location_upstream_errors_are_safe(client, upstream, value, status, code):
    responses, calls = upstream
    responses["search"] = value
    response = client.get("/api/locations/search", params={"q": "Paris"})
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert "upstream-secret" not in response.text
    assert len(calls) == 1


def test_weather_is_grounded_and_proof_has_no_coordinates(client, upstream, weather_query):
    _, calls = upstream
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["location"]["label"] == "New York, New York, United States"
    assert body["grounded"] is True
    assert body["is_forecast"] is True
    assert body["summary"] == "Light rain, 12–18°C, 64% chance of rain."
    assert body["source"]["fetched_at"] == "2026-10-25T12:00:00.000Z"
    assert body["attribution"]["text"] == "Weather data by Open-Meteo.com"
    assert "latitude" not in response.text
    assert "longitude" not in response.text
    encoded = body["weather_token"][4:].split(".")[0]
    proof = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert proof["exp"] - proof["iat"] == 1800
    assert not {"latitude", "longitude", "context", "prompt", "recipient"} & proof.keys()
    assert [request.url.path for request in calls] == ["/v1/get", "/v1/forecast"]
    assert calls[0].url.params["id"] == "5128581"
    forecast_request = calls[1]
    assert forecast_request.url.host == "api.open-meteo.com"
    assert forecast_request.url.params["forecast_days"] == "16"
    assert forecast_request.url.params["timezone"] == weather_query["timezone"]
    assert set(forecast_request.url.params["daily"].split(",")) == {
        "weather_code",
        "temperature_2m_min",
        "temperature_2m_max",
        "precipitation_probability_max",
        "precipitation_sum",
        "wind_speed_10m_max",
    }
    assert client.get("/api/weather", params=weather_query).status_code == 200
    assert len(calls) == 2


@pytest.mark.parametrize(
    ("location_id", "code"),
    [
        (None, "location_required"),
        ("123", "validation_error"),
        ("om:0", "validation_error"),
        ("om:-1", "validation_error"),
        ("om:123", "location_not_found"),
    ],
)
def test_weather_requires_resolvable_city(client, upstream, weather_query, location_id, code):
    if location_id is None:
        del weather_query["location_id"]
    else:
        weather_query["location_id"] = location_id
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


@pytest.mark.parametrize(
    "changes",
    [{"latitude": 40.715}, {"longitude": -74.1}, {"timezone": "America/Toronto"}],
)
def test_weather_rejects_location_mismatch(client, upstream, weather_query, changes):
    response = client.get("/api/weather", params={**weather_query, **changes})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "location_mismatch"


def test_weather_reuses_authoritative_search_city(client, upstream, weather_query):
    _, calls = upstream
    client.get("/api/locations/search", params={"q": "New York"})
    assert client.get("/api/weather", params=weather_query).status_code == 200
    assert [request.url.path for request in calls] == ["/v1/search", "/v1/forecast"]


@pytest.mark.parametrize("day", ["2026-10-24", "2026-11-09"])
def test_weather_date_bounds(client, upstream, weather_query, day):
    response = client.get("/api/weather", params={**weather_query, "date": day})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "date_out_of_range"
    assert response.json()["error"]["details"] == {
        "min_date": "2026-10-25",
        "max_date": "2026-11-08",
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("weather_code", None),
        ("weather_code", True),
        ("weather_code", -1),
        ("temperature_2m_min", None),
        ("temperature_2m_max", float("nan")),
        ("temperature_2m_min", -120),
        ("temperature_2m_min", 10**400),
        ("temperature_2m_max", 95),
        ("temperature_2m_min", 20),
        ("precipitation_probability_max", 101),
        ("precipitation_probability_max", None),
        ("precipitation_sum", -1),
        ("wind_speed_10m_max", float("inf")),
        ("wind_speed_10m_max", "18.2"),
        ("precipitation_sum", None),
        ("wind_speed_10m_max", None),
    ],
)
def test_weather_rejects_incomplete_or_implausible_values(
    client, upstream, weather_query, field, value
):
    responses, _ = upstream
    responses["forecast"]["daily"][field] = [value]
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "weather_unavailable"


@pytest.mark.parametrize("field", ["temperature_2m_max", "precipitation_sum", "wind_speed_10m_max"])
def test_weather_missing_fields_fail(client, upstream, weather_query, field):
    responses, _ = upstream
    del responses["forecast"]["daily"][field]
    assert (
        client.get("/api/weather", params=weather_query).json()["error"]["code"]
        == "weather_unavailable"
    )


@pytest.mark.parametrize(
    "value",
    [
        httpx.Response(500, text="private body"),
        httpx.Response(302, headers={"location": "http://localhost/private"}),
    ],
)
def test_weather_upstream_failures_do_not_redirect(client, upstream, weather_query, value):
    responses, calls = upstream
    responses["forecast"] = value
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "weather_unavailable"
    assert "private" not in response.text
    assert len(calls) == 2


def test_weather_timeout(client, upstream, weather_query):
    responses, _ = upstream
    responses["forecast"] = httpx.ConnectTimeout("secret")
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "upstream_timeout"


def test_forecast_timezone_must_match(client, upstream, weather_query):
    responses, _ = upstream
    responses["forecast"]["timezone"] = "UTC"
    assert client.get("/api/weather", params=weather_query).status_code == 502


def test_unknown_wmo_code_is_not_invented(client, upstream, weather_query):
    responses, _ = upstream
    responses["forecast"]["daily"]["weather_code"] = [9999]
    response = client.get("/api/weather", params=weather_query)
    assert response.status_code == 200
    assert response.json()["forecast"]["condition"] == "Unknown conditions"


def test_weather_local_date_and_cross_year(client, upstream, weather_query, clock):
    responses, _ = upstream
    clock[0] = datetime(2026, 12, 31, 2, tzinfo=UTC)
    # New York is still December 30, making Jan 13 the inclusive +14 date.
    responses["forecast"]["daily"]["time"] = ["2027-01-13"]
    weather_query["date"] = "2027-01-13"
    assert client.get("/api/weather", params=weather_query).status_code == 200
    weather_query["date"] = "2027-01-14"
    assert client.get("/api/weather", params=weather_query).status_code == 422


def test_cache_is_bounded_and_expires(monkeypatch):
    now = [0.0]
    monkeypatch.setattr("app.services.open_meteo.time.monotonic", lambda: now[0])
    cache = BoundedCache()
    for index in range(257):
        cache.put(index, [index])
    assert len(cache.entries) == 256
    assert cache.get(0) is None
    copied = cache.get(256)
    copied.append("not cached")
    assert cache.get(256) == [256]
    now[0] = 600.0
    assert cache.get(256) is None
