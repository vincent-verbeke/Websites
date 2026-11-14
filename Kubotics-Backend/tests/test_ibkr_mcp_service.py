"""Unit tests for the IBKR MCP backend service (pure logic — no network, no DB).

Covers the proven refresh() contract (port of the dev-PC
test_ibkr_mcp_refresh.py battery), PKCE/state validation, the read-only tool
allowlist (C3: never order tools), and the never-raising merged() contract.

Run:  uv run pytest tests/test_ibkr_mcp_service.py -q
Docs: docs/IBKR_MCP_BACKEND.md
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import time
import urllib.parse
from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import settings
from app.services import ibkr_mcp as ib

from .ibkr_helpers import FakeDb, run, seed_tokens


@pytest.fixture(autouse=True)
def _clean_burst_cache(monkeypatch):
    """Every test starts with an empty burst cache (burst due immediately)."""
    monkeypatch.setattr(ib, "_last_burst", None, raising=False)
    monkeypatch.setattr(ib, "_last_burst_ok_at", 0.0, raising=False)


# --------------------------------------------------------------------------- #
# refresh() — the 2026-11-13 family-revocation fix, ported contract-for-contract #
# --------------------------------------------------------------------------- #
def test_fresh_access_token_reused_no_rotation(monkeypatch):
    db = FakeDb()
    seed_tokens(db, access="AT1", refresh="RT1", expires_in=2000)
    calls: list[dict] = []

    async def fake_post(url, data, timeout=45):
        calls.append(dict(data))
        return 200, {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 299}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    tok = run(ib.refresh(db=db))
    assert tok["access_token"] == "AT1"
    assert calls == [], "fresh token must not trigger a rotation"


def test_stale_token_rotates_exactly_once_and_persists(monkeypatch):
    db = FakeDb()
    seed_tokens(db, access="AT1", refresh="RT1", expires_in=10)  # < FRESH_MARGIN_S
    calls: list[dict] = []

    async def fake_post(url, data, timeout=45):
        calls.append(dict(data))
        return 200, {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 299}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    tok = run(ib.refresh(db=db))
    assert len(calls) == 1
    assert tok["refresh_token"] == "RT2"
    assert db.token_row.refresh_token == "RT2", "rotation must be persisted for other readers"
    # refresh request shape matches the proven helper (form fields)
    assert calls[0]["grant_type"] == "refresh_token"
    assert calls[0]["refresh_token"] == "RT1"
    assert calls[0]["client_id"] == settings.IBKR_MCP_CLIENT_ID
    assert calls[0]["resource"] == ib.EP

    # immediately after rotation the fresh token is reused (no second POST)
    tok2 = run(ib.refresh(db=db))
    assert len(calls) == 1
    assert tok2["access_token"] == "AT2"


def test_force_bypasses_freshness_shortcut(monkeypatch):
    db = FakeDb()
    seed_tokens(db, access="AT1", refresh="RT1", expires_in=2000)
    calls: list[dict] = []

    async def fake_post(url, data, timeout=45):
        calls.append(dict(data))
        return 200, {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 299}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    run(ib.refresh(db=db))
    assert len(calls) == 0
    run(ib.refresh(force=True, db=db))
    assert len(calls) == 1, "force=True (401 path) must rotate even when fresh"


def test_failed_refresh_raises_systemexit_with_status(monkeypatch):
    db = FakeDb()
    seed_tokens(db, access="AT1", refresh="RT1", expires_in=-10)

    async def fail_post(url, data, timeout=45):
        return 400, {}

    monkeypatch.setattr(ib, "_post_form", fail_post)

    with pytest.raises(SystemExit) as excinfo:
        run(ib.refresh(force=True, db=db))
    assert "400" in str(excinfo.value)


def test_concurrent_refreshes_rotate_only_once(monkeypatch):
    """The core serialization guarantee: two callers with the SAME stale
    refresh token must produce exactly ONE rotation — the loser re-reads the
    row after the winner's lock and finds a fresh token."""
    db = FakeDb()
    seed_tokens(db, access="AT1", refresh="RT1", expires_in=10)
    calls: list[int] = []

    async def fake_post(url, data, timeout=45):
        calls.append(1)
        await asyncio.sleep(0.01)  # widen the race window
        return 200, {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 299}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    async def scenario():
        return await asyncio.gather(ib.refresh(db=db), ib.refresh(db=db))

    first, second = run(scenario())
    assert len(calls) == 1, f"single-use refresh token was raced: {len(calls)} rotations"
    assert first["refresh_token"] == "RT2"
    assert second["refresh_token"] == "RT2"


def test_refresh_without_stored_token_fails_with_systemexit():
    db = FakeDb()  # no row at all

    with pytest.raises(SystemExit) as excinfo:
        run(ib.refresh(db=db))
    assert "re-auth" in str(excinfo.value)


# --------------------------------------------------------------------------- #
# PKCE + authorize URL (port of ibkr_mcp_reauth.do_prepare)                    #
# --------------------------------------------------------------------------- #
def test_generate_pkce_is_s256():
    verifier, challenge = ib.generate_pkce()
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
    assert challenge == expected.rstrip(b"=").decode()
    assert "=" not in verifier and "=" not in challenge


def test_build_authorize_url_matches_reference(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI",
                        "https://api.kubotics.ch/api/v1/ibkr/auth/callback")
    url = ib.build_authorize_url("state-xyz", "challenge-abc")
    assert url.startswith("https://api.ibkr.com/oauth2/authorize?")
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    assert query["response_type"] == "code"
    assert query["client_id"] == settings.IBKR_MCP_CLIENT_ID
    assert query["redirect_uri"] == "https://api.kubotics.ch/api/v1/ibkr/auth/callback"
    assert query["state"] == "state-xyz"
    assert query["code_challenge"] == "challenge-abc"
    assert query["code_challenge_method"] == "S256"
    assert query["resource"] == ib.EP
    assert query["scope"] == settings.IBKR_MCP_SCOPE


# --------------------------------------------------------------------------- #
# Auth state: TTL, single use, unknown state                                   #
# --------------------------------------------------------------------------- #
def test_auth_state_unknown_rejected():
    async def scenario():
        db = FakeDb()
        return await ib.consume_auth_state(db, "does-not-exist")

    assert run(scenario()) is None


def test_auth_state_single_use():
    async def scenario():
        db = FakeDb()
        state, _url = await ib.create_auth_state(db)
        first = await ib.consume_auth_state(db, state)
        second = await ib.consume_auth_state(db, state)
        return first, second

    first, second = run(scenario())
    assert first, "first consume must return the PKCE verifier"
    assert second is None, "a state must never be usable twice"


def test_auth_state_ttl_expiry():
    async def scenario():
        db = FakeDb()
        state, _url = await ib.create_auth_state(db)
        db.states[state].created_at = datetime.now(UTC) - timedelta(
            seconds=ib.STATE_TTL_S + 1
        )
        verifier = await ib.consume_auth_state(db, state)
        return verifier, state in db.states

    verifier, still_present = run(scenario())
    assert verifier is None
    assert not still_present, "expired state must be purged"


def test_create_auth_state_purges_consumed_rows():
    async def scenario():
        db = FakeDb()
        state, _ = await ib.create_auth_state(db)
        await ib.consume_auth_state(db, state)
        assert state in db.states
        await ib.create_auth_state(db)
        return state in db.states

    assert run(scenario()) is False


# --------------------------------------------------------------------------- #
# Read-only tool allowlist (C3 hard rule)                                      #
# --------------------------------------------------------------------------- #
def test_allowlisted_read_tools_accepted():
    for name in ("get_account_summary", "get_account_balances",
                 "get_account_positions", "get_account_orders",
                 "get_order_instructions"):
        ib.assert_read_tool(name)  # must not raise


@pytest.mark.parametrize(
    "tool",
    [
        "place_order",
        "submit_order",
        "cancel_order",
        "create_order",
        "delete_order",
        "placeOrder",
        "transfer_funds",
        "buy",
        "sell",
        "close_position",
        "some_unknown_tool",
        "",
    ],
)
def test_order_and_write_tools_rejected(tool):
    with pytest.raises(ValueError):
        ib.assert_read_tool(tool)


def test_call_tool_rejects_order_tool_before_any_network(monkeypatch):
    async def boom(*args, **kwargs):
        raise AssertionError("network must not be touched for a rejected tool")

    monkeypatch.setattr(ib, "_post_mcp", boom)

    async def scenario():
        with pytest.raises(ValueError):
            await ib.call_tool("place_order", {"qty": 1}, tok="t", sid=None)
        with pytest.raises(ValueError):
            await ib.call_tool("get_account_orders_backup", None, tok="t", sid=None)

    run(scenario())


# --------------------------------------------------------------------------- #
# merged() — never raises, falls back to cache / previous payload              #
# --------------------------------------------------------------------------- #
def _burst_ok(ts="2026-11-14T12:00:00Z"):
    return {
        "ts": ts,
        "cash_chf": 1234.5,
        "equity_chf": 9999.0,
        "positions": [{"symbol": "AAPL", "position": 10}],
        "orders_active": [],
        "instructions_pending": None,
    }


def test_merged_overlays_burst_and_preserves_existing_blocks(monkeypatch):
    async def fake_burst(force=False):
        return _burst_ok()

    monkeypatch.setattr(ib, "burst", fake_burst)
    existing = {"cash_chf": 1.0, "auth": {"authenticated": True}}

    out = run(ib.merged(existing))
    assert out["cash_chf"] == 1234.5
    assert out["equity_chf"] == 9999.0
    assert out["auth"] == {"authenticated": True}, "existing blocks must survive"
    assert out["source"] == "backend-ibkr-mcp"
    assert out["mcp"] == {"ok": True, "ts": "2026-11-14T12:00:00Z"}


def test_merged_never_raises_on_refresh_failure(monkeypatch):
    async def failing_burst(force=False):
        raise SystemExit("refresh failed: 401")

    monkeypatch.setattr(ib, "burst", failing_burst)
    existing = {"cash_chf": 42.0, "orders_active": [{"id": 7}], "mcp": {"ok": False}}

    out = run(ib.merged(existing))
    assert out == existing, "previous payload must be returned untouched"


def test_merged_never_raises_on_generic_failure(monkeypatch):
    async def broken_burst(force=False):
        raise RuntimeError("network down")

    monkeypatch.setattr(ib, "burst", broken_burst)
    assert run(ib.merged({"cash_chf": 5.0})) == {"cash_chf": 5.0}


def test_merged_never_raises_on_garbage_input(monkeypatch):
    async def broken_burst(force=False):
        raise RuntimeError("network down")

    monkeypatch.setattr(ib, "burst", broken_burst)
    assert run(ib.merged(None)) == {}
    assert run(ib.merged("not-a-dict")) == {}


def test_merged_falls_back_to_cached_burst(monkeypatch):
    ib._last_burst = _burst_ok()
    ib._last_burst_ok_at = time.time()  # recent good burst

    async def failing_burst(force=False):
        raise SystemExit("refresh failed: 400")

    monkeypatch.setattr(ib, "burst", failing_burst)

    out = run(ib.merged({"auth": {"authenticated": False}}))
    assert out["cash_chf"] == 1234.5
    assert out["mcp"]["ok"] is True
    assert out["auth"] == {"authenticated": False}


# --------------------------------------------------------------------------- #
# auth_status / poller switch                                                  #
# --------------------------------------------------------------------------- #
def test_auth_status_when_disabled_is_inert(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")

    status = run(ib.auth_status(FakeDb()))
    assert status["configured"] is False
    assert status["authorized"] is False
    assert status["last_refresh_at"] is None


def test_auth_status_reports_token_health(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI",
                        "https://api.kubotics.ch/api/v1/ibkr/auth/callback")
    db = FakeDb()
    last = datetime.now(UTC) - timedelta(minutes=3)
    seed_tokens(db, expires_in=2000, last_refresh_at=last)

    status = run(ib.auth_status(db))
    assert status["configured"] is True
    assert status["authorized"] is True
    assert status["fresh"] is True
    assert datetime.fromisoformat(status["last_refresh_at"]) == last
    assert status["redirect_uri"].endswith("/api/v1/ibkr/auth/callback")


def test_poller_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")
    assert ib.maybe_start_poller() is None

    # enabled but no redirect URI -> still fully inert
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    assert ib.maybe_start_poller() is None


def test_poller_starts_only_when_fully_configured(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI",
                        "https://api.kubotics.ch/api/v1/ibkr/auth/callback")

    async def scenario():
        task = ib.maybe_start_poller()
        assert task is not None
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return True

    assert run(scenario()) is True
