import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/**
 * Typed frontend analytics — the Phase 1 AnalyticsService of
 * GTM_MIGRATION_ANALYSIS_2026-11-15.md (deliverables 2 + 3).
 *
 * Pushes CANONICAL GTM objects onto `window.dataLayer`
 * (`{event: "<name>", ...}`) so GTM triggers can bind to stable event names
 * once the container id lands in environment.prod.ts. Until then every push
 * just queues on the dataLayer array that index.html already creates — no
 * tags load, nothing changes (inert-until-GTM rollout, analysis §3).
 *
 * Rules baked in:
 *  - Event names are the spec list, stable, lowercase snake_case.
 *  - NO PII ever enters a push (names, emails, phones, free text).
 *  - `generate_lead` / `schedule_appointment` always carry an idempotent
 *    `event_id` (uuid) so a GTM conversion tag and any future backend
 *    Measurement-Protocol mirror can dedupe (spec §4/§6).
 *  - Exactly ONE page_view per history change: route changes dedupe on URL.
 *  - Consent Mode stays a SINGLE system: the index.html inline gtag consent
 *    default/update + cookie-consent component already ride the dataLayer
 *    (gtag() == dataLayer.push(arguments)) — this service deliberately has
 *    NO consent methods (analysis §4: no second consent system).
 *
 * Legacy direct gtag calls in business components stay until Phase 3 evidence
 * (analysis §3/§5 deliverable 6); `gtagForward()` is the one-line bridge for
 * the deferred call-site migration (dual-write: gtag for GA4 today, canonical
 * object for GTM).
 */
export type AnalyticsEventName =
  | 'page_view'
  | 'cta_click'
  | 'form_start'
  | 'generate_lead'
  | 'roi_calculator_interaction'
  | 'roi_result_view'
  | 'outbound_click'
  | 'schedule_appointment';

/** Scalars only — objects/arrays rejected by convention, PII forbidden. */
export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

/** Conversion events (spec §4): must carry event_id for cross-surface dedupe. */
const CONVERSION_EVENTS = new Set<AnalyticsEventName>([
  'generate_lead',
  'schedule_appointment',
]);

type GWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly router = inject(Router);
  private lastPageViewUrl: string | null = null;
  private routerTrackingOn = false;

  /**
   * Push one canonical event: `{event, ...params}` (+ `event_id` for
   * conversion events when the caller did not supply one).
   */
  track(name: AnalyticsEventName, params?: AnalyticsParams): void {
    if (typeof window === 'undefined') return; // SSR/prerender: no-op
    const payload: Record<string, unknown> = { event: name, ...params };
    if (CONVERSION_EVENTS.has(name) && payload['event_id'] === undefined) {
      payload['event_id'] = newEventId();
    }
    this.push(payload);
  }

  /**
   * SPA page_view. Exactly one push per URL: consecutive NavigationEnds with
   * the same target (guards, redirects back) dedupe on URL.
   */
  pageView(url?: string, title?: string): void {
    if (typeof window === 'undefined') return;
    const win = window as GWindow;
    const path = url ?? (win.location.pathname + win.location.search);
    if (path === this.lastPageViewUrl) return;
    this.lastPageViewUrl = path;
    const location = path.startsWith('http')
      ? path
      : win.location.origin + path;
    this.push({
      event: 'page_view',
      page_location: location,
      page_title: title ?? document.title,
    });
  }

  /**
   * Subscribe to NavigationEnd -> pageView (browser only, once). Called from
   * the app initializer in app.config.ts. Also emits the current URL once so
   * the initial navigation is covered regardless of subscribe timing.
   */
  initRouterTracking(): void {
    if (typeof window === 'undefined' || this.routerTrackingOn) return;
    this.routerTrackingOn = true;
    this.pageView();
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.pageView(e.urlAfterRedirects));
  }

  /**
   * Legacy direct GA4 call, for the deferred call-site migration (dual-write
   * bridge — components switch from `(window).gtag(...)` to
   * `analytics.track(...) + analytics.gtagForward(...)`; gtag itself is only
   * removed after Phase 3 evidence, analysis §3 Phase 4).
   * Keeps today's behavior byte-for-byte: same event name, same params.
   */
  gtagForward(name: string, params?: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    const win = window as GWindow;
    if (typeof win.gtag === 'function') win.gtag('event', name, params);
  }

  private push(entry: Record<string, unknown>): void {
    const win = window as GWindow;
    // index.html creates dataLayer; ||= keeps tests/prerender order-safe.
    (win.dataLayer ??= []).push(entry);
  }
}

function newEventId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // Fallback (non-secure contexts): RFC4122-shaped v4 via Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
