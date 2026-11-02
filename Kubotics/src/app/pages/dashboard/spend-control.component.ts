import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface SpendCaps { total_chf: number; search_chf: number; window: string }
interface SpendUsed { total_chf: number; search_chf: number }
interface SpendRemaining { total_chf: number; search_chf: number }
interface SpendApproval {
  id: string; amount_chf: number; channel: string; purpose: string | null;
  status: string; decided_by: string | null; created_at: string | null;
}
interface SpendRecord {
  id: string; amount_chf: number; channel: string; purpose: string | null;
  approval_id: string | null; created_at: string | null;
}
interface SpendStatus {
  caps: SpendCaps; used: SpendUsed; remaining: SpendRemaining;
  approvals: SpendApproval[]; records: SpendRecord[];
}

/**
 * B5 spend-control panel (Vincent's C2: caps + approval must live in the
 * dashboard UI; docs TRADING_WATCH_CLOUD.md §19).
 * GET /spend/status is a public read (same policy as /investments); the
 * decision call carries ONLY the approval phrase — typed by Vincent, never
 * bundled. Pending requests arrive via the (bearer-gated) server-side API.
 */
@Component({
  selector: 'app-spend-control',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="spend-wrap">
      <div class="spend-head">
        <h4>Spend Control — §6 hard boundary</h4>
        <button class="btn" (click)="load()" [disabled]="loading()">↻ Refresh</button>
      </div>

      @if (status(); as s) {
        <div class="cap-grid">
          <div class="cap-card">
            <span class="cap-label">Monthly total</span>
            <span class="cap-value" [class.cap-ok]="s.remaining.total_chf > 0" [class.cap-over]="s.remaining.total_chf <= 0">
              {{ s.used.total_chf | number:'1.2-2' }} / {{ s.caps.total_chf | number:'1.0-0' }} CHF
            </span>
            <span class="cap-sub">remaining {{ s.remaining.total_chf | number:'1.2-2' }} CHF</span>
            <div class="cap-bar"><div class="cap-fill" [style.width.%]="pct(s.used.total_chf, s.caps.total_chf)"></div></div>
          </div>
          <div class="cap-card">
            <span class="cap-label">Google / Search sub-cap</span>
            <span class="cap-value" [class.cap-ok]="s.remaining.search_chf > 0" [class.cap-over]="s.remaining.search_chf <= 0">
              {{ s.used.search_chf | number:'1.2-2' }} / {{ s.caps.search_chf | number:'1.0-0' }} CHF
            </span>
            <span class="cap-sub">remaining {{ s.remaining.search_chf | number:'1.2-2' }} CHF</span>
            <div class="cap-bar"><div class="cap-fill" [style.width.%]="pct(s.used.search_chf, s.caps.search_chf)"></div></div>
          </div>
          <div class="cap-card">
            <span class="cap-label">Rule (§6)</span>
            <span class="cap-value cap-rule">no spend<br/>without approval</span>
            <span class="cap-sub">every record needs an approved request + caps</span>
          </div>
        </div>

        <div class="spend-sub">Pending approvals</div>
        @if (pending(s); as list) {
          <table class="spend-tbl">
            <thead><tr><th>Requested</th><th>Amount</th><th>Channel</th><th>Purpose</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (a of list; track a.id) {
                <tr>
                  <td>{{ a.created_at ? (a.created_at | date:'MMM d, HH:mm') : '—' }}</td>
                  <td class="num">{{ a.amount_chf | number:'1.2-2' }} CHF</td>
                  <td>{{ a.channel }}</td>
                  <td>{{ a.purpose || '—' }}</td>
                  <td><span class="pill" [class.pill-ok]="a.status==='approved'" [class.pill-no]="a.status==='rejected'" [class.pill-wait]="a.status==='pending'">{{ a.status }}</span></td>
                  <td class="acts">
                    @if (a.status === 'pending') {
                      <button class="btn mini ok" (click)="decide(a.id, 'approved')" [disabled]="!phrase() || busy()">Approve</button>
                      <button class="btn mini no" (click)="decide(a.id, 'rejected')" [disabled]="!phrase() || busy()">Reject</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <div class="phrase-row">
            <input type="password" placeholder="Approval phrase (your go)" [value]="phrase()"
                   (input)="phrase.set($any($event.target).value)" />
            <span class="hint">typed by you only — never stored in the app</span>
          </div>
        } @else {
          <div class="spend-empty">No pending requests. Server-side (needle/agent) creates them via POST /api/v1/spend/approvals.</div>
        }
        @if (msg(); as m) { <div class="spend-msg" [class.err]="m.startsWith('❌')">{{ m }}</div> }

        <div class="spend-sub">Recent spend records</div>
        @if (s.records?.length) {
          <table class="spend-tbl">
            <thead><tr><th>When</th><th>Amount</th><th>Channel</th><th>Purpose</th></tr></thead>
            <tbody>
              @for (r of s.records; track r.id) {
                <tr>
                  <td>{{ r.created_at ? (r.created_at | date:'MMM d, HH:mm') : '—' }}</td>
                  <td class="num">{{ r.amount_chf | number:'1.2-2' }} CHF</td>
                  <td>{{ r.channel }}</td>
                  <td>{{ r.purpose || '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <div class="spend-empty">No spend recorded this month — caps untouched (organic phase).</div>
        }
      } @else {
        <div class="spend-empty">{{ error() || 'Loading spend status…' }}</div>
      }
    </div>
  `,
  styles: [`
    .spend-wrap { display: flex; flex-direction: column; gap: 0.9rem; color: #cbd5e1; }
    .spend-head { display: flex; align-items: center; justify-content: space-between; }
    .spend-head h4 { margin: 0; color: #f8fafc; font-size: 1rem; }
    .spend-sub { margin-top: 0.6rem; font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; }
    .cap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.8rem; }
    .cap-card { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 0.8rem 1rem; }
    .cap-label { font-size: .72rem; color: #94a3b8; text-transform: uppercase; }
    .cap-value { display: block; font-size: 1.15rem; font-weight: 700; margin-top: .2rem; }
    .cap-value.cap-ok { color: #10b981; } .cap-value.cap-over { color: #ef4444; }
    .cap-value.cap-rule { font-size: .95rem; color: #f59e0b; line-height: 1.3; }
    .cap-sub { font-size: .75rem; color: #64748b; }
    .cap-bar { height: 6px; background: #1e293b; border-radius: 4px; margin-top: .5rem; overflow: hidden; }
    .cap-fill { height: 100%; background: linear-gradient(90deg, #10b981, #f59e0b); }
    .spend-tbl { width: 100%; border-collapse: collapse; font-size: .82rem; }
    .spend-tbl th { text-align: left; padding: .45rem .6rem; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,.08); font-weight: 500; }
    .spend-tbl td { padding: .5rem .6rem; border-bottom: 1px solid rgba(255,255,255,.05); }
    .num { text-align: right; white-space: nowrap; }
    .pill { padding: 2px 9px; border-radius: 999px; font-size: .72rem; background: #1e293b; color: #94a3b8; }
    .pill-ok { background: rgba(16,185,129,.15); color: #10b981; }
    .pill-no { background: rgba(239,68,68,.15); color: #ef4444; }
    .pill-wait { background: rgba(245,158,11,.15); color: #f59e0b; }
    .acts { display: flex; gap: .4rem; }
    .btn { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); color: #f1f5f9; padding: .3rem .8rem; border-radius: 6px; font-size: .78rem; cursor: pointer; }
    .btn:disabled { opacity: .4; cursor: not-allowed; }
    .btn.mini { padding: .18rem .6rem; font-size: .72rem; }
    .btn.ok { border-color: rgba(16,185,129,.5); color: #10b981; }
    .btn.no { border-color: rgba(239,68,68,.5); color: #ef4444; }
    .phrase-row { display: flex; align-items: center; gap: .7rem; margin-top: .5rem; }
    .phrase-row input { background: #0f172a; border: 1px solid #334155; color: #f1f5f9; border-radius: 6px; padding: .4rem .7rem; font-size: .82rem; min-width: 240px; }
    .phrase-row .hint { font-size: .72rem; color: #64748b; }
    .spend-msg { font-size: .8rem; color: #10b981; } .spend-msg.err { color: #ef4444; }
    .spend-empty { font-size: .82rem; color: #64748b; padding: .5rem 0; }
  `],
})
export class SpendControlComponent implements OnInit, OnDestroy {
  readonly status = signal<SpendStatus | null>(null);
  readonly phrase = signal('');
  readonly busy = signal(false);
  readonly msg = signal('');
  readonly error = signal('');
  readonly loading = signal(false);
  private timer: any = null;
  private readonly API = 'https://api.kubotics.ch/api/v1/spend';

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.load();
    this.timer = setInterval(() => this.load(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  pct(used: number, cap: number): number {
    if (!cap) return 0;
    return Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
  }

  pending(s: SpendStatus): SpendApproval[] {
    return (s.approvals || []).filter(a => a.status === 'pending');
  }

  load(): void {
    this.loading.set(true);
    this.http.get<SpendStatus>(`${this.API}/status`).subscribe({
      next: (res) => { this.status.set(res); this.loading.set(false); this.error.set(''); },
      error: () => { this.loading.set(false); this.error.set('spend status unreachable'); },
    });
  }

  decide(id: string, decision: 'approved' | 'rejected'): void {
    if (!this.phrase()) return;
    this.busy.set(true);
    this.msg.set('');
    this.http.post(`${this.API}/approvals/${id}/decision`,
      { decision, phrase: this.phrase(), decided_by: 'vincent-dashboard' }).subscribe({
      next: () => { this.msg.set(`✅ ${decision}`); this.busy.set(false); this.load(); },
      error: (e) => {
        this.msg.set(`❌ ${e?.error?.detail?.reason || e?.error?.detail || 'decision failed'}`);
        this.busy.set(false);
      },
    });
  }
}
