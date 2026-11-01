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
  type HaItem,
  type HaOverview,
} from '../../core/api';

/** Home Assistant tab (Vincent 2026-10-18 13:53): "all devices with just
 * on/off, all scenes, etc that can be clicked as buttons".
 *
 * Contract (web/server/ha_bridge.py, behind the auth gate + wall):
 *   API.ha.overview (GET  /api/ha/overview) → {devices, scenes, scripts, automations}
 *   API.ha.act      (POST /api/ha/act)      → one action per click
 *
 * Devices: on/off buttons (his words). Scenes: activate. Scripts: run.
 * Automations: on/off. Every click is one POST — no agent, no session.
 */
export type { HaItem, HaOverview } from '../../core/api';

const REFRESH_MS = 8000;

@Component({
  selector: 'app-ha',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>Home Assistant</h2>
      <span class="chip" [class.ok]="state() && !error()">
        {{ error() ? 'offline' : (state() ? counts() : 'loading…') }}
      </span>
      <button class="btn" (click)="refresh()">↻ refresh</button>
      <span class="meta">{{ ack() ?? 'one click = one HA action' }}</span>
    </div>

    <div class="content" *ngIf="state() as s; else loading">
      <div class="card" *ngIf="s.devices.length">
        <h3>Devices</h3>
        <div class="row" *ngFor="let e of s.devices; trackBy: trackById">
          <span class="btns">
            <button class="tog enable" (click)="act(e, 'on')">on</button>
            <button class="tog" (click)="act(e, 'off')">off</button>
          </span>
          <span class="name">{{ e.name }}</span>
          <span class="state" [class.on]="e.on">{{ e.state }}</span>
        </div>
      </div>

      <div class="card" *ngIf="s.scenes.length">
        <h3>Scenes</h3>
        <div class="row" *ngFor="let e of s.scenes; trackBy: trackById">
          <span class="btns">
            <button class="tog enable" (click)="act(e, 'activate')">activate</button>
          </span>
          <span class="name">{{ e.name }}</span>
        </div>
      </div>

      <div class="card" *ngIf="s.scripts.length">
        <h3>Scripts</h3>
        <div class="row" *ngFor="let e of s.scripts; trackBy: trackById">
          <span class="btns">
            <button class="tog enable" (click)="act(e, 'run')">run</button>
          </span>
          <span class="name">{{ e.name }}</span>
        </div>
      </div>

      <div class="card" *ngIf="s.automations.length">
        <h3>Automations</h3>
        <div class="row" *ngFor="let e of s.automations; trackBy: trackById">
          <span class="btns">
            <button class="tog enable" (click)="act(e, 'on')">on</button>
            <button class="tog" (click)="act(e, 'off')">off</button>
          </span>
          <span class="name">{{ e.name }}</span>
          <span class="state" [class.on]="e.on">{{ e.state }}</span>
        </div>
      </div>

      <div class="card" *ngIf="!s.devices.length && !s.scenes.length && !s.scripts.length && !s.automations.length">
        <p class="empty">Home Assistant reports no controllable entities.</p>
      </div>
    </div>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">Loading Home Assistant…</p>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    h3 { font: 600 13px/1 system-ui, sans-serif; margin: 0 0 6px; color: #374151; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; white-space: nowrap; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .content { display: flex; flex-direction: column; gap: 12px; padding: 0 14px 14px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
            padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; align-items: center; gap: 10px; }
    .name { flex: 1; font: 13px/1.3 system-ui, sans-serif; color: #111827;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .state { font: 700 10px/1 system-ui, sans-serif; text-transform: uppercase;
             letter-spacing: .4px; padding: 4px 7px; border-radius: 999px;
             background: #fef3c7; color: #92400e; white-space: nowrap; }
    .state.on { background: #d1fae5; color: #065f46; }
    .btns { display: flex; gap: 6px; width: 118px; flex: 0 0 118px; }
    .tog { font: 600 11px/1 system-ui, sans-serif; padding: 4px 12px; border-radius: 6px;
           border: 1px solid #9ca3af; background: #f3f4f6; color: #374151; cursor: pointer; }
    .tog.enable { border-color: #065f46; background: #10b981; color: #fff; }
    .tog:disabled { opacity: .5; cursor: default; }
    .empty { font: 600 13px/1.5 system-ui, sans-serif; color: #6b7280; margin: 0; }
  `],
})
export class HaComponent implements OnInit, OnDestroy {
  readonly state = signal<HaOverview | null>(null);
  readonly error = signal<string | null>(null);
  readonly ack = signal<string | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    const poll$ = (): Observable<HaOverview | null> => this.fetch$();
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => poll$()),
    ).subscribe((s) => this.state.set(s));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => poll$()),
    ).subscribe((s) => this.state.set(s));
    this.refresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  counts(): string {
    const s = this.state();
    if (!s) return '';
    return `${s.devices.length} devices · ${s.scenes.length} scenes · ` +
           `${s.scripts.length} scripts · ${s.automations.length} automations`;
  }

  trackById(_i: number, e: HaItem): string {
    return e.entity_id;
  }

  /** One click = one HA action (the backend maps 'activate'→scene.turn_on,
   * 'run'→script.turn_on, on/off→domain turn_on/turn_off). */
  act(e: HaItem, action: string): void {
    apiPost<{ ok: boolean }>(this.http, API.ha.act,
      { entity_id: e.entity_id, action }).pipe(
      catchError((err: unknown) => {
        this.error.set(`POST ${API.ha.act.path} failed: ${httpErrorText(err)}`);
        return of(null);
      }),
    ).subscribe((res) => {
      if (res?.ok) {
        this.error.set(null);
        this.ack.set(`${action} → ${e.name}`);
        setTimeout(() => this.ack.set(null), 4000);
        setTimeout(() => this.refresh$.next(), 700);   // show the new state
      }
    });
  }

  private fetch$(): Observable<HaOverview | null> {
    return apiGet<HaOverview>(this.http, API.ha.overview).pipe(
      catchError((err: unknown) => {
        this.error.set(`GET ${API.ha.overview.path} failed: ${httpErrorText(err)}`);
        return of(null);
      }),
    );
  }
}
