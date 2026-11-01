import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { apiGet, apiPost, API, type InvestmentsSummary, type InvestmentMetric, type InvestmentLine, type TickerSnapshot, type BuyResult, type IbkrSnapshot, type IbkrPosition } from '../../core/api';
import { httpErrorText } from '../../core/http-error';

/** Investments tab (Vincent 2026-10-20 proposal):
 *  "a nice table with the % of the capital invested and YTD, (Last Year),
 *   Total both with values and % and color grading per line, if not bought
 *   wait/buy now/order placed … buy value should also be listed … easy to
 *   read … Liz will be happy".
 *
 * Contract: GET /api/investments (READ-ONLY, fail-soft {…, error}).
 * 2026-10-24 (Vincent: "live price ticker … add a buy button … turn it
 * into a proper trading setup … both endpoints need rate limits"): the
 * ticker strip auto-polls GET /api/investments/ticker every 15 s (429-
 * shed server-side) and each buyable row gets a Buy button → POST
 * /api/investments/buy — LIMIT at the live last, NEVER over; his click
 * + the confirm dialog = the explicit approval the 2026-10-20 rule asks
 * for (gateway login poll + WhatsApp notify happen inside the script).
 * 2026-10-25 (Vincent: "update the data on the dashboard live from IBKR",
 * while auto-invest is On Hold until a real API key): the "IBKR (live)"
 * block auto-polls GET /api/investments/ibkr every 30 s (30/min bucket) —
 * auth badge, equity/cash, positions table; fail-soft "gateway unreachable"
 * when the local CP tunnel is down. The BUY flow stays MANUAL-auth: the
 * dashboard buy path tickles and prompts him to log in (never auto-login).
 */

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>Investments</h2>
      <span class="chip" [class.ok]="s() && !error()">
        {{ error() ? 'offline' : (s() ? 'as of ' + s()!.as_of : 'loading…') }}
      </span>
      <span class="chip" [class.ok]="!!ticker()"
            title="live prices: last vs previous session close — auto-refresh 15 s (rate-limited 30/min)">
        ● ticker {{ tickerAt() || '…' }}</span>
      <button class="btn" (click)="load(true)">↻ refresh</button>
      <button class="btn" (click)="run('check')" [disabled]="running()">gate check</button>
      <button class="btn primary" (click)="run('run')" [disabled]="running()"
              title="daily run: validates wait/buy, updates this table, creates orders (you are asked to log into the gateway if needed)">
        ▶ daily run</button>
      <span class="meta" *ngIf="s() as v">
        capital {{ v.capital | number: '1.0-0' }} · invested
        {{ v.invested_chf | number: '1.0-0' }} ({{ v.invested_pct | number: '1.1-1' }}%)
      </span>
    </div>

    <div class="ibkr" title="IBKR Client Portal gateway (local tunnel) — READ-ONLY live picture, auto-refresh 30 s (rate-limited 30/min)">
      <span class="ibkr-h">IBKR (live)</span>
      <ng-container *ngIf="ibkr() as k; else ibkrWait">
        <span class="chip" [class.a-ok]="k.auth" [class.a-no]="!k.auth"
              title="gateway session state (manual login stays the rule while investments are On Hold)">
          {{ k.auth ? '● authenticated' : '● not authenticated' }}</span>
        <span *ngIf="!k.reachable" class="s-err">gateway unreachable</span>
        <ng-container *ngIf="k.reachable">
          <span *ngIf="k.summary as sm" class="meta">
            equity {{ cur(sm.equity, sm.currency) }} · cash {{ cur(sm.cash, sm.currency) }}
          </span>
          <span class="meta" *ngIf="k.auth && !k.summary">summary n/a</span>
        </ng-container>
        <table class="tbl" *ngIf="k.positions.length; else ibkrNoPos">
          <thead>
            <tr>
              <th>Asset</th>
              <th class="c-num">Qty</th>
              <th class="c-num">Value</th>
              <th class="c-num">Avg cost</th>
              <th class="c-num">Unreal P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let p of k.positions">
              <td>{{ p.asset || '—' }}</td>
              <td class="c-num">{{ p.qty | number: '1.0-4' }}</td>
              <td class="c-num">{{ num(p.mktVal, '', 2) }}</td>
              <td class="c-num">{{ num(p.avgCost, '', 2) }}</td>
              <td class="c-num" [ngClass]="pnlSign(p)">{{ pnlText(p) }}</td>
            </tr>
          </tbody>
        </table>
        <ng-template #ibkrNoPos><span class="meta" *ngIf="k.auth">no positions</span></ng-template>
        <span class="meta ibkr-ts">{{ k.ts }}</span>
      </ng-container>
      <ng-template #ibkrWait><span class="meta">checking gateway…</span></ng-template>
    </div>

    <div class="content" *ngIf="s() as v; else loading">
      <div class="legend">
        <span class="chip st-buy_now">BUY NOW — eligible under the gate</span>
        <span class="chip st-wait">WAIT — decreasing, stabilization gate</span>
        <span class="chip st-ordered">order placed</span>
        <span class="chip st-partial">partial fill</span>
        <span class="chip st-held">held</span>
        <span class="chip st-not_bought">not bought</span>
        <span class="meta">green = positive · red = negative · value on target until bought</span>
      </div>

      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="c-status">Status</th>
              <th class="c-sleeve">Sleeve / ETF / ISIN</th>
              <th class="c-num">Price</th>
              <th class="c-buy">Buy value</th>
              <th class="c-num">Invested</th>
              <th class="c-num">Target</th>
              <th class="c-num" title="Year to date">YTD</th>
              <th class="c-num" title="Last calendar year (LY = YTD when the instrument has no last year)">Last year</th>
              <th class="c-num" title="Total over the available history (or since buy when held)">Total</th>
              <th class="c-trade">Trade</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let l of v.lines" [ngClass]="'st-' + l.status">
              <td class="c-status"><span class="chip" [ngClass]="'st-' + l.status">{{ l.status_label }}</span></td>
              <td class="c-sleeve">
                <span class="s-name">{{ l.name }}</span>
                <span class="s-sub">{{ l.etf }} · {{ l.isin }} · {{ l.ticker }}</span>
                <span class="s-sub" *ngIf="l.gate as g" title="stabilization gate: 3 closes without a new 7-day low, above the 5-day average">
                  {{ g.trend }}{{ g.last7d_pct != null ? ' (' + (g.last7d_pct > 0 ? '+' : '') + g.last7d_pct + '%/7d)' : '' }}
                  <ng-container *ngIf="g.note"> · {{ g.note }}</ng-container>
                </span>
                <span class="s-err" *ngIf="l.price.error">price unavailable: {{ l.price.error }}</span>
              </td>
              <td class="c-num">{{ num(tick(l.key)?.last ?? l.price.last, l.currency === 'EUR' ? '€' : 'CHF ', 2) }}
                <span class="s-sub" *ngIf="chg(l.key) as c"
                      [ngClass]="c > 0 ? 'pos' : (c < 0 ? 'neg' : '')">
                  {{ c > 0 ? '▲ +' : (c < 0 ? '▼ ' : '') }}{{ c }}% vs prev close
                </span>
              </td>
              <td class="c-buy">
                <ng-container *ngIf="l.buy as b; else nobuy">
                  {{ b.chf | number: '1.0-0' }} CHF @ {{ b.price | number: '1.2-2' }}
                  <span class="s-sub" *ngIf="b.filled != null && b.total != null && b.filled < b.total">
                    partial: {{ b.filled | number: '1.0-2' }} / {{ b.total | number: '1.0-2' }} filled
                  </span>
                  <span class="s-sub">on {{ b.date }}</span>
                </ng-container>
                <ng-template #nobuy><span class="dim">—</span></ng-template>
              </td>
              <td class="c-num">
                {{ l.invested_chf | number: '1.0-0' }}
                <span class="s-sub">{{ l.invested_pct | number: '1.1-1' }}% of capital</span>
              </td>
              <td class="c-num">
                {{ l.target_pct | number: '1.2-2' }}%
                <span class="s-sub">{{ l.target_chf | number: '1.0-0' }} CHF</span>
              </td>
              <td class="c-num">
                <span [ngClass]="sign(l.ytd)">{{ val(l.ytd) }}</span>
                <span class="s-sub" [ngClass]="sign(l.ytd)">{{ pctv(l.ytd) }}</span>
              </td>
              <td class="c-num">
                <span [ngClass]="sign(l.ly)">{{ val(l.ly) }}</span>
                <span class="s-sub" [ngClass]="sign(l.ly)">{{ pctv(l.ly) }}</span>
              </td>
              <td class="c-num">
                <span [ngClass]="sign(l.total)">{{ val(l.total) }}</span>
                <span class="s-sub" [ngClass]="sign(l.total)">{{ pctv(l.total) }}</span>
              </td>
              <td class="c-trade">
                <button class="btn primary buy" (click)="buy(l)" [disabled]="running()"
                        *ngIf="buyable(l); else tradenone"
                        [title]="'LIMIT at the live last, never over · remaining target CHF ' + (l.target_chf - l.invested_chf | number: '1.0-0')">
                  Buy</button>
                <ng-template #tradenone>
                  <span class="dim" title="gate verdict WAIT (trend gate)">—</span>
                </ng-template>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="c-status">Total</td>
              <td class="c-sleeve">{{ v.lines.length }} sleeves · Inyova removed, % spread across the rest</td>
              <td class="c-num dim">—</td>
              <td class="c-buy dim">—</td>
              <td class="c-num">{{ v.invested_chf | number: '1.0-0' }}
                <span class="s-sub">{{ v.invested_pct | number: '1.1-1' }}%</span></td>
              <td class="c-num">100%
                <span class="s-sub">{{ v.capital | number: '1.0-0' }} CHF</span></td>
              <td class="c-num" [ngClass]="sign(sum(v, 'ytd'))">{{ val(sum(v, 'ytd')) }}</td>
              <td class="c-num" [ngClass]="sign(sum(v, 'ly'))">{{ val(sum(v, 'ly')) }}</td>
              <td class="c-num" [ngClass]="sign(sum(v, 'total'))">{{ val(sum(v, 'total')) }}</td>
              <td class="dim">—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="note" *ngIf="s() as v">
        YTD = this calendar year · Last year = previous calendar year (identical
        to YTD when an instrument has no last year, per Vincent's rule) · Total =
        {{ v.lines[0]?.price.history_from || 'available history' }} → today (or
        since buy once held). BUY approval: manual, after Vincent's validation.
      </div>

      <div class="runout" *ngIf="runOutput() as out">
        <div class="bar">
          <span class="chip">daily run output ({{ out.mode }} · rc {{ out.rc }})</span>
          <button class="btn" (click)="runOutput.set(null)">✕ close</button>
        </div>
        <pre>{{ out.output }}</pre>
        <button class="btn" (click)="load(false)">↻ refresh table</button>
      </div>
    </div>

    <ng-template #loading><div class="content">loading portfolio…</div></ng-template>
  `,
  styles: [`
    .legend { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
    .ibkr { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 2px; padding: 6px 8px; border: 1px solid rgba(127,127,127,.35); border-radius: 6px; }
    .ibkr-h { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .75; font-weight: 700; }
    .ibkr .chip.a-ok { background: rgba(63,185,80,.22); color: #3fb950; }
    .ibkr .chip.a-no { background: rgba(224,82,82,.20); color: #e05252; }
    .ibkr table.tbl { min-width: 0; width: auto; }
    .ibkr table.tbl th, .ibkr table.tbl td { padding: 4px 8px; }
    .ibkr-ts { margin-left: auto; }
    .tbl-wrap { overflow-x: auto; }
    table.tbl { border-collapse: collapse; width: 100%; min-width: 980px; }
    table.tbl th, table.tbl td { padding: 7px 10px; border-bottom: 1px solid rgba(127,127,127,.22); text-align: left; vertical-align: top; }
    table.tbl th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .75; }
    .c-num { text-align: right; white-space: nowrap; }
    .c-trade { text-align: right; white-space: nowrap; }
    .c-trade .btn { font-size: 11px; padding: 3px 10px; }
    .c-num .s-sub { display: block; font-size: 11px; opacity: .8; }
    .s-name { display: block; font-weight: 600; }
    .s-sub { display: block; font-size: 11px; opacity: .72; }
    .s-err { display: block; font-size: 11px; color: #e05252; }
    .dim { opacity: .45; }
    .pos { color: #3fb950; }
    .neg { color: #e05252; }
    tr.st-buy_now { background: rgba(63,185,80,.10); }
    tr.st-wait    { background: rgba(210,153,34,.10); }
    tr.st-ordered { background: rgba(56,139,253,.12); }
    tr.st-partial { background: rgba(163,113,247,.14); }
    tr.st-held    { background: rgba(63,185,80,.05); }
    tr.st-not_bought { opacity: .78; }
    .chip.st-buy_now { background: rgba(63,185,80,.22); }
    .chip.st-wait    { background: rgba(210,153,34,.25); }
    .chip.st-ordered { background: rgba(56,139,253,.25); }
    .chip.st-partial { background: rgba(163,113,247,.30); }
    .chip.st-held    { background: rgba(63,185,80,.15); }
    .chip.st-not_bought { background: rgba(127,127,127,.25); }
    tfoot td { font-weight: 700; border-top: 2px solid rgba(127,127,127,.4); }
    .note { margin-top: 10px; font-size: 11.5px; opacity: .7; line-height: 1.5; }
    .runout { margin-top: 12px; border: 1px solid rgba(127,127,127,.35); border-radius: 6px; padding: 8px; }
    .runout .bar { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .runout pre { background: rgba(0,0,0,.35); border-radius: 4px; padding: 8px; font-size: 11.5px; max-height: 320px; overflow: auto; white-space: pre-wrap; }
    .btn.primary { background: rgba(63,185,80,.25); border-color: rgba(63,185,80,.55); }
    .btn[disabled] { opacity: .5; cursor: wait; }
  `],
})
export class InvestmentsComponent implements OnInit, OnDestroy {
  readonly s = signal<InvestmentsSummary | null>(null);
  readonly error = signal<string | null>(null);
  readonly running = signal(false);
  readonly runOutput = signal<{ rc: number; mode: string; output: string } | null>(null);
  readonly ticker = signal<TickerSnapshot | null>(null);
  readonly tickerAt = signal<string | null>(null);
  private tickerTimer: ReturnType<typeof setInterval> | null = null;
  readonly ibkr = signal<IbkrSnapshot | null>(null);
  private ibkrTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.load(false);
    // first poll after 15 s (an immediate one would race the summary GET and
    // the spec's exactly-one-request contract); failures keep the last
    // snapshot (fail-soft).
    this.tickerTimer = setInterval(() => this.pollTicker(), 15_000);
    // IBKR (live) block: first poll after 30 s (same exactly-one-request
    // contract; the endpoint is fail-soft 200 — reachable:false renders
    // "gateway unreachable", 429 keeps the last snapshot).
    this.ibkrTimer = setInterval(() => this.pollIbkr(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.tickerTimer !== null) clearInterval(this.tickerTimer);
    if (this.ibkrTimer !== null) clearInterval(this.ibkrTimer);
  }

  /** POST /api/investments/run — check = gates+state; run = the full daily
   *  run (his click = the go; the script prompts gateway login itself). */
  run(mode: 'check' | 'run'): void {
    if (this.running()) return;
    this.running.set(true);
    this.runOutput.set(null);
    apiPost<{ rc: number; mode: string; output: string }, { mode: string }>(
      this.http, API.investments.run, { mode })
      .subscribe({
        next: (r) => {
          this.runOutput.set(r);
          this.running.set(false);
          if (mode === 'check') this.load(false);
        },
        error: (e) => {
          this.runOutput.set({ rc: 1, mode,
            output: httpErrorText(e) });
          this.running.set(false);
        },
      });
  }

  load(refresh: boolean): void {
    const path = API.investments.get.path + (refresh ? '?refresh=true' : '');
    apiGet<InvestmentsSummary>(this.http, API.investments.get, path)
      .subscribe({
        next: (v) => { this.s.set(v); this.error.set(null); },
        error: (e) => { this.error.set(httpErrorText(e)); },
      });
  }

  tick(key: string): TickerSnapshot['prices'][string] | undefined {
    return this.ticker()?.prices?.[key];
  }

  chg(key: string): number | null {
    const q = this.tick(key);
    return q && !q.error && q.change_pct != null ? q.change_pct : null;
  }

  /** One ticker fetch — driven by the 15 s interval (and directly by the
   *  tests). 429/5xx: keep the last snapshot (fail-soft). */
  pollTicker(): void {
    apiGet<TickerSnapshot>(this.http, API.investments.ticker, API.investments.ticker.path)
      .subscribe({
        next: (t) => { this.ticker.set(t); this.tickerAt.set(t.as_of); },
        error: () => { /* keep the last good snapshot */ },
      });
  }

  /** One IBKR fetch — driven by the 30 s interval (and directly by the
   *  tests). READ-ONLY; 429/5xx: keep the last snapshot (fail-soft). */
  pollIbkr(): void {
    apiGet<IbkrSnapshot>(this.http, API.investments.ibkr, API.investments.ibkr.path)
      .subscribe({
        next: (s) => this.ibkr.set(s),
        error: () => { /* keep the last good snapshot */ },
      });
  }

  /** equity/cash with its account currency ("CHF 12,345.67"), "—" on null. */
  cur(v: number | null | undefined, currency?: string | null): string {
    if (v == null) return '—';
    return (currency ? currency + ' ' : '') + this.num(v, '', 2);
  }

  pnlSign(p: IbkrPosition): string {
    if (p.unrealizedPnl == null) return '';
    return p.unrealizedPnl > 0 ? 'pos' : (p.unrealizedPnl < 0 ? 'neg' : '');
  }

  pnlText(p: IbkrPosition): string {
    const v = p.unrealizedPnl;
    if (v == null) return '—';
    const sign = v > 0 ? '+' : '';
    return sign + v.toLocaleString('en-CH', { maximumFractionDigits: 2 });
  }

  /**
   * Trade button visibility (Vincent 2026-10-26: "a button for all with Buy
   * Verdict"): keyed off the GATE verdict (BUY|WAIT from the same trend rule
   * daily_invest.py runs), not the old status/remaining heuristic — WAIT
   * rows (e.g. 30d-low sleeves) lose the button, held/sideways rows get it.
   * The confirm dialog + script keep every guard (qty floor, remaining>0.5
   * inside buy(), ACTIVE-guard + no-conid reports server-side).
   */
  buyable(l: InvestmentLine): boolean {
    return l.verdict === 'BUY';
  }

  /** BUY button (2026-10-24): the confirm dialog carries the exact numbers,
   *  then POST the key. LIMIT at the live last, never over (the script
   *  floors qty to the remaining target and skips ACTIVE/filled sleeves);
   *  his OK on this dialog = the explicit approval. */
  buy(l: InvestmentLine): void {
    if (this.running()) return;
    const price = this.tick(l.key)?.last ?? l.price.last;
    const remaining = Math.round((l.target_chf - l.invested_chf) * 100) / 100;
    if (!price || remaining <= 0.5) return;
    const qty = Math.floor((remaining / price) * 100) / 100;
    const g = l.gate;
    const gate = g?.trend
      ? `${g.trend}${g.last7d_pct != null ? ` (${g.last7d_pct > 0 ? '+' : ''}${g.last7d_pct}%/7d)` : ''}`
      : 'n/a';
    const decreasing = !!g?.trend?.includes('decreasing');
    const ok = window.confirm(
      `BUY ${l.name} (${l.ticker}) — your click is the approval\n` +
      `LIMIT ${price} × ${qty} ≈ CHF ${Math.round(qty * price)} of the CHF ${Math.round(remaining)} target gap\n` +
      `trend gate: ${gate}${decreasing ? ' (manual buy overrides WAIT)' : ''}\n` +
      'The order is placed at the live last, NEVER above. The gateway may ask you to log in.');
    if (!ok) return;
    this.running.set(true);
    this.runOutput.set(null);
    apiPost<BuyResult, { key: string }>(this.http, API.investments.buy, { key: l.key })
      .subscribe({
        next: (r) => {
          this.runOutput.set({ rc: r.rc, mode: `buy ${r.key}`, output: r.output });
          this.running.set(false);
          this.load(false);
        },
        error: (e) => {
          this.runOutput.set({ rc: 1, mode: `buy ${l.key}`, output: httpErrorText(e) });
          this.running.set(false);
        },
      });
  }

  num(v: number | null | undefined, prefix: string, digits: number): string {
    if (v == null) return '—';
    return prefix + v.toLocaleString('en-CH',
      { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  val(m: InvestmentMetric): string {
    if (m == null || m.chf == null) return '—';
    const sign = m.chf > 0 ? '+' : '';
    return `${sign}${m.chf.toLocaleString('en-CH', { maximumFractionDigits: 0 })} CHF`;
  }

  pctv(m: InvestmentMetric): string {
    if (m == null || m.pct == null) return '—';
    const sign = m.pct > 0 ? '+' : '';
    return `${sign}${m.pct.toFixed(2)}%`;
  }

  sign(m: InvestmentMetric | null): string {
    if (!m || m.pct == null) return '';
    return m.pct > 0 ? 'pos' : (m.pct < 0 ? 'neg' : '');
  }

  sum(v: InvestmentsSummary, key: 'ytd' | 'ly' | 'total'): InvestmentMetric {
    let chf = 0, any = false;
    for (const l of v.lines) {
      const m = l[key];
      if (m && m.chf != null) { chf += m.chf; any = true; }
    }
    return { pct: null, chf: any ? Math.round(chf) : null, base: 'target' };
  }
}
