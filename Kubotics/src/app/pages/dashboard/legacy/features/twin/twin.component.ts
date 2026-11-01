import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-twin',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="twin-frame-container">
      <div class="bar">
        <h2>H2 Digital Twin (MuJoCo Sim & Replay)</h2>
        <span class="chip ok">Bridge Connected</span>
        <a href="https://ubuntu-automation.tail8c17d3.ts.net/twin" target="_blank" class="chip link-chip">Open Dedicated View ↗</a>
      </div>
      <div class="twin-wrapper">
        <iframe 
          src="https://ubuntu-automation.tail8c17d3.ts.net/twin" 
          class="twin-iframe"
          title="Digital Twin MuJoCo Simulation">
        </iframe>
      </div>
    </div>
  `,
  styles: [`
    .twin-frame-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: 100%;
      min-height: 700px;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .bar h2 {
      margin: 0;
      font-size: 1.25rem;
      color: #f1f5f9;
    }
    .chip {
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.75rem;
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      text-decoration: none;
    }
    .chip.ok {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      border-color: rgba(16, 185, 129, 0.3);
    }
    .link-chip {
      margin-left: auto;
      color: #38bdf8;
      cursor: pointer;
    }
    .twin-wrapper {
      flex: 1;
      width: 100%;
      min-height: 650px;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #334155;
      background: #020617;
    }
    .twin-iframe {
      width: 100%;
      height: 100%;
      min-height: 650px;
      border: none;
    }
  `]
})
export class TwinComponent implements OnInit {
  ngOnInit() {}
}
