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
  type Telemetry,
  type VoiceBotResponse,
} from '../../core/api';

/** Phase 1 parity tab 5 (plan §6): the legacy dashboard's *Autonomous Voice
 * Chatbot*. Contract (core/api.ts):
 *   API.telemetry.get (GET /api/telemetry) → { …, voice_bot_running } (badge)
 *   API.service.voiceBotStart (POST /api/service/voice_bot/start)
 *        → {status:"started", running}
 *   API.service.voiceBotStop  (POST /api/service/voice_bot/stop)
 *        → {status:"stopped", running}
 * Start/Stop are NEVER exercised by the CDP harness (they run bot scripts;
 * safety discipline: robot-service POSTs stay user-triggered only).
 * Signals only — Angular 22 scaffold is zoneless.
 */

const REFRESH_MS = 3000;

@Component({
  selector: 'app-voice',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>Autonomous Voice Chatbot</h2>
      <span class="chip" [class.ok]="running()">
        {{ running() ? 'RUNNING' : 'STOPPED' }}
      </span>
      <button class="btn" (click)="start()" [disabled]="busy() || running()">▶ Start Bot</button>
      <button class="btn danger" (click)="stop()" [disabled]="busy() || !running()">■ Stop Bot</button>
      <span class="meta">{{ meta() }}</span>
    </div>

    <p class="result warn" *ngIf="failure() as f">voice bot control: {{ f }}</p>
    <p class="result" *ngIf="result() as r">{{ r }}</p>

    <section class="sec">
      <p class="hint">
        Interactive voice chatbot pipeline with H2 head audio capture, Whisper ASR,
        PC3 Thor GPU reasoning, and Piper neural speaker. Status follows
        <code>voice_bot_running</code> from <code>/api/telemetry</code> (polled at
        {{ intervalMs / 1000 }} s, like the legacy dashboard).
      </p>
      <div class="kv">
        <span>telemetry</span><b>{{ telemetryOk() ? 'reachable' : 'no answer yet' }}</b>
        <span>robot online</span><b>{{ robotOnline() ? 'yes' : 'no (offline)' }}</b>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #fee2e2; color: #991b1b; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 6px 14px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn.danger { border-color: #b91c1c; background: #ef4444; }
    .btn:disabled { opacity: .45; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .result { font: 12px/1.5 system-ui, sans-serif; color: #065f46; background: #ecfdf5;
              border: 1px solid #a7f3d0; border-radius: 8px; padding: 8px 12px;
              margin: 0 14px 10px; }
    .result.warn { color: #92400e; background: #fffbeb; border-color: #fde68a; }
    .sec { padding: 0 14px 14px; }
    .hint { font: 12px/1.6 system-ui, sans-serif; color: #6b7280; margin: 0 0 12px; }
    .hint code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
    .kv { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px;
          font: 12px/1.5 system-ui, sans-serif; color: #6b7280; }
    .kv b { color: #111827; font-weight: 600; }
  `],
})
export class VoiceComponent implements OnInit, OnDestroy {
  readonly intervalMs = REFRESH_MS;
  readonly running = signal(false);
  readonly telemetryOk = signal(false);
  readonly robotOnline = signal(false);
  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);
  readonly result = signal<string | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((t) => this.apply(t));
    this.refresh$.next();                         // immediate first sample
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((t) => this.apply(t));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  meta(): string {
    return 'badge source: legacy /api/telemetry.voice_bot_running';
  }

  start(): void {
    this.call('start');
  }

  stop(): void {
    this.call('stop');
  }

  /** POST voice_bot/start|stop — inline result (legacy used no feedback beyond
   * the badge). NEVER auto-triggered: robot-service POSTs stay user-driven. */
  private call(action: 'start' | 'stop'): void {
    if (this.busy()) return;
    this.busy.set(true);
    const route = action === 'start' ? API.service.voiceBotStart : API.service.voiceBotStop;
    apiPost<VoiceBotResponse>(this.http, route, {}).pipe(
      catchError((e: unknown) => {
        const body = (e as { error?: unknown }).error;
        if (body && typeof body === 'object' && 'error' in body) {
          return of(body as VoiceBotResponse);
        }
        return of({ error: httpErrorText(e) } as VoiceBotResponse);
      }),
    ).subscribe((res) => {
      this.busy.set(false);
      if ('error' in res && res.error) {
        this.failure.set(`voice_bot/${action}: ${res.error}`);
      } else {
        this.failure.set(null);
        this.result.set(`voice_bot/${action} → ${res.status ?? 'ok'}` +
          (res.running !== undefined ? ` (running: ${res.running})` : ''));
        this.running.set(!!res.running);
      }
    });
  }

  private fetch$(): Observable<{ voice?: boolean; online?: boolean } | null> {
    return apiGet<Telemetry>(this.http, API.telemetry.get).pipe(
      map((t) => ({ voice: !!t.voice_bot_running, online: !!t.low_state?.online })),
      catchError((e: unknown) => {
        this.failure.set(`GET ${API.telemetry.get.path}: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(v: { voice?: boolean; online?: boolean } | null): void {
    if (!v) {
      this.telemetryOk.set(false);
      return;
    }
    this.telemetryOk.set(true);
    this.robotOnline.set(!!v.online);
    this.running.set(!!v.voice);
  }
}
