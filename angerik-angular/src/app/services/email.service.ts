import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface EmailData {
  to: string[];
  subject: string;
  body_text: string;
}

@Injectable({
  providedIn: 'root'
})
export class EmailService {
  private apiUrl = 'https://api.akuris.ch/mail/send-email';

  constructor(private http: HttpClient) { }

  sendEmail(data: EmailData): Observable<any> {
    return this.http.post(this.apiUrl, data);
  }
}
