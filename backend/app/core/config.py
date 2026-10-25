"""Application settings, loaded from the environment only."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]
DEFAULT_SQLITE_PATH = ROOT_DIR / "backend" / "raincheck-dev.db"


class Settings(BaseSettings):
    """Runtime configuration.

    Secrets are never committed. `.env.example` lists keys with blank values.
    A production process refuses to start without a weather signing secret.
    """

    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", ROOT_DIR / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        env_ignore_empty=True,
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "raincheck-api"
    version: str = "0.1.0"

    database_url: str = f"sqlite:///{DEFAULT_SQLITE_PATH.as_posix()}"
    frontend_origin: str = "http://localhost:5173"
    public_base_url: str = "http://localhost:8000"
    frontend_dist: str = ""

    weather_token_secret: str = ""
    ticket_ttl_days: int = Field(default=30, ge=1, le=90)

    ai_provider: Literal["none", "tinker"] = "none"
    tinker_api_key: str = ""
    tinker_model: str = ""
    tinker_adapter_path: str = ""
    tinker_allow_paid_inference: bool = False
    raincheck_allow_paid_training: bool = False

    enable_api_docs: bool = True
    open_meteo_base_url: str = "https://api.open-meteo.com"

    @field_validator("database_url")
    @classmethod
    def normalise_database_url(cls, value: str) -> str:
        value = value.strip()
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value.removeprefix("postgres://")
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value.removeprefix("postgresql://")
        return value

    @model_validator(mode="after")
    def check_production_secrets(self) -> Settings:
        if self.app_env == "production" and not self.weather_token_secret:
            raise ValueError(
                "WEATHER_TOKEN_SECRET is required in production. "
                'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def ai_generation_ready(self) -> bool:
        """Readiness only; importing/checking the adapter must never call a model."""
        if not self.tinker_allow_paid_inference or self.ai_provider != "tinker":
            return False
        try:
            from app.services.generation.service import generator_ready
        except ImportError:
            return False
        return generator_ready(self)

    @property
    def allowed_origins(self) -> list[str]:
        if self.is_production:
            return []
        origins = {
            self.frontend_origin.rstrip("/"),
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        }
        return sorted(origin for origin in origins if origin)

    @property
    def frontend_dist_path(self) -> Path:
        if self.frontend_dist:
            return Path(self.frontend_dist).expanduser().resolve()
        return ROOT_DIR / "frontend" / "dist"


@lru_cache
def get_settings() -> Settings:
    return Settings()
