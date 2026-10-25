from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_blank_env_values_are_ignored(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "APP_ENV=\n"
        "TICKET_TTL_DAYS=\n"
        "WEATHER_TOKEN_SECRET=\n"
        "AI_PROVIDER=\n"
        "RAINCHECK_ALLOW_PAID_TRAINING=\n",
        encoding="utf-8",
    )

    settings = Settings(_env_file=env_file)

    assert settings.app_env == "development"
    assert settings.ticket_ttl_days == 30
    assert settings.weather_token_secret == ""
    assert settings.ai_provider == "none"
    assert settings.raincheck_allow_paid_training is False


def test_postgres_scheme_is_normalised():
    settings = Settings(
        _env_file=None,
        database_url="postgres://user:pass@example.test/db",
    )

    assert settings.database_url == "postgresql+psycopg://user:pass@example.test/db"


def test_production_requires_weather_secret():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", weather_token_secret="")


def test_ai_generation_is_not_ready_in_foundation():
    settings = Settings(
        _env_file=None,
        ai_provider="tinker",
        tinker_api_key="present-but-not-used",
        tinker_model="not-a-real-model-id",
    )

    assert settings.ai_generation_ready is False
    assert settings.tinker_allow_paid_inference is False


@pytest.mark.parametrize("days", [0, 91])
def test_ticket_ttl_is_bounded(days):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ticket_ttl_days=days)
