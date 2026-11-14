"""Phase 2a tests — the cloud IBKR daily plan runner (no network, no real DB).

Spec = the dev-PC runner + its batteries (daily_invest.py, ibkr_spread.py,
investments.py, test_spread_rule.py, test_position_reconcile.py,
test_daily_invest_mcp_review.py). Everything network-facing is stubbed:
Yahoo (``_get_json``), MCP (``ibkr_mcp.open_session``/``call_tool`` — through
the REAL allowlist gate) and WhatsApp (``whatsapp_service``).

Run:  env -u PYTHONPATH uv run --frozen pytest tests/test_ibkr_plan.py -q
Docs: docs/IBKR_MCP_BACKEND.md §10.7
"""
from __future__ import annotations

import asyncio
import copy
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.services import ibkr_mcp as ib
from app.services import ibkr_plan as ip

from .ibkr_helpers import FakeDb, run

TZ = ZoneInfo("Europe/Zurich")
ADMIN = {"X-Needle-Token": "s3cret-ibkr-test"}
# Thursday 2026-11-12 — inside the Mon-Fri window; frozen for every run test.
FROZEN = datetime(2026, 11, 12, 9, 5, tzinfo=TZ)
FROZEN_STAMP = "2026-11-12 09:05"

START_TS = 1735689600  # 2025-01-01 00:00 UTC — daily bar anchor


# --------------------------------------------------------------------------- #
# Fixtures / fakes                                                             #
# --------------------------------------------------------------------------- #
def mk_rows(closes_tail: list[float], n: int = 400) -> list[tuple[date, float]]:
    """Daily gate rows: `n` bars ending with `closes_tail` (the value exactly
    7 calendar days before the last bar drives last7d_pct)."""
    head = [closes_tail[0]] * (n - len(closes_tail))
    closes = head + closes_tail
    start = date(2025, 1, 1)
    return [(start + timedelta(days=i), c) for i, c in enumerate(closes)]


def yahoo_chart(closes: list[float], currency: str = "CHF") -> dict:
    ts = [START_TS + i * 86400 for i in range(len(closes))]
    return {"chart": {"result": [{
        "timestamp": ts,
        "meta": {"currency": currency},
        "indicators": {"quote": [{"close": closes}]},
    }]}}


class YahooStub:
    """Fake ``_get_json``: 3y series (flat 100 by default) + 1d meta currency."""

    def __init__(self):
        self.closes: dict[str, list[float]] = {}
        self.currencies: dict[str, str] = {}
        self.fail: set[str] = set()
        self.calls: list[str] = []

    def set_series(self, symbol: str, closes: list[float]) -> None:
        self.closes[symbol] = closes

    async def get(self, url: str, *, headers: dict, timeout: float) -> dict:
        self.calls.append(url)
        symbol = url.split("/chart/", 1)[1].split("?", 1)[0]
        import urllib.parse as _up
        symbol = _up.unquote(symbol)
        if symbol in self.fail:
            raise RuntimeError("yahoo down")
        currency = self.currencies.get(symbol, "CHF")
        if "range=1d" in url:
            return {"chart": {"result": [{"meta": {"currency": currency}}]}}
        closes = self.closes.get(symbol)
        if closes is None:
            raise RuntimeError(f"no data for {symbol}")
        return yahoo_chart(closes, currency)


class McpStub:
    """Fake MCP call path — routes every tool through the REAL
    assert_allowed_tool gate (submit/cancel/modify can never slip through)."""

    def __init__(self):
        self.orders: dict = {"orders": []}
        self.instructions: dict = {"instructions": []}
        self.positions: dict = {"positions": []}
        self.snaps: dict[str, dict] = {}
        self.creates: list[dict] = []
        self.calls: list[tuple[str, dict]] = []
        self.fail_reads = False
        self.fail_create = False
        self.fail_open = False
        self.fail_snap = False

    async def open_session(self):
        if self.fail_open:
            raise SystemExit("refresh failed: 401")
        return "TOKEN", "SID"

    async def call_tool(self, name, args, tok, sid):
        args = dict(args or {})
        ib.assert_allowed_tool(name, args.get("flow_type"))  # real C3 gate
        self.calls.append((name, args))
        if name == "create_order_instruction":
            if self.fail_create:
                raise RuntimeError("create boom")
            self.creates.append(args)
            return {"id": f"INS{len(self.creates)}"}
        if self.fail_reads:
            raise RuntimeError("read boom")
        if name == "get_account_orders":
            return dict(self.orders)
        if name == "get_order_instructions":
            return dict(self.instructions)
        if name == "get_account_positions":
            return dict(self.positions)
        if name == "get_price_snapshot":
            if self.fail_snap:
                raise RuntimeError("snap boom")
            return dict(self.snaps.get(str(args.get("contract_id")), {}))
        raise AssertionError(f"unexpected tool {name!r}")

    @property
    def read_names(self) -> list[str]:
        return [n for n, _a in self.calls
                if n != "create_order_instruction"]


class WaStub:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []
        self.ok = True
        self.raise_error = False

    async def send_text_message(self, to, text):
        if self.raise_error:
            raise RuntimeError("wa down")
        self.sent.append((to, text))
        return self.ok, "WAMID-TEST", {}


@pytest.fixture()
def env(monkeypatch):
    """Fully stubbed environment: FakeDb + Yahoo + MCP + WhatsApp + frozen time."""
    ip._cur_cache_clear()
    db = FakeDb()
    monkeypatch.setattr(ip, "AsyncSessionLocal", lambda: db)
    yahoo = YahooStub()
    for p in ip.PORTFOLIO:
        yahoo.set_series(p["ticker"], [100.0] * 400)
        yahoo.currencies[p["ticker"]] = "CHF"
    yahoo.set_series("USDCHF=X", [0.82] * 400)
    yahoo.set_series("EURCHF=X", [1.06] * 400)
    monkeypatch.setattr(ip, "_get_json", yahoo.get)
    mcp = McpStub()
    monkeypatch.setattr(ib, "open_session", mcp.open_session)
    monkeypatch.setattr(ib, "call_tool", mcp.call_tool)
    wa = WaStub()
    monkeypatch.setattr(ip, "whatsapp_service", wa)
    monkeypatch.setattr(ip, "_now_zurich", lambda: FROZEN)
    return SimpleNamespace(db=db, yahoo=yahoo, mcp=mcp, wa=wa)


def base_state(**overrides) -> dict:
    """Every sleeve held at target (nothing to plan) unless overridden."""
    st: dict = {"_meta": {"capital": 10_000.0}}
    for p in ip.PORTFOLIO:
        st[p["key"]] = {"status": "held",
                        "invested_chf": float(p["target_chf"])}
    st.update(overrides)
    return st


def seed(env, state: dict) -> None:
    run(ip.save_state(env.db, state))


def ticker_of(key: str) -> str:
    return next(p["ticker"] for p in ip.PORTFOLIO if p["key"] == key)


# --------------------------------------------------------------------------- #
# Gate math (investments/daily_invest thresholds — byte parity)                #
# --------------------------------------------------------------------------- #
def test_gate_increasing_at_exact_threshold():
    g = ip.gate_from_rows(mk_rows([100.0] * 7 + [100.5]))  # +0.50% / 7d
    assert g["last7d_pct"] == 0.5 and g["trend"] == "increasing"
    assert ip.gate_verdict(g) == "BUY"


@pytest.mark.parametrize("pct, trend", [(0.49, "sideways"), (-0.5, "sideways")])
def test_gate_sideways_thresholds(pct, trend):
    prior = 100.0
    g = ip.gate_from_rows(mk_rows([prior] * 7 + [round(prior * (1 + pct / 100), 4)]))
    assert g["last7d_pct"] == pct and g["trend"] == trend


def test_gate_decreasing_at_exact_threshold():
    g = ip.gate_from_rows(mk_rows([100.0] * 7 + [96.0]))  # -4.00% / 7d
    assert g["last7d_pct"] == -4.0 and g["trend"] == "decreasing"
    assert ip.gate_verdict(g) == "WAIT"


def test_gate_decreasing_strongly_below_threshold():
    g = ip.gate_from_rows(mk_rows([100.0] * 7 + [95.99]))  # -4.01% / 7d
    assert g["last7d_pct"] == -4.01 and g["trend"] == "decreasing strongly"
    assert ip.gate_verdict(g) == "WAIT"


def test_gate_verdict_buy_iff_increasing_or_sideways():
    for tr, want in (("increasing", "BUY"), ("sideways", "BUY"),
                     ("decreasing", "WAIT"), ("decreasing strongly", "WAIT")):
        assert ip.gate_verdict({"trend": tr}) == want
    assert ip.gate_verdict({}) == "WAIT"


def test_gate_range_pos_30d_low_and_flat_window():
    # last close = 30d low -> range_pos 0 (the "<= 5" warning zone)
    g = ip.gate_from_rows(mk_rows([100.0] * 7 + [95.0]))
    assert g["range_pos"] == 0
    # flat window -> 50 (dev rule when hi == lo)
    assert ip.gate_from_rows(mk_rows([100.0] * 8))["range_pos"] == 50


def test_gate_too_few_points_is_none():
    assert ip.gate_from_rows(mk_rows([100.0] * 8, n=39)) is None


def test_fetch_quote_error_row_shape(env):
    env.yahoo.fail.add("VAGX.SW")
    q = run(ip.fetch_quote("VAGX.SW"))
    assert "error" in q and q["error"].startswith("RuntimeError:")
    assert run(ip.fetch_quote("CHSPI.SW"))["trend"] == "sideways"  # flat 100


# --------------------------------------------------------------------------- #
# compute_plan — verdicts, stale path, note preservation (FULL verdict logic)   #
# --------------------------------------------------------------------------- #
def _plan(state, quotes):
    return ip.compute_plan(state, quotes)


def test_compute_plan_actions_and_entries():
    state = base_state(
        SWDA={"status": "wait", "invested_chf": 0.0},     # flat -> BUY -> entry
        EIMI={"status": "wait", "invested_chf": 0.0},     # decreasing -> WAIT
    )
    env_quotes = {p["ticker"]: {"trend": "sideways", "last7d_pct": 0.0,
                                "range_pos": 50, "last": 100.0}
                  for p in ip.PORTFOLIO}
    env_quotes[ticker_of("EIMI")] = {"trend": "decreasing", "last7d_pct": -2.0,
                                     "range_pos": 40, "last": 98.0}
    out = _plan(state, env_quotes)
    rows = {r["key"]: r for r in out["rows"]}
    assert rows["SWDA"]["action"] == "buy" and rows["SWDA"]["verdict"] == "BUY"
    assert rows["EIMI"]["action"] == "wait"
    assert "gate WAIT (trend decreasing)" in rows["EIMI"]["reason"]
    assert rows["CHSPI"]["action"] == "skip" and rows["CHSPI"]["reason"] == "held"
    assert [e["key"] for e in out["entries"]] == ["SWDA"]
    assert out["entries"][0]["remaining_chf"] == 2857.0
    assert out["stale"] == []


def test_compute_plan_stale_fetch_keeps_old_gate_and_never_invents():
    state = base_state(
        SWDA={"status": "wait", "invested_chf": 0.0,
              "gate": {"trend": "sideways", "last7d_pct": 0.1,
                       "range_pos": 30, "note": "stabilization gate"}},
    )
    quotes = {p["ticker"]: {"error": "HTTPError: 500"}
              for p in ip.PORTFOLIO}
    out = _plan(state, quotes)
    rows = {r["key"]: r for r in out["rows"]}
    # old gate values kept, verdict N/A, marked stale — state gate untouched
    assert rows["SWDA"]["verdict"] == "N/A"
    assert rows["SWDA"]["trend"] == "sideways" and rows["SWDA"]["7d"] == 0.1
    assert rows["SWDA"]["price"] == "-", "old state gate carries no last"
    assert rows["SWDA"]["action"] == "error"
    assert "price fetch failed" in rows["SWDA"]["reason"]
    assert "SWDA" in out["stale"] and len(out["stale"]) == len(ip.PORTFOLIO)
    assert state["SWDA"]["gate"]["note"] == "stabilization gate", \
        "a failed fetch must NOT append to the persisted note"
    assert any("price fetch failed" in n for n in out["notes"])


def test_stabilization_note_preserved_and_gate_keys_parity():
    """The gate_detail.note ('stabilization gate …') survives a refresh and
    the persisted s["gate"] keeps EXACTLY the dev key set."""
    state = base_state(
        SWDA={"status": "wait", "invested_chf": 0.0,
              "gate": {"trend": "decreasing", "last7d_pct": -1.0,
                       "range_pos": 20,
                       "note": "stabilization gate: 3 closes w/o new 7d low, > 5d avg"}},
    )
    quotes = {p["ticker"]: {"trend": "sideways", "last7d_pct": 0.2,
                            "range_pos": 55, "last": 145.3}
              for p in ip.PORTFOLIO}
    out = _plan(state, quotes)
    gate = state["SWDA"]["gate"]
    assert gate["note"] == ("stabilization gate: 3 closes w/o new 7d low, "
                            "> 5d avg"), "analyst note must be preserved"
    assert set(gate) == {"trend", "last7d_pct", "range_pos", "note"}, \
        "dev persists only these four keys (no 'last')"
    assert gate["trend"] == "sideways" and gate["last7d_pct"] == 0.2
    rows = {r["key"]: r for r in out["rows"]}
    assert rows["SWDA"]["price"] == 145.3, "last rides in the row, not the state"


def test_30d_low_warning_in_reason():
    state = base_state(SWDA={"status": "wait", "invested_chf": 0.0})
    quotes = {p["ticker"]: {"trend": "decreasing", "last7d_pct": -3.0,
                            "range_pos": 0, "last": 95.0}
              for p in ip.PORTFOLIO}
    out = _plan(state, quotes)
    rows = {r["key"]: r for r in out["rows"]}
    assert rows["SWDA"]["action"] == "wait"
    assert rows["SWDA"]["reason"].endswith("; AT 30d LOW")


def test_plan_empty_state_sleeve_defaults_not_planned_when_everything_held():
    # held + remaining<=0.5 guards: a sleeve at target never enters entries
    state = base_state()
    quotes = {p["ticker"]: {"trend": "increasing", "last7d_pct": 1.0,
                            "range_pos": 60, "last": 100.0}
              for p in ip.PORTFOLIO}
    out = _plan(state, quotes)
    assert out["entries"] == []
    assert any("nothing to order" in n for n in out["notes"])


def test_target_reached_reason_for_partial_sleeve():
    state = base_state(SWDA={"status": "wait", "invested_chf": 2857.0})
    quotes = {p["ticker"]: {"trend": "sideways", "last7d_pct": 0.0,
                            "range_pos": 50, "last": 100.0}
              for p in ip.PORTFOLIO}
    out = _plan(state, quotes)
    row = next(r for r in out["rows"] if r["key"] == "SWDA")
    assert row["action"] == "skip" and "target reached" in row["reason"]


# --------------------------------------------------------------------------- #
# Spread rule identity (ibkr_spread.py ported verbatim)                        #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "gate_last, snap, want_limit, want_rule_prefix",
    [
        (100.0, {"last": {"price": 100.0}, "bid-ask": {"ask": 102.0}},
         101.0, "50/50 last 100 / ask 102"),
        (145.30, {"last": {"price": 145.30}, "bid-ask": {"ask": 145.60}},
         145.45, "50/50"),
        (179.84, {"last": {"price": 179.84}, "bid-ask": {"ask": 179.78}},
         179.78, "50/50"),  # capped AT the ask (never crosses the book)
        (91.0, {"last": {"price": 91.0}, "bid-ask": {}}, 91.0,
         "at last (no top-of-book)"),
        (100.0, {"last": {"price": 200.0}, "bid-ask": {"ask": 200.4}},
         100.0, "at last (snapshot last off-market)"),
        (100.0, {"last": {"price": None}, "bid-ask": {"ask": 100.6}},
         100.3, "50/50 last 100 / ask 100.6"),
        (100.0, None, 100.0, "at last (no snapshot"),  # runner adds the " row" note
        (100.0, {}, 100.0, "at last (no snapshot)"),
    ],
)
def test_spread_rule_identity_with_dev_cases(gate_last, snap, want_limit,
                                             want_rule_prefix):
    limit, rule = ip.limit_from(gate_last, snap)
    assert limit == want_limit, (limit, rule)
    assert rule.startswith(want_rule_prefix), rule


def test_spread_rule_no_gate_price_is_zero():
    assert ip.limit_from(0, {"last": {"price": 1.0}}) == (0.0, "no live last")


# --------------------------------------------------------------------------- #
# Full runs: create payload, sizing, guards                                    #
# --------------------------------------------------------------------------- #
def test_run_create_payload_sizing_and_state(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    assert res["date"] == "2026-11-12"
    assert len(env.mcp.creates) == 1
    args = env.mcp.creates[0]
    # daily's payload byte-for-byte + the cloud flow default (Phase-1 §10.3)
    assert args == {"contract_id_ex": "514454916", "side": "BUY",
                    "quantity": 8.57, "order_type": "LIMIT",
                    "limit_price": 100.0, "time_in_force": "DAY",
                    "flow_type": "REVIEW_AND_APPROVE"}
    # reads happened before creates: the same three reads daily does
    assert env.mcp.read_names[:3] == ["get_account_orders",
                                      "get_order_instructions",
                                      "get_account_positions"]
    assert res["instructions"] == [{"index": 0, "status": "created",
                                    "instruction_id": "INS1"}]
    after = res["state_after"]["VAGX"]
    assert after["status"] == "ordered"
    assert after["order"] == {"status": "instruction", "qty": 8.57,
                              "limit": 100.0, "id": "INS1", "filled": 0,
                              "rule": "at last (no snapshot row)"}
    assert res["whatsapp"] is False
    assert any("BUY instruction 8.57 @ 100" in n for n in res["notes"])


def test_state_persisted_with_daily_save_semantics(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 100.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    saved = env.db.snapshots[ip.STATE_DATASET].payload
    meta = saved["_meta"]
    assert meta["gate_checked"] == FROZEN_STAMP
    assert meta["last_order_push"] == FROZEN_STAMP
    sleeve_sum = round(sum(float(v.get("invested_chf") or 0)
                           for k, v in saved.items()
                           if isinstance(v, dict) and k != "_meta"), 2)
    assert meta["invested_chf"] == sleeve_sum
    assert "gate_stale" not in meta, "fresh fetches everywhere -> no stale list"
    assert res["state_after"]["_meta"]["gate_checked"] == FROZEN_STAMP


def test_gate_stale_meta_when_one_ticker_fails(env):
    env.yahoo.fail.add("CSBGC7.SW")  # GOVB's ticker
    state = base_state(SWDA={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))
    meta = env.db.snapshots[ip.STATE_DATASET].payload["_meta"]
    assert meta["gate_stale"] == "GOVB"


def test_qty_floors_on_limit_never_over_target(env):
    # gate last 100, book ask 104 -> snapshot last within 5%: 50/50 -> 102
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.snaps["514454916"] = {"last": {"price": 100.0},
                                  "bid-ask": {"ask": 104.0}}
    run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    args = env.mcp.creates[0]
    limit, qty = args["limit_price"], args["quantity"]
    assert limit == 102.0
    assert qty == 8.4  # floor(857 / 102 * 100)/100 = 8.40
    assert qty * limit <= 857.0 + 1e-9, "never over the remaining target"


def test_limit_capped_at_ask(env):
    # ask BELOW a stale last: midpoint would sit above the book -> capped
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.snaps["514454916"] = {"last": {"price": 100.0},
                                  "bid-ask": {"ask": 99.9}}
    run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))
    assert env.mcp.creates[0]["limit_price"] == 99.9


def test_usd_sleeve_sized_with_fx(env):
    """SWDA trades in USD on SIX — quote_currency/fx path (0.82 CHF/USD)."""
    env.yahoo.currencies["SWDA.SW"] = "USD"
    state = base_state(SWDA={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    args = env.mcp.creates[0]
    # target 2857 CHF / (100 * 0.82) = 34.84 units, price in USD
    assert args["quantity"] == 34.84
    assert "34.84 @ 100 USD" in "; ".join(res["notes"])


def test_small_reported_never_ordered(env):
    state = base_state(SMALL={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    assert env.mcp.creates == [], "SMALL has no conid — never instructed"
    idx = next(i for i, e in enumerate(res["entries"]) if e["key"] == "SMALL")
    assert res["instructions"][idx]["status"] == "skipped"
    assert "awaiting GO/conid" in res["instructions"][idx]["detail"]
    assert any("not eligible on MCP review path" in n for n in res["notes"])
    # SMALL stayed untouched in state
    assert res["state_after"]["SMALL"]["status"] == "wait"


def test_pending_instruction_dedupe(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.instructions = {"instructions": [
        {"id": "INS9", "status": "Open", "contract_id_ex": "514454916",
         "side": "BUY"}]}
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    assert env.mcp.creates == []
    assert res["instructions"][0]["status"] == "skipped"
    assert "already pending" in res["instructions"][0]["detail"]
    assert any("instruction already pending" in n for n in res["notes"])


def test_terminal_instruction_does_not_dedupe(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.instructions = {"instructions": [
        {"id": "INS9", "status": "Filled", "contract_id_ex": "514454916",
         "side": "BUY"}]}
    run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))
    assert len(env.mcp.creates) == 1, "terminal rows are never pending"


def test_active_order_dedupe(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.orders = {"orders": [
        {"contract_id": 514454916, "status": "Submitted", "size": 8}]}
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))
    assert env.mcp.creates == []
    assert res["instructions"][0]["status"] == "skipped"
    assert "ACTIVE" in res["instructions"][0]["detail"]


# --------------------------------------------------------------------------- #
# Reconcile FIRST (test_position_reconcile.py expectations)                    #
# --------------------------------------------------------------------------- #
def test_reconcile_books_fill_and_blocks_instruction(env):
    IWDC_QTY, IWDC_AVG = 18.46, 92.99
    env.yahoo.set_series("EIMI.SW", [100.0] * 7 + [95.0])  # WAIT like the battery
    state = base_state(
        IWDC={"status": "ordered", "invested_chf": 0.0},   # the unreconciled fill
        EIMI={"status": "wait", "invested_chf": 0.0},
        CHSPI={"status": "held", "invested_chf": 1158.71},
    )
    seed(env, state)
    env.mcp.positions = {"positions": [
        {"contract_id": 118059437, "position": IWDC_QTY,
         "average_price": IWDC_AVG, "currency": "CHF"},
        {"contract_id": 150029461, "position": 6.66,
         "average_price": 175.90, "currency": "CHF"},
    ]}
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))

    # 1) fill booked FIRST -> held
    iw = res["state_after"]["IWDC"]
    expected = round(IWDC_QTY * IWDC_AVG, 2)
    assert iw["status"] == "held" and iw["invested_chf"] == expected
    assert iw["buy"] == {"price": IWDC_AVG, "date": "2026-11-12",
                         "chf": expected}
    # 2) reconcile-first: the instruction was NOT created
    assert env.mcp.creates == [], "fill coverage must block the duplicate buy"
    idx = next(i for i, e in enumerate(res["entries"]) if e["key"] == "IWDC")
    assert res["instructions"][idx]["status"] == "skipped"
    assert "completed/reconciled" in res["instructions"][idx]["detail"]
    # 3) already-held CHSPI never re-booked; position-less EIMI untouched
    assert res["state_after"]["CHSPI"]["invested_chf"] == 1158.71
    assert res["state_after"]["EIMI"] == {"status": "wait", "invested_chf": 0.0}
    # 4) fill stamps + message parity
    assert res["state_after"]["_meta"]["last_fill_push"] == FROZEN_STAMP
    assert any("FILLED via MCP position 18.46 @ 92.99" in n
               for n in res["notes"])


def test_reconcile_runs_even_with_empty_plan(env):
    state = base_state(IWDC={"status": "ordered", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.positions = {"positions": [
        {"contract_id": 118059437, "position": 18.46,
         "average_price": 92.99, "currency": "CHF"}]}
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))
    assert res["state_after"]["IWDC"]["status"] == "held"
    assert res["state_after"]["_meta"]["last_fill_push"] == FROZEN_STAMP
    assert env.mcp.creates == []


# --------------------------------------------------------------------------- #
# Dry run — never creates / saves / sends                                      #
# --------------------------------------------------------------------------- #
def test_dry_run_creates_nothing_saves_nothing_sends_nothing(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    before = copy.deepcopy(env.db.snapshots[ip.STATE_DATASET].payload)

    res = run(ip.run_daily_plan(dry_run=True, send_whatsapp=True))

    assert env.mcp.creates == [], "dry run must never create an instruction"
    assert env.wa.sent == [], "dry run must never send WhatsApp"
    assert env.db.snapshots[ip.STATE_DATASET].payload == before, \
        "dry run must never save state"
    assert any("dry-run — NOT saved" in n for n in res["notes"])
    # ...but it still reports the would-be create
    assert res["instructions"][0]["status"] == "dry_run"
    assert "would create: BUY 8.57 @ 100 CHF" in res["instructions"][0]["detail"]
    assert res["whatsapp"] is False


def test_dry_run_still_reads_mcp_for_parity(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    run(ip.run_daily_plan(dry_run=True, send_whatsapp=False))
    assert "get_order_instructions" in env.mcp.read_names
    assert "get_account_positions" in env.mcp.read_names
    assert "get_price_snapshot" in env.mcp.read_names, \
        "the parity instrument must price like the real run"


def test_dry_run_result_shape_is_exact(env):
    seed(env, base_state())
    res = run(ip.run_daily_plan(dry_run=True, send_whatsapp=False))
    assert set(res) == {"date", "rows", "entries", "state_after", "notes",
                        "instructions", "whatsapp"}
    assert len(res["rows"]) == len(ip.PORTFOLIO)
    for row in res["rows"]:
        assert set(row) == {"key", "status", "trend", "7d", "30d", "verdict",
                            "price", "action", "reason"}


# --------------------------------------------------------------------------- #
# State load/save — missing state never invented                               #
# --------------------------------------------------------------------------- #
def test_missing_state_is_clear_error_never_invented(env, monkeypatch):
    def no_yahoo(*a, **k):
        raise AssertionError("no Yahoo fetch without state")

    monkeypatch.setattr(ip, "_get_json", no_yahoo)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=True))
    assert res["state_after"] is None
    assert res["rows"] == [] and res["entries"] == []
    assert res["instructions"] == [] and res["whatsapp"] is False
    assert any("plan state missing" in n and "ibkr_plan_state" in n
               for n in res["notes"])
    assert env.mcp.calls == [], "no MCP contact without state"
    assert ip.STATE_DATASET not in env.db.snapshots, "no state invented"


def test_state_roundtrip_is_exact_dev_shape(env):
    state = base_state()
    state["_meta"]["note"] = "seeded 2026-10-20"
    run(ip.save_state(env.db, state))
    loaded = run(ip.load_state(env.db))
    assert loaded == state
    loaded["_meta"]["capital"] = 9999.0  # caller mutation must not alias row
    assert env.db.snapshots[ip.STATE_DATASET].payload["_meta"]["capital"] == 10_000.0


def test_empty_state_row_reads_as_missing(env):
    env.db.add(_empty_state_row())
    run(env.db.commit())
    assert run(ip.load_state(env.db)) is None


def _empty_state_row():
    from app.models.tasks import DeviceSnapshotCache
    return DeviceSnapshotCache(dataset=ip.STATE_DATASET, source="test",
                               payload={}, updated_at=datetime.now(UTC))


# --------------------------------------------------------------------------- #
# WhatsApp — only when requested, exact wording, never in dry run              #
# --------------------------------------------------------------------------- #
def test_whatsapp_only_when_requested(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=False))
    assert env.wa.sent == []
    assert res["whatsapp"] is False
    # state still saved (it was a real run — only WA was off)
    assert env.db.snapshots[ip.STATE_DATASET].payload["_meta"]["gate_checked"] \
        == FROZEN_STAMP


def test_whatsapp_exact_daily_wording_single_message(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=True))

    assert len(env.wa.sent) == 1, "one WhatsApp per run"
    to, text = env.wa.sent[0]
    assert to == "+41797481975"
    assert text.startswith("IBKR review queue: ")
    assert (" — review & submit in IBKR (Orders → Instructions). "
            "Nothing submitted by me.") in text
    assert "VAGX: BUY instruction 8.57 @ 100 CHF" in text
    assert res["whatsapp"] is True
    assert "whatsapp sent" in res["notes"]


def test_whatsapp_carries_fills_and_skipped_block(env):
    env.yahoo.set_series("EIMI.SW", [100.0] * 7 + [95.0])  # WAIT
    state = base_state(
        IWDC={"status": "ordered", "invested_chf": 0.0},
        VAGX={"status": "wait", "invested_chf": 0.0},
        SMALL={"status": "wait", "invested_chf": 0.0},
    )
    seed(env, state)
    env.mcp.positions = {"positions": [
        {"contract_id": 118059437, "position": 18.46,
         "average_price": 92.99, "currency": "CHF"}]}
    run(ip.run_daily_plan(dry_run=False, send_whatsapp=True))

    assert len(env.wa.sent) == 1
    text = env.wa.sent[0][1]
    assert "IBKR daily run: IWDC FILLED via MCP position" in text
    assert "; skipped: IWDC: completed/reconciled this run — skip; SMALL:" in text
    assert "SMALL: not eligible on MCP review path" in text
    assert text.rstrip().endswith(".")


def test_whatsapp_failure_never_fails_the_run(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.wa.raise_error = True
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=True))
    assert res["whatsapp"] is False
    assert any("whatsapp send failed" in n for n in res["notes"])
    assert res["state_after"]["VAGX"]["status"] == "ordered"


def test_mcp_failure_fails_soft_no_creates_but_state_saved(env):
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    env.mcp.fail_reads = True
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=True))
    assert env.mcp.creates == []
    assert any("mcp unavailable" in n and "NOT created" in n
               for n in res["notes"])
    assert res["state_after"] is not None, "daily still persists gates"
    assert env.db.snapshots[ip.STATE_DATASET].payload["_meta"]["gate_checked"] \
        == FROZEN_STAMP


# --------------------------------------------------------------------------- #
# No network at all in tests                                                   #
# --------------------------------------------------------------------------- #
def test_full_run_touches_no_httpx(env, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("httpx must never be used — all seams stubbed")

    monkeypatch.setattr(httpx, "AsyncClient", boom)
    state = base_state(VAGX={"status": "wait", "invested_chf": 0.0})
    seed(env, state)
    res = run(ip.run_daily_plan(dry_run=False, send_whatsapp=True))
    assert res["state_after"]["VAGX"]["status"] == "ordered"
    assert env.wa.sent and env.mcp.creates


# --------------------------------------------------------------------------- #
# Scheduler — flag default-off, window, marker dedupe, failure stop            #
# --------------------------------------------------------------------------- #
def test_plan_loop_disabled_by_default(monkeypatch):
    assert settings.IBKR_PLAN_DAILY_ENABLED is False  # config default
    monkeypatch.setattr(settings, "IBKR_PLAN_DAILY_ENABLED", False)
    assert ip.maybe_start_plan_loop() is None
    assert ip.plan_enabled() is False


def test_plan_loop_starts_when_enabled(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_PLAN_DAILY_ENABLED", True)

    async def scenario():
        task = ip.maybe_start_plan_loop()
        assert task is not None
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return True

    assert run(scenario()) is True


@pytest.mark.parametrize(
    "dt, want",
    [
        (datetime(2026, 11, 12, 9, 4, tzinfo=TZ), False),   # before 09:05
        (datetime(2026, 11, 12, 9, 5, tzinfo=TZ), True),    # first attempt
        (datetime(2026, 11, 12, 14, 0, tzinfo=TZ), True),   # late wake
        (datetime(2026, 11, 12, 16, 30, tzinfo=TZ), True),  # deadline inclusive
        (datetime(2026, 11, 12, 16, 31, tzinfo=TZ), False), # after deadline
        (datetime(2026, 11, 14, 10, 0, tzinfo=TZ), False),  # Saturday
        (datetime(2026, 11, 15, 9, 30, tzinfo=TZ), False),  # Sunday
    ],
)
def test_run_window_rules(dt, want):
    assert ip.in_run_window(dt) == want


def _fake_run(monkeypatch, calls, ok=True, result=None):
    async def fake(**kw):
        calls.append(kw)
        return (result if result is not None else {"ran": True}), ok

    monkeypatch.setattr(ip, "_run", fake)


def test_marker_dedupe_second_tick_same_date_skips(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(ip, "AsyncSessionLocal", lambda: db)
    calls: list[dict] = []
    _fake_run(monkeypatch, calls)

    first = run(ip.plan_tick(now=datetime(2026, 11, 12, 9, 5, tzinfo=TZ)))
    second = run(ip.plan_tick(now=datetime(2026, 11, 12, 15, 0, tzinfo=TZ)))
    assert first["ran"] is True and first["ok"] is True
    assert second == {"skipped": "already_ran", "date": "2026-11-12",
                      "ok": True}
    assert len(calls) == 1, "one run per calendar day"
    marker = db.snapshots[ip.MARKER_DATASET].payload
    assert marker["date"] == "2026-11-12" and marker["ok"] is True


def test_marker_dedupe_skips_next_day_old_marker(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(ip, "AsyncSessionLocal", lambda: db)
    calls: list[dict] = []
    _fake_run(monkeypatch, calls)
    run(ip.save_marker(db, {"date": "2026-11-11", "ok": True}))
    out = run(ip.plan_tick(now=datetime(2026, 11, 12, 9, 5, tzinfo=TZ)))
    assert out["ran"] is True and len(calls) == 1


def test_failure_marks_and_stops_for_the_day(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(ip, "AsyncSessionLocal", lambda: db)
    calls: list[dict] = []
    _fake_run(monkeypatch, calls, ok=False, result=None)

    first = run(ip.plan_tick(now=datetime(2026, 11, 12, 9, 5, tzinfo=TZ)))
    second = run(ip.plan_tick(now=datetime(2026, 11, 12, 9, 6, tzinfo=TZ)))
    assert first["ran"] is True and first["ok"] is False
    assert second["skipped"] == "already_ran"
    assert db.snapshots[ip.MARKER_DATASET].payload["ok"] is False, \
        "a failed attempt still stops the day (log + no retry)"
    assert len(calls) == 1


def test_tick_outside_window_never_runs(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(ip, "AsyncSessionLocal", lambda: db)
    calls: list[dict] = []
    _fake_run(monkeypatch, calls)

    assert run(ip.plan_tick(
        now=datetime(2026, 11, 12, 9, 4, tzinfo=TZ)))["skipped"] \
        == "before_first_attempt"
    assert run(ip.plan_tick(
        now=datetime(2026, 11, 12, 16, 31, tzinfo=TZ)))["skipped"] \
        == "after_deadline"
    assert run(ip.plan_tick(
        now=datetime(2026, 11, 14, 10, 0, tzinfo=TZ)))["skipped"] == "weekend"
    assert calls == []
    assert ip.MARKER_DATASET not in db.snapshots


def test_late_wake_inside_window_runs(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(ip, "AsyncSessionLocal", lambda: db)
    calls: list[dict] = []
    _fake_run(monkeypatch, calls)
    out = run(ip.plan_tick(now=datetime(2026, 11, 12, 14, 3, tzinfo=TZ)))
    assert out["ran"] is True and len(calls) == 1


def test_tick_full_run_sends_whatsapp_in_scheduler_mode(env, monkeypatch):
    """plan_tick drives _run(dry_run=False, send_whatsapp=True)."""
    seed(env, base_state(VAGX={"status": "wait", "invested_chf": 0.0}))
    out = run(ip.plan_tick(now=FROZEN))
    assert out["ran"] is True and out["ok"] is True
    assert len(env.wa.sent) == 1, "one WhatsApp per successful scheduler run"
    assert env.db.snapshots[ip.MARKER_DATASET].payload["ok"] is True


# --------------------------------------------------------------------------- #
# Endpoints (admin + feed gates, shapes, round-trip)                           #
# --------------------------------------------------------------------------- #
@pytest.fixture()
def client(env, monkeypatch):
    monkeypatch.setattr(settings, "NEEDLE_TOKEN", "s3cret-ibkr-test")
    # Plain TestClient (no context manager): lifespan (DB create_all + loops)
    # must not run.
    app.dependency_overrides[get_db] = lambda: env.db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def test_endpoints_require_admin(client, env, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    assert client.post("/api/v1/ibkr/plan/state/import",
                       json={"_meta": {}}).status_code == 401
    assert client.get("/api/v1/ibkr/plan/state").status_code == 401
    assert client.post("/api/v1/ibkr/plan/dry-run").status_code == 401
    assert client.post("/api/v1/ibkr/plan/state/import", json={"x": 1},
                       headers={"X-Needle-Token": "wrong"}).status_code == 401


def test_import_get_roundtrip_exact_dev_shape(client, env):
    state = base_state()
    state["_meta"]["note"] = "Inyova removed; % renormalized"
    resp = client.post("/api/v1/ibkr/plan/state/import", json=state,
                       headers=ADMIN)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True and body["dataset"] == "ibkr_plan_state"
    assert body["sleeve_count"] == 8 and "_meta" in body["keys"]
    assert body["updated_at"].endswith("+00:00")

    got = client.get("/api/v1/ibkr/plan/state", headers=ADMIN)
    assert got.status_code == 200
    g = got.json()
    assert g["found"] is True
    assert g["state"] == state, "stored EXACTLY the dev investments_state.json"
    assert g["source"] == "backend-ibkr-plan"

    # import twice -> still one row (upsert)
    client.post("/api/v1/ibkr/plan/state/import", json=state, headers=ADMIN)
    assert list(env.db.snapshots).count("ibkr_plan_state") == 1


def test_get_state_absent_is_fail_soft(client):
    got = client.get("/api/v1/ibkr/plan/state", headers=ADMIN)
    assert got.status_code == 200
    assert got.json() == {"found": False, "state": None, "updated_at": None,
                          "source": None}


def test_import_empty_body_422(client):
    resp = client.post("/api/v1/ibkr/plan/state/import", json={},
                       headers=ADMIN)
    assert resp.status_code == 422


def test_import_works_while_flags_off(client):
    """Seeding must not require the feed flag (default-off deployment)."""
    assert settings.IBKR_MCP_ENABLED is False
    assert settings.IBKR_PLAN_DAILY_ENABLED is False
    resp = client.post("/api/v1/ibkr/plan/state/import",
                       json=base_state(), headers=ADMIN)
    assert resp.status_code == 200


def test_dry_run_endpoint_feed_gated(client, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    resp = client.post("/api/v1/ibkr/plan/dry-run", headers=ADMIN)
    assert resp.status_code == 503
    assert "IBKR_MCP_ENABLED" in resp.json()["detail"]


def test_dry_run_endpoint_always_dry(client, env, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    seed(env, base_state(VAGX={"status": "wait", "invested_chf": 0.0}))
    before = copy.deepcopy(env.db.snapshots[ip.STATE_DATASET].payload)

    resp = client.post("/api/v1/ibkr/plan/dry-run", headers=ADMIN)

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"date", "rows", "entries", "state_after", "notes",
                         "instructions", "whatsapp"}
    assert body["whatsapp"] is False
    assert body["instructions"][0]["status"] == "dry_run"
    assert env.mcp.creates == [], "endpoint must never create"
    assert env.wa.sent == [], "endpoint must never send"
    assert env.db.snapshots[ip.STATE_DATASET].payload == before, \
        "endpoint must never save"
    assert len(body["rows"]) == 8


def test_dry_run_endpoint_missing_state_still_200(client, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    resp = client.post("/api/v1/ibkr/plan/dry-run", headers=ADMIN)
    assert resp.status_code == 200
    body = resp.json()
    assert body["state_after"] is None
    assert any("plan state missing" in n for n in body["notes"])
