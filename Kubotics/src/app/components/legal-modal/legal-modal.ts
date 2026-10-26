import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../core/services/i18n';

export type LegalModalType = 'agb' | 'impressum' | 'datenschutz' | null;

@Component({
  selector: 'app-legal-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (activeModal()) {
      <div class="modal-backdrop" (click)="closeModal()">
        <div class="modal-card glass-panel" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <!-- Header -->
          <div class="modal-header">
            <div class="header-titles">
              <span class="badge">{{ i18n.lang() === 'de-CH' ? 'RECHTLICHE HINWEISE' : 'LEGAL NOTICE' }}</span>
              <h2>{{ getTitle() }}</h2>
            </div>
            <button class="close-btn" (click)="closeModal()" aria-label="Close modal">
              <span class="material-icons">close</span>
            </button>
          </div>

          <!-- Body Content -->
          <div class="modal-body">
            @if (activeModal() === 'impressum') {
              <!-- IMPRESSUM CONTENT -->
              <div class="legal-content">
                <h3>{{ i18n.lang() === 'de-CH' ? '1. Herausgeberin & Betreiberin' : '1. Operator & Legal Entity' }}</h3>
                <p>
                  <strong>KUBOTICS</strong><br>
                  Eine Marke der <strong>KuroLIV GmbH</strong><br>
                  Färberstrasse 5<br>
                  8832 Wollerau, Schweiz
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '2. Kontakt' : '2. Contact' }}</h3>
                <p>
                  E-Mail: <a href="mailto:info@kuroliv.ch">info&#64;kuroliv.ch</a> / <a href="mailto:sales@kubotics.ch">sales&#64;kubotics.ch</a><br>
                  Telefon / WhatsApp: +41 78 220 68 96<br>
                  Website: <a href="https://kubotics.ch" target="_blank">https://kubotics.ch</a>
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '3. Handelsregister & UID' : '3. Commercial Register & Tax Identification' }}</h3>
                <p>
                  Eingetragener Firmenname: KuroLIV GmbH<br>
                  Unternehmens-Identifikationsnummer (UID): <strong>CHE-365.727.853</strong><br>
                  Handelsregisteramt: Kanton Schwyz
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '4. Vertretungsberechtigte Person' : '4. Authorized Management' }}</h3>
                <p>
                  Vincent Verbeke, Geschäftsführer / Founder
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '5. Haftungsausschluss' : '5. Disclaimer' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ? 
                    'Die KuroLIV GmbH übernimmt keinerlei Gewähr hinsichtlich der inhaltlichen Richtigkeit, Genauigkeit, Aktualität, Zuverlässigkeit und Vollständigkeit der Informationen. Haftungsansprüche gegen die KuroLIV GmbH wegen Schäden materieller oder immaterieller Art, welche aus dem Zugriff oder der Nutzung bzw. Nichtnutzung der veröffentlichten Informationen entstehen, werden ausgeschlossen.' : 
                    'KuroLIV GmbH assumes no liability for the correctness, accuracy, timeliness, reliability, or completeness of the provided information. Liability claims regarding material or immaterial damages caused by the use or non-use of any information provided are excluded.' 
                  }}
                </p>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Verweise und Links auf Webseiten Dritter liegen ausserhalb unseres Verantwortungsbereichs. Der Zugriff und die Nutzung solcher Webseiten erfolgen auf eigene Gefahr des Nutzers.' :
                    'External links to third-party websites lie outside our scope of responsibility. Access and use of such websites occur entirely at the user’s own risk.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '6. Urheberrechte' : '6. Intellectual Property & Copyright' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Die Urheber- und alle anderen Rechte an Inhalten, Bildern, Videos oder anderen Dateien auf dieser Website gehören ausschliesslich der KuroLIV GmbH oder den speziell genannten Rechtsinhabern (wie Unitree Robotics). Für die Reproduktion jeglicher Elemente ist die schriftliche Zustimmung im Voraus einzuholen.' :
                    'The copyright and all other rights to contents, visuals, videos, and media files on this website belong exclusively to KuroLIV GmbH or explicitly designated rights holders (such as Unitree Robotics). Written authorization must be obtained prior to reproduction.'
                  }}
                </p>
              </div>
            }

            @if (activeModal() === 'agb') {
              <!-- ALLGEMEINE GESCHÄFTSBEDINGUNGEN (AGB) -->
              <div class="legal-content">
                <h3>{{ i18n.lang() === 'de-CH' ? '1. Geltungsbereich & Vertragsgegenstand' : '1. Scope & Subject Matter' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge, Beratungen, Lieferungen von Robotiksystemen (insbesondere Unitree H2, G1, B2), Entwicklungs- und Integrationsdienstleistungen für Fabrikautomation sowie Software- & LLM-Automationslösungen der KuroLIV GmbH (nachfolgend «Kubotics»).' :
                    'These General Terms and Conditions (GTC) apply to all contracts, consulting, delivery of robotics hardware (notably Unitree H2, G1, B2), engineering and integration services for factory automation, and software/LLM automation products provided by KuroLIV GmbH (hereinafter «Kubotics»).'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '2. Angebote, Testtage & Vertragsschluss' : '2. Quotations, Test Days & Contract Formation' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Angebote und Kostenschätzungen sind, sofern nicht schriftlich ausdrücklich als verbindlich bezeichnet, freibleibend. Ein Vertrag kommt durch die schriftliche Auftragsbestätigung, Unterzeichnung einer Leistungsvereinbarung oder Bestätigung eines kostenpflichtigen Consulting- & Testtags zustande.' :
                    'Quotations and cost projections are non-binding unless explicitly marked as binding in writing. A binding agreement is concluded upon written order confirmation, signed statement of work, or booking of a fee-based consulting and test day.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '3. Hardwarelieferung, Inbetriebnahme & Support' : '3. Hardware Delivery, Commissioning & Support' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Die Lieferung von Robotersystemen und Sonderkomponenten erfolgt nach Massgabe der vereinbarten Spezifikationen. Vor-Ort-Inbetriebnahmen, Sicherheitseinweisungen und Schulungen werden in der Leistungsvereinbarung geregelt. Der Kunde stellt die erforderlichen räumlichen, netzwerktechnischen und sicherheitsrelevanten Voraussetzungen sicher.' :
                    'Robotic systems and specialized components are supplied in accordance with agreed technical specifications. Turnkey on-site commissioning, safety briefings, and operator training are defined in the project scope. The client ensures that operational, physical, and network prerequisites are fulfilled.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '4. Preise & Zahlungsbedingungen' : '4. Pricing & Payment Terms' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Alle Preise verstehen sich in Schweizer Franken (CHF) exklusive der gesetzlichen Mehrwertsteuer (MWST), sofern nicht anders ausgewiesen. Rechnungen sind innert 30 Tagen ab Rechnungsdatum netto ohne Abzug zahlbar. Bei individuellen Hardwarebestellungen können Anzahlungen vereinbart werden.' :
                    'All prices are stated in Swiss Francs (CHF) excluding statutory value-added tax (VAT) unless otherwise indicated. Invoices are payable net without deductions within 30 days of the invoice date. Custom hardware orders may require milestone down payments.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '5. Gewährleistung & Haftungsbegrenzung' : '5. Warranty & Limitation of Liability' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Für Hardware gilt die jeweilige Herstellergarantie. Für Software- und Integrationsleistungen leistet Kubotics Gewähr für die fachgerechte Erfüllung nach dem aktuellen Stand der Technik. Die Haftung für indirekte Schäden, Folgeschäden, entgangenen Gewinn oder Betriebsunterbrüche wird, soweit gesetzlich zulässig, wegbedungen.' :
                    'Hardware items are backed by respective manufacturer warranties. For software and robotic integration services, Kubotics warrants diligent execution aligned with current state-of-the-art engineering standards. Liability for indirect damages, lost profits, or business interruption is excluded to the maximum extent permitted by Swiss law.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '6. Anwendbares Recht & Gerichtsstand' : '6. Applicable Law & Jurisdiction' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Das Vertragsverhältnis untersteht ausschliesslich dem materiellen schweizerischen Recht unter Ausschluss des UN-Kaufrechts (CISG). Ausschliesslicher Gerichtsstand für alle Streitigkeiten ist der Sitz der Gesellschaft (Wollerau, Kanton Schwyz).' :
                    'All contractual relationships are governed exclusively by Swiss substantive law, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). The exclusive place of jurisdiction is the corporate seat of KuroLIV GmbH in Wollerau, Canton of Schwyz, Switzerland.'
                  }}
                </p>
              </div>
            }

            @if (activeModal() === 'datenschutz') {
              <!-- DATENSCHUTZERKLÄRUNG (DSGVO & nDSG) -->
              <div class="legal-content">
                <h3>{{ i18n.lang() === 'de-CH' ? '1. Grundsatz & Verantwortliche Stelle' : '1. Overview & Data Controller' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Der Schutz Ihrer persönlichen Daten ist uns ein wichtiges Anliegen. Wir bearbeiten Personendaten in Übereinstimmung mit dem Schweizer Datenschutzgesetz (nDSG) sowie, soweit anwendbar, der Europäischen Datenschutz-Grundverordnung (DSGVO).' :
                    'Protecting your privacy and personal data is a foundational priority. We process personal data strictly in compliance with the revised Swiss Federal Act on Data Protection (FADP / nDSG) and, where applicable, the EU GDPR.'
                  }}
                </p>
                <p>
                  Verantwortliche Stelle: <strong>KuroLIV GmbH</strong>, Färberstrasse 5, 8832 Wollerau, Schweiz (<a href="mailto:privacy@kubotics.ch">privacy&#64;kubotics.ch</a>).
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '2. Erhebung & Bearbeitung von Personendaten' : '2. Collection & Processing of Personal Data' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Wir bearbeiten Daten, die Sie uns über Kontaktformulare, Terminbuchungen, WhatsApp for Business (+41 78 220 68 96) oder Telegram (@Kubotics_bot) übermitteln (z.B. Name, E-Mail-Adresse, Telefonnummer, Firmenzugehörigkeit, Projektbedarf).' :
                    'We process data provided via contact forms, appointment reservations, WhatsApp for Business (+41 78 220 68 96), or Telegram (@Kubotics_bot), such as name, email address, telephone number, organization, and automation project requirements.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '3. Zweck der Datenbearbeitung' : '3. Purpose of Processing' }}</h3>
                <ul class="bullet-list">
                  <li>{{ i18n.lang() === 'de-CH' ? 'Beantwortung von Anfragen und Beratung zu Robotik- und Automationslösungen' : 'Handling inquiries and consulting on robotics and automation architectures' }}</li>
                  <li>{{ i18n.lang() === 'de-CH' ? 'Autonome Terminvereinbarung und Bereitstellung von Microsoft Teams Besprechungslinks' : 'Autonomous calendar slot reservations and Microsoft Teams link generation' }}</li>
                  <li>{{ i18n.lang() === 'de-CH' ? 'Erfüllung vertraglicher und vorvertraglicher Pflichten (Angebote, Testtage)' : 'Execution of pre-contractual and contractual obligations (proposals, test days)' }}</li>
                  <li>{{ i18n.lang() === 'de-CH' ? 'Sicherheit und stabiler Betrieb unserer IT- und Cloud-Infrastruktur' : 'Security and resilient operation of our cloud and database infrastructure' }}</li>
                </ul>

                <h3>{{ i18n.lang() === 'de-CH' ? '4. Speicherung & Datensicherheit' : '4. Storage & Information Security' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Ihre Daten werden sicher auf unserer PostgreSQL-Infrastruktur in zertifizierten AWS-Rechenzentren (Region Frankfurt / eu-central-1) gespeichert. Sämtliche Übertragungen erfolgen verschlüsselt nach aktuellem Stand der Technik (TLS 1.3). Wir geben keine Daten ohne Rechtsgrundlage oder ausdrückliche Einwilligung an unbefugte Dritte weiter.' :
                    'Your data is securely persisted on our managed PostgreSQL database cluster in certified AWS data centers (Region Frankfurt / eu-central-1). All communications are encrypted in transit via state-of-the-art TLS 1.3. Data is never shared with third parties without lawful basis or explicit consent.'
                  }}
                </p>

                <h3>{{ i18n.lang() === 'de-CH' ? '5. Ihre Rechte' : '5. Your Rights as Data Subject' }}</h3>
                <p>
                  {{ i18n.lang() === 'de-CH' ?
                    'Sie haben jederzeit das Recht auf unentgeltliche Auskunft über Ihre gespeicherten personenbezogenen Daten, deren Herkunft, Empfänger und Zweck der Datenbearbeitung sowie ein Recht auf Berichtigung, Sperrung oder Löschung dieser Daten. Wenden Sie sich hierzu an privacy@kubotics.ch.' :
                    'You are entitled at any time to free access to your stored personal data, their origin, recipients, and purpose of processing, as well as the right to rectification, restriction, or erasure. To exercise your rights, please reach out to privacy@kubotics.ch.'
                  }}
                </p>
              </div>
            }
          </div>

          <!-- Footer Action -->
          <div class="modal-footer">
            <button class="btn-close" (click)="closeModal()">
              {{ i18n.lang() === 'de-CH' ? 'Schliessen' : 'Close' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-card {
      background: #0d0d0d;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      width: 100%;
      max-width: 780px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7);
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-header {
      padding: 24px 28px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .header-titles .badge {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #0071e3;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .header-titles h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fff;
      margin-top: 4px;
    }

    .close-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #aaa;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }

    .modal-body {
      padding: 28px;
      overflow-y: auto;
      color: #ccc;
      font-size: 0.9rem;
      line-height: 1.65;
    }

    .legal-content h3 {
      font-size: 1.05rem;
      color: #fff;
      font-weight: 600;
      margin: 22px 0 8px 0;
    }

    .legal-content h3:first-child {
      margin-top: 0;
    }

    .legal-content p {
      margin-bottom: 12px;
      color: #bbb;
    }

    .legal-content a {
      color: #0071e3;
      text-decoration: none;
    }

    .legal-content a:hover {
      text-decoration: underline;
    }

    .bullet-list {
      padding-left: 20px;
      margin-bottom: 16px;
      color: #bbb;
    }

    .bullet-list li {
      margin-bottom: 6px;
    }

    .modal-footer {
      padding: 16px 28px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: flex-end;
    }

    .btn-close {
      padding: 10px 24px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-close:hover {
      background: rgba(255, 255, 255, 0.18);
    }
  `
})
export class LegalModalComponent {
  i18n = inject(I18nService);
  activeModal = signal<LegalModalType>(null);

  openModal(type: LegalModalType) {
    this.activeModal.set(type);
  }

  closeModal() {
    this.activeModal.set(null);
  }

  getTitle(): string {
    const isDe = this.i18n.lang() === 'de-CH';
    switch (this.activeModal()) {
      case 'impressum':
        return isDe ? 'Impressum' : 'Legal Notice & Impressum';
      case 'agb':
        return isDe ? 'Allgemeine Geschäftsbedingungen (AGB)' : 'Terms & Conditions (GTC)';
      case 'datenschutz':
        return isDe ? 'Datenschutzerklärung' : 'Privacy Policy';
      default:
        return '';
    }
  }
}
