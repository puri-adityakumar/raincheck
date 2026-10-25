"""Validated city search."""

import unicodedata

from fastapi import APIRouter, Query, Request

from app.core.errors import APIError
from app.schemas.weather import LocationsResponse
from app.services.open_meteo import LOCATION_ATTRIBUTION

router = APIRouter(tags=["locations"])


@router.get("/locations/search", response_model=LocationsResponse)
async def search_locations(
    request: Request, q: str = Query(..., max_length=256), limit: int = Query(5, ge=1, le=8)
) -> LocationsResponse:
    query = unicodedata.normalize("NFC", q.strip())
    if not 2 <= len(query) <= 80 or any(
        not (unicodedata.category(char).startswith("L") or char in " ,-.'’") for char in query
    ):
        raise APIError(
            422,
            "validation_error",
            "Some fields need attention.",
            {
                "fields": [
                    {"path": "q", "message": "Enter a city name between 2 and 80 characters."}
                ]
            },
        )
    query = " ".join(part for part in query.split(" ") if part)
    results = await request.app.state.open_meteo.search(query, limit)
    return LocationsResponse(query=query, results=results, attribution=LOCATION_ATTRIBUTION)
