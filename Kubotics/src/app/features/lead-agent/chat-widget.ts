import { Component, inject, ElementRef, viewChild, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeadAgentService, BOOKING_PAGE_URL } from './lead-agent.service';

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Floating Trigger Button -->
    <button 
      class="chat-trigger-btn"
      (click)="agent.toggleChat()"
      [attr.aria-label]="agent.isOpen() ? 'Close Assistant' : 'Open Kubotics AI Assistant'"
      [class.active]="agent.isOpen()">
      @if (agent.isOpen()) {
        <span class="material-icons">close</span>
      } @else {
        <span class="material-icons">smart_toy</span>
        <span class="trigger-label">AI Specialist</span>
        <span class="pulse-indicator"></span>
      }
    </button>

    <!-- Chat Dialog Window -->
    @if (agent.isOpen()) {
      <div class="chat-window-backdrop" [class.backdrop-modal]="agent.isExpandedModal()" (click)="agent.closeChat()"></div>
      <aside 
        class="chat-window glass-panel" 
        [class.center-modal]="agent.isExpandedModal()"
        role="dialog" 
        aria-modal="true" 
        aria-label="Kubotics Sales Engineer Assessment">
        <!-- Header -->
        <header class="chat-header">
          <div class="agent-avatar">
            <span class="material-icons">precision_manufacturing</span>
            <span class="status-dot"></span>
          </div>
          <div class="header-info">
            <div class="agent-title">Kubotics Sales Engineer</div>
            <div class="agent-status">
              <span class="stage-tag">{{ agent.currentStage() | uppercase }}</span>
              <span>Online • Solution Assessment</span>
            </div>
          </div>
          <div class="header-controls">
            <!-- Mode Toggle (Corner vs Big Center Modal) -->
            <button 
              class="header-action-btn" 
              (click)="agent.toggleExpandedModal()" 
              [title]="agent.isExpandedModal() ? 'Minimize to Corner Widget' : 'Expand to Full Diagnostic View'">
              <span class="material-icons">{{ agent.isExpandedModal() ? 'close_fullscreen' : 'open_in_full' }}</span>
            </button>
            <button class="header-action-btn" (click)="agent.closeChat()" aria-label="Close dialog">
              <span class="material-icons">close</span>
            </button>
          </div>
        </header>

        <!-- Message Stream -->
        <div #scrollContainer class="chat-messages">
          @for (msg of agent.messages(); track msg.id) {
            <div class="message-row" [class.user-row]="msg.sender === 'user'" [class.agent-row]="msg.sender === 'agent'">
              @if (msg.sender === 'agent') {
                <div class="mini-bot-icon">
                  <span class="material-icons">smart_toy</span>
                </div>
              }
              <div class="message-bubble" [class.user-bubble]="msg.sender === 'user'" [class.agent-bubble]="msg.sender === 'agent'">
                <p class="bubble-text">{{ msg.text }}</p>
                
                @if (msg.actionLink) {
                  <a [href]="msg.actionLink.url" target="_blank" rel="noopener noreferrer" class="action-btn">
                    <span class="material-icons">event</span>
                    {{ msg.actionLink.label }}
                  </a>
                }

                <!-- Structured In-Chat Booking Form to capture Name, Email, Phone, and Slot -->
                @if (msg.showBookingForm && !msg.isBooked) {
                  <div class="booking-card glass-panel">
                    <div class="booking-card-header">
                      <span class="material-icons">calendar_month</span>
                      <strong>Termin buchen mit Vincent Verbeke</strong>
                    </div>
                    <p class="booking-desc">Direkte 30-minütige technische Discovery Session via Microsoft Teams:</p>

                    <form (submit)="onBookMeeting(msg); $event.preventDefault()" class="booking-form">
                      <div class="form-row">
                        <div class="input-field">
                          <label>NAME *</label>
                          <input type="text" [(ngModel)]="bookingName" name="bName" required placeholder="Ihr vollständiger Name" />
                        </div>
                        <div class="input-field">
                          <label>UNTERNEHMEN</label>
                          <input type="text" [(ngModel)]="bookingCompany" name="bCompany" placeholder="Firma / Betrieb" />
                        </div>
                      </div>

                      <div class="form-row">
                        <div class="input-field">
                          <label>E-MAIL *</label>
                          <input type="email" [(ngModel)]="bookingEmail" name="bEmail" required placeholder="ihre.adresse@firma.ch" />
                        </div>
                        <div class="input-field">
                          <label>TELEFON *</label>
                          <input type="tel" [(ngModel)]="bookingPhone" name="bPhone" required placeholder="+41 79 123 45 67" />
                        </div>
                      </div>

                      <div class="form-row">
                        <div class="input-field">
                          <label>WUNSCHDATUM *</label>
                          <input type="date" [(ngModel)]="bookingDate" name="bDate" required [min]="minDate" />
                        </div>
                        <div class="input-field">
                          <label>UHRZEIT (ZÜRICH) *</label>
                          <select [(ngModel)]="bookingTime" name="bTime" required>
                            <option value="09:00">09:00 - 09:30</option>
                            <option value="10:00">10:00 - 10:30</option>
                            <option value="11:00">11:00 - 11:30</option>
                            <option value="14:00">14:00 - 14:30</option>
                            <option value="15:00">15:00 - 15:30</option>
                            <option value="16:00">16:00 - 16:30</option>
                          </select>
                        </div>
                      </div>

                      @if (bookingError()) {
                        <div class="booking-err">{{ bookingError() }}</div>
                      }

                      <div class="booking-btn-row">
                        <button type="submit" class="btn-confirm-booking" [disabled]="isBooking()">
                          @if (isBooking()) {
                            <span>Buche in M365...</span>
                          } @else {
                            <span class="material-icons">check_circle</span>
                            <span>Termin buchen & Teams-Link anfordern</span>
                          }
                        </button>
                      </div>
                    </form>
                  </div>
                }

                @if (msg.quickReplies && msg.quickReplies.length > 0) {
                  <div class="quick-replies">
                    @for (chip of msg.quickReplies; track chip) {
                      <button type="button" class="chip-btn" (click)="onSelectChip(chip)">
                        {{ chip }}
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          }

          @if (agent.isLoading()) {
            <div class="message-row agent-row">
              <div class="mini-bot-icon">
                <span class="material-icons">smart_toy</span>
              </div>
              <div class="message-bubble agent-bubble typing-bubble">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            </div>
          }
        </div>

        <!-- Input Bar -->
        <footer class="chat-footer">
          <form (submit)="onSubmit($event)" class="chat-input-form">
            <input 
              type="text" 
              [(ngModel)]="userInput" 
              name="userInput"
              placeholder="Frage zu Unitree H2, CNC-Automation, Rechnungs-LLM..." 
              class="chat-input"
              autocomplete="off" />
            <button type="submit" class="send-btn" [disabled]="!userInput.trim() || agent.isLoading()" aria-label="Send message">
              <span class="material-icons">send</span>
            </button>
          </form>
          <div class="crm-badge">
            <span class="material-icons">verified_user</span>
            Automatisierte Machbarkeitsprüfung • PostgreSQL RDS CRM Synchronisation
          </div>
          <div class="chat-direct-channels">
            <a href="https://wa.me/41782206896?text=Gr%C3%BCezi%20Kubotics%20Team%2C%20ich%20interessiere%20mich%20f%C3%BCr%20Ihre%20Robotik-%20und%20Automationsl%C3%B6sungen."
               target="_blank"
               rel="noopener noreferrer"
               class="channel-pill wa-pill">
              <span>💬 WhatsApp (+41 78 220 68 96)</span>
            </a>
            <a href="https://t.me/Kubotics_bot?start=website_lead"
               target="_blank"
               rel="noopener noreferrer"
               class="channel-pill tg-pill">
              <span>🎙️ Telegram Voice</span>
            </a>
          </div>
        </footer>
      </aside>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      z-index: 9999;
      font-family: 'Inter', system-ui, sans-serif;
    }

    .chat-trigger-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      height: 52px;
      padding: 0 20px;
      background: #0071e3;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 26px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      box-shadow: 0 8px 32px rgba(0, 113, 227, 0.4);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 10000;
    }

    .chat-trigger-btn:hover {
      transform: translateY(-2px);
      background: #0077ed;
      box-shadow: 0 12px 40px rgba(0, 113, 227, 0.55);
    }

    .pulse-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #30d158;
      box-shadow: 0 0 10px #30d158;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }

    .chat-window-backdrop {
      display: none;
    }

    .chat-window-backdrop.backdrop-modal {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(8px);
      z-index: 10001;
    }

    .chat-window {
      position: fixed;
      bottom: 88px;
      right: 24px;
      width: 420px;
      height: 620px;
      max-height: calc(100vh - 110px);
      max-width: calc(100vw - 48px);
      border-radius: 20px;
      background: rgba(14, 14, 18, 0.94);
      backdrop-filter: blur(30px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 10002;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .chat-window.center-modal {
      bottom: auto;
      right: auto;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 820px;
      height: 740px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 40px);
      border-radius: 24px;
      border: 1px solid rgba(0, 113, 227, 0.35);
      box-shadow: 0 32px 90px rgba(0, 0, 0, 0.9), 0 0 50px rgba(0, 113, 227, 0.2);
    }

    .chat-header {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.03);
    }

    .agent-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(0, 113, 227, 0.2);
      border: 1px solid rgba(0, 113, 227, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      color: #0071e3;
    }

    .status-dot {
      position: absolute;
      bottom: 1px;
      right: 1px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #30d158;
      border: 2px solid #0e0e12;
    }

    .header-info {
      flex: 1;
    }

    .agent-title {
      font-weight: 700;
      font-size: 0.95rem;
      color: #f5f5f7;
    }

    .agent-status {
      font-size: 0.72rem;
      color: #86868b;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stage-tag {
      font-size: 0.62rem;
      font-weight: 700;
      color: #0071e3;
      background: rgba(0, 113, 227, 0.15);
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid rgba(0, 113, 227, 0.3);
    }

    .header-controls {
      display: flex;
      gap: 4px;
    }

    .header-action-btn {
      background: transparent;
      border: none;
      color: #86868b;
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .header-action-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }

    .message-row {
      display: flex;
      gap: 10px;
      max-width: 90%;
    }

    .message-row.user-row {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .message-row.agent-row {
      align-self: flex-start;
    }

    .mini-bot-icon {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: rgba(0, 113, 227, 0.2);
      color: #0071e3;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .mini-bot-icon .material-icons {
      font-size: 16px;
    }

    .message-bubble {
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 0.88rem;
      line-height: 1.5;
    }

    .user-bubble {
      background: #0071e3;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }

    .agent-bubble {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #e5e5ea;
      border-bottom-left-radius: 4px;
    }

    .bubble-text {
      margin: 0;
      white-space: pre-wrap;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      padding: 8px 14px;
      background: #0071e3;
      color: #ffffff;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.82rem;
      transition: background 0.2s;
    }

    .action-btn:hover {
      background: #0077ed;
    }

    /* In-Chat Booking Card */
    .booking-card {
      margin-top: 12px;
      padding: 16px;
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(0, 113, 227, 0.3);
    }

    .booking-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      color: #0071e3;
      margin-bottom: 6px;
    }

    .booking-card-header .material-icons {
      font-size: 18px;
    }

    .booking-desc {
      font-size: 0.78rem;
      color: #86868b;
      margin: 0 0 12px 0;
    }

    .booking-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    @media (max-width: 600px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }

    .input-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .input-field label {
      font-size: 0.65rem;
      font-family: 'Space Mono', monospace;
      color: #86868b;
      letter-spacing: 0.05em;
    }

    .input-field input, .input-field select {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 7px 10px;
      color: #ffffff;
      font-size: 0.8rem;
      outline: none;
    }

    .input-field input:focus, .input-field select:focus {
      border-color: #0071e3;
      background: rgba(255, 255, 255, 0.1);
    }

    .input-field select option {
      background: #1c1c1e;
      color: #ffffff;
    }

    .booking-err {
      font-size: 0.75rem;
      color: #ff453a;
      background: rgba(255, 69, 58, 0.1);
      padding: 6px 10px;
      border-radius: 6px;
    }

    .booking-btn-row {
      margin-top: 4px;
    }

    .btn-confirm-booking {
      width: 100%;
      background: #0071e3;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 10px;
      font-weight: 600;
      font-size: 0.84rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.2s;
    }

    .btn-confirm-booking:hover:not(:disabled) {
      background: #0077ed;
    }

    .btn-confirm-booking:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }

    .chip-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #0071e3;
      border-radius: 12px;
      padding: 5px 11px;
      font-size: 0.76rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .chip-btn:hover {
      background: rgba(0, 113, 227, 0.15);
      border-color: rgba(0, 113, 227, 0.35);
      transform: translateY(-1px);
    }

    .typing-bubble {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 12px 18px;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #86868b;
      animation: blink 1.4s infinite both;
    }

    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes blink {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1.1); }
    }

    .chat-footer {
      padding: 12px 16px 14px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(14, 14, 18, 0.98);
    }

    .chat-input-form {
      display: flex;
      gap: 8px;
    }

    .chat-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 9px 12px;
      color: #ffffff;
      font-size: 0.85rem;
      outline: none;
    }

    .chat-input:focus {
      border-color: #0071e3;
      background: rgba(255, 255, 255, 0.09);
    }

    .send-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: #0071e3;
      color: #ffffff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.2s;
    }

    .send-btn:hover:not(:disabled) {
      background: #0077ed;
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .crm-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.68rem;
      color: #666;
      margin-top: 8px;
      justify-content: center;
      text-align: center;
    }

    .crm-badge .material-icons {
      font-size: 13px;
      color: #0071e3;
    }

    .chat-direct-channels {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      justify-content: center;
    }

    .channel-pill {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 10px;
      font-size: 0.74rem;
      font-weight: 600;
      border-radius: 6px;
      text-decoration: none;
      transition: all 0.2s ease;
    }

    .wa-pill {
      background: rgba(37, 211, 102, 0.15);
      color: #25d366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .wa-pill:hover {
      background: rgba(37, 211, 102, 0.25);
      border-color: #25d366;
    }

    .tg-pill {
      background: rgba(0, 136, 204, 0.15);
      color: #229ed9;
      border: 1px solid rgba(0, 136, 204, 0.3);
    }

    .tg-pill:hover {
      background: rgba(0, 136, 204, 0.25);
      border-color: #229ed9;
    }
  `
})
export class ChatWidgetComponent {
  agent = inject(LeadAgentService);
  scrollContainer = viewChild<ElementRef>('scrollContainer');
  userInput = '';

  // In-chat booking state
  bookingName = '';
  bookingEmail = '';
  bookingPhone = '';
  bookingCompany = '';
  bookingDate = '';
  bookingTime = '10:00';
  isBooking = signal(false);
  bookingError = signal<string | null>(null);
  minDate = new Date().toISOString().split('T')[0];

  constructor() {
    effect(() => {
      this.agent.messages();
      this.agent.isLoading();
      this.agent.isOpen();
      this.agent.isExpandedModal();
      
      setTimeout(() => this.scrollToBottom(), 50);
      setTimeout(() => this.scrollToBottom(), 200);
    });
  }

  onSubmit(event: Event) {
    event.preventDefault();
    if (this.userInput.trim()) {
      const text = this.userInput;
      this.userInput = '';
      this.agent.sendMessage(text);
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  onSelectChip(chip: string) {
    this.agent.sendMessage(chip);
    setTimeout(() => this.scrollToBottom(), 50);
  }

  async onBookMeeting(msg: any) {
    if (!this.bookingName.trim() || !this.bookingEmail.trim() || !this.bookingPhone.trim() || !this.bookingDate) {
      this.bookingError.set('Bitte Name, E-Mail, Telefon und Wunschdatum ausfüllen.');
      return;
    }

    this.isBooking.set(true);
    this.bookingError.set(null);

    const result = await this.agent.executeInChatBooking({
      name: this.bookingName,
      email: this.bookingEmail,
      phone: this.bookingPhone,
      company: this.bookingCompany || undefined,
      date: this.bookingDate,
      time: this.bookingTime,
      topic: msg.bookingTopic || 'Kubotics Automation Consultation'
    });

    this.isBooking.set(false);

    if (result.success) {
      msg.isBooked = true;
      msg.showBookingForm = false;

      this.agent.messages.update(list => [
        ...list,
        {
          id: 'confirm-' + Date.now(),
          sender: 'agent',
          stage: 'conversion',
          text: `🎉 ${result.message}\n\nIhre Reservierung:\n• Teilnehmer: ${this.bookingName} (${this.bookingEmail}, ${this.bookingPhone})\n• Zeitpunkt: ${this.bookingDate} um ${this.bookingTime} Uhr (Zürich)\n• Thema: ${msg.bookingTopic || 'Discovery Call'}`,
          timestamp: new Date(),
          actionLink: result.joinUrl ? {
            label: 'Teams Meeting direkt beitreten',
            url: result.joinUrl,
            type: 'meeting'
          } : undefined,
          quickReplies: ['Frage via WhatsApp stellen', 'Weiteren Use-Case prüfen']
        }
      ]);
    } else {
      this.bookingError.set(result.message);
    }
  }

  private scrollToBottom() {
    const el = this.scrollContainer()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
