"""Vincent 2026-11-23: "pls LLM + Offer Context in Whatsapp".

The WhatsApp / Telegram / Teams agent core must answer through the SAME
provider chain (mail_llm) and the SAME shared system prompt as the website
chat, with the offer matching the message topic injected as context. The
canned stage reply stays the reply whenever the chain fails or the model's
text breaks the 2-qualifying-turns workflow.

No DB, no network: `_llm_reply` runs against a stubbed `chat_text`, the
workflow guards run against the pure `_merge_llm_reply`.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.schemas.channel_dto import NormalizedChannelMessage
from app.services import agent_core as ac
from app.services.chat_context import PAGE_OFFERS, offer_context_block

agent = ac.agent_core


def _envelope(text: str, channel: str = "whatsapp") -> NormalizedChannelMessage:
    return NormalizedChannelMessage(
        channel=channel,
        external_user_id="41790000000",
        external_conversation_id="41790000000",
        external_username="Test Lead",
        message=text,
    )


def _canned(text: str, stage: int):
    return agent._run_agent_reasoning(text, stage)


# --------------------------------------------------------------------------- #
# the LLM turn: shared prompt + offer context + history                        #
# --------------------------------------------------------------------------- #
def test_llm_turn_carries_shared_prompt_offer_and_history(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_chat_text(system, user):
        captured["system"] = system
        captured["user"] = user
        return "**Grüezi!** Welches monatliche Volumen haben Sie?", "mimo", "mx"

    monkeypatch.setattr(ac.mail_llm, "chat_text", fake_chat_text)

    reply = asyncio.run(
        agent._llm_reply(
            _envelope("Wie viele Rechnungen verarbeiten Sie pro Monat?"),
            [
                {"role": "user", "content": "Grüezi, wir brauchen Automation"},
                {"role": "assistant", "content": "Worum geht es genau?"},
            ],
        )
    )

    # markdown stripped: WhatsApp must not show raw ** markers
    assert reply == "Grüezi! Welches monatliche Volumen haben Sie?"
    # the SAME system prompt the website chat uses
    assert "FULLY AUTOMATED AI-DRIVEN MARKETING & SALES" in captured["system"]
    assert "QUALIFICATION FLOW (fixed, no exceptions)" in captured["system"]
    # channel + offer context (invoice offer figures) + history + latest msg
    assert "Channel: whatsapp" in captured["user"]
    assert "98.5%" in captured["user"]
    assert "CHF 35'000" in captured["user"]
    assert "Conversation so far:" in captured["user"]
    assert "Contact: Grüezi, wir brauchen Automation" in captured["user"]
    assert "Kubotics: Worum geht es genau?" in captured["user"]
    assert captured["user"].rstrip().endswith(
        "Contact's latest message: Wie viele Rechnungen verarbeiten Sie pro Monat?"
    )


def test_llm_turn_returns_none_when_chain_fails(monkeypatch):
    async def boom(system, user):
        raise ac.mail_llm.LLMUnavailable("chain down")

    monkeypatch.setattr(ac.mail_llm, "chat_text", boom)

    assert (
        asyncio.run(agent._llm_reply(_envelope("Hallo"), [])) is None
    )


def test_llm_turn_returns_none_on_empty_model_output(monkeypatch):
    async def empty(system, user):
        return "   ", "mimo", "mx"

    monkeypatch.setattr(ac.mail_llm, "chat_text", empty)
    assert asyncio.run(agent._llm_reply(_envelope("Hallo"), [])) is None


# --------------------------------------------------------------------------- #
# offer context selection (page path is missing on messaging channels)         #
# --------------------------------------------------------------------------- #
def test_offer_context_follows_the_message_topic():
    block = offer_context_block("Unsere Rechnungen laufen noch per Hand")
    assert PAGE_OFFERS["/automation/invoice-processing"] in block
    # the marketing offer must NOT be mixed into an invoice turn
    assert PAGE_OFFERS["/marketing/ai-marketing-sales"] not in block


def test_offer_context_without_topic_carries_every_offer():
    block = offer_context_block("Hallo, grüezi")
    for offer in PAGE_OFFERS.values():
        assert offer in block


# --------------------------------------------------------------------------- #
# workflow guards: the model may never widen the 2026-11-23 rules              #
# --------------------------------------------------------------------------- #
def test_stage_machine_return_is_not_awaitable():
    """Regression: `await self._run_agent_reasoning(...)` on this plain def
    raised TypeError on every inbound WhatsApp/Telegram message (2026-11-23)."""
    out = agent._run_agent_reasoning("Grüezi", 0)
    assert isinstance(out, tuple) and len(out) == 5
    assert not inspect.isawaitable(out)


def test_merge_none_keeps_the_canned_reply():
    canned = _canned("Grüezi, wir brauchen Automation", 0)
    reply, link = agent._merge_llm_reply(canned, None, "Grüezi", 0)
    assert reply == canned[0] and link is None


def test_merge_qualifying_turn_takes_the_llm_text():
    canned = _canned("Grüezi, wir brauchen Automation", 0)
    reply, link = agent._merge_llm_reply(
        canned, "Gerne: Welches Problem sollen wir zuerst automatisieren?",
        "Grüezi, wir brauchen Automation", 0,
    )
    assert reply.startswith("Gerne:")
    assert link is None


def test_merge_qualifying_turn_without_question_falls_back():
    canned = _canned("Grüezi, wir brauchen Automation", 0)
    reply, _link = agent._merge_llm_reply(
        canned, "Wir automatisieren seit Jahren.", "Grüezi", 0
    )
    assert reply == canned[0]


def test_merge_qualifying_turn_never_carries_the_booking_link():
    canned = _canned("Grüezi, wir brauchen Automation", 0)
    reply, link = agent._merge_llm_reply(
        canned,
        "Welches System?\nBook here: " + ac.BOOKING_LINK,
        "Grüezi", 0,
    )
    assert ac.BOOKING_LINK not in reply
    assert link is None


def test_merge_closing_turn_gets_the_booking_link_appended():
    canned = _canned("Klingt gut", ac.QUALIFYING_TURNS)
    reply, link = agent._merge_llm_reply(
        canned,
        "Damit ich den Call vorbereite: E-Mail und Telefonnummer bitte.",
        "Klingt gut", ac.QUALIFYING_TURNS,
    )
    assert ac.BOOKING_LINK in reply
    assert link == ac.BOOKING_LINK


def test_merge_closing_turn_without_contact_ask_falls_back():
    canned = _canned("Klingt gut", ac.QUALIFYING_TURNS)
    reply, link = agent._merge_llm_reply(
        canned, "Super, lass uns einen Call machen.", "Klingt gut",
        ac.QUALIFYING_TURNS,
    )
    assert reply == canned[0]
    assert link == ac.BOOKING_LINK


def test_merge_handoff_is_never_replaced():
    canned = _canned("I want to speak to a human", 0)
    assert canned[2] is True
    reply, link = agent._merge_llm_reply(
        canned, "Sure, here is what we do: ...", "human please", 0
    )
    assert reply == canned[0]
    assert link is None
