"""Validate a draft request, then cross only the parent-owned adapter boundary."""

import re
import uuid

from fastapi import APIRouter, Request

from app.core.errors import APIError
from app.core.time import timestamp, utc_now, validate_proposed
from app.schemas.common import clean_text
from app.schemas.generate import GenerateRequest, GenerateResponse, GenerationLabels
from app.services.weather_tokens import public_snapshot, verify_weather_token

router = APIRouter(tags=["generation"])


def _unavailable(provider: str, reason: str) -> APIError:
    return APIError(
        503,
        "ai_unavailable",
        "Drafting isn’t configured on this Raincheck server. You can still write your own note.",
        {"provider": provider, "reason": reason, "fallback": "manual"},
    )


@router.post("/generate", response_model=GenerateResponse)
async def generate(payload: GenerateRequest, request: Request) -> GenerateResponse:
    settings = request.app.state.settings
    proposed = payload.proposed
    validate_proposed(proposed.date, proposed.start_time, proposed.end_time, proposed.timezone)
    weather = None
    if payload.weather_token is not None:
        proof = verify_weather_token(settings, payload.weather_token, proposed.date)
        weather = public_snapshot(proof).model_dump(mode="json")
        proposed.location_label = proof.location_label
    if settings.ai_provider != "tinker" or not settings.tinker_allow_paid_inference:
        raise _unavailable(settings.ai_provider, "not_configured")
    if not settings.tinker_api_key:
        raise _unavailable(settings.ai_provider, "credentials_missing")
    if not (settings.tinker_model or settings.tinker_adapter_path):
        raise _unavailable(settings.ai_provider, "adapter_not_ready")
    try:
        from app.services.generation.service import generate_draft
    except ImportError as exc:
        raise _unavailable(settings.ai_provider, "adapter_not_ready") from exc
    raw = await generate_draft(
        settings, payload.model_dump(mode="json", exclude={"weather_token"}), weather
    )
    message = clean_text(raw)
    if (
        not isinstance(message, str)
        or not 1 <= len(message) <= 700
        or re.search(r"</?[a-zA-Z][^>]*>|```|!\[|\[[^\]]+\]\([^)]+\)", message)
        or re.search(r"(?m)^\s{0,3}(?:#{1,6}\s|[-*]\s|\d+\.\s)|\*\*|__", message)
        or re.search(r"(?<!\w)(?:\*[^*\n]+\*|_[^_\n]+_)(?!\w)|`", message)
    ):
        raise APIError(
            502, "generation_failed", "The draft was unusable. Write a note or try again."
        )
    theatrical = payload.tone == "theatrical"
    disclosures = [
        "AI-drafted. Read and edit before sharing.",
        "The suggested time is not confirmed by the recipient.",
    ]
    if theatrical:
        disclosures.append("Clearly theatrical — a joke, not a real excuse.")
    return GenerateResponse(
        generation_id=f"gen_{uuid.uuid4().hex}",
        message=message,
        tone=payload.tone,
        labels=GenerationLabels(theatrical=theatrical),
        disclosures=disclosures,
        created_at=timestamp(utc_now()),
    )
