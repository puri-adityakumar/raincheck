"""Retained databases must fail clearly, never lose data or claim false readiness."""

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import CheckConstraint, Engine, MetaData, inspect
from sqlalchemy.orm import Session

from app.db import init_db, make_engine
from app.models.ticket import Ticket


@pytest.fixture
def engine() -> Iterator[Engine]:
    instance = make_engine("sqlite:///:memory:")
    try:
        yield instance
    finally:
        instance.dispose()


def add_ticket(engine: Engine, relationship: str = "friend") -> UUID:
    with Session(engine) as session:
        ticket = Ticket(
            token_hash="b" * 64,
            message="Synthetic retained note.",
            relationship=relationship,
            tone="honest",
            proposed_date=date(2026, 10, 26),
            proposed_start_time="15:00",
            timezone="UTC",
            expires_at=datetime.now(UTC) + timedelta(days=30),
        )
        session.add(ticket)
        session.commit()
        return ticket.id


def test_fresh_schema_supports_group(engine: Engine):
    init_db(engine)
    ticket_id = add_ticket(engine, "group")
    with Session(engine) as session:
        assert session.get(Ticket, ticket_id).relationship == "group"


def test_legacy_schema_is_rejected_without_changing_rows_or_constraints(engine: Engine):
    metadata = MetaData()
    legacy = Ticket.__table__.to_metadata(metadata)
    constraint = next(
        value for value in legacy.constraints if value.name == "ck_tickets_relationship"
    )
    legacy.constraints.remove(constraint)
    legacy.append_constraint(
        CheckConstraint(
            "relationship IN ('friend', 'coworker', 'family', 'date', 'neighbor', 'other')",
            name="ck_tickets_relationship",
        )
    )
    metadata.create_all(engine)
    ticket_id = add_ticket(engine)
    before = inspect(engine).get_check_constraints("tickets")

    with pytest.raises(RuntimeError, match="preserving migration"):
        init_db(engine)

    assert inspect(engine).get_check_constraints("tickets") == before
    with Session(engine) as session:
        ticket = session.get(Ticket, ticket_id)
        assert ticket.message == "Synthetic retained note."
        assert ticket.token_hash == "b" * 64
        assert session.query(Ticket).count() == 1


def test_current_schema_restart_keeps_existing_ticket(engine: Engine):
    init_db(engine)
    ticket_id = add_ticket(engine)
    before = inspect(engine).get_check_constraints("tickets")
    init_db(engine)
    assert inspect(engine).get_check_constraints("tickets") == before
    with Session(engine) as session:
        assert session.get(Ticket, ticket_id).message == "Synthetic retained note."
        assert session.query(Ticket).count() == 1
