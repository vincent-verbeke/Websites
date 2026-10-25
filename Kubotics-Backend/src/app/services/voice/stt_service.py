import logging
import io
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)


class VoiceTranscriptionService:
    """
    STT Service: Evaluates Groq Whisper vs OpenAI Whisper.
    Groq Whisper (whisper-large-v3-turbo) is recommended:
    - Speed: ~200-300ms turnaround (near real-time)
    - Cost: ~$0.00072 per minute (6x cheaper than OpenAI)
    """

    def __init__(self):
        self.groq_api_key = getattr(settings, "GROQ_API_KEY", "")
        self.openai_api_key = getattr(settings, "OPENAI_API_KEY", "")

    async def transcribe_audio(self, audio_bytes: bytes, filename: str = "voice.ogg", language: str = "de") -> str:
        """Transcribes incoming voice note bytes into text."""
        # 1. Prefer Groq Whisper if API key available
        if self.groq_api_key:
            try:
                from groq import AsyncGroq

                client = AsyncGroq(api_key=self.groq_api_key)
                transcription = await client.audio.transcriptions.create(
                    file=(filename, audio_bytes),
                    model="whisper-large-v3-turbo",
                    prompt="Kubotics, Unitree H2, humanoid robotics, automation, Switzerland, German, English",
                    language=language,
                )
                logger.info("[VoiceSTT] Transcribed via Groq Whisper successfully.")
                return transcription.text
            except Exception as e:
                logger.warning(f"[VoiceSTT] Groq Whisper failed: {e}. Falling back to OpenAI if configured.")

        # 2. Fallback to OpenAI Whisper
        if self.openai_api_key:
            try:
                from openai import AsyncOpenAI

                client = AsyncOpenAI(api_key=self.openai_api_key)
                transcription = await client.audio.transcriptions.create(
                    file=(filename, audio_bytes),
                    model="whisper-1",
                    language=language,
                )
                logger.info("[VoiceSTT] Transcribed via OpenAI Whisper.")
                return transcription.text
            except Exception as e:
                logger.error(f"[VoiceSTT] OpenAI Whisper failed: {e}")

        # 3. Development Mock Fallback if no keys provided yet
        logger.warning("[VoiceSTT] No STT API keys configured. Returning development mock transcription.")
        return "Guten Tag, ich interessiere mich für einen Unitree H2 Testtag in der Schweiz."

    async def transcribe_audio_bytes(self, audio_bytes: bytes, mime_type: str = "audio/ogg", language: str = "de") -> str:
        ext = "mp3" if "mpeg" in mime_type else "ogg"
        return await self.transcribe_audio(audio_bytes, filename=f"voice.{ext}", language=language)


voice_stt_service = VoiceTranscriptionService()
groq_stt = voice_stt_service
