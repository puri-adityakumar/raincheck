"""Test fixtures: isolated SQLite file per test, no network, no AI."""

from __future__ import annotations

import importlib
from collections.abc import Iterator
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def test_settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        database_url=f"sqlite:///{(tmp_path / 'raincheck-test.db').as_posix()}",
        weather_token_secret="test-only-weather-secret",
        frontend_dist=str(tmp_path / "no-frontend-dist"),
        ai_provider="none",
        raincheck_allow_paid_training=False,
        enable_api_docs=True,
    )


@pytest.fixture
def client(test_settings: Settings) -> Iterator[TestClient]:
    app = create_app(test_settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def no_external_http(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Real network access is forbidden in backend tests.")

    async def async_blocked(*args, **kwargs):
        blocked()

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", async_blocked)


@pytest.fixture
def clock(monkeypatch):
    value = [datetime(2026, 10, 25, 12, 0, tzinfo=UTC)]
    for module in (
        "app.core.time",
        "app.services.open_meteo",
        "app.services.weather_tokens",
        "app.services.tickets",
        "app.services.calendar",
        "app.api.routes.generate",
    ):
        monkeypatch.setattr(importlib.import_module(module), "utc_now", lambda: value[0])
    return value


@pytest.fixture
def ticket_payload(clock) -> dict[str, Any]:
    return deepcopy(
        {
            "message": "Let's find another time for coffee.",
            "sender_name": "Alex",
            "recipient": {"relationship": "group", "display_name": "Sam"},
            "tone": "cozy",
            "plan": {"title": "Coffee", "details": "The corner place."},
            "proposed": {
                "date": "2026-10-30",
                "start_time": "15:00",
                "end_time": "16:00",
                "timezone": "America/New_York",
                "location_label": "New York",
            },
            "reviewed": True,
        }
    )


@pytest.fixture
def city():
    return {
        "id": 5128581,
        "name": "New York",
        "admin1": "New York",
        "country": "United States",
        "country_code": "US",
        "latitude": 40.71427,
        "longitude": -74.00597,
        "timezone": "America/New_York",
    }


@pytest.fixture
def weather_query(clock):
    return {
        "location_id": "om:5128581",
        "latitude": 40.7143,
        "longitude": -74.006,
        "date": "2026-10-30",
        "timezone": "America/New_York",
    }


@pytest.fixture
def daily_weather():
    return {
        "timezone": "America/New_York",
        "daily": {
            "time": ["2026-10-30"],
            "weather_code": [61],
            "temperature_2m_min": [12.1],
            "temperature_2m_max": [17.8],
            "precipitation_probability_max": [64],
            "precipitation_sum": [2.4],
            "wind_speed_10m_max": [18.2],
        },
    }


@pytest.fixture
def upstream(client, city, daily_weather, monkeypatch):
    calls = []
    responses = {"search": {"results": [city]}, "get": city, "forecast": daily_weather}

    def handler(request):
        calls.append(request)
        value = responses[request.url.path.rsplit("/", 1)[-1]]
        if isinstance(value, Exception):
            raise value
        if isinstance(value, httpx.Response):
            return value
        # Preserve deliberate NaN test fixtures, which httpx json= rejects.
        import json

        return httpx.Response(
            200, content=json.dumps(value), headers={"content-type": "application/json"}
        )

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(client.app.state.open_meteo.client, "_transport", transport)
    return responses, calls
