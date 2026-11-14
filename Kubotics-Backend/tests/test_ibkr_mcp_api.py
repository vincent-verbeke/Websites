"""API tests for the IBKR MCP auth/control router (no network, no real DB).

Wiring covered: disabled-by-default inertness (503s, no poller), admin gating,
auth start -> authorize_url, callback state validation (bad state, TTL, single
use), happy-path code exchange with mocked httpx layer, and status/refresh.

Run:  uv run pytest tests/test_ibkr_mcp_api.py -q
Docs: docs/IBKR_MCP_BACKEND.md
"""
from __future__ import annotations

import urllib.parse
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.services import ibkr_mcp as ib

from .ibkr_helpers import FakeDb, seed_tokens

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


def test_enabled_without_redirect_uri_stays_inert(client, monkeypatch):
    monkeypatch.setattr(settings, "IBKR_MCP_ENABLED", True)
    monkeypatch.setattr(settings, "IBKR_MCP_REDIRECT_URI", "")

    assert client.post("/api/v1/ibkr/auth/start", headers=ADMIN).status_code == 503
    assert ib.maybe_start_poller() is None


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
