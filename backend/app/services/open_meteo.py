"""Fixed-host, timeout-bound Open-Meteo access. No caller-controlled URLs."""

import math
import time
from collections import OrderedDict
from copy import deepcopy
from datetime import date, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from pydantic import ValidationError

from app.core.errors import APIError
from app.core.time import timestamp, utc_now
from app.schemas.common import Attribution, clean_text
from app.schemas.weather import Forecast, LocationResult

SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search"
CITY_URL = "https://geocoding-api.open-meteo.com/v1/get"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WEATHER_ATTRIBUTION = Attribution(text="Weather data by Open-Meteo.com")
LOCATION_ATTRIBUTION = Attribution(text="Location search by Open-Meteo.com")

WMO_CONDITIONS = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Light rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Light snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with light hail",
    99: "Thunderstorm with heavy hail",
}


def condition_for(code: int) -> str:
    return WMO_CONDITIONS.get(code, "Unknown conditions")


def forecast_summary(forecast: Forecast) -> str:
    return (
        f"{forecast.condition}, "
        f"{round(forecast.temperature_min_c)}–{round(forecast.temperature_max_c)}°C, "
        f"{forecast.precipitation_probability_max}% chance of rain."
    )


class BoundedCache:
    """Per-app LRU cache, never larger than 256 entries or older than ten minutes."""

    def __init__(self) -> None:
        self.entries: OrderedDict[Any, tuple[float, Any]] = OrderedDict()

    def get(self, key: Any) -> Any:
        cached = self.entries.get(key)
        if cached is None:
            return None
        expires, value = cached
        if time.monotonic() >= expires:
            del self.entries[key]
            return None
        self.entries.move_to_end(key)
        return deepcopy(value)

    def put(self, key: Any, value: Any) -> None:
        self.entries[key] = (time.monotonic() + 600, deepcopy(value))
        self.entries.move_to_end(key)
        while len(self.entries) > 256:
            self.entries.popitem(last=False)


def parse_city(raw: Any) -> LocationResult | None:
    if not isinstance(raw, dict) or type(raw.get("id")) is not int or raw["id"] <= 0:
        return None
    try:
        city = LocationResult(
            id=f"om:{raw['id']}",
            name=raw.get("name"),
            admin1=raw.get("admin1"),
            country=raw.get("country"),
            country_code=raw.get("country_code"),
            latitude=raw.get("latitude"),
            longitude=raw.get("longitude"),
            timezone=raw.get("timezone"),
        )
        # Labels are never invented/truncated to fit a ticket or signing proof.
        if len(city.label) > 120 or any(
            clean_text(value) != value or "\n" in value or "\t" in value
            for value in (city.name, city.admin1 or "", city.country)
        ):
            return None
        return city.model_copy(
            update={"latitude": round(city.latitude, 4), "longitude": round(city.longitude, 4)}
        )
    except (ValidationError, ValueError, TypeError):
        return None


class OpenMeteo:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.search_cache = BoundedCache()
        self.city_cache = BoundedCache()
        self.forecast_cache = BoundedCache()

    async def _get(self, url: str, params: dict[str, Any], kind: str) -> Any:
        try:
            response = await self.client.get(
                url, params=params, timeout=5.0, follow_redirects=False
            )
            if url == CITY_URL and response.status_code == 404:
                return None
            if response.status_code != 200:
                raise ValueError("Upstream response unavailable.")
            return response.json()
        except httpx.TimeoutException as exc:
            raise APIError(
                504, "upstream_timeout", "The data provider took too long. Try again."
            ) from exc
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            code = "location_lookup_unavailable" if kind == "location" else "weather_unavailable"
            raise APIError(
                502, code, "The data provider is unavailable. Please try again."
            ) from exc

    async def search(self, query: str, limit: int) -> list[LocationResult]:
        key = (query.casefold(), limit)
        cached = self.search_cache.get(key)
        if cached is not None:
            return cached
        body = await self._get(
            SEARCH_URL,
            {"name": query, "count": limit, "language": "en", "format": "json"},
            "location",
        )
        if not isinstance(body, dict) or not isinstance(body.get("results", []), list):
            raise APIError(502, "location_lookup_unavailable", "Location search is unavailable.")
        results = []
        for raw in body.get("results", [])[:100]:
            city = parse_city(raw)
            if city is not None:
                results.append(city)
                self.city_cache.put(city.id, city)
                if len(results) == limit:
                    break
        self.search_cache.put(key, results)
        return results

    async def resolve_city(self, location_id: str) -> LocationResult:
        cached = self.city_cache.get(location_id)
        if cached is not None:
            return cached
        body = await self._get(
            CITY_URL, {"id": location_id.removeprefix("om:"), "language": "en"}, "location"
        )
        if isinstance(body, dict) and isinstance(body.get("results"), list):
            candidates = body["results"][:100]
        else:
            candidates = [body]
        for raw in candidates:
            city = parse_city(raw)
            if city is not None and city.id == location_id:
                self.city_cache.put(location_id, city)
                return city
        raise APIError(422, "location_not_found", "Choose a city from location search.")

    async def forecast(
        self, latitude: float, longitude: float, day: date, timezone: str
    ) -> tuple[Forecast, str]:
        today = utc_now().astimezone(ZoneInfo(timezone)).date()
        maximum = today + timedelta(days=14)
        if not today <= day <= maximum:
            raise APIError(
                422,
                "date_out_of_range",
                "Choose a forecast date within the next fourteen days.",
                {"min_date": today.isoformat(), "max_date": maximum.isoformat()},
            )
        key = (round(latitude, 4), round(longitude, 4), day.isoformat(), timezone)
        cached = self.forecast_cache.get(key)
        if cached is not None:
            return cached
        fields = {
            "weather_code": "weather_code",
            "temperature_2m_min": "temperature_min_c",
            "temperature_2m_max": "temperature_max_c",
            "precipitation_probability_max": "precipitation_probability_max",
            "precipitation_sum": "precipitation_sum_mm",
            "wind_speed_10m_max": "wind_speed_max_kmh",
        }
        body = await self._get(
            FORECAST_URL,
            {
                "latitude": key[0],
                "longitude": key[1],
                "timezone": timezone,
                "daily": ",".join(fields),
                "forecast_days": 16,
                "temperature_unit": "celsius",
                "wind_speed_unit": "kmh",
                "precipitation_unit": "mm",
            },
            "weather",
        )
        try:
            if not isinstance(body, dict) or body.get("timezone") != timezone:
                raise ValueError("Invalid timezone.")
            daily = body["daily"]
            days = daily["time"]
            if not isinstance(days, list) or days.count(day.isoformat()) != 1:
                raise ValueError("Missing forecast date.")
            index = days.index(day.isoformat())
            values = {}
            for upstream, local in fields.items():
                series = daily[upstream]
                if not isinstance(series, list) or len(series) != len(days):
                    raise ValueError("Missing forecast field.")
                value = series[index]
                if type(value) not in (int, float) or not math.isfinite(value):
                    raise ValueError("Invalid forecast value.")
                values[local] = value
            forecast = Forecast(condition=condition_for(values["weather_code"]), **values)
        except (KeyError, IndexError, TypeError, ValueError, OverflowError, ValidationError) as exc:
            raise APIError(
                502, "weather_unavailable", "A complete forecast is not available for that date."
            ) from exc
        result = (forecast, timestamp(utc_now()))
        self.forecast_cache.put(key, result)
        return result
