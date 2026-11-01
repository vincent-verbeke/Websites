# PROMPT — Website agent: run the dashboard in the cloud, PC-A becomes the Needle scheduler

> Copy this whole document to the website agent. Prepared 2026-11-01 (Jcode),
> aligned with `kubotics_agentic_gtm_plan_2026-11-01.md`. **Website / landing
> pages are handled by a different agent — do not touch them.**

## 0. Context you can rely on (already true today)

- **The cloud container exists and is live**: `Kubotics-Backend` (FastAPI +
  PostgreSQL) runs as an **AWS ECS Fargate** service behind CloudFront at
  `https://api.kubotics.ch` (CI/CD: `.github/workflows/deploy.yml` in the
  `Coding/Websites` repo root → ECR → rolling update on push to `main`).
  `GET /health` → `{"status":"healthy","environment":"production"}`.
- The **same container already hosts WhatsApp**: `GET|POST
  /api/whatsapp/webhook` answers (verify-challenge + ingest) and the operator
  lane persists into `needle_inbox`.
- The **same container already hosts the Needle intake**: `/api/v1/needle/{inbox,ack,inject}`
  guarded by `X-Needle-Token` (401 without it). Tables `needle_inbox`,
  `agent_runs`, `agent_tool_calls`, `agent_actions`, `conversations`,
  `messages`, `opportunities`, … already exist in the `crm` schema.
- **Today's dashboard lives on PC-A**, not in the cloud: `edge_app`
  (`~/wa-web`, uvicorn `:8001`) serves the SPA, answers `/api/*` reads from a
  snapshot cache that the dev PC pushes into (`POST /api/ingest/<dataset>` with
  a Bearer token), and **relays** everything else to the dev-PC app
  (control POSTs → robot, streams pass through), fail-closed: dev PC
  unreachable ⇒ `502 {"error":"robot offline"}`. Design reference:
  `development/ros2_reusable_stack/docs/DASHBOARD_MIGRATION_PLAN.md` (read it —
  DTO shapes, `updated_at` + `source: "cache"` freshness, cache-file semantics).
- **PostgreSQL is the only commercial system of record. No HubSpot.**

## 1. Goal

1. **Frontend + backend move into the cloud**: the dashboard (SPA + its API)
   is served from `api.kubotics.ch` (static assets may stay on the existing
   frontend hosting/CDN, but **no serving or relay role may remain on PC-A**).
2. **PC-A is demoted to the Needle scheduler only**: it polls the cloud for
   work, tracks task status, and dispatches tasks to agents (dev sessions).
   It must no longer serve the dashboard, proxy reads, or hold dashboard state.

## 2. Backend work (`Kubotics-Backend`)

1. **Task model** — add a `tasks` table (or an equivalent that reuses
   `agent_runs`/`agent_actions` instead of duplicating them):
   `id, event_id (UNIQUE, idempotency), type, payload(jsonb), status
   (queued|assigned|running|succeeded|failed|cancelled|needs_approval),
   assignee, priority, correlation_id, lease/heartbeat timestamps,
   created/started/finished, error, result(jsonb)`.
2. **Scheduler API** (auth: a dedicated scheduler token, same pattern as
   `X-Needle-Token`; separate from human auth):
   - `GET  /api/v1/tasks?status=&after_id=` — poll queue with cursor
   - `POST /api/v1/tasks/{id}/claim` — lease/claim (idempotent, single-claimer)
   - `PATCH /api/v1/tasks/{id}/status` — `assigned|running|succeeded|failed`,
     heartbeat, terminal outcome + error text
   - `GET  /api/v1/events?after_id=` — normalized inbound events (website,
     Telegram, WhatsApp) for trigger/evaluation work
   - `POST /api/v1/agent/output` — structured agent decisions (contract §5.7)
3. **Normalize inbound**: website, Telegram and WhatsApp messages become the
   same lead/conversation records with **UTM + first-touch/last-touch
   attribution never overwritten** (GTM §10.3, backlog P0).
4. **Event contract** (GTM §5.6): idempotency by `event_id`, correlation IDs
   spanning trigger → run → tool call → result, bounded retry with backoff,
   dead-letter/failed-trigger visibility, Europe/Zurich schedules, freshness
   guard (*no action when source data is stale, incomplete or contradictory*),
   every run has a status and terminal outcome.
5. **Dashboard API** (GTM §10.2): spend, reach, website, conversations,
   sales, economics, **agentic operations** (needle triggers, runs, failures,
   decisions, approvals, actions) and quality metrics — all computed from
   Postgres, each payload carrying `updated_at` + a freshness/stale flag.
6. **Control path to the robot** (today: PC-A relay → dev PC → robot): the
   cloud cannot reach the LAN, so replace the relay with an **outbound-pull
   command channel**: the dev-PC side long-polls or consumes queued control
   commands and posts results back; reads keep the existing
   *push-snapshot → ingest* pattern (dev PC/robot push into the cloud
   `POST /api/ingest/<dataset>` equivalent, Bearer-tokened, cache-first
   reads). Preserve fail-closed semantics: unreachable source ⇒ explicit
   error/stale state, **never silently queued or zeroed values**.
7. **Security**: no secrets in the repo or the SPA bundle; human views behind
   the existing M365 auth; scheduler/ingest tokens server-side only; approval
   gate for material external actions (campaign creation, budget increases,
   public publishing — GTM §6.4).

## 3. Frontend work (Kubotics Angular app)

1. Dashboard becomes a first-class area of the app (own route guard), base URL
   `https://api.kubotics.ch` via environment config — **no hardcoded LAN IPs,
   no dependency on PC-A**.
2. Views: task/scheduler status (queue, running, failures, assignees,
   heartbeats), GTM metrics dashboard per §10.2, leads/conversations
   (Postgres records), robot/H2 control + streams via the new cloud
   endpoints, freshness/stale badges on every live panel.
3. Live updates: polling or SSE with graceful degradation; show data
   freshness; **display stale as stale, never fabricate zeros**.
4. Keep de/en site language; desktop-first; reuse existing components where
   possible.

## 4. Explicitly out of scope (other agents / other owners)

- Website pages, landing pages, homepage hierarchy, SEO (separate agent).
- PC-A provisioning, `needle3` daemon changes, WhatsApp send-path moves
  (Jcode owns those — code the PC-A side against your published contract).
- Budget/policy logic decisions (GTM §6 owns them; just enforce the approval
  gate).

## 5. Acceptance criteria

- Dashboard reads and task lifecycle work **with PC-A stopped** (prove it: PC-A
  offline ⇒ dashboard still serves reads and shows the source as stale/offline
  where applicable).
- End-to-end task flow visible in one correlation ID: event → task queued →
  claimed → running → succeeded/failed, with the agent's structured output
  stored (§5.7 contract).
- Replaying the same inbound event creates exactly **one** task (idempotency
  test).
- Snapshot feed dies ⇒ UI shows stale/offline, not silent zeros.
- `pytest` + frontend tests green in CI, migrations reversible, no secrets
  committed, OpenAPI documented (the PC-A side will be coded from your
  OpenAPI/README — publish the final endpoint contracts there).
- Works for the 2–8 Nov go-to-market test window (GTM §8) with Europe/Zurich
  scheduling.

## 6. Deliverables

1. Backend: models/migrations + scheduler/events/dashboard endpoints + tests.
2. Frontend: dashboard area wired to the cloud, environments, stale states.
3. `README`/OpenAPI section: exact request/response shapes for
   `tasks`, `events`, `agent/output`, `ingest` — **this is the contract PC-A
   (needle3) will implement against**.
4. Short cutover note: what stops running on PC-A and when, and the rollback
   (PC-A dashboard returns with one systemctl command until decommissioned).
