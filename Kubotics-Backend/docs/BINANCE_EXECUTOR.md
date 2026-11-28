# Binance Executor

Vincent's GO (2026-11-28, WhatsApp): *"Yes, pls call it **Binance Executor**
from now on, verify, verify against the current market conditions, ensure we
do live trading, not paper trading and port it to the backend, pls note to
follow-up each 4 hours the first 3 days."*

The executor is the **"Beat the Market" challenge stack ported from the
frozen desktop harness** (`AI-Trading/jcode_strategy/`, frozen copy in
`trading-tests@4040c66`) into this backend. It runs alongside — and does not
replace — `trading_watch` (the independent read-only watcher).

## What it trades

| Leg | Rule (unchanged from the challenge) | Cadence |
|---|---|---|
| **Carry (CORE)** | Delta-neutral funding carry: spot BUY first, perp SHORT only after the spot fill, 1:1 paired, up to `CARRY_TOP_N` pairs, per-pair notional `budget × alloc / topN` = 200 USDT. Ranked by live 30d funding (positive only). Exit after `FUNDING_EXIT_STREAK=3` consecutive non-positive 8h intervals: perp close first, then spot. | `CARRY_TICK_S=3600` |
| **Momentum (SATELLITE)** | Rank all Binance USDT/USDC perpetuals by formation momentum (60 × 4h closes, ≥90% coverage). Hold top-N as PM perp LONG legs at `MOMENTUM_NOTIONAL_USD=12.5` per pair (the 2026-10-25 rotate precedent). Rotate: tracked legs that fall out of the top-N are closed; carry pairs and untracked legs are never touched. | `MOMENTUM_TICK_S=21600` (4h) |

Carry candidate universe = challenge `LIQUID_OK` spot map (13 pairs,
`CARRY_SPOT_MAP` in the service).

## Safety rails (Vincent's — never widened here)

Checked **before every decision** (`rails_ok()`):

1. `BINANCE_EXECUTOR_STOP` env kill-switch + DB key `carry.stop`
   (`POST /api/v1/binance/executor/stop {"on": true}`).
2. Daily stop: day PnL ≤ −`0.5% × budget` (−20 USDT).
3. Drawdown halt: `equity + realized < budget × (1 − 20%)`.
4. Hedge mode with explicit `positionSide` (SHORT for carry perps, LONG for
   momentum); carry perp orders only ever follow a filled spot leg.
5. Quantities floored to the exchange LOT_SIZE step — and the challenge
   quantity bugfix survives (`100.00000000` → `"100"`, never `"1"`).
6. `trading_watch` (separate service) keeps alerting on any book drift —
   an executor bug that moves the book trips the independent watcher.

**State is derived from the live book every tick** (positions + spot), so a
crash can never double-enter: the exchange, not our memory, is authoritative.
The existing 13-leg challenge book (5 carry shorts + 8 momentum legs) is
*adopted*, never re-bought.

## Modes (Vincent's "live, not paper" condition)

| Flag | Default | Meaning |
|---|---|---|
| `BINANCE_EXECUTOR_ENABLED` | `false` | loop off; API still serves status/run/stop |
| `BINANCE_EXECUTOR_DRY_RUN` | `true` | `_place()` logs + journals, never POSTs an order |

Dry is the **code default** (repo law: hidden mutations blocked by default;
review-first money gate). Going live = set `BINANCE_EXECUTOR_ENABLED=true`
**and** `BINANCE_EXECUTOR_DRY_RUN=false` in the task definition + deploy —
an explicit, recorded GO. Every decision (dry or live) lands in
`binance_executor_orders` with mode, cycle id and exchange response.

## API (scheduler token, same as trading-watch)

- `GET  /api/v1/binance/executor/status` — rails, equity, open pairs,
  momentum basket/top-N, book drift vs `TRADING_WATCH_EXPECTED_PERP`,
  last 15 journal rows.
- `POST /api/v1/binance/executor/run {"mode": "all|carry|momentum|sync|book"}`
  — one cycle; honors DRY_RUN.
- `POST /api/v1/binance/executor/stop {"on": true, "reason": "..."}` — kill.

## Tables (auto via `Base.metadata.create_all`)

- `binance_executor_state` (kv JSON): `carry` (open, day_pnl, realized,
  stop) and `momentum` (basket, formation, adopted).
- `binance_executor_orders`: append-only journal (kind, symbol, side, qty,
  notional, mode, cycle, result JSON).

## Go-live + the first 3 days (Vincent's condition)

1. Deploy with flags ON: `ENABLED=true`, `DRY_RUN=false` (task definition;
   Binance keys already flow into the same task for `trading_watch`).
2. First live cycle must show journal rows with `mode=live` and exchange
   `code=200` — verify the book did NOT churn (adoption: zero redundant
   entries).
3. **4-hour follow-ups for 72 hours** (18 checks): status snapshot vs the
   13-leg expectation, equity/available, rails `ok`, any `SKIP`, journal
   anomalies (repeated -1023/-1015 rejects, spot-deferred pairs), funding
   streaks close to exit, and trading_watch problem count = 0.
4. Kill any time: stop endpoint (applies within one cycle) or flag off +
   redeploy.

## Failure modes → behavior

- Spot leg fails/underfills → **no perp order** (deferred; never naked).
- Perp hedge fails after spot fill → journal `RE-HEDGE pending`, next tick
  closes the gap from the live book.
- API/DB down mid-cycle → exception logged, next tick re-derives from the
  book; watch ties to needle watchdog for backend-down visibility.
- `rails not ok` → every tick journals `*_SKIP` with the reason (no
  silence).
