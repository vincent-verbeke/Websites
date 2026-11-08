"""API tests for the Kubot mail agent admin endpoints (build step 5).

No DB, no network: the TestClient never enters the app lifespan (no loops,
no create_all) and DB-touching helpers are monkeypatched — same pattern
rationale as tests/test_needle_api.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastapi.testclient import TestClient

from app.api.v1 import mail_agent as api
from app.core.config import settings
from app.main import app

client = TestClient(app)  # NO context manager -> lifespan (loops/DDL) never runs
AUTH = {"Authorization": f"Bearer {settings.API_SECRET_KEY}"}


def test_requires_bearer_when_secret_set():
    assert settings.API_SECRET_KEY, "local .env must carry API_SECRET_KEY"
    r = client.get("/api/v1/mail/status")
    assert r.status_code == 401


def test_status_reports_effective_config(monkeypatch):
    async def fake_counts():
        return {"received": 3, "replied": 1}

    async def fake_wm():
        return "2026-11-08T10:00:00Z"

    monkeypatch.setattr(api, "_state_counts", fake_counts)
    monkeypatch.setattr(api.mail_agent_service, "get_watermark", fake_wm)
    monkeypatch.setattr(api.mail_agent_service, "last_cycle",
                        lambda: {"ts": "2026-11-08T10:00:00Z", "claimed": 0})
    r = client.get("/api/v1/mail/status", headers=AUTH)
    assert r.status_code == 200
    d = r.json()
    assert d["enabled"] is False                     # Phase 0 contract
    assert d["mode"] == "auto"
    assert d["llm_chain"] == "mimo,openai,gemini,xai"  # Q3 order visible
    assert d["alert_window"] == "07:30-22:00 Europe/Zurich"  # Q11
    assert d["unknown_policy"] == "auto"               # Q2
    assert d["state_counts"] == {"received": 3, "replied": 1}
    assert d["watermark"] == "2026-11-08T10:00:00Z"
    assert d["last_cycle"]["claimed"] == 0


def test_status_honours_last_cycle_default(monkeypatch):
    async def fake_counts():
        return {}

    async def fake_wm():
        return None

    monkeypatch.setattr(api, "_state_counts", fake_counts)
    monkeypatch.setattr(api.mail_agent_service, "get_watermark", fake_wm)
    monkeypatch.setattr(api.mail_agent_service, "last_cycle", dict)
    r = client.get("/api/v1/mail/status", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["last_cycle"] == {}


def test_sender_create_validates_email_before_db():
    r = client.post("/api/v1/mail/senders", headers=AUTH,
                    json={"email": "not-an-email"})
    assert r.status_code == 422   # pydantic pattern -> never reaches the handler
    r2 = client.post("/api/v1/mail/senders", headers=AUTH,
                     json={"email": "a@b"})
    assert r2.status_code == 422


def test_messages_limit_bounds():
    assert client.get("/api/v1/mail/messages?limit=9999",
                      headers=AUTH).status_code == 422   # le=MAX_MESSAGES
    assert client.get("/api/v1/mail/messages?limit=0",
                      headers=AUTH).status_code == 422   # ge=1


def test_poll_forwards_stats(monkeypatch):
    async def fake_run():
        return {"claimed": 2, "proc_ready": 1}

    monkeypatch.setattr(api.mail_agent_service, "run_once", fake_run)
    r = client.post("/api/v1/mail/poll", headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "stats": {"claimed": 2, "proc_ready": 1}}


def test_poll_surfaces_cycle_errors(monkeypatch):
    async def boom():
        raise RuntimeError("cycle exploded")

    monkeypatch.setattr(api.mail_agent_service, "run_once", boom)
    r = client.post("/api/v1/mail/poll", headers=AUTH)
    assert r.status_code == 500
    assert "cycle exploded" in r.json()["detail"]


def test_router_is_mounted_in_openapi():
    spec = client.get("/api/v1/openapi.json").json()   # app.openapi_url is prefixed
    paths = [p for p in spec["paths"] if p.startswith("/api/v1/mail/")]
    assert {"/api/v1/mail/status", "/api/v1/mail/senders",
            "/api/v1/mail/messages", "/api/v1/mail/poll"} <= set(paths)
