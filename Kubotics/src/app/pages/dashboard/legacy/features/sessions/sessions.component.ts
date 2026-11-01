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
  type SessionInfo,
  type SessionSendResponse,
  type SessionsState,
} from '../../core/api';

/** WhatsApp session runtime feedback page (2026-10-17, design doc
 * docs/WHATSAPP_SESSION_RUNTIME_DESIGN.md §6 + §10 DECIDED) — the "/chat-style
 * observability surface" for the named sessions the PC-A router drives.
 *
 * Contract (host-local, before the proxy catch-all; DTOs in core/api.ts):
 *   API.sessions.list (GET  /api/sessions)               → SessionsState
 *   API.sessions.send (POST /api/sessions/{name}/send)   → 202 dispatched
 *
 * STRICTLY READ-ONLY from the web app's perspective EXCEPT the send box:
 * there is NO confirm/close/validate control on this page BY DESIGN — a
 * session closes ONLY on Vincent's WhatsApp confirmation
 * (`session_cmd.py confirm` via the PC-A router), never from the dashboard.
 * The send box never auto-creates sessions (404 from the API; the router's
 * `send` is what creates them) and is disabled for CLOSED sessions (409).
 * Signals only — the Angular 22 scaffold is zoneless.
 */

export type { SessionInfo, SessionsState } from '../../core/api';

const REFRESH_MS = 5000;

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bar">
      <h2>WhatsApp Sessions</h2>
      <span class="chip" [class.ok]="state() && !error()">
        {{ error() ? 'offline' : (state() ? counts() : 'loading…') }}
      </span>
      <button class="btn" (click)="refresh()" [disabled]="busy()">↻ refresh</button>
      <button class="tog" (click)="showClosed.set(!showClosed())"
              [title]="'closed sessions: ' + closedCount()">
        {{ showClosed() ? 'hide closed' : 'show closed (' + closedCount() + ')' }}
      </button>
      <span class="meta">{{ metaLine() }}</span>
    </div>

    <div class="content" *ngIf="state() as s; else loading">
      <div class="card" *ngIf="ordered().length === 0">
        <p class="empty" *ngIf="!showClosed() && closedCount() > 0; else noneYet">
          {{ closedCount() }} closed session(s) hidden — click
          “show closed” to see them.
        </p>
        <ng-template #noneYet>
          <p class="empty">No sessions yet — the router creates one when Vincent
            messages WhatsApp without a #name.</p>
        </ng-template>
      </div>

      <div class="card" *ngFor="let sess of ordered(); trackBy: trackByName"
           [class.selected]="selected() === sess.name">
        <div class="row">
          <span class="name">#{{ sess.name }}</span>
          <span class="state" [ngClass]="sess.state.toLowerCase()">
            {{ sess.state }}
          </span>
          <button class="tog" (click)="closeSession(sess.name)"
                  [disabled]="busy()"
                  title="close this session (same as #name final close on WhatsApp)">
            close
          </button>
        </div>

        <p class="ctx">
          opened {{ relTime(sess.opened_at) }}
          <span *ngIf="sess.last_msg_at"> · last msg {{ relTime(sess.last_msg_at) }}</span>
          <span *ngIf="sess.agent_validated_at"> · validated {{ relTime(sess.agent_validated_at) }}</span>
          <span *ngIf="sess.vincent_confirmed_at"> · confirmed {{ relTime(sess.vincent_confirmed_at) }}</span>
        </p>
        <p class="ctx mono" *ngIf="sess.jcode_session_id" [title]="sess.jcode_session_id">
          jcode: {{ sess.jcode_session_id }}
        </p>

        <blockquote class="evidence" *ngIf="sess.evidence">
          <b>agent evidence:</b> {{ sess.evidence }}
        </blockquote>
        <blockquote class="confirmed" *ngIf="sess.confirm_note">
          <b>vincent confirmed:</b> {{ sess.confirm_note }}
        </blockquote>

        <!-- THE one mutation this page can trigger (background dispatch).
             No confirm/close control exists here BY DESIGN: only Vincent's
             WhatsApp confirmation closes a session (design §10 decision 2). -->
        <ng-container *ngIf="sess.state !== 'CLOSED'; else closedNote">
          <textarea rows="2" [ngModel]="drafts()[sess.name] ?? ''"
                    (ngModelChange)="setDraft(sess.name, $event)"
                    placeholder="Send a message to this session…"></textarea>
          <div class="foot">
            <span class="cat">background jcode run — watch “last msg”</span>
            <button class="tog enable" (click)="send(sess.name)"
                    [disabled]="busy() || !(drafts()[sess.name] ?? '').trim()">
              send to session
            </button>
          </div>
        </ng-container>
        <ng-template #closedNote>
          <p class="ctx">closed — a closed session never receives messages
            (reopen = a new session)</p>
        </ng-template>
      </div>
    </div>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">Loading session table…</p>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; white-space: nowrap; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 5px 12px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn:disabled { opacity: .5; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .content { display: flex; flex-direction: column; gap: 12px; padding: 0 14px 14px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
            padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .card.selected { border-color: #10b981; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .name { font: 600 13px/1.3 ui-monospace, monospace; color: #111827; }
    /* lifecycle chips: OPEN amber · VALIDATED green · CLOSED grey (design §10) */
    .state { font: 700 10px/1 system-ui, sans-serif; text-transform: uppercase;
             letter-spacing: .4px; padding: 4px 7px; border-radius: 999px;
             background: #fef3c7; color: #92400e; white-space: nowrap; }
    .state.validated { background: #dbeafe; color: #1e40af; }
    .state.closed { background: #e5e7eb; color: #4b5563; }
    .ctx { font: 12px/1.4 system-ui, sans-serif; color: #9ca3af; margin: 0; }
    .ctx.mono { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .evidence, .confirmed { font: 12px/1.5 system-ui, sans-serif; margin: 0;
            padding: 7px 9px; border-radius: 6px; white-space: pre-wrap;
            overflow-wrap: anywhere; }
    .evidence { background: #f0fdf4; border-left: 3px solid #10b981; color: #065f46; }
    .confirmed { background: #eff6ff; border-left: 3px solid #3b82f6; color: #1e3a8a; }
    textarea { font: 13px/1.45 ui-monospace, monospace; color: #111827;
               border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 9px;
               resize: vertical; background: #f9fafb; }
    textarea:focus { outline: none; border-color: #10b981; background: #fff; }
    .foot { display: flex; justify-content: space-between; align-items: center;
            border-top: 1px solid #f3f4f6; padding-top: 8px; }
    .cat { font: 11px/1 system-ui, sans-serif; color: #9ca3af; }
    .tog { font: 600 11px/1 system-ui, sans-serif; padding: 4px 12px; border-radius: 6px;
           border: 1px solid #9ca3af; background: #f3f4f6; color: #374151; cursor: pointer; }
    .tog.enable { border-color: #065f46; background: #10b981; color: #fff; }
    .tog:disabled { opacity: .5; cursor: default; }
    .empty { font: 600 13px/1.5 system-ui, sans-serif; color: #6b7280; margin: 0;
             text-align: center; padding: 6px 0; }
  `],
})
export class SessionsComponent implements OnInit, OnDestroy {
  /** whole session table (null until the first successful fetch) */
  readonly state = signal<SessionsState | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  /** per-session send drafts (name → text); ngModel binds through setDraft */
  readonly drafts = signal<Record<string, string>>({});
  /** last dispatch acknowledgement ("sent to #x — running in background") */
  readonly ack = signal<string | null>(null);
  readonly selected = signal<string | null>(null);
  /** Vincent 2026-10-18: "filter out closed sessions but have the
   * possibility to unfilter those" — hidden by default, toggle in the bar */
  readonly showClosed = signal(false);

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // periodic refresh (exhaustMap: never stack; catchError keeps the tab
    // alive when the host is down — the same offline tolerance as /chat)
    const poll$ = (): Observable<SessionsState | null> => this.fetch$();
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => poll$()),
    ).subscribe((s) => this.apply(s));
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => poll$()),
    ).subscribe((s) => this.apply(s));
    this.refresh$.next();   // first paint right away
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    this.refresh$.next();
  }

  counts(): string {
    const sessions = this.state()?.sessions ?? [];
    const by = (s: string): number => sessions.filter((x) => x.state === s).length;
    return `${by('OPEN')} open · ${by('VALIDATED')} validated · ${by('CLOSED')} closed`;
  }

  closedCount(): number {
    return (this.state()?.sessions ?? []).filter((x) => x.state === 'CLOSED').length;
  }

  metaLine(): string {
    if (this.error()) return 'session_cmd.py status via GET /api/sessions — poll 5 s';
    return this.ack() ??
      'read-only except the send box — close only via Vincent’s WhatsApp confirm';
  }

  /** most recently active first (the router's newest topic on top) */
  ordered(): SessionInfo[] {
    const sessions = this.state()?.sessions ?? [];
    const visible = this.showClosed()
      ? sessions
      : sessions.filter((x) => x.state !== 'CLOSED');
    return [...visible].sort((a, b) =>
      (b.last_msg_at ?? b.opened_at) - (a.last_msg_at ?? a.opened_at));
  }

  /** identity by name: without it the 5 s poll recreated every card and
   * DESTROYED the textarea being typed in (same lesson as the Chat tab). */
  trackByName(_index: number, s: SessionInfo): string {
    return s.name;
  }

  setDraft(name: string, value: string): void {
    this.drafts.update((d) => ({ ...d, [name]: value }));
  }

  /** THE send box: dispatches into the background (202) — the card's
   * "last msg" timestamp confirms arrival on the next poll. */
  send(name: string): void {
    const msg = (this.drafts()[name] ?? '').trim();
    if (this.busy() || !msg) return;
    this.busy.set(true);
    const route = {
      ...API.sessions.send,
      path: API.sessions.send.path.replace('{name}', encodeURIComponent(name)),
    };
    apiPost<SessionSendResponse>(this.http, route, { msg }).pipe(
      catchError((e: unknown) => {
        this.error.set(`POST ${API.sessions.send.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    ).subscribe((res) => {
      this.busy.set(false);
      if (res?.dispatched) {
        this.error.set(null);
        this.drafts.update((d) => ({ ...d, [name]: '' }));
        this.ack.set(`#${name} dispatched — the jcode run continues in the background`);
        setTimeout(() => this.ack.set(null), 6000);
        this.refresh$.next();   // show the bumped last_msg_at immediately
      }
    });
  }

  /** Vincent 2026-10-18: "add a button in the sessions dashboard to close
   * the session if i want to close easily open sessions" — one click, same
   * `confirm` primitive as the WhatsApp close, note = dashboard:<upn>. */
  closeSession(name: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    const route = {
      ...API.sessions.close,
      path: API.sessions.close.path.replace('{name}', encodeURIComponent(name)),
    };
    apiPost<{ ok: boolean; state?: string }>(this.http, route, {}).pipe(
      catchError((e: unknown) => {
        this.error.set(`POST ${API.sessions.close.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    ).subscribe((res) => {
      this.busy.set(false);
      if (res?.ok) {
        this.error.set(null);
        this.ack.set(`#${name} closed`);
        setTimeout(() => this.ack.set(null), 6000);
        this.refresh$.next();
      }
    });
  }

  private fetch$(): Observable<SessionsState | null> {
    return apiGet<SessionsState>(this.http, API.sessions.list).pipe(
      catchError((e: unknown) => {
        this.error.set(`GET ${API.sessions.list.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private apply(s: SessionsState | null): void {
    if (!s) return;   // offline: keep the last data, error() is already set
    this.error.set(s.error ? `session_cmd: ${s.error}` : null);
    this.state.set(s);
  }

  relTime(ts?: number | null): string {
    if (!ts) return 'never';
    const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }
}
