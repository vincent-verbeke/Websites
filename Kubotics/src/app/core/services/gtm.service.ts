import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * GTM web-container loader (GTM_MIGRATION_ANALYSIS_2026-11-15.md §3 Phase 1).
 *
 * Loads googletagmanager.com/gtm.js ONCE, in the browser only, and only when
 * `environment.gtmId` is non-empty:
 *
 *  - Empty id (today's state — Vincent has not created the containers yet,
 *    readiness §3 row 3) => init() is a no-op: zero scripts, zero behavior
 *    change, and the documented rollback lever (analysis §5: "container ID
 *    off => service inert").
 *  - Dev builds keep gtmId empty too (no prod tags in dev): the id lives
 *    ONLY in environment.prod.ts, swapped in by the production
 *    fileReplacements — never hardcoded in components or index.html.
 *
 * The standard `gtm.start` bootstrap event is queued on the dataLayer BEFORE
 * gtm.js loads, so tags fire against the same queue index.html already
 * created (consent default/update included).
 */
@Injectable({ providedIn: 'root' })
export class GtmService {
  private loaded = false;

  /** App-initializer hook. Safe to call from SSR (no-op) and twice (once). */
  init(): void {
    if (typeof window === 'undefined') return; // SSR/prerender guard
    if (this.loaded) return; // exactly one loader, one script
    const id = environment.gtmId?.trim();
    if (!id) return; // inert: no container id yet (or rolled back)
    this.loaded = true;

    const dataLayer = (window as Window & { dataLayer?: unknown[] }).dataLayer
      ??= [];
    dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);
  }
}
