"""Generation request and explicit disclosure schemas."""

from typing import Literal

from pydantic import BaseModel

from app.models.enums import Tone
from app.schemas.common import Details, DraftFields, TicketLabels


class GenerateRequest(DraftFields):
    context: Details | None = None


class GenerationLabels(TicketLabels):
    is_ai_generated: Literal[True] = True
    is_sample: Literal[False] = False


class GenerateResponse(BaseModel):
    generation_id: str
    message: str
    tone: Tone
    labels: GenerationLabels
    review_required: Literal[True] = True
    max_length: Literal[1200] = 1200
    disclosures: list[str]
    created_at: str
