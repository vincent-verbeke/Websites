import logging
import re
import uuid
from datetime import UTC, datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from app.models.entities import (
    ContactMailPhone,
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

BOOKING_LINK = (
    "https://bookings.cloud.microsoft/book/"
    "KuboticsGet2Know@kuroliv.ch/?ismsaljsauthenabled"
)

#: Vincent 2026-11-23 workflow rule: ALWAYS run 2-3 messages of qualifying
#: questions to determine the lead's need BEFORE asking for a meeting. The
#: closing message then asks for email + phone and proposes the meeting.
QUALIFYING_TURNS = 2

#: An explicit "I want to book" skips the qualifying phase immediately —
#: never block an explicit booking request behind our question flow.
_BOOKING_INTENT_RE = re.compile(
    r"\b(book|booking|meet|meeting|termin|appointment|demo|discovery|slot|"
    r"kennenlernen|calendar|calendly|call|videocall|video call)\b",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?<!\d)\+?[\d][\d\s().\-]{6,}\d(?!\d)")


def _closing_reply(context: str) -> str:
    """The closing workflow message: asks for email + phone, then proposes
    the meeting. The booking link lives inside the TEXT so every channel
    (WhatsApp text, Telegram, voice transcript fallback) delivers it — the
    2026-11-23 lead analysis showed a separately-computed link was dropped.
    """
    return (
        f"{context} Could you share your email address and phone number "
        "first? Then let's meet — a short 15-minute get-to-know call. "
        f"Book your slot directly here:\n{BOOKING_LINK}"
    )


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

        # 4. Qualification stage: how many agent messages has this
        # conversation already seen? Turns 1..QUALIFYING_TURNS only ask
        # questions to determine the need; the closing turn asks for
        # email + phone and proposes the meeting (Vincent 2026-11-23).
        stage = (
            await db.execute(
                select(func.count(Message.id)).where(
                    Message.conversation_id == conversation.id,
                    Message.sender_type == "ai_agent",
                )
            )
        ).scalar_one() or 0

        # Capture any email/phone the lead shares in text — the closing
        # message asks for both, so they must land in the CRM contact rows.
        await self._capture_contact_points(contact, envelope, db)

        # 5. Agent Reasoning & Tool Execution
        reply_text, tool_calls_executed, handoff, meeting_link, quick_replies = (
            await self._run_agent_reasoning(envelope.message, stage)
        )

        # 6. Record Observability Audit (agent_runs & agent_tool_calls)
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
            # B3 (docs §17): the contact initiated the conversation ->
            # replying is consented; marketing stays separable via source.
            consent_status=("granted" if envelope.channel == "whatsapp" else "unknown"),
            consent_source=(f"{envelope.channel}_inbound" if envelope.channel == "whatsapp" else None),
            consent_at=(datetime.now(UTC) if envelope.channel == "whatsapp" else None),
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

        # WhatsApp leads must carry the reachable phone in the CRM contact
        # channels table too — otherwise the lead is unusable (2026-11-02:
        # "Dr. Thomas Meier" had it ONLY in external_identities; backfilled
        # + this guard. Doc: TRADING_WATCH_CLOUD.md §13.)
        if envelope.channel == "whatsapp" and envelope.external_user_id:
            db.add(ContactMailPhone(
                contact_id=contact.id,
                channel_type="phone_mobile",
                value=envelope.external_user_id,
                label="whatsapp",
                is_primary=True,
                is_verified=False,
            ))   # created_at/updated_at: model defaults
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

    async def _capture_contact_points(
        self, contact: Contact, envelope: NormalizedChannelMessage, db: AsyncSession
    ) -> None:
        """Persist an email address / phone number the lead shares in text.

        The closing workflow message asks for BOTH (Vincent 2026-11-23), so
        whatever the lead types must reach the CRM contact rows — otherwise
        the follow-up sequence has no channel to send to. Deduplicated
        against existing rows ((contact_id, channel_type, value) is unique).
        """
        text = (envelope.message or "").strip()
        if not text:
            return
        existing = (
            await db.execute(
                select(ContactMailPhone).where(
                    ContactMailPhone.contact_id == contact.id
                )
            )
        ).scalars().all()
        known = {
            (p.channel_type, (p.value or "").strip().lower())
            for p in existing
        }
        label = f"{envelope.channel}_inbound"

        email = _EMAIL_RE.search(text)
        if email:
            value = email.group(0).strip().lower()
            if ("email", value) not in known:
                db.add(ContactMailPhone(
                    contact_id=contact.id,
                    channel_type="email",
                    value=value,
                    label=label,
                    is_primary=not any(p.channel_type == "email" for p in existing),
                    is_verified=False,
                ))
                await db.flush()

        phone = _PHONE_RE.search(text)
        if phone:
            raw = phone.group(0)
            digits = re.sub(r"\D", "", raw)
            known_digits = {
                re.sub(r"\D", "", p.value or "")
                for p in existing
                if p.channel_type in ("phone_mobile", "phone_office", "whatsapp")
            }
            # 8..15 digits AND an international/leading-zero shape keeps order
            # numbers, dates and prices out of the contacts table.
            if (
                8 <= len(digits) <= 15
                and (raw.lstrip().startswith("+") or digits.startswith("0"))
                and digits not in known_digits
            ):
                db.add(ContactMailPhone(
                    contact_id=contact.id,
                    channel_type="phone_mobile",
                    value=("+" + digits.lstrip("+")) if raw.lstrip().startswith("+") else digits,
                    label=label,
                    is_primary=not any(
                        p.channel_type in ("phone_mobile", "phone_office", "whatsapp")
                        for p in existing
                    ),
                    is_verified=False,
                ))
                await db.flush()

    def _run_agent_reasoning(self, text: str, stage: int):
        """Conversation driver for the qualification workflow (Vincent
        2026-11-23): the first QUALIFYING_TURNS replies only ask questions to
        determine the lead's need; the closing reply asks for the lead's
        email address + phone number and proposes the meeting. The booking
        link is part of the reply TEXT so no channel can drop it. An explicit
        booking request jumps straight to the closing reply; a handoff
        request still wins over everything.
        """
        lower = text.lower()
        tool_calls: list[dict] = []

        if (
            "human" in lower
            or "founder" in lower
            or "speak to" in lower
            or "vincent" in lower
        ):
            return (
                (
                    "I am flagging this conversation for Vincent Verbeke (Founder). "
                    "He will review our transcript and get back to you directly."
                ),
                tool_calls, True, None, [],
            )

        closing = stage >= QUALIFYING_TURNS or bool(
            _BOOKING_INTENT_RE.search(lower)
        )

        if "h2" in lower or "test day" in lower or "robot" in lower:
            tool_calls.append({
                "name": "query_product_catalog",
                "args": {"sku": "UNITREE-H2"},
                "result": {"status": "available", "base_price_chf": "On Request", "lead_time_days": 14}
            })
            if closing:
                reply = _closing_reply(
                    "That is exactly what our Unitree H2 Consulting & Test Days "
                    "in Switzerland cover."
                )
                return reply, tool_calls, False, BOOKING_LINK, [
                    "Book M365 Discovery Slot"
                ]
            if stage == 0:
                reply = (
                    "Kubotics delivers turnkey Unitree robotics with official "
                    "commissioning in Switzerland, including on-site Consulting "
                    "& Test Days with the Unitree H2 humanoid. Quick question "
                    "first: which application do you have in mind for the H2 — "
                    "an on-site test day, research, or a concrete process in "
                    "your company?"
                )
                quick_replies = ["Test Day on-site", "Research & demo", "Pricing"]
            else:
                reply = (
                    "Thanks. One more question so I can prepare this properly: "
                    "what does your current setup look like, and when should "
                    "the H2 be operational?"
                )
                quick_replies = ["Just exploring", "Timeline is set", "Pricing"]

        elif "invoice" in lower or "rechnung" in lower or "scan" in lower:
            tool_calls.append({
                "name": "calculate_roi_projection",
                "args": {"category": "invoice_llm", "estimated_volume": 1200},
                "result": {"annual_savings_chf": 167400, "payback_months": 2.5}
            })
            if closing:
                reply = _closing_reply(
                    "Our multimodal LLM extraction pipeline fits that — "
                    "invoices land in your ERP straight from scans, faxes or "
                    "paper."
                )
                return reply, tool_calls, False, BOOKING_LINK, [
                    "Book M365 Discovery Slot"
                ]
            if stage == 0:
                reply = (
                    "Our multimodal LLM extraction pipeline parses incoming & "
                    "outgoing invoices with >98.5% accuracy — even from "
                    "low-grade scans, faxes, or wrinkled physical paper — "
                    "directly into your ERP. Quick question first: what "
                    "monthly volume are you processing?"
                )
                quick_replies = ["500 - 2,000 / month", "2,000 - 10,000 / month", "Pricing"]
            else:
                reply = (
                    "Understood. And which system should the extracted data "
                    "land in, and how do invoices arrive today — email, scan, "
                    "or paper?"
                )
                quick_replies = ["Email", "Scan / paper", "Mixed"]

        else:
            if closing:
                reply = _closing_reply(
                    "Thanks — that is squarely our field (Unitree robotics, "
                    "factory automation, invoice & process LLMs)."
                )
                return reply, tool_calls, False, BOOKING_LINK, [
                    "Book M365 Discovery Slot"
                ]
            if stage == 0:
                reply = (
                    "Grüezi! I am the Kubotics Autonomous Assistant. We "
                    "specialize in Unitree humanoid delivery (H2/G1), custom "
                    "factory automation with robot arms, and multimodal LLM "
                    "business process automations in Switzerland. Quick "
                    "question first: what would you like to automate first — "
                    "robotics (Unitree H2/G1, robot arms) or a business "
                    "process (invoices, scheduling, outreach)?"
                )
                quick_replies = ["Unitree H2 Test Day", "Factory Robot Arms", "Invoice LLMs"]
            else:
                reply = (
                    "Thanks. One more question so I can point you to the right "
                    "solution: what does your current setup look like, and what "
                    "timeline are you aiming for?"
                )
                quick_replies = ["Just exploring", "Project planned", "Pricing"]

        return reply, tool_calls, False, None, quick_replies


agent_core = KuboticsAgentCore()
