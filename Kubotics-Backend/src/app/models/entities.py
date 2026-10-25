import uuid
from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Boolean,
    Integer,
    Numeric,
    Text,
    DateTime,
    ForeignKey,
    JSON,
    CheckConstraint,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.session import Base


# -----------------------------------------------------------------------------
# DOMAIN 1 & 2: ORGANIZATIONS, CONTACTS, ADDRESSES & MULTI-CHANNEL IDENTIFIERS
# -----------------------------------------------------------------------------
class Organization(Base):
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False)
    domain = Column(String(150), nullable=True)
    industry = Column(String(100), nullable=True)
    employee_bracket = Column(String(50), nullable=True)
    annual_revenue_bracket = Column(String(50), nullable=True)
    is_customer = Column(Boolean, default=False, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    contacts_link = relationship("OrganizationContact", back_populates="organization", cascade="all, delete-orphan")
    addresses = relationship("Address", back_populates="organization", cascade="all, delete-orphan")
    opportunities = relationship("Opportunity", back_populates="organization")
    assets = relationship("CustomerAsset", back_populates="organization")
    projects = relationship("Project", back_populates="organization")


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    salutation = Column(String(30), nullable=True)
    job_title = Column(String(120), nullable=True)
    preferred_language = Column(String(10), default="de-CH", nullable=False)
    lifecycle_stage = Column(String(50), default="lead", nullable=False)
    lead_score = Column(Integer, default=10, nullable=False)
    ai_summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organizations_link = relationship("OrganizationContact", back_populates="contact", cascade="all, delete-orphan")
    addresses = relationship("Address", back_populates="contact", cascade="all, delete-orphan")
    channels = relationship("ContactMailPhone", back_populates="contact", cascade="all, delete-orphan")
    external_identities = relationship("ExternalIdentity", back_populates="contact", cascade="all, delete-orphan")
    conversations = relationship("Conversation", back_populates="contact")
    opportunities = relationship("Opportunity", back_populates="contact", cascade="all, delete-orphan")


class OrganizationContact(Base):
    __tablename__ = "organization_contacts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(100), default="Member", nullable=False)
    department = Column(String(100), nullable=True)
    is_primary_organization = Column(Boolean, default=False, nullable=False)
    is_authorized_signatory = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization = relationship("Organization", back_populates="contacts_link")
    contact = relationship("Contact", back_populates="organizations_link")

    __table_args__ = (
        UniqueConstraint("organization_id", "contact_id", name="uq_org_contact"),
    )


class Address(Base):
    __tablename__ = "addresses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    address_type = Column(String(40), default="office", nullable=False)
    is_primary = Column(Boolean, default=False, nullable=False)
    street_line1 = Column(String(255), nullable=False)
    street_line2 = Column(String(255), nullable=True)
    postal_code = Column(String(30), nullable=False)
    city = Column(String(100), nullable=False)
    canton_or_state = Column(String(100), nullable=True)
    country = Column(String(100), default="Switzerland", nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    contact = relationship("Contact", back_populates="addresses")
    organization = relationship("Organization", back_populates="addresses")

    __table_args__ = (
        CheckConstraint("contact_id IS NOT NULL OR organization_id IS NOT NULL", name="chk_address_owner"),
    )


class ContactMailPhone(Base):
    __tablename__ = "contact_mailphone"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    channel_type = Column(String(30), nullable=False)  # 'email', 'phone_mobile', 'phone_office', 'whatsapp'
    value = Column(String(255), nullable=False)
    label = Column(String(50), default="work", nullable=True)
    is_primary = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    contact = relationship("Contact", back_populates="channels")

    __table_args__ = (
        UniqueConstraint("contact_id", "channel_type", "value", name="uq_contact_channel_val"),
    )


class ExternalIdentity(Base):
    __tablename__ = "external_identities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String(30), nullable=False)  # 'telegram', 'teams', 'sip_phone', 'web'
    external_user_id = Column(String(255), nullable=False)
    external_username = Column(String(150), nullable=True)
    metadata_payload = Column("metadata", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    contact = relationship("Contact", back_populates="external_identities")

    __table_args__ = (
        UniqueConstraint("channel", "external_user_id", name="uq_channel_ext_user"),
    )


# -----------------------------------------------------------------------------
# DOMAIN 3: UNIFIED INBOUND SESSIONS & MESSAGES (Channel-Agnostic)
# -----------------------------------------------------------------------------
class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True)
    channel = Column(String(30), nullable=False)  # 'web_chat', 'telegram', 'teams', 'voice_sip'
    external_conversation_id = Column(String(255), nullable=True)
    status = Column(String(50), default="active", nullable=False)
    language = Column(String(10), default="de-CH", nullable=False)
    started_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    contact = relationship("Contact", back_populates="conversations")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    agent_runs = relationship("AgentRun", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    sender_type = Column(String(30), nullable=False)  # 'visitor', 'ai_agent', 'founder'
    content = Column(Text, nullable=False)
    attachments = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    conversation = relationship("Conversation", back_populates="messages")


# -----------------------------------------------------------------------------
# DOMAIN 4: AGENT OBSERVABILITY & AUDIT TRAIL (Runs, Tools, State)
# -----------------------------------------------------------------------------
class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    agent_name = Column(String(80), default="KuboticsUnifiedAgent", nullable=False)
    model_identifier = Column(String(100), nullable=False)
    input_prompt = Column(Text, nullable=True)
    agent_reasoning = Column(Text, nullable=True)
    final_output = Column(Text, nullable=True)
    token_usage_input = Column(Integer, default=0, nullable=False)
    token_usage_output = Column(Integer, default=0, nullable=False)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    conversation = relationship("Conversation", back_populates="agent_runs")
    tool_calls = relationship("AgentToolCall", back_populates="agent_run", cascade="all, delete-orphan")
    actions = relationship("AgentAction", back_populates="agent_run")


class AgentToolCall(Base):
    __tablename__ = "agent_tool_calls"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_run_id = Column(UUID(as_uuid=True), ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False)
    tool_name = Column(String(100), nullable=False)
    tool_arguments = Column(JSON, nullable=False)
    tool_result = Column(JSON, nullable=True)
    status = Column(String(30), default="success", nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    agent_run = relationship("AgentRun", back_populates="tool_calls")


class AgentAction(Base):
    __tablename__ = "agent_actions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    agent_run_id = Column(UUID(as_uuid=True), ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=True)
    action_type = Column(String(100), nullable=False)
    requires_human_approval = Column(Boolean, default=True, nullable=False)
    approval_status = Column(String(40), default="pending_approval", nullable=False)
    payload = Column(JSON, nullable=False)
    founder_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    executed_at = Column(DateTime(timezone=True), nullable=True)

    agent_run = relationship("AgentRun", back_populates="actions")


# -----------------------------------------------------------------------------
# DOMAIN 5: COMMERCIAL OPPORTUNITIES & QUOTATIONS
# -----------------------------------------------------------------------------
class Opportunity(Base):
    __tablename__ = "opportunities"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contact_id = Column(UUID(as_uuid=True), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    deal_type = Column(String(80), nullable=False)
    pipeline_stage = Column(String(50), default="inbound_discovery", nullable=False)
    estimated_value_chf = Column(Numeric(12, 2), nullable=True)
    probability = Column(Numeric(3, 2), default=0.20, nullable=False)
    expected_close_date = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    contact = relationship("Contact", back_populates="opportunities")
    organization = relationship("Organization", back_populates="opportunities")
    quotations = relationship("Quotation", back_populates="opportunity", cascade="all, delete-orphan")


class Quotation(Base):
    __tablename__ = "quotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    opportunity_id = Column(UUID(as_uuid=True), ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False)
    quote_number = Column(String(50), unique=True, nullable=False)
    status = Column(String(40), default="draft", nullable=False)
    total_amount_chf = Column(Numeric(12, 2), nullable=False)
    valid_until = Column(DateTime, nullable=True)
    line_items = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    opportunity = relationship("Opportunity", back_populates="quotations")


# -----------------------------------------------------------------------------
# DOMAIN 6: PRODUCTS & CUSTOMER ASSETS
# -----------------------------------------------------------------------------
class Product(Base):
    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sku = Column(String(60), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    category = Column(String(80), nullable=False)
    base_price_chf = Column(Numeric(12, 2), nullable=True)
    specifications = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class CustomerAsset(Base):
    __tablename__ = "customer_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    serial_number = Column(String(100), unique=True, nullable=True)
    installation_date = Column(DateTime, nullable=True)
    warranty_until = Column(DateTime, nullable=True)
    status = Column(String(50), default="commissioned", nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    organization = relationship("Organization", back_populates="assets")


# -----------------------------------------------------------------------------
# DOMAIN 7: PROJECTS & SUPPORT CASES
# -----------------------------------------------------------------------------
class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    opportunity_id = Column(UUID(as_uuid=True), ForeignKey("opportunities.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    status = Column(String(50), default="planning", nullable=False)
    target_delivery_date = Column(DateTime, nullable=True)
    budget_chf = Column(Numeric(12, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    organization = relationship("Organization", back_populates="projects")
