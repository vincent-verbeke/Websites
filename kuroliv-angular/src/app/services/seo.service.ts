import { Injectable } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';

@Injectable({
    providedIn: 'root'
})
export class SeoService {
    constructor(private titleService: Title, private metaService: Meta) { }

    updateTitle(title: string) {
        this.titleService.setTitle(`${title} | KuroLIV GmbH`);
    }

    updateMeta(description: string, keywords: string = '') {
        this.metaService.updateTag({ name: 'description', content: description });
        if (keywords) {
            this.metaService.updateTag({ name: 'keywords', content: keywords });
        }
    }
}
