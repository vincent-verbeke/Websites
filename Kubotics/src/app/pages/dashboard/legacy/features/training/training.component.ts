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
  type CloudTrainingJob,
  type CloudTrainingState,
  type CloudTrainingStopRequest,
  type CloudTrainingStopResponse,
  type TrainingMetrics,
  type TrainingState,
} from '../../core/api';

/** Phase 1 parity tab 3 (plan §6): the legacy dashboard's *RL Training
 * Telemetry*. Contract (core/api.ts, from robot_dashboard_server.py,
 * read-only GET):
 *   API.training.get (GET /api/training) → { running, status, metrics:
 *                        {step, sps, ret_mean, iter, succ, fall, loss_pg, ent}?
 *                        , total_steps?, progress_pct?, events[]?, error? }
 * get_pc3_training() degrades gracefully when PC3 is unreachable (battery off
 * 2026-10-13): {running:false, status:"UNKNOWN", metrics:null, error:"…"}.
 * Plus the LIVE cloud card (host-local, web/server/app.py — user 2026-10-15):
 *   API.training.cloud (GET /api/training/cloud) → CloudTrainingState: the
 *     SageMaker picture (recent jobs both regions, active job detail, last
 *     train.jsonl metrics, billable-time cost); fail-soft 200 {…, error}
 *     when the aws CLI/credentials are absent — the card shows a muted
 *     "cloud job info unavailable" chip and the page keeps working.
 *   API.training.cloudStop (POST /api/training/cloud/stop) → THE single
 *     mutating call of this tab: {name} → {ok:true, name} | {ok:false, error}
 *     (400 when the name is not a recent non-terminal job; repeating the
 *     stop is idempotent). Read-only everywhere else; motion untouched.
 * Signals only — Angular 22 scaffold is zoneless.
 */

export type { TrainingMetrics, TrainingState } from '../../core/api';

const REFRESH_MS = 5000;
const CLOUD_REFRESH_MS = 30_000;
const DEFAULT_TOTAL_STEPS = 1_228_800;

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>RL Training</h2>
      <span class="chip" [class.ok]="running()" [class.warn]="checking()">
        {{ statusLabel() }}
      </span>
      <span class="chip" *ngIf="sps() !== null">{{ sps() }} SPS</span>
      <span class="chip ok" *ngIf="focusVerdict() === 'PASS'">FOCUS: PASS</span>
      <span class="chip bad" *ngIf="focusVerdict() === 'FAIL'">FOCUS: FAIL — do not continue</span>
      <button class="btn" (click)="refresh()">↻ refresh</button>
      <span class="meta">{{ meta() }}</span>
    </div>

    <p class="result warn" *ngIf="failure() as f">PC3 telemetry: {{ f }}</p>

    <!-- LIVE cloud (SageMaker) card — host-local GET, auto-refresh 30 s.
         Degrades to a muted chip on error; the STOP button is the tab's
         ONLY mutating action (window.confirm → POST → refresh). -->
    <section class="sec cloud">
      <h3>Cloud training job <span class="meta">· auto-refresh 30 s</span></h3>

      <div [ngSwitch]="cloudMode()">
        <div *ngSwitchCase="'loading'" class="meta">querying AWS (list-training-jobs)…</div>

        <div *ngSwitchCase="'unavailable'">
          <span class="chip warn">cloud job info unavailable</span>
          <span class="meta"> {{ cloudErrorDetail() }}</span>
        </div>

        <div *ngSwitchCase="'idle'">
          <span class="chip warn">no recent cloud job</span>
          <span class="meta"> no non-Failed training job in the last 20 (both regions)</span>
        </div>

        <div *ngSwitchDefault>
          <div class="cloud-head">
            <b class="job-name">{{ jobName() }}</b>
            <span class="chip">{{ jobRegion() }}</span>
            <span class="chip" *ngIf="cloudInstance()">{{ cloudInstance() }}</span>
            <span class="chip" [class.ok]="statusClass() === 'ok'"
                  [class.bad]="statusClass() === 'bad'"
                  [class.warn]="statusClass() === 'warn'">{{ jobStatus() }}</span>
            <span class="chip" *ngIf="secondaryStatus() as ss">{{ ss }}</span>
          </div>

          <div class="meta">{{ timingLine() }}</div>

          <div class="track" *ngIf="cloudPct() !== null">
            <div class="fill" [style.width.%]="cloudPct()"></div>
          </div>
          <div class="prog" *ngIf="cloudPct() !== null">
            {{ cloudPct() }}% of MaxRuntime elapsed
          </div>

          <div class="grid">
            <div class="m wide"><span>latest metrics (train.jsonl)</span>
              <b class="metrics-line">{{ metricsLine() }}</b></div>
            <div class="m wide"><span>cost (estimate)</span>
              <b class="metrics-line">{{ costLine() }}</b></div>
          </div>

          <div class="cloud-actions">
            <button class="btn btn-stop" *ngIf="canStop()"
                    [disabled]="stopping() || jobStatus() === 'Stopping'"
                    (click)="stopCloud()">
              {{ stopping() || jobStatus() === 'Stopping' ? 'STOPPING…' : '⏹ STOP JOB' }}
            </button>
            <span class="meta" *ngIf="stopNote() as n">{{ n }}</span>
          </div>
        </div>
      </div>
    </section>

    <ng-container *ngIf="state() as t; else loading">
      <section class="sec">
        <div class="track">
          <div class="fill" [style.width.%]="pct(t)"></div>
        </div>
        <div class="prog">
          {{ (t.metrics?.step ?? 0).toLocaleString() }} /
          {{ (t.total_steps ?? 1228800).toLocaleString() }} steps ({{ pct(t) }}%)
        </div>
      </section>

      <section class="sec">
        <h3>Metrics</h3>
        <div class="grid">
          <div class="m"><span>ret_mean</span><b>{{ num(t.metrics?.ret_mean, 2) }}</b></div>
          <div class="m"><span>sps</span><b>{{ int(t.metrics?.sps) }}</b></div>
          <div class="m"><span>iteration</span><b>{{ t.metrics?.iter !== undefined ? 'Iter ' + t.metrics?.iter : '—' }}</b></div>
          <div class="m"><span>succ / fall</span><b>{{ (t.metrics?.succ ?? '—') + ' / ' + (t.metrics?.fall ?? '—') }}</b></div>
          <div class="m"><span>loss_pg</span><b>{{ num(t.metrics?.loss_pg, 4) }}</b></div>
          <div class="m"><span>entropy</span><b>{{ num(t.metrics?.ent, 4) }}</b></div>
          <div class="m" title="fraction of worlds that ever reached the arms-in-front stage (need >= 50%)">
            <span>point1 (arms front)</span>
            <b>{{ point1() !== null ? ((point1()! * 100) | number: '1.0-1') + '% / 50%' : '—' }}</b>
          </div>
        </div>
      </section>

      <section class="sec">
        <h3>Duty-cycle events</h3>
        <pre class="log">{{ (t.events?.length ? t.events : ['No duty-cycle events recorded yet.']) | json }}</pre>
      </section>
    </ng-container>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">Loading training telemetry…</p>
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
    .chip.bad { background: #fee2e2; color: #991b1b; font-weight: 700; }
    .chip.warn { background: #f3f4f6; color: #6b7280; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .result { font: 12px/1.5 system-ui, sans-serif; color: #92400e; background: #fffbeb;
              border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px;
              margin: 0 14px 10px; }
    .sec { padding: 0 14px 14px; }
    .track { height: 10px; border-radius: 999px; background: #e5e7eb; overflow: hidden; }
    .fill { height: 100%; background: #10b981; transition: width .4s; }
    .prog { font: 12px/1.6 ui-monospace, monospace; color: #374151; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .m { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
    .m span { display: block; font: 11px/1 system-ui, sans-serif; color: #9ca3af; margin-bottom: 6px; }
    .m b { font: 600 15px/1 ui-monospace, monospace; color: #111827; }
    .log { font: 11px/1.5 ui-monospace, monospace; color: #374151; background: #f9fafb;
           border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px;
           margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; }
    /* cloud (SageMaker) card */
    .cloud { border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb;
             padding: 12px 14px; margin: 0 14px 12px; }
    .cloud .meta { display: inline-block; }
    .cloud-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .job-name { font: 700 14px/1.3 ui-monospace, monospace; color: #111827;
                word-break: break-all; }
    .m.wide { grid-column: 1 / -1; }
    .m b.metrics-line { font-size: 12px; line-height: 1.5; }
    .cloud-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .btn-stop { border-color: #991b1b; background: #dc2626; }
    .btn-stop:disabled { opacity: .55; cursor: default; }
  `],
})
export class TrainingComponent implements OnInit, OnDestroy {
  readonly state = signal<TrainingState | null>(null);
  readonly failure = signal<string | null>(null);
  readonly checking = signal(false);
  /** GET /api/training/cloud (CloudTrainingState; null until the first
   * answer — transport errors are synthesized as the fail-soft error shape). */
  readonly cloud = signal<CloudTrainingState | null>(null);
  /** in-flight POST stop — set synchronously in the click handler so a
   * double-click can never fire the stop twice (idempotency guard #1). */
  readonly stopping = signal(false);
  /** last stop outcome ("stop requested: …" / "stop failed: …") */
  readonly stopNote = signal<string | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();
  private readonly cloudRefresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((t) => this.apply(t));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((t) => this.apply(t));
    this.refresh$.next();
    // cloud card: auto-refresh every 30 s (exhaustMap = never overlap slow
    // AWS calls) + an immediate first fetch; all torn down on destroy.
    interval(CLOUD_REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.cloudFetch$()),
    ).subscribe((c) => this.applyCloud(c));
    this.cloudRefresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.cloudFetch$()),
    ).subscribe((c) => this.applyCloud(c));
    this.cloudRefresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  running(): boolean {
    return !!this.state()?.running || this.state()?.status === 'RUNNING';
  }

  statusLabel(): string {
    const t = this.state();
    if (!t) return 'loading…';
    if (t.status === 'RUNNING') return 'STATUS: RUNNING';
    if (t.status === 'PAUSED_COOLDOWN') return 'PAUSED (THERMAL COOLDOWN)';
    return t.running ? 'STATUS: ACTIVE' : 'STATUS: STOPPED';
  }

  sps(): string | null {
    const v = this.state()?.metrics?.sps;
    return v === undefined ? null : String(Math.round(v));
  }

  /** FOCUS gate verdict written by the trainer at exit (PASS | FAIL | null). */
  focusVerdict(): string | null {
    return this.state()?.metrics?.focus ?? null;
  }

  /** fraction of worlds that ever reached the arms-in-front stage, else null */
  point1(): number | null {
    const v = this.state()?.metrics?.point1;
    return v === undefined || v === null ? null : Number(v);
  }

  meta(): string {
    const t = this.state();
    return t?.error ? `source error: ${t.error}` : 'source: PC3 :8999/training (legacy /api/training)';
  }

  pct(t: TrainingState): number {
    if (t.progress_pct !== undefined) return Math.round(t.progress_pct);
    const total = t.total_steps ?? DEFAULT_TOTAL_STEPS;
    const step = t.metrics?.step ?? 0;
    return Math.min(100, Math.round((step / total) * 1000) / 10);
  }

  num(v: number | undefined, digits: number): string {
    return v !== undefined ? Number(v).toFixed(digits) : '—';
  }

  int(v: number | undefined): string {
    return v !== undefined ? String(Math.round(v)) : '—';
  }

  private fetch$(): Observable<TrainingState | null> {
    return apiGet<TrainingState>(this.http, API.training.get).pipe(
      catchError((e: unknown) => {
        this.failure.set(httpErrorText(e));
        return of(null);
      }),
    );
  }

  private apply(t: TrainingState | null): void {
    if (t) {
      this.failure.set(null);
      this.state.set(t);
      // legacy showed the transport/source error inside the tile as well
      if (t.error) this.failure.set(`PC3: ${t.error}`);
    }
  }

  // ---- cloud card (host-local GET /api/training/cloud + POST …/stop) ------

  cloudMode(): 'loading' | 'unavailable' | 'idle' | 'ok' {
    const c = this.cloud();
    if (!c) return 'loading';
    if (c.error) return 'unavailable';
    return c.active ? 'ok' : 'idle';
  }

  cloudErrorDetail(): string {
    return this.cloud()?.error ?? '';
  }

  jobName(): string {
    return this.activeJob()?.name ?? '—';
  }

  jobStatus(): string {
    return this.activeJob()?.status ?? '—';
  }

  jobRegion(): string {
    return this.activeJob()?.region ?? '—';
  }

  cloudInstance(): string | null {
    return this.cloud()?.detail?.instance_type ?? null;
  }

  secondaryStatus(): string | null {
    return this.cloud()?.detail?.secondary_status ?? null;
  }

  /** status → chip class (running/done green, Failed red, *ting grey) */
  statusClass(): string {
    switch (this.jobStatus()) {
      case 'InProgress':
      case 'Completed':
        return 'ok';
      case 'Failed':
        return 'bad';
      case 'Stopping':
      case 'Stopped':
        return 'warn';
      default:
        return '';
    }
  }

  /** started · elapsed · MaxRuntime line for the card */
  timingLine(): string {
    const started =
      this.cloud()?.detail?.start_time ?? this.activeJob()?.started ?? null;
    const parts = [started ? `started ${started}` : 'started —'];
    const e = this.elapsedSeconds();
    parts.push(e !== null ? `elapsed ${this.fmtDur(e)}` : 'elapsed —');
    const max = this.cloud()?.detail?.max_runtime_seconds ?? null;
    parts.push(max !== null ? `max runtime ${this.fmtDur(max)}` : 'max runtime —');
    return parts.join(' · ');
  }

  /** thin progress bar: elapsed/MaxRuntime (cloud total steps are unknown) */
  cloudPct(): number | null {
    const e = this.elapsedSeconds();
    const max = this.cloud()?.detail?.max_runtime_seconds ?? null;
    if (e === null || max === null || max <= 0) return null;
    return Math.min(100, Math.round((e / max) * 1000) / 10);
  }

  /** latest train.jsonl line: iter / step / ret_mean / succ / fall / point1 */
  metricsLine(): string {
    const m = this.cloud()?.metrics;
    if (!m) return 'no metrics yet (checkpoints/latest/train.jsonl missing)';
    const num = (v: number | null): string =>
      v === null ? '—' : String(Math.round(v * 100) / 100);
    const pct = (v: number | null): string =>
      v === null ? '—' : `${(v * 100).toFixed(1)}%`;
    return [
      `iter ${num(m.iter)}`, `step ${num(m.step)}`,
      `ret_mean ${m.ret_mean !== null ? m.ret_mean.toFixed(2) : '—'}`,
      `succ ${m.succ !== null ? m.succ.toFixed(2) : '—'}`,
      `fall ${m.fall !== null ? m.fall.toFixed(2) : '—'}`,
      `point1 ${pct(m.point1)}`, `stage ${num(m.stage)}`, `sps ${num(m.sps)}`,
    ].join(' · ');
  }

  /** billable seconds + $ estimate (billable/3600 × on-demand rate) */
  costLine(): string {
    const cost = this.cloud()?.cost;
    if (!cost) return '—';
    const billable = cost.billable_seconds !== null
      ? `${cost.billable_seconds.toLocaleString()} s billable` : 'billable —';
    if (cost.usd !== null && cost.rate_usd_per_hour !== null) {
      return `${billable} · ~$${cost.usd.toFixed(2)} @ $${cost.rate_usd_per_hour}/h`;
    }
    return `${billable} · $ estimate n/a (rate unknown)`;
  }

  canStop(): boolean {
    const s = this.jobStatus();
    return s === 'InProgress' || s === 'Stopping';
  }

  /** window.confirm → POST stop → refresh the card. The synchronous
   * stopping() guard fires at most ONE request per press (double-click
   * safe); the backend is idempotent on top: a job already Stopping (or
   * one the first request just stopped) answers ok:true. */
  stopCloud(): void {
    const job = this.activeJob();
    if (!job || this.stopping()) return;
    const sure = window.confirm(
      `STOP cloud training job "${job.name}"?\n\n`
      + 'SageMaker stops it immediately — this cannot be undone.');
    if (!sure) return;
    this.stopping.set(true);
    apiPost<CloudTrainingStopResponse, CloudTrainingStopRequest>(
      this.http, API.training.cloudStop, { name: job.name },
    ).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.stopping.set(false);
        this.stopNote.set(res.ok
          ? `stop requested: ${res.name ?? job.name}`
          : `stop failed: ${res.error ?? 'unknown error'}`);
        this.cloudRefresh$.next();
      },
      error: (e: unknown) => {
        this.stopping.set(false);
        this.stopNote.set(`stop failed: ${httpErrorText(e)}`);
        this.cloudRefresh$.next();
      },
    });
  }

  private activeJob(): CloudTrainingJob | null {
    return this.cloud()?.active ?? null;
  }

  /** seconds started→ended (or →now while running); null when unknown */
  private elapsedSeconds(): number | null {
    const c = this.cloud();
    const startRaw = c?.detail?.start_time ?? c?.active?.started ?? null;
    if (!startRaw) return null;
    const start = Date.parse(startRaw);
    if (Number.isNaN(start)) return null;
    const endRaw = c?.detail?.end_time ?? c?.active?.ended ?? null;
    const parsedEnd = endRaw ? Date.parse(endRaw) : NaN;
    const end = Number.isNaN(parsedEnd) ? Date.now() : parsedEnd;
    const secs = Math.floor((end - start) / 1000);
    return secs >= 0 ? secs : null;
  }

  private fmtDur(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  private cloudFetch$(): Observable<CloudTrainingState> {
    // transport failure (older backend / proxy hiccup) → the fail-soft shape,
    // so the card degrades to its "unavailable" chip instead of breaking.
    return apiGet<CloudTrainingState>(this.http, API.training.cloud).pipe(
      catchError((e: unknown) => of<CloudTrainingState>({
        jobs: [], active: null, detail: null, metrics: null, cost: null,
        error: httpErrorText(e),
      })),
    );
  }

  private applyCloud(c: CloudTrainingState): void {
    // once a stopped job reaches a terminal state the stop note is stale
    if (c.active &&
        ['Completed', 'Failed', 'Stopped'].includes(c.active.status)) {
      this.stopNote.set(null);
    }
    this.cloud.set(c);
  }
}
