# Kubotics Autonomous Business Data Platform & Agent Architecture

## 1. Core Principle
> **"One Agent Brain, One Business Database, Many Interfaces."**

Kubotics does not treat the database as a simple CRM, nor does it develop separate agents for each channel. 
The system operates as an **Autonomous Business Data Platform** in PostgreSQL, accessed by a **Unified Agent Core**, connected to the outside world through lightweight **Channel Adapters**.

```text
       ┌───────────┐      ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
       │  Website  │      │ Telegram Bot  │      │   MS Teams    │      │ Voice / SIP   │
       │ (Angular) │      │  (POC 1 Live) │      │ (POC 3 Corp)  │      │ (POC 4 Audio) │
       └─────┬─────┘      └───────┬───────┘      └───────┬───────┘      └───────┬───────┘
             │                    │                      │                      │
             └────────────────────┼──────────────────────┴──────────────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │  Normalized Channel Layer │
                    │ (FastAPI Inbound Webhook) │
                    └─────────────┬─────────────┘
                                  ▼
                    ┌───────────────────────────┐
                    │    Kubotics Agent Core    │
                    │  - Entity Extraction      │
                    │  - Memory & Context       │
                    │  - Tool Orchestration     │
                    │  - Human-in-the-Loop Gate │
                    └───────┬───────────┬───────┘
                            │           │
            ┌───────────────┘           └───────────────┐
            ▼                                           ▼
┌───────────────────────────────┐       ┌───────────────────────────────┐
│     PostgreSQL System of      │       │          Tool Layer           │
│            Record             │       │ - Microsoft Graph API (M365)  │
│  - organizations & contacts   │       │ - Teams Meeting Links         │
│  - decoupled addresses        │       │ - Automated Quotation Engine  │
│  - contact_mailphone          │       │ - Product Specs (Unitree H2)  │
│  - external_identities        │       │ - LLM Invoicing ROI Engine    │
│  - conversations & messages   │       └───────────────────────────────┘
│  - agent_runs & tool_calls    │
│  - opportunities & quotations │
│  - customer_assets & projects │
│  - pgvector RAG Knowledge     │
└───────────────────────────────┘
```

---

## 2. Relational Schema Architecture (8 Integrated Domains)

The database schema in [`src/app/db/schema.sql`](src/app/db/schema.sql) replaces fragmented SaaS tools with a cohesive operational model:

1. **Organizations & Customers**:
   - `organizations`: B2B accounts, manufacturing sector/industry, revenue bracket, active customer status.
2. **Contacts, Addresses & Channels**:
   - `contacts`: Identity, language (`de-CH`, `en`), lifecycle stage (`lead`, `opportunity`, `customer`), dynamic lead score, executive AI dossier summary.
   - `addresses`: **Decoupled 1-to-many entity**. A contact or organization can have multiple addresses (`office`, `plant/factory`, `billing`, `shipping`).
   - `contact_mailphone`: **Decoupled communication channels**. A contact can link multiple emails and phone numbers (`email`, `phone_mobile`, `phone_office`, `whatsapp`).
   - `external_identities`: Maps external identifiers (Telegram `chat_id`, Teams Azure OID, Caller ID) directly to the unified `contact_id`.
3. **Channel-Agnostic Conversations**:
   - `conversations`: Central conversation state across `web_chat`, `telegram`, `teams`, or `voice_sip`.
   - `messages`: Normalized content, attachments, and timestamps.
4. **Agent Observability & Audit Trail**:
   - `agent_runs`: Captures model identity (`claude-3-7-sonnet`), prompt tokens, output tokens, latency (ms), and internal reasoning.
   - `agent_tool_calls`: Audit log of exact tool names, JSON input arguments, and JSON execution results.
   - `agent_actions`: Queue for high-stakes actions requiring human approval (e.g., dispatching binding quotations or confirming factory visits) before execution.
5. **Commercial Pipeline**:
   - `opportunities`: Pipeline stages (`inbound_discovery`, `testday_scheduled`, `quotation_drafted`, `won`).
   - `quotations`: Structured quotes with SKU line items, discount models, and validity dates.
6. **Products, Robots & Assets**:
   - `products`: Catalog items (`UNITREE-H2`, `UNITREE-G1`, `KUBOTICS-INV-LLM`).
   - `customer_assets`: Physical units installed at client facilities, serial numbers, warranty status.
7. **Projects & Support Cases**:
   - `projects`: Tracking turnkey robot cell installations and custom software deliveries.
   - `support_cases`: SLA tracking, incident severity, and automated technical triage.
8. **Knowledge Base & pgvector**:
   - `knowledge_documents`: Technical manuals, consulting briefs, and pricing guidelines indexed with `vector(1536)` for semantic RAG lookups.

---

## 3. Channel Normalization Contract

All channel adapters transform inbound requests into a standard envelope before handing them to `agent_core.process_inbound()`:

### Inbound Envelope (`NormalizedChannelMessage`):
```json
{
  "channel": "telegram",
  "external_user_id": "184920491",
  "external_conversation_id": "184920491",
  "external_username": "vincent_v",
  "message": "Can we arrange a Unitree H2 test day in Switzerland next month?",
  "attachments": [],
  "metadata": {"telegram_update_id": 98124}
}
```

### Outbound Envelope (`NormalizedAgentResponse`):
```json
{
  "reply": "We conduct on-site Unitree H2 Consulting & Test Days in Switzerland...",
  "conversation_id": "b78d8a7c-44e2-41f8-9a8b-12d837628190",
  "channel": "telegram",
  "handoff_to_human": false,
  "quick_replies": ["Book M365 Discovery Slot", "Download H2 Spec Sheet"],
  "meeting_link": "https://outlook.office.com/bookwithme/user/vincent@kubotics.ch"
}
```

---

## 4. Execution Roadmap

- [x] **Core Platform**: PostgreSQL schema with 8 domains, decoupled addresses, multi-channel identity mapping, and observability tables.
- [x] **Agent Core Engine**: Channel-agnostic reasoning, tool call logging, and M365 Teams calendar scheduling.
- [x] **POC 1 (Telegram Adapter)**: Webhook endpoint `/api/v1/channels/telegram/webhook` to test real-world agent reasoning, memory, and database persistence.
- [x] **POC 2 (Website Integration)**: REST chat endpoint `/api/v1/agent/message` feeding the Angular SSR website directly into the agent core.
- [x] **POC 3 (Microsoft Teams Adapter)**: Bot framework endpoint `/api/v1/channels/teams/webhook` for internal sales assistance and M365 meeting automation.
- [ ] **POC 4 (Voice / Telephony)**: Future SIP/RTP connector feeding speech-to-text directly into `NormalizedChannelMessage` without rewriting any agent logic.
