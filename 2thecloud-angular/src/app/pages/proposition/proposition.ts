import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

interface PropositionDetail {
  id: string;
  icon: string;
  title: string;
  tagline: string;
  description: string;
  points: string[];
}

@Component({
  selector: 'app-proposition',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="proposition-page" *ngIf="proposition()">
      <div class="container">
        <button class="btn-back" routerLink="/services">← Back to Services</button>
        
        <div class="header-section">
          <div class="icon">{{ proposition()?.icon }}</div>
          <h1>{{ proposition()?.title }}</h1>
          <p class="tagline">{{ proposition()?.tagline }}</p>
        </div>

        <div class="content-grid">
          <div class="main-content">
            <h2>The Proposition</h2>
            <p class="description">{{ proposition()?.description }}</p>
            
            <div class="points-grid">
              <div class="point-card" *ngFor="let point of proposition()?.points">
                <span class="checkmark">✓</span>
                <p>{{ point }}</p>
              </div>
            </div>
          </div>

          <aside class="cta-sidebar">
            <div class="cta-card">
              <h3>Interested in this?</h3>
              <p>Let's discuss how this fits your specific architectural needs.</p>
              <button class="btn btn-primary" [routerLink]="['/contact']" [queryParams]="{subject: proposition()?.title, consultation: 'true'}">Book an Audit</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .proposition-page {
      padding: 10rem 2rem 6rem;
      background: var(--bg-light);
      min-height: 100vh;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
    }

    .btn-back {
      background: none;
      border: none;
      color: var(--primary);
      font-weight: 700;
      cursor: pointer;
      margin-bottom: 3rem;
      font-size: 1rem;
      padding: 0;
      transition: transform 0.2s;
      &:hover { transform: translateX(-5px); }
    }

    .header-section {
      text-align: center;
      margin-bottom: 5rem;
      .icon { font-size: 4.5rem; margin-bottom: 1.5rem; }
      h1 { font-size: 4rem; margin-bottom: 1rem; line-height: 1.1; }
      .tagline { font-size: 1.5rem; opacity: 0.6; font-weight: 600; }
    }

    .content-grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 5rem;
      
      @media (max-width: 968px) {
        grid-template-columns: 1fr;
        gap: 3rem;
      }
    }

    .main-content {
      h2 { font-size: 2rem; margin-bottom: 2rem; }
      .description { font-size: 1.25rem; line-height: 1.6; opacity: 0.8; margin-bottom: 3rem; }
    }

    .points-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
    }

    .point-card {
      padding: 1.5rem;
      background: white;
      border-radius: 20px;
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      box-shadow: 0 10px 30px rgba(0,168,255,0.03);
      .checkmark { color: var(--accent); font-weight: 900; }
      p { margin: 0; font-weight: 500; opacity: 0.9; }
    }

    .cta-sidebar {
      .cta-card {
        padding: 3rem;
        background: var(--gradient);
        color: white;
        border-radius: 40px;
        position: sticky;
        top: 120px;
        text-align: center;
        h3 { font-size: 1.8rem; margin-bottom: 1rem; color: white; }
        p { margin-bottom: 2rem; opacity: 0.9; line-height: 1.5; }
        .btn-primary { 
          width: 100%; 
          background: white; 
          color: var(--primary); 
          border: none;
          padding: 1.2rem;
          border-radius: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s;
          &:hover { transform: scale(1.05); }
        }
      }
    }

    :host-context(body.dark-mode) {
      .proposition-page { background: var(--bg-dark); }
      .point-card { background: var(--bg-dark-alt); border: 1px solid rgba(255,255,255,0.1); }
      h2 { color: var(--text-dark); }
    }
  `]
})
export class Proposition implements OnInit {
  private route = inject(ActivatedRoute);
  proposition = signal<PropositionDetail | null>(null);

  private data: PropositionDetail[] = [
    {
      id: 'hybrid-security',
      icon: '🔒',
      title: 'Hybrid Cloud Security',
      tagline: 'Zero Trust. Full Sovereignty.',
      description: 'Our Hybrid Cloud Security proposition ensures a unified, high-tier security posture across both your on-premise assets and your cloud environments, strictly aligned with Swiss data standards.',
      points: [
        'Unified Identity & Access Management (IAM)',
        'Zero-Trust networking across hybrid links',
        'Swiss Compliance & Regulatory hardening',
        'Advanced Threat Detection for inter-infra traffic',
        'Continuous Cloud-native compliance monitoring'
      ]
    },
    {
      id: 'private-cloud',
      icon: '🛡️',
      title: 'Private Cloud',
      tagline: 'Total Control. Ultimate Sovereignty.',
      description: 'Our Private Cloud proposition provides dedicated infrastructure housed in Tier-IV Swiss data centers. Designed for organizations with the most stringent regulatory and performance requirements.',
      points: [
        'Full control over hardware & virtualization layer',
        'Swiss Data Sovereignty compliance',
        'Isolation from public internet/multitenancy risks',
        'Zero-latency inter-service communication',
        'Integrated Managed Backup & Recovery'
      ]
    },
    {
      id: 'public-cloud',
      icon: '🌐',
      title: 'Public Cloud',
      tagline: 'Infinite Scale. Expert Governance.',
      description: 'Maximize the potential of Azure, AWS, or GCP. We don\'t just deploy; we engineer high-performance, cost-efficient environments with specialized Swiss precision.',
      points: [
        'Cost optimization & FinOps strategies',
        'IAM & Advanced Security Governance',
        'Auto-scaling & Resilience architecture',
        'Cross-region high availability',
        'Native Cloud Security implementation'
      ]
    },
    {
      id: 'hybrid-cloud',
      icon: '⚙️',
      title: 'Hybrid Cloud',
      tagline: 'The Best of Both Worlds.',
      description: 'Bridge the gap between your on-premise legacy systems and modern cloud agility. Our Hybrid solutions ensure seamless data flow and centralized management.',
      points: [
        'Unified management plane',
        'DirectConnect & ExpressRoute specialized setup',
        'Burst-to-cloud capacity planning',
        'Legacy-to-Cloud data synchronization',
        'Security-first network bridging'
      ]
    },
    {
      id: 'microsoft-365',
      icon: '🏛️',
      title: 'Microsoft 365',
      tagline: 'Modern Work. Enterprise Security.',
      description: 'Transform your productivity suite into a secure innovation hub. We specialize in M365 governance, security hardening, and adoption for high-tier SMEs.',
      points: [
        'Tenant hardening & Secure Score optimization',
        'Information protection (DLP/AIP)',
        'Teams governance & compliant external chat',
        'Automated user lifecycle management',
        'Cloud-native email security (Defender)'
      ]
    },
    {
      id: 'intune',
      icon: '📱',
      title: 'Cloud Client Mgmt',
      tagline: 'Endpoints. Decoupled & Secured.',
      description: 'Manage your entire device landscape with Microsoft Intune. From zero-touch deployment via Autopilot to continuous compliance monitoring.',
      points: [
        'Zero-Touch Autopilot deployment',
        'Granular Conditional Access policies',
        'Mobile Application Management (MAM)',
        'Continuous patch & security monitoring',
        'Automated software distribution'
      ]
    },
    {
      id: 'app-rebuild',
      icon: '💎',
      title: 'Application Rebuilding',
      tagline: 'De-Legacy your Enterprise.',
      description: 'Technical debt is the weight holding your innovation back. We rebuild legacy applications into modern, reactive web assets with zero baggage and high performance.',
      points: [
        'Migration to modern web stacks (Angular/React)',
        'Zero-Latency API-driven architecture',
        'Cloud-native performance scaling',
        'Enterprise feature parity ensured',
        'Modern UI/UX for legacy workflows'
      ]
    },
    {
      id: 'data-modernization',
      icon: '📊',
      title: 'Data Modernization',
      tagline: 'Insights at Cloud Speed.',
      description: 'Migrate your silos to modern, accessible cloud data platforms. We ensure your data is ready for the next generation of analytics and AI.',
      points: [
        'Silo-to-Cloud migration strategy',
        'NoSQL & Serverless DB implementation',
        'High-availability data clustering',
        'Swiss-grade data encryption',
        'Data Accessibility optimization'
      ]
    },
    {
      id: 'devops-adoption',
      icon: '🚀',
      title: 'Modern DevOps',
      tagline: 'Velocity. Automated.',
      description: 'Modern infrastructure requires modern workflows. We build integrated CI/CD pipelines and automated testing to ensure your cloud journey is stable and fast.',
      points: [
        'Automated CI/CD pipelines',
        'Infrastructure as Code (Terraform/Bicep)',
        'Automated Security scanning (DevSecOps)',
        'Containerization (Docker/K8s)',
        'Real-time observability setup'
      ]
    }
  ];

  ngOnInit() {
    this.route.params.subscribe(params => {
      const id = params['id'];
      const prop = this.data.find(p => p.id === id);
      this.proposition.set(prop || null);
    });
  }
}
