# Kubotics Backend — AI-First Autonomous Platform API

High-performance asynchronous backend engineered for the Kubotics platform.
Built with **Python 3.14**, **FastAPI**, **uv**, and **SQLAlchemy (asyncpg)**.

---

## 1. Architecture & AWS Deployment

```text
  [Internet]
      │
      ▼
[AWS Route 53 (api.kubotics.ch)]
      │
      ▼
[AWS Application Load Balancer (ALB)]
      │   (Port 443 HTTPS -> Port 8000 Target Group)
      │   Health Check: GET /health (HTTP 200)
      ▼
[AWS ECS Fargate Task (kubotics-backend container)]
      │
      ├── PostgreSQL (AWS RDS / schema: kubotics)
      │     ├── companies
      │     ├── contacts
      │     ├── addresses (decoupled 1-to-many)
      │     ├── contact_mailphone (decoupled 1-to-many)
      │     ├── deals (pipeline state machine)
      │     ├── chat_sessions & interaction_messages
      │     └── agent_tasks (human-in-the-loop queue)
      │
      ├── Microsoft 365 Tenant (Graph API / Teams)
      │     └── Schedules discovery calls & Unitree H2 Test Days
      │
      └── Cloud LLM Engine (Claude / Gemini / OpenAI)
            └── Autonomous lead qualification & entity extraction
```

---

## 2. Local Development & Testing (`--dev`)

> **Strict VENV Isolation**: Dependencies are managed exclusively inside `.venv` via `uv`. No global packages are ever installed.

### Prerequisites:
- `uv` package manager (installed in `Coding/Websites/bin/uv` or user PATH)
- Python 3.14 (managed via `uv`)

### 1. Initialize / Recreate VENV (if needed)
```bash
cd /home/vincent/Coding/Websites/Kubotics-Backend
/home/vincent/Coding/Websites/bin/uv venv --python 3.14 --clear .venv
/home/vincent/Coding/Websites/bin/uv pip install setuptools --python .venv
/home/vincent/Coding/Websites/bin/uv pip install -e . --no-build-isolation --python .venv
```

### 2. Start the Local Server with `--dev`
We implemented a dedicated local runner with auto-reload:
```bash
./run.py --dev
```
Or specify a custom port:
```bash
./run.py --dev --port 8000
```
- API Documentation (Swagger UI): `http://127.0.0.1:8000/api/v1/docs`
- Healthcheck: `http://127.0.0.1:8000/health`
- OpenAPI JSON Spec: `http://127.0.0.1:8000/api/v1/openapi.json`

---

## 3. Normalized Database Schema

The database model decouples personal identity from addresses and communication channels:
1. **`companies`**: Organization details, industry (CNC, Machining, Watchmaking), size.
2. **`contacts`**: Core personal identity, lifecycle stage (`lead`, `opportunity`, `customer`), AI summary, and marketing UTM tags.
3. **`addresses`**: Decoupled address records (`street_line1`, `postal_code`, `city`, `canton`, `country`). A contact can have multiple addresses (e.g. office, plant/factory, billing).
4. **`contact_mailphone`**: Decoupled communication channels (`email`, `phone_mobile`, `phone_office`, `whatsapp`). A contact can have multiple emails and phone numbers.
5. **`deals`**: Commercial opportunities and pipeline stages (`inbound_discovery`, `testday_scheduled`, `won`).
6. **`chat_sessions` & `interaction_messages`**: Real-time conversation logs with JSONB `extracted_entities` and token tracking.
7. **`agent_tasks`**: Autonomous agent queue with human approval gates for the founder.

The complete SQL DDL is available in [`src/app/db/schema.sql`](src/app/db/schema.sql).

---

## 4. AWS Load Balancer & ECS Configuration

### Application Load Balancer (ALB) Setup:
- **Host Header Rule**: Forward traffic where `Host == api.kubotics.ch` to the ECS Target Group.
- **Health Check Path**: `/health` (HTTP 200 required).
- **Grace Period**: 30 seconds.
- **Port**: 8000 (HTTP).

### ECS Task Environment Variables:
Inject the following into the ECS Task Definition (retrieved from AWS Secrets Manager):
```ini
ENVIRONMENT=production
DEBUG=false
HOST=0.0.0.0
PORT=8000
POSTGRES_SERVER=your-rds-endpoint.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_USER=kubotics_app
POSTGRES_PASSWORD=your-secure-rds-password
POSTGRES_DB=kubotics
M365_TENANT_ID=your-azure-tenant-id
M365_CLIENT_ID=your-azure-client-id
M365_CLIENT_SECRET=your-azure-client-secret
M365_ORGANIZER_EMAIL=vincent@kubotics.ch
```

---

## 5. Continuous Deployment (CI/CD)

The GitHub Actions workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) automatically builds the multi-stage Docker container on push to `main`, pushes to Amazon ECR, and triggers an in-place rolling update on AWS ECS Fargate without downtime.
