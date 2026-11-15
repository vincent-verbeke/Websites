# Marketing launch readiness — review 2026-11-14 (Jcode)

Answers Vincent's ask: *"summarize what is missing and list me all the landing
pages so I can decide on the launch"*, folded together with the external
review (CHF 150 test proposal) received the same day.

## 1. All landing pages (live routes — `src/app/app.routes.ts`)

| # | URL | Purpose | Paid-traffic ready? |
|---|---|---|---|
| 1 | `https://www.kubotics.ch/` | Home: free-text automation CTA, quick-start cards, ROI calculator, readiness assessment, booking, WhatsApp/Telegram | as generic destination only — **do not** send broad paid traffic here first |
| 2 | `https://www.kubotics.ch/automation/cnc-machine-tending` | CNC machine tending (problem headline + technical questions + feasibility enquiry) | ✅ **best first paid page** (external review agrees) |
| 3 | `https://www.kubotics.ch/automation/invoice-processing` | Invoice automation with LLMs (volume + ERP qualification) | ✅ strong for a second campaign |
| 4 | `https://www.kubotics.ch/robotics/unitree-h2-test-day` | Unitree H2 test day (visual differentiation, booking) | ✅ good for Meta/Instagram, weaker for search |
| 5 | `https://www.kubotics.ch/automation/discovery` | Automation discovery — "explain your problem" (best general entry) | ✅ catch-all for non-specific terms |
| 6 | `https://www.kubotics.ch/marketing/ai-marketing-sales` | Fully automated AI marketing & sales offer (shipped 2026-11-11) | ✅ separate ICP — own campaign |
| — | `https://www.kubotics.ch/dashboard` | Authenticated dashboard | ❌ not an acquisition page |
| — | `/#technology`, `/#solutions`, `/#company`, `/#contact` | home anchors (only these are in the sitemap today) | n/a |

Five solution categories ⇒ five campaign destinations (external review
"Critical #1" — the pages already exist; what is missing is the *campaign
structure*, one campaign per page, not more pages).

**Sitemap defect — FIXED today:** `Kubotics/public/sitemap.xml` listed only
`/`, four home anchors and `/marketing/ai-marketing-sales`, on the apex host.
Rewritten 2026-11-14: all six acquisition pages + anchors, `www.kubotics.ch`
(the host that actually serves 200), fresh `lastmod`; `robots.txt` now points
at `https://www.kubotics.ch/sitemap.xml`. Still to do: submit the property in
Search Console once you grant access (§4).

## 2. What is already in place (verified in code today)

| Area | Status |
|---|---|
| Lead capture → PostgreSQL | ✅ form `/api/v1/leads` (201 + CRM rows), in-chat booking → Teams, WhatsApp/Telegram → agent core |
| UTM/gclid/referrer attribution (readiness **B2**) | ✅ persisted: `Contact.utm_*`, `gclid`, `referrer_url`, `first_touch_at/last_touch_at` (`lead_service.apply_attribution`) |
| Consent / suppression (B3) | ✅ `consent_status` / `consent_source` / `consent_at` on Contact, set at WhatsApp opt-in + lead form (`apply_lead_form_consent`) |
| Campaign metrics ingestion (B4) | ✅ `CampaignMetric` model + `POST /spend/records` + `GET /spend/status` |
| Spend caps + approval gate (B5) | ✅ enforced in code: `SPEND_TOTAL_CAP_CHF = 100`, `SPEND_SEARCH_CAP_CHF = 70` (per calendar month), every spend record needs an APPROVED approval (`marketing_guard.py`) |
| Analytics | ✅ GA4 `G-0H34P5Y9WX` in `index.html`, consent mode defaults, `qualify_lead` + `ads_conversion_SUBMIT_LEAD_FORM_1` events |
| Conversion tracking for *qualified* events | ✅ committed (`d4394d2` + landing `c132bef`): `schedule_appointment` + `ads_conversion_MEETING_SCHEDULED`, `qualify_lead` fired from `submitLead`, ROI methodology transparency, readiness score starting at 0 % (`ng run build` green) |
| Needle daily evaluation | ✅ event/eval path exists; needs a real metrics feed → §3 keys |

## 3. What is MISSING before paid spend (ordered)

1. **Google Ads account + conversions** — no campaign, no conversion actions,
   no keywords loaded, and the tracking events above only count once the
   matching conversion actions exist (`SUBMIT_LEAD_FORM_1`,
   `MEETING_SCHEDULED`). Blocked on **your Google Ads access**.
2. **Substantiation for the technical claims** (external review, High):
   98.5 % extraction accuracy, <3-month payback, <6-month ROI, precision/
   response/autonomy claims need sources or softer wording *before* ads point
   at those pages.
3. **Customer proof** (Medium): real demo video, implementation examples,
   references — needed for the Instagram creative and LinkedIn credibility.
4. **Metrics feed into the backend** — `campaign_metrics` has an endpoint but
   nothing pulls Google Ads/Meta numbers yet; the daily Needle evaluation
   would run on empty data. Solved by the API access in §4 (one ingestion
   job).
5. **Sitemap/SEO fix** (§1 defect) + Search Console property verification.
6. **Unified lead record proof across all paths** (High): attribution is
   persisted for the form path; chat and booking paths need one E2E check
   that they land on the *same* contact with UTM intact (partially the
   backend's `process_inbound_lead`; verify with a tagged test click).
7. **Budget decision**: code caps **CHF 100 total / CHF 70 Search**; the
   external proposal asks **CHF 150** (Search 80 / Meta 25 / LinkedIn 20 /
   reserve 25 — or the simplified variant: Search 100 / Meta 25 / reserve 25,
   LinkedIn organic only). Raising a cap is a one-line settings change but it
   is *your* approval gate — say which allocation you want and it lands as an
   approved change.
8. **LinkedIn profile/company page** (your explicit ask) — §5.

## 4. Access & API keys I need from you (to run campaigns without your help)

| Tool | What I need | Used for |
|---|---|---|
| **Google Ads** | MCC/admin access to your account (user with *Standard access* on the ad account), or: API developer token + OAuth refresh token + customer ID | create campaigns, keywords, negatives, ad copy, pull daily spend/conv |
| **GA4** | property editor access, or measurement ID (have it) + **API secret** (Measurement Protocol) + Data API enable | qualified-event ingestion, daily reports |
| **Google Search Console** | site verification (DNS or file) | SEO/keyword evidence |
| **Meta / Instagram** | Business account + a user with *Ads admin*, or Marketing API token + ad account id; IG professional account linked | the CHF 25 video test, creative publishing |
| **LinkedIn** | your LinkedIn login session once (or Marketing API access) + Company Page admin | company page, organic posts; paid later |
| **HubSpot / CRM** *(if still planned)* | portal id + private app token | lead sync (currently PostgreSQL is the system of record — not blocking) |

With Google Ads + GA4 keys alone the first Search experiment (CHF 80–100 on
the CNC page) can be launched and evaluated without you touching anything.

## 5. LinkedIn proposal (your ask: profile + a Kubotics landing on LinkedIn)

**A. Your personal profile `linkedin.com/in/vincentverbeke`** (untouched "a
very long time") — refresh, in this order:

1. **Headline** (220 chars, keywords first):
   *Founder @ Kubotics — automation & humanoid robotics for Swiss SMEs |
   CNC machine tending • LLM invoice automation • Unitree H2 test days |
   ex-…(previous roles)* — one line per offer, no buzzwords.
2. **About** (~1,200 chars, first 3 lines decisive): the problem you solve
   (production manager with a machine-tending bottleneck / back-office
   drowning in invoices), the three offers, proof, and a CTA link.
3. **Experience → Kubotics**: 4–5 bullets *outcome* style (turnkey Unitree
   distribution in CH, commissioning, AI-first automation), add the 2–3
   flagship links (CNC page, invoice page, H2 test day).
4. **Featured**: pin the CNC landing page, the H2 test-day page and one demo
   clip.
5. **Custom URL**, profile photo + banner (robot + Swiss context), settings
   → *Open to* → optionally "Founders"/"Automation" discovery.
6. **Activity restart**: 1 post/week before any paid spend (the external
   review's "organic first" advice) — first three posts: (a) H2 test-day
   recap with video, (b) invoice-automation before/after numbers, (c)
   CNC tending walkthrough.

**B. Separate Kubotics company page on LinkedIn** (the "Kubotics landing"):

1. Create *Company page* (kubotics.ch as website, tagline mirroring the
   headline, cover = H2/CNC visual, button **Visit website** → default to the
   CNC page during the test, switch to `/` later).
2. Add the five landing pages as **Page → Products/Services links** (or
   "Featured" posts) so the page itself works as a lightweight landing.
3. Move your personal posts to share from the Page (personal posts still
   reach more people — share *and* repost strategy: post personally, amplify
   via page).
4. Admin = you; give me access later via *Manage admins* (or a Marketing
   API token) once the page is live — needed for scheduling/paid.
5. Paid LinkedIn (CHF 20) stays **off** by default per the external review
   (likely too small to deliver); re-enable only if you want the test.

## 6. Recommended launch sequence (pending your GO)

1. Fix sitemap + commit today's conversion-tracking/ROI/readiness changes.
2. You grant Google Ads + GA4 access (§4) → I load the CNC campaign
   (exact/phrase CHF keywords, CH geo, negatives, two ad variants DE/EN) and
   wire the conversion actions.
3. Budget GO: CHF 100 Search / 25 Meta / 25 reserve (or your variant) —
   code caps raised in the same change, approval recorded in
   `spend/approvals`.
4. LinkedIn profile refresh + company page (§5) runs in parallel, organic
   only.
5. Needle evaluates daily (spend, qualified enquiries, meetings, cost per
   lead) against the caps; reserve is released only on its recommendation
   with your approval.

---

## 7. Addendum 2026-11-15 (campaign prep, GTM, new channels, follow-up)

**First campaign destination:** `/automation/it-business-process-automation`
(live, 200) — another agent is improving the page; the GTM rollout targets
this page first (see `GTM_MIGRATION_ANALYSIS_2026-11-15.md` — recommendation:
client-side GTM now, server-side GTM deferred as over-dimensioned).

**New channel — OpenAI ads (diverse lead tracking):** track from day 1 with
`utm_source=openai_ads` (+ medium/campaign) through the existing backend
attribution (no PII, lands on Contact like every other source). No
self-serve campaign API assumed: access path = your OpenAI account/console
(or their ads rep); add conversion integration when they expose one. Design
so needle's daily evaluation can compare `google|meta|linkedin|openai`
sources on equal footing.

**Access & API keys — the complete one-time checklist (what you grant, where
it lands, what it unlocks):**

| # | Tool | You provide (one time) | Lands in | Unlocks |
|---|---|---|---|---|
| 1 | **Google Ads** | MCC invite (user, *Standard* access) OR API trio: developer token + OAuth refresh token + customer ID | GitHub secrets → injected by the prepare step of `deploy.yml` | campaign/keyword/negative management, conversion actions, daily spend pull for needle |
| 1a | Google Ads state probe (2026-11-15) | account **226213290 exists** (visible in GA4 account picker under his login); ads.google.com UI is NOT session-active — opens marketing/signup only; I deliberately did NOT enter the Anmelden/setup/billing flow unattended | — | confirms row 1 still needs YOUR invite/API; billing/onboarding = your clicks only |
| 2 | **GA4** | editor on property `G-0H34P5Y9WX` + enable Data API; (later) Measurement Protocol API secret | same secrets path | event verification, daily metrics ingestion, optional server-side mirror |
| 3 | **GTM** | ✅ **DONE 2026-11-15 by Jcode in your session**: container `GTM-WG9P5H9M` (account *Kubotics* / *www.kubotics.ch*, ToS+DPA accepted, data-sharing off) + initial version published + id wired into `Kubotics/src/environments/environment.prod.ts` + live-verified (gtm.js loads from the site, page_view dedupe intact). REMAINING for Phase 2/3: GA4 editor + Ads access (rows 1–2) so I can configure tags (Google tag page_view OFF, Conversion Linker, conversion tags) and capture DebugView/Preview evidence | frontend env (one slot) + tag config | centralized tags per the migration spec |
| 4 | **Search Console** | DNS TXT record for `www.kubotics.ch` (I give you the value) | Google side | SEO/keyword evidence, sitemap submission (fixed sitemap ready) |
| 5 | **Meta / Instagram** | Business Manager user with *Ads admin* (or Marketing API token + ad-account id) + IG professional account linked | secrets path | the CHF 25 video test + spend ingestion |
| 6 | **LinkedIn** | company-page admin session (page build = out of scope for me); Marketing API later | his side | organic page + later paid |
| 7 | **OpenAI ads** | console/rep access | his side | 4th tracked source (`utm_source=openai_ads`) |
| 7a | **Claude / Anthropic ads** *(added 2026-11-15 for the CHF 100 test spread)* | ad-platform/console access on his side | his side | 4th paid channel (`utm_source=claude_ads`) — split proposal: Google/Meta/OpenAI/Claude 25 each, LinkedIn 0 (organic only) |
| 8 | **Telegram bot** | ✅ verified 2026-11-15 — no action needed: token valid (`getWebhookInfo`: url set, pending 0, no errors), webhook live **with secret enforcement** (only Telegram may post), outbound send path wired for follow-up | already wired |
| 9 | Email (M365) + WhatsApp Cloud | — | **already live** (mail agent + send health green) | follow-up channels 1–2 |

**Lead follow-up automation (your requirement: email/WhatsApp/Telegram,
zero manual work, LLM-drafted, the meeting with you = the only human
contact):** being built now in the backend behind `LEAD_FOLLOWUP_ENABLED`
(default off). Sequence: T+2h personalized email → T+24h WhatsApp **only
inside Meta's 24 h window** (else Telegram if linked, else email) → T+72h
final email whose ONLY next step is your booking link. Stops automatically
on: any reply from the lead, meeting booked, consent revoked/opt-out, 3
touches max, 25 sends/day, quiet hours 08–18 Zurich. Copy = LLM-drafted
(professional Swiss B2B, first name/company/interest only — no free text, no
PII to the model) with fixed-template fallback; full audit trail, admin
status/stop endpoints; consent basis documented (inbound-lead form consent,
FDPIC note). Doc: `Kubotics-Backend/docs/LEAD_FOLLOWUP_PLAN.md`. Enable only
after my review + your GO.

**Still open from yesterday:** budget GO (CHF 100/70 vs 150 split), claim
substantiation (98.5 %, <3 mo payback, <6 mo ROI), customer proof/demo
video, E2E UTM check on chat/booking paths, LinkedIn profile+page copy (your
side), H2 power-on for the light-dashboard cutover.

### 7b. Addendum 2026-11-15 afternoon — Ads/GA4 API chain + GTM state (Jcode)

**Done (evidence-backed):**
- **MCC live**: `KuroLIV Manager` **959-159-1842** (created in your session,
  reCAPTCHA yours). **Link request sent 15:09:13Z** to `618-225-5649`
  (KuroLIV GmbH) — first attempt died at Google's "Confirm it's you" (you
  verified), second landed: **two Google Ads emails at 16:09** in Outlook
  (invitation + pending request). MCC-side tables (Level: All, notifications)
  = empty ⇒ consistent with *sent, not yet accepted*.
  **→ your click: ACCEPT REQUEST in the 16:09 mail** (Outlook refused every
  automated activation of that link; the 618-account "Managers" tab was
  blocked by a stuck Ads loader overlay).
- **OAuth app `kubotics-pipeline` pushed to production**: branding saved
  (home `https://www.kubotics.ch/`, privacy `/datenschutz`, authorized domain
  `kubotics.ch`, support/dev contact = you) + "Push to production?" confirmed
  ⇒ testing-mode 403 and 7-day-token trap are gone; remaining for wide use =
  Google app verification (review later).
- **Consent flow built and re-driven**: desktop OAuth client
  `124391172420-…n03`, scopes `adwords` + `analytics.readonly`
  (`analytics.admin` = invalid_scope for OAuth — dropped), redirect
  `http://localhost:8080`. **Blocked only on your passkey** (prompt re-opened
  15:52 in the agent window) → then code → refresh token → GitHub secrets →
  live GA4/Ads API calls. Playground-default fallback refresh token (7-day)
  already minted and stored (scratch, 600) in case you skip the passkey.
- **Google Ads API enable page = Google-side, control-proven**: 10 failures
  with fresh Request IDs on `apis/library/adwords.googleapis.com` (2
  projects), while `analyticsadmin.googleapis.com`'s page loads perfectly on
  the same project/session ⇒ only that product page errors. Console
  workarounds tested dead (2026 console removed service-usage routes,
  standalone APIs Explorer retired, Try-this-API button unclickable under
  automation, Cloud Shell/press blocked by page Trusted Types).
  **→ your30s fallback: open that URL in your browser and click Enable API.**

**GTM:** container v5 live (GA4 tag + 7 dormant `EVT …` triggers). Phase 2c
(attach the 7 GA4 event tags, publish v6) is fully scripted but **parked as
`g2c`** — my browser helper regressed mid-session (Chrome restarted and
dropped the debug channel; the fallback helper binary needs GLIBC 2.39 vs
this host's 2.35), so screenshots/JS-eval/some clicks are degraded. Workspace
left clean (0 changes). Fix paths: `jcode update`, or your OK to relaunch
Chrome with `--remote-debugging-port` (disturbs open tabs), or a rebuilt
helper.

**Spend frame locked (your 14:46 numbers):** **CHF 100 TOTAL per 7-day test**
across Google/Meta/OpenAI/Claude (25 each), LinkedIn organic 0; evaluate →
improve → repeat until the process is optimized; success = lead conversions →
opportunities → sales (solo + LLM tooling). My earlier 400/280 monthly
proposal is **withdrawn**; per-cycle cap GO = yours once platform billing
entries are in (Meta/OpenAI/Claude need your logins; rows 5/7/7a).

**Also noted:** your LinkedIn developer app `266745874` (Kubotics page) is
ready for the LinkedIn lane (Marketing API token later); GitHub Actions run
`43213051882` (runtime state refresh) = green.
