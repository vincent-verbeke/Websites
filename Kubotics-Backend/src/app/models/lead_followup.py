"""Lead follow-up state machine models (docs/LEAD_FOLLOWUP_PLAN.md).

Two tables (Vincent 2026-11-15, "follow up the leads completely via email /
whatsapp / telegram without manual intervention"):

* ``lead_followups`` — ONE row per contact that entered the sequence. The
  row IS the state machine: ``step`` = the NEXT touch to send (1-based),
  ``status`` =
      pending        — sequence scheduled, next touch waits for ``next_due_at``
      active         — next touch due now (transient; survives a crash mid-cycle
                       and is picked up again because it is still due)
      stopped        — admin stop / consent revoked / opt-out / unreachable /
                       lead too old / repeated send failures
      meeting_booked — a meeting is on the record (lead lifecycle moved past
                       'lead'; see docs for the bookings-detection gap)
      replied        — the contact messaged us after our last touch: the
                       human/agent conversation takes over
      maxed          — LEAD_FOLLOWUP_MAX_TOUCHES touches are exhausted
* ``lead_followup_log`` — append-only audit: one row per send attempt AND per
  skip/stop decision. ``subject_preview`` holds the email subject only and
  ``detail`` only short machine reasons — message BODIES and recipient
  addresses/phones are NEVER stored here (PII rule, docs §"no PII in logs").

Registered in ``app.models.__init__`` so ``Base.metadata.create_all`` sees
them at boot (create_all never imports modules on its own). Schema prefix
``crm`` comes from the shared Base metadata binding.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from app.db.session import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class LeadFollowup(Base):
    """One row per contact in the follow-up sequence (unique per contact)."""

    __tablename__ = "lead_followups"

    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    step = Column(Integer, nullable=False, default=1)      # NEXT touch (1-based)
    status = Column(String(24), nullable=False, default="pending", index=True)
    # pending | active | stopped | meeting_booked | replied | maxed
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    next_due_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )


class LeadFollowupLog(Base):
    """Audit trail: send attempts + skip/stop decisions. Subject preview only,
    never a body, never recipient PII."""

    __tablename__ = "lead_followup_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NULL contact_id/step = cycle-level decision (e.g. the daily cap tripped
    # before a specific lead was picked).
    contact_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contacts.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    step = Column(Integer, nullable=True)
    channel = Column(String(16), nullable=True)  # email | whatsapp | telegram
    subject_preview = Column(String(200), nullable=True)  # subject only, no body
    provider_message_id = Column(String(255), nullable=True)  # wamid / tg id
    status = Column(String(16), nullable=False, index=True)  # ok | skipped | failed
    detail = Column(String(500), nullable=True)  # machine reason, no PII
    created_at = Column(
        DateTime(timezone=True), default=_utcnow, nullable=False, index=True
    )
