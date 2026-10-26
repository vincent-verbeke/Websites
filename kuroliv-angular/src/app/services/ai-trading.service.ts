import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, throwError, retry, delay } from 'rxjs';

/**
 * Service to fetch real-time AI-Trading metrics and trade history from the AWS ALB endpoint.
 * Optimized for "Simple Requests" (no custom headers) to avoid OPTIONS preflight blocks on localhost.
 * Implements robust retry logic to seamlessly recover from IPv6/TLS "Connection Reset" drops.
 */
@Injectable({
  providedIn: 'root'
})
export class AiTradingService {
  private http = inject(HttpClient);
  
  /**
   * Universal production API base URL.
   */
  private readonly baseUrl = 'https://api.akuris.ch/aitrading/api';

  private handleError(error: HttpErrorResponse) {
    let errorMessage = 'An unknown error occurred!';
    if (error.error instanceof ErrorEvent) {
      errorMessage = `Error: ${error.error.message}`;
    } else {
      errorMessage = `Error Code: ${error.status}\nMessage: ${error.message}`;
      console.error('Full HTTP Error Response:', error);
    }
    return throwError(() => new Error(errorMessage));
  }

  /**
   * Fetch global trading stats (pnl, trade count). Mode can be 'DRY' or 'LIVE'.
   */
  getStats(symbol?: string, mode?: string): Observable<any> {
    let url = symbol ? `${this.baseUrl}/stats?symbol=${symbol}` : `${this.baseUrl}/stats`;
    if (mode) {
      url += symbol ? `&mode=${mode}` : `?mode=${mode}`;
    }
    // Added retry(2) with 500ms delay to force browser IPv4 fallback if initial IPv6 drops
    return this.http.get(url).pipe(
      retry({ count: 2, delay: 500 }),
      catchError(this.handleError)
    );
  }

  /**
   * Fetch recent trade history. Mode can be 'DRY' or 'LIVE'.
   */
  getTrades(symbol?: string, limit: number = 50, mode?: string): Observable<any[]> {
    let url = `${this.baseUrl}/trades?limit=${limit}`;
    if (symbol) url += `&symbol=${symbol}`;
    if (mode) url += `&mode=${mode}`;
    return this.http.get<any[]>(url).pipe(
      retry({ count: 2, delay: 500 }),
      catchError(this.handleError)
    );
  }

  /**
   * Fetch performance metrics (win rate, profit factor, etc.)
   */
  getPerformance(symbol?: string, mode?: string): Observable<any> {
    let url = symbol ? `${this.baseUrl}/performance?symbol=${symbol}` : `${this.baseUrl}/performance`;
    if (mode) {
      url += symbol ? `&mode=${mode}` : `?mode=${mode}`;
    }
    return this.http.get(url).pipe(
      retry({ count: 2, delay: 500 }),
      catchError(this.handleError)
    );
  }

  /**
   * Fetch the currently active strategy parameters
   */
  getActiveStrategy(symbol: string = 'BTCUSDC'): Observable<any> {
    return this.http.get(`${this.baseUrl}/strategy/active?symbol=${symbol}`).pipe(
      retry({ count: 2, delay: 500 }),
      catchError(this.handleError)
    );
  }

  /**
   * Fetch real-time Portfolio Margin metrics and daily performance
   */
  getAccountPerformance(mode?: string): Observable<any> {
    let url = `${this.baseUrl}/account/performance`;
    if (mode) url += `?mode=${mode}`;
    return this.http.get(url).pipe(
      retry({ count: 2, delay: 500 }),
      catchError(this.handleError)
    );
  }

  /**
   * Fetch raw Binance Portfolio Margin account data for direct comparison
   */
  getBinancePortfolio(): Observable<any> {
    return this.http.get(`${this.baseUrl}/account/binance`).pipe(
      retry({ count: 2, delay: 500 }),
      catchError(this.handleError)
    );
  }
}
