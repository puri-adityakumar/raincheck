"""Health schemas (implemented in the foundation)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class Capabilities(BaseModel):
    weather: bool
    tickets: bool
    ai_generation: bool
    ai_provider: Literal["none", "tinker"]
    paid_training_enabled: bool


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["raincheck-api"]
    version: str
    time: str
    database: Literal["ok"]
    capabilities: Capabilities
