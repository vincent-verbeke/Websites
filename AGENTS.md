# Websites Repository Guidelines (`Kubotics/` & `Kubotics-Backend/`)

*(Inherits global Caveman routing, `docs/` & status tracking lifecycle, `uv`/Async SQLAlchemy, and Angular 22+/Tailwind standards from `../AGENTS.md`.)*

## 1. Documentation & Status Tracking (`Websites`)
- **Feature Specs & Progress:** Track all new features and multi-step fixes in `docs/features/<issue-id>-<slug>.md` (following `feature-tracker` skill). Keep status headers (`In Progress | Blocked | Ready for Review | Done`) and `- [ ]` / `- [x]` checklists updated on every commit.
- **Architecture & Runbooks:** Operational/system docs live in `Kubotics-Backend/docs/` (e.g., `CLOUD_EDGE_TOPOLOGY.md`, `BINANCE_EXECUTOR.md`, `KUBOT_MAIL_AGENT_PLAN.md`). Update them whenever infra, schemas, or live services change.
- **Task Queues:** Sync cross-PC work via `gh issue list` and `git fetch --all`. 
- **Workflows:** Always check `.agent/workflows` for specific project steps.
- **Boundary with `ros2_reusable_stack`:** `Kubotics/` + `Kubotics-Backend/` is the **cloud/multi-robot SaaS & trading/WhatsApp hub**. On-robot H2 hardware control, DDS, and the local H2 edge UI (`web/`) live exclusively in `ros2_reusable_stack`.


## 2. UI & Frontend (`Kubotics/`)
- **Framework:** **Angular 22+** (Zoneless, Standalone Components, `inject()`, Signals, `httpResource`/`resource`, Signal Forms, Vitest).
- **Styling & Assets:** **Tailwind CSS** (utility-first), **Angular Aria** for accessible primitives, [Google Fonts](https://google.com), and [Google Material Icons](https://google.comicons). Avoid third-party UI libraries unless explicitly specified.
- **UI/UX Intelligence:** Use the `ui-ux-pro-max` skill for UI/UX design decisions (professional, modern, high-performance).

## 3. System Topology — READ BEFORE ANY INFRA / TRADING / WHATSAPP WORK

**Full map: `Kubotics-Backend/docs/CLOUD_EDGE_TOPOLOGY.md`** (last verified 2026-11-28; re-verify live states, never trust a recorded state blindly).

- **Cloud hub:** `Kubotics-Backend` on ECS cluster `kubotics-cluster` (AWS profile `h2rl`), data in RDS `kubotics` (schema `crm`: needle inbox, contacts, followups) + `akuris` (schema `ai_trading` = trading bot state, owner `aitrading`). WhatsApp webhook/inbox/send, IBKR MCP + daily plan, lead followups, mail agent, and the needle watchdog all run HERE.
- **Binance trading:** The old ECS service `ai-trading-service` is **REMOVED (2026-11-28: service deleted, 72 task-def revisions deregistered, repo auto-deploy workflow deleted)** — it had been silently at `desired=0` for 16 days. The live strategy is the **Binance Executor** IN the backend (LIVE 2026-11-28, Vincent GO: carry+momentum, place orders, rails + journal, 4h follow-ups for 3 days — `docs/BINANCE_EXECUTOR.md`), with the "Beat the Market" challenge code (`AI-Trading/jcode_strategy`, frozen `trading-tests`, desktop runners `ros2_reusable_stack/scripts/trading/`) as its reference implementation; `trading_watch` stays the independent read-only alerting layer (rotation-aware expected book). Other backend-resident trading = IBKR `ibkr_plan` + `ibkr_spread`.
- **WhatsApp flow:** Meta → cloud `crm.needle_inbox` → **PC-A** `needle3.service` worker (PC-B hot standby in backup mode) → `POST /api/whatsapp/send`. Replies are WAF-scrubbed + retried since 2026-11-28 (needle3 `2653a9d`/`bb4410e`); a cloud watchdog alerts stuck rows.
- **Edge nodes:** PC-A `.199` (`ssh wa@`, root via `/etc/sudoers.d/90-agent`), PC-B `.170` (`ssh vincent@`, same), dev PC `.161` (sessions, code).
- **Standing rules:** Review-first GO for money/ads/brand, English replies, confirm destructive actions even with root.

## 4. CI / GitHub Actions
- **Only `.github/workflows/` at the REPO ROOT executes.** Workflow files in subdirectories (e.g., `Kubotics-Backend/.github/workflows/deploy.yml`) are silently ignored by GitHub — always edit the root pipeline, never a nested copy.
- *(Context: 2026-11-08 incident where MIMO/XAI secret mapping + pytest gate sat in a dead nested file.)*
- The live pipeline `/.github/workflows/deploy.yml` gates every deploy with **`uv run --frozen pytest -q`** — always keep that gate green before pushing.
