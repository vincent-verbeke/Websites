import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

@Component({
    selector: 'app-hero',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './hero.html',
    styleUrl: './hero.scss'
})
export class Hero {
    constructor(private seoService: SeoService) {
        this.seoService.updateTitle('Brauerei Angerik - Artisanal Belgian Beer');
        this.seoService.updateMeta('Brouwerij Angerik - Artisanaal bier in het Pajottenland. Artisanal Belgian beer brewed in Dilbeek, gateway to the Pajottenland region.');
    }
}
