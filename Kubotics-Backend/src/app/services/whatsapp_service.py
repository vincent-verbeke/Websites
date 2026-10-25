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

    async def send_text_message(self, recipient_phone: str, text: str) -> bool:
        """Send a standard text message back to a WhatsApp user."""
        if not self.is_configured:
            logger.warning("[WhatsApp] Service not fully configured; message dispatch skipped.")
            return False

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "text",
            "text": {"preview_url": True, "body": text},
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self.base_url}/{self.phone_number_id}/messages",
                headers=headers,
                json=payload,
            )
            if resp.status_code in (200, 201):
                logger.info(f"[WhatsApp] Text sent to {recipient_phone}")
                return True
            logger.error(f"[WhatsApp] Send text error ({resp.status_code}): {resp.text}")
            return False

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
