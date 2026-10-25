"""Health route: shallow liveness plus capability truth."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.errors import APIError
from app.db import database_ok, get_db
from app.schemas.health import Capabilities, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request, db: Session = Depends(get_db)) -> HealthResponse:
    if not database_ok(db):
        raise APIError(
            status_code=503,
            code="service_unavailable",
            message="Raincheck is not ready yet. Please try again in a moment.",
            details={"database": "unavailable"},
        )

    settings = request.app.state.settings
    return HealthResponse(
        status="ok",
        service="raincheck-api",
        version=settings.version,
        time=datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        database="ok",
        capabilities=Capabilities(
            weather=True,
            tickets=True,
            ai_generation=settings.ai_generation_ready,
            ai_provider=settings.ai_provider,
            paid_training_enabled=settings.raincheck_allow_paid_training,
        ),
    )
