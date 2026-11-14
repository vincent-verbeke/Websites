#!/usr/bin/env python3
"""ibkr_spread — the 50/50 limit rule (Vincent 2026-11-11):

  "implement and review spread between last executed price and the first
   order 50/50 and let's do limit order based on that"

A BUY limit is priced HALFWAY (50/50) across the spread between

  * the LAST executed price (the last trade), and
  * the FIRST order in the book = the best ask, i.e. the first sell order a
    BUY would hit —

    limit = last + 0.5 * (ask - last)            # 50% of that spread

Guards (never over the target, never cross the book, C3 = deterministic):
  * no usable last -> 0.0, the caller skips the sleeve (as before);
  * no top-of-book (`bid-ask` missing or {}) -> LIMIT at last, the rule that
    stood before this ask (SIX lines SWDA/EIMI/GOVB returned no book when
    probed 2026-11-11, so the fallback is a real everyday case);
  * the limit is capped AT the ask: a buy limit at/above the first order
    would cross the book and fill there — never intended;
  * SNAP_TOL (5%): a snapshot `last` further than that off the trusted gate
    last is a different listing/currency (one conid can trade on SIX/LSE/
    Xetra) -> the snapshot is ignored so it can never resize a CHF target.

Pure functions only: no MCP calls, no network, no orders. The callers are
daily_invest.mcp_review_place (every sleeve) and
ibkr_watch_static.queue_small (the SMALL review-queue instruction).
"""
from __future__ import annotations

SNAP_TOL = 0.05        # |snap_last / gate_last - 1| above = another line


def _num(v):
    """Positive float or None (nulls, repeat-trade prices, junk)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def snap_last_ask(res):
    """get_price_snapshot result -> (last executed, first order/best ask).

    Response keys are hyphenated (MCP note: `bid_ask` -> `bid-ask`) and any
    part may be missing: `last.price` can be null (repeat trade at the same
    price), `bid-ask` comes back {} without a top-of-book feed. Never
    raises — (None, None) simply means "no data"."""
    if not isinstance(res, dict):
        return None, None
    lraw = res.get("last")
    last = _num(lraw.get("price")) if isinstance(lraw, dict) else _num(lraw)
    ba = res.get("bid-ask")
    ask = _num(ba.get("ask")) if isinstance(ba, dict) else None
    return last, ask


def spread_limit(last, ask):
    """The 50/50 rule itself -> (limit, rule label). See the docstring."""
    last = _num(last)
    if not last:
        return 0.0, "no live last"
    ask = _num(ask)
    if not ask:
        return round(last, 4), "at last (no top-of-book)"
    limit = min(round(last + 0.5 * (ask - last), 4), ask)   # midpoint, capped
    if limit <= 0:
        return 0.0, "no live last"
    return limit, f"50/50 last {last:g} / ask {ask:g}"


def trusted_last(gate_last, snap_last):
    """The snapshot last when it is clearly the same listing/currency as the
    trusted gate (Yahoo) last, else None."""
    g, s = _num(gate_last), _num(snap_last)
    if g and s and abs(s / g - 1.0) <= SNAP_TOL:
        return s
    return None


def limit_from(gate_last, snap, snap_note=""):
    """gate last + get_price_snapshot result -> (limit, rule label).

    `gate_last` is the already-validated Yahoo gate price (never 0 here),
    `snap` the raw snapshot result (None/{} = no read), `snap_note` why the
    snapshot batch itself failed — rendered into the label so the WhatsApp
    line always says which pricing basis an instruction used."""
    gate = _num(gate_last)
    if not gate:
        return 0.0, "no live last"
    if not isinstance(snap, dict) or not snap:
        return round(gate, 4), (f"at last ({snap_note})" if snap_note
                                else "at last (no snapshot)")
    s_last, s_ask = snap_last_ask(snap)
    last = trusted_last(gate, s_last)                 # snapshot last wins
    if last is not None:
        return spread_limit(last, s_ask)
    if s_ask and abs(s_ask / gate - 1.0) <= SNAP_TOL:
        return spread_limit(gate, s_ask)          # ask verifiable -> use it
    if s_last:                                        # present, but off-market
        return round(gate, 4), "at last (snapshot last off-market)"
    return round(gate, 4), "at last (no last in snapshot)"
