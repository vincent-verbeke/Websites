import { TestBed } from '@angular/core/testing';
import { GtmService } from './gtm.service';
import { environment } from '../../../environments/environment';

/**
 * GTM_MIGRATION_ANALYSIS_2026-11-15.md §3 Phase 1: loader from ONE env,
 * loaded once, empty id = inert (today's state + rollback lever).
 * Note: specs run against the DEV environment (fileReplacements only swap
 * environment.prod.ts into production builds).
 */
describe('GtmService', () => {
  const originalId = environment.gtmId;
  const gtmScripts = () =>
    Array.from(document.querySelectorAll('script')).filter((s) =>
      s.src.includes('googletagmanager.com/gtm.js'),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({});
    gtmScripts().forEach((s) => s.remove());
    (window as unknown as { dataLayer?: unknown[] }).dataLayer = [];
    environment.gtmId = '';
  });

  afterEach(() => {
    environment.gtmId = originalId;
    gtmScripts().forEach((s) => s.remove());
  });

  it('stays inert with an empty container id (default + rollback)', () => {
    TestBed.inject(GtmService).init();
    expect(gtmScripts().length).toBe(0);
    expect((window as unknown as { dataLayer?: unknown[] }).dataLayer).toEqual(
      [],
    );
  });

  it('loads gtm.js once with the gtm.start bootstrap event', () => {
    environment.gtmId = 'GTM-TEST123';
    const svc = TestBed.inject(GtmService);
    svc.init();
    svc.init(); // double init must not add a second script

    expect(gtmScripts().length).toBe(1);
    expect(gtmScripts()[0].src).toContain('id=GTM-TEST123');
    expect(gtmScripts()[0].async).toBe(true);

    const dl = (
      window as unknown as { dataLayer?: Record<string, unknown>[] }
    ).dataLayer;
    expect(dl?.length).toBe(1);
    expect(dl?.[0]['event']).toBe('gtm.js');
    expect(typeof dl?.[0]['gtm.start']).toBe('number');
  });

  it('ignores surrounding whitespace in the id', () => {
    environment.gtmId = '  GTM-WHITESPACE  ';
    TestBed.inject(GtmService).init();
    expect(gtmScripts().length).toBe(1);
    expect(gtmScripts()[0].src).toContain('id=GTM-WHITESPACE');
  });
});
