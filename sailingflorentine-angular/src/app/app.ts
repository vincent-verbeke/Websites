import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { ThemeService } from './services/theme';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, Footer],
  template: `
    <div class="app-container" [class.light-mode]="!themeService.isDarkMode()">
      <app-header />
      <main>
        <router-outlet />
      </main>
      <app-footer />
    </div>
  `,
  styles: [`
    .app-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      background-color: var(--bg-dark);
      color: var(--text-dark);
      transition: background-color var(--transition-speed), color var(--transition-speed);

      &.light-mode {
        background-color: var(--bg-light);
        color: var(--text-light);
      }
    }

    main {
      flex: 1;
      width: 100%;
    }
  `]
})
export class App {
  themeService = inject(ThemeService);
}
