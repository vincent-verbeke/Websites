import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, interval, of } from 'rxjs';
import { catchError, exhaustMap, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  apiPost,
  type OllamaModel,
  type OllamaModels,
  type OllamaPullResponse as PullResult,
} from '../../core/api';

/** Phase 1 parity tab 4 (plan §6): the legacy dashboard's *Thor Ollama
 * Models*. Contract (core/api.ts, from robot_dashboard_server.py):
 *   API.ollama.models (GET /api/ollama/models) → { models:[{name,…}]?, error? }
 *        (degrades to {models:[], error:"…"} when PC3:11434 is unreachable)
 *   API.ollama.pull (POST /api/ollama/pull) → {status:"initiated"} | {error}
 *        (async pull; progress arrives via telemetry.pull_status — pullActive)
 * Pull is NEVER exercised by the CDP harness (GB downloads; PC3 off).
 * Signals only — Angular 22 scaffold is zoneless.
 */

const REFRESH_MS = 10_000;

@Component({
  selector: 'app-ollama',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bar">
      <h2>Thor Ollama Models</h2>
      <span class="chip" [class.ok]="models().length > 0 && !failure()">
        {{ failure() ? 'PC3 offline' : (models().length ? models().length + ' models' : 'no models') }}
      </span>
      <button class="btn" (click)="refresh()">↻ refresh</button>
      <span class="meta">{{ meta() }}</span>
    </div>

    <p class="result warn" *ngIf="failure() as f">Ollama registry: {{ f }}</p>
    <p class="result" *ngIf="pullResult() as r">
      pull {{ r.status ?? 'error' }}<ng-container *ngIf="r.model"> — {{ r.model }}</ng-container>
      <ng-container *ngIf="r.error"> — {{ r.error }}</ng-container>
    </p>

    <section class="sec">
      <p class="hint">Manage and pull large language models running on PC3 NVIDIA Thor GPU Tensor Cores.</p>
      <div class="input-row">
        <input class="input" type="text" placeholder="e.g. qwen2.5:7b or llama3.3:70b"
               [(ngModel)]="modelInput" (keyup.enter)="pull()" [disabled]="pulling()" />
        <button class="btn alt" (click)="pull()" [disabled]="pulling() || !modelInput.trim()">
          {{ pulling() ? 'pulling…' : 'Pull Model' }}
        </button>
      </div>

      <div class="tags">
        <span class="tag-title">Installed models:</span>
        <span class="tag" *ngFor="let m of models()">{{ m.name }}</span>
        <span class="tag empty" *ngIf="!models().length">Loading models…</span>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 6px 14px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn.alt { border-color: #1f2937; background: #1f2937; }
    .btn:disabled { opacity: .5; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .result { font: 12px/1.5 system-ui, sans-serif; color: #065f46; background: #ecfdf5;
              border: 1px solid #a7f3d0; border-radius: 8px; padding: 8px 12px;
              margin: 0 14px 10px; }
    .result.warn { color: #92400e; background: #fffbeb; border-color: #fde68a; }
    .sec { padding: 0 14px 14px; }
    .hint { font: 12px/1.5 system-ui, sans-serif; color: #6b7280; margin: 0 0 12px; }
    .input-row { display: flex; gap: 8px; margin-bottom: 14px; }
    .input { flex: 1; font: 13px/1 system-ui, sans-serif; padding: 8px 10px;
             border: 1px solid #d1d5db; border-radius: 8px; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .tag-title { font: 600 12px/1 system-ui, sans-serif; color: #374151; }
    .tag { font: 12px/1 ui-monospace, monospace; padding: 5px 10px; border-radius: 999px;
           background: #eef2ff; color: #3730a3; }
    .tag.empty { background: #f3f4f6; color: #9ca3af; }
  `],
})
export class OllamaComponent implements OnInit, OnDestroy {
  readonly models = signal<OllamaModel[]>([]);
  readonly failure = signal<string | null>(null);
  readonly pulling = signal(false);
  readonly pullResult = signal<PullResult | null>(null);
  modelInput = '';

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((r) => this.apply(r));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((r) => this.apply(r));
    this.refresh$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  meta(): string {
    return 'source: PC3 :11434 via legacy /api/ollama/models';
  }

  /** POST /api/ollama/pull — result inline (legacy used alert()). Progress
   * arrives later via telemetry.pull_status; not polled here yet. */
  pull(): void {
    const model = this.modelInput.trim();
    if (!model || this.pulling()) return;
    this.pulling.set(true);
    apiPost<PullResult>(this.http, API.ollama.pull, { model }).pipe(
      catchError((e: unknown) => {
        // legacy sends structured {error} with 4xx/5xx — honour the body
        const body = (e as { error?: unknown }).error;
        if (body && typeof body === 'object' && 'error' in body) {
          return of(body as PullResult);
        }
        return of({ error: httpErrorText(e) } as PullResult);
      }),
    ).subscribe((res) => {
      this.pullResult.set(res);
      this.pulling.set(false);
      if (res.status === 'initiated') {
        this.modelInput = '';
        this.refresh$.next();
      }
    });
  }

  private fetch$(): Observable<OllamaModels | null> {
    return apiGet<OllamaModels>(this.http, API.ollama.models).pipe(
      catchError((e: unknown) => {
        this.failure.set(httpErrorText(e));
        return of(null);
      }),
    );
  }

  private apply(r: OllamaModels | null): void {
    if (!r) return;
    if (r.error) {
      this.failure.set(r.error);           // server-side degradation payload
      this.models.set([]);
      return;
    }
    this.failure.set(null);
    this.models.set(r.models ?? []);
  }
}
