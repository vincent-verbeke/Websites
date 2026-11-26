import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AnalyticsService } from './analytics.service';

export interface InboundLeadPayload {
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  company_name?: string;
  industry?: string;
  primary_interest?: string;
  project_description?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  referrer_url?: string;
}

export interface LeadApiResponse {
  contact_id: string;
  company_id?: string;
  deal_id?: string;
  status: string;
  message: string;
}

export interface MeetingSchedulePayload {
  contact_name: string;
  contact_email: string;
  company_name?: string;
  topic: string;
  start_time: string; // ISO 8601
  end_time: string;   // ISO 8601
  time_zone?: string;
}

export interface MeetingScheduleResponse {
  status: string;
  message: string;
  join_url: string;
  event_id: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface WebChatMessagePayload {
  session_token: string;
  message: string;
  sender?: string;
  /** Page path, topic, UTM, qualification summary — sent as LLM context. */
  extracted_context?: Record<string, string | number>;
  /** Rolling conversation transcript so the LLM answers with full context. */
  history?: ChatTurn[];
}

export interface WebChatResponse {
  reply: string;
  session_token: string;
  intent?: string | null;
  quick_replies?: string[];
  meeting_link?: string | null;
  lead_qualified?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class KuboticsApiService {
  private http = inject(HttpClient);
  private analytics = inject(AnalyticsService);
  private readonly baseUrl = 'https://api.kubotics.ch/api/v1';

  submitLead(payload: InboundLeadPayload): Observable<LeadApiResponse> {
    // Attribution E2E fix (Vincent 2026-11-26, "when a lead lands on a page
    // it should work"): every lead-form caller (H2 rental form, home contact
    // section, ...) previously sent NO utm/gclid unless the component read
    // the URL itself — so paid traffic filled forms as unattributed leads.
    // Enrich once at the single choke point: URL params win only when the
    // caller did not set the field; referrer fills when absent. SSR-safe.
    const lead: InboundLeadPayload = { ...payload };
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      lead.utm_source = lead.utm_source || p.get('utm_source') || undefined;
      lead.utm_medium = lead.utm_medium || p.get('utm_medium') || undefined;
      lead.utm_campaign = lead.utm_campaign || p.get('utm_campaign') || undefined;
      lead.utm_content = lead.utm_content || p.get('utm_content') || undefined;
      lead.utm_term = lead.utm_term || p.get('utm_term') || undefined;
      lead.gclid = lead.gclid || p.get('gclid') || undefined;
      lead.referrer_url = lead.referrer_url || document.referrer || undefined;
    }
    return this.http.post<LeadApiResponse>(`${this.baseUrl}/leads`, lead).pipe(
      tap(() => {
        this.analytics.track('generate_lead', {
          event_category: 'Lead Generation',
          event_label: payload.primary_interest || 'Inbound Lead',
          value: 100.0,
          currency: 'CHF'
        });
        if (typeof window !== 'undefined' && (window as any).gtag) {
          try {
            (window as any).gtag('event', 'qualify_lead', {
              'event_category': 'Lead Generation',
              'event_label': payload.primary_interest || 'Inbound Lead',
              'value': 100.0,
              'currency': 'CHF'
            });
            (window as any).gtag('event', 'ads_conversion_SUBMIT_LEAD_FORM_1', {
              'value': 100.0,
              'currency': 'CHF'
            });
          } catch (e) {
            console.warn('[KuboticsApi] Tracking dispatch warning:', e);
          }
        }
        // Google Ads "Submit lead form" conversion (event snippet, e-mail
        // 2026-11-20 18:45) — fires once per successful lead submission.
        this.analytics.trackAdsConversion();
        // Meta pixel "Lead" standard event (Meta conversion target).
        this.analytics.trackMetaEvent('Lead');
      })
    );
  }

  scheduleMeeting(payload: MeetingSchedulePayload): Observable<MeetingScheduleResponse> {
    return this.http.post<MeetingScheduleResponse>(`${this.baseUrl}/meetings/schedule`, payload);
  }

  /**
   * Website CTA chat — answered by the backend's LLM provider chain
   * (same chain the Kubot mail/chat agent uses) with conversation history
   * and page context attached as context.
   */
  chatMessage(payload: WebChatMessagePayload): Observable<WebChatResponse> {
    return this.http.post<WebChatResponse>(`${this.baseUrl}/chat/message`, payload);
  }
}
