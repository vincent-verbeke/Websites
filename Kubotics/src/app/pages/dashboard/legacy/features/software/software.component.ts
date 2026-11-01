import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, interval, of } from 'rxjs';
import { catchError, exhaustMap, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  apiPost,
  type CheckUpdateResult,
  type HardwareItem,
  type OsInfo,
  type OtaModule,
  type SystemVersions,
} from '../../core/api';

/** Phase 1 parity tab 2 (plan §6): the legacy dashboard's *System & Hardware
 * Versions Inventory* + OTA check. Contract (core/api.ts, from
 * robot_dashboard_server.py):
 *   API.system.versions (GET /api/system/versions) → { os_info,
 *                                      ota_pipe_version, modules, hardware[],
 *                                      last_checked, … }
 *   API.system.checkUpdate (POST /api/system/check_update) → { status,
 *                                      message, checked_at?, raw_output? }
 * The legacy UI popped alert()s; this port keeps results inline (CDP-friendly).
 * Signals only — Angular 22 scaffold is zoneless.
 */

export type {
  CheckUpdateResult,
  HardwareItem,
  OsInfo,
  OtaModule,
  SystemVersions,
} from '../../core/api';

const REFRESH_MS = 30_000;

@Component({
  selector: 'app-software',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>System &amp; Software</h2>
      <span class="chip" [class.ok]="versions() && !error()">
        {{ error() ? 'offline' : (versions() ? 'inventory loaded' : 'loading…') }}
      </span>
      <button class="btn" (click)="refresh()">↻ refresh</button>
      <button class="btn alt" (click)="checkUpdate()" [disabled]="checking()">
        {{ checking() ? 'checking…' : 'check for updates' }}
      </button>
      <span class="meta">{{ error() ?? ('last checked ' + (versions()?.last_checked ?? '—')) }}</span>
    </div>

    <p class="result" *ngIf="checkResult() as r" [class.warn]="r.status !== 'up_to_date'">
      OTA check: <strong>{{ r.status }}</strong> — {{ r.message }}
      <span *ngIf="r.checked_at">({{ r.checked_at }})</span>
    </p>

    <ng-container *ngIf="versions() as v; else loading">
      <section class="sec">
        <h3>Host</h3>
        <div class="kv">
          <span>OS</span><b>{{ v.os_info?.os }}</b>
          <span>Kernel</span><b>{{ v.os_info?.kernel }} · {{ v.os_info?.arch }}</b>
          <span>CPU</span><b>{{ v.os_info?.processor }}</b>
          <span>ROS</span><b>{{ v.os_info?.ros_distro }}</b>
          <span>OTA pipe</span><b>v{{ v.ota_pipe_version }}</b>
        </div>
      </section>

      <section class="sec">
        <h3>OTA modules</h3>
        <div class="rows">
          <div class="row" *ngFor="let m of modules()">
            <div><b>{{ m.key }}</b><span>Unitree OTA subsystem</span></div>
            <div class="right">
              <b>v{{ m.m.installed_version }}</b><span>{{ m.m.status }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="sec">
        <h3>Hardware inventory</h3>
        <div class="rows">
          <div class="row" *ngFor="let h of v.hardware">
            <div><b>{{ h.device }}</b><span>{{ h.type }}</span></div>
            <div class="right"><b>{{ h.firmware }}</b><span>{{ h.status }}</span></div>
          </div>
        </div>
      </section>
    </ng-container>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">Loading version inventory…</p>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    h3 { font: 600 13px/1 system-ui, sans-serif; color: #374151; margin: 0 0 8px; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn.alt { border-color: #1f2937; background: #1f2937; }
    .btn:disabled { opacity: .5; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .result { font: 12px/1.5 system-ui, sans-serif; color: #065f46; background: #ecfdf5;
              border: 1px solid #a7f3d0; border-radius: 8px; padding: 8px 12px;
              margin: 0 14px 10px; }
    .result.warn { color: #92400e; background: #fffbeb; border-color: #fde68a; }
    .sec { padding: 0 14px 14px; }
    .kv { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px;
          font: 12px/1.5 system-ui, sans-serif; color: #6b7280; }
    .kv b { color: #111827; font-weight: 600; }
    .rows { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px;
           border-bottom: 1px solid #f3f4f6; font: 12px/1.4 system-ui, sans-serif; }
    .row:last-child { border-bottom: none; }
    .row b { color: #111827; display: block; }
    .row span { color: #9ca3af; font-size: 11px; }
    .right { text-align: right; }
    .right b { color: #065f46; }
    .right span { color: #0891b2; }
  `],
})
export class SoftwareComponent implements OnInit, OnDestroy {
  readonly versions = signal<SystemVersions | null>(null);
  readonly error = signal<string | null>(null);
  readonly checking = signal(false);
  readonly checkResult = signal<CheckUpdateResult | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  /** derived list for ngFor (signal-null safe) */
  modules(): { key: string; m: OtaModule }[] {
    const v = this.versions();
    if (!v?.modules) return [];
    return Object.entries(v.modules).map(([key, m]) => ({ key, m }));
  }

  ngOnInit(): void {
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((v) => this.apply(v));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((v) => this.apply(v));
    this.refresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  private fetch$(): Observable<SystemVersions | null> {
    return apiGet<SystemVersions>(this.http, API.system.versions).pipe(
      catchError((e: unknown) => {
        this.error.set(`GET ${API.system.versions.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(v: SystemVersions | null): void {
    if (v) {
      this.error.set(null);
      this.versions.set(v);
    }
  }

  /** POST /api/system/check_update — result kept inline (legacy used alert()). */
  checkUpdate(): void {
    if (this.checking()) return;
    this.checking.set(true);
    apiPost<CheckUpdateResult>(this.http, API.system.checkUpdate, {}).pipe(
      catchError((e: unknown) => {
        // the legacy daemon answers structured JSON with a 5xx status when the
        // OTA query fails (e.g. no /unitree/sbin/ota_pipe_cli off-robot) —
        // HttpClient throws, but e.error IS the parsed body: honour it as data
        // (legacy fetch() did the same by reading res.json() regardless).
        const body = (e as { error?: unknown }).error;
        if (body && typeof body === 'object' && 'status' in body) {
          return of(body as CheckUpdateResult);
        }
        this.error.set(`POST ${API.system.checkUpdate.path} failed: ${httpErrorText(e)}`);
        return of({ status: 'error', message: httpErrorText(e) });
      }),
    ).subscribe((res) => {
      this.checkResult.set(res);
      this.checking.set(false);
      if (res.status && res.status !== 'error') {
        this.error.set(null);
        this.refresh$.next();
      }
    });
  }
}
