"""Shared, bounded plain-text and proposed-time schemas."""

import re
import unicodedata
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field, ValidationInfo, field_validator

from app.core.time import timezone_name
from app.models.enums import Relationship, Tone


def clean_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return "".join(
        char
        for char in value
        if char in "\n\t" or unicodedata.category(char) not in {"Cc", "Cf", "Cs"}
    ).strip()


def optional_text(value: Any) -> Any:
    value = clean_text(value)
    return None if value == "" else value


Name = Annotated[
    Annotated[str, Field(min_length=1, max_length=40)] | None, BeforeValidator(optional_text)
]
Title = Annotated[
    Annotated[str, Field(min_length=1, max_length=80)] | None, BeforeValidator(optional_text)
]
Details = Annotated[
    Annotated[str, Field(min_length=1, max_length=400)] | None, BeforeValidator(optional_text)
]
LocationLabel = Annotated[
    Annotated[str, Field(min_length=1, max_length=120)] | None, BeforeValidator(optional_text)
]
Clock = Annotated[str, Field(pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
WeatherToken = Annotated[str, Field(min_length=1, max_length=8192)]


def strict_date(value: Any) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Use a date in YYYY-MM-DD format.")
    return date.fromisoformat(value)


CalendarDate = Annotated[date, BeforeValidator(strict_date)]


class Recipient(BaseModel):
    relationship: Relationship
    display_name: Name | None = None


class Plan(BaseModel):
    title: Title | None = None
    details: Details | None = None


class ProposedTime(BaseModel):
    date: CalendarDate
    start_time: Clock
    end_time: Clock | None = None
    timezone: str
    location_label: LocationLabel | None = None

    _timezone = field_validator("timezone")(timezone_name)

    @field_validator("end_time")
    @classmethod
    def time_order(cls, value: str | None, info: ValidationInfo) -> str | None:
        start = info.data.get("start_time")
        if value is not None and start is not None and value <= start:
            raise ValueError("End time must be after start time.")
        return value


class DraftFields(BaseModel):
    recipient: Recipient
    tone: Tone
    plan: Plan = Field(default_factory=Plan)
    proposed: ProposedTime
    weather_token: WeatherToken | None = None
    sender_name: Name | None = None


class TicketLabels(BaseModel):
    theatrical: bool
    availability_confirmed: Literal[False] = False


class Attribution(BaseModel):
    text: str
    url: Literal["https://open-meteo.com/"] = "https://open-meteo.com/"
