"""Hash-only ticket storage and atomic, idempotent acceptance."""

import hashlib
import re
import secrets
import uuid
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import APIError
from app.core.time import as_utc, timestamp, utc_now, validate_proposed
from app.models.ticket import Ticket
from app.schemas.common import Plan, ProposedTime, Recipient, TicketLabels
from app.schemas.tickets import (
    AcceptResponse,
    Availability,
    CreateTicketRequest,
    CreateTicketResponse,
    TicketResponse,
)
from app.schemas.weather import WeatherSnapshot
from app.services.weather_tokens import public_snapshot, verify_weather_token


def _token_hash(token: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise APIError(404, "ticket_not_found", "This ticket was not found.")
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def get_ticket(db: Session, token: str) -> Ticket:
    ticket = db.scalar(select(Ticket).where(Ticket.token_hash == _token_hash(token)))
    if ticket is None:
        raise APIError(404, "ticket_not_found", "This ticket was not found.")
    if as_utc(ticket.expires_at) <= utc_now():
        raise APIError(410, "ticket_expired", "This ticket has expired.")
    return ticket


def proposed_for(ticket: Ticket) -> ProposedTime:
    return ProposedTime(
        date=ticket.proposed_date.isoformat(),
        start_time=ticket.proposed_start_time,
        end_time=ticket.proposed_end_time,
        timezone=ticket.timezone,
        location_label=ticket.location_label,
    )


def create_ticket(
    db: Session, settings: Settings, payload: CreateTicketRequest
) -> CreateTicketResponse:
    if payload.reviewed is not True:
        raise APIError(422, "review_required", "Review the current note before creating a ticket.")
    now = utc_now()
    proposed = payload.proposed
    validate_proposed(proposed.date, proposed.start_time, proposed.end_time, proposed.timezone, now)
    expires = now + timedelta(days=settings.ticket_ttl_days)
    if proposed.date > expires.astimezone(ZoneInfo(proposed.timezone)).date():
        raise APIError(
            422,
            "date_out_of_ticket_window",
            "Choose a suggested date before this ticket expires.",
        )
    snapshot = None
    label = proposed.location_label
    if payload.weather_token is not None:
        proof = verify_weather_token(settings, payload.weather_token, proposed.date)
        snapshot = public_snapshot(proof).model_dump(mode="json")
        label = proof.location_label
    token = secrets.token_urlsafe(32)
    ticket = Ticket(
        id=uuid.uuid4(),
        token_hash=_token_hash(token),
        message=payload.message,
        sender_name=payload.sender_name,
        relationship=payload.recipient.relationship.value,
        recipient_name=payload.recipient.display_name,
        tone=payload.tone.value,
        plan_title=payload.plan.title,
        plan_details=payload.plan.details,
        proposed_date=proposed.date,
        proposed_start_time=proposed.start_time,
        proposed_end_time=proposed.end_time,
        timezone=proposed.timezone,
        location_label=label,
        weather_json=snapshot,
        created_at=now,
        expires_at=expires,
    )
    db.add(ticket)
    db.commit()
    return CreateTicketResponse(
        ticket_id=str(ticket.id),
        token=token,
        share_path=f"/t/{token}",
        accept_path=f"/api/tickets/{token}/accept",
        ics_path=f"/api/tickets/{token}/raincheck.ics",
        created_at=timestamp(now),
        expires_at=timestamp(expires),
        proposed=proposed_for(ticket),
        labels=TicketLabels(theatrical=ticket.tone == "theatrical"),
    )


def public_ticket(ticket: Ticket) -> TicketResponse:
    return TicketResponse(
        ticket_id=str(ticket.id),
        status="accepted" if ticket.accepted_at is not None else "open",
        message=ticket.message,
        sender_name=ticket.sender_name,
        recipient=Recipient(relationship=ticket.relationship, display_name=ticket.recipient_name),
        tone=ticket.tone,
        theatrical=ticket.tone == "theatrical",
        plan=Plan(title=ticket.plan_title, details=ticket.plan_details),
        proposed=proposed_for(ticket),
        weather=WeatherSnapshot.model_validate(ticket.weather_json)
        if ticket.weather_json
        else None,
        availability=Availability(),
        created_at=timestamp(ticket.created_at),
        expires_at=timestamp(ticket.expires_at),
        accepted_at=timestamp(ticket.accepted_at) if ticket.accepted_at is not None else None,
    )


def accept_ticket(db: Session, token: str) -> AcceptResponse:
    token_hash = _token_hash(token)
    now = utc_now()
    result = db.execute(
        update(Ticket)
        .where(
            Ticket.token_hash == token_hash,
            Ticket.accepted_at.is_(None),
            Ticket.expires_at > now,
        )
        .values(accepted_at=now)
        .execution_options(synchronize_session=False)
    )
    first = result.rowcount == 1
    db.commit()
    # Re-read after committing: concurrent calls observe the first timestamp.
    ticket = get_ticket(db, token)
    if ticket.accepted_at is None:
        raise APIError(500, "internal_error", "Acceptance could not be saved. Please try again.")
    return AcceptResponse(
        ticket_id=str(ticket.id),
        accepted_at=timestamp(ticket.accepted_at),
        already_accepted=not first,
    )
