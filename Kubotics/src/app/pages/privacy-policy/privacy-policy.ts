import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SeoService } from '../../core/services/seo';

@Component({
  selector: 'app-privacy-policy-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="container">
        <div class="legal-header">
          <span class="eyebrow">LEGAL &amp; COMPLIANCE</span>
          <h1>Privacy Policy / Datenschutzerklärung</h1>
          <p class="updated">Last updated: November 15, 2026 · KuroLIV GmbH (Kubotics)</p>
        </div>

        <div class="legal-content">
          <section>
            <h2>1. Controller &amp; Contact Information</h2>
            <p>
              This Privacy Policy explains how <strong>KuroLIV GmbH</strong> (operating under the brand <strong>Kubotics</strong>,
              website: <code>https://www.kubotics.ch</code>) collects, processes, and protects personal data in accordance with the
              Swiss Federal Act on Data Protection (FADP / nDSG) and, where applicable, the EU General Data Protection Regulation (GDPR).
            </p>
            <p>
              <strong>Data Controller:</strong><br>
              KuroLIV GmbH<br>
              Switzerland<br>
              Email: <a href="mailto:info@kubotics.ch">info&#64;kubotics.ch</a><br>
              Website: <a href="https://www.kubotics.ch">https://www.kubotics.ch</a>
            </p>
          </section>

          <section>
            <h2>2. Data We Collect &amp; How We Use It</h2>
            <ul>
              <li><strong>Contact &amp; Lead Forms:</strong> When you submit an enquiry, request an automation analysis, or schedule a discovery meeting, we collect your name, business email address, company name, optional phone number, industry, and project/process description. We use this data exclusively to evaluate your request, prepare an assessment, and communicate with you.</li>
              <li><strong>Technical &amp; Server Logs:</strong> When you visit our website, our hosting infrastructure (AWS CloudFront / S3 and API servers) automatically logs technical metadata such as IP address, browser type, operating system, referrer URL, and timestamp to ensure security, stability, and abuse prevention.</li>
              <li><strong>Attribution &amp; Campaign Parameters:</strong> If you arrive via an advertisement or campaign link, we may store UTM parameters, click identifiers (e.g., <code>gclid</code>), and landing page URLs alongside your enquiry in our PostgreSQL CRM to measure campaign effectiveness.</li>
              <li><strong>Authentication (Internal Dashboard):</strong> Access to <code>/dashboard</code> is restricted to authorized personnel via Microsoft Entra ID (OAuth 2.0 / OIDC). We do not use Entra ID for public visitor tracking.</li>
            </ul>
          </section>

          <section>
            <h2>3. Cookies, Consent Mode &amp; Analytics (GA4 / GTM / Google Ads)</h2>
            <p>
              We use <strong>Google Tag Manager</strong> and <strong>Google Analytics 4 (GA4)</strong> as well as <strong>Google Ads</strong> conversion measurement to understand website usage and measure advertising performance.
            </p>
            <ul>
              <li><strong>Consent Management:</strong> We implement Google Consent Mode v2. Analytics and advertising storage (<code>analytics_storage</code>, <code>ad_storage</code>, <code>ad_user_data</code>, <code>ad_personalization</code>) are denied by default until you explicitly grant consent via our cookie banner.</li>
              <li><strong>No PII in Analytics:</strong> We do not send personal information (such as names, email addresses, phone numbers, or free-text form contents) to Google Analytics or Google Tag Manager.</li>
              <li><strong>Opt-Out:</strong> You can withdraw or change your cookie consent at any time, or use browser-level opt-out mechanisms.</li>
            </ul>
          </section>

          <section>
            <h2>4. Data Sharing &amp; Third-Party Processors</h2>
            <p>
              We do not sell, rent, or trade your personal data. We only share data with trusted infrastructure and service providers strictly necessary to operate our website and business processes (e.g., cloud hosting, email delivery, and Google LLC for consented analytics/advertising measurement). All processors are bound by appropriate data protection obligations.
            </p>
          </section>

          <section>
            <h2>5. Data Retention &amp; Security</h2>
            <p>
              We retain personal data only for as long as necessary to fulfill the purpose for which it was collected or to comply with statutory retention obligations under Swiss law. We implement technical and organizational security measures (TLS encryption in transit, access controls, and least-privilege principles) to protect your data against unauthorized access or loss.
            </p>
          </section>

          <section>
            <h2>6. Your Rights</h2>
            <p>
              Under the Swiss FADP and applicable data protection laws, you have the right to request access to your stored personal data, request correction of inaccurate data, request deletion of your data, or object to certain processing activities. To exercise any of these rights, please contact us at <a href="mailto:info@kubotics.ch">info&#64;kubotics.ch</a>.
            </p>
          </section>

          <div class="legal-footer-links">
            <a routerLink="/terms">Terms of Service / AGB</a>
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
    p, li {
      font-size: 0.98rem;
      line-height: 1.7;
      color: #d4d4d8;
    }
    ul {
      padding-left: 20px;
      margin: 8px 0 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
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
export class PrivacyPolicyPageComponent implements OnInit {
  private readonly seo = inject(SeoService);

  ngOnInit(): void {
    this.seo.updateMeta({
      title: 'Privacy Policy / Datenschutzerklärung | Kubotics (KuroLIV GmbH)',
      description: 'Privacy Policy and data protection notice for Kubotics (KuroLIV GmbH), detailing data collection, cookies, Google Analytics/Ads consent, and user rights under Swiss FADP and GDPR.',
      keywords: 'Privacy Policy, Datenschutz, Kubotics, KuroLIV GmbH, FADP, GDPR'
    });
  }
}
