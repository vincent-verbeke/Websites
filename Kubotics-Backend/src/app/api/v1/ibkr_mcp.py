"""IBKR MCP auth & control endpoints (docs/IBKR_MCP_BACKEND.md).

Online re-auth from ANY browser — Vincent 2026-11-14 ("if Auth is needed once
more it needs to be done online so I can do this when on the way"):

  POST /api/v1/ibkr/auth/start     (admin) -> {authorize_url} he opens on his phone
  GET  /api/v1/ibkr/auth/callback  (PUBLIC, https://api.kubotics.ch forwards all
                                    paths) -> validates state, exchanges the code,
                                    persists tokens, small "Connected" HTML page
  GET  /api/v1/ibkr/auth/status    -> configured/authorized/last_refresh_at/redirect_uri
  POST /api/v1/ibkr/mcp/refresh    (admin) -> force refresh, status only
  POST /api/v1/ibkr/auth/register  (admin) -> RFC 7591 DCR, OFF by default

Every endpoint is inert unless IBKR_MCP_ENABLED=true AND IBKR_MCP_REDIRECT_URI
is set: then start/refresh/callback answer 503 "not configured" and no poller
runs — today's stable behavior stays untouched (stability is critical).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.services import ibkr_mcp

router = APIRouter(prefix="/ibkr", tags=["ibkr-mcp"])

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


def _require_configured() -> None:
    """503 unless the feature flag is on AND a redirect URI is configured."""
    if not ibkr_mcp.is_configured():
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
    _require_configured()
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
    if not ibkr_mcp.is_configured():
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
    status only — never any token value."""
    _require_configured()
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
    _require_configured()
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
