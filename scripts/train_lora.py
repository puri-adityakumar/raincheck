#!/usr/bin/env python3
"""Guarded Tinker training entry point. Refuses to run in the foundation.

There is no import of the Tinker SDK and no network path in this file yet. The
AI worker must verify the current public SDK and model support, implement a
reviewed adapter, and get explicit spend authorization before removing the
final refusal.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tinker_config import BlockedError, require_authorization


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, help="JSONL dataset prepared for the run")
    parser.add_argument("--run-name", default="raincheck-draft-v1")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Attempt the real paid run. Requires env gates and an implemented adapter.",
    )
    args = parser.parse_args()

    if args.dataset and not args.dataset.is_file():
        print(f"BLOCKED: dataset not found: {args.dataset}", file=sys.stderr)
        return 2

    if not args.execute:
        print(f"run_name: {args.run_name}")
        print(f"dataset: {args.dataset or 'not supplied'}")
        print("DRY RUN: no Tinker import, call, training or spend. Pass --execute only when authorized.")
        return 0

    try:
        config = require_authorization("Tinker training")
    except BlockedError as error:
        print(f"BLOCKED: {error}", file=sys.stderr)
        return 2

    print(f"config: {config.safe_summary()}")
    print(
        "BLOCKED: the Tinker training adapter is not implemented in this foundation. "
        "Verify the SDK/model docs, implement and test the adapter, and obtain explicit "
        "authorization before running. No network call was made.",
        file=sys.stderr,
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
