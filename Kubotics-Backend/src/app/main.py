import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.channel_adapters import router as channel_adapters_router
from app.api.v1.endpoints import router as api_v1_router
from app.api.v1.needle import router as needle_router
from app.api.v1.cloud_dashboard import router as cloud_dashboard_router
from app.api.whatsapp import router as whatsapp_router
from app.core.config import settings
from app.db.session import Base, engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Kubotics Autonomous Platform API...")
    # Create missing tables idempotently in EVERY environment: prod runs
    # DEBUG=false and the repo ships no alembic migrations, so new models
    # (ScheduledTask/InboundEvent/DeviceSnapshotCache/AgentOutput) would never
    # exist in the RDS schema (500s on first use). create_all only creates
    # absent tables — it never alters or drops existing ones. Failures are
    # logged, not fatal (preserves the old DEBUG-gated resilience: the app
    # still boots and /health answers if the DB is briefly unreachable).
    # (Jcode hotfix 2026-11-01, prompt §8 — replace with alembic migrations.)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("[DB] Ensured PostgreSQL tables (create_all, all envs).")
    except Exception as e:  # noqa: BLE001
        logger.warning("[DB] create_all skipped: %s", e)
    yield
    logger.info("Shutting down Kubotics API...")
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan,
)

# CORS setup for frontend (kubotics.ch and local testing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check route for AWS Application Load Balancer (ALB)
@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "service": "kubotics-backend",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }


# Include API V1 Router
app.include_router(api_v1_router, prefix=settings.API_V1_STR)
app.include_router(channel_adapters_router, prefix=settings.API_V1_STR)
app.include_router(cloud_dashboard_router, prefix=settings.API_V1_STR)

# needle3 orchestrator intake (/api/v1/needle/inbox, /ack, /inject)
app.include_router(needle_router, prefix=f"{settings.API_V1_STR}/needle")

# WhatsApp Webhook Routers (Mounted both at root and /api/whatsapp for full backwards-compatibility)
app.include_router(whatsapp_router, prefix="/api/whatsapp")
app.include_router(whatsapp_router, prefix=f"{settings.API_V1_STR}/whatsapp")
