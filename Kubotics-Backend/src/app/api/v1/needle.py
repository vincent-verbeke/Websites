"""needle3 orchestrator intake API (mounted at {API_V1_STR}/needle).

Endpoints (every endpoint requires header X-Needle-Token == settings.NEEDLE_TOKEN
whenever NEEDLE_TOKEN is non-empty; empty token allows everything for local dev):
- GET  /inbox  ?after_id=0 -> {"messages": [...], "latest_id": int}
- POST /ack     {"id", "status", "session"?, "reply"?} -> {"ok": true, "row": {...}}
- POST /inject  {"text", "sender"?} -> row dict (test entry point)
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.needle import NeedleInbox

MAX_PAGE = 200


def require_needle_token(
    x_needle_token: str | None = Header(None, alias="X-Needle-Token"),
) -> None:
    """Enforce the shared needle3 token; allow everything when it is unset (local dev)."""
    if settings.NEEDLE_TOKEN and x_needle_token != settings.NEEDLE_TOKEN:
        raise HTTPException(status_code=401, detail="needle token required")


router = APIRouter(tags=["Needle3"], dependencies=[Depends(require_needle_token)])


class AckPayload(BaseModel):
    id: int
    status: Literal["new", "dispatched", "done", "failed"]
    session: str | None = None
    reply: str | None = None


class InjectPayload(BaseModel):
    text: str = Field(min_length=1)
    sender: str = "+41797481975"


def row_dict(row: NeedleInbox) -> dict:
    """Canonical row representation shared by /inbox, /ack and /inject."""
    return {
        "id": row.id,
        "ts": row.ts.isoformat() if row.ts else None,
        "sender": row.sender,
        "wamid": row.wamid,
        "text": row.text,
        "kind": row.kind,
        "status": row.status,
        "session": row.session,
        "reply": row.reply,
        "reply_ts": row.reply_ts.isoformat() if row.reply_ts else None,
        "meta": row.meta,
    }


@router.get("/inbox")
async def list_inbox(
    db: Annotated[AsyncSession, Depends(get_db)],
    after_id: int = 0,
):
    """All rows with id > after_id (ascending, max 200) plus the table's latest id."""
    result = await db.execute(
        select(NeedleInbox)
        .where(NeedleInbox.id > after_id)
        .order_by(NeedleInbox.id.asc())
        .limit(MAX_PAGE)
    )
    rows = list(result.scalars().all())

    latest_result = await db.execute(
        select(NeedleInbox).order_by(NeedleInbox.id.desc()).limit(1)
    )
    latest_row = latest_result.scalars().first()

    return {
        "messages": [row_dict(row) for row in rows],
        "latest_id": latest_row.id if latest_row is not None else 0,
    }


@router.post("/ack")
async def ack_inbox_row(
    payload: AckPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update status/session/reply on one row; a non-null reply also stamps reply_ts."""
    row = await db.get(NeedleInbox, payload.id)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown inbox id")

    row.status = payload.status
    if payload.session is not None:
        row.session = payload.session
    if payload.reply is not None:
        row.reply = payload.reply
        row.reply_ts = datetime.now(UTC)
    await db.commit()
    return {"ok": True, "row": row_dict(row)}


@router.post("/inject")
async def inject_message(
    payload: InjectPayload,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Test entry point: queue a synthetic operator message for needle3."""
    row = NeedleInbox(
        sender=payload.sender,
        text=payload.text,
        wamid=None,
        kind="in",
        status="new",
        meta={"injected": True},
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row_dict(row)
