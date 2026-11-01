import { Component, OnDestroy, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, interval, of, concat } from 'rxjs';
import { catchError, exhaustMap, map, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  apiGet,
  apiPost,
  type LidarTelemetry,
  type ServiceToggleResponse,
  type Telemetry,
} from '../../core/api';

/** Phase 1 parity tab 8/8 (plan §6): the legacy dashboard's *3D Navigation
 * LiDAR & Perception Stream*. Contract (core/api.ts) — there is NO dedicated
 * lidar API; the legacy tab renders `telemetry.lidar_telemetry`:
 *   API.telemetry.get (GET /api/telemetry) → lidar_telemetry { online,
 *       status_str, notice, state_code, cloud_active, cloud_hz, cloud_bytes,
 *       odom_active, odom_hz, odom_pose{x,y,z} }
 *   API.service.toggle (POST /api/service/toggle) {service:"slam_operate"} —
 *       Start SLAM button, NOT exercised by the CDP harness (robot-service POST).
 * Signals only — Angular 22 scaffold is zoneless.
 */

const REFRESH_MS = 3000;

@Component({
  selector: 'app-lidar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <h2>3D Navigation LiDAR &amp; Perception (DDS)</h2>
      <span class="chip" [class.ok]="badgeOk()">{{ badge() }}</span>
      <button class="btn" (click)="startSlam()" [disabled]="busy()">Start SLAM Operate</button>
      <span class="meta">{{ meta() }}</span>
    </div>

    <p class="result warn" *ngIf="failure() as f">lidar telemetry: {{ f }}</p>

    <section class="sec">
      <p class="hint">
        Live telemetry from the RS-Helios / Hesai LiDAR perception driver and
        Unitree 3D SLAM odometry pipeline via CycloneDDS (rendered from
        <code>telemetry.lidar_telemetry</code> — the legacy tab has no dedicated API).
      </p>
      <div class="cards">
        <div class="card">
          <div class="ttl">RS-Helios / rsLidarCheak Health</div>
          <div class="kv">
            <span>Connection State</span><b [class.warn]="!lidar()?.online">{{ lidar()?.status_str ?? 'DISCONNECTED' }}</b>
            <span>Configured Target IP</span><b>192.168.124.20 (eth1)</b>
            <span>Physical Carrier Link</span><b>1000 Mb/s Full Duplex</b>
            <span>DDS Health Topic</span><b>/qt_notice (std_msgs/String)</b>
            <span>Last Daemon Notice</span><b class="clip">{{ lidar()?.notice ?? 'Awaiting message...' }}</b>
          </div>
        </div>
        <div class="card">
          <div class="ttl">Point Cloud &amp; Odometry Telemetry</div>
          <div class="kv">
            <span>PointCloud Topic</span><b>/lio_sam_ros2/deskew/cloud_deskewed</b>
            <span>PCloud Frame Rate</span><b [class.ok]="lidar()?.cloud_active">{{ cloudHz() }}</b>
            <span>Odometry Topic</span><b>/dog_odom (nav_msgs/Odometry)</b>
            <span>Odometry Frequency</span><b [class.ok]="lidar()?.odom_active">{{ odomHz() }}</b>
            <span>Current Position (XYZ)</span><b>{{ odomXyz() }}</b>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #e5e7eb; color: #374151; font-weight: 700; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 6px 14px; border-radius: 999px;
           border: 1px solid #1f2937; background: #1f2937; color: #fff; cursor: pointer; }
    .btn:disabled { opacity: .45; cursor: default; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .result { font: 12px/1.5 system-ui, sans-serif; color: #92400e; background: #fffbeb;
              border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px;
              margin: 0 14px 10px; }
    .sec { padding: 0 14px 14px; }
    .hint { font: 12px/1.5 system-ui, sans-serif; color: #6b7280; margin: 0 0 12px; }
    .hint code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; color: #0891b2; }
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
    .ttl { font: 700 11px/1 system-ui, sans-serif; text-transform: uppercase;
           letter-spacing: .5px; color: #0891b2; margin-bottom: 10px; }
    .kv { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px;
          font: 12px/1.4 system-ui, sans-serif; color: #6b7280; }
    .kv b { color: #111827; font-weight: 600; font-family: ui-monospace, monospace;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kv b.warn { color: #b45309; }
    .kv b.ok { color: #065f46; }
    .kv b.clip { max-width: 260px; font-size: 11px; color: #6b7280; }
  `],
})
export class LidarComponent implements OnInit, OnDestroy {
  readonly lidar = signal<LidarTelemetry | null>(null);
  readonly failure = signal<string | null>(null);
  readonly busy = signal(false);

  readonly badge = computed(() => {
    const l = this.lidar();
    if (!l) return 'AWAITING SENSOR';
    if (l.online) return 'LIDAR STREAMING';
    if (l.odom_active) return 'ODOMETRY ACTIVE (500Hz)';
    return 'AWAITING SENSOR';
  });
  readonly badgeOk = computed(() => !!this.lidar()?.online || !!this.lidar()?.odom_active);

  private readonly destroy$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    concat(of(0), interval(REFRESH_MS)).pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.fetch$()),
    ).subscribe((l) => {
      if (l) {
        this.failure.set(null);
        this.lidar.set(l);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  meta(): string {
    return 'source: telemetry.lidar_telemetry (legacy lidar tab parity)';
  }

  cloudHz(): string {
    const l = this.lidar();
    if (!l) return '—';
    return `${l.cloud_hz ?? 0} Hz (${Math.round((l.cloud_bytes ?? 0) / 1024)} KB payload)`;
  }

  odomHz(): string {
    const l = this.lidar();
    if (!l) return '—';
    return `${l.odom_hz ?? 0} Hz`;
  }

  odomXyz(): string {
    const p = this.lidar()?.odom_pose;
    return p ? `[X: ${p.x}m, Y: ${p.y}m, Z: ${p.z}m]` : '[0.0, 0.0, 0.0]';
  }

  /** API.service.toggle — NOT exercised by CDP (robot-service POST). */
  startSlam(): void {
    if (this.busy()) return;
    this.busy.set(true);
    apiPost<ServiceToggleResponse>(
      this.http, API.service.toggle, { service: 'slam_operate', enabled: true },
    ).pipe(
      catchError((e: unknown) => of({ error: httpErrorText(e) } as ServiceToggleResponse)),
    ).subscribe((res) => {
      this.busy.set(false);
      this.failure.set(res.success ? null
        : `toggle slam_operate: ${res.error ?? 'failed'}`);
    });
  }

  private fetch$(): Observable<LidarTelemetry | null> {
    return apiGet<Telemetry>(this.http, API.telemetry.get).pipe(
      map((t) => t.lidar_telemetry ?? null),
      catchError((e: unknown) => {
        this.failure.set(`GET ${API.telemetry.get.path}: ${httpErrorText(e)}`);
        return of(null);
      }),
    );
  }
}
