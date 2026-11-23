import { describe, expect, it } from 'vitest';
import {
  WELCOME_COPY,
  welcomePageKey,
  visitorChatLang
} from './lead-agent.service';

/**
 * Vincent 2026-11-23: the chat's default sentence must be dependent on the
 * landing page and always in the language of the user. These tests pin the
 * pure helpers the LeadAgentService welcome uses (no TestBed needed).
 */
describe('landing-page-dependent welcome copy', () => {
  it('maps every route to its welcome page key', () => {
    expect(welcomePageKey('/')).toBe('home');
    expect(welcomePageKey('')).toBe('home');
    expect(welcomePageKey('/automation/it-business-process-automation'))
      .toBe('it-bpa');
    expect(welcomePageKey('/automation/it-business-process-automation/'))
      .toBe('it-bpa');
    expect(welcomePageKey('/automation/cnc-machine-tending')).toBe('cnc');
    expect(welcomePageKey('/automation/invoice-processing')).toBe('invoice');
    expect(welcomePageKey('/marketing/ai-marketing-sales')).toBe('ai-marketing');
    expect(welcomePageKey('/robotics/unitree-h2-test-day')).toBe('h2');
    expect(welcomePageKey('/automation/discovery')).toBe('discovery');
    // legal/unknown routes fall back to the generic welcome
    expect(welcomePageKey('/datenschutz')).toBe('home');
    expect(welcomePageKey('/nope')).toBe('home');
  });

  it('has non-empty welcome text and chips in de/en/fr/it for every page', () => {
    for (const [page, byLang] of Object.entries(WELCOME_COPY)) {
      for (const lang of ['de', 'en', 'fr', 'it'] as const) {
        const copy = byLang[lang];
        expect(copy, `missing copy: ${page}/${lang}`).toBeTruthy();
        expect(copy.text.length, `short text: ${page}/${lang}`).toBeGreaterThan(40);
        expect(copy.chips.length, `no chips: ${page}/${lang}`).toBeGreaterThan(0);
        for (const chip of copy.chips) {
          expect(chip.trim()).toBe(chip);
          expect(chip.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the focused IT-automation page opens with its own offer', () => {
    expect(WELCOME_COPY['it-bpa'].de.chips[0])
      .toBe('Kostenlose Automatisierungsanalyse');
    expect(WELCOME_COPY['it-bpa'].de.text)
      .toContain('IT- & Geschäftsprozess-Automatisierung');
    expect(WELCOME_COPY['it-bpa'].en.chips[0])
      .toBe('Free automation analysis');
    expect(WELCOME_COPY['it-bpa'].en.text)
      .toContain('IT & business process automation');
    // the homepage keeps the original German default sentence verbatim
    expect(WELCOME_COPY['home'].de.text).toContain(
      'Ich bin Ihr technischer Kubotics Sales Engineer'
    );
  });

  it('derives the chat language from the browser locale like the backend', () => {
    expect(visitorChatLang('de-CH')).toBe('de');
    expect(visitorChatLang('fr-CA')).toBe('fr');
    expect(visitorChatLang('it-CH')).toBe('it');
    expect(visitorChatLang('en-US')).toBe('en');
    expect(visitorChatLang('nl-NL')).toBe('en'); // no Dutch copy -> English
    expect(visitorChatLang('es-ES')).toBe('de');  // site default (de-CH)
    expect(visitorChatLang(undefined)).toBe('de');
  });
});
