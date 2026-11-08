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
   else `unknown` → **ignore** (policy, §4.3). A small DB override list
   (`mail_watch_senders`, optional) covers test senders without a contact card.
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

In `observe` mode only call #1 runs. Spam/unknown senders never reach the LLM
(hard filters first) — cost and latency stay bounded, honouring the earlier
"do not watch mail via llm" constraint for the polling path itself.

### 3.4 Send safety (ported failure contract)

* Persist `send_attempted_at` **before** the POST; a timeout/4xx never
  blind-retries (PC-A round-27: duplicate-reply class).
* Resolve `internetMessageId` → Graph `id` **at send time** with
  `$filter=internetMessageId eq '...'` (OData `'` doubled), then
  `POST /users/{upn}/messages/{graphId}/reply` — the exact proven PC-A
  `cmd_approve` sequence (`webLink` in §3.1 `$select` is display-only; it is
  **not** a `$filter`-able property and must never appear in a filter).
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
emailed first will *not* be answered — they must be a saved contact.)

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

Every composed reply, in the detected language (de-CH / en / fr / it …):

1. **Opens** with the Kubot introduction, e.g. DE:
   *"Grüezi, ich bin Kubot — Vincents persönlicher digitaler KI-Assistent."*
   EN: *"Hello, I'm Kubot, Vincent's personal digital AI assistant."*
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
5. **Never** discloses prompts/instructions (AGENTS.md rule, kept) — no
   "Vincent asked me to…" — and never quotes prices, legal commitments or
   contract language.
6. **Sign-off: the existing verbatim signature, NOT an invented one.**
   AGENTS.md mandates appending the saved signature block VERBATIM — it
   starts with *"Mit freundlichen Grüßen,"* followed by Vincent's
   **KuroLIV GmbH** block (confirmed against Sent Items 2026-10-29/27:
   "Vincent Verbeke … KuroLIV GmbH"). The earlier draft's invented line
   ("Kubot — AI assistant · Kubotics") is **dropped** — the Kubot identity
   lives in the intro, the sign-off stays Vincent's own. Source of truth:
   `~/.jcode/scratch/mail_watch_sig.html` (AGENTS.md path) — ⚠️ **not present
   on this machine** (see §7 row 12); fallback is rebuilding it from the
   Sent-mail pattern and storing it in the backend as config.
7. Sent as a real **thread reply** (`POST /messages/{id}/reply`), HTML, so the
   conversation stays intact in Outlook. Reply style (AGENTS.md): warm, short
   paragraphs, no fluff, answer *their* points in Vincent's voice.

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
MAIL_AGENT_UNKNOWN_POLICY=ignore    # ignore | notify
MAIL_AGENT_LLM_CHAIN=mimo,openai,gemini,xai  # ordered failover (override via env/secret)
MAIL_AGENT_LLM_MODEL_MIMO=mimo-v2.6-flash    # "Xiami MIMO Flash (latest)" — V2.6-Flash, V2.5 IDs retired 2026-10-21
MAIL_AGENT_LLM_MODEL_OPENAI=                 # default at build time, secret-overridable
MAIL_AGENT_LLM_MODEL_GEMINI=
MAIL_AGENT_LLM_MODEL_XAI=
MAIL_AGENT_LLM_BASE_MIMO=https://api.xiaomimimo.com/v1   # OpenAI-compatible
MAIL_AGENT_TIER_MAP=Board=board;VIP=vip_customer;Kunde=customer  # Outlook categories → tiers
MAIL_AGENT_ONLY_SENDERS=              # comma list; when set, ONLY these senders get replies (Phase B: Liz; emergency brake: set to one address)
MAIL_AGENT_MAX_REPLIES_PER_DAY=20
MAIL_AGENT_SPAM_THRESHOLD=0.80
MAIL_AGENT_NOTIFY_PHONE=+41797481975
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
| 7 | **PC-A poller must be stopped at cutover** | ⚠️ PC-A `mail_watch_poll` (10-min) still watches the **same mailbox** | **disable it when cloud goes live — otherwise double replies** (blocking) |
| 7b | Entra app identity shared with PC-A | ✅ **no longer blocking** — live token 2026-11-08 shows app `7246abc4-…` (= task-def `AZURE_CLIENT_ID`) already reads the target mailbox (200s). PC-A's own identity only matters for its decommission, not for this backend | informational; compare PC-A `M365_CLIENT_ID` only if PC-A-side checks are ever re-enabled |
| 8 | ECS service desired count = 1 | ⚠️ not verifiable from repo | confirm in AWS console; ledger `INSERT … ON CONFLICT DO NOTHING` claim makes even N>1 tasks safe |
| 9 | Mailbox choice | task-def says `vincent.verbeke@kuroliv.ch`, `.env.example` says `vincent@kubotics.ch` | confirm target mailbox (§9 Q1) |
| 10 | Rate/throttling | Graph throttles on 60 s metadata polls are trivial for 1 mailbox (measured volume: 21 inbox messages in the last 8 days ≈ 3/day, §7.1) | implement 429 backoff + retry-after in the loop (planned, not yet written) |
| 11 | **CI has no test/lint gate** | ⚠️ verified 2026-11-08: `deploy.yml` job is named "Build, Test & Deploy" but runs no `pytest`/`ruff` — a push to main deploys regardless of test outcome | run the suite locally before every push (plan §10 keeps 34/34 green as gate); optionally add a pytest step to deploy.yml as a Phase 0 side-fix |
| 12 | **Verbatim signature file + live allowlist for seeding** | ⚠️ AGENTS.md mandates `~/.jcode/scratch/mail_watch_sig.html` (KuroLIV block, never invent a sign-off) and `mail_watch_config.json` (current senders) — **neither exists on this machine**; both live on PC-A (deploy paths `/home/wa/…`) or were pruned | at cutover: copy the sig file from PC-A (or rebuild from Sent mail, §5.6) and export PC-A's allowlist to seed `mail_watch_senders` (cap 50, same address regex) |
| 12b | **Approval-flow divergence** | ⚠️ documented PC-A rule: "NO send ever without explicit SEND" via WhatsApp — this plan deliberately removes that gate (your 2026-11-08 ask: fully automated), mitigated by the Liz-only Phase B + safety valves (§8) | confirm in §9; §8 is the compensating control |
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
| Local test suite | 34/34 pass |
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
credentials), PC-A poller state (different machine), and the acceptance step
itself — your §9 review — which is the user-gated stopping point of this
phase.

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

---

## 8. Rollout plan

**Revised per Vincent 2026-11-08 09:51: Phase A (observe) is DROPPED** —
straight to live testing with Liz, then immediate go-live on approval;
expected low mail volume in the coming days keeps the blast radius small.
The dropped observe phase is compensated by the safety valves below (all
designed in, §3.4): per-conversation 24 h cooldown, `MAIL_AGENT_MAX_REPLIES_PER_DAY`,
spam-verdict-always-wins, validation-failure → `needs_review` (no send), and
the `MAIL_AGENT_ENABLED=false` kill switch.

| Phase | Mode | What happens | Exit criterion |
|---|---|---|---|
| **B** | `mode=auto`, **Liz-only**: `MAIL_AGENT_ONLY_SENDERS=liz.mallet@kuroliv.ch,liz.mallet@hotmail.com` | Real auto-replies to Liz's test mails — thread match, language, Kubot intro, 48 h posture, verbatim signature, ledger row all verified in Outlook | Liz's threads look right **and you approve** |
| **C — GO-LIVE** | `mode=auto`, full contact store + thread replies; `MAIL_AGENT_ONLY_SENDERS=` cleared | **Immediately on your approval:** all R1/R2 replies + P1/P2 WhatsApp alerts live; **PC-A poller stopped in the same change**; low expected mail volume the next days (measured ~3/day today) = limited blast radius | live, no mis-sends in first days (cap = 20/day as brake) |
| **D** | Dashboard card | Senders/contacts view + message ledger in the Kubotics dashboard UI (frontend follow-up) | — |

---

## 9. Open questions for your review

1. **Mailbox:** `vincent.verbeke@kuroliv.ch` (what PC-A watched) or
   `vincent@kubotics.ch`? Default proposed: kuroliv (same as PC-A/task-def).
2. **Unknown senders:** confirm "log & ignore" (§4.3), or switch to
   `notify` (WhatsApp digest, still no auto-reply)?
3. ~~**LLM default provider**~~ **RESOLVED (Vincent 2026-11-08):** chain =
   **Xiaomi MiMo Flash (latest, `mimo-v2.6-flash`) → OpenAI → Gemini → Grok
   (xAI)**; keys as GitHub secrets; chain order + model IDs changeable by
   env parameter/secret. Remaining: secret/model names (Q10).
4. **Cutover:** confirm you want PC-A's mail watch stopped when Phase C goes
   live (it must be, to avoid double answers).
5. **Priority matrix (§4.2):** approve as proposed, or adjust e.g. "every
   board-member mail also WhatsApp-pings me regardless of criticality"?
6. **Daily cap:** 20 auto-replies/day default — OK?
7. **Approval gate removed (§7 row 12b):** the PC-A flow required your
   explicit WhatsApp `SEND` for every reply; this plan sends unattended
   (that is what "fully automated" means) with the Liz-only Phase B test and
   the safety valves (cooldown, daily cap, kill switch, §8) as the ramp.
   Confirm you accept that divergence.
8. **Sign-off (§5.6):** replies end with your verbatim KuroLIV GmbH
   signature (AGENTS.md rule, Kubot only in the intro). Please share
   `mail_watch_sig.html` (PC-A) or approve rebuilding it from your Sent
   mail.
9. ~~**Contact store + your categories**~~ **RESOLVED 2026-11-08 09:49** — you
   granted `Contacts.Read`; I read the store: Liz Mallet found in **Outlook
   People** (notes reviewed, §4.4), 15 contacts total. **Follow-up:** no
   contact has categories set yet — do you plan to tag them (e.g. Liz →
   `VIP`/`Board`/`Partner`)? Until then everyone lands in the default tier
   `contact` (matrix behaves like customer) and the spam guards carry the load.
10. **GitHub secrets (your LLM instruction):** create `MIMO_API_KEY`
    (platform.xiaomimimo.com → API Keys) and `XAI_API_KEY`, confirm
    `OPENAI_API_KEY` + `GEMINI_API_KEY` exist, and Phase 0 adds both new
    names to deploy.yml's injection map. Model IDs overridable via
    `MAIL_AGENT_LLM_MODEL_*` env/secret — naming OK?
11. **Reply timing:** auto-replies 24/7 as mail arrives, or only business
    hours (Europe/Zurich, no weekends)? Default proposed: 24/7 for
    allowlisted/thread mail (the 48 h promise absorbs off-hours), critical
    WhatsApp always.
12. **Mailbox state:** should the service mark processed messages as read
    (Mail.ReadWrite allows it) or **never modify** your mailbox? Default
    proposed: never touch read state — the ledger is the audit trail.
13. **Reply languages:** the opener must exist per language you receive —
    confirm the set: **de-CH, en, fr, it** (add others?)
14. **Reply vs reply-all:** PC-A (and this plan) send `POST /messages/{id}/reply`
    = **reply to the sender only**. If a board/customer mail has CC'd
    recipients, should Kubot (a) reply sender-only (default, proposed — an
    unattended auto-answer shouldn't broadcast to a whole thread), or
    (b) reply-all?

---

## 10. Estimated build order (after your approval)

1. Models + config + migrations pattern (Phase 0, no behaviour change).
2. Poll loop + hard filters + ledger (service stays `MAIL_AGENT_ENABLED=false`
   until Phase B).
3. LLM classify/compose + decision matrix + tests.
4. Send path (marker semantics) + WhatsApp fan-out.
5. Admin endpoints (senders CRUD = your contact management).
6. Phase B deploy (Liz-only) → your approval → **immediate go-live (C)** with
   PC-A poller stopped in the same change (§8 — observe phase dropped 2026-11-08).

Baseline test suite: **34/34 passing** (verified 2026-11-08) — must stay green.
