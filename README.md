# Raincheck

A small, cozy desk for cancelling a plan kindly and offering one replacement date. Write and review an editable note, then make an unguessable, expiring share ticket with an optional `.ics` download. Nothing is sent automatically.

**Stage: local MVP implemented and independently reviewed.** All six review findings closed in one repair cycle; both independent repair rechecks returned no remaining findings. All 332 tests, typecheck, lint, production build and final private container smoke pass. The live browser flow and real Open-Meteo weather work. The optional Tinker adapter is checked offline only; paid inference, training, evaluation, and deployment have not run. This is a local handoff, not production-release approval.

Local agent coordination, review logs, screenshots, databases and datasets are excluded from the public repository.

## What is real right now

- Responsive landing, writing desk, editable preview, reviewed/consented sharing, and recipient ticket page, built with React 19, TypeScript, Vite and Tailwind 4.
- The user's original WebGL/Bayer-dither fishing diorama ported to React, with keyboard input, focus ring, pause, reduced-motion static mode, offscreen/hidden pause, DPR cap and WebGL fallback.
- All three Geist families bundled locally: Sans, Mono and Pixel.
- City search and authoritative Open-Meteo forecasts with attribution, deterministic summaries, expiring signed proofs, and stale-result invalidation.
- Current-content review and separate public-link consent. Editing clears both. Manual writing remains usable when AI is unavailable.
- Hashed 256-bit share tokens, thirty-day default expiry, private context excluded from tickets, atomic idempotent acceptance, and tentative Unicode-safe ICS without invitations or calendar writes.
- FastAPI typed errors, streamed body limits, request ids, privacy headers, SPA serving and health capabilities. SQLite is tested locally; Postgres support remains untested against a live server.
- Backend pytest suite, frontend Vitest + Testing Library suite, Docker multi-stage build and Render blueprint.
- Nothing contacts Tinker or any paid service. AI generation is honestly unavailable.

## Prerequisites

- Node 22 LTS (`.nvmrc`; Node 25 can run the tools but some test dependencies exclude it)
- [uv](https://docs.astral.sh/uv/) (Python 3.12 is pinned and installed by uv)
- Docker only if you want to build the container

## Setup

```bash
cd raincheck

# optional; all values in .env.example are blank
if [ ! -e .env ] && [ ! -L .env ]; then cp .env.example .env; fi

cd backend
uv sync --all-groups

cd ../frontend
npm ci
```

No key is needed for local manual writing or keyless Open-Meteo weather. AI drafting stays disabled unless separately authorized and configured.

**Older foundation databases:** startup detects the old relationship CHECK constraint, which lacks `group`, and stops without changing data. `create_all` is not a migration. Do not delete or reset existing data. A retaining upgrade needs a preserving migration; the verified smoke run used a fresh, separate database. For an isolated local run, explicitly select a new database path with `DATABASE_URL` before starting the backend.

## Run locally

```bash
# terminal 1 — API on :8000
cd backend
.venv/bin/uvicorn app.main:app --reload --port 8000 --no-access-log

# terminal 2 — UI on :5173, /api proxied to :8000
cd frontend
npm run dev
```

Open <http://localhost:5173>. API docs live at <http://localhost:8000/api/docs> in development.

To check the production-style same-origin serve:

```bash
cd frontend && npm run build
cd ../backend && .venv/bin/uvicorn app.main:app --port 8000 --no-access-log
# open http://localhost:8000
```

## Checks

```bash
./checks.sh
```

It does not install, use the network, call Tinker, touch Git, or mutate source. It runs:

- blank-value check on `.env.example`;
- `ruff check` + `ruff format --check` and `pytest` for the backend;
- offline SDK-double tests and explicit paid-execution guard checks;
- TypeScript check, Vitest and a production Vite build into a temp directory for the frontend.

Temporary test and build files stay in a fresh ignored `.checks.*` directory inside the project and are removed on exit.

Individual commands:

```bash
cd backend && .venv/bin/ruff check app tests && .venv/bin/ruff format --check app tests && .venv/bin/pytest -q
cd frontend && npm run check && npm test && npm run build
```

## Environment

Configuration is documented in `.env.example`, `frontend/.env.example`, and `backend/app/core/config.py`. Important defaults:

- `APP_ENV=development`
- `DATABASE_URL` defaults to a SQLite file under `backend/`; Render injects Postgres.
- `WEATHER_TOKEN_SECRET` is required in production (Render generates one).
- `TICKET_TTL_DAYS=30`.
- `AI_PROVIDER=none`, `TINKER_ALLOW_PAID_INFERENCE=false`, `RAINCHECK_ALLOW_PAID_TRAINING=0`.
- Frontend requests use same-origin `/api/*`; Vite proxies them to port 8000 in development.
- Optional `VITE_API_BASE_URL` selects an absolute HTTP(S) API address at frontend build/dev-server start, for example `http://127.0.0.1:8000`. Set it in the frontend build environment (not the backend-only `.env`). Requests and calendar downloads use that address; recipient share links stay on the frontend origin. An optional path prefix is supported; omit `/api` itself. Credentials, query strings, fragments and non-HTTP(S) schemes are rejected. Development CORS allows `FRONTEND_ORIGIN`; production intentionally stays same-origin and does not enable cross-origin access through that setting. Leave this variable unset for the integrated container.

Do not commit `.env`. Do not put secrets in `VITE_*`.

## Structure

```
frontend/   Landing, composer, recipient page, real diorama, typed API client
backend/    FastAPI locations/weather/generation/tickets/ICS, services, tests
scripts/    Offline adapter tests and guarded dataset/training/evaluation tools
public-docs/provenance and AI notes
Dockerfile  Node build stage + Python runtime serving SPA and API
render.yaml One Docker web service + Postgres, no embedded secrets
```

API request/response types are defined in `frontend/src/lib/api/types.ts` and `backend/app/schemas/`. Interactive API documentation is available in development.

## API status

Implemented: health, location search, grounded weather, generation boundary, ticket create/read/accept, and ICS. Health reports `weather: true`, `tickets: true`, `ai_generation: false` with the default configuration. `POST /api/generate` honestly returns `503 ai_unavailable` and a manual-writing fallback when AI is disabled.

The latest local suite passed 234 backend + 32 adapter/tooling + 66 frontend tests. Reproduce it with `./checks.sh`; local review records and smoke logs are not published.

## AI / Tinker status

**Live AI remains blocked; inference adapter implemented offline.** The public Tinker 0.34.0 sampling API is verified and pinned in optional `requirements-tinker.txt`. Inference requires a separate explicit `TINKER_ALLOW_PAID_INFERENCE=true` gate as well as provider, model, SDK, and credentials. All gates stay off for this run. No live generation or measured quality result is claimed.

Training tooling still refuses execution and defaults to dry runs. Paid training, a consented dataset, and a held-out evaluation require separate authorization and work. See `scripts/README.md` and `public-docs/tinker-notes.md`.

## Design notes

- Warm off-white paper, charcoal ink, muted teal, restrained rust.
- Geist Sans for UI, Geist Mono for weather/date/ticket metadata, Geist Pixel for the wordmark and short playful headings only.
- Airy editorial rules, real ticket perforation/stamp texture, no giant gradient hero, no admin dashboard.
- The diorama is the visual anchor. Its original shader palette is preserved inside the canvas.

Diorama provenance, the original attachment hash and font licenses are documented in `public-docs/provenance.md`. The original user-supplied attachment remains unchanged and local.

## Deployment

```bash
docker build -t raincheck .
WEATHER_TOKEN_SECRET="$(openssl rand -base64 32)" docker run --rm \
  -p 127.0.0.1:8000:8000 -e APP_ENV=production -e WEATHER_TOKEN_SECRET raincheck
```

The repaired image `raincheck:repair1-20261025-r1` builds and passes a private production smoke test: non-root uid 999, custom `PORT`, SPA/assets, full-bound Unicode group tickets, concurrent/repeated acceptance, and tentative ICS. Its configured healthcheck command passes; the scheduler still reported `starting` during this short run, so no final-image `healthy` status is claimed. Production refuses a blank `WEATHER_TOKEN_SECRET`. The test container had no network or published host ports and was stopped afterward. Access logs are disabled by the container command; redact bearer paths in platform/reverse-proxy logs too. Local smoke logs remain unpublished.

`render.yaml` defines a Docker web service and a Postgres database. `DATABASE_URL` is wired from the database; `WEATHER_TOKEN_SECRET` is generated by Render; no secret is in the repo. A live Render deploy has **not** been exercised, and Postgres was not run against a real server in this stage. Verify ticket creation, concurrent acceptance and ICS against live Postgres before a production release; add rate limits and platform-log token redaction.
