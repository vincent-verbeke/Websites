import { Component, inject, output } from '@angular/core';
import { I18nService } from '../../core/services/i18n';
import { LegalModalType } from '../legal-modal/legal-modal';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <footer>
      <div class="container footer-content">
        <div class="footer-brand">
          <div class="logo">KUBOTICS</div>
          <p class="mission">Precision Engineered, Interaction-Ready, Stubborn Ingenuity</p>
          <p class="brand-owner">A Brand of KuroLIV GmbH</p>
        </div>

        <div class="footer-links">
          <div class="link-group">
            <h4>{{ i18n.lang() === 'de-CH' ? 'Lösungen' : 'Solutions' }}</h4>
            <a href="#solutions">{{ i18n.t('NAV.SOLUTIONS') }}</a>
            <a href="#roi-calculator">{{ i18n.t('NAV.ROI') }}</a>
            <a href="#readiness-assessment">{{ i18n.t('NAV.READINESS') }}</a>
            <a href="#technology">{{ i18n.t('NAV.TECH') }}</a>
          </div>

          <div class="link-group">
            <h4>{{ i18n.lang() === 'de-CH' ? 'Unternehmen' : 'Company' }}</h4>
            <a href="#company">{{ i18n.t('NAV.COMPANY') }}</a>
            <a href="#contact">{{ i18n.t('NAV.CONTACT') }}</a>
            <a href="https://wa.me/41782206896" target="_blank" rel="noopener noreferrer">WhatsApp Support</a>
          </div>

          <div class="link-group">
            <h4>{{ i18n.lang() === 'de-CH' ? 'Rechtliches' : 'Legal' }}</h4>
            <button type="button" class="legal-btn" (click)="openLegal.emit('agb')">
              {{ i18n.lang() === 'de-CH' ? 'AGB (GTC)' : 'Terms (GTC)' }}
            </button>
            <button type="button" class="legal-btn" (click)="openLegal.emit('impressum')">
              {{ i18n.lang() === 'de-CH' ? 'Impressum' : 'Legal Notice' }}
            </button>
            <button type="button" class="legal-btn" (click)="openLegal.emit('datenschutz')">
              {{ i18n.lang() === 'de-CH' ? 'Datenschutz' : 'Privacy Policy' }}
            </button>
          </div>
        </div>

        <div class="footer-contact">
          <h4>Switzerland</h4>
          <p>Färberstrasse 5</p>
          <p>8832 Wollerau</p>
          <p>UID: CHE-365.727.853</p>
          <p>info&#64;kuroliv.ch</p>
        </div>
      </div>
      
      <div class="footer-bottom container">
        <p>&copy; 2026 KuroLIV GmbH. All rights reserved.</p>
        <div class="legal-links-bottom">
          <button type="button" class="bottom-legal" (click)="openLegal.emit('agb')">AGB</button>
          <span>•</span>
          <button type="button" class="bottom-legal" (click)="openLegal.emit('impressum')">Impressum</button>
          <span>•</span>
          <button type="button" class="bottom-legal" (click)="openLegal.emit('datenschutz')">Datenschutz</button>
        </div>
        <div class="socials">
          <a href="https://www.linkedin.com/in/vincentverbeke" target="_blank">LinkedIn</a>
        </div>
      </div>
    </footer>
  `,
  styles: `
    footer {
      background: #050505;
      padding: 80px 0 40px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .footer-content {
      display: grid;
      grid-template-columns: 1.8fr 2.4fr 1fr;
      gap: 60px;
      margin-bottom: 80px;
    }

    @media (max-width: 992px) {
      .footer-content {
        grid-template-columns: 1fr;
        gap: 40px;
      }
    }

    .logo {
      font-weight: 700;
      font-size: 1.5rem;
      margin-bottom: 20px;
    }

    .mission {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 8px;
    }

    .brand-owner {
      color: var(--primary-blue);
      font-size: 0.7rem;
      font-family: 'Space Mono', monospace;
      letter-spacing: 1px;
    }

    h4 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 24px;
      color: #888;
    }

    .footer-links {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 30px;
    }

    @media (max-width: 768px) {
      .footer-links {
        grid-template-columns: 1fr;
        gap: 24px;
      }
    }

    .link-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .link-group a {
      color: #666;
      text-decoration: none;
      font-size: 0.9rem;
      transition: color 0.3s;
    }

    .link-group a:hover {
      color: white;
    }

    .legal-btn {
      background: none;
      border: none;
      padding: 0;
      color: #666;
      font-size: 0.9rem;
      text-align: left;
      cursor: pointer;
      transition: color 0.3s;
    }

    .legal-btn:hover {
      color: #0071e3;
    }

    .footer-contact p {
      color: #666;
      font-size: 0.9rem;
      margin-bottom: 8px;
    }

    .footer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 40px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      color: #444;
      font-size: 0.75rem;
    }

    @media (max-width: 768px) {
      .footer-bottom {
        flex-direction: column;
        gap: 16px;
        text-align: center;
      }
    }

    .legal-links-bottom {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #555;
    }

    .bottom-legal {
      background: none;
      border: none;
      color: #666;
      font-size: 0.75rem;
      cursor: pointer;
      transition: color 0.2s;
    }

    .bottom-legal:hover {
      color: #fff;
    }

    .socials {
      display: flex;
      gap: 24px;
    }

    .socials a {
      color: #666;
      text-decoration: none;
      transition: color 0.2s;
    }

    .socials a:hover {
      color: #fff;
    }
  `
})
export class FooterComponent {
  readonly i18n = inject(I18nService);
  openLegal = output<LegalModalType>();
}
