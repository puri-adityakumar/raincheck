import asyncio
import json

import pytest


def raw_request(app, chunks, *, length=None, content_type="application/json", path="/api/generate"):
    """Feed distinct ASGI frames, without TestClient coalescing a chunked body."""
    headers = [(b"x-request-id", b"stream-test")]
    if content_type is not None:
        headers.append((b"content-type", content_type.encode()))
    if length is not None:
        headers.append((b"content-length", str(length).encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "scheme": "http",
        "method": "POST",
        "root_path": "",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers,
        "client": ("testclient", 1234),
        "server": ("testserver", 80),
    }
    messages = []
    frames = [
        {"type": "http.request", "body": body, "more_body": index < len(chunks) - 1}
        for index, body in enumerate(chunks)
    ]

    async def receive():
        return frames.pop(0) if frames else {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    asyncio.run(app(scope, receive, send))
    start = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"") for message in messages if message["type"] == "http.response.body"
    )
    return start["status"], dict(start["headers"]), json.loads(body)


@pytest.mark.parametrize("length", [None, 0, 1, 32768])
def test_actual_chunked_bytes_enforce_limit_even_with_false_length(client, length):
    status, headers, body = raw_request(
        client.app, [b"x" * 16384, b"x" * 16384, b"x"], length=length
    )
    assert status == 413
    assert body["error"]["code"] == "payload_too_large"
    assert body["error"]["request_id"] == "stream-test"
    assert headers[b"x-request-id"] == b"stream-test"
    assert headers[b"x-content-type-options"] == b"nosniff"
    assert headers[b"cache-control"] == b"no-store"
    assert headers[b"referrer-policy"] == b"no-referrer"


def test_exact_body_limit_is_not_rejected_as_large(client):
    payload = b'{"unknown":"' + b"x" * (32768 - len(b'{"unknown":""}')) + b'"}'
    assert len(payload) == 32768
    status, _, body = raw_request(client.app, [payload[:10000], payload[10000:]])
    assert status == 422
    assert body["error"]["code"] == "validation_error"


def test_chunked_non_json_is_rejected(client):
    status, _, body = raw_request(client.app, [b"some", b" body"], content_type=None)
    assert status == 415
    assert body["error"]["code"] == "unsupported_media_type"


@pytest.mark.parametrize("length", [-1, "bad"])
def test_invalid_content_length_is_safe(client, length):
    status, _, body = raw_request(client.app, [b"{}"], length=length)
    assert status == 400
    assert body["error"]["code"] == "bad_request"


def test_json_replay_retains_chunks_for_valid_request(client, ticket_payload):
    data = json.dumps(ticket_payload).encode()
    status, headers, body = raw_request(
        client.app, [data[:10], data[10:100], data[100:]], path="/api/tickets"
    )
    assert status == 201
    assert body["status"] == "open"
    assert headers[b"x-robots-tag"] == b"noindex, nofollow"


def test_unexpected_error_has_envelope_and_no_sensitive_exception(client, caplog):
    @client.app.get("/api/test-unexpected")
    def fail():
        raise RuntimeError("sensitive-token-and-context")

    response = client.get("/api/test-unexpected")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sensitive-token-and-context" not in response.text
    assert "sensitive-token-and-context" not in caplog.text


@pytest.mark.parametrize("request_id", ["x" * 65, "\tbad", ""])
def test_invalid_request_id_is_replaced(client, request_id):
    response = client.get("/api/does-not-exist", headers={"x-request-id": request_id})
    assert response.status_code == 404
    assert response.headers["x-request-id"] != request_id
    assert response.json()["error"]["request_id"] == response.headers["x-request-id"]


def test_malformed_json_never_echoes_body(client):
    response = client.post(
        "/api/tickets", content=b'{"secret-context":', headers={"content-type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "secret-context" not in response.text


def test_openapi_exposes_all_routes_and_required_grounding(client):
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    assert {
        "/api/health",
        "/api/locations/search",
        "/api/weather",
        "/api/generate",
        "/api/tickets",
        "/api/tickets/{token}",
        "/api/tickets/{token}/accept",
        "/api/tickets/{token}/raincheck.ics",
    } <= paths.keys()
    parameter = next(
        item for item in paths["/api/weather"]["get"]["parameters"] if item["name"] == "location_id"
    )
    assert parameter["required"] is True
    response = client.get("/api/weather")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "location_required"


def test_disallowed_cors_preflight_uses_error_envelope(client):
    response = client.options(
        "/api/tickets",
        headers={
            "origin": "https://untrusted.example",
            "access-control-request-method": "POST",
            "x-request-id": "cors-test",
        },
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"
    assert response.json()["error"]["request_id"] == "cors-test"
    assert response.headers["cache-control"] == "no-store"
    assert "access-control-allow-origin" not in response.headers


def test_allowed_local_cors_still_works(client):
    response = client.options(
        "/api/tickets",
        headers={
            "origin": "http://localhost:5173",
            "access-control-request-method": "POST",
            "access-control-request-headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-credentials" not in response.headers


def test_unknown_trailing_slash_never_redirects_a_bearer_path(client):
    response = client.get("/api/tickets/unknown/", follow_redirects=False)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert "location" not in response.headers
