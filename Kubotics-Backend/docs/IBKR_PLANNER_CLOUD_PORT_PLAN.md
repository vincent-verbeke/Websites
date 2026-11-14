# IBKR planner → cloud port (Phase 2 of the C cutover) — plan, not yet approved

Context: Vincent 2026-11-14 — *"ONLY C … Cloud needs to run without the dev pc."*
Phase 1 (done tonight) moves every **MCP interaction** into the Kubotics
backend: feed bursts, reads via `POST /api/v1/ibkr/mcp/call`, staged review
orders via `/api/v1/ibkr/instructions`. The **planner** still computes on the
dev PC and now calls the cloud for MCP work. This document maps what is left
to move so the dev PC can be switched off entirely.

## What runs where after Phase 1

| Step | After Phase 1 | Needs dev PC? |
|---|---|---|
| MCP reads (positions/orders/instructions/prices) | backend (cloud token) | no |
| Instruction create (REVIEW_AND_APPROVE) | backend | no |
| Feed → dashboard | backend poller | no (pusher retired) |
| Trend gates (Yahoo), 50/50 spread rule, qty sizing | `daily_invest.py` | **yes** |
| Plan state (`~/.jcode/scratch/investments_state.json`) | dev PC file | **yes** |
| WhatsApp report per run | `daily_invest` → wa.py | **yes** |
| Schedule (09:05 emitter, static watcher) | needle3 on PC-A → SSH → dev PC | **yes** |

## Port inventory (dev PC → backend)

1. **Gates**: `web/server/investments.py::metrics/summary` (Yahoo chart API)
   → backend `httpx` fetch + same trend rule (last7d ≥ +0.5 / ≥ −0.5 / ≥ −4.0,
   range_pos 30d). Pure logic, unit-testable against the existing batteries
   (`test_daily_invest_only.py`, `test_spread_rule.py` expectations).
2. **Spread limit**: `scripts/ibkr/ibkr_spread.limit_from` — pure, port as-is.
3. **Sizing**: remaining-target / limit / floor-qty / ACTIVE-order guard —
   from `daily_invest._chf…` section; keep byte-identical semantics.
4. **Plan state**: replace `investments_state.json` with a backend row
   (single JSON doc, e.g. `device_snapshot_cache` dataset `ibkr_plan_state`
   or a small table) — migration rule: dev-PC file remains the seed, one-way
   import at cutover, then backend is authoritative.
5. **Notify**: backend already has `whatsapp_service` (cloud send) — same
   message shape as `daily_invest` today.
6. **Scheduling**: emit from the backend lifespan loop (pattern:
   `trading_watch.watch_loop`, calendar 09:05–16:30 Europe/Zurich, dedupe by
   date) — replaces the needle3 emitter + SSH hop; needle3 emitter gets
   `ibkr_daily_enabled=false` at that cutover.
7. **Static watcher jobs** (inbox CONID → one SMALL instruction, CORC
   re-place, fill bookkeeping) → same backend module; `ibkr-watch.timer`
   retired on the dev PC.

## Why Phase 2 is held for a GO (not rushed tonight)

- It is the **money-path planner**: sizing/state semantics must stay
  byte-identical (the existing batteries are the spec).
- Phase 1 gives the reliability goal (cloud holds auth + MCP; dev PC can die
  without breaking reads or the review queue). Phase 2 removes the last
  compute dependency — worth a deliberate morning review with Vincent, then
  one worker port + full battery migration.

## Acceptance for Phase 2

- Backend-only dry run reproduces tonight's plan (same sleeves/verdicts/
  limits) from an imported state copy.
- Dev PC timers disabled; 09:05 run originates in the cloud; WhatsApp report
  arrives; instructions land in the IBKR review queue; zero refresh attempts
  outside the backend (token-file mtime invariant, as proven in Phase 1).
