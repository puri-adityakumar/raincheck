#!/usr/bin/env python3
"""Validate a provisional chat JSONL dataset without calling Tinker.

This is deliberately conservative scaffolding, not a claim that the file format
matches the current Tinker SDK. The AI worker must verify the real format from
public docs before training. No network, no writes unless --write is passed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ALLOWED_ROLES = {"system", "user", "assistant"}
MAX_CHARS = 6000


def validate_row(row: object, line_number: int) -> list[str]:
    problems: list[str] = []
    if not isinstance(row, dict):
        return [f"line {line_number}: expected a JSON object"]
    messages = row.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        return [f"line {line_number}: 'messages' must be a list with at least two turns"]
    roles: list[str] = []
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            problems.append(f"line {line_number}: messages[{index}] is not an object")
            continue
        role = message.get("role")
        content = message.get("content")
        if not isinstance(role, str) or role not in ALLOWED_ROLES:
            problems.append(f"line {line_number}: messages[{index}].role is invalid")
        if not isinstance(content, str) or not content.strip():
            problems.append(f"line {line_number}: messages[{index}].content is empty")
        elif len(content) > MAX_CHARS:
            problems.append(
                f"line {line_number}: messages[{index}].content is over {MAX_CHARS} chars"
            )
        roles.append(str(role))
    if roles and roles[-1] != "assistant":
        problems.append(f"line {line_number}: the final message must be from assistant")
    if "user" not in roles:
        problems.append(f"line {line_number}: at least one user message is required")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Source JSONL file")
    parser.add_argument("--output", type=Path, help="Normalized JSONL output (only with --write)")
    parser.add_argument("--write", action="store_true", help="Actually write --output")
    args = parser.parse_args()

    if not args.input.is_file():
        print(f"BLOCKED: dataset not found: {args.input}", file=sys.stderr)
        return 2
    if args.write and not args.output:
        print("BLOCKED: --write requires --output", file=sys.stderr)
        return 2

    rows: list[dict[str, object]] = []
    problems: list[str] = []
    with args.input.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                problems.append(f"line {line_number}: invalid JSON ({error.msg})")
                continue
            row_problems = validate_row(row, line_number)
            if row_problems:
                problems.extend(row_problems)
            elif isinstance(row, dict):
                rows.append(row)

    print(f"file: {args.input}")
    print(f"valid_rows: {len(rows)}")
    print(f"invalid_rows: {len({p.split(':')[0] for p in problems})}")
    if problems:
        for problem in problems[:20]:
            print(f"  - {problem}", file=sys.stderr)
        if len(problems) > 20:
            print(f"  - ... {len(problems) - 20} more", file=sys.stderr)
        print("BLOCKED: fix dataset problems before training.", file=sys.stderr)
        return 1

    if args.write and args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"wrote: {args.output}")

    print("dry run only: no Tinker call, no training.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
