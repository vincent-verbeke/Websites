# Cloud Trading Watcher — design, security & operations

**Authorization:** Vincent, 2026-11-01 18:03 — *"run the watcher in our
cloud service and ensure i get the alerts if needed via sms and the needle
can inform you — i authorize you to update the backend if fully documented
in a .md"* → this file is that documentation.

**Author:** Jcode (agent). **Status:** live in `kubotics-backend` (ECS),
verified end-to-end (§Testing).

---

## 1. Why

The 2026-11-01 review of the Binance live test found real open positions
(5 delta-neutral carry pairs + 8 momentum perp legs + spot legs) with **no
process monitoring them** since the 2026-10-25 rotation — the dev-PC loop had
stopped. Alerts must survive the dev PC being off, and must reach Vincent on
more than one channel. Moving the watcher into the always-on backend solves
both, and lets needle (PC-A) surface the alerts to Jcode sessions.

## 2. What it checks (every `TRADING_WATCH_INTERVAL_S`, default 600 s)

| # | check | alert condition |
|---|---|---|
| 1 | **Carry hedge integrity** | perp short vs spot long quantity mismatch > **5 %**, or a leg missing (`CARRY` map: CHR/DYDX/PEOPLE/SFP/UNI) |
| 2 | **Funding regime** | book est-24h funding < **−0.50 USD** (sign convention: positive rate ⇒ longs pay shorts ⇒ our shorts *receive*: contribution = `−sign(amt) × rate × notional × 3`) |
| 3 | **Position drift** | any open perp symbol not in `TRADING_WATCH_EXPECTED_PERP`, or an expected one closed (new/closed = visibility **and security**: nothing else should trade this account) |
| 4 | **Feed/key health** | Binance API error or missing keys → alert (visible, not silent) |

Healthy cycle log line: `[trading-watch] ok — {perps, usdt, checked_at}`.

## 3. Alert fan-out (all three, per authorization)

1. **Persisted event** — row in `inbound_events` with
   `channel="trading_watch"`, `sender_id="binance-watcher"`,
   `event_id="trading-alert-YYYYMMDDHHMM-<sha1_8>"`, `payload={problems,
   summary, test}`. Readable via the existing
   `GET /api/v1/events?channel=trading_watch&limit=…` (needle token).
2. **WhatsApp** — existing cloud gateway path
   (`whatsapp_service.send_text_message`) to the operator
   (`NEEDLE_OPERATOR_SENDERS`, `+41797481975`). Subject to the Meta 24 h
   window (prompt §9.8) — template fallback is tracked as prompt §9.8/§9.8a.
3. **SMS (optional)** — AWS SNS `publish(Message, PhoneNumber)` in
   `eu-central-1`, enabled by `TRADING_WATCH_SMS_ENABLED=true`
   (default **false** until SNS spend/sandbox is confirmed for the account).
   Failure is returned as a string and logged — WhatsApp stays primary;
   SMS problems never break the loop.

**Cooldown:** one shared `TRADING_WATCH_ALERT_COOLDOWN_S` (7 200 s),
counted from persisted events → survives restarts. `POST …/test` bypasses
cooldown by design.

## 4. Endpoints (both gated by `require_scheduler_token` = `X-Needle-Token`)

```
POST /api/v1/trading/watch/test    # one full cycle + forced fan-out (test:true)
GET  /api/v1/trading/watch/status  # flags, expected symbols, last_alert payload
```

## 5. Configuration (settings → task-definition env)

| env var | default | meaning |
|---|---|---|
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | *(injected)* | read-only signing (see §6) |
| `TRADING_WATCH_ENABLED` | `true` | master switch (also gates lifespan task) |
| `TRADING_WATCH_INTERVAL_S` | `600` | check cadence |
| `TRADING_WATCH_ALERT_COOLDOWN_S` | `7200` | alert suppression window |
| `TRADING_WATCH_SMS_ENABLED` | `false` | SNS SMS channel |
| `TRADING_WATCH_SMS_TO` | `+41797481975` | SMS destination |
| `TRADING_WATCH_EXPECTED_PERP` | current 13 symbols | drift baseline |

Injection path: `Kubotics-Backend/.aws/task-definition.json` `environment`
(private repo — same pattern the repo already uses; values are never logged
or returned by any endpoint). **Rotation:** edit the two values in the task
definition and re-run the backend workflow (or register the task def again).

## 6. Security contract (why these keys are acceptable in the container)

- The module performs **signed GET requests only**: `papi/v1/um/account`
  (positions), `api/v3/account` (balances), plus the **unsigned public**
  `fapi/v1/premiumIndex`. There is no order-placement path — grep for
  `POST|order|leverage` in `app/services/trading_watch.py` returns nothing
  order-related; no key material is ever written to logs/events/ payloads.
- Test: `tests/test_trading_watch.py::test_signed_qs_shape_never_contains_secret`.
- **Recommendation (Vincent):** replace the key pair with a dedicated
  **read-only** Binance API key (no Trade/Futures permission) and keep IP
  whitelisting OFF (ECS egress IPs change on redeploy). With read-only
  scopes, a container compromise still cannot move funds.
- Binance keys must **not** be added to GitHub secrets or the frontend
  workflow; they belong only in the backend task definition.

## 7. Consumers ("needle can inform you")

- **PC-A watchdog** (`needle3/n3_watchdog.py`, 15-min timer):
  pulls `GET /api/v1/events?channel=trading_watch&limit=5` with the needle
  token, compares against a local seen-cursor, and raises **new** alerts as
  watchdog problems → WhatsApp to Vincent + `needle3.db` events, which Jcode
  sessions surface via the `status` command.
- **Dashboard:** the same events feed is available to the website agent for
  a future alerts widget (no new endpoint needed).

## 8. Testing

```bash
uv run pytest tests/test_trading_watch.py -q     # 9 unit checks (pure logic)
# E2E (after deploy, needle token):
curl -X POST https://api.kubotics.ch/api/v1/trading/watch/test -H "X-Needle-Token: $TOK"
curl      https://api.kubotics.ch/api/v1/trading/watch/status -H "X-Needle-Token: $TOK"
```
Verified 2026-11-01: 9/9 unit tests; test endpoint returned
`{alerted, event_id, whatsapp: true, sms: …}` and the WhatsApp arrived;
SNS SMS result recorded in §9.

## 9. Rollout log (2026-11-01)

- Code: `app/services/trading_watch.py`, `app/api/v1/trading_watch.py`,
  config block, lifespan wiring, `boto3` dependency (pyproject).
- Tests: `tests/test_trading_watch.py` (funding-sign regression included —
  the dev-PC prototype had the sign inverted; fixed before shipping).
- ECS: task-definition env gained the binance + TRADING_WATCH_* keys;
  workflow deploy verified `COMPLETED`; first cycle log
  `[trading-watch] background loop started` + `ok — 13 perp legs …`.
- E2E test alerts (18:24/18:25 UTC): events rows persisted
  (`trading-alert-202611011824-e8355339`, `…1825-e8355339`), WhatsApp
  `true` twice. First SMS attempt failed `AuthorizationErrorException`
  (ECS task role lacked `sns:Publish`) → **fixed** by inline policy
  `kubotics-trading-watch-sms` (Action `sns:Publish`, Resource `*`) on role
  `ECSTasks`; retry returned `"sms":"sent"`. All three channels verified.
- Dev-PC switchover: `trading-watch.timer` disabled on the dev PC (cloud is
  primary; `scripts/trading/trading_watch.py` remains as a documented local
  fallback: `python3 scripts/trading/trading_watch.py`).

## 10. Runbook

- **Silence is healthy** — the watcher only speaks on problems (or `/test`).
- Disable: `TRADING_WATCH_ENABLED=false` (task def) → redeploy.
- Re-verify channels anytime: `POST /api/v1/trading/watch/test`.
- Expected-symbol changes (new rotation): update
  `TRADING_WATCH_EXPECTED_PERP` in the task definition in the same change
  that places the trade, else drift alerts fire (intended).
- SNS SMS enablement: AWS console → SNS → SMS → spending limit; then set
  `TRADING_WATCH_SMS_ENABLED=true`.

## 11. Frontend integration — Investments tab (Vincent, 2026-11-01 19:22)

*"integrate this also in the frontend in the investments tab below the IBKR
investments — you can implement the changes in backend and frontend."*

**Backend** (zero new endpoints, zero new auth paths):
- `GET /api/v1/investments` (and `/dashboard/investments`) now embeds a
  `trading_watch` block in **both** response shapes (cached + offline):
  `{enabled, sms_enabled, interval_s, binance_keys_configured,
  last_check, recent_alerts[≤5], error?}`.
  - `last_check` = process-local heartbeat written by every `run_once`
    (ts/ok/legs/usdt/problems); resets on deploy — the UI labels it
    "since last deploy" when absent.
  - `recent_alerts` = newest 5 `inbound_events` rows (channel
    `trading_watch`): `{event_id, created_at, problems[], test}`.
  - The block is wrapped in try/except — an error can never break the IBKR
    feed (`{"error": TypeName}` instead).
- `GET /api/v1/trading/watch/status` now returns the **same block** plus
  `cooldown_s`, `expected_perp`, `last_alert` (back-compat keys kept).

**Frontend** (`Kubotics/src/app/pages/dashboard/legacy/features/investments/investments.component.ts`):
- New interfaces `TradingWatchBlock` / `TradingAlertItem` / `TradingWatchCheck`
  and `InvestmentsFeedResponse.trading_watch`.
- New `sec-card` **"Binance Trading Watcher"** rendered *below* the IBKR
  sleeves section: chips (enabled / keys / SMS / last-check age via `ageOf()`)
  and a recent-alerts table (When · Problems · TEST|ALERT), empty state
  "No alerts — every watcher check is green ✓".
- No additional HTTP call: the block piggybacks the existing 15 s poll.

**Verified:** backend `uv run pytest tests/` → 22 passed; `npm run build`
clean; post-deploy `GET /api/v1/investments` contains `trading_watch` with a
live `last_check`; dashboard tab visually checked in a real browser.

### §11a — Per-asset details since 2026-11-01 + gate string fix (19:41–19:45)

- **Per-asset cumulated income:** each watcher cycle additionally aggregates
  signed `GET /papi/v1/um/income` (paged, `startTime = 2026-11-01 00:00 CET`)
  into `block.per_asset_since = {since, computed_at, rows, assets[], totals}` —
  per symbol: `funding_usd, fees_usd (signed), realized_usd, other_usd,
  net_usd, events, position (open perp amt)`. Failures set `error` in the
  block and never alert (details are best-effort). Pure core:
  `aggregate_income()` (unit-tested).
- **Frontend:** the watcher card gained a "Per-asset cumulated since Nov 1,
  2026 (USDT)" table with green/red signs and a TOTAL row; rides the same
  15 s poll.
- **Gate `[object Object]` fix (pusher side, contract §10 clarification):**
  `ibkr_pusher.state_payload()` now emits `gate` as the **string verdict**
  (`BUY` iff trend ∈ {increasing, sideways}, else `WAIT` — the daily_invest
  rule) and keeps the raw object as `gate_detail`. The dashboard template
  (`sl.gate === 'BUY'` chips) therefore renders correctly; deployed by the
  next 10 s pusher cycle. Pusher tests: 16/16.

## 12. Tablet (Android Chrome) dashboard login — root cause & fix (19:53→21:04)

**Symptom (Vincent):** tapping Login on the Android-Chrome tablet "opens a
new tab with the same content, not logged in".

**Root cause:** `AzureAuthService.login()` used MSAL **`loginPopup`**.
Android Chrome has no popup windows — `window.open` becomes a **new tab**,
and MSAL's popup-completion handshake (opener ↔ popup correlation, popup
close signalling) does not resolve reliably there: the new tab completes the
Entra redirect but the auth result never lands in the initiating context, so
`getAllAccounts()` stays empty → dashboard renders logged-out. Desktop
Chrome (popups = real windows) works, which is why only the tablet showed it.

**Fix** (`Kubotics/src/app/core/services/azure-auth.service.ts`):
- `isMobileBrowser()` (Android/iPad/iPhone UA) → **`loginRedirect` /
  `logoutRedirect`** — full-page flow, single document, no popup handshake.
  The return leg (`/dashboard?code=…&state=…`) is handled by the **existing,
  already-proven** `handleRedirectPromise()` branch in `initMsal()`, with the
  account persisted in `localStorage` (cross-load survives).
- Desktop keeps `loginPopup` unchanged (verified working).

**Verification:** `npm run build` clean; behavior verified in Chrome by
emulating the Android UA and asserting the login click navigates the **same
tab** to `login.microsoftonline.com` (no new tab). Final proof = Vincent's
tablet: tap Login → single-tab Entra → returns to /dashboard logged in
(report if anything still misbehaves; next lever = device-code flow).

## 13. Lead data integrity — WhatsApp phone gap (Vincent 2026-11-02 morning)

**Report:** a genuine lead ("Dr. Thomas Meier", WhatsApp, 2026-10-25 13:35)
had **no email and no phone stored**.

**Root cause (forensics):** the WhatsApp intake path
(`agent_core._resolve_contact`) created `Contact` + `ExternalIdentity`
(phone = `external_user_id` **was** captured there: `41791112233`) but never
wrote a `crm.contact_mailphone` row — only the website form path
(`lead_service`) does. Dashboard reads email/phone from `contact_mailphone`
(hence "useless" lead). Conversation rows for whatsapp contacts were also
absent (agent_core's conversation logic exists but the whatsapp routing path
did not exercise it on 10-25 — flagged for the website agent to trace).

**Fixes applied (Jcode, authorized by Vincent "ensure …100% fine"):**
1. **Data backfill** (idempotent INSERT … WHERE NOT EXISTS): phone rows for
   every WhatsApp identity lacking one → Thomas now
   `phone_mobile=41791112233` (verified via SQL).
2. **Code guard** (`agent_core.py::_resolve_contact`): new WhatsApp contacts
   now get `ContactMailPhone(channel_type='phone_mobile', value=external_user_id,
   label='whatsapp', is_primary=true)` at creation time. Telegram is excluded
   on purpose (external id ≠ phone number).
3. Form path already compliant (`lead_service` writes email + optional phone);
   booking card requires email client-side (verified 2026-11-01 §Testing).

**Residual handed to the website agent:** conversation persistence for the
whatsapp->agent_core route (no `crm.conversations` rows exist for any
whatsapp contact) + whether the "default customer reply" fallback path bypasses
agent_core entirely — see prompt §15.

## 14. Bi-daily needle review job (Vincent 2026-11-02 08:23)

*"foresee the needle orchestrator to get do a review job by you every 2nd day
around 8 pm so we follow-up if our plan still works."*

Implemented needle-side (`needle3/tasks.py::_emit_review_task`): every 2nd
day at/after **20:00 Europe/Zurich** the worker posts a `dev_task`
(`event_id review-task-YYYYMMDD`, session `n3review-YYYYMMDD`) whose prompt
drives a **read-only** plan review (positions vs expected set, funding sign,
watcher alerts/status, per-asset net since Nov 1, IBKR gates/orders, ledger
last 2 days, adherence incl. the +5000 CHF deposit status) and WhatsApps a
≤900-char verdict starting `📋 trading review (date):`. Completion is
reported through the daemon's existing "session done" reply. Guards: flag,
48h marker cadence, hour gate, server-side event_id dedupe; tests 43/43.
First run: 2026-11-02 ~20:00; Jcode self-check scheduled 20:05.

## 16. B2 — lead attribution persisted (Vincent 2026-11-02 "do it yourself")

- **Contact columns added** (idempotent startup migration in `main.py`, since
  `create_all` never ALTERs and alembic is still pending per prompt §8):
  `utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid,
  referrer_url, first_touch_at, last_touch_at`.
- `InboundLeadCreate` gained optional `utm_content`/`utm_term`; **every form
  lead** now runs `apply_attribution()` (last-touch semantics: provided
  values overwrite; first_touch stamped once; last_touch on every touch).
- Unit-tested: `tests/test_marketing_guard.py` (attribution + touches).
- **Note:** existing leads keep NULL attribution (only new leads are stamped);
  events-level UTM (already working) remains the historical source.

## 17. B3 — consent & suppression

- **Contact columns:** `consent_status (unknown|lead_form|granted|denied,
  default unknown), consent_source, consent_at, suppressed, suppression_reason`
  (+ same startup migration).
- Automatic sources: website form submission → `lead_form/website_form`;
  inbound WhatsApp → `granted/<channel>_inbound` (the contact initiated the
  conversation). Manual denial/suppression is set by the operator/dashboard
  and must be respected by every future campaign sender (filter
  `suppressed=false AND consent_status IN ('granted','lead_form')`).

## 18. B4 — campaign metrics ingestion (needle's evaluation source)

- Table `crm.campaign_metrics` (unique key campaign+channel+day) with
  spend/impressions/clicks/leads/conversions + `extra` JSON.
- `POST /api/v1/campaigns/metrics` — Bearer needle token, **idempotent
  upsert**; `GET /api/v1/campaigns/metrics?date_from&date_to&campaign` —
  rows + totals for the needle daily evaluation.
- Validation in `normalize_metric()` (required campaign/channel/day,
  parseable date, non-negative numbers) — unit-tested.

## 19. B5 — spend caps + Vincent approval gate (§6 hard boundary)

- Settings: `SPEND_TOTAL_CAP_CHF=100`, `SPEND_SEARCH_CAP_CHF=70`,
  `SPEND_APPROVAL_PHRASE` (typed in the UI; never shipped in a bundle).
- Tables: `spend_approvals` (pending → approved/rejected + decided_by/at),
  `spend_records` (amount/channel/purpose/approval_id/source).
- Flow (enforced in `spend_decision()` + `POST /spend/records`):
  1. `POST /spend/approvals` → always **pending**
  2. Vincent decides: `POST /spend/approvals/{id}/decision`
     `{decision, phrase}` — **403 unless the phrase matches** (bearer token
     AND phrase: machine auth + your explicit go)
  3. `POST /spend/records` → **403 unless** an approved approval covers it
     AND the amount fits the month-total cap (and the Google/Search sub-cap
     for google-ish channels). GET `/spend/status` = caps, used, remaining,
     approvals, records (dashboard feed).
- Tests: approval-first, caps (total + search sub-cap), zero/negative,
  metric normalization, month window — full suite **34 passed**.

### §19a — auth-model errata after browser integration (07:46–07:50)

E2E-verified on task-def 33: the UI required a token-free read path, so the
final model is — **public reads** (`GET /spend/status`,
`GET /campaigns/metrics`: caps/usage/approval metadata carry no secrets;
same policy the repo already chose for `GET /investments`), **phrase-only
decision** (`POST /spend/approvals/{id}/decision` — the typed approval
phrase is THE gate; keep `SPEND_APPROVAL_PHRASE` non-guessable), and
**bearer-gated writes** (`campaigns/metrics`, `spend/approvals`,
`spend/records` — server/needle/agent side only). Smoke results: caps read
200; metric upsert idempotent; wrong phrase → 403; right phrase → 200
approved; record with pending/absent approval → 403; approved record → 201
with correct remaining math (92.50 total / 67.50 search); over-cap → 403.
All smoke rows deleted afterwards (ledger left at zero).

## 20. WhatsApp template wake-up — watcher-path note (2026-11-02 16:33)

No code change; documentation of an interaction discovered while Vincent
submitted the wake-up template. Context: §9.8b of the website-agent prompt
records the actually-submitted HSM template `kubotics_alter_wakeup`
(Marketing, English→`en`, variable `{{1}}` in the TEXT HEADER, generic body,
"In review" at 16:29) and the `last_inbound > 24h → template` fallback rule
for `POST /api/whatsapp/send` (that code belongs to the website agent).

Impact on this watcher: `_send_whatsapp()` calls
`whatsapp_service.send_text_message()` **directly**, i.e. it bypasses the
send endpoint where the agent will add the fallback. Consequence: when no
24h session window is open, watcher WhatsApp alerts are Graph-accepted but
undelivered (the §9.8 root cause) — exactly as before the template existed.

Decision (deliberate, no action now): the watcher's guaranteed-delivery leg
is **AWS SNS SMS**, which is unaffected by WhatsApp window rules, and watcher
alerts are by design rare. The WhatsApp leg stays best-effort until either
(a) the agent exposes the template send as a reusable service helper, or
(b) a follow-up wires `send_template_message()` next to
`send_text_message()` in `whatsapp_service.py` and the watcher switches on
window state. If (b) is ever done: fetch the approved template structure
first (see prompt §9.8b — header-variable, `language.code=en`,
≤60-char header text) instead of assuming body variables.
