"""Binance Executor operator API (docs/BINANCE_EXECUTOR.md).

Read status / trigger a cycle / kill switch. Gated by the scheduler token
(same auth as trading-watch). Order placement follows the service's
``BINANCE_EXECUTOR_DRY_RUN`` flag; the kill switch is checked by the
service's rails before ANY decision, and is honored even mid-loop.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.v1.cloud_dashboard import require_scheduler_token
from app.core.config import settings
from app.services import binance_executor as ex

router = APIRouter(prefix="/binance/executor",
                   tags=["binance-executor"],
                   dependencies=[Depends(require_scheduler_token)])


class RunBody(BaseModel):
    mode: str = "all"  # all|carry|momentum|sync|book


class StopBody(BaseModel):
    on: bool
    reason: str = ""


@router.get("/status")
async def status() -> dict:
    return await ex.status()


@router.post("/run")
async def run(body: RunBody | None = None) -> dict:
    mode = (body.mode if body else "all")
    if mode not in ("all", "carry", "momentum", "sync", "book"):
        raise HTTPException(400, "mode must be all|carry|momentum|sync|book")
    # still honors dry-run: a manual trigger can never trade against config
    return await ex.run_once(mode)


@router.post("/stop")
async def stop(body: StopBody) -> dict:
    st = await ex.load_state("carry", {"stop": False})
    st["stop"] = bool(body.on)
    await ex.save_state("carry", st)
    settings.BINANCE_EXECUTOR_STOP = bool(body.on)
    return {"stop": bool(body.on), "reason": body.reason}
