# IBKR MCP in the Kubotics Backend

**Author:** Jcode · **Date:** 2026-11-14 · **Requested by:** Vincent
("this MCP should run in the Kubotics Backend and if Auth is needed once more
it needs to be done online so I can do this when on the way. It is critical
that this now works stable.")

This document is the operational and architecture reference for the IBKR MCP
connector that now lives **inside** the Kubotics Backend. It replaces nothing:
the dev-PC feed keeps running during the transition (see §5).

---

## 1. Where things live

| Piece | Location |
|---|---|
| MCP client + feed + poller | `src/app/services/ibkr_mcp.py` |
| HTTP endpoints | `src/app/api/v1/ibkr_mcp.py` (mounted in `src/app/main.py` under `/api/v1`) |
| Token store (Postgres) | table `crm.ibkr_mcp_tokens` — model `src/app/models/ibkr.py` (`IbkrMcpToken`), **exactly one row** (`id='singleton'`) |
| PKCE pending states | table `crm.ibkr_mcp_auth_states` — model `IbkrMcpAuthState` (state PK, verifier, created_at, consumed_at) |
| Snapshot row | existing `device_snapshot_cache` dataset `ibkr_investments` (same row the dev-PC pusher writes) |
| Settings | `src/app/core/config.py` — all `IBKR_MCP_*` (default off) |
| Tests | `tests/test_ibkr_mcp_service.py`, `tests/test_ibkr_mcp_api.py`, `tests/ibkr_helpers.py` |

Tables are created by the existing idempotent `Base.metadata.create_all` in the
lifespan (no alembic yet in this repo, same as every other new model).

### Where tokens live and how they are protected

* Postgres only (no JSON file on disk like the dev-PC `~/ibkr_mcp_tokens.json`).
* Writes are **atomic**: single ORM upsert + single `commit()` — readers see
  either the old or the new token, never a partial write.
* **Token values are never logged** (log lines carry HTTP statuses and counts
  only), never returned by any endpoint (`/auth/status` returns
  configured/authorized/fresh/last_refresh_at/redirect_uri only), and never
  embedded in HTML pages.

### Refresh contract (the 2026-11-13 fix, ported 1:1)

IBKR refresh tokens are **single-use (rotating)**. The whole token family was
revoked on 2026-11-13 12:45 when `ibkr-push`, `ibkr-watch` and the executor
raced on the same refresh token. `services/ibkr_mcp.py::refresh()` therefore
mirrors the proven `~/.local/bin/ibkr_mcp.py` helper exactly:

1. **One refresher at a time** — an asyncio lock (lazily bound per event loop).
   The ECS task runs a single process, so the backend as a whole has exactly
   one rotating refresher — the same guarantee `flock` gave on the dev PC.
2. **Re-read the token row AFTER acquiring the lock** — a waiter picks up the
   rotation the winner just saved instead of replaying a consumed refresh token.
3. **Freshness margin `FRESH_MARGIN_S = 45`** — an access token with more than
   45 s left is reused untouched (no rotation on every call).
4. **`force=True`** skips the shortcut — used only on the HTTP 401 recovery
   path (`open_session()`), exactly like the feed.
5. **Failure contract:** `SystemExit("refresh failed: {http_status}")`. Every
   caller catches it: `merged()` (falls back to cache), the poll loop (logs and
   continues), and `POST /api/v1/ibkr/mcp/refresh` (maps to HTTP 502).

---

## 2. Online re-auth from a phone (the traveling flow)

```
phone/browser                     backend (api.kubotics.ch)              IBKR
     |                                    |                                |
     | 1. POST /api/v1/ibkr/auth/start    |                                |
     |    (admin header)                  | creates PKCE verifier + state  |
     |    <- {"authorize_url": "..."}     |  (DB row, TTL 600 s, 1x use)   |
     | 2. open authorize_url -------------------------------------------> |
     |    user logs into IBKR, consents   |                                |
     | 3. IBKR redirects to IBKR_MCP_REDIRECT_URI (public HTTPS!)        |
     |    GET /api/v1/ibkr/auth/callback?code=...&state=...               |
     |    <----------------------------------- forwards all paths -------->|
     | 4. backend validates state (unknown/expired/used -> 400 HTML),     |
     |    exchanges code (form-encoded, PKCE verifier, resource=EP),      |
     |    persists tokens atomically                                     |
     | <- 200 HTML "Connected. You can close this tab."                   |
```

* `POST /api/v1/ibkr/auth/start` and `POST /api/v1/ibkr/mcp/refresh` are
  **admin gated** — `Authorization: Bearer <token>` or `X-Needle-Token: <token>`
  against `NEEDLE_TOKEN` (fallback `API_SECRET_KEY`), the same pattern as
  `whatsapp._require_send_token`.
* `GET /api/v1/ibkr/auth/callback` is **public** — that is what makes re-auth
  possible while traveling. CloudFront forwards all paths to the ALB, so
  `https://api.kubotics.ch/api/v1/ibkr/auth/callback` works with no edge config.
* State rules: unknown → 400, older than 600 s → 400 (+purged), already used →
  400. The state is **burned before** the code exchange, so a replayed callback
  can never exchange twice.
* Codes are short-lived: a failed exchange returns a 502 HTML page telling
  Vincent to run `/auth/start` again and be quick (same advice as the dev-PC
  `ibkr_mcp_reauth.py`).
* `GET /api/v1/ibkr/auth/status` (public, no secrets): `{configured,
  redirect_configured, authorized, fresh, last_refresh_at, redirect_uri}` —
  `configured` = feed gate, `redirect_configured` = auth gate (§10).

### OAuth parameters (ported 1:1 from the reference scripts)

* Issuer `https://api.ibkr.com`, MCP endpoint (`resource`) =
  `https://api.ibkr.com/v1/api/mcp-public`
* Token endpoint `POST {issuer}/oauth2/api/v1/token` — **form-encoded**
  (`application/x-www-form-urlencoded`; JSON got HTTP 415 on 2026-11-08)
* Authorize `GET {issuer}/oauth2/authorize?...&resource={EP}`
* Scope: `openid profile email account-ids mcp.read mcp.write mcp.orders.submit`
  (identical to the proven login/reauth flow; read-only enforcement is at the
  tool level, see §6)
* Public client id: `ba3ab3ee-3468-442b-8183-113e7d777dae` (registered
  2026-11-08)
* PKCE: S256, verifier = 32 random bytes unpadded base64url, state =
  `secrets.token_urlsafe(16)`

---

## 3. Environment configuration (ECS task definition)

Exact variable names (add to `.aws/task-definition.json` container definitions,
or the deploy workflow's env injection — repo is private):

| Variable | Required to go live | Default | Meaning |
|---|---|---|---|
| `IBKR_MCP_ENABLED` | yes | `false` | Master switch **and the feed gate** (§10): `false` ⇒ no poller, all control/instruction endpoints 503. `true` alone is enough for the feed + instruction endpoints — **no redirect URI required for the feed** (§10). |
| `IBKR_MCP_REDIRECT_URI` | only for online re-auth | `""` (empty) | Public callback, e.g. `https://api.kubotics.ch/api/v1/ibkr/auth/callback`. Required by `/auth/start`, `/auth/callback` and DCR only (the auth gate, §10). Empty ⇒ those endpoints answer 503 "not configured" while the feed keeps running. **Must be registered at IBKR for the client id below.** |
| `IBKR_MCP_CLIENT_ID` | no | `ba3ab3ee-3468-442b-8183-113e7d777dae` | OAuth public client. |
| `IBKR_MCP_SCOPE` | no | proven scope string (see §2) | Do not change without re-testing consent. |
| `IBKR_MCP_POLL_INTERVAL_S` | no | `60` | Seconds between read-only bursts. |
| `IBKR_MCP_DCR_ENABLED` | no | `false` | Dynamic client registration endpoint (§7). |
| `IBKR_MCP_DCR_URL` | no | `""` | Empty ⇒ `{issuer}/oauth2/api/v1/clients` (unverified URL, see §7). |
| `NEEDLE_TOKEN` or `API_SECRET_KEY` | yes (already set) | — | Admin gate for `/auth/start`, `/mcp/refresh`, `/auth/register`. |

Nothing else needs to change: the feature is completely inert when the first
two are unset, which is the default.

**IBKR-side one-time step:** register the redirect URI
`https://api.kubotics.ch/api/v1/ibkr/auth/callback` for client
`ba3ab3ee-3468-442b-8183-113e7d777dae` (currently only
`http://127.0.0.1:53117/callback` is registered). Without this, IBKR rejects
the authorize request with `invalid_redirect_uri` and re-auth cannot complete.

---

## 4. Background poller

* Started in the `main.py` lifespan **only** when `feed_enabled()`
  (`IBKR_MCP_ENABLED` — the redirect URI is NOT required since Phase C, §10) —
  `services/ibkr_mcp.py::maybe_start_poller()` returns `None` otherwise, so
  with defaults nothing registers and nothing polls.
* **No-token robustness (§10):** enabled but no token row (or no refresh
  token) in the DB ⇒ the cycle is skipped quietly — one INFO line per cycle,
  no exception, no log spam, never touches the network. Enabling the flag
  before importing tokens is harmless.
* Loop shape identical to `trading_watch.watch_loop()`: 5 s boot delay, then
  every `IBKR_MCP_POLL_INTERVAL_S`:
  1. burst due? (at most one per 60 s, feed parity),
  2. read the current `ibkr_investments` snapshot row,
  3. `merged(payload)` — refresh → initialize → read-only tools
     (`get_account_summary` / `get_account_balances` fallback /
     `get_account_positions` / `get_account_orders` / `get_order_instructions`
     optional),
  4. **write only if the backend actually contributed data** — on any failure
     the dev-PC row is left untouched,
  5. persist with `source = "backend-ibkr-mcp"` (column **and** payload key, so
     the dashboard's existing `/api/v1/investments` read keeps working
     unchanged).
* One bad cycle can never kill the loop (logs and continues); `SystemExit` from
  `refresh()` is caught inside `merged()`.

> **Note (after cutover):** the dashboard read feed flags `stale` when the row
> is older than `stale_threshold_seconds` (default 60). While the dev-PC
> pusher runs (every ~10 s) the row stays fresh regardless. Once the dev-PC
> feed is retired, the backend's 60 s cadence sits exactly at that threshold —
> either read the feed with `?stale_threshold_seconds=150` or set
> `IBKR_MCP_POLL_INTERVAL_S=45` (bursts are still capped at one per 60 s by
> `BURST_EVERY_S`, but each successful burst rewrites the row before the
> threshold trips).

---

## 5. Coexistence with the dev-PC feed (transition plan)

Both writers target the **same** `device_snapshot_cache` row
(dataset `ibkr_investments`) and produce the **same payload shape**
(`cash_chf`, `equity_chf`, `positions`, `orders_active`, `instructions_pending`
+ the gateway `auth` block from the dev-PC pusher, which the backend merge
preserves). The dashboard therefore renders identically regardless of who wrote
last. The dev-PC `ibkr-push.timer` keeps working untouched.

### Cutover steps (later, deliberately not part of this change)

1. Deploy with `IBKR_MCP_ENABLED=false` (default) → zero behavior change.
2. Register the redirect URI at IBKR (§3), then deploy with
   `IBKR_MCP_ENABLED=true` + `IBKR_MCP_REDIRECT_URI` set.
3. Do the first phone re-auth (`POST /api/v1/ibkr/auth/start` → open URL →
   callback). Verify `GET /api/v1/ibkr/auth/status` → `authorized: true` and
   watch `source: "backend-ibkr-mcp"` appear in `/api/v1/investments`.
4. Let both writers run for a few days; compare freshness/numbers.
5. Retire the dev-PC feed: disable `ibkr-push.timer`
   (`systemctl disable --now ibkr-push.timer`) on the dev PC. The backend row
   keeps updating; nothing else changes.
6. (Optional) stop the dev-PC `ibkr-watch` burst as well — but **only** if no
   other local tool still needs its token file; the backend and the dev PC use
   SEPARATE token stores, so they never race each other's refresh tokens.

---

## 6. Stability constraints (hard rules)

1. **Single refresher.** Only `services/ibkr_mcp.py::refresh()` may hit the
   refresh grant, always serialized + re-reading after the lock + freshness
   reuse (§1). Never add a second refresh path.
2. **Read-only tools + the instruction trio only.** Every MCP tool call runs
   `assert_allowed_tool()` (Phase C, §10): (a) `INSTRUCTION_TOOLS`
   (`create_order_instruction`, `delete_order_instruction`,
   `get_order_instructions` — create/delete REQUIRE
   `flow_type=REVIEW_AND_APPROVE` at the call site), then (b)
   `READ_ONLY_TOOLS` (`get_account_summary`, `get_account_balances`,
   `get_account_positions`, `get_account_orders`, `get_order_instructions`,
   `get_price_snapshot`). Anything else — `submit_*`, `cancel_*`, `modify_*`,
   `place_*`, `preview_order`, `answer_order_question`, `get_order_rules`,
   `get_order_status` (AUTONOMOUS-restricted), unknown names — is rejected
   **before any network call** (C3: no live-order path exists in this backend
   module). `assert_read_tool()` keeps its original strict read-only semantics
   for the pure-read paths (feed/burst callers).
3. **No token logging.** Statuses, counts and HTTP codes only. Tests assert
   that token values never appear in HTTP responses.
4. **Default off.** `IBKR_MCP_ENABLED=false` ⇒ no poller task, no state rows,
   no token rows, 503 on the action endpoints. Existing endpoints untouched.
5. **Never raise from `merged()`.** Refresh/burst failures fall back to the
   last good burst (≤15 min old) or to the previous payload unchanged.
6. **No network in tests.** `httpx` layer is monkeypatched
   (`_post_form` / `_post_mcp`); the DB is an in-memory fake.

---

## 7. Dynamic client registration (`POST /api/v1/ibkr/auth/register`)

**Choice: implemented but disabled by default (`IBKR_MCP_DCR_ENABLED=false`).**

Reasoning, documented exactly as required by the design notes:

* The reference scripts do **not** contain a DCR code path. On the contrary,
  `ibkr_mcp_login.py` explicitly says: *"Reuse the public client registered
  2026-11-08 (ba3ab3ee-…). Re-running DCR each time would orphan clients and
  force fuller consent."*
* No verified IBKR registration URL is documented anywhere in the reference
  material, so the endpoint defaults to `{issuer}/oauth2/api/v1/clients` —
  an **unverified** guess — and only fires when both
  `IBKR_MCP_DCR_ENABLED=true` and (optionally) `IBKR_MCP_DCR_URL` are set.
* The endpoint posts RFC 7591-style JSON (`client_name`, `redirect_uris`,
  `grant_types`, `response_types`, `token_endpoint_auth_method: none`,
  `scope`) and **strips `client_secret`** from anything it returns.

**Recommendation:** keep it disabled. The supported path is to register the
redirect URI for the existing client `ba3ab3ee-3468-442b-8183-113e7d777dae`
(or for a new client created once manually in the IBKR account portal) and set
`IBKR_MCP_CLIENT_ID` accordingly. Enable DCR only after IBKR confirms the
registration endpoint.

---

## 8. Endpoint reference

| Method | Path | Auth | Disallowed/notes |
|---|---|---|---|
| GET | `/api/v1/ibkr/auth/status` | public | always 200; `configured:false` when off; `redirect_configured` added by Phase C (§10) |
| POST | `/api/v1/ibkr/auth/start` | admin | 503 when **auth gate** not ready (enabled + redirect URI) |
| GET | `/api/v1/ibkr/auth/callback` | public | 503 off, 400 bad/expired/used state, 502 exchange failure, 200 HTML "Connected" |
| POST | `/api/v1/ibkr/mcp/refresh` | admin | 503 when **feed gate** off (enabled only, §10), 502 refresh failure; status only |
| POST | `/api/v1/ibkr/auth/register` | admin | 503 always unless `IBKR_MCP_DCR_ENABLED=true` |
| POST/GET/DELETE | `/api/v1/ibkr/instructions[/{id}]` | admin | Phase C (§10) — staged REVIEW_AND_APPROVE instructions |
| POST | `/api/v1/ibkr/mcp/call` | admin | Phase C (§10) — allowlisted generic READ proxy |
| POST | `/api/v1/ibkr/plan/state/import` | admin | Phase 2a (§10.7) — seed the plan state row from the dev state JSON (NOT feed-gated; 422 on empty body) |
| GET | `/api/v1/ibkr/plan/state` | admin | Phase 2a (§10.7) — `{found, state, updated_at, source}`, fail-soft 200 |
| POST | `/api/v1/ibkr/plan/dry-run` | admin | Phase 2a (§10.7) — ALWAYS dry `run_daily_plan` (never creates/saves/sends); 503 when the feed gate is off |
| GET | `/api/v1/ibkr/plan/status` | admin | Phase 2a (§10.7) — loop observability: `{plan: {enabled, loop_started, loop_started_at, first_attempt, deadline, tz, tick_s}, marker, state_dataset, feed_enabled}`; NEVER 503 (the Monday pre-flight) |

Admin = `Authorization: Bearer <NEEDLE_TOKEN or API_SECRET_KEY>` or
`X-Needle-Token: <same>`.

---

## 9. Test coverage

`uv run --frozen pytest -q` (the deploy gate in
`.github/workflows/deploy.yml`) covers, for this feature:

* refresh contract: fresh reuse, rotate-once + persist, post-rotation reuse,
  force bypass, `SystemExit` with HTTP status, **concurrent refreshers rotate
  exactly once** (the 2026-11-13 race regression), missing-token failure
* PKCE S256 relation, authorize URL shape (issuer/client/redirect/scope/
  resource/method)
* auth state: unknown rejected, single use, TTL expiry + purge, purge on
  re-create
* read-tool allowlist: 5 read tools accepted, 12 order/write/unknown names
  rejected, rejection happens with **zero** network calls
* `merged()`: overlays burst, preserves existing blocks, never raises on
  `SystemExit` / `RuntimeError` / garbage input, cache fallback
* API wiring: disabled-by-default inertness (503s + `maybe_start_poller()` is
  `None`), admin 401s, start→authorize_url, callback happy path (form fields,
  persisted tokens, no token material in the response), bad state, TTL, single
  use, exchange failure 502, refresh status-only, DCR disabled
* Phase C (§10): config split (feed without redirect → poller allowed +
  `/auth/start` 503, `redirect_configured` field), poller skip-when-no-token
  (one INFO line, burst never called), instruction create happy path +
  dedupe skip (pending + within-batch, terminal rows don't skip) + batch cap
  422 + validation 422s + AUTONOMOUS 422, delete happy/not-found-404/502,
  `mcp/call` read allowed (incl. `get_price_snapshot`) + write names rejected
  400 with **zero** MCP layer invocations, `import_tokens` row parity,
  admin 401s, disabled 503s, no token material in any Phase C response
* no test makes a network call; no test touches a real database

---

## 10. Phase C — cloud-owned MCP flow (2026-11-14)

Vincent 2026-11-14: *"ONLY C and ASAP … Cloud needs to run without the dev pc,
else we have much too much dependency on the dev pc."* Phase C makes the
backend the **single MCP holder** for the ENTIRE flow: reads (the feed) **and**
order processing (staged review instructions). Deliberately out of scope here:
moving the planner itself off the dev PC (a later brief, Phase 2).

All new code keeps the hard rules of §6: default-off, admin-gated, no token
values logged or returned, no live-order tool ever reachable, no network in
tests.

### 10.1 Feed gate split (callback no longer required for the feed)

| Gate | Definition | Gates |
|---|---|---|
| **feed** | `feed_enabled()` = `IBKR_MCP_ENABLED` | `maybe_start_poller()`, `POST /mcp/refresh`, `POST|GET|DELETE /instructions`, `POST /mcp/call` |
| **auth** | `auth_ready()` = `IBKR_MCP_ENABLED` **and** `IBKR_MCP_REDIRECT_URI` | `POST /auth/start`, `GET /auth/callback`, `POST /auth/register` |

* `IBKR_MCP_ENABLED=true` with **NO redirect URI** is now a first-class
  deployment: the feed polls, the instruction endpoints work, and tokens can
  be imported by script (§10.5). The auth endpoints keep their exact 503
  HTML/JSON shapes ("not configured").
* `GET /auth/status`: `configured` now reports the **feed** gate; the new
  `redirect_configured` field reports the auth gate; `authorized` / `fresh` /
  `last_refresh_at` / `redirect_uri` are unchanged.
* **Poller robustness:** feed enabled but no token row (or no refresh token)
  in the DB ⇒ the cycle is skipped quietly — at most one INFO line per cycle
  (no secrets), never raises, never spams, never touches the network.
  Enabling before importing tokens is harmless.

### 10.2 Instruction endpoints (REVIEW_AND_APPROVE only)

All admin-gated (`Bearer` / `X-Needle-Token`), all feed-gated (503 "feed not
enabled" when `IBKR_MCP_ENABLED` is off), all 502 when the MCP call layer
(refresh/initialize) fails.

**`POST /api/v1/ibkr/instructions`** — stage a batch of order instructions
(never submits anything):

```json
{
  "instructions": [
    {"side": "BUY", "quantity": 2.5, "conid": 265598,
     "limit_price": 450.5, "tif": "DAY", "exchange": "SMART",
     "currency": "USD", "flow_type": "REVIEW_AND_APPROVE"}
  ],
  "dedupe": true,
  "source": "daily_invest"
}
```

* Entry fields: `side` (`BUY`/`SELL`, required), `quantity` (>0, required),
  `conid` (>0) **or** non-empty `symbol`, `limit_price` (>0, optional),
  `tif` (default `"DAY"`), `exchange`, `currency` (optional), `flow_type`
  (optional — anything other than `REVIEW_AND_APPROVE` ⇒ **422**, AUTONOMOUS
  can never pass).
* **1–20 entries per call** (422 beyond); any validation failure ⇒ 422 before
  the MCP layer is touched.
* MCP args use the proven `daily_invest.py` shape:
  `{"contract_id_ex": "<conid as string>", "side", "quantity",
  "time_in_force", "flow_type": "REVIEW_AND_APPROVE" (ALWAYS forced),
  "order_type": "LIMIT" + "limit_price" only when priced, "symbol" when the
  entry was given a ticker}`.
* `dedupe: true` (default) first reads `get_order_instructions` and skips an
  entry whose `(conid-or-symbol, side)` already has a **non-terminal pending**
  instruction — the daily_invest skip semantics (statuses outside
  filled/cancelled/canceled/deleted/rejected/inactive count as pending),
  including duplicates within the same batch. A failed dedupe read aborts the
  batch with 502 rather than risking duplicates.
* Response: `200 {"results": [{"index": 0, "status": "created",
  "instruction_id": "…"}, {"index": 1, "status": "skipped_duplicate",
  "detail": "…"}, {"index": 2, "status": "error", "detail": "…"}]}` — per-entry
  tool failures stay in-band (batch was processed ⇒ 200).
* The handler asserts `assert_allowed_tool("create_order_instruction",
  REVIEW_AND_APPROVE)` **before any network call**, and `call_tool` re-asserts
  per call: `submit_order` / `cancel_order` / `modify_order` are unreachable.

**`GET /api/v1/ibkr/instructions`** — admin, `200 {"instructions": […]} `: the
pending (non-terminal) review queue, exactly the mapping the feed embeds as
`instructions_pending`.

**`DELETE /api/v1/ibkr/instructions/{instruction_id}`** — admin, calls
`delete_order_instruction` with `{"id": …, "flow_type":
"REVIEW_AND_APPROVE"}` (`id` is the field name the live IBKR tool schema
requires — `instruction_id` fails MCP input validation); `404 {"detail": "instruction not found: …"}` when MCP
reports not found (both the `isError`-text and result-dict shapes), 502 when
the MCP call layer fails, 200 `{"ok": true, "instruction_id": …}` on success.

### 10.3 `POST /api/v1/ibkr/mcp/call` — generic READ proxy

Lets the dev-PC callers (`daily_invest`, `ibkr_watch_static` via
`ibkr_mcp_feed._cloud_call_tools`, default route; `IBKR_MCP_LOCAL=1` remains
the local escape hatch for tests/auth emergencies) read through the cloud
instead of holding their own tokens.

```json
{"name": "get_price_snapshot",
 "args": {"contract_id": 265598, "market_data_names": ["last", "bid_ask"]}}
```

* `200 {"name": "<tool>", "result": <parsed MCP JSON>}`.
* **Allowlist only** — the §10.4 resolution runs BEFORE any network call:
  `READ_ONLY_TOOLS` (incl. `get_price_snapshot`) + `INSTRUCTION_TOOLS` pass;
  `submit_order`, `cancel_order`, `modify_order`, `place_*`, `preview_order`,
  `answer_order_question`, `get_order_rules`, `get_order_status` and unknown
  names ⇒ **400 pre-network**.
* **Money rules hold on this path:** for `create_order_instruction` (and
  `delete_order_instruction`) a missing `flow_type` is **defaulted to
  `REVIEW_AND_APPROVE`**; any other explicit flow (AUTONOMOUS) ⇒ **422**
  pre-network. The proxy can never become a submit bypass.
* 503 feed off, 502 MCP-layer failure (refresh/init), never any token in the
  response.

### 10.4 Allowlist resolution (`assert_allowed_tool`, every tool-call helper)

1. **(a)** name in `INSTRUCTION_TOOLS` (`create_order_instruction`,
   `delete_order_instruction`, `get_order_instructions`) → allowed;
   create/delete additionally REQUIRE `flow_type=REVIEW_AND_APPROVE`
   enforced at the call site (missing/other flow ⇒ `ValueError` pre-network),
2. **(b)** name in `READ_ONLY_TOOLS` → allowed,
3. **(c)** any `_ORDER_TOOL_HINTS` match (place/submit/cancel/replace/delete/
   create/buy/sell/transfer/close/write) → rejected,
4. **(d)** unknown → rejected.

`get_order_rules` / `get_order_status` (flow-restricted AUTONOMOUS) fall
through to (d) and stay rejected — not needed. `assert_read_tool()` itself is
unchanged for existing pure-read callers (feed/burst).

### 10.5 Token import (no new attack surface)

`services/ibkr_mcp.py::import_tokens(access_token, refresh_token, expires_in,
scope, token_type="Bearer") -> dict` upserts the singleton row **exactly like
`save_tokens`** (atomic single commit; `expires_at = now + expires_in`;
`last_refresh_at = now`; values never logged). Used by tests and by Vincent's
import script — deliberately **NOT** exposed as an HTTP endpoint.

### 10.6 Cutover order (the 2026-11-13 race rule)

IBKR refresh tokens are single-use; the 2026-11-13 revocation happened when
three processes refreshed the **same** token family concurrently. The import
(§10.5) puts the SAME family into the backend DB, so from that moment **exactly
one refresher may exist**: the backend's serialized `refresh()`. Therefore:

1. **Deploy with `IBKR_MCP_ENABLED=false`** (default) → zero behavior change.
2. **Locals OFF first:** stop every local process that could still refresh the
   token file (`systemctl disable --now ibkr-push.timer`, stop `ibkr-watch`
   bursts, keep `IBKR_MCP_LOCAL` unset so `ibkr_mcp_feed` routes to the cloud
   proxy). No local helper may hold the imported family.
3. **Import tokens** into `crm.ibkr_mcp_tokens` (§10.5) while the feed flag is
   still off.
4. **Then enable:** `IBKR_MCP_ENABLED=true` — **no redirect URI required for
   the feed** — and restart. Watch the one-INFO-per-cycle skip disappear once
   the row exists.
5. **Verify:** `GET /auth/status` → `configured: true, authorized: true`;
   `source: "backend-ibkr-mcp"` in `/api/v1/investments`;
   `GET /api/v1/ibkr/instructions` returns the queue; a `POST /mcp/call` read
   (e.g. `get_account_positions`) answers 200.
6. **Re-auth path (later, optional):** set `IBKR_MCP_REDIRECT_URI` and use
   `POST /auth/start` from any phone (§2) — only needed if the family ever
   dies again.

Rule of thumb: **locals OFF first, cloud enable second** — never both
refreshing the same family (2026-11-13), and never a second backend refresher
(§6.1).

### 10.7 Phase 2a — cloud plan runner (flag off)

Vincent 2026-11-14 (Phase 2a of "ONLY C"): the DAILY IBKR PLAN RUNNER moves
off the dev PC into the backend, behind a new **default-OFF** flag. Until the
flag is flipped, nothing runs, nothing polls and today's behavior is
untouched (the dev-PC `daily_invest.py` stays the sole emitter).

| Piece | Where |
|---|---|
| plan engine + runner + scheduler | `src/app/services/ibkr_plan.py` |
| 50/50 spread rule | `src/app/services/ibkr_spread.py` (byte-identical copy of `ros2_reusable_stack/scripts/ibkr/ibkr_spread.py`) |
| flag | `IBKR_PLAN_DAILY_ENABLED: bool = False` (`config.py`, next to the `IBKR_MCP_*` block) |
| endpoints | `src/app/api/v1/ibkr_plan.py` (router mounted in `main.py`) |
| scheduler registration | `main.py` lifespan via `ibkr_plan.maybe_start_plan_loop()` — `None` unless the flag is on |
| tests | `tests/test_ibkr_plan.py` (71 tests; no network, no real DB) |

**Runner semantics (port of `daily_invest.py`, byte-for-byte where it is a
money path):** state from the `device_snapshot_cache` row
`ibkr_plan_state` (absent ⇒ clear error note, **state is never invented**);
Yahoo gates per sleeve (same URL/params/headers/timeout as
`investments._yahoo_series`, fail-soft per sleeve → `{"error": ...}` → the
dev stale path: old gate kept, verdict `N/A`, `_meta.gate_stale` joined);
FULL verdict logic (+0.5/−0.5/−4.0 thresholds, `range_pos` over 30d, BUY iff
increasing|sideways, 30d-low warning in `rows[].reason`, and the analyst
`gate.note` — the "stabilization gate" note — preserved across refreshes with
the exact dev key set `{trend,last7d_pct,range_pos,note}`); MCP reads through
the in-process Phase-1 path (`open_session` + `call_tool`:
`get_account_orders` / `get_order_instructions` / `get_account_positions`);
dedupe against pending instructions via `pending_instruction_keys`; **fills
reconcile FIRST** (every conid sleeve, even with an empty plan — the
`test_position_reconcile.py` contract, instruction never created when a fill
covers the sleeve); one `get_price_snapshot` per candidate for
`limit_from` (50/50 spread, capped AT the ask, qty floored on the LIMIT);
`create_order_instruction` args identical to daily
(`contract_id_ex` str, `side`, `quantity`, `order_type: LIMIT`,
`limit_price` round-4dp, `time_in_force: DAY`) with `flow_type` defaulted to
`REVIEW_AND_APPROVE` by the call layer exactly like §10.3 does for the dev
caller — `assert_allowed_tool` runs before any create call and `call_tool`
re-asserts (NEVER submit/cancel/modify); state saved only when not dry-run
(`gate_checked`/`last_order_push`/`last_fill_push` = Europe/Zurich
`%Y-%m-%d %H:%M`, `invested_chf` recomputed from the sleeves, `gate_stale`
joined); **after every successful save the state doc is mirrored into the
dashboard's `ibkr_investments` feed row** (`mirror_state_to_feed`) with the
GET-merge-POST semantics of the dev `state_push`: only `state` + `ts` (UTC
`%Y-%m-%dT%H:%M:%SZ`) are overlaid, every other key (cash/positions/orders/
instructions/mcp/auth/source) and the `source` column stay untouched so the
Phase-1 poller and this writer remain convergent — reuse of
`ibkr_mcp._load_snapshot`/`ibkr_mcp.DATASET`; the mirror is fail-soft (on
failure: one `state mirror failed` note + a WARN log, the run still
succeeds) and NEVER runs in dry-run. This keeps the Investments tab's
sleeves/gates live once the dev-PC pusher is retired; WhatsApp only when
requested and never in dry-run.

**Scheduler (`plan_loop`):** Europe/Zurich, Mon–Fri, first attempt 09:05,
deadline 16:30 (a late wake inside the window still runs), 60 s tick.
Same-day dedupe = a `device_snapshot_cache` row `ibkr_plan_marker` with
payload `{"date": "YYYY-MM-DD", "ok": bool, "ran_at": ..., "error"?: ...}` —
a row, not a tiny table: same upsert mechanism as the state row, no
migration, the unique `dataset` column guarantees one marker. One WhatsApp
per successful run (daily's exact wording composed into one message).
Failures (crash, missing state, MCP read failure) log and **stop for the
day** — the marker is written after every attempt, so no retry loop.
A successful scheduler run needs `IBKR_MCP_ENABLED` too (MCP reads); with
the feed off the attempt fails soft once and stops for the day.

**Endpoints** (admin = `Authorization: Bearer <NEEDLE_TOKEN or
API_SECRET_KEY>` or `X-Needle-Token: <same>`):

| Method | Path | Gates | Notes |
|---|---|---|---|
| POST | `/api/v1/ibkr/plan/state/import` | admin (NOT feed-gated — seed while flags are off) | body = the full dev state JSON, stored EXACTLY |
| GET | `/api/v1/ibkr/plan/state` | admin | verification read, fail-soft 200 |
| POST | `/api/v1/ibkr/plan/dry-run` | admin + feed (503 when `IBKR_MCP_ENABLED` off) | ALWAYS dry: never creates, never saves, never sends |
| GET | `/api/v1/ibkr/plan/status` | admin (never 503) | loop observability: flag + registered-loop timestamp + last marker — pre-flight proof that the scheduler is actually live in the running process |

`POST /api/v1/ibkr/plan/state/import` — request is the raw
`investments_state.json` document (NOT wrapped):

```json
{"_meta": {"capital": 10000, "invested_chf": 5427.77, "gate_checked": "2026-11-14 21:39"},
 "SWDA": {"status": "wait", "invested_chf": 0, "buy": null,
          "gate": {"trend": "increasing", "last7d_pct": 1.37, "range_pos": 30,
                   "note": "stabilization gate: 3 closes w/o new 7d low, > 5d avg"}},
 "...": "8 sleeve keys + _meta, structure preserved verbatim"}
```

* `200 {"ok": true, "dataset": "ibkr_plan_state", "updated_at": "<ISO-8601
  UTC>", "keys": ["_meta", "..."], "sleeve_count": 8}` — upsert (repeat
  imports never create a second row).
* `422 {"detail": "empty state — ..."}` for `{}`; `401` without the admin
  token.

`GET /api/v1/ibkr/plan/state` — `200 {"found": true, "state": {<the exact
stored document>}, "updated_at": "<ISO-8601 UTC>", "source":
"backend-ibkr-plan"}`; absent/empty row → `200 {"found": false, "state":
null, "updated_at": null, "source": null}` (fail-soft, never 404).

`POST /api/v1/ibkr/plan/dry-run` — no body. `200` with the exact
`run_daily_plan(dry_run=True, send_whatsapp=False)` result:

```json
{"date": "2026-11-17",
 "rows": [{"key": "SWDA", "status": "wait", "trend": "sideways", "7d": 0.0,
           "30d": 50, "verdict": "BUY", "price": 145.3, "action": "buy",
           "reason": "gate BUY"}, "... 8 rows, PORTFOLIO order"],
 "entries": [{"key": "SWDA", "ticker": "SWDA.SW", "status": "wait",
              "verdict": "BUY", "trend": "sideways", "price": 145.3,
              "target_chf": 2857.0, "invested_chf": 0.0,
              "remaining_chf": 2857.0}],
 "state_after": {"...": "the full state a real run WOULD persist (in memory only)"},
 "notes": ["[plan] 1 sleeve(s) to order: ...", "...  * lines from daily ..."],
 "instructions": [{"index": 0, "status": "dry_run",
                   "detail": "would create: BUY 19.67 @ 145.3 CHF (...)"}],
 "whatsapp": false}
```

* `rows` mirror the dev `daily_invest --check` table columns exactly
  (missing values render `"-"` like the printed table) plus
  `action` ∈ `buy|wait|skip|error` and `reason` (carries the `AT 30d LOW`
  warning); `instructions[].status` ∈ `created|skipped|dry_run|error`
  (`created` carries `instruction_id`); `state_after` is `null` with a
  `plan state missing: ...` note when the row was never imported.
* `503 {"detail": "IBKR MCP feed not enabled (set IBKR_MCP_ENABLED=true)"}`
  when the feed is off; `401` without the admin token.
* The response is the parity instrument to diff against the dev-PC
  `daily_invest --check` output — it contains no token material (MCP layer)
  and no secrets.

**Cutover steps (Phase 2a → live):**

1. Deploy with `IBKR_PLAN_DAILY_ENABLED=false` (default) — zero change.
2. `POST /api/v1/ibkr/plan/state/import` with the current dev
   `investments_state.json`; verify with `GET /api/v1/ibkr/plan/state`.
3. `POST /api/v1/ibkr/plan/dry-run` (feed on) and diff `rows` against
   `daily_invest --check` on the dev PC (same state copy).
4. Stop the dev-PC emitters (needle3 09:05 emitter, `ibkr-watch.timer` —
   per docs/IBKR_PLANNER_CLOUD_PORT_PLAN.md cutover list).
5. Flip `IBKR_PLAN_DAILY_ENABLED=true` + restart → the 09:05 Europe/Zurich
   run originates in the cloud; one WhatsApp per day; instructions land in
   the IBKR review queue; the `ibkr_plan_marker` row proves one run/day.
6. Verify: marker payload `ok:true`, `GET /plan/state` shows fresh
   `gate_checked`, the review queue shows the staged instructions.

§6 hard rules hold unchanged: default off, admin-gated, instruction tools
only, no token values logged or returned, no network in tests.
