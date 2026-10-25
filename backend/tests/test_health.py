from fastapi.testclient import TestClient


def test_health_reports_honest_capabilities(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "raincheck-api"
    assert body["database"] == "ok"
    assert body["capabilities"] == {
        "weather": True,
        "tickets": True,
        "ai_generation": False,
        "ai_provider": "none",
        "paid_training_enabled": False,
    }
    assert response.headers["cache-control"] == "no-store"


def test_health_echoes_safe_request_id(client: TestClient) -> None:
    response = client.get("/api/health", headers={"X-Request-ID": "test-request-123"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "test-request-123"


def test_unknown_api_route_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["request_id"] == response.headers["x-request-id"]
    assert "detail" not in body


def test_method_not_allowed_uses_error_envelope(client: TestClient) -> None:
    response = client.post("/api/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_health_reports_typed_503_when_database_check_fails(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr("app.api.routes.health.database_ok", lambda _: False)

    response = client.get("/api/health")

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "service_unavailable"
    assert body["error"]["details"] == {"database": "unavailable"}


def test_large_body_is_rejected_with_typed_envelope(client: TestClient) -> None:
    response = client.post(
        "/api/health",
        content=b"x" * (33 * 1024),
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_non_json_post_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/health",
        content="hello",
        headers={"Content-Type": "text/plain"},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_media_type"


def test_root_is_honest_when_frontend_is_not_built(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    body = response.json()
    assert body["frontend"] == "not_built"
    assert body["api"] == "/api/health"
