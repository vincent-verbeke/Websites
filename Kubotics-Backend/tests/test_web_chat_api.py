"""API tests for the website CTA chat endpoint (POST /api/v1/chat/message).

Contract (Vincent 2026-11-11): the website CTA chat must answer through the
SAME LLM provider chain the chat/mail agent uses (mail_llm: MiMo -> OpenAI ->
Gemini -> Grok), combined with conversation history + page context, and fall
back to the canned keyword reply when the chain is unavailable.

No DB, no network: TestClient never enters the app lifespan and the LLM call
is monkeypatched — same pattern rationale as tests/test_mail_agent_api.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastapi.testclient import TestClient

from app.api.v1 import endpoints as ep
from app.services import mail_llm
from app.main import app

client = TestClient(app)  # NO context manager -> lifespan (loops/DDL) never runs


def _post(message: str, **extra):
    payload = {"session_token": "test-session", "message": message}
    payload.update(extra)
    return client.post("/api/v1/chat/message", json=payload)


def test_reply_comes_from_llm_chain_with_context(monkeypatch):
    """Happy path: reply text is the LLM's, built from history + page context."""
    captured = {}

    async def fake_chat_text(system, user):
        captured["system"] = system
        captured["user"] = user
        return "Grüezi! Here is my considered answer.", "mimo", "model-x"

    monkeypatch.setattr(ep.mail_llm, "chat_text", fake_chat_text)

    r = _post(
        "Was kostet die Automatisierung?",
        history=[
            {"role": "user", "content": "Wir sind ein 40-personen Betrieb."},
            {"role": "assistant", "content": "Verstanden, danke."},
        ],
        extracted_context={"page": "/marketing/ai-marketing-sales",
                           "topic": "ai_marketing_sales"},
    )

    assert r.status_code == 200
    d = r.json()
    assert d["reply"] == "Grüezi! Here is my considered answer."
    assert d["session_token"] == "test-session"
    # context actually reached the model
    assert "FULLY AUTOMATED AI-DRIVEN MARKETING" in captured["system"]
    assert "/marketing/ai-marketing-sales" in captured["user"]
    assert "Wir sind ein 40-personen Betrieb." in captured["user"]
    assert "Visitor's latest message: Was kostet die Automatisierung?" in \
        captured["user"]
    # history is capped (rolling window) — 12 turns max, 1000 chars each
    big_history = [
        {"role": "user", "content": "x" * 5000} for _ in range(30)
    ]
    _post("und dann?", history=big_history)
    assert captured["user"].count("x" * 1000 + "xxx") == 0


def test_falls_back_to_keyword_reply_when_llm_unavailable(monkeypatch):
    """Provider chain down -> 200 with the canned reply, never a 500."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("all providers failed: mimo:HTTP500")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    r = _post("Do you automate invoices?")
    assert r.status_code == 200
    d = r.json()
    assert ">98.5% accuracy" in d["reply"]   # canned invoice reply
    assert d["lead_qualified"] is False


def test_marketing_intent_signals_and_fallback(monkeypatch):
    """New product gets its own quick replies + marketing fallback copy."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    r = _post("Wir wollen unsere Leadgenerierung automatisieren (marketing)")
    assert r.status_code == 200
    d = r.json()
    assert d["quick_replies"] == [
        "Show me the setup", "Book a discovery call", "Pricing & caps"
    ]
    assert "fully automated AI-driven marketing & sales" in d["reply"]


def test_h2_intent_keeps_booking_link_and_qualification(monkeypatch):
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    r = _post("I want an H2 test day")
    d = r.json()
    assert d["lead_qualified"] is True
    assert d["meeting_link"] and "bookings.cloud.microsoft" in d["meeting_link"]
    assert d["quick_replies"][0] == "Book M365 Calendar"


def test_llm_reply_wins_over_fallback_but_signals_survive(monkeypatch):
    """With the LLM up: custom reply text + keyword-driven quick replies."""
    async def fake_chat_text(system, user):
        return "Individuelle Antwort.", "gemini", "model-g"

    monkeypatch.setattr(ep.mail_llm, "chat_text", fake_chat_text)

    r = _post("cnc machine tending pricing?")
    d = r.json()
    assert d["reply"] == "Individuelle Antwort."
    assert "CNC Machine Tending" in d["quick_replies"]


def test_empty_llm_reply_uses_fallback(monkeypatch):
    """A 200-but-blank model answer must not reach the visitor."""
    async def empty(system, user):
        return "   ", "mimo", "model-x"

    monkeypatch.setattr(ep.mail_llm, "chat_text", empty)

    r = _post("hello")
    assert r.status_code == 200
    assert "Kubotics Sales Engineer" in r.json()["reply"]


def test_markdown_emphasis_is_stripped_from_llm_reply(monkeypatch):
    """The widget renders plain text — raw ** must never reach a visitor."""
    async def md(system, user):
        return ("**Setup:** CRM + Agents.\n\n"
                "## Monthly budget\nUse `spend caps` and *your approval*."), \
               "mimo", "model-x"

    monkeypatch.setattr(ep.mail_llm, "chat_text", md)

    r = _post("Wie funktioniert das Pricing?")
    d = r.json()
    assert "**" not in d["reply"]
    assert "##" not in d["reply"]
    assert "`" not in d["reply"]
    assert "Setup: CRM + Agents." in d["reply"]
    assert "spend caps" in d["reply"]
    assert "your approval" in d["reply"]


def test_payload_validation():
    """Oversized / empty messages are rejected by the schema (422)."""
    assert _post("").status_code == 422
    assert _post("x" * 4001).status_code == 422
