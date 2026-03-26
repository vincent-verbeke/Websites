import { Component, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { ContentService } from '../../services/content';
import { SEOService } from '../../services/seo';

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    @if (post(); as post) {
      <article class="blog-post-page">
        <div class="hero" [style.background-image]="'linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url(' + post.heroImage + ')'">
          <div class="hero-content">
            <a routerLink="/blog" class="back">← All Posts</a>
            <h1>{{ post.title }}</h1>
            <div class="meta">
              <span>{{ post.date }}</span>
              <span>by {{ post.author }}</span>
            </div>
          </div>
        </div>
        <div class="content">
          @for (block of post.content; track $index) {
            @if (block.type === 'heading') {
              <h2>{{ block.text }}</h2>
            }
            @if (block.type === 'paragraph') {
              <p>{{ block.text }}</p>
            }
            @if (block.type === 'image') {
              <figure>
                <img [src]="block.src" [alt]="block.caption || ''" loading="lazy">
                @if (block.caption) {
                  <figcaption>{{ block.caption }}</figcaption>
                }
              </figure>
            }
          }

          @if (post.id === 'our-boat-jeanneau-sun-odyssey-42ds') {
            <div class="post-cta">
              <a routerLink="/boat" class="cta-link">Read more in the details →</a>
            </div>
          }
        </div>
      </article>
    }
  `,
  styles: [`
    .hero {
      height: 50vh;
      background-size: cover;
      background-position: center;
      display: flex;
      align-items: flex-end;
      padding: 3rem;
    }

    .hero-content {
      max-width: 800px;
      color: white;
      .back {
        color: var(--accent-color);
        font-weight: bold;
        margin-bottom: 1rem;
        display: inline-block;
      }
      h1 { font-size: 3rem; margin: 0.5rem 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
      .meta { opacity: 0.9; span { margin-right: 1.5rem; } }
    }

    .content {
      max-width: 800px;
      margin: 3rem auto;
      padding: 0 2rem;
      line-height: 1.8;

      h2 {
        color: var(--accent-color);
        margin-top: 2.5rem;
        margin-bottom: 1rem;
        font-size: 1.8rem;
      }

      p { margin-bottom: 1.5rem; font-size: 1.1rem; }

      figure {
        margin: 2rem 0;
        img {
          width: 100%;
          border-radius: 8px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        figcaption {
          text-align: center;
          margin-top: 0.8rem;
          font-style: italic;
          opacity: 0.7;
          color: var(--card-text);
        }
      }

      .post-cta {
        margin-top: 4rem;
        padding-top: 2rem;
        border-top: 1px solid var(--glass-border);
        text-align: center;
        
        .cta-link {
          display: inline-block;
          padding: 1rem 2rem;
          background: var(--secondary-color);
          color: white;
          border-radius: 8px;
          font-weight: bold;
          text-decoration: none;
          transition: background 0.3s, transform 0.2s;
          
          &:hover { 
            background: #005bb5; 
            transform: translateY(-2px);
          }
        }
      }
    }
  `]
})
export class BlogPostComponent {
  private contentService = inject(ContentService);
  private route = inject(ActivatedRoute);
  private seoService = inject(SEOService);

  post = toSignal(this.route.paramMap.pipe(
    switchMap(params => this.contentService.getBlogPost(params.get('id')!))
  ));

  constructor() {
    effect(() => {
      const postData = this.post();
      if (postData) {
        this.seoService.updateTags({
          title: postData.title,
          description: postData.excerpt,
          image: postData.heroImage,
          keywords: [...postData.tags, 'sailing blog', 'ocean journey', 'SY Florentine']
        });
      }
    });
  }
}
