"""Kubotics SQLAlchemy models package.

Importing any submodule of ``app.models`` runs this module first, which
registers ``app.models.needle`` on ``Base.metadata`` alongside the entities
models so ``Base.metadata.create_all`` (local DEBUG lifespan in app.main)
always creates ``needle_inbox`` too.
"""
from app.models.ibkr import IbkrMcpAuthState, IbkrMcpToken
from app.models.mail_agent import MailMessage, MailWatchSender
from app.models.needle import NeedleInbox
from app.models.tasks import AgentOutput, DeviceSnapshotCache, InboundEvent, ScheduledTask

__all__ = [
    "AgentOutput",
    "DeviceSnapshotCache",
    "IbkrMcpAuthState",
    "IbkrMcpToken",
    "InboundEvent",
    "MailMessage",
    "MailWatchSender",
    "NeedleInbox",
    "ScheduledTask",
]
