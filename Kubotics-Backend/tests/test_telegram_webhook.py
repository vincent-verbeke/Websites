"""Telegram webhook hardening — secret_token enforcement (2026-11-15).

Telegram's setWebhook now carries a secret_token; the adapter must reject
anything else with 403 BEFORE agent processing, and skip the check entirely
when TELEGRAM_WEBHOOK_SECRET is unset (default-off, local dev unaffected).
No network: the agent core is stubbed and settings.TELEGRAM_BOT_TOKEN is
forced empty so the reply branch never calls the Telegram API.
"""

from types import SimpleNamespace

from fastapi.testclient import TestClient

import app.api.v1.channel_adapters as ca
from app.core.config import settings
from app.db.session import get_db
from app.main import app

SECRET = "unit-webhook-secret-42"
VALID_BODY = {
    "update_id": 1,
    "message": {
        "date": 1,
        "text": "hello kubotics",
        "chat": {"id": 777888, "first_name": "Vincent"},
        "from": {"id": 777888, "first_name": "Vincent"},
    },
}
HDR = {"X-Telegram-Bot-Api-Secret-Token": SECRET}


def _mk_client() -> TestClient:
    app.dependency_overrides[get_db] = lambda: object()
    return TestClient(app)


def _stub_agent(calls: list):
    async def fake_process_inbound(envelope, db):
        calls.append(envelope)
        return SimpleNamespace(reply="pong", conversation_id="c1")

    return fake_process_inbound


def test_secret_unset_skips_validation(monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
    calls = []
    monkeypatch.setattr(ca.agent_core, "process_inbound", _stub_agent(calls))
    client = _mk_client()
    try:
        r = client.post("/api/v1/channels/telegram/webhook", json=VALID_BODY)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        assert len(calls) == 1 and calls[0].channel == "telegram"
        assert calls[0].message == "hello kubotics"
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_secret_set_missing_header_403_agent_never_called(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
    calls = []
    monkeypatch.setattr(ca.agent_core, "process_inbound", _stub_agent(calls))
    client = _mk_client()
    try:
        r = client.post("/api/v1/channels/telegram/webhook", json=VALID_BODY)
        assert r.status_code == 403, r.text
        assert "invalid webhook secret" in r.text
        assert calls == []
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_secret_set_wrong_header_403(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
    calls = []
    monkeypatch.setattr(ca.agent_core, "process_inbound", _stub_agent(calls))
    client = _mk_client()
    try:
        r = client.post(
            "/api/v1/channels/telegram/webhook",
            json=VALID_BODY,
            headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
        )
        assert r.status_code == 403, r.text
        assert calls == []
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_secret_set_correct_header_processes(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")  # no outbound call
    calls = []
    monkeypatch.setattr(ca.agent_core, "process_inbound", _stub_agent(calls))
    client = _mk_client()
    try:
        r = client.post(
            "/api/v1/channels/telegram/webhook",
            json=VALID_BODY,
            headers=HDR,
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        assert len(calls) == 1
        assert calls[0].external_user_id == "777888"
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_secret_set_nontext_ignored_after_validation(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
    calls = []
    monkeypatch.setattr(ca.agent_core, "process_inbound", _stub_agent(calls))
    client = _mk_client()
    try:
        body = {"update_id": 2, "message": {"chat": {"id": 1}, "date": 1}}
        r = client.post(
            "/api/v1/channels/telegram/webhook", json=body, headers=HDR
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "status": "ignored_non_text"}
        assert calls == []
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_schema_rejects_empty_body_before_secret_check(monkeypatch):
    """Body validation (422) runs before the handler — proves ordering: an
    unauthenticated garbage POST can never reach agent processing."""
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    calls = []
    monkeypatch.setattr(ca.agent_core, "process_inbound", _stub_agent(calls))
    client = _mk_client()
    try:
        r = client.post("/api/v1/channels/telegram/webhook", json={})
        assert r.status_code == 422, r.status_code
        assert calls == []
    finally:
        app.dependency_overrides.pop(get_db, None)
