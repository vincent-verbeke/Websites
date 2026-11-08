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
| R2 | Sender is one of **my contacts** (Outlook People, maintained by Vincent) | Auto-reply |
| R3 | Message is **advertising / spam** | Ignore (logged, never replied) |
| R4 | Message is **informational** | Personalised thank-you reply |
| R5 | Message is a **follow-up** to my previous email | Analyse + reply |
| R6 | Message is **critical** | Reply + **WhatsApp alert to Vincent** (review urgently) |
| always | Reply opening | Introduce as Kubot in the message language + 48 h posture |

**Reply posture (R5/R6 substantive mail):** "this topic needs Vincent's
expertise for a detailed answer, I will discuss it with him, and either he or I
will answer within the next 48 hours." Informational mail (R4) gets a warm,
personalised thank-you instead.

### 1.1 Request → plan traceability (your 2026-11-08 asks, none dropped)

| Your request (paraphrased) | Plan section |
|---|---|
| Implement in the cloud API backend of the Kubotics website | §6 components, §8 rollout |
| Monitor my mailbox via Graph API | §3.1 poll, §9 Q1 mailbox |
| Reply to replies to my mail **if I sent within last 7 days** | R1, §3.2 thread check |
| Reply to **my contacts** (I will add them myself) | R2, §6 senders CRUD API |
| **Propose** categorisation with priorities/criticality | §4 (two axes + P1–P5 matrix) |
| Advertising/spam → **ignore** | R3, §3.3 hard filters + §4.2 P5 |
| Analyse language + message, reply in that language | §3.3 classify call, §5 |
| Informational → **personalised thank-you** | R4, §5.3 |
| Follow-up to my previous email → analyse + reply | R5, §3.2 + §5.4 |
| Always open as **Kubot, my personal digital AI assistant**, in the message language | §5.1 |
| "Needs my expertise … within the next 48 h" posture | §5.4 |
| Critical → **WhatsApp** me to review urgently | R6, §4.2 P1/P2 alerts |
| Review process + dependencies + what it takes to run in the backend | §3 process, §7 checklist, §6 build plan |
| **Implementation plan for my review before we continue** | this document, status DRAFT, §9 open questions — no code written |
| *Follow-up 09:31:* use contact **notes + categories** for very personal replies (Liz Mallet example) | §3.2 contact match, §4.1 tier-from-categories, §4.4 store review, §5.2 notes in compose prompt, §7 row 13 (`Contacts.Read` granted + verified) |
| *Follow-up 09:31:* LLM keys as **GitHub secrets**; default **Xiami MIMO Flash latest → OpenAI → Gemini → Grok**; models changeable by parameter/secret | §2 chain row, §6 config block (`MAIL_AGENT_LLM_CHAIN`/`MAIL_AGENT_LLM_MODEL_*`), §7 row 5, Q10 |
| *Follow-up 09:31:* add any further questions so he can review better | §9 Q9–Q14 (contact store/categories, secrets, timing, mailbox state, languages, reply-vs-replyAll) |
| *Follow-up 09:51:* **drop Phase A**, test with Liz (Phase B), go **live immediately on approval**; low expected mail volume → limited blast radius | §8 revised (B → GO-LIVE, safety valves listed), `MAIL_AGENT_ONLY_SENDERS` config, §10 step 6 |
| *Answers 10:02 (all 14):* aliases, unknown=classify+answer, PC-A stop now, matrix OK, cap+notify, critical-care, signature proposal, category proposal, env list, alert window, never-modify, de/en/fr/it/nl, replyAll ≤3 | §9 (answered), §3.2–3.4, §4.2–4.3, §5 (incl. §5.6 proposal), §6, §7 rows 7/9/12/12b + §7.3, §8 |

---

## 2. What already exists (reused, not rebuilt)

| Asset | Where | Reuse for |
|---|---|---|
| Graph cert auth (app-only, MSAL) | `src/app/services/m365_service.py` | Token for inbox read + reply |
| Application mail permissions on the shared Entra app | Entra app `7246abc4-…` — roles verified live 2026-11-08: `Mail.ReadWrite` + `Mail.Send` (details §7 rows 2–3) | Inbox read + sending replies |
| Proven reply mechanics: `POST /messages/{id}/reply`, watermark, internetMessageId dedupe, **send-attempt marker (no blind retry)** | PC-A `mail_watch.py` (rounds 16–38 hardened) | Ported 1:1 into DB-backed state machine |
| Background loop in FastAPI lifespan | `trading_watch.watch_loop` in `main.py` | Identical pattern for the mail loop |
| WhatsApp Cloud API sender | `whatsapp_service.send_text_message` | Critical alerts (R6) |
| LLM provider chain (Vincent 2026-11-08: **Xiaomi MiMo Flash latest → OpenAI → Gemini → Grok/xAI**) | Keys **as GitHub secrets** (repo secrets → deploy.yml injection map → task-def env); `openai` SDK talks to all four (MiMo is OpenAI-compatible: `https://api.xiaomimimo.com/v1`, verified from vendor docs) | Classification + reply composition; chain order + model IDs overridable by env/secret (§6 config, §7 row 5) |
| Normalised event stream | `inbound_events` (channel `email` already valid) | Observability / dashboard / needle |
| Bearer auth helpers | `require_ingest_token` (API_SECRET_KEY) | New admin endpoints |
| Test harness | 43 tests passing (34 baseline + 9 Phase 0, verified 2026-11-08) | New pure-function tests |

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
    D -->|contact match (Outlook contacts w/ notes+categories)| E[ tier from categories: board / vip / customer / partner / lead ]
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
* Folder addressing must use Graph **well-known names** (`inbox`,
  `sentItems`, `junkemail`) — the mailbox UI is localized (folders display
  as "Postvak IN", "Ongewenste e-mail", …) and localized display names are
  not query-safe. Verified 2026-11-08 against this mailbox.

### 3.2 Reply-to-my-mail detection (R1/R5)

1. Take incoming `conversationId`.
2. Query Sent Items:
   `messages?$filter=conversationId eq '{cid}' and sentDateTime ge {now-7d}&$top=1`.
3. Hit → eligible as `thread_reply`; miss → **sender matches ANY address of
   an Outlook contact card** (Graph `/contacts`, `emailAddresses[]` — multi-address
   match; Vincent adds people there; `categories` supply the tier,
   `personalNotes` the personalisation, §4.1/§5.2) → eligible as `contact`;
   else `unknown` → **classify anyway and auto-answer real personal email**
   (your Q2 answer, §4.3) — only spam/advertising is ignored. A small DB
   override list (`mail_watch_senders`, optional) covers test senders without
   a contact card.
   ⚠️ **Contact membership never bypasses the §3.1 hard filters or the R3
   spam verdict** — the live contact store contains newsletter/noreply senders
   (see §4.4); eligibility and desirability are separate checks.

This is the only reliable way to enforce "my original email was sent in the
last 7 days" (In-Reply-To alone cannot tell the age of *our* message).

Filter support validated 2026-11-08 against Graph message `$filter`
behaviour: `conversationId eq` and `sentDateTime ge` are both supported
filter operators on `/messages` (and on `sentItems`), so this query needs no
advanced-query headers. `conversationId`/`sentDateTime` are also safe to
combine with `and`. Fallback if it ever misbehaves: fetch sent Items since
`now-7d` once per cycle (metadata only), build a conversationId set in
memory — mailbox volume makes this cheap.

### 3.3 Two LLM calls maximum per candidate message

1. **Classify** → strict JSON: `language`, `category`, `criticality`,
   `spam_probability`, `summary`, `requires_expertise`.
2. **Compose** → the reply body (HTML + text), only when the decision says
   "reply".

Hard-filtered senders (own mail incl. all aliases, autoreplies, mailing
lists, noreply — §3.4) never reach the LLM. **Unknown senders DO get call
#1** (your Q2 answer: classify real-personal vs spam) — but only after the
hard filters, so cost and latency stay bounded and the earlier "do not watch
mail via llm" constraint on the polling path itself is honoured.

### 3.4 Send safety (ported failure contract)

* Persist `send_attempted_at` **before** the POST; a timeout/4xx never
  blind-retries (PC-A round-27: duplicate-reply class).
* Resolve `internetMessageId` → Graph `id` **at send time** with
  `$filter=internetMessageId eq '...'` (OData `'` doubled), then
  **`POST /messages/{graphId}/replyAll` by default; if To+CC recipients
  > 3 → `POST /messages/{graphId}/reply` (sender only)** — your Q14 answer.
  (`webLink` in §3.1 `$select` is display-only; it is **not** `$filter`-able
  and must never appear in a filter.)
* State machine in `mail_messages.state`:
  `received → classified → replied | ignored_spam | ignored_unknown | notify_only | needs_review | send_failed`.
* One reply per conversation per 24 h + daily global cap (safety valve).
  **Cap hit (Q6):** message → `needs_review` **and a WhatsApp notice to
  Vincent** (alert window, Q11) so he can override with his own answer.
* Never reply to: our own mail (any of the 28 aliases, Q1), **auto-replies
  (`Auto-Submitted`, auto-generated) — never answered, any sender, any tier
  (Q14)**, `Precedence: bulk`, `List-Unsubscribe`/`List-Id` (mailing lists),
  `noreply@`/`do-not-reply@`/`mailer-daemon`.
* **Never modify the mailbox (Q12):** no mark-as-read, no move, no delete —
  the ledger is the only audit trail; Mail.ReadWrite is used for reading only.

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

**Sender axis (my Outlook contacts assign a tier via their `categories`):**

`board` > `vip_customer` > `customer` > `partner` > `lead` > `test` > `unknown`

Category-name → tier mapping is one env parameter
(`MAIL_AGENT_TIER_MAP`, e.g. `Board=board;VIP=vip_customer;Kunde=customer`);
contacts whose categories match nothing default to tier `contact` (behaves
like `customer` in §4.2). A contact card with **no** categories still makes
the sender eligible (R2) — it just gets the default tier.

### 4.2 Priority matrix (content × sender → action)

| | board / vip | customer / partner / lead | unknown (no thread) |
|---|---|---|---|
| **critical** | **P1** WhatsApp now + auto-ack reply | **P1** WhatsApp now + auto-ack reply | **P1** WhatsApp now + auto-ack reply |
| **complaint** | **P1** WhatsApp now + auto-ack reply | **P2** WhatsApp + auto-ack reply | **P2** WhatsApp + auto-ack reply |
| **request / high** | **P2** WhatsApp digest + reply | **P3** auto-reply only | **P3** auto-reply (Q2: if real personal) |
| **followup** (R1/R5) | **P3** auto-reply | **P3** auto-reply | n/a (thread ⇒ eligible) |
| **informational** (R4) | **P4** thank-you reply | **P4** thank-you reply | **P4** thank-you reply (Q2: if real personal) |
| **commercial_spam** (R3) | **P5** ignore | **P5** ignore | **P5** ignore |

Unknown senders run through the same matrix at tier `unknown` (no board/vip
boost) — per your Q2 answer they are classified first and only *real personal*
email gets the reply cells; spam lands on P5. Approved by Vincent 2026-11-08
(Q5).

* **P1/P2** → immediate WhatsApp to Vincent (existing gateway): sender, tier,
  criticality, one-line summary, Graph `webLink` to open the mail.
* **P3/P4** → silent auto-reply, visible in the ledger/dashboard.
* **P5** → stored for audit, never replied, never LLM-composed.

This gives you criticality **per message** (LLM axis) *and* **per relationship**
(tier axis), so a board member's "quick question" still escalates while a
customer's newsletter does not.

### 4.3 Unknown-sender default — **answered Q2 (Vincent 2026-11-08)**

Policy = **`auto`**: unknown senders are classified, not blanket-ignored.
Flow: §3.4 hard filters → LLM classify → `commercial_spam` / spam probability
≥ threshold → **ignore (P5, logged)**; otherwise a *real personal email* →
**auto-answer** exactly like a contact at tier `unknown` (matrix §4.2),
critical/complaint also raise the WhatsApp alert. Config
`MAIL_AGENT_UNKNOWN_POLICY = auto | ignore | notify` — `auto` is the default;
`ignore`/`notify` remain as brakes.

### 4.4 Live contact-store reality check (read 2026-11-08 after `Contacts.Read` grant)

The mailbox holds **15 Outlook contacts**; reviewed as instructed (Liz
Mallet example):

* **Liz Mallet** — 2 addresses (`liz.mallet@kuroliv.ch`, `liz.mallet@hotmail.com`),
  note: *"Liz is my partner, Soulmate and co Business Owner of KuroLIV GmbH
  and this also Kubotics."* → exactly the personalisation context §5.2 injects.
  **Categories: none set yet.**
* **The list is NOT a clean allowlist:** `noreply@sonetel.com`,
  `notifications-noreply@linkedin.com`, `news@newsletter.digitec.ch`,
  `security@account.meta.com`, `team@getcarv.com`, `noreply@fairgate.ch`,
  promo senders (SodaStream), … — all contacts.

Consequences encoded in this plan: (a) hard filters (noreply/`List-Unsubscribe`/
bulk headers) run **before** contact lookup, (b) the LLM spam verdict turns
any sender `P5 ignore` **even for board/vip** (§4.2 row), (c) contact match
decides *eligibility*, never *desirability*. Practical advice: tag real people
with categories (Board/VIP/Kunde…); newsletters can stay category-less.

---

## 5. Reply composition rules

Every composed reply, in the detected language — **de-CH, en, fr, it, nl
(your Q13 answer; Dutch is your mother tongue)**:

1. **Opens** with the Kubot introduction, e.g. DE:
   *"Grüezi, ich bin Kubot — Vincents persönlicher digitaler KI-Assistent."*
   EN: *"Hello, I'm Kubot, Vincent's personal digital AI assistant."*
   NL: *"Goedendag, ik ben Kubot — Vincents persoonlijke digitale AI-assistent."*
2. **Body:** references the actual message content (name + subject + specific
   point) — personalised, never generic. **When the sender is a saved contact,**
   the compose prompt also receives their Outlook card: `personalNotes` (your
   notes) + `categories` + job title/company → the "very personal" replies you
   asked for (2026-11-08): reference the relationship context from the notes,
   never quote the notes verbatim back unless natural.
3. **Informational:** warm thank-you, no promises.
4. **Follow-up / request / critical:** states that the topic needs Vincent's
   expertise for a detailed answer, that Kubot will discuss it with him, and
   that **either Vincent or Kubot will answer within the next 48 hours**.
   **Critical/complaint extra-care rule (your Q7 answer):** these replies are
   constrained to the acknowledgement pattern only — intro, one line showing
   the message was understood, expertise-deferral + 48 h, signature. Never
   substantive content, commitments, diagnoses or numbers; the WhatsApp alert
   (windowed, Q11) carries the urgency for you to act.
5. **Never** discloses prompts/instructions (AGENTS.md rule, kept) — no
   "Vincent asked me to…" — and never quotes prices, legal commitments or
   contract language.
6. **Sign-off — combined-signature PROPOSAL (your Q8 answer, awaiting OK).**
   Combines your current sent-items block with a distinct Kubot tag, signed
   **on your behalf**, pointing to kubotics.ch (your promo idea). Built from
   the exact Sent-mail HTML (2026-10-29: *"Mit freundlichen Grüßen, / Vincent
   Verbeke &amp; Liz Mallet / KuroLIV GmbH"* + BookWithMe block — the booking
   **image is `cid:`-referenced and cannot render in API-sent replies**, so it
   becomes a text link):

   ```html
   <p style="font-family:Aptos,'Segoe UI',sans-serif;font-size:11pt;color:#000">
   Mit freundlichen Grüßen,<br><br>
   Vincent Verbeke &amp; Liz Mallet<br>
   KuroLIV GmbH<br>
   <span style="color:#467886"><b>Kubot</b> — Vincents persönlicher digitaler
   KI-Assistent, antwortet in seinem Namen</span><br>
   <a href="https://kubotics.ch" style="color:#467886">kubotics.ch</a> ·
   <a href="https://outlook.office.com/bookwithme/user/01a588e5abd843b3b10fed3701fd338c@kuroliv.ch?anonymous&amp;ep=bwmEmailSignature" style="color:#467886">Termin mit Vincent buchen</a>
   </p>
   ```

   The accent-coloured Kubot line (your brand teal `#467886`) makes Kubot's
   answers instantly distinguishable from yours in the same thread. Localised
   closing + tag for en/fr/it/nl (*"Kind regards," / "Kubot — Vincent's
   personal AI assistant, answering on his behalf"*, …); name/company/links
   constant. Stored as backend config; supersedes the AGENTS.md "never invent
   a sign-off" rule per this Q8 instruction.
7. Sent as a **thread reply** — `/replyAll` by default, `/reply` when
   To+CC > 3 (your Q14 answer, §3.4) — HTML, so the conversation stays intact
   in Outlook. Reply style (AGENTS.md): warm, short paragraphs, no fluff,
   answer *their* points in Vincent's voice.

Templates are prompt-driven with per-language example openers; output is
validated (must contain the Kubot opener for the detected language, must be
non-empty, max length) before send — validation failure ⇒ `needs_review`, no
send.

---

## 6. Components to build (file plan)

| File | Content |
|---|---|
| `src/app/models/mail_agent.py` | `mail_messages` ledger (UNIQUE `internet_message_id`, state machine, classification JSON, reply audit) + `mail_watch_senders` allowlist (`email` UNIQUE, `tier`, `language`, `display_name`, `active`) — **must be imported in `app/models/__init__.py`** (boot-verified 2026-11-08: `create_all` only sees tables whose modules are imported before lifespan runs; needle/tasks use exactly this registration pattern) |
| `src/app/services/mail_agent.py` | Poll loop (lifespan task), watermark/dedupe, thread check, decision matrix, send path, WhatsApp fan-out, daily caps |
| `src/app/services/mail_llm.py` | Classify + compose prompts, **provider-chain adapter** (MiMo → OpenAI → Gemini → xAI, all OpenAI-compatible: one adapter, per-provider base_url/key/model from env; failover on 429/5xx), JSON parsing, output validation |
| `src/app/api/v1/mail_agent.py` | `GET /status`, `GET/POST/DELETE /senders` (override-list CRUD + cached contact view — primary contacts are maintained by Vincent in **Outlook**), `GET /messages?state=`, `POST /poll` (manual trigger), all Bearer `API_SECRET_KEY` |
| `src/app/core/config.py` | New settings block (§7) |
| `src/app/main.py` | Register router + `asyncio.create_task(mail_agent_loop)` gated by `MAIL_AGENT_ENABLED` |
| `.aws/task-definition.json`, `.env.example`, `.env` | Env vars (non-secret) |
| `tests/test_mail_agent.py` | Decision matrix, hard filters, tier resolution, thread-window logic, watermark/dedupe, send-marker semantics, language-opener validation |
| `docs/KUBOT_MAIL_AGENT_PLAN.md` | This document |

**New dependencies: none.** LLM via `groq` / `openai` packages already pinned.

### Config additions

```
MAIL_AGENT_ENABLED=false            # master switch (default OFF until you flip it)
MAIL_AGENT_MODE=auto               # auto | observe (debug only; rollout = Phase B → live, §8)
MAIL_AGENT_POLL_INTERVAL_S=60
MAIL_AGENT_UPN=                     # default: M365_ORGANIZER_EMAIL (vincent.verbeke@kuroliv.ch)
MAIL_AGENT_REPLY_WINDOW_DAYS=7
MAIL_AGENT_UNKNOWN_POLICY=auto     # auto (Q2: classify + answer real personal) | ignore | notify
MAIL_AGENT_LANGUAGES=de-CH,en,fr,it,nl  # reply openers (Q13 — Dutch = mother tongue)
MAIL_AGENT_OWN_ADDRESSES=           # extra own aliases; base set auto-discovered from Graph proxyAddresses (28 found, Q1)
MAIL_AGENT_LLM_CHAIN=mimo,openai,gemini,xai  # ordered failover (override via env/secret)
MAIL_AGENT_LLM_MODEL_MIMO=mimo-v2.6-flash    # "Xiami MIMO Flash (latest)" — V2.6-Flash, V2.5 IDs retired 2026-10-21
MAIL_AGENT_LLM_MODEL_OPENAI=                 # default at build time, secret-overridable
MAIL_AGENT_LLM_MODEL_GEMINI=                 # code default gemini-3.8-flash (page exists, verified 2026-11-08); if it ever 400s: gemini-3.5-flash-lite (Google's documented migration string)
MAIL_AGENT_LLM_MODEL_XAI=
MAIL_AGENT_LLM_BASE_MIMO=https://api.xiaomimimo.com/v1   # OpenAI-compatible
MAIL_AGENT_TIER_MAP=Board=board;VIP=vip_customer;Kunde=customer;Partner=partner;Lead=lead;Test=test  # proposed category set (Q9)
MAIL_AGENT_ONLY_SENDERS=              # comma list; when set, ONLY these senders get replies (Phase B: Liz; emergency brake: set to one address)
MAIL_AGENT_MAX_REPLIES_PER_DAY=20     # Q6: cap hit -> needs_review + WhatsApp notice to Vincent
MAIL_AGENT_SPAM_THRESHOLD=0.80
MAIL_AGENT_NOTIFY_PHONE=+41797481975
MAIL_AGENT_ALERT_WINDOW_START=07:30   # WhatsApp alerts only 07:30-22:00 Europe/Zurich (Q11);
MAIL_AGENT_ALERT_WINDOW_END=22:00     # outside window -> queued, flushed at 07:30; email replies unaffected (24/7)
```

---

## 7. Dependencies & prerequisites checklist

| # | Dependency | Status | Action |
|---|---|---|---|
| 1 | Entra app cert auth in cloud | ✅ done — live-probed from the same cert material 2026-11-08 (token 200). Container gets the key **only** via `AZURE_CLIENT_CERT_KEY` env (Dockerfile copies no `certs/`), injected by deploy.yml **conditionally (`if v:`)** — presumed present (other container M365 features use the same secret) but not directly observable from this machine | confirm `AZURE_CLIENT_CERT_KEY`/`_THUMBPRINT` GitHub secrets remain set before Phase A (same failure mode as row 5) |
| 2 | `Mail.Send` (application) + admin consent | ✅ done (M365_APP_SETUP.md §3) | none |
| 3 | **`Mail.Read`-equivalent application permission** | ✅ **verified live 2026-11-08** — app-only token roles: `Mail.ReadWrite` (superset of `Mail.Read`) + `Mail.Send`; inbox scan, sentItems filter, and internetMessageId resolve all returned 200 against the target mailbox | none (optional later: narrow `Mail.ReadWrite` → `Mail.Read` if write access to mail is unwanted) |
| 4 | WhatsApp Cloud API token | ✅ in task-definition **and live-probed 2026-11-08**: `GET /api/whatsapp/send/health` → `configured=true`, `last_send 2026-11-06 ok`. (The a21 retirement of 2026-11-08 removed PC-A's fallback sender only — the container send path my alerts use is untouched.) | none |
| 5 | **LLM keys as GitHub secrets (Vincent 2026-11-08) + provider chain** | ⚠️ repo secrets → deploy.yml `secrets_to_inject` (`if v:`) → task-def env. Currently injects `OPENAI_API_KEY`/`GEMINI_API_KEY` (+ Groq/Anthropic); **`MIMO_API_KEY` and `XAI_API_KEY` are NOT in the map yet** — Phase 0 must add them | create GitHub secrets `MIMO_API_KEY` (platform.xiaomimimo.com → API Keys) + `XAI_API_KEY`, confirm `OPENAI_API_KEY`/`GEMINI_API_KEY` exist, add both names to deploy.yml injection map; chain/model IDs overridable as env/secret |
| 6 | DB tables | auto via `create_all` + idempotent ALTER (repo pattern, no alembic) | none |
| 7 | **PC-A poller stopped (Q4: "stop PC-A immediately")** | ✅ **DONE 2026-11-08 10:06** — shared allowlist emptied via the dashboard API (`POST /api/mail/watchers` → `senders: []` = documented *watch off*); PC-A's 10-min poller now takes its cheapest exit (no scan, no spawn, no replies). Queue pending: 0 | done before test day; reversible by re-adding the 2 addresses if ever needed |
| 7b | Entra app identity shared with PC-A | ✅ **no longer blocking** — live token 2026-11-08 shows app `7246abc4-…` (= task-def `AZURE_CLIENT_ID`) already reads the target mailbox (200s). PC-A's own identity only matters for its decommission, not for this backend | informational; compare PC-A `M365_CLIENT_ID` only if PC-A-side checks are ever re-enabled |
| 8 | ECS service desired count = 1 | ⚠️ not verifiable from repo | confirm in AWS console; ledger `INSERT … ON CONFLICT DO NOTHING` claim makes even N>1 tasks safe |
| 9 | Mailbox | ✅ **answered Q1**: `vincent.verbeke@kuroliv.ch`, **contains multiple email addresses** — probed live: 28 `proxyAddresses` (sales/info@kubotics, qbotics, angerik, kuroliv, SailingFlorentine, 2thecloud, ecosailing.be, …). Own-mail filter uses the full discovered set + `MAIL_AGENT_OWN_ADDRESSES` extras | none — auto-discovered at loop start |
| 10 | Rate/throttling | Graph throttles on 60 s metadata polls are trivial for 1 mailbox (measured volume: 21 inbox messages in the last 8 days ≈ 3/day, §7.1) | ✅ 429 backoff implemented (`GraphThrottled` + Retry-After, capped 300s, tested in loop wiring) |
| 11 | **CI test gate** | ✅ **ADDED 2026-11-08** with deploy config (97f7ec8): `setup-uv` + `uv run --frozen pytest -q` runs before build (verified green: 82/82 via the exact CI command) | none — deploys now fail on red |
| 12 | **Signature source (Q8)** | 🟡 superseded by your Q8 answer: **combined-signature PROPOSAL in §5.6** (your sent-items block + Kubot tag + kubotics.ch promo, built from the real Sent-mail HTML; booking `cid:` image → text link) — **awaits your OK**. Old `mail_watch_sig.html` no longer needed; allowlist seeding moot (list emptied 10:06, contacts live in Outlook) | approve/edit §5.6 → stored as backend config |
| 12b | **Approval-flow divergence (Q7)** | ✅ **answered: remove the approval gate, be extra careful if critical** — encoded as §5.4 critical ack-only rule + Q7 note + safety valves (cooldown, cap+notify, kill switch) | none — resolved |
| 13 | **`Contacts.Read` for Outlook contacts (notes + categories)** | ✅ **GRANTED + live-verified 2026-11-08 09:49** (Vincent added the app permission): token roles now include `Contacts.Read`; `/users/{upn}/contacts` → **200, 15 contacts read**, Liz Mallet reviewed (§4.4) | none — resolved during review |

### 7.1 Live validation log (2026-11-08, read-only probes from this machine)

| Probe | Result |
|---|---|
| App-only token via local cert (`certs/m365_app.key`) | 200 — roles `Mail.ReadWrite`, `Mail.Send`, `User.Read.All`, calendar/Teams perms |
| Inbox metadata scan (`$top=3`, `$orderby=receivedDateTime desc`, plan §3.1 `$select` incl. `webLink`) | 200 — all selected fields present |
| Sent-items thread check (`conversationId eq` + `sentDateTime ge now-7d`, plan §3.2) | 200 — correct empty result for an unthreaded conversation |
| Sent-items 7-day window (fallback variant) | 200 — 2 messages returned |
| `internetMessageId` → Graph `id` resolve (plan §3.4) | 200 — id returned |
| WhatsApp container send health (`api.kubotics.ch`) | 200 — `configured=true`, `last_send ok` |
| Local test suite | **82/82** at Phase B (34 baseline + 48 mail-agent) |
| Boot-registration check (import `app.main` → `Base.metadata`) | 24 tables incl. all `crm.*`; new mail tables will appear only if registered in `models/__init__.py` |
| Ruff baseline | 120 pre-existing errors, all in legacy files (`dto.py` 29, `channel_dto.py` 24, `m365_service.py` 17 …); new files must be clean (`trading_watch.py` passes 100%) |
| Mailbox volume probe (inbox/sent since 2026-11-01, folder list) | 21 inbox, 2 sent, Junk empty; folders localized ("Postvak IN") → well-known names only |
| Sent-mail signature pattern scan (10 newest, read-only) | KuroLIV sign-off confirmed on real replies (2026-10-29/27) — basis for §5.6 |
| Outlook contacts read (09:49, after Vincent's `Contacts.Read` grant) | 200 — 15 contacts; Liz Mallet note + 2 addresses confirmed; categories empty across all (§4.4) |

No message was sent, modified, or deleted during validation.

### 7.2 Real-path acceptance evidence (2026-11-08 — observed behaviour, not inspection)

**How the result was exercised (the interfaces the finished service will
actually use):**

| Real interface | Observed behaviour |
|---|---|
| **This app booted for real** (`uvicorn app.main:app`, local `.env`, trading-watch off) | `/health` → 200 `healthy`; OpenAPI served **45 paths**; `create_all` ensured tables; clean log |
| **Auth boundary my endpoints will join** | `GET /api/v1/needle/inbox` **401** without token → **200 with real inbox rows**; `POST /api/v1/events` without Bearer → **401** |
| **Gap this plan fills** | `GET /api/v1/mail/status` → **404** (router does not exist yet — exactly what §6 adds) |
| **Prod public API** (`https://api.kubotics.ch`) | `/health` 200 `environment=production`; `/dashboard/leads` = 1 lead (Dr. Thomas Meier), conversations/summary 200 → **Liz Mallet not in CRM** → contact store identified as Outlook People (§4.4) |
| **Graph mail path** (§7.1) | inbox scan / sentItems thread filter / internetMessageId resolve → all 200 against the live mailbox |
| **Graph contacts path** | `/users/{upn}/contacts` → **403 ErrorAccessDenied** first (recorded as dependency row 13) → **200, 15 contacts after Vincent granted `Contacts.Read`** (09:49) → Liz reviewed (§4.4) |
| **WhatsApp send path** | `/api/whatsapp/send/health` → 200 `configured=true`, `last_send ok` |
| **Vendor contract for the default LLM** | Xiaomi MiMo docs fetched live: OpenAI-compatible `https://api.xiaomimimo.com/v1`, env `MIMO_API_KEY`, latest Flash = `mimo-v2.6-flash` (V2.5 IDs retired 2026-10-21) |

**Externally blocked (honest constraints, not skipped checks):** GitHub
secrets (`gh` CLI unavailable on this machine), ECS desired count (no AWS
credentials), PC-A poller state (different machine — but the shared
allowlist stop was executed from here, row 7), and the acceptance step
itself — your §9 review, now answered (§9).

### 7.4 Test-day incident log (2026-11-08, kept for audit)

1. **Shared-database discovery (11:36):** local `.env` `POSTGRES_*` values
   point at the **PROD RDS cluster** (`kubotics_app@app-akuris…`) — every
   "dev DB" label in this document was wrong; my smoke resets ran against
   prod. Impact: one real audit row lost (noreply sudo-verification mail)
   and — critically — **Liz's first test "I love you" (11:04) was deleted
   and fell under the re-seeded watermark** → silently unprocessed.
2. **Recovery (11:39):** watermark restored to `10:46:47Z` via SQL → the
   real pipeline re-claimed both messages (github row deduped by UNIQUE id,
   no double processing); Liz's mail routed `contact/contact` correctly —
   routing, gates and ledger all proven on the recovered mail.
3. **LLM chain blocked (11:40–11:53):** Gemini HTTP 400 on classify →
   error-body logging (83f36c8) revealed `Please pass a valid API key` →
   **invalid GEMINI secret** (not model/code; model also modernised to
   `gemini-3.8-flash`). Liz's mail parked in `needs_review` (5 attempts) —
   reset it once the key is replaced (or Liz resends).
4. **Escalation:** WhatsApp sent 11:55:36 via the needle cloud send endpoint
   (`wamid.HBgLNDE3OTc0ODE5…` → 41797481975): replace GEMINI key, verify
   MIMO secret, retry note for Liz's test.
5. **Standing rule from (1):** never run destructive SQL on this database
   without first echoing and verifying the connection target.
6. **Nested-workflow root cause (14:27–14:31):** Vincent's pasted run log
   showed the LIVE step's `secrets_to_inject` had **no MIMO/XAI entries** —
   GitHub only executes workflows from the repo-root `.github/workflows/`,
   while today's pipeline edits (MIMO/XAI step-env `6631f97`, pytest gate
   `97f7ec8`, diagnostics `00f775e`) all went to the **subdirectory**
   `Kubotics-Backend/.github/workflows/deploy.yml`, which is never executed.
   This is why MIMO stayed absent through ~10 deploys after both the secret
   (11:14Z) and the mapping fix (11:19Z), and why CI's "green" never meant
   tests ran (build+deploy only — the suite had been gated by local runs).
   **Fixed in the ROOT workflow:** MIMO/XAI env + injection-map entries,
   WHATSAPP creds env lines (completes `127d094`'s override intent),
   secret-length + injected/skipped-name diagnostics, and the uv+pytest gate.
   Dead subdirectory file deleted — future sessions: edit
   `/.github/workflows/deploy.yml` (repo root), never the subdir copy.

### 7.5 Secrets pickup protocol (how a GitHub secret change reaches prod)

Secret values are baked into the ECS task definition **at deploy time** —
changing a secret alone does nothing. To pick up new/rotated keys:

1. Vincent fixes the secret in repo `vincent-verbeke/Websites` (or confirms done).
2. Trigger a redeploy with any commit touching `Kubotics-Backend/**`
   (an EMPTY commit does NOT match the workflow path filter — a real file
   must change; a one-line docs append doubles as the audit entry below).
3. Watch `/api/v1/mail/status` → `llm_providers_configured` shows the new
   provider (e.g. `mimo` appears), then `/mail/messages` — Liz's parked row
   self-heals within ≤15 min and completes classify → compose → reply.

Pickup checks armed 2026-11-08 12:33 UTC (first wake 13:20Z, rescheduled
while Vincent is OOO) — each attempt appends a line here:

- 13:21Z check 1 (scheduled): redeploy rode on `68dc3bc`; providers unchanged
  (`[gemini]` — old key still returning HTTP400 `INVALID_ARGUMENT: Please pass
  a valid API key`), MIMO absent; no WhatsApp sent.
- 14:22Z check 2 EARLY (Vincent online): he **replaced `GEMINI_API_KEY`** with
  a freshly created key and confirmed `MIMO_API_KEY` was saved ~11:14Z
  (step-env mapping had been missing until `6631f97`, 11:19Z). Transport push
  = this commit; the workflow step now prints **secret lengths + injected/
  skipped names** (never values) so the run log settles whether every key
  resolves.
- 14:31Z check 2 CONTINUED: `00f775e` deployed green but providers were
  still `[gemini]` → Vincent's pasted run log exposed the **nested-workflow
  root cause** (§7.4/6: GitHub runs only the ROOT `.github/workflows/`).
  MIMO/XAI mapping + diagnostics + pytest gate now live in the ROOT
  `.github/workflows/deploy.yml`; the next transport deploy carries them.

Operational notes:

* **Privacy/consent:** auto-replies are sent from your mailbox to people who
  wrote to you — same posture as the PC-A flow, now unattended. Phase B
  (Liz-only) until you approve go-live.
* **Cost (measured 2026-11-08):** 21 inbox messages in the last 8 days
  (~3/day), 2 sent in the window, Junk empty → ≤2 LLM calls per
  *candidate* message after hard filters = negligible spend (≪ cents/day);
  `$top=100` newest-first scan stays far inside Graph response/throttle
  limits at 60 s cadence.
* **Rollback:** `MAIL_AGENT_ENABLED=false` + redeploy stops everything; sent
  replies are already in Sent Items (auditable).

### 7.3 Complete env inventory (your Q10 answer)

**GitHub repo secrets to CREATE (new):**

| Secret | Where to get it |
|---|---|
| `MIMO_API_KEY` | platform.xiaomimimo.com → Console → API Keys (`sk-…`) |
| `XAI_API_KEY` | console.x.ai → API Keys (Grok) |

**Observed live in prod (2026-11-08 10:47 → 11:53, `/mail/status` + chain
errors):**
- `llm_providers_configured = ["gemini"]` → GEMINI key present; MIMO/XAI not
  reaching the container (empty/absent at workflow run — Vincent to verify;
  my deploy.yml step-env wiring miss is fixed in 6631f97); `OPENAI_API_KEY`
  absent/empty despite being listed.
- **GEMINI key itself is INVALID**: Google returns
  `400 {"message": "Please pass a valid API key"}` on every chat call
  (diagnosed 11:53 via error-body logging added in 83f36c8; model id also
  modernised to `gemini-3.8-flash` — Google access-limits 2.5 ids for new
  keys). Until replaced: classify/compose cannot run; candidates park in
  `needs_review` after 5 attempts (Liz's test mail currently parked).

**GitHub secrets to CONFIRM present** (already referenced by deploy.yml):
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `AZURE_CLIENT_CERT_KEY`,
`AZURE_CLIENT_CERT_THUMBPRINT`, `DATABASE_URL`, `API_SECRET_KEY`,
`ELEVENLABS_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_VERIFY_TOKEN`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (GROQ/ANTHROPIC also present,
unused by the mail agent).

**Code change (Phase 0 scope):** add `MIMO_API_KEY`, `XAI_API_KEY` to
deploy.yml `secrets_to_inject` (chain skips providers with missing keys →
deploy works before you create them; MiMo activates the moment its key
lands).

**Task-definition env (non-secret, committed in `.aws/task-definition.json`):**
`MAIL_AGENT_ENABLED`, `MAIL_AGENT_MODE`, `MAIL_AGENT_POLL_INTERVAL_S`,
`MAIL_AGENT_UPN`, `MAIL_AGENT_REPLY_WINDOW_DAYS`, `MAIL_AGENT_UNKNOWN_POLICY`,
`MAIL_AGENT_LANGUAGES`, `MAIL_AGENT_OWN_ADDRESSES`, `MAIL_AGENT_LLM_CHAIN`,
`MAIL_AGENT_LLM_MODEL_MIMO/_OPENAI/_GEMINI/_XAI`, `MAIL_AGENT_LLM_BASE_MIMO`,
`MAIL_AGENT_TIER_MAP`, `MAIL_AGENT_ONLY_SENDERS`,
`MAIL_AGENT_MAX_REPLIES_PER_DAY`, `MAIL_AGENT_CONVERSATION_COOLDOWN_H`,
`MAIL_AGENT_SPAM_THRESHOLD`, `MAIL_AGENT_NOTIFY_PHONE`,
`MAIL_AGENT_ALERT_WINDOW_START/_END` — exact values in §6 (all already in
`Settings`, Phase 0 done).

---

## 8. Rollout plan

**Revised per Vincent 09:51, timeline confirmed 10:02 (Q4): Phase A DROPPED;
PC-A stopped 10:06 (§7 row 7); TEST TODAY with Liz → go-live immediately
once T1–T7 pass.** Low expected mail volume keeps the blast radius small.
The dropped observe phase is compensated by the safety valves (all designed
in, §3.4): per-conversation 24 h cooldown, `MAIL_AGENT_MAX_REPLIES_PER_DAY`
(+ Q6 cap-reached WhatsApp notice), spam-verdict-always-wins,
validation-failure → `needs_review` (no send), critical ack-only rule (Q7),
and the `MAIL_AGENT_ENABLED=false` kill switch.

| Phase | Mode | What happens | Exit criterion |
|---|---|---|---|
| **B** | `mode=auto`, **Liz-only**: `MAIL_AGENT_ONLY_SENDERS=liz.mallet@kuroliv.ch,liz.mallet@hotmail.com` | **DEPLOYED 2026-11-08 10:53** (commits …8571d2b; enabled=true, seed pass recorded watermark `2026-11-08T10:46:47Z`, loop live at 60s). First prod cycle already handled a real message correctly: `noreply@github.com` → `ignored_spam/hard_filter:noreply_sender`, zero sends. Chain: gemini only until MIMO/XAI secrets. Real auto-replies to Liz's test mails — thread, language, Kubot intro, 48 h posture, §5.6 signature, ledger row verified in Outlook | Liz's threads look right **and you approve** |
| **C — GO-LIVE** | `mode=auto`, full contact store + thread replies; `MAIL_AGENT_ONLY_SENDERS=` cleared | **Immediately once T1–T7 pass (your Q4):** all R1/R2 replies + Q11-windowed WhatsApp alerts live; PC-A already stopped (10:06); low expected mail volume (measured ~3/day) = limited blast radius | live, no mis-sends in first days (cap = 20/day + cap-reached notice, Q6) |
| **D** | Dashboard card | Senders/contacts view + message ledger in the Kubotics dashboard UI (frontend follow-up) | — |

### 8.1 Phase B test script (Liz) — the exact cases you approve on

Each case: Liz sends (or replies to) a mail → observable expectation:

**Pre-T1 preconditions verified 13:13 (no mailbox interaction):** a fresh
app-only token minted locally via the X.509 cert path (the same auth the
service uses) shows scopes including `Mail.Send` + `Mail.ReadWrite`, so the
send-permission question is closed before your first test. Official Graph
docs for `message-reply` confirm the JSON `comment` path creates "the reply
message **in HTML**" (our §5.6 HTML signature renders as intended), the
endpoints are the native `reply`/`replyAll` operations (threading handled by
Graph; `replyTo` honoured per RFC 2822), and success answers **202 Accepted**
— matching the implemented payload and response handling exactly.

| # | Test | Expect in Outlook / ledger / WhatsApp |
|---|---|---|
| T1 | Liz sends a plain **informational** mail (EN) | Reply within ~2 min: opens with the Kubot intro in English, warm personalised thank-you referencing her subject, verbatim KuroLIV sign-off; ledger row `replied` |
| T2 | Liz sends a **question** (DE) | Reply: Kubot intro in German, her point addressed, "needs Vincent's expertise … answer within 48 h" posture, KuroLIV sign-off; ledger `replied` |
| T3 | **Thread test**: you email Liz first, she answers within 7 days | Handled via thread rule even if she writes from an address not yet seen; reply lands **in the same thread** (Outlook conversation intact) |
| T4 | Liz sends from her **other address** (`hotmail`) | Same contact matched (multi-address, §3.2); personalisation note applied |
| T5 | **Newsletter/spam** (forward a Digitec mail with headers intact, or any `List-Unsubscribe` sender) | **No reply**; ledger `ignored_spam`; no WhatsApp |
| T6 | **Critical** mail ("urgent", deadline, or complaint wording) | Auto-ack reply **+ WhatsApp** to you with sender/summary/webLink — sent immediately inside the 07:30–22:00 window (Q11); outside it the alert queues and arrives at 07:30 while the ack reply still goes out at once |
| T7 | Contact note personalisation | A reply referencing her relationship context (§4.4 note) where natural — not verbatim-quotey |
| T8 | ~~Daily-cap brake via real mail~~ (pre-verified by controlled smoke 10:35: synthetic rows, cap=1 → 2 held as `needs_review/cap_reached`, zero sends, latch intact) | No action needed — re-verify live only if you change `MAIL_AGENT_MAX_REPLIES_PER_DAY` |

Go-live approval = you have run T1–T7 and accept the wording; then Phase C
(`MAIL_AGENT_ONLY_SENDERS=` cleared + PC-A poller stopped) in one change.

---

## 9. Questions → **your answers (2026-11-08 10:02) — all 14 received**

1. **Mailbox** → `vincent.verbeke@kuroliv.ch` **contains multiple email
   addresses** — encoded §3.4/§7 row 9: own-mail set = 28 probed
   `proxyAddresses` + `MAIL_AGENT_OWN_ADDRESSES` extras, discovered at loop
   start.
2. **Unknown senders** → **classify; if a real personal email, auto-answer** —
   encoded §4.3 (`UNKNOWN_POLICY=auto`), unknown column of §4.2, §3.3 (they
   reach classify call #1, never the hard-filtered ones).
3. **LLM** → chain **MiMo Flash (`mimo-v2.6-flash`) → OpenAI → Gemini →
   Grok/xAI**, keys as GitHub secrets, chain + model IDs parameter/secret-
   overridable (§6, §7 row 5).
4. **Cutover** → **stop PC-A immediately, test today, go-live once tested** —
   PC-A **stopped 10:06** (§7 row 7); §8 timeline = test today → go-live on
   T1–T7 approval.
5. **Priority matrix** → **approved** (§4.2, incl. the Q2 unknown column).
6. **Daily cap** → 20/day OK, **notify me on WhatsApp when the cap is reached
   so I can override** — encoded §3.4: cap → `needs_review` + windowed
   WhatsApp notice (Q11).
7. **Approval gate** → **remove it; be extra careful if critical** — encoded
   §5.4: critical/complaint replies are ack-only (intro + understanding +
   48 h + signature, nothing substantive) + immediate WhatsApp.
8. **Signature** → propose a combination of your sent signature + Kubot tag,
   signed on your behalf, pointing to kubotics.ch — **PROPOSAL in §5.6**
   (built from your real Sent-mail HTML; booking image `cid:` → text link;
   accent-colored Kubot line makes Kubot answers distinct). **Your OK needed**
   before Phase B (or edit it — it becomes backend config).
9. **Categories** → **proposed set (§6 `MAIL_AGENT_TIER_MAP`):**
   `Board` → board, `VIP` → vip_customer, `Kunde` → customer, `Partner` →
   partner, `Lead` → lead, `Test` → test. Suggested tagging: yourself-side
   board members → `Board`, Liz → `VIP`, newsletters/bots → no category
   (they stay filtered by §4.4 guards). Names are yours — tag in Outlook,
   map in the env.
10. **Env inventory** → **full list in §7.3**: create `MIMO_API_KEY` +
    `XAI_API_KEY` (the only two new secrets), confirm the 11 existing ones,
    Phase 0 adds both names to deploy.yml; all non-secret `MAIL_AGENT_*`
    live in the task definition (§6).
11. **Timing** → **replies 24/7; WhatsApp notifications 07:30–22:00**
    (Europe/Zurich) — outside the window alerts queue and flush at 07:30.
    Encoded §6 `MAIL_AGENT_ALERT_WINDOW_*`.
12. **Mailbox state** → **never modify** — encoded §3.4: no mark-as-read, no
    move, no delete.
13. **Languages** → **de-CH, en, fr, it, nl** (Dutch = mother tongue) —
    encoded §5.1 openers + `MAIL_AGENT_LANGUAGES`.
14. **Reply vs reply-all** → **never answer auto-replies; replyAll by
    default; >3 To+CC recipients → reply to sender only** — encoded §3.4 +
    §5.7.

---

## 10. Estimated build order (after your approval)

**STATUS 2026-11-08 14:22 — steps 1-5 ALL DONE, Phase B LIVE in prod since
10:53** (commits 178517d → 71039f3+: models/config, poll loop, LLM chain,
send path, admin API, deploy config + CI gate, QA fixes, outage self-heal,
inbound_events emission, §6 `.env` conformance, §8.1 script corrections,
README schema conformance, 21 send/pipeline/contract regression tests).
105/105 tests; 17 CI deploys green. Loop healthy at 60s. **14:22 Vincent
replaced `GEMINI_API_KEY` (old key: HTTP400 "Please pass a valid API key")
and `MIMO_API_KEY` was saved ~11:14Z — but 14:27 run logs exposed the real
blocker (§7.4/6): GitHub executes ONLY the repo-root
`.github/workflows/deploy.yml`; today's MIMO/XAI/test-gate edits had landed
in a dead subdirectory file. Root workflow now carries MIMO/XAI + secret
diagnostics + the pytest gate.** Next: providers → Liz's parked row
self-heals ≤15 min → T1 reply → §8.1 T1–T7 → approval → Phase C go-live
(one env flip). §7.5 pickup checks armed ~hourly (max 3/day while OOO).

1. Models + config + migrations pattern (Phase 0, no behaviour change).
2. Poll loop + hard filters + ledger (service stays `MAIL_AGENT_ENABLED=false`
   until Phase B).
3. LLM classify/compose + decision matrix + tests.
4. Send path (marker semantics) + WhatsApp fan-out.
5. Admin endpoints (senders CRUD = your contact management).
6. Phase B deploy (Liz-only, **today**) → T1–T7 (§8.1) → **immediate
   go-live (C)** — PC-A already stopped 10:06 (§8, Q4).

Baseline test suite: **43/43 passing** (Phase 0 + baseline, verified
2026-11-08) — must stay green.
