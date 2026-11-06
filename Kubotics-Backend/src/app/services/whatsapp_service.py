"""Meta WhatsApp for Business Cloud API Client.

Handles:
- Downloading incoming audio / voice notes from Meta Graph CDN.
- Sending outbound text replies.
- Sending outbound audio / voice note replies (synthesized by ElevenLabs).
"""
from __future__ import annotations

import logging
import os
import tempfile
from typing import Any, Dict, Optional
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

# Meta WhatsApp Cloud API hard limit: a text body >4096 chars is REJECTED
# outright (the whole message is lost, nothing is delivered in part).
# 2026-11-06: needle/agent/trading-watch replies all funnel through
# send_text_message, so splitting HERE means no lane can ever lose content
# to the limit again (Vincent: "messages cut off").
WA_TEXT_MAX = 4096
WA_PART_MAX = 4000   # headroom for the "(n/m)" part marker


def split_whatsapp_text(text: str, limit: int = WA_PART_MAX) -> list[str]:
    """Split into <=limit parts on line/space boundaries — content preserved,
    only whitespace at the cut is dropped. Returns [] for empty input."""
    text = text or ""
    if len(text) <= limit:
        return [text] if text else []
    parts: list[str] = []
    rest = text
    while len(rest) > limit:
        cut = rest.rfind("\n", 0, limit)
        if cut < limit // 3:
            cut = rest.rfind(" ", 0, limit)
        if cut < 1:
            cut = limit
        parts.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip("\n")
    if rest.strip():
        parts.append(rest)
    return parts


class WhatsAppService:
    def __init__(
        self,
        access_token: Optional[str] = None,
        phone_number_id: Optional[str] = None,
        api_version: str = "v21.0",
    ):
        self.access_token = access_token or os.getenv("WHATSAPP_ACCESS_TOKEN", "")
        self.phone_number_id = phone_number_id or os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
        self.api_version = api_version or os.getenv("WHATSAPP_API_VERSION", "v21.0")
        self.base_url = f"https://graph.facebook.com/{self.api_version}"

    @property
    def is_configured(self) -> bool:
        return bool(self.access_token and self.phone_number_id)

    async def download_media_bytes(self, media_id: str) -> Optional[bytes]:
        """Fetch media URL from Meta Graph and download the raw bytes (e.g. voice notes)."""
        if not self.access_token:
            logger.warning("[WhatsApp] Cannot download media: WHATSAPP_ACCESS_TOKEN not set.")
            return None

        headers = {"Authorization": f"Bearer {self.access_token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            # 1. Query media metadata to get download URL
            meta_res = await client.get(f"{self.base_url}/{media_id}", headers=headers)
            if meta_res.status_code != 200:
                logger.error(f"[WhatsApp] Failed to query media {media_id}: {meta_res.text}")
                return None

            download_url = meta_res.json().get("url")
            if not download_url:
                logger.error(f"[WhatsApp] No download URL returned for media {media_id}")
                return None

            # 2. Download binary stream
            media_res = await client.get(download_url, headers=headers)
            if media_res.status_code == 200:
                return media_res.content
            logger.error(f"[WhatsApp] Failed to download media bytes: {media_res.status_code}")
            return None

    async def send_text_message(self, recipient_phone: str, text: str) -> tuple[bool, str | None, dict | None]:
        """Send a standard text message back to a WhatsApp user.

        Long texts are sent as several messages (Meta rejects >4096 chars in
        one body); each part is labeled "(i/n)" so nothing reads as cut off.
        Returns: (success: bool, wamid: str | None, raw_response: dict | None)
        """
        if not self.is_configured:
            logger.warning("[WhatsApp] Service not fully configured; message dispatch skipped.")
            return False, None, {"error": "service_not_configured"}

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        parts = split_whatsapp_text(text)
        first_wamid: str | None = None
        data: dict | None = None

        async with httpx.AsyncClient(timeout=15.0) as client:
            for i, part in enumerate(parts, 1):
                body = part if len(parts) == 1 else f"({i}/{len(parts)}) {part}"
                payload = {
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": recipient_phone,
                    "type": "text",
                    "text": {"preview_url": True, "body": body},
                }
                resp = await client.post(
                    f"{self.base_url}/{self.phone_number_id}/messages",
                    headers=headers,
                    json=payload,
                )
                data = (resp.json()
                        if resp.headers.get("content-type", "")
                        .startswith("application/json") else {})
                if resp.status_code not in (200, 201):
                    logger.error(f"[WhatsApp] Send text error ({resp.status_code}): {resp.text}")
                    return False, first_wamid, data
                if first_wamid is None:
                    first_wamid = ((data.get("messages") or [{}])[0]
                                   .get("id") or None)
                logger.info(f"[WhatsApp] Text part {i}/{len(parts)} sent to {recipient_phone}")

        return True, first_wamid, data

    async def send_audio_message(self, recipient_phone: str, audio_bytes: bytes, filename: str = "voice_note.mp3") -> bool:
        """Upload audio and send as a WhatsApp voice/audio message."""
        if not self.is_configured:
            return False

        headers = {"Authorization": f"Bearer {self.access_token}"}
        
        # 1. Upload audio file to Meta Media endpoint
        files = {
            "file": (filename, audio_bytes, "audio/mpeg"),
            "messaging_product": (None, "whatsapp"),
            "type": (None, "audio/mpeg"),
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            up_res = await client.post(
                f"{self.base_url}/{self.phone_number_id}/media",
                headers=headers,
                files=files,
            )
            if up_res.status_code not in (200, 201):
                logger.error(f"[WhatsApp] Media upload failed: {up_res.text}")
                return False

            media_id = up_res.json().get("id")

            # 2. Send audio message referencing uploaded media_id
            msg_payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient_phone,
                "type": "audio",
                "audio": {"id": media_id},
            }
            resp = await client.post(
                f"{self.base_url}/{self.phone_number_id}/messages",
                headers={"Authorization": f"Bearer {self.access_token}", "Content-Type": "application/json"},
                json=msg_payload,
            )
            return resp.status_code in (200, 201)


whatsapp_service = WhatsAppService()
