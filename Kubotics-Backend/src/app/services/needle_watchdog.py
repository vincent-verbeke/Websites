"""Cloud safety net for the needle3 operator inbox (Vincent 2026-11-27).

Why this exists
---------------
Every operator WhatsApp message is persisted to ``needle_inbox`` and is only
processed by ``needle3.service`` -- a systemd user service **on PC-A**
(192.168.1.199). When PC-A is off or unreachable, rows stay ``status='new'``
forever and Vincent hears nothing back. That is exactly what he reported on
2026-11-27 ("my whatsapp messages are not handled since at least yesterday
evening ... i cannot trust our system like this when i am visiting customers";
root cause confirmed: PC-A not on the LAN, last ``done`` ack 26 Nov 12:53).

This loop runs in the **cloud backend** (it does not depend on PC-A) and:

* alerts Vincent via WhatsApp when a row stays unclaimed (``new``) longer than
  ``NEEDLE_WATCHDOG_STALE_AFTER_S``, or stays claimed (``dispatched``) with no
  reply for ``NEEDLE_WATCHDOG_DISPATCHED_AFTER_S`` (30-min dev-task limit +
  margin);
* stamps ``meta['stale_alerted_at']`` once per row => no repeat spam;
* sends ONE batched recovery note per tick once alerted rows reach
  ``done``/``failed`` (``meta['recovery_sent']``);
* writes an ``inbound_events`` row (channel ``needle_watch``) for audit.

It never mutates row status/session/reply: the queue stays authoritative for
needle3, so a drained-backlog row is still processed by PC-A when it returns.
Alerts go to ``NEEDLE_OPERATOR_SENDERS`` (Vincent), never to the row sender,
so a spam row can never trigger a reply to a stranger.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.tasks import InboundEvent
from app.models.needle import NeedleInbox
from app.services.whatsapp_service import whatsapp_service

import logging

logger = logging.getLogger(__name__)

BACKLOG_WINDOW_DAYS = 7  # only scan recent rows


def _now() -> datetime:
    return datetime.now(UTC)


def evaluate(
    rows: list[NeedleInbox],
    now: datetime,
    stale_after_s: int,
    dispatched_after_s: int,
) -> tuple[list[tuple[NeedleInbox, int]], list[NeedleInbox]]:
    """Pure staleness decision. Returns ([(row, age_s) to alert], [rows to recover]).

    * alert: ``new`` rows older than ``stale_after_s``, or ``dispatched`` rows
      without a reply older than ``dispatched_after_s``; each only once
      (``meta['stale_alerted_at']`` unset).
    * recover: rows already alerted earlier that reached ``done``/``failed``
      and have not had the recovery note sent yet.
    """
    stale: list[tuple[NeedleInbox, int]] = []
    recover: list[NeedleInbox] = []
    for row in rows:
        meta = row.meta if isinstance(row.meta, dict) else {}
        alerted = bool(meta.get("stale_alerted_at"))
        ts = row.ts if row.ts is not None else now
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        age_s = int((now - ts).total_seconds())
        if row.status == "new":
            if age_s >= stale_after_s and not alerted:
                stale.append((row, age_s))
        elif row.status == "dispatched":
            if age_s >= dispatched_after_s and not alerted and row.reply_ts is None:
                stale.append((row, age_s))
        elif row.status in ("done", "failed"):
            if alerted and not meta.get("recovery_sent"):
                recover.append(row)
    return stale, recover


def alert_text(count: int, oldest_age_s: int, snippet: str) -> str:
    mins = max(1, oldest_age_s // 60)
    plural = "" if count == 1 else "s"
    return (
        f"⚠️ needle3 queue alert: {count} WhatsApp message{plural} of yours "
        f"not handled yet (oldest waiting {mins} min).\n"
        "needle3 on PC-A looks offline (192.168.1.199 unreachable). "
        "Your messages ARE queued in the cloud and will be handled as soon as "
        f"PC-A is back on.\nOldest: \"{snippet}\""
    )


def recovery_text(count: int) -> str:
    plural = "" if count == 1 else "s"
    return (
        f"✅ needle3 queue recovered: your {count} queued message{plural} "
        "have been processed. PC-A is back."
    )


def _operator_recipient() -> str | None:
    return next(
        (s.strip() for s in settings.NEEDLE_OPERATOR_SENDERS.split(",") if s.strip()),
        None,
    )


async def _send(text: str) -> bool:
    recipient = _operator_recipient()
    if not recipient:
        logger.warning("[needle-watchdog] no operator recipient configured")
        return False
    try:
        ok, wamid, raw = await whatsapp_service.send_text_message(recipient, text)
        logger.info(
            "[needle-watchdog] whatsapp -> %s (%s)",
            "sent" if ok else "FAILED",
            wamid or raw,
        )
        return bool(ok)
    except Exception as exc:  # noqa: BLE001 -- alerting must never kill the loop
        logger.warning("[needle-watchdog] whatsapp error: %s", exc)
        return False


async def _audit(db: AsyncSession, event_id: str, payload: dict[str, Any]) -> None:
    """Idempotent inbound_events row (unique event_id)."""
    exists = (
        await db.execute(
            select(InboundEvent.id).where(InboundEvent.event_id == event_id)
        )
    ).first()
    if exists:
        return
    db.add(
        InboundEvent(
            event_id=event_id,
            channel="needle_watch",
            sender_id="watchdog",
            payload=payload,
            status="received",
        )
    )


async def check_once(db: AsyncSession, now: datetime | None = None) -> dict[str, Any]:
    """One watchdog pass. Returns counts for logging/tests; never raises on send."""
    now = now or _now()
    window_start = now - timedelta(days=BACKLOG_WINDOW_DAYS)
    rows = list(
        (
            await db.execute(
                select(NeedleInbox)
                .where(
                    NeedleInbox.ts >= window_start,
                    NeedleInbox.status.in_(("new", "dispatched", "done", "failed")),
                )
                .order_by(NeedleInbox.id.asc())
            )
        ).scalars().all()
    )
    stale, recover = evaluate(
        rows,
        now,
        settings.NEEDLE_WATCHDOG_STALE_AFTER_S,
        settings.NEEDLE_WATCHDOG_DISPATCHED_AFTER_S,
    )

    alerted = 0
    if stale:
        oldest_age = max(age for _row, age in stale)
        snippet = (stale[0][0].text or "")[:80]
        if await _send(alert_text(len(stale), oldest_age, snippet)):
            for row, _age in stale:
                meta = dict(row.meta) if isinstance(row.meta, dict) else {}
                meta["stale_alerted_at"] = now.isoformat()
                row.meta = meta
                await _audit(
                    db,
                    f"needle-watch-stale-{row.id}",
                    {
                        "row_id": row.id,
                        "status": row.status,
                        "age_s": _age,
                        "text": (row.text or "")[:200],
                    },
                )
                alerted += 1

    recovered = 0
    if recover:
        if await _send(recovery_text(len(recover))):
            for row in recover:
                meta = dict(row.meta) if isinstance(row.meta, dict) else {}
                meta["recovery_sent"] = now.isoformat()
                row.meta = meta
                await _audit(
                    db,
                    f"needle-watch-recovered-{row.id}",
                    {"row_id": row.id, "final_status": row.status},
                )
                recovered += 1

    await db.commit()
    if alerted or recovered:
        logger.info(
            "[needle-watchdog] alerted=%s recovered=%s (active backlog=%s)",
            alerted,
            recovered,
            sum(1 for r in rows if r.status in ("new", "dispatched")),
        )
    return {"alerted": alerted, "recovered": recovered, "scanned": len(rows)}


async def watchdog_loop(interval_s: int | None = None) -> None:
    """Background cadence: boot grace, one bad cycle never kills it."""
    interval = interval_s or settings.NEEDLE_WATCHDOG_TICK_S
    await asyncio.sleep(5)  # let the app finish booting
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await check_once(db)
        except asyncio.CancelledError:  # noqa: PERF201
            raise
        except Exception:
            logger.exception("[needle-watchdog] cycle crashed")
        await asyncio.sleep(interval)


def maybe_start_needle_watchdog_loop() -> asyncio.Task | None:
    """main.py lifespan hook: task when the flag is on (default ON - alert-only)."""
    if not settings.NEEDLE_WATCHDOG_ENABLED:
        return None
    return asyncio.create_task(watchdog_loop())
