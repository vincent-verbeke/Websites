"""Kubot mail agent domain models: reply ledger + sender override list.

Two tables (plan docs/KUBOT_MAIL_AGENT_PLAN.md §6):

* ``mail_messages`` — one row per mailbox message the watcher examined.
  UNIQUE ``internet_message_id`` is the idempotency key across restarts AND
  across ECS tasks (INSERT ... ON CONFLICT DO NOTHING claim). Holds the full
  state machine ``received -> classified -> replied | ignored_spam |
  ignored_unknown | notify_only | needs_review | send_failed`` plus the send
  audit (``send_attempted_at`` marker persisted BEFORE the Graph POST —
  PC-A round-27 semantics: an unconfirmed attempt never blind-retries).
* ``mail_watch_senders`` — OPTIONAL override list for test senders /
  addressees without an Outlook contact card. Primary contacts live in
  Outlook People (Vincent maintains them; plan §3.2/§4.1).

Registered in ``app.models.__init__`` so ``Base.metadata.create_all`` sees
them at boot (create_all never imports modules on its own).
"""
from __future__ import annotations

import uuid

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


class MailMessage(Base):
    """Ledger of every inbox message the watcher looked at (audit + idempotency)."""

    __tablename__ = "mail_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # RFC Message-IDs are ASCII; 1024 keeps the btree entry under PG's 2704-byte limit
    internet_message_id = Column(String(1024), unique=True, nullable=False, index=True)
    conversation_id = Column(String(512), nullable=True, index=True)
    sender = Column(String(255), nullable=False, index=True)
    subject = Column(String(1024), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True, index=True)
    body = Column(Text, nullable=True)
    web_link = Column(Text, nullable=True)

    # routing / classification (plan §3.2/§4.1 — LLM classify call output)
    route = Column(String(32), nullable=True)        # thread_reply | contact | unknown
    tier = Column(String(32), nullable=True)         # board | vip_customer | customer | ... | contact | unknown
    language = Column(String(16), nullable=True)     # de-CH | en | fr | it | ...
    category = Column(String(32), nullable=True)     # informational | followup | request | complaint | critical | commercial_spam
    criticality = Column(String(16), nullable=True)  # low | normal | high | critical
    spam_probability = Column(Float, nullable=True)
    priority = Column(String(8), nullable=True)      # P1..P5 (plan §4.2 matrix)
    summary = Column(Text, nullable=True)
    classification = Column(JSON, nullable=True, default=dict)  # raw LLM JSON, kept for audit

    # state machine (plan §3.4)
    state = Column(String(32), nullable=False, default="received", index=True)
    llm_provider = Column(String(32), nullable=True)
    llm_model = Column(String(64), nullable=True)

    # send audit — PC-A send-attempt marker semantics (never blind-retry)
    reply_text = Column(Text, nullable=True)
    # Graph message ids exceed 128 chars in this tenant (live send attempt hit
    # "value too long" at 14:35 and crashed the cycle before any POST) — keep
    # generous headroom next to internet_message_id's 1024.
    graph_message_id = Column(String(512), nullable=True)
    send_attempted_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    whatsapp_notified_at = Column(DateTime(timezone=True), nullable=True)
    error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_mail_messages_state_created", "state", "created_at"),
    )


class MailWatchSender(Base):
    """Optional sender override list (test senders, senders without a contact card)."""

    __tablename__ = "mail_watch_senders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    display_name = Column(String(255), nullable=True)
    tier = Column(String(32), nullable=False, default="contact")
    language = Column(String(16), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
