-- ============================================================================
-- Kubotics Autonomous Business Data Platform (PostgreSQL)
-- Target: AWS RDS PostgreSQL (Schema: kubotics)
-- Architecture: "One Agent Brain, One Business Database, Many Interfaces"
-- Domains:
--   1. Organizations & Customers
--   2. Contacts, Decoupled Addresses & Multi-Channel Communications
--   3. Unified Inbound Interaction & Channel Adapters (Web, Telegram, Teams, Voice)
--   4. Agent Reasoning, Tool Execution & Observability Audit Trail
--   5. Commercial Pipeline (Leads, Opportunities, Quotations)
--   6. Products, Robots & Customer Assets
--   7. Support Cases & Projects
--   8. Knowledge & Vector Embeddings
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector"; -- pgvector for RAG / Agent Knowledge

-- ----------------------------------------------------------------------------
-- DOMAIN 1: ORGANIZATIONS & CUSTOMERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    domain VARCHAR(150),
    industry VARCHAR(100), -- 'Machining / CNC', 'Watchmaking', 'Pharma', 'Logistics', etc.
    employee_bracket VARCHAR(50),
    annual_revenue_bracket VARCHAR(50),
    is_customer BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 2: CONTACTS, ADDRESSES & MULTI-CHANNEL IDENTIFIERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    salutation VARCHAR(30),
    job_title VARCHAR(120),
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'de-CH', -- 'de-CH', 'en', 'fr'
    lifecycle_stage VARCHAR(50) NOT NULL DEFAULT 'lead',     -- 'lead', 'mql', 'sql', 'opportunity', 'customer'
    lead_score INT NOT NULL DEFAULT 10,
    ai_summary TEXT, -- LLM-maintained executive dossier
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-Many Linking: Contacts to Organizations (with Role, Department, Primary flag)
CREATE TABLE IF NOT EXISTS organization_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    role VARCHAR(100) DEFAULT 'Member', -- 'Managing Director', 'Head of Automation', 'External Consultant', 'Board'
    department VARCHAR(100),            -- 'Production / Manufacturing', 'Engineering', 'Executive', 'Procurement'
    is_primary_organization BOOLEAN NOT NULL DEFAULT FALSE,
    is_authorized_signatory BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_contact UNIQUE (organization_id, contact_id)
);

CREATE TABLE IF NOT EXISTS addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    address_type VARCHAR(40) NOT NULL DEFAULT 'office', -- 'office', 'headquarters', 'plant/factory', 'billing', 'shipping'
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    street_line1 VARCHAR(255) NOT NULL,
    street_line2 VARCHAR(255),
    postal_code VARCHAR(30) NOT NULL,
    city VARCHAR(100) NOT NULL,
    canton_or_state VARCHAR(100),
    country VARCHAR(100) NOT NULL DEFAULT 'Switzerland',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_address_owner CHECK (contact_id IS NOT NULL OR organization_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS contact_mailphone (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel_type VARCHAR(30) NOT NULL, -- 'email', 'phone_mobile', 'phone_office', 'whatsapp'
    value VARCHAR(255) NOT NULL,
    label VARCHAR(50) DEFAULT 'work',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contact_channel_val UNIQUE (contact_id, channel_type, value)
);

-- External Identity Mapping (Telegram ID, Teams Azure AAD Object ID, SIP Caller ID)
CREATE TABLE IF NOT EXISTS external_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel VARCHAR(30) NOT NULL, -- 'telegram', 'teams', 'sip_phone', 'whatsapp', 'web'
    external_user_id VARCHAR(255) NOT NULL, -- e.g. Telegram chat_id or Teams user OID
    external_username VARCHAR(150),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_channel_ext_user UNIQUE (channel, external_user_id)
);

-- ----------------------------------------------------------------------------
-- DOMAIN 3: UNIFIED INBOUND SESSIONS & MESSAGES (Channel-Agnostic)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    channel VARCHAR(30) NOT NULL, -- 'web_chat', 'telegram', 'teams', 'voice_sip', 'email'
    external_conversation_id VARCHAR(255), -- Telegram thread_id or Teams conversationId
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'escalated_to_founder', 'closed'
    language VARCHAR(10) DEFAULT 'de-CH',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_type VARCHAR(30) NOT NULL, -- 'visitor', 'ai_agent', 'founder'
    content TEXT NOT NULL,
    attachments JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 4: AGENT OBSERVABILITY & AUDIT TRAIL (Runs, Tools, State)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_name VARCHAR(80) NOT NULL DEFAULT 'KuboticsUnifiedAgent',
    model_identifier VARCHAR(100) NOT NULL, -- 'claude-3-7-sonnet', 'gemini-2.0-flash', etc.
    input_prompt TEXT,
    agent_reasoning TEXT, -- Chain-of-Thought / internal assessment
    final_output TEXT,
    token_usage_input INT DEFAULT 0,
    token_usage_output INT DEFAULT 0,
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL, -- 'schedule_m365_meeting', 'query_knowledge_base', 'create_deal', 'calculate_roi'
    tool_arguments JSONB NOT NULL,
    tool_result JSONB,
    status VARCHAR(30) NOT NULL DEFAULT 'success', -- 'success', 'failed', 'blocked_by_policy'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    action_type VARCHAR(100) NOT NULL, -- 'dispatch_quotation', 'confirm_testday', 'send_followup_email'
    requires_human_approval BOOLEAN NOT NULL DEFAULT TRUE,
    approval_status VARCHAR(40) NOT NULL DEFAULT 'pending_approval', -- 'pending_approval', 'approved', 'rejected', 'auto_executed'
    payload JSONB NOT NULL,
    founder_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- DOMAIN 5: COMMERCIAL PIPELINE (Leads, Opportunities, Quotations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    deal_type VARCHAR(80) NOT NULL, -- 'Unitree Delivery', 'Test Day', 'Factory Cell', 'LLM Invoice Pipeline'
    pipeline_stage VARCHAR(50) NOT NULL DEFAULT 'inbound_discovery',
    -- Stages: 'inbound_discovery', 'qualification', 'testday_scheduled', 'quotation_drafted', 'negotiation', 'won', 'lost'
    estimated_value_chf NUMERIC(12, 2),
    probability NUMERIC(3, 2) DEFAULT 0.20,
    expected_close_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    quote_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. "KUB-2026-0042"
    status VARCHAR(40) NOT NULL DEFAULT 'draft', -- 'draft', 'founder_approved', 'sent', 'accepted', 'expired'
    total_amount_chf NUMERIC(12, 2) NOT NULL,
    valid_until DATE,
    line_items JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 6: PRODUCTS, ROBOTS & ASSETS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(60) UNIQUE NOT NULL, -- e.g. 'UNITREE-H2', 'UNITREE-G1', 'KUBOTICS-INV-LLM'
    name VARCHAR(200) NOT NULL,
    category VARCHAR(80) NOT NULL, -- 'Humanoid Robot', 'Quadruped Robot', 'Robot Arm', 'IT Automation Software'
    base_price_chf NUMERIC(12, 2),
    specifications JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    serial_number VARCHAR(100) UNIQUE,
    installation_date DATE,
    warranty_until DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'commissioned', -- 'in_transit', 'commissioned', 'maintenance', 'retired'
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 7: SUPPORT CASES & PROJECTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES customer_assets(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    severity VARCHAR(30) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    status VARCHAR(40) NOT NULL DEFAULT 'open', -- 'open', 'in_progress', 'waiting_for_client', 'resolved'
    resolution_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL, -- e.g. "CNC Machine Tending Cell Phase 1"
    status VARCHAR(50) NOT NULL DEFAULT 'planning', -- 'planning', 'in_development', 'field_testing', 'live'
    target_delivery_date DATE,
    budget_chf NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- DOMAIN 8: KNOWLEDGE BASE / RAG WITH PGVECTOR
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    source_type VARCHAR(60) NOT NULL, -- 'unitree_manual', 'pricing_guide', 'consulting_methodology', 'faq'
    document_uri VARCHAR(500),
    content TEXT NOT NULL,
    embedding vector(1536), -- Vector embeddings (OpenAI text-embedding-3 or Gemini)
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- INDEXES & PERFORMANCE
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contact_mailphone_val ON contact_mailphone(value);
CREATE INDEX IF NOT EXISTS idx_ext_identities_lookup ON external_identities(channel, external_user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_ext_id ON conversations(channel, external_conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conv ON agent_runs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_status ON agent_actions(approval_status);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_documents USING hnsw (embedding vector_cosine_ops);
