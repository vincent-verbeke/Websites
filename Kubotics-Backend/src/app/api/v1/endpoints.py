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
from app.services.lead_service import lead_service
from app.services.m365_service import m365_service

router = APIRouter()


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
async def chat_interaction(payload: ChatMessagePayload, db: AsyncSession = Depends(get_db)):
    """Autonomous sales agent conversation endpoint."""
    user_msg = payload.message.lower()

    # Intent routing
    if "test day" in user_msg or "h2" in user_msg:
        reply = (
            "We conduct dedicated Unitree H2 Humanoid Consulting & Test Days on-site in Switzerland. "
            "Would you like to schedule an introductory slot with Vincent Verbeke or select a date via our M365 calendar?"
        )
        quick_replies = ["Book M365 Calendar", "Technical Specs", "Pricing"]
        meeting_link = "https://outlook.office.com/bookwithme/user/vincent@kubotics.ch"
        qualified = True
    elif "invoice" in user_msg or "rechnung" in user_msg:
        reply = (
            "Our multimodal LLM pipeline extracts incoming & outgoing invoices with >98.5% accuracy, "
            "even from crumpled paperwork or low-resolution scans. What monthly volume are you processing?"
        )
        quick_replies = ["500 - 2,000 / month", "2,000 - 10,000 / month", "Request Technical Brief"]
        meeting_link = None
        qualified = False
    elif "arm" in user_msg or "factory" in user_msg or "cnc" in user_msg:
        reply = (
            "We engineer turnkey robotic arm cells and collaborative cobots for machine tending and automated assembly. "
            "What part dimensions or cycle times are you targeting?"
        )
        quick_replies = ["CNC Machine Tending", "Assembly Cell", "Site Feasibility Review"]
        meeting_link = None
        qualified = False
    else:
        reply = (
            "Grüezi! I am the Kubotics Automated Specialist. We deliver Unitree humanoid robots, "
            "custom factory robot arms, and multimodal LLM business process automations in Switzerland. "
            "How can we support your automation roadmap?"
        )
        quick_replies = ["Unitree H2 Test Day", "Factory Robot Arms", "Invoice LLMs"]
        meeting_link = None
        qualified = False

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
