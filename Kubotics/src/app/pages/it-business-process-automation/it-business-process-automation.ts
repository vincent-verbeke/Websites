import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SeoService } from '../../core/services/seo';
import { KuboticsApiService, InboundLeadPayload } from '../../core/services/kubotics-api.service';
import { AnalyticsService, AnalyticsEventName, AnalyticsParams } from '../../core/services/analytics.service';

@Component({
  selector: 'app-it-business-process-automation-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bpa-page">
      <!-- 1. HERO SECTION -->
      <section class="hero-section">
        <div class="container hero-grid">
          <div class="hero-content">
            <div class="eyebrow">
              <span class="material-icons">hub</span>
              IT- &amp; GESCHÄFTSPROZESS-AUTOMATISIERUNG FÜR SCHWEIZER KMU
            </div>
            <h1>Weniger manuelle Arbeit.<br><span class="accent">Mehr automatisierte Geschäftsprozesse.</span></h1>
            <p class="hero-sub">
              Wir verbinden Ihre bestehenden IT-Systeme, eliminieren repetitive Dateneingaben zwischen E-Mail, Excel und ERP und setzen KI gezielt dort ein, wo sie messbaren Nutzen bringt.
            </p>
            <div class="hero-actions">
              <a href="#analyse-formular" (click)="onCtaClick($event, 'hero_primary_cta', 'hero', 'analyse-formular')" class="btn btn-primary btn-lg">
                <span class="material-icons">assignment</span>
                Kostenlose Automatisierungsanalyse anfordern
              </a>
              <a href="#beispiele" (click)="onCtaClick($event, 'hero_secondary_cta', 'hero', 'beispiele')" class="btn btn-outline btn-lg">
                <span class="material-icons">arrow_downward</span>
                Beispiele für Automatisierungen entdecken
              </a>
            </div>
            <p class="cta-clarification">
              Wir prüfen einen konkreten Geschäftsprozess, identifizieren Automatisierungspotenzial und geben Ihnen eine erste Einschätzung zu Machbarkeit, Aufwand und wirtschaftlichem Nutzen.
            </p>
            <div class="hero-trust">
              <span><i class="material-icons">check_circle</i> Integration in bestehende IT (ERP, CRM, M365)</span>
              <span><i class="material-icons">check_circle</i> Kontrollierte Automatisierung mit Human-in-the-Loop</span>
              <span><i class="material-icons">check_circle</i> Schweizer Unternehmen (KuroLIV GmbH)</span>
            </div>
          </div>

          <div class="hero-visual">
            <div class="workflow-card">
              <div class="wf-header">
                <span class="wf-badge">SYSTEM-INTEGRATION</span>
                <span class="wf-status">Ohne Medienbruch</span>
              </div>
              <div class="wf-flow">
                <div class="wf-node">
                  <span class="material-icons">mail</span>
                  <div>
                    <strong>Eingang</strong>
                    <small>E-Mail, PDF, Webformular</small>
                  </div>
                </div>
                <div class="wf-arrow"><span class="material-icons">arrow_downward</span></div>
                <div class="wf-node wf-node-highlight">
                  <span class="material-icons">settings_suggest</span>
                  <div>
                    <strong>Prüfung &amp; Verarbeitung</strong>
                    <small>Regelwerk + gezielte KI-Extraktion</small>
                  </div>
                </div>
                <div class="wf-arrow"><span class="material-icons">arrow_downward</span></div>
                <div class="wf-node">
                  <span class="material-icons">dns</span>
                  <div>
                    <strong>Zielsysteme</strong>
                    <small>ERP, CRM, Buchhaltung, Teams</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. THE PROBLEMS WE SOLVE -->
      <section class="section section-alt">
        <div class="container">
          <div class="section-header">
            <span class="section-tag">AUSGANGSLAGE IN KMU</span>
            <h2>Welche Engpässe wir in Schweizer KMU lösen</h2>
            <p>Viele Unternehmen nutzen bereits moderne Software – dennoch verbringen Teams jede Woche Stunden mit manuellen Zwischenschritten.</p>
          </div>
          <div class="cards-grid cols-3">
            <div class="card">
              <span class="material-icons card-icon">content_copy</span>
              <h3>Manuelles Abtippen &amp; Copy-Paste</h3>
              <p>Daten werden aus E-Mails, PDFs oder Formularen manuell in ERP-, CRM- oder Buchhaltungssysteme übertragen.</p>
            </div>
            <div class="card">
              <span class="material-icons card-icon">table_chart</span>
              <h3>Isolierte Excel-Listen</h3>
              <p>Kritische Prozessdaten liegen in lokalen Tabellen, weil bestehende Systeme nicht sauber miteinander kommunizieren.</p>
            </div>
            <div class="card">
              <span class="material-icons card-icon">mark_email_unread</span>
              <h3>Unstrukturierte Anfragen &amp; Belege</h3>
              <p>Kundenanfragen, Offertanforderungen oder Lieferantenbelege müssen manuell sortiert, geprüft und weitergeleitet werden.</p>
            </div>
            <div class="card">
              <span class="material-icons card-icon">sync_problem</span>
              <h3>Medienbrüche zwischen Abteilungen</h3>
              <p>Informationen gehen zwischen Verkauf, Administration, Einkauf und Finanzen verloren oder bleiben liegen.</p>
            </div>
            <div class="card">
              <span class="material-icons card-icon">person_off</span>
              <h3>Abhängigkeit von Einzelpersonen</h3>
              <p>Wiederkehrende Abläufe funktionieren nur, solange bestimmte Mitarbeitende das implizite Wissen im Kopf haben.</p>
            </div>
            <div class="card">
              <span class="material-icons card-icon">schedule</span>
              <h3>Fehlende Zeit für Kernaufgaben</h3>
              <p>Qualifizierte Fachkräfte verbringen wertvolle Arbeitszeit mit Routineaufgaben statt mit Kunden, Projekten oder Steuerung.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 3. WHAT WE AUTOMATE (5 CAPABILITIES + LEGACY MODERNIZATION) -->
      <section class="section">
        <div class="container">
          <div class="section-header">
            <span class="section-tag">LEISTUNGSSPEKTRUM</span>
            <h2>Was wir konkret automatisieren</h2>
            <p>Wir entwickeln keine isolierten Spielereien, sondern belastbare Abläufe, die in Ihre bestehende IT-Landschaft passen.</p>
          </div>
          <div class="cards-grid cols-3">
            <div class="card capability-card">
              <span class="material-icons card-icon">account_tree</span>
              <h3>Geschäftsprozess-Automatisierung</h3>
              <p>Durchgängige Workflows für Freigaben, Auftragsanlage, Onboarding, Reporting und interne Benachrichtigungen.</p>
            </div>
            <div class="card capability-card">
              <span class="material-icons card-icon">cable</span>
              <h3>IT-System-Integration</h3>
              <p>Sichere API- und Webhook-Verbindungen zwischen ERP, CRM, Microsoft 365, SharePoint, Webshops und Fachapplikationen.</p>
            </div>
            <div class="card capability-card">
              <span class="material-icons card-icon">description</span>
              <h3>Intelligente Dokumentenverarbeitung</h3>
              <p>Automatisiertes Auslesen, Prüfen und Verbuchen von Rechnungen, Lieferscheinen und Bestellungen.</p>
              <a routerLink="/automation/invoice-processing" class="text-link">
                Details zur Rechnungsverarbeitung <span class="material-icons">arrow_forward</span>
              </a>
            </div>
            <div class="card capability-card">
              <span class="material-icons card-icon">psychology</span>
              <h3>KI-gestützte Workflows &amp; Agenten</h3>
              <p>Gezielter Einsatz von LLMs für Klassifizierung, Zusammenfassung, Triage und strukturierte Datenextraktion – immer mit klaren Leitplanken.</p>
            </div>
            <div class="card capability-card">
              <span class="material-icons card-icon">code</span>
              <h3>Individuelle IT-Automatisierung &amp; Legacy-Modernisierung</h3>
              <p>Massgeschneiderte Schnittstellen, Skripte und Hintergrunddienste, wenn Standard-Tools an ihre Grenzen stossen. Wir modernisieren bestehende Anwendungen und ersetzen veraltete Legacy-Systeme durch schlanke, massgeschneiderte Softwarelösungen – unterstützt durch moderne AI-driven Development-Methoden.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. HOW IT WORKS (4 STEPS) -->
      <section class="section section-alt">
        <div class="container">
          <div class="section-header">
            <span class="section-tag">VORGEHEN</span>
            <h2>In 4 klaren Schritten zur funktionierenden Automatisierung</h2>
            <p>Pragmatisch, transparent und ohne monatelange Beratungsprojekte.</p>
          </div>
          <div class="steps-grid">
            <div class="step-card">
              <div class="step-num">01</div>
              <h3>Analyse</h3>
              <p>Wir prüfen den konkreten Prozess, die beteiligten Systeme, Ausnahmefälle und den tatsächlichen Zeitaufwand.</p>
            </div>
            <div class="step-card">
              <div class="step-num">02</div>
              <h3>Konzeption</h3>
              <p>Sie erhalten ein klares Zielbild mit Schnittstellen, Sicherheitsgrenzen, Human-in-the-Loop-Kontrollen und Aufwandsschätzung.</p>
            </div>
            <div class="step-card">
              <div class="step-num">03</div>
              <h3>Umsetzung</h3>
              <p>Wir implementieren die Automatisierung schrittweise in Ihrer Umgebung und testen sie mit realen Beispieldaten.</p>
            </div>
            <div class="step-card">
              <div class="step-num">04</div>
              <h3>Betrieb &amp; Optimierung</h3>
              <p>Nach dem Go-Live begleiten wir den Betrieb, überwachen Fehlerfälle und passen den Ablauf bei Bedarf an.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 5. CONCRETE BUSINESS EXAMPLES (ILLUSTRATIVE) -->
      <section id="beispiele" class="section">
        <div class="container">
          <div class="section-header">
            <span class="section-tag">ILLUSTRATIV</span>
            <h2>Konkrete Automatisierungsbeispiele aus der Praxis</h2>
            <p>Typische Einsatzszenarien, wie wir sie für Schweizer KMU umsetzen (illustrative Prozessbeispiele, keine fiktiven Kundenreferenzen):</p>
          </div>
          <div class="cards-grid cols-2">
            <div class="example-card">
              <div class="example-tag">FINANZEN &amp; ADMINISTRATION</div>
              <h3>Kreditorenrechnung: Vom PDF-Eingang bis zur ERP-Buchung</h3>
              <p>Eingehende Rechnungen per E-Mail werden automatisch ausgelesen, mit Bestellnummern abgeglichen, bei Abweichungen zur Freigabe an die zuständige Person geleitet und anschliessend strukturiert ins ERP übergeben.</p>
            </div>
            <div class="example-card">
              <div class="example-tag">VERTRIEB &amp; AUFTRAGSABWICKLUNG</div>
              <h3>Kundenanfragen &amp; Offerten automatisch vorqualifizieren</h3>
              <p>Webformular- und E-Mail-Anfragen werden automatisch kategorisiert, im CRM als strukturierter Vorgang angelegt und mit den passenden Stammdaten für den Innendienst vorbereitet.</p>
            </div>
            <div class="example-card">
              <div class="example-tag">EINKAUF &amp; LOGISTIK</div>
              <h3>Auftragsbestätigungen &amp; Liefertermine abgleichen</h3>
              <p>Lieferanten-Bestätigungen per PDF werden automatisch mit offenen Bestellungen verglichen. Preis- oder Terminabweichungen lösen gezielt eine Meldung an den Einkauf aus.</p>
            </div>
            <div class="example-card">
              <div class="example-tag">IT &amp; INTERNE SERVICES</div>
              <h3>Mitarbeitenden-Onboarding über M365, Tickets &amp; ERP</h3>
              <p>Ein einziger strukturierter Antrag erstellt Benutzerkonten, weist Berechtigungen zu, informiert die IT und legt die erforderlichen Aufgaben in den Fachabteilungen an.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 6. BUSINESS VALUE / INTERACTIVE ROI ESTIMATOR -->
      <section class="section section-alt">
        <div class="container">
          <div class="section-header">
            <span class="section-tag">WIRTSCHAFTLICHKEIT</span>
            <h2>Was kostet ein manueller Prozess Ihr Unternehmen pro Jahr?</h2>
            <p>Schätzen Sie das Einsparpotenzial eines konkreten Prozesses auf Basis Ihrer eigenen Zahlen.</p>
          </div>

          <div class="roi-box">
            <div class="roi-inputs">
              <div class="input-group">
                <label for="roi-employees">Beteiligte Mitarbeitende: <strong>{{ employees() }}</strong></label>
                <input id="roi-employees" type="range" min="1" max="50" [ngModel]="employees()" (ngModelChange)="onRoiChange('employees', $event)" />
              </div>
              <div class="input-group">
                <label for="roi-hours">Manuelle Stunden pro Woche (pro Person): <strong>{{ hoursPerWeek() }} Std.</strong></label>
                <input id="roi-hours" type="range" min="1" max="30" [ngModel]="hoursPerWeek()" (ngModelChange)="onRoiChange('hours_per_week', $event)" />
              </div>
              <div class="input-group">
                <label for="roi-cost">Vollkosten pro Stunde (CHF): <strong>CHF {{ hourlyCost() }}</strong></label>
                <input id="roi-cost" type="range" min="50" max="180" step="5" [ngModel]="hourlyCost()" (ngModelChange)="onRoiChange('hourly_cost', $event)" />
              </div>
              <div class="input-group">
                <label for="roi-pct">Realistisch automatisierbarer Anteil: <strong>{{ automatablePct() }}%</strong></label>
                <input id="roi-pct" type="range" min="20" max="90" step="5" [ngModel]="automatablePct()" (ngModelChange)="onRoiChange('automatable_pct', $event)" />
              </div>
            </div>

            <div class="roi-results">
              <div class="roi-metric">
                <span class="metric-label">Aktuelle manuelle Prozesskosten / Jahr</span>
                <span class="metric-value">CHF {{ annualManualCost() | number:'1.0-0' }}</span>
              </div>
              <div class="roi-metric highlight">
                <span class="metric-label">Geschätztes Einsparpotenzial / Jahr</span>
                <span class="metric-value">CHF {{ potentialAnnualSavings() | number:'1.0-0' }}</span>
              </div>
              <div class="roi-metric">
                <span class="metric-label">Eingesparte Arbeitszeit / Jahr</span>
                <span class="metric-value">{{ hoursSavedPerYear() | number:'1.0-0' }} Std.</span>
              </div>
              <p class="roi-disclaimer">
                <strong>Annahmen &amp; Transparenz:</strong> Berechnung auf Basis von 48 Arbeitswochen pro Jahr (Mitarbeitende × Stunden/Woche × 48 × Stundensatz × automatisierbarer Anteil). Es handelt sich um eine indikative Schätzung zur Orientierung – die tatsächliche Wirtschaftlichkeit prüfen wir gemeinsam in der kostenlosen Automatisierungsanalyse.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- 7. CREDIBILITY & WHY KUBOTICS -->
      <section class="section">
        <div class="container">
          <div class="section-header">
            <span class="section-tag">VERTRAUEN &amp; UMSETZUNG</span>
            <h2>Warum Unternehmen mit uns zusammenarbeiten</h2>
          </div>
          <div class="cards-grid cols-4">
            <div class="why-card">
              <span class="material-icons">location_on</span>
              <h3>Schweizer Umsetzungspartner</h3>
              <p>KuroLIV GmbH mit Sitz in der Schweiz – direkte Ansprechpartner, kurze Wege und realistische Einschätzungen.</p>
            </div>
            <div class="why-card">
              <span class="material-icons">build</span>
              <h3>Direkte technische Umsetzung</h3>
              <p>Nicht nur Konzepte auf Folien: Wir entwickeln, integrieren und betreiben die Lösung direkt mit Ihnen.</p>
            </div>
            <div class="why-card">
              <span class="material-icons">integration_instructions</span>
              <h3>Integration in bestehende IT</h3>
              <p>Ihre vorhandenen Systeme bleiben das Rückgrat. Wir verbinden, was bereits da ist.</p>
            </div>
            <div class="why-card">
              <span class="material-icons">verified_user</span>
              <h3>Kontrollierte Automatisierung</h3>
              <p>Nachvollziehbares Logging, klare Regeln und menschliche Freigabeschritte bei kritischen Entscheidungen.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 8. CONVERSION SECTION -->
      <section id="analyse-formular" class="section cta-section">
        <div class="container cta-grid">
          <div class="cta-info">
            <span class="section-tag">UNVERBINDLICHE ERSTEINSCHÄTZUNG</span>
            <h2>Welcher Geschäftsprozess kostet Ihr Unternehmen unnötig Zeit?</h2>
            <p>
              Schildern Sie uns kurz Ihren Ablauf oder Ihr aktuelles Nadelöhr. Wir melden uns persönlich bei Ihnen und prüfen gemeinsam, ob und wie sich der Prozess sinnvoll automatisieren lässt.
            </p>
            <ul class="cta-bullets">
              <li><span class="material-icons">check</span> Keine Verkaufspräsentation, sondern konkrete Prozessprüfung</li>
              <li><span class="material-icons">check</span> Ehrliche Einschätzung zu Machbarkeit und Aufwand</li>
              <li><span class="material-icons">check</span> Vertrauliche Behandlung Ihrer Angaben</li>
            </ul>
          </div>

          <div class="cta-form-card">
            @if (submitted()) {
              <div class="form-success">
                <span class="material-icons success-icon">check_circle</span>
                <h3>Vielen Dank für Ihre Anfrage</h3>
                <p>
                  Wir haben Ihre Angaben erfolgreich erhalten. Unser Team prüft Ihre Prozessbeschreibung und meldet sich <strong>innerhalb von 1 Arbeitstag persönlich per E-Mail oder Telefon</strong> bei Ihnen, um das weitere Vorgehen zu besprechen.
                </p>
                <button type="button" class="btn btn-outline" (click)="resetForm()">Weitere Anfrage senden</button>
              </div>
            } @else {
              <form (ngSubmit)="onSubmit()" #leadForm="ngForm" class="lead-form" (focusin)="onFormStart()">
                <div class="form-row">
                  <div class="form-field">
                    <label for="name">Name *</label>
                    <input id="name" name="name" type="text" required [(ngModel)]="form.name" placeholder="Vor- und Nachname" />
                  </div>
                  <div class="form-field">
                    <label for="email">Geschäftliche E-Mail *</label>
                    <input id="email" name="email" type="email" required [(ngModel)]="form.email" placeholder="name@unternehmen.ch" />
                  </div>
                </div>

                <div class="form-row">
                  <div class="form-field">
                    <label for="company">Unternehmen *</label>
                    <input id="company" name="company" type="text" required [(ngModel)]="form.company" placeholder="Firmenname" />
                  </div>
                  <div class="form-field">
                    <label for="phone">Telefon (optional)</label>
                    <input id="phone" name="phone" type="tel" [(ngModel)]="form.phone" placeholder="+41 ..." />
                  </div>
                </div>

                <div class="form-field">
                  <label for="industry">Branche (optional)</label>
                  <input id="industry" name="industry" type="text" [(ngModel)]="form.industry" placeholder="z.B. Industrie, Grosshandel, Dienstleistung, Logistik" />
                </div>

                <div class="form-field">
                  <label for="process">Welcher Prozess oder welches Problem soll automatisiert werden? *</label>
                  <textarea id="process" name="process" rows="4" required [(ngModel)]="form.processDescription" placeholder="Kurze Beschreibung des aktuellen Ablaufs, der beteiligten Systeme (z.B. ERP, Excel, E-Mail) und des grössten Zeitfressers..."></textarea>
                </div>

                @if (errorMsg()) {
                  <div class="form-error">{{ errorMsg() }}</div>
                }

                <button type="submit" class="btn btn-primary btn-block" [disabled]="submitting() || !leadForm.form.valid">
                  @if (submitting()) {
                    Wird gesendet...
                  } @else {
                    Kostenlose Automatisierungsanalyse anfordern
                  }
                </button>
              </form>
            }
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .bpa-page {
      color: var(--color-primary, #ffffff);
      background: radial-gradient(circle at 50% 10%, rgba(0, 113, 227, 0.12) 0%, rgba(2, 2, 4, 1) 70%);
      font-family: var(--font-main, 'Outfit', 'Inter', sans-serif);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
    }
    .section {
      padding: 72px 0;
    }
    .section-alt {
      background: rgba(255, 255, 255, 0.02);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .section-header {
      max-width: 760px;
      margin: 0 auto 48px;
      text-align: center;
    }
    .section-tag {
      display: inline-block;
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #60a5fa;
      background: rgba(0, 113, 227, 0.15);
      border: 1px solid rgba(0, 113, 227, 0.35);
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 14px;
    }
    .section-header h2 {
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      font-weight: 700;
      margin: 0 0 12px;
      color: #ffffff;
    }
    .section-header p {
      font-size: 1.05rem;
      color: var(--color-secondary, #a1a1aa);
      margin: 0;
      line-height: 1.6;
    }

    /* Hero */
    .hero-section {
      padding: 112px 0 72px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: 1.25fr 0.9fr;
      gap: 48px;
      align-items: center;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 0.78rem;
      font-weight: 700;
      color: #60a5fa;
      margin-bottom: 16px;
    }
    .eyebrow .material-icons {
      font-size: 18px;
    }
    h1 {
      font-size: clamp(2rem, 4vw, 3rem);
      font-weight: 800;
      line-height: 1.15;
      margin: 0 0 20px;
      color: #ffffff;
    }
    h1 .accent {
      color: #0071e3;
    }
    .hero-sub {
      font-size: 1.125rem;
      line-height: 1.65;
      color: #d4d4d8;
      margin: 0 0 28px;
      max-width: 620px;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-bottom: 14px;
    }
    .cta-clarification {
      font-size: 0.9rem;
      line-height: 1.55;
      color: #a1a1aa;
      margin: 0 0 24px;
      max-width: 600px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 22px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }
    .btn-lg {
      padding: 14px 24px;
      font-size: 1rem;
    }
    .btn-primary {
      background: #0071e3;
      color: #ffffff;
    }
    .btn-primary:hover:not(:disabled) {
      background: #0077ed;
    }
    .btn-primary:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .btn-outline {
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.16);
    }
    .btn-outline:hover {
      border-color: #0071e3;
      background: rgba(0, 113, 227, 0.12);
    }
    .btn-block {
      width: 100%;
    }
    .hero-trust {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 0.88rem;
      color: #a1a1aa;
    }
    .hero-trust span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .hero-trust .material-icons {
      font-size: 17px;
      color: #30d158;
    }

    /* Workflow visual */
    .workflow-card {
      background: rgba(18, 18, 24, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(16px);
    }
    .wf-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .wf-badge {
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 0.72rem;
      font-weight: 700;
      color: #60a5fa;
      background: rgba(0, 113, 227, 0.15);
      padding: 4px 10px;
      border-radius: 6px;
    }
    .wf-status {
      font-size: 0.78rem;
      color: #a1a1aa;
    }
    .wf-flow {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .wf-node {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
    }
    .wf-node-highlight {
      background: rgba(0, 113, 227, 0.12);
      border-color: rgba(0, 113, 227, 0.4);
    }
    .wf-node .material-icons {
      color: #60a5fa;
      font-size: 24px;
    }
    .wf-node strong {
      display: block;
      font-size: 0.95rem;
      color: #ffffff;
    }
    .wf-node small {
      color: #a1a1aa;
      font-size: 0.82rem;
    }
    .wf-arrow .material-icons {
      color: #71717a;
      font-size: 20px;
    }

    /* Grids & Cards */
    .cards-grid {
      display: grid;
      gap: 24px;
    }
    .cols-2 { grid-template-columns: repeat(2, 1fr); }
    .cols-3 { grid-template-columns: repeat(3, 1fr); }
    .cols-4 { grid-template-columns: repeat(4, 1fr); }

    .card, .example-card, .why-card, .step-card {
      background: rgba(18, 18, 24, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 24px;
    }
    .card-icon, .why-card .material-icons {
      font-size: 28px;
      color: #60a5fa;
      margin-bottom: 12px;
    }
    .card h3, .example-card h3, .why-card h3, .step-card h3 {
      font-size: 1.1rem;
      font-weight: 700;
      margin: 0 0 8px;
      color: #ffffff;
    }
    .card p, .example-card p, .why-card p, .step-card p {
      font-size: 0.94rem;
      line-height: 1.6;
      color: #a1a1aa;
      margin: 0;
    }
    .text-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 14px;
      font-size: 0.88rem;
      font-weight: 600;
      color: #60a5fa;
      text-decoration: none;
    }
    .text-link .material-icons {
      font-size: 16px;
    }
    .steps-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
    }
    .step-num {
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 1.5rem;
      font-weight: 700;
      color: #0071e3;
      margin-bottom: 8px;
    }
    .example-tag {
      display: inline-block;
      font-family: var(--font-mono, 'Space Mono', monospace);
      font-size: 0.72rem;
      font-weight: 700;
      color: #60a5fa;
      background: rgba(0, 113, 227, 0.15);
      padding: 3px 10px;
      border-radius: 6px;
      margin-bottom: 10px;
    }

    /* ROI Box */
    .roi-box {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      background: rgba(18, 18, 24, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 32px;
    }
    .roi-inputs {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .input-group label {
      display: block;
      font-size: 0.92rem;
      color: #d4d4d8;
      margin-bottom: 8px;
    }
    .input-group input[type="range"] {
      width: 100%;
      accent-color: #0071e3;
    }
    .roi-results {
      display: flex;
      flex-direction: column;
      gap: 16px;
      justify-content: center;
    }
    .roi-metric {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .roi-metric.highlight {
      background: rgba(0, 113, 227, 0.15);
      border-color: rgba(0, 113, 227, 0.45);
    }
    .metric-label {
      font-size: 0.9rem;
      color: #d4d4d8;
    }
    .metric-value {
      font-size: 1.35rem;
      font-weight: 800;
      color: #ffffff;
    }
    .roi-metric.highlight .metric-value {
      color: #60a5fa;
    }
    .roi-disclaimer {
      font-size: 0.8rem;
      line-height: 1.5;
      color: #a1a1aa;
      margin: 4px 0 0;
    }

    /* CTA / Conversion Section */
    .cta-section {
      background: rgba(255, 255, 255, 0.02);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .cta-grid {
      display: grid;
      grid-template-columns: 1fr 1.15fr;
      gap: 48px;
      align-items: start;
    }
    .cta-info h2 {
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      font-weight: 700;
      margin: 0 0 16px;
      color: #ffffff;
    }
    .cta-info p {
      font-size: 1.02rem;
      line-height: 1.65;
      color: #d4d4d8;
      margin: 0 0 24px;
    }
    .cta-bullets {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cta-bullets li {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #e4e4e7;
      font-size: 0.95rem;
    }
    .cta-bullets .material-icons {
      color: #30d158;
      font-size: 18px;
    }
    .cta-form-card {
      background: rgba(18, 18, 24, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 16px;
      padding: 32px;
    }
    .lead-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-field label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #d4d4d8;
    }
    .form-field input, .form-field textarea {
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      color: #ffffff;
      font-size: 0.95rem;
      font-family: inherit;
    }
    .form-field input:focus, .form-field textarea:focus {
      outline: none;
      border-color: #0071e3;
      background: rgba(255, 255, 255, 0.08);
    }
    .form-error {
      background: rgba(255, 69, 58, 0.15);
      border: 1px solid rgba(255, 69, 58, 0.4);
      color: #fca5a5;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.88rem;
    }
    .form-success {
      text-align: center;
      padding: 24px 12px;
    }
    .form-success p {
      color: #d4d4d8;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .success-icon {
      font-size: 48px;
      color: #30d158;
      margin-bottom: 12px;
    }

    @media (max-width: 960px) {
      .hero-grid, .roi-box, .cta-grid {
        grid-template-columns: 1fr;
      }
      .cols-3, .cols-4, .steps-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    @media (max-width: 640px) {
      .hero-section {
        padding: 96px 0 48px;
      }
      .cols-2, .cols-3, .cols-4, .steps-grid, .form-row {
        grid-template-columns: 1fr;
      }
      .cta-form-card {
        padding: 20px;
      }
    }
  `]
})
export class ItBusinessProcessAutomationPageComponent implements OnInit {
  private readonly seo = inject(SeoService);
  private readonly api = inject(KuboticsApiService);
  private readonly analytics = inject(AnalyticsService);

  // Interactive ROI Estimator Signals
  readonly employees = signal(5);
  readonly hoursPerWeek = signal(4);
  readonly hourlyCost = signal(95);
  readonly automatablePct = signal(60);

  readonly annualManualCost = computed(() =>
    this.employees() * this.hoursPerWeek() * 48 * this.hourlyCost()
  );
  readonly potentialAnnualSavings = computed(() =>
    Math.round(this.annualManualCost() * (this.automatablePct() / 100))
  );
  readonly hoursSavedPerYear = computed(() =>
    Math.round(this.employees() * this.hoursPerWeek() * 48 * (this.automatablePct() / 100))
  );

  // Lead Form State
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly errorMsg = signal<string | null>(null);
  private formStarted = false;
  private roiInteracted = false;

  form = {
    name: '',
    email: '',
    company: '',
    phone: '',
    industry: '',
    processDescription: ''
  };

  ngOnInit(): void {
    this.seo.updateMeta({
      title: 'IT- & Geschäftsprozess-Automatisierung für Schweizer KMU | Kubotics',
      description: 'Weniger manuelle Arbeit, mehr automatisierte Geschäftsprozesse: Kubotics verbindet bestehende IT-Systeme in Schweizer KMU und automatisiert repetitive Abläufe.',
      keywords: 'Geschäftsprozess Automatisierung Schweiz, IT Automatisierung KMU, Systemintegration ERP CRM, Prozessautomatisierung Schweiz, Kubotics'
    });
  }

  private trackGtag(eventName: AnalyticsEventName, params: AnalyticsParams): void {
    this.analytics.track(eventName, params);
    this.analytics.gtagForward(eventName, params);
  }

  onCtaClick(event: Event, ctaId: string, ctaLocation: string, targetId: string): void {
    event.preventDefault();
    this.trackGtag('cta_click', {
      cta_id: ctaId,
      cta_location: ctaLocation,
      landing_page: '/automation/it-business-process-automation'
    });
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth' });
  }

  onRoiChange(field: 'employees' | 'hours_per_week' | 'hourly_cost' | 'automatable_pct', value: number): void {
    if (field === 'employees') this.employees.set(value);
    if (field === 'hours_per_week') this.hoursPerWeek.set(value);
    if (field === 'hourly_cost') this.hourlyCost.set(value);
    if (field === 'automatable_pct') this.automatablePct.set(value);

    if (!this.roiInteracted) {
      this.roiInteracted = true;
      this.trackGtag('roi_calculator_interaction', {
        landing_page: '/automation/it-business-process-automation'
      });
    }
  }

  onFormStart(): void {
    if (!this.formStarted) {
      this.formStarted = true;
      this.trackGtag('form_start', {
        form_id: 'it_bpa_analysis_form',
        landing_page: '/automation/it-business-process-automation'
      });
    }
  }

  onSubmit(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorMsg.set(null);

    const nameParts = this.form.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || undefined;

    const payload: InboundLeadPayload = {
      first_name: firstName,
      last_name: lastName,
      email: this.form.email.trim(),
      company_name: this.form.company.trim(),
      phone: this.form.phone.trim() || undefined,
      industry: this.form.industry.trim() || undefined,
      primary_interest: 'IT & Business Process Automation',
      project_description: [
        `Prozess/Problem: ${this.form.processDescription.trim()}`,
        `ROI-Schätzung: ${this.employees()} MA, ${this.hoursPerWeek()} Std./Wo, CHF ${this.hourlyCost()}/Std., ${this.automatablePct()}% automatisierbar`
      ].join('\n'),
      referrer_url: typeof window !== 'undefined' ? window.location.href : '/automation/it-business-process-automation'
    };

    this.api.submitLead(payload).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.submitted.set(true);
        this.trackGtag('generate_lead', {
          event_category: 'Lead Generation',
          event_label: 'IT & Business Process Automation',
          landing_page: '/automation/it-business-process-automation',
          transaction_id: res?.contact_id || `lead_${Date.now()}`
        });
      },
      error: () => {
        this.submitting.set(false);
        this.errorMsg.set('Die Anfrage konnte momentan nicht übermittelt werden. Bitte versuchen Sie es erneut.');
      }
    });
  }

  resetForm(): void {
    this.form = {
      name: '',
      email: '',
      company: '',
      phone: '',
      industry: '',
      processDescription: ''
    };
    this.formStarted = false;
    this.submitted.set(false);
    this.errorMsg.set(null);
  }
}
