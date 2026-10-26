import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ContentService, BlogPost } from '../../services/content';
import { SEOService } from '../../services/seo';

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="blog-page">
      <div class="blog-header">
        <h1>Blog</h1>
        <p>Stories from life aboard SY Florentine</p>
      </div>
      <div class="posts-grid">
        @for (post of posts(); track post.id) {
          <article class="post-card" [routerLink]="['/blog', post.id]">
            <div class="post-hero" [style.background-image]="'url(' + post.heroImage + ')'"></div>
            <div class="post-body">
              <div class="meta">
                <span class="date">{{ post.date }}</span>
                <span class="author">by {{ post.author }}</span>
              </div>
              <h2>{{ post.title }}</h2>
              <p>{{ post.excerpt }}</p>
              <div class="tags">
                @for (tag of post.tags; track tag) {
                  <span class="tag">#{{ tag }}</span>
                }
              </div>
              <a class="read-more">Read More →</a>
            </div>
          </article>
        }
      </div>
    </div>
  `,
  styles: [`
    .blog-page { padding: 2rem; max-width: 1200px; margin: 0 auto; }

    .blog-header {
      text-align: center;
      padding: 3rem 0;
      h1 { font-size: 3rem; color: var(--accent-color); margin-bottom: 0.5rem; }
      p { font-size: 1.2rem; opacity: 0.8; }
    }

    .posts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
      gap: 2.5rem;
    }

    .post-card {
      background: var(--glass-bg);
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.3s, box-shadow 0.3s;
      &:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0,0,0,0.2); }
    }

    .post-hero { height: 250px; background-size: cover; background-position: center; }

    .post-body {
      padding: 2rem;
      .meta { font-size: 0.85rem; opacity: 0.7; margin-bottom: 0.8rem;
        .author { margin-left: 1rem; }
      }
      h2 { font-size: 1.5rem; margin-bottom: 1rem; }
      p { line-height: 1.6; opacity: 0.85; margin-bottom: 1rem; }
    }

    .tags { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .tag {
      background: var(--secondary-color);
      color: white;
      padding: 0.2rem 0.8rem;
      border-radius: 20px;
      font-size: 0.8rem;
    }

    .read-more { font-weight: bold; color: var(--accent-color); }

    @media (max-width: 768px) {
      .posts-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class Blog implements OnInit {
  private contentService = inject(ContentService);
  private seoService = inject(SEOService);
  posts = toSignal(this.contentService.getBlogPosts(), { initialValue: [] as BlogPost[] });

  ngOnInit() {
    this.seoService.updateTags({
      title: 'The Journey Blog',
      description: 'Stories and insights from life aboard SY Florentine. Living the blue-water dream with a Shiba Inu.',
      keywords: ['sailing blog', 'life aboard', 'ocean crossing', 'world trip stories', 'Shiba Inu adventure']
    });
  }
}
