import { Component } from '@angular/core';
import { HeroSectionComponent } from '../../components/hero-section/hero-section';
import { ApplicationGridComponent } from '../../features/applications/application-grid';
import { RoiCalculatorComponent } from '../../features/roi-calculator/roi-calculator';
import { ReadinessAssessmentComponent } from '../../features/readiness-assessment/readiness-assessment';
import { TechnologyOverviewComponent } from '../../features/technology/technology-overview';
import { AboutSectionComponent } from '../../components/about-section/about-section';
import { ContactSectionComponent } from '../../components/contact-section/contact-section';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [
    HeroSectionComponent,
    ApplicationGridComponent,
    RoiCalculatorComponent,
    ReadinessAssessmentComponent,
    TechnologyOverviewComponent,
    AboutSectionComponent,
    ContactSectionComponent
  ],
  template: `
    <app-hero-section></app-hero-section>
    <app-application-grid></app-application-grid>
    <app-roi-calculator></app-roi-calculator>
    <app-readiness-assessment></app-readiness-assessment>
    <app-technology-overview></app-technology-overview>
    <app-about-section></app-about-section>
    <app-contact-section></app-contact-section>
  `
})
export class HomePageComponent {}
