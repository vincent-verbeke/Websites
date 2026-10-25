from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


# Address Schema
class AddressBase(BaseModel):
    address_type: str = "office"
    is_primary: bool = False
    street_line1: str
    street_line2: Optional[str] = None
    postal_code: str
    city: str
    canton_or_state: Optional[str] = None
    country: str = "Switzerland"


class AddressCreate(AddressBase):
    pass


class AddressRead(AddressBase):
    id: UUID
    created_at: datetime
    model_config = {"from_attributes": True}


# Contact Mail/Phone Schema
class ContactMailPhoneBase(BaseModel):
    channel_type: str  # 'email', 'phone_mobile', 'phone_office', 'whatsapp'
    value: str
    label: str = "work"
    is_primary: bool = False


class ContactMailPhoneCreate(ContactMailPhoneBase):
    pass


class ContactMailPhoneRead(ContactMailPhoneBase):
    id: UUID
    is_verified: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# Inbound Contact Lead Submission
class InboundLeadCreate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    company_name: Optional[str] = None
    industry: Optional[str] = None
    primary_interest: Optional[str] = "Unitree H2"
    project_description: Optional[str] = None
    
    # Optional Address Info
    address: Optional[AddressCreate] = None
    
    # Marketing UTM Attribution
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    gclid: Optional[str] = None
    referrer_url: Optional[str] = None


class LeadResponse(BaseModel):
    contact_id: UUID
    company_id: Optional[UUID] = None
    deal_id: Optional[UUID] = None
    status: str
    message: str


# Chatbot Session & Message Schemas
class ChatMessagePayload(BaseModel):
    session_token: str
    message: str
    sender: str = "visitor"
    extracted_context: Optional[Dict[str, Any]] = None


class ChatAgentResponse(BaseModel):
    reply: str
    session_token: str
    intent: Optional[str] = None
    quick_replies: List[str] = []
    meeting_link: Optional[str] = None
    lead_qualified: bool = False


# M365 Booking Request
class MeetingBookingRequest(BaseModel):
    contact_email: EmailStr
    contact_name: str
    company_name: Optional[str] = None
    topic: str
    start_time: datetime
    end_time: datetime
    time_zone: str = "Europe/Zurich"
