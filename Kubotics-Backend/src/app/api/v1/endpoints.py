import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.schemas.dto import (
    InboundLeadCreate,
    LeadResponse,
    ChatMessagePayload,
    ChatAgentResponse,
    MeetingBookingRequest,
)
from app.services import mail_llm
from app.services.lead_service import lead_service
from app.services.m365_service import m365_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Hard ceiling for one website-chat turn. The provider chain retries every
# step with a 60s httpx timeout each; a browser visitor must never wait that
# long, so the whole chain call is bounded and falls back to the canned
# keyword reply on timeout (website stays responsive even if all LLM
# providers are down).
CHAT_LLM_TIMEOUT_S = 30.0

BOOKING_LINK = (
    "https://bookings.cloud.microsoft/book/"
    "KuboticsGet2Know@kuroliv.ch/?ismsaljsauthenabled"
)

# System prompt for the website CTA chat (Vincent 2026-11-11: "ensure this CTA
# chat uses the LLM which we use to chat combined with context so we get a top
# professional example"). Context = same provider chain the Kubot mail agent
# uses (mail_llm: MiMo -> OpenAI -> Gemini -> Grok) + full conversation history
# + page/topic context sent by the frontend.
CHAT_SYSTEM_PROMPT = """\
You are the Kubotics Sales Engineer — the official AI assistant of Kubotics, \
a brand of KuroLIV GmbH (Färberstrasse 5, 8832 Wollerau, Switzerland, \
UID CHE-365.727.853), founded by Vincent Verbeke. You answer website visitors \
with Swiss precision: professional, warm, concise and concrete. Never invent \
prices, ROI figures or capabilities that are not listed below.

PORTFOLIO
1. Humanoid & mobile robotics: Unitree H2 (flagship, 31 DoF, 360 Nm), G1/G1-D, \
B2 quadruped — delivery, Swiss support, safety compliance, and hands-on \
Consulting & Test Days in Switzerland.
2. Factory automation: turnkey robot arm cells and cobots for CNC machine \
tending, pick-and-place, assembly and quality inspection.
3. IT business process automation: ERP planning, shift/dispatch scheduling, \
seamless IT-to-shopfloor integration (SAP, Microsoft Dynamics, Odoo, REST/\
GraphQL, SFTP).
4. Multimodal LLM document processing: invoice and document extraction with \
over 98.5% accuracy, even from crumpled scans and handwriting, straight into \
your ERP.
5. Autonomous voice & messaging chatbots: SIP/VoIP, MS Teams, WhatsApp for \
Business, Telegram, Web — sub-100ms voice latency, CRM/ERP and calendar \
sync, autonomous meeting booking.
6. FULLY AUTOMATED AI-DRIVEN MARKETING & SALES (new flagship offer): a \
complete agentic go-to-market engine. Setup: (a) website CTA chat + landing \
pages feed every visitor into the PostgreSQL CRM with UTM/first-touch \
attribution; (b) AI agents research ideal customer profiles and accounts, \
draft personalized outreach and content for Google Search, LinkedIn, email, \
WhatsApp and Telegram; (c) an autonomous qualification agent scores and \
nurtures leads and books meetings straight into Vincent's M365 calendar; \
(d) the Needle orchestrator evaluates campaign metrics and agent output; \
(e) a spend guard enforces hard monthly caps with explicit human approval \
before any franc is spent. Benefits: a 24/7 pipeline that answers in \
seconds, never drops a follow-up, consistent brand voice in de/en/fr/it, \
Swiss data protection (revDSG, no US-CRM lock-in, no HubSpot), and full cost \
control (every campaign runs behind a cap and your approval).

STYLE RULES
- Mirror the visitor's language (German, English, French, Italian or Dutch) \
and keep answers under ~120 words: a short opening, the substance, and ONE \
clear qualifying question or next step.
- Grüezi/Hello once at the start of the conversation, then plain professional \
speech. Use short paragraphs or bullets, no markdown headers, no emojis.
- When the visitor shows real buying intent (volume, budget, timeline, asks \
for a quote), propose the booking link for a 30-min discovery call with \
Vincent Verbeke and say the team follows up within 24h.
- For the marketing & sales offer, always describe BOTH the setup and the \
benefit, then ask which channel or bottleneck they want automated first.
- If asked something outside this portfolio, say honestly what we do and offer \
to route the question to the team. Never fabricate case studies or clients.
"""


def _build_chat_user_content(payload: ChatMessagePayload) -> str:
    """Assemble transcript + page context into one user turn for the LLM."""
    parts: list[str] = []
    ctx = payload.extracted_context or {}
    if ctx:
        # e.g. {"page": "/marketing/ai-marketing-sales", "topic": "..."}
        parts.append("Visitor page context: " + ", ".join(
            f"{k}={v}" for k, v in ctx.items()
            if isinstance(v, (str, int, float))
        ))
    history = (payload.history or [])[-12:]
    if history:
        lines = ["Conversation so far:"]
        for turn in history:
            role = "Visitor" if turn.get("role") == "user" else "Assistant"
            content = (turn.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content[:1000]}")
        parts.append("\n".join(lines))
    parts.append(f"Visitor's latest message: {payload.message.strip()}")
    return "\n\n".join(parts)


def _intent_signals(user_msg: str) -> tuple[list[str], str | None, bool, str]:
    """Keyword intent detection — structured signals + canned fallback reply.

    The LLM writes the actual reply text; these signals keep quick-reply
    chips, the booking link and lead qualification working even when the
    provider chain is down (and drive them when it is up).
    """
    if "test day" in user_msg or "h2" in user_msg:
        return (
            ["Book M365 Calendar", "Technical Specs", "Pricing"],
            BOOKING_LINK,
            True,
            "We conduct dedicated Unitree H2 Humanoid Consulting & Test Days "
            "on-site in Switzerland. Would you like to schedule an "
            "introductory slot with Vincent Verbeke or select a date via our "
            "M365 calendar?",
        )
    if any(k in user_msg for k in (
        "marketing", "sales", "werbung", "vertrieb", "kampagne", "campaign",
        "lead gen", "leadgenerierung", "outreach", "google ads", "linkedin",
    )):
        return (
            ["Show me the setup", "Book a discovery call", "Pricing & caps"],
            None,
            False,
            "Our fully automated AI-driven marketing & sales engine covers "
            "ICP research, personalized multi-channel outreach, autonomous "
            "lead qualification and meeting booking — with hard monthly spend "
            "caps and human approval. Which channel should it automate first?",
        )
    if "invoice" in user_msg or "rechnung" in user_msg:
        return (
            ["500 - 2,000 / month", "2,000 - 10,000 / month",
             "Request Technical Brief"],
            None,
            False,
            "Our multimodal LLM pipeline extracts incoming & outgoing "
            "invoices with >98.5% accuracy, even from crumpled paperwork or "
            "low-resolution scans. What monthly volume are you processing?",
        )
    if "arm" in user_msg or "factory" in user_msg or "cnc" in user_msg:
        return (
            ["CNC Machine Tending", "Assembly Cell", "Site Feasibility Review"],
            None,
            False,
            "We engineer turnkey robotic arm cells and collaborative cobots "
            "for machine tending and automated assembly. What part dimensions "
            "or cycle times are you targeting?",
        )
    return (
        ["Unitree H2 Test Day", "Marketing & Sales Engine", "Invoice LLMs"],
        None,
        False,
        "Grüezi! I am the Kubotics Sales Engineer. We deliver Unitree "
        "humanoid robots, custom factory robot arms, multimodal LLM business "
        "process automations, and a fully automated AI-driven marketing & "
        "sales engine in Switzerland. How can we support your automation "
        "roadmap?",
    )


async def _llm_chat_reply(payload: ChatMessagePayload) -> str | None:
    """One website-chat turn through the shared provider chain (mail_llm).

    Returns None on any failure (no provider keys, all providers failed,
    timeout) so the caller can serve the canned keyword reply instead —
    the endpoint never 500s because an LLM provider had a bad day.
    """
    try:
        content, _provider, _model = await asyncio.wait_for(
            mail_llm.chat_text(
                CHAT_SYSTEM_PROMPT, _build_chat_user_content(payload)
            ),
            timeout=CHAT_LLM_TIMEOUT_S,
        )
    except Exception as e:
        # Covers LLMUnavailable (no key/chain down), asyncio.TimeoutError
        # (visitor-facing latency cap) and any transport surprise — the
        # website chat degrades to the canned keyword reply instead of 500ing.
        logger.warning("[webchat] LLM reply unavailable, using fallback: %s", e)
        return None
    text = (content or "").strip()
    return _strip_chat_markdown(text) or None


def _strip_chat_markdown(text: str) -> str:
    """The chat widget renders plain text: drop emphasis/code markup so
    visitors never see raw ** or backticks (models do this despite the
    prompt)."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?<!\w)[*_](.+?)[*_](?!\w)", r"\1", text)
    text = re.sub(r"`{1,3}(.+?)`{1,3}", r"\1", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    return text.strip()


@router.post("/leads", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
async def submit_lead(payload: InboundLeadCreate, db: AsyncSession = Depends(get_db)):
    """Receives website contact forms and creates normalized Contact, Address, and Channel records."""
    try:
        return await lead_service.process_inbound_lead(payload, db)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record lead: {str(e)}",
        )


@router.post("/chat/message", response_model=ChatAgentResponse)
async def chat_interaction(payload: ChatMessagePayload):
    """Autonomous sales agent conversation endpoint.

    Reply text comes from the shared LLM provider chain with full
    conversation + page context (professional, language-mirroring answers).
    Quick replies, booking link and lead-qualification flags come from the
    keyword detector, which ALSO serves as the reply fallback when the LLM
    chain is unavailable — degraded, but never broken.
    """
    quick_replies, meeting_link, qualified, fallback_reply = _intent_signals(
        payload.message.lower()
    )
    reply = await _llm_chat_reply(payload) or fallback_reply

    return ChatAgentResponse(
        reply=reply,
        session_token=payload.session_token,
        quick_replies=quick_replies,
        meeting_link=meeting_link,
        lead_qualified=qualified,
    )


@router.post("/meetings/schedule")
async def schedule_meeting(booking: MeetingBookingRequest):
    """Directly schedules an executive meeting in Outlook and generates a Microsoft Teams link."""
    try:
        event = await m365_service.create_teams_event(
            attendee_email=booking.contact_email,
            attendee_name=booking.contact_name,
            subject=f"Kubotics Consultation: {booking.topic}",
            start_time=booking.start_time,
            end_time=booking.end_time,
            notes=f"Meeting scheduled for {booking.company_name or 'Prospective Client'}.",
        )
        return {
            "status": "success",
            "message": "Consultation scheduled in Vincent's M365 Calendar.",
            "join_url": event.get("joinWebUrl"),
            "event_id": event.get("id"),
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"M365 Scheduling failed: {str(e)}",
        )
