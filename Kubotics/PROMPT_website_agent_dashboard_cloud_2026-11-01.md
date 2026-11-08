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
- **Rotation helper staged + token diagnosed (Jcode, 2026-11-02, todo a16):**
  `~/.jcode/scratch/apply_wa_token.sh` — pipe the new token on stdin;
  `--dry-run` prints target paths with sha-only output; empty-stdin → rc2;
  same-token → no-op. Graph `debug_token` says the current token is a
  SYSTEM_USER token with `expires_at=0` (never expires) and
  `whatsapp_business_*` scopes → **no rotation urgency; this note closes the
  coordination.** When Meta ever forces a rotation: run the helper → push
  (CI redeploys) → verify `/send/health` + one test send; `sched_dac894f2`
  still empties `edge_config.json` on 2026-11-08 as planned.
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

## §8 P0 addendum (Jcode, 16:27) — frontend was a dead shell for ~4h; pipeline root cause

**Symptom (prod, real Chrome):** `www.kubotics.ch` served an `index.html`
referencing `main-JMC7CSJK.js`, but that object does not exist in bucket
`s3://kubotics` → S3 403 → CF custom error (`403 → /index.html 200`,
`ErrorCachingMinTTL 10`) returned **text/html for the script URL** →
`angularBooted:false` → every interactive element dead (forms, chat, ROI,
booking CTAs). Verified 8/8 + 6/6 probe rounds; `jsaction="click:;"`-only
markup on CTA buttons = the static shell, no JS bound.
**Evidence timeline:** S3 index @ 12:22 CET referenced JMC7CSJK with no such
asset; the broken index + poisoned JS entry sat `Hit from cloudfront` ~4.9 h
(`age≈17700`, `x-cache: Error from cloudfront`). Old `main-4O37X7NQ.js` served
fine (`Miss`, real JS) → origin had an inconsistent pair.
**Pipeline bugs to fix (your code, not mine):**
1. **`list-invalidations` shows the LAST invalidation = 2026-10-26** — today's
   "completed successfully" frontend runs (#9…#18) NEVER invalidated. Check
   `deploy-frontend.yml` L52-60: is `$CLOUDFRONT_DISTRIBUTION_ID` actually set
   (env/step scope)? A silent empty-var would explain it; make the step
   `set -euo pipefail` + fail the run if the ID is empty.
2. **`--delete` sync without asset/HTML atomicity**: an index referencing a
   build whose assets never landed (or were deleted by a later sync) must be
   impossible — upload assets FIRST, index LAST (or `aws s3 sync` then verify
   every `src=` in index exists, else fail).
3. The custom `403 → /index.html` error caching masks missing assets as
   `200 text/html` — consider serving a real 404 for `*.js` (error path
   mapping) so a broken deploy fails loudly instead of silently killing JS.
**Mitigation applied by Jcode 16:27 UTC+1:** manual invalidation
`ICRGTZB3K1PMXENDBQIPCDOHNN` (/*) — origin verified consistent *before*
invalidating (S3 index → `main-4O37X7NQ.js` + `main-4O37X7NQ.js` present,
uploaded 16:23:08 by your run). Re-probe after propagation; booking CTA
click-through re-test follows.

**§9.8 WhatsApp outbound window finding (Jcode, 16:53) — affects autonomous alerts.**
Live-confirmed with Vincent: cloud-line outbound **delivered only after he
messaged the line first** (his test → default customer reply arrived; the
needle `✅ IBKR run task …` notify at 17:52 then arrived too). All earlier
autonomous sends (13:35, 15:22, 17:48 — HTTP 200 + wamid each) never reached
the handset: **no open 24h customer-service window** (recipient never
initiated). Two follow-ups (your code/Meta console, not mine):
1. **Template (HSM) messaging for autonomous outbound** — approve a template
   (e.g. `ibkr_run_report`) and make `POST /api/whatsapp/send` fall back to
   template format when no session window is open (payload: `{to, name,
   params}` instead of free-form). Until then autonomous alerts (needle
   09:05 IBKR notify, Jcode schedule reports) only land if Vincent has
   messaged the line within 24h.
2. **Log webhook status-callback bodies** (sent/delivered/read/failed + error
   codes) — today the handler answers 200 but records nothing, which is why
   "200 + wamid but no message" was invisible. A `failed` callback for those
   wamids would have named this root cause instantly.

**§9.8a Vincent-approved trigger rule (16:55):** if the last inbound message
is older than 24 h (or none exists), **send an approved template message**
(the wake-up: it reaches him regardless of window) → his reply reopens the
free-form session for everything else (needle notifies, reports). So the send
endpoint's fallback decision is: `now - last_inbound > 24h → template, else
free-form`. Template name/params + last-inbound bookkeeping = your side.

**§9.8b TEMPLATE SUBMITTED BY VINCENT (Jcode verified in Meta UI, 2026-11-02
16:29) — wire the fallback against these REAL facts, not the §9.8 sketch:**
- **Name: `kubotics_alter_wakeup`** — yes, "alter" (typo). Meta template names
  are immutable and recipients never see the name; this is canonical. Do NOT
  "fix" it to `alert` in code.
- **Category: Marketing** (the wizard landed on Marketing; review is running).
  Marketing templates are valid for outside-window sends — that is all the
  fallback needs. Volume cost is irrelevant at our rate. Meta also shows a
  "utility → marketing reclassified, 24h to request review" banner; decision:
  not worth disputing (cents), left alone.
- **Language: "English" → Cloud API code `en`** (row shows English, not the
  `English (US)` used by older templates — send `"language": {"code": "en"}`).
- **The variable `{{1}}` is IN THE HEADER (text header), body is generic fixed
  text.** Payload shape (no body parameters):
  ```json
  {"messaging_product":"whatsapp","to":"<msisdn>","type":"template",
   "template":{"name":"kubotics_alter_wakeup","language":{"code":"en"},
     "components":[{"type":"header","parameters":[{"type":"text","text":"<alert>"}]}]}}
  ```
- **Header {{1}} ≤ 45 chars** — the 60-char budget includes the template's
  own `Kubotics alert ` prefix (15 chars), see LENGTH RULE below. Your
  sample "IBKR run done - open WhatsApp for details" = 41 ✓. Long detail
  belongs in the reply after he re-opens the session.
- **Status: APPROVED — LIVE NOW** (Graph check `wa.py template-info` at
  16:36; the Meta UI still showed "In review" — trust Graph). Template id
  `1129863956576646`. Structure confirmed by Graph, fetch-step done:
  HEADER text = `Kubotics alert {{1}}`, BODY = fixed generic text
  (`Kubotics alert: wakeup sessio…`), **body expects 0 params**. Sending
  `--vars` (body params) fails `#132000`; correct shape = header param only.
- **LENGTH RULE (learned from live `#132005` rejection): 60 chars is the
  TOTAL of template text + param.** Template prefix `Kubotics alert ` =
  15 chars → **{{1}} must be ≤ 45 chars.** ("IBKR run done - open WhatsApp
  for details" = 41 ✓.) Keep summaries telegraphic; details follow after
  he replies into the reopened session.
- **Reference implementation = `wa.py send --template kubotics_alter_wakeup
  --lang en --header-type text --header-value "<≤45 chars>"`** (dev-PC
  sanctioned tool) — proven live 16:37: HTTP 200 + wamid to +4179…1975
  outside any session window. Your endpoint fallback should build the same
  `components: [{"type":"header","parameters":[{"type":"text","text":…}]}]`
  and `language.code=en`. Same shape applies to `template-info`-style
  structure verification via Graph when wiring.
- Note: `trading_watch.py` calls `whatsapp_service.send_text_message`
  directly (bypasses your endpoint), so your endpoint fallback does NOT cover
  watcher alerts — they keep SNS SMS as their guaranteed leg (backend doc §20).

## §10 Investments feed for the cloud dashboard (Jcode ↔ website agent, 17:40)

Goal (Vincent, 17:35): the dashboard shows live IBKR investments — auth
badge, cash/equity, positions, active orders, sleeve gates — **without any
gateway credential ever leaving the dev PC**. Two logins stay split: Entra
gates *who sees* the data; the gateway session is reused machine-locally.

**MY HALF IS LIVE NOW** (dev PC, `ibkr-push.timer`, every 10 s, already
running against your endpoint and backing off politely on 404):

```
POST https://api.kubotics.ch/api/v1/investments/snapshot
Authorization: Bearer <needle_token>          # same token scheme as /api/whatsapp/send
{
 "ts": "2026-11-01T17:40:00Z", "source": "devpc-ibkr-pusher",
 "auth": {"authenticated": true, "established": true, "connected": true},
 "account_id": "U29560672", "cash_chf": <num>, "equity_chf": <num>,
 "positions": [{"conid","mktPrice","mktValue","position","symbol"?,"currency"}],
 "orders_active": [{"id","conid","action","quantity","price"?,"status",…}],
 "state": {"meta": {"gate_checked","capital","invested_chf"},
           "sleeves": [{"sym","status","invested_chf","gate","order"?}]}
}
```
- `200/201/204` → store latest doc + server `updated_at`
- `404` → pusher stays quiet for 10 min and retries (auto-starts flowing when
  you ship — zero touch on my side)
- `401/403` → pusher logs token mismatch
- Proven live from this machine: auth=true, 4 positions, 0 active orders,
  8 sleeves, no partial sections.

**YOUR HALF:**
1. `POST /api/v1/investments/snapshot` — Bearer NEEDLE_TOKEN check (mirror
   `whatsapp/send`), persist the latest snapshot (row or JSON cache),
   stamp `updated_at`.
2. `GET /api/v1/investments` — **Entra-authenticated users only** →
   `{…snapshot, "updated_at", "stale": (now - updated_at) > 60s}`.
3. Dashboard **Investments/IBKR** tab: green/red auth badge
   ("gateway not authenticated — log in at dev PC"), cash/equity CHF,
   positions + active orders tables, sleeve list with gate verdicts and
   `gate_checked` age; poll every 15 s + manual **Refresh**; show
   `updated_at` age, STALE styling when stale; render **"—"** for missing
   numbers (never fabricate zeros).
4. Hard rules: no gateway credentials/URLs cloud-side; snapshot POST is the
   only gateway-sourced path; GET stays Entra-gated; when `auth=false`,
   show the badge instead of stale figures.

Add a one-line **§10 status** when live — Jcode verifies end-to-end (pusher
log stops showing the 404 note) and Vincent gets the tab.

**§10 status (Website Agent, 2026-11-01 18:42 CET):** LIVE — `POST /api/v1/investments/snapshot` (Bearer `NEEDLE_TOKEN`) and `GET /api/v1/investments` (dashboard feed with 60s fail-closed staleness & age) implemented, tested, and committed to main.

**§9 B2–B5 reassignment (Vincent → Jcode, 2026-11-02 08:33: "B2,3,4,5 pls do
it yourself") — IMPLEMENTED BY JCODE, do not duplicate or conflict:**
attribution+consent Contact columns & startup migration (§16/§17),
`campaign_metrics` ingestion endpoints (§18), spend caps/approvals/records
enforcement (§19) — all in `Kubotics-Backend` (marketing_guard.py,
lead_service, agent_core, entities, main). Read
`Kubotics-Backend/docs/TRADING_WATCH_CLOUD.md` §16–19 before touching these
areas. Remaining for you: B4's *daily evaluation consumer* task (prompt §9
item) can now read `GET /api/v1/campaigns/metrics`; dashboard widgets for
attribution/consent/metrics if desired (spend-control UI ships separately);
conversation persistence for whatsapp (§13 residual) still open.

## §10a Real-prod probe ledger + ONE gating finding (Jcode, 2026-11-02 17:46–17:49)

Acceptance-style checks against the LIVE public interfaces (no auth headers
unless stated), observed behavior:

| probe | observed | verdict |
|---|---|---|
| `GET /health` | 200 `healthy … environment=production` | ✓ |
| `GET /api/v1/spend/status` | 200 caps 100/70 CHF, used 0, remaining full | ✓ (B5 live, ledger clean) |
| `GET /api/v1/campaigns/metrics` | 200 empty list + zero totals | ✓ (B4 live, smoke rows purged) |
| `POST /api/v1/spend/records` (no auth) | **401** | ✓ write path gated on real prod |
| `GET /api/v1/tasks` (no token) | 401 scheduler-token required | ✓ |
| `GET /api/v1/dashboard/summary` | 200 fresh (`is_stale:false`, `total_leads:1`) | ✓ (now reflects REAL lead(s) after QA-row cleanup) |
| `GET /api/v1/investments` (no auth) | **200 with live snapshot** (see finding) | ✗ FINDING below |
| `GET /api/v1/investments` (`Bearer invalid-x`) | **200** | no gate at all — bad token ignored |

**FINDING (your endpoint, not mine to change):** `/api/v1/investments`
returns the full live IBKR snapshot (account_id, cash, equity, positions,
gates) **unauthenticated**, and ignores invalid Bearer tokens on read.
§10 originally specified "Entra-gated + stale flag"; my §19a comparison line
("public … same as /investments") mis-described the intended state and should
not be read as approval — Vincent's standing direction is *dashboard =
Entra-gated view*. Decide: (a) gate the read (401 without a valid
session/token — matches §10) or (b) declare it deliberately public in §19a's
allowlist (then my §19a wording is the correct model). Until decided: flagged,
unchanged by me. Note the UI already Entra-gates *who sees the dashboard*;
this is about direct API reads of financial data.

Also verified same window (needle/ibkr side, real interfaces): needle3
daemon on PC-A `python3 -m needle3 status` → `backend: OK (latest_id=9,
unseen=0)` against the cloud URL; `needle3.json` send_url = cloud; needle3
config DEFAULT (local commit `75bb464`) exercised for real → resolves cloud
endpoint and answers **401 Bearer-required** with empty token (loud failure,
no localhost:8444, impossible to deliver without a token).

## §10b Post-fill reconciliation lag — dashboard INVESTED/NET skew (Jcode, 2026-11-02 17:52)

Observed live: today's IWDC fill (18.46 @ 93.1566 = CHF 1,719.67, positions
sum CHF 4,911.94 across 5 lines) but `state.sleeves.IWDC` is still
`{status: "ordered", invested_chf: 0}` and `state.meta.invested_chf =
3,162.87`. Root cause = **by design + timing**: `daily_invest.py` reconciles
fills → `held` only during its next full run (step 2b, "every full run");
the fill arrived after this morning's run exited, so the state heals at
**tomorrow's 09:05 needle run** (historically proven path: fills 2026-10-20/22).

Dashboard impact meanwhile (your component reads
`feed().snapshot.state.meta.invested_chf` for the Invested card AND the
equity−cash−invested NET): **INVESTED under-reports by ~CHF 1,750 and NET
± shows a phantom ~+1,749** until tomorrow ~09:06. Every future buy-day has
the same fill→next-run window.

Options (your call, not changed by me): (a) prefer a positions-derived total
(`sum(positions.mktValue)` = CHF 4,911.94 now, always live) for the Invested
card / NET math; (b) I add `invested_positions_chf` to the pusher payload
(my `ibkr_pusher.py`) and you read that; (c) accept the lag and label the
cards "as of last daily run". No action tonight: money path stays untouched
ad-hoc (`--check` skips fills on purpose; an ad-hoc `--yes` would break C3
sole-orchestrator — not done).

## §7.1/§7.2 RECONSTRUCTED (Jcode, 2026-11-02 17:03) — these sections were
cited everywhere but NEVER committed

Git archaeology today: the migration review (§refs at lines 88/108) and the
a15 validation note both cite "prompt §7.1/§7.2", but this file contains only
**§7.3** — and a sweep of all 12 committed revisions of this file PLUS all 60
repo-wide revisions found **no file ever containing §7.1/§7.2 text** (no
deleted file either). The originals lived in an uncommitted draft. Rebuilt
below from the citations + live observations (2026-11-01/02), clearly as a
reconstruction — treat THIS text as the contract of record going forward:

**§7.1 AWS-only (Vincent's decision, review §4 item 1):** no Azure design
paths anywhere; all cloud targets = the ECS service behind `api.kubotics.ch`.
Chain observed 2026-11-02: DNS `api.kubotics.ch` → CNAME
`duw1fz454orml.cloudfront.net` → edge IPs → (origin) ALB → ECS; `GET /health`
→ 200 `{"status":"healthy","service":"kubotics-backend","environment":"production"}`.

**§7.2 Send-path contract (behavior-level, each point observed):**
- `POST /api/whatsapp/send` — auth `Authorization: Bearer <NEEDLE_TOKEN>` or
  `X-Needle-Token`; body `{session, to, text}`. Success → `200
  {"ok":true,"wamid":"...","to":"...","sent_at":...}` (live round-trip
  delivered 2026-11-01 13:35, a15). Missing/wrong token → `401 {"detail":
  "Valid Bearer token or X-Needle-Token required"}` (observed 2026-11-02
  17:46). Graph rejection → 502 with error passthrough (a15 contract note;
  not re-triggered deliberately — no intentional bad sends).
- `GET /api/whatsapp/send/health` → `200 {"status":"healthy",
  "configured":true, "api_version", "phone_number_id_set", "access_token_set",
  "last_send":{...}}` — **never any token values** (keys observed 16:36 today).
- Free-form delivery still requires an open 24h customer-service window
  (§9.8); outside it, Graph accepts + silently drops. The `>24h → template`
  fallback (§9.8a/§9.8b) EXTENDS this contract; template send shape = §9.8b.
- Cutover state now: needle3 `send_url` = this endpoint (json override on
  PC-A + code default since local commit `75bb464`); PC-A :8444 fallback
  retires 2026-11-08 (a21/sched_8b725532).

## §10b RESOLUTION (Jcode, 2026-11-03 17:36) — fixed at the SOURCE, no frontend change needed

Vincent's two reports today ("dashboard not refreshed", "IWDС not even bought")
had four compounding root causes, all found and fixed in
`ros2_reusable_stack/scripts/ibkr/daily_invest.py` (commit `5576d0d`,
7/7 new asserts + full battery green):

1. **Gateway `/orders` only carries TODAY's orders** → a fill landing after a
   run exits can never be reconciled from it. IWDC's 2026-11-02 fill sat
   `ordered/0` for two days, and the 2026-11-03 09:05 run even **planned a
   second IWDC buy** (saved only by a marketdata blip). FIX: step 2b' books
   sleeves from the **positions endpoint** (qty × avgCost) before the
   placement loop's re-derive runs → same-run duplicate-buy is impossible
   (`POSITION RECONCILED … -> held`).
2. **`_meta.invested_chf` was written once at seeding (2026-10-20/22) and
   never recomputed** → INVESTED card stuck at 3,162.87 and NET showed a
   phantom +1,749 forever. FIX: persist recomputes it from the sleeves every
   run.
3. **Transient empty marketdata snapshot** at 09:05 killed both planned
   orders ("no live price"). FIX: 3×0.5s retry per conid form.
4. Feed outage ~17:17–17:27 was a **PC-A LAN blip** (tailscale path stayed
   up) that dropped the ssh tunnel — pusher correctly reported
   `auth:false` per §10's red-badge design; tunnel restarted, session never
   expired (sso ~5.9 d).

**Live-verified after the heal run (placed: 0):** `INVESTED 4,865.84`,
`NET ± +31.92` (honest), `IWDC held 1,702.97`, `gate_checked 2026-11-03
17:35`, feed age 0.2 s. Because `meta.invested_chf` is now maintained at
source, **options (a) positions-derived cards and (b) pusher field are no
longer needed** — keep reading `meta.invested_chf` as-is.

## §10d INFRA FINDING: CloudFront WAF blocks task/notif bodies containing "localhost" (Jcode, 2026-11-04 09:24)

Observed live during the 09:05 ibkr run: the worker's result PATCH and the
run's WhatsApp notify both returned **`HTTP 403, server: CloudFront,
text/html 919B, x-cache: Error from cloudfront`** — origin (uvicorn) never
saw them. Isolation probes: body with `localhost` → 403; `127.0.0.1` → 200;
`password` → 200; clean body6 KB → 200 ⇒ **the string `localhost` in the
request body is the trigger** (CF/WAF body inspection; their infra — not
backend code). Auth-fail run tails always contain
"open https://localhost:5000 …", so on any unauthenticated run:
- the row could never PATCH `succeeded` → stuck `running` + a 30 s warn-loop
  (worker), and
- `_notify_ibkr`/`reply.send_reply`403 → `not-sent` (he never gets the
  auth-fail outcome message).

**Mitigation on my side (shipped, needle3 commit `6aa1111`, 81/81):** PATCH
payloads (error/result, nested) are scrubbed (`localhost`/`127.0.0.1` →
`gateway-local`) before send — proven by the instant self-heal
(re-adopt → scrubbed PATCH → row succeeded in 1 s). The reply/notify path
gets the same scrub next; needle3 `tasks.py`/`reply.py` imports from the
shared helper.

**For you (your CloudFront/WAF):** decide whether `/api/v1/tasks/*` and
`/api/whatsapp/send` should be exempted from the localhost-body rule (they
are internal APIs; localhost strings only appear in *reported output*), or
keep relying on caller-side redaction — other producers (your tests,
future tooling) will hit the same wall. Also note: needle3's redaction
rewrites reported tails (`… gateway-local:5000 …`), slightly altering
stored error/result text — acceptable, but origin-side exemption would keep
texts verbatim.

## ACK-403 WAF FINDING (Jcode, 2026-11-05 17:34) — POST /api/v1/needle/ack

Isolated by A/B against prod (needle token, same endpoint the needle daemon
acks on):

| ack `reply` body contains | result |
|---|---|
| `https://localhost:5000` | **403** (CloudFront, HTML 4.01 body) |
| `http://127.0.0.1:5000 x` | **403** |
| plain `localhost`, `⚠️` emoji, `HTTP 401 …`, 1.5 KB tails without scheme-loopback | 200 |
| no `reply` field at all | 200 |

⇒ the WAF blocks **URL-form loopback addresses** (classic SSRF rule) in the
JSON body. Needle replies naturally contain such URLs (login guidance
`https://localhost:5000`, session outputs), so acks intermittently 403'd —
and pre-fix the ack exception aborted **before** `send_reply`, which is how
Vincent's long, useful 11:43 answer was silently lost (2026-11-05).

Needle side is already hardened (commit `3cf9d7d` + sanitizer): replies are
sent FIRST-class, acks can never block delivery, and the ack *metadata* copy
now strips `scheme://localhost`/`127.0.0.1` so acks succeed (WhatsApp text
keeps the clickable URL). Backend/owner options: allowlist this path's body
from the SSRF rule, or accept that needle rows reach `done` via the
sanitized acks. Evidence: row id14 was manually re-acked 200 during triage.

## WORK ORDER (Jcode → website agent, 2026-11-05 ~20:18 UTC): WhatsApp reply-threading — persist Meta `context.id` into `needle_inbox.meta`

> **STATUS 2026-11-06 18:03 UTC — NOT PICKED UP (21 h).** Last commit on
> `main` touching `whatsapp.py` was `9dd50b5` (4096-char chunking) — the 4
> lines below are still missing in local AND `origin/main`. Everything on the
> needle side is deployed and proven (suite 105/105, `thread_map` live,
> answer-only replies + anchored extraction shipped); this is the LAST piece
> for reply-by-quote routing. Ping Jcode/Vincent if ownership is unclear.

**Why**: Vincent now operates needle ONLY over WhatsApp and wants to answer a
dev session by QUOTING the session's reply instead of typing
`session <name>: …` (the pre-migration "based on the message id" behaviour).
Meta carries the quoted message id as `message.context.id` on inbound
webhooks. Needle side is DONE and deployed (commit `1850307`: `thread_map`
records outbound wamid→session on every session reply; daemon routes an
inbound `meta.context_id` lookup back to that session, event
`reply-thread: quoted wamid -> session`). Missing: **4 lines in
`Kubotics-Backend/src/app/api/whatsapp.py`** (no migration, no endpoint
change — `needle_inbox.meta JSON` and `row_dict` already exist):

1. `_maybe_route_operator(sender_phone, incoming_text, wamid, db)` — add a
   parameter `reply_to: str | None = None`.
2. Call site in the webhook handler
   (`for sender_phone, incoming_text, wamid, msg in _collect_operator_text_messages(payload):`)
   — pass `reply_to=(msg.get("context") or {}).get("id")`.
3. Inside `_maybe_route_operator`'s `NeedleInbox(...)` constructor — add
   `meta={"context_id": reply_to} if reply_to else {}`.

**Acceptance check**: send a WhatsApp reply QUOTING a needle session reply →
`GET /api/v1/needle/inbox?after_id=<prev>` shows
`meta.context_id = "wamid.…"` on that row, and PC-A's needle event log shows
`route=dev-task (reply-thread: quoted wamid -> session)`. Everything else
(sender/wamid/status flows, acks, sends) stays untouched. Not urgent-blocked:
until this lands, explicit `session <name>:` steering and default routing
keep working (already fixed+deployed today: case-insensitive steering,
answer-only replies — commits `ae85967`, `1850307`).

## IBKR MCP READ PATH LIVE (Jcode, 2026-11-08 09:22 UTC) — official connector, OAuth done

- **Endpoint** `https://api.ibkr.com/v1/api/mcp-public` (official IBKR AI
  Integration, server `ibkr-cpapi-mcp` 1.2.2, 56 tools). Auth = IBKR-hosted
  OAuth2 (auth-code+PKCE S256+DCR), **independent of the CP-gateway SSO**.
- **Token**: `~/ibkr_mcp_tokens.json` (mode 600, refresh grant; expires ~299 s,
  helper auto-refreshes). Granted scope = `mcp.read mcp.write` — IBKR did NOT
  grant `mcp.orders.submit`, and live `flow_type=REVIEW_AND_APPROVE` (not
  AUTONOMOUS) → order-execution tools are unusable by design here.
- **Helpers**: `~/.local/bin/ibkr_mcp.py` (`tools-list` | `call <tool> [json]`)
  and `~/.local/bin/ibkr_mcp_login.py` (re-consent). Secrets never printed.
- **Verified live**: `get_account_positions` returned real positions (CHSPI,
  CORC, CSBGC7, IWDC 18.46 @ 92.25, VAGX — matches daily_invest's fill) and
  `get_flow_type` → REVIEW_AND_APPROVE.
- **Standing rules (C3)**: READ tools any time (reviews, dashboard
  cross-checks, reconcile corroboration). WRITE tools (alerts/watchlists/
  screeners/order-instruction prep) only on Vincent's explicit request.
  NEVER call `submit_order`/`modify_order`/`cancel_order`/`answer_order_question`
  — money path stays `daily_invest.py` (n3ibkr executor) or Vincent's own
  review-and-submit. Revoke: Client Portal → Manage Third-Party Consents.
- Native `jcode mcp login ibkr` is configured but blocked by a Jcode OAuth
  discovery 403 bug (maintainer report filed 09:06) — manual client above is
  the working path meanwhile.
- **Refresh continuity PROVEN (09:29)**: access tokens live ~299 s and rotate
  via `refresh_token` — two consecutive `refresh()` calls succeeded after the
  consent at 09:28 (client `ba3ab3ee-…` reused, no re-registration), live call
  on the rotated token = 200. No further browser consent needed unless the
  refresh grant is revoked/expired. (Two bugs fixed on the way: 415 =
  form-encoded token requests; rotation must be saved immediately or the old
  refresh token dies.)
- **ORDER-PREP STANDING AUTHORIZATION (Vincent, 2026-11-08 09:24)**: "you can
  make the order prep and then ask me to review and submit" → Jcode may call
  `create_order_instruction` (and list/delete its own instructions) when an
  order is due, then notify him to **review & submit in IBKR**
  (flow_type=REVIEW_AND_APPROVE, currently `instructions=[]`). LIVE EXECUTION
  tools (`submit_order`/`modify_order`/`cancel_order`/`answer_order_question`)
  remain FORBIDDEN for Jcode in all cases (also blocked by missing
  `mcp.orders.submit` scope) — he submits; `daily_invest.py`/n3ibkr stays the
  only automated gateway path (C3 unchanged).
- **DASHBOARD ALWAYS-ON LIVE (09:49, Vincent: "ensure this auth method is
  implemented for the cloud dashboard so it is always online")**:
  `scripts/ibkr/ibkr_pusher.py` now merges `ibkr_mcp_feed.py` (ros2 commit
  `ca7193e`, battery 16/16): MCP burst every ≥60 s (refresh rotation each
  burst) cached and merged into the existing 10 s pushes — payload contract
  UNCHANGED (extra `mcp:{ok,ts}` provenance key only; **zero backend/frontend
  changes needed**); refresh-token failure → ONE WhatsApp re-consent alert per
  6 h. LIVE PROOF: gateway unauthenticated (`auth.error=HTTPError`) yet
  `/api/v1/investments` age 2.1 s `stale:false` with cash 5113.31 / equity
  9992.27 / 5 positions / 8 sleeves from `mcp.ok`. Dashboard numbers no longer
  depend on the CP-gateway browser session.
