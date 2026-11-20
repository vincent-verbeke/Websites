"""API tests for the IBKR MCP auth/control router (no network, no real DB).

Wiring covered: disabled-by-default inertness (503s, no poller), admin gating,
auth start -> authorize_url, callback state validation (bad state, TTL, single
use), happy-path code exchange with mocked httpx layer, and status/refresh.

Run:  uv run pytest tests/test_ibkr_mcp_api.py -q
Docs: docs/IBKR_MCP_BACKEND.md
"""
from __future__ import annotations

import asyncio
import urllib.parse
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.services import ibkr_mcp as ib

from .ibkr_helpers import FakeDb, run, seed_tokens

REDIRECT = "https://api.kubotics.ch/api/v1/ibkr/auth/callback"
ADMIN = {"X-Needle-Token": "s3cret-ibkr-test"}


@pytest.fixture()
def fake_db():
    return FakeDb()


@pytest.fixture()
def client(fake_db, monkeypatch):
    # Never rely on the ambient .env: force a known admin token here.
    monkeypatch.setattr(settings, "NEEDLE_TOKEN", "s3cret-ibkr-test")
    # Plain TestClient (no context manager): the FastAPI lifespan -- and with it
    # create_all against the real Postgres and any poller -- must not run.
    app.dependency_overrides[get_db] = lambda: fake_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", REDIRECT)


@pytest.fixture(autouse=True)
def _clean_burst_cache(monkeypatch):
    monkeypatch.setattr(ib, "_last_burst", None, raising=False)
    monkeypatch.setattr(ib, "_last_burst_ok_at", 0.0, raising=False)


# --------------------------------------------------------------------------- #
# Disabled by default: everything inert, nothing polls                         #
# --------------------------------------------------------------------------- #
def test_disabled_by_default_is_inert(client, fake_db, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")

    status = client.get("/api/v1/ibkr/auth/status")
    assert status.status_code == 200
    body = status.json()
    assert body["configured"] is False
    assert body["authorized"] is False

    # admin-gated endpoints answer "not configured" (with a valid token)
    assert client.post("/api/v1/ibkr/auth/start", headers=ADMIN).status_code == 503
    assert client.post("/api/v1/ibkr/mcp/refresh", headers=ADMIN).status_code == 503
    # public callback is inert too
    resp = client.get("/api/v1/ibkr/auth/callback", params={"code": "c", "state": "s"})
    assert resp.status_code == 503

    # DCR endpoint stays off regardless
    assert client.post("/api/v1/ibkr/auth/register", headers=ADMIN).status_code == 503

    # nothing started: no poller task when the feature flag is unset
    assert ib.maybe_start_poller() is None
    # and no state/token rows were created
    assert fake_db.states == {}
    assert fake_db.token_row is None


def test_enabled_without_redirect_is_feed_only(client, monkeypatch):
    """Phase C §10: IBKR_MCP_ENABLED alone gates the FEED (poller allowed);
    the OAuth flow still needs the redirect URI (auth/start -> 503)."""
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")

    assert client.post("/api/v1/ibkr/auth/start", headers=ADMIN).status_code == 503
    assert client.get("/api/v1/ibkr/auth/callback",
                      params={"code": "c", "state": "s"}).status_code == 503

    async def scenario():
        task = ib.maybe_start_poller()
        assert task is not None, "feed must poll without a redirect URI"
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return True

    assert run(scenario()) is True


# --------------------------------------------------------------------------- #
# Admin gating                                                                 #
# --------------------------------------------------------------------------- #
def test_admin_endpoints_require_token(client, configured):
    assert client.post("/api/v1/ibkr/auth/start").status_code == 401
    assert client.post(
        "/api/v1/ibkr/auth/start", headers={"X-Needle-Token": "wrong"}
    ).status_code == 401
    assert client.post("/api/v1/ibkr/mcp/refresh").status_code == 401
    assert client.post("/api/v1/ibkr/auth/register").status_code == 401


# --------------------------------------------------------------------------- #
# POST /auth/start                                                             #
# --------------------------------------------------------------------------- #
def test_start_returns_authorize_url_and_persists_state(client, configured, fake_db):
    resp = client.post("/api/v1/ibkr/auth/start", headers=ADMIN)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    url = body["authorize_url"]
    assert url.startswith("https://api.ibkr.com/oauth2/authorize?")
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    assert query["redirect_uri"] == REDIRECT
    assert query["code_challenge_method"] == "S256"
    assert query["resource"] == ib.EP
    assert query["client_id"] == settings.IBKR_MCP_CLIENT_ID
    assert query["state"] and len(fake_db.states) == 1
    assert query["state"] in fake_db.states
    assert body["expires_in_s"] == ib.STATE_TTL_S
    # nothing token-like in the response
    assert "access_token" not in resp.text


# --------------------------------------------------------------------------- #
# GET /auth/callback                                                           #
# --------------------------------------------------------------------------- #
def test_callback_rejects_unknown_state_without_exchange(client, configured, monkeypatch):
    calls = []

    async def fake_post(url, data, timeout=45):
        calls.append(dict(data))
        return 200, {"access_token": "ATOK", "refresh_token": "RTOK", "expires_in": 300}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    resp = client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "good-code", "state": "bogus"}
    )
    assert resp.status_code == 400
    assert calls == [], "code exchange must not run for a bad state"


def test_callback_happy_path_persists_tokens(client, configured, fake_db, monkeypatch):
    calls: list[dict] = []

    async def fake_post(url, data, timeout=45):
        calls.append(dict(data))
        return 200, {
            "access_token": "ATOK-123",
            "refresh_token": "RTOK-456",
            "expires_in": 300,
            "scope": "openid profile email mcp.read",
            "token_type": "Bearer",
        }

    monkeypatch.setattr(ib, "_post_form", fake_post)

    start = client.post("/api/v1/ibkr/auth/start", headers=ADMIN).json()
    state = dict(
        urllib.parse.parse_qsl(urllib.parse.urlsplit(start["authorize_url"]).query)
    )["state"]

    resp = client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "auth-code-1", "state": state}
    )
    assert resp.status_code == 200, resp.text
    assert "Connected" in resp.text
    # tokens persisted, never echoed to the browser
    assert fake_db.token_row is not None
    assert fake_db.token_row.access_token == "ATOK-123"
    assert "ATOK-123" not in resp.text
    assert "RTOK-456" not in resp.text

    # exchange request shape: form-encoded fields of the proven helper
    assert len(calls) == 1
    assert calls[0]["grant_type"] == "authorization_code"
    assert calls[0]["code"] == "auth-code-1"
    assert calls[0]["redirect_uri"] == REDIRECT
    assert calls[0]["client_id"] == settings.IBKR_MCP_CLIENT_ID
    assert calls[0]["resource"] == ib.EP
    assert calls[0]["code_verifier"]

    # status now reports authorized
    status = client.get("/api/v1/ibkr/auth/status").json()
    assert status["configured"] is True
    assert status["authorized"] is True
    assert status["last_refresh_at"] is not None
    datetime.fromisoformat(status["last_refresh_at"])


def test_callback_state_is_single_use(client, configured, fake_db, monkeypatch):
    calls = []

    async def fake_post(url, data, timeout=45):
        calls.append(1)
        return 200, {"access_token": "A", "refresh_token": "R", "expires_in": 300}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    start = client.post("/api/v1/ibkr/auth/start", headers=ADMIN).json()
    state = dict(
        urllib.parse.parse_qsl(urllib.parse.urlsplit(start["authorize_url"]).query)
    )["state"]

    first = client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "c1", "state": state}
    )
    assert first.status_code == 200
    replay = client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "c2", "state": state}
    )
    assert replay.status_code == 400
    assert len(calls) == 1, "a replayed callback must never exchange again"


def test_callback_state_ttl_expiry(client, configured, fake_db, monkeypatch):
    calls = []

    async def fake_post(url, data, timeout=45):
        calls.append(1)
        return 200, {"access_token": "A", "refresh_token": "R", "expires_in": 300}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    start = client.post("/api/v1/ibkr/auth/start", headers=ADMIN).json()
    state = dict(
        urllib.parse.parse_qsl(urllib.parse.urlsplit(start["authorize_url"]).query)
    )["state"]
    # age the pending state beyond the 10-minute TTL
    fake_db.states[state].created_at = datetime.now(UTC) - timedelta(
        seconds=ib.STATE_TTL_S + 5
    )

    resp = client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "late", "state": state}
    )
    assert resp.status_code == 400
    assert calls == []


def test_callback_exchange_failure_returns_502(client, configured, fake_db, monkeypatch):
    async def fake_post(url, data, timeout=45):
        return 400, {"error": "expired_token"}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    start = client.post("/api/v1/ibkr/auth/start", headers=ADMIN).json()
    state = dict(
        urllib.parse.parse_qsl(urllib.parse.urlsplit(start["authorize_url"]).query)
    )["state"]

    resp = client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "stale", "state": state}
    )
    assert resp.status_code == 502
    assert "Connected" not in resp.text
    assert fake_db.token_row is None


def test_callback_missing_params_400(client, configured):
    assert client.get("/api/v1/ibkr/auth/callback").status_code == 400
    assert client.get(
        "/api/v1/ibkr/auth/callback", params={"code": "only-code"}
    ).status_code == 400


# --------------------------------------------------------------------------- #
# POST /mcp/refresh                                                            #
# --------------------------------------------------------------------------- #
def test_refresh_rotates_and_returns_status_only(client, configured, fake_db, monkeypatch):
    seed_tokens(fake_db, access="AT1", refresh="RT1", expires_in=-10)
    calls = []

    async def fake_post(url, data, timeout=45):
        calls.append(dict(data))
        return 200, {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 299}

    monkeypatch.setattr(ib, "_post_form", fake_post)

    resp = client.post("/api/v1/ibkr/mcp/refresh", headers=ADMIN)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["last_refresh_at"] is not None
    # status only — no token material in the response
    assert "RT2" not in resp.text
    assert "AT2" not in resp.text
    assert len(calls) == 1
    assert fake_db.token_row.refresh_token == "RT2"


def test_refresh_failure_maps_to_502(client, configured, fake_db, monkeypatch):
    seed_tokens(fake_db, access="AT1", refresh="RT1", expires_in=-10)

    async def fail_post(url, data, timeout=45):
        return 401, {}

    monkeypatch.setattr(ib, "_post_form", fail_post)

    resp = client.post("/api/v1/ibkr/mcp/refresh", headers=ADMIN)
    assert resp.status_code == 502
    assert "401" in resp.json()["detail"]


# --------------------------------------------------------------------------- #
# POST /auth/register (DCR — disabled by default)                              #
# --------------------------------------------------------------------------- #
def test_register_disabled_by_default(client, configured, monkeypatch):
    async def boom():
        raise AssertionError("DCR must not be attempted when disabled")

    monkeypatch.setattr(ib, "dynamic_client_registration", boom)
    resp = client.post("/api/v1/ibkr/auth/register", headers=ADMIN)
    assert resp.status_code == 503
    assert "ba3ab3ee" in resp.json()["detail"]


# --------------------------------------------------------------------------- #
# Phase C (§10) — cloud-owned MCP flow: fixtures + MCP mocks                   #
# --------------------------------------------------------------------------- #
@pytest.fixture()
def feed_only(monkeypatch):
    """Feed enabled WITHOUT a redirect URI — the valid Phase C deployment."""
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")


def _mock_mcp(monkeypatch, *, pending=None, result_for=None, open_error=None):
    """Replace open_session + call_tool (no network). Returns the call log:
    [(tool_name, args), ...] in call order."""
    calls: list[tuple[str, dict]] = []

    async def fake_open():
        if open_error is not None:
            raise open_error
        return "MOCK-ACCESS-TOKEN", "sid-mock"

    async def fake_call(name, args, tok, sid):
        calls.append((name, dict(args or {})))
        if result_for and name in result_for:
            value = result_for[name]
            if isinstance(value, Exception):
                raise value
            return value
        if name == "get_order_instructions":
            return {"instructions": list(pending or [])}
        if name == "create_order_instruction":
            return {"id": "INS-1"}
        return {}

    monkeypatch.setattr(ib, "open_session", fake_open)
    monkeypatch.setattr(ib, "call_tool", fake_call)
    return calls


def _forbid_network(monkeypatch):
    """Any MCP layer touch must fail the test loudly (zero-network proof)."""
    async def boom(*args, **kwargs):
        raise AssertionError("MCP layer must not be touched")

    monkeypatch.setattr(ib, "open_session", boom)
    monkeypatch.setattr(ib, "call_tool", boom)
    monkeypatch.setattr(ib, "_post_mcp", boom)


def _entry(**over):
    entry = {"side": "BUY", "quantity": 2, "conid": 265598}
    entry.update(over)
    return entry


# --------------------------------------------------------------------------- #
# GET /auth/status — documented field addition                                 #
# --------------------------------------------------------------------------- #
def test_auth_status_reports_redirect_configured(client, feed_only):
    body = client.get("/api/v1/ibkr/auth/status").json()
    assert body["configured"] is True
    assert body["redirect_configured"] is False  # feed-only deployment
    # rest of the payload unchanged
    assert set(body) == {"configured", "redirect_configured", "authorized",
                         "fresh", "last_refresh_at", "redirect_uri"}


def test_auth_status_redirect_configured_true_when_ready(client, configured):
    body = client.get("/api/v1/ibkr/auth/status").json()
    assert body["configured"] is True
    assert body["redirect_configured"] is True


# --------------------------------------------------------------------------- #
# POST /api/v1/ibkr/instructions                                               #
# --------------------------------------------------------------------------- #
def test_create_instructions_happy_path(client, feed_only, fake_db, monkeypatch):
    seed_tokens(fake_db, access="LEAK-AT-1", refresh="LEAK-RT-1", expires_in=2000)
    calls = _mock_mcp(monkeypatch)

    resp = client.post(
        "/api/v1/ibkr/instructions",
        headers=ADMIN,
        json={
            "instructions": [_entry(limit_price=450.5, exchange="SMART", currency="USD")],
            "dedupe": True,
            "source": "daily_invest",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["results"] == [
        {"index": 0, "status": "created", "instruction_id": "INS-1"}
    ]
    # one dedupe read first, then exactly one create — proven MCP arg shape
    assert [name for name, _a in calls] == ["get_order_instructions",
                                            "create_order_instruction"]
    args = calls[1][1]
    assert args["flow_type"] == "REVIEW_AND_APPROVE", "flow always forced"
    assert args["contract_id_ex"] == "265598"
    assert args["side"] == "BUY" and args["quantity"] == 2
    assert args["order_type"] == "LIMIT" and args["limit_price"] == 450.5
    assert args["time_in_force"] == "DAY"
    assert args["exchange"] == "SMART" and args["currency"] == "USD"
    # no token material anywhere in the response
    assert "LEAK-AT-1" not in resp.text and "LEAK-RT-1" not in resp.text


def test_create_instructions_dedupe_skips_pending(client, feed_only, monkeypatch):
    pending = [
        {"id": 1, "status": "active", "contract_id_ex": "265598", "side": "BUY"},
        {"id": 2, "status": "filled", "contract_id_ex": "265600", "side": "BUY"},
    ]
    calls = _mock_mcp(monkeypatch, pending=pending)

    resp = client.post(
        "/api/v1/ibkr/instructions",
        headers=ADMIN,
        json={"instructions": [
            _entry(conid=265598),                    # pending -> skip
            _entry(conid=265599),                    # free -> create
            _entry(conid=265599),                    # dup inside batch -> skip
            _entry(conid=265600),                    # only terminal rows -> create
        ]},
    )
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert [r["status"] for r in results] == [
        "skipped_duplicate", "created", "skipped_duplicate", "created",
    ]
    assert [r["index"] for r in results] == [0, 1, 2, 3]
    creates = [a for n, a in calls if n == "create_order_instruction"]
    assert len(creates) == 2, "pending and within-batch duplicates must not create"
    assert results[0]["detail"], "skip carries a human-readable reason"


def test_create_instructions_dedupe_false_skips_read(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch, pending=[
        {"id": 1, "status": "active", "contract_id_ex": "265598", "side": "BUY"},
    ])
    resp = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [_entry()], "dedupe": False})
    assert resp.status_code == 200, resp.text
    assert [n for n, _a in calls] == ["create_order_instruction"]


def test_create_instructions_batch_cap(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch)
    cap = 20  # MAX_INSTRUCTIONS_PER_CALL

    ok = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                     json={"instructions": [_entry(conid=1000 + i)
                                            for i in range(cap)]})
    assert ok.status_code == 200, ok.text
    assert len(ok.json()["results"]) == cap

    too_many = client.post(
        "/api/v1/ibkr/instructions", headers=ADMIN,
        json={"instructions": [_entry(conid=1000 + i) for i in range(cap + 1)]},
    )
    assert too_many.status_code == 422, "more than 20 entries must be rejected"
    # the rejected oversized batch never reached the MCP layer mid-way
    assert [n for n, _a in calls].count("create_order_instruction") == cap


@pytest.mark.parametrize(
    "entry",
    [
        {"side": "HOLD", "quantity": 1, "conid": 265598},      # bad side
        {"side": "buy", "quantity": 1, "conid": 265598},       # wrong case
        {"side": "BUY", "quantity": 0, "conid": 265598},       # qty not > 0
        {"side": "BUY", "quantity": -2, "conid": 265598},      # qty negative
        {"side": "BUY", "quantity": 1, "conid": 0},            # conid not > 0
        {"side": "BUY", "quantity": 1, "conid": -7},           # conid negative
        {"side": "BUY", "quantity": 1},                        # neither conid/symbol
        {"side": "BUY", "quantity": 1, "symbol": "   "},       # blank symbol
        {"side": "BUY", "quantity": 1, "conid": 1, "limit_price": 0},  # price <= 0
    ],
)
def test_create_instructions_validation_422(client, feed_only, monkeypatch, entry):
    calls = _mock_mcp(monkeypatch)
    resp = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [entry]})
    assert resp.status_code == 422, resp.text
    assert calls == [], "invalid bodies must never open an MCP session"


def test_create_instructions_autonomous_flow_422(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch)
    resp = client.post(
        "/api/v1/ibkr/instructions", headers=ADMIN,
        json={"instructions": [_entry(flow_type="AUTONOMOUS")]},
    )
    assert resp.status_code == 422, "AUTONOMOUS must never pass through"
    assert calls == []
    # explicit REVIEW_AND_APPROVE is accepted (and re-forced to the same value)
    ok = client.post(
        "/api/v1/ibkr/instructions", headers=ADMIN,
        json={"instructions": [_entry(flow_type="REVIEW_AND_APPROVE")]},
    )
    assert ok.status_code == 200
    assert [n for n, _a in calls][-1] == "create_order_instruction"


def test_create_instructions_mcp_layer_failure_502(client, feed_only, monkeypatch):
    async def refresh_fail():
        raise SystemExit("refresh failed: 401")

    monkeypatch.setattr(ib, "open_session", refresh_fail)
    resp = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [_entry()]})
    assert resp.status_code == 502
    assert "refresh failed: 401" in resp.json()["detail"]

    async def init_fail():
        raise RuntimeError("mcp initialize HTTP 503")

    monkeypatch.setattr(ib, "open_session", init_fail)
    resp = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [_entry()]})
    assert resp.status_code == 502
    assert "initialize" in resp.json()["detail"]


def test_create_instructions_dedupe_read_failure_502(client, feed_only, monkeypatch):
    """A failed dedupe read aborts (502) — never risk duplicate instructions."""
    async def fake_open():
        return "T", "S"

    async def fake_call(name, args, tok, sid):
        raise RuntimeError(f"{name} isError: boom")

    monkeypatch.setattr(ib, "open_session", fake_open)
    monkeypatch.setattr(ib, "call_tool", fake_call)

    resp = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [_entry()]})
    assert resp.status_code == 502
    assert "dedupe read failed" in resp.json()["detail"]


def test_create_instructions_per_entry_error_still_200(client, feed_only, monkeypatch):
    _mock_mcp(monkeypatch, result_for={
        "create_order_instruction": RuntimeError(
            "create_order_instruction isError: contract not found"
        ),
    })
    resp = client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [_entry()], "dedupe": False})
    assert resp.status_code == 200, "batch processed -> 200 with per-entry status"
    result = resp.json()["results"][0]
    assert result["status"] == "error"
    assert "contract not found" in result["detail"]


# --------------------------------------------------------------------------- #
# GET /api/v1/ibkr/instructions                                                #
# --------------------------------------------------------------------------- #
def test_list_instructions_returns_pending_only(client, feed_only, monkeypatch):
    _mock_mcp(monkeypatch, pending=[
        {"id": 1, "status": "active", "contract_id_ex": "265598", "side": "BUY",
         "quantity": 2, "limit_price": 400.5},
        {"id": 2, "status": "filled", "contract_id_ex": "265600", "side": "BUY"},
    ])
    resp = client.get("/api/v1/ibkr/instructions", headers=ADMIN)
    assert resp.status_code == 200, resp.text
    instructions = resp.json()["instructions"]
    assert [i["id"] for i in instructions] == [1], "terminal rows excluded"
    assert instructions[0]["conid"] == "265598"
    assert instructions[0]["action"] == "BUY"


# --------------------------------------------------------------------------- #
# DELETE /api/v1/ibkr/instructions/{instruction_id}                            #
# --------------------------------------------------------------------------- #
def test_delete_instruction_happy_path(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch, result_for={"delete_order_instruction": {"ok": True}})
    resp = client.delete("/api/v1/ibkr/instructions/INS-77", headers=ADMIN)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "instruction_id": "INS-77"}
    name, args = calls[0]
    assert name == "delete_order_instruction"
    # the live IBKR tool schema wants the field named "id" (input validation
    # rejects "instruction_id" — real-incident fix 2026-11-20)
    assert args["id"] == "INS-77"
    assert args["flow_type"] == "REVIEW_AND_APPROVE"


@pytest.mark.parametrize(
    "mcp_result",
    [
        RuntimeError("delete_order_instruction isError: instruction not found: INS-404"),
        {"error": "instruction not found"},
    ],
)
def test_delete_instruction_not_found_404(client, feed_only, monkeypatch, mcp_result):
    _mock_mcp(monkeypatch, result_for={"delete_order_instruction": mcp_result})
    resp = client.delete("/api/v1/ibkr/instructions/INS-404", headers=ADMIN)
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"]
    assert "INS-404" in resp.json()["detail"]


def test_delete_instruction_mcp_failure_502(client, feed_only, monkeypatch):
    _mock_mcp(monkeypatch, open_error=SystemExit("refresh failed: 401"))
    resp = client.delete("/api/v1/ibkr/instructions/INS-1", headers=ADMIN)
    assert resp.status_code == 502
    assert "refresh failed: 401" in resp.json()["detail"]


# --------------------------------------------------------------------------- #
# POST /api/v1/ibkr/mcp/call — generic READ proxy                              #
# --------------------------------------------------------------------------- #
def test_mcp_call_read_allowed(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch, result_for={
        "get_account_positions": {"positions": [{"symbol": "SWDA"}]},
        "get_price_snapshot": {"rows": [{"last": 999.0}]},
    })

    resp = client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": "get_account_positions", "args": {}})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"name": "get_account_positions",
                           "result": {"positions": [{"symbol": "SWDA"}]}}

    # the dev-PC quote read (daily_invest / ibkr_watch_static) passes through
    resp = client.post(
        "/api/v1/ibkr/mcp/call", headers=ADMIN,
        json={"name": "get_price_snapshot",
              "args": {"contract_id": 265598, "market_data_names": ["last", "bid_ask"]}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["result"] == {"rows": [{"last": 999.0}]}
    assert calls[1] == ("get_price_snapshot",
                        {"contract_id": 265598, "market_data_names": ["last", "bid_ask"]})


@pytest.mark.parametrize(
    "name",
    [
        "submit_order",
        "cancel_order",
        "modify_order",
        "place_order",
        "preview_order",
        "answer_order_question",
        "get_order_rules",
        "get_order_status",
        "some_unknown_tool",
    ],
)
def test_mcp_call_write_rejected_pre_network(client, feed_only, monkeypatch, name):
    _forbid_network(monkeypatch)  # any layer touch raises -> test fails
    resp = client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": name, "args": {"flow_type": "REVIEW_AND_APPROVE"}})
    assert resp.status_code == 400, f"{name} must be rejected BEFORE any network call"
    assert "rejected" in resp.json()["detail"] or "allowlist" in resp.json()["detail"]


def test_mcp_call_create_defaults_review_flow(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch, result_for={"create_order_instruction": {"id": "INS-5"}})
    resp = client.post(
        "/api/v1/ibkr/mcp/call", headers=ADMIN,
        json={"name": "create_order_instruction",
              "args": {"contract_id_ex": "265598", "side": "BUY", "quantity": 1,
                       "order_type": "LIMIT", "limit_price": 400.0,
                       "time_in_force": "DAY"}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"name": "create_order_instruction", "result": {"id": "INS-5"}}
    assert calls[0][1]["flow_type"] == "REVIEW_AND_APPROVE", \
        "omitted flow_type must default to REVIEW_AND_APPROVE"


def test_mcp_call_delete_defaults_review_flow(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch, result_for={"delete_order_instruction": {"ok": True}})
    resp = client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": "delete_order_instruction",
                             "args": {"id": "INS-1"}})
    assert resp.status_code == 200, resp.text
    assert calls[0][1]["flow_type"] == "REVIEW_AND_APPROVE"


@pytest.mark.parametrize("name", ["create_order_instruction", "delete_order_instruction"])
def test_mcp_call_autonomous_flow_422_pre_network(client, feed_only, monkeypatch, name):
    _forbid_network(monkeypatch)
    resp = client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": name, "args": {"flow_type": "AUTONOMOUS"}})
    assert resp.status_code == 422, "AUTONOMOUS must never pass through the proxy"


def test_mcp_call_get_order_instructions_allowed(client, feed_only, monkeypatch):
    calls = _mock_mcp(monkeypatch, pending=[
        {"id": 9, "status": "active", "contract_id_ex": "1", "side": "BUY"},
    ])
    resp = client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": "get_order_instructions", "args": {}})
    assert resp.status_code == 200, resp.text
    assert resp.json()["result"]["instructions"][0]["id"] == 9
    assert calls[0][0] == "get_order_instructions"


def test_mcp_call_mcp_layer_failure_502(client, feed_only, monkeypatch):
    _mock_mcp(monkeypatch, open_error=SystemExit("refresh failed: 401"))
    resp = client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": "get_account_positions", "args": {}})
    assert resp.status_code == 502
    assert "refresh failed: 401" in resp.json()["detail"]


# --------------------------------------------------------------------------- #
# Phase C gates: 503 disabled / 401 admin / no token material                  #
# --------------------------------------------------------------------------- #
def test_phase_c_endpoints_disabled_503(client, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", False)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")
    _forbid_network(monkeypatch)

    assert client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                       json={"instructions": [_entry()]}).status_code == 503
    assert client.get("/api/v1/ibkr/instructions", headers=ADMIN).status_code == 503
    assert client.delete("/api/v1/ibkr/instructions/INS-1",
                         headers=ADMIN).status_code == 503
    assert client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                       json={"name": "get_account_positions"}).status_code == 503
    assert ib.maybe_start_poller() is None  # default-off unchanged (no loop here)


def test_phase_c_endpoints_require_admin_token(client, feed_only, monkeypatch):
    _forbid_network(monkeypatch)
    wrong = {"X-Needle-Token": "nope"}

    assert client.post("/api/v1/ibkr/instructions",
                       json={"instructions": [_entry()]}).status_code == 401
    assert client.post("/api/v1/ibkr/instructions", headers=wrong,
                       json={"instructions": [_entry()]}).status_code == 401
    assert client.get("/api/v1/ibkr/instructions").status_code == 401
    assert client.delete("/api/v1/ibkr/instructions/INS-1").status_code == 401
    assert client.post("/api/v1/ibkr/mcp/call",
                       json={"name": "get_account_positions"}).status_code == 401
    assert client.post("/api/v1/ibkr/mcp/call", headers=wrong,
                       json={"name": "get_account_positions"}).status_code == 401


def test_phase_c_responses_never_contain_token_material(client, feed_only, fake_db,
                                                         monkeypatch):
    seed_tokens(fake_db, access="LEAK-ACCESS-XYZ", refresh="LEAK-REFRESH-XYZ",
                expires_in=2000)
    _mock_mcp(monkeypatch, pending=[
        {"id": 1, "status": "active", "contract_id_ex": "265598", "side": "BUY"},
    ])

    responses = [
        client.post("/api/v1/ibkr/instructions", headers=ADMIN,
                    json={"instructions": [_entry()]}),
        client.get("/api/v1/ibkr/instructions", headers=ADMIN),
        client.delete("/api/v1/ibkr/instructions/INS-1", headers=ADMIN),
        client.post("/api/v1/ibkr/mcp/call", headers=ADMIN,
                    json={"name": "get_account_positions", "args": {}}),
        client.get("/api/v1/ibkr/auth/status"),
    ]
    for resp in responses:
        assert resp.status_code in (200, 404), (resp.status_code, resp.text)
        assert "LEAK-ACCESS-XYZ" not in resp.text
        assert "LEAK-REFRESH-XYZ" not in resp.text
