"""Scheduler, Ingest, and Dashboard APIs for the Cloud Architecture.
Meets contract in PROMPT_website_agent_dashboard_cloud_2026-11-01.md.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.tasks import InboundEvent, ScheduledTask, DeviceSnapshotCache, AgentOutput
from app.models.entities import Contact, Conversation, Organization, ContactMailPhone, Message

# NOTE: no router-level prefix — main.py already mounts this router under
# settings.API_V1_STR; a "/v1" prefix here produced /api/v1/v1/... and the
# frontend's documented paths (/api/v1/tasks, /api/v1/dashboard/summary) 404'd.
# (Jcode hotfix 2026-11-01, prompt §8; verified with TestClient route probes.)
router = APIRouter(tags=["Cloud Dashboard & Scheduler"])


# -----------------------------------------------------------------------------
# AUTHENTICATION DEPENDENCIES
# -----------------------------------------------------------------------------
def require_scheduler_token(
    x_scheduler_token: str | None = Header(None, alias="X-Scheduler-Token"),
    x_needle_token: str | None = Header(None, alias="X-Needle-Token"),
) -> None:
    """Auth for PC-A scheduler daemon and needle workers."""
    token = x_scheduler_token or x_needle_token
    expected = settings.NEEDLE_TOKEN
    if expected and token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Scheduler token required (X-Scheduler-Token or X-Needle-Token)"
        )


def require_ingest_token(
    authorization: str | None = Header(None)
) -> None:
    """Auth for dev-PC or edge robot pushing snapshot telemetry."""
    if not settings.API_SECRET_KEY:
        return
    expected = f"Bearer {settings.API_SECRET_KEY}"
    if authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid Bearer token required for ingest"
        )


# -----------------------------------------------------------------------------
# SCHEDULER & TASK APIS (PC-A POLLS THESE)
# -----------------------------------------------------------------------------
class TaskCreateRequest(BaseModel):
    event_id: str = Field(min_length=1, max_length=128, description="Idempotency key")
    correlation_id: str = Field(min_length=1, max_length=128, description="Correlation identifier across run/tools")
    type: str = Field(min_length=1, max_length=64, description="Task type identifier")
    priority: int = Field(default=10, ge=1, le=100, description="Task priority (lower is higher priority)")
    payload: dict = Field(default_factory=dict, description="Task input payload")


class TaskClaimRequest(BaseModel):
    assignee: str = Field(min_length=1, description="Worker identity, e.g. pc-a-needle")
    lease_seconds: int = Field(default=300, ge=30, le=3600)


class TaskStatusUpdateRequest(BaseModel):
    status: Literal["assigned", "running", "succeeded", "failed", "cancelled", "needs_approval"]
    heartbeat: bool = True
    error: str | None = None
    result: dict | None = None


class AgentOutputRequest(BaseModel):
    task_id: str | None = None
    correlation_id: str
    agent_id: str
    decision: Literal["approved", "rejected", "escalated", "executed"]
    summary: str
    details: dict = Field(default_factory=dict)
    requires_human_approval: Literal["none", "pending", "approved", "rejected"] = "none"


@router.get("/dashboard/tasks")
async def list_dashboard_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    status: str | None = None,
    limit: int = 50,
):
    """Dashboard read view of task queue (unauthenticated or session-guarded for SPA view)."""
    query = select(ScheduledTask).order_by(ScheduledTask.priority.asc(), ScheduledTask.created_at.desc()).limit(limit)
    if status:
        query = query.where(ScheduledTask.status == status)
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    return {"tasks": tasks, "count": len(tasks)}


@router.get("/tasks", dependencies=[Depends(require_scheduler_token)])
async def list_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    status: str | None = None,
    limit: int = 50,
):
    """Poll task queue for work or inspect task statuses."""
    query = select(ScheduledTask).order_by(ScheduledTask.priority.asc(), ScheduledTask.created_at.asc()).limit(limit)
    if status:
        query = query.where(ScheduledTask.status == status)
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    return {"tasks": tasks, "count": len(tasks)}


@router.post("/tasks", dependencies=[Depends(require_scheduler_token)], status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Enqueue a new scheduled task with strict event_id idempotency.
    
    If a task with the same event_id already exists, returns the existing task (HTTP 200).
    """
    # Idempotency check on event_id
    existing = await db.execute(select(ScheduledTask).where(ScheduledTask.event_id == payload.event_id))
    existing_task = existing.scalars().first()
    if existing_task:
        return {"ok": True, "created": False, "task": existing_task}

    new_task = ScheduledTask(
        event_id=payload.event_id,
        correlation_id=payload.correlation_id,
        type=payload.type,
        priority=payload.priority,
        payload=payload.payload,
        status="queued",
    )
    db.add(new_task)
    await db.commit()
    await db.refresh(new_task)
    return {"ok": True, "created": True, "task": new_task}


@router.post("/tasks/{task_id}/claim", dependencies=[Depends(require_scheduler_token)])
async def claim_task(
    task_id: uuid.UUID,
    payload: TaskClaimRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Idempotently claim/lease a queued task (single worker)."""
    task = await db.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    now = datetime.now(UTC)
    # Allow claim if queued OR if existing lease expired
    if task.status != "queued" and (not task.lease_expires_at or task.lease_expires_at > now):
        if task.assignee == payload.assignee:
            # Idempotent renewal for same assignee
            task.lease_expires_at = now + timedelta(seconds=payload.lease_seconds)
            task.heartbeat_at = now
            await db.commit()
            return {"ok": True, "task": task, "renewed": True}
        raise HTTPException(status_code=409, detail=f"Task already claimed by {task.assignee}")

    task.status = "assigned"
    task.assignee = payload.assignee
    task.claimed_at = now
    task.heartbeat_at = now
    task.lease_expires_at = now + timedelta(seconds=payload.lease_seconds)
    await db.commit()
    await db.refresh(task)
    return {"ok": True, "task": task, "renewed": False}


@router.patch("/tasks/{task_id}/status", dependencies=[Depends(require_scheduler_token)])
async def update_task_status(
    task_id: uuid.UUID,
    payload: TaskStatusUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update task lifecycle, send heartbeat, and record terminal outcome."""
    task = await db.get(ScheduledTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    now = datetime.now(UTC)
    task.status = payload.status
    if payload.heartbeat:
        task.heartbeat_at = now
        # Extend lease if still running
        if task.lease_expires_at:
            task.lease_expires_at = now + timedelta(seconds=300)
    
    if payload.status == "running" and not task.started_at:
        task.started_at = now
    elif payload.status in ("succeeded", "failed", "cancelled"):
        task.finished_at = now
    
    if payload.error is not None:
        task.error = payload.error
    if payload.result is not None:
        task.result = payload.result

    await db.commit()
    await db.refresh(task)
    return {"ok": True, "task": task}


class EventCreateRequest(BaseModel):
    event_id: str = Field(min_length=1, max_length=128, description="Unique inbound event idempotency key")
    channel: str = Field(min_length=1, max_length=32, description="Channel (website, telegram, whatsapp, email)")
    sender_id: str = Field(min_length=1, max_length=128, description="Sender identifier")
    payload: dict = Field(default_factory=dict, description="Event raw or normalized payload")
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_content: str | None = None
    utm_term: str | None = None


@router.post("/events", dependencies=[Depends(require_scheduler_token)], status_code=status.HTTP_201_CREATED)
async def create_inbound_event(
    payload: EventCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Ingest a normalized inbound event (idempotent via event_id)."""
    existing = await db.execute(select(InboundEvent).where(InboundEvent.event_id == payload.event_id))
    existing_event = existing.scalars().first()
    if existing_event:
        return {"ok": True, "created": False, "event": existing_event}

    new_event = InboundEvent(
        event_id=payload.event_id,
        channel=payload.channel,
        sender_id=payload.sender_id,
        payload=payload.payload,
        utm_source=payload.utm_source,
        utm_medium=payload.utm_medium,
        utm_campaign=payload.utm_campaign,
        utm_content=payload.utm_content,
        utm_term=payload.utm_term,
        status="received",
    )
    db.add(new_event)
    await db.commit()
    await db.refresh(new_event)
    return {"ok": True, "created": True, "event": new_event}


@router.get("/events", dependencies=[Depends(require_scheduler_token)])
async def list_inbound_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    channel: str | None = None,
    limit: int = 50,
):
    """Normalized inbound event stream (website, telegram, whatsapp)."""
    query = select(InboundEvent).order_by(desc(InboundEvent.created_at)).limit(limit)
    if channel:
        query = query.where(InboundEvent.channel == channel)
    result = await db.execute(query)
    events = result.scalars().all()
    return {"events": events, "count": len(events)}


@router.post("/agent/output", dependencies=[Depends(require_scheduler_token)])
async def record_agent_output(
    payload: AgentOutputRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record agent decisions, approvals, and outcomes."""
    parsed_task_id = None
    if payload.task_id:
        try:
            parsed_task_id = uuid.UUID(payload.task_id)
        except ValueError:
            pass

    out = AgentOutput(
        task_id=parsed_task_id,
        correlation_id=payload.correlation_id,
        agent_id=payload.agent_id,
        decision=payload.decision,
        summary=payload.summary,
        details=payload.details,
        requires_human_approval=payload.requires_human_approval,
    )
    db.add(out)
    await db.commit()
    await db.refresh(out)
    return {"ok": True, "output_id": str(out.id)}


# -----------------------------------------------------------------------------
# ROBOT / DEV-PC INGEST API (TELEMETRY SNAPSHOT PUSH)
# -----------------------------------------------------------------------------
@router.post("/ingest/{dataset}", dependencies=[Depends(require_ingest_token)])
async def ingest_snapshot(
    dataset: str,
    payload: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dev-PC or robot pushes telemetry snapshot. Updates cache with timestamp."""
    result = await db.execute(select(DeviceSnapshotCache).where(DeviceSnapshotCache.dataset == dataset))
    cached = result.scalars().first()
    now = datetime.now(UTC)

    if not cached:
        cached = DeviceSnapshotCache(
            dataset=dataset,
            source="push-edge",
            payload=payload,
            updated_at=now,
        )
        db.add(cached)
    else:
        cached.payload = payload
        cached.updated_at = now
    
    await db.commit()
    return {"ok": True, "dataset": dataset, "updated_at": now.isoformat()}


# -----------------------------------------------------------------------------
# DASHBOARD API (METRICS & TELEMETRY READS FOR ANGULAR SPA)
# -----------------------------------------------------------------------------
@router.get("/dashboard/summary")
async def get_dashboard_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Aggregated business & operations metrics from Postgres (GTM §10.2)."""
    now = datetime.now(UTC)
    
    # Lead metrics
    # CRM leads are stored as Contact rows with lifecycle_stage="lead"
    # (see services/lead_service.process_inbound_lead); there is no Lead
    # table. Interim fix by Jcode 2026-11-01 (prompt §8 option 1) — supersede
    # with a dedicated Lead model if the design calls for it.
    leads_count = (await db.execute(
        select(func.count(Contact.id)).where(Contact.lifecycle_stage == "lead")
    )).scalar() or 0
    convs_count = (await db.execute(select(func.count(Conversation.id)))).scalar() or 0
    
    # Task queue metrics
    queued_tasks = (await db.execute(select(func.count(ScheduledTask.id)).where(ScheduledTask.status == "queued"))).scalar() or 0
    running_tasks = (await db.execute(select(func.count(ScheduledTask.id)).where(ScheduledTask.status == "running"))).scalar() or 0
    failed_tasks = (await db.execute(select(func.count(ScheduledTask.id)).where(ScheduledTask.status == "failed"))).scalar() or 0

    return {
        "updated_at": now.isoformat(),
        "is_stale": False,
        "kpis": {
            "total_leads": leads_count,
            "conversations": convs_count,
            "tasks_queued": queued_tasks,
            "tasks_running": running_tasks,
            "tasks_failed": failed_tasks,
        }
    }


@router.get("/dashboard/device/{dataset}")
async def get_device_telemetry(
    dataset: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    stale_threshold_seconds: int = 60,
):
    """Reads snapshot for a dataset (e.g. Unitree H2 state). Fail-closed with stale badge."""
    result = await db.execute(select(DeviceSnapshotCache).where(DeviceSnapshotCache.dataset == dataset))
    item = result.scalars().first()

    if not item:
        return {
            "dataset": dataset,
            "source": "unknown",
            "is_stale": True,
            "is_offline": True,
            "updated_at": None,
            "payload": None,
            "status_message": f"Device {dataset} has not published telemetry yet."
        }

    now = datetime.now(UTC)
    age = (now - item.updated_at).total_seconds() if item.updated_at else 999999
    is_stale = age > stale_threshold_seconds

    return {
        "dataset": dataset,
        "source": item.source,
        "is_stale": is_stale,
        "is_offline": age > (stale_threshold_seconds * 3),
        "age_seconds": round(age, 1),
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "payload": item.payload,
    }

# -----------------------------------------------------------------------------
# DASHBOARD LEADS & CONVERSATIONS MANAGEMENT (GTM & AUDIT)
# -----------------------------------------------------------------------------
@router.get("/dashboard/leads")
async def list_dashboard_leads(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = 50,
):
    """List GTM inbound leads with contact channels and organization."""
    query = (
        select(Contact)
        .where(Contact.lifecycle_stage == "lead")
        .order_by(Contact.created_at.desc())
        .limit(limit)
    )
    res = await db.execute(query)
    contacts = res.scalars().all()

    items = []
    for c in contacts:
        # Directly query ContactMailPhone records to reliably fetch email and phone in async SQLAlchemy
        channels_res = await db.execute(
            select(ContactMailPhone).where(ContactMailPhone.contact_id == c.id)
        )
        channels = channels_res.scalars().all()

        phone = next(
            (ch.value for ch in channels if "phone" in ch.channel_type.lower() or ch.channel_type.lower() == "whatsapp"),
            None
        )
        email = next(
            (ch.value for ch in channels if ch.channel_type.lower() == "email"),
            None
        )

        items.append({
            "id": str(c.id),
            "first_name": c.first_name,
            "last_name": c.last_name,
            "job_title": c.job_title,
            "email": email,
            "phone": phone,
            "lead_score": c.lead_score,
            "lifecycle_stage": c.lifecycle_stage,
            "ai_summary": c.ai_summary,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return {"leads": items, "count": len(items)}


@router.delete("/dashboard/leads/{lead_id}")
async def delete_dashboard_lead(
    lead_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a test or obsolete lead and its associated channels."""
    try:
        lid = uuid.UUID(lead_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid lead UUID")

    contact = await db.get(Contact, lid)
    if not contact:
        raise HTTPException(status_code=404, detail="Lead not found")

    await db.delete(contact)
    await db.commit()
    return {"ok": True, "deleted_id": lead_id}


@router.get("/dashboard/conversations")
async def list_dashboard_conversations(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = 50,
):
    """List inbound conversations across WhatsApp, Web Chat, Telegram."""
    query = (
        select(Conversation)
        .order_by(Conversation.started_at.desc())
        .limit(limit)
    )
    res = await db.execute(query)
    convs = res.scalars().all()

    items = []
    for conv in convs:
        # Fetch associated contact and messages directly
        contact_obj = None
        if conv.contact_id:
            contact_obj = await db.get(Contact, conv.contact_id)

        msg_res = await db.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg_row = msg_res.scalars().first()
        last_msg = last_msg_row.content if last_msg_row else None

        msg_count_res = await db.execute(
            select(func.count(Message.id)).where(Message.conversation_id == conv.id)
        )
        msg_count = msg_count_res.scalar() or 0

        sender_phone = conv.external_conversation_id
        sender_name = (
            f"{contact_obj.first_name or ''} {contact_obj.last_name or ''}".strip()
            if contact_obj
            else None
        )

        items.append({
            "id": str(conv.id),
            "channel": conv.channel,
            "status": conv.status,
            "sender": sender_phone or sender_name or "Anonymous",
            "message_count": msg_count,
            "last_message": last_msg,
            "started_at": conv.started_at.isoformat() if conv.started_at else None,
        })
    return {"conversations": items, "count": len(items)}


@router.delete("/dashboard/conversations/{conversation_id}")
async def delete_dashboard_conversation(
    conversation_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a test conversation and its associated messages."""
    try:
        cid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid conversation UUID")

    conv = await db.get(Conversation, cid)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    await db.delete(conv)
    await db.commit()
    return {"ok": True, "deleted_id": conversation_id}


# -----------------------------------------------------------------------------
# §10 INVESTMENTS / IBKR SNAPSHOT INGEST & DASHBOARD FEED
# -----------------------------------------------------------------------------
def require_needle_bearer_token(
    authorization: str | None = Header(None),
    x_needle_token: str | None = Header(None, alias="X-Needle-Token"),
) -> None:
    """Enforce authorization matching WhatsApp send endpoint and needle workers."""
    expected = settings.NEEDLE_TOKEN or settings.API_SECRET_KEY
    if not expected:
        return
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
    elif x_needle_token:
        token = x_needle_token.strip()

    if token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid Bearer token or X-Needle-Token required"
        )


@router.post("/investments/snapshot", dependencies=[Depends(require_needle_bearer_token)])
async def ingest_investments_snapshot(
    payload: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Ingest live IBKR snapshot pushed from dev-PC systemd ibkr-push.timer.
    Stores doc in DeviceSnapshotCache under dataset 'ibkr_investments' with server timestamp.
    """
    now = datetime.now(UTC)
    result = await db.execute(
        select(DeviceSnapshotCache).where(DeviceSnapshotCache.dataset == "ibkr_investments")
    )
    cached = result.scalars().first()

    source = payload.get("source", "devpc-ibkr-pusher")
    if not cached:
        cached = DeviceSnapshotCache(
            dataset="ibkr_investments",
            source=source,
            payload=payload,
            updated_at=now,
        )
        db.add(cached)
    else:
        cached.source = source
        cached.payload = payload
        cached.updated_at = now

    await db.commit()
    return {"ok": True, "stored_at": now.isoformat()}


@router.get("/investments")
@router.get("/dashboard/investments")
async def get_investments_feed(
    db: Annotated[AsyncSession, Depends(get_db)],
    stale_threshold_seconds: int = 60,
):
    """
    Dashboard read feed for IBKR Investments tab.
    Calculates server-side staleness (stale if now - updated_at > 60s).
    Also embeds the trading-watcher block (Vincent 2026-11-01 19:22) so the
    Investments tab can render it below the IBKR sections — see
    Kubotics-Backend/docs/TRADING_WATCH_CLOUD.md §11.
    """
    try:
        from app.services import trading_watch as _tw_svc
        tw_block = await _tw_svc.dashboard_block(db)
    except Exception as e:  # noqa: BLE001 — never break the IBKR feed
        tw_block = {"error": type(e).__name__}
    result = await db.execute(
        select(DeviceSnapshotCache).where(DeviceSnapshotCache.dataset == "ibkr_investments")
    )
    cached = result.scalars().first()

    if not cached:
        return {
            "snapshot": None,
            "source": "devpc-ibkr-pusher",
            "updated_at": None,
            "stale": True,
            "offline": True,
            "age_seconds": None,
            "trading_watch": tw_block,
        }

    now = datetime.now(UTC)
    age = (now - cached.updated_at).total_seconds() if cached.updated_at else 999999
    is_stale = age > stale_threshold_seconds

    return {
        "snapshot": cached.payload,
        "source": cached.source,
        "updated_at": cached.updated_at.isoformat() if cached.updated_at else None,
        "stale": is_stale,
        "offline": age > (stale_threshold_seconds * 3),
        "age_seconds": round(age, 1),
        "trading_watch": tw_block,
    }
