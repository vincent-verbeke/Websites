"""GTM spend control + campaign metrics ingestion (B4/B5).

Vincent 2026-11-02 08:33: *"B2,3,4,5 pls do it yourself"* — this module is
B4 (metrics ingestion) and B5 (spend caps + approval gate). Docs:
``docs/TRADING_WATCH_CLOUD.md`` §18/§19.

Contracts (all machine endpoints: Bearer NEEDLE_TOKEN / X-Needle-Token):
  POST /campaigns/metrics            upsert one {campaign, channel, day, ...}
  GET  /campaigns/metrics?from&to    rows + totals (needle daily evaluation)
  GET  /spend/status                 caps, month usage, approvals, records
  POST /spend/approvals              request Vincent's go (always pending)
  POST /spend/approvals/{id}/decision  {decision, phrase} — phrase must equal
                                      settings.SPEND_APPROVAL_PHRASE (typed
                                      in the dashboard UI, never bundled)
  POST /spend/records                attempts spend: needs an APPROVED
                                      approval + within caps else 403

B5 policy (prompt §6): NO campaign creation / spend increase / external
publishing without Vincent's explicit go -> every spend record requires an
approved approval; monthly caps CHF 100 total, CHF 70 Google search.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.cloud_dashboard import require_needle_bearer_token
from app.core.config import settings
from app.db.session import get_db
from app.models.entities import CampaignMetric, SpendApproval, SpendRecord

router = APIRouter(tags=["spend-control"])

SEARCH_CHANNELS = ("google", "search", "sem", "adwords")


# ---------------------------------------------------------------------------
# Pure decision helpers (unit-tested — tests/test_marketing_guard.py)
# ---------------------------------------------------------------------------

def normalize_metric(payload: dict) -> dict:
    """Validate/normalize an incoming campaign-metric row (raises ValueError)."""
    campaign = str(payload.get("campaign") or "").strip()
    channel = str(payload.get("channel") or "").strip().lower()
    day_raw = str(payload.get("day") or "").strip()
    if not campaign:
        raise ValueError("campaign is required")
    if not channel:
        raise ValueError("channel is required")
    if not day_raw:
        raise ValueError("day is required (YYYY-MM-DD or ISO)")
    try:
        day = datetime.fromisoformat(day_raw)   # py>=3.11 accepts trailing Z
    except ValueError:
        raise ValueError(f"day not parseable: {day_raw!r}") from None
    if day.tzinfo is None:
        # naive midnight stays midnight in UTC (day-bucket key; no tz shift)
        day = datetime(day.year, day.month, day.day, tzinfo=UTC)

    def _num(key: str, cast=float):
        raw = payload.get(key, 0)
        if raw in (None, ""):
            raw = 0
        val = cast(raw)
        if val < 0:
            raise ValueError(f"{key} must be >= 0")
        return val

    return {
        "campaign": campaign,
        "channel": channel,
        "day": day,
        "spend_chf": _num("spend_chf"),
        "impressions": _num("impressions", int),
        "clicks": _num("clicks", int),
        "leads": _num("leads", int),
        "conversions": _num("conversions", int),
        "extra": payload.get("extra") if isinstance(payload.get("extra"), dict) else {},
    }


def spend_decision(amount_chf: float, channel: str,
                   total_used_chf: float, search_used_chf: float,
                   approved: bool,
                   total_cap: float | None = None,
                   search_cap: float | None = None) -> tuple[bool, str]:
    """B5 gate. Returns (allowed, reason). Caps default to settings."""
    total_cap = settings.SPEND_TOTAL_CAP_CHF if total_cap is None else total_cap
    search_cap = settings.SPEND_SEARCH_CAP_CHF if search_cap is None else search_cap
    try:
        amount = float(amount_chf)
    except (TypeError, ValueError):
        return False, f"amount_chf not a number: {amount_chf!r}"
    if amount <= 0:
        return False, "amount_chf must be > 0"
    if not approved:
        return False, ("approval required (B5): create a spend approval and "
                       "get Vincent's decision first")
    remaining_total = round(total_cap - float(total_used_chf), 2)
    if amount > remaining_total + 1e-9:
        return False, (f"monthly total cap reached: {amount:.2f} CHF would "
                       f"exceed remaining {remaining_total:.2f} CHF "
                       f"(cap {total_cap:.0f})")
    ch = (channel or "").lower()
    if any(ch.startswith(s) for s in SEARCH_CHANNELS):
        remaining_search = round(search_cap - float(search_used_chf), 2)
        if amount > remaining_search + 1e-9:
            return False, (f"google/search sub-cap reached: remaining "
                           f"{remaining_search:.2f} CHF (cap {search_cap:.0f})")
    return True, "allowed"


def month_start_utc(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return datetime(now.year, now.month, 1, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class MetricIn(BaseModel):
    campaign: str
    channel: str
    day: str
    spend_chf: float = 0
    impressions: int = 0
    clicks: int = 0
    leads: int = 0
    conversions: int = 0
    extra: dict = Field(default_factory=dict)


class ApprovalIn(BaseModel):
    amount_chf: float
    channel: str
    purpose: str | None = None


class DecisionIn(BaseModel):
    decision: str                       # approved | rejected
    phrase: str = ""                    # settings.SPEND_APPROVAL_PHRASE
    decided_by: str = "dashboard"


class SpendRecordIn(BaseModel):
    amount_chf: float
    channel: str
    purpose: str | None = None
    approval_id: str | None = None
    source: str = "manual"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _bad(msg: str, code: int = status.HTTP_400_BAD_REQUEST):
    raise HTTPException(status_code=code, detail=msg)


@router.post("/campaigns/metrics", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_needle_bearer_token)])
async def ingest_campaign_metric(
    payload: MetricIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """B4: idempotent upsert keyed on (campaign, channel, day)."""
    try:
        norm = normalize_metric(payload.model_dump())
    except ValueError as e:
        _bad(str(e))
    row = (await db.execute(
        select(CampaignMetric).where(
            CampaignMetric.campaign == norm["campaign"],
            CampaignMetric.channel == norm["channel"],
            CampaignMetric.day == norm["day"],
        ))).scalars().first()
    if row:
        for k in ("spend_chf", "impressions", "clicks", "leads",
                  "conversions", "extra", "day"):
            setattr(row, k, norm[k])
        updated = True
    else:
        row = CampaignMetric(**norm)
        db.add(row)
        updated = False
    await db.commit()
    return {"ok": True, "id": str(row.id), "updated": updated,
            "day": norm["day"].isoformat()}


@router.get("/campaigns/metrics")   # public read (same policy as /investments)
async def list_campaign_metrics(
    db: Annotated[AsyncSession, Depends(get_db)],
    date_from: str | None = None,
    date_to: str | None = None,
    campaign: str | None = None,
) -> dict:
    q = select(CampaignMetric).order_by(desc(CampaignMetric.day))
    if date_from:
        q = q.where(CampaignMetric.day >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.where(CampaignMetric.day <= datetime.fromisoformat(date_to))
    if campaign:
        q = q.where(CampaignMetric.campaign == campaign)
    rows = (await db.execute(q)).scalars().all()
    totals = {
        "spend_chf": float(sum(r.spend_chf or 0 for r in rows)),
        "clicks": sum(r.clicks or 0 for r in rows),
        "leads": sum(r.leads or 0 for r in rows),
        "conversions": sum(r.conversions or 0 for r in rows),
    }
    return {"metrics": [{
        "campaign": r.campaign, "channel": r.channel,
        "day": r.day.isoformat() if r.day else None,
        "spend_chf": float(r.spend_chf or 0), "impressions": r.impressions,
        "clicks": r.clicks, "leads": r.leads, "conversions": r.conversions,
        "extra": r.extra,
    } for r in rows], "count": len(rows), "totals": totals}


async def _month_usage(db: AsyncSession) -> tuple[float, float]:
    """(total spend CHF this month, google/search spend CHF) from both
    ledgers (records + metrics)."""
    start = month_start_utc()
    total = (await db.execute(select(func.coalesce(func.sum(SpendRecord.amount_chf), 0))
                              .where(SpendRecord.created_at >= start))).scalar() or 0
    search = (await db.execute(select(func.coalesce(func.sum(SpendRecord.amount_chf), 0))
                               .where(SpendRecord.created_at >= start,
                                      SpendRecord.channel.ilike("google%")))).scalar() or 0
    m_total = (await db.execute(select(func.coalesce(func.sum(CampaignMetric.spend_chf), 0))
                                .where(CampaignMetric.day >= start))).scalar() or 0
    m_search = (await db.execute(select(func.coalesce(func.sum(CampaignMetric.spend_chf), 0))
                                 .where(CampaignMetric.day >= start,
                                        CampaignMetric.channel.ilike("google%")))).scalar() or 0
    return float(total) + float(m_total), float(search) + float(m_search)


@router.get("/spend/status")   # public read (caps/usage/approvals carry no secrets)
async def spend_status(db: Annotated[AsyncSession, Depends(get_db)]) -> dict:
    """B5 dashboard feed: caps, month usage/remaining, approvals, records."""
    total_used, search_used = await _month_usage(db)
    approvals = (await db.execute(
        select(SpendApproval).order_by(desc(SpendApproval.created_at)).limit(10)
    )).scalars().all()
    records = (await db.execute(
        select(SpendRecord).order_by(desc(SpendRecord.created_at)).limit(10)
    )).scalars().all()
    return {
        "caps": {"total_chf": settings.SPEND_TOTAL_CAP_CHF,
                 "search_chf": settings.SPEND_SEARCH_CAP_CHF,
                 "window": "calendar month (UTC)"},
        "used": {"total_chf": round(total_used, 2),
                 "search_chf": round(search_used, 2)},
        "remaining": {
            "total_chf": round(settings.SPEND_TOTAL_CAP_CHF - total_used, 2),
            "search_chf": round(settings.SPEND_SEARCH_CAP_CHF - search_used, 2)},
        "approvals": [{"id": str(a.id), "amount_chf": float(a.amount_chf),
                       "channel": a.channel, "purpose": a.purpose,
                       "status": a.status, "decided_by": a.decided_by,
                       "created_at": a.created_at.isoformat() if a.created_at else None}
                      for a in approvals],
        "records": [{"id": str(r.id), "amount_chf": float(r.amount_chf),
                     "channel": r.channel, "purpose": r.purpose,
                     "approval_id": str(r.approval_id) if r.approval_id else None,
                     "created_at": r.created_at.isoformat() if r.created_at else None}
                    for r in records],
    }


@router.post("/spend/approvals", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_needle_bearer_token)])
async def request_spend_approval(
    payload: ApprovalIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    if payload.amount_chf <= 0:
        _bad("amount_chf must be > 0")
    row = SpendApproval(amount_chf=payload.amount_chf,
                        channel=payload.channel.lower(),
                        purpose=payload.purpose)
    db.add(row)
    await db.commit()
    return {"ok": True, "id": str(row.id), "status": row.status,
            "note": "pending — Vincent decides in the dashboard (phrase)"}


@router.post("/spend/approvals/{approval_id}/decision")  # phrase = THE gate
async def decide_spend_approval(
    approval_id: str,
    payload: DecisionIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """The Vincent gate (docs §19): the approval phrase typed in the dashboard
    must match settings.SPEND_APPROVAL_PHRASE. The phrase is never shipped in
    any bundle; this endpoint intentionally has NO bearer dependency so the
    browser can call it (phrase = the explicit go; keep it non-guessable)."""
    import uuid as _uuid
    try:
        uid = _uuid.UUID(approval_id)
    except ValueError:
        _bad("approval_id not a uuid")
    row = (await db.execute(select(SpendApproval).where(SpendApproval.id == uid))
           ).scalars().first()
    if not row:
        _bad("approval not found", status.HTTP_404_NOT_FOUND)
    if row.status != "pending":
        _bad(f"approval already {row.status}")
    dec = payload.decision.lower().strip()
    if dec not in ("approved", "rejected"):
        _bad("decision must be approved|rejected")
    if payload.phrase != settings.SPEND_APPROVAL_PHRASE:
        _bad("approval phrase mismatch", status.HTTP_403_FORBIDDEN)
    row.status = dec
    row.decided_by = payload.decided_by[:64]
    row.decided_at = datetime.now(UTC)
    await db.commit()
    return {"ok": True, "id": str(row.id), "status": row.status,
            "decided_by": row.decided_by}


@router.post("/spend/records", status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_needle_bearer_token)])
async def record_spend(
    payload: SpendRecordIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """B5 enforcement point: approved approval + inside BOTH caps or 403."""
    import uuid as _uuid
    approved = False
    if payload.approval_id:
        try:
            uid = _uuid.UUID(payload.approval_id)
        except ValueError:
            _bad("approval_id not a uuid")
        row = (await db.execute(select(SpendApproval).where(SpendApproval.id == uid))
               ).scalars().first()
        approved = bool(row and row.status == "approved")
    total_used, search_used = await _month_usage(db)
    allowed, reason = spend_decision(payload.amount_chf, payload.channel,
                                     total_used, search_used, approved)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"denied": True, "reason": reason})
    rec = SpendRecord(amount_chf=payload.amount_chf,
                      channel=payload.channel.lower(),
                      purpose=payload.purpose,
                      approval_id=_uuid.UUID(payload.approval_id) if payload.approval_id else None,
                      source=payload.source[:32])
    db.add(rec)
    await db.commit()
    return {"ok": True, "id": str(rec.id),
            "remaining_total_chf": round(settings.SPEND_TOTAL_CAP_CHF
                                         - total_used - payload.amount_chf, 2),
            "remaining_search_chf": round(settings.SPEND_SEARCH_CAP_CHF
                                          - search_used
                                          - (payload.amount_chf if any(
                                              payload.channel.lower().startswith(s)
                                              for s in SEARCH_CHANNELS) else 0), 2)}
