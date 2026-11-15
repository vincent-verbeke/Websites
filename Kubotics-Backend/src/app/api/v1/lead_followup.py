"""Lead follow-up admin API (mounted at {API_V1_STR}/leads).

docs/LEAD_FOLLOWUP_PLAN.md §"ops endpoints". Two admin routes (shared
``_require_admin_token`` gate: Bearer / X-Needle-Token against NEEDLE_TOKEN /
API_SECRET_KEY — same as the IBKR routes):

  GET  /api/v1/leads/followup/status         observability: flag, status
       counts, today's sends vs cap, next few due — contact_id only, no PII
  POST /api/v1/leads/followup/{contact_id}/stop   idempotent manual stop

Both work while LEAD_FOLLOWUP_ENABLED is off (status reports enabled=false),
so the wiring can be verified BEFORE the flag is flipped.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.ibkr_mcp import _require_admin_token
from app.db.session import get_db
from app.models.entities import Contact
from app.services import lead_followup as lf

router = APIRouter(
    prefix="/leads",
    tags=["lead-followup"],
    dependencies=[Depends(_require_admin_token)],
)


@router.get("/followup/status")
async def followup_status(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Flag + counts + today's sends + next due. No PII beyond contact_id."""
    return await lf.status_snapshot(db, datetime.now(UTC))


@router.post("/followup/{contact_id}/stop")
async def followup_stop(
    contact_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Stop the sequence for one contact (idempotent; 404 if unknown)."""
    contact = (
        await db.execute(select(Contact).where(Contact.id == contact_id))
    ).scalars().first()
    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="contact not found",
        )
    return await lf.stop_followup(db, contact, datetime.now(UTC))
