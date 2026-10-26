import { Injectable, inject } from '@angular/core';
import { I18nService } from './i18n';

export type LeadTopic = 
  | 'h2_testday'
  | 'g1_robotics'
  | 'b2_quadruped'
  | 'factory_arms'
  | 'erp_planning'
  | 'llm_invoices'
  | 'chatbots_voice'
  | 'roi_calculator'
  | 'general';

@Injectable({
  providedIn: 'root'
})
export class ChannelLinkService {
  private i18n = inject(I18nService);
  
  // Official Kubotics WhatsApp for Business number
  readonly whatsappPhone = '41782206896';
  // Official Telegram Bot Handle
  readonly telegramBot = 'Kubotics_bot';

  private topicTexts: Record<LeadTopic, { de: string; en: string; tgPayload: string }> = {
    h2_testday: {
      de: 'Grüezi Kubotics Team, ich interessiere mich für einen Unitree H2 Humanoid Testtag & Beratung in der Schweiz.',
      en: 'Hello Kubotics team, I am interested in scheduling a Unitree H2 Humanoid Test Day & consultation in Switzerland.',
      tgPayload: 'h2_testday'
    },
    g1_robotics: {
      de: 'Grüezi Kubotics Team, ich interessiere mich für die agile Unitree G1 / G1-D humanoide Plattform.',
      en: 'Hello Kubotics team, I would like to learn more about the Unitree G1 humanoid platform.',
      tgPayload: 'g1_robot'
    },
    b2_quadruped: {
      de: 'Grüezi Kubotics Team, ich interessiere mich für den vierbeinigen Industrieroboter Unitree B2.',
      en: 'Hello Kubotics team, I am inquiring about the Unitree B2 autonomous industrial quadruped.',
      tgPayload: 'b2_quadruped'
    },
    factory_arms: {
      de: 'Grüezi Kubotics Team, ich plane eine Fabrikautomation mit Roboterarmen / Roboterzellen nach Mass.',
      en: 'Hello Kubotics team, I am planning a custom factory automation project with robotic arms.',
      tgPayload: 'factory_arms'
    },
    erp_planning: {
      de: 'Grüezi Kubotics Team, ich interessiere mich für automatisierte Ressourcen- und Einsatzplanung im ERP.',
      en: 'Hello Kubotics team, I am interested in automated ERP resource and workforce planning.',
      tgPayload: 'erp_planning'
    },
    llm_invoices: {
      de: 'Grüezi Kubotics Team, wir möchten unsere Rechnungsverarbeitung mit multimodalen LLMs automatisieren.',
      en: 'Hello Kubotics team, we want to automate our invoice processing with multimodal LLMs.',
      tgPayload: 'llm_invoices'
    },
    chatbots_voice: {
      de: 'Grüezi Kubotics Team, ich interessiere mich für autonome KI-Chatbots & Voice Bots (SIP, MS Teams, WhatsApp, Telegram).',
      en: 'Hello Kubotics team, I am interested in autonomous AI Chatbots & Voice Bots (SIP, MS Teams, WhatsApp, Telegram).',
      tgPayload: 'chatbots_voice'
    },
    roi_calculator: {
      de: 'Grüezi Kubotics Team, ich habe Ihren ROI-Rechner genutzt und möchte eine detaillierte Machbarkeit prüfen.',
      en: 'Hello Kubotics team, I used your ROI calculator and would like to verify feasibility.',
      tgPayload: 'roi_report'
    },
    general: {
      de: 'Grüezi Kubotics Team, ich interessiere mich für Ihre Robotik- und Automationslösungen.',
      en: 'Hello Kubotics team, I am interested in your robotics and automation solutions.',
      tgPayload: 'website_lead'
    }
  };

  /**
   * Generates a direct WhatsApp Click-to-Chat deep link customized with topic and current language.
   */
  getWhatsAppLink(topic: LeadTopic = 'general', customPrefix?: string): string {
    const lang = this.i18n.lang();
    const config = this.topicTexts[topic] || this.topicTexts.general;
    let message = lang === 'de-CH' ? config.de : config.en;
    if (customPrefix) {
      message = `${customPrefix} ${message}`;
    }
    return `https://wa.me/${this.whatsappPhone}?text=${encodeURIComponent(message)}`;
  }

  /**
   * Generates a Telegram deep link with start parameter payload so the bot knows the exact topic.
   */
  getTelegramLink(topic: LeadTopic = 'general'): string {
    const config = this.topicTexts[topic] || this.topicTexts.general;
    return `https://t.me/${this.telegramBot}?start=${config.tgPayload}`;
  }
}
