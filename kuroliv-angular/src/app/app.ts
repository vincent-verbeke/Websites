import { Component, signal, computed, inject } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
// import { Hero } from './components/hero/hero'; // No longer needed here
// import { Services } from './components/services/services'; // No longer needed here
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
      filter(event => {
        console.log('Router Event:', event);
        return event instanceof NavigationEnd;
      })
    )
  );

  // Compute visibility based on URL
  protected showHeaderFooter = computed(() => {
    // We can rely on router.url directly if signal updates on NavigationEnd, 
    // but toSignal returns the event. We need the url after nav.
    // Easier: just wrap router.url in a computed/signal pattern or check it manually ?
    // The signal from events will trigger changes.
    const event = this.currentUrl();
    if (event instanceof NavigationEnd) {
      return event.urlAfterRedirects !== '/';
    }
    // Default/Initial state: check router.url (might be empty initially)
    return this.router.url !== '/';
  });
}
