"""FastAPI application factory and SPA host."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

from app.api.router import api_router
from app.core.config import Settings, get_settings
from app.core.errors import APIError, register_error_handlers
from app.core.middleware import APICORSMiddleware, RequestSafetyMiddleware
from app.db import init_db, make_engine, make_session_factory
from app.services.open_meteo import OpenMeteo


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    dist = settings.frontend_dist_path
    index = dist / "index.html"

    if not index.is_file():

        @app.get("/", include_in_schema=False)
        def frontend_not_built() -> JSONResponse:
            return JSONResponse(
                {
                    "service": "raincheck-api",
                    "frontend": "not_built",
                    "message": "Run `npm run dev` in frontend/ or build it for production.",
                    "api": "/api/health",
                },
                headers={"Cache-Control": "no-store"},
            )

        return

    # Hashed assets are served by the catch-all below so that they get the
    # immutable cache headers; StaticFiles would drop them.
    resolved_dist = dist.resolve()
    immutable_headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    file_headers = {"Cache-Control": "public, max-age=3600"}
    html_headers = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise APIError(404, "not_found", "The requested resource was not found.")
        if full_path:
            candidate = (dist / full_path).resolve()
            if candidate.is_relative_to(resolved_dist) and candidate.is_file():
                headers = immutable_headers if full_path.startswith("assets/") else file_headers
                return FileResponse(candidate, headers=headers)
        headers = dict(html_headers)
        if full_path.startswith("t/"):
            headers["Referrer-Policy"] = "no-referrer"
        return FileResponse(index, media_type="text/html", headers=headers)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        init_db(engine)
        try:
            async with httpx.AsyncClient(
                timeout=5.0, follow_redirects=False, trust_env=False
            ) as client:
                application.state.open_meteo = OpenMeteo(client)
                yield
        finally:
            engine.dispose()

    docs_url = "/api/docs" if settings.enable_api_docs else None
    openapi_url = "/api/openapi.json" if settings.enable_api_docs else None

    app = FastAPI(
        title="Raincheck API",
        version=settings.version,
        description="Kind cancellations and tentative rainchecks. No automatic messages.",
        docs_url=docs_url,
        redoc_url=None,
        openapi_url=openapi_url,
        redirect_slashes=False,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.engine = engine

    app.add_middleware(
        APICORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    app.add_middleware(RequestSafetyMiddleware)

    register_error_handlers(app)
    app.include_router(api_router)
    _mount_frontend(app, settings)
    return app


app = create_app()
