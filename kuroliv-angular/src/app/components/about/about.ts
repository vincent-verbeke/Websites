import { Component } from '@angular/core';
import { SeoService } from '../../services/seo.service';

@Component({
    selector: 'app-about',
    standalone: true,
    imports: [],
    templateUrl: './about.html',
    styleUrl: './about.scss'
})
export class About {
    constructor(private seoService: SeoService) {
        this.seoService.updateTitle('About Our Journey');
        this.seoService.updateMeta('Learn about KuroLIV GmbH, our 20+ year journey in IT and HR, and our unique shiba-minded approach to strategic advisory in Switzerland.');
    }
}
