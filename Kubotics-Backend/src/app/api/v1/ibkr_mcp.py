"""IBKR MCP auth, feed & control endpoints (docs/IBKR_MCP_BACKEND.md).

Online re-auth from ANY browser — Vincent 2026-11-14 ("if Auth is needed once
more it needs to be done online so I can do this when on the way"):

  POST /api/v1/ibkr/auth/start     (admin) -> {authorize_url} he opens on his phone
  GET  /api/v1/ibkr/auth/callback  (PUBLIC, https://api.kubotics.ch forwards all
                                    paths) -> validates state, exchanges the code,
                                    persists tokens, small "Connected" HTML page
  GET  /api/v1/ibkr/auth/status    -> configured/redirect_configured/authorized/
                                      fresh/last_refresh_at/redirect_uri
  POST /api/v1/ibkr/mcp/refresh    (admin) -> force refresh, status only
  POST /api/v1/ibkr/auth/register  (admin) -> RFC 7591 DCR, OFF by default

Phase C — cloud-owned MCP flow (§10): the backend holds the ENTIRE MCP flow
(reads + staged review instructions):

  POST   /api/v1/ibkr/instructions              (admin) -> batch staged
                                                  REVIEW_AND_APPROVE
                                                  instructions, <=20/call
  GET    /api/v1/ibkr/instructions              (admin) -> pending list
  DELETE /api/v1/ibkr/instructions/{instruction_id} (admin) -> delete staged
                                                  instruction (404 when MCP
                                                  reports not found)
  POST   /api/v1/ibkr/mcp/call                  (admin) -> generic READ proxy
                                                  (allowlist only) for the
                                                  dev-PC callers

Two gates replace the old combined check (feed without callback is a valid
deployment now, e.g. tokens imported by script — §10):

  * feed gate  = IBKR_MCP_ENABLED alone  -> poller, /mcp/refresh, the
    read/instruction endpoints below (503 "feed not enabled" when off),
  * auth gate  = IBKR_MCP_ENABLED AND IBKR_MCP_REDIRECT_URI -> /auth/start,
    /auth/callback, /auth/register (503 "not configured" when not ready —
    exact HTML/JSON shapes unchanged).

Default-off (IBKR_MCP_ENABLED=false) keeps everything inert (stability rule).
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.services import ibkr_mcp

router = APIRouter(prefix="/ibkr", tags=["ibkr-mcp"])
logger = logging.getLogger(__name__)

# Small closeable-tab pages — never contain token values.
_PAGE_OK = (
    "<!doctype html><html><body style='font-family:sans-serif'>"
    "<h3>Connected.</h3><p>You can close this tab and return to Kubotics.</p>"
    "</body></html>"
)


def _page(title: str, detail: str = "") -> str:
    detail_html = f"<p>{detail}</p>" if detail else ""
    return (
        "<!doctype html><html><body style='font-family:sans-serif'>"
        f"<h3>{title}</h3>{detail_html}</body></html>"
    )


def _require_admin_token(
    authorization: str | None = Header(None),
    x_needle_token: str | None = Header(None, alias="X-Needle-Token"),
) -> None:
    """Admin gate — same pattern as whatsapp._require_send_token (Bearer or
    X-Needle-Token against NEEDLE_TOKEN / API_SECRET_KEY)."""
    expected = settings.NEEDLE_TOKEN or settings.API_SECRET_KEY
    if not expected:
        return
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
    elif x_needle_token:
        token = x_needle_token.strip()
    if token != expected:
        raise HTTPException(
            status_code=401,
            detail="Valid Bearer token or X-Needle-Token required",
        )


def _require_feed() -> None:
    """503 unless the feed flag is on (IBKR_MCP_ENABLED alone — no redirect
    URI needed for the feed, Phase C §10)."""
    if not ibkr_mcp.feed_enabled():
        raise HTTPException(
            status_code=503,
            detail="IBKR MCP feed not enabled (set IBKR_MCP_ENABLED=true)",
        )


def _require_auth_ready() -> None:
    """503 unless the feature flag is on AND a redirect URI is configured
    (exact JSON shape kept — online re-auth endpoints only)."""
    if not ibkr_mcp.auth_ready():
        raise HTTPException(
            status_code=503,
            detail="IBKR MCP not configured (set IBKR_MCP_ENABLED=true and IBKR_MCP_REDIRECT_URI)",
        )


@router.get("/auth/status")
async def auth_status(db: Annotated[AsyncSession, Depends(get_db)]) -> dict:
    """Public status (no secrets): configured / authorized / last refresh."""
    return await ibkr_mcp.auth_status(db)


@router.post("/auth/start", dependencies=[Depends(_require_admin_token)])
async def auth_start(db: Annotated[AsyncSession, Depends(get_db)]) -> dict:
    """Create a fresh PKCE verifier+state (server-side, TTL ~10 min, single
    use) and return the authorize URL Vincent opens on his phone."""
    _require_auth_ready()
    _state, authorize_url = await ibkr_mcp.create_auth_state(db)
    return {"authorize_url": authorize_url, "expires_in_s": ibkr_mcp.STATE_TTL_S}


@router.get("/auth/callback", response_class=HTMLResponse)
async def auth_callback(
    db: Annotated[AsyncSession, Depends(get_db)],
    code: str | None = None,
    state: str | None = None,
) -> HTMLResponse:
    """PUBLIC: the phone browser lands here after IBKR consent. Validates state
    (unknown/expired/used -> 400), exchanges the code (form-encoded), persists
    tokens atomically, returns a small 'Connected' page. No token ever appears
    in the page or the logs."""
    if not ibkr_mcp.auth_ready():
        return HTMLResponse(
            _page("IBKR MCP is not configured.", "Set IBKR_MCP_ENABLED and IBKR_MCP_REDIRECT_URI."),
            status_code=503,
        )
    if not code or not state:
        return HTMLResponse(
            _page("Missing code or state.", "Close this tab and run /api/v1/ibkr/auth/start again."),
            status_code=400,
        )
    verifier = await ibkr_mcp.consume_auth_state(db, state)
    if verifier is None:
        return HTMLResponse(
            _page(
                "Unknown, expired or already used state.",
                "Close this tab and run /api/v1/ibkr/auth/start again.",
            ),
            status_code=400,
        )
    saved = await ibkr_mcp.exchange_code(db, code, verifier)
    if saved is None:
        return HTMLResponse(
            _page(
                "Token exchange failed.",
                "Codes are short-lived: run /api/v1/ibkr/auth/start again and be quick.",
            ),
            status_code=502,
        )
    return HTMLResponse(_PAGE_OK)


@router.post("/mcp/refresh", dependencies=[Depends(_require_admin_token)])
async def mcp_refresh(db: Annotated[AsyncSession, Depends(get_db)]) -> dict:
    """Force one refresh-token rotation (the 401 recovery path). Returns
    status only — never any token value. Feed-gated: no redirect URI needed
    (Phase C §10)."""
    _require_feed()
    try:
        tokens = await ibkr_mcp.refresh(force=True, db=db)
    except SystemExit as exc:
        # refresh() contract: message carries the HTTP status only.
        raise HTTPException(status_code=502, detail=str(exc)) from None
    last = tokens.get("last_refresh_at")
    return {"ok": True, "last_refresh_at": last.isoformat() if last else None}


@router.post("/auth/register", dependencies=[Depends(_require_admin_token)])
async def auth_register() -> dict:
    """RFC 7591-style dynamic client registration — DISABLED by default.

    The proven flow reuses public client ba3ab3ee (re-running DCR orphans
    clients); enable IBKR_MCP_DCR_ENABLED only after IBKR confirms the
    registration URL. See docs/IBKR_MCP_BACKEND.md §Dynamic client registration.
    """
    if not settings.IBKR_MCP_DCR_ENABLED:
        raise HTTPException(
            status_code=503,
            detail=(
                "Dynamic client registration disabled (default): reuse client "
                "ba3ab3ee-3468-442b-8183-113e7d777dae — see docs/IBKR_MCP_BACKEND.md"
            ),
        )
    _require_auth_ready()
    status_code, body = await ibkr_mcp.dynamic_client_registration()
    if status_code not in (200, 201) or not body.get("client_id"):
        raise HTTPException(status_code=502, detail=f"registration failed: HTTP {status_code}")
    return {
        "ok": True,
        "client_id": body.get("client_id"),
        "note": (
            "Register IBKR_MCP_REDIRECT_URI for this client (or keep using "
            "ba3ab3ee-3468-442b-8183-113e7d777dae) before starting re-auth."
        ),
    }


# ---------------------------------------------------------------------------
# Phase C (docs/IBKR_MCP_BACKEND.md §10) — cloud-owned MCP flow:
# reads AND staged review instructions live entirely in the backend.
# ---------------------------------------------------------------------------
MAX_INSTRUCTIONS_PER_CALL = 20


class InstructionEntry(BaseModel):
    """One staged order instruction — REVIEW_AND_APPROVE only, never AUTONOMOUS."""

    side: Literal["BUY", "SELL"]
    quantity: float = Field(gt=0, description="quantity > 0")
    conid: int | None = Field(default=None, gt=0, description="contract id > 0")
    symbol: str | None = Field(default=None, description="or a non-empty ticker")
    limit_price: float | None = Field(default=None, gt=0)
    tif: str = Field(default="DAY", min_length=1)
    exchange: str | None = None
    currency: str | None = None
    flow_type: str | None = None

    @model_validator(mode="after")
    def _require_target_and_review_flow(self) -> InstructionEntry:
        if self.conid is None and not (self.symbol or "").strip():
            raise ValueError("conid (int>0) or a non-empty symbol is required")
        if self.symbol is not None and not self.symbol.strip():
            raise ValueError("symbol must be non-empty when given")
        if self.flow_type is not None and self.flow_type != ibkr_mcp.REVIEW_AND_APPROVE:
            # money rule: AUTONOMOUS (or anything else) must never pass — 422.
            raise ValueError(
                f"flow_type must be {ibkr_mcp.REVIEW_AND_APPROVE} (never AUTONOMOUS)"
            )
        return self


class InstructionBatch(BaseModel):
    """POST /instructions body: <=20 entries per call (422 beyond)."""

    instructions: list[InstructionEntry] = Field(min_length=1,
                                                 max_length=MAX_INSTRUCTIONS_PER_CALL)
    dedupe: bool = True
    source: str | None = Field(default=None, max_length=200)


class McpCallBody(BaseModel):
    """POST /mcp/call body: {"name": str, "args": dict?}."""

    name: str = Field(min_length=1, max_length=120)
    args: dict[str, Any] = Field(default_factory=dict)


def _create_instruction_args(entry: InstructionEntry) -> dict:
    """MCP create_order_instruction args (shape proven by daily_invest.py:
    contract_id_ex as string, time_in_force, LIMIT only when priced).
    flow_type is ALWAYS forced to REVIEW_AND_APPROVE here."""
    args: dict[str, Any] = {
        "side": entry.side,
        "quantity": entry.quantity,
        "time_in_force": entry.tif,
        "flow_type": ibkr_mcp.REVIEW_AND_APPROVE,
    }
    if entry.conid is not None:
        args["contract_id_ex"] = str(entry.conid)
    if entry.symbol is not None:
        args["symbol"] = entry.symbol.strip()
    if entry.limit_price is not None:
        args["order_type"] = "LIMIT"
        args["limit_price"] = entry.limit_price
    if entry.exchange:
        args["exchange"] = entry.exchange
    if entry.currency:
        args["currency"] = entry.currency
    return args


async def _open_mcp_session():
    """refresh() + initialize() — the MCP call layer. Any failure (SystemExit
    refresh contract or init error) maps to 502; messages carry HTTP statuses
    and exception types only, never token material."""
    try:
        return await ibkr_mcp.open_session()
    except SystemExit as exc:  # refresh() contract — status only
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001 — init/network layer
        raise HTTPException(
            status_code=502, detail=f"MCP session failed: {type(exc).__name__}: {exc}"[:200]
        ) from None


async def _read_pending_keys(tok: str, sid: str | None) -> set[tuple[str, str]]:
    """Pending (conid/side) keys for dedupe — a failed read aborts the batch
    with 502 rather than risking duplicate instructions."""
    try:
        raw = await ibkr_mcp.call_tool("get_order_instructions", {}, tok, sid)
    except SystemExit as exc:  # refresh contract mid-batch
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"MCP dedupe read failed: {type(exc).__name__}: {exc}"[:200],
        ) from None
    return ibkr_mcp.pending_instruction_keys(raw if isinstance(raw, dict) else {})


@router.post("/instructions", dependencies=[Depends(_require_admin_token)])
async def create_instructions(body: InstructionBatch) -> dict:
    """Stage REVIEW_AND_APPROVE order instructions (admin, Phase C §10).

    Batch <= 20 (422 beyond), dedupe against the pending review queue by
    (conid, side) — daily_invest skip semantics: statuses outside the
    terminal set count as pending. Response: {"results": [{index,
    status: created|skipped_duplicate|error, instruction_id?, detail?}]}.
    503 feed off, 502 when the MCP call layer (refresh/init) fails.
    NEVER calls submit/cancel/modify — the gate below asserts before any
    network call, and call_tool re-asserts per call.
    """
    _require_feed()
    ibkr_mcp.assert_allowed_tool(
        "create_order_instruction", ibkr_mcp.REVIEW_AND_APPROVE
    )  # assert-before-network invariant (impossible to fail here)
    tok, sid = await _open_mcp_session()

    pending: set[tuple[str, str]] = set()
    if body.dedupe:
        pending = await _read_pending_keys(tok, sid)

    results: list[dict] = []
    created = skipped = errors = 0
    for index, entry in enumerate(body.instructions):
        key = ibkr_mcp.entry_instruction_key(entry.conid, entry.symbol, entry.side)
        if key in pending:
            results.append({
                "index": index,
                "status": "skipped_duplicate",
                "detail": "non-terminal pending instruction already exists (conid, side)",
            })
            skipped += 1
            continue
        try:
            res = await ibkr_mcp.call_tool(
                "create_order_instruction", _create_instruction_args(entry), tok, sid
            )
        except SystemExit as exc:  # refresh contract mid-batch: status only
            results.append({"index": index, "status": "error", "detail": str(exc)[:200]})
            errors += 1
            continue
        except Exception as exc:  # noqa: BLE001 — per-entry tool failure
            results.append({
                "index": index,
                "status": "error",
                "detail": f"{type(exc).__name__}: {exc}"[:200],
            })
            errors += 1
            continue
        iid = ibkr_mcp.instruction_id_of(res)
        entry_out: dict = {"index": index, "status": "created"}
        if iid is not None:
            entry_out["instruction_id"] = iid
        results.append(entry_out)
        pending.add(key)
        created += 1
    logger.info(
        "[ibkr-mcp] instructions batch source=%s created=%d skipped=%d errors=%d",
        body.source or "-", created, skipped, errors,
    )
    return {"results": results}


@router.get("/instructions", dependencies=[Depends(_require_admin_token)])
async def list_instructions() -> dict:
    """Pending (non-terminal) review instructions — the same read the feed
    embeds as instructions_pending. 503 feed off, 502 MCP failure."""
    _require_feed()
    tok, sid = await _open_mcp_session()
    try:
        raw = await ibkr_mcp.call_tool("get_order_instructions", {}, tok, sid)
    except SystemExit as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"MCP read failed: {type(exc).__name__}: {exc}"[:200]
        ) from None
    return {"instructions": ibkr_mcp.pending_instructions(raw)}


@router.delete("/instructions/{instruction_id}", dependencies=[Depends(_require_admin_token)])
async def delete_instruction(instruction_id: str) -> dict:
    """Delete a staged instruction via delete_order_instruction
    (REVIEW_AND_APPROVE, admin). 404-shaped detail when MCP reports not
    found, 502 when the MCP call layer fails, 503 when the feed is off.
    The gate asserts before any network call — never submit/cancel."""
    _require_feed()
    ibkr_mcp.assert_allowed_tool(
        "delete_order_instruction", ibkr_mcp.REVIEW_AND_APPROVE
    )  # assert-before-network invariant
    tok, sid = await _open_mcp_session()
    try:
        res = await ibkr_mcp.call_tool(
            "delete_order_instruction",
            {"instruction_id": instruction_id,
             "flow_type": ibkr_mcp.REVIEW_AND_APPROVE},
            tok,
            sid,
        )
    except SystemExit as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        if ibkr_mcp.looks_not_found(str(exc)):
            raise HTTPException(
                status_code=404, detail=f"instruction not found: {instruction_id}"
            ) from None
        raise HTTPException(
            status_code=502, detail=f"MCP delete failed: {type(exc).__name__}: {exc}"[:200]
        ) from None
    if ibkr_mcp.result_not_found(res):
        raise HTTPException(
            status_code=404, detail=f"instruction not found: {instruction_id}"
        )
    return {"ok": True, "instruction_id": instruction_id}


@router.post("/mcp/call", dependencies=[Depends(_require_admin_token)])
async def mcp_call(body: McpCallBody) -> dict:
    """Generic MCP proxy for the dev-PC callers (admin, Phase C §10).

    Allowlist ONLY — assert_allowed_tool resolution runs BEFORE any network
    call: READ_ONLY_TOOLS (incl. get_price_snapshot) + INSTRUCTION_TOOLS pass;
    submit_order/cancel_order/modify_order/place_*/preview_order/
    answer_order_question/get_order_rules/get_order_status and unknown names
    are rejected 400 pre-network.

    Money rules hold on this path (it is the future route for
    create_order_instruction): for the instruction write tools a missing
    flow_type is defaulted to REVIEW_AND_APPROVE and any other explicit flow
    (AUTONOMOUS) is rejected 422 — this proxy can never become a submit
    bypass. Returns {"name": <tool>, "result": <parsed JSON>}.
    503 feed off, 502 MCP-layer failure.
    """
    _require_feed()
    name = body.name.strip()
    args: dict[str, Any] = dict(body.args or {})
    if name in ibkr_mcp.INSTRUCTION_WRITE_TOOLS:
        flow = args.get("flow_type")
        if flow is None:
            args["flow_type"] = ibkr_mcp.REVIEW_AND_APPROVE
        elif flow != ibkr_mcp.REVIEW_AND_APPROVE:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"flow_type must be {ibkr_mcp.REVIEW_AND_APPROVE} (never AUTONOMOUS)"
                ),
            )
    try:
        ibkr_mcp.assert_allowed_tool(name, args.get("flow_type"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    tok, sid = await _open_mcp_session()
    try:
        res = await ibkr_mcp.call_tool(name, args, tok, sid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except SystemExit as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"MCP call failed: {type(exc).__name__}: {exc}"[:200]
        ) from None
    return {"name": name, "result": res}
