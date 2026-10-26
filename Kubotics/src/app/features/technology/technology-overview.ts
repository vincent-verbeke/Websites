import { Component, inject, OnInit, signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n';
import { ChannelLinkService } from '../../core/services/channel-link.service';
import { LeadAgentService } from '../lead-agent/lead-agent.service';

@Component({
  selector: 'app-technology-overview',
  standalone: true,
  template: `
    <section id="technology" class="tech-overview">
      <div class="container">
        <div class="section-badge">{{ i18n.t('NAV.TECH') }}</div>
        <h2 class="title-huge">Robotic <br> Evolution.</h2>
        
        <div class="tech-intro animate-fade-in">
          <p>At Kubotics, we believe the future of robotics lies in <strong>meaningful interaction</strong>. Our systems are engineered not just for task execution, but for seamless cooperation—bridging the gap between human intuition and machine precision, while enabling advanced robot-to-robot coordination for the next generation of industrial intelligence.</p>
        </div>
        
        <div class="showcase-stack">
          <!-- H2 Humanoid -->
          <div class="showcase-item">
            <div class="showcase-content">
              <h3>{{ i18n.t('TECH.H2_TITLE') }}</h3>
              <p>{{ i18n.t('TECH.H2_DESC') }}</p>
              <div class="spec-list">
                <div class="spec"><span>Height</span><span>1.8m</span></div>
                <div class="spec"><span>DOF</span><span>31</span></div>
                <div class="spec"><span>Torque</span><span>360Nm</span></div>
              </div>
              <div class="cta-wrapper">
                <button type="button" class="btn-cta-accent" (click)="openH2Booking()">{{ i18n.t('TECH.H2_CTA') }}</button>
                <div class="quick-channels">
                  <a [href]="channelLinks.getWhatsAppLink('h2_testday')" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     class="btn-channel-mini wa"
                     title="WhatsApp Inquiry for H2">
                    <span>💬 WhatsApp</span>
                  </a>
                  <a [href]="channelLinks.getTelegramLink('h2_testday')" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     class="btn-channel-mini tg"
                     title="Telegram Inquiry for H2">
                    <span>🎙️ Telegram</span>
                  </a>
                </div>
              </div>
            </div>
            <div class="showcase-visual glass">
              <video src="robots/h2-video.mp4" autoplay [muted]="true" loop playsinline poster="robots/h2-hero.jpg"></video>
            </div>
          </div>

          <!-- G1-D Interaction (Rotating Gallery) -->
          <div class="showcase-item reverse">
            <div class="showcase-content">
              <h3>{{ i18n.t('TECH.G1_TITLE') }}</h3>
              <p>{{ i18n.t('TECH.G1_DESC') }}</p>
              <div class="spec-list">
                <div class="spec"><span>Intelligence</span><span>GROOT</span></div>
                <div class="spec"><span>Learning</span><span>PI 0.5</span></div>
                <div class="spec"><span>Sync</span><span>Unified API</span></div>
              </div>
              <div class="cta-wrapper">
                <div class="quick-channels">
                  <a [href]="channelLinks.getWhatsAppLink('g1_robotics')" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     class="btn-channel-mini wa">
                    <span>💬 WhatsApp</span>
                  </a>
                  <a [href]="channelLinks.getTelegramLink('g1_robotics')" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     class="btn-channel-mini tg">
                    <span>🎙️ Telegram</span>
                  </a>
                </div>
              </div>
            </div>
            <div class="showcase-visual glass">
              <div class="gallery-container">
                @for (img of g1Images; track img; let i = $index) {
                  <img [src]="img" 
                       [class.active]="currentImageIndex() === i"
                       class="gallery-img" 
                       alt="Unitree G1-D">
                }
              </div>
            </div>
          </div>

          <!-- B2 Inspection -->
          <div class="showcase-item">
            <div class="showcase-content">
              <h3>{{ i18n.t('TECH.QUAD_TITLE') }}</h3>
              <p>{{ i18n.t('TECH.QUAD_DESC') }}</p>
              <div class="spec-list">
                <div class="spec"><span>Rating</span><span>IP67</span></div>
                <div class="spec"><span>Speed</span><span>6m/s</span></div>
                <div class="spec"><span>Payload</span><span>40kg</span></div>
              </div>
              <div class="cta-wrapper">
                <div class="quick-channels">
                  <a [href]="channelLinks.getWhatsAppLink('b2_quadruped')" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     class="btn-channel-mini wa">
                    <span>💬 WhatsApp</span>
                  </a>
                  <a [href]="channelLinks.getTelegramLink('b2_quadruped')" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     class="btn-channel-mini tg">
                    <span>🎙️ Telegram</span>
                  </a>
                </div>
              </div>
            </div>
            <div class="showcase-visual glass">
              <video src="robots/inspection-video.mp4" autoplay [muted]="true" loop playsinline poster="robots/inspection-hero.jpg"></video>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: `
    .tech-overview {
      padding: 240px 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      background: #0a0a0a;
    }

    .section-badge {
      color: var(--color-accent);
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      margin-bottom: 24px;
    }

    .tech-intro {
      max-width: 800px;
      margin-top: 40px;
      margin-bottom: 80px;
    }

    .tech-intro p {
      font-size: 1.4rem;
      color: var(--color-secondary);
      line-height: 1.6;
    }

    .tech-intro strong {
      color: white;
    }

    .showcase-stack {
      margin-top: 100px;
      display: flex;
      flex-direction: column;
      gap: 160px;
    }

    .showcase-item {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 80px;
      align-items: center;
    }

    .showcase-item.reverse {
      grid-template-columns: 1.2fr 1fr;
    }

    .showcase-item.reverse .showcase-content {
      order: 2;
    }

    .showcase-item.reverse .showcase-visual {
      order: 1;
    }

    @media (max-width: 992px) {
      .showcase-item, .showcase-item.reverse {
        grid-template-columns: 1fr;
        gap: 40px;
      }
      .showcase-item.reverse .showcase-content {
        order: 1;
      }
      .showcase-item.reverse .showcase-visual {
        order: 2;
      }
    }

    .showcase-content h3 {
      font-size: 2.5rem;
      margin-bottom: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .showcase-content p {
      color: #888;
      font-size: 1.1rem;
      line-height: 1.6;
      margin-bottom: 40px;
    }

    .spec-list {
      display: flex;
      gap: 32px;
      border-top: 1px solid rgba(255,255,255,0.05);
      padding-top: 32px;
    }

    .spec {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .spec span:first-child {
      font-family: 'Space Mono', monospace;
      font-size: 0.7rem;
      color: #555;
    }

    .spec span:last-child {
      font-size: 1.2rem;
      font-weight: 500;
      color: var(--color-accent);
    }

    .showcase-visual {
      border-radius: 24px;
      overflow: hidden;
      aspect-ratio: 16/9;
      position: relative;
    }

    .showcase-visual video, .showcase-visual img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .gallery-container {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .gallery-img {
      position: absolute;
      top: 0;
      left: 0;
      opacity: 0;
      transition: opacity 1s ease-in-out;
    }

    .gallery-img.active {
      opacity: 1;
    }

    .cta-wrapper {
      margin-top: 40px;
    }

    .quick-channels {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }

    .btn-channel-mini {
      display: inline-flex;
      align-items: center;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s ease;
      font-family: 'Space Mono', monospace;
    }

    .btn-channel-mini.wa {
      background: rgba(37, 211, 102, 0.12);
      color: #25d366;
      border: 1px solid rgba(37, 211, 102, 0.3);
    }

    .btn-channel-mini.wa:hover {
      background: rgba(37, 211, 102, 0.25);
      border-color: #25d366;
      transform: translateY(-1px);
    }

    .btn-channel-mini.tg {
      background: rgba(0, 136, 204, 0.12);
      color: #229ed9;
      border: 1px solid rgba(0, 136, 204, 0.3);
    }

    .btn-channel-mini.tg:hover {
      background: rgba(0, 136, 204, 0.25);
      border-color: #0088cc;
      transform: translateY(-1px);
    }

    .btn-cta-accent {
      display: inline-block;
      padding: 14px 28px;
      background: linear-gradient(135deg, #0071e3 0%, #00c6ff 100%);
      color: white;
      text-decoration: none;
      border-radius: 100px;
      font-weight: 600;
      font-size: 0.9rem;
      transition: all 0.3s ease;
      box-shadow: 0 10px 20px rgba(0, 113, 227, 0.2);
    }

    .btn-cta-accent:hover {
      transform: translateY(-3px);
      box-shadow: 0 15px 30px rgba(0, 113, 227, 0.4);
      filter: brightness(1.1);
    }
  `
})
export class TechnologyOverviewComponent implements OnInit {
  readonly i18n = inject(I18nService);
  readonly channelLinks = inject(ChannelLinkService);
  readonly agent = inject(LeadAgentService);
  
  openH2Booking() {
    this.agent.openChat('Ich möchte einen Unitree H2 Humanoid Consulting & Testtag in der Schweiz buchen.', true);
  }
  
  g1Images = [
    'robots/g1-1.jpg',
    'robots/g1-2.jpg',
    'robots/g1-3.jpg',
    'robots/g1-4.jpg'
  ];

  currentImageIndex = signal(0);

  ngOnInit() {
    setInterval(() => {
      this.currentImageIndex.update(idx => (idx + 1) % this.g1Images.length);
    }, 4000);
  }
}
