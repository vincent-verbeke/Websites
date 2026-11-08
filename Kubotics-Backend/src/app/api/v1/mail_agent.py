"""Kubot mail agent admin API (mounted at {API_V1_STR}/mail).

Endpoints (all Bearer `API_SECRET_KEY`, open only while the secret is unset —
the `require_ingest_token` convention):

- GET    /status          loop heartbeat, state counts, effective config
- GET    /senders         override list + cached Outlook contact view
- POST   /senders         add/update an override sender (validated, cap 50)
- DELETE /senders/{email} deactivate (idempotent)
- GET    /messages        ledger rows (`?state=&limit=`) — plan §6
- POST   /poll            trigger one cycle manually (test/status use)

Plan: docs/KUBOT_MAIL_AGENT_PLAN.md §6 (build step 5).
"""
from __future__ import annotations

import re

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.mail_agent import MailMessage, MailWatchSender
from app.services import mail_agent as mail_agent_service
from app.services import mail_llm

MAIL_ADDR_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
MAX_SENDERS = 50          # mirror of PC-A MAIL_WATCH_MAX_SENDERS
MAX_MESSAGES = 200


def require_mail_token(authorization: str | None = Header(None)) -> None:
    """Bearer API_SECRET_KEY; open when the secret is unset (local dev)."""
    if not settings.API_SECRET_KEY:
        return
    if authorization != f"Bearer {settings.API_SECRET_KEY}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Valid Bearer token required")


router = APIRouter(prefix="/mail", tags=["MailAgent"],
                   dependencies=[Depends(require_mail_token)])


class SenderCreate(BaseModel):
    email: str = Field(min_length=5, max_length=255,
                       pattern=r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
    tier: str = Field(default="contact", max_length=32)
    display_name: str | None = Field(default=None, max_length=255)
    language: str | None = Field(default=None, max_length=16)
    note: str | None = Field(default=None, max_length=4000)


def _sender_row(r: MailWatchSender) -> dict:
    return {"id": str(r.id), "email": r.email, "tier": r.tier,
            "display_name": r.display_name, "language": r.language,
            "active": r.active, "note": r.note,
            "created_at": r.created_at.isoformat() if r.created_at else None}


def _message_row(r: MailMessage) -> dict:
    cls = r.classification or {}
    return {"id": str(r.id), "sender": r.sender, "subject": r.subject,
            "state": r.state, "route": r.route, "tier": r.tier,
            "priority": r.priority, "category": r.category,
            "language": r.language, "summary": r.summary,
            "error": r.error, "web_link": r.web_link,
            "reply_chars": len(r.reply_text or ""),
            "llm_provider": r.llm_provider, "llm_model": r.llm_model,
            "notify": cls.get("notify"),
            "received_at": r.received_at.isoformat() if r.received_at else None,
            "sent_at": r.sent_at.isoformat() if r.sent_at else None}


async def _state_counts() -> dict[str, int]:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(MailMessage.state, func.count(MailMessage.id))
            .group_by(MailMessage.state)
        )).all()
    return {state: int(count) for state, count in rows}


async def _list_messages(state_filter: str | None, limit: int) -> list[dict]:
    async with AsyncSessionLocal() as db:
        stmt = select(MailMessage).order_by(MailMessage.received_at.desc()).limit(limit)
        if state_filter:
            stmt = stmt.where(MailMessage.state == state_filter)
        rows = (await db.execute(stmt)).scalars().all()
    return [_message_row(r) for r in rows]


@router.get("/status")
async def mail_status() -> dict:
    return {
        "enabled": settings.MAIL_AGENT_ENABLED,
        "mode": settings.MAIL_AGENT_MODE,
        "upn": mail_agent_service.resolve_upn(),
        "poll_interval_s": settings.MAIL_AGENT_POLL_INTERVAL_S,
        "only_senders": settings.MAIL_AGENT_ONLY_SENDERS,
        "unknown_policy": settings.MAIL_AGENT_UNKNOWN_POLICY,
        "llm_chain": settings.MAIL_AGENT_LLM_CHAIN,
        "llm_providers_configured": [p.name for p in mail_llm.provider_chain()],
        "alert_window": (f"{settings.MAIL_AGENT_ALERT_WINDOW_START}-"
                         f"{settings.MAIL_AGENT_ALERT_WINDOW_END} "
                         f"{settings.MAIL_AGENT_ALERT_TZ}"),
        "reply_window_days": settings.MAIL_AGENT_REPLY_WINDOW_DAYS,
        "max_replies_per_day": settings.MAIL_AGENT_MAX_REPLIES_PER_DAY,
        "watermark": await mail_agent_service.get_watermark(),
        "state_counts": await _state_counts(),
        "last_cycle": dict(mail_agent_service.last_cycle()),
    }


@router.get("/senders")
async def list_senders() -> dict:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(MailWatchSender).order_by(MailWatchSender.created_at.asc())
        )).scalars().all()
    outlook: list[dict] = []
    outlook_error = None
    try:
        async with httpx.AsyncClient() as client:
            cards = await mail_agent_service.fetch_contacts(client)
        outlook = [
            {"display_name": c.get("displayName"),
             "addresses": [a.get("address") for a in (c.get("emailAddresses") or [])],
             "categories": c.get("categories") or [],
             "has_note": bool((c.get("personalNotes") or "").strip())}
            for c in cards
        ]
    except Exception as exc:  # noqa: BLE001 — view degrades, override list is the API
        outlook_error = f"{type(exc).__name__}: {exc}"[:200]
    payload = {"senders": [_sender_row(r) for r in rows], "outlook_contacts": outlook}
    if outlook_error:
        payload["outlook_error"] = outlook_error
    return payload


@router.post("/senders", status_code=status.HTTP_201_CREATED)
async def upsert_sender(body: SenderCreate) -> dict:
    email = body.email.strip().lower()
    if not MAIL_ADDR_RE.match(email):
        raise HTTPException(status_code=422, detail="invalid email address")
    async with AsyncSessionLocal() as db:
        existing = (await db.execute(
            select(MailWatchSender).where(MailWatchSender.email == email)
        )).scalar_one_or_none()
        if existing:
            existing.tier = body.tier
            existing.display_name = body.display_name
            existing.language = body.language
            existing.note = body.note
            existing.active = True
            row = existing
        else:
            active_count = (await db.execute(
                select(func.count(MailWatchSender.id)).where(
                    MailWatchSender.active.is_(True))
            )).scalar_one()
            if active_count >= MAX_SENDERS:
                raise HTTPException(status_code=429,
                                    detail=f"sender cap ({MAX_SENDERS}) reached")
            row = MailWatchSender(email=email, tier=body.tier,
                                  display_name=body.display_name,
                                  language=body.language, note=body.note,
                                  active=True)
            db.add(row)
        await db.commit()
        await db.refresh(row)
    return _sender_row(row)


@router.delete("/senders/{email}")
async def deactivate_sender(email: str) -> dict:
    target = email.strip().lower()
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(MailWatchSender).where(MailWatchSender.email == target)
        )).scalar_one_or_none()
        if row and row.active:
            row.active = False
            await db.commit()
    return {"ok": True, "email": target}   # idempotent (PC-A remove semantics)


@router.get("/messages")
async def list_messages(state: str | None = Query(default=None),
                        limit: int = Query(default=50, ge=1, le=MAX_MESSAGES)) -> dict:
    rows = await _list_messages(state, limit)
    return {"messages": rows, "count": len(rows)}


@router.post("/poll")
async def poll_now() -> dict:
    """Manually run one cycle (status/testing; the loop does this on schedule)."""
    try:
        stats = await mail_agent_service.run_once()
    except mail_agent_service.GraphThrottled as th:
        raise HTTPException(status_code=429, detail=str(th)) from th
    except Exception as exc:  # surface cycle errors to the caller
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}"[:300]) from exc
    return {"ok": True, "stats": stats}


@router.post("/llm_probe")
async def llm_probe(provider: str | None = Query(default=None),
                    model: str | None = Query(default=None)) -> dict:
    """Per-provider health: one tiny chat call per configured chain step.

    Answers "is this key actually working — and if not, what is the REAL
    provider error" after any secret rotation (plan §7.5). Returns ok,
    latency and a truncated error per provider — never key material.
    Optional ``provider`` + ``model`` trial a single chain step with a
    candidate model id (live model-id validation). Costs a few tokens."""
    chain = mail_llm.provider_chain()
    if provider:
        chain = [p for p in chain if p.name == provider.lower()]
        if model and chain:
            p = chain[0]
            chain = [mail_llm.Provider(p.name, p.base_url, p.api_key, model)]
    return {"chain": settings.MAIL_AGENT_LLM_CHAIN,
            "configured": [p.name for p in mail_llm.provider_chain()],
            "trial": {"provider": provider, "model": model} if provider else None,
            "providers": await mail_llm.probe_providers(chain=chain)}
