# GTM test readiness — checked 2026-11-01 13:00 CET

Scope: Day-1 (Mon 2 Nov) readiness for the 2–8 Nov experiment
(`kubotics_agentic_gtm_plan_2026-11-01.md` §8/§12). Website/landing-page
quality itself is owned by the website agent — this covers the plumbing the
test depends on.

## A. Verified working (probe-backed)

| # | Item | Evidence |
|---|------|----------|
| A1 | Home + all four topic pages live | `https://www.kubotics.ch` `/automation/cnc-machine-tending` `/automation/invoice-processing` `/robotics/unitree-h2-test-day` `/automation/discovery` → **200** each, correct German titles, ~0.2s |
| A2 | Frontend deployed incl. `/dashboard` | S3 `kubotics` objects at 12:43:33 incl. `dashboard/index.html`, `main-BQ5K2LHS.js`, `chunk-D4PbZnUZ.js`; CDN serves chunk with **Entra tenant id + client id present (1 hit each)** |
| A3 | WhatsApp webhook receiver in the cloud | verify challenge 200 through CloudFront; operator lane → `needle_inbox`; needle token enforced (401 without) |
| A4 | Needle intake + scheduler on PC-A | needle3 polls `https://api.kubotics.ch` → `backend: OK (latest_id=4)`; `dry_run=false`; unit enabled |
| A5 | Needle watchdog (new today) | `n3_watchdog.timer` active, every 15 min: error-burst (≥20/20min, no info) + backend reachability; alerts via PC-A send API with 2h cooldown, opt-out respected; validated `ok` + `--simulate` path |
| A6 | Chat + booking endpoints reachable on current backend | `/api/v1/chat/message`, `/api/v1/meetings/schedule`, `/api/v1/leads` registered on task def `:7` (serving) |
| A7 | Inbound chat + booking landing path built | booking URL `bookings.cloud.microsoft/book/KuboticsGet2Know…` present in frontend service + backend fallbacks + agent core (code-verified); Teams meeting generation per agent's report |
| A8 | Infra guardrails for the week | CloudFront forwards headers+query (ORP AllViewer), ECS↔LB registration attached, circuit breaker armed — validated live when today's bad deploy could not take prod down (health 200 throughout) |
| A9 | Postgres = system of record; audit tables exist | `contacts/organizations/opportunities/conversations/messages/agent_runs/agent_tool_calls/agent_actions/needle_inbox` present |

## B. Blocked / open (must land before paid spend — Day-1 gate)

| # | Gap | Impact | Owner |
|---|-----|--------|-------|
| B1 | **Backend deploy of `a990349` fails at import** (`cloud_dashboard.py:17` imports non-existent `Lead`) → `/api/v1/dashboard/summary`, `/api/v1/tasks`, `/api/v1/events` = 404; prod safely serving `:7` | Cloud dashboard + scheduler API + agent-output endpoint not live; §8 of the website-agent prompt has the traceback + suggested fix | website agent (fix pending) |
| B2 | **Attribution accepted but dropped**: frontend captures `utm_source/medium/campaign`, `gclid`, `referrer_url`; `InboundLeadCreate` accepts them; `process_inbound_lead` never persists them and `Contact` has no such columns | §12 P0 "persist lead source/campaign/UTM" + §10.3 attribution **unmet** → click/lead attribution impossible → **do not start paid spend** (§8 Day-1 gate) | website agent (schema + service mapping) |
| B3 | **No consent / suppression fields** in backend (0 matches for consent/suppression/first_touch on Contact; `InboundEvent` from `a990349` has first/last touch only for events) | §12 P0 privacy/contact-permission open; WhatsApp/Telegram opt-in record incomplete | website agent |
| B4 | **Campaign metrics ingestion absent** (`campaign_metrics` 0 matches) | Needle daily evaluation (§9) has no metric source yet → first evaluation cannot be evidence-based | backend/needle owner |
| B5 | **No spend-cap enforcement**: code only carries CRM *data* fields (`Opportunity.budget_chf`, lead intake `budgetOrScale`) — nothing enforces CHF 100 total / CHF 70 Search caps or the approval gate | Hard budget boundary (§6) is manual until implemented: **no campaign creation, spend increase, or external publishing without Vincent's explicit go** | Vincent + backend agent |
| B6 | **E2E conversion tests not run** (form submit → Postgres lead; chat; booking card → Teams meeting; readiness/ROI submissions) | Day-1 instrument step outstanding; chat/booking testable **now** (A6 works), form test pending B1 for full dashboard verification | Jcode can run on request |
| B7 | Booking URL returns **417** to headless clients (bot gate) | Needs a real-browser click-through check of the booking flow | Jcode/browser or website agent |

## C. Day-1 execution order (proposed)

1. Website agent merges the `Lead` fix (B1) → verify `/api/v1/dashboard/summary` answers and ECS `COMPLETED`.
2. Run E2E conversion tests (B6): form, chat, booking→Teams; capture first lead with UTM (fails at B2 — record exactly where it is lost).
3. Land attribution + consent persistence (B2/B3) — **gate for spend**.
4. Needle test evaluation (trigger → agent run → auditable output) once B1/B4 exist.
5. Manual guardrails in force meanwhile (B5): budget stays at CHF 0 spent until caps are enforced in code or explicitly approved.
