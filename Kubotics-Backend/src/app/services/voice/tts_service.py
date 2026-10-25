import logging
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)


class ElevenLabsTTSService:
    """
    TTS Service: Generates natural, low-latency executive voice responses using ElevenLabs.
    Configured with Eleven v4 Turbo / Flash (eleven_flash_v2_5 or eleven_turbo_v2_5)
    delivering ~100ms median inference latency for conversational agent workflows.
    """

    def __init__(self):
        self.api_key = getattr(settings, "ELEVENLABS_API_KEY", "")
        # Default voice ID (e.g. customized multilingual Swiss/German executive voice)
        self.voice_id = getattr(settings, "ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
        # Eleven v4 Turbo: ultra low latency (~100ms) with high expressiveness
        self.model_id = getattr(settings, "ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    async def synthesize_speech(self, text: str) -> bytes:
        """Synthesizes text into audio bytes with low latency."""
        if not self.api_key:
            logger.warning("[TTS] ElevenLabs API key not configured. Returning empty audio bytes.")
            return b""

        # Query parameter optimize_streaming_latency=4 ensures minimum latency (~100ms)
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}?optimize_streaming_latency=4"
        headers = {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        payload = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.8,
                "style": 0.15,
                "use_speaker_boost": True,
            },
        }

        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=headers, timeout=20.0)
            resp.raise_for_status()
            logger.info(f"[TTS] Generated ElevenLabs audio for {len(text)} chars.")
            return resp.content

    async def synthesize_speech_bytes(self, text: str) -> bytes:
        return await self.synthesize_speech(text)


elevenlabs_tts_service = ElevenLabsTTSService()
elevenlabs_tts = elevenlabs_tts_service
voice_tts_service = elevenlabs_tts_service
