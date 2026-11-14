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
| Conversion tracking for *qualified* events | 🟡 **in the working tree, not yet committed**: `schedule_appointment` + `ads_conversion_MEETING_SCHEDULED`, `qualify_lead` fired from `submitLead`, ROI methodology transparency, readiness score starting at 0 % (`ng run build` verified green today — commits land with this batch) |
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
