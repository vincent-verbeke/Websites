import { Component, signal, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { IntroCubeComponent } from './features/intro-cube/intro-cube';
import { HeaderComponent } from './components/header/header';
import { FooterComponent } from './components/footer/footer';
import { LegalModalComponent } from './components/legal-modal/legal-modal';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent';
import { ChatWidgetComponent } from './features/lead-agent/chat-widget';
import { I18nService } from './core/services/i18n';
import { SeoService } from './core/services/seo';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    IntroCubeComponent, 
    HeaderComponent, 
    FooterComponent, 
    LegalModalComponent, 
    CookieConsentComponent, 
    ChatWidgetComponent
  ],
  template: `
    <!-- Interactive Three.js 3D Intro Cube: Loaded only on client when not finished -->
    @if (!isIntroFinished() && isBrowser) {
      <app-intro-cube (done)="onIntroDone()"></app-intro-cube>
    }

    <!-- Semantic SSR-Rendered Main Site (Crawled instantly by Google & LLM bots) -->
    <div class="site-wrapper fade-in" [class.intro-active]="!isIntroFinished() && isBrowser">
      <app-header></app-header>
      <main class="visible">
        <router-outlet></router-outlet>
      </main>
      <app-footer (openLegal)="legalModal.openModal($event)"></app-footer>

      <!-- Legal Document Modals (AGB, Impressum, Datenschutz) -->
      <app-legal-modal #legalModal></app-legal-modal>

      <!-- Google Consent Mode v2 Cookie Banner -->
      <app-cookie-consent (openPrivacy)="legalModal.openModal($event)"></app-cookie-consent>

      <!-- AI Lead Generation Assistant Widget -->
      <app-chat-widget></app-chat-widget>
    </div>
  `,
  styles: `
    .site-wrapper {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .site-wrapper.intro-active {
      visibility: hidden;
    }

    main {
      opacity: 1;
      flex: 1;
    }
  `
})
export class AppComponent implements OnInit {
  isIntroFinished = signal(false);
  i18n = inject(I18nService);
  seo = inject(SeoService);
  platformId = inject(PLATFORM_ID);
  isBrowser = false;

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    if (!this.isBrowser) {
      this.isIntroFinished.set(true);
    }
  }

  ngOnInit() {
    if (this.isBrowser) {
      const seen = sessionStorage.getItem('kubotics_intro_seen');
      if (seen === 'true') {
        this.isIntroFinished.set(true);
      }
    }

    this.seo.updateMeta({
      title: 'KUBOTICS — Schweizer Robotik, Fabrikautomation & KI',
      description: 'Offizieller Spezialist & Partner für Unitree-Roboter (H2/G1) in der Schweiz. Schlüsselfertige Roboterarm-Zellen und multimodale LLM-Geschäftsprozessautomation.',
      keywords: 'Unitree Schweiz, Unitree H2 Testtag, Humanoide Roboter Schweiz, CNC Maschinenbeschickung Automation, LLM Rechnungsverarbeitung'
    });
  }

  onIntroDone() {
    this.isIntroFinished.set(true);
    if (this.isBrowser) {
      sessionStorage.setItem('kubotics_intro_seen', 'true');
    }
  }
}
