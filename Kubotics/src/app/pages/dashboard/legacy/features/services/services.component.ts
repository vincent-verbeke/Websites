import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, interval, of } from 'rxjs';
import { catchError, exhaustMap, map, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  apiPost,
  type ServiceInfo,
  type ServicesMap,
  type ServiceToggleResponse,
} from '../../core/api';

/** Phase 1 parity tab (plan §6): the legacy dashboard's *App Services Manager*.
 * Contract in web/src/app/core/api.ts (read from scripts/monitoring/dashboard
 * / robot_dashboard_server.py):
 *   API.services.get (GET  /api/services)   → { [key]: ServiceInfo } (APP_SERVICES)
 *   API.service.toggle (POST /api/service/toggle) {service, enabled}
 *                                           → { success, error?|msg? }
 * Signals only — the Angular 22 scaffold is zoneless (verified via CDP).
 */

export type { ServiceInfo } from '../../core/api';

const REFRESH_MS = 5000;

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>App Services</h2>
      <span class="chip" [class.ok]="services() && !error()">
        {{ error() ? 'offline' : (services() ? services()!.length + ' services' : 'loading…') }}
      </span>
      <button class="btn" (click)="refresh()" [disabled]="busy()">↻ refresh</button>
      <span class="meta">{{ error() ?? 'DDS RPC sync — legacy /api/services contract' }}</span>
    </div>

    <div class="grid" *ngIf="services() as list; else loading">
      <div class="card" *ngFor="let s of list">
        <div class="row">
          <span class="name">{{ s.name }}</span>
          <span class="state" [class.on]="s.enabled">{{ s.enabled ? 'ON' : 'OFF' }}</span>
        </div>
        <p class="desc">{{ s.desc }}</p>
        <div class="foot">
          <span class="cat">{{ s.category }}</span>
          <button class="tog" [class.enable]="!s.enabled"
                  [disabled]="busy()"
                  (click)="toggle(s.key, !s.enabled)">
            {{ s.enabled ? 'Disable' : 'Enable' }}
          </button>
        </div>
      </div>
    </div>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">Loading services list…</p>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn:disabled { opacity: .5; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 12px; padding: 0 14px 14px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
            padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .name { font: 600 13px/1.3 system-ui, sans-serif; color: #111827; }
    .state { font: 700 10px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 999px;
             background: #e5e7eb; color: #6b7280; }
    .state.on { background: #d1fae5; color: #065f46; }
    .desc { font: 12px/1.45 system-ui, sans-serif; color: #6b7280; margin: 0; }
    .foot { display: flex; justify-content: space-between; align-items: center;
            border-top: 1px solid #f3f4f6; padding-top: 8px; }
    .cat { font: 11px/1 system-ui, sans-serif; color: #9ca3af; }
    .tog { font: 600 11px/1 system-ui, sans-serif; padding: 4px 12px; border-radius: 6px;
           border: 1px solid #9ca3af; background: #f3f4f6; color: #374151; cursor: pointer; }
    .tog.enable { border-color: #065f46; background: #10b981; color: #fff; }
    .tog:disabled { opacity: .5; cursor: default; }
  `],
})
export class ServicesComponent implements OnInit, OnDestroy {
  /** flat list (key attached) rendered by the template */
  readonly services = signal<(ServiceInfo & { key: string })[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // periodic refresh (exhaustMap: never stack; catchError keeps the tab alive
    // when the backend/robot is unreachable — robot battery off 2026-10-13)
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((list) => this.apply(list));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((list) => this.apply(list));
    this.refresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  private fetch$(): Observable<(ServiceInfo & { key: string })[] | null> {
    return apiGet<ServicesMap>(this.http, API.services.get).pipe(
      map((m) => Object.entries(m).map(([key, s]) => ({ ...s, key }))),
      catchError((e: unknown) => {
        this.error.set(`GET ${API.services.get.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(list: (ServiceInfo & { key: string })[] | null): void {
    if (list) {
      this.error.set(null);
      this.services.set(list);
    }
  }

  /** API.service.toggle → reload (parity with legacy toggleAppService). */
  toggle(service: string, enabled: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    apiPost<ServiceToggleResponse>(
      this.http, API.service.toggle, { service, enabled },
    ).pipe(
      catchError((e: unknown) => {
        this.error.set(`POST ${API.service.toggle.path} failed: ${httpErrorText(e)}`);
        return [{ success: false as const, error: httpErrorText(e) }];
      }),
    ).subscribe((res) => {
      if (!res.success) {
        this.error.set(`toggle ${service}: ${res.error ?? 'failed'}`);
      } else {
        this.error.set(null);
        this.refresh$.next();
      }
      this.busy.set(false);
    });
  }
}
