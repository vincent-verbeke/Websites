import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../core/services/seo';
import { LeadAgentService } from '../../features/lead-agent/lead-agent.service';
import { ChannelLinkService } from '../../core/services/channel-link.service';
import { KuboticsApiService } from '../../core/services/kubotics-api.service';

@Component({
  selector: 'app-unitree-h2-landing',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="landing-page">
      <div class="container top-nav-bar">
        <a routerLink="/" class="back-link">
          <span class="material-icons">arrow_back</span>
          <span>Zurück zur Übersicht</span>
        </a>
      </div>

      <section class="landing-hero">
        <div class="container hero-inner">
          <div class="badge-tag">OFFIZIELLER UNITREE SPEZIALIST SCHWEIZ</div>
          <h1 class="landing-title">Unitree H2 Humanoid Consulting & Testtag</h1>
          <p class="landing-subtitle">
            Erleben und evaluieren Sie die humanoide Flaggschiff-Plattform Unitree H2 
            (1.8m, 31 Freiheitsgrade, 360Nm Drehmoment) direkt vor Ort in der Schweiz. 
            Wir testen Ihre realen Fertigungs- und Manipulationsaufgaben hands-on vor einer Investition.
          </p>

          <!-- Direct Intake CTA -->
          <div class="direct-cta-card glass-panel">
            <div class="intake-header">
              <span class="live-dot"></span>
              <strong>DIREKTE MACHBARKEITS-ANFRAGE: UNITREE H2 TESTTAG</strong>
            </div>
            <p class="intake-desc">
              Welchen Anwendungsfall möchten Sie mit dem H2 testen (z.B. Intralogistik, Greifoperationen, F&E)?
            </p>

            <form (submit)="onSubmitQuestion($event)" class="question-form">
              <div class="input-wrap">
                <input 
                  type="text" 
                  [(ngModel)]="directQuestion" 
                  name="h2Question" 
                  placeholder="z.B. Bauteiltransport zwischen Montageinseln, Teleoperation, Greifen von Schüttgut..." 
                  class="direct-input" />
                <button type="submit" class="btn-ask-cta">
                  <span>Machbarkeit prüfen</span>
                  <span class="material-icons">arrow_forward</span>
                </button>
              </div>
            </form>

            <div class="quick-prompts">
              <span>Häufige Testtag-Szenarien:</span>
              <button type="button" class="prompt-chip" (click)="askPreset('Hands-on Testtag in unserem Werk in der Schweiz buchen')">
                Testtag im Werk buchen
              </button>
              <button type="button" class="prompt-chip" (click)="askPreset('Teleoperation und VR-Steuerung für F&E-Labor')">
                Teleoperation & F&E
              </button>
              <button type="button" class="prompt-chip" (click)="askPreset('Lieferzeit, Turnkey-Inbetriebnahme und Schulung')">
                Lieferzeit & Konditionen
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Specifications & Booking Grid -->
      <section class="content-section">
        <div class="container">
          <div class="grid-2col">
            <div class="content-block">
              <h2>Was passiert an einem Unitree H2 Testtag?</h2>
              <ul class="benefit-list">
                <li>
                  <span class="material-icons check-icon">check_circle</span>
                  <div>
                    <strong>1. Analyse Ihrer Arbeitsumgebung:</strong>
                    Wir evaluieren Bodenbeschaffenheit, Raumgeometrie, Taktzeiten und menschliche Interaktionsschnittstellen.
                  </div>
                </li>
                <li>
                  <span class="material-icons check-icon">check_circle</span>
                  <div>
                    <strong>2. Live-Demonstration & Manipulation:</strong>
                    Der Unitree H2 führt konkrete Geh-, Hebe- und Greifaufgaben mit Ihren realen Werkstücken durch.
                  </div>
                </li>
                <li>
                  <span class="material-icons check-icon">check_circle</span>
                  <div>
                    <strong>3. Schnittstellen & Software-Architektur:</strong>
                    Einblick in die ROS2-Anbindung, Python/C++ SDKs und KI-Steuerungsalgorithmen für Ihre Entwickler.
                  </div>
                </li>
                <li>
                  <span class="material-icons check-icon">check_circle</span>
                  <div>
                    <strong>4. Verbindlicher Machbarkeits- und Wirtschaftlichkeitsbericht:</strong>
                    Sie erhalten eine fundierte Entscheidungsgrundlage mit klaren technischen und finanziellen KPIs.
                  </div>
                </li>
              </ul>
            </div>

            <div class="consultation-box glass-panel">
              <h3>Testtag unverbindlich anfragen</h3>
              <p>Wählen Sie Ihren Wunschzeitraum für eine Live-Demonstration:</p>

              <form (submit)="onConsultationSubmit(); $event.preventDefault()" class="lead-form">
                <div class="field">
                  <label>NAME *</label>
                  <input type="text" [(ngModel)]="leadName" name="name" required placeholder="Ihr Vor- und Nachname" />
                </div>

                <div class="field">
                  <label>GESCHÄFTLICHE E-MAIL *</label>
                  <input type="email" [(ngModel)]="leadEmail" name="email" required placeholder="name@unternehmen.ch" />
                </div>

                <div class="field">
                  <label>TELEFONNUMMER *</label>
                  <input type="tel" [(ngModel)]="leadPhone" name="phone" required placeholder="+41 79 123 45 67" />
                </div>

                <div class="field">
                  <label>UNTERNEHMEN / INSTITUT</label>
                  <input type="text" [(ngModel)]="leadCompany" name="company" placeholder="z.B. Tech-Firma AG, ETH / ZHAW Labor" />
                </div>

                <div class="field">
                  <label>WUNSCHZEITRAUM & ANFORDERUNGEN</label>
                  <textarea [(ngModel)]="leadDetails" name="details" rows="2" placeholder="Bevorzugte Kalenderwoche oder Testziele..."></textarea>
                </div>

                @if (submitStatus() === 'success') {
                  <div class="success-banner">
                    <span class="material-icons">task_alt</span>
                    <span>Vielen Dank! Ihre Anfrage wurde im CRM erfasst. Wir koordinieren den Termin persönlich.</span>
                  </div>
                }

                @if (submitStatus() === 'error') {
                  <div class="error-banner">
                    <span>Übermittlungsfehler. Bitte kontaktieren Sie uns direkt via WhatsApp.</span>
                  </div>
                }

                <button type="submit" class="btn-submit-lead" [disabled]="isSubmitting()">
                  @if (isSubmitting()) {
                    <span>Wird übermittelt...</span>
                  } @else {
                    <span>H2 Testtag anfragen</span>
                  }
                </button>
              </form>

              <div class="direct-contact-footer">
                <span>Direkter Draht zu unseren Robotik-Ingenieuren:</span>
                <div class="messenger-row">
                  <a [href]="channelLinks.getWhatsAppLink('h2_testday')" target="_blank" rel="noopener noreferrer" class="btn-msg wa">
                    💬 WhatsApp (+41 78 220 68 96)
                  </a>
                  <a [href]="channelLinks.getTelegramLink('h2_testday')" target="_blank" rel="noopener noreferrer" class="btn-msg tg">
                    🎙️ Telegram
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: `
    .landing-page {
      padding-top: 100px;
      padding-bottom: 120px;
      background: radial-gradient(circle at 50% 10%, rgba(0, 113, 227, 0.12) 0%, rgba(2, 2, 4, 1) 70%);
      color: #f5f5f7;
      min-height: 100vh;
    }

    .top-nav-bar { margin-bottom: 30px; }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #86868b;
      text-decoration: none;
      font-size: 0.9rem;
      transition: color 0.2s;
    }

    .back-link:hover { color: #0071e3; }

    .hero-inner {
      max-width: 960px;
      margin: 0 auto;
      text-align: center;
    }

    .badge-tag {
      font-size: 0.75rem;
      font-family: 'Space Mono', monospace;
      color: #0071e3;
      letter-spacing: 0.15em;
      margin-bottom: 16px;
    }

    .landing-title {
      font-size: 3.2rem;
      font-weight: 800;
      line-height: 1.15;
      margin-bottom: 20px;
      letter-spacing: -0.02em;
    }

    .landing-subtitle {
      font-size: 1.2rem;
      color: #86868b;
      line-height: 1.6;
      max-width: 780px;
      margin: 0 auto 40px auto;
    }

    .direct-cta-card {
      background: rgba(18, 18, 24, 0.75);
      border: 1px solid rgba(0, 113, 227, 0.35);
      border-radius: 20px;
      padding: 30px;
      text-align: left;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 113, 227, 0.15);
    }

    .intake-header {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.82rem;
      color: #0071e3;
      font-family: 'Space Mono', monospace;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }

    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #30d158;
      box-shadow: 0 0 8px #30d158;
    }

    .intake-desc {
      font-size: 0.95rem;
      color: #a1a1a6;
      margin: 0 0 20px 0;
    }

    .question-form .input-wrap {
      display: flex;
      gap: 12px;
    }

    .direct-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 14px 18px;
      color: #ffffff;
      font-size: 1rem;
      outline: none;
      transition: all 0.2s;
    }

    .direct-input:focus {
      border-color: #0071e3;
      background: rgba(255, 255, 255, 0.1);
      box-shadow: 0 0 20px rgba(0, 113, 227, 0.25);
    }

    .btn-ask-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #0071e3;
      color: #ffffff;
      border: none;
      border-radius: 12px;
      padding: 0 24px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }

    .btn-ask-cta:hover { background: #0077ed; }

    .quick-prompts {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
      font-size: 0.8rem;
      color: #86868b;
    }

    .prompt-chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #0071e3;
      border-radius: 12px;
      padding: 5px 12px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .prompt-chip:hover {
      background: rgba(0, 113, 227, 0.15);
      border-color: #0071e3;
    }

    .content-section { margin-top: 70px; }

    .grid-2col {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 40px;
      align-items: start;
    }

    @media (max-width: 900px) {
      .grid-2col { grid-template-columns: 1fr; }
      .question-form .input-wrap { flex-direction: column; }
      .landing-title { font-size: 2.4rem; }
    }

    .content-block h2 {
      font-size: 1.8rem;
      margin-bottom: 24px;
    }

    .benefit-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .benefit-list li {
      display: flex;
      gap: 14px;
      font-size: 1rem;
      line-height: 1.5;
      color: #a1a1a6;
    }

    .benefit-list li strong {
      color: #ffffff;
      display: block;
      margin-bottom: 2px;
    }

    .check-icon {
      color: #30d158;
      font-size: 22px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .consultation-box {
      background: rgba(18, 18, 24, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 30px;
    }

    .consultation-box h3 {
      font-size: 1.3rem;
      margin-top: 0;
      margin-bottom: 8px;
    }

    .consultation-box p {
      font-size: 0.9rem;
      color: #86868b;
      margin: 0 0 20px 0;
    }

    .lead-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field label {
      font-size: 0.68rem;
      font-family: 'Space Mono', monospace;
      color: #86868b;
      letter-spacing: 0.05em;
    }

    .field input, .field textarea {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 10px 14px;
      color: #ffffff;
      font-size: 0.9rem;
      outline: none;
    }

    .field input:focus, .field textarea:focus {
      border-color: #0071e3;
      background: rgba(255, 255, 255, 0.09);
    }

    .btn-submit-lead {
      background: #0071e3;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      padding: 13px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 4px;
    }

    .btn-submit-lead:hover:not(:disabled) { background: #0077ed; }
    .btn-submit-lead:disabled { opacity: 0.5; cursor: not-allowed; }

    .success-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(48, 209, 88, 0.15);
      border: 1px solid rgba(48, 209, 88, 0.3);
      color: #30d158;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
    }

    .error-banner {
      background: rgba(255, 69, 58, 0.15);
      border: 1px solid rgba(255, 69, 58, 0.3);
      color: #ff453a;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
    }

    .direct-contact-footer {
      margin-top: 24px;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      text-align: center;
    }

    .direct-contact-footer span {
      font-size: 0.78rem;
      color: #86868b;
      display: block;
      margin-bottom: 10px;
    }

    .messenger-row {
      display: flex;
      gap: 8px;
    }

    .btn-msg {
      flex: 1;
      padding: 8px 12px;
      font-size: 0.8rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 8px;
      text-align: center;
    }

    .btn-msg.wa {
      background: rgba(37, 211, 102, 0.15);
      color: #25d366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .btn-msg.tg {
      background: rgba(0, 136, 204, 0.15);
      color: #229ed9;
      border: 1px solid rgba(0, 136, 204, 0.3);
    }
  `
})
export class UnitreeH2LandingPageComponent implements OnInit {
  private seo = inject(SeoService);
  private agent = inject(LeadAgentService);
  private api = inject(KuboticsApiService);
  readonly channelLinks = inject(ChannelLinkService);

  directQuestion = '';
  leadName = '';
  leadEmail = '';
  leadPhone = '';
  leadCompany = '';
  leadDetails = '';

  isSubmitting = signal(false);
  submitStatus = signal<'idle' | 'success' | 'error'>('idle');

  ngOnInit() {
    this.seo.updateMeta({
      title: 'Unitree H2 Humanoid Testtag & Beratung | Kubotics Schweiz',
      description: 'Erleben Sie den humanoiden Roboter Unitree H2 hands-on in der Schweiz. Dedizierter Consulting- & Testtag für industrielle Manipulation und F&E-Projekte.',
      keywords: 'Unitree H2 Schweiz, Humanoid Robot Testtag, Unitree Partner Schweiz, Humanoide Robotik Miete Kauf'
    });
  }

  onSubmitQuestion(event: Event) {
    event.preventDefault();
    if (this.directQuestion.trim()) {
      const prompt = `[Thema: Unitree H2 Testtag] ${this.directQuestion.trim()}`;
      this.agent.openChat(prompt, true);
    }
  }

  askPreset(preset: string) {
    this.directQuestion = preset;
    this.agent.openChat(`[Thema: Unitree H2 Testtag] ${preset}`, true);
  }

  async onConsultationSubmit() {
    if (!this.leadName.trim() || !this.leadEmail.trim() || !this.leadPhone.trim()) return;

    this.isSubmitting.set(true);
    this.submitStatus.set('idle');

    try {
      await this.api.submitLead({
        first_name: this.leadName.split(' ')[0],
        last_name: this.leadName.split(' ').slice(1).join(' ') || undefined,
        email: this.leadEmail,
        phone: this.leadPhone,
        company_name: this.leadCompany || undefined,
        primary_interest: 'Unitree H2 Hands-On Test Day',
        project_description: this.leadDetails || 'Direct landing page inquiry: /robotics/unitree-h2-test-day'
      }).toPromise();

      this.isSubmitting.set(false);
      this.submitStatus.set('success');
      this.leadName = '';
      this.leadEmail = '';
      this.leadPhone = '';
      this.leadCompany = '';
      this.leadDetails = '';
    } catch (e) {
      this.isSubmitting.set(false);
      this.submitStatus.set('error');
    }
  }
}
