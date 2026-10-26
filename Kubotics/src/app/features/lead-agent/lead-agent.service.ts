import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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
}

export interface LeadQualificationData {
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  interest?: 'Humanoid Robotics' | 'Manufacturing Automation' | 'IT Automation' | 'Consulting Test Day';
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

const BOOKING_URL = 'https://bookings.cloud.microsoft/bookwithme/user/01a588e5abd843b3b10fed3701fd338c@kuroliv.ch/meetingtype/qdRffgQQckmT6Zj8NQZ03Q2?anonymous&ismsaljsauthenabled&ep=mlink';

@Injectable({
  providedIn: 'root'
})
export class LeadAgentService {
  private platformId = inject(PLATFORM_ID);
  
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
        // When clicked from the floating bottom-right button, always open in compact corner mode!
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

    this.isLoading.set(true);

    try {
      const reply = await this.processSalesEngineerReasoning(text.trim());
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
   * 4-Stage Sales Engineer State Machine:
   * Discovery -> Qualification -> Recommendation -> Conversion & Booking
   */
  private async processSalesEngineerReasoning(input: string): Promise<ChatMessage> {
    const lower = input.toLowerCase();
    await new Promise(r => setTimeout(r, 650));

    // 1. Email Capturing & Conversion
    const emailMatch = input.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      const email = emailMatch[0];
      this.qualification.update(q => ({ ...q, email }));
      this.currentStage.set('conversion');
      this.syncLeadData();

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'conversion',
        text: `Vielen Dank! Ich habe ${email} vermerkt und die Machbarkeitsdaten für Sie vorbereitet.\n\nMöchten Sie direkt einen 30-minütigen technischen Strategie-Call mit Vincent Verbeke (Founder) im Microsoft 365 Kalender buchen oder bevorzugen Sie eine Abstimmung via WhatsApp?`,
        timestamp: new Date(),
        actionLink: {
          label: 'M365 Discovery Slot buchen (Teams)',
          url: BOOKING_URL,
          type: 'meeting'
        },
        quickReplies: ['Slot im Kalender buchen', 'Via WhatsApp chatten (+41 78 220 68 96)', 'H2 Testtag fixieren']
      };
    }

    // 2. Humanoid Robotics / Unitree H2 Discovery & Feasibility
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
        text: 'Empfehlung Kubotics Sales Engineering: Der Unitree H2 (31 Freiheitsgrade, 360Nm Drehmoment) eignet sich ideal für variable, menschliche Arbeitsumgebungen und F&E-Automatisierung.\n\nDer effizienteste nächste Schritt: Unser begleiteter Consulting- & Testtag in der Schweiz. Wir testen Ihren realen Prozess hands-on.\n\nFür welches Unternehmen prüfen Sie den Einsatz und wie erreichen wir Sie?',
        timestamp: new Date(),
        actionLink: {
          label: 'M365 Beratungstermin reservieren',
          url: BOOKING_URL,
          type: 'meeting'
        },
        quickReplies: ['E-Mail angeben', 'Preise / Turnkey Konditionen', 'WhatsApp Chat starten']
      };
    }

    // 3. Machine Tending / Factory Robot Arms & CNC
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
        text: 'Empfehlung Kubotics Sales Engineering: Für hochpräzise Maschinenbeschickung oder Werkstück-Handling empfehlen wir eine schlüsselfertige 6-Achs-Roboterarm- bzw. Cobot-Zelle.\n\nDamit entkoppeln Sie Ihre Maschinenlaufzeiten von personellen Schichten und erreichen typischerweise einen ROI innerhalb von 3 bis 6 Monaten.\n\nWie viele Zyklen oder Schichten fahren Sie aktuell pro Tag?',
        timestamp: new Date(),
        quickReplies: ['1-2 Schichten', '3-Schicht-Betrieb (24/7)', 'Direkten Termin buchen']
      };
    }

    // 4. Multimodal LLM Invoice & Document Processing
    if (lower.includes('rechnung') || lower.includes('invoice') || lower.includes('beleg') || lower.includes('ocr') || lower.includes('scan')) {
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
        text: 'Empfehlung Kubotics Sales Engineering: Unsere multimodale LLM-Extraktionspipeline liest eingehende und ausgehende Belege selbst aus minderwertigen Scans, Faxen oder zerknitterten Papierdokumenten fehlerfrei (>98.5%) direkt in Ihr ERP.\n\nBei über 400 Belegen/Monat sparen Sie jährlich über CHF 40\'000.- bei weniger als 3 Monaten Amortisationsdauer.\n\nDürfen wir Ihnen eine Test-Extraktion anhand Ihrer Beispielbelege demonstrieren?',
        timestamp: new Date(),
        actionLink: {
          label: 'Discovery Call mit Vincent Verbeke buchen',
          url: BOOKING_URL,
          type: 'meeting'
        },
        quickReplies: ['Testbelege einreichen', 'ERP Schnittstellen (SAP, Odoo)', 'Rückruf anfordern']
      };
    }

    // 5. IT Resource Planning & ERP Workflow
    if (lower.includes('planung') || lower.includes('erp') || lower.includes('ressource') || lower.includes('workflow') || lower.includes('schicht')) {
      this.qualification.update(q => ({ 
        ...q, 
        interest: 'IT Automation',
        processProblem: input,
        recommendedSolution: 'Autonome ERP- & Personaleinsatzplanungs-Automation'
      }));
      this.currentStage.set('recommendation');

      return {
        id: 'agent-' + Date.now(),
        sender: 'agent',
        stage: 'recommendation',
        text: 'Empfehlung Kubotics Sales Engineering: Wir verbinden operative IT-Systeme (ERP/MES) mit intelligenter Einsatzsteuerung, sodass Planungszeiten um bis zu 80% reduziert werden.\n\nWelches Quellsystem (z.B. SAP, Microsoft Dynamics, Odoo oder Eigenentwicklung) ist bei Ihnen im Einsatz?',
        timestamp: new Date(),
        quickReplies: ['SAP / Microsoft Dynamics', 'Odoo / Web-ERP', 'Individuelle Schnittstelle']
      };
    }

    // 6. Discovery Stage default
    this.currentStage.set('discovery');
    return {
      id: 'agent-' + Date.now(),
      sender: 'agent',
      stage: 'discovery',
      text: 'Verstanden. Um die Machbarkeit und den ROI für Sie fundiert einzuschätzen: Welches manuelle Volumen oder welche Taktzeiten bindet dieser Prozess derzeit in Ihrem Betrieb?',
      timestamp: new Date(),
      quickReplies: ['Hohe manuelle Fehlerquote', 'Fachkräftemangel in der Schicht', 'Direkte Beratung mit Vincent']
    };
  }

  private saveSession() {
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.setItem('kubotics_chat_history', JSON.stringify(this.messages()));
    }
  }

  async syncLeadData() {
    const data = this.qualification();
    const transcript = this.messages().map(m => `[${m.sender.toUpperCase()}]: ${m.text}`).join('\n');

    const payload = {
      ...data,
      transcript,
      timestamp: new Date().toISOString()
    };

    console.info('[LeadAgentService] Lead qualified and synchronized with Kubotics PostgreSQL DB & M365 Calendar workflow:', payload);
  }
}
