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
| B1 | ~~Backend deploy fails at import~~ **RESOLVED & PROD-CONFIRMED 13:29** — 3 defects fixed by Jcode hotfix (Lead import, double `/v1` prefix, `create_all` in all envs); ECS deployment `COMPLETED`, `/api/v1/dashboard/summary` 200 stable 3/3, `/api/v1/tasks` 401 | website agent may supersede with Lead model + alembic (prompt §8) |
| B2 | **Attribution accepted but dropped**: frontend captures `utm_source/medium/campaign`, `gclid`, `referrer_url`; `InboundLeadCreate` accepts them; `process_inbound_lead` never persists them and `Contact` has no such columns | §12 P0 "persist lead source/campaign/UTM" + §10.3 attribution **unmet** → click/lead attribution impossible → **do not start paid spend** (§8 Day-1 gate) | website agent (schema + service mapping) |
| B3 | **No consent / suppression fields** in backend (0 matches for consent/suppression/first_touch on Contact; `InboundEvent` from `a990349` has first/last touch only for events) | §12 P0 privacy/contact-permission open; WhatsApp/Telegram opt-in record incomplete | website agent |
| B4 | **Campaign metrics ingestion absent** (`campaign_metrics` 0 matches) | Needle daily evaluation (§9) has no metric source yet → first evaluation cannot be evidence-based | backend/needle owner |
| B5 | **No spend-cap enforcement**: code only carries CRM *data* fields (`Opportunity.budget_chf`, lead intake `budgetOrScale`) — nothing enforces CHF 100 total / CHF 70 Search caps or the approval gate | Hard budget boundary (§6) is manual until implemented: **no campaign creation, spend increase, or external publishing without Vincent's explicit go** | Vincent + backend agent |
| B6 | **E2E conversion tests: form PASS (live), chat N/A, booking pending** — form POST `/api/v1/leads` with UTM → 201 (contact `aea573b4…`, deal `4779da76…`) and dashboard `total_leads 7 → 8` in the same minute; site chat is **client-side reasoning** (no HTTP), so `/api/v1/chat/message` (needs `session_token`) is not on the conversion path; booking → Teams still needs the real-browser pass (B7) | conversion form path fully verified | Jcode (done) + browser step |
| B7 | Booking URL returns **417** to headless clients (bot gate) | Needs a real-browser click-through check of the booking flow | Jcode/browser or website agent |

## C. Day-1 execution order (proposed)

1. Website agent merges the `Lead` fix (B1) → verify `/api/v1/dashboard/summary` answers and ECS `COMPLETED`.
2. Run E2E conversion tests (B6): form, chat, booking→Teams; capture first lead with UTM (fails at B2 — record exactly where it is lost).
3. Land attribution + consent persistence (B2/B3) — **gate for spend**.
4. Needle test evaluation (trigger → agent run → auditable output) once B1/B4 exist.
5. Manual guardrails in force meanwhile (B5): budget stays at CHF 0 spent until caps are enforced in code or explicitly approved.

---

## Evidence addendum — B7 RESOLVED + prod incident healed (Jcode, 2026-11-01 16:31)

**B7 (booking real-browser check) — PASS, checked end-to-end in real Chrome:**
- Direct link `bookings.cloud.microsoft/book/KuboticsGet2Know@kuroliv.ch`
  loads (no 417): full Bookings SPA — service "Kubotics Get2Know / 30-min
  meeting", Nov-2026 calendar, time slot, details form, Book button. *Note:*
  the timezone selector defaults to **UTC** on first render — Day-1 eyeball
  check that Swiss visitors see CET slots (or change the Bookings default).
- **In-chat booking card (the real conversion path per A7) verified live:**
  homepage CTAs ("Testtag / Beratungsgespräch buchen" ROI card and
  "Beratungs- & Testtag buchen" H2) open the sales chat, whose `.booking-card`
  renders: "Termin buchen mit Vincent Verbeke — 30-min Teams Discovery",
  required fields (bName/bEmail/bDate/time slots ZRH), submit
  "Termin buchen & Teams-Link anfordern".
- **Wiring proof without side effects:** empty-form submit → 4 fields flip
  `ng-invalid`, **zero network calls** (performance log: no /api|teams|graph
  requests) → validation blocks as designed. Per C4 the actual booking
  submission is Vincent's own click-through.
- App boot proof: Angular intro overlay + working skip button (the page was a
  *dead static shell* for ~4 h earlier today — see prompt §8; healed 16:27).

**Prod incident (resolved):** 12:22–16:27 `www.kubotics.ch` served a stale
index referencing `main-JMC7CSJK.js` (absent from S3) → CloudFront custom
403→index.html returned `text/html` for the script → every interactive
element dead (`angularBooted:false`, 8/8 probes). Last CF invalidation before
today was **2026-10-26** (workflow invalidation step never firing — handed to
website agent, prompt §8). Healed by manual invalidation
`ICRGTZB3K1PMXENDBQIPCDOHNN` after verifying origin consistency
(S3 index → `main-4O37X7NQ.js`, present); post-fix probes 6/6 healthy.
