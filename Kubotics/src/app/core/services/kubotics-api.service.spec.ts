import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { KuboticsApiService } from './kubotics-api.service';

/**
 * Attribution E2E contract (Vincent 2026-11-26): every lead-form submission
 * must carry the page's utm/gclid — callers no longer need to read the URL
 * themselves, submitLead enriches at the single choke point and never
 * overwrites an explicit caller value.
 */
describe('KuboticsApiService lead attribution', () => {
  let svc: KuboticsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    svc = TestBed.inject(KuboticsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    window.history.replaceState({}, '', '/');
  });

  it('enriches a bare payload with URL utm + gclid', () => {
    window.history.replaceState(
      {},
      '',
      '/robotics/unitree-h2-rental?utm_source=google&utm_medium=cpc' +
        '&utm_campaign=chf100_test_itbpa&utm_content=e2e&gclid=GCLID-E2E',
    );
    svc.submitLead({ email: 'e2e@example.ch' }).subscribe();

    const req = http.expectOne((r) => r.url.includes('/leads'));
    const body = req.request.body as Record<string, string | undefined>;
    expect(body['utm_source']).toBe('google');
    expect(body['utm_medium']).toBe('cpc');
    expect(body['utm_campaign']).toBe('chf100_test_itbpa');
    expect(body['utm_content']).toBe('e2e');
    expect(body['gclid']).toBe('GCLID-E2E');
    req.flush({ contact_id: 'c1', status: 'ok', message: 'ok' });
  });

  it('never overwrites caller-supplied attribution', () => {
    window.history.replaceState({}, '', '/?utm_source=from-url');
    svc
      .submitLead({
        email: 'x@y.ch',
        utm_source: 'explicit',
        gclid: 'KEEPME',
      })
      .subscribe();

    const req = http.expectOne((r) => r.url.includes('/leads'));
    const body = req.request.body as Record<string, string | undefined>;
    expect(body['utm_source']).toBe('explicit');
    expect(body['gclid']).toBe('KEEPME');
    req.flush({ contact_id: 'c2', status: 'ok', message: 'ok' });
  });

  it('sends plain payloads unchanged when no URL attribution exists', () => {
    window.history.replaceState({}, '', '/contact');
    svc.submitLead({ email: 'plain@z.ch', phone: '+41790000000' }).subscribe();

    const req = http.expectOne((r) => r.url.includes('/leads'));
    const body = req.request.body as Record<string, string | undefined>;
    expect(body['utm_source']).toBeUndefined();
    expect(body['gclid']).toBeUndefined();
    expect(body['email']).toBe('plain@z.ch');
    req.flush({ contact_id: 'c3', status: 'ok', message: 'ok' });
  });
});
