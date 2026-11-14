import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { timeout } from 'rxjs';
import {
  KuboticsApiService,
  ChatTurn,
  WebChatResponse
} from '../../core/services/kubotics-api.service';

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

@Injectable({
  providedIn: 'root'
})
export class LeadAgentService {
  private platformId = inject(PLATFORM_ID);
  private api = inject(KuboticsApiService);
  
  isOpen = signal<boolean>(false);
  isExpandedModal = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  currentStage = signal<'discovery' | 'qualification' | 'recommendation' | 'conversion'>('discovery');
  messages = signal<ChatMessage[]>([]);
  qualification = signal<LeadQualificationData>({});

  constructor() {
    this.initSession();
  }

  private initSession() {
    const welcomeMessage: ChatMessage = {
      id: 'welcome-1',
      sender: 'agent',
      stage: 'discovery',
      text: 'Grüezi! Ich bin Ihr technischer Kubotics Sales Engineer. Beschreiben Sie mir kurz Ihren konkreten Prozess oder Flaschenhals:\n\nWelche Aufgabe möchten Sie automatisieren — z.B. Maschinenbeschickung, Belegverarbeitung oder Einsatz eines humanoiden Roboters?',
      timestamp: new Date(),
      quickReplies: [
        'Maschinenbeschickung CNC',
        'Unitree H2 Testtag',
        'Rechnungsprüfung LLM',
        'KI-Marketing & Sales Automation',
        'Palettierung & Logistik'
      ]
    };

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
  private async processSalesEngineerReasoning(input: string): Promise<ChatMessage> {
    const lower = input.toLowerCase();
    await new Promise(r => setTimeout(r, 450));

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
      this.currentStage.set('recommendation');

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Empfehlung Kubotics Sales Engineering: Der Unitree H2 (31 Freiheitsgrade, 360Nm Drehmoment) eignet sich ideal für variable menschliche Arbeitsumgebungen und F&E-Automatisierung.\n\nDer nächste konkrete Schritt: Unser begleiteter Consulting- & Testtag in der Schweiz. Wir testen Ihren realen Prozess hands-on.\n\nMöchten Sie einen Termin vereinbaren oder weitere Spezifikationen prüfen?',
        timestamp: new Date(),
        quickReplies: ['Testtag-Termin buchen', 'Preise & Turnkey Konditionen', 'WhatsApp Chat starten']
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
      this.currentStage.set('recommendation');

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Empfehlung Kubotics Sales Engineering: Für hochpräzise Maschinenbeschickung empfehlen wir eine schlüsselfertige 6-Achs-Roboterarm- oder Cobot-Zelle.\n\nDamit entkoppeln Sie Ihre Maschinenlaufzeiten von personellen Schichten und erreichen typischerweise einen ROI innerhalb von 3 bis 6 Monaten.\n\nWie viele Zyklen oder Schichten fahren Sie aktuell pro Tag?',
        timestamp: new Date(),
        quickReplies: ['1-2 Schichten', '3-Schicht-Betrieb (24/7)', 'Beratungstermin mit Vincent']
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
      this.currentStage.set('recommendation');

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Empfehlung Kubotics Sales Engineering: Unsere multimodale LLM-Extraktionspipeline liest eingehende Belege selbst aus minderwertigen Scans oder zerknitterten Dokumenten fehlerfrei (>98.5%) direkt in Ihr ERP.\n\nBei über 400 Belegen/Monat sparen Sie jährlich über CHF 40\'000.- bei weniger als 3 Monaten Amortisation.\n\nMöchten Sie eine Test-Extraktion mit Ihren Musterbelegen durchführen oder einen Discovery Call vereinbaren?',
        timestamp: new Date(),
        quickReplies: ['Discovery Call buchen', 'ERP Schnittstellen (SAP, Odoo)', 'Testbelege einreichen']
      };
    }

    // ERP / Quellsystem Qualification Handlers
    if (lower.includes('sap') || lower.includes('dynamics') || lower.includes('odoo') || lower.includes('schnittstelle') || lower.includes('eigenentwicklung')) {
      this.qualification.update(q => ({ ...q, notes: (q.notes ? q.notes + '; ' : '') + `Quellsystem: ${input}` }));
      this.currentStage.set('recommendation');

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: `Ausgezeichnet. Wir integrieren standardmässig via REST/GraphQL API, SFTP oder direkten Datenbank-Connectoren in Ihr ${input}-System.\n\nGerne prüfen wir die Schnittstelle in einem kurzen 30-minütigen technischen Strategiegespräch mit Vincent Verbeke:`,
        timestamp: new Date(),
        quickReplies: ['Termin buchen', 'WhatsApp Direktkontakt', 'Weitere Fragen stellen']
      };
    }

    // Shift / Volume / Bottleneck Qualification Handlers
    if (lower.includes('schicht') || lower.includes('fehler') || lower.includes('personal') || lower.includes('mangel') || lower.includes('monat')) {
      this.qualification.update(q => ({ ...q, processProblem: (q.processProblem ? q.processProblem + '; ' : '') + input }));
      this.currentStage.set('recommendation');

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Genau hier greift unsere Schweizer Automationsmethodik: Wir entlasten Ihre Fachkräfte von repetitiver Taktarbeit und steigern die Produktivität planbar.\n\nSollen wir die Machbarkeit für Ihren Betrieb in einem unverbindlichen Beratungsgespräch prüfen?',
        timestamp: new Date(),
        quickReplies: ['Beratungstermin mit Vincent', 'Machbarkeitsbericht anfordern', 'WhatsApp starten']
      };
    }

    // Adaptive General Discovery (only when no specific intent detected yet)
    this.currentStage.set('discovery');
    return {
      id: 'agent-' + Date.now(),
      sender: 'agent',
      stage: 'discovery',
      text: 'Verstanden. Um die Machbarkeit und den passenden Lösungsansatz für Sie fundiert einzuschätzen:\n\nWelche Kernherausforderung steht bei Ihnen im Vordergrund?',
      timestamp: new Date(),
      quickReplies: ['CNC-Maschinenbeschickung', 'Unitree H2 Humanoid Testtag', 'Rechnungsverarbeitung LLM', 'Direkte Beratung mit Vincent']
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
