#!/usr/bin/env python3
"""
Kubotics Autonomous Telegram Bot Runner (Text + Voice Notes)
Connects directly to the Kubotics Agent Core & PostgreSQL Database.
Can run locally or as a dedicated AWS ECS container.
"""

import os
import sys
import io
import asyncio
import logging
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# Ensure src is on Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "src")))

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.schemas.channel_dto import NormalizedChannelMessage
from app.services.agent_core import agent_core
from app.services.voice.stt_service import voice_stt_service
from app.services.voice.tts_service import voice_tts_service

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logger = logging.getLogger("KuboticsTelegramBot")


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles the /start command, customizing greeting by topic if passed in args."""
    args = context.args or []
    payload = args[0].lower() if args else ""

    if payload == "h2_testday":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — Unitree H2 Humanoid Specialist.*\n\n"
            "Ich habe vermerkt, dass Sie sich für den *Unitree H2 Humanoiden* oder einen *Beratungs- & Testtag* interessieren.\n\n"
            "Ich kann Ihnen sofort Spezifikationen, Einsatzerfahrungen und Konditionen erläutern oder einen direkten Termin im Kalender von Vincent Verbeke reservieren.\n\n"
            "Sprechen Sie mir einfach eine *Sprachnachricht* auf oder schreiben Sie mir Ihre Fragen!"
        )
    elif payload == "g1_robot":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — Unitree G1 & G1-D Fokus.*\n\n"
            "Sie interessieren sich für die kompakte, agile humanoide Plattform *Unitree G1* (GROOT & PI 0.5 KI-Steuerung).\n\n"
            "Wie kann ich Sie bei Entwicklung, Forschung oder industrieller Erprobung unterstützen?"
        )
    elif payload == "b2_quadruped":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — Unitree B2 Industrie-Quadruped.*\n\n"
            "Gerne beantworte ich Fragen zum *Unitree B2* (IP67-Schutz, 40kg Traglast, autonome Fabrikinspektion und Vermessung).\n\n"
            "Möchten Sie eine Live-Demonstration oder technische Datenblätter besprechen?"
        )
    elif payload == "factory_arms":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — Fabrikautomation & Roboterzellen.*\n\n"
            "Sie interessieren sich für massgeschneiderte *Roboterarme, Cobots oder automatisierte Maschinenbeschickung* in der Schweiz.\n\n"
            "Erzählen Sie mir kurz von Ihrem Anwendungsfall (z.B. Bauteile, Taktzeit, CNC-Anbindung) per Text oder Sprachnachricht!"
        )
    elif payload == "llm_invoices":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — Multimodale Rechnungs-LLMs.*\n\n"
            "Unsere KI-Pipeline extrahiert Belege, Rechnungen und Lieferscheine selbst aus *zerknitterten, minderwertigen Scans oder Faxen* mit >98.5% Genauigkeit direkt in Ihr ERP.\n\n"
            "Möchten Sie eine Machbarkeitsprüfung mit Ihren Testbelegen starten?"
        )
    elif payload == "erp_planning":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — IT-Prozessautomation & ERP.*\n\n"
            "Wir automatisieren Personal- und Ressourceneinsatzplanung sowie Auftragsabläufe zwischen Werkstattboden und ERP-Systemen.\n\n"
            "Welche Systeme möchten Sie synchronisieren?"
        )
    elif payload == "chatbots_voice":
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics — Voice- & Messaging-Agenten.*\n\n"
            "Wir entwickeln enterprise-grade Chatbots & Voice Bots mit nativer Anbindung an:\n"
            "• *SIP / VoIP Telefonie* (Inbound / Outbound Echtzeit-Gespräche)\n"
            "• *Microsoft Teams* (Graph Calling & Meeting-Assistenten)\n"
            "• *WhatsApp for Business & Telegram*\n"
            "• *CRM / ERP-Integration & Kalenderbuchung*\n\n"
            "Sprechen Sie mir einfach auf oder beschreiben Sie Ihren Anwendungsfall!"
        )
    else:
        welcome_text = (
            "🤖 *Grüezi! Willkommen bei Kubotics.*\n\n"
            "Ich bin Ihr autonomer KI-Spezialist für Robotik & Geschäftsprozessautomation in der Schweiz.\n\n"
            "Sie können mir jederzeit schreiben oder eine *Sprachnachricht senden*. "
            "Ich beantworte Fragen zu:\n"
            "• *Unitree H2 & G1* Humanoid Consulting & Testtagen\n"
            "• *Fabrikautomation & Roboterarmen*\n"
            "• *Automatisierter Rechnungsverarbeitung mit multimodalen LLMs*\n"
            "• Direkter Terminbuchung im Kalender von Vincent Verbeke\n\n"
            "Wie kann ich Ihnen weiterhelfen?"
        )

    await update.message.reply_text(welcome_text, parse_mode="Markdown")


async def handle_text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Processes text messages through the unified Kubotics Agent Core."""
    user = update.effective_user
    chat_id = str(update.effective_chat.id)
    text = update.message.text

    logger.info(f"[Telegram Text] Message from {user.first_name} ({chat_id}): {text}")

    envelope = NormalizedChannelMessage(
        channel="telegram",
        external_user_id=chat_id,
        external_conversation_id=chat_id,
        external_username=user.username or user.first_name,
        message=text,
        metadata={
            "telegram_user_id": user.id,
            "language_code": user.language_code,
        },
    )

    async with AsyncSessionLocal() as db:
        response = await agent_core.process_inbound(envelope, db)

    # Reply with text and optional meeting link
    reply_msg = response.reply
    if response.meeting_link:
        reply_msg += f"\n\n📅 *Terminbuchung:* [Hier Slot im M365-Kalender wählen]({response.meeting_link})"

    await update.message.reply_text(reply_msg, parse_mode="Markdown")


async def handle_voice_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Processes voice notes: Downloads audio -> Whisper STT -> Agent Core -> ElevenLabs TTS."""
    user = update.effective_user
    chat_id = str(update.effective_chat.id)
    voice = update.message.voice

    await update.message.reply_chat_action("record_voice")

    # 1. Download voice note file from Telegram
    voice_file = await context.bot.get_file(voice.file_id)
    file_bytes = await voice_file.download_as_bytearray()

    logger.info(f"[Telegram Voice] Received audio ({len(file_bytes)} bytes) from {user.first_name}")

    # 2. Transcribe audio via STT (Groq Whisper / OpenAI)
    transcription = await voice_stt_service.transcribe_audio(bytes(file_bytes), "voice.ogg")
    await update.message.reply_text(f"🎙 *Transkription:* _{transcription}_", parse_mode="Markdown")

    # 3. Process transcription in Agent Core & PostgreSQL
    envelope = NormalizedChannelMessage(
        channel="telegram_voice",
        external_user_id=chat_id,
        external_conversation_id=chat_id,
        external_username=user.username or user.first_name,
        message=transcription,
        metadata={"voice_duration": voice.duration, "file_id": voice.file_id},
    )

    async with AsyncSessionLocal() as db:
        response = await agent_core.process_inbound(envelope, db)

    # 4. Synthesize voice response via ElevenLabs TTS
    audio_reply = await voice_tts_service.synthesize_speech(response.reply)

    if audio_reply:
        # Send voice audio note back
        await update.message.reply_voice(
            voice=io.BytesIO(audio_reply),
            caption=response.reply[:1024],
        )
    else:
        # Fallback to text if ElevenLabs key not yet supplied
        reply_msg = response.reply
        if response.meeting_link:
            reply_msg += f"\n\n📅 *M365 Kalender:* [Termin wählen]({response.meeting_link})"
        await update.message.reply_text(reply_msg, parse_mode="Markdown")


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or getattr(settings, "TELEGRAM_BOT_TOKEN", None)
    if not token or token == "YOUR_BOT_TOKEN":
        print("❌ Error: TELEGRAM_BOT_TOKEN environment variable is missing.")
        print("Set it via: export TELEGRAM_BOT_TOKEN='your:token' and re-run.")
        sys.exit(1)

    print(f"🚀 Starting Kubotics Autonomous Telegram Voice Bot...")
    
    # Configure resilient HTTP connection with 30s timeout and connection pool
    from telegram.request import HTTPXRequest
    request = HTTPXRequest(
        connect_timeout=30.0,
        read_timeout=30.0,
        write_timeout=30.0,
        pool_timeout=30.0,
        connection_pool_size=10,
    )

    app = (
        ApplicationBuilder()
        .token(token)
        .request(request)
        .get_updates_request(request)
        .build()
    )

    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_text_message))
    app.add_handler(MessageHandler(filters.VOICE, handle_voice_message))

    app.run_polling(drop_pending_updates=True, timeout=20)


if __name__ == "__main__":
    main()
