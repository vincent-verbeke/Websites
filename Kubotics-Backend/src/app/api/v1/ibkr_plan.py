"""IBKR daily plan endpoints — Phase 2a state seeding + parity instrument.

docs/IBKR_MCP_BACKEND.md §10.7. Three admin routes on the /ibkr prefix:

  POST /api/v1/ibkr/plan/state/import   (admin) body = the FULL dev
      investments_state.json object (_meta + sleeve keys, stored EXACTLY as
      given — dev/cloud interop during the transition) -> upserts the
      device_snapshot_cache row dataset ``ibkr_plan_state``.
      NOT feed-gated: seeding must work while IBKR_MCP_ENABLED is still off.
  GET  /api/v1/ibkr/plan/state          (admin) verification read ->
      {found, state, updated_at, source} (fail-soft 200 when absent).
  POST /api/v1/ibkr/plan/dry-run        (admin, feed-gated 503) ALWAYS
      dry: run_daily_plan(dry_run=True, send_whatsapp=False) — never
      creates an instruction, never saves state, never sends WhatsApp.
      This is the parity instrument to diff against the dev-PC
      ``daily_invest --check`` table.

Admin = the shared _require_admin_token gate (Bearer / X-Needle-Token).
No secrets in responses; no network until the dry-run actually runs
(its MCP/Yahoo/WhatsApp seams are stubbed in tests).
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.ibkr_mcp import _require_admin_token, _require_feed
from app.db.session import get_db
from app.services import ibkr_mcp as ibkr_mcp_service
from app.services import ibkr_plan

router = APIRouter(prefix="/ibkr", tags=["ibkr-plan"])
logger = logging.getLogger(__name__)


@router.post("/plan/state/import", dependencies=[Depends(_require_admin_token)])
async def import_plan_state(
    payload: dict[str, Any],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Seed/replace the plan state row from the dev state JSON.

    Body = the raw ``investments_state.json`` document (NOT wrapped): a
    non-empty JSON object, else 422. Response reports the stored shape so
    the caller can verify interop (keys + sleeve count), never any secrets.
    """
    if not payload:
        raise HTTPException(
            status_code=422,
            detail="empty state — expected the full investments_state.json "
                   "object (_meta + sleeve keys)",
        )
    saved_at = await ibkr_plan.save_state(db, payload)
    keys = sorted(payload.keys())
    sleeves = [k for k in keys if k != "_meta"]
    logger.info("[ibkr-plan] state imported: %d sleeve(s), %d key(s)",
                len(sleeves), len(keys))
    return {
        "ok": True,
        "dataset": ibkr_plan.STATE_DATASET,
        "updated_at": saved_at.isoformat(),
        "keys": keys,
        "sleeve_count": len(sleeves),
    }


@router.get("/plan/state", dependencies=[Depends(_require_admin_token)])
async def get_plan_state(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Verification read of the plan state row (fail-soft 200, no 404)."""
    row = await ibkr_plan._load_row(db, ibkr_plan.STATE_DATASET)
    found = row is not None and isinstance(row.payload, dict) and bool(row.payload)
    return {
        "found": found,
        "state": row.payload if found else None,
        "updated_at": row.updated_at.isoformat() if row is not None else None,
        "source": row.source if row is not None else None,
    }


@router.post("/plan/dry-run", dependencies=[Depends(_require_admin_token)])
async def plan_dry_run() -> dict:
    """ALWAYS dry — the parameters are fixed here, not taken from input:
    dry_run=True (no create_order_instruction call, no state save) and
    send_whatsapp=False (nothing sent). Feed-gated 503 like every other
    MCP-backed route; 502-class failures surface inside ``notes`` (the
    runner is fail-soft by design)."""
    _require_feed()
    return await ibkr_plan.run_daily_plan(dry_run=True, send_whatsapp=False)


@router.get("/plan/status", dependencies=[Depends(_require_admin_token)])
async def plan_status(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Loop observability (admin, read-only, NO MCP, never 503): the pre-
    flight proof that the flag is live and the scheduler task actually
    registered in this process — otherwise a silent no-op at 09:05 would be
    invisible until Monday. Returns {plan: loop_status(), marker: last
    same-day-dedupe row or null, state_dataset, feed_enabled}."""
    marker = await ibkr_plan.load_marker(db)
    return {
        "plan": ibkr_plan.loop_status(),
        "marker": marker,
        "state_dataset": ibkr_plan.STATE_DATASET,
        "feed_enabled": ibkr_mcp_service.feed_enabled(),
    }
