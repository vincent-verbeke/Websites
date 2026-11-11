import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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
  private readonly baseUrl = 'https://api.kubotics.ch/api/v1';

  submitLead(payload: InboundLeadPayload): Observable<LeadApiResponse> {
    return this.http.post<LeadApiResponse>(`${this.baseUrl}/leads`, payload);
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
