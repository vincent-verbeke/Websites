import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, interval, of } from 'rxjs';
import { catchError, exhaustMap, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  apiPost,
  type VisionPipelineStartResponse,
  type VisionServiceToggleResponse,
  type VisionStatus,
} from '../../core/api';

/** /vision tab — H2 stereo patch (bilateral data stream interface) viewer.
 * Contract (core/api.ts, host-local FastAPI web/server/vision_pipeline.py):
 *   API.vision.status (GET)          → VisionStatus: live service states
 *        (video_hub / stereo_patch_pc1 via the Unitree SDK ServiceList),
 *        receiver IP, PC1:9080 reachability, per-stream health, pipeline step
 *   API.vision.pipelineStart (POST)  → THE one-click bring-up: stop video_hub
 *        (documented conflict) → start stereo_patch_pc1 → wait PC1:9080 → aim
 *        the UDP receiver at this machine → restart the service (the receiver
 *        IP only applies after a restart) → verify RTP. Background; progress
 *        shows in VisionStatus.pipeline.step.
 *   API.vision.serviceToggle (POST)  → separate per-service Start/Stop.
 *   API.vision.stream.* (GET)        → multipart MJPEG: binocular 1920x1080
 *        @15fps (UDP 5002), left eye 544x448 @10fps (5004), right eye (5006).
 * Signals only — Angular 22 scaffold is zoneless. Feature sources must not
 * embed raw API path literals (api.spec.ts greps for those) — use API.*.
 */
const REFRESH_MS = 3_000;

@Component({
  selector: 'app-vision',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>Robot Vision: H2 Stereo Patch</h2>
      <span class="chip" [class.ok]="svc('video_hub') === 'stopped'"
            [class.warn]="svc('video_hub') === 'unknown'">
        video_hub: {{ svc('video_hub') | uppercase }}
      </span>
      <span class="chip" [class.ok]="svc('stereo_patch_pc1') === 'running'"
            [class.warn]="svc('stereo_patch_pc1') === 'unknown'">
        stereo_patch_pc1: {{ svc('stereo_patch_pc1') | uppercase }}
      </span>
      <span class="chip" [class.ok]="flowingCount() === 3">
        streams: {{ flowingCount() }}/3
      </span>
    </div>

    <div class="controls">
      <button class="btn primary" (click)="startPipeline()"
              [disabled]="busy() || pipelineActive()">
        {{ pipelineActive() ? 'Bringing up…' : 'Start Stereo Pipeline' }}
      </button>
      <span class="step" *ngIf="pipelineActive()">
        step: {{ status()?.pipeline?.step || '…' }}
      </span>
      <span class="step done" *ngIf="!pipelineActive() && lastSteps() as s">
        done: {{ s }}
      </span>
      <div class="svc-ctl">
        <span class="ctl-label">video_hub</span>
        <button class="btn small" (click)="toggle('video_hub', true)"
                [disabled]="busy() || svc('video_hub') !== 'stopped'">Start</button>
        <button class="btn small ghost" (click)="toggle('video_hub', false)"
                [disabled]="busy() || svc('video_hub') !== 'running'">Stop</button>
        <span class="ctl-label">stereo_patch_pc1</span>
        <button class="btn small" (click)="toggle('stereo_patch_pc1', true)"
                [disabled]="busy() || svc('stereo_patch_pc1') !== 'stopped'">Start</button>
        <button class="btn small ghost" (click)="toggle('stereo_patch_pc1', false)"
                [disabled]="busy() || svc('stereo_patch_pc1') !== 'running'">Stop</button>
      </div>
      <span class="meta">{{ meta() }}</span>
    </div>

    <p class="result warn" *ngIf="failure() as f">{{ f }}</p>
    <p class="result warn" *ngIf="pipelineError() as e">pipeline: {{ e }}</p>

    <section class="sec">
      <div class="eye wide">
        <div class="eye-head">
          <b>BINOCULAR</b><span>1920&#215;1080 @ 15 fps &#183; UDP 5002 &#183; raw, no undistortion</span>
        </div>
        <div class="eye-body">
          <img [src]="streams()[0].src" [alt]="streams()[0].label + ' Video Stream'" />
          <div class="nostream" *ngIf="!streamFlowing('binocular')">
            NO SIGNAL &#8212; start the stereo pipeline
          </div>
        </div>
      </div>
      <div class="eyes">
        <div class="eye" *ngFor="let s of streams().slice(1)">
          <div class="eye-head">
            <b>{{ s.label }}</b><span>544&#215;448 @ 10 fps &#183; UDP {{ s.port }}</span>
          </div>
          <div class="eye-body">
            <img [src]="s.src" [alt]="s.label + ' Video Stream'" />
            <div class="nostream" *ngIf="!streamFlowing(s.key)">
              NO SIGNAL &#8212; start the stereo pipeline
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px 4px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .chip.warn { background: #fef3c7; color: #92400e; }
    .controls { display: flex; align-items: center; gap: 10px; padding: 6px 14px 10px;
                flex-wrap: wrap; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 6px 14px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn.primary { padding: 8px 18px; font-size: 13px; background: #0e7490;
                   border-color: #0e7490; }
    .btn.ghost { background: #fff; color: #b91c1c; border-color: #fca5a5; }
    .btn.small { padding: 4px 10px; }
    .btn:disabled { opacity: .45; cursor: default; }
    .step { font: 12px/1.4 ui-monospace, monospace; color: #0e7490; }
    .step.done { color: #6b7280; }
    .svc-ctl { display: flex; align-items: center; gap: 6px; margin-left: 8px; }
    .ctl-label { font: 12px/1 system-ui, sans-serif; color: #374151; margin-left: 8px; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; margin-left: auto; }
    .result { font: 12px/1.5 system-ui, sans-serif; color: #92400e; background: #fffbeb;
              border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px;
              margin: 0 14px 10px; }
    .sec { padding: 0 14px 14px; }
    .eyes { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    .eye { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
    .eye-head { display: flex; justify-content: space-between; align-items: center;
                padding: 8px 12px; background: #111827; }
    .eye-head b { font: 600 12px/1 system-ui, sans-serif; color: #22d3ee; }
    .eye-head span { font: 11px/1 system-ui, sans-serif; color: #9ca3af; }
    .eye-body { position: relative; aspect-ratio: 16/9; background: #0a0e17;
                display: flex; align-items: center; justify-content: center; }
    .eye-body img { width: 100%; height: 100%; object-fit: cover; }
    .nostream { position: absolute; inset: 0; display: flex; align-items: center;
                justify-content: center; font: 600 12px/1 system-ui, sans-serif;
                color: #64748b; letter-spacing: .08em; pointer-events: none; }
  `],
})
export class VisionComponent implements OnInit, OnDestroy {
  /** Binocular first (the wide panel), then the two eyes. */
  readonly streams = signal([
    { key: 'binocular', label: 'BINOCULAR', port: 5002, src: API.vision.stream.binocular.path },
    { key: 'left', label: 'LEFT EYE', port: 5004, src: API.vision.stream.left.path },
    { key: 'right', label: 'RIGHT EYE', port: 5006, src: API.vision.stream.right.path },
  ]);
  readonly status = signal<VisionStatus | null>(null);
  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

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

  svc(name: string): string {
    return this.status()?.services?.[name] ?? 'unknown';
  }

  streamFlowing(key: string): boolean {
    return !!this.status()?.streams?.[key as 'binocular']?.flowing;
  }

  flowingCount(): number {
    const s = this.status()?.streams;
    return s ? ['binocular', 'left', 'right'].filter((k) =>
      s[k as 'binocular']?.flowing).length : 0;
  }

  pipelineActive(): boolean {
    return !!this.status()?.pipeline?.active;
  }

  pipelineError(): string | null {
    return this.status()?.pipeline?.error ?? null;
  }

  lastSteps(): string | null {
    const done = this.status()?.pipeline?.steps_done ?? [];
    return done.length ? done.join(' → ') : null;
  }

  meta(): string {
    const s = this.status();
    const ip = s?.receiver_ip ?? '?';
    const cfg = s?.pc1_9080 === null || s?.pc1_9080 === undefined
      ? 'PC1:9080 ?' : (s.pc1_9080 ? 'PC1:9080 up' : 'PC1:9080 down');
    return `receiver ${ip} · ${cfg}`;
  }

  /** THE one-click button (API.vision.pipelineStart). */
  startPipeline(): void {
    if (this.busy()) return;
    this.busy.set(true);
    apiPost<VisionPipelineStartResponse>(this.http, API.vision.pipelineStart, {}).pipe(
      catchError((e: unknown) => of<VisionPipelineStartResponse>(
        { ok: false, error: httpErrorText(e) })),
    ).subscribe((res) => {
      this.busy.set(false);
      if (!res.ok) this.failure.set(`pipeline: ${res.error ?? 'failed to start'}`);
      else this.failure.set(null);
      this.refresh$.next();
    });
  }

  /** Separate per-service Start/Stop (API.vision.serviceToggle). */
  toggle(service: 'video_hub' | 'stereo_patch_pc1', enabled: boolean): void {
    if (this.busy()) return;
    this.busy.set(true);
    apiPost<VisionServiceToggleResponse>(
      this.http, API.vision.serviceToggle, { service, enabled },
    ).pipe(
      catchError((e: unknown) => of<VisionServiceToggleResponse>(
        { ok: false, error: httpErrorText(e) })),
    ).subscribe((res) => {
      this.busy.set(false);
      if (!res.ok) this.failure.set(`${service}: ${res.error ?? 'toggle failed'}`);
      else this.failure.set(null);
      this.refresh$.next();
    });
  }

  private fetch$() {
    return apiGet<VisionStatus>(this.http, API.vision.status).pipe(
      catchError((e: unknown) => {
        this.failure.set(`GET ${API.vision.status.path}: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(v: VisionStatus | null): void {
    if (v !== null) this.status.set(v);
  }
}
