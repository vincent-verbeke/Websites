import { Component, inject, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ContentService, BoatInfo } from '../../services/content';
import { SEOService } from '../../services/seo';

@Component({
  selector: 'app-boat',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (boat(); as boat) {
      <div class="boat-page">
        <div class="boat-hero" [style.background-image]="'linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.5)), url(' + boat.image + ')'">
          <div class="hero-content">
            <h1>{{ boat.name }}</h1>
            <p class="model">{{ boat.make }} {{ boat.model }}</p>
            <span class="type-badge">{{ boat.type }}</span>
          </div>
        </div>
        <div class="content">
          <div class="description">
            <h2>Our Floating Home</h2>
            <p>{{ boat.description }}</p>
          </div>

          <div class="tech-specs">
            <div class="specs-data">
              <h2>Technical Specifications</h2>
              <div class="specs-grid">
                @for (spec of boat.specs; track spec.label) {
                  <div class="spec-card">
                    <span class="label">{{ spec.label }}</span>
                    <span class="value">{{ spec.value }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="specs-drawing">
              <img [src]="boat.drawing" alt="Jeanneau 42 DS Technical Drawing" class="drawing-img">
              <p class="drawing-caption">Official technical drawing of the Sun Odyssey 42 DS</p>
            </div>
          </div>

          <div class="gallery-section">
            <h2>Gallery</h2>
            <div class="gallery-grid">
              @for (img of boat.gallery; track img) {
                <div class="gallery-item" [style.background-image]="'url(' + img + ')'">
                   <div class="overlay">
                     <span>{{ getFilename(img) }}</span>
                   </div>
                </div>
              }
            </div>
          </div>

          @if (boat.upgrades.length) {
            <div class="upgrades-section">
              <h2>Recent Upgrades</h2>
              <div class="upgrades-list">
                @for (upgrade of boat.upgrades; track upgrade.description) {
                  <div class="upgrade-item">
                    <span class="year">{{ upgrade.year }}</span>
                    <span class="desc">{{ upgrade.description }}</span>
                  </div>
                }
              </div>
            </div>
          }

          @if (boat.blueWaterEquipment.length) {
            <div class="equipment-section">
              <h2>Blue Water Equipment</h2>
              <div class="equipment-grid">
                @for (equip of boat.blueWaterEquipment; track equip.name) {
                  <div class="equipment-card">
                    <h3>{{ equip.name }}</h3>
                    <p>{{ equip.description }}</p>
                    @if (equip.link) {
                      <a [href]="equip.link" target="_blank" class="equip-link">Visit Website →</a>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .boat-hero {
      height: 60vh;
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: flex-end;
      padding: 3rem;
    }

    .hero-content {
      color: white;
      h1 { font-size: 3.5rem; margin-bottom: 0.3rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
      .model { font-size: 1.5rem; opacity: 0.9; margin-bottom: 1rem; }
      .type-badge {
        background: var(--accent-color);
        color: var(--primary-color);
        padding: 0.5rem 1.5rem;
        border-radius: 20px;
        font-weight: bold;
        font-size: 0.9rem;
      }
    }

    .content { max-width: 1000px; margin: 0 auto; padding: 3rem 2rem; }

    .description {
      margin-bottom: 3rem;
      h2 { color: var(--accent-color); margin-bottom: 1.5rem; font-size: 2rem; }
      p { line-height: 1.8; font-size: 1.1rem; }
    }

    .tech-specs {
      display: flex;
      gap: 3rem;
      margin-bottom: 5rem;
      align-items: center;
      
      .specs-data { flex: 1.2; }
      .specs-drawing { 
        flex: 1; 
        text-align: center;
        .drawing-img { 
          width: 100%; 
          border-radius: 8px; 
          background: white; 
          padding: 1rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        }
        .drawing-caption { font-size: 0.8rem; opacity: 0.6; margin-top: 1rem; }
      }
      
      h2 { color: var(--accent-color); margin-bottom: 2rem; font-size: 2rem; }
    }

    .specs-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.2rem;
    }

    .spec-card {
      background: var(--glass-bg);
      padding: 1.2rem;
      border-radius: 12px;
      border: 1px solid var(--glass-border);
      .label { display: block; font-size: 0.75rem; opacity: 0.7; margin-bottom: 0.3rem; text-transform: uppercase; letter-spacing: 1px; }
      .value { display: block; font-size: 1.1rem; font-weight: bold; color: var(--accent-color); }
    }

    .gallery-section {
      h2 { color: var(--accent-color); margin-bottom: 2rem; font-size: 2rem; }
    }

    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.5rem;
    }

    .gallery-item {
      aspect-ratio: 4/3;
      background-size: cover;
      background-position: center;
      border-radius: 12px;
      overflow: hidden;
      position: relative;
      transition: transform 0.3s;
      &:hover { transform: scale(1.02); }
      
      .overlay {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.7));
        padding: 1rem;
        color: white;
        font-size: 0.8rem;
        opacity: 0;
        transition: opacity 0.3s;
      }
      &:hover .overlay { opacity: 1; }
    }

    @media (max-width: 900px) {
      .tech-specs { flex-direction: column; }
      .specs-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .upgrades-section, .equipment-section {
      margin-top: 5rem;
      h2 { color: var(--accent-color); margin-bottom: 2rem; font-size: 2rem; }
    }

    .upgrades-list {
      background: var(--glass-bg);
      border-radius: 16px;
      padding: 1rem 0;
    }

    .upgrade-item {
      display: flex;
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--glass-border);
      &:last-child { border-bottom: none; }
      .year { 
        font-weight: bold; 
        color: var(--accent-color); 
        width: 80px; 
        flex-shrink: 0;
      }
      .desc { opacity: 0.9; line-height: 1.5; }
    }

    .equipment-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2rem;
    }

    .equipment-card {
      background: var(--glass-bg);
      padding: 2rem;
      border-radius: 16px;
      border: 1px solid var(--glass-border);
      h3 { color: var(--accent-color); margin-bottom: 1rem; }
      p { opacity: 0.8; line-height: 1.6; margin-bottom: 1.5rem; }
      .equip-link { 
        font-weight: bold; 
        color: var(--secondary-color); 
        text-decoration: none;
        &:hover { color: var(--accent-color); }
      }
    }

    @media (max-width: 768px) {
      .equipment-grid { grid-template-columns: 1fr; }
      .upgrade-item { flex-direction: column; gap: 0.5rem; }
    }
  `]
})
export class Boat {
  private contentService = inject(ContentService);
  private seoService = inject(SEOService);
  boat = toSignal(this.contentService.getBoat());

  constructor() {
    effect(() => {
      const boatData = this.boat();
      if (boatData) {
        this.seoService.updateTags({
          title: 'SY Florentine - The Boat',
          description: `Discover ${boatData.name}, our blue-water ${boatData.make} ${boatData.model}. Performance sailing meets the comfort of a floating home.`,
          image: boatData.image,
          keywords: ['Jeanneau 42DS', 'performance sailing', 'blue water equipment', 'solar yacht', 'sailboat specifications', 'living aboard']
        });
      }
    });
  }

  getFilename(path: string): string {
    return path.split('/').pop() || path;
  }
}
