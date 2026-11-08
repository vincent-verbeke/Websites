"""Unit tests for the Kubot mail agent — Phase 0 (models + config only).

Run:  uv run pytest tests/test_mail_agent.py -q
Docs: docs/KUBOT_MAIL_AGENT_PLAN.md (§6 file plan, §7 checklist)

Phase 0 is deliberately behaviour-free: MAIL_AGENT_ENABLED must default to
False, the tables must register on Base.metadata (create_all contract), and
the config defaults must match the plan's documented values.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import app.models  # noqa: F401  (registers needle/tasks/mail_agent tables)
from app.core.config import settings
from app.db.session import Base
from app.models.mail_agent import MailMessage, MailWatchSender


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
    assert settings.MAIL_AGENT_UNKNOWN_POLICY == "ignore"
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
