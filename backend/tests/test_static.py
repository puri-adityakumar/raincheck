"""SPA/static serving: real built-frontend behaviour without touching the repo."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def built_client(tmp_path: Path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    index = "<!doctype html><title>Raincheck</title><div id=root></div>"
    (dist / "index.html").write_text(index, encoding="utf-8")
    (dist / "assets" / "app-abc123.js").write_text("console.log('raincheck');", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg></svg>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("do not serve", encoding="utf-8")

    settings = Settings(
        _env_file=None,
        app_env="test",
        database_url=f"sqlite:///{(tmp_path / 'static.db').as_posix()}",
        weather_token_secret="test-only-weather-secret",
        frontend_dist=str(dist),
    )
    with TestClient(create_app(settings)) as client:
        yield client


def test_root_serves_index_without_caching(built_client: TestClient) -> None:
    response = built_client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-store"
    assert "Raincheck" in response.text


def test_hashed_assets_are_immutable(built_client: TestClient) -> None:
    response = built_client.get("/assets/app-abc123.js")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert "raincheck" in response.text


def test_unknown_non_api_path_serves_the_spa(built_client: TestClient) -> None:
    response = built_client.get("/t/some-share-token")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["referrer-policy"] == "no-referrer"


def test_unknown_api_path_stays_a_json_404(built_client: TestClient) -> None:
    response = built_client.get("/api/nope")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_path_traversal_does_not_escape_dist(built_client: TestClient) -> None:
    for attempt in ("../secret.txt", "..%2Fsecret.txt", "assets/../../secret.txt"):
        response = built_client.get(f"/{attempt}")
        assert "do not serve" not in response.text
        assert response.status_code in {200, 404}


def test_spa_security_headers(built_client: TestClient) -> None:
    response = built_client.get("/")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
