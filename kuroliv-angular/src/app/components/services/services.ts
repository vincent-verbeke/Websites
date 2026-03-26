import { Component, OnInit, signal } from '@angular/core';
import { ContentService } from '../../services/content'; // Adjust import path
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
      // Keep order or prioritize? JSON order should be preserved.
      // Filter out duplicates preserving first occurrence order.
      const depts: string[] = [];
      items.forEach(i => {
        if (!depts.includes(i.Department)) {
          depts.push(i.Department);
        }
      });
      this.departments.set(depts.filter(d => d !== 'Passions' && d !== 'Kuro'));
    });
  }

  navigateToDepartment(dept: string) {
    this.router.navigate(['/service', dept]);
  }

  getDepartmentTitle(dept: string): string {
    if (dept === 'Management') return 'CEO/CIO/CTO As A Service';
    if (dept === 'HR') return 'HR Services';
    if (dept === 'IT') return 'IT Services';
    return dept; // Fallback (e.g. Pleasure)
  }

  getDepartmentDescription(dept: string): string {
    // Hardcoded descriptions for now as they aren't in JSON
    if (dept === 'Management') return 'Experienced executive leadership on demand. Strategic planning, technology roadmap execution, and organizational transformation.';
    if (dept === 'HR') return 'Comprehensive human resources solutions, from talent acquisition to performance management and cultural development.';
    if (dept === 'IT') return 'Full-spectrum IT delivery, including software development, infrastructure management, and cloud migration strategies.';
    if (dept === 'Passions') return 'Discover our other passions and activities.';
    return '';
  }
}
