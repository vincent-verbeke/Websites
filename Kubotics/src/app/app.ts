import { Component, signal, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { IntroCubeComponent } from './features/intro-cube/intro-cube';
import { HeaderComponent } from './components/header/header';
import { HeroSectionComponent } from './components/hero-section/hero-section';
import { TechnologyOverviewComponent } from './features/technology/technology-overview';
import { ApplicationGridComponent } from './features/applications/application-grid';
import { RoiCalculatorComponent } from './features/roi-calculator/roi-calculator';
import { ReadinessAssessmentComponent } from './features/readiness-assessment/readiness-assessment';
import { AboutSectionComponent } from './components/about-section/about-section';
import { ContactSectionComponent } from './components/contact-section/contact-section';
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
    IntroCubeComponent, 
    HeaderComponent, 
    HeroSectionComponent, 
    TechnologyOverviewComponent, 
    ApplicationGridComponent,
    RoiCalculatorComponent,
    ReadinessAssessmentComponent,
    AboutSectionComponent,
    ContactSectionComponent,
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
        <app-hero-section></app-hero-section>
        <app-application-grid></app-application-grid>
        <app-roi-calculator></app-roi-calculator>
        <app-readiness-assessment></app-readiness-assessment>
        <app-technology-overview></app-technology-overview>
        <app-about-section></app-about-section>
        <app-contact-section></app-contact-section>
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
  isBrowser = isPlatformBrowser(this.platformId);

  ngOnInit() {
    // If returning user or non-browser (SSR), bypass intro immediately
    if (this.isBrowser) {
      const hasSeenIntro = sessionStorage.getItem('kubotics_intro_viewed');
      if (hasSeenIntro) {
        this.isIntroFinished.set(true);
      }
    } else {
      this.isIntroFinished.set(true);
    }

    // High-Converting SEO & GEO Metadata
    this.seo.updateMeta({
      title: 'Kubotics — AI-First Robotics Platform & Automation Systems',
      description: 'Enterprise humanoid robotics, manufacturing automation, and AI integration. Book hands-on Unitree H2 consulting & test days in Switzerland.',
      keywords: 'Unitree H2 Switzerland, humanoid robotics Europe, manufacturing automation, AI robotics integration, robot fleet management, Kubotics'
    });

    // Structured JSON-LD Schema for Google & AI Search Engines
    this.seo.setStructuredData({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://kubotics.ch/#organization',
          'name': 'Kubotics',
          'url': 'https://kubotics.ch',
          'description': 'AI-First Robotics Platform & Autonomous Systems Integration',
          'address': {
            '@type': 'PostalAddress',
            'addressCountry': 'CH'
          },
          'knowsAbout': [
            'Humanoid Robotics',
            'Unitree H2',
            'Unitree G1',
            'Industrial Automation',
            'AI-Driven Fleet Operations'
          ]
        },
        {
          '@type': 'Service',
          '@id': 'https://kubotics.ch/#test-days',
          'name': 'Unitree H2 Consulting & Test Days',
          'provider': {
            '@id': 'https://kubotics.ch/#organization'
          },
          'description': 'Hands-on feasibility evaluation, live humanoid robot demonstrations, and commercial ROI assessment for Swiss and European enterprises.',
          'areaServed': ['CH', 'DE', 'AT', 'LI']
        }
      ]
    });
  }

  onIntroDone() {
    this.isIntroFinished.set(true);
    if (this.isBrowser) {
      sessionStorage.setItem('kubotics_intro_viewed', 'true');
    }
  }
}
