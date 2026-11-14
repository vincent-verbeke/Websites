import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CLOUD_API_BASE,
  CLOUD_TAB_IDS,
  DashboardConfigService,
  H2_LOCAL_TAB_IDS,
  MODE_FILE,
} from './dashboard-config.service';

/**
 * H2 light dashboard (H2_LIGHT_DASHBOARD_PLAN_2026-11-14.md §2):
 * one artifact, runtime mode file. Fail-soft contract — a missing/broken
 * mode file must keep today's cloud behavior byte-identical.
 */
describe('DashboardConfigService', () => {
  let http: HttpTestingController;
  let svc: DashboardConfigService;

  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(DashboardConfigService);
  }

  afterEach(() => http.verify());

  it('defaults to cloud when the mode file is missing (404)', () => {
    setup();
    let result: boolean | undefined;
    svc.load().subscribe((v) => (result = v));

    http
      .expectOne(MODE_FILE)
      .flush('not found', { status: 404, statusText: 'Not Found' });

    expect(result).toBe(false);
    expect(svc.isLocal()).toBe(false);
    expect(svc.apiBase()).toBe(CLOUD_API_BASE);
    expect(svc.allowedTabIds().length).toBe(CLOUD_TAB_IDS.length);
    expect(svc.loaded()).toBe(true);
  });

  it('h2-local drops the cloud tabs and switches the api base', () => {
    setup();
    svc.load().subscribe();
    http
      .expectOne(MODE_FILE)
      .flush({ mode: 'h2-local', apiBase: 'http://localhost:8001/api/v1/' });

    expect(svc.isLocal()).toBe(true);
    // trailing slash trimmed so `${apiBase}/dashboard/...` never doubles up
    expect(svc.apiBase()).toBe('http://localhost:8001/api/v1');

    const ids = svc.allowedTabIds();
    expect(ids.length).toBe(H2_LOCAL_TAB_IDS.length);
    expect(ids).not.toContain('investments');
    expect(ids).not.toContain('sessions');
    for (const local of ['overview', 'motion', 'management', 'system']) {
      expect(ids).toContain(local);
    }
  });

  it('cloud mode file keeps all 16 tabs', () => {
    setup();
    svc.load().subscribe();
    http
      .expectOne(MODE_FILE)
      .flush({ mode: 'cloud', apiBase: CLOUD_API_BASE });

    expect(svc.isLocal()).toBe(false);
    expect(svc.allowedTabIds()).toEqual(CLOUD_TAB_IDS);
    expect(svc.allowedTabIds().length).toBe(16);
  });

  it('unknown mode / empty apiBase falls back to cloud, loads only once', () => {
    setup();
    svc.load().subscribe();
    http.expectOne(MODE_FILE).flush({ mode: 'weird', apiBase: '   ' });

    expect(svc.isLocal()).toBe(false);
    expect(svc.apiBase()).toBe(CLOUD_API_BASE);

    // idempotent: a second load() issues no further request
    svc.load().subscribe();
    http.expectNone(MODE_FILE);
    expect(svc.loaded()).toBe(true);
  });
});
