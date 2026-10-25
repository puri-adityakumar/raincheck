"""Typed errors and the single API error envelope."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("raincheck.api")


class APIError(Exception):
    """Raise for expected, safe API failures."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers or {}


def request_id_for(request: Request) -> str:
    return getattr(request.state, "request_id", "")


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": request_id_for(request),
        }
    }
    merged_headers = {"Cache-Control": "no-store", "X-Request-ID": request_id_for(request)}
    if headers:
        merged_headers.update(headers)
    return JSONResponse(status_code=status_code, content=body, headers=merged_headers)


_HTTP_CODES: dict[int, tuple[str, str]] = {
    400: ("bad_request", "The request could not be understood."),
    404: ("not_found", "The requested resource was not found."),
    405: ("method_not_allowed", "That method is not allowed for this resource."),
    413: ("payload_too_large", "The request body is too large."),
    415: ("unsupported_media_type", "Send JSON with a Content-Type of application/json."),
}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def handle_api_error(request: Request, exc: APIError) -> JSONResponse:
        return error_response(
            request,
            exc.status_code,
            exc.code,
            exc.message,
            exc.details,
            exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        if request.url.path == "/api/weather" and any(
            error.get("type") == "missing" and error.get("loc") == ("query", "location_id")
            for error in exc.errors()
        ):
            return error_response(
                request, 422, "location_required", "Choose a city from location search."
            )
        fields: list[dict[str, str]] = []
        for error in exc.errors():
            location = [
                str(part)
                for part in error.get("loc", ())
                if part not in {"body", "query", "path", "header"}
            ]
            fields.append(
                {
                    "path": ".".join(location) or "body",
                    "message": str(error.get("msg", "Invalid value.")),
                }
            )
        return error_response(
            request,
            422,
            "validation_error",
            "Some fields need attention.",
            {"fields": fields},
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _HTTP_CODES.get(
            exc.status_code, ("http_error", "The request could not be completed.")
        )
        headers = dict(exc.headers or {})
        return error_response(request, exc.status_code, code, message, None, headers)

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Tracebacks, paths and exception strings may contain bearer tokens or
        # SQL parameters. Keep only the safe correlation ID.
        logger.error(
            "Unhandled API error request_id=%s",
            request_id_for(request),
        )
        return error_response(
            request,
            500,
            "internal_error",
            "Something went wrong on our side. Please try again.",
        )
