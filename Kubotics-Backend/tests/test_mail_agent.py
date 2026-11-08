"""Unit tests for the Kubot mail agent — Phase 0 (models + config only).

Run:  uv run pytest tests/test_mail_agent.py -q
Docs: docs/KUBOT_MAIL_AGENT_PLAN.md (§6 file plan, §7 checklist)

Phase 0 is deliberately behaviour-free: MAIL_AGENT_ENABLED must default to
False, the tables must register on Base.metadata (create_all contract), and
the config defaults must match the plan's documented values.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import app.models  # noqa: F401  (registers needle/tasks/mail_agent tables)
from app.core.config import settings
from app.db.session import Base
from app.models.mail_agent import MailMessage, MailWatchSender
from app.services import mail_agent as ma  # pure helpers under test


def _tbl(name: str):
    """Resolve a table in Base.metadata regardless of schema prefix (crm.* vs bare)."""
    if name in Base.metadata.tables:
        return Base.metadata.tables[name]
    suffixed = [k for k in Base.metadata.tables if k.endswith(f".{name}")]
    assert len(suffixed) == 1, f"table {name!r} not registered (found: {suffixed})"
    return Base.metadata.tables[suffixed[0]]

# --- config defaults (plan §6) ------------------------------------------------

def test_agent_disabled_by_default():
    """Phase B gate: service must be OFF until explicitly enabled."""
    assert settings.MAIL_AGENT_ENABLED is False


def test_plan_config_defaults():
    assert settings.MAIL_AGENT_MODE == "auto"
    assert settings.MAIL_AGENT_POLL_INTERVAL_S == 60
    assert settings.MAIL_AGENT_REPLY_WINDOW_DAYS == 7
    assert settings.MAIL_AGENT_UNKNOWN_POLICY == "auto"  # Q2: classify + answer real personal
    assert settings.MAIL_AGENT_LANGUAGES == "de-CH,en,fr,it,nl"  # Q13 (Dutch mother tongue)
    assert settings.MAIL_AGENT_OWN_ADDRESSES == ""  # Q1: extras; base from Graph proxyAddresses
    assert settings.MAIL_AGENT_MAX_REPLIES_PER_DAY == 20
    assert settings.MAIL_AGENT_CONVERSATION_COOLDOWN_H == 24
    assert settings.MAIL_AGENT_SPAM_THRESHOLD == 0.80
    assert settings.MAIL_AGENT_ONLY_SENDERS == ""
    assert settings.MAIL_AGENT_TIER_MAP == ""


def test_llm_chain_defaults_match_vincents_order():
    """MiMo Flash -> OpenAI -> Gemini -> Grok/xAI (Vincent 2026-11-08)."""
    assert settings.MAIL_AGENT_LLM_CHAIN == "mimo,openai,gemini,xai"
    assert settings.MAIL_AGENT_LLM_MODEL_MIMO == "mimo-v2.6-flash"
    assert settings.MAIL_AGENT_LLM_BASE_MIMO == "https://api.xiaomimimo.com/v1"


def test_notify_phone_is_vincents_number():
    assert settings.MAIL_AGENT_NOTIFY_PHONE == "+41797481975"


def test_alert_window_matches_q11_answer():
    """WhatsApp alerts only 07:30-22:00 Europe/Zurich; replies stay 24/7."""
    assert settings.MAIL_AGENT_ALERT_WINDOW_START == "07:30"
    assert settings.MAIL_AGENT_ALERT_WINDOW_END == "22:00"
    assert settings.MAIL_AGENT_ALERT_TZ == "Europe/Zurich"


# --- model registration (create_all contract, plan §6) -----------------------

def test_mail_tables_registered_on_metadata():
    assert _tbl("mail_messages") is not None
    assert _tbl("mail_watch_senders") is not None


def test_ledger_internet_message_id_is_unique():
    """Idempotency across restarts AND ECS tasks (plan §3.1)."""
    col = _tbl("mail_messages").c.internet_message_id
    assert col.unique is True
    assert col.nullable is False


def test_ledger_state_defaults_to_received():
    col = _tbl("mail_messages").c.state
    assert col.nullable is False
    assert col.default is not None
    assert col.default.arg == "received"


def test_override_sender_email_unique_and_active_by_default():
    tbl = _tbl("mail_watch_senders")
    assert tbl.c.email.unique is True
    assert tbl.c.active.default.arg is True
    assert tbl.c.tier.default.arg == "contact"


def test_model_classes_exported():
    assert MailMessage.__tablename__ == "mail_messages"
    assert MailWatchSender.__tablename__ == "mail_watch_senders"


# --- step 2: hard filters + scan plan (pure, plan §3.4 / §3.1) ---------------

def _msg(mid: str, ts: str, sender: str = "a@b.ch") -> dict:
    return {"internetMessageId": mid, "receivedDateTime": ts,
            "from": {"emailAddress": {"address": sender}},
            "conversationId": "cid-" + mid, "subject": "s"}


def test_resolve_upn_falls_back_to_organizer():
    assert ma.resolve_upn()  # always non-empty
    assert "@" in ma.resolve_upn()


def test_own_address_set_covers_q1_aliases():
    own = ma.own_address_set(
        "vincent.verbeke@kuroliv.ch",
        ["SMTP:vincent.verbeke@kuroliv.ch",  # Exchange primary = uppercase
         "smtp:sales@kubotics.ch", "sip:not-an-email", "smtp:info@qbotics.ch"],
        "extra@example.com, , not-an-email",
    )
    assert own == {"vincent.verbeke@kuroliv.ch", "sales@kubotics.ch",
                   "info@qbotics.ch", "extra@example.com"}


def test_sender_hard_filter_never_answer_rules():
    own = {"me@corp.ch"}
    assert ma.sender_hard_filter("me@corp.ch", own) == "own_mail"
    assert ma.sender_hard_filter("NoReply@vendor.com", own) == "noreply_sender"
    assert ma.sender_hard_filter("do-not-reply@x.io", own) == "noreply_sender"
    assert ma.sender_hard_filter("mailer-daemon@x.io", own) == "system_sender"
    assert ma.sender_hard_filter("", own) == "no_sender"
    assert ma.sender_hard_filter("liz.mallet@hotmail.com", own) is None


def test_header_hard_filter_q14_never_autoreplies():
    assert ma.header_hard_filter({"auto-submitted": "auto-generated"}) == "auto_submitted"
    assert ma.header_hard_filter({"auto-submitted": "no"}) is None  # RFC 3834 human
    assert ma.header_hard_filter({"list-unsubscribe": "<https://x>"}) == "mailing_list"
    assert ma.header_hard_filter({"list-id": "Newsletter"}) == "mailing_list"
    assert ma.header_hard_filter({"precedence": "bulk"}) == "precedence_bulk"
    assert ma.header_hard_filter({}) is None
    # QA fix: X-Auto-Response-Suppress is NOT an auto-reply signal (human
    # Exchange mail carries "DR, RN, NRN") — filtering it would eat real mail
    assert ma.header_hard_filter({"x-auto-response-suppress": "DR, RN, NRN"}) is None
    assert ma.header_hard_filter({"x-auto-response-suppress": "OOF, AutoReply"}) is None


def test_plan_scan_first_boot_seeds_without_processing():
    """Never retro-answer history: empty ledger -> seed watermark, claim nothing."""
    msgs = [_msg("<a@x>", "2026-11-08T09:00:00Z"), _msg("<b@x>", "2026-11-08T08:00:00Z")]
    claims, new_base, seed = ma.plan_scan(msgs, base=None, ledger_empty=True, known_ids=set())
    assert claims == [] and seed is True
    assert new_base == "2026-11-08T09:00:00Z"


def test_plan_scan_strict_lt_skip_and_claim_newer():
    base = "2026-11-08T09:00:00Z"
    msgs = [_msg("<new@x>", "2026-11-08T09:00:05Z"),
            _msg("<same@x>", base),          # equal second: offered (dedup elsewhere)
            _msg("<old@x>", "2026-11-08T08:59:59Z")]  # strictly older: skipped
    claims, new_base, seed = ma.plan_scan(msgs, base=base, ledger_empty=False, known_ids=set())
    assert seed is False
    assert [m["internetMessageId"] for m in claims] == ["<new@x>", "<same@x>"]
    assert new_base == "2026-11-08T09:00:05Z"


def test_plan_scan_dedupes_known_ids_and_keeps_watermark_on_empty():
    base = "2026-11-08T09:00:00Z"
    known = {"<known@x>"}
    claims, new_base, seed = ma.plan_scan(
        [_msg("<known@x>", "2026-11-08T09:00:03Z")],
        base=base, ledger_empty=False, known_ids=known)
    assert claims == [] and seed is False and new_base == base  # no advance on dedupe


def test_plan_scan_never_moves_watermark_backwards():
    base = "2026-11-08T09:00:00Z"
    claims, new_base, _ = ma.plan_scan(
        [_msg("<only-old@x>", "2026-11-08T08:00:00Z")],
        base=base, ledger_empty=False, known_ids=set())
    assert claims == [] and new_base == base


# --- step 3: routing helpers + decision matrix (plan §3.2/§4.2) ---------------

def test_parse_tier_map_q9_proposed_set():
    tm = ma.parse_tier_map("Board=board;VIP=vip_customer;Kunde=customer")
    assert tm == {"board": "board", "vip": "vip_customer", "kunde": "customer"}
    assert ma.parse_tier_map("junk;;no-equals;=x") == {}


def test_parse_only_senders_phase_b_gate():
    assert ma.parse_only_senders("Liz.Mallet@KUROLIV.ch, b@c.ch , nope") == {
        "liz.mallet@kuroliv.ch", "b@c.ch"}
    assert ma.parse_only_senders("") == set()


def test_tier_for_categories():
    tm = {"board": "board", "vip": "vip_customer"}
    assert ma.tier_for_categories(["Board"], tm) == "board"
    assert ma.tier_for_categories(["unknown-tag", "VIP"], tm) == "vip_customer"  # first match wins
    assert ma.tier_for_categories([], tm) == "contact"   # Q9: no categories -> contact tier
    assert ma.tier_for_categories(None, tm) == "contact"


def test_find_contact_matches_any_address_case_insensitive():
    contacts = [{"displayName": "Liz Mallet",
                 "emailAddresses": [{"address": "liz.mallet@kuroliv.ch"},
                                    {"address": "liz.mallet@hotmail.com"}],
                 "categories": [], "personalNotes": "partner"}]
    assert ma.find_contact("LIZ.MALLET@HOTMAIL.COM", contacts)["displayName"] == "Liz Mallet"  # case-insens
    assert ma.find_contact("liz.mallet@hotmail.com", contacts)["displayName"] == "Liz Mallet"
    assert ma.find_contact("liz.mallet@kuroliv.ch", contacts)["displayName"] == "Liz Mallet"
    assert ma.find_contact("stranger@x.ch", contacts) is None
    assert ma.find_contact("", contacts) is None


def test_headers_to_dict_lowercases():
    raw = [{"name": "Auto-Submitted", "value": "auto-generated"},
           {"name": "X-Mailer", "value": "v"}, {"value": "no-name"}]
    assert ma.headers_to_dict(raw)["auto-submitted"] == "auto-generated"
    assert ma.headers_to_dict(None) == {}


def _decide(**kw):
    base = {"category": "informational", "criticality": "low", "tier": "contact",
            "spam_probability": 0.1, "personal_email": True, "route": "contact",
            "unknown_policy": "auto", "spam_threshold": 0.8}
    base.update(kw)
    return ma.decide(**base)


def test_decide_critical_is_p1_ack_only_notify():
    a = _decide(category="critical", criticality="critical")
    assert (a["action"], a["priority"], a["kind"], a["notify"]) == (
        "reply", "P1", "ack_only", True)   # Q7 ack-only care rule


def test_decide_complaint_board_p1_customer_p2():
    assert _decide(category="complaint", tier="board")["priority"] == "P1"
    assert _decide(category="complaint", tier="customer")["priority"] == "P2"
    assert _decide(category="complaint")["kind"] == "ack_only"


def test_decide_request_board_p2_notify_customer_p3():
    b = _decide(category="request", tier="vip_customer")
    assert (b["priority"], b["notify"], b["kind"]) == ("P2", True, "holding")
    c = _decide(category="request", tier="contact")
    assert (c["priority"], c["notify"], c["kind"]) == ("P3", False, "holding")
    assert _decide(category="request", criticality="high", tier="contact")["priority"] == "P3"


def test_decide_followup_p3_informational_p4():
    f = _decide(category="followup", route="thread_reply", tier="unknown")
    assert (f["action"], f["priority"], f["kind"]) == ("reply", "P3", "holding")
    i = _decide(category="informational")
    assert (i["action"], i["priority"], i["kind"], i["notify"]) == (
        "reply", "P4", "thank_you", False)


def test_decide_spam_always_p5_even_for_board():
    a = _decide(category="commercial_spam", tier="board")
    assert (a["action"], a["priority"], a["state"]) == ("ignore", "P5", "ignored_spam")
    b = _decide(spam_probability=0.85, tier="board")   # threshold inclusive
    assert b["reason"] == "spam"


def test_decide_q2_unknown_auto_gates_on_personal_email():
    real = _decide(tier="unknown", route="unknown", category="informational",
                   personal_email=True)
    assert real["action"] == "reply"                       # Q2: real personal -> answer
    not_real = _decide(tier="unknown", route="unknown", personal_email=False)
    assert (not_real["action"], not_real["reason"]) == ("ignore", "not_personal")
    ignore_pol = _decide(tier="unknown", unknown_policy="ignore")
    assert ignore_pol["state"] == "ignored_unknown"
    notify_pol = _decide(tier="unknown", unknown_policy="notify")
    assert (notify_pol["action"], notify_pol["state"]) == ("notify_only", "notify_only")


def test_decide_thread_route_bypasses_unknown_gate():
    """§4.2: thread => eligible even without contact card (tier unknown)."""
    a = _decide(tier="unknown", route="thread_reply", category="critical")
    assert (a["action"], a["priority"]) == ("reply", "P1")
    b = _decide(tier="unknown", route="thread_reply", category="informational",
                personal_email=False)   # gate does not apply on threads
    assert b["action"] == "reply"


# --- step 3: LLM layer (pure parts) -------------------------------------------

from app.services import mail_llm  # imported here: after sys.path setup above


def test_extract_json_variants():
    from app.services.mail_llm import extract_json
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! Here it is: {"a": {"b": "c"}} hope that helps') == {
        "a": {"b": "c"}}
    assert extract_json('{"s": "has } brace"}') == {"s": "has } brace"}
    assert extract_json("no json here") is None
    assert extract_json("") is None
    assert extract_json("{broken") is None


def test_normalize_classification_validation():
    from app.services.mail_llm import normalize_classification
    ok = normalize_classification({"language": "DE-CH", "category": "Followup",
                                   "criticality": "HIGH", "spam_probability": 1.7,
                                   "personal_email": True, "summary": "x"})
    assert ok["language"] == "de-ch" and ok["category"] == "followup"
    assert ok["criticality"] == "high" and ok["spam_probability"] == 1.0  # clamped
    try:
        normalize_classification({"category": "banana"})
        raise AssertionError("bad category must raise (-> needs_review)")
    except ValueError:
        pass
    try:
        normalize_classification({})   # missing category also raises
        raise AssertionError("missing category must raise")
    except ValueError:
        pass


def test_finalize_reply_validation_and_signature():
    from app.services.mail_llm import ReplyInvalid, finalize_reply, signature_html
    body = ("<p>" + "Hello, I'm Kubot, Vincent's personal digital AI assistant. "
            + "thanks for your note " + "x" * 80 + "</p>")
    full = finalize_reply(body, "nl")
    assert full.startswith(body)
    assert "kubotics.ch" in full and "467886" in full          # §5.6 promo + tag
    assert "Met vriendelijke groet" in full                     # Q13 nl closing
    assert "Vincents persoonlijke digitale AI-assistent" in full
    assert "Termin mit Vincent" not in full                     # label follows lang
    assert "kubotics.ch" in signature_html("en")
    assert "Kind regards" in signature_html("en-GB")            # lang prefix fallback
    for bad, why in (("too short", "short"),
                     ("<p>Plain polite mail without the required opener "
                      + "y" * 150 + "</p>", "no kubot"),
                     ("<p>Kubot " + "z" * 8100 + "</p>", "too long")):
        try:
            finalize_reply(bad, "en")
            raise AssertionError(f"must reject: {why}")
        except ReplyInvalid:
            pass


def test_build_compose_system_contains_rules_and_note():
    from app.services.mail_llm import build_compose_system
    s = build_compose_system(
        lang="de", kind="holding", sender_name="Liz", subject="Test",
        tier="vip_customer", contact_note="partner of Vincent",
        categories=["VIP"], classification={"category": "request",
                                             "criticality": "normal"})
    assert "Kubot" in s and "Grüezi" in s                      # Q13 de opener
    assert "48 hours" in s                                     # plan §5.4 posture
    assert "partner of Vincent" in s                           # Q8/§5.2 notes
    assert "VIP" in s
    crit = build_compose_system(
        lang="en", kind="ack_only", sender_name="x", subject="",
        tier="board", contact_note=None, categories=None,
        classification={"category": "critical", "criticality": "critical"})
    assert "ACKNOWLEDGEMENT ONLY" in crit and "NO substantive content" in crit  # Q7


def test_provider_chain_skips_missing_keys(monkeypatch):
    """Q10: chain must work before MIMO/XAI secrets exist (§7.3)."""
    for var in ("MIMO_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    assert mail_llm.provider_chain() == []                       # nothing configured
    monkeypatch.setenv("MIMO_API_KEY", "sk-test")
    chain = mail_llm.provider_chain()
    assert [p.name for p in chain] == ["mimo"]                  # Q3 order preserved
    assert chain[0].model == "mimo-v2.6-flash"
    assert chain[0].base_url == "https://api.xiaomimimo.com/v1"
    monkeypatch.setenv("XAI_API_KEY", "xai-test")
    assert [p.name for p in mail_llm.provider_chain()] == ["mimo", "xai"]  # chain order


# --- step 4: send-path guards (pure) -------------------------------------------

def test_alert_window_q11_boundaries():
    """WhatsApp only 07:30-22:00 Europe/Zurich; replies stay 24/7."""
    tz = "Europe/Zurich"
    def at(hour, minute, day=8):
        return datetime(2026, 11, day, hour, minute, tzinfo=ZoneInfo(tz))
    assert ma.in_alert_window(at(7, 30), "07:30", "22:00", tz)     # opens exactly
    assert ma.in_alert_window(at(7, 29), "07:30", "22:00", tz) is False
    assert ma.in_alert_window(at(12, 0), "07:30", "22:00", tz)
    assert ma.in_alert_window(at(22, 0), "07:30", "22:00", tz)      # closes at 22:00
    assert ma.in_alert_window(at(22, 1), "07:30", "22:00", tz) is False
    # UTC time that is next-day morning in Zurich still counts local
    utc_noon = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
    assert ma.in_alert_window(utc_noon, "07:30", "22:00", tz)       # 13:00 local


def test_reply_all_rule_q14():
    assert ma.reply_all_required(1) is True
    assert ma.reply_all_required(3) is True       # <= 3 -> replyAll
    assert ma.reply_all_required(4) is False      # > 3 -> sender only
    assert ma.reply_all_required(0) is True
    assert ma.reply_all_required(None) is False   # unknown -> minimal exposure


def test_cap_reached_uses_settings(monkeypatch):
    monkeypatch.setattr(settings, "MAIL_AGENT_MAX_REPLIES_PER_DAY", 2)
    assert ma._cap_reached(1) is False
    assert ma._cap_reached(2) is True             # Q6: cap inclusive
    assert ma._cap_reached(3) is True


def test_sent_same_day_and_alert_text():
    assert ma.sent_same_day(datetime.now(UTC)) is True
    assert ma.sent_same_day(datetime.now(UTC) - timedelta(days=1)) is False
    txt = ma.alert_text("P1", "board", "critical", "big@corp.ch", "s" * 300,
                        "https://outlook.office.com/mail/x", digest=False)
    assert txt.startswith("Kubot mail alert P1")
    assert "https://outlook.office.com/mail/x" in txt
    assert len(txt) <= 3800
    dig = ma.alert_text("P3", "unknown", "informational", "a@b.ch", "s", None,
                        digest=True)
    assert dig.startswith("Kubot mail digest")
    assert "https://" not in dig


def test_hhmm_parser():
    assert ma._hhmm("07:30") == (7, 30)
    assert ma._hhmm("22:00") == (22, 0)
    assert ma._hhmm("") == (0, 0)

