"""Reviewed ticket creation, public reads, acceptance and ICS downloads."""

from typing import Any

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.tickets import (
    AcceptResponse,
    CreateTicketRequest,
    CreateTicketResponse,
    TicketResponse,
)
from app.services.calendar import calendar_bytes
from app.services.tickets import accept_ticket, create_ticket, get_ticket, public_ticket

router = APIRouter(tags=["tickets"])


@router.post("/tickets", status_code=201, response_model=CreateTicketResponse)
def create(
    payload: CreateTicketRequest, request: Request, db: Session = Depends(get_db)
) -> CreateTicketResponse:
    return create_ticket(db, request.app.state.settings, payload)


@router.get("/tickets/{token}", response_model=TicketResponse)
def read(token: str, db: Session = Depends(get_db)) -> TicketResponse:
    return public_ticket(get_ticket(db, token))


@router.post("/tickets/{token}/accept", response_model=AcceptResponse)
def accept(
    token: str, payload: dict[str, Any] | None = Body(default=None), db: Session = Depends(get_db)
) -> AcceptResponse:
    return accept_ticket(db, token)


@router.get("/tickets/{token}/raincheck.ics")
def download_calendar(token: str, db: Session = Depends(get_db)) -> Response:
    ticket = get_ticket(db, token)
    return Response(
        calendar_bytes(ticket),
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="raincheck-{str(ticket.id)[:8]}.ics"'
        },
    )
