"""Binance Executor — the "Beat the Market" challenge stack, ported to the
cloud backend (Vincent GO 2026-11-28: *"pls call it Binance Executor from
now on … ensure we do live trading, not paper trading and port it to the
backend … follow-up each 4 hours the first 3 days"*).

Faithful port of two frozen programs (semantics, sizing and rails are the
challenge contract — never widened):

* **Carry (CORE)** — `jcode_strategy/carry_executor.py`: delta-neutral
  funding carry on up to ``CARRY_TOP_N`` liquid pairs. Spot leg FIRST and it
  must fill; the perp SHORT is only ever sent against an already-bought spot
  hedge (never naked); exit after ``FUNDING_EXIT_STREAK`` consecutive
  non-positive funding intervals; per-pair notional =
  ``budget * alloc_pct / top_n`` (4000 * 0.50 / 10 = 200 USD).
* **Momentum (SATELLITE)** — `xsec_live_deploy` / `xsec_rotate`: rank the
  Binance USDT/USDC perpetual universe by formation momentum over the latest
  60 x 4h closes, hold the top-N as PM perp LONG legs at a fixed small
  notional per pair (12.5 USD, the 2026-10-25 rotate precedent), close legs
  that fall out of the top-N.

**Rails (Vincent's, applied on every cycle):** env kill-switch
``BINANCE_EXECUTOR_STOP`` + DB key ``stop``; daily loss stop
(``DAILY_STOP_PCT`` of budget); drawdown halt (``DRAWDOWN_HALT_PCT``);
per-pair caps; hedge mode with explicit ``positionSide``; quantities floored
to the exchange step (never over). Dry-run is the code default — live is a
configuration decision (``BINANCE_EXECUTOR_DRY_RUN=false``) recorded here.

State lives in ``binance_executor_state`` (kv JSON) and every decision in
``binance_executor_orders``. Each live tick first **re-derives holdings from
the exchange** so a crash can never double-enter: the book, not our memory,
is authoritative.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.binance_executor import BinExecOrder, BinExecState

logger = logging.getLogger(__name__)

SPOT_HOST = "https://api.binance.com"
PAPI_HOST = "https://papi.binance.com"
FAPI_HOST = "https://fapi.binance.com"

# --- carry candidate universe (challenge: LIQUID_OK x spot map) -------------
CARRY_SPOT_MAP: dict[str, str] = {
    "SFPUSDT": "SFPUSDT", "DYDXUSDT": "DYDXUSDT", "CHRUSDT": "CHRUSDT",
    "UNIUSDC": "UNIUSDT", "UNIUSDT": "UNIUSDT", "PEOPLEUSDT": "PEOPLEUSDT",
    "LINKUSDC": "LINKUSDT", "LTCUSDC": "LTCUSDT", "SSVUSDT": "SSVUSDT",
    "NEARUSDC": "NEARUSDT", "ARBUSDC": "ARBUSDT", "VETUSDT": "VETUSDT",
    "JOEUSDT": "JOEUSDT",
}

BARS_FORM = 60 * 4          # 60 x 4h bars of formation momentum (xsec)
MIN_COVERAGE = 0.9
KLINE_LIMIT = 360


# ---------------------------------------------------------------- utilities --
def _keys() -> tuple[str, str]:
    return settings.BINANCE_API_KEY, settings.BINANCE_API_SECRET


def _fmt_qty(qty: float, step: float) -> str:
    """Quantize to step WITHOUT stripping integer zeros (challenge bugfix:
    rstrip('0') turned '100.00000000' into '1')."""
    q = float(int(qty / step) * step) if step > 0 else qty
    s = f"{q:.8f}"
    intpart, frac = s.split(".")
    frac = frac.rstrip("0")
    return intpart if not frac else intpart + "." + frac


def _sign(params: dict, secret: str) -> str:
    qs = urllib.parse.urlencode(params)
    return hmac.new(secret.encode(), qs.encode(), hashlib.sha256).hexdigest()


def _request(method: str, url: str, api_key: str = "",
             body: bytes | None = None, timeout: int = 20
             ) -> tuple[int, dict]:
    """Synchronous signed/public HTTP. Called from async code via
    ``asyncio.to_thread`` (keeps the port close to the frozen originals)."""
    req = urllib.request.Request(
        url, data=body, method=method,
        headers={"X-MBX-APIKEY": api_key} if api_key else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:  # noqa: BLE001
            return e.code, {"raw": "non-json-error"}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


def _signed_url(host: str, path: str, params: dict, post: bool,
                key: str, secret: str) -> tuple[str, bytes | None]:
    p = dict(params)
    p["timestamp"] = int(time.time() * 1000)
    p["recvWindow"] = 5000
    qs = urllib.parse.urlencode(p) + "&signature=" + _sign(p, secret)
    return f"{host}{path}?{qs}", (b"" if post else None)


async def _public(path: str, params: dict | None = None,
                  host: str = FAPI_HOST) -> tuple[int, dict]:
    url = host + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return await asyncio.to_thread(_request, "GET", url)


async def _signed(path: str, params: dict | None = None, *, post: bool = False,
                  host: str = PAPI_HOST) -> tuple[int, dict]:
    key, secret = _keys()
    url, body = await asyncio.to_thread(
        _signed_url, host, path, dict(params or {}), post, key, secret)
    return await asyncio.to_thread(_request, "POST" if post else "GET",
                                   url, key, body)


# ------------------------------------------------------------------- state ---
async def load_state(key: str, default: dict | None = None) -> dict:
    async with AsyncSessionLocal() as db:
        row = await db.get(BinExecState, key)
        return dict(row.value) if row and row.value else dict(default or {})


async def save_state(key: str, value: dict) -> None:
    async with AsyncSessionLocal() as db:
        row = await db.get(BinExecState, key)
        if row:
            row.value = value
        else:
            db.add(BinExecState(key=key, value=value))
        await db.commit()


async def journal(kind: str, *, symbol: str = "", side: str = "",
                  qty: float = 0.0, price: float = 0.0,
                  notional: float = 0.0, mode: str = "dry",
                  cycle: str = "", result: dict | None = None,
                  note: str = "") -> None:
    async with AsyncSessionLocal() as db:
        db.add(BinExecOrder(kind=kind, symbol=symbol, side=side, qty=qty,
                            price=price, notional=notional, mode=mode,
                            cycle=cycle, result=result or {}, note=note))
        await db.commit()


# ------------------------------------------------------------------- rails ---
async def rails_ok() -> tuple[bool, str]:
    """Vincent's kill/daily/drawdown rails — checked BEFORE any decision."""
    if settings.BINANCE_EXECUTOR_STOP:
        return False, "env BINANCE_EXECUTOR_STOP"
    st = await load_state("carry")
    if st.get("stop"):
        return False, "db state stop flag"
    budget = settings.BINANCE_EXECUTOR_CARRY_BUDGET_USD
    realized = float(st.get("realized", 0.0))
    if budget + realized < budget * (1 - settings.BINANCE_EXECUTOR_DRAWDOWN_HALT_PCT):
        return False, "drawdown halt"
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    if st.get("day") != day:
        st["day"] = day
        st["day_pnl"] = 0.0
        await save_state("carry", st)
    daily_stop = budget * settings.BINANCE_EXECUTOR_DAILY_STOP_PCT
    if float(st.get("day_pnl", 0.0)) <= -daily_stop:
        return False, "daily stop"
    return True, "ok"


# ------------------------------------------------------------ live holdings --
async def live_book() -> dict:
    """Authoritative holdings: perp positions (PM) + spot balances.

    **Fails loud on any signed-read error** (empty dict defaults removed):
    an unreachable account must never look like "nothing held" — that would
    re-enter a live book. Caught in dry-run E2E 2026-11-28 09:45.
    """
    code, um = await _signed("/papi/v1/um/account")
    if code != 200:
        raise RuntimeError(
            f"Binance papi /um/account failed (code={code}): {str(um)[:180]}"
            " — refusing to trade against an unknown book")
    positions: dict[str, dict] = {}
    for p in um.get("positions", []):
        amt = float(p.get("positionAmt") or 0)
        if amt:
            positions[p["symbol"]] = {
                "amt": amt, "entry": float(p.get("entryPrice") or 0),
                "side": p.get("positionSide") or
                        ("LONG" if amt > 0 else "SHORT"),
                "upnl": float(p.get("unrealizedProfit") or 0),
            }
    code, acc = await _signed("/api/v3/account", host=SPOT_HOST)
    if code != 200:
        raise RuntimeError(
            f"Binance spot /account failed (code={code}): {str(acc)[:180]}")
    spot = {b["asset"]: float(b["free"]) + float(b["locked"])
            for b in acc.get("balances", [])
            if float(b.get("free") or 0) or float(b.get("locked") or 0)}
    code, pm = await _signed("/papi/v1/account")
    if code != 200:
        raise RuntimeError(
            f"Binance papi /account failed (code={code}): {str(pm)[:180]}")
    equity = float(pm.get("accountEquity") or 0)
    available = float(pm.get("totalAvailableBalance") or 0)
    return {"positions": positions, "spot": spot,
            "equity": equity, "available": available}


_FILTER_CACHE: dict = {"ts": 0.0, "spot": None, "perp": None,
                       "perp_min": None}


async def _filter_maps() -> tuple[dict, dict, dict]:
    """Spot LOT_SIZE + perp LOT_SIZE/MIN_NOTIONAL maps, memoized 10 min.

    FULL exchangeInfo fetches (no ``symbols`` query — spot requires a JSON
    array there; the old plain-comma value returned -1100 and silently
    produced empty steps → 1e-8 fallback → live -1013 LOT_SIZE rejects on
    2026-11-28 08:57). First-fetch failure RAISES: an unknown step must
    never be defaulted.
    """
    now = time.time()
    if (_FILTER_CACHE["spot"] is not None
            and now - _FILTER_CACHE["ts"] < 600):
        return (_FILTER_CACHE["spot"], _FILTER_CACHE["perp"] or {},
                _FILTER_CACHE["perp_min"] or {})
    code, ex = await _public("/api/v3/exchangeInfo", host=SPOT_HOST)
    if code == 200 and ex.get("symbols"):
        _FILTER_CACHE["spot"] = {
            s["symbol"]: float(f["stepSize"])
            for s in ex["symbols"]
            for f in s.get("filters", [])
            if f.get("filterType") == "LOT_SIZE"}
    code, fx = await _public("/fapi/v1/exchangeInfo")
    if code == 200 and fx.get("symbols"):
        perp_steps: dict = {}
        perp_min: dict = {}
        for s in fx["symbols"]:
            for f in s.get("filters", []):
                if f.get("filterType") == "LOT_SIZE":
                    perp_steps[s["symbol"]] = float(f["stepSize"])
                elif f.get("filterType") in ("MIN_NOTIONAL", "NOTIONAL"):
                    perp_min[s["symbol"]] = float(
                        f.get("minNotional") or f.get("notional") or 5.0)
        _FILTER_CACHE["perp"] = perp_steps
        _FILTER_CACHE["perp_min"] = perp_min
    _FILTER_CACHE["ts"] = now
    if not _FILTER_CACHE["spot"] or not _FILTER_CACHE["perp"]:
        raise RuntimeError(
            f"exchangeInfo fetch failed (spot={bool(_FILTER_CACHE['spot'])} "
            f"perp={bool(_FILTER_CACHE['perp'])}) — no filter data")
    return (_FILTER_CACHE["spot"], _FILTER_CACHE["perp"],
            _FILTER_CACHE["perp_min"] or {})


async def _steps(symbols: list[str]) -> dict[str, tuple[float, float, float]]:
    """Per symbol: (spot step, perp step, perp min notional). Symbols with
    unknown filters are OMITTED — callers defer instead of guessing."""
    spot, perp, perp_min = await _filter_maps()
    out: dict[str, tuple[float, float, float]] = {}
    for s in symbols:
        step_spot = spot.get(CARRY_SPOT_MAP.get(s, s))
        step_perp = perp.get(s)
        if step_spot is None or step_perp is None:
            continue
        out[s] = (step_spot, step_perp, perp_min.get(s, 5.0))
    return out


# ------------------------------------------------------------ order insert ---
async def _place(path: str, params: dict, *, post: bool = True,
                 host: str = PAPI_HOST) -> tuple[int, dict]:
    if settings.BINANCE_EXECUTOR_DRY_RUN:
        return 200, {"dry": True, "would_send": params}
    return await _signed(path, params, post=post, host=host)


# ================================================================== CARRY ====
async def carry_universe(top_n: int) -> list[tuple[str, str, float]]:
    """(perp, spot, net30d) ranked by the last ~30d of funding, live."""
    ranked: list[tuple[str, str, float]] = []
    for perp, spot in CARRY_SPOT_MAP.items():
        code, rows = await _public(
            "/fapi/v1/fundingRate", {"symbol": perp, "limit": 90})
        if code != 200 or not isinstance(rows, list) or not rows:
            continue
        net = sum(float(r["fundingRate"]) for r in rows)
        ranked.append((perp, spot, net))
    ranked.sort(key=lambda t: t[2], reverse=True)
    positive = [t for t in ranked if t[2] > 0]
    return positive[:top_n]


async def carry_tick() -> dict:
    """One carry cycle: sync from live -> re-hedge -> exits -> entries."""
    ok, why = await rails_ok()
    mode = "dry" if settings.BINANCE_EXECUTOR_DRY_RUN else "live"
    cycle = f"carry-{int(time.time())}"
    if not ok:
        await journal("CARRY_SKIP", mode=mode, cycle=cycle, note=why)
        return {"ok": False, "skip": why, "mode": mode}

    book = await live_book()
    shorts = {s: p for s, p in book["positions"].items()
              if p["amt"] < 0 and s in CARRY_SPOT_MAP}
    st = await load_state("carry", {"open": {}, "day_pnl": 0.0,
                                    "realized": 0.0, "day": None})
    budget = settings.BINANCE_EXECUTOR_CARRY_BUDGET_USD
    notional = (budget * settings.BINANCE_EXECUTOR_CARRY_ALLOC_PCT
                / max(1, settings.BINANCE_EXECUTOR_CARRY_TOP_N))
    actions: list[str] = []

    # --- state is DERIVED from the live book each tick (crash-safe) --------
    open_now: dict[str, dict] = {}
    for perp, pos in shorts.items():
        spot_sym = CARRY_SPOT_MAP[perp]
        spot_amt = book["spot"].get(spot_sym, 0.0)
        meta = (await _steps([perp])).get(perp)
        step_spot, step_perp, _ = meta if meta else (0.0, 0.0, 5.0)
        open_now[perp] = {
            "spot": spot_sym, "qty": abs(pos["amt"]),
            "step_spot": step_spot, "step_perp": step_perp,
            "hedged": True, "spot_held": spot_amt >= abs(pos["amt"]) * 0.98,
            "entry": pos["entry"],
        }
    st["open"] = open_now
    await save_state("carry", st)

    # --- exits: funding-streak on held pairs -------------------------------
    for perp, meta in list(open_now.items()):
        code, rows = await _public("/fapi/v1/fundingRate",
                                   {"symbol": perp, "limit": 3})
        streak = 0
        if code == 200 and isinstance(rows, list):
            for r in rows:
                streak = streak + 1 if float(r["fundingRate"]) <= 0 else 0
        if streak >= settings.BINANCE_EXECUTOR_FUNDING_EXIT_STREAK:
            # perp CLOSE first (long spot may linger, never a naked short)
            code_p, r_p = await _place("/papi/v1/um/order", {
                "symbol": perp, "side": "BUY", "type": "MARKET",
                "quantity": _fmt_qty(meta["qty"], meta["step_perp"]),
                "positionSide": "SHORT"})
            await journal("CARRY_EXIT_PERP", symbol=perp, side="BUY",
                          qty=meta["qty"], mode=mode, cycle=cycle,
                          result={"code": code_p, "resp": str(r_p)[:300]},
                          note=f"funding streak {streak}")
            if code_p == 200:
                code_s, r_s = await _place("/api/v3/order", {
                    "symbol": meta["spot"], "side": "SELL", "type": "MARKET",
                    "quantity": _fmt_qty(meta["qty"], meta["step_spot"])},
                    host=SPOT_HOST)
                await journal("CARRY_EXIT_SPOT", symbol=meta["spot"],
                              side="SELL", qty=meta["qty"], mode=mode,
                              cycle=cycle,
                              result={"code": code_s, "resp": str(r_s)[:300]})
                actions.append(f"exit {perp}")

    # --- re-hedge: live spot leg without a short (never naked) -------------
    st = await load_state("carry", {"open": {}})
    for perp, meta in st.get("open", {}).items():
        if meta.get("hedged"):
            continue
        code_p, r_p = await _place("/papi/v1/um/order", {
            "symbol": perp, "side": "SELL", "type": "MARKET",
            "quantity": _fmt_qty(meta["qty"], meta["step_perp"]),
            "positionSide": "SHORT"})
        meta["hedged"] = code_p == 200
        await journal("CARRY_HEDGE", symbol=perp, side="SELL",
                      qty=meta["qty"], mode=mode, cycle=cycle,
                      result={"code": code_p, "resp": str(r_p)[:300]})
    await save_state("carry", st)

    # --- entries: top liquid pairs with positive net30d not yet held -------
    cand = await carry_universe(settings.BINANCE_EXECUTOR_CARRY_TOP_N)
    held = set(st.get("open", {}))
    for perp, spot_sym, net in cand:
        if perp in held or len(st.get("open", {})) >= \
                settings.BINANCE_EXECUTOR_CARRY_TOP_N:
            continue
        code, t = await _public("/fapi/v1/ticker/price", {"symbol": perp})
        if code != 200:
            continue
        price = float(t.get("price") or 0)
        if price <= 0:
            continue
        qty = notional / price
        meta = (await _steps([perp])).get(perp)
        if meta is None:
            await journal("CARRY_ENTRY_DEFER", symbol=perp, mode=mode,
                          cycle=cycle, note="no exchange filter data")
            continue
        step_spot, step_perp, min_notional = meta
        qty = float(_fmt_qty(qty, min(step_spot, step_perp)))
        if qty * price < min_notional:
            await journal("CARRY_ENTRY_SKIP", symbol=perp, qty=qty,
                          price=price, notional=qty * price, mode=mode,
                          cycle=cycle, note=f"minNotional={min_notional}")
            continue
        # spot leg FIRST: fills -> then the perp short (never naked)
        code_s, r_s = await _place("/api/v3/order", {
            "symbol": spot_sym, "side": "BUY", "type": "MARKET",
            "quantity": _fmt_qty(qty, step_spot)}, host=SPOT_HOST)
        await journal("CARRY_ENTRY_SPOT", symbol=spot_sym, side="BUY",
                      qty=qty, price=price, notional=qty * price, mode=mode,
                      cycle=cycle,
                      result={"code": code_s, "resp": str(r_s)[:300]})
        if code_s != 200:
            actions.append(f"deferred {perp} (spot did not fill)")
            continue
        code_p, r_p = await _place("/papi/v1/um/order", {
            "symbol": perp, "side": "SELL", "type": "MARKET",
            "quantity": _fmt_qty(qty, step_perp), "positionSide": "SHORT"})
        await journal("CARRY_ENTRY_PERP", symbol=perp, side="SELL",
                      qty=qty, price=price, notional=qty * price, mode=mode,
                      cycle=cycle,
                      result={"code": code_p, "resp": str(r_p)[:300]},
                      note=f"net30d={net:.5f}")
        st.setdefault("open", {})[perp] = {
            "spot": spot_sym, "qty": qty, "step_spot": step_spot,
            "step_perp": step_perp, "hedged": code_p == 200,
            "spot_held": True, "entry": price}
        await save_state("carry", st)
        actions.append(f"entry {perp} ({qty:g} @ {price:g})")
        if code_p != 200:
            actions.append(f"RE-HEDGE pending {perp}")

    book2 = await live_book()
    return {"ok": True, "mode": mode, "actions": actions,
            "open": sorted(st.get("open", {})),
            "equity": book2["equity"], "available": book2["available"]}


# ============================================================== MOMENTUM =====
async def formation_top(top_n: int) -> tuple[list[str], dict[str, float]]:
    """Rank ALL USDT/USDC perpetuals by 60x4h formation return (xsec rule)."""
    code, info = await _public("/fapi/v1/exchangeInfo")
    if code != 200:
        return [], {}
    syms = sorted({s["symbol"] for s in info.get("symbols", [])
                   if s.get("contractType") == "PERPETUAL"
                   and s.get("status") == "TRADING"
                   and s.get("quoteAsset") in ("USDT", "USDC")})
    mom: dict[str, float] = {}
    for i, s in enumerate(syms):
        code, kl = await _public("/fapi/v1/klines",
                                 {"symbol": s, "interval": "4h",
                                  "limit": KLINE_LIMIT})
        if code == 200 and isinstance(kl, list) and \
                len(kl) >= BARS_FORM * MIN_COVERAGE:
            closes = [float(k[4]) for k in kl][-BARS_FORM:]
            if closes[0] > 0:
                mom[s] = (closes[-1] - closes[0]) / closes[0]
        await asyncio.sleep(0.05)
    ranked = sorted(mom, key=mom.get, reverse=True)
    return ranked[:top_n], mom


async def momentum_tick() -> dict:
    ok, why = await rails_ok()
    mode = "dry" if settings.BINANCE_EXECUTOR_DRY_RUN else "live"
    cycle = f"mom-{int(time.time())}"
    if not ok:
        await journal("MOMENTUM_SKIP", mode=mode, cycle=cycle, note=why)
        return {"ok": False, "skip": why, "mode": mode}

    book = await live_book()
    longs = {s: p for s, p in book["positions"].items()
             if p["amt"] > 0 and s not in CARRY_SPOT_MAP}
    st = await load_state("momentum", {"basket": {}})
    # basket IS the live non-carry long book (carry-style derivation: the
    # challenge legs adopt automatically, phantom claims from any non-live
    # state — e.g. a dry run against the shared KV — drop, a crash can never
    # double-enter); richer tracked metadata is kept where it exists.
    held: dict[str, dict] = {}
    for sym, p in longs.items():
        meta = dict((st.get("basket") or {}).get(sym) or
                    {"entry": p["entry"], "mom": 0.0})
        meta["qty"] = abs(p["amt"])
        held[sym] = meta
    st["basket"] = held
    await save_state("momentum", st)
    top, mom = await formation_top(settings.BINANCE_EXECUTOR_MOMENTUM_TOP_N)
    actions: list[str] = []

    # exits (rotate rule): LIVE tracked legs that left the top-N; carry
    # shorts are never in `held` (filtered out of `longs`).
    for sym in sorted(set(held) - set(top)):
        pos = longs[sym]
        meta = (await _steps([sym])).get(sym)
        if meta is None:
            await journal("MOMENTUM_EXIT_DEFER", symbol=sym, mode=mode,
                          cycle=cycle, note="no exchange filter data")
            continue
        _, step_perp, _ = meta
        code, r = await _place("/papi/v1/um/order", {
            "symbol": sym, "side": "SELL", "type": "MARKET",
            "quantity": _fmt_qty(abs(pos["amt"]), step_perp),
            "positionSide": "LONG"})
        await journal("MOMENTUM_EXIT", symbol=sym, side="SELL",
                      qty=abs(pos["amt"]), mode=mode, cycle=cycle,
                      result={"code": code, "resp": str(r)[:300]},
                      note="left top-N formation")
        actions.append(f"exit {sym}")
        held.pop(sym, None)

    # entries: fresh top-N members not already held (never a carry pair)
    notional = settings.BINANCE_EXECUTOR_MOMENTUM_NOTIONAL_USD
    for sym in top:
        if sym in held or sym in CARRY_SPOT_MAP:
            continue
        code, t = await _public("/fapi/v1/ticker/price", {"symbol": sym})
        if code != 200:
            continue
        price = float(t.get("price") or 0)
        if price <= 0:
            continue
        meta = (await _steps([sym])).get(sym)
        if meta is None:
            await journal("MOMENTUM_ENTRY_DEFER", symbol=sym, mode=mode,
                          cycle=cycle, note="no exchange filter data")
            continue
        _, step_perp, min_notional = meta
        qty = notional / price
        if qty * price < min_notional:
            await journal("MOMENTUM_ENTRY_SKIP", symbol=sym,
                          notional=notional, mode=mode, cycle=cycle,
                          note=f"minNotional={min_notional} not met")
            continue
        code, r = await _place("/papi/v1/um/order", {
            "symbol": sym, "side": "BUY", "type": "MARKET",
            "quantity": _fmt_qty(qty, step_perp), "positionSide": "LONG"})
        await journal("MOMENTUM_ENTRY", symbol=sym, side="BUY", qty=qty,
                      price=price, notional=notional, mode=mode, cycle=cycle,
                      result={"code": code, "resp": str(r)[:300]},
                      note=f"mom={mom.get(sym, 0):+.4f}")
        actions.append(f"entry {sym} ({notional} USD)")
        held[sym] = {"qty": qty, "entry": price,
                     "mom": mom.get(sym, 0.0)}

    st["basket"] = held
    st["top_n"] = top
    st["formation"] = {k: round(v, 5) for k, v in mom.items()
                       if k in top or k in held}
    await save_state("momentum", st)
    return {"ok": True, "mode": mode, "actions": actions, "top": top,
            "basket": sorted(held)}


# ============================================================ run/status =====
async def run_once(mode: str = "all") -> dict:
    """Operator/API trigger: sync + carry + momentum (or one leg)."""
    out: dict = {"ts": datetime.now(UTC).isoformat(timespec="seconds"),
                 "dry_run": settings.BINANCE_EXECUTOR_DRY_RUN}
    if mode in ("all", "carry", "sync"):
        out["carry"] = await carry_tick()
    if mode in ("all", "momentum"):
        out["momentum"] = await momentum_tick()
    if mode == "book":
        out["book"] = await live_book()
    return out


async def status() -> dict:
    """Read-only status for /api/v1/binance/executor/status + 4h follow-ups."""
    book = await live_book()
    carry_st = await load_state("carry", {"open": {}})
    mom_st = await load_state("momentum", {"basket": {}})
    expected = [s for s in
                settings.TRADING_WATCH_EXPECTED_PERP.split(",") if s]
    held_perps = sorted(book["positions"])
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(BinExecOrder).order_by(BinExecOrder.id.desc())
            .limit(15))).scalars().all()
        recent = [{"ts": r.ts.isoformat(timespec="seconds"),
                   "kind": r.kind, "symbol": r.symbol, "side": r.side,
                   "qty": r.qty, "mode": r.mode, "cycle": r.cycle,
                   "note": r.note,
                   "code": (r.result or {}).get("code")}
                  for r in rows]
    ok, why = await rails_ok()
    return {
        "name": "Binance Executor",
        "enabled": settings.BINANCE_EXECUTOR_ENABLED,
        "dry_run": settings.BINANCE_EXECUTOR_DRY_RUN,
        "kill_switch": settings.BINANCE_EXECUTOR_STOP,
        "rails": {"ok": ok, "why": why},
        "equity": book["equity"], "available": book["available"],
        "carry": {"open": sorted(carry_st.get("open", {})),
                  "budget": settings.BINANCE_EXECUTOR_CARRY_BUDGET_USD},
        "momentum": {"basket": sorted(mom_st.get("basket", {})),
                     "top_n": mom_st.get("top_n", [])},
        "book": {"held_perps": held_perps, "expected": expected,
                 "drift": sorted(set(held_perps) ^ set(expected))},
        "spot_float": book["spot"].get("USDT", 0.0),
        "recent_actions": recent,
    }


# =================================================================== loop ====
async def executor_loop() -> None:
    logger.info("[binance-executor] loop started (enabled=%s dry_run=%s "
                "carry_tick=%ss momentum_tick=%ss)",
                settings.BINANCE_EXECUTOR_ENABLED,
                settings.BINANCE_EXECUTOR_DRY_RUN,
                settings.BINANCE_EXECUTOR_CARRY_TICK_S,
                settings.BINANCE_EXECUTOR_MOMENTUM_TICK_S)
    next_carry = 0.0
    next_mom = 0.0
    while True:
        now = time.monotonic()
        try:
            if now >= next_carry:
                next_carry = now + settings.BINANCE_EXECUTOR_CARRY_TICK_S
                res = await carry_tick()
                logger.info("[binance-executor] carry: %s", json.dumps(res)[:500])
            if now >= next_mom:
                next_mom = now + settings.BINANCE_EXECUTOR_MOMENTUM_TICK_S
                res = await momentum_tick()
                logger.info("[binance-executor] momentum: %s",
                            json.dumps(res)[:500])
        except Exception:
            logger.exception("[binance-executor] cycle crashed")
        await asyncio.sleep(60)


def maybe_start_binance_executor_loop() -> asyncio.Task | None:
    if not settings.BINANCE_EXECUTOR_ENABLED:
        logger.info("[binance-executor] disabled (BINANCE_EXECUTOR_ENABLED=false)")
        return None
    return asyncio.create_task(executor_loop())
