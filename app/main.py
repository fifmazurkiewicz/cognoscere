from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.application.bootstrap import ensure_bootstrap_admin_user
from app.infrastructure.config import settings
from app.infrastructure.database import AsyncSessionLocal
from app.presentation.api.routers import admin as admin_router
from app.presentation.api.routers import auth as auth_router
from app.presentation.api.routers import daily_checkin as daily_checkin_router
from app.presentation.api.routers import protocols as protocols_router
from app.presentation.api.routers import sessions as sessions_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    async with AsyncSessionLocal() as db:
        await ensure_bootstrap_admin_user(db)
    yield


app = FastAPI(
    title="Cognoscere API",
    version="0.1.0",
    description="API dla aplikacji Cognoscere wspierającej psychoterapię",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
app.include_router(protocols_router.router, prefix="/api", tags=["protocols"])
app.include_router(daily_checkin_router.router, prefix="/api", tags=["daily-checkin"])
app.include_router(sessions_router.router, prefix="/api", tags=["sessions"])
app.include_router(admin_router.router, prefix="/api/admin", tags=["admin"])


@app.get("/api/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name}
