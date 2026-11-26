import asyncio
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
from app.services import mail_llm
from app.services.chat_context import (
    BOOKING_LINK,
    CHAT_SYSTEM_PROMPT,
    QUALIFYING_TEXTS,
    offer_context_block,
    strip_chat_markdown,
)
from app.services.m365_service import m365_service

logger = logging.getLogger(__name__)

#: Vincent 2026-11-23 ("pls LLM + Offer Context in Whatsapp"): one agent turn
#: through the shared provider chain may take up to 60s per provider, so the
#: messaging lane caps the whole call here and falls back to the canned stage
#: reply — a WhatsApp reply must never hang on a slow model.
AGENT_LLM_TIMEOUT_S = 45.0

#: Vincent 2026-11-26 workflow rule ("the chat should ALWAYS do 3 to 5
#: steps asking deeper about the exact expectations of a potential
#: customer"): ALWAYS run 3-5 messages of qualifying questions BEFORE asking
#: for a meeting. Stages 0-4 each ask ONE deeper question (application ->
#: current setup & volume -> success criteria & timeline -> constraints &
#: budget -> recap); the closing message then asks for email + phone FIRST
#: and proposes the meeting. Early close: explicit booking intent at ANY
#: stage, both email + phone volunteered from MIN_EARLY_CLOSE_TURN on.
QUALIFYING_TURNS = 5

#: Earliest stage at which "email + phone already volunteered" may close the
#: flow — the first 3 qualifying questions always happen.
MIN_EARLY_CLOSE_TURN = 3

#: An explicit "I want to book" skips the qualifying phase immediately —
#: never block an explicit booking request behind our question flow.
_BOOKING_INTENT_RE = re.compile(
    r"\b(book|booking|meet|meeting|termin|appointment|demo|discovery|slot|"
    r"kennenlernen|calendar|calendly|call|videocall|video call)\b",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"(?<!\d)\+?[\d][\d\s().\-]{6,}\d(?!\d)")

#: Light language pick for the CANNED stage replies: the LLM path mirrors
#: the visitor's language itself, but when the chain is down the fallback
#: serves Swiss High German for German-looking messages and English
#: otherwise (Vincent 2026-11-26: "Swiss High German de-CH for German ...
#: English variants consistent with the existing style").
_DE_HINT_RE = re.compile(
    r"[äöüß]"
    r"|\b(?:ich|wir|sie|und|nicht|für|mit|von|den|dem|der|die|das|"
    r"eine|einen|auch|noch|bereits|danke|grüezi|gruezi|bitte|unsere|unser|"
    r"brauchen|braucht|suchen|möchte|klingt|gut|lass|uns|machen|"
    r"lösung|prozess|firma|kunden|zeitrahmen|wochen|monat|termin|"
    r"rechnung|rechnungen|automatisierung|belege|volumen|heute|soll|"
    r"wollen|kann|gibt|sehr|darauf|vielen|frage|fragen|konkret|dafür|"
    r"ablauf|ziel|betrieb|unternehmen|rahmen|passt|geht|kurz|"
    r"ebenfalls|natürlich)\b",
    re.IGNORECASE,
)


def _detect_lang(text: str) -> str:
    """\"de\" when the message looks German, else \"en\" (canned replies)."""
    return "de" if _DE_HINT_RE.search(text or "") else "en"


def _volunteered_contact(text: str) -> bool:
    """True when BOTH an email address and a phone number appear in text."""
    return bool(_EMAIL_RE.search(text)) and bool(_PHONE_RE.search(text))


def _should_close(message: str, stage: int = 0, history_text: str = "") -> bool:
    """Closing rule of the 2026-11-26 workflow (3-5 qualifying steps).

    * ``stage >= QUALIFYING_TURNS`` — the normal path: after the 5 qualifying
      questions the flow always closes.
    * explicit booking intent (existing _BOOKING_INTENT_RE gate) — closes at
      ANY stage: a booking request is never blocked by the question flow.
    * both email AND phone already volunteered (message + history) — closes
      from ``MIN_EARLY_CLOSE_TURN`` on: the first 3 questions always happen,
      then only contact details are missing before the meeting ask.
    """
    if stage >= QUALIFYING_TURNS:
        return True
    if _BOOKING_INTENT_RE.search(message):
        return True
    if stage >= MIN_EARLY_CLOSE_TURN and _volunteered_contact(
        f"{message}\n{history_text}"
    ):
        return True
    return False


def _closing_reply(context: str, lang: str = "en") -> str:
    """The closing workflow message: asks for email + phone FIRST, then
    proposes the meeting. The booking link lives inside the TEXT so every channel
    (WhatsApp text, Telegram, voice transcript fallback) delivers it — the
    2026-11-23 lead analysis showed a separately-computed link was dropped.
    German serves Swiss High German (de-CH), matching the canned stage replies.
    """
    if lang == "de":
        return (
            f"{context} Nennen Sie mir zuerst Ihre E-Mail-Adresse und "
            "Telefonnummer. Danach lernen wir uns kurz kennen — ein "
            "15-minütiger Call. Buchen Sie Ihren Slot direkt hier:\n"
            f"{BOOKING_LINK}"
        )
    return (
        f"{context} Could you share your email address and phone number "
        "first? Then let's meet — a short 15-minute get-to-know call. "
        f"Book your slot directly here:\n{BOOKING_LINK}"
    )


#: Canned qualifying replies per intent branch and language (Vincent
#: 2026-11-26: "3 to 5 steps asking deeper about the exact expectations of a
#: potential customer"). Stage 0 = which application/problem to solve,
#: stage 1 = current setup/process & volume — both offer specific; stages
#: 2-4 are the shared deeper questions from QUALIFYING_TEXTS (success
#: criteria/goal & timeline, constraints/budget & decision process, recap +
#: confirm expectations). ONE question per message; NEVER a meeting ask
#: while qualifying; the closing reply is built by `_closing_reply`.
def _stage_table(
    stage0_en: str, stage1_en: str, stage0_de: str, stage1_de: str
) -> dict[str, tuple[str, ...]]:
    return {
        "en": (
            stage0_en, stage1_en,
            QUALIFYING_TEXTS["en"][2],
            QUALIFYING_TEXTS["en"][3],
            QUALIFYING_TEXTS["en"][4],
        ),
        "de": (
            stage0_de, stage1_de,
            QUALIFYING_TEXTS["de"][2],
            QUALIFYING_TEXTS["de"][3],
            QUALIFYING_TEXTS["de"][4],
        ),
    }


_STAGE_TEXTS: dict[str, dict[str, tuple[str, ...]]] = {
    "h2": _stage_table(
        (
            "Kubotics delivers turnkey Unitree robotics with official "
            "commissioning in Switzerland, including on-site Consulting "
            "& Test Days with the Unitree H2 humanoid. Quick question "
            "first: which application do you have in mind for the H2 — "
            "an on-site test day, research, or a concrete process in "
            "your company?"
        ),
        (
            "Thanks. One more question so I can prepare this properly: "
            "what does your current setup look like, and when should "
            "the H2 be operational?"
        ),
        (
            "Kubotics liefert schlüsselfertige Unitree-Robotik mit "
            "offizieller Inbetriebnahme in der Schweiz — inklusive "
            "Consulting- & Testtagen vor Ort mit dem H2-Humanoid. Kurze "
            "Frage vorab: welche Anwendung haben Sie für den H2 im Sinn — "
            "einen Testtag vor Ort, Forschung oder einen konkreten Prozess "
            "in Ihrem Betrieb?"
        ),
        (
            "Danke. Noch eine Frage, damit ich mich gut vorbereiten kann: "
            "Wie sieht Ihr heutiger Setup aus, und wann soll der H2 "
            "einsatzbereit sein?"
        ),
    ),
    "invoice": _stage_table(
        (
            "Our multimodal LLM extraction pipeline parses incoming & "
            "outgoing invoices with >98.5% accuracy — even from "
            "low-grade scans, faxes, or wrinkled physical paper — "
            "directly into your ERP. Quick question first: what "
            "monthly volume are you processing?"
        ),
        (
            "Understood. And which system should the extracted data "
            "land in, and how do invoices arrive today — email, scan, "
            "or paper?"
        ),
        (
            "Unsere multimodale LLM-Extraktionspipeline liest ein- und "
            "ausgehende Rechnungen mit über 98.5% Genauigkeit — auch aus "
            "minderwertigen Scans, Faxes oder zerknitterten Belegen — "
            "direkt in Ihr ERP. Kurze Frage vorab: welches Volumen "
            "verarbeiten Sie pro Monat?"
        ),
        (
            "Verstanden. In welchem System sollen die extrahierten Daten "
            "landen, und wie kommen Rechnungen heute an — E-Mail, Scan "
            "oder Papier?"
        ),
    ),
    "general": _stage_table(
        (
            "Grüezi! I am the Kubotics Autonomous Assistant. We "
            "specialize in Unitree humanoid delivery (H2/G1), custom "
            "factory automation with robot arms, and multimodal LLM "
            "business process automations in Switzerland. Quick "
            "question first: what would you like to automate first — "
            "robotics (Unitree H2/G1, robot arms) or a business "
            "process (invoices, scheduling, outreach)?"
        ),
        (
            "Thanks. One more question so I can point you to the right "
            "solution: what does your current setup look like, and what "
            "timeline are you aiming for?"
        ),
        (
            "Grüezi! Ich bin Ihr Kubotics Autonomous Assistant. Wir "
            "spezialisieren uns auf Unitree-Humanoide (H2/G1), "
            "individuelle Fabrikautomatisierung mit Robotarmen und "
            "multimodale LLM-Geschäftsprozess-Automatisierungen in der "
            "Schweiz. Kurze Frage vorab: Was möchten Sie zuerst "
            "automatisieren — Robotik (Unitree H2/G1, Roboterarme) oder "
            "einen Geschäftsprozess (Rechnungen, Terminplanung, Outreach)?"
        ),
        (
            "Danke. Noch eine Frage, damit ich Sie zur richtigen Lösung "
            "führen kann: Wie sieht Ihr heutiger Setup aus, und welchen "
            "Zeitrahmen streben Sie an?"
        ),
    ),
}

#: Quick replies per branch for qualifying turns — (stage 0, stage 1);
#: stages 2-4 reuse the stage-1 chips. Topic chips only, never a meeting
#: chip while qualifying (Vincent 2026-11-26).
_STAGE_CHIPS: dict[str, tuple[list[str], list[str]]] = {
    "h2": (
        ["Test Day on-site", "Research & evaluation", "Pricing"],
        ["Just exploring", "Timeline is set", "Pricing"],
    ),
    "invoice": (
        ["500 - 2,000 / month", "2,000 - 10,000 / month", "Pricing"],
        ["Email", "Scan / paper", "Mixed"],
    ),
    "general": (
        ["Unitree H2 Test Day", "Factory Robot Arms", "Invoice LLMs"],
        ["Just exploring", "Project planned", "Pricing"],
    ),
}

#: One-line need recap per branch and language, prepended by
#: `_closing_reply` to the closing message (email + phone FIRST, then the
#: 15-minute call with BOOKING_LINK inside the text).
_CLOSING_CONTEXT: dict[str, dict[str, str]] = {
    "h2": {
        "en": ("That is exactly what our Unitree H2 Consulting & Test Days "
               "in Switzerland cover."),
        "de": ("Das ist genau das, was unsere Unitree-H2-Consulting- & "
               "Testtags in der Schweiz abdecken."),
    },
    "invoice": {
        "en": ("Our multimodal LLM extraction pipeline fits that — "
               "invoices land in your ERP straight from scans, faxes or "
               "paper."),
        "de": ("Unsere multimodale LLM-Extraktionspipeline passt dazu — "
               "Rechnungen landen direkt aus Scans, Faxes oder Papier in "
               "Ihrem ERP."),
    },
    "general": {
        "en": ("Thanks — that is squarely our field (Unitree robotics, "
               "factory automation, invoice & process LLMs)."),
        "de": ("Danke — das ist genau unser Feld (Unitree-Robotik, "
               "Fabrikautomatisierung und Prozess-LLMs)."),
    },
}


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
        # conversation already seen? Stages 1..QUALIFYING_TURNS each ask ONE
        # deeper question about the lead's exact expectations; the closing
        # turn asks for email + phone and proposes the meeting (Vincent
        # 2026-11-26: 3-5 qualifying steps before any meeting ask). The stage
        # COUNTING itself stays as it always was.
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

        # Rolling transcript (newest 12, just-recorded inbound excluded): fed
        # to the LLM turn below AND — as the visitor's own words — to the
        # stage machine's "email + phone already volunteered" early close.
        history = await self._recent_history(
            db, conversation.id, inbound_msg.id
        )
        history_text = "\n".join(
            turn["content"] for turn in history
            if turn["role"] == "user" and (turn.get("content") or "").strip()
        )

        # 5. Agent Reasoning & Tool Execution. The stage machine is a plain
        # def (NOT a coroutine) — it must not be awaited: awaiting its tuple
        # return raised TypeError on every inbound message, which the webhook's
        # catch-all turned into a silent no-reply (2026-11-23).
        canned = self._run_agent_reasoning(
            envelope.message, stage, history_text
        )
        reply_text, tool_calls_executed, handoff, meeting_link, quick_replies = canned

        # 5b. LLM turn with offer context (Vincent 2026-11-23: "pls LLM +
        # Offer Context in Whatsapp"): same provider chain + shared system
        # prompt as the website chat, fed with this conversation's history and
        # the offer matching the message topic. A handoff never reaches the
        # model, and any model failure keeps the canned reply.
        llm_text = llm_provider = llm_model = None
        if not handoff:
            llm_text, llm_provider, llm_model = await self._llm_reply(
                envelope, history
            )
            reply_text, meeting_link = self._merge_llm_reply(
                canned, llm_text, envelope.message, stage, history_text
            )

        # 6. Record Observability Audit (agent_runs & agent_tool_calls)
        latency = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        agent_run = AgentRun(
            conversation_id=conversation.id,
            agent_name="KuboticsUnifiedAgent",
            # REAL pair that answered, or the canned marker — this used to be
            # the hard-coded "claude-3-7-sonnet" for every row (report
            # 2026-11-25), which made the audit table useless for analysis.
            model_identifier=(
                f"{llm_provider}:{llm_model}"[:100]
                if llm_text and llm_provider and llm_model
                else "canned:stage-machine"
            ),
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

    async def _recent_history(
        self, db: AsyncSession, conversation_id, exclude_message_id
    ) -> list[dict[str, str]]:
        """Last turns of this conversation as LLM history rows (oldest first),
        the just-recorded inbound message excluded — it is sent as the latest
        message instead of appearing twice."""
        rows = (
            (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == conversation_id)
                    .order_by(Message.id.desc())
                    .limit(12)
                )
            )
            .scalars()
            .all()
        )
        history = [
            m for m in rows if m.id != exclude_message_id
        ][::-1]
        return [
            {
                "role": "user" if m.sender_type == "visitor" else "assistant",
                "content": (m.content or ""),
            }
            for m in history
        ]

    async def _llm_reply(
        self, envelope: NormalizedChannelMessage, history: list[dict[str, str]]
    ) -> tuple[str | None, str | None, str | None]:
        """One messaging turn through the shared provider chain (mail_llm).

        Returns ``(text, provider, model)`` — text is None on any failure (no
        provider keys, all providers failed, timeout) so the caller keeps the
        canned stage reply. provider/model are the pair that actually
        answered, so agent_runs can record audit truth instead of the old
        hard-coded claude-3-7-sonnet (report 2026-11-25). The lane never
        500s and never stays silent because an LLM provider had a bad day.
        """
        parts = [
            (
                f"Channel: {envelope.channel} (messaging conversation, no "
                "landing page — drive your opening from the offer context "
                "below instead)."
            ),
            offer_context_block(envelope.message),
        ]
        if history:
            lines = ["Conversation so far:"]
            for turn in history:
                role = "Contact" if turn["role"] == "user" else "Kubotics"
                content = (turn.get("content") or "").strip()
                if content:
                    lines.append(f"{role}: {content[:1000]}")
            parts.append("\n".join(lines))
        parts.append(
            f"Contact's latest message: {(envelope.message or '').strip()}"
        )
        try:
            content, provider, model = await asyncio.wait_for(
                mail_llm.chat_text(CHAT_SYSTEM_PROMPT, "\n\n".join(parts)),
                timeout=AGENT_LLM_TIMEOUT_S,
            )
        except Exception as e:  # noqa: BLE001 — LLMUnavailable, timeout, transport
            logger.warning(
                "[agent_core:%s] LLM reply unavailable, using canned reply: %s",
                envelope.channel, e,
            )
            return None, None, None
        text = strip_chat_markdown((content or "").strip())
        if not text:
            return None, None, None
        logger.info(
            "[agent_core:%s] LLM reply via %s/%s (%d chars)",
            envelope.channel, provider, model, len(text),
        )
        return text, provider, model

    @staticmethod
    def _merge_llm_reply(
        canned: tuple, llm_text: str | None, message: str, stage: int,
        history_text: str = "",
    ) -> tuple[str, str | None]:
        """Adopt the model's text only when it respects the 2026-11-26
        workflow guards; otherwise keep the canned stage reply.

        Guards: a handoff never changes; a closing turn (`_should_close`:
        stage >= QUALIFYING_TURNS, explicit booking intent at ANY stage, or
        both email + phone volunteered from MIN_EARLY_CLOSE_TURN on) must ask
        for an email address ("mail" in de/en/fr/it) and always carries the
        booking link; a qualifying turn must ask a question and never carries
        the booking link.
        """
        reply_text, _tools, handoff, link, _chips = canned
        if handoff or not llm_text:
            return reply_text, link
        closing = _should_close(message, stage, history_text)
        if closing:
            if "mail" not in llm_text.lower():
                return reply_text, link
            if BOOKING_LINK not in llm_text:
                llm_text = f"{llm_text}\n\n{BOOKING_LINK}"
            return llm_text, BOOKING_LINK
        if "?" not in llm_text:
            return reply_text, link
        if BOOKING_LINK in llm_text:
            llm_text = "\n".join(
                line for line in llm_text.splitlines() if BOOKING_LINK not in line
            ).strip()
        return llm_text, None

    def _run_agent_reasoning(
        self, text: str, stage: int, history_text: str = ""
    ):
        """Conversation driver for the qualification workflow (Vincent
        2026-11-26): the first QUALIFYING_TURNS replies each ask ONE deeper
        qualifying question about the lead's EXACT expectations — which
        application/problem, current setup & volume, success criteria &
        timeline, constraints & budget, then a recap — never a meeting ask.
        The closing reply asks for the lead's email address + phone number
        FIRST and then proposes the meeting; the booking link is part of the
        reply TEXT so no channel can drop it. An explicit booking request
        jumps straight to the closing reply at ANY stage, a lead that already
        volunteered both email and phone from MIN_EARLY_CLOSE_TURN on; a
        handoff request still wins over everything. German messages get the
        Swiss High German (de-CH) canned text, English messages the English
        variants.
        """
        lower = text.lower()
        lang = _detect_lang(text)
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

        if "h2" in lower or "test day" in lower or "robot" in lower:
            branch = "h2"
            tool_calls.append({
                "name": "query_product_catalog",
                "args": {"sku": "UNITREE-H2"},
                "result": {"status": "available", "base_price_chf": "On Request", "lead_time_days": 14}
            })
        elif "invoice" in lower or "rechnung" in lower or "scan" in lower:
            branch = "invoice"
            tool_calls.append({
                "name": "calculate_roi_projection",
                "args": {"category": "invoice_llm", "estimated_volume": 1200},
                "result": {"annual_savings_chf": 167400, "payback_months": 2.5}
            })
        else:
            branch = "general"

        if _should_close(lower, stage, history_text):
            reply = _closing_reply(_CLOSING_CONTEXT[branch][lang], lang)
            return reply, tool_calls, False, BOOKING_LINK, [
                "Book M365 Discovery Slot"
            ]

        # Qualifying turn: ONE deeper question per message (stages 0-4),
        # never a meeting ask and never the booking link (Vincent 2026-11-26).
        stage = max(0, min(stage, len(_STAGE_TEXTS[branch][lang]) - 1))
        reply = _STAGE_TEXTS[branch][lang][stage]
        quick_replies = _STAGE_CHIPS[branch][min(stage, 1)]
        return reply, tool_calls, False, None, quick_replies


agent_core = KuboticsAgentCore()
