import { Component, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ContentService, ContentItem } from '../../services/content';
import { CommonModule } from '@angular/common';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-department',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './department.html',
  styleUrl: './department.scss'
})
export class Department implements OnInit {
  departmentId = signal<string>('');
  activities = signal<string[]>([]);
  activeActivity = signal<string>('');
  content = signal<string>('');

  hasConsultationOffer = computed(() => {
    const dept = this.departmentId();
    return ['Beer', 'Tasting'].includes(dept);
  });

  constructor(
    private route: ActivatedRoute,
    private contentService: ContentService,
    private seoService: SeoService
  ) { }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.departmentId.set(id);
        this.loadActivities(id);
      }
    });
  }

  loadActivities(dept: string) {
    this.contentService.getStructure().subscribe(items => {
      const deptItems = items.filter(i => i.Department === dept);
      const acts = deptItems.map(i => i.Activity);
      this.activities.set(acts);

      if (acts.length > 0) {
        this.selectActivity(acts[0]);
      }
    });
  }

  selectActivity(activity: string) {
    this.activeActivity.set(activity);
    this.contentService.getContent(this.departmentId(), activity).subscribe(html => {
      this.content.set(html);
      const deptName = this.departmentId();
      this.seoService.updateTitle(`${deptName} - ${activity}`);
      this.seoService.updateMeta(`Explore ${deptName} ${activity} at Brauerei Angerik. Artisanal Belgian beer from Dilbeek.`);
    });
  }
}
