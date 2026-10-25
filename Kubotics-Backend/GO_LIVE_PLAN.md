# Kubotics Platform — Production Go-Live & Migration Plan

This plan outlines the structured path to deploy the **Kubotics Website** (S3 + CloudFront) and the **Kubotics Autonomous Business Platform** (FastAPI on AWS ECS + RDS PostgreSQL), followed by the **Telegram Voice Bot** rollout.

---

## 1. High-Level Production Architecture

```text
                                [Internet Traffic]
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
      [https://kubotics.ch]                       [https://api.kubotics.ch]
      AWS CloudFront CDN                          AWS Route 53 DNS + ACM Cert
              │                                             │
              ▼                                             ▼
      AWS S3 Bucket                               AWS Application Load Balancer
      (Prerendered Angular SPA)                             │
                                                            ▼
                                                  AWS ECS Fargate Cluster
                                                  ┌───────────────────────────┐
                                                  │ Container 1: Backend API  │
                                                  │ (FastAPI, Webhooks, RAG)  │
                                                  ├───────────────────────────┤
                                                  │ Container 2: Telegram Bot │
                                                  │ (Audio STT/TTS & Voice)   │
                                                  └─────────────┬─────────────┘
                                                                │
                                              ┌─────────────────┴─────────────────┐
                                              ▼                                   ▼
                                    AWS RDS PostgreSQL                    Microsoft 365
                                    (Dedicated Schema)                   (Graph API / Teams)
```

---

## 2. Phase-by-Phase Go-Live Checklist

### Phase 1: Database Setup (AWS RDS PostgreSQL)
- [ ] Connect to your existing AWS PostgreSQL RDS instance.
- [ ] Create database or schema: `CREATE SCHEMA IF NOT EXISTS kubotics;`.
- [ ] Enable required extensions:
  ```sql
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS "pg_trgm";
  CREATE EXTENSION IF NOT EXISTS "vector"; -- for pgvector semantic search
  ```
- [ ] Execute [`src/app/db/schema.sql`](src/app/db/schema.sql) to provision all 8 core domains.
- [ ] Create dedicated least-privilege DB user: `kubotics_app`.

### Phase 2: Frontend Deployment (S3 + CloudFront)
- [ ] Run production build in `/Kubotics`:
  ```bash
  npm run build
  ```
- [ ] Copy the contents of `dist/Kubotics/browser/*` to your S3 bucket `s3://kubotics-web-frontend/`.
- [ ] Configure CloudFront Distribution:
  - Default root object: `index.html`.
  - Custom error response: `404 -> /index.html` (HTTP 200) for client-side Angular routing fallback.
  - Invalidate CloudFront cache: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`.
- [ ] Point Route 53 `kubotics.ch` and `www.kubotics.ch` to CloudFront distribution.

### Phase 3: Backend Deployment (AWS ECS Fargate + ALB via GitHub Secrets)
- [ ] Create Amazon ECR Repository: `kubotics-backend`.
- [ ] Store Production Secrets in **GitHub Repository Secrets** (`Settings -> Secrets and variables -> Actions`):
  
  #### 1. Core Database & Infrastructure Secrets
  - `DATABASE_URL`: Full PostgreSQL asyncpg connection string:
    `postgresql+asyncpg://kubotics_app:<PASSWORD>@app-akuris.cluster-cdksucuwyw2t.eu-central-1.rds.amazonaws.com:5432/kubotics`
    *(or separate components: `POSTGRES_SERVER`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`)*
  - `POSTGRES_SCHEMA`: `crm`
  - `ENVIRONMENT`: `production`
  - `DEBUG`: `false`
  - `API_SECRET_KEY`: High-entropy 32+ character random string

  #### 2. AI & Voice Providers
  - `ANTHROPIC_API_KEY`: Anthropic Claude API key (`sk-ant-...`)
  - `OPENAI_API_KEY`: OpenAI API key (`sk-proj-...` or `sk-...`)
  - `GEMINI_API_KEY`: Google Gemini API key
  - `GROQ_API_KEY`: Groq API key for ultra-fast Whisper STT (`gsk_...`)
  - `ELEVENLABS_API_KEY`: ElevenLabs API key for ultra-low-latency voice synthesis (`sk_...`)
  - `ELEVENLABS_VOICE_ID`: `21m00Tcm4TlvDq8ikWAM` (or selected voice clone)
  - `ELEVENLABS_MODEL_ID`: `eleven_turbo_v2_5`

  #### 3. Communication Channels (Telegram & WhatsApp)
  - `TELEGRAM_BOT_TOKEN`: Production BotFather token (e.g. `7972412128:AA...`)
  - `WHATSAPP_ACCESS_TOKEN`: Meta WhatsApp Cloud API Permanent System User Token
  - `WHATSAPP_PHONE_NUMBER_ID`: Meta Phone Number ID (for `+41 78 220 68 96`)
  - `WHATSAPP_VERIFY_TOKEN`: Webhook verification secret token

  #### 4. Microsoft 365 / Entra ID Integration
  - `M365_TENANT_ID`: `aef12348-a49b-42b9-93e5-b8d23baaa54c` (or `AZURE_TENANT_ID`)
  - `M365_CLIENT_ID`: Entra ID Application Client ID (or `AZURE_CLIENT_ID`)
  - `M365_ORGANIZER_EMAIL`: `vincent.verbeke@kuroliv.ch`
  - `AZURE_CLIENT_CERT_THUMBPRINT`: Certificate Thumbprint (when using certificate auth)
  - `AZURE_CLIENT_CERT_KEY`: Base64-encoded private key content (or injected to `certs/m365_app.key`)

  #### 5. CI/CD Deployment Credentials (GitHub Actions)
  - `AWS_ACCESS_KEY_ID`: IAM user/role deployer key
  - `AWS_SECRET_ACCESS_KEY`: IAM user/role deployer secret
  - `AWS_REGION`: `eu-central-1`

- [ ] Deploy Application Load Balancer Rule:
  - Listener 443 (HTTPS with ACM certificate for `api.kubotics.ch`).
  - Target Group: Port 8000, Health check path: `/health` (interval 30s, 2 healthy checks).
- [ ] Trigger GitHub Actions CI/CD ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) to build, push image to ECR, and update ECS task/service.

### Phase 4: Verification & Integration Testing
- [ ] **ALB Healthcheck**: `curl -f https://api.kubotics.ch/health` returns `{"status": "healthy"}`.
- [ ] **End-to-End Web Ingestion**: Submit inquiry via `https://kubotics.ch/#contact`; verify row in `contacts`, `contact_mailphone`, `addresses`, and `opportunities`.
- [ ] **Web Chat Specialist**: Verify chat conversation logs into `conversations` and `messages`.

---

## 3. Telegram Voice Bot Rollout (Next Step)

1. **Bot Registration**:
   - Create bot via `@BotFather` on Telegram $\rightarrow$ obtain `TELEGRAM_BOT_TOKEN`.
   - Set bot privacy mode and description.
2. **Audio Processing Pipeline**:
   - Handle Telegram voice notes (`.oga` / `.ogg` format).
   - Convert via `ffmpeg` to 16kHz PCM.
   - Run Speech-to-Text (STT) via OpenAI Whisper / Groq Whisper.
   - Core Agent processes the recognized text $\rightarrow$ generates reply.
   - Run Text-to-Speech (TTS) via ElevenLabs or OpenAI TTS $\rightarrow$ dispatch voice message back to chat.
3. **Dedicated ECS Container**:
   - Run Telegram Voice Bot as an independent ECS task using long polling (`getUpdates`) or webhook mode.
