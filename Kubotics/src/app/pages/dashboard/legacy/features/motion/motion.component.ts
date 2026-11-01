import { Component, HostListener, OnDestroy, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, Observable, interval, of, concat } from 'rxjs';
import { catchError, exhaustMap, takeUntil } from 'rxjs/operators';
import { httpErrorText } from '../../core/http-error';
import {
  API,
  type Imu,
  type Joint,
  type LowState,
  type MotionResponse as CmdRes,
  type MotionSafetyLock as SafetyLock,
  type MotionWaypoint,
  type MotionWaypointList,
  type Telemetry,
} from '../../core/api';
import {
  DEFAULT_VELOCITY_DEG_S,
  JOG_TICK_MS,
  JOINT_BY_ID,
  JOINT_TABLE,
  approachStep,
  chunkStep,
  clampStep,
  clampToLimits,
  computeJointSteps,
  sanitizeVelocity,
  velocityStepDeg,
  type JogJoint,
  type JogSelection,
} from './jogger.model';

/** Phase 1 parity tab 7 (plan §6): the legacy dashboard's *SDK2 Motion &
 * Joint Telemetry (Hardware Safety Protected)*. Contract from
 * robot_dashboard_server.py + index.html:
 *   GET  /api/motion/safety_lock      → {armed, lock_reason, last_command_rejected}
 *   GET  /api/telemetry               → low_state {online, imu{roll_deg…}, joints[],
 *                                        safety_lock}
 *   POST /api/motion/safety_lock/toggle {armed, confirm_robot_suspended_or_safe?}
 *   POST /api/motion/execute          {type: 'jog'|'fsm'|'trajectory', …}
 *   POST /api/motion/nudge            {joint_id, delta_deg}
 *   POST /api/motion/jogger/start|stop
 *   POST /api/motion/capture_waypoint {name}
 * Server-side: every motion POST is rejected with 403 while disarmed (hard
 * interlock) and even-armed runs are "supervised staging" (no motor output
 * without the physical tether). Client-side: sendMotionCmd blocks BEFORE the
 * fetch while disarmed (parity) — so CDP can exercise the interlock feedback
 * safely; the POSTs themselves are NEVER triggered by the CDP harness.
 * Signals only — Angular 22 scaffold is zoneless.
 *
 * Waypoint jogger (2026-10-15, replaces the old select + nudge buttons):
 * 31 per-joint sliders (soft-limited, mouse + keyboard), a global velocity
 * entry (deg/s), a same-direction GROUP checkbox in front of each slider, a
 * MIRROR checkbox behind it (L/R pair, test_h2_arm_raise_sequence.py sign
 * convention), HOLD/RELEASE of the seated hold, and waypoint capture with a
 * copyable JSON preview. Movement math lives in jogger.model.ts (pure,
 * unit-tested); this class only drives the 20 Hz tick and the nudge queue.
 * 2026-10-17: + absolute SET box as the first column of every row (current
 * degrees, type a new angle, Set/Enter walks the joint there through the SAME
 * rate-limited tick — an alternative to dragging the slider).
 */

// DTOs + routes live in core/api.ts (shared); the aliases above keep this
// tab's original names. Joint/Imu/LowState/SafetyLock/Telemetry are the
// low_state slice of GET /api/telemetry + GET /api/motion/safety_lock.

const TELEMETRY_MS = 2000;

/** Exact tooltip every jog control carries while the interlock is disarmed
 * (the client-side gate mirrors the server's 403 — spec: exact title). */
export const JOG_INTERLOCK_TITLE =
  'BLOCKED: Safety Interlock — robot not armed; arm motion control first (server rejects with 403)';

/** Exact tooltip while armed but no seated hold is active yet. */
export const JOG_HOLD_TITLE =
  'HOLD required — press "HOLD position" (jogger start) to latch the current pose before jogging';

/** Max queued nudge requests: beyond this the tick pauses (back-pressure),
 * the drain keeps running — the server is never flooded. */
const NUDGE_QUEUE_LIMIT = 64;

interface NudgeReq {
  readonly joint_id: number;
  readonly delta_deg: number;
}

/** legacy fsm presets (sendMotionCmd values from index.html) */
const FSM_PRESETS = [
  { id: 4, label: 'FixStand', hint: 'FSM 4' },
  { id: 3, label: 'Sit Down', hint: 'FSM 3' },
  { id: 601, label: 'HybridWalk', hint: 'FSM 601' },
  { id: 1, label: 'Passive / Damped', hint: 'FSM 1' },
] as const;

interface JogBtn {
  key: string;
  label: string;
  title: string;
  vx: number;
  vy: number;
  stop?: boolean;
}

/** Per-step state of the "run all" waypoint sequence (row chips + summary). */
export type WaypointStepState =
  'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'stopped';

/** One row of the sequence runner: waypoint name + its latest outcome. */
export interface WaypointStep {
  readonly name: string;
  readonly state: WaypointStepState;
  readonly error?: string;
}

/** Normalise an HttpClient error into a MotionResponse body: the legacy
 * backend answers 403/4xx with structured {success:false, error} — honour
 * the body like the legacy fetch().json() did; anything else becomes a
 * readable error (shared by post(), the nudge drain and waypoint plays). */
function cmdErrorRes(e: unknown): CmdRes {
  const b = (e as { error?: unknown }).error;
  if (b && typeof b === 'object' && 'success' in b) return b as CmdRes;
  return { success: false, error: httpErrorText(e) } as CmdRes;
}

const JOG_PAD: JogBtn[] = [
  { key: 'fwd', label: '▲', title: 'Forward 0.2m/s', vx: 0.2, vy: 0 },
  { key: 'left', label: '◀', title: 'Strafe Left 0.2m/s', vx: 0, vy: 0.2 },
  { key: 'stop', label: '■', title: 'Emergency Zero Velocity', vx: 0, vy: 0, stop: true },
  { key: 'right', label: '▶', title: 'Strafe Right 0.2m/s', vx: 0, vy: -0.2 },
  { key: 'bwd', label: '▼', title: 'Backward 0.2m/s', vx: -0.2, vy: 0 },
];

@Component({
  selector: 'app-motion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bar">
      <h2>SDK2 Motion &amp; Joint Telemetry</h2>
      <span class="chip" [class.ok]="armed()">{{ armed() ? 'ARMED' : 'LOCKED (DISARMED)' }}</span>
      <span class="chip" [class.ok]="online()">{{ online() ? 'DDS LIVE' : 'DDS OFFLINE' }}</span>
      <span class="meta">hardware safety protected — server interlock rejects all motion while disarmed</span>
    </div>

    <p class="feedback" [class.ok]="feedbackOk()" *ngIf="feedback() as f">{{ f }}</p>

    <section class="sec">
      <h3>Safety interlock</h3>
      <p class="reason">{{ lock()?.lock_reason ?? '—' }}</p>
      <div class="arm-row">
        <label class="chk">
          <input type="checkbox" [(ngModel)]="confirmSafe" [disabled]="armed() || busy()" />
          I verified the robot is suspended / safe
        </label>
        <button class="btn" [class.danger]="armed()" [disabled]="busy()"
                (click)="toggleArm()">
          {{ armed() ? '■ Disarm motion control' : '▶ Arm motion control' }}
        </button>
        <button class="btn" [disabled]="busy()"
                title="Release the robot's motion service (e.g. 'ai') via MotionSwitcher — the dashboard form of: python3 h2_state_control.py --release. SAFE: makes the robot passive, never moves it, works without ARM."
                (click)="releaseMotionService()">
          ⏏ release motion service
        </button>
      </div>
      <p class="reject" *ngIf="lock()?.last_command_rejected as rej">
        last rejected: <b>{{ rej?.type }}</b> — {{ rej?.reason }}
      </p>
    </section>

    <section class="sec">
      <h3>Live state</h3>
      <div class="kv">
        <span>IMU roll/pitch/yaw</span>
        <b>{{ imu() ? (fmt(imu()!.roll_deg) + '° / ' + fmt(imu()!.pitch_deg) + '° / ' + fmt(imu()!.yaw_deg) + '°') : '—' }}</b>
        <span>packets</span><b>{{ packets() }}</b>
        <span>joints</span><b>{{ joints().length ? joints().length + ' reported' : 'no joint data (robot offline)' }}</b>
      </div>
      <div class="joints" *ngIf="joints().length">
        <div class="j" *ngFor="let j of joints()">
          <span>{{ short(j.name) }}</span><b>{{ deg(j.q_rad) }}°</b>
        </div>
      </div>
    </section>

    <section class="sec">
      <h3>Guarded commands</h3>
      <div class="pad">
        <button *ngFor="let b of jogPad" class="jog" [title]="b.title"
                (click)="sendJog(b)">{{ b.label }}</button>
      </div>
      <div class="fsm">
        <button *ngFor="let f of fsmPresets" class="fsm-btn" [title]="f.hint"
                (click)="sendFsm(f.id, f.label)">{{ f.label }} <i>{{ f.hint }}</i></button>
      </div>
      <p class="hint">
        Client-side interlock mirrors the legacy <code>sendMotionCmd</code>: while
        disarmed the command is rejected BEFORE any network call; the server
        additionally rejects with 403 and only ever runs "supervised staging".
      </p>
    </section>

    <section class="sec">
      <h3>Waypoint jogger — joint sliders</h3>

      <div class="jbar">
        <span class="chip" [class.ok]="holdActive()">{{ holdActive() ? 'HOLDING' : 'NOT HOLDING' }}</span>
        <label class="vel">velocity
          <input type="number" [(ngModel)]="velocityDegS" min="1" max="60" step="1" />
          °/s
        </label>
        <button class="btn hold" [disabled]="!armed() || holdActive() || busy()"
                [attr.title]="jogGuardTitle() || 'jogger start — engage the adaptive seated hold (latches the current pose, zero motion)'"
                (click)="startHold()">▶ HOLD position</button>
        <button class="btn rel" [class.on]="holdActive()"
                [disabled]="!armed() || !holdActive() || busy()"
                [attr.title]="jogGuardTitle() || 'jogger stop — release to passive seated damping'"
                (click)="releaseHold()">■ RELEASE</button>
        <span class="jstat">step {{ fmt(velocityStep()) }}°/tick · {{ jogStatus() }}</span>
      </div>

      <p class="hint">
        The leftmost box shows the current angle: type a new value and press
        Set (or Enter) to walk the joint there at the configured velocity — an
        alternative to dragging the slider. Each row shows the joint's
        <b>min/max</b> soft limits under its name (typed values are clamped to
        that range). Drag a slider (or focus it and press
        ←/→ — one arrow = one velocity step);
        movement is rate-limited to the velocity above and runs in 20 Hz ticks,
        each nudge ≤ 1.0°, clamped to the per-joint soft limits of
        <code>test_h2_lowcmd_joint.py</code>. ☐ in front = same-direction group
        (≥ 2 checked → every checked joint moves with the same velocity and
        direction; the moved slider is the master). ☐ behind = mirror to the L/R
        twin (roll/yaw opposite sign, pitch/elbow same sign — the
        <code>test_h2_arm_raise_sequence.py</code> convention; e.g.
        LeftShoulderRoll + / RightShoulderRoll −).
      </p>
      <p class="hint warn">
        Server policy (robot_dashboard_server.py): all 31 joints accepted —
        each nudge ≤ 1.0° with the target clamped to the per-joint soft limits
        and a 90° per-session travel sanity from the hold baseline (the old
        ±2.0° envelope and single-joint restriction were removed 2026-10-15 on
        request). Safety floor unchanged: ARM interlock, soft limits,
        stale-lowstate watchdog, fail → release to passive; rejections are
        shown above.
      </p>

      <div class="rows">
        <div class="jrow" *ngFor="let j of jogRows">
          <span class="abs">
            <input class="absin" type="number" step="0.1"
                   [attr.min]="j.lo" [attr.max]="j.hi"
                   [value]="absValue(j)" [disabled]="!canJog()"
                   [attr.title]="jogGuardTitle() ?? ('Absolute target for ' + j.name + ' — min ' + fmt(j.lo) + '°, max ' + fmt(j.hi) + '°; type the angle in degrees and press Set (or Enter); walks there rate-limited like the slider')"
                   (input)="onAbsInput(j, $event)" (keyup.enter)="onAbsExec(j)" />
            <button class="absbtn" [disabled]="!canJog()"
                    [attr.title]="jogGuardTitle() ?? ('Move ' + j.name + ' to the typed angle (rate-limited, soft-limit clamped)')"
                    (click)="onAbsExec(j)">Set</button>
          </span>
          <label class="box" title="Same-direction group — check ≥ 2 joints and moving any of their sliders moves them all with the same velocity and direction">
            <input type="checkbox" [checked]="isGroup(j.id)" (change)="toggleGroup(j.id, $event)" />
          </label>
          <span class="jn" [title]="j.name + ' — joint_id ' + j.id + ' (' + j.group + ')'">{{ j.name }}<i class="lim">min {{ fmt(j.lo) }}° · max {{ fmt(j.hi) }}°</i></span>
          <input class="slider" type="range" step="0.1"
                 [attr.min]="j.lo" [attr.max]="j.hi"
                 [value]="rowValue(j)" [disabled]="!canJog()"
                 [attr.title]="jogGuardTitle()"
                 (input)="onSliderInput(j, $event)" (keydown)="onSliderKey(j, $event)"
                 (pointerdown)="onSliderPointerDown(j)" />
          <span class="jt">{{ shownDeg(j) }}<i *ngIf="targets()[j.id] !== undefined && liveDeg(j) !== undefined"> / {{ fmt(liveDeg(j)) }}°</i></span>
          <label class="box" [title]="mirrorTitle(j)">
            <input type="checkbox" [checked]="isMirror(j.id)"
                   [disabled]="j.mirror === undefined"
                   (change)="toggleMirror(j.id, $event)" />
          </label>
        </div>
      </div>

      <div class="wp-row">
        <input class="input" type="text"
               placeholder="waypoint name (optional — capture works disarmed, it is a read-only snapshot)"
               [(ngModel)]="wpName" />
        <button class="fsm-btn" [disabled]="busy()"
                title="Snapshot ALL joints now: POST /api/motion/capture_waypoint writes configs/poses/web_captured_<name>.yaml and the JSON below shows the same low_state values"
                (click)="captureWaypoint()">capture waypoint</button>
      </div>
      <pre class="wp-prev" *ngIf="wpPreview() as prev">{{ prev }}</pre>
      <p class="hint" *ngIf="!wpPreview()">
        A capture snapshots every joint (31 values) for trajectory mapping — the
        preview below is the exact low_state snapshot the server persists.
      </p>
    </section>

    <section class="sec">
      <h3>Captured waypoints — list, play &amp; sequence</h3>
      <div class="wpl-bar">
        <span class="chip" [class.ok]="waypoints().length > 0">{{ waypoints().length }} captured</span>
        <span class="chip seq-chip" *ngIf="seqRunning()">SEQUENCE RUNNING</span>
        <button class="fsm-btn" title="Re-read GET /api/motion/waypoints — read-only snapshot list, works while disarmed"
                (click)="refreshWaypoints()">⟳ refresh</button>
        <button class="btn run" [disabled]="!waypoints().length || seqRunning() || busy()"
                title="Play every waypoint in order, one after another; per-step status shows on each row; a failure aborts the remaining steps; STOP halts everything immediately"
                (click)="runAllWaypoints()">▶ run all sequential</button>
        <button class="btn danger stop" [disabled]="!seqRunning()"
                title="HALT the running sequence: aborts the in-flight play and never sends the remaining steps"
                (click)="stopSequence()">■ STOP</button>
      </div>
      <p class="reject wp-err" *ngIf="wpListError() as err">waypoint list unavailable: {{ err }}</p>
      <p class="hint" *ngIf="!waypoints().length && !wpListError()">
        Nothing captured yet — press "capture waypoint" above; every capture is
        appended here (read-only YAML snapshot, works while disarmed).
      </p>
      <p class="jstat" *ngIf="seqSteps().length">{{ seqSummary() }}</p>
      <div class="wp-list" *ngIf="waypoints().length">
        <div class="wp-item" *ngFor="let w of waypoints()">
          <span class="wp-name" [title]="'web_captured_' + w.name + '.yaml'">{{ w.name }}</span>
          <span class="wp-meta">{{ w.joints }} joints · {{ w.mtime * 1000 | date: 'short' }}</span>
          <span class="wp-step" *ngIf="stepFor(w.name) as st"
                [class.ok]="st.state === 'ok'" [class.bad]="st.state === 'failed'"
                [class.mid]="st.state === 'running'"
                [attr.title]="st.error ?? ('sequence step: ' + st.state)">{{ st.state }}<i *ngIf="st.error">!</i></span>
          <button class="fsm-btn wp-play" [disabled]="seqRunning() || busy()"
                  title="Play this waypoint once: POST /api/motion/execute type=waypoint — the server reads the YAML itself; requires ARM (the interlock is enforced server-side too)"
                  (click)="playWaypoint(w.name)">▶ play</button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; overflow: auto; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap; }
    h2 { font: 600 16px/1 system-ui, sans-serif; margin: 0 8px 0 0; }
    h3 { font: 600 13px/1 system-ui, sans-serif; color: #374151; margin: 0 0 8px; }
    .chip { font: 12px/1 system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
            background: #fee2e2; color: #991b1b; font-weight: 700; }
    .chip.ok { background: #d1fae5; color: #065f46; }
    .meta { font: 12px/1.4 ui-monospace, monospace; color: #6b7280; }
    .feedback { font: 12px/1.5 system-ui, sans-serif; color: #92400e; background: #fffbeb;
                border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px;
                margin: 0 14px 10px; }
    .feedback.ok { color: #065f46; background: #ecfdf5; border-color: #a7f3d0; }
    .sec { padding: 0 14px 14px; }
    .reason { font: 12px/1.5 system-ui, sans-serif; color: #6b7280; margin: 0 0 10px; }
    .arm-row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .chk { font: 12px/1.4 system-ui, sans-serif; color: #374151; display: flex; gap: 6px; align-items: center; }
    .btn { font: 600 12px/1 system-ui, sans-serif; padding: 6px 14px; border-radius: 999px;
           border: 1px solid #065f46; background: #10b981; color: #fff; cursor: pointer; }
    .btn.danger { border-color: #b91c1c; background: #ef4444; }
    .btn:disabled { opacity: .45; cursor: default; }
    .reject { font: 11px/1.5 ui-monospace, monospace; color: #b91c1c; margin: 8px 0 0; }
    .kv { display: grid; grid-template-columns: 150px 1fr; gap: 4px 12px;
          font: 12px/1.5 system-ui, sans-serif; color: #6b7280; margin-bottom: 10px; }
    .kv b { color: #111827; font-weight: 600; font-family: ui-monospace, monospace; }
    .joints { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
              gap: 6px; }
    .j { display: flex; justify-content: space-between; font: 11px/1.4 ui-monospace, monospace;
         background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 8px; }
    .j span { color: #6b7280; } .j b { color: #111827; }
    .pad { display: grid; grid-template-columns: repeat(3, 64px); gap: 6px; margin-bottom: 10px; }
    .jog { height: 46px; font-size: 1.1rem; border-radius: 8px; border: 1px solid #d1d5db;
           background: #f3f4f6; cursor: pointer; }
    .fsm { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .fsm-btn { font: 600 12px/1 system-ui, sans-serif; padding: 7px 12px; border-radius: 8px;
               border: 1px solid #9ca3af; background: #f3f4f6; color: #374151; cursor: pointer; }
    .fsm-btn i { font-style: normal; color: #9ca3af; font-size: 10px; }
    .fsm-btn:disabled { opacity: .45; cursor: default; }
    .hint { font: 11px/1.5 system-ui, sans-serif; color: #9ca3af; margin: 6px 0 0; }
    .hint code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
    .hint.warn { color: #92400e; background: #fffbeb; border: 1px solid #fde68a;
                 border-radius: 6px; padding: 6px 8px; }
    .jbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
    .vel { font: 12px/1 system-ui, sans-serif; color: #374151; display: flex; gap: 6px; align-items: center; }
    .vel input { width: 62px; font: 13px/1 ui-monospace, monospace; padding: 6px 8px;
                 border: 1px solid #d1d5db; border-radius: 8px; }
    .btn.hold { padding: 8px 16px; }
    .btn.rel { border-color: #b91c1c; background: #9ca3af; }
    .btn.rel.on { background: #ef4444; }
    .jstat { font: 11px/1.4 ui-monospace, monospace; color: #6b7280; }
    .rows { display: flex; flex-direction: column; gap: 3px; margin: 8px 0; }
    .jrow { display: grid; grid-template-columns: 92px 26px 148px 1fr 104px 26px; gap: 8px;
            align-items: center; background: #f9fafb; border: 1px solid #e5e7eb;
            border-radius: 6px; padding: 3px 8px; }
    .abs { display: flex; gap: 3px; align-items: center; }
    .absin { width: 100%; min-width: 0; font: 11px/1 ui-monospace, monospace;
             padding: 5px 4px; border: 1px solid #d1d5db; border-radius: 6px; }
    .absin:disabled { background: #f3f4f6; }
    .absbtn { font: 600 10px/1 system-ui, sans-serif; padding: 6px 6px; border-radius: 6px;
              border: 1px solid #2563eb; background: #2563eb; color: #fff; cursor: pointer; }
    .absbtn:disabled { opacity: .45; cursor: default; }
    .jn { font: 11px/1.4 ui-monospace, monospace; color: #374151; display: flex;
          flex-direction: column; overflow: hidden; white-space: nowrap; }
    .jn i.lim { font: 9.5px/1.3 ui-monospace, monospace; color: #9ca3af;
                font-style: normal; white-space: nowrap; }
    .jt { font: 11px/1.4 ui-monospace, monospace; color: #111827; text-align: right; }
    .jt i { color: #9ca3af; font-style: normal; }
    .slider { width: 100%; accent-color: #2563eb; }
    .box { display: flex; justify-content: center; cursor: pointer; }
    .box input { accent-color: #2563eb; margin: 0; }
  `],
})
export class MotionComponent implements OnInit, OnDestroy {
  readonly lock = signal<SafetyLock | null>(null);
  readonly online = signal(false);
  readonly packets = signal(0);
  readonly imu = signal<Imu | null>(null);
  readonly joints = signal<Joint[]>([]);
  readonly feedback = signal<string | null>(null);
  readonly feedbackOk = signal(false);
  readonly busy = signal(false);
  readonly fsmPresets = FSM_PRESETS;
  readonly jogPad = JOG_PAD;
  readonly jogRows = JOINT_TABLE;
  /** server-side seated hold state (jogger start/stop responses) */
  readonly holdActive = signal(false);
  /** front checkboxes: same-direction group */
  readonly groupSel = signal<ReadonlySet<number>>(new Set<number>());
  /** rear checkboxes: mirror onto the L/R twin */
  readonly mirrorSel = signal<ReadonlySet<number>>(new Set<number>());
  /** commanded target per joint (deg) — what the sliders show while holding */
  readonly targets = signal<Record<number, number>>({});
  /** absolute SET box entries (raw text per joint) while composing a value */
  readonly absEdit = signal<Record<number, string>>({});
  /** live low_state positions per joint_id (deg) */
  readonly liveById = signal<Record<number, number>>({});
  /** last movement/nudge status line */
  readonly jogStatus = signal('');
  /** copyable JSON preview of the last captured waypoint */
  readonly wpPreview = signal<string | null>(null);
  /** GET /api/motion/waypoints — captured waypoint list (server: newest first) */
  readonly waypoints = signal<MotionWaypoint[]>([]);
  /** transport/parse error of the last list fetch (null = list healthy) */
  readonly wpListError = signal<string | null>(null);
  /** per-step outcomes of the current/last "run all" sequence */
  readonly seqSteps = signal<WaypointStep[]>([]);
  /** true while a sequence runs — blocks single plays + run-all re-entry */
  readonly seqRunning = signal(false);
  confirmSafe = false;
  wpName = '';
  /** global velocity entry (deg/s) */
  velocityDegS: number = DEFAULT_VELOCITY_DEG_S;

  readonly armed = computed(() => !!this.lock()?.armed);

  /** one-line progress of the sequence runner (counters + the active step) */
  readonly seqSummary = computed(() => {
    const steps = this.seqSteps();
    if (!steps.length) return '';
    const n = (state: WaypointStepState) =>
      steps.filter((s) => s.state === state).length;
    const bits: string[] = [];
    for (const state of ['ok', 'failed', 'stopped', 'skipped',
                         'running', 'pending'] as const) {
      const c = n(state);
      if (c) bits.push(`${c} ${state}`);
    }
    const running = steps.find((s) => s.state === 'running');
    return `sequence ${steps.length} steps — ${bits.join(', ')}`
      + (running ? ` · playing '${running.name}'` : '');
  });
  readonly jogSelection = computed<JogSelection>(() => ({
    group: this.groupSel(),
    mirror: this.mirrorSel(),
  }));

  /** the position the master slider is currently approaching (null = idle) */
  private desired: { id: number; value: number } | null = null;
  /** row whose slider is being pointer-dragged (binding follows the finger) */
  private dragId: number | null = null;
  private nudgeQ: NudgeReq[] = [];
  private nudgeSending = false;
  /** abort handle of the running sequence (STOP → next() + complete()) */
  private seqAbort$: Subject<void> | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // safety lock: immediate + slow refresh
    this.poll(API.motion.safetyLock.path, 15_000).subscribe((s) => {
      if (s) this.lock.set(s as SafetyLock);
    });
    // live state: telemetry.low_state (2 s like legacy fetchTelemetry)
    this.poll<Telemetry>(API.telemetry.get.path, TELEMETRY_MS)
      .subscribe((t) => this.applyTelemetry(t));
    // captured waypoint list (read-only — works disarmed; refreshed again
    // after every capture so a new one shows up immediately)
    this.refreshWaypoints();
    // 20 Hz movement tick — the ONLY place nudges are produced (≤ 20 bursts/s)
    interval(JOG_TICK_MS).pipe(takeUntil(this.destroy$)).subscribe(() => this.tick());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  fmt(v: number | undefined): string {
    return v !== undefined ? v.toFixed(1) : '—';
  }

  deg(rad: number | undefined): string {
    return rad !== undefined ? (rad * 180 / Math.PI).toFixed(1) : '—';
  }

  short(name: string): string {
    return name.replace('_joint', '').replace(/^(left|right)_/, '');
  }

  // ---- waypoint jogger: state views ---------------------------------------

  /** Movement gate: ARMED + HOLD active (the server enforces both too). */
  canJog(): boolean {
    return this.armed() && this.holdActive();
  }

  /** Exact title for every disabled jog control (spec: exact title). */
  jogGuardTitle(): string | null {
    if (!this.armed()) return JOG_INTERLOCK_TITLE;
    if (!this.holdActive()) return JOG_HOLD_TITLE;
    return null;
  }

  velocity(): number {
    return sanitizeVelocity(this.velocityDegS);
  }

  /** degrees the configured velocity covers per 20 Hz tick (= arrow-key step) */
  velocityStep(): number {
    return velocityStepDeg(this.velocity());
  }

  liveDeg(j: JogJoint): number | undefined {
    return this.liveById()[j.id];
  }

  /** Value cell: commanded target while holding, else the measured position;
   * '—' until anything real is known (offline range sliders sit mid-track). */
  shownDeg(j: JogJoint): string {
    if (this.targets()[j.id] !== undefined) return `${this.fmt(this.rowValue(j))}°`;
    const l = this.liveDeg(j);
    return l !== undefined ? `${this.fmt(l)}°` : '—';
  }

  /** Slider position: while dragging the master, the finger's desired value;
   * otherwise the commanded target (falls back to live telemetry / range mid). */
  rowValue(j: JogJoint): number {
    if (this.dragId === j.id && this.desired && this.desired.id === j.id) {
      return clampToLimits(j, this.desired.value);
    }
    return this.effTarget(j);
  }

  isGroup(id: number): boolean {
    return this.groupSel().has(id);
  }

  isMirror(id: number): boolean {
    return this.mirrorSel().has(id);
  }

  toggleGroup(id: number, ev: Event): void {
    const next = new Set(this.groupSel());
    if ((ev.target as HTMLInputElement).checked) next.add(id);
    else next.delete(id);
    this.groupSel.set(next);
  }

  toggleMirror(id: number, ev: Event): void {
    const next = new Set(this.mirrorSel());
    if ((ev.target as HTMLInputElement).checked) next.add(id);
    else next.delete(id);
    this.mirrorSel.set(next);
  }

  mirrorTitle(j: JogJoint): string {
    if (j.mirror === undefined) {
      return `No L/R mirror pair — ${j.name} is a single central joint`;
    }
    const twin = JOINT_BY_ID.get(j.mirror);
    return `Mirror to ${twin ? twin.name : j.mirror}: move this slider and the twin `
      + 'follows mirrored (roll/yaw opposite sign, pitch/elbow same sign)';
  }

  // ---- waypoint jogger: input ---------------------------------------------

  /** pointer down on a slider: remember the row so the value follows the finger */
  onSliderPointerDown(j: JogJoint): void {
    if (!this.canJog()) return;
    this.dragId = j.id;
  }

  @HostListener('window:pointerup')
  onPointerUp(): void {
    this.dragId = null;
  }

  /** mouse/wheel/drag: the slider position is the master's DESIRED value; the
   * 20 Hz tick walks the target there at the configured velocity. */
  onSliderInput(j: JogJoint, ev: Event): void {
    if (!this.canJog()) return;
    const v = Number((ev.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    this.ensureSeeded();
    this.clearAbs(j.id);
    this.desired = { id: j.id, value: clampToLimits(j, v) };
  }

  /** arrow keys = one velocity step (velocity × tick, default 1.0°). The
   *  default range-key behavior is suppressed so the step is exact. */
  onSliderKey(j: JogJoint, ev: Event): void {
    if (!this.canJog()) return;
    const e = ev as KeyboardEvent;
    let dir = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') dir = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') dir = -1;
    else return;
    e.preventDefault();
    this.ensureSeeded();
    this.clearAbs(j.id);
    const base = this.effTarget(j);
    this.desired = {
      id: j.id,
      value: clampToLimits(j, base + dir * velocityStepDeg(this.velocity())),
    };
  }

  // ---- waypoint jogger: absolute SET box (first column) -------------------

  /** Set-box value: the raw typed entry while there is one, else the row's
   * current degrees (commanded target / live position — same as the slider). */
  absValue(j: JogJoint): string | number {
    const e = this.absEdit()[j.id];
    return e !== undefined ? e : Math.round(this.rowValue(j) * 10) / 10;
  }

  /** typing stores the raw text (no value fighting mid-number); the box stops
   * mirroring the row until Set/Enter or the next slider gesture. */
  onAbsInput(j: JogJoint, ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    this.absEdit.set({ ...this.absEdit(), [j.id]: raw });
  }

  /** Set/Enter = walk the joint to the typed angle through the SAME 20 Hz
   * tick as the slider: soft-limit clamped, velocity-limited, ≤ 1.0° nudges,
   * group/mirror composition applied. Out-of-range input is clamped. */
  onAbsExec(j: JogJoint): void {
    if (!this.canJog()) return;
    const raw = this.absEdit()[j.id];
    this.clearAbs(j.id);
    if (raw !== undefined && raw.trim() === '') return;    // empty box = resync
    const v = raw !== undefined ? Number(raw) : this.rowValue(j);
    if (!Number.isFinite(v)) return;
    const target = clampToLimits(j, v);
    this.ensureSeeded();
    this.desired = { id: j.id, value: target };
    this.jogStatus.set(`set ${j.name} → ${target.toFixed(1)}°`);
  }

  /** drop a stale SET-box entry so the box mirrors the row again. */
  private clearAbs(id: number): void {
    if (!(id in this.absEdit())) return;
    const next = { ...this.absEdit() };
    delete next[id];
    this.absEdit.set(next);
  }

  // ---- waypoint jogger: hold / release / capture --------------------------

  /** HOLD = jogger start = adaptive gravity-comp seated hold (latches pose). */
  startHold(): void {
    if (!this.guard('jogger start (HOLD)')) return;
    this.post(API.motion.joggerStart.path, {}, 'jogger start (HOLD)', (res) => {
      const on = !!res.success && res.active !== false;
      this.holdActive.set(on);
      this.desired = null;
      this.absEdit.set({});
      if (on) {
        // seed the sliders from a FRESH low_state so client targets and the
        // server's latched hold_positions start from the same pose
        this.refreshJoints(() => this.snapshotTargets());
      }
    });
  }

  /** RELEASE = jogger stop = passive seated damping. */
  releaseHold(): void {
    if (!this.guard('jogger stop (RELEASE)')) return;
    this.post(API.motion.joggerStop.path, {}, 'jogger stop (RELEASE)', (res) => {
      if (res.success) {
        this.holdActive.set(false);
        this.desired = null;
        this.nudgeQ.length = 0;
        this.jogStatus.set('');
      }
    });
  }

  /** Waypoint capture: read-only snapshot of ALL joints. The backend has no
   *  arm gate on this route, so it works disarmed; the preview is built from
   *  the same low_state the server writes to configs/poses/. */
  captureWaypoint(): void {
    const name = this.wpName.trim() || `waypoint_${Date.now()}`;
    const jointsDeg: Record<string, number> = {};
    for (const j of this.joints()) {
      const v = typeof j.q_deg === 'number' ? j.q_deg
        : typeof j.q_rad === 'number' ? Math.round((j.q_rad * 180) / Math.PI * 100) / 100
        : undefined;
      if (v !== undefined && Number.isFinite(v)) jointsDeg[j.name] = v;
    }
    this.post(API.motion.captureWaypoint.path, { name }, `capture ${name}`, (res) => {
      this.wpPreview.set(res.success
        ? JSON.stringify({
            name,
            timestamp: new Date().toISOString(),
            joints_deg: jointsDeg,
          }, null, 2)
        : null);
      // add-to-list flow: the new capture appears immediately (read-only GET)
      if (res.success) this.refreshWaypoints();
    });
  }

  // ---- captured waypoints: list, single play, sequential run + STOP --------

  /** GET /api/motion/waypoints — read-only list (works disarmed). Fail-soft:
   *  on any transport/parse error the previous list stays intact and an error
   *  chip appears; the tab never breaks (robot LAN down is the normal case). */
  refreshWaypoints(): void {
    this.http.get<MotionWaypointList>(API.motion.waypoints.path).pipe(
      takeUntil(this.destroy$),
      catchError((e: unknown) => {
        this.wpListError.set(httpErrorText(e));
        return of<MotionWaypointList | null>(null);
      }),
    ).subscribe((res) => {
      if (!res) return;                       // error already surfaced above
      this.wpListError.set(null);
      this.waypoints.set(Array.isArray(res.waypoints) ? res.waypoints : []);
    });
  }

  /** The sequence step chip for one row (undefined = never part of a run). */
  stepFor(name: string): WaypointStep | undefined {
    return this.seqSteps().find((s) => s.name === name);
  }

  /** ONE waypoint: same guarded execute path as jog/FSM — blocked client-side
   *  while disarmed (legacy parity) AND rejected server-side with the lock
   *  reason; post() surfaces either outcome in the feedback line. */
  playWaypoint(name: string): void {
    if (this.seqRunning()) return;
    if (!this.guard(`play waypoint ${name}`)) return;
    this.post(API.motion.execute.path,
      { type: 'waypoint', name, desc: `waypoint ${name}` },
      `play ${name}`);
  }

  /** RUN ALL: play every waypoint in list order, one after another (each play
   *  starts when the previous one answered — client-chained). A failed step
   *  aborts the rest (marked skipped); STOP halts everything immediately. */
  runAllWaypoints(): void {
    if (this.seqRunning()) return;
    const names = this.waypoints().map((w) => w.name);
    if (!names.length) {
      this.feedbackOk.set(false);
      this.feedback.set('No waypoints captured yet — capture at least one first.');
      return;
    }
    if (!this.guard('run all waypoints')) return;
    this.seqSteps.set(names.map((name) => ({ name, state: 'pending' as const })));
    this.seqRunning.set(true);
    const abort$ = new Subject<void>();
    this.seqAbort$ = abort$;
    this.runStep(0, names.length, abort$);
  }

  /** Halt a running sequence NOW: unsubscribes the in-flight play (the
   *  browser aborts the request) and marks every unfinished step stopped —
   *  no further play is ever sent after this returns. */
  stopSequence(): void {
    const abort$ = this.seqAbort$;
    if (!abort$) return;
    this.seqAbort$ = null;
    abort$.next();
    abort$.complete();
    this.seqSteps.update((steps) => steps.map((s) =>
      s.state === 'running' || s.state === 'pending'
        ? { ...s, state: 'stopped' as const } : s));
    this.seqRunning.set(false);
    const steps = this.seqSteps();
    const ok = steps.filter((s) => s.state === 'ok').length;
    this.feedbackOk.set(false);
    this.feedback.set(
      `STOPPED (run all): sequence halted — ${ok} ok of ${steps.length}, `
      + 'remaining steps not sent');
    this.pollOnce();
  }

  /** One sequence step: play, then chain the next (success) or abort the
   *  rest (failure — remaining steps are marked skipped). */
  private runStep(index: number, total: number, abort$: Subject<void>): void {
    if (this.seqAbort$ !== abort$) return;          // STOP raced us
    const step = this.seqSteps()[index];
    if (!step) {
      this.finishSequence(true, `ACK (run all): ${total}/${total} waypoints ok`);
      return;
    }
    this.patchStep(index, { state: 'running' });
    this.playReq(step.name).pipe(takeUntil(abort$)).subscribe((res) => {
      if (this.seqAbort$ !== abort$) return;        // STOP raced the response
      if (res.success) {
        this.patchStep(index, { state: 'ok' });
        this.runStep(index + 1, total, abort$);
        return;
      }
      const err = res.error ?? res.message ?? 'failed';
      this.patchStep(index, { state: 'failed', error: err });
      this.markRemaining(index + 1, 'skipped');
      this.finishSequence(false,
        `REJECTED (run all): step ${index + 1}/${total} '${step.name}' `
        + `failed: ${err}`);
    });
  }

  /** The one POST every play goes through (sequence path — no busy flag so
   *  steps can chain; HTTP/interlock errors normalised to a CmdRes body). */
  private playReq(name: string): Observable<CmdRes> {
    return this.http.post<CmdRes>(API.motion.execute.path,
      { type: 'waypoint', name, desc: `waypoint ${name}` }).pipe(
      catchError((e: unknown) => of(cmdErrorRes(e))),
    );
  }

  private patchStep(index: number, patch: Partial<WaypointStep>): void {
    this.seqSteps.update((steps) => steps.map((s, i) =>
      i === index ? { ...s, ...patch } : s));
  }

  private markRemaining(from: number, state: WaypointStepState): void {
    this.seqSteps.update((steps) => steps.map((s, i) =>
      i >= from && s.state === 'pending' ? { ...s, state } : s));
  }

  private finishSequence(ok: boolean, message: string): void {
    const abort$ = this.seqAbort$;
    this.seqAbort$ = null;
    if (abort$) abort$.complete();
    this.seqRunning.set(false);
    this.feedbackOk.set(ok);
    this.feedback.set(message);
    this.pollOnce();
  }

  // ---- waypoint jogger: movement tick + nudge queue ------------------------

  private tick(): void {
    if (!this.armed() || !this.holdActive()) {
      if (this.desired) this.desired = null;
      if (this.nudgeQ.length) this.nudgeQ.length = 0;
      return;
    }
    if (!this.desired) return;
    // back-pressure: pause while the drain catches up (server is never flooded)
    if (this.nudgeQ.length > NUDGE_QUEUE_LIMIT) return;

    const j = JOINT_BY_ID.get(this.desired.id);
    if (!j) { this.desired = null; return; }
    this.ensureSeeded();

    const target = this.effTarget(j);
    const applied = approachStep(j, target, this.desired.value, this.velocity());
    if (applied === 0) { this.desired = null; return; }   // at limit / arrived

    // group + mirror composition (pure, unit-tested in jogger.model.spec.ts)
    const steps = computeJointSteps(j.id, applied, this.jogSelection());
    const tq = { ...this.targets() };
    const nudges: NudgeReq[] = [];
    for (const [id, s] of steps) {
      const jt = JOINT_BY_ID.get(id);
      if (!jt) continue;
      const cur = this.effTarget(jt);
      const a = clampStep(jt, cur, s);          // soft-limit clamp (script parity)
      if (a === 0) continue;
      tq[id] = cur + a;
      for (const d of chunkStep(a)) {           // ≤ 1.0° per server request
        nudges.push({ joint_id: id, delta_deg: d });
      }
    }
    this.targets.set(tq);

    const masterNow = tq[j.id];
    if (masterNow === undefined || Math.abs(masterNow - this.desired.value) < 1e-6) {
      this.desired = null;                       // master arrived → movement done
    }
    this.enqueueNudges(nudges);
  }

  private enqueueNudges(nudges: NudgeReq[]): void {
    if (!nudges.length) return;
    this.nudgeQ.push(...nudges);
    this.drainNudges();
  }

  /** Serial drain: one nudge in flight at a time. Any rejection (interlock 403,
   *  server policy) stops the movement and clears the queue immediately. */
  private drainNudges(): void {
    if (this.nudgeSending) return;
    const n = this.nudgeQ.shift();
    if (!n) return;
    this.nudgeSending = true;
    this.http.post<CmdRes>(API.motion.nudge.path, n).pipe(
      catchError((e: unknown) => of(cmdErrorRes(e))),
    ).subscribe((res) => {
      this.nudgeSending = false;
      if (!res.success) {
        this.desired = null;
        this.nudgeQ.length = 0;
        this.feedbackOk.set(false);
        this.feedback.set(
          `REJECTED (nudge ${n.joint_id} ${n.delta_deg > 0 ? '+' : ''}`
          + `${n.delta_deg.toFixed(2)}°): ${res.error ?? res.message ?? 'failed'}`);
        this.pollOnce();
        return;
      }
      const name = JOINT_BY_ID.get(n.joint_id)?.name ?? `joint ${n.joint_id}`;
      this.jogStatus.set(
        `nudged ${name} ${n.delta_deg > 0 ? '+' : ''}${n.delta_deg.toFixed(2)}°`);
      this.drainNudges();
    });
  }

  /** Full target snapshot from the freshest live positions (hold start). */
  private snapshotTargets(): void {
    const live = this.liveById();
    const t: Record<number, number> = {};
    for (const j of JOINT_TABLE) {
      const l = live[j.id];
      t[j.id] = clampToLimits(j, l !== undefined ? l : (j.lo + j.hi) / 2);
    }
    this.targets.set(t);
  }

  /** Lazily snapshot before the first gesture (e.g. hold already active from
   *  a previous page load). */
  private ensureSeeded(): void {
    if (Object.keys(this.targets()).length >= JOINT_TABLE.length) return;
    this.snapshotTargets();
  }

  private effTarget(j: JogJoint): number {
    const t = this.targets()[j.id];
    if (t !== undefined) return clampToLimits(j, t);
    const l = this.liveById()[j.id];
    return clampToLimits(j, l !== undefined ? l : (j.lo + j.hi) / 2);
  }

  // ---- guarded commands (unchanged parity gate) ----------------------------

  /** Legacy sendMotionCmd client gate: block BEFORE any network call. */
  private guard(desc: string): boolean {
    if (this.armed()) return true;
    this.feedbackOk.set(false);
    this.feedback.set(
      `BLOCKED: Command '${desc}' rejected by Safety Interlock (Robot not armed).`);
    return false;
  }

  sendJog(b: JogBtn): void {
    const desc = b.stop ? 'Emergency Zero Velocity'
      : b.vy ? (b.vy > 0 ? 'Strafe Left 0.2m/s' : 'Strafe Right 0.2m/s')
      : (b.vx > 0 ? 'Forward 0.2m/s' : 'Backward 0.2m/s');
    if (!this.guard(desc)) return;
    this.execute('jog', { vx: b.vx, vy: b.vy, vyaw: 0, desc });
  }

  sendFsm(id: number, label: string): void {
    if (!this.guard(`${label} (FSM ${id})`)) return;
    this.execute('fsm', { fsm_id: id, desc: `${label} (FSM ${id})` });
  }

  toggleArm(): void {
    if (this.busy()) return;
    const next = !this.armed();
    if (next && !this.confirmSafe) {
      this.feedbackOk.set(false);
      this.feedback.set('Safety Warning: check the confirmation checkbox '
        + '(robot suspended/safe) before arming.');
      return;
    }
    // NOTE: do NOT set busy here — post() owns it. (Bug fixed 2026-10-15:
    // setting busy before post() made post()'s `if (this.busy()) return`
    // swallow the request entirely — ARM never reached the server and busy
    // stayed true, disabling the whole panel.)
    const body = next
      ? { armed: true, confirm_robot_suspended_or_safe: true }
      : { armed: false };
    this.post(API.motion.safetyLockToggle.path, body,
      next ? 'arming' : 'disarming', (res) => {
        if (res.success) this.confirmSafe = false;
        this.refreshLock();
      });
  }

  /** SAFE: release the robot's motion service (MotionSwitcher.ReleaseMode) —
   * the dashboard form of `python3 h2_state_control.py --release`. Makes the
   * robot passive; never a motion command; allowed while DISARMED. */
  releaseMotionService(): void {
    this.post(API.motion.motionServiceRelease.path, {}, 'motion-service release',
      () => this.refreshLock());
  }

  // ---- plumbing -----------------------------------------------------------

  private execute(type: string, params: Record<string, unknown>): void {
    this.post(API.motion.execute.path, { type, ...params },
      `exec ${type}: ${(params['desc'] as string) ?? ''}`);
  }

  private post(url: string, body: unknown, label: string,
               after?: (res: CmdRes) => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.http.post<CmdRes>(url, body).pipe(
      catchError((e: unknown) => of(cmdErrorRes(e))),
    ).subscribe((res) => {
      this.busy.set(false);
      this.feedbackOk.set(!!res.success);
      this.feedback.set(res.success
        ? `ACK (${label}): ${res.message ?? 'ok'}`
        : `REJECTED (${label}): ${res.error ?? res.message ?? 'failed'}`);
      if (after) after(res);
      this.pollOnce();
    });
  }

  private applyTelemetry(t: Telemetry | null): void {
    if (!t) return;
    const ls = t.low_state;
    if (!ls) return;
    this.online.set(!!ls.online);
    this.packets.set(ls.packet_count ?? 0);
    this.imu.set(ls.imu ?? null);
    this.joints.set(ls.joints ?? []);
    if (ls.safety_lock) this.lock.set(ls.safety_lock);   // authoritative live flag
    // live positions keyed by joint_id (the nudge `joint_id` ↔ name mapping)
    const live: Record<number, number> = {};
    for (const j of ls.joints ?? []) {
      const id = typeof j.id === 'number' ? j.id
        : JOINT_TABLE.find((t2) => t2.name === j.name)?.id;
      if (id === undefined) continue;
      const v = typeof j.q_deg === 'number' ? j.q_deg
        : typeof j.q_rad === 'number' ? (j.q_rad * 180) / Math.PI
        : undefined;
      if (v !== undefined && Number.isFinite(v)) live[id] = v;
    }
    if (Object.keys(live).length) this.liveById.set(live);
  }

  private refreshJoints(then?: () => void): void {
    this.poll<Telemetry>(API.telemetry.get.path, 0).subscribe((t) => {
      this.applyTelemetry(t);
      if (then) then();
    });
  }

  private refreshLock(): void {
    this.poll<SafetyLock>(API.motion.safetyLock.path, 0).subscribe((s) => {
      if (s) this.lock.set(s as SafetyLock);
    });
  }

  private pollOnce(): void {
    this.poll<Telemetry>(API.telemetry.get.path, 0).subscribe((t) => {
      const ls = t?.low_state;
      if (ls?.safety_lock) this.lock.set(ls.safety_lock);
    });
  }

  /** immediate-first + periodic JSON GET poll (offline-safe). */
  private poll<T>(url: string, periodMs: number): Observable<T | null> {
    const src = periodMs > 0 ? concat(of(0), interval(periodMs)) : of(0);
    return src.pipe(
      takeUntil(this.destroy$),
      exhaustMap(() => this.http.get<T>(url).pipe(
        catchError((e: unknown) => {
          this.feedbackOk.set(false);
          this.feedback.set(`GET ${url}: ${httpErrorText(e)}`);
          return of(null);
        }),
      )),
    );
  }
}
