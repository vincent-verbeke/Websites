import { Component, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n';
import { ChannelLinkService } from '../../core/services/channel-link.service';

@Component({
  selector: 'app-application-grid',
  standalone: true,
  template: `
    <section id="solutions" class="applications">
      <div class="container">
        <div class="header-row">
          <div>
            <div class="section-badge">{{ i18n.t('NAV.SOLUTIONS') }}</div>
            <h2 class="title-huge" style="font-size: 3.5rem">{{ i18n.t('SOLUTIONS.TITLE') }}</h2>
            <p class="section-desc" style="color: #86868b; font-size: 1.15rem; margin-top: 10px;">
              {{ i18n.t('SOLUTIONS.SUBTITLE') }}
            </p>
          </div>
          <a href="#contact" class="btn-secondary">{{ i18n.t('SOLUTIONS.CUSTOM_CTA') }}</a>
        </div>

        <div class="app-grid">
          <!-- Solution 1: Humanoid Robotics -->
          <div class="app-item glass h-card">
            <div class="app-info">
              <div class="card-icon"><span class="material-icons">precision_manufacturing</span></div>
              <h3>{{ i18n.t('SOLUTIONS.CAT1_TITLE') }}</h3>
              <p>{{ i18n.t('SOLUTIONS.CAT1_DESC') }}</p>
              <div class="card-channels">
                <a [href]="channelLinks.getWhatsAppLink('h2_testday')" target="_blank" rel="noopener noreferrer" class="link-wa">💬 WhatsApp</a>
                <a [href]="channelLinks.getTelegramLink('h2_testday')" target="_blank" rel="noopener noreferrer" class="link-tg">🎙️ Telegram</a>
              </div>
            </div>
            <div class="app-tag tag-primary">UNITREE H2 & G1</div>
          </div>
          
          <!-- Solution 2: Factory Automation -->
          <div class="app-item glass h-card">
            <div class="app-info">
              <div class="card-icon"><span class="material-icons">engineering</span></div>
              <h3>{{ i18n.t('SOLUTIONS.CAT2_TITLE') }}</h3>
              <p>{{ i18n.t('SOLUTIONS.CAT2_DESC') }}</p>
              <div class="card-channels">
                <a [href]="channelLinks.getWhatsAppLink('factory_arms')" target="_blank" rel="noopener noreferrer" class="link-wa">💬 WhatsApp</a>
                <a [href]="channelLinks.getTelegramLink('factory_arms')" target="_blank" rel="noopener noreferrer" class="link-tg">🎙️ Telegram</a>
              </div>
            </div>
            <div class="app-tag">ROBOT ARMS & CELLS</div>
          </div>

          <!-- Solution 3: IT Process Automation -->
          <div class="app-item glass h-card">
            <div class="app-info">
              <div class="card-icon"><span class="material-icons">account_tree</span></div>
              <h3>{{ i18n.t('SOLUTIONS.CAT3_TITLE') }}</h3>
              <p>{{ i18n.t('SOLUTIONS.CAT3_DESC') }}</p>
              <div class="card-channels">
                <a [href]="channelLinks.getWhatsAppLink('erp_planning')" target="_blank" rel="noopener noreferrer" class="link-wa">💬 WhatsApp</a>
                <a [href]="channelLinks.getTelegramLink('erp_planning')" target="_blank" rel="noopener noreferrer" class="link-tg">🎙️ Telegram</a>
              </div>
            </div>
            <div class="app-tag">ERP & PLANNING</div>
          </div>

          <!-- Solution 4: Invoicing & Document LLMs -->
          <div class="app-item glass h-card">
            <div class="app-info">
              <div class="card-icon"><span class="material-icons">document_scanner</span></div>
              <h3>{{ i18n.t('SOLUTIONS.CAT4_TITLE') }}</h3>
              <p>{{ i18n.t('SOLUTIONS.CAT4_DESC') }}</p>
              <div class="card-channels">
                <a [href]="channelLinks.getWhatsAppLink('llm_invoices')" target="_blank" rel="noopener noreferrer" class="link-wa">💬 WhatsApp</a>
                <a [href]="channelLinks.getTelegramLink('llm_invoices')" target="_blank" rel="noopener noreferrer" class="link-tg">🎙️ Telegram</a>
              </div>
            </div>
            <div class="app-tag tag-llm">MULTIMODAL LLM</div>
          </div>

          <!-- Solution 5: Voice & Messaging Chatbots (SIP, Teams, WhatsApp, Telegram) -->
          <div class="app-item glass h-card highlight-card">
            <div class="app-info">
              <div class="card-icon"><span class="material-icons">record_voice_over</span></div>
              <h3>{{ i18n.t('SOLUTIONS.CAT5_TITLE') }}</h3>
              <p>{{ i18n.t('SOLUTIONS.CAT5_DESC') }}</p>
              <div class="channel-pill-list">
                <span class="channel-chip">SIP / VoIP</span>
                <span class="channel-chip">MS Teams</span>
                <span class="channel-chip">WhatsApp</span>
                <span class="channel-chip">Telegram</span>
                <span class="channel-chip">Web</span>
              </div>
              <div class="card-channels">
                <a [href]="channelLinks.getWhatsAppLink('chatbots_voice')" target="_blank" rel="noopener noreferrer" class="link-wa">💬 WhatsApp</a>
                <a [href]="channelLinks.getTelegramLink('chatbots_voice')" target="_blank" rel="noopener noreferrer" class="link-tg">🎙️ Telegram</a>
              </div>
            </div>
            <div class="app-tag tag-primary">VOICE & MESSAGING</div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .applications {
      padding: 240px 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      background: #000;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 80px;
    }

    .section-badge {
      color: #0071e3;
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      margin-bottom: 24px;
    }

    .app-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 32px;
    }

    .app-item {
      min-height: 520px;
      height: auto;
      padding: 44px 36px 36px 36px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: visible;
      transition: var(--transition-smooth);
    }

    .app-item:hover {
      background: rgba(255, 255, 255, 0.08);
      transform: translateY(-4px);
    }

    .app-info h3 {
      font-size: 1.65rem;
      font-weight: 600;
      line-height: 1.25;
      margin-bottom: 16px;
      word-break: break-word;
      hyphens: auto;
    }

    .app-info p {
      color: #a0a0a0;
      max-width: 100%;
      line-height: 1.6;
      font-size: 0.95rem;
    }

    .channel-pill-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 14px;
    }

    .channel-chip {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #ddd;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 0.68rem;
      font-family: 'Space Mono', monospace;
    }

    .card-channels {
      display: flex;
      gap: 8px;
      margin-top: 18px;
    }

    .link-wa, .link-tg {
      display: inline-flex;
      align-items: center;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s ease;
      font-family: 'Space Mono', monospace;
    }

    .link-wa {
      background: rgba(37, 211, 102, 0.12);
      color: #25d366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .link-wa:hover {
      background: rgba(37, 211, 102, 0.25);
      border-color: #25d366;
      transform: translateY(-1px);
    }

    .link-tg {
      background: rgba(0, 136, 204, 0.12);
      color: #229ed9;
      border: 1px solid rgba(0, 136, 204, 0.3);
    }

    .link-tg:hover {
      background: rgba(0, 136, 204, 0.25);
      border-color: #0088cc;
      transform: translateY(-1px);
    }

    .app-tag {
      font-family: 'Space Mono', monospace;
      font-size: 0.6rem;
      letter-spacing: 0.1em;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 4px 12px;
      border-radius: 100px;
      align-self: flex-start;
    }

    .btn-secondary {
      padding: 12px 24px;
      border-radius: 100px;
      background: none;
      border: 1px solid #444;
      color: #888;
      cursor: pointer;
      font-size: 0.8rem;
    }
  `
})
export class ApplicationGridComponent {
  readonly i18n = inject(I18nService);
  readonly channelLinks = inject(ChannelLinkService);
}
