"""Vincent 2026-11-23: "pls LLM + Offer Context in Whatsapp".

The WhatsApp / Telegram / Teams agent core must answer through the SAME
provider chain (mail_llm) and the SAME shared system prompt as the website
chat, with the offer matching the message topic injected as context. The
canned stage reply stays the reply whenever the chain fails or the model's
text breaks the 3-5-qualifying-turns workflow (Vincent 2026-11-26).

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

    reply, provider, model = asyncio.run(
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
    # audit truth: the pair that answered is what agent_runs records
    assert (provider, model) == ("mimo", "mx")
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

    text, provider, model = asyncio.run(
        agent._llm_reply(_envelope("Hallo"), [])
    )
    assert (text, provider, model) == (None, None, None)


def test_llm_turn_returns_none_on_empty_model_output(monkeypatch):
    async def empty(system, user):
        return "   ", "mimo", "mx"

    monkeypatch.setattr(ac.mail_llm, "chat_text", empty)
    text, provider, model = asyncio.run(
        agent._llm_reply(_envelope("Hallo"), [])
    )
    assert (text, provider, model) == (None, None, None)


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
    # the H2 rental alias shares its string with the test-day path — the
    # fallback must never show the same offer twice
    assert block.count(PAGE_OFFERS["/robotics/unitree-h2-rental"]) == 1


def test_h2_offer_sells_the_rental_and_has_the_alias_path():
    """Vincent 2026-11-26: the Unitree H2 entries lead with the RENTAL
    offer; the Test Day stays a secondary mention; both H2 page paths
    (/robotics/unitree-h2-test-day and /robotics/unitree-h2-rental) serve
    the same offer."""
    from app.services.chat_context import offer_for_page

    rental_sentence = (
        "Unitree H2 humanoid rentable in Switzerland: 2 days CHF 500 or "
        "1 week CHF 1000, excl. MwSt., excl. shipping, on-site"
    )
    offer = PAGE_OFFERS["/robotics/unitree-h2-rental"]
    assert rental_sentence in offer
    # rental first, Test Day secondary
    assert offer.index(rental_sentence) < offer.index("Test Day")
    # both H2 paths resolve to the same offer
    assert PAGE_OFFERS["/robotics/unitree-h2-test-day"] == offer
    assert offer_for_page("/robotics/unitree-h2-rental") == offer
    assert offer_for_page("/robotics/unitree-h2-test-day/") == offer
    # topic-selected messaging turns carry it too
    assert offer in offer_context_block("Unitree H2 rental price?")


def test_shared_prompt_pins_the_3_to_5_turn_qualification_rule():
    """The system prompt must tell the model the NEW rule: one deeper
    qualifying question per turn, no meeting before turn 3, close by turn 5,
    immediate close on booking intent or both contact details."""
    prompt = ac.CHAT_SYSTEM_PROMPT
    assert "QUALIFICATION FLOW (fixed, no exceptions)" in prompt
    assert "EXACT" in prompt and "expectations" in prompt
    assert "before the THIRD turn" in prompt
    assert "FIFTH qualifying turn at the latest" in prompt
    assert "BOTH an email address and a phone number" in prompt
    assert "explicitly asks to book or meet" in prompt
    # the old 2-turn wording is gone
    assert "first TWO turns" not in prompt
    assert "From the THIRD turn on" not in prompt


# --------------------------------------------------------------------------- #
# workflow guards: the model may never widen the 2026-11-26 rules              #
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


def test_merge_keeps_stage_four_a_qualifying_turn():
    """Vincent 2026-11-26: stages 0-4 qualify; only QUALIFYING_TURNS=5
    closes (plus the two early-close gates below)."""
    canned = _canned("We need automation", 4)
    assert canned[3] is None
    reply, link = agent._merge_llm_reply(
        canned, "Which outcome do you need, and by when?",
        "We need automation", 4,
    )
    assert reply.startswith("Which outcome")
    assert link is None


def test_merge_booking_intent_closes_from_stage_zero():
    """Never block an explicit booking request — the closing guard applies
    at ANY stage, so the model's contact ask is adopted at stage 0."""
    canned = _canned("Can we book a call?", 0)
    assert canned[3] == ac.BOOKING_LINK          # canned already closes
    reply, link = agent._merge_llm_reply(
        canned, "Sure — your email address and phone number first.",
        "can we book a call?", 0,
    )
    assert reply.endswith(ac.BOOKING_LINK)       # link appended by the guard
    assert link == ac.BOOKING_LINK


def test_merge_sees_volunteered_email_and_phone_in_history():
    """Both contact details in the conversation -> closing from stage 3 on
    (3-question floor holds before that)."""
    history = "reach me at lead@example.ch or call +41 79 123 45 67"
    canned3 = agent._run_agent_reasoning("und weiter?", 3, history)
    assert canned3[3] == ac.BOOKING_LINK         # early close fires
    reply, link = agent._merge_llm_reply(
        canned3, "Gerne, eine Frage.", "und weiter?", 3, history
    )
    # llm text has no contact ask -> canned closing (with its link) stays
    assert reply == canned3[0]
    assert link == ac.BOOKING_LINK

    # floor: the same history at stage 2 still qualifies
    canned2 = agent._run_agent_reasoning("und weiter?", 2, history)
    assert canned2[3] is None
    assert "?" in canned2[0]
