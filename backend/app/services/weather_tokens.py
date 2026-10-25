"""Short-lived HMAC proofs containing only a city label and verified forecast."""

import base64
import hashlib
import hmac
import json
import re
import secrets
from datetime import date, datetime
from typing import Any

from pydantic import ValidationError

from app.core.config import Settings
from app.core.errors import APIError
from app.core.time import utc_now
from app.schemas.common import clean_text
from app.schemas.weather import Forecast, WeatherProof, WeatherSnapshot
from app.services.open_meteo import WEATHER_ATTRIBUTION, condition_for, forecast_summary

_DEVELOPMENT_KEY = secrets.token_bytes(48)


def _key(settings: Settings) -> bytes:
    return settings.weather_token_secret.encode() or _DEVELOPMENT_KEY


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid encoding.")
    decoded = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if _encode(decoded) != value:
        raise ValueError("Noncanonical encoding.")
    return decoded


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate field.")
        result[key] = value
    return result


def issue_weather_token(
    settings: Settings, day: date, label: str, forecast: Forecast, fetched_at: str
) -> str:
    now = int(utc_now().timestamp())
    payload = {
        "v": 1,
        "iat": now,
        "exp": now + 1800,
        "date": day.isoformat(),
        "location_label": label,
        **forecast.model_dump(),
        "summary": forecast_summary(forecast),
        "source": "open-meteo",
        "fetched_at": fetched_at,
    }
    encoded = _encode(json.dumps(payload, separators=(",", ":"), allow_nan=False).encode())
    signature = _encode(hmac.digest(_key(settings), encoded.encode(), hashlib.sha256))
    return f"wxs_{encoded}.{signature}"


def verify_weather_token(settings: Settings, token: str, day: date) -> WeatherProof:
    reason = "invalid"
    try:
        if not isinstance(token, str) or len(token) > 8192 or not token.startswith("wxs_"):
            raise ValueError("Invalid proof.")
        encoded, signature = token[4:].split(".")
        expected = hmac.digest(_key(settings), encoded.encode("ascii"), hashlib.sha256)
        if not hmac.compare_digest(expected, _decode(signature)):
            raise ValueError("Invalid signature.")
        data = json.loads(_decode(encoded), object_pairs_hook=_unique_object)
        if not isinstance(data, dict) or type(data.get("v")) is not int:
            raise ValueError("Invalid proof version.")
        proof = WeatherProof.model_validate(data)
        now = int(utc_now().timestamp())
        if proof.iat < 0 or proof.exp != proof.iat + 1800 or proof.iat > now:
            raise ValueError("Invalid issuance.")
        if (
            proof.condition != condition_for(proof.weather_code)
            or proof.summary != forecast_summary(proof)
            or clean_text(proof.location_label) != proof.location_label
            or "\n" in proof.location_label
            or "\t" in proof.location_label
            or datetime.fromisoformat(proof.fetched_at).timestamp() > proof.iat + 1
        ):
            raise ValueError("Invalid snapshot.")
        if now >= proof.exp:
            reason = "expired"
            raise ValueError("Expired proof.")
        if proof.date != day.isoformat():
            reason = "date_mismatch"
            raise ValueError("Wrong date.")
        return proof
    except (ValueError, TypeError, KeyError, OverflowError, ValidationError) as exc:
        raise APIError(
            422,
            "weather_token_invalid",
            "Refresh the weather before attaching it to this date.",
            {"reason": reason},
        ) from exc


def public_snapshot(proof: WeatherProof) -> WeatherSnapshot:
    return WeatherSnapshot(
        **proof.model_dump(include=set(WeatherSnapshot.model_fields) - {"attribution"}),
        attribution=WEATHER_ATTRIBUTION,
    )
