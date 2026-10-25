#!/usr/bin/env bash
# Non-mutating baseline checks: no installs, no network, no AI/Tinker calls,
# no Git operations, no writes outside temporary build/test directories.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PY="$ROOT/backend/.venv/bin/python"
RUFF="$ROOT/backend/.venv/bin/ruff"
PYTEST="$ROOT/backend/.venv/bin/pytest"

if [[ ! -x "$PY" ]]; then
  echo "FAIL: backend/.venv is missing. Run: (cd backend && uv sync --all-groups)" >&2
  exit 2
fi
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "FAIL: frontend/node_modules is missing. Run: (cd frontend && npm ci)" >&2
  exit 2
fi

# Every generated test/build file stays inside this project. mktemp creates a
# fresh ignored directory, so cleanup cannot discard existing user files.
CHECK_DIR="$(mktemp -d "$ROOT/.checks.XXXXXX")"
cleanup() { "$PY" -c 'import shutil, sys; shutil.rmtree(sys.argv[1])' "$CHECK_DIR"; }
trap cleanup EXIT
export TMPDIR="$CHECK_DIR"

echo "== environment example values are blank =="
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "$line" == \#* ]] && continue
  if [[ "$line" != *=* ]]; then
    echo "FAIL: .env.example contains a non-assignment line: $line" >&2
    exit 1
  fi
  value="${line#*=}"
  if [[ -n "${value//[[:space:]]/}" ]]; then
    echo "FAIL: .env.example has a non-blank value for ${line%%=*}" >&2
    exit 1
  fi
done < "$ROOT/.env.example"
echo "ok"

echo "== backend lint =="
(cd "$ROOT/backend" && "$RUFF" check app tests)
(cd "$ROOT/backend" && "$RUFF" format --check app tests)

echo "== backend tests =="
(cd "$ROOT/backend" && "$PYTEST" -q)

echo "== offline AI adapter tests =="
(cd "$ROOT/backend" && "$RUFF" check ../scripts/tests)
(cd "$ROOT/backend" && "$RUFF" format --check ../scripts/tests)
PYTHONPATH="$ROOT/backend" "$PYTEST" "$ROOT/scripts/tests" -q

echo "== frontend typecheck =="
(cd "$ROOT/frontend" && npm run check)

echo "== frontend tests =="
(cd "$ROOT/frontend" && npm test)

echo "== frontend production build =="
BUILD_DIR="$CHECK_DIR/frontend-build"
(cd "$ROOT/frontend" && npm run build -- --outDir "$BUILD_DIR" --emptyOutDir)
echo "ok (built to a temporary directory)"

echo
echo "All offline checks passed. Live AI, deployment, and real-device checks are separate."
