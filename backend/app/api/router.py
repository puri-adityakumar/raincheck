"""API router. Feature routers are added here by the backend worker."""

from fastapi import APIRouter

from app.api.routes import generate, health, locations, tickets, weather

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(locations.router)
api_router.include_router(weather.router)
api_router.include_router(generate.router)
api_router.include_router(tickets.router)

__all__ = ["api_router"]
