import { Component, OnInit, signal } from '@angular/core';
import { ContentService } from '../../services/content';
import { Router } from '@angular/router';

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [],
  templateUrl: './services.html',
  styleUrl: './services.scss'
})
export class Services implements OnInit {
  departments = signal<string[]>([]);

  constructor(private contentService: ContentService, private router: Router) { }

  ngOnInit() {
    this.contentService.getStructure().subscribe(items => {
      const uniqueDepts = [...new Set(items.map(i => i.Department))];
      const depts: string[] = [];
      items.forEach(i => {
        if (!depts.includes(i.Department)) {
          depts.push(i.Department);
        }
      });
      this.departments.set(depts.filter(d => d !== 'Home'));
    });
  }

  navigateToDepartment(dept: string) {
    this.router.navigate(['/service', dept]);
  }

  getDepartmentTitle(dept: string): string {
    if (dept === 'About') return 'About Us';
    if (dept === 'Beer') return 'Our Beer Range';
    if (dept === 'Tasting') return 'Tasting Experience';
    if (dept === 'Contact') return 'Contact';
    return dept;
  }

  getDepartmentDescription(dept: string): string {
    if (dept === 'About') return 'Learn about our history, tradition, and the story behind Brauerei Angerik.';
    if (dept === 'Beer') return 'Discover our artisanal beers including Dilleke, Record, Lambiek, and Cuvée Kluysbosch.';
    if (dept === 'Tasting') return 'Visit our brewery and enjoy tastings every Saturday from 12:00 to 19:00.';
    if (dept === 'Contact') return 'Get in touch with us for brewery visits, beer orders, and inquiries.';
    return '';
  }
}
