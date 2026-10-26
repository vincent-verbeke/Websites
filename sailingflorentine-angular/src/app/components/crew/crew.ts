import { Component, inject, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ContentService, CrewMember } from '../../services/content';
import { SEOService } from '../../services/seo';

@Component({
  selector: 'app-crew',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="crew-page">
      <div class="crew-header">
        <h1>The Crew</h1>
        <p>Meet the family behind Sailing Florentine — a passionate team with professional standards.</p>
      </div>
      <div class="crew-grid">
        @for (member of crew(); track member.id) {
          <div class="crew-card">
            <div class="avatar">
              <span class="emoji">{{ member.emoji }}</span>
            </div>
            <h2>{{ member.name }}</h2>
            <span class="role">{{ member.role }}</span>
            <p class="bio">{{ member.bio }}</p>
            <blockquote class="quote">"{{ member.quote }}"</blockquote>
          </div>
        }
      </div>
      <div class="crew-story">
        <h2>Together, We Sail</h2>
        <p>KuroLIV is not just a company name — it's a philosophy. <strong>KURO</strong>, <strong>LI</strong>, and <strong>V</strong> represent three pillars of a warm, open-minded family. We believe our combined strength far exceeds the sum of its parts. In our world, 1+1+1 does not equal 3; it represents a much larger, exponential value that we bring to every challenge and every mile sailed.</p>
      </div>
    </div>
  `,
  styles: [`
    .crew-page { max-width: 1200px; margin: 0 auto; padding: 2rem; }

    .crew-header {
      text-align: center;
      padding: 3rem 0;
      h1 { font-size: 3rem; color: var(--accent-color); margin-bottom: 0.5rem; }
      p { font-size: 1.2rem; opacity: 0.8; max-width: 600px; margin: 0 auto; }
    }

    .crew-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2.5rem;
      margin-bottom: 4rem;
    }

    .crew-card {
      background: var(--glass-bg);
      color: var(--card-text);
      border-radius: 16px;
      padding: 2.5rem;
      text-align: center;
      transition: transform 0.3s, box-shadow 0.3s;
      &:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0,0,0,0.2); }

      .avatar {
        width: 100px; height: 100px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--secondary-color), var(--primary-color));
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 1.5rem;
        .emoji { font-size: 2.5rem; }
      }

      h2 { margin-bottom: 0.3rem; }

      .role {
        color: var(--accent-color);
        font-weight: bold;
        font-size: 0.95rem;
        display: block;
        margin-bottom: 1.5rem;
      }

      .bio { font-size: 0.95rem; line-height: 1.7; opacity: 0.85; margin-bottom: 1.5rem; }

      .quote {
        font-style: italic;
        opacity: 0.7;
        border-left: 3px solid var(--accent-color);
        padding-left: 1rem;
        text-align: left;
        margin: 0;
      }
    }

    .crew-story {
      text-align: center;
      padding: 3rem;
      background: var(--glass-bg);
      border-radius: 16px;
      h2 { color: var(--accent-color); margin-bottom: 1.5rem; }
      p { max-width: 700px; margin: 0 auto; line-height: 1.8; font-size: 1.1rem; color: var(--card-text); }
    }

    @media (max-width: 992px) {
      .crew-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class Crew {
  private contentService = inject(ContentService);
  private seoService = inject(SEOService);
  crew = toSignal(this.contentService.getCrew(), { initialValue: [] as CrewMember[] });

  constructor() {
    effect(() => {
      if (this.crew().length > 0) {
        this.seoService.updateTags({
          title: 'The Crew',
          description: 'Meet the Belgian family and their Shiba Inu Kuro sailing the world on SY Florentine. Professional standards meets passion for the sea.',
          keywords: ['sailing crew', 'family on board', 'Shiba Inu sailing', 'Belgian sailors', 'Swiss flag', 'KuroLIV philosophy']
        });
      }
    });
  }
}
