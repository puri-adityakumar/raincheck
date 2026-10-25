"""Ticket persistence model.

The raw share token is never stored. Only its SHA-256 hex digest is persisted,
so a database leak cannot replay share links. Coordinates and prompts are not
part of this table by design.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, Date, DateTime, Index, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import RELATIONSHIP_VALUES, TONE_VALUES


def utc_now() -> datetime:
    return datetime.now(UTC)


_RELATIONSHIP_SQL = ", ".join(f"'{value}'" for value in RELATIONSHIP_VALUES)
_TONE_SQL = ", ".join(f"'{value}'" for value in TONE_VALUES)


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        CheckConstraint(f"relationship IN ({_RELATIONSHIP_SQL})", name="ck_tickets_relationship"),
        CheckConstraint(f"tone IN ({_TONE_SQL})", name="ck_tickets_tone"),
        Index("ix_tickets_expires_at", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    message: Mapped[str] = mapped_column(Text, nullable=False)
    sender_name: Mapped[str | None] = mapped_column(String(40), nullable=True)

    relationship: Mapped[str] = mapped_column(String(24), nullable=False)
    recipient_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    tone: Mapped[str] = mapped_column(String(16), nullable=False)
    plan_title: Mapped[str | None] = mapped_column(String(80), nullable=True)
    plan_details: Mapped[str | None] = mapped_column(String(400), nullable=True)

    proposed_date: Mapped[date] = mapped_column(Date, nullable=False)
    proposed_start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    proposed_end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    location_label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    weather_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
