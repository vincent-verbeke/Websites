"""IBKR daily plan runner — Phase 2a cloud port of the dev-PC planner.

Vincent 2026-11-14 ("ONLY C and ASAP … Cloud needs to run without the dev
pc"): this module moves the DAILY IBKR PLAN RUNNER out of
``ros2_reusable_stack/scripts/ibkr/daily_invest.py`` into the Kubotics
backend, behind the default-OFF flag ``IBKR_PLAN_DAILY_ENABLED``.

Spec sources (port semantics byte-for-byte; the dev batteries under
``ros2_reusable_stack/scripts/ibkr`` are their tests):

  * ``daily_invest.py`` — gate table build, plan candidates, sizing, the
    50/50 spread rule, ACTIVE/pending guards, fills reconcile BEFORE
    instructions, create_order_instruction args, state save semantics,
    WhatsApp summary wording (``IBKR review queue:`` / ``IBKR daily run:``).
  * ``ibkr_spread.py`` — ported verbatim as ``app.services.ibkr_spread``.
  * ``web/server/investments.py`` — PORTFOLIO (8 sleeves) + the Yahoo gate
    fetch (same URL/params/headers/timeout) + the FULL verdict logic
    (thresholds +0.5/-0.5/-4.0, range_pos over 30d, BUY iff increasing|
    sideways, 30d-low warning, and preservation of the analyst
    ``gate.note`` — the "stabilization gate" note — across refreshes).

What the runner does (one call of ``run_daily_plan``):

  1. reads the plan state from the cloud row
     (``device_snapshot_cache`` dataset ``ibkr_plan_state``) — absent ⇒ a
     clear error note and NOTHING else; state is never invented,
  2. fetches Yahoo series per sleeve (fail-soft per sleeve -> ``{"error"}``),
     computes verdicts + plan candidates (``compute_plan``),
  3. MCP reads through the in-process Phase-1 call path
     (``ibkr_mcp.open_session`` + ``call_tool``): get_account_orders,
     get_order_instructions, get_account_positions — the same reads daily
     does — dedupe vs pending instructions via
     ``ibkr_mcp.pending_instruction_keys``,
  4. reconciles FILLS from MCP positions FIRST (never over; a covered
     sleeve is skipped before any instruction),
  5. one ``get_price_snapshot`` read per candidate for the 50/50 spread
     rule, then creates REVIEW_AND_APPROVE instructions ONLY when
     ``dry_run=False`` (args identical to daily; ``flow_type`` defaulted to
     REVIEW_AND_APPROVE exactly like the Phase-1 ``/mcp/call`` proxy does
     for the dev-PC caller today),
  6. saves state ONLY when ``dry_run=False`` (``gate_checked`` /
     ``last_order_push`` / ``last_fill_push`` = Europe/Zurich ``%Y-%m-%d
     %H:%M`` like daily's local ``time.strftime``, ``invested_chf``
     recomputed, ``gate_stale`` joined),
  7. sends WhatsApp ONLY when ``send_whatsapp=True`` (never in dry_run),
     one message per run carrying daily's exact wording, to +41797481975.

Scheduler (``plan_loop``): Europe/Zurich, Mon–Fri, first attempt 09:05,
deadline 16:30 (a late wake inside the window still runs), same-day dedupe
via a ``device_snapshot_cache`` dataset ``ibkr_plan_marker`` row
(payload ``{"date": "YYYY-MM-DD", "ok": bool, ...}`` — chosen over a tiny
table: same mechanism as the state row, no migration, one upsert).
Failures log and stop for the day (marker written either way; no retry).

Hard rules (docs/IBKR_MCP_BACKEND.md §6/§10): default off, admin-gated
endpoints, instruction tools only (``assert_allowed_tool`` before any
create call, call_tool re-asserts — NEVER submit/cancel/modify), no token
values logged or returned, no network in tests (``_get_json`` / MCP /
WhatsApp are the seams), no secrets in responses.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import math
import time
import urllib.parse
from datetime import UTC, datetime, timedelta
from datetime import time as dtime
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.tasks import DeviceSnapshotCache
from app.services import ibkr_mcp
from app.services.ibkr_spread import limit_from
from app.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)

# --- proven constants (daily_invest.py / investments.py, ported 1:1) ---------
TZ = ZoneInfo("Europe/Zurich")  # dev PC ran in this tz — stamps/date boundaries
STATE_DATASET = "ibkr_plan_state"  # device_snapshot_cache row holding the plan state
MARKER_DATASET = "ibkr_plan_marker"  # same-day dedupe row (value = {"date": ...})
SOURCE = "backend-ibkr-plan"
WA_TO = "+41797481975"  # daily_invest WA_TO (wa_send --to)

# Scheduler window (Europe/Zurich, Mon-Fri): first attempt 09:05, deadline 16:30.
FIRST_ATTEMPT = dtime(9, 5)
DEADLINE = dtime(16, 30)
PLAN_TICK_S = 60  # loop cadence (marker dedupe makes ticks idempotent per day)

STATE_MISSING_NOTE = (
    "plan state missing: device_snapshot_cache row 'ibkr_plan_state' not found — "
    "import the dev investments_state.json first "
    "(POST /api/v1/ibkr/plan/state/import); nothing computed, no state invented"
)

# --- investments.py PORTFOLIO (the working portfolio, 10k reference) --------
CAPITAL_TEST = 10_000.0
CAPITAL_FULL = 2_000_000.0

PORTFOLIO = [
    {"key": "SWDA", "name": "Global developed equities",
     "etf": "iShares Core MSCI World (Acc)", "isin": "IE00B4L5Y983",
     "ticker": "SWDA.SW", "currency": "CHF",
     "target_pct": 28.57, "target_chf": 2857.0},
    {"key": "IWDC", "name": "Global developed equities, CHF-hedged",
     "etf": "iShares MSCI World CHF Hedged (Acc)", "isin": "IE00B8BVCK12",
     "ticker": "IWDC.SW", "currency": "CHF",
     "target_pct": 17.14, "target_chf": 1714.0},
    {"key": "EIMI", "name": "Emerging-market equities",
     "etf": "iShares Core MSCI Emerging Markets IMI (Acc)", "isin": "IE00BKM4GZ66",
     "ticker": "EIMI.SW", "currency": "CHF",
     "target_pct": 5.71, "target_chf": 571.0},
    {"key": "CHSPI", "name": "Swiss equities",
     "etf": "iShares Core SPI (CH)", "isin": "CH0237935652",
     "ticker": "CHSPI.SW", "currency": "CHF",
     "target_pct": 11.43, "target_chf": 1143.0},
    {"key": "VAGX", "name": "Global bonds, CHF-hedged",
     "etf": "Vanguard Global Aggregate Bond CHF Hedged (Acc)", "isin": "IE00BG47KF31",
     "ticker": "VAGX.SW", "currency": "CHF",
     "target_pct": 8.57, "target_chf": 857.0},
    {"key": "GOVB", "name": "Swiss government bonds 3-7y",
     "etf": "iShares Swiss Domestic Government Bond 3-7 (CH)", "isin": "CH0016999846",
     "ticker": "CSBGC7.SW", "currency": "CHF",
     "target_pct": 5.71, "target_chf": 571.0},
    {"key": "CORPB", "name": "Global corporate bonds, CHF-hedged",
     "etf": "iShares Global Corp Bond CHF Hedged (Acc)", "isin": "IE00BK0TB144",
     "ticker": "CORC.SW", "currency": "CHF",
     "target_pct": 5.71, "target_chf": 571.0},
    {"key": "SMALL", "name": "Global small-cap equities",
     "etf": "Vanguard FTSE Global Small-Cap (Acc)", "isin": "IE0007TPRF31",
     "ticker": "VGSA.DE", "currency": "EUR",   # SIX line is thin; Xetra Acc is liquid
     "target_pct": 17.14, "target_chf": 1714.0},
]

# conid -> sleeve key (verified 2026-10-20/22; SMALL intentionally absent)
# + the three sleeves added 2026-10-29 (resolved via secdef search by ISIN)
CONID_TO_KEY = {"370359661": "CORPB", "150029461": "CHSPI",
                "514454916": "VAGX", "32412936": "GOVB",
                "78999785": "SWDA", "118059437": "IWDC",
                "153454131": "EIMI"}

# sleeve -> (conid, exchange or None).  The four proven sleeves keep the
# original conid-only routing (fills 2026-10-20/22 — do not touch).  SWDA,
# IWDC and EIMI are MULTI-LISTING contracts (same conid trades on LSE /
# Euronext / SIX), so the SIX line is forced via exchange=EBS: routing to
# the wrong venue would price the order in USD-on-LSE/EUR instead of the
# SIX line and blow the CHF target sizing.
SLEEVE_CONID = {"SWDA": ("78999785", "EBS"), "IWDC": ("118059437", "EBS"),
                "EIMI": ("153454131", "EBS"), "CHSPI": ("150029461", None),
                "VAGX": ("514454916", None), "GOVB": ("32412936", None),
                "CORPB": ("370359661", None)}


# --- time helpers (tests freeze time by monkeypatching _now_zurich) ---------
def _now_zurich() -> datetime:
    return datetime.now(TZ)


def _day(now: datetime) -> str:
    return now.strftime("%Y-%m-%d")


def _stamp(now: datetime) -> str:
    """daily_invest's ``time.strftime("%Y-%m-%d %H:%M")`` on the Zurich box."""
    return now.strftime("%Y-%m-%d %H:%M")


# --- Yahoo (httpx; same URL/params/headers/timeout as investments.py) --------
# The single HTTP seam: tests monkeypatch _get_json (no network in tests).
_YA_UA_SERIES = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
_YA_UA_META = "Mozilla/5.0"


async def _get_json(url: str, *, headers: dict, timeout: float) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def yahoo_series(ticker: str) -> list:
    """3y of daily closes [(date, close), ...] (oldest first) — the
    investments._yahoo_series fetch, httpx edition (same URL, params,
    User-Agent and 20 s timeout)."""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           + urllib.parse.quote(ticker) + "?range=3y&interval=1d")
    d = await _get_json(url, headers={"User-Agent": _YA_UA_SERIES}, timeout=20)
    res = d["chart"]["result"][0]
    out = []
    for t, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if c is not None:
            # daily ran with the dev PC's local (Zurich) tz — keep the same
            # calendar-date boundaries on the UTC cloud host (parity).
            out.append((datetime.fromtimestamp(t, TZ).date(), float(c)))
    return out


_CUR_CACHE: dict = {}  # ticker -> (ts, quote currency) — daily_invest parity


def _cur_cache_clear() -> None:
    """Test seam: drop the quote_currency 24 h cache."""
    _CUR_CACHE.clear()


async def quote_currency(ticker: str) -> str | None:
    """Listing currency from Yahoo meta.  SWDA.SW and EIMI.SW are USD lines
    on SIX (fund name '... USD (Acc)'); PORTFOLIO's `currency` field is the
    CHF *target* accounting, not the trading currency — never size with it."""
    hit = _CUR_CACHE.get(ticker)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    cur = None
    try:
        url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
               + urllib.parse.quote(ticker) + "?range=1d&interval=1d")
        d = await _get_json(url, headers={"User-Agent": _YA_UA_META}, timeout=15)
        cur = d["chart"]["result"][0]["meta"].get("currency")
    except Exception:                                    # noqa: BLE001
        cur = None
    _CUR_CACHE[ticker] = (time.time(), cur)
    return cur


async def fx_to_chf(currency: str | None) -> float | None:
    """1 unit of `currency` in CHF (Yahoo FX close). None => unknown (skip)."""
    if not currency or currency == "CHF":
        return 1.0
    pair = {"USD": "USDCHF=X", "EUR": "EURCHF=X"}.get(currency.upper())
    if not pair:
        return None
    try:
        rows = await yahoo_series(pair)
        return float(rows[-1][1])
    except Exception:                                    # noqa: BLE001
        return None


# ---------------------------------------------------------------- gate ----
def gate_from_rows(rows: list) -> dict | None:
    """{trend,last7d_pct,range_pos,last} or None on data error.

    Body ported 1:1 from daily_invest.compute_gate (the Yahoo fetch lives in
    compute_gate/fetch_quote so this half stays pure for tests).
    """
    try:
        if len(rows) < 40:
            raise ValueError(f"only {len(rows)} points")
        last = rows[-1][1]
        d7 = rows[-1][0] - timedelta(days=7)
        prior = [r for r in rows if r[0] <= d7][-1][1]
        l7 = round((last - prior) / prior * 100.0, 2)
        w30 = rows[-30:]
        lo, hi = min(r[1] for r in w30), max(r[1] for r in w30)
        rp = round((last - lo) / (hi - lo) * 100) if hi > lo else 50
        if l7 >= 0.5:
            tr = "increasing"
        elif l7 >= -0.5:
            tr = "sideways"
        elif l7 >= -4.0:
            tr = "decreasing"
        else:
            tr = "decreasing strongly"
        return {"trend": tr, "last7d_pct": l7, "range_pos": rp,
                "last": round(last, 4)}
    except Exception:                                    # noqa: BLE001
        return None


def gate_verdict(gate: dict) -> str:
    return "BUY" if gate and gate["trend"] in ("increasing", "sideways") \
        else "WAIT"


async def compute_gate(ticker: str) -> dict | None:
    """daily_invest.compute_gate with the httpx fetch (None on data error)."""
    try:
        rows = await yahoo_series(ticker)
        return gate_from_rows(rows)
    except Exception:                                    # noqa: BLE001
        return None


async def fetch_quote(ticker: str) -> dict:
    """Gate dict for one sleeve, or ``{"error": ...}`` (fail-soft per sleeve,
    the investments.metrics error shape the dashboard renders)."""
    try:
        rows = await yahoo_series(ticker)
    except Exception as e:                               # noqa: BLE001
        return {"error": f"{type(e).__name__}: {e}"[:120]}
    g = gate_from_rows(rows)
    if g is None:
        return {"error": "not enough points"}
    return g


async def fetch_quotes(tickers) -> dict:
    """One gate fetch per ticker, fail-soft per sleeve (no shared failure)."""
    out: dict = {}
    for t in tickers:
        out[t] = await fetch_quote(t)
    return out


def scaled_port(capital) -> dict:
    """Weight-proportional targets (Vincent 2026-11-08: "the weighting all
    the time, same original proportions — SWDA 28.57% of the total").

    target_chf = target_pct% x capital, so ONE _meta.capital edit rescales
    every sleeve (SMALL included) to the same original weighting at any
    budget. invested_chf is never touched: open amount = new target −
    invested, so added budget flows only to sleeves with headroom (never
    over). Copies entries — PORTFOLIO (the 10k reference) is NOT mutated."""
    out = {}
    for p0 in PORTFOLIO:
        p = dict(p0)
        pct = p.get("target_pct")
        if pct is not None:
            p["target_chf"] = round(float(pct) / 100.0 * float(capital), 2)
        out[p["key"]] = p
    return out


def compute_plan(state: dict, quotes: dict) -> dict:
    """daily_invest stages 1+2 (gate table -> plan candidates), pure.

    ``quotes`` is keyed by ticker: a gate dict or ``{"error": ...}`` (a
    missing/error row is the dev "price fetch failed" path: old gate kept,
    verdict N/A, sleeve listed in ``stale`` -> ``_meta.gate_stale``).

    Returns ``{rows, entries, stale, notes}``:
      * rows   — one per sleeve in PORTFOLIO order with the dev --check
                 columns (key/status/trend/7d/30d/verdict/price — missing
                 values render "-", exactly like the dev table) plus
                 action/reason (buy/wait/skip/error + why; the 30d-low
                 warning rides in reason),
      * entries — the confirmed plan candidates (verdict BUY, not held,
                 remaining > 0.5) in daily's stage-2 order,
      * stale  — sleeves whose gate fetch failed (daily's gate_stale list),
      * notes  — daily's console annotations for this stage.

    Mutates ``state`` gates exactly like daily stage 1 does (fresh gate ->
    s["gate"] = {trend,last7d_pct,range_pos,note} with the OLD analyst note
    preserved — the "stabilization gate" note —; failed fetch leaves
    s["gate"] untouched). The caller persists only when not dry_run.
    """
    capital = float((state.get("_meta") or {}).get("capital") or CAPITAL_TEST)
    port = scaled_port(capital)
    notes: list[str] = []
    stale: list[str] = []
    prepared = []

    # --- stage 1: gate validation (fail-soft keeps old gate on error) -------
    for key, p in port.items():
        s = state.get(key, {}) or {}
        q = quotes.get(p["ticker"])
        g = dict(q) if isinstance(q, dict) else None
        if g is None or "error" in g or "trend" not in g:
            stale.append(key)
            g = dict(s.get("gate") or {})          # keep old, mark stale
            g["note"] = ((g.get("note") or "") + " [price fetch failed]").strip()
            verdict = "N/A"
            notes.append(f"{key}: price fetch failed — old gate kept (stale)")
        else:
            verdict = gate_verdict(g)
            old_note = (s.get("gate") or {}).get("note")
            g["note"] = old_note        # preserve analyst note unless empty
            s["gate"] = {k: g[k] for k in
                         ("trend", "last7d_pct", "range_pos", "note")
                         if k in g}
        prepared.append((key, s, g, verdict, p))

    # --- stage 2: plan — what would be ordered ------------------------------
    rows, entries = [], []
    for key, s, g, verdict, p in prepared:
        status = s.get("status", "not_bought")
        invested = float(s.get("invested_chf") or 0.0)
        remaining = p["target_chf"] - invested
        in_plan = True
        if status == "held" or remaining <= 0.5 or verdict != "BUY":
            in_plan = False
        warn = "; AT 30d LOW" if g.get("range_pos") is not None \
            and g.get("range_pos") <= 5 else ""
        if not in_plan:
            if status == "held":
                action, reason = "skip", "held"
            elif remaining <= 0.5:
                action, reason = (
                    "skip",
                    f"target reached (remaining CHF {remaining:.2f} <= 0.50)",
                )
            elif verdict == "N/A":
                action, reason = "error", "price fetch failed (old gate kept)"
            else:
                action, reason = "wait", f"gate WAIT (trend {g.get('trend', '-')})"
            reason = reason + warn
        else:
            action, reason = "buy", "gate BUY" + warn
            entries.append({
                "key": key,
                "ticker": p["ticker"],
                "status": status,
                "verdict": verdict,
                "trend": g.get("trend"),
                "price": g.get("last"),
                "target_chf": p["target_chf"],
                "invested_chf": round(invested, 2),
                "remaining_chf": round(remaining, 2),
            })
        rows.append({
            "key": key,
            "status": status,
            "trend": g.get("trend", "-"),
            "7d": g.get("last7d_pct", "-"),
            "30d": g.get("range_pos", "-"),
            "verdict": verdict,
            "price": g.get("last", "-"),
            "action": action,
            "reason": reason,
        })

    if entries:
        notes.append(
            f"[plan] {len(entries)} sleeve(s) to order: "
            + ", ".join(f"{e['key']} (remaining CHF {e['remaining_chf']:.2f})"
                        for e in entries))
    else:
        notes.append("[plan] nothing to order this run (fills still checked below)")
    return {"rows": rows, "entries": entries, "stale": stale, "notes": notes}


# --- state / marker rows (device_snapshot_cache) ----------------------------
async def _load_row(db, dataset: str) -> DeviceSnapshotCache | None:
    res = await db.execute(
        select(DeviceSnapshotCache).where(DeviceSnapshotCache.dataset == dataset)
    )
    return res.scalars().first()


async def load_state(db) -> dict | None:
    """The plan state from the cloud row, or None when absent/empty.

    NEVER invents state (the brief's hard rule): the runner aborts with a
    clear error note when this returns None. Deep-copied so callers cannot
    alias the session's row payload.
    """
    row = await _load_row(db, STATE_DATASET)
    if row is None or not isinstance(row.payload, dict) or not row.payload:
        return None
    return copy.deepcopy(row.payload)


async def _upsert(db, dataset: str, payload: dict) -> datetime:
    row = await _load_row(db, dataset)
    now = datetime.now(UTC)
    if row is None:
        db.add(DeviceSnapshotCache(dataset=dataset, source=SOURCE,
                                   payload=copy.deepcopy(payload),
                                   updated_at=now))
    else:
        row.source = SOURCE
        row.payload = copy.deepcopy(payload)
        row.updated_at = now
    await db.commit()
    return now


async def save_state(db, state: dict) -> datetime:
    """Upsert the full state doc (EXACTLY the dev investments_state.json
    structure: _meta + sleeve keys — dev/cloud interop during transition)."""
    return await _upsert(db, STATE_DATASET, state)


async def load_marker(db) -> dict | None:
    row = await _load_row(db, MARKER_DATASET)
    if row is None or not isinstance(row.payload, dict) or not row.payload:
        return None
    return dict(row.payload)


async def save_marker(db, marker: dict) -> datetime:
    """Same-day dedupe row: payload {"date": "YYYY-MM-DD", "ok": bool, ...}.

    A DeviceSnapshotCache row (not a tiny table): same upsert mechanism as
    the state row, zero migration, and the unique `dataset` column already
    guarantees a single marker.
    """
    return await _upsert(db, MARKER_DATASET, marker)


async def mirror_state_to_feed(db, state: dict) -> bool:
    """Carry the state doc to the dashboard's feed row (dev state_push parity).

    GET-merge-POST semantics of
    ``ros2_reusable_stack/scripts/ibkr/state_push.py``: read the
    ``ibkr_investments`` row through the Phase-1 poller's own seam
    (``ibkr_mcp._load_snapshot`` / ``ibkr_mcp.DATASET`` — same dataset, so
    the two writers stay convergent), overlay ONLY ``state`` + ``ts``
    (UTC ``%Y-%m-%dT%H:%M:%SZ``, the dev pusher's format) and keep every
    other key — cash/positions/orders/instructions/mcp/auth/source —
    untouched; the row's ``source`` column is also left as-is on update.

    Fail-soft by the state_push contract: returns False and logs — NEVER
    raises, NEVER fails the run (the primary state row is already saved).
    """
    try:
        row = await ibkr_mcp._load_snapshot(db)
        now = datetime.now(UTC)
        payload = (dict(row.payload)
                   if row is not None and isinstance(row.payload, dict) else {})
        payload["state"] = copy.deepcopy(state)
        payload["ts"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        if row is None:
            db.add(DeviceSnapshotCache(dataset=ibkr_mcp.DATASET, source=SOURCE,
                                       payload=payload, updated_at=now))
        else:
            row.payload = payload
            row.updated_at = now
        await db.commit()
        return True
    except Exception as e:  # noqa: BLE001 — mirror must never fail the run
        logger.warning("[ibkr-plan] state mirror failed (%s)", type(e).__name__)
        return False


# --- WhatsApp (daily_invest's exact wording, one message per run) -----------
def build_whatsapp_text(instr_msgs: list, fill_msgs: list, skipped: list) -> str:
    """daily's two wa_send payloads composed into ONE message (the scheduler
    rule is one WhatsApp per successful run). Wording copied verbatim —
    daily's block carries no emoji; nothing invented here."""
    parts: list[str] = []
    if instr_msgs:
        parts.append(
            "IBKR review queue: "
            + "; ".join(instr_msgs)
            + " — review & submit in IBKR (Orders → Instructions). "
              "Nothing submitted by me.")
    if fill_msgs:
        parts.append(
            "IBKR daily run: "
            + "; ".join(fill_msgs)
            + (f"; skipped: {'; '.join(skipped)}" if skipped else "")
            + ".")
    return "\n".join(parts)


# ---------------------------------------------------------------- run ------
async def _run(*, dry_run: bool, send_whatsapp: bool) -> tuple[dict, bool]:
    """One full run. Returns (result dict, ok) — ok drives the scheduler
    marker (state loaded AND the MCP read stage succeeded)."""
    now = _now_zurich()
    day, stamp = _day(now), _stamp(now)
    notes: list[str] = []
    instructions: list[dict] = []

    # --- 1) plan state from the cloud row (never invented) ------------------
    async with AsyncSessionLocal() as db:
        state = await load_state(db)
    if state is None:
        notes.append(STATE_MISSING_NOTE)
        return ({"date": day, "rows": [], "entries": [], "state_after": None,
                 "notes": notes, "instructions": [], "whatsapp": False}), False

    # --- 2) gates (Yahoo, fail-soft per sleeve) + plan candidates ------------
    capital = float((state.get("_meta") or {}).get("capital") or CAPITAL_TEST)
    port = scaled_port(capital)
    quotes = await fetch_quotes([p["ticker"] for p in port.values()])
    plan_out = compute_plan(state, quotes)
    rows, entries, stale = plan_out["rows"], plan_out["entries"], plan_out["stale"]
    notes.extend(plan_out["notes"])
    entry_idx = {e["key"]: i for i, e in enumerate(entries)}

    # --- 3) MCP reads (the same three reads daily does) ----------------------
    tok = sid = None
    orders_d = instr_d = pos_d = None
    mcp_ok = True
    try:
        tok, sid = await ibkr_mcp.open_session()
        orders_d = await ibkr_mcp.call_tool("get_account_orders", {}, tok, sid)
        instr_d = await ibkr_mcp.call_tool("get_order_instructions", {}, tok, sid)
        pos_d = await ibkr_mcp.call_tool("get_account_positions", {}, tok, sid)
    except SystemExit as e:
        mcp_ok = False
        notes.append(f"mcp refresh failed — instructions NOT created ({e})")
    except Exception as e:  # noqa: BLE001 — mcp layer down: fail-soft like daily
        mcp_ok = False
        notes.append(f"mcp unavailable ({type(e).__name__}) — instructions NOT created")

    instr_msgs: list[str] = []
    fill_msgs: list[str] = []
    skipped: list[str] = []

    if mcp_ok:
        active_conids = set()
        for o in (orders_d.get("orders") or []):
            stt = str(o.get("status") or "").lower()
            if "filled" not in stt and any(
                    a in stt for a in ("active", "submitted", "pending")):
                active_conids.add(str(o.get("contract_id") or o.get("conid") or ""))
        # Phase-1 helper: NON-terminal pending instructions (same terminal set
        # as daily's pending_conids) -> dedupe keys (conid/symbol, side).
        pending_keys = ibkr_mcp.pending_instruction_keys(
            instr_d if isinstance(instr_d, dict) else {})

        def _chf(qty: float, price: float, fx) -> float:
            return qty * price * (fx or 1.0)

        # --- 4) FILLS reconcile FIRST (account truth; never over) -----------
        # Every conid sleeve, even with an empty plan — the old gateway 2b'
        # parity from test_position_reconcile.py.
        mcp_pos = {str(r.get("contract_id")): r
                   for r in (pos_d.get("positions") or [])}
        recon = [(key, state.get(key) or {}, p)
                 for key, p in port.items() if key in SLEEVE_CONID]
        for key, s, p in recon:
            conid, _exch = SLEEVE_CONID.get(key, (None, None))
            if not conid or str(conid) not in mcp_pos or s.get("status") == "held":
                continue
            r = mcp_pos[str(conid)]
            qty = float(r.get("position") or 0)
            avg = float(r.get("average_price") or 0)
            if qty <= 0 or avg <= 0:
                continue
            cur = (await quote_currency(p.get("ticker", "")) or p.get("currency")
                   or "CHF")
            fx = await fx_to_chf(cur)
            if fx is None and cur.upper() == "CHF":
                fx = 1.0
            if fx is None:
                skipped.append(f"{key}: MCP fill seen but no fx {cur}->CHF — "
                               f"REVIEW manually")
                continue
            notional = round(qty * avg * fx, 2)
            prev = s.get("status", "not_bought")
            s["status"] = "held"
            s["invested_chf"] = notional
            s["buy"] = {"price": round(avg, 4), "date": day, "chf": notional}
            state.setdefault("_meta", {})["last_fill_push"] = stamp
            fill_msgs.append(f"{key} FILLED via MCP position {qty:g} @ {avg:g} "
                             f"= CHF {notional:.2f} -> held (was {prev}) — "
                             f"no instruction")

        # --- 5) candidates: every guard up to currency, then ONE snapshot
        #        read per candidate, then the creates -----------------------
        cand = []
        for e in entries:
            key = e["key"]
            s = state.get(key) or {}
            p = port[key]
            conid, _exch = SLEEVE_CONID.get(key, (None, None))
            # remaining recomputed AFTER reconcile (daily does the same: a
            # fill booked above closes the sleeve before any instruction).
            remaining = p["target_chf"] - float(s.get("invested_chf") or 0.0)
            if key == "SMALL":
                msg = (f"{key}: not eligible on MCP review path "
                       f"(awaiting GO/conid)")
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            if not conid:
                msg = f"{key}: no conid known — not instructed"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            if s.get("status") == "held" or remaining <= 0.5:
                msg = f"{key}: completed/reconciled this run — skip"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            if str(conid) in active_conids:
                msg = f"{key}: ACTIVE gateway order exists (MCP) — skip"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            if (str(conid), "BUY") in pending_keys:
                msg = f"{key}: instruction already pending — skip"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            price = float(e.get("price") or 0)
            if price <= 0:
                msg = f"{key}: no yahoo last — not instructed"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            cur = (await quote_currency(p.get("ticker", "")) or p.get("currency")
                   or "CHF")
            fx = await fx_to_chf(cur)
            if fx is None and cur.upper() == "CHF":
                fx = 1.0
            if fx is None:
                msg = f"{key}: no fx rate {cur}->CHF — not instructed"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            cand.append((key, s, conid, price, cur, fx, remaining))

        # live book for the 50/50 rule: last executed + the FIRST order (best
        # ask) of each candidate. Fail-soft by design: a failed read is
        # carried into the rule label and the order prices LIMIT-at-last (the
        # standing fallback) — never a blocked run (daily batch semantics:
        # one failure = no snapshot rows at all).
        snaps: dict = {}
        snap_note = ""
        for key, s, conid, price, cur, fx, remaining in cand:
            try:
                res = await ibkr_mcp.call_tool(
                    "get_price_snapshot",
                    {"contract_id": int(conid),
                     "market_data_names": ["last", "bid_ask"]}, tok, sid)
            except SystemExit as e:
                snaps, snap_note = {}, f"no snapshot ({e})"
                break
            except Exception as e:  # noqa: BLE001
                snaps, snap_note = {}, f"no snapshot ({type(e).__name__})"
                break
            snaps[str(conid)] = res

        # creates: qty floors on the LIMIT (never over the remaining target)
        creates = []
        for key, s, conid, gate_last, cur, fx, remaining in cand:
            snap = snaps.get(str(conid))
            limit, rule = limit_from(gate_last, snap,
                                     snap_note or "no snapshot row")
            if limit <= 0:
                msg = f"{key}: no live last — not instructed"
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            qty = math.floor(remaining / (limit * fx) * 100) / 100.0
            if qty <= 0:
                msg = (f"{key}: remaining CHF {remaining:.2f} = 0 units — skip")
                skipped.append(msg)
                instructions.append({"index": entry_idx[key], "status": "skipped",
                                     "detail": msg})
                continue
            creates.append((key, s, conid, qty, limit, cur, fx, rule))

        if dry_run:
            # ALWAYS dry: report the would-be create, touch NOTHING on MCP,
            # apply no order block.
            for key, s, conid, qty, limit, cur, fx, rule in creates:
                instructions.append({
                    "index": entry_idx[key], "status": "dry_run",
                    "detail": (f"would create: BUY {qty:g} @ {limit:g} {cur} "
                               f"({rule}; CHF {_chf(qty, limit, fx):.2f})")})
        elif creates:
            # assert-before-network invariant (call_tool re-asserts per call;
            # submit/cancel/modify are unreachable from here).
            ibkr_mcp.assert_allowed_tool("create_order_instruction",
                                         ibkr_mcp.REVIEW_AND_APPROVE)
            pending_create = list(creates)
            while pending_create:
                key, s, conid, qty, limit, cur, fx, rule = pending_create.pop(0)
                # daily's args byte-for-byte; the cloud call layer (like the
                # Phase-1 /mcp/call proxy the dev PC uses today) defaults
                # flow_type=REVIEW_AND_APPROVE — the only flow allowed.
                args = {"contract_id_ex": str(conid), "side": "BUY",
                        "quantity": qty, "order_type": "LIMIT",
                        "limit_price": round(limit, 4), "time_in_force": "DAY"}
                try:
                    res = await ibkr_mcp.call_tool(
                        "create_order_instruction",
                        {**args, "flow_type": ibkr_mcp.REVIEW_AND_APPROVE},
                        tok, sid)
                except SystemExit as e:
                    instructions.append({"index": entry_idx[key], "status": "error",
                                         "detail": str(e)[:200]})
                    notes.append(f"mcp refresh failed — instructions NOT created ({e})")
                    for rest in pending_create:
                        instructions.append(
                            {"index": entry_idx[rest[0]], "status": "error",
                             "detail": "not attempted (mcp refresh failed)"})
                    break
                except Exception as e:  # noqa: BLE001 — per-entry tool failure
                    instructions.append(
                        {"index": entry_idx[key], "status": "error",
                         "detail": f"{type(e).__name__}: {e}"[:200]})
                    notes.append(f"{key}: create failed ({type(e).__name__}) — "
                                 f"instructions NOT created")
                    continue
                iid = ibkr_mcp.instruction_id_of(res) or ""
                s["order"] = {"status": "instruction", "qty": qty,
                              "limit": limit, "id": iid, "filled": 0,
                              "rule": rule}
                s["status"] = "ordered"
                instr_msgs.append(
                    f"{key}: BUY instruction {qty:g} @ {limit:g} {cur} "
                    f"({rule}; CHF {_chf(qty, limit, fx):.2f}) "
                    f"id={iid or '?'}")
                entry_out: dict = {"index": entry_idx[key], "status": "created"}
                if iid:
                    entry_out["instruction_id"] = iid
                instructions.append(entry_out)

        if instr_msgs or fill_msgs:
            state.setdefault("_meta", {})["last_order_push"] = stamp
        # daily prints these as "  * <msg>" lines — the notes channel.
        notes.extend(instr_msgs + skipped + fill_msgs)

    # --- 6) WhatsApp (ONLY when requested; never in dry_run) ----------------
    whatsapp = False
    if send_whatsapp and not dry_run and (instr_msgs or fill_msgs):
        text = build_whatsapp_text(instr_msgs, fill_msgs, skipped)
        try:
            sent, _wamid, _raw = await whatsapp_service.send_text_message(
                WA_TO, text)
        except Exception as e:  # noqa: BLE001 — never fails the run
            sent = False
            notes.append(f"whatsapp send failed ({type(e).__name__})")
        if sent:
            notes.append("whatsapp sent")
            whatsapp = True
        elif not any(n.startswith("whatsapp send failed") for n in notes):
            notes.append("whatsapp send failed")

    # --- 7) save semantics (daily's persist block) ---------------------------
    # Stamps + recompute run in BOTH modes so state_after is always the state
    # a real run would persist; only the ROW WRITE is gated on dry_run.
    state.setdefault("_meta", {})["gate_checked"] = stamp
    # invested TOTAL recomputed from the sleeves every persist (daily's
    # drift fix: the dashboard reads _meta.invested_chf directly).
    state["_meta"]["invested_chf"] = round(
        sum(float(v.get("invested_chf") or 0)
            for k, v in state.items()
            if isinstance(v, dict) and k != "_meta"), 2)
    if stale:
        state["_meta"]["gate_stale"] = ",".join(stale)
    if not dry_run:
        async with AsyncSessionLocal() as db:
            await save_state(db, state)
            # dashboard carrier (dev state_push parity): the Investments tab
            # reads state/ts from the ibkr_investments feed row — mirror it
            # while the dev-PC pusher is retired. Fail-soft: never fails the run.
            if not await mirror_state_to_feed(db, state):
                notes.append("state mirror failed (ibkr_investments feed row) — "
                             "dashboard state may lag this run")
        notes.append(f"[state] updated (gate_checked {stamp})")
    else:
        notes.append("[state] dry-run — NOT saved")

    ok = mcp_ok
    # deterministic output: one record per plan entry, ordered by entry index
    instructions.sort(key=lambda d: d["index"])
    return ({"date": day, "rows": rows, "entries": entries,
             "state_after": state, "notes": notes,
             "instructions": instructions, "whatsapp": whatsapp}), ok


async def run_daily_plan(*, dry_run: bool, send_whatsapp: bool) -> dict:
    """Public runner (the endpoint + test entry point).

    Returns {date, rows, entries, state_after, notes, instructions,
    whatsapp}. dry_run=True NEVER creates/saves/sends. Never raises on
    expected failures — they land in ``notes`` (fail-soft house rule).
    """
    result, _ok = await _run(dry_run=dry_run, send_whatsapp=send_whatsapp)
    return result


# --- scheduler (default OFF: IBKR_PLAN_DAILY_ENABLED) ----------------------
def plan_enabled() -> bool:
    return bool(settings.IBKR_PLAN_DAILY_ENABLED)


def in_run_window(now: datetime) -> bool:
    """Mon–Fri AND 09:05 <= t <= 16:30 (Europe/Zurich). A late wake inside
    the window still runs; before the first attempt or after the deadline
    the day is passed over."""
    if now.weekday() >= 5:
        return False
    t = now.time().replace(tzinfo=None)
    return FIRST_ATTEMPT <= t <= DEADLINE


async def plan_tick(now: datetime | None = None) -> dict:
    """One scheduler check (tests drive this directly with frozen times).

    Same-day dedupe: the ``ibkr_plan_marker`` payload carries the date; a
    marker for today skips (success OR failure — failures log and stop for
    the day, no retry). Returns {"skipped": reason} or
    {"ran": True, "date", "ok", "result"}.
    """
    now = now if now is not None else _now_zurich()
    day = _day(now)
    if now.weekday() >= 5:
        return {"skipped": "weekend", "date": day}
    if now.time().replace(tzinfo=None) < FIRST_ATTEMPT:
        return {"skipped": "before_first_attempt", "date": day}
    if now.time().replace(tzinfo=None) > DEADLINE:
        return {"skipped": "after_deadline", "date": day}
    async with AsyncSessionLocal() as db:
        marker = await load_marker(db)
    if isinstance(marker, dict) and marker.get("date") == day:
        return {"skipped": "already_ran", "date": day, "ok": marker.get("ok")}

    error = None
    try:
        result, ok = await _run(dry_run=False, send_whatsapp=True)
    except Exception as e:
        result, ok = None, False
        error = f"{type(e).__name__}: {e}"[:200]
        logger.exception("[ibkr-plan] daily run crashed")
    marker_payload: dict = {"date": day, "ok": bool(ok),
                            "ran_at": _stamp(now)}
    if error:
        marker_payload["error"] = error
    async with AsyncSessionLocal() as db:
        await save_marker(db, marker_payload)
    if not ok:
        logger.error("[ibkr-plan] daily run failed on %s — stopping for the day "
                     "(no retry): %s", day, error or "; ".join(
                         n for n in (result or {}).get("notes", [])
                         if "NOT created" in n or "missing" in n) or "see notes")
    return {"ran": True, "date": day, "ok": bool(ok), "result": result}


async def plan_loop(interval_s: int | None = None) -> None:
    """Background loop — same shape as trading_watch.watch_loop() /
    ibkr_mcp.poll_loop(): boot grace, tick, one bad cycle never kills it."""
    interval = interval_s or PLAN_TICK_S
    await asyncio.sleep(5)  # let the app finish booting
    while True:
        try:
            await plan_tick()
        except asyncio.CancelledError:  # noqa: PERF201
            raise
        except Exception:
            logger.exception("[ibkr-plan] plan tick crashed")
        await asyncio.sleep(interval)


def maybe_start_plan_loop() -> asyncio.Task | None:
    """main.py lifespan hook: the plan task when the flag is on.

    Gate = IBKR_PLAN_DAILY_ENABLED only (default False) => None => NOTHING
    starts and NOTHING was ever contacted (default-off rule). A successful
    run additionally needs IBKR_MCP_ENABLED (MCP reads); with the feed off
    the run fails soft, logs once and stops for the day.
    """
    if not plan_enabled():
        return None
    return asyncio.create_task(plan_loop())
