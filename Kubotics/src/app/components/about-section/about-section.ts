import { Component, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n';

@Component({
  selector: 'app-about-section',
  standalone: true,
  template: `
    <section id="company" class="about-section active-section">
      <div class="container">
        <div class="about-grid">
          <div class="about-content">
            <div class="section-badge">{{ i18n.t('NAV.COMPANY') }}</div>
            <h2 class="title-large">{{ i18n.t('ABOUT.TITLE') }}</h2>
            
            <div class="story-block">
              <p class="lead-text">{{ i18n.t('ABOUT.P1') }}</p>
              <p>{{ i18n.t('ABOUT.P2') }}</p>
              <p>{{ i18n.t('ABOUT.P3') }}</p>
              <p>{{ i18n.t('ABOUT.P4') }}</p>
              <p>{{ i18n.t('ABOUT.P5') }}</p>
            </div>

            <div class="vision-footer">
              <div class="vision-item">
                <span class="material-icons">precision_manufacturing</span>
                <span>Swiss Precision</span>
              </div>
              <div class="vision-item">
                <span class="material-icons">psychology</span>
                <span>Stubborn Ingenuity</span>
              </div>
            </div>
          </div>
          
          <div class="about-visual">
            <div class="glass-card mascot-card">
              <div class="mascot-spirit">
                <span class="material-icons logo-icon">pets</span>
              </div>
              <div class="card-details">
                <div class="card-label">INSPIRED BY</div>
                <div class="card-value">KURO THE SHIBA</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .about-section {
      padding: 180px 0;
      min-height: 80vh;
      display: flex;
      align-items: center;
      background: var(--color-bg-dark);
      position: relative;
      overflow: hidden;
    }

    .about-grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 80px;
      align-items: center;
    }

    @media (max-width: 992px) {
      .about-grid {
        grid-template-columns: 1fr;
        gap: 60px;
      }
    }

    .story-block {
      margin: 40px 0;
    }

    .story-block p {
      color: var(--text-muted);
      font-size: 1.1rem;
      line-height: 1.8;
      margin-bottom: 24px;
    }

    .lead-text {
      color: var(--text-main) !important;
      font-size: 1.3rem !important;
      font-weight: 500;
    }

    .vision-footer {
      display: flex;
      gap: 40px;
      margin-top: 60px;
      padding-top: 40px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .vision-item {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--color-accent);
      font-family: 'Space Mono', monospace;
      font-size: 0.9rem;
      letter-spacing: 1px;
    }

    .about-visual {
      display: flex;
      justify-content: center;
      position: relative;
    }

    .mascot-card {
      padding: 40px;
      width: 100%;
      max-width: 320px;
      text-align: center;
      border: 1px solid rgba(0, 113, 227, 0.2);
    }

    .mascot-spirit {
      width: 80px;
      height: 80px;
      background: rgba(0, 113, 227, 0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 30px;
    }

    .logo-icon {
      font-size: 40px;
      color: var(--color-accent);
    }

    .card-label {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #666;
      margin-bottom: 8px;
    }

    .card-value {
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: 2px;
    }
  `
})
export class AboutSectionComponent {
  i18n = inject(I18nService);
}
