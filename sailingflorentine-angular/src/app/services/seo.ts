import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';

@Injectable({
    providedIn: 'root'
})
export class SEOService {
    private titleService = inject(Title);
    private metaService = inject(Meta);

    private readonly siteTitle = 'Sailing Yacht Florentine';

    updateTags(config: {
        title?: string;
        description?: string;
        image?: string;
        keywords?: string[];
    }) {
        const fullTitle = config.title ? `${config.title} | ${this.siteTitle}` : this.siteTitle;
        this.titleService.setTitle(fullTitle);

        if (config.description) {
            this.metaService.updateTag({ name: 'description', content: config.description });
            this.metaService.updateTag({ property: 'og:description', content: config.description });
            this.metaService.updateTag({ name: 'twitter:description', content: config.description });
        }

        this.metaService.updateTag({ property: 'og:title', content: fullTitle });
        this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });

        if (config.image) {
            const imageUrl = config.image.startsWith('http') ? config.image : `${window.location.origin}${config.image}`;
            this.metaService.updateTag({ property: 'og:image', content: imageUrl });
            this.metaService.updateTag({ name: 'twitter:image', content: imageUrl });
        }

        if (config.keywords) {
            this.metaService.updateTag({ name: 'keywords', content: config.keywords.join(', ') });
        }
    }
}
