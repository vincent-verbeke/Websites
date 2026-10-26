import { Component } from '@angular/core';
import { RouterLink, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink, CommonModule],
  template: `
    <footer>
      <div class="footer-container">
        <div class="footer-info">
          <h3>2TheCloud</h3>
          <p>Modernize with Clarity. Transform with Authority.</p>
        </div>
        <div class="footer-links">
          <h4>Expertise</h4>
          <ul>
            <li><a [routerLink]="['/']" [fragment]="'infrastructure'">Cloud Infrastructure</a></li>
            <li><a [routerLink]="['/']" [fragment]="'modernization'">App Modernization</a></li>
            <li><a [routerLink]="['/']" [fragment]="'security'">Advanced Security</a></li>
          </ul>
        </div>
        <div class="footer-contact" [routerLink]="['/contact']" style="cursor: pointer;">
          <h4>Contact</h4>
          <p>2TheCloud</p>
          <p>hello&#64;2thecloud.ch</p>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2026 2TheCloud - Member of KuroLIV GmbH family. All rights reserved.</p>
      </div>
    </footer>
  `,
  styles: [`
    footer {
      background: var(--bg-dark);
      color: var(--text-dark);
      padding: 4rem 0 2rem;
      margin-top: 0;
    }
    .footer-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 2rem;
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 4rem;
    }
    h3 { color: var(--primary); margin-bottom: 1rem; }
    h4 { margin-bottom: 1.5rem; }
    ul { list-style: none; padding: 0; }
    li { margin-bottom: 0.5rem; opacity: 0.8; }
    li a { 
      color: inherit; 
      text-decoration: none; 
      transition: color 0.3s;
      &:hover { color: var(--primary); }
    }
    .footer-bottom {
      max-width: 1200px;
      margin: 2rem auto 0;
      padding: 2rem 2rem 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      text-align: center;
      font-size: 0.9rem;
      opacity: 0.6;
    }
    @media (max-width: 768px) {
      .footer-container { grid-template-columns: 1fr; gap: 2rem; }
    }
  `]
})
export class Footer { }
