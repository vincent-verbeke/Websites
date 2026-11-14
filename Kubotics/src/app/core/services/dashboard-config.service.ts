import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';

/**
 * Runtime dashboard mode — ONE artifact, two hosts (H2 light dashboard,
 * plan: Kubotics/H2_LIGHT_DASHBOARD_PLAN_2026-11-14.md).
 *
 * `public/dashboard-mode.json` is served at the host ROOT
 * (`/dashboard-mode.json`). The cloud host ships {"mode":"cloud"} (today's
 * behavior, zero change); the H2 serves {"mode":"h2-local","apiBase":"..."}
 * from its local web host. Any fetch failure = cloud defaults, never a
 * broken dashboard (house rule: fail-soft, no simulated values).
 */
export type DashboardMode = 'cloud' | 'h2-local';

export const CLOUD_API_BASE = 'https://api.kubotics.ch/api/v1';
export const MODE_FILE = '/dashboard-mode.json';

/** All 16 tabs (master list — the component keeps labels/icons). */
export const CLOUD_TAB_IDS: readonly string[] = [
  'overview', 'twin', 'investments', 'services', 'system', 'management',
  'lidar', 'motion', 'vision', 'voice', 'chat', 'sessions', 'ha',
  'training', 'ollama', 'software',
];

/**
 * H2-local tabs: every local control/telemetry feature. Dropped for the
 * robot build: `investments` (IBKR/cloud) and `sessions` (WhatsApp/cloud).
 * `overview` stays as a local status page (device telemetry strip; its
 * cloud KPI/leads/conversations/spend/tasks blocks are gated in the
 * template by `cfg.isLocal()`).
 */
export const H2_LOCAL_TAB_IDS: readonly string[] = [
  'overview', 'twin', 'services', 'system', 'management', 'lidar', 'motion',
  'vision', 'voice', 'chat', 'ha', 'training', 'ollama', 'software',
];

@Injectable({ providedIn: 'root' })
export class DashboardConfigService {
  private readonly http = inject(HttpClient);

  private readonly _mode = signal<DashboardMode>('cloud');
  private readonly _apiBase = signal<string>(CLOUD_API_BASE);
  private readonly _loaded = signal(false);

  readonly mode = this._mode.asReadonly();
  readonly apiBase = this._apiBase.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly isLocal = computed(() => this._mode() === 'h2-local');
  readonly allowedTabIds = computed<readonly string[]>(
    () => (this.isLocal() ? H2_LOCAL_TAB_IDS : CLOUD_TAB_IDS),
  );

  /** Fetch the mode file once. Never errors; result is idempotent
   * (false = file missing/unusable -> cloud defaults were applied). */
  load(): Observable<boolean> {
    if (this._loaded()) return of(true);
    return this.http.get<{ mode?: string; apiBase?: string }>(MODE_FILE).pipe(
      map((cfg) => {
        this.apply(cfg);
        return true;
      }),
      catchError(() => {
        this.apply({});
        return of(false);
      }),
      tap(() => this._loaded.set(true)),
    );
  }

  private apply(cfg: { mode?: string; apiBase?: string }): void {
    if (cfg?.mode === 'h2-local' || cfg?.mode === 'cloud') {
      this._mode.set(cfg.mode);
    }
    const base = String(cfg?.apiBase ?? '').trim().replace(/\/+$/, '');
    this._apiBase.set(base || CLOUD_API_BASE);
  }
}
