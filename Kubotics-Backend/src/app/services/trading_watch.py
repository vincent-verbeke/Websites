"""Cloud trading watcher — READ-ONLY safety checks on Vincent's LIVE Binance book.

Authorized by Vincent 2026-11-01 18:03 ("run the watcher in our cloud service …
alerts via sms … needle can inform you … I authorize you to update the
backend if fully documented in a .md").  Full documentation:
``docs/TRADING_WATCH_CLOUD.md`` in this repository.

Security contract (enforced by construction):
  * ONLY signed **GET** endpoints are called (um/account, api/v3/account)
    plus the unsigned public premiumIndex — this module contains no order
    path, no POST/DELETE to Binance, and never logs credentials.
  * Alert fan-out: (1) row in ``inbound_events`` (channel=trading_watch)
    so needle/PC-A/dashboard can read it, (2) WhatsApp via the existing
    cloud gateway, (3) optional AWS SNS SMS (TRADING_WATCH_SMS_ENABLED).

Checks (every TRADING_WATCH_INTERVAL_S):
  1. carry hedge integrity — perp short vs spot long qty within 5%
  2. book est-24h funding sign (shorts RECEIVE positive rates) — alert below
     TRADING_WATCH funding threshold
  3. position drift vs TRADING_WATCH_EXPECTED_PERP (security)
  4. feed/key health
Alerts share one cooldown (TRADING_WATCH_ALERT_COOLDOWN_S), counted from
persisted events so it survives restarts.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time
import urllib.parse
from datetime import UTC, datetime, timedelta, timezone

import httpx
from sqlalchemy import desc, select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.tasks import InboundEvent
from app.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)

FAPI = "https://fapi.binance.com"
PAPI = "https://papi.binance.com"
SPOT = "https://api.binance.com"

CARRY = {"CHRUSDT": "CHR", "DYDXUSDT": "DYDX", "PEOPLEUSDT": "PEOPLE",
         "SFPUSDT": "SFP", "UNIUSDC": "UNI"}
HEDGE_TOL = 0.05           # 5% qty mismatch = broken hedge
NEG_FUNDING_ALERT = -0.50  # book est24h funding below this (USD) -> alert
CHANNEL = "trading_watch"


def _signed_qs(params: dict | None = None) -> tuple[str, dict[str, str]]:
    """HMAC-SHA256 signed querystring + API-key headers (GET only)."""
    p = dict(params or {})
    p["timestamp"] = int(time.time() * 1000)
    p["recvWindow"] = 5000
    qs = urllib.parse.urlencode(p)
    sig = hmac.new(settings.BINANCE_API_SECRET.encode(), qs.encode(),
                   hashlib.sha256).hexdigest()
    return f"{qs}&signature={sig}", {"X-MBX-APIKEY": settings.BINANCE_API_KEY}


async def fetch_book() -> tuple[list[dict], dict[str, float], dict[str, float]]:
    """(open perp positions, spot balances, last funding rates). Read-only."""
    async with httpx.AsyncClient(timeout=12) as client:
        qs, hdr = _signed_qs()
        r = await client.get(f"{PAPI}/papi/v1/um/account?{qs}", headers=hdr)
        r.raise_for_status()
        perps = [p for p in r.json().get("positions", [])
                 if float(p.get("positionAmt") or 0) != 0]

        qs, hdr = _signed_qs()
        r = await client.get(f"{SPOT}/api/v3/account?{qs}", headers=hdr)
        r.raise_for_status()
        spot = {b["asset"]: float(b.get("free", 0)) + float(b.get("locked", 0))
                for b in r.json().get("balances", [])}

        r = await client.get(f"{FAPI}/fapi/v1/premiumIndex")   # public, unsigned
        r.raise_for_status()
        rates = {row["symbol"]: float(row.get("lastFundingRate") or 0)
                 for row in r.json()}
    return perps, spot, rates


def evaluate(perps: list[dict], spot: dict[str, float], rates: dict[str, float],
             expected: list[str] | None = None) -> list[str]:
    """Pure checks — ported 1:1 from the dev-PC watcher (sign fixed 2026-11-01:
    positive funding => shorts receive => book contribution -sign(amt)*rate*N)."""
    problems: list[str] = []
    expected = settings.TRADING_WATCH_EXPECTED_PERP.split(",") if expected is None else expected

    for sym, asset in CARRY.items():
        amt = next((float(p["positionAmt"]) for p in perps
                    if p.get("symbol") == sym), 0.0)
        sq = spot.get(asset, 0.0)
        if amt == 0:
            problems.append(f"carry {sym}: perp leg GONE (spot {asset} "
                            f"{'unhedged' if sq > 1 else 'also closed'})")
            continue
        if sq <= 0:
            problems.append(f"carry {sym}: spot leg GONE (short {abs(amt):g} unhedged)")
            continue
        mismatch = abs(abs(amt) - sq) / max(abs(amt), sq)
        if mismatch > HEDGE_TOL:
            problems.append(f"carry {sym}: hedge mismatch {mismatch:.1%} "
                            f"(perp {amt:g} vs spot {sq:g})")

    est24 = 0.0
    for p in perps:
        sym = p.get("symbol")
        amt = float(p["positionAmt"])
        mark = float(p.get("entryPrice") or 0)
        rate = rates.get(sym)
        if rate is None or not mark:
            continue
        # positive rate: longs pay shorts; our carry legs are shorts (amt<0)
        direction = -1 if amt > 0 else 1
        est24 += direction * rate * 3 * abs(amt) * mark
    if est24 < NEG_FUNDING_ALERT:
        problems.append(f"book est24h funding {est24:+.2f} USD "
                        f"(negative regime — carry legs PAYING)")

    current = {p.get("symbol") for p in perps}
    added = sorted(current - set(expected))
    removed = sorted(set(expected) - current)
    if added:
        problems.append(f"NEW perp positions vs expected: {added}")
    if removed:
        problems.append(f"CLOSED perp positions vs expected: {removed}")
    return problems


def make_event_id(problems: list[str]) -> str:
    digest = hashlib.sha1("|".join(sorted(problems)).encode()).hexdigest()[:8]
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M")
    return f"trading-alert-{stamp}-{digest}"


async def _cooldown_active(db) -> bool:
    since = datetime.now(UTC) - timedelta(
        seconds=settings.TRADING_WATCH_ALERT_COOLDOWN_S)
    q = (select(InboundEvent)
         .where(InboundEvent.channel == CHANNEL,
                InboundEvent.created_at > since)
         .order_by(desc(InboundEvent.created_at)).limit(1))
    row = (await db.execute(q)).scalars().first()
    return row is not None


async def _send_whatsapp(text: str) -> bool:
    recipient = next(
        (s.strip() for s in settings.NEEDLE_OPERATOR_SENDERS.split(",") if s.strip()),
        None)
    if not recipient:
        logger.warning("[trading-watch] no operator recipient configured")
        return False
    try:
        ok, wamid, raw = await whatsapp_service.send_text_message(recipient, text)
        logger.info("[trading-watch] whatsapp -> %s (%s)",
                    "sent" if ok else "FAILED", wamid or raw)
        return bool(ok)
    except Exception as e:  # noqa: BLE001 — alerting must never crash the loop
        logger.warning("[trading-watch] whatsapp error: %s", e)
        return False


def _send_sms(text: str) -> str:
    """Optional AWS SNS SMS. Disabled by default; failures are returned as
    strings (never raised) — WhatsApp remains the primary channel."""
    if not settings.TRADING_WATCH_SMS_ENABLED:
        return "disabled"
    try:
        import boto3  # lazy: only needed when SMS is enabled
        client = boto3.client("sns", region_name="eu-central-1")
        client.publish(Message=text[:1500],
                       PhoneNumber=settings.TRADING_WATCH_SMS_TO)
        return "sent"
    except Exception as e:  # noqa: BLE001
        return f"failed: {type(e).__name__}: {str(e)[:140]}"


async def _persist_and_notify(problems: list[str], summary: dict,
                              test: bool = False) -> dict:
    event_id = make_event_id(problems)
    payload = {"problems": problems, "summary": summary, "test": test}
    async with AsyncSessionLocal() as db:
        db.add(InboundEvent(event_id=event_id, channel=CHANNEL,
                            sender_id="binance-watcher", payload=payload,
                            status="received"))
        await db.commit()
    header = "TEST — " if test else ""
    text = (f"{header}⚠️ trading-watch (live Binance book):\n- "
            + "\n- ".join(problems)
            + f"\nlegs={summary.get('perps')} cash_usdt={summary.get('usdt')}")
    wa_ok = await _send_whatsapp(text)
    sms = _send_sms(text)
    logger.info("[trading-watch] alert persisted %s whatsapp=%s sms=%s",
                event_id, wa_ok, sms)
    return {"event_id": event_id, "whatsapp": wa_ok, "sms": sms}


async def run_once(test: bool = False) -> dict:
    if not settings.TRADING_WATCH_ENABLED and not test:
        return {"skipped": "disabled"}
    problems: list[str] = []
    summary: dict = {}
    if not settings.BINANCE_API_KEY or not settings.BINANCE_API_SECRET:
        problems.append("BINANCE keys not configured in task definition")
    else:
        try:
            perps, spot, rates = await fetch_book()
            summary = {"perps": len(perps),
                       "usdt": round(spot.get("USDT", 0.0), 2),
                       "checked_at": datetime.now(UTC).isoformat()}
            problems += evaluate(perps, spot, rates)
            # per-asset cumulated income (dashboard details, non-critical)
            try:
                inc = await fetch_income_rows(PER_ASSET_SINCE_MS)
                agg = aggregate_income(inc)
                pos = {q.get("symbol"): float(q["positionAmt"]) for q in perps}
                for a in agg["assets"]:
                    a["position"] = pos.pop(a["symbol"], None)
                for sym, amt in pos.items():   # open but no income rows yet
                    agg["assets"].append(
                        {"symbol": sym, "funding_usd": 0.0, "fees_usd": 0.0,
                         "realized_usd": 0.0, "other_usd": 0.0, "net_usd": 0.0,
                         "events": 0, "position": amt})
                agg["assets"].sort(key=lambda a: a["symbol"])
                _per_asset.clear()
                _per_asset.update(agg)
            except Exception as ie:  # noqa: BLE001 — details are best-effort
                logger.warning("[trading-watch] per-asset income failed: %s", ie)
                _per_asset.clear()
                _per_asset.update({"since": PER_ASSET_SINCE.isoformat(),
                                   "computed_at": datetime.now(UTC).isoformat(),
                                   "error": type(ie).__name__})
        except Exception as e:  # noqa: BLE001
            problems.append(f"Binance feed error: {type(e).__name__}: {str(e)[:120]}")
    if not problems and not test:
        _record(True, summary, [])
        logger.info("[trading-watch] ok — %s", summary)
        return {"ok": True, "summary": summary}
    if test:
        problems.append("channel test requested via POST /trading/watch/test")
    async with AsyncSessionLocal() as db:
        if not test and await _cooldown_active(db):
            _record(False, summary, problems)
            logger.info("[trading-watch] problems suppressed by cooldown: %s", problems)
            return {"suppressed": True, "problems": problems}
        result = await _persist_and_notify(problems, summary, test=test)
        _record(False, summary, problems)
    return {"alerted": True, "problems": problems, **result}


async def watch_loop(interval_s: int | None = None) -> None:
    interval = interval_s or settings.TRADING_WATCH_INTERVAL_S
    await asyncio.sleep(5)  # let the app finish booting
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:  # noqa: PERF201
            raise
        except Exception:
            logger.exception("[trading-watch] cycle crashed")
        await asyncio.sleep(interval)


# ---------------------------------------------------------------------------
# Dashboard (Investments tab) integration — Vincent 2026-11-01 19:22
# ---------------------------------------------------------------------------

_last_check: dict = {}  # process-local heartbeat for the UI (resets on deploy)


def _record(ok: bool, summary: dict, problems: list[str]) -> None:
    """Persist an in-memory hint of the most recent check for the dashboard."""
    _last_check.clear()
    _last_check.update(ts=datetime.now(UTC).isoformat(), ok=ok,
                       legs=summary.get("perps"), usdt=summary.get("usdt"),
                       problems=list(problems[:5]))


def shape_alerts(rows) -> list[dict]:
    """InboundEvent rows -> dashboard alert items (pure, unit-tested)."""
    out: list[dict] = []
    for r in rows[:5]:
        pl = getattr(r, "payload", None) or {}
        created = getattr(r, "created_at", None)
        out.append({
            "event_id": getattr(r, "event_id", None),
            "created_at": created.isoformat() if created else None,
            "problems": list(pl.get("problems") or []),
            "test": bool(pl.get("test")),
        })
    return out


async def dashboard_block(db) -> dict:
    """Trading-watcher slice embedded in GET /api/v1/investments so the
    Investments tab renders it below the IBKR sections with zero extra
    auth/service plumbing (same polling cadence)."""
    q = (select(InboundEvent)
         .where(InboundEvent.channel == CHANNEL)
         .order_by(desc(InboundEvent.created_at))
         .limit(5))
    rows = (await db.execute(q)).scalars().all()
    return {
        "enabled": settings.TRADING_WATCH_ENABLED,
        "sms_enabled": settings.TRADING_WATCH_SMS_ENABLED,
        "interval_s": settings.TRADING_WATCH_INTERVAL_S,
        "binance_keys_configured": bool(settings.BINANCE_API_KEY
                                        and settings.BINANCE_API_SECRET),
        "last_check": dict(_last_check) or None,
        "recent_alerts": shape_alerts(rows),
        "per_asset_since": dict(_per_asset) or None,
    }


# ---------------------------------------------------------------------------
# Per-asset cumulated income since 2026-11-01 (dashboard details, Vincent
# 2026-11-01 19:41) — aggregated once per watcher cycle, read by the block.
# ---------------------------------------------------------------------------

CET = timezone(timedelta(hours=1))            # UTC+1 (November, after DST end)
PER_ASSET_SINCE = datetime(2026, 11, 1, 0, 0, 0, tzinfo=CET)
PER_ASSET_SINCE_MS = int(PER_ASSET_SINCE.timestamp() * 1000)
_per_asset: dict = {}  # last aggregation (process-local, refreshed each cycle)


async def fetch_income_rows(since_ms: int, max_pages: int = 10) -> list[dict]:
    """Signed GET /papi/v1/um/income, paged backwards until `since_ms`."""
    rows: list[dict] = []
    end_ms: int | None = None
    async with httpx.AsyncClient(timeout=15) as client:
        for _ in range(max_pages):
            params: dict = {"startTime": since_ms, "limit": 1000}
            if end_ms is not None:
                params["endTime"] = end_ms
            qs, hdr = _signed_qs(params)
            r = await client.get(f"{PAPI}/papi/v1/um/income?{qs}", headers=hdr)
            r.raise_for_status()
            page = r.json()
            if not isinstance(page, list) or not page:
                break
            rows.extend(page)
            if len(page) < 1000:
                break
            end_ms = min(int(x.get("time") or since_ms) for x in page) - 1
            if end_ms <= since_ms:
                break
    return [x for x in rows if int(x.get("time") or 0) >= since_ms]


def aggregate_income(rows: list[dict]) -> dict:
    """Pure: income rows -> per-asset cumulated buckets (USDT)."""
    buckets: dict[str, dict] = {}
    for x in rows:
        sym = x.get("symbol") or "?"
        b = buckets.setdefault(sym, {
            "symbol": sym, "funding_usd": 0.0, "fees_usd": 0.0,
            "realized_usd": 0.0, "other_usd": 0.0, "events": 0})
        amt = float(x.get("income") or 0)
        kind = x.get("incomeType")
        if kind == "FUNDING_FEE":
            b["funding_usd"] += amt
        elif kind == "COMMISSION":
            b["fees_usd"] += amt          # signed as Binance reports (<=0)
        elif kind == "REALIZED_PNL":
            b["realized_usd"] += amt
        else:
            b["other_usd"] += amt
        b["events"] += 1
    assets = sorted(buckets.values(), key=lambda b: b["symbol"])
    totals = {"funding_usd": 0.0, "fees_usd": 0.0, "realized_usd": 0.0,
              "other_usd": 0.0, "net_usd": 0.0, "events": 0}
    for b in assets:
        b["net_usd"] = (b["funding_usd"] + b["fees_usd"]
                        + b["realized_usd"] + b["other_usd"])
        for k in ("funding_usd", "fees_usd", "realized_usd", "other_usd", "net_usd"):
            b[k] = round(b[k], 6)
            totals[k] = round(totals[k] + b[k], 6)
        totals["events"] += b["events"]
    return {
        "since": PER_ASSET_SINCE.isoformat(),
        "computed_at": datetime.now(UTC).isoformat(),
        "assets": assets,
        "totals": totals,
        "rows": len(rows),
    }
