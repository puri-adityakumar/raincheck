import sys
from types import SimpleNamespace

import pytest

from app.core.errors import APIError


def install_generator(monkeypatch, function):
    monkeypatch.setitem(
        sys.modules,
        "app.services.generation.service",
        SimpleNamespace(generate_draft=function, generator_ready=lambda settings: True),
    )


def configured_test_settings(client):
    # These explicit fixtures never reach an SDK: every configured test installs a stub.
    settings = client.app.state.settings
    settings.ai_provider = "tinker"
    settings.tinker_allow_paid_inference = True
    settings.tinker_api_key = "test-only-key-never-used"
    settings.tinker_model = "fixture-only-model"


def test_default_generation_is_honestly_unavailable(client, ticket_payload):
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "ai_unavailable"
    assert error["details"] == {
        "provider": "none",
        "reason": "not_configured",
        "fallback": "manual",
    }
    assert "message" not in response.json()


def test_generation_validation_precedes_unavailable(client, ticket_payload):
    ticket_payload["proposed"]["start_time"] = "25:00"
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert client.post("/api/generate", json={"recipient": "bad"}).status_code == 422


def test_disabled_paid_gate_never_calls_adapter(client, ticket_payload, monkeypatch):
    async def forbidden(*args):
        raise AssertionError("The adapter must not be called.")

    configured_test_settings(client)
    client.app.state.settings.tinker_allow_paid_inference = False
    install_generator(monkeypatch, forbidden)
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_unavailable"
    assert client.get("/api/health").json()["capabilities"]["ai_generation"] is False


@pytest.mark.parametrize("field", ["tinker_api_key", "tinker_model"])
def test_missing_configuration_is_safe(client, ticket_payload, monkeypatch, field):
    configured_test_settings(client)
    setattr(client.app.state.settings, field, "")

    async def forbidden(*args):
        raise AssertionError("Missing config cannot call the adapter.")

    install_generator(monkeypatch, forbidden)
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 503
    assert response.json()["error"]["details"]["fallback"] == "manual"


def test_generation_serializes_validated_input_and_labels_real_boundary(
    client, ticket_payload, monkeypatch, upstream, weather_query
):
    calls = []
    configured_test_settings(client)

    async def fixture_generator(settings, payload, weather):
        calls.append((payload, weather))
        return "  Could we try another time?\x00\nNo pressure. "

    install_generator(monkeypatch, fixture_generator)
    ticket_payload.update(
        tone="theatrical",
        context="  I need to move our plan.  ",
        weather_token=client.get("/api/weather", params=weather_query).json()["weather_token"],
    )
    ticket_payload["proposed"]["location_label"] = "Caller invented label"
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["generation_id"].startswith("gen_") and len(body["generation_id"]) == 36
    assert body["message"] == "Could we try another time?\nNo pressure."
    assert body["labels"] == {
        "is_ai_generated": True,
        "is_sample": False,
        "theatrical": True,
        "availability_confirmed": False,
    }
    assert body["review_required"] is True
    assert body["max_length"] == 1200
    assert any("a joke" in disclosure for disclosure in body["disclosures"])
    payload, weather = calls[0]
    assert payload["context"] == "I need to move our plan."
    assert payload["proposed"]["date"] == "2026-10-30"
    assert payload["proposed"]["location_label"] == "New York, New York, United States"
    assert "weather_token" not in payload
    assert weather["source"] == "open-meteo"
    assert "latitude" not in weather
    from sqlalchemy import select

    from app.models.ticket import Ticket

    with client.app.state.session_factory() as session:
        assert session.scalar(select(Ticket)) is None


@pytest.mark.parametrize(
    "output",
    [
        "",
        "  ",
        "\x00",
        None,
        123,
        "x" * 701,
        "<script>alert(1)</script>",
        "**markdown**",
        "*markdown*",
        "_markdown_",
        "`code`",
        "# Heading",
        "[link](https://example.test)",
        "```code```",
    ],
)
def test_unusable_model_output_is_typed_failure(client, ticket_payload, monkeypatch, output):
    configured_test_settings(client)

    async def fixture_generator(*args):
        return output

    install_generator(monkeypatch, fixture_generator)
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "generation_failed"
    assert "test-only-key" not in response.text


def test_adapter_typed_failure_is_preserved(client, ticket_payload, monkeypatch):
    configured_test_settings(client)

    async def fixture_generator(*args):
        raise APIError(502, "generation_failed", "The model did not return a draft.")

    install_generator(monkeypatch, fixture_generator)
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "generation_failed"


def test_optional_weather_proof_is_validated_even_when_ai_disabled(client, ticket_payload):
    ticket_payload["weather_token"] = "wxs_bad.bad"
    response = client.post("/api/generate", json=ticket_payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "weather_token_invalid"


def test_health_checks_readiness_without_model_execution(client, ticket_payload, monkeypatch):
    configured_test_settings(client)

    async def forbidden(*args):
        raise AssertionError("Health cannot generate.")

    install_generator(monkeypatch, forbidden)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["capabilities"]["ai_generation"] is True
    assert "test-only-key" not in response.text
    assert "fixture-only-model" not in response.text
