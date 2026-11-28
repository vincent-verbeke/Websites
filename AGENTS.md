# Antigravity Guidelines

## Task Tracking
- Use `bd` (Beads) for progression tracking and task management.
- bd available in c:\coding\Websites\bd.exe
- Initialize with `bd init` if not already done.
- Follow the hierarchy: `bd ready` to see what to do next.

## UI Design
- Use the `ui-ux-pro-max` skill for all UI/UX design intelligence.
- Preferred styles: Professional, modern, and high-performance.
- Fonts and Icons MUST be from [Google Fonts](https://fonts.google.com/) and [Google Material Icons](https://fonts.google.com/icons).
- Avoid third-party UI libraries unless specified.

## Angular Development
- Framework: **Angular 21** (Latest unstable/experimental features if available, otherwise latest stable).
- Architecture: Modern Angular syntax (Signals, Standalone Components, Functional Interceptors).
- Style: SCSS or Vanilla CSS (standard for the project).
- Backend: Limit to static or minimal serverless functions.
- Avoid unnecessary plugins/dependencies.

## Workflows
- Always check `.agent/workflows` for specific project steps.

## Caveman skill (installed 2026-11-14, global)

The caveman skill pack is installed globally with the `-g` option
(`npx -y skills add JuliusBrussee/caveman --skill '*' -g`, linked into
`~/.jcode/skills/` so Jcode loads it — `skill_manage list` shows all 22:
`/caveman`, `/ultracave`, `/megacave`, `/caveman-review`, `/caveman-commit`,
`/caveman-explore`, `/cavecrew`, `/surgical-patch`, `/safe-refactor`,
`/lean-build`, `/migration`, `/verify-and-stop`, `/investigate-first`, …).

**Scope rule (Vincent 2026-11-14):**

- USE caveman **for frontend and backend development only** — writing,
  editing, reviewing and committing code in `Kubotics/` (Angular frontend)
  and `Kubotics-Backend/` (FastAPI backend).
- DO **NOT** use it by default when **reasoning or thinking is required**:
  architecture decisions, root-cause/incident analysis, trading or marketing
  reviews, planning, risk and budget assessment. Normal mode stays the
  default there — say "stop caveman" if a session started in caveman mode.
- Caveman changes the *reply style* (compression), never the engineering
  bar: tests, verification steps and safety gates are unchanged.

## System topology — READ BEFORE ANY INFRA / TRADING / WHATSAPP WORK

**Full map: `Kubotics-Backend/docs/CLOUD_EDGE_TOPOLOGY.md`** (last verified
2026-11-28; re-verify live states, never trust a recorded state blindly).

- **Cloud hub** = `Kubotics-Backend` on ECS cluster `kubotics-cluster`
  (AWS profile `h2rl`), data in RDS `kubotics` (schema `crm`: needle inbox,
  contacts, followups) + `akuris` (schema `ai_trading` = trading bot state,
  owner `aitrading`). WhatsApp webhook/inbox/send, IBKR MCP + daily plan,
  lead followups, mail agent and the needle watchdog all run HERE.
- **Binance trading**: the old ECS service `ai-trading-service` is
  **REMOVED (2026-11-28: service deleted, 72 task-def revisions
  deregistered, repo auto-deploy workflow deleted)** — it had been silently
  at `desired=0` for 16 days. The live strategy = the **Binance Executor**
  IN the backend (LIVE 2026-11-28, Vincent GO: carry+momentum, place orders,
  rails + journal, 4h follow-ups for 3 days — `docs/BINANCE_EXECUTOR.md`),
  with the “Beat the Market” challenge code (`AI-Trading/jcode_strategy`,
  frozen `trading-tests`, desktop runners `ros2_reusable_stack/scripts/trading/`)
  as its reference implementation; `trading_watch` stays the independent
  read-only alerting layer (rotation-aware expected book). Other
  backend-resident trading = IBKR `ibkr_plan` + `ibkr_spread`.
- **WhatsApp flow** = Meta → cloud `crm.needle_inbox` → **PC-A**
  `needle3.service` worker (PC-B hot standby in backup mode) →
  `POST /api/whatsapp/send`. Replies are WAF-scrubbed + retried since
  2026-11-28 (needle3 `2653a9d`/`bb4410e`); a cloud watchdog alerts stuck
  rows.
- **Edge**: PC-A `.199` (`ssh wa@`, root via `/etc/sudoers.d/90-agent`),
  PC-B `.170` (`ssh vincent@`, same), dev PC `.161` (sessions, code).
- Standing rules: review-first GO for money/ads/brand, English replies,
  confirm destructive actions even with root.

## CI / GitHub Actions
- **Only `.github/workflows/` at the REPO ROOT executes.** Workflow files in
  subdirectories (e.g. `Kubotics-Backend/.github/workflows/deploy.yml`) are
  silently ignored by GitHub — edit the root pipeline, never a nested copy.
  (2026-11-08 incident: MIMO/XAI secret mapping + the pytest gate sat in a
  dead nested file for hours while the live pipeline ran without them; see
  `Kubotics-Backend/docs/KUBOT_MAIL_AGENT_PLAN.md` §7.4/6. The live pipeline
  `/.github/workflows/deploy.yml` gates every deploy with
  `uv run --frozen pytest -q` — keep that gate green before pushing.)
