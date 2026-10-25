"""A forecast can only be attached to an authoritative, resolved city."""

from typing import Annotated

from fastapi import APIRouter, Query, Request

from app.core.errors import APIError
from app.core.time import timezone_name
from app.schemas.common import CalendarDate
from app.schemas.weather import WeatherLocation, WeatherResponse, WeatherSource
from app.services.open_meteo import WEATHER_ATTRIBUTION, forecast_summary
from app.services.weather_tokens import issue_weather_token

router = APIRouter(tags=["weather"])


@router.get("/weather", response_model=WeatherResponse)
async def weather(
    request: Request,
    latitude: Annotated[float, Query(ge=-90, le=90, allow_inf_nan=False)],
    longitude: Annotated[float, Query(ge=-180, le=180, allow_inf_nan=False)],
    date: CalendarDate,
    timezone: str = Query(..., max_length=64),
    location_id: str = Query(..., max_length=40, pattern=r"^om:[1-9][0-9]*$"),
) -> WeatherResponse:
    try:
        timezone_name(timezone)
    except ValueError as exc:
        raise APIError(422, "validation_error", "Choose a valid IANA timezone.") from exc
    service = request.app.state.open_meteo
    city = await service.resolve_city(location_id)
    if (
        round(latitude, 4) != city.latitude
        or round(longitude, 4) != city.longitude
        or timezone != city.timezone
    ):
        raise APIError(
            422,
            "location_mismatch",
            "The city and forecast location do not match. Choose the city again.",
        )
    forecast, fetched_at = await service.forecast(city.latitude, city.longitude, date, timezone)
    return WeatherResponse(
        date=date.isoformat(),
        location=WeatherLocation(
            label=city.label,
            **city.model_dump(exclude={"id", "latitude", "longitude"}),
        ),
        forecast=forecast,
        summary=forecast_summary(forecast),
        source=WeatherSource(fetched_at=fetched_at),
        attribution=WEATHER_ATTRIBUTION,
        weather_token=issue_weather_token(
            request.app.state.settings, date, city.label, forecast, fetched_at
        ),
    )
