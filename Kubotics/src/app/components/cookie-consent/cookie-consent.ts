import { Component, signal, inject, OnInit, PLATFORM_ID, output } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { I18nService } from '../../core/services/i18n';
import { LegalModalType } from '../legal-modal/legal-modal';

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isVisible()) {
      <aside class="cookie-banner-backdrop animate-fade-in" role="region" aria-label="Cookie consent">
        <div class="cookie-card glass-panel">
          <div class="cookie-content">
            <div class="cookie-header">
              <span class="material-icons cookie-icon">shield</span>
              <h4>{{ i18n.t('COOKIE.TITLE') }}</h4>
            </div>
            <p class="cookie-desc">
              {{ i18n.t('COOKIE.TEXT') }}
              <button type="button" class="link-privacy" (click)="openPrivacy.emit('datenschutz')">
                {{ i18n.t('COOKIE.LEARN_MORE') }}
              </button>
            </p>
          </div>

          <div class="cookie-actions">
            <button type="button" class="btn-essential" (click)="acceptEssential()">
              {{ i18n.t('COOKIE.ESSENTIAL_ONLY') }}
            </button>
            <button type="button" class="btn-accept-all" (click)="acceptAll()">
              {{ i18n.t('COOKIE.ACCEPT_ALL') }}
            </button>
          </div>
        </div>
      </aside>
    }
  `,
  styles: `
    .cookie-banner-backdrop {
      position: fixed;
      bottom: 24px;
      left: 24px;
      right: 24px;
      max-width: 960px;
      margin: 0 auto;
      z-index: 9998;
      pointer-events: none;
    }

    .cookie-card {
      pointer-events: auto;
      background: rgba(12, 12, 12, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 22px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 32px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(20px);
    }

    @media (max-width: 768px) {
      .cookie-card {
        flex-direction: column;
        align-items: stretch;
        gap: 20px;
        padding: 20px;
      }
    }

    .cookie-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }

    .cookie-icon {
      color: #0071e3;
      font-size: 20px;
    }

    .cookie-header h4 {
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
      margin: 0;
    }

    .cookie-desc {
      font-size: 0.82rem;
      color: #aaa;
      line-height: 1.5;
      margin: 0;
    }

    .link-privacy {
      background: none;
      border: none;
      color: #0071e3;
      text-decoration: underline;
      cursor: pointer;
      padding: 0;
      font-size: 0.82rem;
      display: inline;
    }

    .cookie-actions {
      display: flex;
      gap: 12px;
      flex-shrink: 0;
    }

    @media (max-width: 768px) {
      .cookie-actions {
        flex-direction: column;
      }
    }

    .btn-essential {
      padding: 10px 18px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #ccc;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .btn-essential:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }

    .btn-accept-all {
      padding: 10px 22px;
      background: #0071e3;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 15px rgba(0, 113, 227, 0.35);
      white-space: nowrap;
    }

    .btn-accept-all:hover {
      background: #0077ed;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(0, 113, 227, 0.5);
    }
  `
})
export class CookieConsentComponent implements OnInit {
  i18n = inject(I18nService);
  private platformId = inject(PLATFORM_ID);
  
  isVisible = signal<boolean>(false);
  openPrivacy = output<LegalModalType>();

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = localStorage.getItem('kubotics_consent');
      if (!stored) {
        // Show banner after brief delay
        setTimeout(() => this.isVisible.set(true), 1200);
      }
    }
  }

  acceptAll() {
    this.updateConsent('granted');
  }

  acceptEssential() {
    this.updateConsent('denied');
  }

  private updateConsent(status: 'granted' | 'denied') {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('kubotics_consent', status);
      this.isVisible.set(false);

      // Trigger Google Consent Mode v2 Update
      if (typeof (window as any).gtag === 'function') {
        (window as any).gtag('consent', 'update', {
          'analytics_storage': status,
          'ad_storage': status,
          'ad_user_data': status,
          'ad_personalization': status
        });
      }
    }
  }
}
