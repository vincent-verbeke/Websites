"""Shared chat context: system prompt, landing-page offers, offer selection.

One prompt + one offer source for BOTH conversation drivers that answer
through the shared LLM provider chain (mail_llm: MiMo -> OpenAI -> Gemini ->
Grok):

* the website CTA chat (``app.api.v1.endpoints``) — the visitor's landing
  page path selects the offer;
* the WhatsApp / Telegram / Teams agent core (``app.services.agent_core``) —
  there is no page, so the message topic selects the offer (Vincent
  2026-11-23: "reply via LLM with specific data from our offer injected ...
  in WhatsApp").

Splitting the context out of the API module keeps the two lanes byte-identical
in what they tell the model, so an offer fix lands in both at once.
"""

import re

BOOKING_LINK = (
    "https://bookings.cloud.microsoft/book/"
    "KuboticsGet2Know@kuroliv.ch/?ismsaljsauthenabled"
)

# System prompt for the website CTA chat (Vincent 2026-11-11: "ensure this CTA
# chat uses the LLM which we use to chat combined with context so we get a top
# professional example"). Context = same provider chain the Kubot mail agent
# uses (mail_llm: MiMo -> OpenAI -> Gemini -> Grok) + full conversation history
# + page/topic context sent by the frontend.
CHAT_SYSTEM_PROMPT = f"""\
You are the Kubotics Sales Engineer — the official AI assistant of Kubotics, \
a brand of KuroLIV GmbH (Färberstrasse 5, 8832 Wollerau, Switzerland, \
UID CHE-365.727.853), founded by Vincent Verbeke. You answer website visitors \
and messaging contacts with Swiss precision: professional, warm, concise and \
concrete. Never invent prices, ROI figures or capabilities that are not \
listed below.

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
- ALWAYS answer in the language of the visitor's latest message (German, \
English, French, Italian or Dutch). If that message gives no clear language, \
use the "language" value from the page context (their browser locale), else \
the language of the conversation so far. The contact's language decides, \
never yours. Keep answers under ~120 words: a short opening, the substance, \
and ONE clear qualifying question or next step.
- Be personal: address the contact directly (you / Sie / vous / voi), refer \
back to their own words, their stated process, company or name when known, \
and never repeat a canned opening twice or sound like a script. Grüezi/Hello \
once at the start of the conversation, then plain professional speech. Use \
short paragraphs or bullets, no markdown headers, no emojis.
- Let the landing page (or the "Offer context" block, for messaging \
contacts that have no page) drive your opening: every turn carries \
"Visitor page context" (page path) or the offer context. Your default first \
sentence and recommended next step must fit THAT page/offer (e.g. the free \
automation analysis on the IT & business process automation page), not a \
generic company intro.
- QUALIFICATION FLOW (fixed, no exceptions): the first TWO turns of a \
conversation each ask exactly ONE question to determine the contact's need \
(goal, situation, volume, timeline). Never propose a meeting, a call, a \
calendar slot or a booking link before those two questions — regardless of \
topic or how interested the contact seems.
- From the THIRD turn on (or immediately when the contact explicitly asks \
to book or meet): recap the need in ONE line, ask for the contact's email \
address AND phone number, then propose a 15-minute get-to-know call with \
Vincent Verbeke, include the booking link and say the team follows up \
within 24h. Booking link: {BOOKING_LINK}
- For the marketing & sales offer, always describe BOTH the setup and the \
benefit, then ask which channel or bottleneck they want automated first.
- If asked something outside this portfolio, say honestly what we do and offer \
to route the question to the team. Never fabricate case studies or clients.
"""


# Offer of each landing page (copied from the page's own CTA copy). The
# website chat must inject the specific offer data of the page the visitor is
# on (Vincent 2026-11-23: "reply via LLM with specific data from our offer
# injected ... the default sentence and reply should be dependent on the
# landing page"). Matched by exact path or path prefix.
PAGE_OFFERS: dict[str, str] = {
    "/automation/it-business-process-automation": (
        "Free Automation Analysis (Kostenlose Automatisierungsanalyse): we review "
        "ONE concrete business process of the visitor's team, give a first "
        "assessment of feasibility, effort and economic benefit, and reply "
        "personally within 1 working day. No sales pitch, confidential. Focus: "
        "connect existing IT systems (ERP, CRM, M365 - SAP, Microsoft Dynamics, "
        "Odoo), eliminate manual re-keying between email, Excel and ERP, "
        "human-in-the-loop automation."
    ),
    "/automation/cnc-machine-tending": (
        "Free potential analysis: turnkey 6-axis robot / cobot cells for CNC "
        "machine tending, 24/7 unattended shifts, ROI under 6 months."
    ),
    "/automation/invoice-processing": (
        "Multimodal LLM invoice & document extraction: over 98.5% accuracy even "
        "from crumpled scans, straight into the visitor's ERP; amortization "
        "typically under 3 months - from about 400 invoices/month that is over "
        "CHF 35'000 saved per year. Visitors can submit sample documents for a "
        "test extraction."
    ),
    "/marketing/ai-marketing-sales": (
        "Fully automated AI-driven marketing & sales engine: website CTA chat + "
        "landing pages feed every visitor into the PostgreSQL CRM with UTM/"
        "first-touch attribution; ICP research and personalized outreach for "
        "Google Search, LinkedIn, email, WhatsApp and Telegram; autonomous lead "
        "qualification and meeting booking straight into Vincent's M365 calendar; "
        "hard monthly spend caps with human approval; brand voice in de/en/fr/it."
    ),
    "/robotics/unitree-h2-test-day": (
        "Unitree H2 Humanoid Consulting & Test Day in Switzerland: hands-on "
        "testing of the visitor's real process with the H2 (31 DoF, 360 Nm), "
        "plus G1/B2 portfolio and Swiss support."
    ),
    "/automation/discovery": (
        "Automation discovery: concept & ROI calculation with an amortization "
        "forecast before any hardware investment, validated hands-on via a test "
        "day or a sample-document extraction."
    ),
}

#: Message-topic -> landing page, in priority order. Messaging contacts carry
#: no page path, so their own words pick the offer (first match wins; a
#: message matching several topics gets every matching offer).
_TOPIC_PAGES: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("h2", "test day", "testtag", "unitree", "humanoid", "g1", "b2 ",
         "roboter", "robot"),
        "/robotics/unitree-h2-test-day",
    ),
    (
        ("invoice", "rechnung", "beleg", "quittung", "scan", "receipt",
         "document extraction", "erp"),
        "/automation/invoice-processing",
    ),
    (
        ("marketing", "sales", "werbung", "vertrieb", "kampagne", "campaign",
         "outreach", "lead gen", "leadgenerierung", "linkedin", "google ads",
         "pipeline"),
        "/marketing/ai-marketing-sales",
    ),
    (
        ("cnc", "machine tending", "maschinenbeschickung", "robotarm",
         "robot arm", "cobot", "fertigung", "factory", "assembly", "montage",
         "fokus", "pick-and-place"),
        "/automation/cnc-machine-tending",
    ),
    (
        ("discovery", "roi", "amortization", "amortisation", "feasibility",
         "machbarkeit", "potential analysis", "potenzialanalyse"),
        "/automation/discovery",
    ),
    (
        ("automatisierung", "automation", "prozess", "process", "workflow",
         "integration", "scheduling", "dispatch", "it-system", "it system"),
        "/automation/it-business-process-automation",
    ),
)


def offer_for_page(page: str) -> str | None:
    """The landing-page offer for a page path (None when the page has none)."""
    if not page:
        return None
    if page in PAGE_OFFERS:
        return PAGE_OFFERS[page]
    for prefix, offer in PAGE_OFFERS.items():
        if page.startswith(prefix + "/"):
            return offer
    return None


def offers_for_text(text: str) -> list[str]:
    """Offer(s) matching a message's topic — the messaging-channel mirror of
    ``offer_for_page``.

    No topic keyword -> every offer, so the model still has the exact figures
    (98.5%, CHF 35'000, ROI < 6 months, free analysis) instead of inventing
    them.
    """
    low = (text or "").lower()
    hits: list[str] = []
    for keys, page in _TOPIC_PAGES:
        if any(k in low for k in keys):
            offer = PAGE_OFFERS[page]
            if offer not in hits:
                hits.append(offer)
    return hits or list(PAGE_OFFERS.values())


def offer_context_block(text: str) -> str:
    """The 'Offer context' user-content block for a messaging turn."""
    offers = offers_for_text(text)
    return (
        "Offer context (your opening and recommended next step must fit it; "
        "never invent figures beyond it):\n- " + "\n- ".join(offers)
    )


def strip_chat_markdown(text: str) -> str:
    """Chat surfaces render plain text: drop emphasis/code markup so contacts
    never see raw ** or backticks (models do this despite the prompt)."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"(?<!\w)[*_](.+?)[*_](?!\w)", r"\1", text)
    text = re.sub(r"`{1,3}(.+?)`{1,3}", r"\1", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    return text.strip()
