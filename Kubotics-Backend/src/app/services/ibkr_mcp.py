"""IBKR MCP backend connector — read-only account feed + online re-auth.

Ported 1:1 from the proven reference code (Vincent 2026-11-14 requirement:
"this MCP should run in the Kubotics Backend and if Auth is needed once more it
needs to be done online ... it is critical that this now works stable"):

  * ``refresh()`` semantics from ``~/.local/bin/ibkr_mcp.py`` — serialized
    refresher, re-read AFTER the lock, freshness margin FRESH_MARGIN_S=45,
    force bypass on 401, ``SystemExit(f"refresh failed: {status}")`` on failure.
    IBKR refresh tokens are single-use (rotation); the whole token family was
    revoked on 2026-11-13 when three processes raced. This module is the ONLY
    refresher in the backend (one asyncio task, one process — see docs).
  * OAuth auth-code + PKCE (S256) flow from ``ibkr_mcp_reauth.py`` /
    ``ibkr_mcp_login.py`` — same authorize query (incl. ``resource=EP``),
    same form-encoded code exchange.
  * ``burst()`` / ``merged()`` semantics from
    ``ros2_reusable_stack/scripts/ibkr/ibkr_mcp_feed.py`` — burst at most every
    BURST_EVERY_S, cache the result, merge into the payload, never raise.

Stability constraints (docs/IBKR_MCP_BACKEND.md — hard rules):
  * READ-ONLY tools only: an explicit allowlist; any order-creating or write
    tool name is rejected before any network call (C3: never orders, never
    writes). The tools/call path CANNOT be pointed at a non-allowlisted tool.
  * Single serialized refresher + freshness reuse (no refresh-token races).
  * Token values are NEVER logged and NEVER returned by any endpoint.
  * ``merged()`` NEVER raises: on refresh/burst failure it falls back to the
    last good burst, else to the previous payload untouched.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import secrets
import time
import urllib.parse
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.ibkr import TOKEN_ROW_ID, IbkrMcpAuthState, IbkrMcpToken
from app.models.tasks import DeviceSnapshotCache

logger = logging.getLogger(__name__)

# --- proven constants (ibkr_mcp.py / ibkr_mcp_reauth.py / ibkr_mcp_feed.py) ---
EP = "https://api.ibkr.com/v1/api/mcp-public"
ISSUER = "https://api.ibkr.com"
TOKEN_URL = f"{ISSUER}/oauth2/api/v1/token"
AUTHORIZE_URL = f"{ISSUER}/oauth2/authorize"
PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "kubotics-backend-ibkr", "version": "1.0"}

FRESH_MARGIN_S = 45  # reuse an access token with more than this left (2026-11-13 fix)
BURST_EVERY_S = 60  # one read-only burst per minute (dev-PC feed parity)
BURST_CACHE_MAX_AGE_S = 900  # fall back to the last good burst for up to 15 min
STATE_TTL_S = 600  # pending phone re-auth (PKCE state) TTL, ~10 min, single use
DATASET = "ibkr_investments"  # DeviceSnapshotCache row shared with the dev-PC pusher
SOURCE = "backend-ibkr-mcp"

# Hard allowlist: the ONLY tools this module may ever call (C3 read-only).
READ_ONLY_TOOLS = frozenset(
    {
        "get_account_summary",
        "get_account_balances",
        "get_account_positions",
        "get_account_orders",
        "get_order_instructions",
    }
)
# Defense in depth: reject order/write-looking names even before the allowlist.
_ORDER_TOOL_HINTS = (
    "place",
    "submit",
    "cancel",
    "replace",
    "delete",
    "create",
    "buy",
    "sell",
    "transfer",
    "close",
    "write",
)

_active_order_status = (
    "active",
    "submitted",
    "presubmitted",
    "pendingsubmit",
    "apipending",
    "new",
    "open",
)
# review-queue instructions in a terminal state are never "pending approval"
_terminal_instruction = (
    "filled",
    "cancelled",
    "canceled",
    "deleted",
    "rejected",
    "inactive",
)

# Process-local burst cache + refresher lock (see _refresh_lock below).
_last_burst: dict | None = None
_last_burst_ok_at: float = 0.0
_refresh_lock_obj: asyncio.Lock | None = None
_refresh_lock_loop: asyncio.AbstractEventLoop | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def is_configured() -> bool:
    """True only when the feature is explicitly enabled AND a public callback
    URI is set — anything else keeps today's inert behavior (stability rule)."""
    return bool(settings.IBKR_MCP_ENABLED and settings.IBKR_MCP_REDIRECT_URI)


def _refresh_lock() -> asyncio.Lock:
    """Per-event-loop refresh lock.

    One refresher at a time inside this process (the asyncio-lock + re-read
    recipe the brief prescribes); the ECS task runs a single process, so the
    backend as a whole has exactly one rotating refresher — the guarantee the
    dev-PC helper got from flock. Bound lazily so repeated event loops (tests)
    never share a stale lock object.
    """
    global _refresh_lock_obj, _refresh_lock_loop
    loop = asyncio.get_running_loop()
    if _refresh_lock_obj is None or _refresh_lock_loop is not loop:
        _refresh_lock_obj = asyncio.Lock()
        _refresh_lock_loop = loop
    return _refresh_lock_obj


# ---------------------------------------------------------------------------
# Token store (Postgres, singleton row; atomic single-commit writes; no logging)
# ---------------------------------------------------------------------------
def _row_to_dict(row: IbkrMcpToken) -> dict:
    return {
        "access_token": row.access_token,
        "refresh_token": row.refresh_token,
        "expires_at": row.expires_at,
        "scope": row.scope,
        "token_type": row.token_type,
        "last_refresh_at": row.last_refresh_at,
    }


async def _load_token_row(db) -> IbkrMcpToken | None:
    res = await db.execute(select(IbkrMcpToken).where(IbkrMcpToken.id == TOKEN_ROW_ID))
    return res.scalars().first()


async def load_tokens(db) -> dict | None:
    """Current token dict (values stay in-process — never logged, never exposed)."""
    row = await _load_token_row(db)
    return _row_to_dict(row) if row is not None else None


async def save_tokens(db, tok: dict) -> dict:
    """Atomically persist a token response (one row, one flush, one commit).

    Mirrors the helper's atomic file replace: readers see either the old or the
    new token, never a half-written state. Never logs any token value.
    """
    now = _now()
    expires_at = None
    expires_in = tok.get("expires_in")
    if expires_in is not None:
        try:
            expires_at = now + timedelta(seconds=float(expires_in))
        except (TypeError, ValueError):
            expires_at = None
    row = await _load_token_row(db)
    if row is None:
        row = IbkrMcpToken(
            id=TOKEN_ROW_ID,
            access_token=tok.get("access_token") or "",
            refresh_token=tok.get("refresh_token") or "",
            expires_at=expires_at,
            scope=tok.get("scope"),
            token_type=tok.get("token_type") or "Bearer",
            last_refresh_at=now,
        )
        db.add(row)
    else:
        if tok.get("access_token"):
            row.access_token = tok["access_token"]
        if tok.get("refresh_token"):
            row.refresh_token = tok["refresh_token"]
        if expires_at is not None:
            row.expires_at = expires_at
        if tok.get("scope"):
            row.scope = tok["scope"]
        if tok.get("token_type"):
            row.token_type = tok["token_type"]
        row.last_refresh_at = now
    await db.commit()
    return _row_to_dict(row)


def _remaining_s(tokens: dict) -> float:
    """Seconds until expiry (negative when expired/unknown)."""
    expires_at = tokens.get("expires_at")
    if not expires_at:
        return -1e9
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return (expires_at - _now()).total_seconds()


# ---------------------------------------------------------------------------
# HTTP primitives (httpx; tests monkeypatch these — no network in tests)
# ---------------------------------------------------------------------------
async def _post_form(url: str, data: dict, timeout: float = 45) -> tuple[int, dict]:
    """RFC 6749 form-encoded POST (IBKR returns 415 for JSON token requests —
    proven 2026-11-08). Returns (status, parsed JSON). NEVER logs ``data``."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url,
                data=data,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("[ibkr-mcp] endpoint unreachable (%s)", type(exc).__name__)
        return 0, {}
    try:
        return resp.status_code, resp.json() or {}
    except ValueError:
        return resp.status_code, {}


async def _post_mcp(payload: dict, tok: str, sid: str | None = None,
                    timeout: float = 45) -> tuple[int, dict, dict]:
    """POST a JSON-RPC payload to the MCP endpoint; returns (status, parsed, headers).

    Parses SSE (text/event-stream) and plain JSON bodies like the proven helper.
    """
    headers = {
        "Authorization": f"Bearer {tok}",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if sid:
        headers["Mcp-Session-Id"] = sid
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(EP, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("[ibkr-mcp] MCP endpoint unreachable (%s)", type(exc).__name__)
        return 0, {}, {}
    return resp.status_code, parse_body(resp.text, resp.headers.get("content-type")), dict(
        resp.headers
    )


def parse_body(body: str, content_type: str | None) -> dict:
    """SSE or JSON body -> last JSON object (port 1:1 from ibkr_mcp.py)."""
    if "text/event-stream" in (content_type or ""):
        out = []
        for line in (body or "").splitlines():
            if line.startswith("data:"):
                try:
                    out.append(json.loads(line[5:].strip()))
                except ValueError:
                    pass
        return out[-1] if out else {}
    try:
        return json.loads(body or "") or {}
    except ValueError:
        return {}


def _header(headers: dict, name: str) -> str | None:
    """Case-insensitive header lookup (Mcp-Session-Id casing differs per server)."""
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return None


# ---------------------------------------------------------------------------
# refresh() — the 2026-11-13 revocation fix, ported 1:1
# ---------------------------------------------------------------------------
async def refresh(force: bool = False, db=None) -> dict:
    """Valid access token, rotating the single-use refresh token only when needed.

    Contract (identical to ~/.local/bin/ibkr_mcp.py refresh()):
      * exactly one refresher at a time (asyncio lock; single-process ECS task
        = the cross-process guarantee flock gave on the dev PC),
      * the winner re-reads the token row AFTER acquiring the lock, so a waiter
        picks up the rotation the winner just saved instead of replaying a
        consumed refresh token (never race the rotation!),
      * a token with more than FRESH_MARGIN_S left is reused untouched,
      * force=True skips the freshness shortcut (caller saw a 401),
      * failure raises SystemExit("refresh failed: {status}") — callers must
        catch it (merged()/poll loop/endpoints do).
    """
    async with _refresh_lock():
        if db is not None:
            return await _refresh_locked(force, db)
        async with AsyncSessionLocal() as own_db:
            return await _refresh_locked(force, own_db)


async def _refresh_locked(force: bool, db) -> dict:
    tokens = await load_tokens(db)
    if not tokens or not tokens.get("refresh_token"):
        raise SystemExit("refresh failed: no refresh token stored (re-auth required)")
    if not force and tokens.get("access_token") and tokens.get("expires_at") \
            and _remaining_s(tokens) > FRESH_MARGIN_S:
        return tokens  # still valid: no rotation needed
    status, body = await _post_form(
        TOKEN_URL,
        {
            "grant_type": "refresh_token",
            "refresh_token": tokens.get("refresh_token") or "",
            "client_id": settings.IBKR_MCP_CLIENT_ID,
            "resource": EP,
        },
    )
    tok = body if isinstance(body, dict) else {}
    if status == 200 and tok.get("access_token"):
        if "refresh_token" not in tok:
            tok["refresh_token"] = tokens.get("refresh_token")
        return await save_tokens(db, tok)
    # Never include response bodies here — status only (no token leakage).
    logger.warning("[ibkr-mcp] token refresh rejected: HTTP %s", status)
    raise SystemExit(f"refresh failed: {status}")


# ---------------------------------------------------------------------------
# OAuth: PKCE + online (phone) re-auth flow — ported from ibkr_mcp_reauth.py
# ---------------------------------------------------------------------------
def generate_pkce() -> tuple[str, str]:
    """(verifier, challenge) — S256, 32 random bytes, unpadded base64url."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge.rstrip(b"=").decode()


def build_authorize_url(state: str, challenge: str) -> str:
    """Authorize URL identical to the proven helpers (incl. resource=EP)."""
    query = {
        "response_type": "code",
        "client_id": settings.IBKR_MCP_CLIENT_ID,
        "redirect_uri": settings.IBKR_MCP_REDIRECT_URI,
        "scope": settings.IBKR_MCP_SCOPE,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "resource": EP,
    }
    return f"{AUTHORIZE_URL}?" + urllib.parse.urlencode(query)


async def create_auth_state(db) -> tuple[str, str]:
    """Persist a fresh PKCE verifier+state (TTL STATE_TTL_S, single use).

    Returns (state, authorize_url) — Vincent opens the URL on his phone; the
    phone then redirects to GET /api/v1/ibkr/auth/callback on this backend.
    """
    verifier, challenge = generate_pkce()
    state = secrets.token_urlsafe(16)
    # opportunistic purge of expired pendings (keeps the table tiny)
    res = await db.execute(select(IbkrMcpAuthState))
    now = _now()
    for row in res.scalars().all():
        created = row.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        if created is None or (now - created).total_seconds() > STATE_TTL_S \
                or row.consumed_at is not None:
            await db.delete(row)
    # created_at set in Python (server_default would only materialize in SQL and
    # a fresh ORM instance would read None until refreshed — TTL must not depend
    # on that).
    db.add(IbkrMcpAuthState(state=state, verifier=verifier, created_at=_now()))
    await db.commit()
    return state, build_authorize_url(state, challenge)


async def consume_auth_state(db, state: str) -> str | None:
    """One-shot state validation: unknown / expired / already-used -> None.

    On first sight of a valid state it is burned (consumed_at) BEFORE the code
    exchange, so a replayed callback can never exchange twice.
    """
    if not state:
        return None
    res = await db.execute(select(IbkrMcpAuthState).where(IbkrMcpAuthState.state == state))
    row = res.scalars().first()
    if row is None or row.consumed_at is not None:
        return None
    created = row.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    if created is None or (_now() - created).total_seconds() > STATE_TTL_S:
        await db.delete(row)
        await db.commit()
        return None
    row.consumed_at = _now()
    await db.commit()
    return row.verifier


async def exchange_code(db, code: str, verifier: str) -> dict | None:
    """Auth-code -> tokens (form-encoded, resource=EP), persisted atomically.

    Returns the token dict on success, None on failure. Never logs values.
    """
    status, tok = await _post_form(
        TOKEN_URL,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.IBKR_MCP_REDIRECT_URI,
            "client_id": settings.IBKR_MCP_CLIENT_ID,
            "code_verifier": verifier,
            "resource": EP,
        },
    )
    if status == 200 and tok.get("access_token"):
        saved = await save_tokens(db, tok)
        logger.info("[ibkr-mcp] online re-auth OK (scope set, refresh_token=%s)",
                    "yes" if saved.get("refresh_token") else "no")
        return saved
    # Codes are short-lived; response bodies are never logged (may carry detail).
    logger.warning("[ibkr-mcp] code exchange rejected: HTTP %s", status)
    return None


async def auth_status(db) -> dict:
    """GET /ibkr/auth/status payload — status only, never token values."""
    configured = is_configured()
    tokens = await load_tokens(db) if configured else None
    fresh = bool(tokens and tokens.get("access_token") and _remaining_s(tokens) > FRESH_MARGIN_S)
    refreshable = bool(tokens and tokens.get("refresh_token"))
    last = tokens.get("last_refresh_at") if tokens else None
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    return {
        "configured": configured,
        "authorized": bool(tokens and tokens.get("access_token") and (fresh or refreshable)),
        "fresh": fresh,
        "last_refresh_at": last.isoformat() if last else None,
        "redirect_uri": settings.IBKR_MCP_REDIRECT_URI or None,
    }


async def dynamic_client_registration() -> tuple[int, dict]:
    """RFC 7591-style dynamic client registration — DISABLED by default.

    The proven helpers deliberately REUSE client ba3ab3ee (re-running DCR
    orphans clients and forces fuller consent), and no reference script shows
    IBKR's registration URL — hence IBKR_MCP_DCR_ENABLED=false default and an
    explicit IBKR_MCP_DCR_URL override. See docs/IBKR_MCP_BACKEND.md §DCR.
    Never returns/logs a client_secret value.
    """
    url = settings.IBKR_MCP_DCR_URL or f"{ISSUER}/oauth2/api/v1/clients"
    payload = {
        "client_name": "kubotics-backend",
        "redirect_uris": [settings.IBKR_MCP_REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": settings.IBKR_MCP_SCOPE,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        logger.warning("[ibkr-mcp] DCR unreachable (%s)", type(exc).__name__)
        return 0, {}
    try:
        body = resp.json() or {}
    except ValueError:
        body = {}
    if isinstance(body, dict):
        body.pop("client_secret", None)  # never propagate secrets outward
    return resp.status_code, body if isinstance(body, dict) else {}


# ---------------------------------------------------------------------------
# MCP session: initialize -> notifications/initialized -> tools/*
# ---------------------------------------------------------------------------
async def rpc(method: str, params: dict | None, tok: str, sid: str | None = None,
              rid: int = 1) -> tuple[int, dict, dict]:
    payload = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        payload["params"] = params
    return await _post_mcp(payload, tok, sid)


async def notify(method: str, params: dict | None, tok: str,
                 sid: str | None = None) -> tuple[int, dict]:
    payload = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        payload["params"] = params
    status, _, headers = await _post_mcp(payload, tok, sid)
    return status, headers


async def open_session() -> tuple[str, str | None]:
    """(access_token, Mcp-Session-Id) for a fresh MCP session.

    refresh() reuses a still-valid access token (serialized rotation), so a
    token revoked mid-life surfaces as HTTP 401: force exactly one rotation
    and retry once before giving up (port from ibkr_mcp_feed._open_session).
    """
    tok = (await refresh())["access_token"]
    st, _res, headers = await rpc(
        "initialize",
        {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": CLIENT_INFO},
        tok=tok,
    )
    if st == 401:
        tok = (await refresh(force=True))["access_token"]
        st, _res, headers = await rpc(
            "initialize",
            {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": CLIENT_INFO},
            tok=tok,
        )
    if st != 200:
        raise RuntimeError(f"mcp initialize HTTP {st}")
    sid = _header(headers, "Mcp-Session-Id")
    await notify("notifications/initialized", None, tok=tok, sid=sid)
    return tok, sid


def assert_read_tool(name: str) -> None:
    """C3 hard gate: only the explicit read allowlist may ever be called.

    Any order-creating / write tool name is rejected BEFORE any network call.
    """
    lowered = (name or "").strip().lower()
    if not lowered or any(hint in lowered for hint in _ORDER_TOOL_HINTS):
        raise ValueError(f"order/write tool rejected (read-only MCP): {name!r}")
    if name not in READ_ONLY_TOOLS:
        raise ValueError(f"tool not in read-only allowlist: {name!r}")


async def call_tool(name: str, args: dict | None, tok: str, sid: str | None) -> dict:
    """tools/call for an allowlisted read tool -> parsed JSON result."""
    assert_read_tool(name)
    _st, res, _ = await rpc("tools/call", {"name": name, "arguments": args or {}},
                            tok=tok, sid=sid, rid=7)
    out = (res.get("result") or res.get("error") or {})
    if out.get("isError"):
        raise RuntimeError(f"{name} isError")
    txt = " ".join((c.get("text") or "") for c in (out.get("content") or []))
    return json.loads(txt)


# ---------------------------------------------------------------------------
# Row mapping — ported 1:1 from ibkr_mcp_feed.py (contract §10 keys)
# ---------------------------------------------------------------------------
def _pick(row: dict, *names):
    for n in names:
        if row.get(n) is not None:
            return row.get(n)
    return None


def _map_position(r: dict) -> dict:
    """MCP position row -> gateway-compatible keys (contract §10) + extras."""
    out = {
        "symbol": _pick(r, "contract_description", "symbol", "ticker"),
        "conid": _pick(r, "contract_id", "conid"),
        "mktPrice": _pick(r, "market_price", "mktPrice"),
        "mktValue": _pick(r, "market_value", "mktValue"),
        "position": _pick(r, "position", "qty", "quantity"),
        "currency": r.get("currency"),
        "average_price": r.get("average_price"),
        "unrealized_pnl": r.get("unrealized_pnl"),
    }
    return {k: v for k, v in out.items() if v is not None}


def _map_instruction(r: dict) -> dict:
    """MCP order-instruction row -> compact pending-review entry."""
    out = {
        "id": _pick(r, "id", "instruction_id"),
        "status": r.get("status"),
        "ticker": _pick(r, "contract_description", "symbol", "ticker"),
        "action": _pick(r, "side", "action"),
        "quantity": _pick(r, "quantity", "size"),
        "price": _pick(r, "limit_price", "price"),
        "conid": _pick(r, "contract_id_ex", "contract_id", "conid"),
    }
    return {k: v for k, v in out.items() if v is not None}


def _map_pending_instructions(rows) -> list:
    """Only the instructions that still await review/approval."""
    return [
        _map_instruction(r)
        for r in rows
        if str(r.get("status") or "").lower() not in _terminal_instruction
    ]


def _map_order(r: dict) -> dict:
    status = str(r.get("status") or "")
    out = {
        "id": _pick(r, "order_id", "id"),
        "conid": _pick(r, "contract_id", "conid"),
        "ticker": _pick(r, "symbol", "ticker", "contract_description"),
        "action": _pick(r, "side", "action"),
        "quantity": _pick(r, "size", "quantity"),
        "price": _pick(r, "price", "limit_price"),
        "status": status or None,
        "order_type": _pick(r, "order_type", "type"),
    }
    return {k: v for k, v in out.items() if v is not None}


def _is_active_order(order: dict) -> bool:
    status = str(order.get("status") or "")
    return not status or any(a in status.lower() for a in _active_order_status)


# ---------------------------------------------------------------------------
# burst() / merged() — never-raising feed semantics
# ---------------------------------------------------------------------------
def _burst_due() -> bool:
    return (time.time() - _last_burst_ok_at) >= BURST_EVERY_S


def _cached_burst() -> dict | None:
    if _last_burst and (time.time() - _last_burst_ok_at) <= BURST_CACHE_MAX_AGE_S:
        return _last_burst
    return None


async def burst(force: bool = False) -> dict:
    """Fresh read-only MCP burst -> {ts, cash_chf, equity_chf, positions,
    orders_active, instructions_pending} (same keys/shape as the dev-PC feed).

    Raises on credential or network problems; ``merged()`` catches everything
    and falls back — burst() itself mirrors the proven feed (SystemExit from
    refresh() propagates to the caller by contract).
    """
    global _last_burst, _last_burst_ok_at
    if not force and not _burst_due():
        raise RuntimeError("burst not due")
    tok, sid = await open_session()

    sm = await call_tool("get_account_summary", None, tok=tok, sid=sid)
    cash = sm.get("total_cash_value")
    equity = sm.get("net_liquidation")
    if cash is None:  # fallback: balances CHF/BASE row
        try:
            bal = await call_tool("get_account_balances", None, tok=tok, sid=sid)
            rows = bal.get("balances") or []
            chf = next((r for r in rows if r.get("currency") in ("CHF", "BASE")), {})
            cash = chf.get("cash_balance")
            equity = equity or chf.get("net_liquidation_value")
        except Exception:  # noqa: BLE001, S110 — optional fallback, feed parity
            pass
    pos = await call_tool("get_account_positions", None, tok=tok, sid=sid)
    orders = await call_tool("get_account_orders", None, tok=tok, sid=sid)
    # review-queue depth: OPTIONAL read — a failure here must never take the
    # cash/positions/orders burst down (None = "unknown", callers keep data).
    instructions = None
    try:
        raw = await call_tool("get_order_instructions", None, tok=tok, sid=sid)
        instructions = _map_pending_instructions(raw.get("instructions") or [])
    except Exception as exc:  # noqa: BLE001 — optional field, burst stays up
        logger.info("[ibkr-mcp] order instructions read failed: %s", type(exc).__name__)

    out = {
        "ts": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cash_chf": cash,
        "equity_chf": equity,
        "positions": [_map_position(r) for r in (pos.get("positions") or [])][:12],
        "orders_active": [o for o in (_map_order(r) for r in (orders.get("orders") or []))
                          if _is_active_order(o)][:10],
        "instructions_pending": instructions,
    }
    _last_burst = out
    _last_burst_ok_at = time.time()
    logger.info("[ibkr-mcp] burst ok: positions=%d orders=%d",
                len(out["positions"]), len(out["orders_active"]))
    return out


def _merge_payload(existing: dict, src: dict) -> dict:
    out = dict(existing)
    for key in ("cash_chf", "equity_chf", "positions", "orders_active", "instructions_pending"):
        if src.get(key) is not None:
            out[key] = src[key]
    out["source"] = SOURCE
    out["mcp"] = {"ok": True, "ts": src.get("ts")}
    return out


async def _merged(existing_payload) -> tuple[dict, bool]:
    """(merged payload, backend_contributed) — NEVER raises, any failure falls
    back to the last good burst, else to the previous payload untouched."""
    existing = dict(existing_payload) if isinstance(existing_payload, dict) else {}
    src = None
    try:
        if _burst_due():
            src = await burst()
    except SystemExit as exc:
        # refresh() contract — message carries the HTTP status only, no tokens.
        logger.error("[ibkr-mcp] refresh failed: %s — keeping previous data", exc)
    except Exception as exc:  # noqa: BLE001 — transient network: log, no crash
        logger.warning("[ibkr-mcp] burst failed: %s: %s", type(exc).__name__, exc)
    if src is None:
        src = _cached_burst()
    if not src:
        return existing, False
    return _merge_payload(existing, src), True


async def merged(existing_payload) -> dict:
    """Merge fresh (or cached) backend MCP data into an existing payload.

    Never raises — on refresh/burst failure it falls back to the cache or the
    previous payload, which is returned unchanged.
    """
    payload, _ = await _merged(existing_payload)
    return payload


# ---------------------------------------------------------------------------
# Snapshot writer + scheduled poller (trading_watch-style loop)
# ---------------------------------------------------------------------------
async def _load_snapshot(db) -> DeviceSnapshotCache | None:
    res = await db.execute(
        select(DeviceSnapshotCache).where(DeviceSnapshotCache.dataset == DATASET)
    )
    return res.scalars().first()


async def run_once() -> dict:
    """One poll cycle: burst (if due), merge into the current snapshot row and
    persist with source='backend-ibkr-mcp'.

    Only writes when the backend actually contributed data — if the MCP side
    is down, the dev-PC pusher's row stays untouched (coexistence rule).
    """
    if not _burst_due():
        return {"skipped": "burst not due"}
    async with AsyncSessionLocal() as db:
        row = await _load_snapshot(db)
        existing = row.payload if row is not None and isinstance(row.payload, dict) else {}
        payload, contributed = await _merged(existing)
        if not contributed:
            return {"skipped": "no backend data"}
        now = _now()
        if row is None:
            db.add(DeviceSnapshotCache(
                dataset=DATASET, source=SOURCE, payload=payload, updated_at=now,
            ))
        else:
            row.source = SOURCE
            row.payload = payload
            row.updated_at = now
        await db.commit()
        logger.info("[ibkr-mcp] snapshot updated (source=%s)", SOURCE)
        return {"ok": True, "ts": payload.get("mcp", {}).get("ts")}


async def poll_loop(interval_s: int | None = None) -> None:
    """Background loop — same shape as trading_watch.watch_loop()."""
    interval = interval_s or settings.IBKR_MCP_POLL_INTERVAL_S
    await asyncio.sleep(5)  # let the app finish booting
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:  # noqa: PERF201
            raise
        except Exception:  # one bad cycle must never kill the loop
            logger.exception("[ibkr-mcp] poll cycle crashed")
        await asyncio.sleep(interval)


def maybe_start_poller() -> asyncio.Task | None:
    """main.py lifespan hook: the poller task when fully configured, else None.

    Disabled/unconfigured => None => NOTHING starts and NOTHING was ever
    contacted — today's stable behavior stays untouched (default-off rule).
    """
    if not is_configured():
        return None
    return asyncio.create_task(poll_loop())
