# IBKR planner → cloud port (Phase 2 of the C cutover) — Phase 2a LANDED (flag off)

## Status (2026-11-14, Phase 2a)

**Landed in the backend (behind `IBKR_PLAN_DAILY_ENABLED=false`, default off —
nothing runs until Vincent flips it):**

| Piece | Status |
|---|---|
| Trend gates (Yahoo, full verdict logic incl. stabilization note) | ✅ `src/app/services/ibkr_plan.py` (`fetch_quote`/`compute_plan`) |
| 50/50 spread rule | ✅ `src/app/services/ibkr_spread.py` (byte-identical copy of the dev module) |
| Sizing / floor-qty / ACTIVE + pending guards | ✅ `ibkr_plan._run` (same guard messages as `daily_invest`) |
| Plan state (`investments_state.json`) | ✅ `device_snapshot_cache` row `ibkr_plan_state` (import endpoint stores the dev JSON verbatim) |
| Fills reconcile BEFORE instructions | ✅ ported from `test_position_reconcile.py` expectations |
| Instruction create (REVIEW_AND_APPROVE) | ✅ in-process Phase-1 `call_tool`, daily's exact args + flow default |
| WhatsApp report per run | ✅ `whatsapp_service.send_text_message`, daily's exact wording, one message/run, +41797481975 |
| Schedule (09:05 emitter) | ✅ `ibkr_plan.plan_loop` — Mon-Fri 09:05-16:30 Europe/Zurich, marker row `ibkr_plan_marker` dedupe (**not yet registered: flag off**) |
| Parity instrument | ✅ `POST /api/v1/ibkr/plan/dry-run` (always dry) vs dev `daily_invest --check` |

**Still on the dev PC (Phase 2b — NOT part of this change):**

* **Static watcher jobs** (`ibkr_watch_static`): inbox CONID → SMALL
  instruction, CORC re-place, fill bookkeeping — `ibkr-watch.timer` stays.
* **needle3 emitter** (PC-A 09:05 SSH hop) + the dashboard `POST
  /api/investments/run` spawn of `daily_invest.py` — stays until the cloud
  runner is validated.
* Dev `investments_state.json` remains authoritative until cutover step 2
  below; after it, the cloud row is authoritative and the dev pusher writes
  are retired.

**Exact cutover steps Vincent runs (also in docs/IBKR_MCP_BACKEND.md §10.7):**

1. Deploy unchanged — `IBKR_PLAN_DAILY_ENABLED` defaults false, zero behavior
   change.
2. Seed state: `POST /api/v1/ibkr/plan/state/import` with the current
   `~/.jcode/scratch/investments_state.json`; verify
   `GET /api/v1/ibkr/plan/state` (`found:true`, `sleeve_count:8`).
3. Parity: `POST /api/v1/ibkr/plan/dry-run` (needs `IBKR_MCP_ENABLED=true`)
   and diff `rows` against `daily_invest.py --check` on the dev PC — same
   sleeves/status/trend/7d/30d/verdict/price expected.
4. Stop dev-PC emitters: needle3 09:05 emitter (`ibkr_daily_enabled=false`)
   and `ibkr-watch.timer` (Phase 2b scope for the watch jobs — at minimum the
   daily emitter must be off before enabling the cloud loop).
5. Flip `IBKR_PLAN_DAILY_ENABLED=true` + restart the backend → the 09:05
   Europe/Zurich run originates in the cloud.
6. Verify next Mon-Fri morning: `ibkr_plan_marker` payload `{date, ok:true}`,
   one WhatsApp to +41797481975, instructions in the IBKR review queue,
   fresh `gate_checked` in `GET /api/v1/ibkr/plan/state`.

---

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
