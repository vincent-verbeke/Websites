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
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.mail_agent import MailMessage, MailWatchSender
from app.models.tasks import DeviceSnapshotCache
from app.services import mail_llm
from app.services.m365_service import m365_service
from app.services.whatsapp_service import whatsapp_service

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

    QA note (2026-11-08): ``X-Auto-Response-Suppress`` is deliberately NOT
    filtered — it only says which auto-responses THIS message suppresses
    ("DR, RN, NRN" is normal on human Exchange mail) and says nothing about
    the sender being a machine; filtering on it would eat corporate mail.
    """
    auto = headers.get("auto-submitted")
    if auto is not None and (auto or "").strip().lower() != "no":
        return "auto_submitted"
    if "list-unsubscribe" in headers or "list-id" in headers:
        return "mailing_list"
    precedence = (headers.get("precedence") or "").strip().lower()
    if precedence in {"bulk", "junk", "list", "auto_reply"}:
        return f"precedence_{precedence}"
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
_LAST_CYCLE: dict = {}


def last_cycle() -> dict:
    """Most recent run_once stats (process-local heartbeat for GET /mail/status)."""
    return dict(_LAST_CYCLE)


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
        _LAST_CYCLE.clear()
        _LAST_CYCLE.update(ts=datetime.now(UTC).isoformat(), **stats)
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

    # step 3 pipeline: detail -> header filters -> route -> classify -> decide -> compose
    for key, val in (await process_pending()).items():
        stats[f"proc_{key}"] = val
    # step 4: send ready replies + flush windowed WhatsApp alerts
    for key, val in (await send_ready()).items():
        stats[f"snd_{key}"] = val

    stats["pending"] = stats["claimed"] - stats["ignored"]
    _LAST_CYCLE.clear()
    _LAST_CYCLE.update(ts=datetime.now(UTC).isoformat(), **stats)
    if any(stats.values()):
        logger.info("[mail-agent] cycle: %s", stats)
    return stats


# --- routing (plan §3.2) -------------------------------------------------------

def parse_tier_map(csv: str) -> dict[str, str]:
    """MAIL_AGENT_TIER_MAP: "Board=board;VIP=vip_customer" (case-insensitive)."""
    out: dict[str, str] = {}
    for pair in (csv or "").split(";"):
        if "=" not in pair:
            continue
        key, val = pair.split("=", 1)
        key, val = key.strip().lower(), val.strip().lower()
        if key and val:
            out[key] = val
    return out


def parse_only_senders(csv: str) -> set[str]:
    return {e.strip().lower() for e in (csv or "").split(",") if "@" in e}


def tier_for_categories(categories: list[str] | None, tier_map: dict[str, str]) -> str:
    """First matching Outlook category -> tier; none/no categories -> contact (§4.1)."""
    for cat in categories or []:
        mapped = tier_map.get(str(cat).strip().lower())
        if mapped:
            return mapped
    return "contact"


async def thread_within_window(client: httpx.AsyncClient, conversation_id: str,
                               window_days: int) -> bool:
    """R1/R5: did I send in this thread within the last N days? (§3.2, Q1)

    Fail-closed on Graph errors (returns False) — the contact/override/unknown
    routes still apply; ``GraphThrottled`` propagates so the cycle backs off.
    """
    if not conversation_id:
        return False
    tok = m365_service.get_access_token()
    cutoff = (datetime.now(UTC) - timedelta(days=window_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    resp = await client.get(
        f"https://graph.microsoft.com/v1.0{_upn_path()}/mailFolders/sentItems/messages",
        params={"$top": "1", "$select": "id",
                "$filter": f"conversationId eq '{conversation_id.replace(chr(39), chr(39) * 2)}' "
                           f"and sentDateTime ge {cutoff}"},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=20.0,
    )
    if resp.status_code == 429:
        raise GraphThrottled(int(resp.headers.get("Retry-After") or "60"))
    if resp.status_code != 200:
        logger.warning("[mail-agent] thread check HTTP %s", resp.status_code)
        return False
    return bool(resp.json().get("value"))


async def fetch_contacts(client: httpx.AsyncClient) -> list[dict]:
    """Outlook People (Contacts.Read, granted 09:49) — 15 cards, cheap per cycle."""
    tok = m365_service.get_access_token()
    resp = await client.get(
        f"https://graph.microsoft.com/v1.0{_upn_path()}/contacts",
        params={"$top": "50", "$select":
                "displayName,emailAddresses,categories,personalNotes,jobTitle,companyName"},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=20.0,
    )
    if resp.status_code == 429:
        raise GraphThrottled(int(resp.headers.get("Retry-After") or "60"))
    if resp.status_code != 200:
        logger.warning("[mail-agent] contacts fetch HTTP %s — routing degraded", resp.status_code)
        return []
    return resp.json().get("value", [])


def find_contact(sender: str, contacts: list[dict]) -> dict | None:
    """Match ANY address of a card (Q1/Liz has 2) — plan §3.2."""
    s = (sender or "").strip().lower()
    if not s:
        return None
    for card in contacts:
        for addr in card.get("emailAddresses") or []:
            if (addr.get("address") or "").strip().lower() == s:
                return card
    return None


async def fetch_message_detail(client: httpx.AsyncClient,
                               internet_message_id: str) -> dict | None:
    """Per-candidate body+headers+recipients (metadata scan never carries them)."""
    tok = m365_service.get_access_token()
    mid = internet_message_id.replace("'", "''")
    resp = await client.get(
        f"https://graph.microsoft.com/v1.0{_upn_path()}/mailFolders/inbox/messages",
        params={"$top": "1", "$filter": f"internetMessageId eq '{mid}'",
                "$select": "body,internetMessageHeaders,toRecipients,ccRecipients"},
        headers={"Authorization": f"Bearer {tok}"},
        timeout=25.0,
    )
    if resp.status_code == 429:
        raise GraphThrottled(int(resp.headers.get("Retry-After") or "60"))
    if resp.status_code != 200:
        raise RuntimeError(f"detail fetch HTTP {resp.status_code}")
    values = resp.json().get("value", [])
    return values[0] if values else None


def headers_to_dict(raw_headers: list[dict] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in raw_headers or []:
        name = (h.get("name") or "").strip().lower()
        if name:
            out[name] = str(h.get("value") or "")
    return out


async def load_overrides() -> dict[str, dict]:
    """mail_watch_senders override list (active) keyed by lowercase email."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(MailWatchSender).where(MailWatchSender.active.is_(True))
        )).scalars().all()
    return {r.email.lower(): {"tier": r.tier, "note": r.note,
                              "display_name": r.display_name} for r in rows}


# --- decision matrix (plan §4.2, answers Q2/Q5/Q6/Q7) --------------------------

def decide(*, category: str, criticality: str, tier: str,
           spam_probability: float, personal_email: bool, route: str,
           unknown_policy: str, spam_threshold: float) -> dict:
    """Pure matrix: classification x sender tier -> action (unit-tested).

    Returns {action: reply|ignore|notify_only, state, priority, notify, kind, reason}.
    """
    boardish = tier in ("board", "vip_customer")
    if category == "commercial_spam" or spam_probability >= spam_threshold:
        return {"action": "ignore", "state": "ignored_spam", "priority": "P5",
                "notify": False, "kind": None, "reason": "spam"}
    # Q2 gate applies ONLY to unknown senders WITHOUT a thread (thread = eligible)
    if tier == "unknown" and route != "thread_reply":
        if unknown_policy == "ignore":
            return {"action": "ignore", "state": "ignored_unknown", "priority": "P5",
                    "notify": False, "kind": None, "reason": "unknown_policy"}
        if unknown_policy == "notify":
            return {"action": "notify_only", "state": "notify_only", "priority": "P3",
                    "notify": True, "kind": None, "reason": "unknown_digest"}
        if not personal_email:
            return {"action": "ignore", "state": "ignored_spam", "priority": "P5",
                    "notify": False, "kind": None, "reason": "not_personal"}
    # Q7: critical/complaint -> ack-only care rule
    if category == "critical":
        return {"action": "reply", "state": "classified", "priority": "P1",
                "notify": True, "kind": "ack_only", "reason": "critical"}
    if category == "complaint":
        return {"action": "reply", "state": "classified",
                "priority": "P1" if boardish else "P2",
                "notify": True, "kind": "ack_only", "reason": "complaint"}
    if category == "request" or criticality == "high":
        return {"action": "reply", "state": "classified",
                "priority": "P2" if boardish else "P3",
                "notify": boardish, "kind": "holding", "reason": "request"}
    if category == "followup":
        return {"action": "reply", "state": "classified", "priority": "P3",
                "notify": False, "kind": "holding", "reason": "followup"}
    return {"action": "reply", "state": "classified", "priority": "P4",
            "notify": False, "kind": "thank_you", "reason": "informational"}


# --- pending pipeline (step 3 orchestration) -----------------------------------

async def _defer_row(row, stats, prefix: str, detail: str) -> None:
    """Transient failure: keep ``received`` for retry, give up after 5 tries.

    Mirrors the LLM-attempts pattern so an outage window cannot quarantine
    fresh mail into a terminal state.
    """
    key = f"{prefix}_attempts"
    attempts = int((row.classification or {}).get(key, 0)) + 1
    row.classification = {**(row.classification or {}), key: attempts}
    row.error = f"{prefix}:{detail}"[:500]
    if attempts >= 5:
        row.state = "needs_review"
        stats["review"] += 1
    else:
        stats["deferred"] += 1


async def _requeue_parked_llm_failures(db, stats) -> int:
    """Outage self-heal: requeue ``needs_review`` rows parked by failures that
    are the INFRASTRUCTURE's fault (LLM provider unreachable/invalid key,
    transient detail-fetch errors) so they recover the moment the GitHub
    secret is fixed — every >=15 minutes. Reply/validation failures stay
    terminal (plan §5: a bad compose must not silently loop)."""
    edge = datetime.now(UTC) - timedelta(minutes=15)
    rows = (await db.execute(
        select(MailMessage).where(
            MailMessage.state == "needs_review",
            MailMessage.updated_at <= edge,
            or_(
                MailMessage.error.like("classify:LLMUnavailable%"),
                and_(MailMessage.error.like("detail_fetch:%"),
                     MailMessage.error.not_like("%HTTP 4%"),
                     MailMessage.error.not_like("%message_not_found%")),
            ),
        )
    )).scalars().all()
    for row in rows:
        row.state = "received"
        row.error = None
        cls = dict(row.classification or {})
        cls["llm_attempts"] = 0
        cls.pop("detail_attempts", None)
        row.classification = cls
        stats["requeued"] += 1
    return len(rows)


async def process_pending(limit: int = 50) -> dict:
    """Take ``received`` rows through detail -> filters -> route -> classify ->
    decide -> compose. Send + WhatsApp happen in step 4 (rows end in
    ``classified`` / ``notify_only`` / ``ignored_*`` / ``needs_review``)."""
    stats = {"taken": 0, "ready": 0, "ignored": 0, "restricted": 0,
             "review": 0, "deferred": 0, "notify_only": 0, "requeued": 0}
    async with AsyncSessionLocal() as db:
        await _requeue_parked_llm_failures(db, stats)   # self-heal first
        await db.commit()
        rows = (await db.execute(
            select(MailMessage)
            .where(MailMessage.state == "received")
            .order_by(MailMessage.received_at.asc())
            .limit(limit)
        )).scalars().all()
        if not rows:
            return stats
        stats["taken"] = len(rows)
        only = parse_only_senders(settings.MAIL_AGENT_ONLY_SENDERS)
        tier_map = parse_tier_map(settings.MAIL_AGENT_TIER_MAP)
        overrides = await load_overrides()
        async with httpx.AsyncClient() as client:
            contacts = await fetch_contacts(client)
            for row in rows:
                await _process_row(client, db, row, only, tier_map, overrides,
                                   contacts, stats)
                await db.commit()   # per-row: a later throttle keeps earlier work
        await db.commit()
    return stats


async def _process_row(client, db, row, only, tier_map, overrides, contacts,
                       stats) -> None:
    sender = (row.sender or "").lower()
    # Phase B restriction BEFORE any network/LLM (§8)
    if only and sender not in only:
        row.state = "ignored_unknown"
        row.summary = "restricted:phase_b_only_senders"
        stats["restricted"] += 1
        return
    try:
        detail = await fetch_message_detail(client, row.internet_message_id)
    except GraphThrottled:
        raise
    except httpx.HTTPError as exc:
        # transient network/timeout — retry next cycle, cap at 5 -> needs_review
        await _defer_row(row, stats, "detail_fetch", f"{type(exc).__name__}: {exc}")
        return
    except Exception as exc:  # noqa: BLE001 — non-200 from Graph
        msg = f"{type(exc).__name__}: {exc}"
        if "HTTP 5" in str(exc):   # 5xx = transient server-side
            await _defer_row(row, stats, "detail_fetch", msg)
        else:
            row.state = "needs_review"    # 4xx / gone -> terminal, visible
            row.error = f"detail_fetch:{msg}"[:500]
            stats["review"] += 1
        return
    if detail is None:
        row.state = "needs_review"
        row.error = "detail_fetch:message_not_found (deleted/moved)"
        stats["review"] += 1
        return

    hreason = header_hard_filter(headers_to_dict(detail.get("internetMessageHeaders")))
    if hreason:
        row.state = "ignored_spam"
        row.summary = f"hard_filter:{hreason}"
        stats["ignored"] += 1
        return

    body_html = (detail.get("body") or {}).get("content") or ""
    body_text = re.sub(r"<[^>]+>", " ", body_html) if "<" in body_html else body_html
    rcpt_count = len(detail.get("toRecipients") or []) + len(detail.get("ccRecipients") or [])

    # --- routing (§3.2): thread -> contact card -> override -> unknown
    card = find_contact(sender, contacts)
    override = overrides.get(sender)
    route = "unknown"
    if row.conversation_id and await thread_within_window(
            client, row.conversation_id, settings.MAIL_AGENT_REPLY_WINDOW_DAYS):
        route = "thread_reply"
    elif card or override:
        route = "contact"
    if card:
        tier = tier_for_categories(card.get("categories"), tier_map)
        note = (card.get("personalNotes") or "").strip() or None
        sender_name = card.get("displayName") or sender.split("@")[0]
        cats = [str(c) for c in (card.get("categories") or [])]
    elif override:
        tier = override.get("tier") or "contact"
        note = override.get("note")
        sender_name = override.get("display_name") or sender.split("@")[0]
        cats = []
    else:
        tier, note, sender_name, cats = "unknown", None, sender.split("@")[0], []
    row.route, row.tier = route, tier

    # --- classify (call #1)
    cls: dict
    provider = model = None
    try:
        cls, provider, model = await mail_llm.classify_message(
            sender=sender, subject=row.subject or "", body=body_text,
            route=route, tier=tier)
    except (mail_llm.LLMUnavailable, ValueError) as exc:
        attempts = int((row.classification or {}).get("llm_attempts", 0)) + 1
        row.classification = {**(row.classification or {}), "llm_attempts": attempts}
        row.error = f"classify:{type(exc).__name__}: {exc}"[:500]
        if attempts >= 5:
            row.state = "needs_review"   # stop retrying a persistently failing chain
            stats["review"] += 1
        else:
            stats["deferred"] += 1        # keep received -> retried next cycle
        return
    except GraphThrottled:
        raise

    row.language, row.category, row.criticality = (
        cls["language"], cls["category"], cls["criticality"])
    row.spam_probability, row.summary = cls["spam_probability"], cls["summary"]

    action = decide(
        category=cls["category"], criticality=cls["criticality"], tier=tier,
        spam_probability=cls["spam_probability"],
        personal_email=cls["personal_email"], route=route,
        unknown_policy=settings.MAIL_AGENT_UNKNOWN_POLICY,
        spam_threshold=settings.MAIL_AGENT_SPAM_THRESHOLD)
    row.priority = action["priority"]
    row.classification = {
        **cls, "route": route, "tier": tier, "priority": action["priority"],
        "notify": action["notify"], "kind": action["kind"],
        "reason": action["reason"], "provider": provider, "model": model,
        "rcpt_count": rcpt_count,   # Q14: replyAll <= 3, else sender-only
        "llm_attempts": int((row.classification or {}).get("llm_attempts", 0)),
    }
    row.llm_provider, row.llm_model = provider, model

    if action["action"] != "reply":
        row.state = action["state"]
        if action["action"] == "notify_only":
            stats["notify_only"] += 1
        else:
            stats["ignored"] += 1
        return

    if settings.MAIL_AGENT_MODE != "auto":
        row.state = "classified"          # observe: classify only, no compose (§3.3)
        stats["ready"] += 1
        return

    try:
        reply_html, cprovider, cmodel = await mail_llm.compose_reply(
            lang=cls["language"], kind=action["kind"], sender_name=sender_name,
            subject=row.subject or "", tier=tier, contact_note=note,
            categories=cats, classification=cls)
    except mail_llm.ReplyInvalid as exc:
        row.state = "needs_review"        # plan §5: validation failure -> no send
        row.error = f"compose_validation:{exc}"[:500]
        stats["review"] += 1
        return
    except mail_llm.LLMUnavailable as exc:
        row.state = "needs_review"
        row.error = f"compose:{exc}"[:500]
        stats["review"] += 1
        return
    except GraphThrottled:
        raise
    row.reply_text = reply_html
    row.classification = {**(row.classification or {}),
                          "compose_provider": cprovider, "compose_model": cmodel}
    row.state = "classified"             # step 4 sends (marker semantics)
    stats["ready"] += 1


# --- step 4: send path + WhatsApp notifications (plan §3.4/§4.2, Q6/Q11) ------

CAP_NOTICE_DATASET = "kubot_cap_notice"


def _hhmm(value: str) -> tuple[int, int]:
    hour, _, minute = (value or "0:0").partition(":")
    return int(hour or 0), int(minute or 0)


def in_alert_window(now: datetime, start: str, end: str, tz_name: str) -> bool:
    """Q11: WhatsApp alerts only 07:30-22:00 Europe/Zurich (replies unaffected)."""
    local = now.astimezone(ZoneInfo(tz_name))
    sh, sm = _hhmm(start)
    eh, em = _hhmm(end)
    minutes = local.hour * 60 + local.minute
    return sh * 60 + sm <= minutes <= eh * 60 + em


def reply_all_required(rcpt_count: int | None) -> bool:
    """Q14: replyAll by default; more than 3 To+CC recipients -> sender only.
    Missing count (legacy rows) -> sender-only (minimal exposure)."""
    if rcpt_count is None:
        return False
    return rcpt_count <= 3


def sent_same_day(ts: datetime) -> bool:
    now = datetime.now(UTC)
    return ts.astimezone(UTC).date() == now.date()


def alert_text(priority: str, tier: str, category: str, sender: str,
               summary: str, web_link: str | None, digest: bool = False) -> str:
    head = "Kubot mail digest" if digest else f"Kubot mail alert {priority}"
    line = f"{head}: [{tier}/{category}] {sender} — {(summary or '').strip()[:180]}"
    if web_link:
        line += f"\n{web_link}"
    return line[:3800]   # Meta limit 4096, keep headroom (whatsapp_service splits anyway)


async def _cap_notice_latched(today: str) -> bool:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(DeviceSnapshotCache).where(
                DeviceSnapshotCache.dataset == CAP_NOTICE_DATASET)
        )).scalar_one_or_none()
        return bool(row and isinstance(row.payload, dict)
                    and row.payload.get("date") == today)


async def _latch_cap_notice(today: str) -> None:
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(DeviceSnapshotCache).where(
                DeviceSnapshotCache.dataset == CAP_NOTICE_DATASET)
        )).scalar_one_or_none()
        if row:
            row.payload = {"date": today}
        else:
            db.add(DeviceSnapshotCache(dataset=CAP_NOTICE_DATASET,
                                       payload={"date": today}))
        await db.commit()


def _cap_reached(sent_today: int) -> bool:
    """Q6: cap = MAIL_AGENT_MAX_REPLIES_PER_DAY (per calendar day)."""
    return sent_today >= settings.MAIL_AGENT_MAX_REPLIES_PER_DAY


async def resolve_graph_id(internet_message_id: str) -> str | None:
    """PC-A cmd_approve: internetMessageId -> Graph id at send time."""
    async with httpx.AsyncClient() as client:
        tok = m365_service.get_access_token()
        mid = internet_message_id.replace("'", "''")
        resp = await client.get(
            f"https://graph.microsoft.com/v1.0{_upn_path()}/mailFolders/inbox/messages",
            params={"$top": "1", "$filter": f"internetMessageId eq '{mid}'",
                    "$select": "id"},
            headers={"Authorization": f"Bearer {tok}"},
            timeout=20.0)
        if resp.status_code == 429:
            raise GraphThrottled(int(resp.headers.get("Retry-After") or "60"))
        if resp.status_code != 200:
            return None
        values = resp.json().get("value", [])
        return values[0]["id"] if values else None


async def send_ready(limit: int = 20) -> dict:
    """Step 4: ``classified`` -> Graph reply (marker semantics) + WhatsApp flush.

    Safety re-checked at send time (§3.4): Phase-B gate, daily cap (Q6 ->
    needs_review + one latched WhatsApp notice/day), 24h conversation cooldown,
    Q14 replyAll<=3. WhatsApp delivery honours the Q11 07:30-22:00 window —
    pending alerts (``whatsapp_notified_at IS NULL``) queue implicitly and
    flush when the window opens.
    """
    stats = {"sent": 0, "cap_blocked": 0, "cooldown_skip": 0, "failed": 0,
             "alerts_sent": 0, "alerts_pending": 0, "cap_notice": 0,
             "observe_skip": 0}
    now = datetime.now(UTC)
    only = parse_only_senders(settings.MAIL_AGENT_ONLY_SENDERS)
    in_window = in_alert_window(
        now, settings.MAIL_AGENT_ALERT_WINDOW_START,
        settings.MAIL_AGENT_ALERT_WINDOW_END, settings.MAIL_AGENT_ALERT_TZ)

    async with AsyncSessionLocal() as db:
        # --- daily cap (Q6) ---
        sent_today = (await db.execute(
            select(MailMessage).where(MailMessage.sent_at.is_not(None))
        )).scalars().all()
        sent_today = [r for r in sent_today if r.sent_at and sent_same_day(r.sent_at)]
        ready = (await db.execute(
            select(MailMessage).where(MailMessage.state == "classified")
            .order_by(MailMessage.received_at.asc()).limit(limit)
        )).scalars().all()
        if ready and _cap_reached(len(sent_today)):
            for row in ready:
                row.state = "needs_review"
                row.summary = f"cap_reached:limit_{settings.MAIL_AGENT_MAX_REPLIES_PER_DAY}"
                await db.commit()
                stats["cap_blocked"] += 1
            today = now.astimezone(ZoneInfo(settings.MAIL_AGENT_ALERT_TZ)).date().isoformat()
            if in_window and not await _cap_notice_latched(today):
                ok, _, _ = await whatsapp_service.send_text_message(
                    settings.MAIL_AGENT_NOTIFY_PHONE,
                    f"Kubot: daily reply cap reached "
                    f"({settings.MAIL_AGENT_MAX_REPLIES_PER_DAY}) — "
                    f"{stats['cap_blocked']} message(s) waiting in needs_review "
                    "for your own answer.")
                if ok:
                    await _latch_cap_notice(today)
                    stats["cap_notice"] = 1
            ready = []

        for row in ready:
            # observe-mode rows were classified WITHOUT compose (§3.3) — they
            # must never reach the send path (empty-comment send guard)
            if not (row.reply_text or "").strip():
                stats["observe_skip"] += 1
                continue
            # Phase-B gate re-checked at send time (defensive)
            if only and (row.sender or "").lower() not in only:
                row.state = "ignored_unknown"
                row.summary = "restricted:phase_b_only_senders"
                await db.commit()
                continue
            # 24h conversation cooldown (plan §3.4)
            if row.conversation_id:
                cooldown_edge = now - timedelta(
                    hours=settings.MAIL_AGENT_CONVERSATION_COOLDOWN_H)
                prior = (await db.execute(
                    select(MailMessage).where(
                        MailMessage.conversation_id == row.conversation_id,
                        MailMessage.sent_at.is_not(None),
                        MailMessage.sent_at >= cooldown_edge,
                        MailMessage.id != row.id,
                    ).limit(1)
                )).scalar_one_or_none()
                if prior:
                    stats["cooldown_skip"] += 1   # stays classified -> retried
                    continue
            # --- PC-A marker semantics: persist BEFORE the POST ---
            graph_id = await resolve_graph_id(row.internet_message_id)
            if not graph_id:
                row.state = "send_failed"
                row.error = "resolve:graph_id_not_found (message gone)"
                await db.commit()
                stats["failed"] += 1
                continue
            row.graph_message_id = graph_id
            row.send_attempted_at = now
            await db.commit()   # marker durable BEFORE the network call
            rcpt = (row.classification or {}).get("rcpt_count")
            endpoint = "replyAll" if reply_all_required(rcpt) else "reply"
            try:
                async with httpx.AsyncClient() as client:
                    tok = m365_service.get_access_token()
                    resp = await client.post(
                        f"https://graph.microsoft.com/v1.0{_upn_path()}/messages/"
                        f"{graph_id}/{endpoint}",
                        headers={"Authorization": f"Bearer {tok}",
                                 "Content-Type": "application/json"},
                        json={"comment": row.reply_text or ""},
                        timeout=30.0)
            except Exception as exc:  # noqa: BLE001 — unconfirmed: never retry
                row.state = "send_failed"
                row.error = (f"post_unconfirmed:{type(exc).__name__}: {exc} "
                             f"— reply MAY have been sent, check Sent folder")[:500]
                await db.commit()
                stats["failed"] += 1
                continue
            if resp.status_code in (200, 202):
                row.state = "replied"
                row.sent_at = datetime.now(UTC)
                row.error = None
            else:
                row.state = "send_failed"
                row.error = f"reply HTTP {resp.status_code}: {resp.text[:200]}"
                stats["failed"] += 1
            await db.commit()
            if row.state == "replied":
                stats["sent"] += 1

        # --- Q6 cap notice, DECOUPLED from the cap branch: an after-hours cap
        # must still notify when the window opens (one latched notice/day)
        capped = (await db.execute(
            select(func.count(MailMessage.id)).where(
                MailMessage.state == "needs_review",
                MailMessage.summary.like("cap_reached:%"))
        )).scalar_one()
        if capped and in_window:
            today = now.astimezone(ZoneInfo(settings.MAIL_AGENT_ALERT_TZ)).date().isoformat()
            if not await _cap_notice_latched(today):
                ok, _, _ = await whatsapp_service.send_text_message(
                    settings.MAIL_AGENT_NOTIFY_PHONE,
                    f"Kubot: daily reply cap reached "
                    f"({settings.MAIL_AGENT_MAX_REPLIES_PER_DAY}) — "
                    f"{capped} message(s) waiting in needs_review "
                    "for your own answer.")
                if ok:
                    await _latch_cap_notice(today)
                    stats["cap_notice"] = 1

        # --- WhatsApp flush (Q11 window; pending = notify flag & not yet sent) ---
        pending_alerts = (await db.execute(
            select(MailMessage).where(
                MailMessage.whatsapp_notified_at.is_(None),
                MailMessage.state.in_(["replied", "classified", "notify_only",
                                       "needs_review", "send_failed"]),
            )
        )).scalars().all()
        pending_alerts = [r for r in pending_alerts
                          if (r.classification or {}).get("notify") is True]
        stats["alerts_pending"] = len(pending_alerts)
        if in_window:
            for row in pending_alerts:
                cls = row.classification or {}
                ok, _, _ = await whatsapp_service.send_text_message(
                    settings.MAIL_AGENT_NOTIFY_PHONE,
                    alert_text(cls.get("priority") or row.priority or "?",
                               cls.get("tier") or "?", cls.get("category") or "?",
                               row.sender or "?", cls.get("summary") or row.summary or "",
                               row.web_link,
                               digest=(row.state == "notify_only")))
                if ok:
                    row.whatsapp_notified_at = datetime.now(UTC)
                    await db.commit()
                    stats["alerts_sent"] += 1
                    stats["alerts_pending"] -= 1
                else:
                    logger.warning("[mail-agent] WhatsApp alert failed for %s — retrying next cycle",
                                   row.internet_message_id[:40])
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
