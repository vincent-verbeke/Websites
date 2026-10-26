import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="hero">
      <div class="cloud-container">
        <div class="cloud c1"></div>
        <div class="cloud c2"></div>
        <div class="cloud c3"></div>
      </div>
      
      <div class="hero-content">
        <h1 class="fade-in">Modernize with <span class="playful-twist">Clarity</span>.<br>Transform with Authority.</h1>
        <p class="fade-in delay-1">High-level Cloud Architecture and Application Rebuilding for Swiss SMEs.</p>
        <div class="cta-grid fade-in delay-2">
          <div class="cta-row-1">
            <button class="btn btn-outline" routerLink="/services" [fragment]="'infrastructure'">Cloud Infrastructure</button>
            <button class="btn btn-outline" routerLink="/services" [fragment]="'modernization'">App Modernization</button>
          </div>
          <div class="cta-row-2">
            <button class="btn btn-primary" routerLink="/contact" [queryParams]="{consultation: 'true'}">Request a 2h Audit</button>
          </div>
        </div>
      </div>
      
      <div class="hero-footer">
        <div class="scroll-indicator">
          <span>Scroll to explore</span>
          <div class="mouse"></div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .hero {
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
      background: var(--bg-light);
      text-align: center;
    }

    .hero-content {
      z-index: 10;
      max-width: 1000px;
      padding: 0 2rem;
    }

    h1 {
      font-size: clamp(3rem, 8vw, 5rem);
      margin-bottom: 1.5rem;
      line-height: 1.1;
    }

    p {
      font-size: 1.5rem;
      opacity: 0.8;
      max-width: 700px;
      margin: 0 auto 3rem;
    }

    .cta-grid {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      align-items: center;
    }

    .cta-row-1 {
      display: flex;
      gap: 1.5rem;
      justify-content: center;
      flex-wrap: wrap;
    }

    .btn {
      padding: 1.2rem 2.5rem;
      border-radius: 50px;
      font-weight: 700;
      font-size: 1.1rem;
      cursor: pointer;
      transition: all 0.3s ease;
      border: none;
      white-space: nowrap;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
      box-shadow: 0 10px 25px rgba(0, 168, 255, 0.3);
      &:hover { transform: translateY(-3px); box-shadow: 0 15px 30px rgba(0, 168, 255, 0.4); }
    }

    .btn-outline {
      background: transparent;
      border: 2px solid var(--primary);
      color: var(--primary);
      &:hover { background: var(--primary); color: white; transform: translateY(-3px); }
    }

    /* Cloud Background Animation */
    .cloud-container {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      z-index: 1;
      opacity: 0.4;
    }
    .cloud {
      position: absolute;
      background: white;
      border-radius: 100px;
      filter: blur(50px);
      animation: float 20s infinite alternate linear;
    }
    .c1 { width: 400px; height: 150px; top: 10%; left: -10%; background: #e0f2fe; }
    .c2 { width: 500px; height: 200px; top: 50%; right: -10%; animation-duration: 25s; background: #f0f9ff; }
    .c3 { width: 300px; height: 100px; bottom: 10%; left: 30%; animation-duration: 15s; background: #e6f7ff; }

    @keyframes float {
      0% { transform: translate(0, 0) scale(1); }
      100% { transform: translate(100px, 50px) scale(1.1); }
    }

    /* Animations */
    .fade-in { opacity: 0; animation: fadeIn 0.8s forwards ease-out; }
    .delay-1 { animation-delay: 0.3s; }
    .delay-2 { animation-delay: 0.6s; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

    .hero-footer {
      position: absolute;
      bottom: 2rem;
      width: 100%;
      z-index: 10;
    }
    .scroll-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      font-size: 0.8rem;
      opacity: 0.5;
    }
    .mouse {
      width: 20px; height: 35px;
      border: 2px solid var(--text-light);
      border-radius: 10px;
      position: relative;
      &::after {
        content: ''; position: absolute; top: 5px; left: 50%;
        width: 4px; height: 4px; background: var(--text-light);
        border-radius: 50%; transform: translateX(-50%);
        animation: scrollWheel 2s infinite;
      }
    }
    @keyframes scrollWheel { 0% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, 15px); } }

    :host-context(body.dark-mode) {
      .hero { background: var(--bg-dark); }
      .cloud { background: rgba(255,255,255,0.05); filter: blur(80px); }
      .mouse { border-color: var(--text-dark); &::after { background: var(--text-dark); } }
    }
  `]
})
export class Hero { }
