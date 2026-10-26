import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContentService, TimelineEvent } from '../../services/content';
import { SEOService } from '../../services/seo';

@Component({
  selector: 'app-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="timeline-hero">
      <div class="container">
        <h1>The Florentine Timeline</h1>
        <p>A journey from the factory to the ocean, 2011 – Present.</p>
      </div>
    </section>

    <section class="timeline-content">
      <div class="container">
        <div class="timeline">
          @for (event of timeline(); track event.title + event.year; let i = $index) {
            <div class="timeline-item" [class.reverse]="i % 2 !== 0">
              @if (event.images && event.images.length > 0) {
                <div class="timeline-visual multi-image">
                  @for (img of event.images; track img) {
                    <img [src]="img" [alt]="event.title" loading="lazy">
                  }
                </div>
              } @else if (event.image) {
                <div class="timeline-visual">
                  <img [src]="event.image" [alt]="event.title" loading="lazy">
                </div>
              }
              <div class="timeline-marker">
                <div class="dot"></div>
                <div class="line"></div>
              </div>
              <div class="timeline-info">
                <span class="year">{{ event.year }}</span>
                <h2>{{ event.title }}</h2>
                <p>{{ event.description }}</p>
              </div>
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .timeline-hero {
      padding: 8rem 2rem 4rem;
      text-align: center;
      background: linear-gradient(to bottom, var(--bg-dark), rgba(0,0,0,0.4)), url('/images/hero/stmalo_bg.jpg');
      background-size: cover;
      background-position: center;
      color: white;
      h1 { font-size: 3.5rem; margin-bottom: 1rem; color: var(--accent-color); }
      p { font-size: 1.2rem; opacity: 0.9; }
    }

    .timeline-content { padding: 4rem 2rem; }
    .container { max-width: 1100px; margin: 0 auto; }

    .timeline {
      position: relative;
      padding: 2rem 0;
    }

    .timeline-item {
      display: flex;
      align-items: center;
      margin-bottom: 6rem;
      gap: 4rem;

      &.reverse {
        flex-direction: row-reverse;
        text-align: right;
      }
    }

    .timeline-visual {
      flex: 1;
      &.multi-image {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
      }
      img {
        width: 100%;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        transition: transform 0.3s ease;
        &:hover { transform: scale(1.02); }
      }
    }

    .timeline-marker {
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
      .dot {
        width: 20px;
        height: 20px;
        background: var(--accent-color);
        border-radius: 50%;
        z-index: 2;
        box-shadow: 0 0 10px var(--accent-color);
      }
      .line {
        width: 2px;
        flex: 1;
        background: rgba(255,255,255,0.1);
        position: absolute;
        top: 20px;
        bottom: -6rem;
      }
    }

    .timeline-item:last-child .line { display: none; }

    .timeline-info {
      flex: 1;
      .year {
        display: inline-block;
        font-size: 0.9rem;
        font-weight: bold;
        color: var(--accent-color);
        margin-bottom: 0.5rem;
        letter-spacing: 2px;
      }
      h2 { font-size: 2rem; margin-bottom: 1rem; }
      p { font-size: 1.1rem; line-height: 1.6; opacity: 0.8; }
    }

    @media (max-width: 768px) {
      .timeline-item {
        flex-direction: column !important;
        text-align: left !important;
        gap: 2rem;
        margin-bottom: 4rem;
      }
      .timeline-marker { display: none; }
      .timeline-hero h1 { font-size: 2.5rem; }
    }
  `]
})
export class TimelineComponent implements OnInit {
  private contentService = inject(ContentService);
  private seoService = inject(SEOService);
  timeline = signal<TimelineEvent[]>([]);

  ngOnInit() {
    this.contentService.getHistory().subscribe(data => {
      this.timeline.set(data.timeline);
      this.seoService.updateTags({
        title: 'Timeline - Our Journey',
        description: 'From 2011 to present: Explore the milestones of SY Florentine. Technical upgrades, family adventures, and the road to a world trip.',
        keywords: ['sailing timeline', 'cruising milestones', 'voyage history', 'blue water adventure', 'Belgian sailors journey']
      });
    });
  }
}
