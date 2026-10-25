"""WhatsApp for Business Cloud API Router & Webhook Handler.

Supports:
1. GET /webhook: Meta Webhook Challenge Verification (for zero-downtime cutover).
2. POST /webhook: Inbound message ingestion (Text, Audio/Voice notes).
   - Audio notes are automatically transcribed via Groq Whisper STT (~250ms).
   - Routed into KuboticsAgentCore to update crm.contacts, crm.conversations, crm.messages.
   - Outbound reply returned as text or ElevenLabs Turbo v2.5 voice note.
3. Compatibility forwarder from legacy /api/whatsapp/* routes.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal, get_db
from app.models.needle import NeedleInbox
from app.schemas.channel_dto import NormalizedChannelMessage
from app.services.agent_core import agent_core
from app.services.voice.stt_service import groq_stt
from app.services.voice.tts_service import elevenlabs_tts
from app.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["WhatsApp Webhook"])

VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "kubotics_wa_verify_token_2026")


# -----------------------------------------------------------------------------
# needle3 operator lane: messages from settings.NEEDLE_OPERATOR_SENDERS are
# persisted into needle_inbox for the needle3 daemon instead of agent_core.
# -----------------------------------------------------------------------------
def _needle_operator_senders() -> set[str]:
    """Comma-separated NEEDLE_OPERATOR_SENDERS, whitespace-stripped."""
    return {part.strip() for part in settings.NEEDLE_OPERATOR_SENDERS.split(",") if part.strip()}


def _is_needle_operator(sender_phone: str | None) -> bool:
    if not sender_phone:
        return False
    return sender_phone.strip() in _needle_operator_senders()


async def _maybe_route_operator(
    sender_phone: str,
    incoming_text: str,
    wamid: str | None,
    db: AsyncSession,
) -> bool:
    """Persist an operator text message in needle_inbox (needle3 intake).

    Returns False for non-operator senders so callers keep the agent_core path.
    """
    if not _is_needle_operator(sender_phone):
        return False
    db.add(
        NeedleInbox(
            sender=sender_phone,
            text=incoming_text,
            wamid=wamid,
            kind="in",
            status="new",
        )
    )
    await db.commit()
    return True


def _walk_message_lists(payload: Any) -> Iterator[list[dict[str, Any]]]:
    """Yield the mutable message lists of a Meta webhook payload (shape-defensive)."""
    if not isinstance(payload, dict):
        return
    entries = payload.get("entry")
    if not isinstance(entries, list):
        return
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        changes = entry.get("changes")
        if not isinstance(changes, list):
            continue
        for change in changes:
            if not isinstance(change, dict):
                continue
            value = change.get("value")
            if not isinstance(value, dict):
                continue
            messages = value.get("messages")
            if isinstance(messages, list):
                yield messages


def _collect_operator_text_messages(
    payload: Any,
) -> list[tuple[str, str, str | None, dict[str, Any]]]:
    """Find operator text messages in a webhook payload (does not mutate the payload).

    Returns (sender, text, wamid, message-dict) tuples; the raw message dicts are
    kept so they can later be removed from the payload by identity.
    """
    found: list[tuple[str, str, str | None, dict[str, Any]]] = []
    for messages in _walk_message_lists(payload):
        for msg in messages:
            if msg.get("type") != "text":
                continue
            sender_phone = msg.get("from")
            text_obj = msg.get("text")
            incoming_text = text_obj.get("body", "") if isinstance(text_obj, dict) else ""
            if not isinstance(sender_phone, str) or not incoming_text.strip():
                continue
            if _is_needle_operator(sender_phone):
                found.append((sender_phone, incoming_text, msg.get("id"), msg))
    return found


def _discard_messages(payload: Any, discard: list[dict[str, Any]]) -> None:
    """Remove already-routed message dicts from the payload (identity-based)."""
    discard_ids = {id(msg) for msg in discard}
    for messages in _walk_message_lists(payload):
        messages[:] = [
            msg for msg in messages if not (isinstance(msg, dict) and id(msg) in discard_ids)
        ]


@router.get("/webhook", response_class=PlainTextResponse)
@router.get("/api/whatsapp/webhook", response_class=PlainTextResponse)
async def verify_webhook(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
):
    """
    Meta Webhook Verification Challenge.
    Meta sends: hub.mode=subscribe, hub.challenge=xxx, hub.verify_token=yyy.
    Returns the raw challenge string with HTTP 200 to establish verification.
    """
    logger.info(f"[WhatsApp] Verification challenge received: mode={hub_mode}, token={hub_verify_token}")
    expected_token = os.getenv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN)

    if hub_mode == "subscribe" and hub_verify_token == expected_token:
        logger.info("[WhatsApp] Challenge verified successfully!")
        return hub_challenge or ""

    logger.warning("[WhatsApp] Verification failed: token mismatch or invalid mode")
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Verification token mismatch",
    )


async def _process_whatsapp_inbound_async(payload: dict[str, Any]):
    """Background processor for incoming WhatsApp messages to keep Meta 200 response fast."""
    try:
        entries = payload.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                contacts_meta = value.get("contacts", [])
                user_display_name = contacts_meta[0].get("profile", {}).get("name", "WhatsApp User") if contacts_meta else "WhatsApp User"
                
                messages = value.get("messages", [])
                for msg in messages:
                    sender_phone = msg.get("from")
                    msg_id = msg.get("id")
                    msg_type = msg.get("type")
                    
                    if not sender_phone:
                        continue

                    incoming_text = ""
                    is_voice = False

                    # 1. Extract text or handle voice note
                    if msg_type == "text":
                        incoming_text = msg.get("text", {}).get("body", "")
                    elif msg_type in ("audio", "voice"):
                        is_voice = True
                        audio_meta = msg.get("audio", {}) or msg.get("voice", {})
                        media_id = audio_meta.get("id")
                        if media_id:
                            logger.info(f"[WhatsApp] Downloading voice note media_id: {media_id}")
                            audio_bytes = await whatsapp_service.download_media_bytes(media_id)
                            if audio_bytes:
                                # Transcribe using Groq Whisper (~250ms)
                                incoming_text = await groq_stt.transcribe_audio_bytes(
                                    audio_bytes,
                                    mime_type=audio_meta.get("mime_type", "audio/ogg"),
                                    language="de"
                                )
                                logger.info(f"[WhatsApp] Voice Transcribed: '{incoming_text}'")

                    if not incoming_text.strip():
                        continue

                    # 2. Process through unified Kubotics Agent Core in fresh DB session
                    async with AsyncSessionLocal() as session:
                        envelope = NormalizedChannelMessage(
                            channel="whatsapp",
                            external_user_id=sender_phone,
                            external_conversation_id=sender_phone,
                            external_username=user_display_name,
                            message=incoming_text,
                            metadata={"whatsapp_message_id": msg_id, "is_voice": is_voice},
                        )
                        agent_resp = await agent_core.process_inbound(envelope, session)

                    reply_text = agent_resp.reply

                    # 3. Deliver reply back to WhatsApp
                    # If user sent voice and ElevenLabs is enabled, optionally send voice note
                    sent_voice = False
                    if is_voice and elevenlabs_tts.is_configured:
                        try:
                            audio_reply = await elevenlabs_tts.synthesize_speech_bytes(reply_text)
                            sent_voice = await whatsapp_service.send_audio_message(sender_phone, audio_reply)
                        except Exception as e:  # noqa: BLE001 -- voice reply must not crash the lane
                            logger.error(f"[WhatsApp] Error sending voice note reply: {e}")

                    if not sent_voice:
                        await whatsapp_service.send_text_message(sender_phone, reply_text)

    except Exception:
        logger.exception("[WhatsApp Inbound Error]")


@router.post("/webhook")
@router.post("/api/whatsapp/webhook")
async def receive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Meta Webhook Inbound Message Receiver.
    Always returns HTTP 200 immediately to prevent Meta from retrying or disabling the webhook.
    Processes agent reasoning and reply dispatch in the background.

    needle3 operator lane: text messages from settings.NEEDLE_OPERATOR_SENDERS are
    persisted synchronously into needle_inbox and answered with
    {"ok": true, "routed": "needle"}; only the remaining messages reach agent_core.
    """
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 -- keep Meta's always-200 behavior on garbage payloads
        return {"status": "ok", "detail": "invalid json ignored"}

    # Operator-lane fast path: insert rows first, then strip those messages from
    # the payload so the background agent_core path never sees them.
    routed_messages: list[dict[str, Any]] = []
    try:
        for sender_phone, incoming_text, wamid, msg in _collect_operator_text_messages(payload):
            try:
                if await _maybe_route_operator(sender_phone, incoming_text, wamid, db):
                    routed_messages.append(msg)
            except Exception:
                logger.exception(f"[Needle] Failed to persist operator message wamid={wamid}")
    except Exception:
        logger.exception("[Needle] Operator routing scan failed")

    if routed_messages:
        _discard_messages(payload, routed_messages)

    # Dispatch to background task to guarantee < 100ms response to Meta
    background_tasks.add_task(_process_whatsapp_inbound_async, payload)

    if routed_messages:
        return {"ok": True, "routed": "needle"}
    return {"status": "ok"}
