"""Trading watch control/status endpoints (needle-token gated).

POST /trading/watch/test — force one full check cycle INCLUDING the alert
fan-out (events row + WhatsApp + optional SMS) with `test: true` — the
documented channel-verification path (docs/TRADING_WATCH_CLOUD.md §Testing).
GET  /trading/watch/status — enable flags + most recent alert (if any).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select

from app.api.v1.cloud_dashboard import require_scheduler_token
from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.tasks import InboundEvent
from app.services import trading_watch

router = APIRouter(prefix="/trading", tags=["trading-watch"])


@router.post("/watch/test", dependencies=[Depends(require_scheduler_token)])
async def trading_watch_test() -> dict:
    """Run one check cycle with forced alerting — proves events + WhatsApp
    (+ SMS when enabled) end-to-end. Does NOT depend on Binance being
    reachable: a feed problem is included in the test payload instead."""
    return await trading_watch.run_once(test=True)


@router.get("/watch/status", dependencies=[Depends(require_scheduler_token)])
async def trading_watch_status() -> dict:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(InboundEvent)
            .where(InboundEvent.channel == trading_watch.CHANNEL)
            .order_by(desc(InboundEvent.created_at))
            .limit(1))).scalars().first()
    return {
        "enabled": settings.TRADING_WATCH_ENABLED,
        "interval_s": settings.TRADING_WATCH_INTERVAL_S,
        "cooldown_s": settings.TRADING_WATCH_ALERT_COOLDOWN_S,
        "sms_enabled": settings.TRADING_WATCH_SMS_ENABLED,
        "binance_keys_configured": bool(settings.BINANCE_API_KEY
                                        and settings.BINANCE_API_SECRET),
        "expected_perp": settings.TRADING_WATCH_EXPECTED_PERP.split(","),
        "last_alert": None if row is None else {
            "event_id": row.event_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "payload": row.payload,
        },
    }
