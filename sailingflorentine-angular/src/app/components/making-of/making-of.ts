import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContentService, HistoryData } from '../../services/content';
import { SEOService } from '../../services/seo';

@Component({
  selector: 'app-making-of',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (data(); as history) {
      <section class="makingof-hero">
        <div class="container">
          <h1>{{ history.makingOf.title }}</h1>
          @if (history.makingOf.mapsLink) {
            <a [href]="history.makingOf.mapsLink" target="_blank" class="subtitle location-link">
              {{ history.makingOf.subtitle }}
            </a>
          } @else {
            <p class="subtitle">{{ history.makingOf.subtitle }}</p>
          }
          <div class="intro-card">
            <p>{{ history.makingOf.description }}</p>
          </div>
        </div>
      </section>

      <section class="story-grid">
        <div class="container">
          <div class="grid">
            @for (item of history.makingOf.story; track item.image) {
              <div class="story-item">
                <div class="image-wrapper">
                  <img [src]="item.image" [alt]="item.caption" loading="lazy">
                  <div class="overlay">
                    <p>{{ item.caption }}</p>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
      </section>

      <section class="story-footer">
        <div class="container text-center">
          <h2>And thus, Florentine was born.</h2>
          <p>Built for the blue, loved by the family.</p>
        </div>
      </section>
    }
  `,
  styles: [`
    .makingof-hero {
      padding: 8rem 2rem 4rem;
      background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('/images/makingof/IMG_0032.jpg');
      background-size: cover;
      background-position: center;
      text-align: center;
      color: white;
      
      h1 { font-size: 3.5rem; margin-bottom: 0.5rem; color: var(--accent-color); }
      .subtitle { font-size: 1.4rem; opacity: 0.9; margin-bottom: 3rem; display: block; text-decoration: none; color: inherit; }
      .location-link {
        transition: color 0.3s, opacity 0.3s;
        &:hover { color: var(--accent-color); opacity: 1; text-decoration: underline; }
      }
    }

    .intro-card {
      max-width: 800px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(8px);
      padding: 2.5rem;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      p { font-size: 1.2rem; line-height: 1.7; font-style: italic; }
    }

    .container { max-width: 1200px; margin: 0 auto; }
    .text-center { text-align: center; }

    .story-grid { padding: 6rem 2rem; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 2rem;
    }

    .story-item {
      border-radius: 12px;
      overflow: hidden;
      position: relative;
      aspect-ratio: 4/3;
      
      .image-wrapper {
        height: 100%;
        width: 100%;
        position: relative;
        img { 
          width: 100%; height: 100%; object-fit: cover; 
          transition: transform 0.5s ease;
        }
        &:hover img { transform: scale(1.1); }
        
        .overlay {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          padding: 1.5rem;
          background: linear-gradient(transparent, rgba(0,0,0,0.8));
          color: white;
          opacity: 0;
          transition: opacity 0.3s ease;
          p { margin: 0; font-size: 1rem; }
        }
        &:hover .overlay { opacity: 1; }
      }
    }

    .story-footer {
      padding: 6rem 2rem;
      h2 { font-size: 2.5rem; color: var(--accent-color); margin-bottom: 1rem; }
      p { font-size: 1.2rem; opacity: 0.8; }
    }

    @media (max-width: 768px) {
      .makingof-hero h1 { font-size: 2.5rem; }
      .grid { grid-template-columns: 1fr; }
    }
  `]
})
export class MakingOfComponent implements OnInit {
  private contentService = inject(ContentService);
  private seoService = inject(SEOService);
  data = signal<HistoryData | null>(null);

  ngOnInit() {
    this.contentService.getHistory().subscribe(data => {
      this.data.set(data);
      this.seoService.updateTags({
        title: 'The Making of SY Florentine',
        description: 'A journey back to the beginnings in Les Herbiers. Witness the birth of our blue-water home at the Jeanneau factory.',
        keywords: ['boat building', 'Jeanneau production', 'Les Herbiers factory', 'sailboat construction', 'SY Florentine birth']
      });
    });
  }
}
