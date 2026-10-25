# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST=/app/frontend/dist \
    DATABASE_URL=sqlite:////app/data/raincheck.db \
    PATH="/app/.venv/bin:$PATH"

RUN pip install --no-cache-dir uv==0.11.21 \
    && groupadd --system raincheck \
    && useradd --system --gid raincheck --home-dir /app raincheck

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project \
    && mkdir -p /app/data /app/frontend \
    && chown -R raincheck:raincheck /app

COPY --chown=raincheck:raincheck backend/app ./app
COPY --from=frontend-build --chown=raincheck:raincheck /app/frontend/dist ./frontend/dist

USER raincheck
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import os, urllib.request; port=int(os.getenv('PORT', '8000')); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=4)"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log"]
