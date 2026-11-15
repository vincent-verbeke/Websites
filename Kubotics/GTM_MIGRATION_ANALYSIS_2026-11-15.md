# GTM migration — analysis & recommendation (2026-11-15, Jcode)

Question from Vincent: *"analyse if we could integrate the GTM part in our
Backend or what would be the best option without over-dimensioning for the
first test"* — with the explicit priority that **customer interaction beats
tracking polish**, while still ending up state-of-the-art.

## 1. Short answer

**Google Tag Manager cannot live in the backend.** A GTM *web container* is
browser JavaScript that loads tags on the client; "running it in FastAPI"
would mean either (a) rendering tag JS server-side (impossible — clicks,
scrolls, form state and consent live in the browser), or (b) server-side GTM
(sGTM), which is real infrastructure. For a CHF 150 first test the best
option is:

**Recommended: Option A — client-side GTM web container + one typed
analytics service on the frontend, with PostgreSQL staying the authoritative
lead/CRM store (already the case).** Server-side GTM is explicitly deferred
(Option B, revisit after test 1).

| Option | What it gives | Cost | Verdict |
|---|---|---|---|
| **A. Client GTM web container** (recommended) | Tracking configurable in GTM UI without releases; GA4 + Ads + Conversion Linker centralized; Consent Initialization; matches the pasted spec 1:1 | Container + ~1 day frontend service work; zero infra | **DO NOW** |
| B. Server-side GTM (sGTM on AWS) | First-party cookies, harder to block, server-side conversions | New service, domain/headers, tag config on server, ops burden | **DEFER** — over-dimensioned for test 1 |
| C. Backend-emitted events (GA4 Measurement Protocol / Ads enhanced conversions) | Backend-confirmed events only (lead created, meeting booked) with `transaction_id` dedupe | Small; needs GA4 MP API secret | **OPTIONAL ADD-ON** after A — complements, never replaces, browser events |
| D. Backend-only "GTM replacement" | Cannot see page_view/cta_click/form_start at all | — | **REJECTED** (fails the spec) |

## 2. What the backend does (and does not) own under Option A

Stays in PostgreSQL (spec §5 — already implemented, do not move):
GCLID/GBRAID/WBRAID + UTM + first/last touch + landing page + lead source +
conversion timestamps on `Contact` (B2/B3 work, verified 2026-11-14);
one-lead-per-submission dedupe server-side; spend caps + approval gate.

Backend explicitly does **not**: host the container (googletagmanager.com
serves it; our S3/CloudFront only serves our own JS), receive tag callbacks,
store PII for GA4, or create CRM records from GTM. GTM is a *publisher* of
events; our endpoints remain the *system of record*.

Optional later (Option C): a backend mirror of `generate_lead` /
`schedule_appointment` via Measurement Protocol with the SAME
`event_id`/`transaction_id` the frontend sent — dedupe by id means no
double count (spec §6). Needs GA4 Measurement Protocol secret (access list).

## 3. Phased rollout (respects "don't remove direct gtag until GTM passes")

- **Phase 0 (account-side, Vincent, blocking):** create the GTM container
  (prod + dev containers), grant Google Ads + GA4 access (table in
  `MARKETING_LAUNCH_READINESS_2026-11-14.md` §5/§6 addendum 2026-11-15), create the
  `generate_lead` conversion action in Google Ads (primary) and keep
  `qualified_lead`/`meeting` as secondary until verified (spec §4).
  **Status 2026-11-15: PROD CONTAINER DONE** — `GTM-WG9P5H9M` (account
  *Kubotics* / *www.kubotics.ch*) created + published + wired by Jcode in
  Vincent's signed-in session; GA4/Ads grants + dev container still open.
- **Phase 1 (frontend — coordinate with the landing-page agent):**
  `AnalyticsService` (typed `window.dataLayer.push` wrappers for page_view,
  cta_click, form_start, generate_lead, roi_calculator_interaction,
  roi_result_view, outbound_click, schedule_appointment + `event_id`;
  **no PII**, business components stop calling `gtag`), GTM loader from one
  env/config (container ID not hardcoded; no prod tags in dev; loaded once;
  SPA route-change page_view with dedupe), Consent Mode v2 wired to the
  EXISTING cookie-consent component (defaults before tags, update on change,
  no second consent system). Ship on the **IT-BPA landing page first**
  (`/automation/it-business-process-automation`), then home + the rest.
- **Phase 2 (parallel-run, de-dup):** GTM's GA4 tag configured NOT to send
  `page_view` while the direct gtag still does (single page_view source);
  conversion tags fire ONLY from GTM; direct `ads_conversion_*` calls in
  `kubotics-api.service.ts`/`lead-agent.service.ts` kept until evidence.
  **Runbook (2026-11-15, UI fight documented):** GTM workspace 3 → Add tag →
  Google Analytics → *Add your Google Analytics stream* → measurement
  `G-0H34P5Y9WX` → turn OFF "Send page view on page load" → trigger
  Initialization/All Pages → Save → Submit/Publish → verify in ONE pass:
  (a) site reload shows gtm.js + exactly one canonical page_view in dataLayer,
  (b) GA4 **Realtime via Vincent's signed-in session** (analytics.google.com —
  browser access needs NO grant; only the Data API needs row-2) shows page_view
  arrivals WITHOUT duplicates; delete/revert the tag if anything doubles.
  Note: the tag-chooser sheet renders DUPLICATE instances in this browser
  bridge — always scope clicks to the VISIBLE `.gtm-sheet-wrapper`, and
  Tag Assistant's Connect popup is blocked here (its window.open needs a real
  user gesture; debug URL pattern `?gtm_debug=<ts>` captured but opener-less
  tabs cannot handshake) → Phase 3 evidence runs in a real session.
  **✅ STEP 1 EXECUTED + RECEIVED 2026-11-15 13:21 (container v3+v4 live):**
  Google Analytics tag `G-0H34P5Y9WX` created on Initialization-All-Pages with
  `send_page_view=false`; GTM's auto-added "Manage automatic event detection"
  turned OFF (all 6: history-change page views, scroll, outbound, forms,
  video, file downloads — defaults were ON); "Allow user-provided data
  capabilities" (auto email/phone/address detection) turned OFF (privacy,
  data minimization). Declined the account-link prompt. **GA4 Realtime
  receipt (property Kubotics 530208306 via signed-in session):** 2 page loads
  → Views=2, Event count = `page_view`×2 and NOTHING else (100%) — exactly
  one page_view per load, no auto events, no duplicates → one-source rule
  HOLDS in production. In-page: gtm.js loads, gtm.start×1, canonical
  page_view×1, GA4 direct gtag untouched. NEXT: conversion/Ads tags (his Ads
  account 226213290 WAS visible in the picker — verify its state), event
  triggers when components migrate, DebugView deep pass.
- **Phase 3 (evidence, spec §7):** GTM Preview + Tag Assistant + GA4
  DebugView + Ads diagnostics on the REAL flows (load, SPA route, CTA,
  form start, success, fail, duplicate, consent accept/reject, ROI, booking).
  **Acceptance = live tag-delivery evidence, not code inspection** (spec §8);
  I can drive the browser flows and capture DebugView/Tag Assistant states
  that need his logged-in Google session.
- **Phase 4 (cleanup):** remove direct gtag calls (deliverable 6: removed
  with commit evidence), keep consent banner + Measurement Protocol mirror
  decision.
- **Phase 5 (after test 1):** evaluate sGTM (Option B) with real data on
  signal loss / cookie limits — only then.

## 4. Duplicates & consent (the two ways this breaks)

- One `page_view` source at any time (phase-managed, see Phase 2); SPA route
  changes push exactly one page_view per history change (service-level
  guard, `navigationEnd` id).
- One `generate_lead` per successful submit: fired from the success callback
  with `transaction_id = lead id` + idempotent `event_id`; failed submits
  fire nothing; GTM conversion tag configured on that single event (never
  on cta_click/form_start per spec §4).
- Consent: ONE system — the existing `cookie-consent` component writes
  consent state, GTM dataLayer consent commands mirror it (`ad_storage`,
  `analytics_storage`, `ad_user_data`, `ad_personalization`), defaults
  `denied` until user choice, Consent Initialization tag first. No second
  banner.

## 5. Deliverables vs the pasted spec (who does what)

| Spec deliverable | Owner | State |
|---|---|---|
| 1 Container ID + env config | DONE 2026-11-15 (Jcode in Vincent's session): container `GTM-WG9P5H9M` created + initial version published + env slot wired (`f9c3741`) + live-verified; dev container still open | **done** |
| 2 Analytics service + typed dataLayer | me — **DONE 2026-11-15** (`AnalyticsService` + `GtmService` + env slot, `16fb4fe`/`f9c3741`, 50/50 vitest, live-verified); component call-site migration deferred to after landing-agent + Phase 3 evidence | **done (infra)** |
| 3 Event definitions | me — **DONE**: the 8 spec names typed in `AnalyticsEventName` (page_view, cta_click, form_start, generate_lead, roi_calculator_interaction, roi_result_view, outbound_click, schedule_appointment), stable, no PII, event_id on conversions | **done** |
| 4 Consent v2 migration | **NO CHANGE NEEDED**: index.html inline gtag consent default/update + cookie-consent component already ride the dataLayer (single system, §4); GTM picks the queue up on load | **done** |
| 5 Tags/triggers configured | Vincent's GTM UI or my browser session w/ his access | pending access |
| 6 direct gtag removed/justified | me after Phase 3 evidence | pending |
| 7 Dedup strategy | defined in §3/§4 (partly already live: qualify_lead/meeting events exist) | partly live |
| 8 Test evidence | me (browser flows) + his Google sessions for DebugView | pending access |
| 9 Deploy/rollback | me — standard frontend pipeline; rollback = revert commit (container ID off ⇒ service inert) | ready |
| OpenAI-ads channel events | me: `utm_source=openai_ads` distinct source + backend attribution (no reliable ads API yet — see access table) | design done |

## 6. Explicitly NOT doing now (over-dimensioning guard)

sGTM infra, server-side conversion API integrations, GTM server containers,
a second consent system, moving any CRM logic into GTM, and paid-channel
launches before the access table in the readiness doc is granted.
