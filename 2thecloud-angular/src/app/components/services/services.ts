import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-services',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="services-container">
      <!-- Cloud Infrastructure Section -->
      <section id="infrastructure" class="service-section">
        <div class="container">
          <h2 class="section-title">Cloud <span class="playful-twist">Infrastructure</span></h2>
          <p class="intro-text">High-level architectural guidance to evolve your infrastructure into a scalable, secure, and performance-optimized cloud environment.</p>
          
          <div class="services-grid">
            <div class="service-card" *ngFor="let s of infraServices" [routerLink]="['/proposition', s.id]">
              <div class="icon">{{s.icon}}</div>
              <h3>{{s.title}}</h3>
              <p>{{s.desc}}</p>
              <span class="learn-more">Explore Proposition →</span>
            </div>
          </div>

          <!-- Added Hybrid Cloud Security section hook -->
          <div id="security" style="height: 1px; margin-top: -100px; position: absolute;"></div>

          <div class="audit-banner">
            <div class="audit-content">
              <h3>Secure your future with a <span class="highlight">Free 2h Audit</span></h3>
              <p>A high-level architectural review of your IT landscape to identify optimization potential.</p>
              <button class="btn btn-primary" [routerLink]="['/contact']" [queryParams]="{consultation: 'true', source: 'infrastructure'}">Request a 2h Audit</button>
            </div>
          </div>
        </div>
      </section>

      <div class="section-divider"></div>

      <!-- App Modernization Section -->
      <section id="modernization" class="service-section alt-bg">
        <div class="container">
          <h2 class="section-title">App <span class="playful-twist">Modernization</span></h2>
          <p class="intro-text">Don't just migrate—rebuild. We transform legacy technical debt into high-performance web assets with zero baggage.</p>
          
          <div class="services-grid">
            <div class="service-card" *ngFor="let s of migrationServices" [routerLink]="['/proposition', s.id]">
              <div class="icon">{{s.icon}}</div>
              <h3>{{s.title}}</h3>
              <p>{{s.desc}}</p>
              <span class="learn-more">Explore Proposition →</span>
            </div>
          </div>

          <div class="audit-banner">
            <div class="audit-content">
              <h3>Modernization Roadmap: <span class="highlight">Free 2h Audit</span></h3>
              <p>Let's analyze your legacy codebase and define a clear path to a modern architecture.</p>
              <button class="btn btn-primary" [routerLink]="['/contact']" [queryParams]="{consultation: 'true', source: 'modernization'}">Request a 2h Audit</button>
            </div>
          </div>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .services-container { background: white; }
    .service-section { padding: 8rem 2rem; }
    .service-section.alt-bg { background: #fcfdfe; }
    
    .container {
      max-width: 1240px;
      margin: 0 auto;
      text-align: center;
    }
    
    .section-title {
      font-size: 3.5rem;
      margin-bottom: 1rem;
    }
    
    .intro-text {
      max-width: 800px;
      margin: 0 auto 4rem;
      font-size: 1.25rem;
      opacity: 0.7;
    }

    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 2.5rem;
      margin-bottom: 5rem;
    }

    .service-card {
      padding: 3rem;
      background: white;
      border-radius: 35px;
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      border: 1px solid #edf2f7;
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0, 168, 255, 0.02);

      &:hover {
        transform: translateY(-10px);
        box-shadow: 0 25px 50px rgba(0, 168, 255, 0.1);
        border-color: var(--primary);
        .learn-more { color: var(--primary); transform: translateX(10px); }
      }

      .icon {
        font-size: 3rem;
        margin-bottom: 1.5rem;
      }

      h3 {
        font-size: 1.5rem;
        margin-bottom: 1rem;
        color: var(--text-light);
      }

      p {
        line-height: 1.6;
        opacity: 0.7;
        margin-bottom: 2rem;
        flex-grow: 1;
      }

      .learn-more {
        font-weight: 700;
        font-size: 0.9rem;
        opacity: 0.8;
        transition: all 0.3s;
      }
    }

    .audit-banner {
      background: #f1f5f9;
      padding: 4.5rem;
      border-radius: 50px;
      text-align: center;
      .highlight { color: var(--primary); }
      h3 { font-size: 2.2rem; margin-bottom: 1rem; }
      p { font-size: 1.2rem; margin-bottom: 2.5rem; opacity: 0.7; }
      
      .btn {
        padding: 1.2rem 2.5rem;
        border-radius: 50px;
        font-weight: 700;
        font-size: 1.1rem;
        cursor: pointer;
        transition: all 0.3s ease;
        border: none;
        white-space: nowrap;
        display: inline-block;
        text-decoration: none;
      }

      .btn-primary {
        background: var(--primary);
        color: white;
        box-shadow: 0 10px 25px rgba(0, 168, 255, 0.3);
        &:hover { transform: translateY(-3px); box-shadow: 0 15px 30px rgba(0, 168, 255, 0.4); }
      }
    }

    .section-divider {
      height: 1px;
      background: linear-gradient(to right, transparent, #edf2f7, transparent);
      width: 80%;
      margin: 0 auto;
    }

    :host-context(body.dark-mode) {
      .services-container { background: var(--bg-dark); }
      .service-section.alt-bg { background: var(--bg-dark-alt); }
      .service-card {
        background: var(--bg-dark-alt);
        border-color: rgba(255,255,255,0.1);
        h3 { color: var(--text-dark); }
        &:hover { border-color: var(--primary); }
      }
      .audit-banner { background: var(--bg-dark-alt); border: 1px solid rgba(255,255,255,0.05); }
      .section-divider { background: linear-gradient(to right, transparent, rgba(255,255,255,0.1), transparent); }
    }

    @media (max-width: 768px) {
      .audit-banner { padding: 2.5rem; }
      .section-title { font-size: 2.5rem; }
    }
  `]
})
export class Services {
  infraServices = [
    {
      id: 'private-cloud',
      icon: '🛡️',
      title: 'Private Cloud',
      desc: 'Exclusive cloud environments for maximum data sovereignty and custom security needs in Switzerland.'
    },
    {
      id: 'public-cloud',
      icon: '🌐',
      title: 'Public Cloud',
      desc: 'Scalable and cost-efficient Azure, AWS, and GCP solutions managed with high-level architectural precision.'
    },
    {
      id: 'hybrid-cloud',
      icon: '⚙️',
      title: 'Hybrid Cloud',
      desc: 'Seamless integration of on-premise infrastructure with high-performance cloud agility.'
    },
    {
      id: 'microsoft-365',
      icon: '🏛️',
      title: 'Microsoft 365',
      desc: 'Enterprise-grade productivity suites fully optimized for high-tier SME security standards.'
    },
    {
      id: 'intune',
      icon: '📱',
      title: 'Cloud Client Mgmt',
      desc: 'Advanced Intune management for all endpoints, ensuring compliant security and zero-touch deployment.'
    },
    {
      id: 'hybrid-security',
      icon: '🔒',
      title: 'Hybrid Cloud Security',
      desc: 'Architecture-first security strategy for integrated on-premise and cloud environments, focused on Swiss compliance.'
    }
  ];

  migrationServices = [
    {
      id: 'app-rebuild',
      icon: '💎',
      title: 'Application Rebuilding',
      desc: 'Transform legacy technical debt into reactive, high-performance web applications using modern stacks.'
    },
    {
      id: 'data-modernization',
      icon: '📊',
      title: 'Data Modernization',
      desc: 'Migrate on-premise databases to cloud-native storage with zero downtime and improved accessibility.'
    },
    {
      id: 'devops-adoption',
      icon: '🚀',
      title: 'Modern DevOps Adoption',
      desc: 'Establish CI/CD pipelines and automated testing as part of your application rebuild journey.'
    }
  ];
}
