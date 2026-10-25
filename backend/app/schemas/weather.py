"""Typed Open-Meteo results, forecast snapshots and strict signed proofs."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.core.time import timezone_name
from app.schemas.common import Attribution

Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]
Temperature = Annotated[Number, Field(ge=-100, le=70)]
Probability = Annotated[StrictInt, Field(ge=0, le=100)]
Code = Annotated[StrictInt, Field(ge=0)]
Precipitation = Annotated[Number, Field(ge=0, le=2000)]
Wind = Annotated[Number, Field(ge=0, le=500)]


class LocationResult(BaseModel):
    id: str = Field(pattern=r"^om:[1-9][0-9]*$")
    name: str = Field(min_length=1, max_length=80, strict=True)
    admin1: str | None = Field(default=None, max_length=80, strict=True)
    country: str = Field(min_length=1, max_length=80, strict=True)
    country_code: str = Field(pattern=r"^[A-Z]{2}$", strict=True)
    latitude: Number = Field(ge=-90, le=90)
    longitude: Number = Field(ge=-180, le=180)
    timezone: str

    _timezone = field_validator("timezone")(timezone_name)

    @property
    def label(self) -> str:
        return ", ".join(part for part in (self.name, self.admin1, self.country) if part)


class LocationsResponse(BaseModel):
    query: str
    results: list[LocationResult]
    attribution: Attribution


class WeatherLocation(BaseModel):
    label: str
    name: str
    admin1: str | None
    country: str
    country_code: str
    timezone: str


class Forecast(BaseModel):
    weather_code: Code
    condition: str
    temperature_min_c: Temperature
    temperature_max_c: Temperature
    precipitation_probability_max: Probability
    precipitation_sum_mm: Precipitation
    wind_speed_max_kmh: Wind

    @model_validator(mode="after")
    def ordered_temperatures(self) -> "Forecast":
        if self.temperature_min_c > self.temperature_max_c:
            raise ValueError("Invalid temperature range.")
        return self


class WeatherSource(BaseModel):
    provider: Literal["open-meteo"] = "open-meteo"
    endpoint: Literal["forecast"] = "forecast"
    model: Literal["best_match"] = "best_match"
    fetched_at: str


class WeatherResponse(BaseModel):
    date: str
    location: WeatherLocation
    forecast: Forecast
    summary: str
    grounded: Literal[True] = True
    is_forecast: Literal[True] = True
    source: WeatherSource
    attribution: Attribution
    weather_token: str


class WeatherProof(Forecast):
    model_config = ConfigDict(extra="forbid", strict=True)

    v: Literal[1]
    iat: StrictInt
    exp: StrictInt
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    location_label: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=300)
    source: Literal["open-meteo"]
    fetched_at: str

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: str) -> str:
        datetime.strptime(value, "%Y-%m-%d")
        return value

    @field_validator("fetched_at")
    @classmethod
    def valid_timestamp(cls, value: str) -> str:
        if not value.endswith("Z"):
            raise ValueError("Invalid UTC timestamp.")
        datetime.fromisoformat(value)
        return value


class WeatherSnapshot(BaseModel):
    date: str
    weather_code: int
    condition: str
    summary: str
    temperature_min_c: float
    temperature_max_c: float
    precipitation_probability_max: int
    source: Literal["open-meteo"] = "open-meteo"
    fetched_at: str
    attribution: Attribution
