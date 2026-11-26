import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from './analytics.service';

type DLWindow = {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
};

/**
 * GTM_MIGRATION_ANALYSIS_2026-11-15.md deliverables 2+3 — typed dataLayer
 * pushes, event_id on conversions, page_view dedupe, gtag bridge.
 */
describe('AnalyticsService', () => {
  let svc: AnalyticsService;
  const win = window as unknown as DLWindow;

  const entries = () => (win.dataLayer ?? []) as Record<string, unknown>[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    svc = TestBed.inject(AnalyticsService);
    win.dataLayer = []; // index.html normally creates it; fresh per test
    delete win.gtag;
  });

  it('pushes canonical {event, ...params} objects', () => {
    svc.track('cta_click', { button: 'hero', section: 'home' });
    expect(entries()).toEqual([
      { event: 'cta_click', button: 'hero', section: 'home' },
    ]);
  });

  it('adds event_id to conversion events only', () => {
    svc.track('generate_lead', { form: 'contact' });
    const lead = entries()[0];
    expect(lead['event']).toBe('generate_lead');
    expect(String(lead['event_id']).length).toBeGreaterThan(10);

    svc.track('roi_result_view', { score: 42 });
    expect(entries()[1]['event_id']).toBeUndefined();
  });

  it('keeps a caller-supplied event_id (success-callback dedupe id)', () => {
    svc.track('schedule_appointment', { event_id: 'lead-123' });
    expect(entries()[0]['event_id']).toBe('lead-123');
  });

  it('page_view dedupes per URL: one push per history change', () => {
    svc.pageView('/automation/it-business-process-automation');
    svc.pageView('/automation/it-business-process-automation'); // same target
    svc.pageView('/'); // changed
    expect(entries().length).toBe(2);
    expect(entries()[0]['event']).toBe('page_view');
    expect(String(entries()[0]['page_location'])).toContain(
      '/automation/it-business-process-automation',
    );
  });

  it('initRouterTracking emits the current URL once, double init safe', () => {
    svc.initRouterTracking();
    svc.initRouterTracking();
    const views = entries().filter((e) => e['event'] === 'page_view');
    expect(views.length).toBe(1);
  });

  it('gtagForward calls window.gtag when present, no-ops when absent', () => {
    const calls: unknown[][] = [];
    win.gtag = (...args: unknown[]) => calls.push(args);
    svc.gtagForward('qualify_lead', { tier: 'high' });
    expect(calls).toEqual([['event', 'qualify_lead', { tier: 'high' }]]);

    delete win.gtag;
    expect(() => svc.gtagForward('qualify_lead')).not.toThrow();
  });

  it('trackAdsConversion sends the Google Ads event snippet (default send_to)', () => {
    const calls: unknown[][] = [];
    win.gtag = (...args: unknown[]) => calls.push(args);
    svc.trackAdsConversion();
    expect(calls).toEqual([
      ['event', 'conversion', { send_to: 'AW-17955497634/JUoDCK_prLwdEKLN7PFC' }],
    ]);

    svc.trackAdsConversion('AW-17955497634/OTHER_label');
    expect(calls[1]).toEqual([
      'event', 'conversion', { send_to: 'AW-17955497634/OTHER_label' },
    ]);

    delete win.gtag;
    expect(() => svc.trackAdsConversion()).not.toThrow();
  });

  it('trackMetaEvent sends the Meta pixel standard event, no-ops without fbq', () => {
    const calls: unknown[][] = [];
    win.fbq = (...args: unknown[]) => calls.push(args);
    svc.trackMetaEvent('Lead');
    expect(calls).toEqual([['track', 'Lead']]);

    svc.trackMetaEvent('Schedule');
    expect(calls[1]).toEqual(['track', 'Schedule']);

    delete win.fbq;
    expect(() => svc.trackMetaEvent('Lead')).not.toThrow();
  });
});
