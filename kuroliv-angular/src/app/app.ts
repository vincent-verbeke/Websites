import { Component, signal, computed, inject } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private router = inject(Router);

  // Create a signal that updates whenever navigation ends
  private currentUrl = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    )
  );

  /**
   * Compute visibility based on URL.
   * Hide Header/Footer for the Hero page (/) and the AI-Trading Dashboard (/aitrading)
   * to ensure a full-screen executive experience.
   */
  protected showHeaderFooter = computed(() => {
    const event = this.currentUrl() as NavigationEnd;
    const url = event ? event.urlAfterRedirects : this.router.url;
    
    // Exact match for root and aitrading paths
    return url !== '/' && url !== '/aitrading';
  });
}
