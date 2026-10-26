import { Component, inject, ElementRef, viewChild, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeadAgentService, ChatMessage } from './lead-agent.service';

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
              placeholder="Ask about Unitree H2, Test Days, automation..." 
              class="chat-input"
              autocomplete="off" />
            <button type="submit" class="send-btn" [disabled]="!userInput.trim() || agent.isLoading()" aria-label="Send message">
              <span class="material-icons">send</span>
            </button>
          </form>
          <div class="crm-badge">
            <span class="material-icons">verified_user</span>
            Automated qualification • Synchronized with Kubotics PostgreSQL DB
          </div>
          <div class="chat-direct-channels">
            <a href="https://wa.me/41782206896?text=Gr%C3%BCezi%20Kubotics%20Team%2C%20ich%20interessiere%20mich%20f%C3%BCr%20Ihre%20Robotik-%20und%20Automationsl%C3%B6sungen."
               target="_blank"
               rel="noopener noreferrer"
               class="channel-pill wa-pill">
              <span>💬 WhatsApp</span>
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
      border-radius: 9999px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      box-shadow: 0 8px 30px rgba(0, 113, 227, 0.45);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 10000;
    }

    .chat-trigger-btn:hover {
      background: #0077ed;
      transform: translateY(-2px);
      box-shadow: 0 12px 35px rgba(0, 113, 227, 0.55);
    }

    .chat-trigger-btn.active {
      width: 52px;
      padding: 0;
      justify-content: center;
      background: #1f1f23;
    }

    .trigger-label {
      font-size: 0.88rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .pulse-indicator {
      width: 8px;
      height: 8px;
      background: #30d158;
      border-radius: 50%;
      box-shadow: 0 0 0 rgba(48, 209, 88, 0.5);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(48, 209, 88, 0.7); }
      70% { box-shadow: 0 0 0 8px rgba(48, 209, 88, 0); }
      100% { box-shadow: 0 0 0 0 rgba(48, 209, 88, 0); }
    }

    .chat-window {
      position: fixed;
      bottom: 90px;
      right: 24px;
      width: 400px;
      max-width: calc(100vw - 48px);
      height: 600px;
      max-height: calc(100vh - 120px);
      background: rgba(18, 18, 24, 0.94);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7);
      overflow: hidden;
      z-index: 10001;
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Prominent Big Diagnostic Modal Mode (Point #2 & #3 CTA) */
    .chat-window.center-modal {
      top: 50%;
      left: 50%;
      bottom: auto;
      right: auto;
      transform: translate(-50%, -50%);
      width: 820px;
      max-width: min(92vw, 860px);
      height: 720px;
      max-height: min(88vh, 760px);
      border: 1px solid rgba(0, 113, 227, 0.35);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.85), 0 0 40px rgba(0, 113, 227, 0.2);
      animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .chat-window-backdrop.backdrop-modal {
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: translate(-50%, -46%) scale(0.97); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .chat-header {
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .agent-avatar {
      position: relative;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(0, 113, 227, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
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
      border: 2px solid #121218;
    }

    .header-info {
      flex: 1;
    }

    .agent-title {
      font-size: 0.92rem;
      font-weight: 600;
      color: #ffffff;
    }

    .agent-status {
      font-size: 0.72rem;
      color: #86868b;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stage-tag {
      font-family: 'Space Mono', monospace;
      font-size: 0.62rem;
      color: #0071e3;
      background: rgba(0, 113, 227, 0.15);
      border: 1px solid rgba(0, 113, 227, 0.3);
      padding: 1px 5px;
      border-radius: 4px;
    }

    .header-action-btn {
      background: none;
      border: none;
      color: #86868b;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: flex;
    }

    .header-action-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.06);
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .message-row {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      max-width: 88%;
    }

    .user-row {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .agent-row {
      align-self: flex-start;
    }

    .mini-bot-icon {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(0, 113, 227, 0.15);
      color: #2997ff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }

    .message-bubble {
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 0.875rem;
      line-height: 1.45;
    }

    .bubble-text {
      margin: 0;
      white-space: pre-wrap;
    }

    .user-bubble {
      background: #0071e3;
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }

    .agent-bubble {
      background: rgba(255, 255, 255, 0.07);
      color: #f5f5f7;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom-left-radius: 4px;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      padding: 9px 14px;
      background: #30d158;
      color: #000;
      font-weight: 600;
      font-size: 0.8rem;
      border-radius: 8px;
      text-decoration: none;
      transition: opacity 0.2s;
    }

    .action-btn:hover {
      opacity: 0.9;
    }

    .quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
    }

    .chip-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #2997ff;
      border-radius: 20px;
      padding: 5px 12px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .chip-btn:hover {
      background: rgba(41, 151, 255, 0.18);
      border-color: #2997ff;
      color: #ffffff;
    }

    .typing-bubble {
      display: flex;
      gap: 5px;
      align-items: center;
      padding: 12px 18px;
    }

    .dot {
      width: 6px;
      height: 6px;
      background: #86868b;
      border-radius: 50%;
      animation: bounce 1.4s infinite;
    }

    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-5px); }
    }

    .chat-footer {
      padding: 12px 16px 14px 16px;
      background: rgba(255, 255, 255, 0.02);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .chat-input-form {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .chat-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      padding: 10px 14px;
      color: #ffffff;
      font-size: 0.86rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .chat-input:focus {
      border-color: #0071e3;
    }

    .send-btn {
      background: #0071e3;
      border: none;
      border-radius: 10px;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      cursor: pointer;
      transition: background 0.2s;
    }

    .send-btn:disabled {
      background: rgba(255, 255, 255, 0.08);
      color: #555;
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
      padding: 6px 12px;
      font-size: 0.75rem;
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

  constructor() {
    // Whenever messages list changes, agent finishes loading, or chat opens, auto-scroll to latest message
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

  private scrollToBottom() {
    const el = this.scrollContainer()?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
