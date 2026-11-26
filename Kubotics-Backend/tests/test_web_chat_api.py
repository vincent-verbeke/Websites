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
        "Show me the setup", "Pricing & caps", "Which channel first?"
    ]
    assert "fully automated AI-driven marketing & sales" in d["reply"]
    # no meeting chip before the qualification turns (Vincent 2026-11-23)
    assert not any("book" in chip.lower() for chip in d["quick_replies"])


def test_h2_intent_waits_for_qualification_before_meeting(monkeypatch):
    """Vincent 2026-11-26: turns 0-4 are qualifying questions only (3 to 5
    steps digging into the expectations); the closing turn (turn_count >= 5)
    asks email + phone and proposes the meeting with the booking link."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    history: list[dict] = []
    for turn, msg in enumerate([
        "I want an H2 test day",
        "It is for a research pilot",
        "Timeline is Q1 next year",
        "Our team evaluates the unit",
        "Budget is approved for pilots",
    ]):
        d = _post(msg, history=history).json()
        # no meeting before turn 5: qualifying question only
        assert d["lead_qualified"] is False, f"turn {turn} closed too early"
        assert d["meeting_link"] is None, f"turn {turn} carries a booking link"
        assert not any("book" in chip.lower() for chip in d["quick_replies"]), \
            f"turn {turn} offers a booking chip"
        assert "?" in d["reply"]
        assert "bookings.cloud.microsoft" not in d["reply"]
        history.append({"role": "user", "content": msg})
        history.append({"role": "assistant", "content": d["reply"]})

    # turn_count 5: closing message
    d5 = _post("Let us continue", history=history).json()
    assert d5["lead_qualified"] is True
    assert d5["meeting_link"] and "bookings.cloud.microsoft" in d5["meeting_link"]
    # closing turn offers a booking chip (keywords are classified per message)
    assert d5["quick_replies"][0].startswith("Book")
    # closing copy: email + phone first, then the meeting
    assert "email address" in d5["reply"] and "phone number" in d5["reply"]
    assert "bookings.cloud.microsoft" in d5["reply"]


def test_booking_intent_skips_qualification_at_any_stage(monkeypatch):
    """Vincent 2026-11-26: an explicit booking request is never blocked by
    the question flow — it closes even on the very first message."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    d = _post("Can we book a 15-minute call this week?").json()
    assert d["lead_qualified"] is True
    assert d["meeting_link"] and "bookings.cloud.microsoft" in d["meeting_link"]
    assert "email address" in d["reply"] and "phone number" in d["reply"]
    assert "bookings.cloud.microsoft" in d["reply"]


def test_volunteered_email_and_phone_close_early_from_turn_three(monkeypatch):
    """Both contact details already in the conversation -> the closing turn
    fires from turn_count 3 on; before that the 3-question floor holds."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    base: list[dict] = [
        {"role": "user", "content": "mail me at lead@example.ch"},
        {"role": "assistant", "content": "Verstanden, eine Frage."},
        {"role": "user", "content": "or call +41 79 123 45 67"},
        {"role": "assistant", "content": "Danke, noch eine Frage."},
    ]
    # floor: turn_count 2 with both details still qualifies
    d2 = _post("und weiter?", history=base).json()
    assert d2["lead_qualified"] is False
    assert d2["meeting_link"] is None
    assert "?" in d2["reply"]

    # turn_count 3: closes early — email + phone first, then the meeting
    history3 = base + [
        {"role": "user", "content": "klingt gut"},
        {"role": "assistant", "content": "Noch eine Frage."},
    ]
    d3 = _post("und weiter?", history=history3).json()
    assert d3["lead_qualified"] is True
    assert d3["meeting_link"] and "bookings.cloud.microsoft" in d3["meeting_link"]
    assert "email address" in d3["reply"] and "phone number" in d3["reply"]
    assert "bookings.cloud.microsoft" in d3["reply"]


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


# --- Vincent 2026-11-23: offer injection, personal/language rules,
# --- landing-page-dependent default sentence ---------------------------


def test_llm_turn_carries_offer_injection_and_style_rules(monkeypatch):
    """The LLM turn must carry the landing page's OFFER data and the prompt
    must pin the personal / language / page-dependent rules."""
    captured = {}

    async def fake_chat_text(system, user):
        captured["system"] = system
        captured["user"] = user
        return "Persönliche Antwort.", "mimo", "model-x"

    monkeypatch.setattr(ep.mail_llm, "chat_text", fake_chat_text)

    r = _post(
        "Welcher Prozess lässt sich automatisieren?",
        extracted_context={"page": "/automation/it-business-process-automation",
                           "language": "de-CH"},
    )
    assert r.status_code == 200
    # the specific offer of the IT-BPA landing page is injected
    assert "Offer of the landing page" in captured["user"]
    assert "Free Automation Analysis" in captured["user"]
    assert "within 1 working day" in captured["user"]
    # the prompt pins: language of the user, personal, page-dependent opening
    assert "ALWAYS answer in the language of the visitor's latest message" in \
        captured["system"]
    assert "Be personal:" in captured["system"]
    assert "must fit THAT page" in captured["system"]
    assert "language=de-CH" in captured["user"]


def test_no_offer_injected_on_home_but_portfolio_prompt_stays(monkeypatch):
    """Pages without a defined offer get no offer block (no fabrication)."""
    captured = {}

    async def fake_chat_text(system, user):
        captured["user"] = user
        return "ok", "mimo", "model-x"

    monkeypatch.setattr(ep.mail_llm, "chat_text", fake_chat_text)

    _post("hello", extracted_context={"page": "/", "language": "en-US"})
    assert "Offer of the landing page" not in captured["user"]
    assert "Visitor page context: page=/" in captured["user"]


def test_fallback_answers_in_the_visitors_language(monkeypatch):
    """LLM down -> German visitor gets German canned copy + German chips."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    d = _post(
        "hallo, was können Sie automatisieren?",
        extracted_context={"page": "/", "language": "de-CH"},
    ).json()
    assert "Ich bin Ihr Kubotics Sales Engineer" in d["reply"]
    assert d["quick_replies"][0] == "Unitree H2 Testtag"

    # French visitor -> French copy
    d_fr = _post(
        "bonjour, que pouvez-vous automatiser ?",
        extracted_context={"page": "/", "language": "fr-CH"},
    ).json()
    assert "Je suis votre Sales Engineer Kubotics" in d_fr["reply"]

    # English visitor (explicit locale) -> original English copy untouched
    d_en = _post(
        "hello, what do you automate?",
        extracted_context={"page": "/", "language": "en-US"},
    ).json()
    assert "I am the Kubotics Sales Engineer" in d_en["reply"]


def test_default_reply_depends_on_the_landing_page(monkeypatch):
    """No intent keyword on the IT-BPA landing page -> THAT page's offer is
    the default sentence, in the visitor's language (Vincent 2026-11-23)."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    page = "/automation/it-business-process-automation"

    d_de = _post(
        "grüezi",
        extracted_context={"page": page, "language": "de-CH"},
    ).json()
    assert "IT- & Geschäftsprozess-Automatisierung" in d_de["reply"]
    assert d_de["quick_replies"][0] == "Kostenlose Automatisierungsanalyse"

    d_en = _post(
        "hi",
        extracted_context={"page": page, "language": "en-US"},
    ).json()
    assert "You are on our IT & business process automation page" in d_en["reply"]
    assert d_en["quick_replies"][0] == "Free automation analysis"


def test_localized_closing_turn_keeps_structured_signals(monkeypatch):
    """German visitor reaching the closing turn: German email+phone ask with
    the booking link, while lead_qualified/meeting_link stay the signals of
    `_intent_signals`. Here it closes EARLY: both contact details are already
    in the conversation and turn_count >= MIN_EARLY_CLOSE_TURN (Vincent
    2026-11-26)."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    history = [
        {"role": "user", "content": "ich brauche automatisierung"},
        {"role": "assistant", "content": "gerne, eine Frage"},
        {"role": "user",
         "content": "es geht um unsere rechnungen, mail: einkauf@firma.ch"},
        {"role": "assistant", "content": "verstanden"},
        {"role": "user", "content": "unser telefon ist +41 44 123 45 67"},
        {"role": "assistant", "content": "danke, noch eine frage"},
    ]
    d = _post(
        "zeitrahmen ist q1",
        history=history,
        extracted_context={"language": "de-CH"},
    ).json()
    assert d["lead_qualified"] is True
    assert d["meeting_link"] and "bookings.cloud.microsoft" in d["meeting_link"]
    assert "E-Mail-Adresse" in d["reply"] and "Telefonnummer" in d["reply"]
    assert "bookings.cloud.microsoft" in d["reply"]


def test_localized_turns_run_five_progressive_qualifying_stages(monkeypatch):
    """German visitor, LLM down: turns 0-4 serve 5 progressive qualifying
    questions in German (LOCALIZED_FALLBACK + QUALIFYING_TEXTS), never a
    meeting ask; the closing turn (>=5) switches to the German email+phone
    ask with the booking link."""
    async def boom(system, user):
        raise mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ep.mail_llm, "chat_text", boom)

    ctx = {"language": "de-CH"}
    history: list[dict] = []
    replies = []
    for turn, msg in enumerate([
        "hallo, wir brauchen automatisierung",
        "es geht um unsere rechnungen",
        "das volumen ist rund 800 belege pro monat",
        "erfolg heisst weniger manuelle tipparbeit",
        "budget und timeline stehen",
    ]):
        d = _post(msg, history=history, extracted_context=ctx).json()
        assert d["lead_qualified"] is False, f"turn {turn} closed too early"
        assert d["meeting_link"] is None, f"turn {turn} carries a booking link"
        assert not any("book" in chip.lower() for chip in d["quick_replies"])
        assert "?" in d["reply"]
        assert "bookings.cloud.microsoft" not in d["reply"]
        replies.append(d["reply"])
        history.append({"role": "user", "content": msg})
        history.append({"role": "assistant", "content": d["reply"]})
    assert len(set(replies)) == 5       # progressive, not the same text 5x

    d5 = _post("bitte weiter", history=history, extracted_context=ctx).json()
    assert d5["lead_qualified"] is True
    assert d5["meeting_link"] and "bookings.cloud.microsoft" in d5["meeting_link"]
    assert "E-Mail-Adresse" in d5["reply"] and "Telefonnummer" in d5["reply"]
    assert "bookings.cloud.microsoft" in d5["reply"]
