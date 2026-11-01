import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AzureAuthService } from '../../core/services/azure-auth.service';

// Legacy / Edge Feature Components
import { ChatComponent } from './legacy/features/chat/chat.component';
import { HaComponent } from './legacy/features/home-assistant/ha.component';
import { InvestmentsComponent } from './legacy/features/investments/investments.component';
import { LidarComponent } from './legacy/features/lidar/lidar.component';
import { ManagementComponent } from './legacy/features/management/management.component';
import { MotionComponent } from './legacy/features/motion/motion.component';
import { OllamaComponent } from './legacy/features/ollama/ollama.component';
import { ServicesComponent } from './legacy/features/services/services.component';
import { SessionsComponent } from './legacy/features/sessions/sessions.component';
import { SoftwareComponent } from './legacy/features/software/software.component';
import { SystemComponent } from './legacy/features/system/system.component';
import { TrainingComponent } from './legacy/features/training/training.component';
import { TwinComponent } from './legacy/features/twin/twin.component';
import { VisionComponent } from './legacy/features/vision/vision.component';
import { VoiceComponent } from './legacy/features/voice/voice.component';

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

interface LeadItem {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  lead_score: number;
  lifecycle_stage: string;
  ai_summary: string | null;
  created_at: string | null;
}

interface ConversationItem {
  id: string;
  channel: string;
  status: string;
  sender: string;
  message_count: number;
  last_message: string | null;
  started_at: string | null;
}

type TabId =
  | 'overview'
  | 'twin'
  | 'services'
  | 'system'
  | 'management'
  | 'lidar'
  | 'ha'
  | 'software'
  | 'training'
  | 'ollama'
  | 'voice'
  | 'vision'
  | 'motion'
  | 'chat'
  | 'investments'
  | 'sessions';

interface TabItem {
  id: TabId;
  label: string;
  icon: string;
  badge?: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ChatComponent,
    HaComponent,
    InvestmentsComponent,
    LidarComponent,
    ManagementComponent,
    MotionComponent,
    OllamaComponent,
    ServicesComponent,
    SessionsComponent,
    SoftwareComponent,
    SystemComponent,
    TrainingComponent,
    TwinComponent,
    VisionComponent,
    VoiceComponent,
  ],
  template: `
    <div class="dashboard-container">
      <!-- HEADER / STATUS BAR -->
      <header class="dashboard-header">
        <div class="brand-group">
          <h1>Kubotics Autonomous Control & Orchestrator</h1>
          <span class="badge cloud-badge">
            <span class="dot live"></span> Cloud-Native & Hybrid Edge
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

      <!-- NAVIGATION TABS -->
      <nav class="dashboard-tabs" aria-label="Dashboard navigation">
        <div class="tabs-scroll">
          @for (tab of tabs; track tab.id) {
            <button
              class="tab-btn"
              [class.active]="activeTab() === tab.id"
              (click)="setTab(tab.id)"
            >
              <span class="tab-label">{{ tab.label }}</span>
              @if (tab.badge) {
                <span class="tab-badge">{{ tab.badge }}</span>
              }
            </button>
          }
        </div>
      </nav>

      <!-- UNLOGGED STATE PROMPT (Only shown when not signed in) -->
      @if (!auth.isAuthenticated()) {
        <div class="unauth-hero">
          <div class="lock-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          </div>
          <h2>Enterprise Operations Access Restricted</h2>
          <p>Please authenticate using your authorized Microsoft Entra ID tenant account to manage autonomous devices, execute Needle tasks, and access live telemetry.</p>
          <button class="btn-login-hero" (click)="auth.login()">
            Sign in with Microsoft 365
          </button>
        </div>
      } @else {
        <!-- TAB CONTENT VIEWS -->
        <main class="tab-viewport">
          <!-- 1. OVERVIEW / CLOUD ORCHESTRATION -->
          @if (activeTab() === 'overview') {
            <div class="overview-view">
              <!-- KPI SECTION (CLICKABLE CARDS) -->
              <section class="kpi-grid">
                <div class="kpi-card interactive" [class.selected]="selectedView() === 'leads'" (click)="toggleView('leads')">
                  <div class="kpi-header-row">
                    <div class="kpi-label">Total GTM Leads</div>
                    <span class="click-hint">{{ selectedView() === 'leads' ? 'Hide ▲' : 'View & Clean ▼' }}</span>
                  </div>
                  <div class="kpi-value">{{ kpis()?.total_leads ?? '—' }}</div>
                  <div class="kpi-sub">HubSpot & Outreach Sync (Click to inspect)</div>
                </div>

                <div class="kpi-card interactive" [class.selected]="selectedView() === 'conversations'" (click)="toggleView('conversations')">
                  <div class="kpi-header-row">
                    <div class="kpi-label">Conversations</div>
                    <span class="click-hint">{{ selectedView() === 'conversations' ? 'Hide ▲' : 'View & Clean ▼' }}</span>
                  </div>
                  <div class="kpi-value">{{ kpis()?.conversations ?? '—' }}</div>
                  <div class="kpi-sub">WhatsApp & Multi-channel (Click to inspect)</div>
                </div>

                <div class="kpi-card">
                  <div class="kpi-label">Tasks Queued</div>
                  <div class="kpi-value">{{ kpis()?.tasks_queued ?? 0 }}</div>
                  <div class="kpi-sub">Needle worker pool</div>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Tasks Running</div>
                  <div class="kpi-value status-running-val">{{ kpis()?.tasks_running ?? 0 }}</div>
                  <div class="kpi-sub">Active leases</div>
                </div>
                <div class="kpi-card">
                  <div class="kpi-label">Tasks Failed</div>
                  <div class="kpi-value" [class.danger]="(kpis()?.tasks_failed ?? 0) > 0">
                    {{ kpis()?.tasks_failed ?? 0 }}
                  </div>
                  <div class="kpi-sub">Requires triage</div>
                </div>
              </section>

              <!-- DRILL-DOWN PANEL: GTM LEADS -->
              @if (selectedView() === 'leads') {
                <section class="drilldown-section">
                  <div class="section-header">
                    <div>
                      <h3>Inbound GTM Leads</h3>
                      <p class="section-desc">Inspect registered leads, test submissions, and cleanup records.</p>
                    </div>
                    <button class="btn-refresh" (click)="fetchLeads()">Refresh Leads</button>
                  </div>
                  <div class="task-table-wrapper">
                    <table class="task-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Contact (Email / Phone)</th>
                          <th>Title</th>
                          <th>Score</th>
                          <th>AI Summary / Note</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (lead of leads(); track lead.id) {
                          <tr>
                            <td class="font-medium text-white">
                              {{ (lead.first_name || lead.last_name) ? (lead.first_name + ' ' + (lead.last_name || '')) : 'Anonymous Lead' }}
                            </td>
                            <td>
                              <div>{{ lead.email || 'No email' }}</div>
                              <small class="text-muted">{{ lead.phone || 'No phone' }}</small>
                            </td>
                            <td>{{ lead.job_title || '—' }}</td>
                            <td>
                              <span class="badge score-badge">{{ lead.lead_score }}</span>
                            </td>
                            <td class="cell-payload">
                              <span [title]="lead.ai_summary || ''">{{ lead.ai_summary || 'No summary' }}</span>
                            </td>
                            <td>{{ lead.created_at ? (lead.created_at | date:'short') : '—' }}</td>
                            <td>
                              <button class="btn-danger-sm" (click)="deleteLead(lead.id)">Delete</button>
                            </td>
                          </tr>
                        } @empty {
                          <tr>
                            <td colspan="7" class="empty-state">No leads found in database. Inbound form submissions and outreach replies will appear here.</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              }

              <!-- DRILL-DOWN PANEL: CONVERSATIONS -->
              @if (selectedView() === 'conversations') {
                <section class="drilldown-section">
                  <div class="section-header">
                    <div>
                      <h3>Inbound WhatsApp & Multi-Channel Conversations</h3>
                      <p class="section-desc">Active conversations, messages history, and test thread cleanup.</p>
                    </div>
                    <button class="btn-refresh" (click)="fetchConversations()">Refresh Conversations</button>
                  </div>
                  <div class="task-table-wrapper">
                    <table class="task-table">
                      <thead>
                        <tr>
                          <th>Sender / Phone</th>
                          <th>Channel</th>
                          <th>Status</th>
                          <th>Messages</th>
                          <th>Last Message Snippet</th>
                          <th>Started</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (conv of conversations(); track conv.id) {
                          <tr>
                            <td class="font-medium text-white">{{ conv.sender }}</td>
                            <td><span class="pill-type">{{ conv.channel }}</span></td>
                            <td>
                              <span class="pill-status status-{{ conv.status }}">{{ conv.status }}</span>
                            </td>
                            <td>{{ conv.message_count }}</td>
                            <td class="cell-payload">
                              <span [title]="conv.last_message || ''">{{ conv.last_message || '—' }}</span>
                            </td>
                            <td>{{ conv.started_at ? (conv.started_at | date:'short') : '—' }}</td>
                            <td>
                              <button class="btn-danger-sm" (click)="deleteConversation(conv.id)">Delete</button>
                            </td>
                          </tr>
                        } @empty {
                          <tr>
                            <td colspan="7" class="empty-state">No conversations found. Inbound messages from WhatsApp or web chat will appear here.</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              }

              <!-- EDGE DEVICE TELEMETRY STRIP (Fail-closed) -->
              <section class="device-strip">
                <div class="strip-header">
                  <h3>Physical Device Telemetry Feeds (Fail-Closed)</h3>
                  <button class="btn-refresh" (click)="loadAllData()">Refresh Now</button>
                </div>
                <div class="device-grid">
                  <!-- H2 Humanoid Device -->
                  <div class="device-card" [class.device-offline]="h2State()?.is_offline">
                    <div class="card-top">
                      <span class="device-name">Unitree H2 Humanoid (PC3 Thor)</span>
                      <span class="status-indicator" [class.online]="!h2State()?.is_offline" [class.stale]="h2State()?.is_stale">
                        {{ h2State()?.is_offline ? 'OFFLINE' : (h2State()?.is_stale ? 'STALE' : 'LIVE') }}
                      </span>
                    </div>
                    <div class="card-body">
                      @if (h2State()?.is_offline) {
                        <div class="fail-closed-notice">
                          <p>Telemetry stream unreachable or closed. No simulated values are synthesized.</p>
                          <small>Edge relay last heard: {{ h2State()?.age_seconds ? h2State()?.age_seconds + 's ago' : 'Unknown' }}</small>
                        </div>
                      } @else {
                        <div class="telemetry-rows">
                          <div>Source: {{ h2State()?.source }}</div>
                          <div>Updated: {{ h2State()?.updated_at | date:'HH:mm:ss' }}</div>
                          <div>Payload: {{ h2State()?.payload | json }}</div>
                        </div>
                      }
                    </div>
                  </div>

                  <!-- CNC Cell Device -->
                  <div class="device-card" [class.device-offline]="cncState()?.is_offline">
                    <div class="card-top">
                      <span class="device-name">CNC Machine Tending Cell (Fanuc Robodrill)</span>
                      <span class="status-indicator" [class.online]="!cncState()?.is_offline" [class.stale]="cncState()?.is_stale">
                        {{ cncState()?.is_offline ? 'OFFLINE' : (cncState()?.is_stale ? 'STALE' : 'LIVE') }}
                      </span>
                    </div>
                    <div class="card-body">
                      @if (cncState()?.is_offline) {
                        <div class="fail-closed-notice">
                          <p>OPC-UA edge bridge offline. Fail-closed: values deliberately not fabricated.</p>
                          <small>Last poll: {{ cncState()?.age_seconds ? cncState()?.age_seconds + 's ago' : 'Never' }}</small>
                        </div>
                      } @else {
                        <div class="telemetry-rows">
                          <div>Source: {{ cncState()?.source }}</div>
                          <div>Updated: {{ cncState()?.updated_at | date:'HH:mm:ss' }}</div>
                          <div>Payload: {{ cncState()?.payload | json }}</div>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              </section>

              <!-- NEEDLE TASK PIPELINE MONITOR -->
              <section class="tasks-section">
                <div class="section-header">
                  <h3>Needle Task Scheduler & Work Queue</h3>
                  <span class="task-count">{{ tasks().length }} tasks recorded</span>
                </div>
                <div class="task-table-wrapper">
                  <table class="task-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Assignee</th>
                        <th>Created</th>
                        <th>Leased Until</th>
                        <th>Payload / Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (task of tasks(); track task.id) {
                        <tr>
                          <td class="cell-id"><code>{{ task.id.substring(0, 8) }}</code></td>
                          <td><span class="pill-type">{{ task.type }}</span></td>
                          <td>
                            <span class="pill-status status-{{ task.status }}">
                              {{ task.status }}
                            </span>
                          </td>
                          <td>{{ task.assignee || '—' }}</td>
                          <td>{{ task.created_at | date:'shortTime' }}</td>
                          <td>{{ task.leased_until ? (task.leased_until | date:'shortTime') : '—' }}</td>
                          <td class="cell-payload">
                            <code>{{ task.result ? (task.result | json) : (task.payload | json) }}</code>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="7" class="empty-state">No scheduled tasks in queue. Ad-hoc and daily schedules will materialize here.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          }

          <!-- 2. DIGITAL TWIN -->
          @if (activeTab() === 'twin') {
            <app-twin></app-twin>
          }

          <!-- 3. SERVICES MANAGER -->
          @if (activeTab() === 'services') {
            <app-services></app-services>
          }

          <!-- 4. SYSTEM & THERMALS -->
          @if (activeTab() === 'system') {
            <app-system></app-system>
          }

          <!-- 5. MANAGEMENT & CONTROLS -->
          @if (activeTab() === 'management') {
            <app-management></app-management>
          }

          <!-- 6. LIDAR -->
          @if (activeTab() === 'lidar') {
            <app-lidar></app-lidar>
          }

          <!-- 7. HOME ASSISTANT -->
          @if (activeTab() === 'ha') {
            <app-ha></app-ha>
          }

          <!-- 8. SOFTWARE & UPDATES -->
          @if (activeTab() === 'software') {
            <app-software></app-software>
          }

          <!-- 9. TRAINING & RL -->
          @if (activeTab() === 'training') {
            <app-training></app-training>
          }

          <!-- 10. OLLAMA LOCAL MODELS -->
          @if (activeTab() === 'ollama') {
            <app-ollama></app-ollama>
          }

          <!-- 11. VOICE BOT -->
          @if (activeTab() === 'voice') {
            <app-voice></app-voice>
          }

          <!-- 12. VISION / CAMERAS -->
          @if (activeTab() === 'vision') {
            <app-vision></app-vision>
          }

          <!-- 13. MOTION CONTROLS -->
          @if (activeTab() === 'motion') {
            <app-motion></app-motion>
          }

          <!-- 14. CHAT / JCODE -->
          @if (activeTab() === 'chat') {
            <app-chat></app-chat>
          }

          <!-- 15. INVESTMENTS & IBKR -->
          @if (activeTab() === 'investments') {
            <app-investments></app-investments>
          }

          <!-- 16. SESSIONS (WHATSAPP) -->
          @if (activeTab() === 'sessions') {
            <app-sessions></app-sessions>
          }
        </main>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      color: #e2e8f0;
      background: #090d16;
      min-height: 100vh;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .dashboard-container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 1.5rem 2rem 4rem;
    }

    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 1rem;
    }

    .brand-group h1 {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 0.4rem;
      color: #f8fafc;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.25);
    }
    .score-badge {
      background: rgba(16, 185, 129, 0.12);
      color: #10b981;
      border-color: rgba(16, 185, 129, 0.25);
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .dot.live {
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    /* AUTH CONTROLS */
    .user-pill {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 6px 4px 12px;
      border-radius: 9999px;
    }
    .user-name {
      font-size: 0.85rem;
      font-weight: 500;
      color: #f1f5f9;
    }
    .btn-logout {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #94a3b8;
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-logout:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }

    .btn-login, .btn-login-hero {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #0078d4;
      color: #ffffff;
      border: none;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 0.55rem 1.1rem;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-login:hover, .btn-login-hero:hover {
      background: #106ebe;
    }

    /* TAB NAVIGATION */
    .dashboard-tabs {
      margin-bottom: 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      position: sticky;
      top: 0;
      background: rgba(9, 13, 22, 0.95);
      backdrop-filter: blur(8px);
      z-index: 20;
    }
    .tabs-scroll {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: thin;
    }
    .tabs-scroll::-webkit-scrollbar {
      height: 4px;
    }
    .tabs-scroll::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 2px;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: #94a3b8;
      padding: 0.6rem 0.9rem;
      font-size: 0.825rem;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      color: #f1f5f9;
      background: rgba(255, 255, 255, 0.03);
    }
    .tab-btn.active {
      color: #38bdf8;
      border-bottom-color: #38bdf8;
      background: rgba(56, 189, 248, 0.06);
    }
    .tab-badge {
      font-size: 0.65rem;
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      padding: 1px 5px;
      border-radius: 4px;
    }

    /* TAB VIEWPORT */
    .tab-viewport {
      min-height: 600px;
    }

    /* UNAUTH HERO */
    .unauth-hero {
      text-align: center;
      padding: 4rem 2rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px dashed rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      margin-top: 2rem;
    }
    .lock-icon {
      color: #38bdf8;
      margin-bottom: 1rem;
    }
    .unauth-hero h2 {
      font-size: 1.35rem;
      color: #f8fafc;
      margin: 0 0 0.5rem;
    }
    .unauth-hero p {
      max-width: 540px;
      margin: 0 auto 1.5rem;
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    /* OVERVIEW VIEW STYLES */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .kpi-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 1.25rem;
      border-radius: 10px;
      transition: all 0.2s ease;
    }
    .kpi-card.interactive {
      cursor: pointer;
    }
    .kpi-card.interactive:hover {
      background: rgba(56, 189, 248, 0.05);
      border-color: rgba(56, 189, 248, 0.3);
    }
    .kpi-card.selected {
      background: rgba(56, 189, 248, 0.08);
      border-color: #38bdf8;
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
    }
    .kpi-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .click-hint {
      font-size: 0.7rem;
      color: #38bdf8;
      font-weight: 500;
    }
    .kpi-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .kpi-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: #f8fafc;
      margin: 0.35rem 0 0.2rem;
    }
    .kpi-value.danger { color: #ef4444; }
    .status-running-val { color: #f59e0b; }
    .kpi-sub {
      font-size: 0.75rem;
      color: #64748b;
    }

    /* DRILLDOWN SECTION */
    .drilldown-section {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 10px;
      padding: 1.25rem;
      margin-bottom: 2rem;
      animation: fadeIn 0.2s ease-in-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .section-desc {
      font-size: 0.8rem;
      color: #94a3b8;
      margin: 0.25rem 0 0;
    }

    /* DEVICE STRIP */
    .device-strip {
      margin-bottom: 2.5rem;
    }
    .strip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .strip-header h3 {
      font-size: 1.05rem;
      margin: 0;
      color: #f1f5f9;
    }
    .device-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1rem;
    }
    .device-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 1rem 1.25rem;
    }
    .device-card.device-offline {
      border-left: 3px solid #ef4444;
      background: rgba(239, 68, 68, 0.02);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .device-name {
      font-size: 0.9rem;
      font-weight: 600;
      color: #f8fafc;
    }
    .status-indicator {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .status-indicator.online {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    .status-indicator.stale {
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
    }
    .fail-closed-notice p {
      font-size: 0.8rem;
      color: #94a3b8;
      margin: 0 0 0.35rem;
    }
    .fail-closed-notice small {
      font-size: 0.7rem;
      color: #64748b;
    }

    /* TASKS SECTION */
    .tasks-section {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .section-header h3 {
      font-size: 1.05rem;
      margin: 0;
      color: #f1f5f9;
    }
    .task-count {
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .task-table-wrapper {
      overflow-x: auto;
    }
    .task-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.825rem;
      text-align: left;
    }
    .task-table th {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      font-weight: 500;
    }
    .task-table td {
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
    }
    .cell-id code {
      font-family: monospace;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .cell-payload {
      max-width: 250px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cell-payload code {
      font-family: monospace;
      font-size: 0.75rem;
      color: #94a3b8;
      display: inline-block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pill-type {
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
    }
    .pill-status {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .status-active, .status-queued { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
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
    .btn-danger-sm {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #ef4444;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-danger-sm:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    .empty-state { padding: 2rem; text-align: center; color: #64748b; font-size: 0.9rem; }
    .text-muted { color: #64748b; font-size: 0.75rem; }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  auth = inject(AzureAuthService);
  private http = inject(HttpClient);

  private readonly API_BASE = 'https://api.kubotics.ch/api/v1';
  private pollInterval: any = null;

  activeTab = signal<TabId>('overview');
  selectedView = signal<'none' | 'leads' | 'conversations'>('none');

  tabs: TabItem[] = [
    { id: 'overview', label: 'Cloud Orchestrator', icon: 'hub', badge: 'Cloud' },
    { id: 'twin', label: 'Digital Twin (H2)', icon: 'view_in_ar' },
    { id: 'investments', label: 'Investments & IBKR', icon: 'trending_up', badge: 'Live' },
    { id: 'services', label: 'Services Manager', icon: 'settings_suggest' },
    { id: 'system', label: 'Thermals & System', icon: 'thermostat' },
    { id: 'management', label: 'Robot Management', icon: 'tune' },
    { id: 'lidar', label: 'LiDAR Diagnostics', icon: 'radar' },
    { id: 'motion', label: 'Motion Control', icon: 'gamepad' },
    { id: 'vision', label: 'Vision & Cams', icon: 'videocam' },
    { id: 'voice', label: 'Voice Bot', icon: 'mic' },
    { id: 'chat', label: 'Jcode Chat', icon: 'chat' },
    { id: 'sessions', label: 'WhatsApp Sessions', icon: 'forum' },
    { id: 'ha', label: 'Home Assistant', icon: 'home' },
    { id: 'training', label: 'RL Training', icon: 'model_training' },
    { id: 'ollama', label: 'Ollama Models', icon: 'psychology' },
    { id: 'software', label: 'Software Updates', icon: 'system_update' },
  ];

  kpis = signal<DashboardKPIs | null>(null);
  summaryStale = signal<boolean>(false);
  summaryTime = signal<string>('');

  leads = signal<LeadItem[]>([]);
  conversations = signal<ConversationItem[]>([]);

  h2State = signal<DeviceState | null>(null);
  cncState = signal<DeviceState | null>(null);
  tasks = signal<any[]>([]);

  ngOnInit() {
    this.loadAllData();
    // Poll every 10 seconds for live operations
    this.pollInterval = setInterval(() => {
      if (this.auth.isAuthenticated() && this.activeTab() === 'overview') {
        this.loadAllData();
      }
    }, 10000);
  }

  ngOnDestroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  setTab(tabId: TabId) {
    this.activeTab.set(tabId);
    if (tabId === 'overview') {
      this.loadAllData();
    }
  }

  toggleView(view: 'leads' | 'conversations') {
    if (this.selectedView() === view) {
      this.selectedView.set('none');
    } else {
      this.selectedView.set(view);
      if (view === 'leads') {
        this.fetchLeads();
      } else {
        this.fetchConversations();
      }
    }
  }

  loadAllData() {
    this.fetchSummary();
    this.fetchDeviceTelemetry('robot_h2_state', this.h2State);
    this.fetchDeviceTelemetry('cnc_cell_1', this.cncState);
    if (this.auth.isAuthenticated()) {
      this.fetchTasks();
      if (this.selectedView() === 'leads') this.fetchLeads();
      if (this.selectedView() === 'conversations') this.fetchConversations();
    }
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

  fetchLeads() {
    this.http.get<{ leads: LeadItem[] }>(`${this.API_BASE}/dashboard/leads`).subscribe({
      next: (res) => this.leads.set(res.leads || []),
      error: () => this.leads.set([])
    });
  }

  deleteLead(leadId: string) {
    if (!confirm('Are you sure you want to delete this lead?')) return;
    this.http.delete(`${this.API_BASE}/dashboard/leads/${leadId}`).subscribe({
      next: () => {
        this.fetchLeads();
        this.fetchSummary();
      },
      error: (err) => alert('Failed to delete lead: ' + (err.error?.detail || err.message))
    });
  }

  fetchConversations() {
    this.http.get<{ conversations: ConversationItem[] }>(`${this.API_BASE}/dashboard/conversations`).subscribe({
      next: (res) => this.conversations.set(res.conversations || []),
      error: () => this.conversations.set([])
    });
  }

  deleteConversation(conversationId: string) {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    this.http.delete(`${this.API_BASE}/dashboard/conversations/${conversationId}`).subscribe({
      next: () => {
        this.fetchConversations();
        this.fetchSummary();
      },
      error: (err) => alert('Failed to delete conversation: ' + (err.error?.detail || err.message))
    });
  }

  private fetchDeviceTelemetry(dataset: string, targetSignal: any) {
    this.http.get<DeviceState>(`${this.API_BASE}/dashboard/device/${dataset}`).subscribe({
      next: (res) => targetSignal.set(res),
      error: () => targetSignal.set({ dataset, source: 'network', is_stale: true, is_offline: true })
    });
  }

  private fetchTasks() {
    this.http.get<{ tasks: any[] }>(`${this.API_BASE}/dashboard/tasks?limit=15`).subscribe({
      next: (res) => this.tasks.set(res.tasks || []),
      error: () => this.tasks.set([])
    });
  }
}
