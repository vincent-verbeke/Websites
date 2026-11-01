import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, forkJoin, interval, of } from 'rxjs';
import { catchError, exhaustMap, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  apiPost,
  type ApiPostRoute,
  type ChatQuestion,
  type ChatState,
  type MailWatchPending,
  type MailWatchers,
  type WhatsappInbox,
  type WhatsappInboxMsg,
} from '../../core/api';

/** Jcode Chat tab (2026-10-13): the coding agent writes questions into the
 * host-local JSON store (scripts/chat/jcode_chat.py → web/chat/state.json);
 * the user answers from here and copies the agent-composed prompt back into
 * a Jcode chat. Contract (host-local, before the proxy catch-all; DTOs in
 * core/api.ts):
 *   API.chat.state  (GET  /api/chat/state)  → ChatState (created on demand)
 *   API.chat.reply  (POST /api/chat/reply)  → { id, reply } → updated state
 *   API.chat.prompt (POST /api/chat/prompt) → { prompt } → updated state
 *   API.chat.inbox  (GET  /api/chat/inbox)  → WhatsappInbox — READ-ONLY view
 *     of the user's WhatsApp messages (web/chat/inbox.json; no send here)
 * Signals only — the Angular 22 scaffold is zoneless.
 */

export type { ChatQuestion, ChatState, MailWatchPending, MailWatchers, WhatsappInbox, WhatsappInboxMsg } from '../../core/api';

const REFRESH_MS = 5000;

/** Sender grouping for the WhatsApp card: messages keyed by the RAW `from`
 * (labelled formatted — the raw id stays in the group/title). Records without
 * a sender (delivery receipts, type "status") land in one trailing system
 * group, so the user's own messages always come first. */
interface WaGroup {
  raw: string | null;
  label: string;
  messages: WhatsappInboxMsg[];
}

/** "41797481975" → "+41 797 481 975" (CC = first 2 digits, rest in 3s).
 * Non-numeric senders pass through unchanged. */
function formatFrom(raw: string): string {
  if (!/^\d{6,15}$/.test(raw)) return raw;
  return `+${raw.slice(0, 2)} ${raw.slice(2).replace(/(\d{3})(?=\d)/g, '$1 ')}`.trim();
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bar">
      <h2>Jcode Chat</h2>
      <span class="chip" [class.ok]="state() && !error()">
        {{ error() ? 'offline'
            : (state() ? counts() : 'loading…') }}
      </span>
      <button class="btn" (click)="refresh()" [disabled]="busy()">↻ refresh</button>
      <span class="meta">{{ error() ?? 'agent ↔ web UI via web/chat/state.json — poll 5 s' }}</span>
    </div>

    <div class="content" *ngIf="state() as s; else loading">
      <!-- Prompt card: pre-composed by the agent, editable + copyable -->
      <div class="card">
        <div class="row">
          <span class="name">Prompt</span>
          <span class="foot-actions">
            <button class="tog" (click)="copyPrompt()">
              {{ copied() ? 'copied ✓' : 'copy' }}
            </button>
            <button class="tog enable" (click)="savePrompt()"
                    [disabled]="busy() || promptDraft() === s.prompt">
              save
            </button>
          </span>
        </div>
        <textarea class="prompt" rows="4" [ngModel]="promptDraft()"
                  (ngModelChange)="setPrompt($event)"
                  placeholder="No prompt yet — the agent or you can compose one here."></textarea>
        <p class="hint">Copy this into a Jcode chat to hand the answers back to the agent.</p>
      </div>

      <div class="card" *ngIf="pendingCount() === 0">
        <p class="empty">No pending questions — the agent isn't waiting on you. 🎉</p>
      </div>

      <div class="card" *ngFor="let q of visible(); trackBy: trackById">
        <div class="row">
          <span class="name">{{ q.session }}</span>
          <span class="state" [class.answered]="q.status === 'answered'">
            {{ q.status }}
          </span>
        </div>
        <p class="q">{{ q.question }}</p>
        <p class="ctx" *ngIf="q.context">{{ q.context }}</p>

        <ng-container *ngIf="q.status === 'pending'; else shownReply">
          <textarea rows="3" [ngModel]="drafts()[q.id] ?? ''"
                    (ngModelChange)="setDraft(q.id, $event)"
                    placeholder="Type your reply…"></textarea>
          <div class="foot">
            <span class="cat">#{{ q.id }}</span>
            <button class="tog enable" (click)="sendReply(q.id)"
                    [disabled]="busy() || !(drafts()[q.id] ?? '').trim()">
              Send reply
            </button>
          </div>
        </ng-container>
        <ng-template #shownReply>
          <p class="reply" *ngIf="q.reply"><b>reply:</b> {{ q.reply }}</p>
        </ng-template>
      </div>
    </div>
    <ng-template #loading>
      <p class="meta" style="padding: 0 14px;">Loading chat state…</p>
    </ng-template>

    <!-- WhatsApp inbox (READ-ONLY): own 5 s exhaustMap poll, survives the
         host being down (catchError → keep last data). No send/reply here —
         outbound stays in scripts/whatsapp/wa.py. -->
    <div class="content">
      <div class="card">
        <div class="row">
          <span class="name">WhatsApp</span>
          <span class="chip" [class.ok]="waSeen() && !waError()">
            {{ waError() ? 'offline'
                : (waSeen() ? waMessages().length + ' messages' : 'loading…') }}
          </span>
        </div>

        <p class="empty" *ngIf="waSeen() && waMessages().length === 0">
          No WhatsApp messages yet
        </p>

        <ng-container *ngFor="let g of waGroups(); trackBy: trackGroup">
          <div class="wa-group">
            <span class="wa-from" [title]="g.raw ?? 'no sender (webhook status updates)'">
              {{ g.label }}
            </span>
            <span class="wa-count">{{ g.messages.length }} msg<span *ngIf="g.messages.length !== 1">s</span></span>
          </div>

          <div class="wa-msg" *ngFor="let m of g.messages; trackBy: trackMsg">
            <div class="row">
              <span class="wa-text">{{ displayText(m) }}</span>
              <span class="state" [class.wa-new]="m.status === 'new'"
                    [class.wa-done]="m.status !== 'new'">
                {{ m.status ?? 'unknown' }}
              </span>
            </div>
            <p class="ctx">{{ relTime(m.ts) }}<span *ngIf="m.ts"> · </span>{{ absTime(m.ts) }}</p>
            <div class="wa-badges" *ngIf="m.session || m.answered_question || m.opt_out">
              <span class="badge sess" *ngIf="m.session">session: {{ m.session }}</span>
              <span class="badge ans" *ngIf="m.answered_question">
                answered {{ m.answered_question }}
              </span>
              <span class="badge out" *ngIf="m.opt_out">OPT-OUT</span>
            </div>
          </div>
        </ng-container>
      </div>

      <!-- Mail watch (dashboard-managed allowlist): PC-A polls these senders
           every 10 min via pure script — an LLM session is spawned ONLY when
           a message actually lands, drafts via WhatsApp for approval. -->
      <div class="card">
        <div class="row">
          <span class="name">Mail watch</span>
          <span class="chip" [class.ok]="mwSeen() && !mwError()">
            {{ mwError() ? 'offline'
                : (mwSeen() ? mw().senders.length + ' senders · polled 10 min'
                            : 'loading…') }}
          </span>
        </div>

        <div class="mw-list" *ngIf="mwSeen()">
          <div class="mw-item" *ngFor="let s of mw().senders">
            <span class="mw-addr">{{ s }}</span>
            <button class="tog" (click)="removeSender(s)"
                    [disabled]="mwBusy()">remove</button>
          </div>
          <p class="empty" *ngIf="mw().senders.length === 0">
            No senders — nothing is polled
          </p>
        </div>

        <div class="mw-add">
          <input type="email" [ngModel]="mwDraft()"
                 (ngModelChange)="mwDraft.set($event)"
                 (keyup.enter)="addSender()"
                 placeholder="someone@example.com" />
          <button class="tog enable" (click)="addSender()"
                  [disabled]="mwBusy() || !validAddr(mwDraft())">
            watch
          </button>
        </div>

        <div class="mw-item" *ngFor="let p of mwPending()">
          <span class="mw-addr" [title]="p.subject ?? ''">
            {{ p.from }} · {{ p.state }}
          </span>
          <span class="cat">{{ p.qid }}</span>
        </div>
        <p class="hint" *ngIf="mwSeen() && mwPending().length === 0">
          Approvals arrive as drafts on WhatsApp (SEND &lt;qid&gt; / DISCARD &lt;qid&gt;).
        </p>
      </div>
    </div>
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
    .content { display: flex; flex-direction: column; gap: 12px; padding: 0 14px 14px; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
            padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .name { font: 600 13px/1.3 system-ui, sans-serif; color: #111827; }
    .state { font: 700 10px/1 system-ui, sans-serif; text-transform: uppercase;
             letter-spacing: .4px; padding: 4px 7px; border-radius: 999px;
             background: #fef3c7; color: #92400e; }
    .state.answered { background: #d1fae5; color: #065f46; }
    .q { font: 600 13px/1.45 system-ui, sans-serif; color: #111827; margin: 0; }
    .ctx { font: 12px/1.4 system-ui, sans-serif; color: #9ca3af; margin: 0; }
    textarea { font: 13px/1.45 ui-monospace, monospace; color: #111827;
               border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 9px;
               resize: vertical; background: #f9fafb; }
    textarea:focus { outline: none; border-color: #10b981; background: #fff; }
    .prompt { font: 13px/1.5 ui-monospace, monospace; }
    .hint { font: 12px/1.4 system-ui, sans-serif; color: #6b7280; margin: 0; }
    .foot { display: flex; justify-content: space-between; align-items: center;
            border-top: 1px solid #f3f4f6; padding-top: 8px; }
    .foot-actions { display: flex; gap: 6px; }
    .cat { font: 11px/1 system-ui, sans-serif; color: #9ca3af; }
    .tog { font: 600 11px/1 system-ui, sans-serif; padding: 4px 12px; border-radius: 6px;
           border: 1px solid #9ca3af; background: #f3f4f6; color: #374151; cursor: pointer; }
    .tog.enable { border-color: #065f46; background: #10b981; color: #fff; }
    .tog:disabled { opacity: .5; cursor: default; }
    .reply { font: 13px/1.45 system-ui, sans-serif; color: #374151; margin: 0; }
    .empty { font: 600 13px/1.4 system-ui, sans-serif; color: #6b7280; margin: 0;
             text-align: center; padding: 6px 0; }
    /* ---- WhatsApp card (read-only inbox) ---- */
    .wa-group { display: flex; justify-content: space-between; align-items: center;
                gap: 8px; border-top: 1px solid #f3f4f6; padding-top: 8px; }
    .wa-group:first-of-type { border-top: 0; padding-top: 0; }
    .wa-from { font: 600 12px/1.3 ui-monospace, monospace; color: #111827;
               cursor: help; }
    .wa-count { font: 11px/1 system-ui, sans-serif; color: #9ca3af; white-space: nowrap; }
    .wa-msg { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; }
    .wa-text { font: 600 13px/1.45 system-ui, sans-serif; color: #111827;
               overflow-wrap: anywhere; }
    .wa-msg .state { background: #e5e7eb; color: #4b5563; }   /* handled/log = grey */
    .wa-msg .state.wa-new { background: #fef3c7; color: #92400e; } /* new = amber */
    .wa-msg .ctx { margin: 0; }
    .wa-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { font: 700 10px/1 system-ui, sans-serif; letter-spacing: .3px;
             text-transform: uppercase; padding: 4px 7px; border-radius: 999px; }
    .badge.sess { background: #dbeafe; color: #1e40af; text-transform: none;
                  letter-spacing: 0; font-weight: 600; }
    .badge.ans { background: #ede9fe; color: #5b21b6; text-transform: none;
                 letter-spacing: 0; font-weight: 600; }
    .badge.out { background: #fee2e2; color: #991b1b; border: 1px solid #dc2626; }
    /* ---- Mail watch card (dashboard-managed sender allowlist) ---- */
    .mw-list { display: flex; flex-direction: column; gap: 6px; }
    .mw-item { display: flex; justify-content: space-between; align-items: center;
               gap: 8px; border-top: 1px solid #f3f4f6; padding-top: 6px; }
    .mw-list .mw-item:first-child { border-top: 0; padding-top: 0; }
    .mw-addr { font: 600 12px/1.4 ui-monospace, monospace; color: #111827;
               overflow-wrap: anywhere; }
    .mw-add { display: flex; gap: 8px; }
    .mw-add input { flex: 1; font: 13px/1.4 ui-monospace, monospace; color: #111827;
                    border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 9px;
                    background: #f9fafb; }
    .mw-add input:focus { outline: none; border-color: #10b981; background: #fff; }
  `],
})
export class ChatComponent implements OnInit, OnDestroy {
  /** whole state file (null until first successful fetch) */
  readonly state = signal<ChatState | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly copied = signal(false);
  /** per-question reply drafts (id → text); ngModel binds through setDraft */
  readonly drafts = signal<Record<string, string>>({});
  /** prompt textarea buffer — edited locally, saved via POST /api/chat/prompt */
  readonly promptDraft = signal('');
  /** WhatsApp inbox (READ-ONLY): flat newest-first records + sender groups */
  readonly waMessages = signal<WhatsappInboxMsg[]>([]);
  readonly waGroups = signal<WaGroup[]>([]);
  /** first successful inbox fetch (distinguishes "empty" from "loading…") */
  readonly waSeen = signal(false);
  readonly waError = signal<string | null>(null);
  /** Mail watch (dashboard allowlist): same offline-tolerant pattern */
  readonly mw = signal<MailWatchers>({ senders: [] });
  readonly mwSeen = signal(false);
  readonly mwError = signal<string | null>(null);
  readonly mwBusy = signal(false);
  readonly mwDraft = signal('');
  private promptTouched = false;

  private readonly destroy$ = new Subject<void>();
  private readonly refresh$ = new Subject<void>();
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // periodic refresh (exhaustMap: never stack; catchError keeps the tab
    // alive when the host is unreachable — offline tolerance like services).
    // Chat state + WhatsApp inbox + mail-watch list are FOLDED into one
    // stream: one 5 s tick → one in-flight trio, so requests can never stack.
    const poll$ = (): Observable<{ chat: ChatState | null; wa: WhatsappInbox | null;
                                   mw: MailWatchers | null }> =>
      forkJoin({ chat: this.fetch$(), wa: this.fetchInbox$(), mw: this.fetchMailWatch$() });
    interval(REFRESH_MS).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => poll$()),
    ).subscribe((r) => { this.apply(r.chat); this.applyInbox(r.wa); this.applyMailWatch(r.mw); });
    this.refresh$.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => poll$()),
    ).subscribe((r) => { this.apply(r.chat); this.applyInbox(r.wa); this.applyMailWatch(r.mw); });
    this.refresh$.next();   // first paint (all three halves) right away
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.copyTimer !== null) clearTimeout(this.copyTimer);
  }

  refresh(): void {
    this.refresh$.next();
  }

  pendingCount(): number {
    return this.state()?.questions.filter((q) => q.status === 'pending').length ?? 0;
  }

  answeredCount(): number {
    return this.state()?.questions.filter((q) => q.status === 'answered').length ?? 0;
  }

  counts(): string {
    return `${this.pendingCount()} pending · ${this.answeredCount()} answered`;
  }

  /** pending first, then answered (newest first); consumed ones hidden */
  visible(): ChatQuestion[] {
    const qs = this.state()?.questions.filter((q) => q.status !== 'consumed') ?? [];
    return [...qs].sort((a, b) =>
      (a.status === b.status ? b.ts - a.ts : a.status === 'pending' ? -1 : 1));
  }

  /** identity by id: without it the 5 s poll (fresh objects from JSON)
   * recreated every card and DESTROYED the textarea being typed in — focus
   * jumped away mid-sentence (user 2026-10-13, 'almost impossible to type'). */
  trackById(_index: number, q: ChatQuestion): string {
    return q.id;
  }

  // ---- WhatsApp card (read-only inbox) view helpers -----------------------

  trackGroup(_index: number, g: WaGroup): string {
    return g.raw ?? ' system';
  }

  /** ids repeat across delivery receipts (sent/delivered/read share one id,
   * sometimes even a ts) — key on id+ts+receipt+position to stay unique. */
  trackMsg(index: number, m: WhatsappInboxMsg): string {
    return `${m.id ?? ''}-${m.ts ?? 0}-${m.status_type ?? ''}-${index}`;
  }

  /** text bodies verbatim; delivery receipts as "status: delivered";
   * non-text inbound uses the same "<type>" fallback as the webhook ingest. */
  displayText(m: WhatsappInboxMsg): string {
    if (m.text) return m.text;
    if (m.type === 'status') return `status: ${m.status_type ?? 'update'}`;
    return `<${m.type ?? 'unknown'}>`;
  }

  relTime(ts?: number): string {
    if (!ts) return '';
    const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }

  absTime(ts?: number): string {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  setDraft(id: string, value: string): void {
    this.drafts.update((d) => ({ ...d, [id]: value }));
  }

  setPrompt(value: string): void {
    this.promptTouched = true;
    this.promptDraft.set(value);
  }

  copyPrompt(): void {
    const text = this.promptDraft();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      if (this.copyTimer !== null) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => this.copied.set(false), 1500);
    }).catch((e: unknown) => {
      this.error.set(`clipboard failed: ${httpErrorText(e)}`);
    });
  }

  savePrompt(): void {
    this.post<ChatState>(API.chat.prompt, { prompt: this.promptDraft() });
  }

  // ---- Mail watch card (dashboard-managed allowlist) -----------------------

  /** pending drafts (queue states that still need work), stable order */
  mwPending(): MailWatchPending[] {
    return this.mw().pending ?? [];
  }

  validAddr(addr: string): boolean {
    return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(addr.trim());
  }

  addSender(): void {
    const address = this.mwDraft().trim().toLowerCase();
    if (this.mwBusy() || !this.validAddr(address)) return;
    this.mwBusy.set(true);
    apiPost<MailWatchers>(this.http, API.mailWatch.update,
                          { action: 'add', address }).pipe(
      catchError((e: unknown) => {
        this.mwError.set(`POST ${API.mailWatch.update.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    ).subscribe((res) => {
      if (res) { this.applyMailWatch(res); this.mwDraft.set(''); }
      this.mwBusy.set(false);
    });
  }

  removeSender(address: string): void {
    if (this.mwBusy()) return;
    this.mwBusy.set(true);
    apiPost<MailWatchers>(this.http, API.mailWatch.update,
                          { action: 'remove', address }).pipe(
      catchError((e: unknown) => {
        this.mwError.set(`POST ${API.mailWatch.update.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    ).subscribe((res) => {
      if (res) this.applyMailWatch(res);
      this.mwBusy.set(false);
    });
  }

  sendReply(id: string): void {
    const reply = (this.drafts()[id] ?? '').trim();
    if (this.busy() || !reply) return;
    this.post<ChatState>(API.chat.reply, { id, reply }, () => {
      // clear the draft only after the server confirmed the reply
      this.drafts.update((d) => ({ ...d, [id]: '' }));
    });
  }

  private fetch$(): Observable<ChatState | null> {
    return apiGet<ChatState>(this.http, API.chat.state).pipe(
      catchError((e: unknown) => {
        this.error.set(`GET ${API.chat.state.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  /** GET /api/chat/inbox — offline-tolerant: a dead host yields of(null) so
   * the card keeps its last data instead of taking the tab down. */
  private fetchInbox$(): Observable<WhatsappInbox | null> {
    return apiGet<WhatsappInbox>(this.http, API.chat.inbox).pipe(
      catchError((e: unknown) => {
        this.waError.set(`GET ${API.chat.inbox.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  /** GET /api/mail/watchers — offline-tolerant: dead host → of(null) keeps
   * the last list instead of taking the tab down. */
  private fetchMailWatch$(): Observable<MailWatchers | null> {
    return apiGet<MailWatchers>(this.http, API.mailWatch.get).pipe(
      catchError((e: unknown) => {
        this.mwError.set(`GET ${API.mailWatch.get.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }

  private applyMailWatch(r: MailWatchers | null): void {
    if (!r || !Array.isArray(r.senders)) return;   // offline: keep last data
    this.mw.set(r);
    this.mwSeen.set(true);
    this.mwError.set(null);
  }

  /** Sort newest-first, group by RAW `from` (senders by latest activity,
   * senderless status records in one trailing system group). */
  private applyInbox(inbox: WhatsappInbox | null): void {
    if (!inbox) return;   // offline: keep the last data, waError is already set
    const messages = [...inbox.messages].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const bySender = new Map<string, WhatsappInboxMsg[]>();
    const system: WhatsappInboxMsg[] = [];
    for (const m of messages) {
      if (m.from) {
        const bucket = bySender.get(m.from);
        if (bucket) bucket.push(m);
        else bySender.set(m.from, [m]);
      } else {
        system.push(m);
      }
    }
    // messages are pre-sorted, so each bucket's [0] is its newest record
    const groups: WaGroup[] = [...bySender.entries()]
      .map(([raw, msgs]) => ({ raw, label: formatFrom(raw), messages: msgs }))
      .sort((a, b) => (b.messages[0].ts ?? 0) - (a.messages[0].ts ?? 0));
    if (system.length) groups.push({ raw: null, label: 'system', messages: system });
    this.waMessages.set(messages);
    this.waGroups.set(groups);
    this.waSeen.set(true);
    this.waError.set(null);
  }

  private apply(s: ChatState | null): void {
    if (s) {
      this.error.set(null);
      this.state.set(s);
      // first load only — don't clobber the user's in-progress edits
      if (!this.promptTouched) this.promptDraft.set(s.prompt);
    }
  }

  private post<T extends ChatState>(route: ApiPostRoute, body: unknown, onOk?: () => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    apiPost<T>(this.http, route, body).pipe(
      catchError((e: unknown) => {
        this.error.set(`POST ${route.path} failed: ${httpErrorText(e)}`);
        return of(null);
      }),
    ).subscribe((res) => {
      if (res) {
        this.error.set(null);
        this.apply(res);
        onOk?.();
      }
      this.busy.set(false);
    });
  }
}
