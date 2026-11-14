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

REDIRECT_URI = "https://api.kubotics.ch/api/v1/ibkr/auth/callback"


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


def test_poller_starts_on_feed_enabled_without_redirect(monkeypatch):
    """Phase C §10: the feed gate is IBKR_MCP_ENABLED alone — no callback
    URI required (tokens can be imported by script)."""
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")

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


# --------------------------------------------------------------------------- #
# Phase C (§10) — config split: feed_enabled / auth_ready                      #
# --------------------------------------------------------------------------- #
def test_config_split_feed_without_redirect(monkeypatch):
    """Feed = IBKR_MCP_ENABLED alone; auth = feed AND redirect URI."""
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", REDIRECT_URI)
    assert ib.feed_enabled() is False
    assert ib.auth_ready() is False

    # feed WITHOUT redirect: poller/feed allowed, OAuth flow not ready
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    assert ib.feed_enabled() is True, "feed must not require a redirect URI"
    assert ib.auth_ready() is False, "auth flow still needs the redirect URI"

    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", REDIRECT_URI)
    assert ib.feed_enabled() is True
    assert ib.auth_ready() is True


def test_auth_status_feed_only_reports_redirect_configured(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")
    db = FakeDb()
    seed_tokens(db, expires_in=2000)

    status = run(ib.auth_status(db))
    assert status["configured"] is True, "configured now reports the FEED gate"
    assert status["redirect_configured"] is False
    assert status["authorized"] is True, "token health stays visible without a redirect"
    assert status["redirect_uri"] is None

    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", REDIRECT_URI)
    assert run(ib.auth_status(db))["redirect_configured"] is True


def test_auth_status_disabled_has_redirect_configured_false(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", REDIRECT_URI)
    status = run(ib.auth_status(FakeDb()))
    assert status["configured"] is False
    assert status["redirect_configured"] is False


def test_run_once_skips_quietly_when_no_token_row(monkeypatch, caplog):
    """Enabling the feed before importing tokens must be harmless: one INFO
    line per cycle, no burst attempt, no exception, no secrets."""
    fake_db = FakeDb()
    monkeypatch.setattr(ib, "AsyncSessionLocal", lambda: fake_db)

    async def boom(*args, **kwargs):
        raise AssertionError("burst must not run without a token row")

    monkeypatch.setattr(ib, "burst", boom)

    with caplog.at_level("INFO"):
        out = run(ib.run_once())

    assert out == {"skipped": "no token row"}
    skip_lines = [r for r in caplog.records if "no token row" in r.getMessage()]
    assert len(skip_lines) == 1, "at most one INFO line per cycle"
    assert all(r.levelname == "INFO" for r in skip_lines)
    assert "AT1" not in caplog.text and "RT1" not in caplog.text


def test_run_once_skips_when_row_has_no_refresh_token(monkeypatch):
    fake_db = FakeDb()
    seed_tokens(fake_db, refresh="", expires_in=2000)  # row exists, unusable
    monkeypatch.setattr(ib, "AsyncSessionLocal", lambda: fake_db)

    async def boom(*args, **kwargs):
        raise AssertionError("burst must not run without a refresh token")

    monkeypatch.setattr(ib, "burst", boom)
    assert run(ib.run_once()) == {"skipped": "no token row"}


def test_import_tokens_upserts_singleton_row(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(ib, "AsyncSessionLocal", lambda: fake_db)

    before = datetime.now(UTC)
    saved = run(ib.import_tokens(
        "AT-IMPORT-1", "RT-IMPORT-1", 1234, "openid profile mcp.read",
    ))
    after = datetime.now(UTC)

    row = fake_db.token_row
    assert row is not None and row.id == "singleton"
    assert row.access_token == "AT-IMPORT-1"
    assert row.refresh_token == "RT-IMPORT-1"
    assert row.scope == "openid profile mcp.read"
    assert row.token_type == "Bearer"
    # expires_at = now + expires_in, last_refresh_at = now (save_tokens parity)
    assert row.expires_at is not None
    assert before + timedelta(seconds=1234) <= row.expires_at <= after + timedelta(seconds=1234)
    assert before <= row.last_refresh_at <= after
    assert saved["access_token"] == "AT-IMPORT-1"
    assert saved["expires_at"] == row.expires_at
    # second call upserts the same singleton row (no second row possible)
    run(ib.import_tokens("AT-IMPORT-2", "RT-IMPORT-2", 60, None))
    assert fake_db.token_row.access_token == "AT-IMPORT-2"
    assert fake_db.commits == 2


# --------------------------------------------------------------------------- #
# Phase C (§10) — allowlist surgery: instruction trio + full resolution order   #
# --------------------------------------------------------------------------- #
def test_instruction_trio_allowed_by_full_gate():
    ib.assert_allowed_tool("get_order_instructions", None)  # read, either flow
    ib.assert_allowed_tool("create_order_instruction", ib.REVIEW_AND_APPROVE)
    ib.assert_allowed_tool("delete_order_instruction", ib.REVIEW_AND_APPROVE)
    # pure-read callers keep the unchanged assert_read_tool behavior
    ib.assert_read_tool("get_order_instructions")


@pytest.mark.parametrize("flow", [None, "", "AUTONOMOUS", "autonomous"])
def test_instruction_write_tools_require_review_flow(flow):
    for name in ("create_order_instruction", "delete_order_instruction"):
        with pytest.raises(ValueError):
            ib.assert_allowed_tool(name, flow)


def test_get_price_snapshot_is_read_allowed():
    """daily_invest / ibkr_watch_static quote reads through the cloud proxy."""
    ib.assert_read_tool("get_price_snapshot")
    ib.assert_allowed_tool("get_price_snapshot", None)


@pytest.mark.parametrize(
    "tool",
    [
        "submit_order",
        "cancel_order",
        "modify_order",
        "place_order",
        "preview_order",
        "answer_order_question",
        "get_order_rules",
        "get_order_status",
    ],
)
def test_order_tools_rejected_with_zero_network(monkeypatch, tool):
    async def boom(*args, **kwargs):
        raise AssertionError(f"network must not be touched for {tool}")

    monkeypatch.setattr(ib, "_post_mcp", boom)

    async def scenario():
        with pytest.raises(ValueError):
            await ib.call_tool(tool, {"flow_type": "REVIEW_AND_APPROVE"},
                               tok="t", sid=None)

    run(scenario())


def test_create_autonomous_flow_rejected_pre_network(monkeypatch):
    async def boom(*args, **kwargs):
        raise AssertionError("AUTONOMOUS create must never reach the wire")

    monkeypatch.setattr(ib, "_post_mcp", boom)

    async def scenario():
        with pytest.raises(ValueError):
            await ib.call_tool(
                "create_order_instruction",
                {"contract_id_ex": "265598", "side": "BUY",
                 "quantity": 1, "flow_type": "AUTONOMOUS"},
                tok="t", sid=None,
            )
        with pytest.raises(ValueError):
            await ib.call_tool(
                "create_order_instruction",
                {"contract_id_ex": "265598", "side": "BUY", "quantity": 1},
                tok="t", sid=None,
            )

    run(scenario())


def test_create_with_review_flow_passes_gate_and_calls_mcp(monkeypatch):
    """Happy path through call_tool: gate opens, one tools/call, parsed JSON."""
    calls: list[dict] = []

    async def fake_post(payload, tok, sid=None, timeout=45):
        calls.append(dict(payload.get("params") or {}))
        return 200, {"result": {"content": [{"text": '{"id": "INS-9"}'}]}}, {}

    monkeypatch.setattr(ib, "_post_mcp", fake_post)

    out = run(ib.call_tool(
        "create_order_instruction",
        {"contract_id_ex": "265598", "side": "BUY", "quantity": 2,
         "flow_type": ib.REVIEW_AND_APPROVE},
        tok="t", sid="s",
    ))
    assert out == {"id": "INS-9"}
    assert calls[0]["name"] == "create_order_instruction"


def test_pending_instruction_keys_terminal_not_pending():
    raw = {"instructions": [
        {"id": 1, "status": "active", "contract_id_ex": "265598", "side": "BUY"},
        {"id": 2, "status": "Filled", "contract_id_ex": "265600", "side": "BUY"},
        {"id": 3, "status": "cancelled", "contract_id": 265601, "action": "SELL"},
        {"id": 4, "status": "pendingreview", "symbol": "SWDA", "side": "BUY"},
    ]}
    keys = ib.pending_instruction_keys(raw)
    assert ("265598", "BUY") in keys, "non-terminal conid must count as pending"
    assert ("SWDA", "BUY") in keys, "symbol rows match too"
    assert not any(k[0] in ("265600", "265601") for k in keys), \
        "terminal statuses (filled/cancelled/...) are never pending"
    # entry keys use the same shape (daily_invest skip semantics)
    assert ib.entry_instruction_key(265598, None, "BUY") in keys
    assert ib.entry_instruction_key(None, "swda", "buy") in keys
    assert ib.entry_instruction_key(265600, None, "BUY") not in keys


def test_pending_instructions_public_view():
    raw = {"instructions": [
        {"id": 1, "status": "active", "contract_id_ex": "265598", "side": "BUY"},
        {"id": 2, "status": "filled", "contract_id_ex": "265600", "side": "BUY"},
    ]}
    pending = ib.pending_instructions(raw)
    assert [p["id"] for p in pending] == [1], "only non-terminal rows"
    assert ib.pending_instructions(None) == []
    assert ib.pending_instructions("garbage") == []


def test_instruction_id_of_shapes():
    assert ib.instruction_id_of({"id": 7}) == "7"
    assert ib.instruction_id_of({"instruction": {"id": "INS-1"}}) == "INS-1"
    assert ib.instruction_id_of({"instruction_id": "X"}) == "X"
    assert ib.instruction_id_of({}) is None
    assert ib.instruction_id_of("nope") is None
