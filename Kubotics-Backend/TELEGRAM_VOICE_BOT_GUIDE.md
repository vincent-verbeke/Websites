# Kubotics Telegram Voice Bot — Guide & Testing Instructions

The **Kubotics Telegram Voice Bot** is an autonomous channel adapter for the **Kubotics Agent Core**. It allows users to communicate with the company agent via either **written text** or **spoken voice notes** on Telegram.

---

## 1. STT (Speech-to-Text) Recommendation: Groq Whisper vs OpenAI Whisper

| Feature | Groq Whisper (`whisper-large-v3-turbo`) | OpenAI Whisper (`whisper-1`) |
|---|---|---|
| **Speed / Latency** | ⚡ **~200–350 ms** (Near real-time on LPUs) | ⏳ **1,200–2,500 ms** |
| **Pricing** | 💰 **$0.04 / hour** (~$0.00067 / min) | 💵 **$0.36 / hour** ($0.006 / min) — **9x more expensive** |
| **Swiss/German Accuracy** | ⭐ Excellent (state of the art Whisper v3) | ⭐ Very good |
| **Recommendation** | **RECOMMENDED (Primary)** | **Configured as Fallback** |

The backend implementation in [`src/app/services/voice/stt_service.py`](src/app/services/voice/stt_service.py) automatically uses **Groq Whisper** first, falling back to **OpenAI Whisper** if Groq is unavailable.

---

## 2. TTS (Text-to-Speech): ElevenLabs (Eleven Turbo / v4 Turbo)
Integrated via [`src/app/services/voice/tts_service.py`](src/app/services/voice/tts_service.py):
- **Model**: `eleven_turbo_v2_5` (Eleven Turbo / v4 Turbo generation)
- **Latency**: **~100 ms** median inference latency with `optimize_streaming_latency=4`
- **Quality**: High expressiveness, high-fidelity voice cloning, and multilingual Swiss/German performance.
- When a user sends a voice note, the bot transcribes the audio, generates the agent reply, synthesizes speech with Eleven Turbo, and replies with a native Telegram voice note.

---

## 3. Telegram Credentials Clarification

In `telegram.md`, the file lists Telegram MTProto developer credentials:
- `App api_id: 27080187`
- `App api_hash: 0c7b5fb381821b6fe889fb0b6a4cf5eb`

> **Important Note:**  
> These MTProto credentials (`api_id` and `api_hash`) are used when building a custom Telegram client app.  
> To run a standard automated bot (which receives updates and sends voice messages), Telegram uses a **Bot Token** issued by `@BotFather`.
>
> If you haven't obtained the Bot Token yet:
> 1. Open Telegram and search for `@BotFather`.
> 2. Send `/newbot` and follow the 2 steps (Name: `Kubotics AI Agent`, Username: e.g. `KuboticsAIBot`).
> 3. `@BotFather` will give you a token formatted like: `7492810482:AAFlw93kd...`.

---

## 4. How to Test the Telegram Bot Locally (Step-by-Step)

You can test the bot on your local machine right now without deploying to AWS:

### Step 1: Export Environment Keys
```bash
cd /home/vincent/Coding/Websites/Kubotics-Backend

# 1. Your Telegram Bot Token (from @BotFather)
export TELEGRAM_BOT_TOKEN="your_bot_father_token_here"

# 2. Voice STT & TTS Keys
export GROQ_API_KEY="gsk_..."           # Fast Whisper STT
export ELEVENLABS_API_KEY="sk_..."      # ElevenLabs TTS
```

*(Note: If STT/TTS keys are not provided during testing, the bot will still run in text mode and use development mocks for voice!)*

### Step 2: Start the Bot Runner
```bash
.venv/bin/python3 telegram_bot_runner.py
```
You will see:
```text
🚀 Starting Kubotics Autonomous Telegram Voice Bot...
```

### Step 3: Test on Telegram
1. Open your Telegram app and search for your bot username.
2. Send `/start`. The bot will greet you in German.
3. Send a test message:
   - *"Guten Tag, wir interessieren uns für einen Unitree H2 Testtag in der Schweiz."*
4. Record a 5-second voice note on your phone:
   - Speak: *"Wie hoch sind die Einsparungen bei 1200 Rechnungen im Monat?"*
5. The bot will transcribe your voice note, execute the ROI calculation in the agent brain, and send back a voice reply!

---

## 5. Deployment as a Separate ECS Container

When you are ready to deploy:
- A dedicated Dockerfile [`Dockerfile.telegram`](Dockerfile.telegram) is prepared with `ffmpeg` pre-installed for audio transcoding.
- It can run as an independent ECS Fargate task in your AWS cluster sharing the same RDS PostgreSQL database.
