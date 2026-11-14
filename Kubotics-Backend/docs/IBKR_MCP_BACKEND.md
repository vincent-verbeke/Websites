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
  authorized, fresh, last_refresh_at, redirect_uri}`.

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
| `IBKR_MCP_ENABLED` | yes | `false` | Master switch. `false` ⇒ no poller, all mutating endpoints 503. |
| `IBKR_MCP_REDIRECT_URI` | yes | `""` (empty) | Public callback, e.g. `https://api.kubotics.ch/api/v1/ibkr/auth/callback`. Empty ⇒ treated as not configured (inert). **Must be registered at IBKR for the client id below.** |
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

* Started in the `main.py` lifespan **only** when `is_configured()`
  (`IBKR_MCP_ENABLED` **and** `IBKR_MCP_REDIRECT_URI` set) —
  `services/ibkr_mcp.py::maybe_start_poller()` returns `None` otherwise, so
  with defaults nothing registers and nothing polls.
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
2. **Read-only tools only.** `READ_ONLY_TOOLS` is an explicit allowlist
   (`get_account_summary`, `get_account_balances`, `get_account_positions`,
   `get_account_orders`, `get_order_instructions`). Any other name — in
   particular anything order-creating (`place_*`, `submit_*`, `cancel_*`,
   `create_*`, `delete_*`, `transfer_*`, `buy`/`sell`, …) — is rejected by
   `assert_read_tool()` **before any network call** (C3: no order path exists
   in this backend module).
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
| GET | `/api/v1/ibkr/auth/status` | public | always 200; `configured:false` when off |
| POST | `/api/v1/ibkr/auth/start` | admin | 503 when not configured |
| GET | `/api/v1/ibkr/auth/callback` | public | 503 off, 400 bad/expired/used state, 502 exchange failure, 200 HTML "Connected" |
| POST | `/api/v1/ibkr/mcp/refresh` | admin | 503 off, 502 refresh failure; status only |
| POST | `/api/v1/ibkr/auth/register` | admin | 503 always unless `IBKR_MCP_DCR_ENABLED=true` |

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
* no test makes a network call; no test touches a real database
