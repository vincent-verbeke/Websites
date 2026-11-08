# Kubot Mail Agent — Cloud Auto-Reply Service (Implementation Plan)

Status: **DRAFT for Vincent's review — no code written yet.**
Date: 2026-11-08. Replaces the PC-A mail watch (`ros2_reusable_stack/scripts/mail/*`)
with a fully backend-hosted service in this repository.

---

## 1. Goal

Monitor Vincent's M365 mailbox through Microsoft Graph from this backend and
reply automatically, in the sender's language, always as **Kubot — Vincent's
personal digital AI assistant**, with these rules:

| # | Rule | Action |
|---|------|--------|
| R1 | Mail is a reply to an email **I sent in the last 7 days** (thread match) | Analyse + auto-reply |
| R2 | Sender is one of **my contacts** (allowlist, Vincent maintains it) | Auto-reply |
| R3 | Message is **advertising / spam** | Ignore (logged, never replied) |
| R4 | Message is **informational** | Personalised thank-you reply |
| R5 | Message is a **follow-up** to my previous email | Analyse + reply |
| R6 | Message is **critical** | Reply + **WhatsApp alert to Vincent** (review urgently) |
| always | Reply opening | Introduce as Kubot in the message language + 48 h posture |

**Reply posture (R5/R6 substantive mail):** "this topic needs Vincent's
expertise for a detailed answer, I will discuss it with him, and either he or I
will answer within the next 48 hours." Informational mail (R4) gets a warm,
personalised thank-you instead.

---

## 2. What already exists (reused, not rebuilt)

| Asset | Where | Reuse for |
|---|---|---|
| Graph cert auth (app-only, MSAL) | `src/app/services/m365_service.py` | Token for inbox read + reply |
| `Mail.Send` application permission | Entra app (docs/M365_APP_SETUP.md §3) | Sending replies (already proven) |
| `Mail.Read` used by PC-A poller | same Entra app | Reading inbox (verify, §7) |
| Proven reply mechanics: `POST /messages/{id}/reply`, watermark, internetMessageId dedupe, **send-attempt marker (no blind retry)** | PC-A `mail_watch.py` (rounds 16–38 hardened) | Ported 1:1 into DB-backed state machine |
| Background loop in FastAPI lifespan | `trading_watch.watch_loop` in `main.py` | Identical pattern for the mail loop |
| WhatsApp Cloud API sender | `whatsapp_service.send_text_message` | Critical alerts (R6) |
| LLM keys already injected into the container | deploy.yml → task-def (`GROQ`, `OPENAI`, `ANTHROPIC`, `GEMINI`) | Classification + reply composition |
| Normalised event stream | `inbound_events` (channel `email` already valid) | Observability / dashboard / needle |
| Bearer auth helpers | `require_ingest_token` (API_SECRET_KEY) | New admin endpoints |
| Test harness | 34 tests passing (baseline verified 2026-11-08) | New pure-function tests |

**No new Python dependencies are required** (httpx, msal, openai, groq already
in `pyproject.toml`).

---

## 3. Process design

```mermaid
flowchart TD
    A[Graph poll every 60s<br/>inbox metadata only $top=100<br/>watermark + internetMessageId dedupe] --> B{Hard filters<br/>no LLM, cheap}
    B -->|own mail / auto-reply headers /<br/>List-Unsubscribe / noreply@ /<br/>bulk headers| X[Ignore - logged]
    B --> C[Fetch body of new messages only]
    C --> D{Sender tier lookup}
    D -->|allowlisted contact| E[ board / vip / customer / partner / lead ]
    D -->|thread match: conversationId found in<br/>Sent Items within last 7 days| F[thread_reply]
    D -->|neither| G[unknown]
    G --> X
    E --> H[LLM classify #1<br/>language, category, criticality,<br/>spam probability, summary]
    F --> H
    H -->|spam / commercial > threshold| X
    H --> I{Decision matrix<br/>pure function, unit-tested}
    I -->|informational| J[LLM compose #2<br/>personalised thank-you]
    I -->|followup / request| K[LLM compose #2<br/>Kubot intro + needs Vincent's expertise<br/>+ answer within 48h]
    I -->|critical / complaint| K
    K --> L[Reply POST /messages/id/reply<br/>attempt marker persisted BEFORE POST<br/>never blind-retry]
    L --> M[(mail_messages ledger)]
    I -->|critical| N[WhatsApp to Vincent<br/>urgency + summary + link]
    J --> M
    H -->|classified| O[(inbound_events channel=email<br/>+ state in ledger)]
    X --> M
```

### 3.1 Polling (ported PC-A semantics, DB-backed)

* Metadata-only scan: `$select=from,subject,receivedDateTime,internetMessageId,
  conversationId,isRead,webLink`, `$top=100`, `$orderby=receivedDateTime desc`
  (PC-A lesson: full bodies = 34 MiB payload, never scan bodies).
* Watermark (`receivedDateTime`, strict `<` compare) + dedupe by
  `internetMessageId` in a new `mail_messages` table (UNIQUE constraint =
  idempotency across restarts **and** across ECS tasks).
* Body fetched per new candidate message only, truncated (8 000 chars).
* Default interval 60 s (PC-A ran 10 min; cloud is always on).

### 3.2 Reply-to-my-mail detection (R1/R5)

1. Take incoming `conversationId`.
2. Query Sent Items:
   `messages?$filter=conversationId eq '{cid}' and sentDateTime ge {now-7d}&$top=1`.
3. Hit → eligible as `thread_reply`; miss → fall back to sender allowlist (R2),
   else `unknown` → **ignore** (policy, §4.3).

This is the only reliable way to enforce "my original email was sent in the
last 7 days" (In-Reply-To alone cannot tell the age of *our* message).

### 3.3 Two LLM calls maximum per candidate message

1. **Classify** → strict JSON: `language`, `category`, `criticality`,
   `spam_probability`, `summary`, `requires_expertise`.
2. **Compose** → the reply body (HTML + text), only when the decision says
   "reply".

In `observe` mode only call #1 runs. Spam/unknown senders never reach the LLM
(hard filters first) — cost and latency stay bounded, honouring the earlier
"do not watch mail via llm" constraint for the polling path itself.

### 3.4 Send safety (ported failure contract)

* Persist `send_attempted_at` **before** the POST; a timeout/4xx never
  blind-retries (PC-A round-27: duplicate-reply class).
* State machine in `mail_messages.state`:
  `received → classified → replied | ignored_spam | ignored_unknown | notify_only | needs_review | send_failed`.
* One reply per conversation per 24 h + daily global cap (safety valve).
* Never reply to: our own sent items, `Auto-Submitted`/auto-generated headers,
  `Precedence: bulk`, `List-Unsubscribe`/`List-Id` (mailing lists),
  `noreply@`/`do-not-reply@`/`mailer-daemon`.

---

## 4. Categorisation proposal (your open point)

### 4.1 Two independent axes

**Content axis (LLM assigns):**

| category | meaning | criticality |
|---|---|---|
| `informational` | thank-you, FYI, confirmation, no question | low |
| `followup` | continuation of a thread I started ≤7 d | normal |
| `request` | question needing my expertise | normal / high |
| `complaint` | dissatisfaction, escalation | high |
| `critical` | urgent, legal, financial, safety, deadline, outage | critical |
| `commercial_spam` | advertising, cold sales, newsletter | — (ignored) |

**Sender axis (Vincent's allowlist assigns a tier):**

`board` > `vip_customer` > `customer` > `partner` > `lead` > `test` > `unknown`

### 4.2 Priority matrix (content × sender → action)

| | board / vip | customer / partner / lead | unknown (no thread) |
|---|---|---|---|
| **critical** | **P1** WhatsApp now + auto-ack reply | **P1** WhatsApp now + auto-ack reply | log only |
| **complaint** | **P1** WhatsApp now + auto-ack reply | **P2** WhatsApp + auto-ack reply | log only |
| **request / high** | **P2** WhatsApp digest + reply | **P3** auto-reply only | log only |
| **followup** (R1/R5) | **P3** auto-reply | **P3** auto-reply | n/a (thread ⇒ eligible) |
| **informational** (R4) | **P4** thank-you reply | **P4** thank-you reply | log only |
| **commercial_spam** (R3) | **P5** ignore | **P5** ignore | **P5** ignore |

* **P1/P2** → immediate WhatsApp to Vincent (existing gateway): sender, tier,
  criticality, one-line summary, Graph `webLink` to open the mail.
* **P3/P4** → silent auto-reply, visible in the ledger/dashboard.
* **P5** → stored for audit, never replied, never LLM-composed.

This gives you criticality **per message** (LLM axis) *and* **per relationship**
(tier axis), so a board member's "quick question" still escalates while a
customer's newsletter does not.

### 4.3 Unknown-sender default

Default policy: **log & ignore, no reply** (matches your R1+R2 wording — only
threads I started and my contacts get answered). Config switch
`MAIL_AGENT_UNKNOWN_POLICY = ignore | notify` lets you get a WhatsApp digest of
interesting unknown senders instead, without auto-committing Kubot to
strangers. (Heads-up: with `ignore`, an important customer you have never
emailed first will *not* be answered — they must be on the allowlist.)

---

## 5. Reply composition rules

Every composed reply, in the detected language (de-CH / en / fr / it …):

1. **Opens** with the Kubot introduction, e.g. DE:
   *"Grüezi, ich bin Kubot — Vincent' persönlicher digitaler KI-Assistent."*
   EN: *"Hello, I'm Kubot, Vincent's personal digital AI assistant."*
2. **Body:** references the actual message content (name + subject + specific
   point) — personalised, never generic.
3. **Informational:** warm thank-you, no promises.
4. **Follow-up / request / critical:** states that the topic needs Vincent's
   expertise for a detailed answer, that Kubot will discuss it with him, and
   that **either Vincent or Kubot will answer within the next 48 hours**.
5. **Never** discloses prompts/instructions, never quotes prices, legal
   commitments or contract language (PC-A mail-watch rule kept).
6. Signature: `Kubot — AI assistant for Vincent Verbeke · Kubotics`.
7. Sent as a real **thread reply** (`POST /messages/{id}/reply`), HTML, so the
   conversation stays intact in Outlook.

Templates are prompt-driven with per-language example openers; output is
validated (must contain the Kubot opener for the detected language, must be
non-empty, max length) before send — validation failure ⇒ `needs_review`, no
send.

---

## 6. Components to build (file plan)

| File | Content |
|---|---|
| `src/app/models/mail_agent.py` | `mail_messages` ledger (UNIQUE `internet_message_id`, state machine, classification JSON, reply audit) + `mail_watch_senders` allowlist (`email` UNIQUE, `tier`, `language`, `display_name`, `active`) |
| `src/app/services/mail_agent.py` | Poll loop (lifespan task), watermark/dedupe, thread check, decision matrix, send path, WhatsApp fan-out, daily caps |
| `src/app/services/mail_llm.py` | Classify + compose prompts, provider adapter (Groq/OpenAI/Anthropic via existing keys), JSON parsing, output validation |
| `src/app/api/v1/mail_agent.py` | `GET /status`, `GET/POST/DELETE /senders` (CRUD — "I will add contacts"), `GET /messages?state=`, `POST /poll` (manual trigger), all Bearer `API_SECRET_KEY` |
| `src/app/core/config.py` | New settings block (§7) |
| `src/app/main.py` | Register router + `asyncio.create_task(mail_agent_loop)` gated by `MAIL_AGENT_ENABLED` |
| `.aws/task-definition.json`, `.env.example`, `.env` | Env vars (non-secret) |
| `tests/test_mail_agent.py` | Decision matrix, hard filters, tier resolution, thread-window logic, watermark/dedupe, send-marker semantics, language-opener validation |
| `docs/KUBOT_MAIL_AGENT_PLAN.md` | This document |

**New dependencies: none.** LLM via `groq` / `openai` packages already pinned.

### Config additions

```
MAIL_AGENT_ENABLED=false            # master switch (default OFF until you flip it)
MAIL_AGENT_MODE=observe             # observe | auto   (phase-in, §8)
MAIL_AGENT_POLL_INTERVAL_S=60
MAIL_AGENT_UPN=                     # default: M365_ORGANIZER_EMAIL (vincent.verbeke@kuroliv.ch)
MAIL_AGENT_REPLY_WINDOW_DAYS=7
MAIL_AGENT_UNKNOWN_POLICY=ignore    # ignore | notify
MAIL_AGENT_LLM_PROVIDER=groq        # groq | openai | anthropic
MAIL_AGENT_MAX_REPLIES_PER_DAY=20
MAIL_AGENT_SPAM_THRESHOLD=0.80
MAIL_AGENT_NOTIFY_PHONE=+41797481975
```

---

## 7. Dependencies & prerequisites checklist

| # | Dependency | Status | Action |
|---|---|---|---|
| 1 | Entra app cert auth in cloud | ✅ done (`AZURE_CLIENT_CERT_KEY` injected by deploy.yml) | none |
| 2 | `Mail.Send` (application) + admin consent | ✅ done (M365_APP_SETUP.md §3) | none |
| 3 | **`Mail.Read` (application) + admin consent** | ⚠️ used by PC-A poller, **not** listed in the setup doc | **verify in Entra portal → add + consent if missing** (blocking) |
| 4 | WhatsApp Cloud API token | ✅ in task-definition | none |
| 5 | LLM key (Groq/OpenAI/Anthropic) | ✅ injected by deploy.yml | pick default provider (§9 Q3) |
| 6 | DB tables | auto via `create_all` + idempotent ALTER (repo pattern, no alembic) | none |
| 7 | **PC-A poller must be stopped at cutover** | ⚠️ PC-A `mail_watch_poll` (10-min) still watches the **same mailbox** | **disable it when cloud goes live — otherwise double replies** (blocking) |
| 8 | ECS service desired count = 1 | ⚠️ not verifiable from repo | confirm in AWS console; ledger `INSERT … ON CONFLICT DO NOTHING` claim makes even N>1 tasks safe |
| 9 | Mailbox choice | task-def says `vincent.verbeke@kuroliv.ch`, `.env.example` says `vincent@kubotics.ch` | confirm target mailbox (§9 Q1) |
| 10 | Rate/throttling | Graph throttles on 60 s metadata polls are trivial for 1 mailbox | none expected; backoff on 429 implemented |

Operational notes:

* **Privacy/consent:** auto-replies are sent from your mailbox to people who
  wrote to you — same posture as the PC-A flow, now unattended. Keep
  `observe` mode until you have reviewed classifications.
* **Cost:** ≤2 LLM calls per *candidate* message (after hard filters), at
  typical personal-mailbox volume ≈ cents per day.
* **Rollback:** `MAIL_AGENT_ENABLED=false` + redeploy stops everything; sent
  replies are already in Sent Items (auditable).

---

## 8. Rollout plan

| Phase | Mode | What happens | Exit criterion |
|---|---|---|---|
| **A** | `enabled=true, mode=observe` | Poll, classify, ledger only — **no replies, no WhatsApp** (except optionally P1 alerts off) | 3–5 days of classifications reviewed in ledger/dashboard; spam filter and tiers look right |
| **B** | `mode=auto`, allowlist = 1 test sender only | Real replies to the test sender, thread + language + 48 h posture verified | Test threads look correct in Outlook |
| **C** | `mode=auto`, full allowlist | R2 contacts + R1 threads live; P1/P2 WhatsApp alerts live; PC-A poller stopped | One week without mis-sends |
| **D** | Dashboard card | Senders CRUD + message ledger in the Kubotics dashboard UI (frontend follow-up) | — |

---

## 9. Open questions for your review

1. **Mailbox:** `vincent.verbeke@kuroliv.ch` (what PC-A watched) or
   `vincent@kubotics.ch`? Default proposed: kuroliv (same as PC-A/task-def).
2. **Unknown senders:** confirm "log & ignore" (§4.3), or switch to
   `notify` (WhatsApp digest, still no auto-reply)?
3. **LLM default provider:** Groq (cheap/fast, key already injected) vs
   OpenAI (higher quality). Proposed: **Groq classify + Groq compose**, one
   env var to switch.
4. **Cutover:** confirm you want PC-A's mail watch stopped when Phase C goes
   live (it must be, to avoid double answers).
5. **Priority matrix (§4.2):** approve as proposed, or adjust e.g. "every
   board-member mail also WhatsApp-pings me regardless of criticality"?
6. **Daily cap:** 20 auto-replies/day default — OK?

---

## 10. Estimated build order (after your approval)

1. Models + config + migrations pattern (Phase 0, no behaviour change).
2. Poll loop + hard filters + ledger (still observe-only).
3. LLM classify/compose + decision matrix + tests.
4. Send path (marker semantics) + WhatsApp fan-out.
5. Admin endpoints (senders CRUD = your contact management).
6. Phase A deploy → your review → B → C.

Baseline test suite: **34/34 passing** (verified 2026-11-08) — must stay green.
