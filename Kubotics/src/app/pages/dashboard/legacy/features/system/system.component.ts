import { Component, OnDestroy, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, interval, of } from 'rxjs';
import { catchError, exhaustMap, map, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  type Telemetry,
  type Thermals,
  type TrainingState,
} from '../../core/api';

/** System tab (WhatsApp request 2026-10-14): temperature summary parity with the
 * legacy dashboard (scripts/monitoring/dashboard/robot_dashboard_server.py).
 * Contract — read-only API.telemetry.get (GET /api/telemetry):
 *   pc3_thermals → { hostname, zones: {name: °C}, max_temp, power?, error?,
 *                    offline? }   (PC3 Thor via http://192.168.123.163:8999/temp,
 *                    degrades to {zones:{}, max_temp:0, offline:true} when the
 *                    robot LAN is down)
 *   pc2_thermals → { zones: {name: °C}, max_temp }  (local /sys thermal zones)
 *   rl_training  → same shape as API.training.get (GET /api/training):
 *                    { running, status, temp?, metrics?, events?, error? } —
 *                    `temp` is PC3's max thermal reading while training
 *                    (pc3_thermal_reporter.py /training).
 * DTOs (Thermals/TrainingState/Telemetry) live in core/api.ts.
 * Signals only — the Angular 22 scaffold is zoneless (as services.component).
 */

export type { Telemetry, Thermals, TrainingState } from '../../core/api';

interface Zone {
  name: string;
  temp: number;
  pct: number;
  level: 'ok' | 'warn' | 'hot';
}

const REFRESH_MS = 5000;

/** Legacy thresholds (index.html updateUI): <80 safe, 80–90 warn, ≥90 critical. */
function levelOf(temp: number): Zone['level'] {
  return temp >= 90 ? 'hot' : temp >= 80 ? 'warn' : 'ok';
}

function zonesOf(t: Thermals | null | undefined): Zone[] {
  const zones = t?.zones ?? {};
  return Object.entries(zones)
    .map(([name, temp]) => ({
      name: name.replace('-thermal', ''),
      temp,
      pct: Math.min(100, Math.max(2, temp)),
      level: levelOf(temp),
    }))
    .sort((a, b) => b.temp - a.temp);
}

@Component({
  selector: 'app-system',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>System Temperatures</h2>
      <span class="chip" [class.ok]="tel() && !error()">
        {{ error() && !tel() ? 'offline' : (tel() ? 'telemetry live' : 'loading…') }}
      </span>
      <span class="chip" [class.ok]="pc3Online()" [class.bad]="pc3() && !pc3Online()">
        {{ pc3Label() }}
      </span>
      <button class="btn" (click)="refresh()">↻ refresh</button>
      <span class="meta">{{ error() ?? 'PC3 Thor + PC2 zones — GET /api/telemetry, 5 s poll' }}</span>
    </div>

    <div class="grid" *ngIf="tel() as t; else loading">
      <!-- PC3 · NVIDIA Jetson Thor (robot LAN) -->
      <div class="card">
        <div class="row">
          <span class="name">PC3 · NVIDIA Jetson Thor</span>
          <span class="state" [class.ok]="pc3Online()" [class.bad]="pc3() && !pc3Online()">
            {{ pc3Online() ? 'ONLINE' : 'OFFLINE' }}
          </span>
        </div>
        <div class="peak">
          <b [class.warn]="pc3Level() === 'warn'" [class.hot]="pc3Level() === 'hot'">{{ pc3MaxText() }}</b>
          <span class="unit">°C max</span>
        </div>
        <div class="zones" *ngIf="pc3Zones().length; else pc3NoData">
          <div class="zone" *ngFor="let z of pc3Zones()">
            <div class="zrow">
              <span class="zname">{{ z.name }}</span>
              <span class="ztemp">{{ z.temp }}°C</span>
            </div>
            <div class="track">
              <div class="fill" [class.warn]="z.level === 'warn'" [class.hot]="z.level === 'hot'"
                   [style.width.%]="z.pct"></div>
            </div>
          </div>
        </div>
        <ng-template #pc3NoData>
          <p class="note" [class.bad]="pc3Offline()">
            {{ pc3Offline()
              ? 'Robot LAN unreachable — ' + (pc3()?.error || 'no route to 192.168.123.163:8999')
              : 'Waiting for PC3 thermal zones…' }}
          </p>
        </ng-template>
        <div class="foot" *ngIf="pc3()?.power as pw">
          <span class="cat">power profile</span>
          <span class="pw">{{ pw?.mode_name ?? '—' }}</span>
        </div>
      </div>

      <!-- PC2 · local thermal zones -->
      <div class="card">
        <div class="row">
          <span class="name">PC2 · this machine</span>
          <span class="state ok">ONLINE</span>
        </div>
        <div class="peak">
          <b [class.warn]="pc2Level() === 'warn'" [class.hot]="pc2Level() === 'hot'">{{ pc2MaxText() }}</b>
          <span class="unit">°C max</span>
        </div>
        <div class="zones" *ngIf="pc2Zones().length; else pc2NoData">
          <div class="zone" *ngFor="let z of pc2Zones()">
            <div class="zrow">
              <span class="zname">{{ z.name }}</span>
              <span class="ztemp">{{ z.temp }}°C</span>
            </div>
            <div class="track">
              <div class="fill" [class.warn]="z.level === 'warn'" [class.hot]="z.level === 'hot'"
                   [style.width.%]="z.pct"></div>
            </div>
          </div>
        </div>
        <ng-template #pc2NoData>
          <p class="note">No local thermal zones exposed on this host.</p>
        </ng-template>
      </div>

      <!-- PC3 training temp (GET /api/training → rl_training) -->
      <div class="card" *ngIf="train() as tr">
        <div class="row">
          <span class="name">PC3 · RL training</span>
          <span class="state" [class.ok]="tr.running" [class.warn]="tr.status === 'PAUSED_COOLDOWN'">
            {{ tr.status || (tr.running ? 'RUNNING' : 'UNKNOWN') }}
          </span>
        </div>
        <div class="peak" *ngIf="trainTemp() as tt; else noTrainTemp">
          <b>{{ tt }}</b>
          <span class="unit">°C PC3 training temp</span>
        </div>
        <ng-template #noTrainTemp>
          <p class="note" [class.bad]="!!tr.error">
            {{ tr.error ? 'PC3 training feed: ' + tr.error : 'No training temp reported yet.' }}
          </p>
        </ng-template>
      </div>
    </div>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">
        {{ error() ?? 'Loading /api/telemetry…' }}
      </p>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .chip.bad { background: #fee2e2; color: #991b1b; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn:disabled { opacity: .5; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 12px; padding: 0 14px 14px; align-items: start; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
            padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .name { font: 600 13px/1.3 system-ui, sans-serif; color: #111827; }
    .state { font: 700 10px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 999px;
             background: #e5e7eb; color: #6b7280; }
    .state.ok { background: #d1fae5; color: #065f46; }
    .state.warn { background: #fef3c7; color: #92400e; }
    .state.bad { background: #fee2e2; color: #991b1b; }
    .peak { display: flex; align-items: baseline; gap: 6px; }
    .peak b { font: 700 28px/1 ui-monospace, monospace; color: #0891b2; }
    .peak b.warn { color: #d97706; }
    .peak b.hot { color: #dc2626; }
    .unit { font: 12px/1 system-ui, sans-serif; color: #6b7280; }
    .zones { display: flex; flex-direction: column; gap: 8px; }
    .zrow { display: flex; justify-content: space-between; align-items: center; gap: 8px;
            margin-bottom: 3px; }
    .zname { font: 12px/1.2 ui-monospace, monospace; color: #374151;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ztemp { font: 600 12px/1 ui-monospace, monospace; color: #111827; }
    .track { height: 6px; border-radius: 999px; background: #f3f4f6; overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; background: #10b981;
            transition: width .4s ease; }
    .fill.warn { background: #f59e0b; }
    .fill.hot { background: #ef4444; }
    .note { font: 12px/1.45 system-ui, sans-serif; color: #6b7280; margin: 0; }
    .note.bad { color: #b91c1c; }
    .foot { display: flex; justify-content: space-between; align-items: center;
            border-top: 1px solid #f3f4f6; padding-top: 8px; }
    .cat { font: 11px/1 system-ui, sans-serif; color: #9ca3af; }
    .pw { font: 600 11px/1 ui-monospace, monospace; color: #374151; }
  `],
})
export class SystemComponent implements OnInit, OnDestroy {
  /** latest successful /api/telemetry payload (kept across failed polls) */
  readonly tel = signal<Telemetry | null>(null);
  readonly error = signal<string | null>(null);

  readonly pc3 = computed(() => this.tel()?.pc3_thermals ?? null);
  readonly pc2 = computed(() => this.tel()?.pc2_thermals ?? null);
  readonly train = computed(() => this.tel()?.rl_training ?? null);

  readonly pc3Zones = computed(() => zonesOf(this.pc3()));
  readonly pc2Zones = computed(() => zonesOf(this.pc2()));

  readonly pc3Offline = computed(() => !!this.pc3()?.offline);
  readonly pc3Online = computed(() => {
    const t = this.pc3();
    return !!t && !t.offline && this.pc3Zones().length > 0;
  });
  readonly pc3Label = computed(() => {
    if (!this.pc3()) return this.tel() ? 'PC3 …' : 'PC3 loading…';
    return this.pc3Online() ? 'PC3 online' : 'PC3 offline';
  });

  readonly pc3Level = computed<Zone['level'] | null>(() => {
    const t = this.pc3();
    return t && !t.offline ? levelOf(t.max_temp) : null;
  });
  readonly pc2Level = computed<Zone['level'] | null>(() => {
    const t = this.pc2();
    return t && this.pc2Zones().length ? levelOf(t.max_temp) : null;
  });
  readonly pc3MaxText = computed(() => {
    const t = this.pc3();
    return t && !t.offline ? t.max_temp.toFixed(1) : '—';
  });
  readonly pc2MaxText = computed(() => {
    const t = this.pc2();
    return t && this.pc2Zones().length ? t.max_temp.toFixed(1) : '—';
  });

  /** PC3 training temp (GET /api/training `temp`) when the LAN answers. */
  readonly trainTemp = computed<number | null>(() => {
    const temp = this.train()?.temp;
    return typeof temp === 'number' && Number.isFinite(temp) ? temp : null;
  });

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // periodic refresh (exhaustMap: never stack; catchError keeps the tab alive
    // when the backend/robot is unreachable — robot LAN down 2026-10-14)
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((t) => this.apply(t));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((t) => this.apply(t));
    this.refresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  private fetch$(): Observable<Telemetry | null> {
    return apiGet<Telemetry>(this.http, API.telemetry.get).pipe(
      map((t) => t ?? null),
      catchError((e: unknown) => {
        this.error.set(`GET ${API.telemetry.get.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(t: Telemetry | null): void {
    if (t) {
      this.error.set(null);
      this.tel.set(t);
    }
  }
}
