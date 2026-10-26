import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer>
      <div class="footer-content">
        <div class="footer-section">
          <h3>Sailing Florentine</h3>
          <p>Follow our family adventures across the oceans. Captain Vincent, 1st Mate Liz, and Chief Happiness Officer Kuro invite you aboard.</p>
          <div class="social-links">
            <a href="https://www.instagram.com/kuro211018/" target="_blank" aria-label="Instagram">📸</a>
            <a href="https://facebook.com" target="_blank" aria-label="Facebook">👥</a>
          </div>
        </div>
        <div class="footer-section">
          <h4>Explore</h4>
          <ul>
            <li><a routerLink="/blog">Blog</a></li>
            <li><a routerLink="/crew">Crew</a></li>
            <li><a routerLink="/boat">SY Florentine</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <h4>Legal</h4>
          <ul>
            <li><a routerLink="/contact">Contact & Impressum</a></li>
            <li><a routerLink="/contact">Privacy</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2026 Sailing Florentine — A KuroLIV GmbH project. Passionate family, professional standards.</p>
      </div>
    </footer>
  `,
  styles: [`
    footer {
      background: var(--primary-color);
      color: white;
      padding: 3rem 2rem 1rem;
      margin-top: auto;
    }

    .footer-content {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 3rem;
    }

    .footer-section h3, .footer-section h4 {
      color: var(--accent-color);
      margin-bottom: 1.5rem;
    }

    .footer-section ul {
      list-style: none;
      padding: 0;
      margin: 0;
      li {
        margin-bottom: 0.8rem;
        a { color: rgba(255,255,255,0.8); &:hover { color: white; } }
      }
    }

    .social-links {
      display: flex;
      gap: 1.5rem;
      font-size: 1.5rem;
      margin-top: 1rem;
      a { transition: transform 0.2s; &:hover { transform: translateY(-3px); } }
    }

    .footer-bottom {
      max-width: 1200px;
      margin: 2rem auto 0;
      padding-top: 2rem;
      border-top: 1px solid rgba(255,255,255,0.1);
      text-align: center;
      font-size: 0.9rem;
      color: rgba(255,255,255,0.6);
    }

    @media (max-width: 768px) {
      .footer-content { grid-template-columns: 1fr; gap: 2rem; }
    }
  `]
})
export class Footer { }
