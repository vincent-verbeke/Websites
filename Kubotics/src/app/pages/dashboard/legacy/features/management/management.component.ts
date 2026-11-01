import { Component, OnDestroy, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, forkJoin, interval, of } from 'rxjs';
import { catchError, exhaustMap, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  type ManagementAction,
  type OtaModule,
  type SystemVersions,
  type Telemetry,
} from '../../core/api';

/** Robot Management tab (WhatsApp queue item 3/6, 2026-10-14) — READ-ONLY
 * first, so the operator can inspect the robot without any risk. The robot LAN
 * (192.168.123.0/24) is currently down: every offline state below is an
 * explicit, labelled placeholder, never a broken control.
 *
 * Sections:
 *   a. Device / system info — GET API.system.versions (os_info, OTA modules,
 *      hardware inventory) as cards/rows (DTO SystemVersions in core/api.ts).
 *   b. Connectivity / WiFi — read-only slice of GET API.telemetry
 *      (robot_state.connected, pc2/pc3 thermal presence) + a clearly labelled
 *      "WiFi status: requires robot LAN" placeholder. No scanning, and NO
 *      endpoint is invented for WiFi (none exists host-side).
 *   c. Audit log — client-side, in-memory + localStorage list of every action
 *      ATTEMPTED from this tab (audit(action, result) on every press,
 *      including failed/disabled ones), newest-first, with a clear button.
 *   d. Guarded controls — BUILT BUT DISABLED (reboot, shutdown, service
 *      start/stop, WebRTC multi-session toggle).
 *
 * SAFETY RULE (docs/plans/2026-10-13_angular_webui_and_legion1581_integration_
 * plan.md §3.1 "API inventory", evidence note; enforced by the gate in
 * AGENTS.md → `web/check.sh`): "The 13 POST routes were deliberately not
 * exercised (not read-only — motion/service/power/system changes)". Mutation
 * endpoints (POST /api/motion/*, /api/system/upgrade, /api/service/*,
 * /api/power/set) are NEVER exercised by tests, CDP probes or this tab:
 *   * this file contains no apiPost() call at all — the only HTTP it performs
 *     are the two GETs above;
 *   * guarded controls render disabled with
 *     title="Requires robot LAN — unavailable until 192.168.123.0/24 is
 *     reachable" and their press handler only writes to the local audit log;
 *   * the confirm dialog shown if a disabled control is somehow activated
 *     records the attempt and closes — it never sends a request.
 * Signals only — the Angular 22 scaffold is zoneless (as system.component).
 */

export type {
  ManagementAction,
  SystemVersions,
  Telemetry,
} from '../../core/api';

/** Exact tooltip every guarded control renders while the robot LAN is down. */
export const GUARD_TITLE =
  'Requires robot LAN — unavailable until 192.168.123.0/24 is reachable';

/** One guarded control. `action`/`target` are what the audit log records. */
interface GuardControl {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly target: string;
  readonly hint: string;
}

/** Built, rendered, disabled — flipping `guardsEnabled` is a code change, not
 * a UI state (read-only first; enabling needs a real, reviewed write path). */
const GUARDS: readonly GuardControl[] = [
  { id: 'reboot', label: 'Reboot', action: 'reboot', target: 'robot host',
    hint: 'restart the robot' },
  { id: 'shutdown', label: 'Shutdown', action: 'shutdown', target: 'robot host',
    hint: 'power the robot off' },
  { id: 'service-start', label: 'Service start', action: 'service.start',
    target: 'maintenance service', hint: 'start a maintenance service' },
  { id: 'service-stop', label: 'Service stop', action: 'service.stop',
    target: 'maintenance service', hint: 'stop a maintenance service' },
  { id: 'webrtc', label: 'WebRTC multi-session', action: 'webrtc.multi_session.toggle',
    target: 'WebRTC multi-session',
    hint: 'toggle multi-session WebRTC (plan Gate G1 prerequisite)' },
];

const REFRESH_MS = 15_000;
const AUDIT_KEY = 'h2.management.audit.v1';
const AUDIT_MAX = 200;

@Component({
  selector: 'app-management',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>Robot Management</h2>
      <span class="chip" [class.ok]="versions() && !verError()" [class.bad]="!!verError()">
        {{ verError() ? 'device info offline' : (versions() ? 'device info loaded' : 'device info…') }}
      </span>
      <span class="chip" [class.ok]="tel() && !telError()" [class.bad]="!!telError()">
        {{ telError() ? 'telemetry offline' : (tel() ? 'telemetry live' : 'telemetry…') }}
      </span>
      <button class="btn" (click)="refresh()">↻ refresh</button>
      <span class="meta">READ-ONLY — no mutation endpoint is ever called from this tab</span>
    </div>

    <!-- a. Device / system info — GET API.system.versions -->
    <section class="sec">
      <h3>Device / system info</h3>
      <ng-container *ngIf="versions() as v; else noVersions">
        <div class="kv">
          <span>OS</span><b>{{ v.os_info?.os }}</b>
          <span>Kernel</span><b>{{ v.os_info?.kernel }} · {{ v.os_info?.arch }}</b>
          <span>CPU</span><b>{{ v.os_info?.processor }}</b>
          <span>ROS</span><b>{{ v.os_info?.ros_distro }}</b>
          <span>OTA pipe</span><b>v{{ v.ota_pipe_version }}</b>
          <span>OTA server</span><b [class.warn]="!v.ota_server_online">
            {{ v.ota_server_online ? 'online' : 'offline' }}</b>
          <span>Last checked</span><b>{{ v.last_checked || '—' }}</b>
        </div>
        <div class="rows">
          <div class="row" *ngFor="let m of modules()">
            <div><b>{{ m.key }}</b><span>OTA module</span></div>
            <div class="right"><b>v{{ m.m.installed_version }}</b><span>{{ m.m.status }}</span></div>
          </div>
          <div class="row" *ngFor="let h of v.hardware">
            <div><b>{{ h.device }}</b><span>{{ h.type }}</span></div>
            <div class="right"><b>{{ h.firmware }}</b><span>{{ h.status }}</span></div>
          </div>
        </div>
      </ng-container>
      <ng-template #noVersions>
        <p class="note bad">{{ verError() ?? ('Device inventory unavailable — ' + versionsPath + ' did not answer yet.') }}</p>
        <p class="note">Requires the robot LAN (192.168.123.0/24). Inventory is re-read on every refresh; nothing here is guessed.</p>
      </ng-template>
    </section>

    <!-- b. Connectivity / WiFi — read-only telemetry slice + honest placeholder -->
    <section class="sec">
      <h3>Connectivity / WiFi</h3>
      <div class="rows">
        <div class="row">
          <div><b>Robot link</b><span>robot_state.connected</span></div>
          <div class="right">
            <b [class.ok-text]="robotConnected() === true"
               [class.bad-text]="robotConnected() === false">{{ robotLinkLabel() }}</b>
            <span>{{ tel() ? telemetryPath : 'telemetry unreachable' }}</span>
          </div>
        </div>
        <div class="row">
          <div><b>PC3 thermals</b><span>pc3_thermals presence</span></div>
          <div class="right">
            <b [class.ok-text]="pc3Present() && !pc3Offline()"
               [class.bad-text]="pc3Offline()">{{ pc3ThermalLabel() }}</b>
            <span>robot-side feed</span>
          </div>
        </div>
        <div class="row">
          <div><b>PC2 thermals</b><span>pc2_thermals presence</span></div>
          <div class="right">
            <b [class.ok-text]="pc2Present()">{{ pc2ThermalLabel() }}</b>
            <span>local feed</span>
          </div>
        </div>
        <div class="row">
          <div><b>WiFi status</b><span>read-only placeholder — no scan, no endpoint invented</span></div>
          <div class="right">
            <b class="muted-text">requires robot LAN</b>
            <span>192.168.123.0/24 unreachable from this host</span>
          </div>
        </div>
      </div>
      <p class="note bad" *ngIf="telError() as e">{{ e }}</p>
      <p class="note" *ngIf="!telError()">Source: {{ telemetryPath }} only — this tab never probes or scans the network.</p>
    </section>

    <!-- d. Guarded controls — BUILT BUT DISABLED (safety rule in the class doc) -->
    <section class="sec">
      <h3>Guarded controls <span class="sub">disabled — read-only until the robot LAN is back</span></h3>
      <div class="guards">
        <button *ngFor="let g of guards" type="button" class="btn danger"
                [attr.data-guard]="g.id"
                [disabled]="!guardsEnabled()"
                [title]="guardTitle"
                (click)="guardPress(g)">
          {{ g.label }}
        </button>
      </div>
      <p class="note">Every press — including on a disabled control — lands in the audit log below.</p>

      <div class="confirm" *ngIf="pending() as g" role="dialog" aria-modal="true">
        <p class="ctitle">Confirm: {{ g.label }} <span class="sub">({{ g.hint }})</span></p>
        <p class="note bad">{{ guardTitle }}</p>
        <p class="note">No request will be sent: this tab never POSTs to a mutation endpoint (safety rule, plan §3.1). Confirming only records the attempt in the audit log.</p>
        <div class="acts">
          <button type="button" class="btn alt" (click)="cancelGuard()">cancel</button>
          <button type="button" class="btn danger" (click)="confirmGuard()">confirm</button>
        </div>
      </div>
    </section>

    <!-- c. Audit log — client-side only, newest-first -->
    <section class="sec">
      <h3>Audit log
        <span class="sub">client-side (localStorage) — {{ auditLog().length }} entries</span>
      </h3>
      <div class="rows" *ngIf="auditLog().length; else noAudit">
        <div class="row" *ngFor="let e of auditLog()">
          <div><b>{{ e.action }}</b><span>{{ e.target || '—' }}</span></div>
          <div class="right"><b class="res">{{ e.result }}</b><span>{{ e.ts | date: 'HH:mm:ss' }}</span></div>
        </div>
      </div>
      <ng-template #noAudit>
        <p class="note">No actions attempted yet — every press from this tab (even a disabled one) is recorded here.</p>
      </ng-template>
      <button type="button" class="btn alt" (click)="clearAudit()"
              [disabled]="!auditLog().length">clear</button>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    h3 { font: 600 13px/1 system-ui, sans-serif; color: #374151; margin: 0 0 8px;
         display: flex; align-items: baseline; gap: 8px; }
    .sub { font: 400 11px/1 system-ui, sans-serif; color: #9ca3af; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .chip.bad { background: #fee2e2; color: #991b1b; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn.alt { border-color: #1f2937; background: #1f2937; }
    .btn.danger { border-color: #b91c1c; background: #dc2626; }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .sec { padding: 0 14px 14px; }
    .kv { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; margin-bottom: 8px;
          font: 12px/1.5 system-ui, sans-serif; color: #6b7280; }
    .kv b { color: #111827; font-weight: 600; }
    .kv b.warn { color: #b45309; }
    .rows { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
    .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px;
           border-bottom: 1px solid #f3f4f6; font: 12px/1.4 system-ui, sans-serif; }
    .row:last-child { border-bottom: none; }
    .row b { color: #111827; display: block; }
    .row span { color: #9ca3af; font-size: 11px; }
    .right { text-align: right; }
    .right b.ok-text { color: #065f46; }
    .right b.bad-text { color: #b91c1c; }
    .right b.muted-text { color: #b45309; font-style: italic; }
    .right b.res { color: #b45309; font-weight: 500; }
    .guards { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .note { font: 12px/1.45 system-ui, sans-serif; color: #6b7280; margin: 4px 0 0; }
    .note.bad { color: #b91c1c; }
    .confirm { border: 1px solid #fecaca; background: #fef2f2; border-radius: 10px;
               padding: 10px 12px; margin-top: 8px; }
    .ctitle { font: 600 13px/1.3 system-ui, sans-serif; color: #991b1b; margin: 0 0 4px; }
    .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    .sec > .btn { margin-top: 8px; }
  `],
})
export class ManagementComponent implements OnInit, OnDestroy {
  /** latest successful GET payloads (kept across failed polls — honest offline) */
  readonly versions = signal<SystemVersions | null>(null);
  readonly tel = signal<Telemetry | null>(null);
  readonly verError = signal<string | null>(null);
  readonly telError = signal<string | null>(null);

  /** audit log, NEWEST-FIRST, persisted in localStorage (see AUDIT_KEY) */
  readonly auditLog = signal<ManagementAction[]>(ManagementComponent.loadAudit());

  /** guarded controls: built but disabled (read-only first) */
  readonly guardsEnabled = signal(false);
  readonly guards = GUARDS;
  readonly guardTitle = GUARD_TITLE;

  /** non-null while the confirm dialog is open (only reachable via a press on
   * a guarded control — which normally cannot happen, hence "somehow clicked") */
  readonly pending = signal<GuardControl | null>(null);

  /** route paths for display — never a raw literal in this file (api.spec.ts) */
  readonly versionsPath = API.system.versions.path;
  readonly telemetryPath = API.telemetry.get.path;

  readonly modules = computed(() => {
    const v = this.versions();
    if (!v?.modules) return [] as { key: string; m: OtaModule }[];
    return Object.entries(v.modules).map(([key, m]) => ({ key, m }));
  });

  readonly robotConnected = computed<boolean | null>(() => {
    const t = this.tel();
    if (!t) return null;
    return t.robot_state?.connected ?? null;
  });
  readonly robotLinkLabel = computed(() => {
    const c = this.robotConnected();
    return c === null ? (this.tel() ? 'unknown (no robot_state)' : 'unknown (telemetry offline)')
         : c ? 'connected' : 'not connected';
  });

  readonly pc3Present = computed(() => !!this.tel()?.pc3_thermals);
  readonly pc2Present = computed(() => !!this.tel()?.pc2_thermals);
  readonly pc3Offline = computed(() => !!this.tel()?.pc3_thermals?.offline ||
    !!this.tel()?.pc3_thermals?.error);
  readonly pc3ThermalLabel = computed(() => {
    if (!this.tel()) return 'unknown (offline)';
    if (!this.pc3Present()) return 'absent';
    // payload present but flagged offline (robot LAN down) — say so plainly
    return this.pc3Offline() ? 'present (feed offline)' : 'present';
  });
  readonly pc2ThermalLabel = computed(() =>
    this.tel() ? (this.pc2Present() ? 'present' : 'absent') : 'unknown (offline)');

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // periodic refresh (exhaustMap: never stack; catchError keeps the tab alive
    // when the backend/robot is unreachable — robot LAN down 2026-10-14)
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe(([v, t]) => this.apply(v, t));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe(([v, t]) => this.apply(v, t));
    this.refresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.audit('refresh', 'issued read-only GETs', 'versions + telemetry');
    this.refresh$.next();
  }

  // ---------------------------------------------------------------- audit --
  /** Record one attempted action (called on EVERY press from this tab,
   * including failed/disabled ones, so the log explains what an operator tried
   * even while offline). Newest-first, capped, persisted. */
  audit(action: string, result: string, target = ''): void {
    const entry: ManagementAction = { ts: Date.now(), action, target, result };
    const next = [entry, ...this.auditLog()].slice(0, AUDIT_MAX);
    this.auditLog.set(next);
    ManagementComponent.saveAudit(next);
  }

  /** Empty the log (and its storage). Deliberately not self-auditing: an
   * emptied log is its own evidence, and audit-then-wipe would be noise. */
  clearAudit(): void {
    this.auditLog.set([]);
    ManagementComponent.saveAudit([]);
  }

  // --------------------------------------------------------------- guards --
  /** Press on a guarded control. Normally unreachable (the button is
   * disabled); reachable via programmatic dispatch or a future enablement —
   * either way it ONLY logs and opens the confirm dialog. No HTTP, ever. */
  guardPress(g: GuardControl): void {
    this.audit(g.action,
      this.guardsEnabled()
        ? 'pressed — blocked (read-only build: no POST path)'
        : 'disabled press — blocked, requires robot LAN',
      g.target);
    this.pending.set(g);
  }

  confirmGuard(): void {
    const g = this.pending();
    if (!g) return;
    this.audit(g.action, 'confirmed — NOT sent (read-only build: no POST)', g.target);
    this.pending.set(null);
  }

  cancelGuard(): void {
    const g = this.pending();
    if (!g) return;
    this.audit(g.action, 'cancelled by operator', g.target);
    this.pending.set(null);
  }

  // ----------------------------------------------------------------- data --
  private fetch$(): Observable<readonly [SystemVersions | null, Telemetry | null]> {
    return forkJoin([this.fetchVersions$(), this.fetchTelemetry$()]);
  }

  private fetchVersions$(): Observable<SystemVersions | null> {
    return apiGet<SystemVersions>(this.http, API.system.versions).pipe(
      catchError((e: unknown) => {
        this.verError.set(`GET ${API.system.versions.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private fetchTelemetry$(): Observable<Telemetry | null> {
    return apiGet<Telemetry>(this.http, API.telemetry.get).pipe(
      catchError((e: unknown) => {
        this.telError.set(`GET ${API.telemetry.get.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(v: SystemVersions | null, t: Telemetry | null): void {
    if (v) {
      this.verError.set(null);
      this.versions.set(v);
    }
    if (t) {
      this.telError.set(null);
      this.tel.set(t);
    }
  }

  private static loadAudit(): ManagementAction[] {
    try {
      const raw = localStorage.getItem(AUDIT_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e): e is ManagementAction =>
        !!e && typeof e === 'object' &&
        typeof (e as ManagementAction).ts === 'number' &&
        typeof (e as ManagementAction).action === 'string');
    } catch {
      return []; // storage unavailable (privacy mode, SSR, corrupt JSON)
    }
  }

  private static saveAudit(entries: ManagementAction[]): void {
    try {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(entries));
    } catch {
      // storage full/unavailable — the in-memory log still works this session
    }
  }
}
