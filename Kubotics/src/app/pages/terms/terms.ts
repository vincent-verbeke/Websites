import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SeoService } from '../../core/services/seo';

@Component({
  selector: 'app-terms-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="container">
        <div class="legal-header">
          <span class="eyebrow">LEGAL &amp; TERMS</span>
          <h1>Terms of Service / Nutzungsbedingungen</h1>
          <p class="updated">Last updated: November 15, 2026 · KuroLIV GmbH (Kubotics)</p>
        </div>

        <div class="legal-content">
          <section>
            <h2>1. Scope &amp; Provider</h2>
            <p>
              These Terms of Service govern the use of the website <code>https://www.kubotics.ch</code> and related digital services
              provided by <strong>KuroLIV GmbH</strong> (operating as <strong>Kubotics</strong>, Switzerland). By accessing this website,
              you agree to these terms.
            </p>
          </section>

          <section>
            <h2>2. Services &amp; Non-Binding Information</h2>
            <p>
              Content on this website—including process examples, ROI calculators, and readiness assessments—is provided for general
              informational purposes only and does not constitute a binding offer. Specific automation, integration, or software
              development services are governed by separate written agreements or Statements of Work between KuroLIV GmbH and the client.
            </p>
          </section>

          <section>
            <h2>3. Intellectual Property</h2>
            <p>
              All trademarks, logos, texts, graphics, software components, and layouts on this website are the intellectual property
              of KuroLIV GmbH or its licensors and may not be copied, reproduced, or distributed without prior written permission.
            </p>
          </section>

          <section>
            <h2>4. Acceptable Use</h2>
            <p>
              You agree not to misuse this website, attempt unauthorized access to restricted areas (such as <code>/dashboard</code> or
              backend APIs), or interfere with the availability and security of our services.
            </p>
          </section>

          <section>
            <h2>5. Liability</h2>
            <p>
              KuroLIV GmbH takes reasonable care to ensure the accuracy and availability of this website, but assumes no liability
              for uninterrupted availability, completeness, or indirect/consequential damages arising from the use of this website,
              to the extent permitted by Swiss law.
            </p>
          </section>

          <section>
            <h2>6. Governing Law &amp; Jurisdiction</h2>
            <p>
              These Terms of Service are governed by substantive Swiss law, excluding conflict-of-law rules. Exclusive place of
              jurisdiction is the registered seat of KuroLIV GmbH in Switzerland.
            </p>
          </section>

          <div class="legal-footer-links">
            <a routerLink="/datenschutz">Privacy Policy / Datenschutz</a>
            <a routerLink="/">Back to Home</a>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .legal-page {
      min-height: 100vh;
      padding: 120px 0 80px;
      background: radial-gradient(circle at 50% 10%, rgba(0, 113, 227, 0.1) 0%, rgba(2, 2, 4, 1) 70%);
      color: var(--color-primary, #ffffff);
      font-family: var(--font-main, 'Outfit', 'Inter', sans-serif);
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      padding: 0 24px;
    }
    .legal-header {
      margin-bottom: 40px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 24px;
    }
    .eyebrow {
      display: inline-block;
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 0.75rem;
      font-weight: 700;
      color: #60a5fa;
      letter-spacing: 0.08em;
      margin-bottom: 10px;
    }
    h1 {
      font-size: clamp(1.8rem, 3.5vw, 2.5rem);
      font-weight: 800;
      margin: 0 0 8px;
    }
    .updated {
      color: #a1a1aa;
      font-size: 0.9rem;
      margin: 0;
    }
    .legal-content section {
      margin-bottom: 32px;
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 12px;
    }
    p {
      font-size: 0.98rem;
      line-height: 1.7;
      color: #d4d4d8;
    }
    a {
      color: #60a5fa;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    code {
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 0.88em;
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .legal-footer-links {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      gap: 24px;
    }
  `]
})
export class TermsPageComponent implements OnInit {
  private readonly seo = inject(SeoService);

  ngOnInit(): void {
    this.seo.updateMeta({
      title: 'Terms of Service / Nutzungsbedingungen | Kubotics (KuroLIV GmbH)',
      description: 'Terms of Service for Kubotics (KuroLIV GmbH), Switzerland.',
      keywords: 'Terms of Service, AGB, Nutzungsbedingungen, Kubotics, KuroLIV GmbH'
    });
  }
}
