"""IBKR MCP connector models: OAuth token store + transient PKCE states.

Stability rules (docs/IBKR_MCP_BACKEND.md):
  * ``ibkr_mcp_tokens`` holds exactly ONE row (id='singleton') — access/refresh
    tokens for the official IBKR MCP connector. Values are never logged,
    never returned by any endpoint, never committed anywhere on purpose.
  * ``ibkr_mcp_auth_states`` holds server-side PKCE verifier+state rows for the
    online (phone) re-auth flow: single use, TTL enforced by the service.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, String, Text, func

from app.db.session import Base

TOKEN_ROW_ID = "singleton"


class IbkrMcpToken(Base):
    """Singleton IBKR MCP OAuth token row (rotating refresh-token safe)."""

    __tablename__ = "ibkr_mcp_tokens"

    id = Column(String(32), primary_key=True, default=TOKEN_ROW_ID)
    access_token = Column(Text, nullable=False)
    # Single-use (rotating) refresh token — 2026-11-13 family revocation means
    # exactly one serialized refresher may ever rotate this value.
    refresh_token = Column(Text, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    scope = Column(String(512), nullable=True)
    token_type = Column(String(32), default="Bearer", nullable=False)
    # Last token issuance (connect or refresh) — surfaced by GET /ibkr/auth/status.
    last_refresh_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class IbkrMcpAuthState(Base):
    """One pending online re-auth (PKCE verifier + OAuth state), single use."""

    __tablename__ = "ibkr_mcp_auth_states"

    state = Column(String(64), primary_key=True)
    verifier = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Set the moment the state is consumed by /auth/callback (single use).
    consumed_at = Column(DateTime(timezone=True), nullable=True)
