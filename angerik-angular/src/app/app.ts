import { Component, computed, inject } from '@angular/core';
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

  // Track if we're on home page to hide header/footer
  private currentUrl = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    )
  );

  // Show header/footer on all pages except the very first load/home
  protected showHeaderFooter = computed(() => {
    const current = this.currentUrl();
    if (current && current instanceof NavigationEnd) {
      return current.urlAfterRedirects !== '/';
    }
    // Default to showing header/footer on initial load
    return true;
  });
}
