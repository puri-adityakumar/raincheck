"""UTC serialization and explicit, DST-safe local time handling."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from app.core.errors import APIError

_IANA_TIMEZONES = available_timezones() - {"localtime"}


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    # SQLite returns naive values even for DateTime(timezone=True).
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def timestamp(value: datetime) -> str:
    return as_utc(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def timezone_name(value: str) -> str:
    try:
        if not value or len(value) > 64 or value not in _IANA_TIMEZONES:
            raise ValueError("Invalid timezone.")
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError("Choose a valid IANA timezone.") from exc
    return value


def local_instant(day: date, clock: str, timezone: str) -> datetime:
    wall = datetime.combine(day, time.fromisoformat(clock))
    # fold=0 deliberately picks the earlier occurrence of an ambiguous time.
    local = wall.replace(tzinfo=ZoneInfo(timezone), fold=0)
    instant = local.astimezone(UTC)
    if instant.astimezone(local.tzinfo).replace(tzinfo=None) != wall:
        raise APIError(
            422,
            "invalid_local_time",
            "That local time does not exist because the clocks change. Choose another time.",
        )
    return instant


def validate_proposed(
    day: date, start: str, end: str | None, timezone: str, now: datetime | None = None
) -> None:
    today = (now or utc_now()).astimezone(ZoneInfo(timezone)).date()
    if not today <= day <= today + timedelta(days=365):
        raise APIError(
            422,
            "validation_error",
            "Some fields need attention.",
            {
                "fields": [
                    {"path": "proposed.date", "message": "Choose a date within the next year."}
                ]
            },
        )
    local_instant(day, start, timezone)
    if end is not None:
        local_instant(day, end, timezone)
