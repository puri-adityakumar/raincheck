"""Tinker configuration shared by the AI tooling scripts.

No SDK is imported and no network call is made here. The foundation only
defines the gate; a human-authorized AI worker must verify the current SDK,
supported models, adapter format and pricing from public docs before using it.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


class BlockedError(RuntimeError):
    """Raised when a paid or credentialed action is not authorised."""


@dataclass(frozen=True)
class TinkerConfig:
    api_key: str = field(repr=False)
    model: str
    adapter_path: str | None = None

    def safe_summary(self) -> dict[str, str]:
        return {
            "api_key": "present" if self.api_key else "missing",
            "model": self.model or "missing",
            "adapter_path": self.adapter_path or "none",
        }


def load_config() -> TinkerConfig:
    return TinkerConfig(
        api_key=os.getenv("TINKER_API_KEY", "").strip(),
        model=os.getenv("TINKER_MODEL", "").strip(),
        adapter_path=os.getenv("TINKER_ADAPTER_PATH", "").strip() or None,
    )


def require_authorization(action: str = "Tinker work") -> TinkerConfig:
    """Return settings only when every explicit gate is open.

    This does not start any work by itself and does not prove the adapter is
    implemented. Callers must still fail closed until a real, tested adapter
    exists.
    """

    if os.getenv("RAINCHECK_ALLOW_PAID_TRAINING", "0").strip() != "1":
        raise BlockedError(
            "Paid/credentialed work is disabled. Set RAINCHECK_ALLOW_PAID_TRAINING=1 "
            "only after a human explicitly authorizes the run."
        )

    config = load_config()
    missing = []
    if not config.api_key:
        missing.append("TINKER_API_KEY")
    if not config.model:
        missing.append("TINKER_MODEL")
    if missing:
        raise BlockedError(f"{action} is missing required environment: {', '.join(missing)}.")

    return config
