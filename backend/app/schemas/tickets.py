"""Ticket creation and deliberately minimal public responses."""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, StrictBool

from app.models.enums import Tone
from app.schemas.common import (
    DraftFields,
    Plan,
    ProposedTime,
    Recipient,
    TicketLabels,
    clean_text,
)
from app.schemas.weather import WeatherSnapshot


class CreateTicketRequest(DraftFields):
    message: Annotated[str, BeforeValidator(clean_text), Field(min_length=1, max_length=1200)]
    reviewed: StrictBool


class CreateTicketResponse(BaseModel):
    ticket_id: str
    token: str
    share_path: str
    accept_path: str
    ics_path: str
    status: Literal["open"] = "open"
    created_at: str
    expires_at: str
    proposed: ProposedTime
    labels: TicketLabels


class Availability(BaseModel):
    confirmed: Literal[False] = False
    note: str = "This is a suggestion. The recipient's calendar has not been checked."


class TicketResponse(BaseModel):
    ticket_id: str
    status: Literal["open", "accepted"]
    message: str
    sender_name: str | None
    recipient: Recipient
    tone: Tone
    theatrical: bool
    plan: Plan
    proposed: ProposedTime
    weather: WeatherSnapshot | None
    availability: Availability
    created_at: str
    expires_at: str
    accepted_at: str | None


class AcceptResponse(BaseModel):
    ticket_id: str
    status: Literal["accepted"] = "accepted"
    accepted_at: str
    already_accepted: bool
