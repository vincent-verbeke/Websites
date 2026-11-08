import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.channel_adapters import router as channel_adapters_router
from app.api.v1.cloud_dashboard import router as cloud_dashboard_router
from app.api.v1.endpoints import router as api_v1_router
from app.api.v1.mail_agent import router as mail_agent_router
from app.api.v1.marketing_guard import router as marketing_guard_router
from app.api.v1.needle import router as needle_router
from app.api.v1.trading_watch import router as trading_watch_router
from app.api.whatsapp import router as whatsapp_router
from app.core.config import settings
from app.db.session import Base, engine
from app.services import mail_agent as mail_agent_service
from app.services import trading_watch as trading_watch_service

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
    # B2/B3 additive columns (docs §16/§17): create_all never ALTERs existing
    # tables and the repo has no alembic yet (prompt §8) -> idempotent adds.
    try:
        from sqlalchemy import text as _sql_text
        _contact_cols = [
            "utm_source varchar(64)", "utm_medium varchar(64)",
            "utm_campaign varchar(128)", "utm_content varchar(128)",
            "utm_term varchar(128)", "gclid varchar(256)",
            "referrer_url text", "first_touch_at timestamptz",
            "last_touch_at timestamptz",
            "consent_status varchar(32) DEFAULT 'unknown'",
            "consent_source varchar(64)", "consent_at timestamptz",
            "suppressed boolean DEFAULT false", "suppression_reason varchar(255)",
        ]
        async with engine.begin() as conn:
            for _col in _contact_cols:
                await conn.execute(_sql_text(
                    f"ALTER TABLE contacts ADD COLUMN IF NOT EXISTS {_col}"))
        logger.info("[DB] contact attribution/consent columns ensured (B2/B3).")
    except Exception as e:  # noqa: BLE001
        logger.warning("[DB] contact column migration skipped: %s", e)
    # Cloud trading watcher (Vincent-authorized 2026-11-01 — docs/TRADING_WATCH_CLOUD.md)
    wt = None
    if settings.TRADING_WATCH_ENABLED:
        wt = asyncio.create_task(trading_watch_service.watch_loop())
        logger.info("[trading-watch] background loop started (interval=%ss, sms=%s)",
                    settings.TRADING_WATCH_INTERVAL_S,
                    settings.TRADING_WATCH_SMS_ENABLED)
    # Kubot mail agent (docs/KUBOT_MAIL_AGENT_PLAN.md) — OFF by default (Phase 0
    # contract); Phase B deploy flips MAIL_AGENT_ENABLED=true (Liz-only test).
    ma = None
    if settings.MAIL_AGENT_ENABLED:
        ma = asyncio.create_task(mail_agent_service.watch_loop())
        logger.info("[mail-agent] background loop started (interval=%ss, mode=%s, upn=%s)",
                    settings.MAIL_AGENT_POLL_INTERVAL_S,
                    settings.MAIL_AGENT_MODE,
                    mail_agent_service.resolve_upn())
    yield
    if ma is not None:
        ma.cancel()
        with suppress(asyncio.CancelledError):
            await ma
    if wt is not None:
        wt.cancel()
        with suppress(asyncio.CancelledError):
            await wt
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
# trading watcher control/status (/api/v1/trading/watch/{test,status})
app.include_router(trading_watch_router, prefix=settings.API_V1_STR)
# spend caps + campaign metrics (B4/B5: /api/v1/spend/*, /api/v1/campaigns/*)
app.include_router(marketing_guard_router, prefix=settings.API_V1_STR)

# needle3 orchestrator intake (/api/v1/needle/inbox, /ack, /inject)
app.include_router(needle_router, prefix=f"{settings.API_V1_STR}/needle")

# Kubot mail agent admin (/api/v1/mail/status, /senders, /messages, /poll)
app.include_router(mail_agent_router, prefix=settings.API_V1_STR)

# WhatsApp Webhook Routers (Mounted both at root and /api/whatsapp for full backwards-compatibility)
app.include_router(whatsapp_router, prefix="/api/whatsapp")
app.include_router(whatsapp_router, prefix=f"{settings.API_V1_STR}/whatsapp")
