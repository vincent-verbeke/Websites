import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule, HttpErrorResponse } from '@angular/common/http';
import { AiTradingService } from '../../services/ai-trading.service';
import { interval, Subscription, startWith, catchError, of, forkJoin, timeout } from 'rxjs';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-ai-trading',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './ai-trading.component.html',
  styleUrl: './ai-trading.component.scss'
})
export class AiTradingComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('pnlChart') pnlChartRef!: ElementRef<HTMLCanvasElement>;

  private tradingService = inject(AiTradingService);

  // State Signals (Aligned with working production version: limit 15)
  currentSymbol = signal<string>('BTCUSDC');
  selectedMode = signal<string>('LIVE');
  tradeLimit = signal<number>(15);

  stats = signal<any>({ total_trades: 0, total_pnl: 0, actual_mode: '...' });
  performance = signal<any>({ win_rate: 0, profit_factor: 0, avg_profit: 0, avg_loss: 0 });
  accountPerf = signal<any>({ current_equity: 0, daily_pnl_abs: 0, daily_pnl_rel_pct: 0 });
  binancePortfolio = signal<any>({ total_margin_balance: 0, total_wallet_balance: 0, total_unrealized_pnl: 0, total_available_balance: 0 });
  
  trades = signal<any[]>([]);
  btcTrades = signal<any[]>([]);
  ethTrades = signal<any[]>([]);
  activeStrategy = signal<any>(null);
  
  // Granular Loading States
  isLoading = signal<boolean>(true);
  isStatsLoading = signal<boolean>(false);
  isTradesLoading = signal<boolean>(false);
  isStrategyLoading = signal<boolean>(false);
  apiError = signal<string | null>(null);

  // Computed: filtered trades PnL summary
  tradePnlSummary = computed(() => {
    const t = this.trades().filter(tr => tr.status === 'CLOSED' && tr.pnl !== null);
    const totalPnl = t.reduce((s, tr) => s + (parseFloat(tr.pnl) || 0), 0);
    const wins = t.filter(tr => (parseFloat(tr.pnl) || 0) > 0).length;
    return { totalPnl, count: t.length, wins };
  });

  // Computed: strategy params array to prevent Angular *ngFor infinite thrashing
  strategyParams = computed(() => {
    const s = this.activeStrategy();
    return s?.parameters ? Object.entries(s.parameters) : [];
  });

  private chart: Chart | null = null;
  private pollSubscription?: Subscription;

  ngOnInit(): void {
    this.pollSubscription = interval(15000) // Poll every 15s (standard)
      .pipe(startWith(0))
      .subscribe(() => this.refreshData());
  }

  ngAfterViewInit(): void {
    this.initChart();
  }

  ngOnDestroy(): void {
    this.pollSubscription?.unsubscribe();
    this.chart?.destroy();
  }

  setSymbol(symbol: string): void {
    if (this.currentSymbol() === symbol) return;
    this.currentSymbol.set(symbol);
    this.refreshWithLoading();
  }

  setMode(mode: string): void {
    if (this.selectedMode() === mode) return;
    this.selectedMode.set(mode);
    this.refreshWithLoading();
  }

  setLimit(limit: number): void {
    if (this.tradeLimit() === limit) return;
    this.tradeLimit.set(limit);
    this.refreshWithLoading();
  }

  public refreshWithLoading(): void {
    this.isStatsLoading.set(true);
    this.isTradesLoading.set(true);
    this.isStrategyLoading.set(true);
    this.refreshData();
  }

  public refreshData(): void {
    const symbol = this.currentSymbol();
    const mode = this.selectedMode();
    const limit = this.tradeLimit();

    this.isLoading.set(true);

    // 1. Stats and Win Rate
    this.tradingService.getStats(symbol, mode).pipe(timeout(10000), catchError(e => this.handleLocalError('Stats', e))).subscribe(s => {
      if (s) this.stats.set(s);
      this.isStatsLoading.set(false);
    });

    this.tradingService.getPerformance(symbol, mode).pipe(timeout(10000), catchError(e => this.handleLocalError('Perf', e))).subscribe(p => {
      if (p) this.performance.set(p);
    });

    // 2. Portfolio/Account 
    this.tradingService.getAccountPerformance(mode).pipe(timeout(12000), catchError(e => this.handleLocalError('Account', e))).subscribe(a => {
      if (a) this.accountPerf.set(a);
    });

    this.tradingService.getBinancePortfolio().pipe(timeout(12000), catchError(e => this.handleLocalError('Binance', e))).subscribe(b => {
      if (b) this.binancePortfolio.set(b);
      this.isLoading.set(false);
    });

    // 3. Strategy
    this.tradingService.getActiveStrategy(symbol).pipe(timeout(8000), catchError(e => this.handleLocalError('Strategy', e))).subscribe(st => {
      this.activeStrategy.set(st);
      this.isStrategyLoading.set(false);
    });

    // 4. Detailed Trades
    this.tradingService.getTrades(symbol, limit, mode).pipe(timeout(10000), catchError(e => this.handleLocalError('Trades', e))).subscribe(t => {
      if (t) this.trades.set(t);
      this.isTradesLoading.set(false);
    });

    // 5. Chart Data (Background)
    forkJoin({
      btc: this.tradingService.getTrades('BTCUSDC', limit, mode).pipe(timeout(10000), catchError(() => of([]))),
      eth: this.tradingService.getTrades('ETHUSDC', limit, mode).pipe(timeout(10000), catchError(() => of([])))
    }).subscribe(({ btc, eth }) => {
      this.btcTrades.set(btc);
      this.ethTrades.set(eth);
      this.updateChart();
    });
  }

  private handleLocalError(ctx: string, err: any) {
    console.error(`[AI-TRADING] ${ctx} fetch failed:`, err);
    this.apiError.set(`${ctx} disconnected.`);
    return of(null);
  }

  private initChart(): void {
    if (!this.pnlChartRef?.nativeElement) return;
    const ctx = this.pnlChartRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: 'rgba(255,255,255,0.7)', font: { size: 11 } } },
          tooltip: {
            backgroundColor: '#0F172A',
            titleColor: '#F8FAFC',
            bodyColor: 'rgba(255,255,255,0.7)',
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: $${(ctx.parsed.y ?? 0).toFixed(2)}` }
          }
        },
        scales: {
          x: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }

  updateChart(): void {
    if (!this.chart) return;
    const buildSeries = (trades: any[]) => {
      const closed = [...trades].filter(t => t && t.status === 'CLOSED' && t.pnl !== null).reverse();
      let cum = 0;
      return closed.map(t => { cum += parseFloat(t.pnl || 0); return cum; });
    };
    const btcData = buildSeries(this.btcTrades());
    const ethData = buildSeries(this.ethTrades());
    const maxLen = Math.max(btcData.length, ethData.length);
    this.chart.data.labels = Array.from({ length: maxLen }, (_, i) => `#${i + 1}`);
    this.chart.data.datasets = [
      { label: 'BTC PnL', data: btcData, borderColor: '#F59E0B', tension: 0.4, fill: false },
      { label: 'ETH PnL', data: ethData, borderColor: '#8B5CF6', tension: 0.4, fill: false }
    ];
    this.chart.update('none');
  }

  getPnlPct(trade: any): number {
    const entry = parseFloat(trade.entry_price || 0);
    const amount = parseFloat(trade.amount || 0);
    return entry && amount ? (parseFloat(trade.pnl || 0) / (entry * amount)) * 100 : 0;
  }

  getSideClass(side: string): string { return side === 'LONG' ? 'side-long' : 'side-short'; }
  getPnlClass(pnl: any): string { return parseFloat(pnl || 0) >= 0 ? 'pnl-pos' : 'pnl-neg'; }
  formatTime(ts: string): string { return ts ? new Date(ts).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
}
