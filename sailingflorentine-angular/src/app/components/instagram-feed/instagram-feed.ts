import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';

interface InstaPhoto {
  id: string;
  mediaUrl: string;
  permalink: string;
  caption?: string;
}

@Component({
  selector: 'app-instagram-feed',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="instagram-section">
      <div class="insta-header">
        <h2 class="premium-title">📸 On the Horizon</h2>
        <a href="https://www.instagram.com/kuro211018/" target="_blank" class="insta-handle">
          &#64;kuro211018
        </a>
      </div>
      
      <div class="insta-grid">
        @for (photo of photos(); track photo.id) {
          <a class="insta-item" [href]="photo.permalink" target="_blank">
            <div class="img-wrapper">
              <img [src]="photo.mediaUrl" [alt]="photo.caption || 'Instagram photo'" loading="lazy">
            </div>
            <div class="overlay">
              <span class="icon">📷</span>
              <span class="text">View Post</span>
            </div>
          </a>
        } @empty {
          <!-- Fallback Placeholders with loading animation -->
          @for (p of placeholders; track $index) {
            <div class="insta-item loading">
              <div class="skeleton"></div>
            </div>
          }
        }
      </div>

      <div class="insta-cta">
        <a href="https://www.instagram.com/kuro211018/" target="_blank" class="follow-btn">
          Follow our Adventures on Instagram
        </a>
      </div>
    </div>
  `,
  styles: [`
    .instagram-section {
      padding: 6rem 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .premium-title {
      font-size: 3.5rem;
      font-weight: 800;
      color: var(--accent-color);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: -1px;
    }

    .insta-header {
      text-align: center;
      margin-bottom: 4rem;
      .insta-handle {
        font-size: 1.5rem;
        color: var(--secondary-color);
        font-weight: 600;
        text-decoration: none;
        transition: color 0.3s;
        &:hover { color: var(--accent-color); }
      }
    }

    .insta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.5rem;
    }

    .insta-item {
      position: relative;
      aspect-ratio: 1/1;
      overflow: hidden;
      border-radius: 12px;
      display: block;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);

      .img-wrapper {
        width: 100%;
        height: 100%;
        transition: transform 0.6s ease;
      }

      img { 
        width: 100%; 
        height: 100%; 
        object-fit: cover; 
      }

      .overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 31, 63, 0.8);
        backdrop-filter: blur(4px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s;
        .icon { font-size: 2rem; margin-bottom: 0.5rem; }
        .text { color: white; font-weight: bold; font-size: 0.9rem; letter-spacing: 1px; }
      }

      &:hover {
        transform: translateY(-10px) scale(1.02);
        box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
        .img-wrapper { transform: scale(1.1); }
        .overlay { opacity: 1; }
      }
    }

    .skeleton {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
      background-size: 200% 100%;
      animation: loading 1.5s infinite;
    }

    @keyframes loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .insta-cta {
      text-align: center;
      margin-top: 5rem;
      .follow-btn {
        display: inline-block;
        background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
        color: white;
        padding: 1.2rem 3.5rem;
        border-radius: 50px;
        font-weight: 800;
        font-size: 1.2rem;
        text-decoration: none;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        box-shadow: 0 10px 30px rgba(188, 24, 136, 0.3);
        &:hover {
          transform: translateY(-5px) scale(1.05);
          box-shadow: 0 20px 40px rgba(188, 24, 136, 0.5);
        }
      }
    }

    @media (max-width: 992px) {
      .insta-grid { grid-template-columns: repeat(2, 1fr); }
      .premium-title { font-size: 2.5rem; }
    }
  `]
})
export class InstagramFeed implements OnInit {
  private http = inject(HttpClient);

  // NOTE: Provide your Behold.so JSON URL here to see real photos.
  // It's free and takes 2 minutes to set up.
  private FEED_URL = '';

  photos = signal<InstaPhoto[]>([]);
  placeholders = new Array(8);

  ngOnInit() {
    if (this.FEED_URL) {
      this.http.get<InstaPhoto[]>(this.FEED_URL).pipe(
        catchError(() => of([]))
      ).subscribe(data => {
        this.photos.set(data.slice(0, 8));
      });
    } else {
      // Create mock rotating real photos if URL is empty for demo/wow factor
      this.photos.set([
        { id: '1', mediaUrl: 'https://picsum.photos/id/1015/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '2', mediaUrl: 'https://picsum.photos/id/1016/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '3', mediaUrl: 'https://picsum.photos/id/1036/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '4', mediaUrl: 'https://picsum.photos/id/1039/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '5', mediaUrl: 'https://picsum.photos/id/1043/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '6', mediaUrl: 'https://picsum.photos/id/1047/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '7', mediaUrl: 'https://picsum.photos/id/1049/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
        { id: '8', mediaUrl: 'https://picsum.photos/id/1053/600/600', permalink: 'https://www.instagram.com/kuro211018/' },
      ]);
    }
  }
}
