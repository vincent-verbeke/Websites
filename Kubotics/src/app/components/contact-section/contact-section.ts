import { Component, signal, inject, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../core/services/i18n';
import { EmailService, EmailData } from '../../core/services/email.service';
import { ChannelLinkService, LeadTopic } from '../../core/services/channel-link.service';

@Component({
  selector: 'app-contact-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section id="contact" class="contact-section">
      <div class="container">
        <div class="contact-grid">
          <div class="contact-info">
            <div class="section-badge">{{ i18n.t('NAV.CONTACT') }}</div>
            <h2 class="title-large">GET IN TOUCH</h2>
            
            <div class="impressum-block">
              <h3>KUBOTICS</h3>
              <p class="brand-sub">A Brand of KuroLIV GmbH</p>
              
              <div class="legal-details">
                <p>Färberstrasse 5</p>
                <p>8832 Wollerau, Switzerland</p>
                <div class="ids">
                    <p>UID: CHE-365.727.853</p>
                </div>
              </div>
              
              <div class="contact-methods">
                <a href="mailto:sales@kubotics.ch" class="contact-link">
                  sales&#64;kubotics.ch
                </a>
              </div>

              <!-- High-Conversion Instant Channels (WhatsApp + Telegram) -->
              <div class="instant-channels">
                <div class="instant-header">
                  <span class="live-dot"></span>
                  <span class="instant-label">{{ i18n.t('CONTACT.INSTANT_TITLE') }}</span>
                </div>
                <p class="instant-desc">{{ i18n.t('CONTACT.INSTANT_SUBTITLE') }}</p>

                <!-- Topic Selector Chips -->
                <div class="topic-pills">
                  <button type="button" 
                          class="topic-chip" 
                          [class.active]="selectedTopic() === 'general'" 
                          (click)="selectedTopic.set('general')">
                    {{ i18n.lang() === 'de-CH' ? 'Allgemein' : 'General' }}
                  </button>
                  <button type="button" 
                          class="topic-chip" 
                          [class.active]="selectedTopic() === 'h2_testday'" 
                          (click)="selectedTopic.set('h2_testday')">
                    Unitree H2
                  </button>
                  <button type="button" 
                          class="topic-chip" 
                          [class.active]="selectedTopic() === 'factory_arms'" 
                          (click)="selectedTopic.set('factory_arms')">
                    {{ i18n.lang() === 'de-CH' ? 'Roboterarme' : 'Robot Arms' }}
                  </button>
                  <button type="button" 
                          class="topic-chip" 
                          [class.active]="selectedTopic() === 'llm_invoices'" 
                          (click)="selectedTopic.set('llm_invoices')">
                    LLM Invoices
                  </button>
                  <button type="button" 
                          class="topic-chip" 
                          [class.active]="selectedTopic() === 'chatbots_voice'" 
                          (click)="selectedTopic.set('chatbots_voice')">
                    Voice & Chatbots
                  </button>
                </div>

                <div class="instant-buttons">
                  <a [href]="channelLinks.getWhatsAppLink(selectedTopic())"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="channel-btn whatsapp-btn">
                    <span class="btn-icon">💬</span>
                    <span class="btn-text">
                      <strong>{{ i18n.t('CONTACT.WHATSAPP_BTN') }}</strong>
                      <small>+41 78 220 68 96</small>
                    </span>
                  </a>
                  <a [href]="channelLinks.getTelegramLink(selectedTopic())"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="channel-btn telegram-btn">
                    <span class="btn-icon">🎙️</span>
                    <span class="btn-text">
                      <strong>{{ i18n.t('CONTACT.TELEGRAM_BTN') }}</strong>
                      <small>@Kubotics_bot</small>
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
          
          <div class="contact-form-container">
            @if (!isSubmitted()) {
              <form (submit)="submitForm(); $event.preventDefault()" class="glass-card contact-form animate-fade-in">
                <div class="form-row">
                  <div class="form-group">
                    <label for="name">NAME</label>
                    <input type="text" id="name" name="name" [(ngModel)]="name" required placeholder="Your Name">
                  </div>
                  <div class="form-group">
                    <label for="email">EMAIL</label>
                    <input type="email" id="email" name="email" [(ngModel)]="email" required placeholder="email@example.com">
                  </div>
                </div>
                
                <div class="form-group">
                  <label for="subject">SUBJECT</label>
                  <input type="text" id="subject" name="subject" [(ngModel)]="subject" required [placeholder]="i18n.lang() === 'de-CH' ? 'Wie können wir helfen?' : 'How can we help?'">
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label for="date">{{ i18n.t('CONTACT.DATE') }}</label>
                    <input type="date" id="date" name="date" [(ngModel)]="preferredDate">
                  </div>
                </div>

                <div class="form-group">
                  <label for="usecase">{{ i18n.t('CONTACT.USECASE') }}</label>
                  <textarea id="usecase" name="usecase" [(ngModel)]="businessUseCase" required rows="3" [placeholder]="i18n.t('CONTACT.USECASE_PLACEHOLDER')"></textarea>
                </div>
                
                <div class="form-group">
                  <label for="message">MESSAGE</label>
                  <textarea id="message" name="message" [(ngModel)]="message" required rows="5" [placeholder]="i18n.lang() === 'de-CH' ? 'Erzählen Sie uns mehr...' : 'Tell us about your project...'"></textarea>
                </div>
                
                <button type="submit" class="submit-btn" [disabled]="isSubmitting()">
                  {{ isSubmitting() ? (i18n.lang() === 'de-CH' ? 'SENDET...' : 'SENDING...') : (i18n.lang() === 'de-CH' ? 'NACHRICHT SENDEN' : 'SEND MESSAGE') }}
                </button>
              </form>
            } @else {
              <div class="glass-card success-landing animate-fade-in">
                <div class="success-icon">
                  <span class="material-icons">check_circle</span>
                </div>
                <h3>{{ i18n.lang() === 'de-CH' ? 'Vielen Dank!' : 'Thank You!' }}</h3>
                <p>{{ i18n.t('CONTACT.SUBMIT_SUCCESS') }}</p>
                <button class="btn-reset" (click)="isSubmitted.set(false)">
                  {{ i18n.lang() === 'de-CH' ? 'Weitere Nachricht senden' : 'Send another message' }}
                </button>
              </div>
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .contact-section {
      padding: 240px 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      background: #050505;
    }

    .contact-grid {
      display: grid;
      grid-template-columns: 0.8fr 1.2fr;
      gap: 80px;
    }

    @media (max-width: 992px) {
      .contact-grid {
        grid-template-columns: 1fr;
        gap: 60px;
      }
    }

    .impressum-block {
      margin-top: 40px;
    }

    .brand-sub {
      color: var(--color-accent);
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      margin-bottom: 24px;
    }

    .legal-details p {
      color: #888;
      margin-bottom: 8px;
    }

    .ids {
      margin-top: 20px;
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
    }

    .contact-methods {
      margin-top: 40px;
    }

    .contact-link {
      display: flex;
      align-items: center;
      gap: 12px;
      color: white;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.3s;
    }

    .contact-link:hover {
      color: var(--color-accent);
    }

    .instant-channels {
      margin-top: 36px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
    }

    .instant-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #25d366;
      box-shadow: 0 0 10px #25d366;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .instant-label {
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      color: #fff;
      text-transform: uppercase;
      font-family: 'Space Mono', monospace;
    }

    .instant-desc {
      font-size: 0.82rem;
      color: #a0a0a0;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .topic-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 14px;
    }

    .topic-chip {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #bbb;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 0.72rem;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: 'Space Mono', monospace;
    }

    .topic-chip:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }

    .topic-chip.active {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: #000;
      font-weight: 700;
    }

    .instant-buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .channel-btn {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 12px 18px;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.25s ease;
      cursor: pointer;
    }

    .channel-btn .btn-icon {
      font-size: 1.4rem;
    }

    .channel-btn .btn-text {
      display: flex;
      flex-direction: column;
      text-align: left;
    }

    .channel-btn .btn-text strong {
      font-size: 0.9rem;
      color: #fff;
    }

    .channel-btn .btn-text small {
      font-size: 0.75rem;
      opacity: 0.85;
      font-family: 'Space Mono', monospace;
    }

    .whatsapp-btn {
      background: linear-gradient(135deg, rgba(37, 211, 102, 0.2) 0%, rgba(18, 140, 126, 0.3) 100%);
      border: 1px solid rgba(37, 211, 102, 0.4);
    }

    .whatsapp-btn:hover {
      background: linear-gradient(135deg, rgba(37, 211, 102, 0.35) 0%, rgba(18, 140, 126, 0.5) 100%);
      border-color: #25d366;
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(37, 211, 102, 0.3);
    }

    .telegram-btn {
      background: linear-gradient(135deg, rgba(0, 136, 204, 0.2) 0%, rgba(34, 158, 217, 0.3) 100%);
      border: 1px solid rgba(0, 136, 204, 0.4);
    }

    .telegram-btn:hover {
      background: linear-gradient(135deg, rgba(0, 136, 204, 0.35) 0%, rgba(34, 158, 217, 0.5) 100%);
      border-color: #0088cc;
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0, 136, 204, 0.3);
    }

    .contact-form {
      padding: 40px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      border: 1px solid rgba(255,255,255,0.05);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    @media (max-width: 576px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    label {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #666;
      letter-spacing: 1px;
    }

    input, textarea {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      padding: 12px 16px;
      color: white;
      border-radius: 4px;
      font-family: inherit;
      transition: all 0.3s;
    }

    input:focus, textarea:focus {
      outline: none;
      border-color: var(--color-accent);
      background: rgba(0, 113, 227, 0.05);
    }

    .submit-btn {
      margin-top: 12px;
      background: var(--color-accent);
      color: white;
      border: none;
      padding: 16px;
      font-weight: 600;
      letter-spacing: 1px;
      cursor: pointer;
      transition: all 0.3s;
      border-radius: 4px;
    }

    .submit-btn:hover:not(:disabled) {
      background: #0077ed;
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(0, 113, 227, 0.3);
    }

    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .success-landing {
      padding: 60px 40px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      border: 1px solid rgba(0, 113, 227, 0.2);
    }

    .success-icon {
      color: #0071e3;
      margin-bottom: 8px;
    }

    .success-icon .material-icons {
      font-size: 4rem;
    }

    .success-landing h3 {
      font-size: 2rem;
      font-weight: 700;
      margin: 0;
    }

    .success-landing p {
      color: #888;
      font-size: 1.1rem;
      margin: 0;
    }

    .secondary-text {
      font-size: 0.9rem !important;
      opacity: 0.7;
    }

    .btn-reset {
      margin-top: 16px;
      padding: 12px 24px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: white;
      border-radius: 100px;
      cursor: pointer;
      transition: all 0.3s;
      font-size: 0.8rem;
    }

    .btn-reset:hover {
      background: rgba(255,255,255,0.1);
      transform: translateY(-2px);
    }
  `
})
export class ContactSectionComponent {
  i18n = inject(I18nService);
  channelLinks = inject(ChannelLinkService);
  private emailService = inject(EmailService);

  selectedTopic = signal<LeadTopic>('general');
  name = model('');
  email = model('');
  subject = model('');
  message = model('');
  preferredDate = model('');
  businessUseCase = model('');
  isSubmitting = signal(false);
  isSubmitted = signal(false);

  async submitForm() {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);

    const emailData: EmailData = {
      to: ['vincent.verbeke@kuroliv.ch'],
      subject: `Kubotics Contact: ${this.subject()} (${this.name()})`,
      body_text: `Name: ${this.name()}\nEmail: ${this.email()}\nDate: ${this.preferredDate() || 'N/A'}\nUse Case: ${this.businessUseCase()}\n\nMessage:\n${this.message()}`
    };

    this.emailService.sendEmail(emailData).subscribe({
      next: () => {
        // Trigger GA4 conversion event
        if ((window as any).gtag) {
          (window as any).gtag('event', 'qualify_lead', {
            'value': 1.0,
            'currency': 'CHF',
            'event_callback': () => console.log('GA4 qualify_lead tracked')
          });
          (window as any).gtag('event', 'ads_conversion_SUBMIT_LEAD_FORM_1', {
            'value': 1.0,
            'currency': 'CHF'
          });
        }
        
        this.resetForm();
        this.isSubmitting.set(false);
        this.isSubmitted.set(true);
      },
      error: () => {
        const errorMsg = this.i18n.lang() === 'de-CH' ? 
          'Beim Senden Ihrer Nachricht ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.' : 
          'There was an error sending your message. Please try again later.';
        alert(errorMsg);
        this.isSubmitting.set(false);
      }
    });
  }

  private resetForm() {
    this.name.set('');
    this.email.set('');
    this.subject.set('');
    this.message.set('');
    this.preferredDate.set('');
    this.businessUseCase.set('');
  }
}
