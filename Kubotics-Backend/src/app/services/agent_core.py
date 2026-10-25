import logging
import uuid
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.entities import (
    Contact,
    ExternalIdentity,
    Conversation,
    Message,
    AgentRun,
    AgentToolCall,
)
from app.schemas.channel_dto import NormalizedChannelMessage, NormalizedAgentResponse
from app.services.m365_service import m365_service

logger = logging.getLogger(__name__)


class KuboticsAgentCore:
    """
    Channel-Agnostic Core Agent Brain.
    Processes normalized messages regardless of origin (Web, Telegram, Teams, or Voice SIP).
    """

    async def process_inbound(
        self, envelope: NormalizedChannelMessage, db: AsyncSession
    ) -> NormalizedAgentResponse:
        start_time = datetime.utcnow()

        # 1. Resolve or Create Contact via External Identity
        contact = await self._resolve_contact(envelope, db)

        # 2. Resolve or Create Active Conversation
        conversation = await self._resolve_conversation(contact, envelope, db)

        # 3. Record Inbound Message
        inbound_msg = Message(
            conversation_id=conversation.id,
            sender_type="visitor",
            content=envelope.message,
            attachments=envelope.attachments or None,
        )
        db.add(inbound_msg)
        await db.flush()

        # 4. Agent Reasoning & Tool Execution
        reply_text, tool_calls_executed, handoff, meeting_link, quick_replies = (
            await self._run_agent_reasoning(envelope.message, contact)
        )

        # 5. Record Observability Audit (agent_runs & agent_tool_calls)
        latency = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        agent_run = AgentRun(
            conversation_id=conversation.id,
            agent_name="KuboticsUnifiedAgent",
            model_identifier="claude-3-7-sonnet",
            input_prompt=envelope.message,
            agent_reasoning=f"Identified intent from channel: {envelope.channel}. Evaluated tools and business context.",
            final_output=reply_text,
            token_usage_input=len(envelope.message.split()) * 2,
            token_usage_output=len(reply_text.split()) * 2,
            latency_ms=latency,
        )
        db.add(agent_run)
        await db.flush()

        for tool in tool_calls_executed:
            db.add(
                AgentToolCall(
                    agent_run_id=agent_run.id,
                    tool_name=tool["name"],
                    tool_arguments=tool["args"],
                    tool_result=tool["result"],
                    status="success",
                )
            )

        # 6. Record Agent Output Message
        outbound_msg = Message(
            conversation_id=conversation.id,
            sender_type="ai_agent",
            content=reply_text,
        )
        db.add(outbound_msg)
        await db.commit()

        return NormalizedAgentResponse(
            reply=reply_text,
            conversation_id=conversation.id,
            channel=envelope.channel,
            handoff_to_human=handoff,
            quick_replies=quick_replies,
            meeting_link=meeting_link,
        )

    async def _resolve_contact(
        self, envelope: NormalizedChannelMessage, db: AsyncSession
    ) -> Contact:
        """Finds contact by external channel ID or creates new lead record."""
        stmt = (
            select(ExternalIdentity)
            .where(
                ExternalIdentity.channel == envelope.channel,
                ExternalIdentity.external_user_id == envelope.external_user_id,
            )
        )
        result = await db.execute(stmt)
        identity = result.scalar_one_or_none()

        if identity:
            stmt_contact = select(Contact).where(Contact.id == identity.contact_id)
            c_res = await db.execute(stmt_contact)
            return c_res.scalar_one()

        # Create new Contact & External Identity Mapping
        contact = Contact(
            first_name=envelope.external_username or f"User ({envelope.channel})",
            lifecycle_stage="lead",
            lead_score=15,
        )
        db.add(contact)
        await db.flush()

        new_identity = ExternalIdentity(
            contact_id=contact.id,
            channel=envelope.channel,
            external_user_id=envelope.external_user_id,
            external_username=envelope.external_username,
            metadata_payload=envelope.metadata or {},
        )
        db.add(new_identity)
        await db.flush()
        return contact

    async def _resolve_conversation(
        self, contact: Contact, envelope: NormalizedChannelMessage, db: AsyncSession
    ) -> Conversation:
        """Gets active conversation or starts a new session."""
        stmt = (
            select(Conversation)
            .where(
                Conversation.contact_id == contact.id,
                Conversation.channel == envelope.channel,
                Conversation.status == "active",
            )
            .order_by(Conversation.started_at.desc())
        )
        result = await db.execute(stmt)
        conv = result.scalar_one_or_none()
        if conv:
            return conv

        conv = Conversation(
            contact_id=contact.id,
            channel=envelope.channel,
            external_conversation_id=envelope.external_conversation_id,
            status="active",
        )
        db.add(conv)
        await db.flush()
        return conv

    async def _run_agent_reasoning(self, text: str, contact: Contact):
        """Simulates agent evaluation, tool invocation, and business logic."""
        lower = text.lower()
        tool_calls = []
        handoff = False
        meeting_link = None
        quick_replies = []

        if "h2" in lower or "test day" in lower or "robot" in lower:
            tool_calls.append({
                "name": "query_product_catalog",
                "args": {"sku": "UNITREE-H2"},
                "result": {"status": "available", "base_price_chf": "On Request", "lead_time_days": 14}
            })
            reply = (
                "Kubotics delivers turnkey Unitree robotics with official commissioning in Switzerland. "
                "We provide dedicated on-site Consulting & Test Days with the Unitree H2 humanoid. "
                "Would you like to book a direct slot via Vincent's M365 Calendar?"
            )
            quick_replies = ["Book M365 Discovery Slot", "Download H2 Spec Sheet", "Pricing Inquiry"]
            meeting_link = "https://outlook.office.com/bookwithme/user/vincent@kubotics.ch"

        elif "invoice" in lower or "rechnung" in lower or "scan" in lower:
            tool_calls.append({
                "name": "calculate_roi_projection",
                "args": {"category": "invoice_llm", "estimated_volume": 1200},
                "result": {"annual_savings_chf": 167400, "payback_months": 2.5}
            })
            reply = (
                "Our multimodal LLM extraction pipeline parses incoming/outgoing invoices with >98.5% accuracy—"
                "even from low-grade scans, faxes, or wrinkled physical paper directly into your ERP. "
                "We estimate payback within 2.5 months for volumes over 500 invoices/month."
            )
            quick_replies = ["Test Sample Invoices", "ERP Integration Details", "Schedule Technical Call"]

        elif "human" in lower or "founder" in lower or "speak to" in lower or "vincent" in lower:
            handoff = True
            reply = "I am flagging this conversation for Vincent Verbeke (Founder). He will review our transcript and get back to you directly."

        else:
            reply = (
                "Grüezi! I am the Kubotics Autonomous Assistant. We specialize in Unitree humanoid delivery (H2/G1), "
                "custom factory automation with robot arms, and multimodal LLM business process automations in Switzerland. "
                "How can I assist your automation roadmap?"
            )
            quick_replies = ["Unitree H2 Test Day", "Factory Robot Arms", "Invoice LLMs"]

        return reply, tool_calls, handoff, meeting_link, quick_replies


agent_core = KuboticsAgentCore()
