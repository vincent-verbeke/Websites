import logging
import httpx
from fastapi import APIRouter, Depends, Request, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.schemas.channel_dto import (
    NormalizedChannelMessage,
    NormalizedAgentResponse,
    TelegramWebhookUpdate,
    TeamsActivityPayload,
)
from app.services.agent_core import agent_core
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


# -----------------------------------------------------------------------------
# 1. UNIFIED CORE AGENT ENDPOINT (Direct API / Web Chat)
# -----------------------------------------------------------------------------
@router.post("/agent/message", response_model=NormalizedAgentResponse)
async def process_normalized_message(
    envelope: NormalizedChannelMessage, db: AsyncSession = Depends(get_db)
):
    """Channel-agnostic entry point for any connected interface."""
    return await agent_core.process_inbound(envelope, db)


# -----------------------------------------------------------------------------
# 2. TELEGRAM CHANNEL ADAPTER (POC 1)
# -----------------------------------------------------------------------------
@router.post("/channels/telegram/webhook")
async def telegram_webhook(update: TelegramWebhookUpdate, db: AsyncSession = Depends(get_db)):
    """
    Receives Telegram webhooks, adapts to NormalizedChannelMessage,
    invokes Agent Core, and posts reply back to Telegram API.
    """
    msg_data = update.message or {}
    text = msg_data.get("text", "")
    chat = msg_data.get("chat", {})
    chat_id = str(chat.get("id", ""))
    from_user = msg_data.get("from", {})
    username = from_user.get("username") or from_user.get("first_name", "TelegramUser")

    if not text or not chat_id:
        return {"ok": True, "status": "ignored_non_text"}

    envelope = NormalizedChannelMessage(
        channel="telegram",
        external_user_id=chat_id,
        external_conversation_id=chat_id,
        external_username=username,
        message=text,
        metadata={"telegram_update_id": update.update_id},
    )

    # Core Agent Execution
    agent_resp = await agent_core.process_inbound(envelope, db)

    # Post reply back to Telegram Bot API if token configured
    telegram_bot_token = getattr(settings, "TELEGRAM_BOT_TOKEN", None)
    if telegram_bot_token:
        try:
            tg_url = f"https://api.telegram.org/bot{telegram_bot_token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": agent_resp.reply,
            }
            async with httpx.AsyncClient() as client:
                await client.post(tg_url, json=payload, timeout=5.0)
        except Exception as e:
            logger.error(f"[Telegram Adapter] Failed to dispatch reply to Telegram: {e}")

    return {
        "ok": True,
        "reply": agent_resp.reply,
        "conversation_id": str(agent_resp.conversation_id),
    }


# -----------------------------------------------------------------------------
# 3. MICROSOFT TEAMS CHANNEL ADAPTER (POC 3)
# -----------------------------------------------------------------------------
@router.post("/channels/teams/webhook")
async def teams_webhook(activity: TeamsActivityPayload, db: AsyncSession = Depends(get_db)):
    """
    Receives Microsoft Teams Bot Framework activities, normalizes,
    and returns agent responses.
    """
    text = activity.text or ""
    sender = activity.from_user or {}
    sender_id = sender.get("id", "unknown_teams_user")
    sender_name = sender.get("name", "TeamsUser")
    conv = activity.conversation or {}
    conv_id = conv.get("id", sender_id)

    envelope = NormalizedChannelMessage(
        channel="teams",
        external_user_id=sender_id,
        external_conversation_id=conv_id,
        external_username=sender_name,
        message=text,
        metadata={"serviceUrl": activity.serviceUrl},
    )

    agent_resp = await agent_core.process_inbound(envelope, db)

    return {
        "type": "message",
        "text": agent_resp.reply,
        "conversation": {"id": conv_id},
    }
