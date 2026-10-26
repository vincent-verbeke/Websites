import { Injectable, inject, PLATFORM_ID, RendererFactory2 } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private title = inject(Title);
  private meta = inject(Meta);
  private platformId = inject(PLATFORM_ID);
  private doc = inject(DOCUMENT);
  private rendererFactory = inject(RendererFactory2);

  updateMeta(config: { title?: string; description?: string; keywords?: string; image?: string; url?: string }) {
    if (config.title) {
      this.title.setTitle(`${config.title} | Kubotics`);
      this.meta.updateTag({ property: 'og:title', content: config.title });
      this.meta.updateTag({ name: 'twitter:title', content: config.title });
    }

    if (config.description) {
      this.meta.updateTag({ name: 'description', content: config.description });
      this.meta.updateTag({ property: 'og:description', content: config.description });
      this.meta.updateTag({ name: 'twitter:description', content: config.description });
    }

    if (config.keywords) {
      this.meta.updateTag({ name: 'keywords', content: config.keywords });
    }

    if (config.image) {
      this.meta.updateTag({ property: 'og:image', content: config.image });
      this.meta.updateTag({ name: 'twitter:image', content: config.image });
    }

    if (config.url) {
      this.meta.updateTag({ property: 'og:url', content: config.url });
    }

    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
  }

  setStructuredData(data: any) {
    const renderer = this.rendererFactory.createRenderer(null, null);
    const script = renderer.createElement('script');
    renderer.setAttribute(script, 'type', 'application/ld+json');
    renderer.setProperty(script, 'text', JSON.stringify(data));
    renderer.appendChild(this.doc.head, script);
  }
}
