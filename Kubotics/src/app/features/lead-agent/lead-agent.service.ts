import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { timeout } from 'rxjs';
import {
  KuboticsApiService,
  ChatTurn,
  WebChatResponse
} from '../../core/services/kubotics-api.service';
import { AnalyticsService } from '../../core/services/analytics.service';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text: string;
  timestamp: Date;
  quickReplies?: string[];
  stage?: 'discovery' | 'qualification' | 'recommendation' | 'conversion';
  actionLink?: {
    label: string;
    url: string;
    type: 'meeting' | 'external' | 'phone';
  };
  showBookingForm?: boolean;
  bookingTopic?: string;
  isBooked?: boolean;
}

export interface LeadQualificationData {
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  interest?: 'Humanoid Robotics' | 'Manufacturing Automation' | 'IT Automation' | 'Consulting Test Day' | 'AI Marketing & Sales';
  processProblem?: string;
  estimatedVolume?: string;
  recommendedSolution?: string;
  timeline?: string;
  budgetOrScale?: string;
  notes?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  gclid?: string;
}

export const BOOKING_PAGE_URL = 'https://bookings.cloud.microsoft/book/KuboticsGet2Know@kuroliv.ch/?ismsaljsauthenabled';

/**
 * Vincent 2026-11-26 interaction workflow: the chat ALWAYS runs 3 to 5
 * steps asking deeper about the exact expectations of a potential customer
 * before any meeting ask. Turns 0-2 qualify (3 guaranteed), turns 3 and 4
 * ask one deeper question each; the closing message asks for email + phone
 * first, then proposes the meeting (booking form / booking link). An
 * explicit booking request never reaches the fallback (detectConversionIntent
 * serves the booking form first, at ANY stage).
 */
export const QUALIFYING_TURNS = 5;

/**
 * Earliest turn at which "email + phone already captured" may close the
 * fallback flow — the first 3 qualifying questions always happen.
 * (Backend: endpoints.py / agent_core MIN_EARLY_CLOSE_TURN.)
 */
export const MIN_EARLY_CLOSE_TURN = 3;

/**
 * Closing decision of the LLM-down fallback — the widget mirror of the
 * backend's `_should_close`: closes at QUALIFYING_TURNS, or from
 * MIN_EARLY_CLOSE_TURN on when both contact details are already known.
 * Booking intent is handled BEFORE this (detectConversionIntent).
 */
export function isClosingQualifyingTurn(
  turnIndex: number,
  contactComplete: boolean = false
): boolean {
  if (turnIndex >= QUALIFYING_TURNS) return true;
  return turnIndex >= MIN_EARLY_CLOSE_TURN && contactComplete;
}

/**
 * The chat's default (welcome) sentence is dependent on the landing page AND
 * in the visitor's language (Vincent 2026-11-23): "the default sentence and
 * reply should be dependent on the landing page ... always reply personal and
 * in the language of the user". Keyed page -> language; nl/unknown locales
 * fall back to en, the site default (de-CH) applies when nothing matches.
 * The page copy mirrors each landing page's own CTA/offer.
 */
type ChatLang = 'de' | 'en' | 'fr' | 'it';
interface WelcomeCopy { text: string; chips: string[]; }

export const WELCOME_COPY: Record<string, Record<ChatLang, WelcomeCopy>> = {
  // Homepage / unknown route — the original generic welcome.
  home: {
    de: {
      text: 'Grüezi! Ich bin Ihr technischer Kubotics Sales Engineer. Beschreiben Sie mir kurz Ihren konkreten Prozess oder Flaschenhals:\n\nWelche Aufgabe möchten Sie automatisieren — z.B. Maschinenbeschickung, Belegverarbeitung oder Einsatz eines humanoiden Roboters?',
      chips: [
        'Maschinenbeschickung CNC',
        'Unitree H2 Testtag',
        'Rechnungsprüfung LLM',
        'KI-Marketing & Sales Automation',
        'Palettierung & Logistik'
      ]
    },
    en: {
      text: "Hello! I'm your technical Kubotics Sales Engineer. Tell me briefly about your concrete process or bottleneck:\n\nWhich task would you like to automate — e.g. machine tending, invoice processing or deploying a humanoid robot?",
      chips: [
        'CNC machine tending',
        'Unitree H2 test day',
        'LLM invoice review',
        'AI marketing & sales automation',
        'Palletizing & logistics'
      ]
    },
    fr: {
      text: 'Grüezi ! Je suis votre Sales Engineer technique Kubotics. Décrivez-moi brièvement votre processus ou votre goulot d\u2019étranglement concret :\n\nQuelle tâche souhaitez-vous automatiser — p. ex. l\u2019alimentation de machines, le traitement de factures ou l\u2019utilisation d\u2019un robot humanoïde ?',
      chips: [
        'Alimentation machine CNC',
        'Test Day Unitree H2',
        'Révision de factures LLM',
        'Automatisation marketing & ventes IA',
        'Palettisation & logistique'
      ]
    },
    it: {
      text: 'Grüezi! Sono il vostro Sales Engineer tecnico Kubotics. Descrivetemi brevemente il vostro processo o collo di bottiglia concreto:\n\nQuale attività volete automatizzare — ad esempio il carico macchine, l\u2019elaborazione fatture o l\u2019uso di un robot umanoide?',
      chips: [
        'Carico macchine CNC',
        'Test Day Unitree H2',
        'Revisione fatture LLM',
        'Automazione marketing & vendite IA',
        'Pallettizzazione & logistica'
      ]
    }
  },
  // The landing page we focus on: IT & business process automation
  // (offer: free automation analysis, personal reply within 1 working day).
  'it-bpa': {
    de: {
      text: 'Grüezi! Sie sind auf unserer Seite zur IT- & Geschäftsprozess-Automatisierung — ich bin Ihr technischer Kubotics Sales Engineer.\n\nWelcher Ablauf kostet Ihr Team heute am meisten Zeit — manuelles Abtippen zwischen E-Mail, Excel und ERP, unstrukturierte Belege oder isolierte Excel-Listen? Beschreiben Sie ihn kurz, dann gebe ich Ihnen eine erste Einschätzung zu Machbarkeit, Aufwand und Nutzen.',
      chips: [
        'Kostenlose Automatisierungsanalyse',
        'ERP-/CRM-Integration (SAP, Dynamics, Odoo)',
        'Rechnungsprüfung per LLM'
      ]
    },
    en: {
      text: "Hello! You're on our IT & business process automation page — I'm your technical Kubotics Sales Engineer.\n\nWhich workflow costs your team the most time today — manual re-keying between email, Excel and ERP, unstructured documents, or isolated Excel sheets? Describe it briefly and I'll give you a first assessment of feasibility, effort and benefit.",
      chips: [
        'Free automation analysis',
        'ERP/CRM integration (SAP, Dynamics, Odoo)',
        'LLM invoice processing'
      ]
    },
    fr: {
      text: 'Grüezi ! Vous êtes sur notre page d\u2019automatisation IT & processus métier — je suis votre Sales Engineer technique Kubotics.\n\nQuel flux de travail fait perdre le plus de temps à votre équipe aujourd\u2019hui — ressaisie manuelle entre e-mail, Excel et ERP, documents non structurés ou feuilles Excel isolées ? Décrivez-le brièvement et je vous donnerai une première évaluation de faisabilité, d\u2019effort et de bénéfice.',
      chips: [
        'Analyse d\u2019automatisation gratuite',
        'Intégration ERP/CRM (SAP, Dynamics, Odoo)',
        'Traitement de factures par LLM'
      ]
    },
    it: {
      text: 'Grüezi! Siete sulla nostra pagina di automazione IT & processi aziendali — sono il vostro Sales Engineer tecnico Kubotics.\n\nQuale flusso di lavoro fa perdere più tempo al vostro team oggi — reinserimento manuale tra e-mail, Excel ed ERP, documenti non strutturati o fogli Excel isolati? Descrivetelo brevemente e vi darò una prima valutazione di fattibilità, impegno e beneficio.',
      chips: [
        'Analisi di automazione gratuita',
        'Integrazione ERP/CRM (SAP, Dynamics, Odoo)',
        'Elaborazione fatture con LLM'
      ]
    }
  },
  cnc: {
    de: {
      text: 'Grüezi! Sie interessieren sich für CNC-Maschinenbeschickung mit Robotern — ich bin Ihr technischer Kubotics Sales Engineer.\n\nFür welche Maschinen und Teile suchen Sie eine Automatisierung, und fahren Sie heute in Schichten oder möchten Sie 24/7-Gleitschichten ermöglichen?',
      chips: ['Kostenlose Potenzialanalyse', 'ROI unter 6 Monaten', 'Schichten & Taktzeiten']
    },
    en: {
      text: "Hello! You're interested in robotic CNC machine tending — I'm your technical Kubotics Sales Engineer.\n\nWhich machines and parts are you looking to automate, and are you running shifts today or aiming for 24/7 unattended operation?",
      chips: ['Free potential analysis', 'ROI under 6 months', 'Shift patterns & cycle times']
    },
    fr: {
      text: 'Grüezi ! Vous vous intéressez à l\u2019alimentation robotisée de machines à CN — je suis votre Sales Engineer technique Kubotics.\n\nPour quelles machines et pièces recherchez-vous une automatisation, et travaillez-vous actuellement par équipes ou visez-vous une production 24/7 ?',
      chips: ['Analyse de potentiel gratuite', 'ROI < 6 mois', 'Équipes & temps de cycle']
    },
    it: {
      text: 'Grüezi! Siete interessati al carico robotizzato di macchine CNC — sono il vostro Sales Engineer tecnico Kubotics.\n\nPer quali macchine e pezzi cercate un’automazione, e oggi lavorate a turni o puntate alla produzione 24/7?',
      chips: ['Analisi del potenziale gratuita', 'ROI sotto 6 mesi', 'Turni e tempi di ciclo']
    }
  },
  invoice: {
    de: {
      text: 'Grüezi! Sie interessieren sich für automatisierte Rechnungs- & Belegverarbeitung — ich bin Ihr technischer Kubotics Sales Engineer.\n\nWie viele Belege verarbeiten Sie pro Monat, und in welches System sollen sie direkt eingetragen werden (ERP, Buchhaltung)?',
      chips: ['Rechnungsvolumen nennen', 'Technische Details (>98.5%)', 'Testbelege einreichen']
    },
    en: {
      text: "Hello! You're interested in automated invoice & document processing — I'm your technical Kubotics Sales Engineer.\n\nHow many documents do you process per month, and which system should they land in directly (ERP, accounting)?",
      chips: ['Share monthly volume', 'Technical details (>98.5%)', 'Submit sample documents']
    },
    fr: {
      text: 'Grüezi ! Vous vous intéressez au traitement automatisé des factures & documents — je suis votre Sales Engineer technique Kubotics.\n\nCombien de documents traitez-vous par mois, et dans quel système doivent-ils atterrir directement (ERP, comptabilité) ?',
      chips: ['Indiquer le volume mensuel', 'Détails techniques (>98,5 %)', 'Envoyer des exemples']
    },
    it: {
      text: 'Grüezi! Siete interessati all’elaborazione automatizzata di fatture & documenti — sono il vostro Sales Engineer tecnico Kubotics.\n\nQuanti documenti elaborate al mese, e in quale sistema devono finire direttamente (ERP, contabilità)?',
      chips: ['Indica il volume mensile', 'Dettagli tecnici (>98,5%)', 'Invia documenti di prova']
    }
  },
  'ai-marketing': {
    de: {
      text: 'Grüezi! Sie interessieren sich für unsere KI-Marketing- & Sales-Automatisierung — ich bin Ihr technischer Kubotics Sales Engineer.\n\nWelchen Kanal soll die Engine zuerst übernehmen (LinkedIn, Google Ads, E-Mail, WhatsApp/Telegram), und welches Ziel verfolgen Sie: mehr Leads, schnellere Reaktion oder weniger manuelle Arbeit?',
      chips: ['Setup der Engine verstehen', 'Spend-Caps & Freigabe', 'Welcher Kanal zuerst?']
    },
    en: {
      text: "Hello! You're interested in our AI marketing & sales automation — I'm your technical Kubotics Sales Engineer.\n\nWhich channel should the engine take over first (LinkedIn, Google Ads, email, WhatsApp/Telegram), and what's your goal: more leads, faster response or less manual work?",
      chips: ['Understand the setup', 'Spend caps & approval', 'Which channel first?']
    },
    fr: {
      text: 'Grüezi ! Vous vous intéressez à notre automatisation marketing & ventes par IA — je suis votre Sales Engineer technique Kubotics.\n\nQuel canal la machine doit-elle prendre en charge en premier (LinkedIn, Google Ads, e-mail, WhatsApp/Telegram), et quel est votre objectif : plus de leads, une réponse plus rapide ou moins de travail manuel ?',
      chips: ['Comprendre le setup', 'Plafonds & validation', 'Quel canal d\u2019abord ?']
    },
    it: {
      text: 'Grüezi! Siete interessati alla nostra automazione marketing & vendite con IA — sono il vostro Sales Engineer tecnico Kubotics.\n\nQuale canale deve prendere in carico per primo (LinkedIn, Google Ads, e-mail, WhatsApp/Telegram), e qual è il vostro obiettivo: più lead, risposta più rapida o meno lavoro manuale?',
      chips: ['Capire il setup', 'Limiti di spesa & approvazione', 'Quale canale per primo?']
    }
  },
  h2: {
    de: {
      text: 'Grüezi! Sie interessieren sich für den Unitree H2 Humanoid Testtag — ich bin Ihr technischer Kubotics Sales Engineer.\n\nMöchten Sie den H2 in Ihrem Werk live erleben, und welcher konkrete Prozess oder welches F&E-Thema steht dahinter?',
      chips: ['Testtag im Werk erleben', 'Technische Daten H2', 'Konkreter Prozess / F&E-Thema']
    },
    en: {
      text: "Hello! You're interested in the Unitree H2 humanoid test day — I'm your technical Kubotics Sales Engineer.\n\nWould you like to experience the H2 live at your facility, and which concrete process or R&D topic is behind your interest?",
      chips: ['On-site test day interest', 'H2 technical specs', 'Concrete process / R&D topic']
    },
    fr: {
      text: 'Grüezi ! Vous vous intéressez au Test Day humanoïde Unitree H2 — je suis votre Sales Engineer technique Kubotics.\n\nSouhaitez-vous vivre l’expérience H2 dans votre usine, et quel processus concret ou sujet de R&D motive votre intérêt ?',
      chips: ['Test day sur site (intérêt)', 'Fiches techniques H2', 'Processus concret / R&D']
    },
    it: {
      text: 'Grüezi! Siete interessati all’Unitree H2 Humanoid Test Day — sono il vostro Sales Engineer tecnico Kubotics.\n\nVolete vivere l’H2 dal vivo presso la vostra sede, e quale processo concreto o tema R&D motiva il vostro interesse?',
      chips: ['Test day in sede (interesse)', 'Specifiche tecniche H2', 'Processo concreto / R&D']
    }
  },
  discovery: {
    de: {
      text: 'Grüezi! Sie suchen eine Automatisierungs-Discovery für Ihre Prozesse — ich bin Ihr technischer Kubotics Sales Engineer.\n\nWelcher Prozess steht im Fokus, und geht es eher um Machbarkeit, ROI-Zahlen oder den konkreten nächsten Schritt?',
      chips: ['Konzept & ROI-Kalkulation', 'Musterprozess prüfen', 'Welcher Prozess zuerst?']
    },
    en: {
      text: "Hello! You're looking for an automation discovery for your processes — I'm your technical Kubotics Sales Engineer.\n\nWhich process is in focus, and are you after feasibility, ROI figures or the concrete next step?",
      chips: ['Concept & ROI calculation', 'Review a sample process', 'Which process first?']
    },
    fr: {
      text: 'Grüezi ! Vous recherchez une phase de découverte d’automatisation pour vos processus — je suis votre Sales Engineer technique Kubotics.\n\nQuel processus est au centre, et cherchez-vous la faisabilité, des chiffres de ROI ou la prochaine étape concrète ?',
      chips: ['Concept & calcul du ROI', 'Examiner un processus type', 'Quel processus d\u2019abord ?']
    },
    it: {
      text: 'Grüezi! Cercate una fase di discovery dell’automazione per i vostri processi — sono il vostro Sales Engineer tecnico Kubotics.\n\nQuale processo è al centro, e cercate fattibilità, dati di ROI o il prossimo passo concreto?',
      chips: ['Concept & calcolo ROI', 'Esaminare un processo campione', 'Quale processo per primo?']
    }
  }
};

/** Map the current route to the landing-page key of WELCOME_COPY. */
export function welcomePageKey(pathname: string): string {
  const p = (pathname || '/').replace(/\/$/, '') || '/';
  if (p.startsWith('/automation/it-business-process-automation')) return 'it-bpa';
  if (p.startsWith('/automation/cnc-machine-tending')) return 'cnc';
  if (p.startsWith('/automation/invoice-processing')) return 'invoice';
  if (p.startsWith('/marketing/ai-marketing-sales')) return 'ai-marketing';
  if (p.startsWith('/robotics/unitree-h2-test-day')) return 'h2';
  if (p.startsWith('/automation/discovery')) return 'discovery';
  return 'home';
}

/** Visitor's chat language from the browser locale (kept identical to the
 * backend's `_visitor_lang` so welcome and replies never mix languages). */
export function visitorChatLang(navigatorLang: string | undefined): ChatLang {
  const nav = (navigatorLang || 'de-CH').toLowerCase();
  if (nav.startsWith('fr')) return 'fr';
  if (nav.startsWith('it')) return 'it';
  if (nav.startsWith('en') || nav.startsWith('nl')) return 'en';
  return 'de';
}

@Injectable({
  providedIn: 'root'
})
export class LeadAgentService {
  private platformId = inject(PLATFORM_ID);
  private api = inject(KuboticsApiService);
  private analytics = inject(AnalyticsService);
  
  isOpen = signal<boolean>(false);
  isExpandedModal = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  currentStage = signal<'discovery' | 'qualification' | 'recommendation' | 'conversion'>('discovery');
  messages = signal<ChatMessage[]>([]);
  qualification = signal<LeadQualificationData>({});

  constructor() {
    this.initSession();
  }

  /** The default/welcome sentence: dependent on the landing page the visitor
   * is on AND in their language (browser locale). */
  private welcomeForCurrentPage(): ChatMessage {
    const lang: ChatLang = isPlatformBrowser(this.platformId)
      ? visitorChatLang(navigator.language)
      : 'de';
    const page = isPlatformBrowser(this.platformId) ? window.location.pathname : '/';
    const copy = WELCOME_COPY[welcomePageKey(page)][lang];
    return {
      id: 'welcome-1',
      sender: 'agent',
      stage: 'discovery',
      text: copy.text,
      timestamp: new Date(),
      quickReplies: copy.chips
    };
  }

  private initSession() {
    const welcomeMessage = this.welcomeForCurrentPage();

    if (isPlatformBrowser(this.platformId)) {
      const params = new URLSearchParams(window.location.search);
      const utmSource = params.get('utm_source') || undefined;
      const utmMedium = params.get('utm_medium') || undefined;
      const utmCampaign = params.get('utm_campaign') || undefined;
      const gclid = params.get('gclid') || undefined;

      this.qualification.update(q => ({
        ...q,
        utmSource,
        utmMedium,
        utmCampaign,
        gclid
      }));

      const saved = sessionStorage.getItem('kubotics_chat_history');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          this.messages.set(parsed);
          return;
        } catch (e) {}
      }
    }

    this.messages.set([welcomeMessage]);
  }

  toggleChat() {
    this.isOpen.update(v => {
      const next = !v;
      if (next) {
        this.isExpandedModal.set(false);
      }
      return next;
    });
  }

  openChat(initialPrompt?: string, asModal: boolean = false) {
    this.isOpen.set(true);
    this.isExpandedModal.set(asModal);
    if (initialPrompt) {
      this.sendMessage(initialPrompt);
    }
  }

  toggleExpandedModal() {
    this.isExpandedModal.update(v => !v);
  }

  closeChat() {
    this.isOpen.set(false);
  }

  async sendMessage(text: string) {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: 'usr-' + Date.now(),
      sender: 'user',
      text: text.trim(),
      timestamp: new Date()
    };

    this.messages.update(list => [...list, userMsg]);
    this.saveSession();

    // Structured conversion intents (contact capture -> booking form) are
    // handled locally first: they drive UI state the LLM reply cannot.
    const conversion = this.detectConversionIntent(text.trim());
    if (conversion) {
      this.messages.update(list => [...list, conversion]);
      this.saveSession();
      return;
    }

    // Keep CRM interest tagging deterministic regardless of the LLM answer.
    this.trackInterestLocally(text.trim());

    this.isLoading.set(true);

    try {
      let reply: ChatMessage;
      try {
        // Primary path: backend LLM provider chain with conversation +
        // page context (the "LLM we use to chat", combined with context).
        reply = await this.askLlmAgent(text.trim());
      } catch (llmErr) {
        // Offline / timeout / backend down: canned state-machine fallback.
        console.warn('[LeadAgentService] LLM path failed, using local fallback:', llmErr);
        reply = await this.processSalesEngineerReasoning(text.trim());
      }
      this.messages.update(list => [...list, reply]);
      this.saveSession();
    } catch (err) {
      this.messages.update(list => [
        ...list,
        {
          id: 'sys-err',
          sender: 'system',
          text: 'Notice: Agent temporarily offline. Reach us directly at sales@kubotics.ch or via WhatsApp +41 78 220 68 96.',
          timestamp: new Date()
        }
      ]);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * One chat turn through the backend LLM (same provider chain the Kubot
   * mail/chat agent uses), carrying the rolling transcript + page/lead
   * context so answers are conversational and product-aware.
   */
  private async askLlmAgent(text: string): Promise<ChatMessage> {
    const res: WebChatResponse | undefined = await this.api.chatMessage({
      session_token: this.sessionToken(),
      message: text,
      history: this.buildHistory(),
      extracted_context: this.buildChatContext(text)
    }).pipe(timeout(35000)).toPromise();

    if (!res || !res.reply || !res.reply.trim()) {
      throw new Error('empty LLM reply');
    }

    if (res.lead_qualified) {
      this.currentStage.set('conversion');
    }

    return {
      id: 'agent-' + Date.now(),
      sender: 'agent',
      stage: this.currentStage(),
      text: res.reply.trim(),
      timestamp: new Date(),
      quickReplies: res.quick_replies && res.quick_replies.length > 0
        ? res.quick_replies
        : undefined,
      actionLink: res.meeting_link
        ? { label: 'Direkt Termin buchen (M365)', url: res.meeting_link, type: 'meeting' }
        : undefined
    };
  }

  /** Rolling transcript for the LLM: everything except the just-sent message. */
  private buildHistory(): ChatTurn[] {
    return this.messages()
      .filter(m => m.sender !== 'system')
      .slice(0, -1)
      .slice(-12)
      .map(m => ({ role: m.sender === 'user' ? 'user' as const : 'assistant' as const, content: m.text }));
  }

  /** Page path, topic, UTM and qualification summary sent as LLM context. */
  private buildChatContext(currentText: string): Record<string, string | number> {
    const q = this.qualification();
    const ctx: Record<string, string | number> = {};

    if (isPlatformBrowser(this.platformId)) {
      ctx['page'] = window.location.pathname;
      ctx['language'] = navigator.language || 'de-CH';
    }

    const topic = currentText.match(/^\[Thema:\s*([^\]]+)\]/);
    if (topic) {
      ctx['topic'] = topic[1].trim();
    }

    if (q.interest) ctx['interest'] = q.interest;
    if (q.company) ctx['company'] = q.company;
    if (q.processProblem) ctx['process_problem'] = q.processProblem.slice(0, 300);
    if (q.estimatedVolume) ctx['volume'] = q.estimatedVolume;
    if (q.utmSource) ctx['utm_source'] = q.utmSource;
    if (q.utmMedium) ctx['utm_medium'] = q.utmMedium;
    if (q.utmCampaign) ctx['utm_campaign'] = q.utmCampaign;

    return ctx;
  }

  private sessionTokenValue = '';

  private sessionToken(): string {
    if (!isPlatformBrowser(this.platformId)) return 'ssr';
    if (!this.sessionTokenValue) {
      this.sessionTokenValue =
        sessionStorage.getItem('kubotics_chat_session_token') ||
        'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('kubotics_chat_session_token', this.sessionTokenValue);
    }
    return this.sessionTokenValue;
  }

  /**
   * UI-critical conversion flows the LLM cannot trigger: capturing an email/
   * phone from a message, or an explicit booking request -> booking form.
   * Returns null when the message needs a normal (LLM) answer.
   */
  private detectConversionIntent(input: string): ChatMessage | null {
    const lower = input.toLowerCase();
    const emailMatch = input.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = input.match(/(\+?[0-9]{2,3}[ -]?[0-9]{2,3}[ -]?[0-9]{3}[ -]?[0-9]{2,4}|07[6-9][ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2})/);

    if (emailMatch || phoneMatch) {
      if (emailMatch) this.qualification.update(q => ({ ...q, email: emailMatch[0] }));
      if (phoneMatch) this.qualification.update(q => ({ ...q, phone: phoneMatch[0].trim() }));

      this.currentStage.set('conversion');
      this.syncLeadData();

      const topic = this.qualification().interest || 'Automations-Potenzialanalyse';
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'conversion',
        text: `Vielen Dank für Ihre Kontaktdaten! Ich habe Ihre Angaben erfasst.\n\nDamit wir Ihren Termin direkt und verbindlich in Vincents Kalender eintragen können, wählen Sie bitte Ihr Wunschdatum:`,
        timestamp: new Date(),
        showBookingForm: true,
        bookingTopic: topic,
        quickReplies: ['Direkt im Kalender buchen', 'Via WhatsApp abstimmen', 'Später anrufen']
      };
    }

    if (
      lower.includes('beratung') ||
      lower.includes('termin') ||
      lower.includes('vincent') ||
      lower.includes('call') ||
      lower.includes('buchen') ||
      lower.includes('meeting') ||
      lower.includes('gespräch') ||
      lower.includes('slot') ||
      lower.includes('discovery')
    ) {
      this.currentStage.set('conversion');
      const topic = this.qualification().recommendedSolution || this.qualification().interest || 'Discovery Call & Beratung';

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'conversion',
        text: `Sehr gerne! Für eine direkte Beratung mit Vincent Verbeke (Founder) erfassen wir nachfolgend kurz Ihre Kontaktdaten und Wunschzeit. Der Termin wird via Microsoft Teams direkt in Vincents Outlook-Kalender gebucht:`,
        timestamp: new Date(),
        showBookingForm: true,
        bookingTopic: topic,
        quickReplies: ['Via WhatsApp chatten (+41 78 220 68 96)', 'Frage zu Robotern stellen', 'Zurück']
      };
    }

    return null;
  }

  /** Deterministic CRM interest tagging, independent of the LLM reply. */
  private trackInterestLocally(input: string) {
    const lower = input.toLowerCase();
    if (/(marketing|sales|werbung|vertrieb|kampagne|campaign|lead\s?gen|outreach|linkedin|google ads)/.test(lower)) {
      this.qualification.update(q => ({
        ...q,
        interest: 'AI Marketing & Sales',
        processProblem: input,
        recommendedSolution: 'Fully Automated AI-Driven Marketing & Sales Engine'
      }));
      return;
    }
    if (/(h2|humanoid|testtag|unitree)/.test(lower)) {
      this.qualification.update(q => ({
        ...q,
        interest: 'Humanoid Robotics',
        processProblem: input,
        recommendedSolution: 'Unitree H2 Hands-On Test Day & Feasibility'
      }));
      return;
    }
    if (/(cnc|beschickung|\barm\b|cobot|tending|fabrik)/.test(lower)) {
      this.qualification.update(q => ({
        ...q,
        interest: 'Manufacturing Automation',
        processProblem: input,
        recommendedSolution: 'Turnkey Cobot / 6-Achs-Roboterzelle für Maschinenbeschickung'
      }));
      return;
    }
    if (/(rechnung|invoice|beleg|ocr|scan|dokument)/.test(lower)) {
      this.qualification.update(q => ({
        ...q,
        interest: 'IT Automation',
        processProblem: input,
        recommendedSolution: 'Multimodale LLM-Belegextraktion (>98.5% Genauigkeit)'
      }));
    }
  }

  /**
   * Adaptive Sales Engineer State Machine:
   * Recognizes booking requests, captured contacts, process qualifications, and intents.
   */
  /**
   * Closing workflow message (Vincent 2026-11-23): asks for the email
   * address + phone number FIRST, then proposes the meeting via the in-chat
   * calendar booking form (which collects both contact details).
   */
  private closingMeetingReply(): ChatMessage {
    this.currentStage.set('conversion');
    const topic = this.qualification().interest || 'Automations-Potenzialanalyse';
    return {
      id: 'agent-' + Date.now(),
      sender: 'agent',
      stage: 'conversion',
      text: 'Danke — das ist genau unser Feld. Zwei kurze Angaben, damit ich den Termin vorbereiten kann: Ihre E-Mail-Adresse und Ihre Telefonnummer.\n\nDanach wählen Sie direkt Ihr Wunschdatum im Kalender von Vincent Verbeke (Founder):',
      timestamp: new Date(),
      showBookingForm: true,
      bookingTopic: topic,
      quickReplies: ['Direkt im Kalender buchen', 'Via WhatsApp abstimmen', 'Frage stellen']
    };
  }

  /**
   * Deeper qualifying questions for fallback turns 1-4 (Vincent 2026-11-26:
   * "3 to 5 steps asking deeper about the exact expectations of a potential
   * customer"). Turn 0 keeps each intent branch's own question; turns 1-4
   * progress: current setup/process & volume -> success criteria & timeline
   * -> constraints/budget & decision process -> recap + confirm. ONE question
   * per message, never a meeting ask — mirrors the backend's
   * QUALIFYING_TEXTS (Swiss High German, the widget fallback copy is de).
   */
  private deeperQualifyingReply(turnIndex: number): ChatMessage {
    this.currentStage.set('qualification');
    const stage = Math.min(Math.max(turnIndex, 1), 4);
    const steps: Record<number, { text: string; chips: string[] }> = {
      1: {
        text: 'Danke. Wie sieht Ihr heutiger Setup aus — welches Volumen oder wie viele Vorgänge verarbeiten Sie aktuell pro Monat?',
        chips: ['Setup beschreiben', 'Volumen pro Monat', 'Timeline']
      },
      2: {
        text: 'Woran messen Sie den Erfolg — welches konkrete Ergebnis brauchen Sie, und bis wann soll die Lösung produktiv sein?',
        chips: ['Konkretes Ziel', 'Bis wann produktiv?', 'Erst mal orientieren']
      },
      3: {
        text: 'Gibt es Rahmenbedingungen, die ich berücksichtigen soll — ein Budgetrahmen, technische Vorgaben oder wer entscheidet mit?',
        chips: ['Budgetrahmen', 'Technische Vorgaben', 'Entscheidungsteam']
      },
      4: {
        text: 'Letzte Kontrolle: Habe ich Ihre Erwartungen — Ziel, heutiger Ablauf, Zeitrahmen und Rahmenbedingungen — richtig verstanden, oder soll ich noch etwas ergänzen?',
        chips: ['Ja, passt', 'Ergänzen', 'Weiter zur Empfehlung']
      }
    };
    const step = steps[stage];
    return {
      id: 'agent-' + Date.now(),
      sender: 'agent',
      stage: 'qualification',
      text: step.text,
      timestamp: new Date(),
      quickReplies: step.chips
    };
  }

  private async processSalesEngineerReasoning(input: string): Promise<ChatMessage> {
    const lower = input.toLowerCase();
    await new Promise(r => setTimeout(r, 450));

    // Visitor messages BEFORE this one (the current one is already appended)
    // -> qualification stage, identical rule to the backend's turn_count.
    // Vincent 2026-11-26: 3-5 qualifying steps before any meeting ask.
    const turnIndex = this.messages().filter(m => m.sender === 'user').length - 1;
    const closingPhase = isClosingQualifyingTurn(
      turnIndex,
      !!this.qualification().email && !!this.qualification().phone
    );

    // Detect direct contact details: Email and/or Phone
    const emailMatch = input.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = input.match(/(\+?[0-9]{2,3}[ -]?[0-9]{2,3}[ -]?[0-9]{3}[ -]?[0-9]{2,4}|07[6-9][ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2})/);

    if (emailMatch || phoneMatch) {
      if (emailMatch) this.qualification.update(q => ({ ...q, email: emailMatch[0] }));
      if (phoneMatch) this.qualification.update(q => ({ ...q, phone: phoneMatch[0].trim() }));

      this.currentStage.set('conversion');
      this.syncLeadData();

      const topic = this.qualification().interest || 'Automations-Potenzialanalyse';
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'conversion',
        text: `Vielen Dank für Ihre Kontaktdaten! Ich habe Ihre Angaben erfasst.\n\nDamit wir Ihren Termin direkt und verbindlich in Vincents Kalender eintragen können, wählen Sie bitte Ihr Wunschdatum:`,
        timestamp: new Date(),
        showBookingForm: true,
        bookingTopic: topic,
        quickReplies: ['Direkt im Kalender buchen', 'Via WhatsApp abstimmen', 'Später anrufen']
      };
    }

    // Direct booking/consultation request intent
    if (
      lower.includes('beratung') || 
      lower.includes('termin') || 
      lower.includes('vincent') || 
      lower.includes('call') || 
      lower.includes('buchen') ||
      lower.includes('meeting') ||
      lower.includes('gespräch') ||
      lower.includes('slot') ||
      lower.includes('discovery')
    ) {
      this.currentStage.set('conversion');
      const topic = this.qualification().recommendedSolution || this.qualification().interest || 'Discovery Call & Beratung';

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'conversion',
        text: `Sehr gerne! Für eine direkte Beratung mit Vincent Verbeke (Founder) erfassen wir nachfolgend kurz Ihre Kontaktdaten und Wunschzeit. Der Termin wird via Microsoft Teams direkt in Vincents Outlook-Kalender gebucht:`,
        timestamp: new Date(),
        showBookingForm: true,
        bookingTopic: topic,
        quickReplies: ['Via WhatsApp chatten (+41 78 220 68 96)', 'Frage zu Robotern stellen', 'Zurück']
      };
    }

    // Humanoid Robotics / Unitree H2 Discovery & Feasibility
    if (lower.includes('h2') || lower.includes('humanoid') || lower.includes('testtag') || lower.includes('unitree')) {
      this.qualification.update(q => ({ 
        ...q, 
        interest: 'Humanoid Robotics', 
        processProblem: input,
        recommendedSolution: 'Unitree H2 Hands-On Test Day & Feasibility'
      }));
      // Closing turn (Vincent 2026-11-26): contact details first, then the
      // meeting — never before 3 qualifying steps; turns 1-4 dig deeper.
      if (closingPhase) return this.closingMeetingReply();
      if (turnIndex > 0) return this.deeperQualifyingReply(turnIndex);

      this.currentStage.set('recommendation');
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Der Unitree H2 (31 Freiheitsgrade, 360Nm Drehmoment) eignet sich ideal für variable menschliche Arbeitsumgebungen und F&E-Automatisierung.\n\nWelche konkrete Anwendung möchten Sie mit dem H2 prüfen — Testtag vor Ort, Forschung oder ein Prozess in Ihrem Betrieb?',
        timestamp: new Date(),
        quickReplies: ['Testtag vor Ort', 'F&E / Forschung', 'Technische Daten H2']
      };
    }

    // Machine Tending / Factory Robot Arms & CNC
    if (lower.includes('cnc') || lower.includes('beschickung') || lower.includes('arm') || lower.includes('cobot') || lower.includes('tending') || lower.includes('fabrik')) {
      this.qualification.update(q => ({ 
        ...q, 
        interest: 'Manufacturing Automation',
        processProblem: input,
        recommendedSolution: 'Turnkey Cobot / 6-Achs-Roboterzelle für Maschinenbeschickung'
      }));
      // Closing turn (Vincent 2026-11-26): contact details first, then the
      // meeting — never before 3 qualifying steps; turns 1-4 dig deeper.
      if (closingPhase) return this.closingMeetingReply();
      if (turnIndex > 0) return this.deeperQualifyingReply(turnIndex);

      this.currentStage.set('recommendation');
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Empfehlung Kubotics Sales Engineering: Für hochpräzise Maschinenbeschickung empfehlen wir eine schlüsselfertige 6-Achs-Roboterarm- oder Cobot-Zelle.\n\nDamit entkoppeln Sie Ihre Maschinenlaufzeiten von personellen Schichten und erreichen typischerweise einen ROI innerhalb von 3 bis 6 Monaten.\n\nWie viele Zyklen oder Schichten fahren Sie aktuell pro Tag?',
        timestamp: new Date(),
        quickReplies: ['1-2 Schichten', '3-Schicht-Betrieb (24/7)', 'Neue Zelle / Retrofit']
      };
    }

    // Multimodal LLM Invoice & Document Processing
    if (lower.includes('rechnung') || lower.includes('invoice') || lower.includes('beleg') || lower.includes('ocr') || lower.includes('scan') || lower.includes('dokument')) {
      this.qualification.update(q => ({ 
        ...q, 
        interest: 'IT Automation',
        processProblem: input,
        recommendedSolution: 'Multimodale LLM-Belegextraktion (>98.5% Genauigkeit)'
      }));
      // Closing turn (Vincent 2026-11-26): contact details first, then the
      // meeting — never before 3 qualifying steps; turns 1-4 dig deeper.
      if (closingPhase) return this.closingMeetingReply();
      if (turnIndex > 0) return this.deeperQualifyingReply(turnIndex);

      this.currentStage.set('recommendation');
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Empfehlung Kubotics Sales Engineering: Unsere multimodale LLM-Extraktionspipeline liest eingehende Belege selbst aus minderwertigen Scans oder zerknitterten Dokumenten fehlerfrei (>98.5%) direkt in Ihr ERP.\n\nBei über 400 Belegen/Monat sparen Sie jährlich über CHF 35\'000.- bei weniger als 3 Monaten Amortisation.\n\nMöchten Sie eine Test-Extraktion mit Ihren Musterbelegen durchführen — und in welches System sollen die extrahierten Daten?',
        timestamp: new Date(),
        quickReplies: ['Testbelege einreichen', 'ERP Schnittstellen (SAP, Odoo)', 'Volumen pro Monat']
      };
    }

    // ERP / Quellsystem Qualification Handlers
    if (lower.includes('sap') || lower.includes('dynamics') || lower.includes('odoo') || lower.includes('schnittstelle') || lower.includes('eigenentwicklung')) {
      this.qualification.update(q => ({ ...q, notes: (q.notes ? q.notes + '; ' : '') + `Quellsystem: ${input}` }));
      // Closing turn (Vincent 2026-11-26): contact details first, then the
      // meeting — never before 3 qualifying steps; turns 1-4 dig deeper.
      if (closingPhase) return this.closingMeetingReply();
      if (turnIndex > 0) return this.deeperQualifyingReply(turnIndex);

      this.currentStage.set('recommendation');
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: `Ausgezeichnet. Wir integrieren standardmässig via REST/GraphQL API, SFTP oder direkten Datenbank-Connectoren in Ihr ${input}-System.\n\nWelche Daten sollen synchronisiert werden — und wie oft (Nachtlauf oder Echtzeit)?`,
        timestamp: new Date(),
        quickReplies: ['Echtzeit-Sync', 'Nachtlauf / Batch', 'Weitere Fragen stellen']
      };
    }

    // Shift / Volume / Bottleneck Qualification Handlers
    if (lower.includes('schicht') || lower.includes('fehler') || lower.includes('personal') || lower.includes('mangel') || lower.includes('monat')) {
      this.qualification.update(q => ({ ...q, processProblem: (q.processProblem ? q.processProblem + '; ' : '') + input }));
      // Closing turn (Vincent 2026-11-26): contact details first, then the
      // meeting — never before 3 qualifying steps; turns 1-4 dig deeper.
      if (closingPhase) return this.closingMeetingReply();
      if (turnIndex > 0) return this.deeperQualifyingReply(turnIndex);

      this.currentStage.set('recommendation');
      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Genau hier greift unsere Schweizer Automationsmethodik: Wir entlasten Ihre Fachkräfte von repetitiver Taktarbeit und steigern die Produktivität planbar.\n\nFür welchen Prozess sollen wir die Machbarkeit zuerst prüfen?',
        timestamp: new Date(),
        quickReplies: ['Machbarkeitsbericht anfordern', 'Fertigung', 'Logistik & Intralogistik']
      };
    }

    // Adaptive General Discovery (only when no specific intent detected yet)
    if (closingPhase) return this.closingMeetingReply();
    if (turnIndex > 0) return this.deeperQualifyingReply(turnIndex);

    this.currentStage.set('discovery');
    return {
      id: 'agent-' + Date.now(),
      sender: 'agent',
      stage: 'discovery',
      text: 'Verstanden. Um die Machbarkeit und den passenden Lösungsansatz für Sie fundiert einzuschätzen:\n\nWelche Kernherausforderung steht bei Ihnen im Vordergrund?',
      timestamp: new Date(),
      quickReplies: ['CNC-Maschinenbeschickung', 'Unitree H2 Humanoid Testtag', 'Rechnungsverarbeitung LLM']
    };
  }

  async executeInChatBooking(data: { name: string; email: string; phone: string; company?: string; date: string; time: string; topic?: string }): Promise<{ success: boolean; message: string; joinUrl?: string }> {
    try {
      const startDateTime = new Date(`${data.date}T${data.time}:00`);
      const endDateTime = new Date(startDateTime.getTime() + 30 * 60000); // 30 mins

      // 1. Ingest Lead into PostgreSQL RDS
      await this.api.submitLead({
        first_name: data.name.split(' ')[0],
        last_name: data.name.split(' ').slice(1).join(' ') || undefined,
        email: data.email,
        phone: data.phone,
        company_name: data.company,
        primary_interest: data.topic || 'Discovery Call',
        project_description: `Booked via in-chat scheduler for ${data.date} ${data.time}`,
        utm_source: this.qualification().utmSource,
        utm_medium: this.qualification().utmMedium,
        utm_campaign: this.qualification().utmCampaign,
        gclid: this.qualification().gclid
      }).toPromise();

      // 2. Schedule M365 Teams Meeting on Vincent's Outlook Calendar
      const meetingRes = await this.api.scheduleMeeting({
        contact_name: data.name,
        contact_email: data.email,
        company_name: data.company,
        topic: data.topic || 'Kubotics Automation Discovery',
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        time_zone: 'Europe/Zurich'
      }).toPromise();

      // Update in-memory qualification
      this.qualification.update(q => ({
        ...q,
        fullName: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company
      }));

      // Trigger GA4 & Google Ads Conversion for Qualified Scheduled Meeting
      this.analytics.track('schedule_appointment', {
        event_category: 'Engagement',
        event_label: data.topic || 'Discovery Call',
        value: 250.0,
        currency: 'CHF'
      });
      if (typeof window !== 'undefined' && (window as any).gtag) {
        try {
          (window as any).gtag('event', 'schedule_appointment', {
            'event_category': 'Engagement',
            'event_label': data.topic || 'Discovery Call',
            'value': 250.0,
            'currency': 'CHF'
          });
          (window as any).gtag('event', 'ads_conversion_MEETING_SCHEDULED', {
            'value': 250.0,
            'currency': 'CHF'
          });
          console.info('[LeadAgentService] Conversion event schedule_appointment dispatched to GA4/Google Ads.');
        } catch (trackErr) {
          console.warn('[LeadAgentService] Conversion tracking dispatch ignored:', trackErr);
        }
      }

      return {
        success: true,
        message: 'Ihr Termin wurde erfolgreich in Vincents M365 Kalender gebucht. Die Einladung mit Microsoft Teams Link wurde an Ihre E-Mail gesendet.',
        joinUrl: meetingRes?.join_url
      };
    } catch (err: any) {
      console.error('[LeadAgentService] Booking error:', err);
      return {
        success: false,
        message: err?.error?.detail || 'Die Terminbuchung konnte nicht abgeschlossen werden. Bitte kontaktieren Sie uns direkt via WhatsApp (+41 78 220 68 96) oder E-Mail (sales@kubotics.ch).'
      };
    }
  }

  private saveSession() {
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.setItem('kubotics_chat_history', JSON.stringify(this.messages()));
    }
  }

  async syncLeadData() {
    const data = this.qualification();
    if (!data.email && !data.phone) return;

    try {
      await this.api.submitLead({
        first_name: data.fullName?.split(' ')[0] || undefined,
        last_name: data.fullName?.split(' ').slice(1).join(' ') || undefined,
        email: data.email || 'lead-capture@kubotics.ch',
        phone: data.phone,
        company_name: data.company,
        primary_interest: data.interest || 'Web Chat Inquiry',
        project_description: data.processProblem || 'Chat qualified prospect',
        utm_source: data.utmSource,
        utm_medium: data.utmMedium,
        utm_campaign: data.utmCampaign,
        gclid: data.gclid
      }).toPromise();
      console.info('[LeadAgentService] Synchronized lead to PostgreSQL RDS crm schema.');
    } catch (e) {
      console.warn('[LeadAgentService] Non-critical sync warning:', e);
    }
  }
}
