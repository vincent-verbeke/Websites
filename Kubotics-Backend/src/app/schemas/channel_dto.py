from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


# -----------------------------------------------------------------------------
# Normalized Channel Input/Output (Channel-Agnostic Agent Envelope)
# -----------------------------------------------------------------------------
class NormalizedChannelMessage(BaseModel):
    """Unified inbound message envelope from Web, Telegram, Teams, or Voice SIP."""
    channel: str = Field(..., description="'web', 'telegram', 'teams', 'sip_phone', 'email'")
    external_user_id: str = Field(..., description="Unique ID in the source channel (e.g. Telegram chat_id or Teams user OID)")
    external_conversation_id: Optional[str] = Field(None, description="Thread or conversation ID")
    external_username: Optional[str] = None
    message: str = Field(..., description="Raw text message or STT voice transcript")
    attachments: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class NormalizedAgentResponse(BaseModel):
    """Normalized response envelope returned to any channel adapter."""
    reply: str
    conversation_id: UUID
    channel: str
    actions: List[Dict[str, Any]] = Field(default_factory=list)
    handoff_to_human: bool = False
    quick_replies: List[str] = Field(default_factory=list)
    meeting_link: Optional[str] = None


# Telegram Webhook Schema
class TelegramWebhookUpdate(BaseModel):
    update_id: int
    message: Optional[Dict[str, Any]] = None
    callback_query: Optional[Dict[str, Any]] = None


# Teams Activity Webhook Schema
class TeamsActivityPayload(BaseModel):
    type: str = "message"
    id: Optional[str] = None
    channelId: str = "msteams"
    serviceUrl: Optional[str] = None
    from_user: Optional[Dict[str, Any]] = Field(None, alias="from")
    conversation: Optional[Dict[str, Any]] = None
    text: Optional[str] = None
