"""Vincent 2026-11-23 workflow rule, enforced end to end:

    "we should interact 2-3 messages always with questions to determine
     the need before asking for a meeting and in the end ask email and
     phone and propose meeting"

Covers the two conversation drivers:
- agent_core (WhatsApp / Telegram / voice inbound), stage = number of agent
  messages already sent in the conversation;
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


def test_closing_reply_asks_email_and_phone_then_proposes_meeting():
    reply, _tools, _handoff, link, _chips = agent._run_agent_reasoning(
        "Klingt gut", ac.QUALIFYING_TURNS
    )
    assert link == ac.BOOKING_LINK
    assert ac.BOOKING_LINK in reply           # link lives in the TEXT
    # email + phone BEFORE the meeting proposal
    assert reply.index("email address") < reply.index("get-to-know call")
    assert "phone number" in reply


def test_h2_branch_asks_questions_before_the_meeting():
    reply0, tools, _h, link0, _c = agent._run_agent_reasoning("H2 test day", 0)
    assert link0 is None and "?" in reply0
    assert "bookings.cloud.microsoft" not in reply0
    assert tools and tools[0]["name"] == "query_product_catalog"  # observability kept
    reply1, _t, _h, link1, _c = agent._run_agent_reasoning(
        "It is for the H2 in our factory", 1
    )
    assert link1 is None and "?" in reply1
    assert "bookings.cloud.microsoft" not in reply1
    reply2, _t, _h, link2, _c = agent._run_agent_reasoning(
        "It is for the H2 in our factory", 2
    )
    assert link2 == ac.BOOKING_LINK and ac.BOOKING_LINK in reply2
    assert reply2.index("email address") < reply2.index("get-to-know call")


def test_invoice_branch_asks_questions_before_the_meeting():
    reply0, _t, _h, link0, _c = agent._run_agent_reasoning(
        "invoice automation please", 0
    )
    assert link0 is None and "?" in reply0
    assert "bookings.cloud.microsoft" not in reply0
    reply1, _t, _h, link1, _c = agent._run_agent_reasoning(
        "invoice automation please", 1
    )
    assert link1 is None and "?" in reply1
    reply2, _t, _h, link2, _c = agent._run_agent_reasoning(
        "invoice automation please", 2
    )
    assert link2 == ac.BOOKING_LINK and ac.BOOKING_LINK in reply2


def test_explicit_booking_intent_jumps_to_the_closing_reply():
    reply, _tools, _handoff, link, _chips = agent._run_agent_reasoning(
        "Can we book a call this week?", 0
    )
    assert link == ac.BOOKING_LINK
    assert "email address" in reply and "phone number" in reply
    assert ac.BOOKING_LINK in reply
    assert reply.index("email address") < reply.index(ac.BOOKING_LINK)


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
