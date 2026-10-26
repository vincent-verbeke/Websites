import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../core/services/i18n';
import { LeadAgentService } from '../lead-agent/lead-agent.service';

@Component({
  selector: 'app-roi-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section id="roi-calculator" class="roi-section">
      <div class="container">
        <div class="header-center">
          <div class="section-badge">{{ i18n.t('ROI.BADGE') }}</div>
          <h2 class="title-huge" style="font-size: 3rem">{{ i18n.t('ROI.TITLE') }}</h2>
          <p class="roi-subtitle">
            {{ i18n.t('ROI.SUBTITLE') }}
          </p>
        </div>

        <div class="calculator-grid">
          <!-- Controls Panel -->
          <div class="calc-panel glass-card">
            <div class="preset-selector">
              <label class="panel-label">{{ i18n.t('ROI.SELECT_AREA') }}</label>
              <div class="preset-buttons">
                <button 
                  type="button" 
                  class="preset-btn" 
                  [class.active]="mode() === 'invoices'" 
                  (click)="setMode('invoices')">
                  <span class="material-icons">document_scanner</span>
                  <span>{{ i18n.t('ROI.PRESET_INVOICE') }}</span>
                </button>
                <button 
                  type="button" 
                  class="preset-btn" 
                  [class.active]="mode() === 'factory'" 
                  (click)="setMode('factory')">
                  <span class="material-icons">precision_manufacturing</span>
                  <span>{{ i18n.t('ROI.PRESET_FACTORY') }}</span>
                </button>
                <button 
                  type="button" 
                  class="preset-btn" 
                  [class.active]="mode() === 'humanoid'" 
                  (click)="setMode('humanoid')">
                  <span class="material-icons">smart_toy</span>
                  <span>{{ i18n.t('ROI.PRESET_HUMANOID') }}</span>
                </button>
              </div>
            </div>

            <!-- Sliders for Invoices Mode -->
            @if (mode() === 'invoices') {
              <div class="slider-group">
                <div class="slider-header">
                  <span>{{ i18n.t('ROI.MONTHLY_DOCS') }}</span>
                  <span class="slider-val">{{ monthlyInvoices() }} {{ i18n.t('ROI.DOCS_PER_MONTH') }}</span>
                </div>
                <input 
                  type="range" 
                  min="200" 
                  max="10000" 
                  step="100" 
                  [ngModel]="monthlyInvoices()" 
                  (ngModelChange)="monthlyInvoices.set($event)" 
                  class="slider-range">
                
                <div class="slider-header" style="margin-top: 24px;">
                  <span>{{ i18n.t('ROI.MANUAL_COST') }}</span>
                  <span class="slider-val">CHF {{ costPerDoc() }}</span>
                </div>
                <input 
                  type="range" 
                  min="4" 
                  max="25" 
                  step="1" 
                  [ngModel]="costPerDoc()" 
                  (ngModelChange)="costPerDoc.set($event)" 
                  class="slider-range">
              </div>
            }

            <!-- Sliders for Factory Robot Arm Mode -->
            @if (mode() === 'factory') {
              <div class="slider-group">
                <div class="slider-header">
                  <span>{{ i18n.t('ROI.SHIFT_HOURS') }}</span>
                  <span class="slider-val">{{ shiftHours() }} {{ i18n.t('ROI.HOURS_PER_DAY') }}</span>
                </div>
                <input 
                  type="range" 
                  min="8" 
                  max="24" 
                  step="4" 
                  [ngModel]="shiftHours()" 
                  (ngModelChange)="shiftHours.set($event)" 
                  class="slider-range">
                
                <div class="slider-header" style="margin-top: 24px;">
                  <span>{{ i18n.t('ROI.HOURLY_RATE') }}</span>
                  <span class="slider-val">CHF {{ hourlyRate() }} / hr</span>
                </div>
                <input 
                  type="range" 
                  min="45" 
                  max="120" 
                  step="5" 
                  [ngModel]="hourlyRate()" 
                  (ngModelChange)="hourlyRate.set($event)" 
                  class="slider-range">
              </div>
            }

            <!-- Sliders for Humanoid Pilot Mode -->
            @if (mode() === 'humanoid') {
              <div class="slider-group">
                <div class="slider-header">
                  <span>{{ i18n.t('ROI.PILOT_MONTHS') }}</span>
                  <span class="slider-val">{{ pilotMonths() }} {{ i18n.t('ROI.MONTHS') }}</span>
                </div>
                <input 
                  type="range" 
                  min="3" 
                  max="18" 
                  step="3" 
                  [ngModel]="pilotMonths()" 
                  (ngModelChange)="pilotMonths.set($event)" 
                  class="slider-range">
                
                <div class="slider-header" style="margin-top: 24px;">
                  <span>{{ i18n.t('ROI.TEAM_SIZE') }}</span>
                  <span class="slider-val">{{ teamSize() }} {{ i18n.t('ROI.ENGINEERS') }}</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="15" 
                  step="1" 
                  [ngModel]="teamSize()" 
                  (ngModelChange)="teamSize.set($event)" 
                  class="slider-range">
              </div>
            }
          </div>

          <!-- Live ROI Summary Card -->
          <div class="summary-card glass-card">
            <div class="summary-header">
              <span class="projected-label">{{ i18n.t('ROI.ANNUAL_IMPACT') }}</span>
              <div class="big-savings-number">CHF {{ annualSavings().toLocaleString() }}</div>
              <div class="savings-subtext">{{ i18n.t('ROI.SAVINGS_SUB') }}</div>
            </div>

            <div class="metrics-grid">
              <div class="metric-box">
                <div class="metric-label">{{ i18n.t('ROI.METRIC_TIME') }}</div>
                <div class="metric-val">{{ hoursSaved().toLocaleString() }} {{ i18n.t('ROI.METRIC_TIME_VAL') }}</div>
              </div>
              <div class="metric-box">
                <div class="metric-label">{{ i18n.t('ROI.METRIC_ERROR') }}</div>
                <div class="metric-val">&gt; 98.5%</div>
              </div>
              <div class="metric-box">
                <div class="metric-label">{{ i18n.t('ROI.METRIC_PAYBACK') }}</div>
                <div class="metric-val">{{ paybackMonths() }} {{ i18n.t('ROI.MONTHS') }}</div>
              </div>
              <div class="metric-box">
                <div class="metric-label">{{ i18n.t('ROI.METRIC_UPTIME') }}</div>
                <div class="metric-val">24 / 7</div>
              </div>
            </div>

            <div class="summary-cta-group">
              <button type="button" class="btn-primary-roi" (click)="openAiAssessment()">
                <span class="material-icons">auto_awesome</span>
                <span>{{ i18n.t('ROI.CTA_AI_BRIEF') }}</span>
              </button>
              <button type="button" class="btn-secondary-roi" (click)="openBookingAssistant()">
                <span class="material-icons">event</span>
                <span>{{ i18n.t('ROI.CTA_BOOK') }}</span>
              </button>
            </div>
            
            <p class="roi-footnote">
              {{ i18n.t('ROI.FOOTNOTE') }}
            </p>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .roi-section {
      padding: 140px 0;
      background: radial-gradient(circle at 50% 30%, rgba(0, 113, 227, 0.08) 0%, rgba(0, 0, 0, 0.95) 70%);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .header-center {
      text-align: center;
      max-width: 800px;
      margin: 0 auto 60px auto;
    }

    .roi-subtitle {
      color: #86868b;
      font-size: 1.15rem;
      line-height: 1.6;
      margin-top: 14px;
    }

    .calculator-grid {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 32px;
      align-items: stretch;
    }

    @media (max-width: 900px) {
      .calculator-grid {
        grid-template-columns: 1fr;
      }
    }

    .calc-panel {
      padding: 40px;
      display: flex;
      flex-direction: column;
      gap: 32px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      background: rgba(18, 18, 24, 0.6);
      backdrop-filter: blur(20px);
    }

    .panel-label {
      font-size: 0.72rem;
      font-family: 'Space Mono', monospace;
      letter-spacing: 0.12em;
      color: #0071e3;
      margin-bottom: 14px;
      display: block;
    }

    .preset-buttons {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .preset-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      color: #86868b;
      font-size: 0.92rem;
      cursor: pointer;
      transition: all 0.25s ease;
      text-align: left;
    }

    .preset-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.2);
    }

    .preset-btn.active {
      background: rgba(0, 113, 227, 0.15);
      border-color: #0071e3;
      color: #fff;
    }

    .preset-btn.active .material-icons {
      color: #2997ff;
    }

    .slider-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .slider-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.92rem;
      color: #ddd;
    }

    .slider-val {
      font-family: 'Space Mono', monospace;
      color: #2997ff;
      font-weight: 600;
    }

    .slider-range {
      width: 100%;
      height: 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.1);
      outline: none;
      -webkit-appearance: none;
      cursor: pointer;
    }

    .slider-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #0071e3;
      border: 2px solid #ffffff;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(0, 113, 227, 0.6);
    }

    .summary-card {
      padding: 40px;
      border: 1px solid rgba(0, 113, 227, 0.25);
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(14, 22, 38, 0.8) 0%, rgba(10, 12, 18, 0.8) 100%);
      backdrop-filter: blur(20px);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .projected-label {
      font-size: 0.72rem;
      font-family: 'Space Mono', monospace;
      letter-spacing: 0.15em;
      color: #30d158;
    }

    .big-savings-number {
      font-size: 3.2rem;
      font-weight: 700;
      color: #ffffff;
      margin: 8px 0 4px 0;
      letter-spacing: -0.02em;
    }

    .savings-subtext {
      color: #86868b;
      font-size: 0.88rem;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin: 32px 0;
    }

    .metric-box {
      padding: 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
    }

    .metric-label {
      font-size: 0.65rem;
      font-family: 'Space Mono', monospace;
      color: #666;
      margin-bottom: 6px;
    }

    .metric-val {
      font-size: 1.15rem;
      font-weight: 600;
      color: #fff;
    }

    .summary-cta-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .btn-primary-roi {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: #0071e3;
      color: #fff;
      border: none;
      padding: 16px 24px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 20px rgba(0, 113, 227, 0.4);
    }

    .btn-primary-roi:hover {
      background: #0077ed;
      transform: translateY(-2px);
      box-shadow: 0 8px 30px rgba(0, 113, 227, 0.6);
    }

    .btn-secondary-roi {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 14px 24px;
      border-radius: 12px;
      font-size: 0.9rem;
      text-decoration: none;
      transition: background 0.2s;
    }

    .btn-secondary-roi:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .roi-footnote {
      font-size: 0.72rem;
      color: #555;
      text-align: center;
      margin-top: 16px;
    }
  `
})
export class RoiCalculatorComponent {
  i18n = inject(I18nService);
  agent = inject(LeadAgentService);

  mode = signal<'invoices' | 'factory' | 'humanoid'>('invoices');

  // Invoices Mode Signals
  monthlyInvoices = signal<number>(1200);
  costPerDoc = signal<number>(12);

  // Factory Mode Signals
  shiftHours = signal<number>(16);
  hourlyRate = signal<number>(65);

  // Humanoid Mode Signals
  pilotMonths = signal<number>(6);
  teamSize = signal<number>(4);

  annualSavings = computed(() => {
    if (this.mode() === 'invoices') {
      const annualManualCost = this.monthlyInvoices() * this.costPerDoc() * 12;
      const annualAutomatedCost = this.monthlyInvoices() * 0.45 * 12 + 4800; // API + infra
      return Math.round(annualManualCost - annualAutomatedCost);
    } else if (this.mode() === 'factory') {
      const workingDays = 240;
      const annualLaborHours = this.shiftHours() * workingDays;
      const grossLaborCost = annualLaborHours * this.hourlyRate();
      const netSavings = grossLaborCost * 0.65; // conservative 65% efficiency gain
      return Math.round(netSavings);
    } else {
      // Humanoid pilot calculation: speed-up of PoC vs external contractor dev
      return Math.round(this.teamSize() * 45000);
    }
  });

  hoursSaved = computed(() => {
    if (this.mode() === 'invoices') {
      // 8 mins manual review per doc saved down to 20 seconds
      return Math.round((this.monthlyInvoices() * 12 * 7.5) / 60);
    } else if (this.mode() === 'factory') {
      return this.shiftHours() * 240;
    } else {
      return this.teamSize() * 320;
    }
  });

  paybackMonths = computed(() => {
    if (this.mode() === 'invoices') return 2.5;
    if (this.mode() === 'factory') return 7.2;
    return 4.0;
  });

  setMode(m: 'invoices' | 'factory' | 'humanoid') {
    this.mode.set(m);
  }

  openAiAssessment() {
    const currentMode = this.mode();
    let prompt = '';
    if (currentMode === 'invoices') {
      prompt = `I am processing approximately ${this.monthlyInvoices()} invoices per month at CHF ${this.costPerDoc()}/doc. Can you provide a detailed technical feasibility assessment and pricing for your multimodal LLM solution?`;
    } else if (currentMode === 'factory') {
      prompt = `We are looking to automate a factory cell running ${this.shiftHours()} hours/day at CHF ${this.hourlyRate()}/hr. What turnkey robot arm / cobot solutions do you offer?`;
    } else {
      prompt = `We want to explore a Unitree H2 humanoid pilot with a team of ${this.teamSize()} engineers. When can we schedule a hands-on Consulting & Test Day in Switzerland?`;
    }

    this.agent.openChat(prompt, true);
  }

  openBookingAssistant() {
    const currentMode = this.mode();
    let prompt = '';
    if (currentMode === 'invoices') {
      prompt = 'Ich möchte einen 30-minütigen Discovery Call für automatisierte Beleg- und Rechnungsextraktion vereinbaren.';
    } else if (currentMode === 'factory') {
      prompt = 'Ich möchte einen Beratungstermin für eine Roboterarm- bzw. Cobot-Zelle zur Maschinenbeschickung buchen.';
    } else {
      prompt = 'Ich möchte einen Termin für einen Unitree H2 Humanoid Testtag in der Schweiz buchen.';
    }

    // Opens the large centered diagnostic modal directly with conversation stage conversion
    this.agent.openChat(prompt, true);
  }
}
