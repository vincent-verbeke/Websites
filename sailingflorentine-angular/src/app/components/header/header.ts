import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header [class.light]="!themeService.isDarkMode()">
      <nav>
        <a routerLink="/" class="logo-link">
          <span class="logo-text">Sailing <span class="highlight">Florentine</span></span>
        </a>
        <div class="right-section">
          <ul>
            <li><a routerLink="/blog">Blog</a></li>
            <li><a routerLink="/timeline">History</a></li>
            <li><a routerLink="/making-of">Making Of</a></li>
            <li><a routerLink="/crew">Crew</a></li>
            <li><a routerLink="/boat">Boat</a></li>
            <li><a routerLink="/contact">Contact</a></li>
          </ul>
          <button (click)="themeService.toggleTheme()" class="theme-toggle"
              [attr.aria-label]="themeService.isDarkMode() ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
              {{ themeService.isDarkMode() ? '☀️' : '🌙' }}
          </button>
        </div>
      </nav>
    </header>
  `,
  styles: [`
    header {
      background: var(--primary-color);
      color: white;
      padding: 1rem 2rem;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      position: sticky;
      top: 0;
      z-index: 1000;
      transition: background var(--transition-speed);

      &.light {
        background: white;
        color: var(--primary-color);
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);

        nav ul li a {
          color: var(--primary-color);
          &:hover { color: var(--secondary-color); }
        }

        .logo-text { color: var(--primary-color); }
      }
    }

    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1200px;
      margin: 0 auto;
    }

    .logo-text {
      font-size: 1.5rem;
      font-weight: bold;
      color: white;
      text-transform: uppercase;
      letter-spacing: 1px;

      .highlight {
        color: var(--accent-color);
      }
    }

    .right-section {
      display: flex;
      align-items: center;
      gap: 2rem;
    }

    ul {
      display: flex;
      list-style: none;
      margin: 0;
      padding: 0;
      gap: 1.5rem;

      li a {
        color: white;
        font-weight: 500;
        transition: color 0.2s;

        &:hover {
          color: var(--accent-color);
        }
      }
    }

    .theme-toggle {
      background: none;
      border: 1px solid rgba(255,255,255,0.2);
      padding: 0.5rem;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1.2rem;
      line-height: 1;
      transition: transform 0.3s;

      &:hover {
        transform: scale(1.1);
      }
    }

    .light .theme-toggle {
      border-color: rgba(0,0,0,0.1);
    }
  `]
})
export class Header {
  constructor(public themeService: ThemeService) { }
}
