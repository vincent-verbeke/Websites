import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export interface IbkrPositionFeed {
  conid: number;
  mktPrice?: number;
  mktValue?: number;
  position?: number;
  symbol?: string;
  currency?: string;
  avgCost?: number;
  unrealizedPnl?: number;
}

export interface IbkrOrderActive {
  id: string | number;
  conid?: number;
  ticker?: string;
  action: string;
  quantity: number;
  price?: number;
  status: string;
}

export interface SleeveItem {
  sym: string;
  status?: string;
  invested_chf?: number;
  gate?: string;
  order?: any;
}

export interface InvestmentsSnapshotDoc {
  ts?: string;
  source?: string;
  auth?: {
    authenticated?: boolean;
    established?: boolean;
    connected?: boolean;
  };
  account_id?: string;
  cash_chf?: number;
  equity_chf?: number;
  positions?: IbkrPositionFeed[];
  orders_active?: IbkrOrderActive[];
  state?: {
    meta?: {
      gate_checked?: string;
      capital?: number;
      invested_chf?: number;
    };
    sleeves?: SleeveItem[];
  };
}

export interface InvestmentsFeedResponse {
  snapshot: InvestmentsSnapshotDoc | null;
  source: string;
  updated_at: string | null;
  stale: boolean;
  offline: boolean;
  age_seconds: number | null;
  trading_watch?: TradingWatchBlock | null;
}

export interface TradingAlertItem {
  event_id: string | null;
  created_at: string | null;
  problems: string[];
  test: boolean;
}

export interface TradingWatchCheck {
  ts?: string;
  ok?: boolean;
  legs?: number;
  usdt?: number;
  problems?: string[];
}

/** Per-asset cumulated Binance income (since 2026-11-01, USDT). */
export interface PerAssetRow {
  symbol: string;
  funding_usd: number;
  fees_usd: number;
  realized_usd: number;
  other_usd: number;
  net_usd: number;
  events: number;
  position?: number | null;
}

export interface PerAssetSince {
  since?: string;
  computed_at?: string;
  assets?: PerAssetRow[];
  totals?: {
    funding_usd?: number;
    fees_usd?: number;
    realized_usd?: number;
    net_usd?: number;
    events?: number;
  };
  rows?: number;
  error?: string;
}

/** Binance trading-watcher slice embedded in GET /investments (backend §11). */
export interface TradingWatchBlock {
  enabled?: boolean;
  sms_enabled?: boolean;
  interval_s?: number;
  binance_keys_configured?: boolean;
  last_check?: TradingWatchCheck | null;
  recent_alerts?: TradingAlertItem[];
  per_asset_since?: PerAssetSince | null;
  error?: string;
}

@Component({
  selector: 'app-investments',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="investments-container">
      <!-- TOP STATUS BAR -->
      <div class="bar">
        <h2>Live Investments & IBKR Watcher</h2>
        
        <!-- GATEWAY AUTH BADGE -->
        @if (feed()?.snapshot?.auth?.authenticated) {
          <span class="chip ok">● Gateway Authenticated</span>
        } @else {
          <span class="chip danger" title="Please log in on the dev PC terminal">
            ● Gateway not authenticated — log in at dev PC
          </span>
        }

        <!-- STALENESS & SOURCE BADGE -->
        @if (feed()?.stale) {
          <span class="chip stale" title="No snapshot received from dev PC within the last 60 seconds">
            STALE ({{ feed()?.age_seconds ? feed()?.age_seconds + 's ago' : 'no data' }})
          </span>
        } @else {
          <span class="chip ok">
            LIVE ({{ feed()?.age_seconds != null ? feed()?.age_seconds + 's ago' : 'now' }})
          </span>
        }

        <button class="btn" (click)="load()" [disabled]="loading()">↻ Refresh</button>
      </div>

      <!-- ACCOUNT SUMMARY STRIP -->
      <div class="summary-cards">
        <div class="scard">
          <span class="scard-label">Account ID</span>
          <span class="scard-val">{{ feed()?.snapshot?.account_id || '—' }}</span>
          <span class="scard-sub">Interactive Brokers LLC</span>
        </div>
        <div class="scard">
          <span class="scard-label">Net Equity</span>
          <span class="scard-val">
            {{ feed()?.snapshot?.equity_chf != null ? (feed()?.snapshot?.equity_chf | number:'1.2-2') + ' CHF' : '—' }}
          </span>
          <span class="scard-sub">Portfolio valuation</span>
        </div>
        <div class="scard">
          <span class="scard-label">Available Cash</span>
          <span class="scard-val">
            {{ feed()?.snapshot?.cash_chf != null ? (feed()?.snapshot?.cash_chf | number:'1.2-2') + ' CHF' : '—' }}
          </span>
          <span class="scard-sub">Liquidity pool</span>
        </div>
        <div class="scard">
          <span class="scard-label">Capital Allocated</span>
          <span class="scard-val">
            {{ feed()?.snapshot?.state?.meta?.capital != null ? (feed()?.snapshot?.state?.meta?.capital | number:'1.0-0') + ' CHF' : '—' }}
          </span>
          <span class="scard-sub">Target strategy capital</span>
        </div>
      </div>

      <!-- POSITIONS TABLE -->
      <section class="sec-card">
        <div class="sec-header">
          <h3>IBKR Live Positions</h3>
          <span class="sec-count">{{ feed()?.snapshot?.positions?.length || 0 }} open positions</span>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Symbol / Asset</th>
                <th class="c-num">Position (Qty)</th>
                <th class="c-num">Market Price</th>
                <th class="c-num">Market Value</th>
                <th class="c-num">Currency</th>
              </tr>
            </thead>
            <tbody>
              @for (pos of feed()?.snapshot?.positions || []; track pos.conid) {
                <tr>
                  <td class="font-bold text-white">{{ pos.symbol || ('ConID: ' + pos.conid) }}</td>
                  <td class="c-num">{{ pos.position != null ? (pos.position | number:'1.0-4') : '—' }}</td>
                  <td class="c-num">{{ pos.mktPrice != null ? (pos.mktPrice | number:'1.2-2') : '—' }}</td>
                  <td class="c-num">{{ pos.mktValue != null ? (pos.mktValue | number:'1.2-2') : '—' }}</td>
                  <td class="c-num">{{ pos.currency || 'CHF' }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="empty-state">No open positions currently reported by IBKR gateway.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- ACTIVE ORDERS TABLE -->
      <section class="sec-card">
        <div class="sec-header">
          <h3>Active IBKR Working Orders</h3>
          <span class="sec-count">{{ feed()?.snapshot?.orders_active?.length || 0 }} orders</span>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Ticker</th>
                <th>Action</th>
                <th class="c-num">Quantity</th>
                <th class="c-num">Limit Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (ord of feed()?.snapshot?.orders_active || []; track ord.id) {
                <tr>
                  <td><code>{{ ord.id }}</code></td>
                  <td class="font-bold text-white">{{ ord.ticker || ('ConID ' + ord.conid) }}</td>
                  <td><span class="chip" [class.ok]="ord.action === 'BUY'">{{ ord.action }}</span></td>
                  <td class="c-num">{{ ord.quantity | number:'1.0-2' }}</td>
                  <td class="c-num">{{ ord.price != null ? (ord.price | number:'1.2-2') : 'MKT' }}</td>
                  <td><span class="chip-status">{{ ord.status }}</span></td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="empty-state">No working orders open at this time.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- SLEEVES & GATE VERDICTS -->
      <section class="sec-card">
        <div class="sec-header">
          <h3>Portfolio Sleeves & Gate Verdicts</h3>
          <span class="sec-meta">
            Gate evaluated: {{ feed()?.snapshot?.state?.meta?.gate_checked || '—' }}
          </span>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Sleeve Symbol</th>
                <th>Status</th>
                <th class="c-num">Invested</th>
                <th>Gate Verdict</th>
                <th>Active Order</th>
              </tr>
            </thead>
            <tbody>
              @for (sl of feed()?.snapshot?.state?.sleeves || []; track sl.sym) {
                <tr>
                  <td class="font-bold text-white">{{ sl.sym }}</td>
                  <td><span class="chip">{{ sl.status || 'active' }}</span></td>
                  <td class="c-num">{{ sl.invested_chf != null ? (sl.invested_chf | number:'1.0-0') + ' CHF' : '—' }}</td>
                  <td>
                    <span class="chip" [class.ok]="sl.gate === 'BUY'" [class.stale]="sl.gate === 'WAIT'">
                      {{ sl.gate || '—' }}
                    </span>
                  </td>
                  <td>
                    @if (sl.order) {
                      <code>{{ sl.order | json }}</code>
                    } @else {
                      <span class="dim">—</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="empty-state">No sleeve gates initialized yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- BINANCE TRADING WATCHER — below IBKR per Vincent (2026-11-01 19:22) -->
      <section class="sec-card">
        <div class="sec-header">
          <h3>Binance Trading Watcher</h3>
          <span class="sec-meta">
            cloud · checks every {{ feed()?.trading_watch?.interval_s || '—' }}s · read-only
          </span>
        </div>
        <div class="bar">
          @if (feed()?.trading_watch?.enabled) {
            <span class="chip ok">● Watcher enabled</span>
          } @else {
            <span class="chip danger">● Watcher disabled</span>
          }
          @if (feed()?.trading_watch?.binance_keys_configured) {
            <span class="chip ok">Keys configured</span>
          } @else {
            <span class="chip danger">Keys missing</span>
          }
          @if (feed()?.trading_watch?.sms_enabled) {
            <span class="chip ok">SMS alerts on</span>
          } @else {
            <span class="chip">SMS off</span>
          }
          @if (feed()?.trading_watch?.last_check; as lc) {
            <span class="chip" [class.ok]="lc.ok" [class.danger]="!lc.ok"
                  [title]="lc.problems?.join(' · ') || ''">
              Last check: {{ lc.ok ? 'OK' : 'PROBLEM' }} · {{ lc.legs ?? '—' }} legs · {{ ageOf(lc.ts) }}
            </span>
          } @else {
            <span class="chip stale">No check yet (since last deploy)</span>
          }
        </div>
        @if (feed()?.trading_watch?.error) {
          <div class="empty-state">Watcher status unavailable: {{ feed()?.trading_watch?.error }}</div>
        }
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Problems</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              @for (a of feed()?.trading_watch?.recent_alerts || []; track a.event_id) {
                <tr>
                  <td>{{ a.created_at ? (a.created_at | date:'MMM d, HH:mm') : '—' }}</td>
                  <td>
                    @for (prob of a.problems; track $index) {
                      <div>• {{ prob }}</div>
                    } @empty {
                      <span class="dim">—</span>
                    }
                  </td>
                  <td><span class="chip" [class.stale]="a.test">{{ a.test ? 'TEST' : 'ALERT' }}</span></td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="3" class="empty-state">No alerts — every watcher check is green ✓</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- PER-ASSET DETAILS since 01.11.2026 (cumulated, USDT) -->
        @if (feed()?.trading_watch?.per_asset_since; as pa) {
          <div class="sec-sub">
            Per-asset cumulated since {{ pa.since ? (pa.since | date: 'MMM d, y') : 'Nov 1, 2026' }}
            (USDT, funding + fees + realized)
            @if (pa.computed_at) {
              <span class="dim"> · computed {{ ageOf(pa.computed_at) }}</span>
            }
          </div>
          @if (pa.error) {
            <div class="empty-state">Per-asset detail unavailable: {{ pa.error }}</div>
          } @else {
            <div class="tbl-wrap">
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th class="c-num">Funding</th>
                    <th class="c-num">Fees</th>
                    <th class="c-num">Realized</th>
                    <th class="c-num">Net</th>
                    <th class="c-num">Position</th>
                    <th class="c-num">Events</th>
                  </tr>
                </thead>
                <tbody>
                  @for (a of pa.assets || []; track a.symbol) {
                    <tr>
                      <td class="font-bold text-white">{{ a.symbol }}</td>
                      <td class="c-num" [class.pos]="a.funding_usd > 0" [class.neg]="a.funding_usd < 0">{{ a.funding_usd | number:'1.4-4' }}</td>
                      <td class="c-num" [class.pos]="a.fees_usd > 0" [class.neg]="a.fees_usd < 0">{{ a.fees_usd | number:'1.4-4' }}</td>
                      <td class="c-num" [class.pos]="a.realized_usd > 0" [class.neg]="a.realized_usd < 0">{{ a.realized_usd | number:'1.4-4' }}</td>
                      <td class="c-num font-bold" [class.pos]="a.net_usd > 0" [class.neg]="a.net_usd < 0">{{ a.net_usd | number:'1.4-4' }}</td>
                      <td class="c-num">{{ a.position != null ? (a.position | number:'1.0-4') : '—' }}</td>
                      <td class="c-num dim">{{ a.events }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="7" class="empty-state">No income events since Nov 1, 2026.</td>
                    </tr>
                  }
                </tbody>
                @if (pa.totals?.net_usd != null) {
                  <tfoot>
                    <tr>
                      <td class="font-bold text-white">TOTAL</td>
                      <td class="c-num font-bold" [class.pos]="(pa.totals?.funding_usd || 0) > 0">{{ pa.totals?.funding_usd | number:'1.4-4' }}</td>
                      <td class="c-num font-bold" [class.neg]="(pa.totals?.fees_usd || 0) < 0">{{ pa.totals?.fees_usd | number:'1.4-4' }}</td>
                      <td class="c-num font-bold" [class.pos]="(pa.totals?.realized_usd || 0) > 0">{{ pa.totals?.realized_usd | number:'1.4-4' }}</td>
                      <td class="c-num font-bold" [class.pos]="(pa.totals?.net_usd || 0) > 0" [class.neg]="(pa.totals?.net_usd || 0) < 0">{{ pa.totals?.net_usd | number:'1.4-4' }}</td>
                      <td class="c-num dim">—</td>
                      <td class="c-num dim">{{ pa.totals?.events }}</td>
                    </tr>
                  </tfoot>
                }
              </table>
            </div>
          }
        } @else {
          <div class="empty-state">Per-asset detail not computed yet (arrives with the next watcher cycle).</div>
        }
      </section>
    </div>
  `,
  styles: [`
    .investments-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      color: #cbd5e1;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .bar h2 {
      margin: 0;
      font-size: 1.25rem;
      color: #f8fafc;
    }
    .chip {
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
    }
    .chip.ok {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border-color: rgba(16, 185, 129, 0.3);
    }
    .chip.danger {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .chip.stale {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
      border-color: rgba(245, 158, 11, 0.3);
    }
    .btn {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #f1f5f9;
      padding: 0.35rem 0.85rem;
      border-radius: 6px;
      font-size: 0.8rem;
      cursor: pointer;
      margin-left: auto;
    }
    .btn:hover { background: rgba(255, 255, 255, 0.15); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
    }
    .scard {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 1.1rem;
    }
    .scard-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
    }
    .scard-val {
      font-size: 1.5rem;
      font-weight: 700;
      color: #f8fafc;
      margin: 0.3rem 0 0.2rem;
      display: block;
    }
    .scard-sub {
      font-size: 0.75rem;
      color: #64748b;
    }

    .sec-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .sec-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .sec-header h3 {
      font-size: 1.05rem;
      margin: 0;
      color: #f1f5f9;
    }
    .sec-count, .sec-meta {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    .tbl-wrap { overflow-x: auto; }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.825rem;
      text-align: left;
    }
    .tbl th {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      font-weight: 500;
    }
    .tbl td {
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
    }
    .c-num { text-align: right; white-space: nowrap; }
    .sec-sub { margin-top: 1rem; font-size: 0.85rem; color: #94a3b8; }
    .pos { color: #10b981; }
    .neg { color: #f87171; }
    .dim { color: #64748b; }
    .text-white { color: #f8fafc; }
    .font-bold { font-weight: 600; }
    .empty-state { text-align: center; color: #64748b; padding: 2rem; font-size: 0.85rem; }
    code {
      font-family: monospace;
      font-size: 0.75rem;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 1px 4px;
      border-radius: 3px;
    }
  `]
})
export class InvestmentsComponent implements OnInit, OnDestroy {
  readonly feed = signal<InvestmentsFeedResponse | null>(null);
  readonly loading = signal<boolean>(false);
  private timer: any = null;

  private readonly API_URL = 'https://api.kubotics.ch/api/v1/investments';

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.load();
    // Poll every 15 seconds per §10 contract
    this.timer = setInterval(() => this.load(), 15_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** "3m ago" / "just now" for the last-check chip. */
  ageOf(ts?: string): string {
    if (!ts) return '—';
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(ts)) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  load(): void {
    this.loading.set(true);
    this.http.get<InvestmentsFeedResponse>(this.API_URL).subscribe({
      next: (res) => {
        this.feed.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }
}
