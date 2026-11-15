# LEAD FOLLOW-UP PLAN — automated multi-channel lead follow-up (default OFF)

Vincent, 2026-11-15: *"ensure that we have a way to follow up the leads
completely via email / whatsapp / telegram without manual intervention and
professional llm interaction and only the last contact should be the meeting
with me."*

This doc is the contract for `src/app/services/lead_followup.py`,
`src/app/models/lead_followup.py`, `src/app/api/v1/lead_followup.py` and
`tests/test_lead_followup.py` (53 tests, no network, no real DB). Conventions
mirror `docs/IBKR_MCP_BACKEND.md` §10: default-OFF flag, admin-gated ops
endpoints, fail-soft loop, env flags listed for `.aws/task-definition.json`.

**Master switch: `LEAD_FOLLOWUP_ENABLED` (default `False`).** With the flag
off, `maybe_start_followup_loop()` returns `None`, no task registers in the
lifespan, and nothing is ever drafted or sent. The two admin endpoints still
answer (they report `enabled: false`), so the wiring is verifiable **before**
the flag is flipped.

---

## 1. The sequence (times, channels, stop conditions)

```mermaid
sequenceDiagram
    autonumber
    participant L as Lead (form / WhatsApp / Telegram)
    participant S as lead_followup loop (300s tick)
    participant V as Vincent (meeting only)

    Note over S: anchor = max(lead created, last inbound)
    rect rgb(240,248,255)
    S->>L: T+2h — step 1 EMAIL (LLM-drafted, DE/EN)<br/>references primary_interest + kubotics.ch<br/>invites a plain REPLY — no meeting yet
    end
    Note over S: STOP checks run BEFORE every send:<br/>replied · meeting_booked · consent · opt-out<br/>lead older than 7d · maxed · daily cap · quiet hours
    rect rgb(240,255,240)
    S->>L: T+24h — step 2 WHATSAPP iff last inbound<br/>WhatsApp <24h old (Meta window), else TELEGRAM<br/>(if ExternalIdentity), else EMAIL
    end
    rect rgb(255,248,240)
    S->>L: T+72h — step 3 EMAIL (final): the booking<br/>link is the ONLY next step, no more marketing
    end
    L-->>V: Lead replies at ANY point → status "replied"
    Note over S,V: automation stops for that lead;<br/>the human/agent conversation takes over
    L-->>V: Lead books via bookings.cloud.microsoft<br/>(or lifecycle moves past "lead") → "meeting_booked"
    V->>L: THE MEETING — Vincent's only automated-flow task
```

Timing rules (Europe/Zurich):

| Step | Channel order | Due |
|---|---|---|
| 1 | **email** → whatsapp (window) → telegram | T+2h after `max(contact.created_at, last inbound message)` |
| 2 | **whatsapp (window)** → telegram → **email** | T+24h after touch 1 |
| 3 | **email** → whatsapp (window) → telegram | T+72h after touch 2; after the send the row goes `maxed` |

Hard channel rules (all enforced in `resolve_channel`):

* **WhatsApp ONLY inside the Meta 24h customer-service window** — the lead's
  last INBOUND WhatsApp message must be `< 24h` old (strict: exactly 24h is
  already closed). Encoded literally as `WHATSAPP_WINDOW = timedelta(hours=24)`.
* **Never a channel the lead never used AND has no contact point for**:
  email requires a `ContactMailPhone(channel_type='email')` row; whatsapp
  requires `channel_type='phone_mobile' + label='whatsapp'` (agent_core's
  backfill) or `channel_type='whatsapp'`; telegram requires an
  `ExternalIdentity(channel='telegram')` — which only exists if they messaged
  the bot. No contact point anywhere ⇒ `no_reachable_channel` (logged, row
  `stopped` — never a blind send).
* **Needle operator numbers are never lead targets** — the phone is normalized
  exactly like `whatsapp._clean_phone_digits` and checked against
  `NEEDLE_OPERATOR_SENDERS` (Vincent's own lane).

## 2. STOP matrix (evaluated before EVERY send; each lands in the log)

Order matters (first match wins) — `evaluate_stops()`:

| # | Condition | Detection | Resulting `status` | `detail` |
|---|---|---|---|---|
| 1 | Opt-out keyword | latest inbound message matches `^(stop|stopall|unsubscribe|abmelden|abbrechen|opt_out)[bitte|please]?$` (command-only, `"Stop by tomorrow"` does NOT match) | `stopped` | `opt_out_keyword` (+ sets `Contact.suppressed=True`, reason `followup_keyword_opt_out`) |
| 2 | Suppression flag | `Contact.suppressed` | `stopped` | `opt_out_suppressed` |
| 3 | Consent revoked / never allowlisted | `Contact.consent_status ∉ {lead_form, granted}` | `stopped` | `consent_not_allowed` |
| 4 | Meeting booked | `Contact.lifecycle_stage != 'lead'` (see gap note §6) | `meeting_booked` | `lifecycle_<stage>` |
| 5 | Reply received | any `Message(sender_type='visitor')` with `created_at > row.last_sent_at` | `replied` | `inbound_after_last_touch` — human/agent conversation takes over |
| 6 | Touches exhausted | `row.step > LEAD_FOLLOWUP_MAX_TOUCHES` | `maxed` | `touches_exhausted` |
| 7 | Lead too old | `contact.created_at < now - 7 days` | `stopped` | `lead_too_old` (never send to a >7d lead, re-checked at every touch) |
| — | Quiet hours | outside 08:00–18:00 Zurich | *(no row)* | whole cycle defers (`quiet_hours: true`) |
| — | Daily cap | `ok` rows today ≥ `LEAD_FOLLOWUP_MAX_PER_DAY` | row stays `pending` | `daily_cap` — the lead is deferred to tomorrow 08:00 and the cycle halts |
| — | Cycle cap | ≥ 10 sends in one tick | *(no row)* | `cycle_cap` (next tick continues) |
| — | Send failure | provider returned falsy / raised | row stays due | `failed`/`send_failed:<kind>`; 3 failures on the SAME step ⇒ `stopped`/`send_failures_exhausted` (no blind retry loop) |

Selection gates (before a lead ever enters the sequence,
`candidate_skip_reason`): `lifecycle='lead'`, `created_at ≤ 7 days`,
consent allowlist, not suppressed, no terminal row
(`stopped|replied|meeting_booked|maxed`), and due (T+2h anchor / `next_due_at`).

Row status semantics (`lead_followups.status`): `pending` = scheduled, next
touch waits for `next_due_at` · `active` = next touch due now (transient; a
crash mid-cycle leaves it due, so the next tick re-picks it) · terminal:
`stopped` `meeting_booked` `replied` `maxed`.

## 3. Consent basis (what allows each send)

Consent mechanisms **found in the codebase** (all gated on):

1. **`Contact.consent_status`** (`unknown | lead_form | granted | denied`,
   docs §17) with `consent_source`/`consent_at`. Writers found:
   * `lead_service.apply_lead_form_consent` → **`lead_form` / `website_form`**
     on every `/api/v1/leads` submission. **This is the form-consent record:
     submitting the lead form is the inbound consent to be contacted about
     that inquiry** (basis for step 1 email).
   * `agent_core._resolve_contact` → **`granted` / `whatsapp_inbound`** when a
     contact first messages via WhatsApp ("the contact initiated the
     conversation → replying is consented").
   * default **`unknown`** (telegram/web inbound) ⇒ **not** allowlisted, never
     auto-contacted.
   * `denied` exists in the schema (no writer yet) ⇒ hard skip.
   * The follow-up allowlist is exactly `{lead_form, granted}` — an explicit
     allowlist, everything else skips with reason.
2. **`Contact.suppressed` + `suppression_reason`** (B3 columns, docs §17) —
   the kill switch. Checked at selection AND before every send.
3. **`mail_agent.header_hard_filter`** — `list-unsubscribe`/`list-id` headers
   mark bulk mail (mail-agent lane only; not a per-contact field, but treated
   as the reason the follow-up never touches the mail-agent's inbound path).
4. **Needle operator lane** (`NEEDLE_OPERATOR_SENDERS`) — operator messages are
   Vincent's, never lead traffic; their numbers are excluded as recipients.
5. **Meta 24h window** — WhatsApp outbound only inside the customer-service
   window of a genuine inbound (policy rule, now enforced in code; before this
   feature nothing enforced it).
6. **NEW (added by this feature): opt-out keyword detection** — an inbound
   message that *is* `STOP`/`ABMELDEN`/`UNSUBSCRIBE` (optionally + bitte/
   please) sets `suppressed=True` and stops the sequence. Conservative: only
   the bare command counts, longer messages containing the word do not.
7. Related but out of scope: `MAIL_AGENT_ONLY_SENDERS` (mail-lane emergency
   brake) — the follow-up does not read the mailbox at all.

**FDPIC note (Swiss data protection):** the follow-up processes names,
companies and inquiry topics of people who submitted a lead form or
messengered Kubotics — a legitimate-interest / pre-contract communication
about *their own inquiry*, limited to 3 touches in 7 days, with an explicit
opt-out honored at any time (keyword or `suppressed` flag) and a hard stop on
reply. No cold lists are imported: only contacts already in this CRM with a
recorded consent state are eligible. Log/audit rows and API responses carry
**no message bodies and no recipient addresses** (subject previews only), so
the audit trail itself stays minimal (data-minimization). If the FDPIC or a
lead asks: `lead_followup_log` is the complete record of what was sent when,
and `POST /stop` + `suppressed=true` terminate everything within one tick.

## 4. Caps and quiet hours

| Control | Value (flag) | Behavior |
|---|---|---|
| Sequence depth | `LEAD_FOLLOWUP_MAX_TOUCHES = 3` | after touch 3 the row is `maxed`; a lowered flag value stops sequences above it |
| Daily sends | `LEAD_FOLLOWUP_MAX_PER_DAY = 25` | counted from `lead_followup_log` rows `status='ok'` since 00:00 Europe/Zurich; on hit: defer lead to next 08:00, halt the cycle |
| Per-tick sends | 10 (constant `MAX_PER_CYCLE`) | remaining due leads continue next tick |
| Quiet hours | `LEAD_FOLLOWUP_QUIET_START = 8`, `LEAD_FOLLOWUP_QUIET_END = 18` (Europe/Zurich, hour granularity, start inclusive / end exclusive) | no sends outside the window; the whole cycle no-ops (`quiet_hours: true`) |
| Lead age | 7 days (constant) | selection SQL + re-check before every send — a >7-day-old lead is NEVER written to |
| Tick | 300 s (constant `CYCLE_TICK_S`) | loop: 5 s boot grace, fail-soft, one bad cycle never kills it |
| LLM drafting | 20 s bounded (`LLM_TIMEOUT_S`) | `asyncio.wait_for` around `mail_llm.chat_json` (the MAIL_AGENT_LLM_CHAIN resolver); any failure/timeout/shape violation ⇒ pre-written template |

## 5. LLM drafting + fallback

* Fixed system instruction per step × language: Swiss B2B tone, DE default /
  EN when indicated, ≤ 120 words, no promises we cannot keep, no fake
  references/testimonials, fixed sign-off
  (`Vincent Verbeke — Founder, Kubotics`), JSON out `{"subject","body"}`.
* The user prompt contains ONLY: `language`, `first_name`, `company`,
  `interest` (from `Opportunity.deal_type`, which the lead form wrote). No
  emails, phones or free text ever enter the prompt.
* EN selection: last inbound message looks English (≥2 signal words) OR
  `preferred_language`/conversation language starts with `en`; otherwise DE.
* Output validated: non-empty subject/body, body ≤ 1400 chars / 160 words;
  anything else falls back.
* **Template fallback: 3 pre-written templates per language (step 1/2/3 ×
  de/en)** — a failed, timed-out or malformed LLM call NEVER blocks a send
  (tested: `source="template"` rows still dispatch).

## 6. Gap note: meeting-booked detection

There is **no appointments/bookings table and no booking webhook in this
repo** — meetings land via the external Microsoft Bookings page
(`https://bookings.cloud.microsoft/book/KuboticsGet2Know@kuroliv.ch/?ismsaljsauthenabled`)
straight into Outlook, invisible to the backend. `/api/v1/meetings/schedule`
creates a Teams event but persists nothing. Therefore the **detectable marker
used = lead lifecycle moving past `lead`** (set when a meeting/opportunity is
confirmed), plus the universal `replied` stop (a lead who booked almost always
replies first) and the admin stop endpoint. If a real booking signal is ever
needed, the follow-up already stops on `meeting_booked` the moment
`Contact.lifecycle_stage` changes — that field is the hook.

## 7. Enable steps (Vincent flips these)

Add to `.aws/task-definition.json` container definitions (names exactly as
below; repo default stays OFF if omitted):

```json
{"name": "LEAD_FOLLOWUP_ENABLED",    "value": "true"},
{"name": "LEAD_FOLLOWUP_MAX_TOUCHES", "value": "3"},
{"name": "LEAD_FOLLOWUP_MAX_PER_DAY", "value": "25"},
{"name": "LEAD_FOLLOWUP_QUIET_START", "value": "8"},
{"name": "LEAD_FOLLOWUP_QUIET_END",   "value": "18"}
```

Prerequisites already in the task def / secrets: M365 cert auth
(`AZURE_*`, `M365_ORGANIZER_EMAIL` — reused as the email FROM, deliberately
**no** `LEAD_FOLLOWUP_EMAIL_FROM` flag), `WHATSAPP_ACCESS_TOKEN` +
`WHATSAPP_PHONE_NUMBER_ID`, `TELEGRAM_BOT_TOKEN`, an LLM key for at least one
`MAIL_AGENT_LLM_CHAIN` provider (else templates are used, sends still work).

Pre-flight: `GET /api/v1/leads/followup/status` with
`Bearer <NEEDLE_TOKEN or API_SECRET_KEY>` → `"enabled": false` proves the
routes are live without sending anything; flip the flag and check
`loop_started_at` becomes non-null on the next deploy.

## 8. Ops endpoints (admin: `Authorization: Bearer <NEEDLE_TOKEN|API_SECRET_KEY>`
or `X-Needle-Token`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/leads/followup/status` | `{enabled, loop_started_at, counts{pending,active,stopped,meeting_booked,replied,maxed}, today_sends, today_cap, max_touches, quiet_hours[8,18], next_due[{contact_id, step, next_due_at}]}` — `contact_id` only, **no PII** (no names, addresses, subjects) |
| POST | `/api/v1/leads/followup/{contact_id}/stop` | idempotent: row → `stopped`, `next_due_at=None`, one `admin_stop` audit entry; `404` for unknown contact |

Audit table `lead_followup_log` (PII rule): `contact_id, step, channel,
subject_preview (email subject only, ≤200 chars — never a body),
provider_message_id (wamid / telegram message id), status ok|skipped|failed,
detail (machine reason only)`.

## 9. What the human still does

**Vincent = the meeting only.**

* He does **not** draft, schedule, chase, or triage leads — steps 1–3 run
  unattended, stop on reply, and never leave the 7-day/3-touch/25-per-day box.
* The moment a lead replies (or lifecycle advances), the automation exits and
  the existing human/agent conversation takes over — nothing is auto-sent
  afterwards.
* The only inbound the flow deliberately produces for him is step 3's
  booking link: **the meeting is the last contact** — he shows up to it.
* Manual levers, if ever needed: `POST .../followup/{contact_id}/stop`,
  `Contact.suppressed = true`, consent `denied`, or flipping
  `LEAD_FOLLOWUP_ENABLED=false` (loop deregisters on restart).
