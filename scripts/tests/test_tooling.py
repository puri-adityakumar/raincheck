"""The training entry point remains fail-closed, including with --execute."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest


def test_training_dry_run_never_requires_credentials(monkeypatch, capsys):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    trainer = importlib.import_module("train_lora")
    monkeypatch.setattr("sys.argv", ["train_lora.py"])
    assert trainer.main() == 0
    assert "DRY RUN" in capsys.readouterr().out


def test_paid_training_is_blocked_before_loading_credentials(monkeypatch, capsys):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    trainer = importlib.import_module("train_lora")
    config = importlib.import_module("tinker_config")
    monkeypatch.setenv("RAINCHECK_ALLOW_PAID_TRAINING", "0")
    monkeypatch.setattr(
        config, "load_config", lambda: (_ for _ in ()).throw(AssertionError("must not read keys"))
    )
    monkeypatch.setattr("sys.argv", ["train_lora.py", "--execute"])
    assert trainer.main() == 2
    assert "BLOCKED" in capsys.readouterr().err


@pytest.mark.parametrize("role", [[], {}])
def test_unhashable_dataset_roles_are_validation_errors(monkeypatch, role):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    validator = importlib.import_module("prepare_dataset")
    problems = validator.validate_row(
        {
            "messages": [
                {"role": role, "content": "Synthetic malformed input."},
                {"role": "assistant", "content": "A synthetic completion."},
            ]
        },
        1,
    )
    assert "line 1: messages[0].role is invalid" in problems
