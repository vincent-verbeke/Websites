"""Vincent 2026-11-26 workflow rule, enforced end to end:

    "the chat should ALWAYS do 3 to 5 steps asking deeper about the exact
     expectations of a potential customer" before any meeting ask, "and
     in the end ask email and phone and propose meeting"

Covers the two conversation drivers:
- agent_core (WhatsApp / Telegram / voice inbound), stage = number of agent
  messages already sent in the conversation (qualifying stages 0-4, closing
  at QUALIFYING_TURNS — or earlier on explicit booking intent, or both
  email + phone volunteered from MIN_EARLY_CLOSE_TURN on);
- lead_followup (email / whatsapp / telegram sequence), step = touch number.
"""
from app.services import agent_core as ac
from app.services import lead_followup as lf

agent = ac.agent_core


# --------------------------------------------------------------------------- #
# agent_core: live conversation stage machine                                  #
# --------------------------------------------------------------------------- #
def test_first_reply_asks_a_question_and_offers_no_meeting():
    reply, _tools, handoff, link, _chips = agent._run_agent_reasoning(
        "Grüezi, wir brauchen Automatisierung", 0
    )
    assert handoff is False
    assert link is None
    assert "?" in reply
    assert "bookings.cloud.microsoft" not in reply
    assert "get-to-know call" not in reply


def test_second_reply_still_qualifies_no_meeting():
    reply, _tools, _handoff, link, _chips = agent._run_agent_reasoning(
        "Unser Team sucht eine Lösung", 1
    )
    assert link is None
    assert "?" in reply
    assert "bookings.cloud.microsoft" not in reply
    assert "get-to-know call" not in reply


def test_no_meeting_before_turn_three():
    """Vincent 2026-11-26: turns 0-2 (3 guaranteed) are qualifying
    questions only — no link, no lead-qualified, no meeting ask."""
    for stage in (0, 1, 2):
        reply, _t, _h, link, _c = agent._run_agent_reasoning(
            "We need an automation solution", stage
        )
        assert link is None, f"stage {stage} closed too early"
        assert "?" in reply
        assert "bookings.cloud.microsoft" not in reply
        assert "get-to-know call" not in reply


def test_turns_three_and_four_ask_deeper_qualifying_questions():
    """Stages 3 and 4 dig deeper (constraints, recap) and stay questions
    without any meeting ask until QUALIFYING_TURNS."""
    seen = set()
    for stage in (3, 4):
        reply, _t, _h, link, _c = agent._run_agent_reasoning(
            "We need an automation solution", stage
        )
        assert link is None, f"stage {stage} closed too early"
        assert "?" in reply
        assert "bookings.cloud.microsoft" not in reply
        assert "get-to-know call" not in reply
        assert reply not in seen          # progressive, not the same text twice
        seen.add(reply)
    # stage 4 is the recap + confirm-expectations question
    reply4, _t, _h, link4, _c = agent._run_agent_reasoning(
        "We need an automation solution", 4
    )
    assert link4 is None and "expectations" in reply4


def test_closing_reply_asks_email_and_phone_then_proposes_meeting():
    reply, _tools, _handoff, link, _chips = agent._run_agent_reasoning(
        "Klingt gut", ac.QUALIFYING_TURNS
    )
    assert link == ac.BOOKING_LINK
    assert ac.BOOKING_LINK in reply           # link lives in the TEXT
    # "Klingt gut" is a German message -> Swiss High German (de-CH) closing:
    # contact details asked BEFORE the meeting proposal
    assert "E-Mail-Adresse" in reply and "Telefonnummer" in reply
    assert reply.index("Telefonnummer") < reply.index("15-minütiger Call")
    assert reply.index("E-Mail-Adresse") < reply.index(ac.BOOKING_LINK)


def test_h2_branch_asks_questions_before_the_meeting():
    reply0, tools, _h, link0, _c = agent._run_agent_reasoning("H2 test day", 0)
    assert link0 is None and "?" in reply0
    assert "bookings.cloud.microsoft" not in reply0
    assert tools and tools[0]["name"] == "query_product_catalog"  # observability kept
    for stage in (1, 2, 3, 4):   # 3-5 qualifying steps (Vincent 2026-11-26)
        reply, _t, _h, link, _c = agent._run_agent_reasoning(
            "It is for the H2 in our factory", stage
        )
        assert link is None and "?" in reply
        assert "bookings.cloud.microsoft" not in reply
        assert "get-to-know call" not in reply
    reply5, _t, _h, link5, _c = agent._run_agent_reasoning(
        "It is for the H2 in our factory", ac.QUALIFYING_TURNS
    )
    assert link5 == ac.BOOKING_LINK and ac.BOOKING_LINK in reply5
    assert reply5.index("email address") < reply5.index("get-to-know call")


def test_invoice_branch_asks_questions_before_the_meeting():
    for stage in range(ac.QUALIFYING_TURNS):
        reply, _t, _h, link, _c = agent._run_agent_reasoning(
            "invoice automation please", stage
        )
        assert link is None and "?" in reply
        assert "bookings.cloud.microsoft" not in reply
    closing, _t, _h, link, _c = agent._run_agent_reasoning(
        "invoice automation please", ac.QUALIFYING_TURNS
    )
    assert link == ac.BOOKING_LINK and ac.BOOKING_LINK in closing
    assert closing.index("email address") < closing.index("get-to-know call")


def test_explicit_booking_intent_jumps_to_the_closing_reply():
    reply, _tools, _handoff, link, _chips = agent._run_agent_reasoning(
        "Can we book a call this week?", 0
    )
    assert link == ac.BOOKING_LINK
    assert "email address" in reply and "phone number" in reply
    assert ac.BOOKING_LINK in reply
    assert reply.index("email address") < reply.index(ac.BOOKING_LINK)


def test_booking_intent_skips_at_any_stage():
    """Vincent 2026-11-26: never block an explicit booking request — the
    closing reply fires from the very first message to stage 4 alike."""
    for stage in (0, 1, 2, 3, 4):
        reply, _t, _h, link, _c = agent._run_agent_reasoning(
            "I would like to book a meeting", stage
        )
        assert link == ac.BOOKING_LINK, f"stage {stage} blocked a booking"
        assert ac.BOOKING_LINK in reply
        assert "email address" in reply and "phone number" in reply
        assert reply.index("email address") < reply.index("get-to-know call")


def test_volunteered_email_and_phone_close_early_from_stage_three():
    """Both contact details already in the conversation -> close from
    MIN_EARLY_CLOSE_TURN on; the 3-question floor still holds before it."""
    history = "reach me at lead@example.ch"
    phone_line = "or call +41 79 123 45 67"

    # floor: stage 2 with both details still qualifies
    reply, _t, _h, link, _c = agent._run_agent_reasoning(
        "und weiter?", 2, f"{history}\n{phone_line}"
    )
    assert link is None and "?" in reply
    assert "bookings.cloud.microsoft" not in reply

    # from stage 3 on: closing (ask only what is missing, propose the call)
    reply3, _t, _h, link3, _c = agent._run_agent_reasoning(
        "und weiter?", 3, f"{history}\n{phone_line}"
    )
    assert link3 == ac.BOOKING_LINK and ac.BOOKING_LINK in reply3


def test_german_message_gets_swiss_german_canned_text():
    """Canned stage replies: Swiss High German (de-CH) for German messages,
    English variants consistent with the existing style."""
    reply_de, _t, _h, link_de, _c = agent._run_agent_reasoning(
        "Grüezi, wir brauchen Automatisierung für unseren Betrieb", 0
    )
    assert link_de is None and "?" in reply_de
    assert "Schweiz" in reply_de
    reply_en, _t, _h, link_en, _c = agent._run_agent_reasoning(
        "We need automation for our plant", 0
    )
    assert link_en is None and "?" in reply_en
    assert "Grüezi! I am the Kubotics Autonomous Assistant" in reply_en


def test_human_request_still_hands_off_without_meeting_pitch():
    reply, _tools, handoff, link, _chips = agent._run_agent_reasoning(
        "I want to speak to a human", 0
    )
    assert handoff is True and link is None
    assert "Vincent Verbeke" in reply
    assert "bookings.cloud.microsoft" not in reply


# --------------------------------------------------------------------------- #
# lead_followup: prompt + template enforce the same sequence                   #
# --------------------------------------------------------------------------- #
def test_touch1_and_touch2_prompts_forbid_the_meeting():
    for step in (1, 2):
        for lang in ("de", "en"):
            system = lf._system_prompt(step, lang)
            assert "Do NOT offer a meeting" in system
            assert "qualifying question" in system
            assert lf.BOOKING_LINK not in system


def test_touch3_prompt_asks_missing_contact_and_keeps_link():
    system = lf._system_prompt(3, "en", has_email=False, has_phone=False)
    assert "email address AND phone number" in system
    assert lf.BOOKING_LINK in system
    assert "no other offers, no marketing" in system.lower()

    # only what we do not have yet gets asked for (the standing rules line
    # always contains "phone numbers" as an anti-invention rule, so assert on
    # the actual ask)
    missing_phone = lf._system_prompt(3, "en", has_email=True, has_phone=False)
    assert "ask for their phone number" in missing_phone
    assert "ask for their email address" not in missing_phone

    missing_email = lf._system_prompt(3, "en", has_email=False, has_phone=True)
    assert "ask for their email address" in missing_email
    assert "ask for their phone number" not in missing_email

    both = lf._system_prompt(3, "en", has_email=True, has_phone=True)
    assert "ask for their" not in both
    assert lf.BOOKING_LINK in both


def test_templates_follow_the_same_sequence_de_and_en():
    for lang in ("de", "en"):
        t1 = lf._template(1, lang, first_name="Anna", company=None,
                          interest="Unitree H2")[1]
        assert "?" in t1 and lf.BOOKING_LINK not in t1
        assert "https://kubotics.ch" in t1            # landing page stays

        t2 = lf._template(2, lang, first_name="Anna", company=None,
                          interest="Unitree H2")[1]
        assert "?" in t2 and lf.BOOKING_LINK not in t2

        t3 = lf._template(3, lang, first_name="Anna", company=None,
                          interest="Unitree H2", has_email=False,
                          has_phone=False)[1]
        assert lf.BOOKING_LINK in t3
        # contact details are asked BEFORE the meeting proposal
        marker = "e-mail" if lang == "de" else "email"
        assert t3.lower().index(marker) < t3.index(lf.BOOKING_LINK)


def test_touch3_template_skips_contact_ask_when_both_known():
    t3 = lf._template(3, "en", first_name="Anna", company=None,
                      interest="H2", has_email=True, has_phone=True)[1]
    assert lf.BOOKING_LINK in t3
    assert "Please share your" not in t3
