import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InstagramFeed } from '../instagram-feed/instagram-feed';
import { ContentService, BlogPost } from '../../services/content';
import { SEOService } from '../../services/seo';

interface CarouselItem {
  title: string;
  subtitle: string;
  image: string;
  linkText: string;
  link: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink, InstagramFeed],
  template: `
    <!-- HERO CAROUSEL -->
    <section class="hero">
      <div class="carousel">
        <div class="carousel-inner" [style.transform]="'translateX(-' + currentSlide() * 100 + '%)'">
          @for (slide of slides; track slide.title) {
            <div class="slide" [style.background-image]="'linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(' + slide.image + ')'">
              <div class="slide-content">
                <h1>{{ slide.title }}</h1>
                <p>{{ slide.subtitle }}</p>
                <a [routerLink]="slide.link" class="cta-button">{{ slide.linkText }}</a>
              </div>
            </div>
          }
        </div>
        <button class="nav-btn prev" (click)="prevSlide()">❮</button>
        <button class="nav-btn next" (click)="nextSlide()">❯</button>
        <div class="indicators">
          @for (slide of slides; track $index) {
            <span class="dot" [class.active]="currentSlide() === $index" (click)="setSlide($index)"></span>
          }
        </div>
      </div>
    </section>

    <!-- FEATURES -->
    <section class="marketing">
      <div class="container">
        <div class="features">
          <a routerLink="/boat" class="feature-card">
            <div class="icon">⛵</div>
            <h2>SY Florentine</h2>
            <p>Jeanneau Sun Odyssey 42 DS Performance Edition — our blue-water home.</p>
          </a>
          <a routerLink="/blog" class="feature-card">
            <div class="icon">🌊</div>
            <h2>The Journey</h2>
            <p>From Saint-Malo to the Azores and across the Atlantic to the Caribbean.</p>
          </a>
          <a routerLink="/crew" class="feature-card">
            <div class="icon">👨‍👩‍👧‍👦</div>
            <h2>The Crew</h2>
            <p>A passionate family with a professional spirit and a Shiba Inu pirate.</p>
          </a>
        </div>

        <!-- BLOG PREVIEW -->
        <div class="blog-preview">
          <h2>Latest from the Blog</h2>
          <div class="post-grid">
            @for (post of latestPosts; track post.id) {
              <a class="post-card" [routerLink]="['/blog', post.id]">
                <div class="post-image" [style.background-image]="'url(' + post.heroImage + ')'"></div>
                <div class="post-info">
                  <span class="date">{{ post.date }}</span>
                  <h3>{{ post.title }}</h3>
                  <p>{{ post.excerpt }}</p>
                  <span class="read-more">Read More →</span>
                </div>
              </a>
            }
          </div>
        </div>

        <!-- INSTAGRAM SECTION -->
        <app-instagram-feed />

        <!-- HISTORY TEASER -->
        <div class="history-teaser">
          <div class="teaser-content">
            <h2>Our Story Since 2011</h2>
            <p>From the first visit to the Jeanneau factory to the latest Atlantic waves.</p>
            <div class="teaser-actions">
              <a routerLink="/timeline" class="cta-button outline">Explore Timeline</a>
              <a routerLink="/making-of" class="cta-button">The Making Of</a>
            </div>
          </div>
          <div class="teaser-image" style="background-image: url('/images/makingof/IMG_0032.jpg')"></div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .hero {
      height: 80vh;
      overflow: hidden;
      position: relative;
    }

    .carousel {
      height: 100%;
      width: 100%;
      position: relative;
    }

    .carousel-inner {
      height: 100%;
      display: flex;
      transition: transform 0.6s ease;
    }

    .slide {
      min-width: 100%;
      height: 100%;
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: white;
    }

    .slide-content {
      max-width: 800px;
      padding: 2rem;
      h1 { font-size: 3.5rem; margin-bottom: 1rem; text-shadow: 2px 2px 6px rgba(0,0,0,0.5); }
      p { font-size: 1.5rem; margin-bottom: 2rem; text-shadow: 1px 1px 3px rgba(0,0,0,0.5); }
    }

    .cta-button {
      display: inline-block;
      padding: 1rem 2.5rem;
      font-size: 1.1rem;
      background: var(--accent-color);
      color: var(--primary-color);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      transition: transform 0.2s, background 0.2s;
      &:hover { transform: scale(1.05); background: #e6c600; color: var(--primary-color); }
    }

    .nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(4px);
      border: none;
      color: white;
      padding: 1rem 1.2rem;
      cursor: pointer;
      font-size: 1.5rem;
      border-radius: 4px;
      transition: background 0.2s;
      &:hover { background: rgba(255,255,255,0.3); }
      &.prev { left: 1rem; }
      &.next { right: 1rem; }
    }

    .indicators {
      position: absolute;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 1rem;
    }

    .dot {
      width: 12px; height: 12px;
      border-radius: 50%;
      background: rgba(255,255,255,0.4);
      cursor: pointer;
      transition: background 0.2s;
      &.active { background: white; }
    }

    /* MARKETING */
    .marketing { padding: 4rem 2rem; }
    .container { max-width: 1200px; margin: 0 auto; }

    .features {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2.5rem;
      margin-bottom: 5rem;
      text-align: center;
    }

    .feature-card {
      display: block;
      background: rgba(255,255,255,0.05);
      padding: 3rem 2rem;
      border-radius: 16px;
      transition: transform 0.3s, box-shadow 0.3s;
      &:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0,0,0,0.2); color: inherit; }
      .icon { font-size: 3rem; margin-bottom: 1rem; }
      h2 { color: var(--accent-color); margin-bottom: 1rem; }
      p { line-height: 1.6; opacity: 0.8; }
    }

    .blog-preview {
      margin-bottom: 3rem;
      h2 { text-align: center; color: var(--accent-color); margin-bottom: 3rem; font-size: 2.5rem; }
    }

    .post-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2rem;
    }

    .post-card {
      display: block;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      overflow: hidden;
      transition: transform 0.3s, box-shadow 0.3s;
      &:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,0,0,0.15); color: inherit; }
      .post-image { height: 220px; background-size: cover; background-position: center; }
      .post-info {
        padding: 1.5rem;
        .date { color: var(--secondary-color); font-weight: bold; font-size: 0.85rem; }
        h3 { margin: 0.5rem 0 0.8rem; }
        p { opacity: 0.8; margin-bottom: 1rem; line-height: 1.5; }
        .read-more { font-weight: bold; color: var(--accent-color); }
      }
    }

    @media (max-width: 992px) {
      .features { grid-template-columns: 1fr; }
      .post-grid { grid-template-columns: 1fr; }
      .slide-content h1 { font-size: 2rem; }
    }

    .history-teaser {
      margin-top: 5rem;
      display: flex;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      overflow: hidden;
      min-height: 400px;
      
      .teaser-content {
        flex: 1;
        padding: 4rem;
        display: flex;
        flex-direction: column;
        justify-content: center;
        h2 { color: var(--accent-color); font-size: 2.5rem; margin-bottom: 1.5rem; }
        p { font-size: 1.2rem; margin-bottom: 2rem; opacity: 0.8; }
      }
      
      .teaser-image {
        flex: 1;
        background-size: cover;
        background-position: center;
      }

      .teaser-actions {
        display: flex;
        gap: 1.5rem;
      }
      
      .cta-button.outline {
        background: transparent;
        border: 2px solid var(--accent-color);
        color: var(--accent-color);
        &:hover { background: var(--accent-color); color: var(--primary-color); }
      }
    }

    @media (max-width: 768px) {
      .history-teaser {
        flex-direction: column-reverse;
        .teaser-image { height: 300px; }
        .teaser-content { padding: 2rem; }
        .teaser-actions { flex-direction: column; }
      }
    }
  `]
})
export class Home implements OnInit {
  private contentService = inject(ContentService);
  private seoService = inject(SEOService);
  currentSlide = signal(0);
  latestPosts: BlogPost[] = [];

  slides: CarouselItem[] = [
    {
      title: '2026 — The Voyage Starts',
      subtitle: 'Nieuwpoort to Genoa: The beginning of the Mediterranean chapter.',
      image: '/images/hero/stmalo_bg.jpg',
      linkText: 'Explore Timeline',
      link: '/timeline'
    },
    {
      title: '2028 — The Azores Mission',
      subtitle: 'A final blue-water tryout before the big adventure.',
      image: '/images/hero/azores.jpeg',
      linkText: 'Meet the Crew',
      link: '/crew'
    },
    {
      title: '2030 — The World Trip',
      subtitle: 'Finally, off into the big blue for our world trip adventure.',
      image: '/images/hero/caribbean.jpg',
      linkText: 'Making Of',
      link: '/making-of'
    }
  ];

  ngOnInit() {
    this.seoService.updateTags({
      description: 'Sailing Yacht Florentine — Blue-water cruising adventure of a Belgian family and their Shiba Inu Kuro. Follow our world trip under the Swiss flag.',
      keywords: ['blue water cruising', 'sailing world trip', 'living aboard', 'Shiba Inu on board', 'Belgian sailors', 'Swiss flag']
    });
    setInterval(() => this.nextSlide(), 6000);
    this.contentService.getBlogPosts().subscribe(posts => {
      this.latestPosts = posts.slice(0, 2);
    });
  }

  nextSlide() {
    this.currentSlide.update(v => (v + 1) % this.slides.length);
  }

  prevSlide() {
    this.currentSlide.update(v => (v - 1 + this.slides.length) % this.slides.length);
  }

  setSlide(index: number) {
    this.currentSlide.set(index);
  }
}
