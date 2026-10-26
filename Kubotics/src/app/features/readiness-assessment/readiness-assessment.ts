import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../core/services/i18n';
import { ChannelLinkService } from '../../core/services/channel-link.service';

interface AssessmentQuestion {
  id: string;
  category: string;
  titleDe: string;
  titleEn: string;
  descDe: string;
  descEn: string;
  weight: number;
}

@Component({
  selector: 'app-readiness-assessment',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section id="readiness-assessment" class="readiness-section">
      <div class="container">
        <!-- Section Header -->
        <div class="section-header">
          <div class="section-badge">{{ i18n.t('ASSESSMENT.BADGE') }}</div>
          <h2 class="title-huge">{{ i18n.t('ASSESSMENT.TITLE') }}</h2>
          <p class="section-subtitle">{{ i18n.t('ASSESSMENT.SUBTITLE') }}</p>
        </div>

        <div class="assessment-container glass-card">
          <!-- Question Checklist -->
          <div class="questions-panel">
            <div class="panel-header">
              <span class="step-indicator">PRACTICAL READINESS CRITERIA</span>
              <span class="subtext">{{ i18n.lang() === 'de-CH' ? 'Wählen Sie zutreffende Punkte:' : 'Check all that apply:' }}</span>
            </div>

            <div class="question-list">
              @for (q of questions; track q.id) {
                <div class="question-card" 
                     [class.selected]="answers()[q.id]" 
                     (click)="toggleQuestion(q.id)">
                  <div class="checkbox-circle" [class.checked]="answers()[q.id]">
                    @if (answers()[q.id]) {
                      <span class="material-icons">check</span>
                    }
                  </div>
                  <div class="question-body">
                    <div class="question-meta">
                      <span class="category-tag">{{ q.category }}</span>
                      <span class="impact-tag">+{{ q.weight }}% score</span>
                    </div>
                    <h4>{{ i18n.lang() === 'de-CH' ? q.titleDe : q.titleEn }}</h4>
                    <p>{{ i18n.lang() === 'de-CH' ? q.descDe : q.descEn }}</p>
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- Dynamic Live Scorecard Result -->
          <div class="scorecard-panel">
            <div class="scorecard-sticky">
              <div class="score-header">
                <span class="score-badge">{{ i18n.t('ASSESSMENT.SCORE_LABEL') }}</span>
                <div class="score-number-row">
                  <span class="score-val" [class.high-score]="score() >= 60" [class.low-score]="score() < 60">
                    {{ score() }}%
                  </span>
                  <span class="score-scale">/ 100%</span>
                </div>
              </div>

              <!-- Animated Visual Progress Bar -->
              <div class="progress-track">
                <div class="progress-fill" 
                     [style.width.%]="score()" 
                     [class.fill-ready]="score() >= 60" 
                     [class.fill-prework]="score() < 60">
                </div>
              </div>

              <!-- Dynamic Verdict Status -->
              <div class="verdict-box" [class.verdict-ready]="score() >= 60" [class.verdict-prework]="score() < 60">
                <div class="verdict-icon">
                  <span class="material-icons">{{ score() >= 60 ? 'verified' : 'build_circle' }}</span>
                </div>
                <div class="verdict-content">
                  <h3>{{ score() >= 60 ? i18n.t('ASSESSMENT.READY_TITLE') : i18n.t('ASSESSMENT.PREWORK_TITLE') }}</h3>
                  <p>{{ score() >= 60 ? i18n.t('ASSESSMENT.READY_DESC') : i18n.t('ASSESSMENT.PREWORK_DESC') }}</p>
                </div>
              </div>

              <!-- Next Steps Recommendations -->
              <div class="recommendations">
                <div class="rec-title">{{ i18n.lang() === 'de-CH' ? 'EMPFOHLENE NÄCHSTE SCHRITTE:' : 'RECOMMENDED ACTION:' }}</div>
                <ul class="rec-list">
                  @if (score() >= 60) {
                    <li><span>•</span> {{ i18n.lang() === 'de-CH' ? 'Direkte Hardware- & Software-Machbarkeitsstudie' : 'Direct hardware & software feasibility scoping' }}</li>
                    <li><span>•</span> {{ i18n.lang() === 'de-CH' ? 'Hands-on Unitree H2 Testtag oder Roboterzellen-Entwurf' : 'Hands-on Unitree H2 test day or robotic cell prototyping' }}</li>
                    <li><span>•</span> {{ i18n.lang() === 'de-CH' ? 'Pilot-Anbindung an ERP / Dokumentenextraktion' : 'Pilot ERP integration & invoice extraction trial' }}</li>
                  } @else {
                    <li><span>•</span> {{ i18n.lang() === 'de-CH' ? 'Workflows standardisieren & Schnittstellen-Katalog erstellen' : 'Standardize workflows & compile API integration list' }}</li>
                    <li><span>•</span> {{ i18n.lang() === 'de-CH' ? 'Begleitete Prozess-Harmonisierung vor Hardware-Investition' : 'Guided process harmonization audit before hardware capex' }}</li>
                    <li><span>•</span> {{ i18n.lang() === 'de-CH' ? 'Fokussierter Starter-Use-Case (z.B. LLM-Dokumentenbelege)' : 'Focal starter use case (e.g. multimodal LLM invoicing)' }}</li>
                  }
                </ul>
              </div>

              <!-- Instant Lead Action Channels -->
              <div class="action-buttons">
                <a href="#contact" class="btn-primary-action">
                  {{ i18n.t('ASSESSMENT.CTA_CONSULT') }}
                </a>
                <div class="channel-actions">
                  <a [href]="channelLinks.getWhatsAppLink('general', getScoreSummary('WhatsApp'))"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="btn-channel wa-channel">
                    <span>💬 WhatsApp</span>
                  </a>
                  <a [href]="channelLinks.getTelegramLink('general')"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="btn-channel tg-channel">
                    <span>🎙️ Telegram</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .readiness-section {
      padding: 160px 0 200px 0;
      background: #020202;
      position: relative;
    }

    .section-header {
      margin-bottom: 60px;
    }

    .section-badge {
      color: #0071e3;
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      margin-bottom: 20px;
      letter-spacing: 0.05em;
    }

    .section-subtitle {
      color: #888;
      font-size: 1.15rem;
      max-width: 650px;
      margin-top: 14px;
      line-height: 1.5;
    }

    .assessment-container {
      display: grid;
      grid-template-columns: 1.25fr 0.95fr;
      gap: 40px;
      padding: 44px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
    }

    @media (max-width: 992px) {
      .assessment-container {
        grid-template-columns: 1fr;
        padding: 24px;
      }
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .step-indicator {
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      color: var(--color-accent);
      font-weight: 700;
    }

    .subtext {
      font-size: 0.78rem;
      color: #777;
    }

    .question-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .question-card {
      display: flex;
      align-items: flex-start;
      gap: 18px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.25s ease;
    }

    .question-card:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateX(4px);
    }

    .question-card.selected {
      background: rgba(0, 113, 227, 0.08);
      border-color: #0071e3;
    }

    .checkbox-circle {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;
      transition: all 0.2s ease;
    }

    .checkbox-circle.checked {
      background: #0071e3;
      border-color: #0071e3;
      color: #fff;
    }

    .checkbox-circle .material-icons {
      font-size: 16px;
    }

    .question-body {
      flex: 1;
    }

    .question-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .category-tag {
      font-family: 'Space Mono', monospace;
      font-size: 0.65rem;
      color: #888;
      text-transform: uppercase;
    }

    .impact-tag {
      font-family: 'Space Mono', monospace;
      font-size: 0.68rem;
      color: #25d366;
    }

    .question-body h4 {
      font-size: 1.05rem;
      color: #fff;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .question-body p {
      font-size: 0.85rem;
      color: #999;
      line-height: 1.45;
      margin: 0;
    }

    /* Scorecard Side Panel */
    .scorecard-panel {
      position: relative;
    }

    .scorecard-sticky {
      position: sticky;
      top: 100px;
      background: rgba(10, 10, 10, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 32px;
      backdrop-filter: blur(20px);
    }

    .score-badge {
      font-family: 'Space Mono', monospace;
      font-size: 0.72rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .score-number-row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-top: 8px;
    }

    .score-val {
      font-size: 3.8rem;
      font-weight: 800;
      font-family: 'Space Mono', monospace;
      line-height: 1;
    }

    .high-score {
      color: #25d366;
      text-shadow: 0 0 30px rgba(37, 211, 102, 0.4);
    }

    .low-score {
      color: #ff9f0a;
      text-shadow: 0 0 30px rgba(255, 159, 10, 0.4);
    }

    .score-scale {
      font-size: 1.1rem;
      color: #666;
      font-family: 'Space Mono', monospace;
    }

    .progress-track {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      margin: 20px 0 28px 0;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .fill-ready {
      background: linear-gradient(90deg, #0071e3 0%, #25d366 100%);
    }

    .fill-prework {
      background: linear-gradient(90deg, #ff9f0a 0%, #ff453a 100%);
    }

    .verdict-box {
      display: flex;
      gap: 16px;
      padding: 18px;
      border-radius: 12px;
      margin-bottom: 24px;
    }

    .verdict-ready {
      background: rgba(37, 211, 102, 0.08);
      border: 1px solid rgba(37, 211, 102, 0.25);
    }

    .verdict-prework {
      background: rgba(255, 159, 10, 0.08);
      border: 1px solid rgba(255, 159, 10, 0.25);
    }

    .verdict-icon .material-icons {
      font-size: 28px;
    }

    .verdict-ready .verdict-icon .material-icons {
      color: #25d366;
    }

    .verdict-prework .verdict-icon .material-icons {
      color: #ff9f0a;
    }

    .verdict-content h3 {
      font-size: 0.98rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 6px;
    }

    .verdict-content p {
      font-size: 0.82rem;
      color: #a0a0a0;
      line-height: 1.45;
      margin: 0;
    }

    .recommendations {
      margin-bottom: 28px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .rec-title {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #888;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    }

    .rec-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rec-list li {
      font-size: 0.82rem;
      color: #bbb;
      line-height: 1.4;
      display: flex;
      gap: 8px;
    }

    .rec-list li span {
      color: var(--color-accent);
    }

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .btn-primary-action {
      display: block;
      width: 100%;
      text-align: center;
      padding: 14px 20px;
      background: #0071e3;
      color: #fff;
      font-weight: 600;
      font-size: 0.9rem;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.2s ease;
      box-shadow: 0 4px 15px rgba(0, 113, 227, 0.35);
    }

    .btn-primary-action:hover {
      background: #0077ed;
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 113, 227, 0.5);
    }

    .channel-actions {
      display: flex;
      gap: 10px;
    }

    .btn-channel {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      text-decoration: none;
      font-family: 'Space Mono', monospace;
      transition: all 0.2s ease;
    }

    .wa-channel {
      background: rgba(37, 211, 102, 0.12);
      color: #25d366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .wa-channel:hover {
      background: rgba(37, 211, 102, 0.25);
      border-color: #25d366;
      transform: translateY(-1px);
    }

    .tg-channel {
      background: rgba(0, 136, 204, 0.12);
      color: #229ed9;
      border: 1px solid rgba(0, 136, 204, 0.3);
    }

    .tg-channel:hover {
      background: rgba(0, 136, 204, 0.25);
      border-color: #0088cc;
      transform: translateY(-1px);
    }
  `
})
export class ReadinessAssessmentComponent {
  i18n = inject(I18nService);
  channelLinks = inject(ChannelLinkService);

  // 5 Strategic Readiness Dimensions
  questions: AssessmentQuestion[] = [
    {
      id: 'standard_processes',
      category: 'Process Standardization',
      titleDe: 'Unternehmensweit standardisierte Prozessabläufe',
      titleEn: 'Company-Wide Standardized Processes in Place',
      descDe: 'Wiederkehrende Aufgaben (z.B. Belegprüfung, Maschinenbeschickung, Montage) folgen klaren SOPs und sind dokumentiert.',
      descEn: 'Repetitive tasks follow documented SOPs with explicit rules rather than ad-hoc oral handoffs.',
      weight: 25
    },
    {
      id: 'digital_systems',
      category: 'Data & Systems',
      titleDe: 'Zentrales ERP- oder WMS-System vorhanden',
      titleEn: 'Central ERP / WMS or Digital Master Records',
      descDe: 'Bestellungen, Lieferscheine, Rechnungen oder Produktionsaufträge werden in einem digitalen Kernsystem gepflegt.',
      descEn: 'Orders, delivery notes, inventory, or invoices reside in an accessible digital ERP/WMS database.',
      weight: 20
    },
    {
      id: 'digital_apis',
      category: 'Integration & APIs',
      titleDe: 'Offene Schnittstellen (REST, SQL, Webhooks oder Dateiexport)',
      titleEn: 'Accessible Interfaces (APIs, SQL, or Structured Exports)',
      descDe: 'Daten können per API, Datenbankabfrage oder automatisiertem Export mit Drittsystemen ausgetauscht werden.',
      descEn: 'Systems permit bidirectional synchronization via APIs, SQL connectors, or automated folder drops.',
      weight: 20
    },
    {
      id: 'management_buyin',
      category: 'Leadership & Stakeholders',
      titleDe: 'Management-Rückhalt für Pilot- & Testtage vorhanden',
      titleEn: 'Management Sponsorship for Pilots & Test Days',
      descDe: 'Entscheidungsträger unterstützen pragmatische Tests (z.B. Vor-Ort H2 Humanoid Testtag oder LLM-Extraktion).',
      descEn: 'Key leaders endorse running focused proofs-of-concept and measuring tangible ROI before wide rollout.',
      weight: 20
    },
    {
      id: 'volume_scale',
      category: 'Volume & Bottlenecks',
      titleDe: 'Spürbarer operativer Flaschenhals (Personalmangel / Belegflut)',
      titleEn: 'Clear Operational Bottleneck (Staffing / Volume Peak)',
      descDe: 'Mindestens 400 Belege/Monat oder Engpässe an Produktionsmaschinen rechtfertigen die Automatisierung wirtschaftlich.',
      descEn: 'Over 400 monthly invoices or production station idle time provides a high-leverage business case.',
      weight: 15
    }
  ];

  // State of user answers (preset with standard processes and digital systems checked by default)
  answers = signal<Record<string, boolean>>({
    standard_processes: true,
    digital_systems: true
  });

  score = computed(() => {
    const ans = this.answers();
    return this.questions.reduce((total, q) => total + (ans[q.id] ? q.weight : 0), 0);
  });

  toggleQuestion(id: string) {
    this.answers.update(current => ({
      ...current,
      [id]: !current[id]
    }));
  }

  getScoreSummary(channel: string): string {
    const currentScore = this.score();
    const verdict = currentScore >= 60 ? 'READY' : 'PRE-WORK NEEDED';
    return `[Readiness Assessment: ${currentScore}% (${verdict})]`;
  }
}
