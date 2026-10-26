import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../core/services/i18n';
import { LeadAgentService } from '../../features/lead-agent/lead-agent.service';

@Component({
  selector: 'app-hero-section',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <div class="background-glow"></div>
      <div class="container hero-content">
        <!-- Strategic Positioning Badge: Swiss Precision • Humanoid Specialist • IT Automation -->
        <div class="badge animate-fade-in">{{ i18n.t('HERO.BADGE') }}</div>
        
        <h1 class="title-huge animate-fade-in">{{ i18n.t('HERO.TITLE') }}</h1>
        <p class="subtitle animate-fade-in" style="animation-delay: 0.15s">
          {{ i18n.t('HERO.SUBTITLE') }}
        </p>
        <p class="tagline animate-fade-in" style="animation-delay: 0.25s">
          {{ i18n.t('HERO.TAGLINE') }}
        </p>

        <!-- Conversational Automation Problem Selector (Point #2 & #3) -->
        <div class="problem-intake-card glass-panel animate-fade-in" style="animation-delay: 0.35s">
          <div class="intake-label">
            <span class="live-dot"></span>
            <strong>{{ i18n.t('HERO.PROBLEM_PROMPT_LABEL') }}</strong>
          </div>
          
          <form class="intake-form" (submit)="submitCustomProblem($event)">
            <div class="input-wrap">
              <span class="material-icons search-icon">auto_awesome</span>
              <input 
                type="text" 
                [(ngModel)]="customProblem" 
                name="customProblem"
                [placeholder]="i18n.t('HERO.PROBLEM_PLACEHOLDER')" 
                class="intake-input"
                autocomplete="off" />
            </div>
            <button type="submit" class="btn-intake-submit">
              <span>{{ i18n.t('HERO.CTA_ANALYZE') }}</span>
              <span class="material-icons">arrow_forward</span>
            </button>
          </form>

          <div class="quick-problem-chips">
            <span class="chip-hint">{{ i18n.lang() === 'de-CH' ? 'Oder Schnellstart:' : 'Or quick select:' }}</span>
            <button type="button" class="problem-chip" (click)="selectPreset('Maschinenbeschickung CNC')">
              🏭 {{ i18n.t('HERO.CHIP_CNC') }}
            </button>
            <button type="button" class="problem-chip" (click)="selectPreset('Unitree H2 Humanoid Testtag')">
              🤖 {{ i18n.t('HERO.CHIP_H2') }}
            </button>
            <button type="button" class="problem-chip" (click)="selectPreset('Rechnungs- und Belegprüfung LLM')">
              📄 {{ i18n.t('HERO.CHIP_INVOICE') }}
            </button>
            <button type="button" class="problem-chip" (click)="selectPreset('Roboterarme & Zellen')">
              🦾 {{ i18n.t('HERO.CHIP_ARMS') }}
            </button>
            <button type="button" class="problem-chip" (click)="selectPreset('Palettierung & Intralogistik')">
              📦 {{ i18n.t('HERO.CHIP_LOGISTICS') }}
            </button>
          </div>
        </div>

        <!-- Conversational Primary CTAs -->
        <div class="cta-group animate-fade-in" style="animation-delay: 0.45s">
          <button class="btn-primary" (click)="openChatForAssessment()">
            <span class="material-icons">chat</span>
            {{ i18n.t('HERO.CTA_PRIMARY') }}
          </button>
          <button class="btn-secondary" (click)="scrollTo('#technology')">
            {{ i18n.t('HERO.CTA_SECONDARY') }}
          </button>
          <button class="btn-accent" (click)="openH2Assessment()">
            <span class="material-icons">precision_manufacturing</span>
            {{ i18n.t('HERO.CTA_TESTDAY') }}
          </button>
        </div>

        <!-- Metric Specs Row: Nested cleanly inside container to prevent wide screen stretching -->
        <div class="specs-grid animate-fade-in" style="animation-delay: 0.6s">
          <div class="spec-item">
            <span class="label">PRECISION</span>
            <span class="value">0.01mm</span>
          </div>
          <div class="spec-item">
            <span class="label">SPEECH RESPONSE</span>
            <span class="value">~100ms</span>
          </div>
          <div class="spec-item">
            <span class="label">SYSTEM AUTONOMY</span>
            <span class="value">LEVEL 5</span>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .hero {
      position: relative;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 130px 0 100px 0;
      overflow: hidden;
    }

    .background-glow {
      position: absolute;
      top: -30%;
      right: -15%;
      width: 75%;
      height: 90%;
      background: radial-gradient(circle, rgba(0, 113, 227, 0.16) 0%, transparent 70%);
      pointer-events: none;
    }

    .hero-content {
      z-index: 2;
      max-width: 1080px;
    }

    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 100px;
      font-family: 'Space Mono', monospace;
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      margin-bottom: 22px;
      color: #0071e3;
    }

    .subtitle {
      font-size: 1.35rem;
      color: #fff;
      font-weight: 500;
      line-height: 1.4;
      margin-bottom: 12px;
      max-width: 820px;
    }

    .tagline {
      color: #86868b;
      font-size: 1.05rem;
      max-width: 680px;
      margin-bottom: 2rem;
      line-height: 1.5;
    }

    /* Problem Intake Diagnostic Card */
    .problem-intake-card {
      background: rgba(18, 18, 18, 0.75);
      border: 1px solid rgba(0, 113, 227, 0.35);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 32px;
      backdrop-filter: blur(20px);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 113, 227, 0.15);
    }

    .intake-label {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      color: #fff;
      letter-spacing: 0.08em;
      margin-bottom: 14px;
    }

    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #0071e3;
      box-shadow: 0 0 10px #0071e3;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .intake-form {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }

    @media (max-width: 768px) {
      .intake-form {
        flex-direction: column;
      }
    }

    .input-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 0 16px;
      transition: all 0.2s ease;
    }

    .input-wrap:focus-within {
      border-color: #0071e3;
      background: rgba(255, 255, 255, 0.08);
      box-shadow: 0 0 15px rgba(0, 113, 227, 0.3);
    }

    .search-icon {
      color: #0071e3;
      font-size: 20px;
    }

    .intake-input {
      width: 100%;
      background: none;
      border: none;
      color: #fff;
      font-size: 0.95rem;
      padding: 14px 0;
      outline: none;
    }

    .intake-input::placeholder {
      color: #777;
    }

    .btn-intake-submit {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 24px;
      background: #0071e3;
      color: #fff;
      font-weight: 600;
      font-size: 0.88rem;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
      font-family: 'Space Mono', monospace;
    }

    .btn-intake-submit:hover {
      background: #0077ed;
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 113, 227, 0.5);
    }

    .quick-problem-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .chip-hint {
      font-size: 0.75rem;
      color: #777;
      font-family: 'Space Mono', monospace;
      margin-right: 4px;
    }

    .problem-chip {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #ccc;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .problem-chip:hover {
      background: rgba(0, 113, 227, 0.15);
      border-color: #0071e3;
      color: #fff;
      transform: translateY(-1px);
    }

    .cta-group {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 40px;
    }

    button {
      padding: 14px 28px;
      border-radius: 100px;
      font-weight: 600;
      font-size: 0.88rem;
      cursor: pointer;
      transition: var(--transition-smooth);
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .btn-primary {
      background: #0071e3;
      color: white;
    }

    .btn-primary:hover {
      background: #0077ed;
      transform: scale(1.03);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .btn-accent {
      background: linear-gradient(135deg, #0071e3 0%, #00c6ff 100%);
      color: white;
      box-shadow: 0 10px 20px rgba(0, 113, 227, 0.3);
    }

    .btn-accent:hover {
      transform: scale(1.03) translateY(-2px);
      box-shadow: 0 15px 30px rgba(0, 113, 227, 0.4);
    }

    .specs-grid {
      display: inline-flex;
      align-items: center;
      gap: 48px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 28px;
      margin-top: 36px;
      width: auto;
      max-width: 100%;
    }

    @media (max-width: 640px) {
      .specs-grid {
        gap: 24px;
        flex-wrap: wrap;
      }
    }

    .spec-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .label {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #666;
    }

    .value {
      font-size: 1.4rem;
      font-weight: 300;
      letter-spacing: 0.1em;
      color: #fff;
    }
  `
})
export class HeroSectionComponent {
  i18n = inject(I18nService);
  private agent = inject(LeadAgentService);

  customProblem = '';

  submitCustomProblem(event: Event) {
    event.preventDefault();
    if (this.customProblem.trim()) {
      const query = this.customProblem;
      this.customProblem = '';
      this.agent.openChat(query, true); // Open as prominent centered modal!
    } else {
      this.agent.openChat(undefined, true);
    }
  }

  selectPreset(topic: string) {
    this.agent.openChat(`Ich interessiere mich für eine Automations-Machbarkeitsanalyse im Bereich: ${topic}`, true);
  }

  openChatForAssessment() {
    this.agent.openChat(undefined, true);
  }

  openH2Assessment() {
    this.agent.openChat('Ich möchte die Machbarkeit eines Unitree H2 Humanoid Testtags für unsere Prozesse prüfen.', true);
  }

  scrollTo(selector: string) {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

