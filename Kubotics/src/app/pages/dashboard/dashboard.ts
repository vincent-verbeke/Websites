import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AzureAuthService } from '../../core/services/azure-auth.service';

interface DashboardKPIs {
  total_leads: number;
  conversations: number;
  tasks_queued: number;
  tasks_running: number;
  tasks_failed: number;
}

interface DeviceState {
  dataset: string;
  source: string;
  is_stale: boolean;
  is_offline: boolean;
  age_seconds?: number;
  updated_at?: string;
  payload?: any;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dashboard-container">
      <!-- HEADER / STATUS BAR -->
      <header class="dashboard-header">
        <div class="brand-group">
          <h1>Kubotics Autonomous Control & Needle Orchestrator</h1>
          <span class="badge cloud-badge">
            <span class="dot live"></span> Cloud-Native (ECS Fargate)
          </span>
        </div>

        <div class="auth-bar">
          @if (auth.isAuthenticated()) {
            <div class="user-pill">
              <span class="user-name">{{ auth.currentAccount()?.name || auth.currentAccount()?.username }}</span>
              <button class="btn-logout" (click)="auth.logout()">Sign out</button>
            </div>
          } @else {
            <button class="btn-login" (click)="auth.login()">
              <svg width="18" height="18" viewBox="0 0 21 21"><path fill="#f25022" d="M1 1h9v9H1z"/><path fill="#00a4ef" d="M1 11h9v9H1z"/><path fill="#7fba00" d="M11 1h9v9H11z"/><path fill="#ffb900" d="M11 11h9v9H11z"/></svg>
              Sign in with Microsoft 365
            </button>
          }
        </div>
      </header>

      <!-- UNLOGGED STATE PROMPT -->
      @if (!auth.isAuthenticated()) {
        <div class="unauth-hero">
          <div class="lock-icon">
            <span class="material-icons-outlined">admin_panel_settings</span>
          </div>
          <h2>Enterprise Operations Access Restricted</h2>
          <p>Please authenticate using your authorized Kuroliv / Kubotics Microsoft Entra ID account to access live GTM metrics, telemetry, and needle task pipelines.</p>
          <button class="btn-primary-auth" (click)="auth.login()">Sign in with Entra ID</button>
        </div>
      } @else {
        <!-- LOGGED-IN DASHBOARD CONTENT -->
        <main class="dashboard-content">
          <!-- TOP ROW: SYSTEM VITALS & GTM METRICS -->
          <div class="section-title-row">
            <h2>GTM & Orchestration Metrics</h2>
            <div class="freshness-indicator">
              <span class="dot" [class.live]="!summaryStale()" [class.stale]="summaryStale()"></span>
              Last updated: {{ summaryTime() || 'Syncing...' }}
            </div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-card">
              <span class="kpi-label">Total Ingested Leads</span>
              <span class="kpi-val">{{ kpis()?.total_leads ?? 0 }}</span>
              <span class="kpi-sub">PostgreSQL CRM Source of Truth</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Active Conversations</span>
              <span class="kpi-val">{{ kpis()?.conversations ?? 0 }}</span>
              <span class="kpi-sub">Web + WhatsApp + Telegram</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Queued Tasks (PC-A Poll)</span>
              <span class="kpi-val" [class.warn]="(kpis()?.tasks_queued ?? 0) > 10">{{ kpis()?.tasks_queued ?? 0 }}</span>
              <span class="kpi-sub">Awaiting daemon claim</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Running Tasks</span>
              <span class="kpi-val highlight">{{ kpis()?.tasks_running ?? 0 }}</span>
              <span class="kpi-sub">In-flight agent operations</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Failed Tasks</span>
              <span class="kpi-val" [class.alert]="(kpis()?.tasks_failed ?? 0) > 0">{{ kpis()?.tasks_failed ?? 0 }}</span>
              <span class="kpi-sub">Requires triage / retry</span>
            </div>
          </div>

          <!-- MIDDLE ROW: HARDWARE & EDGE ROBOT TELEMETRY (FAIL-CLOSED) -->
          <div class="section-title-row">
            <h2>Edge Hardware & Unitree Telemetry (Fail-Closed)</h2>
            <span class="badge info">Outbound Pull & Push-Ingest</span>
          </div>

          <div class="hardware-grid">
            <!-- Unitree H2 Humanoid Card -->
            <div class="hw-card" [class.border-stale]="h2State()?.is_stale" [class.border-offline]="h2State()?.is_offline">
              <div class="hw-header">
                <div>
                  <h3>Unitree H2 Humanoid</h3>
                  <span class="hw-source">Dataset: robot_h2_state</span>
                </div>
                <div>
                  @if (h2State()?.is_offline) {
                    <span class="badge offline">OFFLINE (Fail-Closed)</span>
                  } @else if (h2State()?.is_stale) {
                    <span class="badge stale">STALE ({{ h2State()?.age_seconds }}s)</span>
                  } @else {
                    <span class="badge live">ONLINE (Live)</span>
                  }
                </div>
              </div>

              @if (h2State()?.is_offline) {
                <div class="offline-warning">
                  <span class="material-icons-outlined">warning</span>
                  <div>
                    <strong>Edge Telemetry Feed Offline</strong>
                    <p>No recent snapshot received from PC-A / dev PC. Values are NOT fabricated.</p>
                  </div>
                </div>
              } @else {
                <div class="telemetry-stats">
                  <div class="stat-row">
                    <span>Battery State</span>
                    <strong>{{ h2State()?.payload?.battery_soc || 'N/A' }}%</strong>
                  </div>
                  <div class="stat-row">
                    <span>Joint Temp Peak</span>
                    <strong>{{ h2State()?.payload?.max_joint_temp || 'N/A' }}°C</strong>
                  </div>
                  <div class="stat-row">
                    <span>Control Mode</span>
                    <strong>{{ h2State()?.payload?.control_mode || 'Standby' }}</strong>
                  </div>
                </div>
              }
            </div>

            <!-- CNC Automation Cell Card -->
            <div class="hw-card" [class.border-stale]="cncState()?.is_stale" [class.border-offline]="cncState()?.is_offline">
              <div class="hw-header">
                <div>
                  <h3>CNC Cell Arm & Gripper</h3>
                  <span class="hw-source">Dataset: cnc_cell_1</span>
                </div>
                <div>
                  @if (cncState()?.is_offline) {
                    <span class="badge offline">OFFLINE (Fail-Closed)</span>
                  } @else if (cncState()?.is_stale) {
                    <span class="badge stale">STALE</span>
                  } @else {
                    <span class="badge live">ONLINE</span>
                  }
                </div>
              </div>

              @if (cncState()?.is_offline) {
                <div class="offline-warning">
                  <span class="material-icons-outlined">warning</span>
                  <div>
                    <strong>PLC / Edge Sensor Offline</strong>
                    <p>Zero telemetry reported in the last 180 seconds.</p>
                  </div>
                </div>
              } @else {
                <div class="telemetry-stats">
                  <div class="stat-row">
                    <span>Cycle Counter</span>
                    <strong>{{ cncState()?.payload?.cycle_count || 0 }} pcs</strong>
                  </div>
                  <div class="stat-row">
                    <span>Spindle State</span>
                    <strong>{{ cncState()?.payload?.spindle_status || 'Idle' }}</strong>
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- BOTTOM ROW: LIVE TASK QUEUE (PC-A POLLING) -->
          <div class="section-title-row">
            <h2>Needle Task Execution Pipeline</h2>
            <button class="btn-refresh" (click)="loadAllData()">Manual Refresh</button>
          </div>

          <div class="task-table-card">
            @if (tasks().length === 0) {
              <div class="empty-state">No active or pending tasks in cloud queue.</div>
            } @else {
              <table class="task-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Correlation ID</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assignee</th>
                    <th>Heartbeat / Age</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of tasks(); track t.id) {
                    <tr>
                      <td class="task-type">{{ t.type }}</td>
                      <td class="task-corr"><code>{{ t.correlation_id }}</code></td>
                      <td>{{ t.priority }}</td>
                      <td>
                        <span class="status-pill status-{{ t.status }}">{{ t.status }}</span>
                      </td>
                      <td>{{ t.assignee || 'Unassigned' }}</td>
                      <td class="task-time">{{ t.heartbeat_at || t.created_at | date:'shortTime' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </main>
      }
    </div>
  `,
  styles: `
    .dashboard-container {
      min-height: 90vh;
      background: #080c14;
      color: #e2e8f0;
      padding: 1.5rem 2rem 4rem;
      font-family: 'Inter', system-ui, sans-serif;
    }

    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 2rem;
    }

    .brand-group h1 {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 0.4rem 0;
      color: #ffffff;
    }

    .cloud-badge {
      font-size: 0.75rem;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 9999px;
      padding: 0.2rem 0.6rem;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .dot.live { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .dot.stale { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }

    .auth-bar {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .btn-login, .btn-primary-auth {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #ffffff;
      color: #0f172a;
      font-weight: 600;
      font-size: 0.85rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-login:hover, .btn-primary-auth:hover { background: #f1f5f9; }

    .user-pill {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 0.35rem 0.85rem;
      border-radius: 8px;
    }
    .user-name { font-size: 0.85rem; font-weight: 500; }
    .btn-logout {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .btn-logout:hover { color: #f87171; }

    .unauth-hero {
      text-align: center;
      max-width: 540px;
      margin: 6rem auto;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 3rem 2rem;
    }
    .lock-icon span { font-size: 3rem; color: #38bdf8; margin-bottom: 1rem; }
    .unauth-hero h2 { font-size: 1.4rem; margin-bottom: 0.75rem; }
    .unauth-hero p { font-size: 0.9rem; color: #94a3b8; line-height: 1.5; margin-bottom: 1.75rem; }
    .btn-primary-auth { margin: 0 auto; padding: 0.7rem 1.5rem; font-size: 0.95rem; }

    .section-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 2rem 0 1rem;
    }
    .section-title-row h2 {
      font-size: 1.05rem;
      font-weight: 600;
      color: #cbd5e1;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
    }
    .freshness-indicator {
      font-size: 0.8rem;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }
    .kpi-card {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
    }
    .kpi-label { font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.5rem; }
    .kpi-val { font-size: 1.9rem; font-weight: 700; color: #ffffff; }
    .kpi-val.highlight { color: #38bdf8; }
    .kpi-val.warn { color: #f59e0b; }
    .kpi-val.alert { color: #ef4444; }
    .kpi-sub { font-size: 0.72rem; color: #64748b; margin-top: 0.4rem; }

    .hardware-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.25rem;
    }
    .hw-card {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1.25rem;
    }
    .hw-card.border-stale { border-color: rgba(245, 158, 11, 0.4); }
    .hw-card.border-offline { border-color: rgba(239, 68, 68, 0.4); }
    .hw-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .hw-header h3 { font-size: 1.05rem; margin: 0 0 0.2rem; }
    .hw-source { font-size: 0.75rem; color: #64748b; font-family: monospace; }

    .badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
    .badge.live { background: rgba(16, 185, 129, 0.15); color: #10b981; }
    .badge.stale { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .badge.offline { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
    .badge.info { background: rgba(56, 189, 248, 0.1); color: #38bdf8; }

    .offline-warning {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      padding: 0.85rem;
      border-radius: 8px;
      color: #fca5a5;
    }
    .offline-warning strong { display: block; font-size: 0.85rem; }
    .offline-warning p { margin: 0.2rem 0 0; font-size: 0.75rem; color: #f87171; }

    .telemetry-stats { display: flex; flex-direction: column; gap: 0.5rem; }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 0.4rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.85rem;
    }
    .stat-row span { color: #94a3b8; }

    .task-table-card {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      overflow: hidden;
    }
    .task-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .task-table th, .task-table td {
      padding: 0.85rem 1rem;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .task-table th { background: rgba(255, 255, 255, 0.02); color: #94a3b8; font-weight: 600; }
    .task-type { font-weight: 600; color: #38bdf8; }
    .task-corr code { background: rgba(255, 255, 255, 0.06); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.78rem; }
    .status-pill {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      text-transform: uppercase;
    }
    .status-queued { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; }
    .status-assigned { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }
    .status-running { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    .status-succeeded { background: rgba(16, 185, 129, 0.15); color: #10b981; }
    .status-failed { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

    .btn-refresh {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1;
      padding: 0.3rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .btn-refresh:hover { background: rgba(255, 255, 255, 0.12); }
    .empty-state { padding: 2rem; text-align: center; color: #64748b; font-size: 0.9rem; }
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  auth = inject(AzureAuthService);
  private http = inject(HttpClient);

  private readonly API_BASE = 'https://api.kubotics.ch/api/v1';
  private pollInterval: any = null;

  kpis = signal<DashboardKPIs | null>(null);
  summaryStale = signal<boolean>(false);
  summaryTime = signal<string>('');

  h2State = signal<DeviceState | null>(null);
  cncState = signal<DeviceState | null>(null);
  tasks = signal<any[]>([]);

  ngOnInit() {
    this.loadAllData();
    // Poll every 10 seconds for live operations
    this.pollInterval = setInterval(() => {
      if (this.auth.isAuthenticated()) {
        this.loadAllData();
      }
    }, 10000);
  }

  ngOnDestroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  loadAllData() {
    this.fetchSummary();
    this.fetchDeviceTelemetry('robot_h2_state', this.h2State);
    this.fetchDeviceTelemetry('cnc_cell_1', this.cncState);
    this.fetchTasks();
  }

  private fetchSummary() {
    this.http.get<any>(`${this.API_BASE}/dashboard/summary`).subscribe({
      next: (res) => {
        this.kpis.set(res.kpis);
        this.summaryStale.set(res.is_stale);
        this.summaryTime.set(new Date(res.updated_at).toLocaleTimeString());
      },
      error: () => this.summaryStale.set(true)
    });
  }

  private fetchDeviceTelemetry(dataset: string, targetSignal: any) {
    this.http.get<DeviceState>(`${this.API_BASE}/dashboard/device/${dataset}`).subscribe({
      next: (res) => targetSignal.set(res),
      error: () => targetSignal.set({ dataset, source: 'network', is_stale: true, is_offline: true })
    });
  }

  private fetchTasks() {
    this.http.get<{ tasks: any[] }>(`${this.API_BASE}/tasks?limit=15`).subscribe({
      next: (res) => this.tasks.set(res.tasks || []),
      error: () => this.tasks.set([])
    });
  }
}
