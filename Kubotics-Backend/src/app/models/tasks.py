"""Needle and scheduler domain models: Inbound events, Tasks, and Robot Cache."""
from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    JSON,
    Integer,
    ForeignKey,
    UniqueConstraint,
    Index,
    func
)
from sqlalchemy.dialects.postgresql import UUID
from app.db.session import Base


class InboundEvent(Base):
    """Normalized inbound event stream (website, Telegram, WhatsApp, email)."""
    __tablename__ = "inbound_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(String(128), unique=True, nullable=False, index=True)  # Idempotency key
    channel = Column(String(32), nullable=False)  # website, telegram, whatsapp, email
    sender_id = Column(String(128), nullable=False, index=True)
    payload = Column(JSON, nullable=False, default=dict)
    
    # First-touch / Last-touch UTM attribution
    utm_source = Column(String(64), nullable=True)
    utm_medium = Column(String(64), nullable=True)
    utm_campaign = Column(String(128), nullable=True)
    utm_content = Column(String(128), nullable=True)
    utm_term = Column(String(128), nullable=True)

    status = Column(String(32), default="received", nullable=False)  # received, processed, dead_letter
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ScheduledTask(Base):
    """Orchestrator and Needle task queue (polled by PC-A scheduler daemon)."""
    __tablename__ = "scheduled_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(String(128), unique=True, nullable=False, index=True)  # Idempotency constraint
    correlation_id = Column(String(128), nullable=False, index=True)
    type = Column(String(64), nullable=False, index=True)  # e.g., lead_followup, campaign_eval, robot_telemetry
    priority = Column(Integer, default=10, nullable=False)  # Lower is higher priority
    payload = Column(JSON, nullable=False, default=dict)
    
    status = Column(String(32), default="queued", nullable=False, index=True)
    # queued | assigned | running | succeeded | failed | cancelled | needs_approval
    
    assignee = Column(String(64), nullable=True)  # e.g., "pc-a-needle", "dev-agent-1"
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    
    error = Column(Text, nullable=True)
    result = Column(JSON, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class DeviceSnapshotCache(Base):
    """Snapshot store for edge robots (Unitree H2/G1, arms) and dev-PC telemetry."""
    __tablename__ = "device_snapshot_cache"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dataset = Column(String(64), unique=True, nullable=False, index=True)  # e.g. "robot_h2_state", "cnc_cell_1"
    source = Column(String(64), nullable=False, default="device")
    payload = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AgentOutput(Base):
    """Structured decisions, approvals, and actions produced by autonomous agents."""
    __tablename__ = "agent_outputs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("scheduled_tasks.id", ondelete="CASCADE"), nullable=True)
    correlation_id = Column(String(128), nullable=False, index=True)
    agent_id = Column(String(64), nullable=False)
    decision = Column(String(64), nullable=False)  # approved, rejected, escalated, executed
    summary = Column(Text, nullable=False)
    details = Column(JSON, nullable=False, default=dict)
    requires_human_approval = Column(String(32), default="none", nullable=False)  # none, pending, approved, rejected
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
