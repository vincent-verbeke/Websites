"""Kubot mail agent — poll loop, ledger claims, hard filters.

Build step 2/5 (plan docs/KUBOT_MAIL_AGENT_PLAN.md §10): metadata scan with
PC-A-proven watermark semantics (rounds 19/20: strict ``<`` skip, dedupe by
``internetMessageId``), first-boot seed pass (never retro-processes old mail),
idempotent claim (``INSERT … ON CONFLICT DO NOTHING`` — safe across restarts
and ECS tasks), and the sender-level hard filters of plan §3.4.

Header-level hard filters (``Auto-Submitted``/``List-Unsubscribe``/``Precedence``)
are implemented here as ``header_hard_filter`` and wired in build step 3,
which fetches body+headers per new candidate (metadata scan never carries
them — PC-A lesson: 34 MiB payloads).

Rows left in state ``received`` are picked up by step 3 (classify) and
step 4 (send). The loop only starts when ``MAIL_AGENT_ENABLED`` is true
(main.py lifespan) — default False (Phase 0 contract).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.mail_agent import MailMessage
from app.models.tasks import DeviceSnapshotCache
from app.services.m365_service import m365_service

logger = logging.getLogger(__name__)

SCAN_SELECT = "from,subject,receivedDateTime,internetMessageId,conversationId,isRead,webLink"
SCAN_TOP = 100
WATERMARK_DATASET = "kubot_mail_watermark"
WATERMARK_KEY = "watermark"


class GraphThrottled(Exception):
    """429 with a Retry-After hint — the loop backs off instead of hammering."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"graph throttled, retry in {retry_after}s")
        self.retry_after = retry_after


# --- pure helpers (unit-tested, plan §3.4 / §1 Q1) ----------------------------

def resolve_upn() -> str:
    """Mailbox to watch: MAIL_AGENT_UPN wins, else M365_ORGANIZER_EMAIL."""
    return (settings.MAIL_AGENT_UPN or settings.M365_ORGANIZER_EMAIL).strip().lower()


def own_address_set(upn_addr: str, proxy_addresses: list[str] | None,
                    extras_csv: str = "") -> set[str]:
    """Own-mail identities (Q1: the mailbox holds 28 proxyAddresses).

    Exchange casing: ``SMTP:`` (upper) = primary, ``smtp:`` = secondary —
    both prefixes are stripped after lowercasing. Extras from
    ``MAIL_AGENT_OWN_ADDRESSES`` (comma list) are appended.
    """
    own: set[str] = set()
    upn_addr = (upn_addr or "").strip().lower()
    if upn_addr:
        own.add(upn_addr)
    for raw in proxy_addresses or []:
        p = (raw or "").strip()
        low = p.lower()
        if low.startswith("smtp:"):
            p = p[5:]
        elif low.startswith(("sip:", "x500:", "dn:")):
            continue
        p = p.strip().lower()
        if "@" in p:
            own.add(p)
    for extra in (extras_csv or "").split(","):
        e = extra.strip().lower()
        if "@" in e:
            own.add(e)
    return own


def sender_hard_filter(sender: str, own: set[str]) -> str | None:
    """Sender-level never-answer filters (plan §3.4). Reason string or None.

    Applied AFTER the ledger claim so every examined message is audited.
    """
    s = (sender or "").strip().lower()
    if not s or "@" not in s:
        return "no_sender"
    if s in own:
        return "own_mail"
    local = s.split("@", 1)[0]
    if local in {"mailer-daemon", "postmaster", "abuse", "root"}:
        return "system_sender"
    if local.startswith(("noreply", "no-reply", "no_reply", "do-not-reply",
                         "donotreply", "do_not_reply")):
        return "noreply_sender"
    return None


def header_hard_filter(headers: dict[str, str]) -> str | None:
    """Header-level never-answer filters (plan §3.4), Q14: never autoreplies.

    ``headers``: lowercased header name -> value. ``Auto-Submitted: no``
    explicitly marks a human-sent mail (RFC 3834) and passes.
    """
    auto = headers.get("auto-submitted")
    if auto is not None and (auto or "").strip().lower() != "no":
        return "auto_submitted"
    if "list-unsubscribe" in headers or "list-id" in headers:
        return "mailing_list"
    precedence = (headers.get("precedence") or "").strip().lower()
    if precedence in {"bulk", "junk", "list", "auto_reply"}:
        return f"precedence_{precedence}"
    if (headers.get("x-auto-response-suppress") or "").strip().lower() not in ("", "none"):
        return "auto_response_suppress"
    return None


def plan_scan(messages: list[dict], base: str | None, ledger_empty: bool,
              known_ids: set[str]) -> tuple[list[dict], str | None, bool]:
    """Decide what this cycle claims (PC-A rounds 19/20 semantics, DB-backed).

    Returns ``(claims, new_watermark, seed_only)``:
    * First boot (empty ledger, no watermark): **seed** — record the newest
      timestamp, claim nothing (never retro-answer old mail), ``seed_only=True``.
    * Skip strictly older than the watermark (``ts < base``); equal-second
      rows are re-offered and deduped by ``known_ids``/unique claim.
    * Watermark advances only over rows this cycle claims (``…SSZ`` strings
      compare lexicographically — Graph second-precision contract, PC-A
      round-19 census).
    """
    if not messages:
        return [], base, False
    newest = max((m.get("receivedDateTime") or "" for m in messages), default="")
    if ledger_empty and not base:
        return [], newest or base, True
    claims: list[dict] = []
    max_claimed = ""
    for m in messages:
        ts = m.get("receivedDateTime") or ""
        mid = m.get("internetMessageId") or ""
        if not ts or not mid:
            continue
        if base and ts < base:
            continue
        if mid in known_ids:
            continue
        claims.append(m)
        max_claimed = max(max_claimed, ts)
    new_base = base
    if max_claimed and max_claimed > (base or ""):
        new_base = max_claimed
    return claims, new_base, False


# --- Graph access (async, token from the proven m365_service) -----------------

def _upn_path() -> str:
    return f"/users/{resolve_upn()}"


async def fetch_own_addresses(client: httpx.AsyncClient) -> set[str]:
    """Q1: discover all mailbox aliases once per process (cached)."""
    global _OWN_CACHE
    if _OWN_CACHE is not None:
        return _OWN_CACHE
    tok = m365_service.get_access_token()
    resp = await client.get(
        f"https://graph.microsoft.com/v1.0{_upn_path()}",
        params={"$select": "mail,proxyAddresses"},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15.0,
    )
    if resp.status_code == 200:
        data = resp.json()
        addrs = own_address_set(
            data.get("mail") or resolve_upn(),
            data.get("proxyAddresses"),
            settings.MAIL_AGENT_OWN_ADDRESSES,
        )
        _OWN_CACHE = addrs
        logger.info("[mail-agent] own-address set discovered: %d aliases", len(addrs))
        return addrs
    # Degrade loudly but keep running: UPN + configured extras only.
    logger.warning("[mail-agent] alias discovery HTTP %s — using UPN+extras only",
                   resp.status_code)
    return own_address_set(resolve_upn(), None, settings.MAIL_AGENT_OWN_ADDRESSES)


_OWN_CACHE: set[str] | None = None


async def fetch_inbox_metadata(client: httpx.AsyncClient) -> list[dict]:
    """Metadata-only newest-100 scan (plan §3.1; bodies never scanned)."""
    tok = m365_service.get_access_token()
    resp = await client.get(
        f"https://graph.microsoft.com/v1.0{_upn_path()}/mailFolders/inbox/messages",
        params={"$top": str(SCAN_TOP), "$orderby": "receivedDateTime desc",
                "$select": SCAN_SELECT},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=25.0,
    )
    if resp.status_code == 429:
        raise GraphThrottled(int(resp.headers.get("Retry-After") or "60"))
    if resp.status_code != 200:
        raise RuntimeError(f"inbox scan HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json().get("value", [])


# --- ledger + watermark (DB-backed, plan §3.1) --------------------------------

async def get_watermark() -> str | None:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(DeviceSnapshotCache).where(
                DeviceSnapshotCache.dataset == WATERMARK_DATASET)
        )).scalar_one_or_none()
        if row and isinstance(row.payload, dict):
            val = row.payload.get(WATERMARK_KEY)
            return str(val) if val else None
        # Fallback: derive from the ledger (snapshot row lost but mail processed)
        max_ts = (await db.execute(
            select(MailMessage.received_at).order_by(
                MailMessage.received_at.desc()).limit(1)
        )).scalar_one_or_none()
        if not max_ts:
            return None
        # PC-A format contract: Graph second-precision '...SSZ' (lexicographic compares)
        return max_ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def set_watermark(ts: str) -> None:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(DeviceSnapshotCache).where(
                DeviceSnapshotCache.dataset == WATERMARK_DATASET)
        )).scalar_one_or_none()
        if row:
            current = (row.payload or {}).get(WATERMARK_KEY) or ""
            if ts > current:  # never move backwards
                row.payload = {"watermark": ts}
        else:
            db.add(DeviceSnapshotCache(dataset=WATERMARK_DATASET,
                                       payload={"watermark": ts}))
        await db.commit()


async def recent_message_ids(since: str | None) -> set[str]:
    """Known ids for in-cycle dedupe (the UNIQUE claim is the real guard).

    ``since`` is the string watermark — parse to timestamptz for the column
    comparison (live-smoke caught the varchar-vs-timestamp error here);
    unparseable -> fetch all ids (safe superset).
    """
    async with AsyncSessionLocal() as db:
        stmt = select(MailMessage.internet_message_id)
        if since:
            try:
                cutoff = datetime.fromisoformat(since)
            except ValueError:
                cutoff = None
            if cutoff is not None:
                stmt = stmt.where(MailMessage.received_at >= cutoff)
        return set((await db.execute(stmt)).scalars().all())


async def ledger_empty() -> bool:
    async with AsyncSessionLocal() as db:
        from sqlalchemy import func as sa_func
        n = (await db.execute(select(sa_func.count(MailMessage.id)))).scalar_one()
        return n == 0


async def claim_messages(rows: list[dict]) -> list[dict]:
    """Idempotent claim: UNIQUE internet_message_id decides across tasks/restarts."""
    won: list[dict] = []
    async with AsyncSessionLocal() as db:
        for m in rows:
            sender = (((m.get("from") or {}).get("emailAddress") or {})
                      .get("address") or "").lower()
            ts_raw = m.get("receivedDateTime") or ""
            try:
                ts = datetime.fromisoformat(ts_raw)  # py3.11+ parses the trailing Z
            except ValueError:
                ts = datetime.now(UTC)
            stmt = (
                pg_insert(MailMessage.__table__)
                .values(
                    internet_message_id=m["internetMessageId"],
                    conversation_id=m.get("conversationId"),
                    sender=sender or "unknown",
                    subject=(m.get("subject") or "")[:1024],
                    received_at=ts,
                    web_link=m.get("webLink"),
                    state="received",
                )
                .on_conflict_do_nothing(index_elements=["internet_message_id"])
                .returning(MailMessage.internet_message_id)
            )
            res = await db.execute(stmt)
            if res.scalar_one_or_none() is not None:
                won.append(m)
        await db.commit()
    return won


async def mark_ignored(internet_message_id: str, reason: str) -> None:
    """Hard-filter hit -> audit row (state ignored_spam, summary = exact reason)."""
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(MailMessage).where(
                MailMessage.internet_message_id == internet_message_id)
        )).scalar_one_or_none()
        if row and row.state == "received":
            row.state = "ignored_spam"
            row.summary = f"hard_filter:{reason}"
            await db.commit()


# --- one cycle ----------------------------------------------------------------

async def run_once() -> dict:
    """One poll cycle. Returns counters for logging/status (plan §3.1)."""
    stats = {"scanned": 0, "seeded": 0, "claimed": 0, "ignored": 0, "pending": 0}
    async with httpx.AsyncClient() as client:
        messages = await fetch_inbox_metadata(client)
        own = await fetch_own_addresses(client)
    stats["scanned"] = len(messages)

    empty = await ledger_empty()
    base = await get_watermark()
    known = await recent_message_ids(base)
    claims, new_base, seed_only = plan_scan(messages, base, empty, known)

    if seed_only:
        if new_base:
            await set_watermark(new_base)
        logger.info("[mail-agent] seeded watermark at %s (%d messages seen, "
                    "none processed on first boot)", new_base, stats["scanned"])
        stats["seeded"] = 1
        return stats

    won = await claim_messages(claims) if claims else []
    stats["claimed"] = len(won)
    if new_base and new_base != base:
        await set_watermark(new_base)

    for m in won:
        sender = (((m.get("from") or {}).get("emailAddress") or {})
                  .get("address") or "")
        reason = sender_hard_filter(sender, own)
        if reason:
            await mark_ignored(m["internetMessageId"], reason)
            stats["ignored"] += 1

    stats["pending"] = stats["claimed"] - stats["ignored"]
    if any(stats[k] for k in ("claimed", "ignored", "seeded")):
        logger.info("[mail-agent] cycle: %s", stats)
    return stats


# --- background loop (trading_watch pattern) ----------------------------------

async def watch_loop(interval_s: int | None = None) -> None:
    interval = interval_s or settings.MAIL_AGENT_POLL_INTERVAL_S
    await asyncio.sleep(5)  # let the app finish booting
    while True:
        backoff = interval
        try:
            stats = await run_once()
            _ = stats
        except asyncio.CancelledError:  # noqa: PERF201
            raise
        except GraphThrottled as th:
            backoff = max(interval, min(th.retry_after, 300))
            logger.warning("[mail-agent] Graph throttled — backing off %ss", backoff)
        except Exception:
            logger.exception("[mail-agent] cycle crashed")
        await asyncio.sleep(backoff)
