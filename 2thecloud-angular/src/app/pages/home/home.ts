import { Component } from '@angular/core';
import { Hero } from '../../components/hero/hero';
import { Services } from '../../components/services/services';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [Hero, Services],
    template: `
    <app-hero></app-hero>
    <app-services></app-services>
  `
})
export class Home { }
