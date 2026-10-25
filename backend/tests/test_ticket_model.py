"""Ticket model schema is present and persists without a raw token."""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app.db import init_db, make_engine, make_session_factory
from app.models.ticket import Ticket


def test_ticket_round_trip_has_no_raw_token(tmp_path):
    engine = make_engine(f"sqlite:///{(tmp_path / 'model.db').as_posix()}")
    init_db(engine)
    factory = make_session_factory(engine)

    raw_token = "example-raw-token-never-stored"
    now = datetime.now(UTC)
    with factory() as session:
        ticket = Ticket(
            token_hash=hashlib.sha256(raw_token.encode()).hexdigest(),
            message="Hello there.",
            relationship="friend",
            tone="cozy",
            proposed_date=date.today() + timedelta(days=2),
            proposed_start_time="15:00",
            timezone="UTC",
            created_at=now,
            expires_at=now + timedelta(days=30),
        )
        session.add(ticket)
        session.commit()
        ticket_id = ticket.id

    with factory() as session:
        stored = session.scalar(select(Ticket).where(Ticket.id == ticket_id))
        assert stored is not None
        assert stored.token_hash == hashlib.sha256(raw_token.encode()).hexdigest()
        assert not hasattr(stored, "token")
        assert stored.message == "Hello there."
        assert stored.weather_json is None

    engine.dispose()
