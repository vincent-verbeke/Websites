import { Component, inject } from '@angular/core';
import { I18nService, Lang } from '../../core/services/i18n';

@Component({
  selector: 'app-header',
  standalone: true,
  template: `
    <header class="glass">
      <div class="container nav-content">
        <div class="logo">
          <img src="/Logo_Cube.svg" alt="Kubotics Logo" class="logo-img">
          <span>KUBOTICS</span>
        </div>
        <nav>
          <a href="#solutions">{{ i18n.t('NAV.SOLUTIONS') }}</a>
          <a href="#roi-calculator">{{ i18n.t('NAV.ROI') }}</a>
          <a href="#readiness-assessment">{{ i18n.t('NAV.READINESS') }}</a>
          <a href="#technology">{{ i18n.t('NAV.TECH') }}</a>
          <a href="#company">{{ i18n.t('NAV.COMPANY') }}</a>
          <a href="#contact" class="nav-contact-link">{{ i18n.t('NAV.CONTACT') }}</a>
        </nav>
        <div class="lang-switch">
          <button (click)="i18n.setLanguage('de-CH')" [class.active]="i18n.lang() === 'de-CH'">DE</button>
          <span>/</span>
          <button (click)="i18n.setLanguage('en')" [class.active]="i18n.lang() === 'en'">EN</button>
        </div>
      </div>
    </header>
  `,
  styles: `
    header {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 48px);
      max-width: 1100px;
      height: 64px;
      z-index: 100;
      display: flex;
      align-items: center;
    }

    .nav-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      letter-spacing: 0.1em;
      font-size: 1.2rem;
    }

    .logo-img {
      height: 32px;
      width: auto;
    }

    nav {
      display: flex;
      gap: 32px;
    }

    nav a {
      color: var(--color-secondary);
      text-decoration: none;
      font-size: 0.8rem;
      font-weight: 500;
      letter-spacing: 0.05em;
      transition: var(--transition-smooth);
      position: relative;
    }

    nav a:hover {
      color: white;
    }

    .nav-contact-link {
      color: var(--color-accent) !important;
    }

    .nav-contact-link::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 0;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--color-accent);
      left: 50%;
      transform: translateX(-50%) translateY(10px);
      transition: transform 0.3s, opacity 0.3s;
      opacity: 0;
    }

    .nav-contact-link:hover::after {
      opacity: 1;
      transform: translateX(-50%) translateY(4px);
    }

    .lang-switch {
      display: flex;
      gap: 8px;
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #444;
    }

    .lang-switch button {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 0;
      transition: color 0.3s;
    }

    .lang-switch button.active {
      color: white;
      font-weight: 700;
    }
  `
})
export class HeaderComponent {
  readonly i18n = inject(I18nService);
}
