import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.dto import (
    ChatAgentResponse,
    ChatMessagePayload,
    InboundLeadCreate,
    LeadResponse,
    MeetingBookingRequest,
)
from app.services import mail_llm
from app.services.chat_context import (
    BOOKING_LINK,
    CHAT_SYSTEM_PROMPT,
)
from app.services.chat_context import (
    offer_for_page as _offer_for_page,
)
from app.services.chat_context import (
    strip_chat_markdown as _strip_chat_markdown,
)
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

# BOOKING_LINK, CHAT_SYSTEM_PROMPT and PAGE_OFFERS live in
# app.services.chat_context — shared with the WhatsApp/Telegram agent core.

#: Vincent 2026-11-23 workflow: the first QUALIFYING_TURNS visitor messages
#: are answered with qualifying questions ONLY — never with a meeting ask.
#: The closing turn asks for email + phone and proposes the meeting (the
#: booking link + lead_qualified flip the widget into its conversion stage).
QUALIFYING_TURNS = 2

# CHAT_SYSTEM_PROMPT lives in app.services.chat_context (shared with the
# WhatsApp/Telegram/Teams agent core) so both lanes tell the model the same
# portfolio, style and qualification rules.


# PAGE_OFFERS / _offer_for_page: see app.services.chat_context — the same
# offer table feeds the messaging lanes (topic-selected instead of page-selected).


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
    offer = _offer_for_page(str(ctx.get("page") or ""))
    if offer:
        parts.append(
            "Offer of the landing page the visitor is on (your opening and "
            f"recommended next step must depend on it): {offer}"
        )
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


def _intent_signals(
    user_msg: str, turn_count: int = 0
) -> tuple[list[str], str | None, bool, str]:
    """Keyword intent detection — structured signals + canned fallback reply.

    The LLM writes the actual reply text; these signals keep quick-reply
    chips, the booking link and lead qualification working even when the
    provider chain is down (and drive them when it is up).

    ``turn_count`` = number of visitor messages BEFORE this one. While
    ``turn_count < QUALIFYING_TURNS`` the signals NEVER carry a booking
    link, a meeting chip or lead_qualified=True — each of those turns
    returns ONE qualifying question instead (Vincent 2026-11-23: "2-3
    messages with questions to determine the need before asking for a
    meeting"). The closing turn asks for email + phone and proposes the
    meeting.
    """
    if "test day" in user_msg or "h2" in user_msg:
        chips = (
            ["Test Day on-site", "Research & demo", "Pricing"],
            ["Evaluation / pilot", "Concrete use case", "Pricing"],
        )
        replies = (
            (
                "We conduct dedicated Unitree H2 Humanoid Consulting & Test Days "
                "on-site in Switzerland. Quick question first: which application "
                "do you have in mind for the H2 — an on-site test/evaluation day, "
                "research, or a concrete process in your company?"
            ),
            (
                "Understood. One more question so I can prepare this properly: "
                "what does your current setup look like, and when should the H2 "
                "be operational?"
            ),
        )
        final_chips = ["Book M365 Calendar", "Technical Specs", "Pricing"]
    elif any(k in user_msg for k in (
        "marketing", "sales", "werbung", "vertrieb", "kampagne", "campaign",
        "lead gen", "leadgenerierung", "outreach", "google ads", "linkedin",
    )):
        chips = (
            ["Show me the setup", "Pricing & caps", "Which channel first?"],
            ["Outbound first", "Reporting first", "Pricing & caps"],
        )
        replies = (
            (
                "Our fully automated AI-driven marketing & sales engine covers "
                "ICP research, personalized multi-channel outreach, autonomous "
                "lead qualification and meeting booking — with hard monthly spend "
                "caps and human approval. Which channel should it automate first?"
            ),
            (
                "Got it. One more question: which system should it plug into "
                "first (CRM/ERP, outreach, reporting), and roughly how many "
                "qualified leads per month are you targeting?"
            ),
        )
        final_chips = ["Book a discovery call", "Pricing & caps", "Show me the setup"]
    elif "invoice" in user_msg or "rechnung" in user_msg:
        chips = (
            ["500 - 2,000 / month", "2,000 - 10,000 / month",
             "Request Technical Brief"],
            ["It lands in our ERP", "Email inbox", "Scan / paper"],
        )
        replies = (
            (
                "Our multimodal LLM pipeline extracts incoming & outgoing "
                "invoices with >98.5% accuracy, even from crumpled paperwork or "
                "low-resolution scans. What monthly volume are you processing?"
            ),
            (
                "Understood. One more question: which system should the "
                "extracted data land in, and how do invoices arrive today — "
                "email, scan, or paper?"
            ),
        )
        final_chips = ["Schedule Technical Call", "500 - 2,000 / month",
                       "Request Technical Brief"]
    elif "arm" in user_msg or "factory" in user_msg or "cnc" in user_msg:
        chips = (
            ["CNC Machine Tending", "Assembly Cell", "Site Feasibility Review"],
            ["New installation", "Retrofit", "Site Feasibility Review"],
        )
        replies = (
            (
                "We engineer turnkey robotic arm cells and collaborative cobots "
                "for machine tending and automated assembly. What part dimensions "
                "or cycle times are you targeting?"
            ),
            (
                "Noted. One more question: is this a new installation or a "
                "retrofit of an existing cell, and what timeline are you "
                "planning?"
            ),
        )
        final_chips = ["Book a discovery call", "CNC Machine Tending",
                       "Site Feasibility Review"]
    else:
        chips = (
            ["Unitree H2 Test Day", "Marketing & Sales Engine", "Invoice LLMs"],
            ["Just exploring", "Project planned", "Pricing"],
        )
        replies = (
            (
                "Grüezi! I am the Kubotics Sales Engineer. We deliver Unitree "
                "humanoid robots, custom factory robot arms, multimodal LLM "
                "business process automations, and a fully automated AI-driven "
                "marketing & sales engine in Switzerland. What would you like to "
                "automate or solve first?"
            ),
            (
                "Thanks. One more question so I can point you to the right "
                "solution: what does your current setup look like, and what "
                "timeline are you aiming for?"
            ),
        )
        final_chips = ["Book M365 Discovery Slot", "Unitree H2 Test Day",
                       "Invoice LLMs"]

    if turn_count >= QUALIFYING_TURNS:
        # Closing turn: ask for email + phone FIRST, then propose the meeting.
        return (
            final_chips,
            BOOKING_LINK,
            True,
            (
                "Thanks — that is exactly what we set up for customers in "
                "Switzerland. Could you share your email address and phone "
                "number first? Then let's meet: a short 15-minute get-to-know "
                f"call with Vincent Verbeke — book directly here: {BOOKING_LINK}"
            ),
        )
    return (
        chips[turn_count],
        None,
        False,
        replies[turn_count],
    )


def _visitor_lang(ctx: dict | None) -> str:
    """Chat language for this visitor from the browser-locale context.

    Mirrors `visitorChatLang()` on the frontend so the welcome sentence and
    the canned fallback can never mix languages (Vincent 2026-11-23: "always
    reply personal and in the language of the user"). No `language` key at all
    (older clients / tests) keeps the original English copy untouched.
    """
    raw = (ctx or {}).get("language")
    if raw is None:
        return "en"
    lang = str(raw).lower()
    if lang.startswith(("de", "fr", "it")):
        return lang[:2]
    if lang.startswith(("en", "nl")):
        return "en"
    return "de"  # site default (de-CH) for any other locale


def _localized_intent(user_msg: str, ctx: dict | None) -> str:
    """Same keyword classification as `_intent_signals`, plus the landing-
    page-dependent default: on the IT & business process automation page a
    message without an intent keyword gets THAT page's offer as default."""
    if "test day" in user_msg or "h2" in user_msg:
        return "h2"
    if any(k in user_msg for k in (
        "marketing", "sales", "werbung", "vertrieb", "kampagne", "campaign",
        "lead gen", "leadgenerierung", "outreach", "google ads", "linkedin",
    )):
        return "marketing"
    if "invoice" in user_msg or "rechnung" in user_msg:
        return "invoice"
    if "arm" in user_msg or "factory" in user_msg or "cnc" in user_msg:
        return "arm"
    if str((ctx or {}).get("page") or "").startswith(
        "/automation/it-business-process-automation"
    ):
        return "it_bpa"
    return "general"


# Shared stage-1 qualifying question (turn 2 of the 2026-11-23 workflow) for
# the open-ended intents — same text, only the language changes.
_T1_TEXT: dict[str, str] = {
    "de": ("Danke. Noch eine Frage, damit ich Sie zur richtigen Lösung führen "
           "kann: Wie sieht Ihr heutiger Setup aus, und welchen Zeitrahmen "
           "streben Sie an?"),
    "fr": ("Merci. Encore une question pour vous orienter vers la bonne "
           "solution : à quoi ressemble votre configuration actuelle, et quel "
           "calendrier visez-vous ?"),
    "it": ("Grazie. Ancora una domanda per indirizzarvi alla soluzione giusta: "
           "com'è il vostro setup attuale, e quale tempistica avete in mente?"),
}

_CLOSING_TEXT: dict[str, str] = {
    # en: byte-for-byte the English closing in `_intent_signals` (served on
    # the IT-BPA landing page, which bypasses the English early-return).
    "en": ("Thanks — that is exactly what we set up for customers in "
           "Switzerland. So I can prepare a short get-to-know call with "
           "Vincent Verbeke: could you share your email address and phone "
           "number? You can also book a 15-minute slot directly: "
           f"{BOOKING_LINK}"),
    "de": ("Das ist genau das, was wir für Kunden in der Schweiz aufsetzen. "
           "Damit ich einen kurzen Get-to-know-call mit Vincent Verbeke "
           "vorbereiten kann: nennen Sie mir bitte Ihre E-Mail-Adresse und "
           "Telefonnummer. Sie können auch direkt einen 15-Minuten-Slot "
           f"buchen: {BOOKING_LINK}"),
    "fr": ("C'est exactement ce que nous mettons en place pour nos clients en "
           "Suisse. Pour que je puisse préparer un court échange avec Vincent "
           "Verbeke : pourriez-vous me communiquer votre adresse e-mail et votre "
           "numéro de téléphone ? Vous pouvez aussi réserver directement un "
           f"créneau de 15 minutes : {BOOKING_LINK}"),
    "it": ("È esattamente ciò che impostiamo per i clienti in Svizzera. Così "
           "posso preparare una breve call di presentazione con Vincent "
           "Verbeke: condividete la vostra e-mail e il vostro numero di "
           "telefono. Potete anche prenotare direttamente uno slot da 15 "
           f"minuti: {BOOKING_LINK}"),
}

#: Canned fallback per intent and visitor language — (turn0, turn1, final
#: chips). De/fr/it mirrors of the English copy in `_intent_signals`; served
#: ONLY when the LLM chain is down AND the visitor's locale is not English
#: (English keeps `_intent_signals` byte-for-byte, so its contract tests stay
#: authoritative). "it_bpa" is the landing-page-dependent default for
#: /automation/it-business-process-automation.
LOCALIZED_FALLBACK: dict[str, dict[str, tuple[
    tuple[list[str], str], tuple[list[str], str], list[str]
]]] = {
    "h2": {
        "de": (
            (["Test Day vor Ort", "Forschung & Demo", "Preise"],
             "Wir bieten dedizierte Unitree-H2-Humanoid Consulting- & Testtags "
             "direkt bei Ihnen in der Schweiz. Kurze Frage vorab: welche "
             "Anwendung haben Sie für den H2 im Sinn — ein Test-/Evaluierungstag "
             "vor Ort, Forschung oder ein konkreter Prozess in Ihrem Unternehmen?"),
            (["Evaluation / Pilot", "Konkreter Anwendungsfall", "Preise"],
             "Verstanden. Noch eine Frage, damit ich mich gut vorbereiten kann: "
             "Wie sieht Ihr heutiger Setup aus, und wann soll der H2 "
             "einsatzbereit sein?"),
            ["M365-Kalender buchen", "Technische Daten", "Preise"],
        ),
        "fr": (
            (["Test Day sur site", "Recherche & démo", "Prix"],
             "Nous organisons des Unitree H2 Humanoid Consulting & Test Days "
             "directement chez vous en Suisse. Une question d'abord : quelle "
             "application envisagez-vous pour le H2 — un jour d'essai/évaluation "
             "sur site, de la recherche ou un processus concret dans votre "
             "entreprise ?"),
            (["Évaluation / pilote", "Cas d'usage concret", "Prix"],
             "Compris. Encore une question pour bien me préparer : à quoi "
             "ressemble votre configuration actuelle, et quand le H2 doit-il "
             "être opérationnel ?"),
            ["Réserver via calendrier M365", "Fiches techniques", "Prix"],
        ),
        "it": (
            (["Test Day in sede", "Ricerca & demo", "Prezzi"],
             "Organizziamo Unitree H2 Humanoid Consulting & Test Day "
             "direttamente presso di voi in Svizzera. Prima una domanda: quale "
             "applicazione avete in mente per l'H2 — un giorno di test/valutazione "
             "in sede, ricerca o un processo concreto nella vostra azienda?"),
            (["Valutazione / pilot", "Caso d'uso concreto", "Prezzi"],
             "Capito. Ancora una domanda per prepararmi bene: com'è il vostro "
             "setup attuale, e quando l'H2 dovrebbe essere operativo?"),
            ["Prenota calendario M365", "Specifiche tecniche", "Prezzi"],
        ),
    },
    "marketing": {
        "de": (
            (["Setup zeigen", "Preise & Limits", "Welcher Kanal zuerst?"],
             "Unsere vollautomatische KI-gestützte Marketing- & Sales-Engine "
             "umfasst ICP-Recherche, personalisierte Multi-Channel-Outreach, "
             "automatische Lead-Qualifizierung und Terminbuchung — mit harten "
             "monatlichen Ausgabenlimits und Ihrer Freigabe. Welchen Kanal soll "
             "sie zuerst automatisieren?"),
            (["Outbound zuerst", "Reporting zuerst", "Preise & Limits"],
             "Verstanden. Noch eine Frage: Welches System soll sie zuerst "
             "anbinden (CRM/ERP, Outreach, Reporting), und wie viele "
             "qualifizierte Leads pro Monat streben Sie an?"),
            ["Discovery Call buchen", "Preise & Limits", "Setup zeigen"],
        ),
        "fr": (
            (["Voir le setup", "Prix & plafonds", "Quel canal d'abord ?"],
             "Notre moteur marketing & ventes entièrement piloté par IA couvre "
             "la recherche d'ICP, des démarches multi-canal personnalisées, la "
             "qualification autonome des leads et la prise de rendez-vous — avec "
             "des plafonds mensuels stricts et votre validation. Quel canal "
             "doit-il automatiser en premier ?"),
            (["Outbound d'abord", "Reporting d'abord", "Prix & plafonds"],
             "Compris. Encore une question : dans quel système doit-elle se "
             "connecter en premier (CRM/ERP, démarches, reporting), et environ "
             "combien de leads qualifiés par mois visez-vous ?"),
            ["Réserver un discovery call", "Prix & plafonds", "Voir le setup"],
        ),
        "it": (
            (["Mostra il setup", "Prezzi & limiti", "Quale canale per primo?"],
             "Il nostro motore marketing & vendite completamente automatizzato "
             "con IA include ricerca ICP, outreach multicanale personalizzato, "
             "qualificazione autonoma dei lead e prenotazione di appuntamenti — "
             "con limiti di spesa mensili rigidi e la tua approvazione. Quale "
             "canale deve automatizzare per primo?"),
            (["Outbound per primo", "Reporting per primo", "Prezzi & limiti"],
             "Capito. Ancora una domanda: a quale sistema deve collegarsi per "
             "primo (CRM/ERP, outreach, reporting), e circa quanti lead "
             "qualificati al mese puntate?"),
            ["Prenota una discovery call", "Prezzi & limiti", "Mostra il setup"],
        ),
    },
    "invoice": {
        "de": (
            (["500 – 2'000 / Monat", "2'000 – 10'000 / Monat",
              "Technischen Brief anfordern"],
             "Unsere multimodale LLM-Pipeline liest ein- und ausgehende "
             "Rechnungen mit über 98.5% Genauigkeit — auch zerknitterte Belege "
             "oder Scans mit niedriger Auflösung. Welches Volumen verarbeiten "
             "Sie pro Monat?"),
            (["Landet in unserem ERP", "E-Mail-Postfach", "Scan / Papier"],
             "Verstanden. Noch eine Frage: In welchem System sollen die "
             "extrahierten Daten landen, und wie kommen Rechnungen heute an — "
             "E-Mail, Scan oder Papier?"),
            ["Technischen Call buchen", "500 – 2'000 / Monat",
             "Technischen Brief anfordern"],
        ),
        "fr": (
            (["500 – 2'000 / mois", "2'000 – 10'000 / mois",
              "Demander la fiche technique"],
             "Notre pipeline LLM multimodale extrait les factures entrantes et "
             "sortantes avec plus de 98,5 % de précision — même depuis des "
             "documents froissés ou des scans de faible résolution. Quel volume "
             "traitez-vous par mois ?"),
            (["Atterrit dans notre ERP", "Boîte e-mail", "Scan / papier"],
             "Compris. Encore une question : dans quel système les données "
             "extraites doivent-elles atterrir, et comment les factures "
             "arrivent-elles aujourd'hui — e-mail, scan ou papier ?"),
            ["Planifier un call technique", "500 – 2'000 / mois",
             "Demander la fiche technique"],
        ),
        "it": (
            (["500 – 2.000 / mese", "2.000 – 10.000 / mese",
              "Richiedi report tecnico"],
             "La nostra pipeline LLM multimodale estrae le fatture in entrata e "
             "in uscita con precisione superiore al 98,5 % — anche da documenti "
             "piegati o scansioni a bassa risoluzione. Quale volume elaborate al "
             "mese?"),
            (["Finisce nel nostro ERP", "Posta e-mail", "Scansione / carta"],
             "Capito. Ancora una domanda: in quale sistema devono finire i dati "
             "estratti, e come arrivano oggi le fatture — e-mail, scansione o "
             "carta?"),
            ["Prenota call tecnico", "500 – 2.000 / mese",
             "Richiedi report tecnico"],
        ),
    },
    "arm": {
        "de": (
            (["CNC-Maschinenbeschickung", "Montagezelle", "Standort-Beurteilung"],
             "Wir bauen schlüsselfertige Roboterarm-Zellen und Cobots für "
             "Maschinenbeschickung und automatisierte Montage. Welche "
             "Teilemaße oder Zykluszeiten streben Sie an?"),
            (["Neue Installation", "Retrofit", "Standort-Beurteilung"],
             "Notiert. Noch eine Frage: Ist es eine neue Installation oder ein "
             "Retrofit einer bestehenden Zelle, und welchen Zeitrahmen planen "
             "Sie?"),
            ["Discovery Call buchen", "CNC-Maschinenbeschickung",
             "Standort-Beurteilung"],
        ),
        "fr": (
            (["Ajustement machine CNC", "Cellule d'assemblage",
              "Étude de faisabilité sur site"],
             "Nous concevons des cellules robotiques clés en main et des cobots "
             "pour le chaudronnage de machines et l'assemblage automatisé. "
             "Quelles dimensions de pièces ou quels temps de cycle visez-vous ?"),
            (["Nouvelle installation", "Rétrofit", "Étude de faisabilité sur site"],
             "Noté. Encore une question : s'agit-il d'une nouvelle installation "
             "ou du rétrofit d'une cellule existante, et quel calendrier "
             "prévoyez-vous ?"),
            ["Réserver un discovery call", "Ajustement machine CNC",
             "Étude de faisabilité sur site"],
        ),
        "it": (
            (["Carico macchine CNC", "Cella di assemblaggio",
              "Sopralluogo di fattibilità"],
             "Progettiamo celle robotiche chiavi in mano e cobot per il carico "
             "macchine e l'assemblaggio automatico. Quali dimensioni dei pezzi o "
             "tempi di ciclo mirate?"),
            (["Nuova installazione", "Retrofit", "Sopralluogo di fattibilità"],
             "Notato. Ancora una domanda: si tratta di una nuova installazione "
             "o del retrofit di una cella esistente, e quale tempistica state "
             "pianificando?"),
            ["Prenota una discovery call", "Carico macchine CNC",
             "Sopralluogo di fattibilità"],
        ),
    },
    "general": {
        "de": (
            (["Unitree H2 Testtag", "Marketing- & Sales-Engine", "Rechnungs-LLMs"],
             "Grüezi! Ich bin Ihr Kubotics Sales Engineer. Wir liefern Unitree "
             "humanoide Roboter, eigene Fabrikroboterarme, multimodale "
             "LLM-Geschäftsprozess-Automatisierungen und eine vollautomatische "
             "KI-gestützte Marketing- & Sales-Engine in der Schweiz. Was möchten "
             "Sie zuerst automatisieren oder lösen?"),
            (["Orientierung", "Projekt geplant", "Preise"], _T1_TEXT["de"]),
            ["M365-Discovery-Slot buchen", "Unitree H2 Testtag", "Rechnungs-LLMs"],
        ),
        "fr": (
            (["Test Day Unitree H2", "Moteur Marketing & Ventes", "LLM de factures"],
             "Grüezi ! Je suis votre Sales Engineer Kubotics. Nous livrons des "
             "robots humanoïdes Unitree, des bras robotisés industriels, des "
             "automatisations de processus métier par LLM multimodal et un "
             "moteur marketing & ventes entièrement automatisé par IA en Suisse. "
             "Que souhaitez-vous automatiser ou résoudre en premier ?"),
            (["Simple exploration", "Projet planifié", "Prix"], _T1_TEXT["fr"]),
            ["Réserver un créneau Discovery M365", "Test Day Unitree H2",
             "LLM de factures"],
        ),
        "it": (
            (["Test Day Unitree H2", "Motore Marketing & Vendite", "LLM fatture"],
             "Grüezi! Sono il vostro Kubotics Sales Engineer. Forniamo robot "
             "umanoidi Unitree, braccia robotiche industriali, automazioni di "
             "processi aziendali con LLM multimodale e un motore marketing & "
             "vendite completamente automatizzato con IA in Svizzera. Cosa "
             "volete automatizzare o risolvere per primo?"),
            (["Sto esplorando", "Progetto pianificato", "Prezzi"], _T1_TEXT["it"]),
            ["Prenota slot Discovery M365", "Test Day Unitree H2", "LLM fatture"],
        ),
    },
    # Landing-page-dependent default (Vincent 2026-11-23): on the IT &
    # business process automation page the default sentence is that page's
    # offer (free automation analysis, personal reply within 1 working day).
    "it_bpa": {
        "de": (
            (["Kostenlose Automatisierungsanalyse",
              "ERP-/CRM-Integration (SAP, Dynamics, Odoo)",
              "Rechnungsprüfung per LLM"],
             "Sie sind auf unserer Seite für IT- & Geschäftsprozess-"
             "Automatisierung. Welcher Ablauf kostet Ihr Team heute am meisten "
             "Zeit — manuelles Abtippen zwischen E-Mail, Excel und ERP oder "
             "unstrukturierte Belege? Beschreiben Sie ihn kurz, dann gebe ich "
             "Ihnen eine erste Einschätzung zu Machbarkeit, Aufwand und Nutzen."),
            (["SAP / Dynamics / Odoo", "Bestehende Prozesse", "Zeitrahmen"],
             _T1_TEXT["de"]),
            ["Kostenlose Automatisierungsanalyse", "Termin mit Vincent buchen",
             "Technische Details"],
        ),
        "en": (
            (["Free automation analysis",
              "ERP/CRM integration (SAP, Dynamics, Odoo)",
              "LLM invoice processing"],
             "You are on our IT & business process automation page. Which "
             "workflow costs your team the most time today — manual re-keying "
             "between email, Excel and ERP, or unstructured documents? Describe "
             "it briefly and I'll give you a first assessment of feasibility, "
             "effort and benefit — free of charge and personally within one "
             "working day."),
            (["SAP / Dynamics / Odoo", "Existing processes", "Timeline"],
             ("Thanks. One more question so I can point you to the right "
              "solution: what does your current setup look like, and what "
              "timeline are you aiming for?")),
            ["Free automation analysis", "Book a call with Vincent",
             "Technical details"],
        ),
        "fr": (
            (["Analyse d'automatisation gratuite",
              "Intégration ERP/CRM (SAP, Dynamics, Odoo)",
              "Traitement de factures par LLM"],
             "Vous êtes sur notre page d'automatisation IT & processus métier. "
             "Quel flux de travail fait perdre le plus de temps à votre équipe "
             "aujourd'hui — ressaisie manuelle entre e-mail, Excel et ERP ou "
             "documents non structurés ? Décrivez-le brièvement et je vous "
             "donnerai une première évaluation de faisabilité, d'effort et de "
             "bénéfice — gratuitement et personnellement sous 1 jour ouvrable."),
            (["SAP / Dynamics / Odoo", "Processus existants", "Calendrier"],
             _T1_TEXT["fr"]),
            ["Analyse d'automatisation gratuite", "Réserver un appel",
             "Détails techniques"],
        ),
        "it": (
            (["Analisi di automazione gratuita",
              "Integrazione ERP/CRM (SAP, Dynamics, Odoo)",
              "Elaborazione fatture con LLM"],
             "Siete sulla nostra pagina di automazione IT & processi aziendali. "
             "Quale flusso di lavoro fa perdere più tempo al vostro team oggi — "
             "reinserimento manuale tra e-mail, Excel ed ERP o documenti non "
             "strutturati? Descrivetelo brevemente e vi darò una prima "
             "valutazione di fattibilità, impegno e beneficio — gratuitamente e "
             "personalmente entro 1 giorno lavorativo."),
            (["SAP / Dynamics / Odoo", "Processi esistenti", "Tempistica"],
             _T1_TEXT["it"]),
            ["Analisi di automazione gratuita", "Prenota una call",
             "Dettagli tecnici"],
        ),
    },
}


def _localized_signals(
    payload: ChatMessagePayload, turn_count: int
) -> tuple[list[str], str] | None:
    """Fallback (quick replies + text) in the visitor's language.

    Returns None for English locales so `_intent_signals` serves the original
    copy untouched — except on the IT-BPA landing page, where the English
    default sentence must also be that page's offer (its own copy lives in
    LOCALIZED_FALLBACK["it_bpa"]["en"]). Stage mirrors the 2026-11-23
    qualifying workflow: turn 0, turn 1, then the closing turn (email +
    phone + meeting proposal).
    """
    ctx = payload.extracted_context or {}
    lang = _visitor_lang(ctx)
    intent = _localized_intent(payload.message.lower(), ctx)
    if lang == "en" and intent != "it_bpa":
        return None
    copy = LOCALIZED_FALLBACK[intent][lang]
    if turn_count >= QUALIFYING_TURNS:
        return copy[2], _CLOSING_TEXT[lang]
    stage = 1 if turn_count >= 1 else 0
    chips, text = copy[stage]
    return chips, text


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
    # Visitor messages BEFORE this one -> qualification stage (Vincent
    # 2026-11-23: no meeting ask in the first QUALIFYING_TURNS turns).
    turn_count = sum(
        1 for turn in (payload.history or []) if turn.get("role") == "user"
    )
    quick_replies, meeting_link, qualified, fallback_reply = _intent_signals(
        payload.message.lower(), turn_count
    )
    # Language- and landing-page-aware canned copy for non-English visitors
    # (Vincent 2026-11-23). English keeps the original `_intent_signals`
    # output byte-for-byte; structured signals (booking link, qualification)
    # always stay those of `_intent_signals`.
    localized = _localized_signals(payload, turn_count)
    if localized is not None:
        quick_replies, fallback_reply = localized
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
