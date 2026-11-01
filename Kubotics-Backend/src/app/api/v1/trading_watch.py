"""Trading watch control/status endpoints (needle-token gated).

POST /trading/watch/test — force one full check cycle INCLUDING the alert
fan-out (events row + WhatsApp + optional SMS) with `test: true` — the
documented channel-verification path (docs/TRADING_WATCH_CLOUD.md §Testing).
GET  /trading/watch/status — enable flags + most recent alert (if any).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.v1.cloud_dashboard import require_scheduler_token
from app.core.config import settings
from app.db.session import AsyncSessionLocal
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
    """Full watcher status: flags + last_check heartbeat + recent alerts
    (same shape as the `trading_watch` block embedded in /investments)."""
    async with AsyncSessionLocal() as db:
        block = await trading_watch.dashboard_block(db)
    alerts = block.get("recent_alerts") or []
    return {
        **block,
        "cooldown_s": settings.TRADING_WATCH_ALERT_COOLDOWN_S,
        "expected_perp": settings.TRADING_WATCH_EXPECTED_PERP.split(","),
        "last_alert": alerts[0] if alerts else None,
    }
