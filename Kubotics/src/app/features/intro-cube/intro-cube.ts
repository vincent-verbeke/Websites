import { Component, signal, ElementRef, viewChild, output, inject, DestroyRef, AfterViewInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { WebGLRenderer } from './engine/renderer/webgl-renderer';

@Component({
  selector: 'app-intro-cube',
  standalone: true,
  template: `
    <div class="intro-container" [class.fade-out]="isDone()">
      <div #canvasContainer class="canvas-container"></div>
      
      <div class="overlay">
        <div class="status-panel glass">
            <div class="status-title">SYSTEM STATUS</div>
            <div class="status-value">{{ status() }}</div>
            <div class="progress-bar">
                <div class="progress-fill" [style.width.%]="progress()"></div>
            </div>
        </div>
        
        <button class="skip-btn" (click)="skip()">INTRO ÜBERSPRINGEN</button>
      </div>

      <div class="ai-branding title-huge">KUBOTICS</div>
    </div>
  `,
  styles: `
    .intro-container {
      position: fixed;
      inset: 0;
      background: #000;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: opacity 1.5s ease-in-out;
    }

    .fade-out {
      opacity: 0;
      pointer-events: none;
    }

    .canvas-container {
      width: 100%;
      height: 100%;
    }

    .overlay {
      position: absolute;
      bottom: 80px;
      width: 100%;
      max-width: 600px;
      padding: 0 40px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .status-panel {
      padding: 20px;
      width: 200px;
      border-left: 2px solid #0071e3;
    }

    .status-title {
      font-family: 'Space Mono', monospace;
      font-size: 0.6rem;
      color: #666;
      margin-bottom: 8px;
    }

    .status-value {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 12px;
      color: #fff;
    }

    .progress-bar {
      height: 2px;
      background: rgba(255, 255, 255, 0.1);
      width: 100%;
    }

    .progress-fill {
      height: 100%;
      background: #0071e3;
      transition: width 0.3s;
    }

    .skip-btn {
      background: none;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #888;
      padding: 8px 16px;
      border-radius: 100px;
      font-size: 0.7rem;
      font-family: 'Space Mono', monospace;
      cursor: pointer;
      transition: all 0.3s;
    }

    .skip-btn:hover {
      background: rgba(255, 255, 255, 0.05);
      color: white;
      border-color: white;
    }

    .ai-branding {
      position: absolute;
      top: 40px;
      opacity: 0.05;
      letter-spacing: 0.5em;
      pointer-events: none;
    }
  `
})
export class IntroCubeComponent implements AfterViewInit {
  container = viewChild<ElementRef>('canvasContainer');
  isDone = signal(false);
  status = signal('ANALYZING CUBE STATE');
  progress = signal(0);
  
  done = output<void>();

  private engine?: WebGLRenderer;
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);

  ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.isDone.set(true);
      this.done.emit();
      return;
    }

    const hostEl = this.container()?.nativeElement;
    if (hostEl) {
      this.engine = new WebGLRenderer(hostEl);
      this.runIntroSequence();
      
      this.destroyRef.onDestroy(() => {
        this.engine?.dispose();
      });
    }
  }

  private async runIntroSequence() {
    // Initial wait
    await this.wait(2000);
    
    // Scramble (User could do this manually, but for intro we do it automatically)
    this.status.set('ENTROPY INJECTION');
    await this.engine?.scramble();
    
    await this.wait(1000);
    this.status.set('IDENTIFYING ALGORITHMIC PATH');
    await this.wait(2000);
    
    this.status.set('AI SOLVING IN PROGRESS');
    await this.engine?.solve();
    
    this.status.set('OPTIMIZATION COMPLETE');
    this.progress.set(100);
    await this.wait(1000);

    this.status.set('REORGANIZING DATA STRUCTURES');
    this.engine?.explode();
    await this.wait(1000);
    
    this.isDone.set(true);
    setTimeout(() => this.done.emit(), 1000);
  }

  private wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  skip() {
    this.isDone.set(true);
    setTimeout(() => this.done.emit(), 500);
  }
}
