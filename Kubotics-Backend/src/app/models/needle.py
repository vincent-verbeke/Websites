"""needle3 operator intake model (needle_inbox table)."""
from sqlalchemy import JSON, Column, DateTime, Integer, String, Text, func

from app.db.session import Base


class NeedleInbox(Base):
    """Inbox of operator-lane WhatsApp messages polled by the needle3 daemon.

    status: new | dispatched | done | failed
    kind:   "in" (inbound operator message)
    """

    __tablename__ = "needle_inbox"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sender = Column(String, nullable=False)
    wamid = Column(String, nullable=True)
    text = Column(Text, nullable=False)
    kind = Column(String, nullable=False, default="in")
    status = Column(String, nullable=False, default="new")
    session = Column(String, nullable=True)
    reply = Column(Text, nullable=True)
    reply_ts = Column(DateTime(timezone=True), nullable=True)
    meta = Column(JSON, nullable=False, default=dict)
