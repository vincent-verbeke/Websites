import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.entities import Organization, Contact, ContactMailPhone, Address, Opportunity
from app.schemas.dto import InboundLeadCreate, LeadResponse

logger = logging.getLogger(__name__)


class LeadProcessingService:
    async def process_inbound_lead(self, payload: InboundLeadCreate, db: AsyncSession) -> LeadResponse:
        """
        Processes an inbound lead:
        1. Finds or creates the Organization
        2. Creates Contact record
        3. Creates ContactMailPhone entries (email & optional phone)
        4. Creates Address record if provided
        5. Spawns an initial Opportunity in 'inbound_discovery' stage
        """
        # 1. Organization Handling
        organization = None
        if payload.company_name:
            stmt = select(Organization).where(Organization.name == payload.company_name)
            result = await db.execute(stmt)
            organization = result.scalar_one_or_none()
            if not organization:
                organization = Organization(
                    name=payload.company_name,
                    industry=payload.industry,
                )
                db.add(organization)
                await db.flush()

        # 2. Contact Record
        contact = Contact(
            organization_id=organization.id if organization else None,
            first_name=payload.first_name,
            last_name=payload.last_name,
            ai_summary=payload.project_description,
            lifecycle_stage="lead",
            lead_score=20,
        )
        db.add(contact)
        await db.flush()

        # 3. Contact Channels (Decoupled Email & Phone)
        email_channel = ContactMailPhone(
            contact_id=contact.id,
            channel_type="email",
            value=payload.email,
            label="work",
            is_primary=True,
        )
        db.add(email_channel)

        if payload.phone:
            phone_channel = ContactMailPhone(
                contact_id=contact.id,
                channel_type="phone_mobile",
                value=payload.phone,
                label="work",
                is_primary=True,
            )
            db.add(phone_channel)

        # 4. Decoupled Address if supplied
        if payload.address:
            addr = Address(
                contact_id=contact.id,
                organization_id=organization.id if organization else None,
                address_type=payload.address.address_type,
                is_primary=payload.address.is_primary,
                street_line1=payload.address.street_line1,
                street_line2=payload.address.street_line2,
                postal_code=payload.address.postal_code,
                city=payload.address.city,
                canton_or_state=payload.address.canton_or_state,
                country=payload.address.country,
            )
            db.add(addr)

        # 5. Opportunity Generation
        opportunity = Opportunity(
            contact_id=contact.id,
            organization_id=organization.id if organization else None,
            title=f"{payload.primary_interest or 'Automation'} Inquiry: {payload.company_name or payload.email}",
            deal_type=payload.primary_interest or "General Inquiry",
            pipeline_stage="inbound_discovery",
            notes=payload.project_description,
        )
        db.add(opportunity)
        await db.commit()

        logger.info(f"[LeadProcessing] Processed lead {contact.id} for {payload.email}")

        return LeadResponse(
            contact_id=contact.id,
            company_id=organization.id if organization else None,
            deal_id=opportunity.id,
            status="created",
            message="Lead successfully recorded into Kubotics autonomous database.",
        )


lead_service = LeadProcessingService()
