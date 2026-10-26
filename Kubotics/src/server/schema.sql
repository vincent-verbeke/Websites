-- ============================================================================
-- Kubotics AI-First Autonomous Business Schema (PostgreSQL)
-- Single Source of Truth for Leads, Pipeline, AI Agents, and Transcripts
-- Replaces external CRM (e.g. HubSpot) with an agentic-native relational data model.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fast fuzzy name/company search

-- ----------------------------------------------------------------------------
-- 1. COMPANIES / ORGANIZATIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    domain VARCHAR(150),
    industry VARCHAR(100), -- 'Machining / CNC', 'Watchmaking', 'Logistics', 'Pharma', etc.
    country VARCHAR(100) DEFAULT 'Switzerland',
    city VARCHAR(100),
    employee_bracket VARCHAR(50), -- '1-10', '11-50', '51-250', '250+'
    annual_revenue_bracket VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. CONTACTS / LEADS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    job_title VARCHAR(120),
    preferred_language VARCHAR(10) DEFAULT 'de-CH', -- 'de-CH', 'en', 'fr'
    
    -- Inbound Attribution
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    gclid VARCHAR(255),
    referrer_url TEXT,
    
    -- Lead Status & Scoring
    lifecycle_stage VARCHAR(50) DEFAULT 'lead', -- 'lead', 'marketing_qualified', 'sales_qualified', 'opportunity', 'customer'
    lead_score INT DEFAULT 10,                 -- Dynamic 0-100 score maintained by Sales Agent
    primary_interest VARCHAR(100),              -- 'Unitree H2', 'Factory Robot Arm', 'Invoice LLM', 'IT Automation'
    ai_summary TEXT,                           -- Executive dossier compiled by LLM agent
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. DEALS / COMMERCIAL OPPORTUNITIES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL, -- e.g. "Unitree H2 Test Day & Feasibility PoC"
    deal_type VARCHAR(80) NOT NULL, -- 'Unitree Delivery', 'Test Day', 'Factory Cell', 'LLM Invoice Pipeline'
    pipeline_stage VARCHAR(50) NOT NULL DEFAULT 'inbound_discovery',
    -- Stages: 'inbound_discovery', 'qualification', 'testday_scheduled', 'proposal_drafted', 'founder_review', 'won', 'lost'
    
    estimated_value_chf NUMERIC(12, 2),
    probability NUMERIC(3, 2) DEFAULT 0.20,
    expected_close_date DATE,
    win_loss_reason TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4. INTERACTION CHANNELS & CHAT SESSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    channel VARCHAR(30) DEFAULT 'web_chat', -- 'web_chat', 'email', 'voice_sip'
    ip_hash VARCHAR(64),
    user_agent TEXT,
    status VARCHAR(50) DEFAULT 'active', -- 'active', 'qualified', 'escalated_to_founder', 'closed'
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 5. CHAT / INTERACTION MESSAGES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interaction_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender VARCHAR(30) NOT NULL, -- 'visitor', 'ai_sales_agent', 'ai_support_agent', 'founder'
    content TEXT NOT NULL,
    extracted_entities JSONB, -- JSON with parsed parameters (e.g. {"monthly_invoices": 1200, "budget_chf": 45000})
    token_usage_prompt INT DEFAULT 0,
    token_usage_completion INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. AGENT ACTION LOGS & FOUNDER TASKS (Agentic Workflow State Machine)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    agent_name VARCHAR(60) NOT NULL, -- 'MarketingLeadAgent', 'SalesQualificationAgent', 'VoiceAgent'
    action_type VARCHAR(80) NOT NULL, -- 'qualify_lead', 'draft_proposal', 'schedule_testday', 'send_followup_email'
    status VARCHAR(40) DEFAULT 'pending_approval', 
    -- 'pending_approval' (Rule 8: human approval for consequential actions), 'approved', 'executed', 'rejected'
    
    proposed_payload JSONB NOT NULL, -- Draft email body, proposed test day date, proposal PDF link
    founder_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 7. PERFORMANCE INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON interaction_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
