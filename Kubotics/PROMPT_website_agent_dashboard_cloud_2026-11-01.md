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

## 7. Integration plan updates — Vincent's decisions, 2026-11-01 (binding)

1. **AWS only.** There is **no Azure container** ("we have no azure
   containers => All on AWS"); do not design for Azure. Everything (backend,
   WhatsApp, dashboard, send path) targets the existing AWS ECS container
   `api.kubotics.ch`. Anything you find that references an Azure container
   target should be re-pointed to AWS. (Entra ID / M365 auth stays — that is
   identity, not hosting.)
2. **Integrate the WhatsApp send path into the container.** Add the send API
   to `Kubotics-Backend` — this is the contract PC-A (needle3) and other
   callers will be re-pointed to:
   - `POST /api/whatsapp/send` — `Authorization: Bearer <SEND_TOKEN>`,
     JSON `{"session": "<label>", "to": "<e.164>", "text": "..."}`; also
     accept needle3's current shape `{"session","text"}` with `to`
     defaulting to the configured operator number →
     `{"ok": true, "wamid": "..."}`
   - `GET /api/whatsapp/send/health` → token/config presence + last-send
     status, **no secrets in the response**
   - Failure semantics: answer non-2xx (502) when the Graph API call failed,
     so callers retry; 2xx only after Meta accepted the message. Bounded
     retry on transient Graph errors. Document the choice in the README.
   - Cutover: once live, Jcode switches PC-A needle3 `send_url` from
     `http://192.168.1.199:8444/api/whatsapp/send` to
     `https://api.kubotics.ch/api/whatsapp/send`. **Flag this endpoint in
     the PR description** so both sides move the same day.
3. **Consolidate the Meta access-token holders in the same move.** Today two
   holders exist: `ros2_reusable_stack/scripts/whatsapp/wa_config.json`
   (dev PC) and `~/wa-edge/edge_config.json` (PC-A). Target state: **one
   holder — the container.** Sequence: (a) land the send API, (b) rotate the
   Meta token in the WABA, (c) store the new token only in the ECS task
   definition / secrets, (d) callers (`wa.py` from Jcode sessions, `wa_core`
   on PC-A, needle3) switch to the container endpoint, (e) old files emptied
   and marked deprecated — **do not delete them in the same PR** (rollback
   needs them for one week). Announce the rotation window to Jcode so no
   scheduled run fires with a stale token (IBKR reports + watchdog alerts use
   `wa.py` today).
4. **Needle + WhatsApp verify tokens stay as-is** (validated identical
   between ECS task env and local `.env` on 2026-11-01) — no rotation needed
   in this move.
5. **Infra facts you can rely on (fixed/verified 2026-11-01):** CloudFront
   now forwards all viewer headers and query strings to the origin (managed
   origin-request policy `AllViewer` on `api.kubotics.ch`) — previously
   `X-Needle-Token` and query params were silently stripped; the ECS service
   now has its target group **attached** (ECS registers/deregisters task ENIs
   itself); deployment circuit breaker with rollback is active and was
   observed auto-rolling back a failed deploy at 13:02 with prod at 200
   throughout. Do not remove the origin-request policy or detach the load
   balancer when touching CI/CD.

## 8. P0 breakage from commit `a990349` — backend deploy is failing (Jcode, 2026-11-01 12:52)

The ECS deployment of `kubotics-backend-task:8` (image `a9903496…`) crashes at
import, so the new dashboard/scheduler API **is not live**:

```
File "/app/src/app/main.py", line 10, in <module>
  from app.api.v1.cloud_dashboard import router as cloud_dashboard_router
File "/app/src/app/api/v1/cloud_dashboard.py", line 17, in <module>
  from app.models.entities import Lead, Conversation, Organization
ImportError: cannot import name 'Lead' from 'app.models.entities'
```

- `class Lead` does not exist anywhere in the backend (only
  `LeadProcessingService` and the `LeadResponse` schema); the `lead_service`
  persists inbound leads as **`Contact` rows with `lifecycle_stage='lead'`**,
  and there is no `leads` table in Postgres.
- `Lead` is used in exactly one place: line 244
  `leads_count = (await db.execute(select(func.count(Lead.id)))).scalar() or 0`.
- Suggested fix (pick one and state the choice in the PR):
  1. **Preferred:** `leads_count = count(Contact.id).where(Contact.lifecycle_stage == 'lead')`
     (matches how `lead_service.process_inbound_lead` actually stores leads),
  2. or add the `Lead` model/table you intended and keep line 244 — then it
     needs a migration + backfill decision.
- Blast radius so far: **prod stayed up** on the previous task def (`:7`,
  health 200 the whole time) because `minimumHealthyPercent=100`; the
  deployment circuit breaker is armed and will roll the failed revision back.
  Expect CI `wait-for-service-stability` to fail on this run.
- Verification once fixed: `GET https://api.kubotics.ch/health` 200 **and**
  `GET /api/v1/dashboard/summary` answering (401 without token is fine —
  anything but 404/502 means the new routers loaded), then check the ECS
  deployment shows `COMPLETED`.

### §8 update — **RESOLVED by Jcode hotfix, 2026-11-01 13:20** (supersede freely)

Three defects were blocking the deploy; all fixed, locally validated with
TestClient route probes (see evidence below), pushed as one commit:

1. **ImportError `Lead`** (original §8): count now uses
   `Contact.lifecycle_stage == 'lead'` (how `lead_service` actually stores
   leads). Keep or replace with a dedicated `Lead` model — but then add a
   migration.
2. **Double `/v1` prefix** (new): `APIRouter(prefix="/v1")` inside a router
   already mounted at `/api/v1` made every documented path live at
   `/api/v1/v1/...` — the frontend's `/api/v1/tasks` and
   `/api/v1/dashboard/summary` would 404 even after fix 1. Prefix removed.
3. **New tables never created in prod** (new): prod runs `DEBUG=false` and
   the repo ships no alembic versions, so `lifespan`'s `create_all` never ran
   and `scheduled_tasks/inbound_events/device_snapshot_cache/agent_outputs`
   would not exist in RDS (500 on first use). `create_all` now runs in every
   environment, wrapped so a DB hiccup can't block boot. **Replace with
   alembic migrations** when you set up the migration workflow (alembic is
   already a dependency).

Validation evidence (local, same venv/DB as the service): `/health` 200,
`/api/v1/tasks` 401 (routed + token enforced), `/api/v1/v1/tasks` 404
(old path gone), `/api/v1/events` 401, `/api/v1/dashboard/summary` 200
(`kpis/is_stale/updated_at`), `/api/v1/agent/output` 405 on GET (POST-only),
all four new tables present.

**CI note:** `deploy.yml` has no `paths:` filter — every push to `main`
(including docs-only) rebuilds and redeploys the backend (observed:
task `:9` triggered by a docs commit at 13:07, crash-cycle, breaker rolled
back). Please add a `paths: [Kubotics-Backend/**, .github/**]` filter so
docs and frontend pushes don't churn ECS.

### §8 update 2 — **PROD CONFIRMED 2026-11-01 13:29**

ECS deployment of the hotfix: `COMPLETED`; stability 3/3 → `/health` 200, `/api/v1/dashboard/summary` 200 (`kpis: total_leads 7→8` after a live form test), `/api/v1/tasks` 401 (token enforced), old `/api/v1/v1/*` 404. Live form E2E: `POST /api/v1/leads` with UTM → 201, contact+deal created, dashboard KPI incremented. Site chat verified as client-side only — `/api/v1/chat/message` (session_token) is unused by the SPA.

### §7.3 status addendum (Jcode, 2026-11-01 13:40) — do not undo these

- **Send credentials are now IN the repo task definition** (`.aws/task-definition.json`
  literals `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, same precedent
  as `NEEDLE_TOKEN`) **and layered in `deploy.yml`** (a GitHub secret with the
  same name overrides the literal automatically). Reason: a manual ECS task
  def I registered (`:15`) was silently dropped when CI re-registered from the
  repo (`:16`/`:17`) and the send client went back to `configured:false`.
  If you add GitHub secrets later, nothing else needs changing.
- **Token-holder inventory for the rotation step:** PC-A `edge_config.json`,
  dev-PC `wa_config.json` and local `Kubotics-Backend/.env` all hold the
  **same** Meta access token (206 chars, hash-verified identical). After the
  WABA rotation: update the repo JSON literal (+ GitHub secret if added),
  update `wa.py`'s `wa_config.json` (IBKR reports still use it), empty
  `edge_config.json` (retirement `sched_dac894f2`, 2026-11-08).
- `needle3` on PC-A already sends with `Bearer <NEEDLE_TOKEN>` and
  `send_url=https://api.kubotics.ch/api/whatsapp/send` (cutover verified with
  a `wamid` receipt at 13:35).

## 9. Work queue for the website agent — Vincent-approved 2026-11-01 13:53 (this supersedes ad-hoc asks)

Do **not** re-implement anything in §7.3/§8 (done by Jcode, marked interim).
Vincent's decisions baked in: **C2** spend caps + approval gate also in the
dashboard UI; **C3** *Needle becomes the single orchestrator, independent of
external LLM; the IBKR schedule moves under it too.*

### P0 — spend gate (Day-1 blockers)
1. **Persist attribution (readiness B2).** Columns on the lead/contact record
   for `utm_source/medium/campaign`, `gclid`, `referrer_url`, **first_touch
   (immutable)**, `last_touch`; map them in `lead_service`; expose in reads for
   the dashboard. *Accept: form POST with UTM query visible via a read endpoint
   within the same minute.*
2. **Consent + suppression (B3).** Consent state + timestamp on the contact;
   suppression list enforced by every outbound path (container send API,
   Telegram/Teams adapters, agent sends). *Accept: suppressed contact produces
   no send attempt (502/200 both blocked earlier).*
3. **Spend caps + approval gate incl. DASHBOARD UI (B5, C2).** Enforce
   CHF 100 total / CHF 70 Search server-side; tasks entering `needs_approval`
   for: campaign create, budget increase, external publish (GTM §6.4);
   dashboard shows remaining caps + Approve/Reject controls that PATCH the
   task; audit rows for decision + actor. *Accept: over-cap action without an
   approval record is rejected at the API, and the approval button moves
   queued → running from the UI.*

### P0 — ops hygiene
4. **CI paths filters**: `deploy.yml` → `[Kubotics-Backend/**, .github/**]`;
   `deploy-frontend.yml` → `[Kubotics/**, .github/**]`. Today every docs push
   rebuilds and redeploys ECS (observed 3 churn rollouts on 2026-11-01).
5. **Alembic baseline**: replace the `create_all`-in-all-envs shim (Jcode
   interim in `main.py`) with migrations covering the tasks tables; then
   decide: keep the `Contact.lifecycle_stage='lead'` count (interim) or add a
   real `Lead` model + backfill.

### P1 — single-orchestrator architecture (C3)
6. **Scheduling on `ScheduledTask`** (missing today — the model has only
   lease/heartbeat/status): add `run_at` (one-shot), `cron` + `timezone`
   (default `Europe/Zurich`), recurrence materialization into queued tasks;
   `GET /tasks?due=true` filter; `POST/GET/DELETE /api/v1/schedules` CRUD;
   documented task types incl. **`ibkr_run`** and `campaign_eval`.
7. **Freeze the worker contract** (README/OpenAPI, prompt §6.3): exact
   shapes for `GET /tasks`, `POST /tasks/{id}/claim`, `PATCH
   /tasks/{id}/status`, `POST /agent/output` — Jcode implements the needle3
   consumer against it and consumes item 6 for IBKR.
8. **Control/streams channel** replacing PC-A `edge_app` relay: Bearer
   snapshot ingest (`POST /api/v1/ingest/{dataset}`) + queued control commands
   the dev side pulls (fail-closed, never queued-blind) — unblocks retiring
   `edge_app:8001`.
9. **Campaign metrics ingestion (B4)** + the metrics endpoint Needle's daily
   evaluation reads (GTM §9 checklist).

### P1 — cleanup / decisions
10. **WhatsApp secrets**: repo literals + `deploy.yml` layering are in place;
    add GitHub secrets when you have portal access (rotation order in §7.3
    addendum). Decide: keep `/api/v1/chat/message` (unused by the SPA,
    requires an unissued `session_token`) or remove it.
11. **Booking E2E** owner: Vincent clicks through the booking page (a19);
    you verify the resulting lead + Teams meeting rows land in Postgres.

### Interface note (both sides)
Jcode (needle3) will implement the worker consumer + the IBKR migration
**after items 6–7 land**, and the IBKR run stays on the Jcode schedule
(`sched_2bb68117`) until a needle-scheduled run is proven — no gaps in the
money path. Everything deterministic stays out of LLM calls (needle3's
router/gates are already model-free).

**§9 item 7 status — Jcode's worker is LIVE (2026-11-01 14:02), build your
producers against this:** needle3 on PC-A now polls `GET /api/v1/tasks?status=queued`
every 10 s as assignee **`pc-a-needle`** (auth `X-Needle-Token`), claims with a
300 s lease, heartbeats via `PATCH /tasks/{id}/status`, and executes through
the proven SSH forced-command boundary. Contract expectations for producers:
- task `type` must be in the allowlist **`dev_task`, `ibkr_run`** (extend the
  allowlist with me if you need more — foreign types are left queued on
  purpose so your agent-side work is never consumed by us);
- `payload` needs **`text`** (the instruction to run) and optionally
  **`session`** (dev-session name; auto `n3t-<id8>` otherwise);
- on completion we PATCH `succeeded` with `result: {session, tail}` or
  `failed` with `error` (≤500 chars).
Validated: 11/11 offline contract tests (allowlist, 409 conflicts, heartbeats,
terminal-state immutability, auth header) + live prod read (`count: 0`,
`run_cycle -> idle`). The `ibkr_run` path activates after your §9.6 scheduling
fields exist (Jcode a23).

**§9.7 addendum — `ibkr_run` is executable end-to-end (Jcode, 14:12).** For your
§9.6 scheduler, an `ibkr_run` task's payload is simply
`{"mode": "check" | "run", "session"?: "<name>"}` — **no `text` needed**; the
worker routes it to a dedicated deterministic boundary verb `n3ibkr` (three
independent mode allowlists, argv built dev-side from a fixed
interpreter+script pair, **no model anywhere in the money path**). `check` =
`daily_invest.py --check` (gates/state only, zero orders), `run` =
`daily_invest.py --yes --auth-wait 240` (the sanctioned run). Result tail =
daily_invest stdout. Proven live through the real SSH boundary: check-mode
returned `done rc=0` with the gate table (`IWDC … BUY 92.8`), 15/15 worker
tests green. Suggested schedule payload for the daily run:
`{"type": "ibkr_run", "payload": {"mode": "run"}, "cron": "55 8 * * 1-5",
"timezone": "Europe/Zurich"}` (times per §9.6; worker claims as `pc-a-needle`).

**§9 interface gap found (Jcode, 14:28): `GET /api/v1/tasks` is the ONLY
method — there is no task-creation endpoint.** Verified against live OpenAPI:
no `POST /tasks`, no `POST /events`. Consequences:
1. Ad-hoc producers (marketing evaluation triggers, follow-ups, manual runs)
   have no way to enqueue work; only your internal code can insert
   `ScheduledTask` rows today.
2. Jcode's worker claim/PATCH cycle is validated against a contract stub +
   prod **reads** (count/idle) but cannot be proven end-to-end until one real
   task exists — my worker is ready the moment a row appears.
3. For §9.6 please include a creation path with the scheduler: either
   `POST /api/v1/tasks {type, payload, correlation_id?, priority?, run_at?}`
   (idempotent via `event_id`, same auth as claim) **or** document that
   schedules are the only producer and ad-hoc creation is out of scope.
Until then my a23 (IBKR-through-needle) waits on §9.6 + this, and the Jcode
schedule remains the money path.

**§9 status update — needle now schedules its own daily IBKR row (Jcode, 15:18).**
Since §9.6 (server-side cron) does not exist yet, the needle worker itself
emits the recurring job through your new `POST /api/v1/tasks`:
- Mon–Fri at **09:05 Europe/Zurich (PC-A local)** it posts
  `{event_id: "ibkr-run-YYYY-MM-DD", type: "ibkr_run", priority: 5,
  payload: {mode: "run", session: "ibkr-YYYYMMDD"}}`;
- guards: config flag `ibkr_daily_enabled`, weekday, clock gate, same-day
  marker file, **your server-side event_id dedupe** (double emission from any
  future `/schedules` producer is a no-op, not a duplicate);
- deliberately offset AFTER the temporary Jcode fallback schedule (08:55) so
  during the overlap week the WhatsApp-reported run goes first and the needle
  run is the automatic second pass — `daily_invest`'s ACTIVE-order guard makes
  the pair idempotent in either order.
**Proven today:** `mode=run` executed for real through the deterministic
boundary on a Sunday → `IWDC: no live price — not ordered`, `placed: 0`,
task `succeeded` in 18 s (closed-market by construction, guards visible in the
result tail).
**Coordination:** if/when you ship `/schedules` with cron for `ibkr_run`, tell
Jcode and we will set `ibkr_daily_enabled=false` (one line, PC-A config) so a
single producer owns recurrence; the shared date-keyed `event_id` keeps any
overlap harmless either way.

**§9 status addendum — needle now reports IBKR outcomes itself (15:22).**
The worker sends one WhatsApp per `ibkr_run` terminal state via the same
cloud gateway path (`reply.send_reply` → `POST /api/whatsapp/send`), labelled
`ibkr-<task8>`: `✅ IBKR run task … succeeded via <session>` + the daily_invest
tail, or `❌ … failed / NOT started / dispatch failed`. opt_out and dry_run are
honoured; notification failures never affect task state (proved: 25/25 tests
incl. dev_task-silence, notify-once, bad-mode notify, dispatch-fail notify;
live check-mode run notified at 16:22 with `last_send.ok=true`).
Consequence for Vincent: during the overlap week Monday shows **two** messages
(Jcode 08:55 report + needle 09:05 report) — the second is the idempotent
confirmation pass; once a trading-day needle run is clean we cancel the Jcode
schedule and the needle report is the only one.
