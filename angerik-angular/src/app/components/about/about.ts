import { Component, signal, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { ContentService } from '../../services/content';

@Component({
    selector: 'app-about',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './about.html',
    styleUrl: './about.scss'
})
export class About {
    content = signal('');
    private contentService = inject(ContentService);
    private seoService = inject(SeoService);

    constructor() {
        this.seoService.updateTitle('About Our Journey');
        this.seoService.updateMeta('Learn about Brauerei Angerik, our history in brewing tradition, and our unique approach to artisanal Belgian beer in the Pajottenland region.');
    }
}
