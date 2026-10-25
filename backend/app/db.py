"""Database engine, session and schema bootstrap (MVP: create_all)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from fastapi import Request
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def make_engine(database_url: str) -> Engine:
    kwargs: dict[str, Any] = {"future": True, "pool_pre_ping": True}
    if database_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(database_url, **kwargs)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db(engine: Engine) -> None:
    # Import models so their tables are registered on Base.metadata.
    from app.models import ticket  # noqa: F401

    inspector = inspect(engine)
    if inspector.has_table("tickets"):
        for constraint in inspector.get_check_constraints("tickets"):
            if constraint["name"] == "ck_tickets_relationship" and not any(
                value in constraint["sqltext"] for value in ("'group'", '"group"')
            ):
                raise RuntimeError(
                    "The existing ticket relationship constraint predates group support. "
                    "Startup stopped without changing data. Apply a preserving migration "
                    "or explicitly select a fresh database; do not reset existing data."
                )
    Base.metadata.create_all(bind=engine)


def get_db(request: Request) -> Iterator[Session]:
    session_factory: sessionmaker[Session] = request.app.state.session_factory
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


def database_ok(session: Session) -> bool:
    try:
        session.execute(text("SELECT 1"))
        return True
    except Exception:
        # Health must turn any DB/driver failure into a typed 503, not a 500.
        return False
