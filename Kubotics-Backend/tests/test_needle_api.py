"""Tests for the needle3 operator intake API and the WhatsApp operator route.

No network and no real database: the get_db dependency is overridden with an
in-memory fake session, and the WhatsApp background collaborators
(agent_core, whatsapp_service) are stubbed.
"""
from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Select
from sqlalchemy.sql.elements import BinaryExpression

from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.needle import NeedleInbox

ROW_KEYS = {
    "id",
    "ts",
    "sender",
    "wamid",
    "text",
    "kind",
    "status",
    "session",
    "reply",
    "reply_ts",
    "meta",
}


# --------------------------------------------------------------------------- #
# In-memory fake AsyncSession: covers exactly the calls the handlers make.     #
# --------------------------------------------------------------------------- #
class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalarResult(self._rows)


def _unwrap_name(clause):
    element = clause
    while hasattr(element, "element"):
        element = element.element
    name = getattr(element, "name", None)
    if not isinstance(name, str):
        raise TypeError(f"unsupported SQL clause in fake session: {clause!r}")
    return name


def _eval_where(clause, row):
    if isinstance(clause, BinaryExpression):
        left_name = _unwrap_name(clause.left)
        right = clause.right
        right_value = getattr(right, "value", right)
        return bool(clause.operator(getattr(row, left_name), right_value))
    raise AssertionError(f"unsupported WHERE clause in fake session: {clause!r}")


class FakeNeedleSession:
    """Minimal in-memory stand-in for sqlalchemy.ext.asyncio.AsyncSession."""

    def __init__(self):
        self.rows: list[NeedleInbox] = []
        self._pending: list[NeedleInbox] = []

    # -- unit of work ---------------------------------------------------------
    def add(self, obj):
        self._pending.append(obj)

    async def commit(self):
        for obj in self._pending:
            if obj.id is None:
                obj.id = max((row.id for row in self.rows), default=0) + 1
            if obj.ts is None:
                obj.ts = datetime.now(UTC)
            if obj.kind is None:
                obj.kind = "in"
            if obj.status is None:
                obj.status = "new"
            if obj.meta is None:
                obj.meta = {}
            self.rows.append(obj)
        self._pending.clear()

    async def refresh(self, obj):
        return None

    async def get(self, model, ident):
        assert model is NeedleInbox
        for row in self.rows:
            if row.id == ident:
                return row
        return None

    async def execute(self, stmt):
        if not isinstance(stmt, Select):
            raise TypeError(f"fake session only supports Select, got {stmt!r}")
        rows = list(self.rows)

        whereclause = stmt.whereclause
        if whereclause is not None:
            rows = [row for row in rows if _eval_where(whereclause, row)]

        for clause in reversed(list(stmt._order_by_clauses or ())):
            name = _unwrap_name(clause)
            descending = "DESC" in str(clause).upper()
            rows.sort(key=lambda row, _name=name: getattr(row, _name), reverse=descending)

        limit = stmt._limit
        if limit is not None:
            rows = rows[: int(limit)]
        return _FakeResult(rows)


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
@pytest.fixture()
def fake_db():
    return FakeNeedleSession()


@pytest.fixture()
def client(fake_db, monkeypatch):
    # .env may set NEEDLE_TOKEN (the live needle3 daemon uses one), so never rely
    # on the ambient value: functional tests force the token off here, and the
    # auth tests re-set it explicitly afterwards (same monkeypatch instance).
    monkeypatch.setattr(settings, "NEEDLE_TOKEN", "")
    # Plain TestClient (no context manager): the FastAPI lifespan -- and with it
    # Base.metadata.create_all against the real Postgres -- must not run.
    app.dependency_overrides[get_db] = lambda: fake_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def operator_senders(monkeypatch):
    # Comma-separated with whitespace to exercise the strip/comma parsing.
    monkeypatch.setattr(settings, "NEEDLE_OPERATOR_SENDERS", " +41797481975 , +41446668888 ")


def _inject(client, text="hello needle", sender=None):
    body = {"text": text}
    if sender is not None:
        body["sender"] = sender
    resp = client.post("/api/v1/needle/inject", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --------------------------------------------------------------------------- #
# GET/POST /api/v1/needle/*                                                   #
# --------------------------------------------------------------------------- #
def test_inject_returns_new_row(client):
    body = _inject(client, "needle3 test message")

    assert isinstance(body["id"], int) and body["id"] >= 1
    assert body["status"] == "new"
    assert body["kind"] == "in"
    assert body["sender"] == "+41797481975"
    assert body["text"] == "needle3 test message"
    assert body["wamid"] is None
    assert body["session"] is None
    assert body["reply"] is None
    assert body["reply_ts"] is None
    assert body["meta"] == {"injected": True}
    datetime.fromisoformat(body["ts"])  # ISO string, as pinned


def test_inbox_empty_table_latest_id_zero(client):
    data = client.get("/api/v1/needle/inbox").json()
    assert data == {"messages": [], "latest_id": 0}


def test_inbox_after_id_paging_and_latest_id(client):
    first = _inject(client, "one")
    second = _inject(client, "two")

    data = client.get("/api/v1/needle/inbox").json()
    assert [m["id"] for m in data["messages"]] == [first["id"], second["id"]]
    assert data["latest_id"] == second["id"]
    assert set(data["messages"][0]) == ROW_KEYS
    assert data["messages"][0]["ts"] == first["ts"]

    data = client.get("/api/v1/needle/inbox", params={"after_id": first["id"]}).json()
    assert [m["id"] for m in data["messages"]] == [second["id"]]
    assert data["latest_id"] == second["id"]

    data = client.get("/api/v1/needle/inbox", params={"after_id": second["id"]}).json()
    assert data["messages"] == []
    assert data["latest_id"] == second["id"]


def test_ack_updates_status_session_reply_and_reply_ts(client):
    row = _inject(client, "please dispatch")

    resp = client.post(
        "/api/v1/needle/ack",
        json={
            "id": row["id"],
            "status": "dispatched",
            "session": "sess-42",
            "reply": "working on it",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    updated = body["row"]
    assert set(updated) == ROW_KEYS
    assert updated["status"] == "dispatched"
    assert updated["session"] == "sess-42"
    assert updated["reply"] == "working on it"
    assert updated["reply_ts"] is not None
    datetime.fromisoformat(updated["reply_ts"])

    # persisted view through GET /inbox
    data = client.get("/api/v1/needle/inbox").json()
    assert data["messages"][0]["status"] == "dispatched"
    assert data["messages"][0]["reply_ts"] == updated["reply_ts"]


def test_ack_without_reply_leaves_reply_ts_null(client):
    row = _inject(client)
    resp = client.post("/api/v1/needle/ack", json={"id": row["id"], "status": "done"})
    assert resp.status_code == 200
    updated = resp.json()["row"]
    assert updated["status"] == "done"
    assert updated["reply_ts"] is None
    assert updated["session"] is None


def test_ack_unknown_id_404(client):
    resp = client.post("/api/v1/needle/ack", json={"id": 9999, "status": "done"})
    assert resp.status_code == 404


def test_ack_bad_status_422(client):
    row = _inject(client)
    resp = client.post("/api/v1/needle/ack", json={"id": row["id"], "status": "bogus"})
    assert resp.status_code == 422


# --------------------------------------------------------------------------- #
# Auth                                                                        #
# --------------------------------------------------------------------------- #
def test_auth_missing_header_401(client, monkeypatch):
    monkeypatch.setattr(settings, "NEEDLE_TOKEN", "s3cret-token")

    resp = client.get("/api/v1/needle/inbox")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "needle token required"}

    resp = client.post("/api/v1/needle/inject", json={"text": "blocked"})
    assert resp.status_code == 401
    resp = client.post("/api/v1/needle/ack", json={"id": 1, "status": "done"})
    assert resp.status_code == 401


def test_auth_correct_header_200(client, monkeypatch):
    monkeypatch.setattr(settings, "NEEDLE_TOKEN", "s3cret-token")
    headers = {"X-Needle-Token": "s3cret-token"}

    resp = client.get("/api/v1/needle/inbox", headers=headers)
    assert resp.status_code == 200

    resp = client.post(
        "/api/v1/needle/inject", json={"text": "with token"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["meta"] == {"injected": True}

    # wrong token is rejected as well
    resp = client.get("/api/v1/needle/inbox", headers={"X-Needle-Token": "nope"})
    assert resp.status_code == 401


# --------------------------------------------------------------------------- #
# WhatsApp operator route                                                     #
# --------------------------------------------------------------------------- #
def _webhook_payload(sender, text, msg_id="wamid.test.1"):
    return {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "contacts": [{"profile": {"name": "Vincent"}, "wa_id": sender}],
                            "messages": [
                                {
                                    "from": sender,
                                    "id": msg_id,
                                    "type": "text",
                                    "text": {"body": text},
                                }
                            ],
                        }
                    }
                ]
            }
        ]
    }


class _ExplosiveAgentCore:
    """process_inbound must never run for operator-lane messages."""

    def __init__(self):
        self.calls = []

    async def process_inbound(self, envelope, session):
        self.calls.append(envelope)
        raise AssertionError("agent_core.process_inbound called for operator message")


class _StubAgentCore:
    def __init__(self):
        self.calls = []

    async def process_inbound(self, envelope, session):
        self.calls.append(envelope)
        return SimpleNamespace(reply="stub agent reply")


class _StubWhatsAppService:
    def __init__(self):
        self.sent = []

    async def send_text_message(self, recipient, text):
        self.sent.append((recipient, text))
        return True


def test_operator_message_routed_to_needle_not_agent(
    client, fake_db, monkeypatch, operator_senders
):
    agent = _ExplosiveAgentCore()
    whatsapp = _StubWhatsAppService()
    monkeypatch.setattr("app.api.whatsapp.agent_core", agent)
    monkeypatch.setattr("app.api.whatsapp.whatsapp_service", whatsapp)

    resp = client.post(
        "/api/whatsapp/webhook",
        json=_webhook_payload("+41797481975", "dispatch a fix now"),
    )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "routed": "needle"}

    assert len(fake_db.rows) == 1
    row = fake_db.rows[0]
    assert row.sender == "+41797481975"
    assert row.text == "dispatch a fix now"
    assert row.wamid == "wamid.test.1"
    assert row.kind == "in"
    assert row.status == "new"
    assert row.meta == {}

    assert agent.calls == []
    assert whatsapp.sent == []

    # visible through the needle API too
    data = client.get("/api/v1/needle/inbox").json()
    assert [m["text"] for m in data["messages"]] == ["dispatch a fix now"]


def test_non_operator_message_keeps_agent_core_path(
    client, fake_db, monkeypatch, operator_senders
):
    agent = _StubAgentCore()
    whatsapp = _StubWhatsAppService()
    monkeypatch.setattr("app.api.whatsapp.agent_core", agent)
    monkeypatch.setattr("app.api.whatsapp.whatsapp_service", whatsapp)

    resp = client.post(
        "/api/whatsapp/webhook",
        json=_webhook_payload("+41440000111", "hello sales team", msg_id="wamid.test.2"),
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    assert len(agent.calls) == 1
    envelope = agent.calls[0]
    assert envelope.channel == "whatsapp"
    assert envelope.external_user_id == "+41440000111"
    assert envelope.message == "hello sales team"
    assert whatsapp.sent == [("+41440000111", "stub agent reply")]

    # no needle row was created for the non-operator sender
    assert fake_db.rows == []
