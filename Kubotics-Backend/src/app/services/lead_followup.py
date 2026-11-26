"""Automated, consent-respecting multi-channel lead follow-up state machine.

docs/LEAD_FOLLOWUP_PLAN.md (Vincent 2026-11-15: "follow up the leads
completely via email / whatsapp / telegram without manual intervention and
professional llm interaction and only the last contact should be the meeting
with me").

Vincent 2026-11-23: "interact 2-3 messages always with questions to
determine the need before asking for a meeting and in the end ask email and
phone and propose meeting" -> touches 1 and 2 are qualifying QUESTIONS
only (no meeting, no booking link); touch 3 is the closing message (asks
the contact details we are missing, then proposes the meeting).

Sequence (Europe/Zurich, quiet hours 08:00-18:00, <= 3 touches, <= 25 sends
per day counted from `lead_followup_log`):

  step 1  T+2h  after max(lead creation, last inbound)   EMAIL (LLM-drafted,
          references primary_interest + landing page, asks the FIRST
          qualifying question — no meeting, no booking link)
  step 2  T+24h after touch 1                            WHATSAPP iff the last
          INBOUND WhatsApp message is <24h old (Meta customer-service window,
          encoded literally), else TELEGRAM if a telegram ExternalIdentity
          exists, else EMAIL — asks a SECOND qualifying question (still no
          meeting)
  step 3  T+72h after touch 2                            EMAIL, final: asks
          for the contact details we are missing (email / phone), then
          proposes the meeting — the booking link is the ONLY next step

STOP conditions are evaluated before EVERY send and land in
`lead_followup_log` (status=skipped + reason): inbound reply after our last
touch (-> replied, human/agent conversation takes over), meeting booked
(lifecycle past 'lead' — see docs for the bookings-detection gap), consent
revoked / opt-out / suppression, lead older than 7 days, touches exhausted
(-> maxed), daily cap (-> defers the rest of the day), quiet hours (global
deferral), no reachable channel (-> defers 24h as pending, never terminal).

Gates: default OFF (LEAD_FOLLOWUP_ENABLED=False => maybe_start_followup_loop()
returns None => no task registers). Channel seams are module attributes so
tests stub them and never touch the network: `m365_service`, `whatsapp_service`,
`_send_telegram`, `_llm_chat`.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.entities import (
    Contact,
    ContactMailPhone,
    Conversation,
    ExternalIdentity,
    Message,
    Opportunity,
    Organization,
    OrganizationContact,
)
from app.models.lead_followup import LeadFollowup, LeadFollowupLog
from app.services import mail_llm
from app.services.m365_service import m365_service
from app.services.whatsapp_service import whatsapp_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (see docs/LEAD_FOLLOWUP_PLAN.md for the rationale of each)
# ---------------------------------------------------------------------------
TZ = ZoneInfo("Europe/Zurich")

#: Consent allowlist — the ONLY states we may ever auto-contact a lead in.
#: 'unknown' (default), 'denied' and any suppression => skip/stop.
ALLOWED_CONSENT = frozenset({"lead_form", "granted"})

LEAD_MAX_AGE = timedelta(days=7)          # never send to a lead older than this
STEP1_DELAY = timedelta(hours=2)          # T+2h after anchor
#: Delay AFTER sending step N before step N+1 is due.
NEXT_STEP_DELAY = {2: timedelta(hours=24), 3: timedelta(hours=72)}
WHATSAPP_WINDOW = timedelta(hours=24)     # Meta 24h customer-service window

MAX_PER_CYCLE = 10                        # per-loop-cycle send cap
CYCLE_TICK_S = 300                        # loop cadence
LLM_TIMEOUT_S = 20.0                      # bounded drafting time
LLM_MAX_BODY_CHARS = 1400                 # sanity cap for LLM output
LLM_MAX_BODY_WORDS = 160                  # prompt says ~120, tolerate a bit
MAX_SEND_FAILURES = 3                     # failed attempts per step => stop

BOOKING_LINK = (
    "https://bookings.cloud.microsoft/book/"
    "KuboticsGet2Know@kuroliv.ch/?ismsaljsauthenabled"
)
LANDING_PAGE = "https://kubotics.ch"

TERMINAL_STATUSES = frozenset(
    {"stopped", "meeting_booked", "replied", "maxed"}
)
SCHEDULABLE_STATUSES = frozenset({"pending", "active"})
ALL_STATUSES = tuple(
    sorted(SCHEDULABLE_STATUSES | TERMINAL_STATUSES)
)

#: Opt-out message: the message IS the opt-out command (optionally + bitte/
#: please). Longer messages that merely contain the word are NOT treated as
#: opt-outs ("Stop by tomorrow" must not suppress anyone).
OPTOUT_RE = re.compile(
    r"^\s*(stop|stopall|unsubscribe|abmelden|abbrechen|opt[\s_-]?out)"
    r"[\s.!?,;]*(bitte|please)?[\s.!?,;]*\s*$",
    re.IGNORECASE,
)

#: English-signal words for the DE/EN pick when no explicit language is set.
_EN_TEXT_RE = re.compile(
    r"\b(hello|thanks|thank you|please|interested|regards|would|could|"
    r"regarding|information|informationen?|meeting|quote|available|call|"
    r"week|next|we are|our)\b",
    re.IGNORECASE,
)

_LOOP_STARTED_AT: datetime | None = None


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _as_utc(dt: datetime | None) -> datetime | None:
    """Model defaults can be naive (utcnow in entities); normalize to UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def in_quiet_hours(now: datetime) -> bool:
    """True when sends are NOT allowed (outside 08:00-18:00 Europe/Zurich)."""
    local = _as_utc(now).astimezone(TZ)
    start = settings.LEAD_FOLLOWUP_QUIET_START
    end = settings.LEAD_FOLLOWUP_QUIET_END
    return not (start <= local.hour < end)


def day_start_zurich(now: datetime) -> datetime:
    local = _as_utc(now).astimezone(TZ)
    return datetime(local.year, local.month, local.day, tzinfo=TZ)


def next_allowed_time(now: datetime) -> datetime:
    """Next moment sends are allowed strictly after ``now`` (08:00 Zurich)."""
    local = _as_utc(now).astimezone(TZ)
    start = settings.LEAD_FOLLOWUP_QUIET_START
    candidate = datetime.combine(local.date(), time(hour=start), tzinfo=TZ)
    if local >= candidate:
        candidate += timedelta(days=1)
    return candidate


def is_optout_text(text: str | None) -> bool:
    return bool(text and OPTOUT_RE.match(text.strip()))


def looks_english(text: str | None) -> bool:
    """Heuristic: >=2 English signal words in the last inbound message."""
    if not text:
        return False
    return len(_EN_TEXT_RE.findall(text)) >= 2


def pick_language(
    contact: Contact,
    last_inbound_text: str | None = None,
    conversation_language: str | None = None,
) -> str:
    """'en' iff the lead's last inbound message or an explicit language
    field indicates English; otherwise 'de' (DE is the default)."""
    if looks_english(last_inbound_text):
        return "en"
    for lang in (getattr(contact, "preferred_language", None),
                 conversation_language):
        if lang and str(lang).lower().startswith("en"):
            return "en"
    return "de"


def _clean_phone_digits(phone: str | None) -> str:
    """Mirror of whatsapp._clean_phone_digits ('+41 79 ...' -> digits only)."""
    if not phone:
        return ""
    return re.sub(r"\D", "", phone)


def _operator_numbers() -> set[str]:
    """Needle operator senders (Vincent's own numbers) — never lead targets."""
    return {
        _clean_phone_digits(part)
        for part in settings.NEEDLE_OPERATOR_SENDERS.split(",")
        if _clean_phone_digits(part)
    }


def is_operator_number(phone: str | None) -> bool:
    digits = _clean_phone_digits(phone)
    return bool(digits) and digits in _operator_numbers()


# ---------------------------------------------------------------------------
# Data the decisions are made on
# ---------------------------------------------------------------------------
@dataclass
class InboundInfo:
    """Latest INBOUND (sender_type='visitor') message facts for a contact."""

    last_at: datetime | None = None
    last_text: str | None = None
    last_whatsapp_at: datetime | None = None


@dataclass
class ChannelTarget:
    channel: str            # email | whatsapp | telegram
    recipient: str          # address / phone / chat id (never logged)
    note: str = ""


@dataclass
class Draft:
    subject: str
    body: str
    source: str             # llm | template
    provider: str | None = None
    language: str = "de"
    extra: dict[str, Any] = field(default_factory=dict)


async def _inbound_info(db: AsyncSession, contact_id) -> InboundInfo:
    """Latest visitor message across all conversations of the contact
    (+ the latest WhatsApp one specifically, for the Meta 24h window)."""
    convs = (
        await db.execute(
            select(Conversation).where(Conversation.contact_id == contact_id)
        )
    ).scalars().all()
    info = InboundInfo()
    for conv in convs:
        msgs = (
            await db.execute(
                select(Message)
                .where(
                    Message.conversation_id == conv.id,
                    Message.sender_type == "visitor",
                )
                .order_by(Message.created_at.desc())
                .limit(100)
            )
        ).scalars().all()
        for msg in msgs:                     # python-max: robust + testable
            at = _as_utc(msg.created_at)
            if at is None:
                continue
            if info.last_at is None or at > info.last_at:
                info.last_at = at
                info.last_text = msg.content
            if conv.channel == "whatsapp" and (
                info.last_whatsapp_at is None or at > info.last_whatsapp_at
            ):
                info.last_whatsapp_at = at
    return info


async def _contact_points(
    db: AsyncSession, contact_id
) -> list[ContactMailPhone]:
    return (
        await db.execute(
            select(ContactMailPhone).where(
                ContactMailPhone.contact_id == contact_id
            )
        )
    ).scalars().all()


async def _telegram_identity(db: AsyncSession, contact_id) -> str | None:
    rows = (
        await db.execute(
            select(ExternalIdentity).where(
                ExternalIdentity.contact_id == contact_id,
                ExternalIdentity.channel == "telegram",
            )
        )
    ).scalars().all()
    return rows[0].external_user_id if rows else None


async def _get_row(db: AsyncSession, contact_id) -> LeadFollowup | None:
    return (
        await db.execute(
            select(LeadFollowup).where(LeadFollowup.contact_id == contact_id)
        )
    ).scalars().first()


async def _sends_today(db: AsyncSession, now: datetime) -> int:
    """Today's successful sends (Europe/Zurich), counted from the audit log."""
    rows = (
        await db.execute(
            select(LeadFollowupLog).where(
                LeadFollowupLog.status == "ok",
                LeadFollowupLog.created_at >= day_start_zurich(now),
            )
        )
    ).scalars().all()
    return len(rows)


async def _failed_attempts(db: AsyncSession, contact_id, step: int) -> int:
    rows = (
        await db.execute(
            select(LeadFollowupLog).where(
                LeadFollowupLog.contact_id == contact_id,
                LeadFollowupLog.step == step,
                LeadFollowupLog.status == "failed",
            )
        )
    ).scalars().all()
    return len(rows)


async def _primary_interest(db: AsyncSession, contact_id) -> str | None:
    """primary_interest lives on the Opportunity the lead form spawned
    (lead_service.process_inbound_lead puts payload.primary_interest into
    deal_type). Most recent wins."""
    rows = (
        await db.execute(
            select(Opportunity).where(Opportunity.contact_id == contact_id)
        )
    ).scalars().all()
    rows = [r for r in rows if r.deal_type]
    if not rows:
        return None
    rows.sort(key=lambda r: _as_utc(r.created_at) or datetime.min.replace(
        tzinfo=UTC), reverse=True)
    return rows[0].deal_type


async def _company_name(db: AsyncSession, contact_id) -> str | None:
    links = (
        await db.execute(
            select(OrganizationContact).where(
                OrganizationContact.contact_id == contact_id
            )
        )
    ).scalars().all()
    if not links:
        return None
    link = next(
        (l for l in links if getattr(l, "is_primary_organization", False)),
        links[0],
    )
    org = (
        await db.execute(select(Organization).where(
            Organization.id == link.organization_id))
    ).scalars().first()
    return org.name if org else None


# ---------------------------------------------------------------------------
# Candidate selection (pure decision + orchestration)
# ---------------------------------------------------------------------------
def candidate_skip_reason(
    contact: Contact,
    row: LeadFollowup | None,
    now: datetime,
    last_inbound_at: datetime | None = None,
) -> str | None:
    """Why this contact is NOT due for evaluation, or None when it is.

    Row-less contacts run the full gate (lead/age/consent/suppression and the
    T+2h anchor). Contacts that already have a row are only filtered on
    sequence state here — every other condition is a STOP re-checked (and
    logged) by run_due before the send.
    """
    if row is None:
        if (contact.lifecycle_stage or "") != "lead":
            return "not_lead"
        if getattr(contact, "suppressed", False):
            return "suppressed"
        if (contact.consent_status or "unknown") not in ALLOWED_CONSENT:
            return "consent_not_allowed"
        created = _as_utc(contact.created_at)
        if created is None or created < now - LEAD_MAX_AGE:
            return "lead_too_old"
        anchor = created
        last = _as_utc(last_inbound_at)
        if last is not None and last > anchor:
            anchor = last
        if anchor + STEP1_DELAY > now:
            return "not_due_yet"
        return None
    # existing row: terminal sequences never re-enter, future ones wait
    if row.status in TERMINAL_STATUSES:
        return f"terminal_{row.status}"
    due = _as_utc(row.next_due_at)
    if due is None or due > now:
        return "not_due"
    return None


async def select_candidates(db: AsyncSession, now: datetime) -> list[Contact]:
    """Leads that must be evaluated in THIS cycle (see candidate_skip_reason).

    Query: fresh leads inside the 7-day window PLUS contacts with a schedulable
    (pending/active) row that is due — the second branch keeps mid-sequence
    contacts reachable for their STOP checks even after they age past 7 days
    or their lifecycle advances (never to send: run_due re-checks everything).
    """
    cutoff = now - LEAD_MAX_AGE
    rows = (
        await db.execute(select(LeadFollowup))
    ).scalars().all()
    due_row_ids = [
        r.contact_id
        for r in rows
        if r.status in SCHEDULABLE_STATUSES
        and _as_utc(r.next_due_at) is not None
        and _as_utc(r.next_due_at) <= _as_utc(now)
    ]
    lead_branch = (Contact.lifecycle_stage == "lead") & (
        Contact.created_at >= cutoff
    )
    # NOTE: never build ``id.in_([])`` (SQLA renders it as a non-column expr).
    condition = (
        or_(lead_branch, Contact.id.in_(due_row_ids))
        if due_row_ids
        else lead_branch
    )
    stmt = select(Contact).where(condition).order_by(Contact.created_at.asc())
    contacts = (await db.execute(stmt)).scalars().all()

    row_by_contact = {r.contact_id: r for r in rows}
    out: list[Contact] = []
    for contact in contacts:
        row = row_by_contact.get(contact.id)
        info = None
        if row is None:
            info = await _inbound_info(db, contact.id)
        if candidate_skip_reason(
            contact, row, now, info.last_at if info else None
        ) is None:
            out.append(contact)
    return out


# ---------------------------------------------------------------------------
# STOP matrix — evaluated before EVERY send
# ---------------------------------------------------------------------------
async def evaluate_stops(
    db: AsyncSession,
    contact: Contact,
    row: LeadFollowup | None,
    now: datetime,
    info: InboundInfo,
) -> tuple[str, str] | None:
    """(terminal_status, log_detail) when this contact must NOT be written to,
    else None. Order: opt-out -> consent -> meeting -> replied -> maxed -> age.
    """
    # 1. opt-out: suppression flag OR the latest inbound being an opt-out
    #    command (keyword detection is new — docs list it as an addition).
    if is_optout_text(info.last_text):
        if not getattr(contact, "suppressed", False):
            contact.suppressed = True
            contact.suppression_reason = "followup_keyword_opt_out"
        return "stopped", "opt_out_keyword"
    if getattr(contact, "suppressed", False):
        return "stopped", "opt_out_suppressed"
    # 2. consent revoked / never granted (allowlist: lead_form, granted)
    if (contact.consent_status or "unknown") not in ALLOWED_CONSENT:
        return "stopped", "consent_not_allowed"
    # 3. meeting booked: NO appointments/booking table exists in this repo
    #    (the bookings.cloud.microsoft flow is external — docs gap note), so
    #    the detectable marker is the lead lifecycle moving past 'lead'.
    if (contact.lifecycle_stage or "lead") != "lead":
        return "meeting_booked", f"lifecycle_{contact.lifecycle_stage}"
    if row is not None:
        # 4. any inbound message after our last touch => conversation takes over
        last_sent = _as_utc(row.last_sent_at)
        if (
            last_sent is not None
            and info.last_at is not None
            and info.last_at > last_sent
        ):
            return "replied", "inbound_after_last_touch"
        # 5. touches exhausted
        if row.step > settings.LEAD_FOLLOWUP_MAX_TOUCHES:
            return "maxed", "touches_exhausted"
    # 6. never send to a lead older than 7 days (checked every touch too)
    created = _as_utc(contact.created_at)
    if created is None or created < now - LEAD_MAX_AGE:
        return "stopped", "lead_too_old"
    return None


# ---------------------------------------------------------------------------
# Channel resolution (contact points + Meta 24h window + fallback order)
# ---------------------------------------------------------------------------
def _pick_email(points: list[ContactMailPhone]) -> str | None:
    emails = [p for p in points if p.channel_type == "email" and p.value]
    if not emails:
        return None
    primary = [p for p in emails if p.is_primary]
    return (primary or emails)[0].value


def _pick_whatsapp_phone(points: list[ContactMailPhone]) -> str | None:
    """Mirror of how other code stores WhatsApp recipients: agent_core writes
    channel_type='phone_mobile' + label='whatsapp'; the lead form allows an
    explicit channel_type='whatsapp' row too."""
    phones = [
        p for p in points
        if p.value
        and (
            p.channel_type == "whatsapp"
            or (p.channel_type == "phone_mobile" and p.label == "whatsapp")
        )
    ]
    if not phones:
        return None
    primary = [p for p in phones if p.is_primary]
    return (primary or phones)[0].value


def whatsapp_window_open(info: InboundInfo, now: datetime) -> bool:
    """Meta 24h customer-service window, encoded literally: we may only send
    WhatsApp when the lead's last INBOUND WhatsApp message is <24h old."""
    last = _as_utc(info.last_whatsapp_at)
    if last is None:
        return False
    return (_as_utc(now) - last) < WHATSAPP_WINDOW


def resolve_channel(
    points: list[ContactMailPhone],
    telegram_id: str | None,
    step: int,
    info: InboundInfo,
    now: datetime,
) -> tuple[ChannelTarget | None, str | None]:
    """Pick the channel for this touch, or (None, reason).

    Hard rules: WhatsApp only inside the 24h window AND with a phone contact
    point AND never to a needle-operator number; Telegram only with a
    telegram ExternalIdentity (which only exists if they messaged us);
    Email only with an email contact point. A channel the lead never used and
    has no contact point for is NEVER chosen (fallback chain instead).

    Step order: 1 -> email, whatsapp(window), telegram | 2 -> whatsapp(window),
    telegram, email | 3 -> email, whatsapp(window), telegram.
    """
    email = _pick_email(points)
    phone = _pick_whatsapp_phone(points)
    window_ok = whatsapp_window_open(info, now)
    wa_ok = bool(window_ok and phone and not is_operator_number(phone))
    if step == 2:
        order = [
            ("whatsapp", phone) if wa_ok else None,
            ("telegram", telegram_id) if telegram_id else None,
            ("email", email) if email else None,
        ]
    else:  # step 1 and step 3 are email-first
        order = [
            ("email", email) if email else None,
            ("whatsapp", phone) if wa_ok else None,
            ("telegram", telegram_id) if telegram_id else None,
        ]
    for entry in order:
        if entry is None:
            continue
        channel, recipient = entry
        note = ""
        if channel == "whatsapp":
            note = "meta_24h_window"
        return ChannelTarget(channel, recipient, note), None
    return None, "no_reachable_channel"


# ---------------------------------------------------------------------------
# LLM drafting (reuses mail_llm's provider chain; templates on ANY failure)
# ---------------------------------------------------------------------------
def _contact_ask(has_email: bool, has_phone: bool, lang: str) -> str:
    """Opening of the CLOSING touch: ask only for the details we do not have
    yet (Vincent 2026-11-23: "in the end ask email and phone"). Empty when
    both points are known — never ask for something already stored."""
    if has_email and has_phone:
        return ""
    if lang == "de":
        if not has_email and not has_phone:
            return ("Bitte senden Sie mir noch Ihre E-Mail-Adresse und Ihre "
                    "Telefonnummer, damit ich Sie direkt erreiche.\n\n")
        if not has_email:
            return "Bitte senden Sie mir noch Ihre E-Mail-Adresse.\n\n"
        return "Bitte senden Sie mir noch Ihre Telefonnummer.\n\n"
    if not has_email and not has_phone:
        return ("Please share your email address and phone number so I can "
                "reach you directly.\n\n")
    if not has_email:
        return "Please share your email address.\n\n"
    return "Please share your phone number.\n\n"


def _system_prompt(
    step: int,
    lang: str,
    *,
    has_email: bool = True,
    has_phone: bool = True,
) -> str:
    lang_name = "German (Swiss German business style)" if lang == "de" else "English"
    sign = (
        "Mit freundlichen Grüßen\nVincent Verbeke\nFounder, Kubotics"
        if lang == "de"
        else "Kind regards\nVincent Verbeke\nFounder, Kubotics"
    )
    if has_email and has_phone:
        contact_ask = "then "
    elif not has_email and not has_phone:
        contact_ask = "ask for their email address AND phone number, then "
    elif not has_email:
        contact_ask = "ask for their email address, then "
    else:
        contact_ask = "ask for their phone number, then "
    goals = {
        1: (
            "Write touch 1: a short, warm first follow-up to their inquiry "
            "that asks ONE clear qualifying question to determine their need "
            "(goal, problem or use case). "
            f"Reference their interest and point them to {LANDING_PAGE}. "
            "Do NOT offer a meeting, a call or a booking link yet."
        ),
        2: (
            "Write touch 2: a brief, friendly follow-up that asks ONE "
            "further qualifying question to understand their need "
            "concretely (volume, systems, process, timeline — whatever fits "
            "their inquiry). Do NOT offer a meeting, a call or a booking "
            "link yet."
        ),
        3: (
            "Write touch 3 (FINAL): recap their need in one short line, "
            f"{contact_ask}state that the only next step is a short "
            f"get-to-know call and include this booking link verbatim: "
            f"{BOOKING_LINK} Nothing else — no other offers, no marketing."
        ),
    }
    return (
        "You write professional B2B lead follow-ups for Kubotics, a Swiss "
        "robotics and automation company (Zurich). You write on behalf of "
        "Vincent Verbeke, Founder of Kubotics.\n"
        f"Write in {lang_name}.\n"
        f"{goals[step]}\n"
        "Rules: max 120 words; Swiss B2B tone — polite, direct, no hype; no "
        "promises we cannot keep; no testimonials, references or statistics "
        "you were not given; use ONLY the provided variables (first name, "
        "company, interest) and never invent personal details, emails or "
        f"phone numbers; sign exactly as:\n{sign}\n"
        'Answer ONLY with one JSON object: {"subject": "...", "body": "..."} '
        "(plain-text body with newlines, no markdown)."
    )


def _user_prompt(first_name: str | None, company: str | None,
                 interest: str | None, lang: str) -> str:
    return (
        f"language: {lang}\n"
        f"first_name: {first_name or 'unknown'}\n"
        f"company: {company or 'unknown'}\n"
        f"interest: {interest or 'unknown'}"
    )


async def _llm_chat(system: str, user: str) -> tuple[dict, str, str]:
    """The ONE network seam for drafting — mail_llm's provider chain."""
    return await mail_llm.chat_json(system, user)


def _template(step: int, lang: str, *, first_name: str | None,
              company: str | None, interest: str | None,
              has_email: bool = True, has_phone: bool = True) -> tuple[str, str]:
    """Pre-written fallback (subject, body) — used on ANY LLM failure.
    Same workflow as the LLM prompts: touches 1-2 ask qualifying questions,
    touch 3 asks the missing contact details and proposes the meeting."""
    name = (first_name or "").strip()
    contact_ask = _contact_ask(has_email, has_phone, lang)
    if lang == "de":
        greet = f"{name}," if name else "Grüezi,"
        topic = interest or "Ihre Anfrage"
        firm = f" bei {company}" if company else ""
        if step == 1:
            return (
                f"Kubotics: {topic}{firm}",
                (f"{greet}\n\n"
                 f"vielen Dank für Ihre Anfrage zu {topic}{firm}. Wir helfen "
                 f"Kundinnen und Kunden in der Schweiz genau damit weiter — "
                 f"von Beratung über Test bis schlüsselfertiger Installation "
                 f"({LANDING_PAGE}).\n\n"
                 "Welchen Prozess möchten Sie als Erstes automatisieren oder "
                 "verbessern? Antworten Sie einfach auf diese E-Mail — dann "
                 "melde ich mich persönlich bei Ihnen.\n\n"
                 "Mit freundlichen Grüßen\nVincent Verbeke\nFounder, Kubotics"),
            )
        if step == 2:
            return (
                f"Kubotics: kurze Rückfrage zu {topic}",
                (f"{greet}\n\n"
                 "ich wollte kurz nachfassen — damit ich Ihnen gezielt "
                 f"weiterhelfen kann: Was genau soll sich mit {topic} "
                 "verbessern, und welches System läuft dafür heute? "
                 "Antworten Sie einfach hier.\n\n"
                 "Mit freundlichen Grüßen\nVincent Verbeke\nFounder, Kubotics"),
            )
        return (
            f"Kubotics: Kennenlernen zu {topic}",
            (f"{greet}\n\n"
             f"{contact_ask}"
             "der nächste und einzige Schritt ist ein kurzes Kennenlernen "
             "per Video — 15 Minuten, ohne Verpflichtung:\n"
             f"{BOOKING_LINK}\n\n"
             "Bis bald\nVincent Verbeke\nFounder, Kubotics"),
        )
    greet = f"{name}," if name else "Hello,"
    topic = interest or "your inquiry"
    firm = f" at {company}" if company else ""
    if step == 1:
        return (
            f"Kubotics: {topic}{firm}",
            (f"{greet}\n\n"
             f"thank you for your inquiry about {topic}{firm}. This is exactly "
             f"what we help Swiss customers with — from consulting to "
             f"turnkey installation ({LANDING_PAGE}).\n\n"
             "Which process would you like to automate or improve first? "
             "Simply REPLY to this message and I will come back to you "
             "personally.\n\n"
             "Kind regards\nVincent Verbeke\nFounder, Kubotics"),
        )
    if step == 2:
        return (
            f"Kubotics: quick follow-up on {topic}",
            (f"{greet}\n\n"
             "quick follow-up — to point you in the right direction: what "
             f"exactly should improve with {topic}, and which system does it "
             "run on today? Just reply here and I will take care of it.\n\n"
             "Kind regards\nVincent Verbeke\nFounder, Kubotics"),
        )
    return (
        f"Kubotics: let's talk about {topic}",
        (f"{greet}\n\n"
         f"{contact_ask}"
         "the one next step is a short get-to-know call on video — "
         "15 minutes, no strings attached:\n"
         f"{BOOKING_LINK}\n\n"
         "See you there\nVincent Verbeke\nFounder, Kubotics"),
    )


def _valid_llm_draft(parsed: Any) -> tuple[str, str] | None:
    if not isinstance(parsed, dict):
        return None
    subject = str(parsed.get("subject") or "").strip()
    body = str(parsed.get("body") or "").strip()
    if not subject or not body:
        return None
    if len(body) > LLM_MAX_BODY_CHARS or len(body.split()) > LLM_MAX_BODY_WORDS:
        return None
    return subject[:200], body


async def draft_touch(
    step: int,
    lang: str,
    *,
    first_name: str | None,
    company: str | None,
    interest: str | None,
    has_email: bool = True,
    has_phone: bool = True,
) -> Draft:
    """LLM-drafted {subject, body}; on ANY failure/timeout/bad shape fall
    back to the pre-written template for this step and language."""
    try:
        parsed, provider, _model = await asyncio.wait_for(
            _llm_chat(
                _system_prompt(
                    step, lang, has_email=has_email, has_phone=has_phone
                ),
                _user_prompt(first_name, company, interest, lang),
            ),
            timeout=LLM_TIMEOUT_S,
        )
        valid = _valid_llm_draft(parsed)
        if valid is not None:
            subject, body = valid
            return Draft(subject, body, "llm", provider, lang)
        logger.warning(
            "[lead-followup] LLM draft invalid (shape/size) — template fallback"
        )
    except TimeoutError:
        logger.warning(
            "[lead-followup] LLM draft timed out (%ss) — template fallback",
            LLM_TIMEOUT_S,
        )
    except Exception:  # ANY LLM failure (incl. LLMUnavailable) => template
        logger.warning(
            "[lead-followup] LLM draft failed — template fallback",
            exc_info=True,
        )
    subject, body = _template(
        step, lang, first_name=first_name, company=company, interest=interest,
        has_email=has_email, has_phone=has_phone,
    )
    return Draft(subject, body, "template", None, lang)


# ---------------------------------------------------------------------------
# Channel senders (the network seams)
# ---------------------------------------------------------------------------
def _to_html(text: str) -> str:
    escaped = html.escape(text or "")
    return "<p>" + escaped.replace("\n", "<br>\n") + "</p>"


async def _send_email(
    recipient: str, subject: str, body_text: str
) -> tuple[bool, str | None, str | None]:
    """Sent from the M365 organizer mailbox (m365_service.organizer_email —
    reused, NOT a second from-setting). Graph sendMail returns 202 without a
    message id, so provider id stays None."""
    try:
        ok = await m365_service.send_confirmation_email(
            recipient, subject, _to_html(body_text)
        )
    except Exception as exc:  # noqa: BLE001 — one provider must not crash the cycle
        logger.warning("[lead-followup] email send raised: %s", type(exc).__name__)
        return False, None, type(exc).__name__
    return bool(ok), None, None


async def _send_whatsapp(
    recipient: str, text: str
) -> tuple[bool, str | None, str | None]:
    try:
        ok, wamid, _raw = await whatsapp_service.send_text_message(
            recipient, text
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[lead-followup] whatsapp send raised: %s",
                       type(exc).__name__)
        return False, None, type(exc).__name__
    return bool(ok), wamid, None


async def _send_telegram(
    chat_id: str, text: str
) -> tuple[bool, str | None, str | None]:
    """channel_adapters' Telegram sendMessage pattern (settings.TELEGRAM_BOT_TOKEN)."""
    token = settings.TELEGRAM_BOT_TOKEN
    if not token:
        return False, None, "not_configured"
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(url, json={"chat_id": chat_id, "text": text})
        data = {}
        if resp.headers.get("content-type", "").startswith("application/json"):
            data = resp.json()
        if resp.status_code == 200 and data.get("ok"):
            msg_id = (data.get("result") or {}).get("message_id")
            return True, str(msg_id) if msg_id is not None else None, None
        return False, None, f"http_{resp.status_code}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[lead-followup] telegram send raised: %s",
                       type(exc).__name__)
        return False, None, type(exc).__name__


async def _dispatch(
    target: ChannelTarget, draft: Draft
) -> tuple[bool, str | None, str | None]:
    if target.channel == "email":
        return await _send_email(target.recipient, draft.subject, draft.body)
    if target.channel == "whatsapp":
        return await _send_whatsapp(target.recipient, draft.body)
    if target.channel == "telegram":
        return await _send_telegram(target.recipient, draft.body)
    return False, None, "unknown_channel"


# ---------------------------------------------------------------------------
# Row + audit helpers
# ---------------------------------------------------------------------------
def _log(
    db: AsyncSession,
    *,
    now: datetime,
    contact_id=None,
    step: int | None = None,
    channel: str | None = None,
    subject_preview: str | None = None,
    provider_message_id: str | None = None,
    status: str,
    detail: str | None = None,
) -> None:
    """Audit row. NEVER a body, NEVER a recipient address — subject preview
    (email only) and machine reasons only."""
    db.add(
        LeadFollowupLog(
            contact_id=contact_id,
            step=step,
            channel=channel,
            subject_preview=(
                subject_preview[:200] if subject_preview else None
            ),
            provider_message_id=provider_message_id,
            status=status,
            detail=(detail or "")[:500] or None,
            created_at=now,
        )
    )


def _new_row(
    contact_id, step: int, status: str, now: datetime,
    next_due: datetime | None = None,
) -> LeadFollowup:
    return LeadFollowup(
        contact_id=contact_id,
        step=step,
        status=status,
        last_sent_at=None,
        next_due_at=next_due,
        created_at=now,
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# Per-contact processing
# ---------------------------------------------------------------------------
async def _process_contact(
    db: AsyncSession,
    contact: Contact,
    row: LeadFollowup | None,
    now: datetime,
    sends_today: int,
    cap: int,
) -> dict:
    """STOPs first, then channel -> draft -> send -> row/log updates."""
    info = await _inbound_info(db, contact.id)

    stop = await evaluate_stops(db, contact, row, now, info)
    if stop is not None:
        status, detail = stop
        step = row.step if row is not None else 0
        if row is not None:
            row.status = status
            row.next_due_at = None
            row.updated_at = now
        else:
            db.add(_new_row(contact.id, step, status, now))
        _log(db, now=now, contact_id=contact.id, step=step,
             status="skipped", detail=detail)
        return {"kind": "stopped", "contact_id": str(contact.id),
                "status": status, "reason": detail}

    # daily cap: defer this lead to tomorrow's window and halt for the day
    if sends_today >= cap:
        step = row.step if row is not None else 1
        due = next_allowed_time(now)
        if row is not None:
            row.status = "pending"
            row.next_due_at = due
            row.updated_at = now
        else:
            db.add(_new_row(contact.id, step, "pending", now, next_due=due))
        _log(db, now=now, contact_id=contact.id, step=step,
             status="skipped", detail="daily_cap")
        return {"kind": "skipped", "contact_id": str(contact.id),
                "reason": "daily_cap", "halt": True}

    step = row.step if row is not None else 1

    points = await _contact_points(db, contact.id)
    telegram_id = await _telegram_identity(db, contact.id)
    target, reason = resolve_channel(points, telegram_id, step, info, now)
    if target is None:
        # No channel reaches this lead RIGHT NOW (e.g. the Meta 24h window is
        # closed and there is no telegram/email point): DEFER the sequence by
        # 24h instead of killing it. "stopped" is terminal
        # (candidate_skip_reason filters terminal rows forever), so this path
        # used to silently drop step 3 — the closing touch that asks for the
        # missing contact details. Unreachability is NEVER terminal: a reply
        # reopens the WhatsApp window and an email captured later becomes the
        # fallback on the next attempt (log detail: deferred_unreachable).
        # The age stop (LEAD_MAX_AGE) still bounds how long a row may defer.
        due = now + timedelta(hours=24)
        if row is not None:
            row.status = "pending"
            row.next_due_at = due
            row.updated_at = now
        else:
            db.add(_new_row(contact.id, step, "pending", now, next_due=due))
        _log(db, now=now, contact_id=contact.id, step=step,
             status="skipped", detail="deferred_unreachable")
        return {"kind": "skipped", "contact_id": str(contact.id),
                "reason": reason, "deferred_to": due.isoformat()}

    lang = pick_language(contact, info.last_text)
    draft = await draft_touch(
        step,
        lang,
        first_name=contact.first_name,
        company=await _company_name(db, contact.id),
        interest=await _primary_interest(db, contact.id),
        # closing touch (step 3) only asks for the details we do NOT have
        has_email=any(p.channel_type == "email" and p.value for p in points),
        has_phone=any(
            p.channel_type in ("whatsapp", "phone_mobile", "phone_office")
            and p.value
            for p in points
        ),
    )

    ok, provider_id, err = await _dispatch(target, draft)
    if not ok:
        attempts = await _failed_attempts(db, contact.id, step)
        _log(db, now=now, contact_id=contact.id, step=step,
             channel=target.channel, status="failed",
             detail=f"send_failed:{err or 'rejected'}")
        if attempts + 1 >= MAX_SEND_FAILURES:
            if row is not None:
                row.status = "stopped"
                row.next_due_at = None
                row.updated_at = now
            else:
                db.add(_new_row(contact.id, step, "stopped", now))
            _log(db, now=now, contact_id=contact.id, step=step,
                 channel=target.channel, status="skipped",
                 detail="send_failures_exhausted")
            return {"kind": "failed", "contact_id": str(contact.id),
                    "reason": "send_failures_exhausted"}
        return {"kind": "failed", "contact_id": str(contact.id),
                "reason": "send_failed"}

    # success: audit row (NO body, NO recipient), then advance the sequence
    _log(
        db,
        now=now,
        contact_id=contact.id,
        step=step,
        channel=target.channel,
        subject_preview=draft.subject if target.channel == "email" else None,
        provider_message_id=provider_id,
        status="ok",
        detail=f"{draft.source}:{draft.provider or draft.language}",
    )
    next_step = step + 1
    if row is None:
        row = _new_row(contact.id, next_step, "pending", now)
        db.add(row)
    row.step = next_step
    row.last_sent_at = now
    row.updated_at = now
    if next_step > settings.LEAD_FOLLOWUP_MAX_TOUCHES:
        row.status = "maxed"
        row.next_due_at = None
    else:
        row.status = "pending"
        row.next_due_at = now + NEXT_STEP_DELAY[next_step]
    return {"kind": "sent", "contact_id": str(contact.id), "step": step,
            "channel": target.channel, "source": draft.source}


# ---------------------------------------------------------------------------
# Orchestration (used by the loop AND the tests)
# ---------------------------------------------------------------------------
async def run_due(db: AsyncSession, now: datetime) -> dict:
    """One follow-up cycle: stop-gated, quiet-hours-gated, capped.

    Pure-ish: every collaborator it touches is injectable/stubbable and it
    never opens its own session (the caller owns ``db``).
    """
    now = _as_utc(now)
    result: dict[str, Any] = {
        "now": now.isoformat(),
        "quiet_hours": False,
        "daily_cap_hit": False,
        "due": 0,
        "sent": [],
        "stopped": [],
        "skipped": [],
        "failed": [],
    }
    if in_quiet_hours(now):
        result["quiet_hours"] = True
        return result

    candidates = await select_candidates(db, now)
    result["due"] = len(candidates)

    sends_today = await _sends_today(db, now)
    cap = settings.LEAD_FOLLOWUP_MAX_PER_DAY
    cycle = 0
    for contact in candidates:
        if cycle >= MAX_PER_CYCLE:
            result["skipped"].append(
                {"contact_id": str(contact.id), "reason": "cycle_cap"}
            )
            break
        try:
            row = await _get_row(db, contact.id)
            outcome = await _process_contact(
                db, contact, row, now, sends_today, cap
            )
        except Exception as exc:  # one lead must not kill the cycle
            logger.exception("[lead-followup] contact processing crashed")
            result["skipped"].append(
                {"contact_id": str(contact.id),
                 "reason": f"error:{type(exc).__name__}"}
            )
            continue
        kind = outcome.pop("kind", "skipped")
        result.setdefault(kind, []).append(outcome)
        if kind == "sent":
            sends_today += 1
            cycle += 1
        if outcome.get("halt"):
            result["daily_cap_hit"] = True
            break
    await db.commit()
    return result


# ---------------------------------------------------------------------------
# Status snapshot (admin API)
# ---------------------------------------------------------------------------
async def status_snapshot(db: AsyncSession, now: datetime) -> dict:
    """Admin observability. contact_id only — no names, no addresses."""
    now = _as_utc(now)
    rows = (await db.execute(select(LeadFollowup))).scalars().all()
    counts = Counter(r.status for r in rows)
    due = [
        r for r in rows
        if r.status in SCHEDULABLE_STATUSES
        and _as_utc(r.next_due_at) is not None
        and _as_utc(r.next_due_at) <= now
    ]
    due.sort(key=lambda r: _as_utc(r.next_due_at))
    return {
        "enabled": followup_enabled(),
        "loop_started_at": (
            _LOOP_STARTED_AT.isoformat() if _LOOP_STARTED_AT else None
        ),
        "counts": {s: counts.get(s, 0) for s in ALL_STATUSES},
        "today_sends": await _sends_today(db, now),
        "today_cap": settings.LEAD_FOLLOWUP_MAX_PER_DAY,
        "max_touches": settings.LEAD_FOLLOWUP_MAX_TOUCHES,
        "quiet_hours": [
            settings.LEAD_FOLLOWUP_QUIET_START,
            settings.LEAD_FOLLOWUP_QUIET_END,
        ],
        "next_due": [
            {
                "contact_id": str(r.contact_id),
                "step": r.step,
                "next_due_at": _as_utc(r.next_due_at).isoformat(),
            }
            for r in due[:5]
        ],
    }


async def stop_followup(
    db: AsyncSession, contact: Contact, now: datetime
) -> dict:
    """Admin stop: terminal row (created if the lead was never in the
    sequence) + one audit entry. Idempotent."""
    now = _as_utc(now)
    row = await _get_row(db, contact.id)
    if row is not None:
        row.status = "stopped"
        row.next_due_at = None
        row.updated_at = now
        step = row.step
    else:
        step = 0
        db.add(_new_row(contact.id, step, "stopped", now))
    _log(db, now=now, contact_id=contact.id, step=step, status="skipped",
         detail="admin_stop")
    await db.commit()
    return {"contact_id": str(contact.id), "status": "stopped"}


# ---------------------------------------------------------------------------
# Background loop (main.py lifespan; default OFF)
# ---------------------------------------------------------------------------
def followup_enabled() -> bool:
    return bool(settings.LEAD_FOLLOWUP_ENABLED)


async def followup_loop(interval_s: int | None = None) -> None:
    """Background cycle: boot grace, run_due, one bad cycle never kills it."""
    interval = interval_s or CYCLE_TICK_S
    await asyncio.sleep(5)  # let the app finish booting
    while True:
        try:
            async with AsyncSessionLocal() as db:
                outcome = await run_due(db, datetime.now(UTC))
            if outcome.get("sent") or outcome.get("stopped"):
                logger.info(
                    "[lead-followup] cycle done: due=%s sent=%s stopped=%s "
                    "skipped=%s",
                    outcome.get("due"), len(outcome.get("sent", [])),
                    len(outcome.get("stopped", [])),
                    len(outcome.get("skipped", [])),
                )
        except asyncio.CancelledError:  # noqa: PERF201
            raise
        except Exception:
            logger.exception("[lead-followup] cycle crashed")
        await asyncio.sleep(interval)


def maybe_start_followup_loop() -> asyncio.Task | None:
    """main.py lifespan hook: the follow-up task when the flag is on.

    Gate = LEAD_FOLLOWUP_ENABLED only (default False) => None => NOTHING
    registers and NOTHING is ever drafted or sent (default-off rule).
    """
    global _LOOP_STARTED_AT
    if not followup_enabled():
        return None
    _LOOP_STARTED_AT = datetime.now(UTC)
    return asyncio.create_task(followup_loop())
