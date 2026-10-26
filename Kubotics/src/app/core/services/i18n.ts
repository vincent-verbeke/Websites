import { Injectable, signal, computed } from '@angular/core';

export type Lang = 'de-CH' | 'en';

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  private currentLang = signal<Lang>('de-CH');
  
  lang = this.currentLang.asReadonly();

  translations: any = {
    'de-CH': {
      NAV: {
        TECH: 'Roboter & Technologie',
        SOLUTIONS: 'Lösungen & Automation',
        ROI: 'ROI Rechner',
        READINESS: 'Reifegrad-Check',
        IT_AUTOMATION: 'IT-Geschäftsprozesse',
        COMPANY: 'Über uns',
        CONTACT: 'Kontakt & Demo'
      },
      HERO: {
        BADGE: 'SWISS PRECISION • HUMANOID SPECIALIST • IT AUTOMATION',
        TITLE: 'KUBOTICS',
        SUBTITLE: 'Humanoide Robotik, Fabrikautomation & KI-gestützte Geschäftsprozesse',
        TAGLINE: 'Offizieller Partner & Spezialist für Unitree-Roboter in der Schweiz und Europa.',
        PROBLEM_PROMPT_LABEL: 'WAS MÖCHTEN SIE AUTOMATISIEREN?',
        PROBLEM_PLACEHOLDER: 'z.B. Maschinenbeschickung CNC, Belegprüfung, H2 Testtag...',
        CHIP_CNC: 'Maschinenbeschickung (CNC)',
        CHIP_H2: 'Unitree H2 Humanoid',
        CHIP_INVOICE: 'Rechnungs- & Beleg-LLM',
        CHIP_ARMS: 'Fabrik-Roboterarme',
        CHIP_LOGISTICS: 'Palettierung & Logistik',
        CTA_ANALYZE: 'POTENZIAL PRÜFEN',
        CTA_PRIMARY: 'AUTOMATIONSBEDARF BESCHREIBEN',
        CTA_SECONDARY: 'ROBOTER & TECH',
        CTA_TESTDAY: 'H2 MACHBARKEIT PRÜFEN'
      },
      ABOUT: {
        TITLE: 'ÜBER UNS',
        P1: 'Kubotics entstand aus demselben Geist, der auch KuroLIV geprägt hat: dem Glauben, dass Technologie präzise, zielgerichtet und manchmal auch mutig sein muss. Inspiriert von Kuro, unserem Shiba Inu, verbinden wir Neugier, Entschlossenheit und den Mut, Probleme aus ungewöhnlichen Perspektiven zu lösen.',
        P2: 'Wie der Shiba vereinen wir Disziplin mit Eigenständigkeit. Schweizer Ingenieurspräzision bildet unser Fundament, doch unsere wahre Stärke liegt im kreativen Denken – darin, elegante Lösungen zu finden, wo andere nur Komplexität sehen.',
        P3: 'Unser Fokus liegt auf bedeutungsvollen Interaktionen: zwischen Mensch und Roboter sowie zwischen Robotern selbst. Bei Kubotics trifft hartnäckiger Einfallsreichtum auf Schweizer Präzision – und verwandelt mutige Ideen in intelligente Systeme für jede Interaktion.',
        P4: 'Aus dieser Überzeugung heraus realisieren wir heute ganzheitliche Automationslösungen: Wir liefern modernste Robotersysteme von Unitree mit Fokus auf die humanoide Flaggschiff-Plattform H2, entwickeln massgeschneiderte Fabrikautomation mit Roboterarmen nach Mass und vernetzen diese nahtlos mit intelligenter IT.',
        P5: 'Von der automatisierten Ressourcen- und Einsatzplanung bis zur multimodalen Rechnungsverarbeitung, die dank fortschrittlicher LLMs selbst minderwertige Scans und Dokumente zuverlässig erfasst – wir automatisieren die komplexen Prozesse rund um Ihre operative Wertschöpfung.'
      },
      TECH: {
        H2_TITLE: 'UNITREE H2 — Humanoide Exzellenz',
        H2_DESC: 'Das Flaggschiff unter den humanoiden Industrie- und Forschungsrobotern. 31 Freiheitsgrade, bis zu 360 Nm Gelenkmoment und integrierte Sensorik für fortgeschrittene Mensch-Roboter-Kollaboration. Wir liefern das Gesamtsystem inklusive Schweizer Support und Inbetriebnahme.',
        H2_CTA: 'Beratungs- & Testtag buchen',
        G1_TITLE: 'UNITREE G1 & G1-D — Agil & Kollaborativ',
        G1_DESC: 'Kompakte humanoide Plattform für Entwicklung, Schulung und industrielle Aufgaben. Unterstützt modernste KI-Steuerungen (GROOT, PI 0.5) und nahtlose Flottenkoordination.',
        QUAD_TITLE: 'UNITREE B2 — Autonome Industrieroboter-Hunde',
        QUAD_DESC: 'Hochbelastbare vierbeinige Roboterplattform für anspruchsvolle Inspektions- und Patrouillenaufgaben in Fabriken, Bauwerken und unwegsamem Gelände. IP67-zertifiziert, 40 kg Traglast.'
      },
      SOLUTIONS: {
        TITLE: 'Leistungsportfolio & Automationslösungen',
        SUBTITLE: 'Massgeschneiderte Automationslösungen nach Kundenbedarf',
        CAT1_TITLE: 'Humanoide & Mobile Robotik',
        CAT1_DESC: 'Beschaffung, Testtage, Sicherheitsgutachten und schlüsselfertige Integration von Unitree-Robotern (H2, G1, B2) für Labor, Fabrik und Showroom.',
        CAT2_TITLE: 'Fabrikautomation & Roboterarme',
        CAT2_DESC: 'Massgeschneiderte Roboterzellen, kollaborative Roboterarme (Cobots) für Maschinenbeschickung, Pick-and-Place, Qualitätskontrolle und automatisierte Montagelinien.',
        CAT3_TITLE: 'IT-Geschäftsprozess-Automation',
        CAT3_DESC: 'End-to-End-Automatisierung von Ressourcen- und Personaleinsatzplanung (ERP), Auftragssteuerung und nahtlose Verknüpfung von operativer IT mit Hallenböden.',
        CAT4_TITLE: 'Intelligente Rechnungsverarbeitung mit LLMs',
        CAT4_DESC: 'Automatisierte Verarbeitung ausgehender und eingehender Belege. Multimodale KI-Modelle erfassen selbst schlechte Scans, Knicke, Faxe und handschriftliche Vermerke direkt in Ihr ERP/Buchhaltungssystem.',
        CAT5_TITLE: 'Autonome KI-Chatbots & Voice Bots',
        CAT5_DESC: 'Omnichannel Voice- & Chat-Agenten mit tiefer CRM- und ERP-Integration: Telefonie & SIP/VoIP, Microsoft Teams, WhatsApp for Business, Telegram und Web-Chat. Ultraschnelle Sprachverarbeitung (~100ms) mit autonomer Kalenderbuchung.',
        CUSTOM_CTA: 'INDIVIDUELLE ANFRAGE'
      },
      ROI: {
        BADGE: 'WIRTSCHAFTLICHE RENTABILITÄT & ROI',
        TITLE: 'Berechnen Sie Ihr Einsparpotenzial',
        SUBTITLE: 'Ermitteln Sie die messbare Rentabilität durch automatisierte Dokumentenerfassung, Roboterarm-Maschinenbeschickung oder humanoide Pilotprojekte.',
        SELECT_AREA: 'AUTOMATIONSBEREICH WÄHLEN',
        PRESET_INVOICE: 'Rechnungs- & Dokumenten-LLM',
        PRESET_FACTORY: 'Fabrik-Roboterarm / Cobot',
        PRESET_HUMANOID: 'Unitree H2 Humanoid Pilot',
        MONTHLY_DOCS: 'Monatlich verarbeitete Belege',
        DOCS_PER_MONTH: 'Belege/Monat',
        MANUAL_COST: 'Kosten je manuelle Belegprüfung (CHF)',
        COST_PER_DOC: 'CHF / Beleg',
        SHIFT_HOURS: 'Täglich automatisierte Schichtstunden',
        HOURS_PER_DAY: 'Stunden / Tag',
        HOURLY_RATE: 'Vollkosten-Stundensatz',
        CHF_PER_HR: 'CHF / Std.',
        PILOT_MONTHS: 'Laufzeit des Pilotprojekts',
        MONTHS: 'Monate',
        TEAM_SIZE: 'Beteiligte Ingenieure / Entwickler',
        ENGINEERS: 'Ingenieure',
        ANNUAL_IMPACT: 'GESCHÄTZTER JAHRESVORTEIL',
        SAVINGS_SUB: 'Reine Einsparungen & freigesetzte Kapazität pro Jahr',
        METRIC_TIME: 'ZEITERSPARNIS',
        METRIC_TIME_VAL: 'Std./Jahr',
        METRIC_ERROR: 'FEHLERREDUKTION',
        METRIC_PAYBACK: 'AMORTISATIONSDAUER',
        METRIC_UPTIME: 'SYSTEM-VERFÜGBARKEIT',
        CTA_AI_BRIEF: 'Detaillierten Machbarkeitsbericht anfordern',
        CTA_BOOK: 'Testtag / Beratungsgespräch buchen',
        FOOTNOTE: 'Basierend auf empirischen Schweizer Industrie-Benchmarks und multimodalen LLM-Messwerten.'
      },
      ASSESSMENT: {
        BADGE: 'AUTOMATION READINESS ASSESSMENT',
        TITLE: 'Sind Ihre Prozesse bereit für KI & Robotik?',
        SUBTITLE: 'Beantworten Sie 5 kurze Fragen zur operativen Reife Ihres Unternehmens und erhalten Sie Ihren sofortigen Automations-Score sowie konkrete Handlungsempfehlungen.',
        SCORE_LABEL: 'AUTOMATION READINESS SCORE',
        READY_TITLE: 'Status: Bereit für operative Umsetzung (Ready)',
        READY_DESC: 'Ihre Prozesse und Datenstrukturen bieten hervorragende Voraussetzungen für die unmittelbare Einführung von Robotikzellen, LLM-Extraktion oder autonomen Agenten.',
        PREWORK_TITLE: 'Status: Vorbereitende Massnahmen empfohlen (Pre-Work Needed)',
        PREWORK_DESC: 'Grosses Automationspotenzial vorhanden. Wir empfehlen eine strukturierte Prozessharmonisierung oder einen Pilot-Testtag vor der breiten Skalierung.',
        CTA_CONSULT: 'Individuelle Potenzialanalyse anfordern',
        CTA_WHATSAPP: 'Ergebnis via WhatsApp besprechen',
        CTA_TELEGRAM: 'Ergebnis via Telegram besprechen'
      },
      CONTACT: {
        TITLE: 'Sprechen Sie mit unseren Automations-Spezialisten',
        SUBTITLE: 'Vereinbaren Sie einen Unitree H2 Testtag oder ein technisches Beratungsgespräch.',
        DATE: 'Bevorzugtes Datum Beratungs- & Testtag (Optional)',
        USECASE: 'Projekt- / Automationsbedarf',
        USECASE_PLACEHOLDER: 'z.B. Testtag Unitree H2, automatisierte Rechnungsverarbeitung, Roboterzelle für Maschinenbeschickung...',
        SUBMIT_SUCCESS: 'Vielen Dank für Ihre Anfrage! Unser Team meldet sich innerhalb von 24 Stunden bei Ihnen.',
        INSTANT_TITLE: 'Direkter Sofort-Kontakt via WhatsApp oder Telegram',
        INSTANT_SUBTITLE: 'Schreiben oder sprechen Sie direkt mit unserem KI-Spezialisten & Gründern – Antwort innerhalb von Sekunden.',
        WHATSAPP_BTN: 'WhatsApp Chat starten',
        TELEGRAM_BTN: 'Telegram Voice / Chat'
      },
      COOKIE: {
        TITLE: 'Datenschutz & Privatsphäre-Einstellungen',
        TEXT: 'Wir nutzen Cookies und Webanalyse (Google Analytics & Google Consent Mode v2), um die Funktionalität unserer Website und unserer KI-Dienste kontinuierlich zu optimieren. Daten werden anonymisiert verarbeitet.',
        ACCEPT_ALL: 'Alle akzeptieren',
        ESSENTIAL_ONLY: 'Nur essenzielle Cookies',
        SETTINGS: 'Details anzeigen',
        LEARN_MORE: 'Mehr in unserer Datenschutzerklärung'
      }
    },
    'en': {
      NAV: {
        TECH: 'Robots & Tech',
        SOLUTIONS: 'Solutions & Automation',
        ROI: 'ROI Calculator',
        READINESS: 'Readiness Check',
        IT_AUTOMATION: 'IT Business Automation',
        COMPANY: 'About Us',
        CONTACT: 'Contact & Demo'
      },
      HERO: {
        BADGE: 'SWISS PRECISION • HUMANOID SPECIALIST • IT AUTOMATION',
        TITLE: 'KUBOTICS',
        SUBTITLE: 'Humanoid Robotics, Factory Automation & AI-Driven Business Processes',
        TAGLINE: 'Official partner and specialist for Unitree Robots in Switzerland and Europe.',
        PROBLEM_PROMPT_LABEL: 'WHAT WOULD YOU LIKE TO AUTOMATE?',
        PROBLEM_PLACEHOLDER: 'e.g. CNC machine tending, invoice extraction, H2 test day...',
        CHIP_CNC: 'Machine Tending (CNC)',
        CHIP_H2: 'Unitree H2 Humanoid',
        CHIP_INVOICE: 'Invoice & Document LLM',
        CHIP_ARMS: 'Factory Robotic Arms',
        CHIP_LOGISTICS: 'Palletizing & Logistics',
        CTA_ANALYZE: 'ANALYZE POTENTIAL',
        CTA_PRIMARY: 'DESCRIBE AUTOMATION NEED',
        CTA_SECONDARY: 'ROBOTICS & TECH',
        CTA_TESTDAY: 'ASSESS H2 FEASIBILITY'
      },
      ABOUT: {
        TITLE: 'ABOUT US',
        P1: 'Kubotics was born from the same spirit that shaped KuroLIV: a belief that technology should be precise, purposeful, and a little bit fearless. Inspired by Kuro, our Shiba Inu, we embrace curiosity, determination, and the confidence to approach challenges from unexpected angles.',
        P2: 'Like the Shiba, we combine discipline with independence. Swiss engineering precision forms our foundation, but our strength lies in creative problem-solving—finding elegant solutions where others see complexity.',
        P3: 'Our work focuses on meaningful interaction: between humans and robots, and between robots themselves. At Kubotics, stubborn ingenuity meets Swiss precision, turning bold ideas into intelligent systems designed for every interaction.',
        P4: 'Grounded in this ethos, we engineer turnkey industrial solutions: delivering cutting-edge robotics from Unitree with specialized expertise on the flagship humanoid H2, building custom factory automation with robotic arms tailored to specific production cells, and bridging hardware with intelligent software.',
        P5: 'From automated enterprise resource planning (ERP) to intelligent incoming and outgoing invoice processing using multimodal LLMs that reliably parse low-quality scans—we automate the critical workflows that drive real business performance.'
      },
      TECH: {
        H2_TITLE: 'UNITREE H2 — Humanoid Excellence',
        H2_DESC: 'The premier humanoid robot for research and industrial deployment. Featuring 31 degrees of freedom, 360Nm peak joint torque, and integrated perception for advanced human-robot collaboration. We provide turnkey delivery, Swiss support, and on-site setup.',
        H2_CTA: 'Book a Consulting & Test Day',
        G1_TITLE: 'UNITREE G1 & G1-D — Agile & Collaborative',
        G1_DESC: 'Compact humanoid platform for development, training, and commercial applications. Built for policy learning (PI 0.5, GROOT) and unified fleet integration.',
        QUAD_TITLE: 'UNITREE B2 — Autonomous Industrial Quadruped',
        QUAD_DESC: 'Heavy-duty quadruped inspection robot for industrial plants, construction, and hazardous terrains. IP67 rated, 6 m/s speed, with up to 40 kg payload capacity.'
      },
      SOLUTIONS: {
        TITLE: 'Solutions Portfolio',
        SUBTITLE: 'Customized Automation Solutions Engineered to Customer Specifications',
        CAT1_TITLE: 'Humanoid & Mobile Robotics',
        CAT1_DESC: 'Delivery, test days, safety compliance, and turnkey deployment of Unitree robots (H2, G1, B2) for industrial testing, labs, and commercial facilities.',
        CAT2_TITLE: 'Factory Automation & Robot Arms',
        CAT2_DESC: 'Customized robotic cells and collaborative arms for machine tending, pick-and-place, assembly, and automated optical inspection (AOI).',
        CAT3_TITLE: 'IT Business Process Automation',
        CAT3_DESC: 'End-to-end automation of enterprise resource planning (ERP), shift scheduling, dispatching, and bidirectional synchronization between IT and the factory floor.',
        CAT4_TITLE: 'Intelligent Invoicing & Document LLMs',
        CAT4_DESC: 'Automated outgoing and incoming invoice processing. Multimodal LLMs understand low-quality scans, wrinkled paper, receipts, and multilingual documents directly into accounting systems.',
        CAT5_TITLE: 'Autonomous Voice & Messaging Chatbots',
        CAT5_DESC: 'Enterprise conversational AI across voice and messaging: SIP/VoIP telephony, Microsoft Teams, WhatsApp for Business, Telegram, and Web Chat. Sub-100ms voice latency with native CRM/ERP and calendar synchronization.',
        CUSTOM_CTA: 'CUSTOM REQUEST'
      },
      ROI: {
        BADGE: 'COMMERCIAL IMPACT & ROI',
        TITLE: 'Calculate Your Automation Savings',
        SUBTITLE: 'See the quantifiable return on automating manual document processing, robot arm CNC tending, or humanoid pilot operations.',
        SELECT_AREA: 'SELECT AUTOMATION AREA',
        PRESET_INVOICE: 'Invoice & Document LLM',
        PRESET_FACTORY: 'Factory Robot Arm / Cobot',
        PRESET_HUMANOID: 'Unitree H2 Humanoid Pilot',
        MONTHLY_DOCS: 'Monthly Invoices Processed',
        DOCS_PER_MONTH: 'docs/month',
        MANUAL_COST: 'Cost per Manual Processing (CHF)',
        COST_PER_DOC: 'CHF / doc',
        SHIFT_HOURS: 'Daily Shift Hours Automated',
        HOURS_PER_DAY: 'hours / day',
        HOURLY_RATE: 'Fully-Loaded Hourly Labor Rate',
        CHF_PER_HR: 'CHF / hr',
        PILOT_MONTHS: 'Enterprise R&D / Pilot Duration',
        MONTHS: 'Months',
        TEAM_SIZE: 'Engineering Team Size Involved',
        ENGINEERS: 'Engineers',
        ANNUAL_IMPACT: 'ESTIMATED ANNUAL IMPACT',
        SAVINGS_SUB: 'Net savings & capacity unlocked per year',
        METRIC_TIME: 'TIME RECLAIMED',
        METRIC_TIME_VAL: 'hrs/yr',
        METRIC_ERROR: 'ERROR REDUCTION',
        METRIC_PAYBACK: 'ESTIMATED PAYBACK',
        METRIC_UPTIME: 'SYSTEM UPTIME',
        CTA_AI_BRIEF: 'Get Detailed Feasibility Brief',
        CTA_BOOK: 'Book Test Day / Discovery Call',
        FOOTNOTE: 'Based on empirical Swiss industrial manufacturing benchmarks & multimodal LLM pipeline telemetry.'
      },
      ASSESSMENT: {
        BADGE: 'AUTOMATION READINESS ASSESSMENT',
        TITLE: 'Are Your Business Workflows Ready for Robotics & AI?',
        SUBTITLE: 'Answer 5 rapid operational maturity questions to receive your instant readiness score and recommended next steps.',
        SCORE_LABEL: 'AUTOMATION READINESS SCORE',
        READY_TITLE: 'Status: Ready for Implementation (Ready)',
        READY_DESC: 'Your workflows, documentation, and data architecture are well-positioned for immediate robotic arm cells, LLM pipelines, or autonomous agent deployment.',
        PREWORK_TITLE: 'Status: Preparatory Optimization Recommended (Pre-Work Needed)',
        PREWORK_DESC: 'High automation potential identified. We recommend standardizing manual handoffs and running a focused pilot or test day before broad rollout.',
        CTA_CONSULT: 'Request Detailed Readiness Audit',
        CTA_WHATSAPP: 'Discuss Results via WhatsApp',
        CTA_TELEGRAM: 'Discuss Results via Telegram'
      },
      CONTACT: {
        TITLE: 'Connect with our Automation Engineers',
        SUBTITLE: 'Schedule a Unitree H2 Test Day or a technical feasibility consultation.',
        DATE: 'Preferred Date Consulting & Test Day (Optional)',
        USECASE: 'Project & Automation Requirements',
        USECASE_PLACEHOLDER: 'e.g. Unitree H2 Test Day, LLM invoice extraction, customized robot arm for CNC tending...',
        SUBMIT_SUCCESS: 'Thank you for contacting us! Our team will get back to you within 24 hours.',
        INSTANT_TITLE: 'Instant Direct Connect via WhatsApp & Telegram',
        INSTANT_SUBTITLE: 'Message or speak directly with our AI Specialist & engineering team in seconds.',
        WHATSAPP_BTN: 'Start WhatsApp Chat',
        TELEGRAM_BTN: 'Telegram Voice / Chat'
      },
      COOKIE: {
        TITLE: 'Privacy & Cookie Preferences',
        TEXT: 'We use cookies and web analytics (Google Analytics & Google Consent Mode v2) to continuously measure and improve our site performance and AI capabilities. Telemetry is anonymized.',
        ACCEPT_ALL: 'Accept All',
        ESSENTIAL_ONLY: 'Essential Only',
        SETTINGS: 'Cookie Details',
        LEARN_MORE: 'Learn more in our Privacy Policy'
      }
    }
  };

  setLanguage(lang: Lang) {
    this.currentLang.set(lang);
  }

  t(path: string): string {
    const keys = path.split('.');
    let result = this.translations[this.currentLang()];
    for (const key of keys) {
      if (result) result = result[key];
    }
    return result || path;
  }
}

