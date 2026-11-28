"""Unit tests for the Binance Executor port (no network, no DB).

Run:  uv run pytest tests/test_binance_executor.py -q
Docs: docs/BINANCE_EXECUTOR.md

Covers Vincent's acceptance conditions: dry-run is the code default, rails
are enforced before any decision, the carry pair is never naked, the
spot-before-perp order and funding-streak exit survive the port, the
quantity bugfix (integer zeros) holds, and momentum never touches carry
shorts or untracked legs.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.core.config import settings
from app.services import binance_executor as ex

RESETS = []


def _patch(name: str, value):
    # config flags live on the shared ``settings`` object, logic on the module
    target = settings if name.startswith("BINANCE_EXECUTOR_") else ex
    orig = getattr(target, name)
    setattr(target, name, value)
    RESETS.append((target, name, orig))


@pytest.fixture(autouse=True)
def _restore_patches():
    yield
    for target, name, orig in RESETS:
        setattr(target, name, orig)
    RESETS.clear()


# ------------------------------------------------------------------ fakes ---
class Mem:
    def __init__(self):
        self.state: dict[str, dict] = {}
        self.orders: list[dict] = []

    async def load(self, key, default=None):
        return dict(self.state.get(key) or dict(default or {}))

    async def save(self, key, value):
        self.state[key] = dict(value)

    async def journal(self, kind, **kw):
        self.orders.append({"kind": kind, **kw})


def _run(coro):
    return asyncio.run(coro)


def test_fmt_qty_keeps_integer_zeros_and_floors_to_step():
    # challenge bugfix: int-part zeros must survive rstrip (100 != 1)
    assert ex._fmt_qty(100.0, 1.0) == "100"
    assert ex._fmt_qty(2512.55, 1.0) == "2512"          # never over
    assert ex._fmt_qty(0.123456789, 0.01) == "0.12"
    assert ex._fmt_qty(6.0, 0.001) == "6"
    assert ex._fmt_qty(1000.0, 100.0) == "1000"


def test_dry_run_is_the_code_default():
    assert settings.BINANCE_EXECUTOR_DRY_RUN is True
    assert settings.BINANCE_EXECUTOR_ENABLED is False


def test_place_is_log_only_in_dry_run(monkeypatch):
    _patch("BINANCE_EXECUTOR_DRY_RUN", True)
    sent = []

    async def fake_signed(path, params, *, post=True, host=""):
        sent.append(path)
        return 500, {"bypassed": True}

    _patch("_signed", fake_signed)
    code, resp = _run(ex._place("/papi/v1/um/order", {"side": "SELL"}))
    assert code == 200 and resp.get("dry") is True
    assert sent == []                      # dry mode never reaches the API


# ------------------------------------------------------------------- rails ---
def test_env_kill_switch_blocks():
    _patch("BINANCE_EXECUTOR_STOP", True)
    ok, why = _run(ex.rails_ok())
    assert not ok and "STOP" in why


def test_db_stop_flag_blocks():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _run(mem.save("carry", {"stop": True}))
    ok, why = _run(ex.rails_ok())
    assert not ok and "db" in why


def test_daily_stop_blocks_after_loss():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    budget = settings.BINANCE_EXECUTOR_CARRY_BUDGET_USD
    _run(mem.save("carry", {"day": None, "day_pnl": -budget * 0.006}))
    ok, why = _run(ex.rails_ok())
    # day rollover resets day_pnl on a new day -> must run with SAME day
    st = _run(mem.load("carry"))
    st["day_pnl"] = -budget * 0.006
    _run(mem.save("carry", st))
    ok, why = _run(ex.rails_ok())
    assert not ok and "daily" in why


def test_drawdown_halt_blocks():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    budget = settings.BINANCE_EXECUTOR_CARRY_BUDGET_USD
    _run(mem.save("carry", {"realized": -budget * 0.21}))
    ok, why = _run(ex.rails_ok())
    assert not ok and "drawdown" in why


# ----------------------------------------------------------- carry universe --
def test_carry_universe_ranks_positive_net_and_caps_top_n():
    async def fake_public(path, params=None, host=""):
        sym = params["symbol"]
        # CHR strongly positive, UNI flat, DYDX negative, SFP very positive;
        # every other candidate gets a small positive default
        rates = {"CHRUSDT": 0.0001, "UNIUSDT": 0.0, "UNIUSDC": 0.0,
                 "DYDXUSDT": -0.0002, "SFPUSDT": 0.0003}
        return 200, [{"fundingRate": rates.get(sym, 0.00005)}
                     for _ in range(90)]

    _patch("_public", fake_public)
    out = _run(ex.carry_universe(2))
    assert [t[0] for t in out] == ["SFPUSDT", "CHRUSDT"]  # desc + positive-only
    assert all(t[2] > 0 for t in out)


# -------------------------------------------------------------- carry tick ---
def test_carry_tick_spot_before_perp_and_state_from_live_book():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _patch("journal", mem.journal)
    _patch("rails_ok", _ok)
    calls: list[tuple[str, str]] = []

    async def fake_place(path, params, *, post=True, host=""):
        side = "spot" if "api/v3" in host or path == "/api/v3/order" else "perp"
        calls.append((side, params.get("symbol", "")))
        return 200, {"ok": True}

    async def fake_book():
        # live book ALREADY has the 5 carry shorts -> adopted, not re-entered
        shorts = {"CHRUSDT": -2512.0, "DYDXUSDT": -406.0,
                  "PEOPLEUSDT": -6495.0, "SFPUSDT": -195.0,
                  "UNIUSDC": -6.0}
        return {"positions": {s: {"amt": a, "entry": 1.0, "side": "SHORT",
                                  "upnl": 0.0} for s, a in shorts.items()},
                "spot": {}, "equity": 6800.0, "available": 4100.0}

    async def fake_public(path, params=None, host=""):
        if path.endswith("fundingRate") and params and params.get("limit") == 3:
            return 200, [{"fundingRate": 0.0001} for _ in range(3)]
        if path.endswith("fundingRate"):
            return 200, [{"fundingRate": 0.0001} for _ in range(90)]
        if path.endswith("ticker/price"):
            return 200, {"price": "1.0"}
        return 200, {}

    async def fake_steps(symbols):
        return {s: (1e-8, 1e-3, 5.0) for s in symbols}

    _patch("_place", fake_place)
    _patch("live_book", fake_book)
    _patch("_public", fake_public)
    _patch("_steps", fake_steps)

    res = _run(ex.carry_tick())
    assert res["ok"] is True
    st = _run(mem.load("carry"))
    held5 = {"CHRUSDT", "DYDXUSDT", "PEOPLEUSDT", "SFPUSDT", "UNIUSDC"}
    # book-derived: all 5 adopted WITHOUT re-entry (no order for them)...
    assert held5 <= set(st["open"])
    # ...and the 5 free slots were filled with spot-then-perp pairs only
    assert len(st["open"]) == 10
    legs = [(side, sym) for side, sym in calls]
    assert len(legs) == 10 and legs[0][0] == "spot"
    # paired 1:1: spot leg is always the MAP of its perp leg, spot first
    assert all(legs[i][0] == "spot" and legs[i + 1][0] == "perp"
               and legs[i][1] == ex.CARRY_SPOT_MAP[legs[i + 1][1]]
               for i in range(0, 10, 2))
    assert not ({s for _, s in legs} & held5)      # never re-bought adopted


def test_carry_entry_is_spot_then_perp_and_defers_when_spot_fails():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _patch("journal", mem.journal)
    _patch("rails_ok", _ok)
    calls: list[str] = []
    fail_spot = {"on": True}

    async def fake_book():
        return {"positions": {}, "spot": {}, "equity": 6800.0,
                "available": 4100.0}

    async def fake_public(path, params=None, host=""):
        if path.endswith("fundingRate"):
            return 200, [{"fundingRate": 0.0002} for _ in range(90)]
        if path.endswith("ticker/price"):
            return 200, {"price": "1.0"}
        return 200, {}

    async def fake_place(path, params, *, post=True, host=""):
        if host == ex.SPOT_HOST:
            calls.append("spot:" + params["symbol"])
            return (400, {"msg": "insufficient"}) if fail_spot["on"] \
                else (200, {"ok": True})
        calls.append("perp:" + params["symbol"])
        return 200, {"ok": True}

    async def fake_steps(symbols):
        return {s: (1e-8, 1e-3, 5.0) for s in symbols}

    _patch("_place", fake_place)
    _patch("live_book", fake_book)
    _patch("_public", fake_public)
    _patch("_steps", fake_steps)

    _run(ex.carry_tick())
    # spot tried, FAILED -> NO perp order may follow (never naked)
    assert calls and all(c.startswith("spot:") for c in calls)
    st = _run(mem.load("carry"))
    assert st["open"] == {}

    calls.clear()
    fail_spot["on"] = False
    _run(ex.carry_tick())
    # per pair: spot BEFORE perp, paired 1:1 across the whole top-N
    legs = [c.split(":")[0] for c in calls]
    assert len(calls) > 0 and len(calls) % 2 == 0
    assert all(legs[i] == "spot" and legs[i + 1] == "perp"
               for i in range(0, len(legs), 2))
    st = _run(mem.load("carry"))
    assert st["open"] and all(m["hedged"] for m in st["open"].values())


def test_funding_streak_exit_closes_perp_then_spot():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _patch("journal", mem.journal)
    _patch("rails_ok", _ok)
    closed: list[str] = []

    async def fake_book():
        return {"positions": {"CHRUSDT": {"amt": -100.0, "entry": 0.1,
                                          "side": "SHORT", "upnl": 0.0}},
                "spot": {"CHR": 100.0}, "equity": 6800.0,
                "available": 4100.0}

    async def fake_public(path, params=None, host=""):
        if path.endswith("fundingRate") and params.get("limit") == 3:
            return 200, [{"fundingRate": -0.0001} for _ in range(3)]
        if path.endswith("fundingRate"):
            return 200, [{"fundingRate": 0.0001} for _ in range(90)]
        if path.endswith("ticker/price"):
            return 200, {"price": "1.0"}
        return 200, {}

    async def fake_place(path, params, *, post=True, host=""):
        closed.append(params["symbol"])
        return 200, {"ok": True}

    async def fake_steps(symbols):
        return {s: (1e-8, 1e-3, 5.0) for s in symbols}

    _patch("_place", fake_place)
    _patch("live_book", fake_book)
    _patch("_public", fake_public)
    _patch("_steps", fake_steps)

    _run(ex.carry_tick())
    assert closed[0] == "CHRUSDT"          # perp close first...
    assert [o["kind"] for o in mem.orders][:2] == ["CARRY_EXIT_PERP",
                                                   "CARRY_EXIT_SPOT"]
    # ...and a NEW entry may follow in the same cycle only after the exit
    perp_idx = [i for i, o in enumerate(mem.orders)
                if o["kind"] == "CARRY_ENTRY_PERP"]
    assert perp_idx


# --------------------------------------------------------------- momentum ----
def test_momentum_never_touches_carry_shorts_or_untracked_legs():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _patch("journal", mem.journal)
    _patch("rails_ok", _ok)
    orders: list[str] = []

    async def fake_book():
        return {
            "positions": {
                "CHRUSDT": {"amt": -100.0, "entry": 0.1, "side": "SHORT",
                            "upnl": 0.0},                       # carry short
                "QUSDT": {"amt": 97.0, "entry": 0.12, "side": "LONG",
                          "upnl": 0.0},                         # legacy/untracked
                "AGTUSDT": {"amt": 136.0, "entry": 0.09, "side": "LONG",
                            "upnl": 0.0},                       # adopted, out
            },
            "spot": {}, "equity": 6800.0, "available": 4100.0}

    async def fake_top(n):
        # AGT out of formation, BTW fresh in; Q not in top but UNTRACKED
        return ["BTWUSDT", "JCTUSDT"], {"BTWUSDT": 0.4, "JCTUSDT": 0.3}

    async def fake_public(path, params=None, host=""):
        if path.endswith("ticker/price"):
            return 200, {"price": "2.0"}
        return 200, {}

    async def fake_place(path, params, *, post=True, host=""):
        orders.append(f"{params['side']}:{params['symbol']}")
        return 200, {"ok": True}

    async def fake_steps(symbols):
        return {s: (1e-8, 1e-3, 5.0) for s in symbols}

    _patch("formation_top", fake_top)
    _patch("_public", fake_public)
    _patch("_place", fake_place)
    _patch("live_book", fake_book)
    _patch("_steps", fake_steps)

    res = _run(ex.momentum_tick())
    assert res["ok"] is True
    st = _run(mem.load("momentum"))
    # adoption ran (first tick): both live longs entered the basket, then
    # the rotate rule closed the ones outside the new formation
    assert "AGTUSDT" not in st["basket"] and "QUSDT" not in st["basket"]
    assert "SELL:AGTUSDT" in orders and "SELL:QUSDT" in orders
    # carry CHR was never touched
    assert not any(o.endswith(":CHRUSDT") for o in orders)
    # entries for fresh top-N members, fixed small notional
    buys = [o for o in orders if o.startswith("BUY:")]
    assert set(buys) == {"BUY:BTWUSDT", "BUY:JCTUSDT"}
    assert all(abs(o["notional"]
                   - settings.BINANCE_EXECUTOR_MOMENTUM_NOTIONAL_USD) < 1e-9
               for o in mem.orders if o["kind"] == "MOMENTUM_ENTRY")


# -------------------------------------------------------------- loop gating --
def test_maybe_start_is_disabled_by_default():
    _patch("BINANCE_EXECUTOR_ENABLED", False)
    assert ex.maybe_start_binance_executor_loop() is None


async def _ok():
    return True, "ok"


def test_momentum_exit_survives_perp_only_listing():
    """Spot LOT may not exist for perp-only listings — the exit must still fire
    (live 09:09 DEFER storm regression, 2026-11-28)."""
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _patch("journal", mem.journal)
    _patch("rails_ok", _ok)
    orders: list[str] = []

    async def fake_book():
        return {"positions": {"AGTUSDT": {"amt": 136.0, "entry": 0.09,
                                          "side": "LONG", "upnl": 0.0}},
                "spot": {}, "equity": 6800.0, "available": 4100.0}

    async def fake_top(n):
        return ["BTWUSDT"], {"BTWUSDT": 0.4}

    async def fake_public(path, params=None, host=""):
        return 200, {"price": "2.0"}

    async def fake_place(path, params, *, post=True, host=""):
        orders.append(f"{params['side']}:{params['symbol']}")
        return 200, {"ok": True}

    async def fake_steps(symbols):
        return {s: (None, 1e-3, 5.0) for s in symbols}   # no spot LOT_SIZE

    _patch("formation_top", fake_top)
    _patch("_public", fake_public)
    _patch("_place", fake_place)
    _patch("live_book", fake_book)
    _patch("_steps", fake_steps)

    res = _run(ex.momentum_tick())
    assert res["ok"] is True
    assert "SELL:AGTUSDT" in orders                      # exit fired
    assert "BUY:BTWUSDT" in orders                       # fresh entry too
    kinds = [o["kind"] for o in mem.orders]
    assert "MOMENTUM_EXIT" in kinds and "MOMENTUM_EXIT_DEFER" not in kinds


def test_carry_entry_defers_when_spot_step_missing():
    mem = Mem()
    _patch("load_state", mem.load)
    _patch("save_state", mem.save)
    _patch("journal", mem.journal)
    _patch("rails_ok", _ok)
    placed: list[str] = []

    async def fake_book():
        return {"positions": {}, "spot": {}, "equity": 6800.0,
                "available": 4100.0}

    async def fake_public(path, params=None, host=""):
        if path.endswith("fundingRate"):
            return 200, [{"fundingRate": 0.0002} for _ in range(90)]
        if path.endswith("ticker/price"):
            return 200, {"price": "1.0"}
        return 200, {}

    async def fake_place(path, params, *, post=True, host=""):
        placed.append(params.get("symbol", ""))
        return 200, {"ok": True}

    async def fake_steps(symbols):
        return {s: (None, 1e-3, 5.0) for s in symbols}   # spot leg unknown

    _patch("_place", fake_place)
    _patch("live_book", fake_book)
    _patch("_public", fake_public)
    _patch("_steps", fake_steps)

    _run(ex.carry_tick())
    assert placed == []                                   # never half-pair
    kinds = [o["kind"] for o in mem.orders]
    assert kinds and all(k == "CARRY_ENTRY_DEFER" for k in kinds)
