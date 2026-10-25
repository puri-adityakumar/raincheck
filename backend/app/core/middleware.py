"""Bound actual streamed bytes before routing and apply privacy headers on every path."""

import uuid

from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import APIError, error_response

MAX_BODY_BYTES = 32 * 1024


class APICORSMiddleware(CORSMiddleware):
    """Keep rejected CORS preflights inside the API's safe error envelope."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] == "OPTIONS":
            request = Request(scope)
            if "origin" in request.headers and "access-control-request-method" in request.headers:
                response = self.preflight_response(request.headers)
                if response.status_code >= 400:
                    cors_headers = {
                        key: value
                        for key, value in response.headers.items()
                        if key not in {"content-length", "content-type"}
                    }
                    response = error_response(
                        request,
                        400,
                        "bad_request",
                        "That cross-origin request is not allowed.",
                        headers=cors_headers,
                    )
                await response(scope, receive, send)
                return
        await super().__call__(scope, receive, send)


class RequestSafetyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        supplied = request.headers.get("x-request-id", "")
        request_id = (
            supplied
            if 1 <= len(supplied) <= 64 and all(32 <= ord(char) <= 126 for char in supplied)
            else str(uuid.uuid4())
        )
        scope.setdefault("state", {})["request_id"] = request_id

        started = False

        async def safe_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = list(message.get("headers", []))
                defaults = {
                    b"x-request-id": request_id.encode("ascii"),
                    b"x-content-type-options": b"nosniff",
                    b"referrer-policy": b"no-referrer",
                }
                path = scope.get("path", "")
                if path == "/api" or path.startswith("/api/"):
                    defaults[b"cache-control"] = b"no-store"
                if path.startswith(("/api/tickets", "/t/")):
                    defaults[b"x-robots-tag"] = b"noindex, nofollow"
                    defaults[b"cache-control"] = b"no-store"
                existing = {key.lower() for key, _ in headers}
                headers.extend(
                    (key, value) for key, value in defaults.items() if key not in existing
                )
                message = {**message, "headers": headers}
            await send(message)

        try:
            raw_length = request.headers.get("content-length")
            if raw_length is not None:
                try:
                    length = int(raw_length)
                    if length < 0:
                        raise ValueError("Negative length.")
                except ValueError as exc:
                    raise APIError(
                        400, "bad_request", "The request could not be understood."
                    ) from exc
                if length > MAX_BODY_BYTES:
                    raise APIError(413, "payload_too_large", "The request body is too large.")
            chunks: list[bytes] = []
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body = message.get("body", b"")
                size += len(body)
                if size > MAX_BODY_BYTES:
                    raise APIError(413, "payload_too_large", "The request body is too large.")
                if body:
                    chunks.append(body)
                if not message.get("more_body", False):
                    break
            if size and scope["method"] in {"POST", "PUT", "PATCH"}:
                media_type = (
                    request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                )
                if media_type != "application/json":
                    raise APIError(
                        415,
                        "unsupported_media_type",
                        "Send JSON with a Content-Type of application/json.",
                    )
            buffered = b"".join(chunks)
            delivered = False

            async def replay() -> Message:
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": buffered, "more_body": False}
                return await receive()

            await self.app(scope, replay, safe_send)
        except APIError as exc:
            if started:
                raise
            response = error_response(
                request, exc.status_code, exc.code, exc.message, exc.details, exc.headers
            )
            await response(scope, receive, safe_send)
        except Exception:
            if started:
                raise
            # No exception text, request path, body, or traceback: those can contain secrets.
            response = error_response(
                request,
                500,
                "internal_error",
                "Something went wrong on our side. Please try again.",
            )
            await response(scope, receive, safe_send)
