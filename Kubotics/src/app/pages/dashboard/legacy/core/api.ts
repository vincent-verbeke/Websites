import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Typed API client — Phase 1 foundation (plan §3.1: 21 HTTP routes =
 * 8 GET + 13 POST, verified against the legacy owner
 * scripts/monitoring/dashboard/robot_dashboard_server.py).
 *
 * Rules of the house:
 *  * components NEVER write a raw "/api/…" string — they use `API.*` (the
 *    contract test in api.spec.ts greps the feature sources to enforce it)
 *  * every route is one exported const: `{ method, path }`
 *  * DTOs live here (moved from the tabs that first declared them); tabs
 *    re-export the ones their templates used to own
 *  * `apiGet` / `apiPost` are thin HttpClient wrappers returning typed
 *    Observables — OFFLINE handling (catchError) stays in the components
 */

export type HttpMethod = 'GET' | 'POST';

/** One HTTP route: method + path (never a magic string in a component). */
export interface ApiRoute {
  readonly method: HttpMethod;
  readonly path: string;
}
export interface ApiGetRoute extends ApiRoute {
  readonly method: 'GET';
}
export interface ApiPostRoute extends ApiRoute {
  readonly method: 'POST';
}

const GET = (path: string): ApiGetRoute => ({ method: 'GET', path });
const POST = (path: string): ApiPostRoute => ({ method: 'POST', path });

/** The route inventory.
 *
 * Legacy 21-route surface (plan §3.1 — 8 GET + 13 POST): telemetry, training,
 * motion.{safety_lock,execute,jogger/*,nudge,capture_waypoint,
 * safety_lock/toggle}, services, service.{toggle,voice_bot/*}, system.
 * {versions,check_update,upgrade}, ollama.{models,pull}, video.{left,right},
 * power.set.
 * Host-local extras served by FastAPI (web/server/app.py, not part of the
 * legacy §3.1 inventory): chat.*, packs.list, vision.*. */
export const API = {
  /** GET /api/telemetry — the aggregate (thermals, robot state, voice,
   * lowstate, lidar, RL training, pull status). */
  telemetry: { get: GET('/api/telemetry') },
  /** GET /api/training — PC3 RL training status.
   * GET /api/training/cloud — host-local SageMaker picture (jobs, progress,
   *   cost); degrades to HTTP 200 {..., error} when the AWS CLI is absent.
   * POST /api/training/cloud/stop — THE single mutating cloud route: stops
   *   the named recent non-terminal job (400 otherwise). */
  training: {
    get: GET('/api/training'),
    cloud: GET('/api/training/cloud'),
    cloudStop: POST('/api/training/cloud/stop'),
  },

  /** GET /api/services — APP_SERVICES catalog ({[key]: ServiceInfo}). */
  services: { get: GET('/api/services') },
  /** /api/service/* — Unitree app microservices. */
  service: {
    toggle: POST('/api/service/toggle'),
    voiceBotStart: POST('/api/service/voice_bot/start'),
    voiceBotStop: POST('/api/service/voice_bot/stop'),
  },

  /** /api/motion/* — all guarded by the server-side safety interlock.
   * waypoints (GET, added 2026-10-17) is READ-ONLY (lists the captured
   * web_captured_*.yaml pose files) and served by the same legacy owner;
   * playing one rides execute with {type:'waypoint', name}. */
  motion: {
    safetyLock: GET('/api/motion/safety_lock'),
    safetyLockToggle: POST('/api/motion/safety_lock/toggle'),
    execute: POST('/api/motion/execute'),
    joggerStart: POST('/api/motion/jogger/start'),
    joggerStop: POST('/api/motion/jogger/stop'),
    nudge: POST('/api/motion/nudge'),
    captureWaypoint: POST('/api/motion/capture_waypoint'),
    /** GET /api/motion/waypoints — captured-waypoint list (name, mtime,
     * joint count), newest first. Read-only; works while disarmed. */
    waypoints: GET('/api/motion/waypoints'),
    /** SAFE, always-allowed: releases the robot's motion service (e.g. 'ai')
     * via MotionSwitcher.ReleaseMode — the dashboard equivalent of
     * `python3 scripts/motion/h2_state_control.py --release`. Never moves the
     * robot (makes it passive); does NOT require the ARM interlock. */
    motionServiceRelease: POST('/api/motion/motion_service/release'),
  },

  /** /api/system/* — version inventory + OTA. */
  system: {
    versions: GET('/api/system/versions'),
    checkUpdate: POST('/api/system/check_update'),
    upgrade: POST('/api/system/upgrade'),
  },

  /** /api/ollama/* — PC3 model registry. */
  ollama: {
    models: GET('/api/ollama/models'),
    pull: POST('/api/ollama/pull'),
  },

  /** /api/video/* — MJPEG eye streams (multipart/x-mixed-replace). */
  video: {
    left: GET('/api/video/left'),
    right: GET('/api/video/right'),
  },

  /** /api/vision/* — H2 stereo pipeline (host-local, FastAPI web/server/
   * vision_pipeline.py): live service state (video_hub, stereo_patch_pc1),
   * the ONE-CLICK bring-up (stop video_hub -> start stereo_patch_pc1 -> aim
   * receiver IP -> restart -> verify RTP), separate per-service toggles, and
   * the 3 MJPEG streams from the stereo patch (binocular 5002, left 5004,
   * right 5006 — the legacy /api/video/* feeds come from videohub instead).
   * GET /api/vision/stream/{name} is multipart/x-mixed-replace MJPEG. */
  vision: {
    status: GET('/api/vision/status'),
    pipelineStart: POST('/api/vision/pipeline/start'),
    serviceToggle: POST('/api/vision/service/toggle'),
    stream: {
      binocular: GET('/api/vision/stream/binocular'),
      left: GET('/api/vision/stream/left'),
      right: GET('/api/vision/stream/right'),
    },
  },

  /** POST /api/power/set — PC3 power mode ({mode_id}). */
  power: { set: POST('/api/power/set') },

  // ---- host-local routes (FastAPI web/server/app.py, NOT §3.1 inventory) --
  /** GET /api/chat/state — agent↔web chat store (web/chat/state.json).
   * GET /api/chat/inbox — read-only WhatsApp inbox (web/chat/inbox.json). */
  chat: {
    state: GET('/api/chat/state'),
    prompt: POST('/api/chat/prompt'),
    reply: POST('/api/chat/reply'),
    inbox: GET('/api/chat/inbox'),
  },
  /** /api/mail/watchers — the Kubot mail-watch sender allowlist (Vincent
   * 2026-10-22: dashboard-managed, polled by PC-A's pure-script 10-min timer
   * — never an LLM). GET → { senders[], pending[{qid,from,subject,state}] }
   * (fail-soft: queue file missing → pending []). POST {action, address} →
   * updated senders (400 bad action/address, cap 50; add dedupes, remove is
   * idempotent — a removed address simply stops being polled). */
  mailWatch: {
    get: GET('/api/mail/watchers'),
    update: POST('/api/mail/watchers'),
  },
  /** /api/sessions — WhatsApp session runtime (2026-10-17, design doc §10).
   * GET list → the session table (session_cmd.py status), READ-ONLY.
   * POST send → the tab's send box — the ONLY mutating session route the web
   * app exposes (400 bad name/msg · 404 unknown · 409 CLOSED · 202 dispatched;
   * `session_cmd.py send` then runs in the background). POST close → the
   * dashboard close button (Vincent 2026-10-18 13:13 — his earlier
   * "WhatsApp-only close" rule changed): one click, lands in the same
   * `session_cmd.py confirm` as `#<name> final close` (404 unknown · 409
   * already CLOSED · 200 closed). NO validate route ever. */
  sessions: {
    list: GET('/api/sessions'),
    send: POST('/api/sessions/{name}/send'),
    close: POST('/api/sessions/{name}/close'),
  },
  /** /api/ha — Home Assistant bridge (web/server/ha_bridge.py, Vincent
   * 2026-10-18 13:53): overview = devices (on/off) + scenes + scripts +
   * automations as click-buttons; act = one action per click. Behind the
   * auth gate + wall like every other mutating route. */
  ha: {
    overview: GET('/api/ha/overview'),
    act: POST('/api/ha/act'),
  },
  /** /api/investments — Investments tab (Vincent 2026-10-20 proposal:
   *  status per sleeve + % of capital + YTD / Last Year / Total with
   *  values and %, color-graded; buy value listed; fail-soft READ-ONLY).
   *  POST /api/investments/run (2026-10-23: 'start via the dashboard'):
   *  mode=check gates+state only; mode=run = full daily run (auth prompt
   *  in the script, button = his go). Returns {rc, mode, output}. */
  investments: {
    get: GET('/api/investments'),
    run: POST('/api/investments/run'),
    /** GET /api/investments/ticker (2026-10-24, Vincent: "live price
     *  ticker … both endpoints need rate limits"): live last vs previous
     *  session close per sleeve (20 s upstream cache, 30/min per client).
     * POST /api/investments/buy {key}: the row Buy button — spawns
     *  daily_invest.py --only KEY (LIMIT at the live last, never over;
     *  click + confirm = the approval; 6/min + the shared run lock). */
    ticker: GET('/api/investments/ticker'),
    /** GET /api/investments/ibkr (2026-10-25: "update the data on the
     *  dashboard live from IBKR"): READ-ONLY live gateway picture — auth
     *  flag, account summary (equity/cash) and positions over the local CP
     *  tunnel; fail-soft 200 ALWAYS (reachable:false when the tunnel is
     *  down), rate-limited 30/min per client. */
    ibkr: GET('/api/investments/ibkr'),
    buy: POST('/api/investments/buy'),
  },
  /** GET /api/packs — backend policy packs (zip files; a pack is fetched as
   * `${API.packs.list.path}/<name>`). */
  packs: { list: GET('/api/packs') },
  /** GET /api/replay — published *.npz eval replays in the served dir (host-
   * local, read-only, newest first). GET /api/replay/{name} — one npz decoded
   * to frames × 31 hinges + base poses for the /twin replay viewer; the
   * component substitutes `{name}` (encodeURIComponent).
   * GET /h2_replay/latest_replay.html — host-local alias serving the NEWEST
   * `*_replay.html` of the same dir by mtime ("always latest"); the /twin
   * page embeds it in an iframe under the 3D viewport (registered before the
   * catch-all proxy, so it is never proxied upstream). */
  replay: {
    list: GET('/api/replay'),
    frames: GET('/api/replay/{name}'),
    latest: GET('/h2_replay/latest_replay.html'),
  },
  /** /auth/* — Microsoft 365 (Entra ID) sign-in (web/server/auth_m365.py),
   * config-driven: everything is inert while AUTH_ENABLED=false (default).
   * status is polled by the shell to render the account entry; login/logout
   * are full-page navigations (the browser rides the OAuth redirect), not
   * HttpClient calls — the /auth/callback leg belongs to Microsoft's
   * redirect and is therefore not part of this client inventory. */
  auth: {
    status: GET('/auth/status'),
    login: GET('/auth/login'),
    logout: GET('/auth/logout'),
  },
};

// ---------------------------------------------------------------------------
// DTOs — shapes copied from the legacy owner (robot_dashboard_server.py),
// each documented in the tab that renders it.
// ---------------------------------------------------------------------------

/** GET /api/services → value (legacy APP_SERVICES entry). */
export interface ServiceInfo {
  name: string;
  desc: string;
  topic: string;
  icon: string;
  enabled: boolean;
  category: string;
}
export type ServicesMap = Record<string, ServiceInfo>;

/** POST /api/service/toggle request. */
export interface ServiceToggleRequest {
  service: string;
  enabled: boolean;
}
/** POST /api/service/toggle → {success, service, enabled, msg} | {success, error}. */
export interface ServiceToggleResponse {
  success?: boolean;
  service?: string | null;
  enabled?: boolean;
  msg?: string;
  error?: string;
}

/** GET /api/vision/status → per-stream receiver health (web/server/
 * vision_pipeline.py StreamReceiver.health). */
export interface VisionStreamHealth {
  port: number;
  running: boolean;
  frames: number;
  bytes: number;
  last_frame_age_s: number | null;
  flowing: boolean;
  error: string | null;
}

/** GET /api/vision/status → one-click bring-up progress. `step` is the
 * currently running step (null when idle), `steps_done` the finished ones. */
export interface VisionPipelineState {
  active: boolean;
  step: string | null;
  steps_done: string[];
  error: string | null;
  updated_at: number | null;
}

/** GET /api/vision/status — fail-soft: 'unknown' / null whenever the robot
 * LAN or the SDK helper is unavailable. */
export interface VisionStatus {
  services: Record<string, 'running' | 'stopped' | 'unknown'>;
  receiver_ip: string | null;
  pc1_9080: boolean | null;
  streams: Record<'binocular' | 'left' | 'right', VisionStreamHealth>;
  pipeline: VisionPipelineState;
  sdk_error: string | null;
}

/** POST /api/vision/service/toggle request (separate start/stop controls). */
export interface VisionServiceToggleRequest {
  service: 'video_hub' | 'stereo_patch_pc1';
  enabled: boolean;
}
/** POST /api/vision/service/toggle → {ok, service, requested[, state]} |
 * {ok:false, error}; HTTP 400 unknown service / non-boolean enabled. */
export interface VisionServiceToggleResponse {
  ok: boolean;
  service?: string;
  requested?: 'on' | 'off';
  state?: 'running' | 'stopped';
  error?: string;
}

/** POST /api/vision/pipeline/start → {ok:true, started:true} immediately
 * (background orchestration — poll VisionStatus.pipeline for progress);
 * {ok:false, error} with HTTP 409 while a run is already active. */
export interface VisionPipelineStartResponse {
  ok: boolean;
  started?: boolean;
  error?: string;
  pipeline?: VisionPipelineState;
}

/** Thermal snapshot (pc2 local zones / PC3 via its :8999/temp endpoint). */
export interface Thermals {
  hostname?: string;
  zones: Record<string, number>;
  max_temp: number;
  power?: { mode_id?: number | null; mode_name?: string };
  error?: string;
  offline?: boolean;
}

/** telemetry.robot_state (BMS/DDS liveness). */
export interface RobotState {
  connected?: boolean;
  mode?: string;
  battery_soc?: number | null;
  battery_voltage?: number[];
  battery_current_a?: number;
  battery_temp_c?: number[];
  bms_state?: string;
  standby?: boolean;
}

/** GET /api/motion/safety_lock (also embedded at low_state.safety_lock). */
export interface MotionSafetyLock {
  armed: boolean;
  lock_reason?: string;
  last_command_rejected?: {
    type?: string;
    params?: unknown;
    timestamp?: number;
    reason?: string;
  } | null;
}

/** One joint of low_state (robot_dashboard_server.py H2_JOINTS row). */
export interface Joint {
  name: string;
  /** H2_JOINTS motor id 0..30 — the `joint_id` POST /api/motion/nudge takes. */
  id?: number;
  /** live angle in degrees (backend rounds to 2 decimals). */
  q_deg?: number;
  /** H2_JOINTS group label, e.g. "Left Arm". */
  group?: string;
  q_rad?: number;
  dq?: number;
  temp_c?: number;
  [k: string]: unknown;
}

/** low_state.imu (SDK2 rt/lowstate, 1 kHz DDS). */
export interface Imu {
  roll_deg?: number;
  pitch_deg?: number;
  yaw_deg?: number;
  rpy_rad?: number[];
  gyro?: number[];
  accel?: number[];
  quaternion?: number[];
}

/** telemetry.low_state (IMU + 31 joints + safety lock). */
export interface LowState {
  online?: boolean;
  packet_count?: number;
  imu?: Imu;
  joints?: Joint[];
  safety_lock?: MotionSafetyLock;
}

/** telemetry.lidar_telemetry (RS-Helios driver + Unitree 3D SLAM odometry). */
export interface LidarTelemetry {
  online?: boolean;
  status_str?: string;
  notice?: string;
  state_code?: number;
  cloud_active?: boolean;
  cloud_hz?: number;
  cloud_bytes?: number;
  odom_active?: boolean;
  odom_hz?: number;
  odom_pose?: { x?: number; y?: number; z?: number };
}

/** telemetry.pull_status (async ollama pull progress). */
export interface PullStatus {
  active?: boolean;
  model?: string;
  status?: string;
  percent?: number;
  total?: number;
  completed?: number;
}

/** GET /api/training → metrics tile (FOCUS gate fields included). */
export interface TrainingMetrics {
  step?: number;
  sps?: number;
  ret_mean?: number;
  iter?: number;
  succ?: number | string;
  fall?: number | string;
  loss_pg?: number;
  ent?: number;
  /** FOCUS gate: fraction of worlds that ever reached --require-stage */
  point1?: number;
  /** FOCUS gate verdict written at exit: PASS | FAIL (FAIL = do not continue) */
  focus?: string;
}

/** GET /api/training (and telemetry.rl_training): get_pc3_training() degrades
 * offline to {running:false, status:"UNKNOWN", metrics:null, error:"…"}. */
export interface TrainingState {
  running: boolean;
  status: string;
  metrics: TrainingMetrics | null;
  /** PC3 max thermal reading while training (pc3_thermal_reporter.py). */
  temp?: number | null;
  total_steps?: number;
  progress_pct?: number;
  events?: string[];
  error?: string;
}

/** One recent SageMaker job — GET /api/training/cloud → jobs[] (merged
 * list-training-jobs across us-east-1 + eu-central-1, newest first). */
export interface CloudTrainingJob {
  name: string;
  region: string;
  /** SageMaker TrainingJobStatus: InProgress | Stopping | Stopped |
   * Completed | Failed */
  status: string;
  created: string | null;
  started: string | null;
  ended: string | null;
}

/** describe-training-job extras for the active job — GET → detail. */
export interface CloudTrainingDetail {
  /** SecondaryStatus: Starting | Training | Stopping | … */
  secondary_status: string | null;
  start_time: string | null;
  end_time: string | null;
  /** BillableTimeInSeconds (null while SageMaker does not report it yet) */
  billable_seconds: number | null;
  instance_type: string | null;
  max_runtime_seconds: number | null;
}

/** Last line of s3://…/checkpoints/latest/train.jsonl — GET → metrics
 * (null when the per-run file is missing). */
export interface CloudTrainingMetrics {
  iter: number | null;
  step: number | null;
  ret_mean: number | null;
  succ: number | null;
  fall: number | null;
  point1: number | null;
  stage: number | null;
  sps: number | null;
}

/** BillableTimeInSeconds/3600 × hourly on-demand TRAINING rate — GET → cost.
 * Unknown instance type → rate_usd_per_hour AND usd are null. */
export interface CloudTrainingCost {
  billable_seconds: number | null;
  rate_usd_per_hour: number | null;
  usd: number | null;
}

/** GET /api/training/cloud → the cloud picture. The five base keys are ALWAYS
 * present; `error` marks the fail-soft path (no CLI/credentials/AWS trouble)
 * — always HTTP 200 so the /training tab degrades instead of breaking. */
export interface CloudTrainingState {
  jobs: CloudTrainingJob[];
  /** most recent non-Failed job, else null */
  active: CloudTrainingJob | null;
  detail: CloudTrainingDetail | null;
  metrics: CloudTrainingMetrics | null;
  cost: CloudTrainingCost | null;
  error?: string;
}

/** POST /api/training/cloud/stop request body. */
export interface CloudTrainingStopRequest {
  name: string;
}

/** POST /api/training/cloud/stop → {ok:true, name} | {ok:false, error}
 * (400 when the name is not a recent non-terminal job). Repeating the stop
 * is idempotent: a job already Stopping answers ok:true. */
export interface CloudTrainingStopResponse {
  ok: boolean;
  name?: string;
  error?: string;
}

/** GET /api/telemetry — the aggregate every tab subslices. */
export interface Telemetry {
  timestamp?: number;
  pc3_thermals?: Thermals;
  pc2_thermals?: Thermals;
  robot_state?: RobotState;
  voice_bot_running?: boolean;
  pull_status?: PullStatus;
  app_services?: ServicesMap;
  video_streaming?: boolean;
  lidar_telemetry?: LidarTelemetry;
  low_state?: LowState;
  rl_training?: TrainingState | null;
}

/** GET /api/system/versions → os_info. */
export interface OsInfo {
  os: string;
  kernel: string;
  arch: string;
  processor: string;
  ros_distro: string;
}
/** GET /api/system/versions → modules[name]. */
export interface OtaModule {
  installed_version: string;
  backup_version?: string;
  status: string;
}
/** GET /api/system/versions → hardware[]. */
export interface HardwareItem {
  device: string;
  type: string;
  firmware: string;
  status: string;
}
/** GET /api/system/versions — hardware/firmware/software inventory. */
export interface SystemVersions {
  os_info: OsInfo;
  ota_pipe_version: string;
  modules: Record<string, OtaModule>;
  hardware: HardwareItem[];
  ota_server_online: boolean;
  upgrade_available: boolean;
  last_checked: string;
}
/** POST /api/system/check_update (real ota_pipe_cli query; 502/500 on error
 * are returned as structured JSON, honoured as data by the tab). */
export interface CheckUpdateResult {
  status?: string;
  real_ota_query?: boolean;
  modules?: Record<string, string>;
  message?: string;
  latest_version?: string;
  raw_output?: string;
  checked_at?: string;
  error?: string;
}
/** POST /api/system/upgrade (never called by the frontend — plan §3.1). */
export interface SystemUpgradeResponse {
  status?: string;
  module?: string;
  message?: string;
  error?: string;
}

/** GET /api/ollama/models → value (ollama /api/tags passthrough). */
export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
  [k: string]: unknown;
}
/** GET /api/ollama/models → degrades to {models:[], error} when PC3 is down. */
export interface OllamaModels {
  models?: OllamaModel[];
  error?: string;
}
/** POST /api/ollama/pull → {status:"initiated", model} | {error}. */
export interface OllamaPullResponse {
  status?: string;
  model?: string;
  error?: string;
}

/** POST /api/service/voice_bot/{start,stop} → {status, running}. */
export interface VoiceBotResponse {
  status?: string;
  running?: boolean;
  error?: string;
}

/** Motion POST result (execute/jogger/nudge/waypoint/toggle) — success or a
 * structured 403 {success:false, error} from the safety interlock. For an
 * execute with type='waypoint' the server echoes the loaded capture under
 * `waypoint` (supervised staging — executed stays false). */
export interface MotionResponse {
  success?: boolean;
  executed?: boolean;
  simulated?: boolean;
  blocked_by_safety?: boolean;
  armed?: boolean;
  active?: boolean;
  command?: string;
  params?: unknown;
  message?: string;
  path?: string;
  error?: string;
  waypoint?: CapturedWaypointPose;
}

/** One captured waypoint entry — GET /api/motion/waypoints (legacy
 * robot_dashboard_server.py list_waypoints(): one web_captured_*.yaml in
 * configs/poses/). `joints` is the size of its joints_deg map (31 for a
 * full low_state capture). */
export interface MotionWaypoint {
  name: string;
  /** file mtime, epoch seconds (list sorted newest-first) */
  mtime: number;
  /** joint angles stored in the YAML (31 for a full capture) */
  joints: number;
}

/** GET /api/motion/waypoints → the capture list (read-only, fail-soft:
 * an empty list is a valid answer, the route never 500s). */
export interface MotionWaypointList {
  waypoints: MotionWaypoint[];
}

/** The YAML body execute echoes back for type='waypoint' plays — the same
 * shape capture_waypoint writes ({name, timestamp, joints_deg} degrees). */
export interface CapturedWaypointPose {
  name?: string;
  timestamp?: string;
  joints_deg?: Record<string, number>;
}

/** POST /api/power/set → PC3 {success, error?} passthrough. */
export interface PowerSetResponse {
  success?: boolean;
  error?: string;
  [k: string]: unknown;
}

/** One published replay artifact (*.npz) — GET /api/replay list entry. */
export interface ReplayInfo {
  /** file stem, e.g. "rl_gate1_eval_it000011" (path segment for frames) */
  name: string;
  file: string;
  frames: number;
  fps: number;
  duration_s: number;
  /** artifact mtime, epoch seconds (list is sorted newest-first) */
  mtime: number;
}

/** GET /api/replay → the served dir + its artifacts (host-local; `error` only
 * when numpy is missing server-side, then `replays` is []). */
export interface ReplayList {
  dir: string;
  replays: ReplayInfo[];
  error?: string;
}

/** One stage mark of a replay (stage_names/stage_f0/stage_f1 of the npz;
 * `f1` exclusive). Empty when the artifact carries no stage timeline. */
export interface ReplayStage {
  name: string;
  f0: number;
  f1: number;
}

/** GET /api/replay/{name} → npz decoded for setJoints (sim/protocol.ts):
 * `joints` is (frames × 31) rad in H2 model order (core JOINT_NAMES),
 * `base` is (frames × 7) = x, y, z, qw, qx, qy, qz (MuJoCo wxyz — the
 * server converts the writer's xyzw). */
export interface ReplayFrames {
  name: string;
  frames: number;
  fps: number;
  joint_names: string[];
  joints: number[][];
  base: number[][];
  stages: ReplayStage[];
}

/** One entry of the agent↔web chat store (web/chat/state.json). */
export interface ChatQuestion {
  id: string;
  ts: number;
  session: string;
  question: string;
  context: string;
  status: 'pending' | 'answered' | 'consumed';
  reply: string;
  replied_at: number | null;
}
/** GET /api/chat/state (also the response of prompt/reply POSTs). */
export interface ChatState {
  updated_at: number;
  prompt: string;
  questions: ChatQuestion[];
}

/** One record of web/chat/inbox.json (WhatsApp Cloud API webhook ingest —
 * web/server/app.py::_wa_ingest; served read-only by GET /api/chat/inbox).
 * Inbound messages carry from/text + the routing hints (session, opt_out,
 * answered_question); delivery receipts (type "status") carry only
 * id/type/status_type/ts/status — every field is optional on purpose. */
export interface WhatsappInboxMsg {
  id?: string | null;
  /** raw sender, e.g. "41797481975" (the Chat tab formats/groups by it) */
  from?: string | null;
  /** "text" | "status" | … (non-text inbound falls back to "<type>") */
  type?: string;
  text?: string;
  /** epoch seconds */
  ts?: number;
  /** triage: "new" (amber chip) | "handled" (grey) | "log" (delivery logs) */
  status?: string;
  /** delivery receipt kind when type === "status" (sent/delivered/read) */
  status_type?: string;
  /** "#<session id>" / "session:<id>" routing target, when present */
  session?: string | null;
  /** user wrote STOP/unsubscribe/abbestellen — binding, no further sends */
  opt_out?: boolean;
  /** id of the single pending chat question this text answered */
  answered_question?: string;
}

/** GET /api/chat/inbox → the WhatsApp inbox, newest-first rendering only —
 * the Chat tab never sends from here (sends stay in scripts/whatsapp/wa.py). */
export interface WhatsappInbox {
  messages: WhatsappInboxMsg[];
}

/** One queued mail-watch draft awaiting draft/approval (GET /api/mail/watchers
 * `pending`; states mirror scripts/mail/mail_watch.py's queue file). */
export interface MailWatchPending {
  qid: string | null;
  from: string | null;
  subject: string | null;
  state: string | null;
}

/** GET /api/mail/watchers → allowlist + pending drafts. POST (update) returns
 * just the updated `senders` (+ optional `unchanged: true` when the address
 * was already in/absent from the list). */
export interface MailWatchers {
  senders: string[];
  pending?: MailWatchPending[];
  unchanged?: boolean;
}

/** Lifecycle of one session (session_cmd.py; design doc §10 DECIDED):
 * OPEN → (work, messages) → VALIDATED (agent recorded evidence) →
 * CLOSED (Vincent's WhatsApp confirmation — the ONLY close path; the web UI
 * has no confirm/close control, by design). */
export type SessionLifecycle = 'OPEN' | 'VALIDATED' | 'CLOSED';

/** One row of the session runtime table (scripts/sessions/session_cmd.py
 * ~/.jcode/scratch/session_runtime/sessions.json; GET /api/sessions). */
export interface SessionInfo {
  /** human name (Vincent's `#name` or the router's auto-name) */
  name: string;
  /** jcode session id for `jcode run --resume=` (null until bootstrap ran) */
  jcode_session_id: string | null;
  state: SessionLifecycle;
  /** epoch seconds */
  opened_at: number;
  last_msg_at: number | null;
  agent_validated_at: number | null;
  /** the agent's validation evidence (gate output, checks, …) */
  evidence: string | null;
  vincent_confirmed_at: number | null;
  /** Vincent's confirmation note ("vincent:<wamid>…"), set by `confirm` */
  confirm_note: string | null;
}

/** GET /api/sessions → the whole table (fail-soft: `error` with an empty
 * list when session_cmd.py is unavailable — never a 500). */
export interface SessionsState {
  updated_at: number;
  sessions: SessionInfo[];
  error?: string;
}

/** POST /api/sessions/{name}/send request body (the send box). */
export interface SessionSendRequest {
  msg: string;
}

/** POST /api/sessions/{name}/send → 202 when dispatched (the jcode run then
 * happens in the background — poll GET /api/sessions for last_msg_at);
 * errors arrive as {ok:false, error} with 400/404/409. */
/** One Home Assistant entity row (web/server/ha_bridge.py overview). */
export interface HaItem {
  entity_id: string;
  name: string;
  state: string;
  on: boolean;
}

/** GET /api/ha/overview — grouped, sorted by friendly name. */
export interface HaOverview {
  devices: HaItem[];
  scenes: HaItem[];
  scripts: HaItem[];
  automations: HaItem[];
}

/** One performance metric (value computed on invested CHF when held,
 *  on the target amount until bought — labeled by `base`). */
export interface InvestmentMetric {
  pct: number | null;
  chf: number | null;
  base: 'invested' | 'target';
}

/** One portfolio row (GET /api/investments). */
export interface InvestmentLine {
  key: string;
  name: string;
  etf: string;
  isin: string;
  ticker: string;
  currency: string;
  target_pct: number;
  target_chf: number;
  status: 'not_bought' | 'wait' | 'buy_now' | 'ordered' | 'partial' | 'held';
  status_label: string;
  invested_chf: number;
  invested_pct: number;
  price: { last?: number; error?: string; history_from?: string };
  buy: { price: number; date: string; chf: number; filled?: number; total?: number } | null;
  /** Gate verdict (Vincent 2026-10-26): 'BUY' | 'WAIT' — Trade button keys off this. */
  verdict: 'BUY' | 'WAIT' | null;
  gate?: { trend?: string; last7d_pct?: number; range_pos?: number; note?: string } | null;
  ytd: InvestmentMetric;
  ly: InvestmentMetric;
  total: InvestmentMetric;
}

/** GET /api/investments. */
export interface InvestmentsSummary {
  as_of: string;
  capital: number;
  invested_chf: number;
  invested_pct: number;
  lines: InvestmentLine[];
}

/** One live quote (GET /api/investments/ticker, keyed by sleeve `key`). */
export interface TickerQuote {
  ticker: string;
  currency: string;
  last?: number;
  prev_close?: number;
  change_pct?: number | null;
  error?: string;
}

/** GET /api/investments/ticker — fail-soft: a symbol error only blanks its
 *  own quote (the house per-row rule); HTTP 429 = rate limit (the UI keeps
 *  its last snapshot). */
export interface TickerSnapshot {
  as_of: string;
  prices: Record<string, TickerQuote>;
}

/** POST /api/investments/buy → the run-shape + the requested sleeve. */
export interface BuyResult {
  rc: number;
  mode: string;
  key: string;
  output: string;
}

/** One live position (GET /api/investments/ibkr). The gateway returns
 *  different key styles per endpoint; the server normalises to these five
 *  fields and passes anything else through under `raw` (2026-10-25). */
export interface IbkrPosition {
  asset: string | null;
  qty: number | null;
  mktVal: number | null;
  avgCost: number | null;
  unrealizedPnl: number | null;
  raw?: Record<string, unknown>;
}

/** Account summary slice (GET /api/investments/ibkr): equity/cash
 *  normalised across the CP key styles, `raw` keeps the full payload. */
export interface IbkrSummary {
  equity: number | null;
  cash: number | null;
  currency: string | null;
  raw?: Record<string, unknown>;
}

/** GET /api/investments/ibkr — fail-soft 200 ALWAYS (the house rule):
 *  tunnel down => {reachable:false, auth:false, summary:null, positions:[]};
 *  HTTP 429 = rate limit (the UI keeps its last snapshot). */
export interface IbkrSnapshot {
  auth: boolean;
  reachable: boolean;
  summary: IbkrSummary | null;
  positions: IbkrPosition[];
  ts: string;
  error?: string;
}

export interface SessionSendResponse {
  ok: boolean;
  dispatched?: boolean;
  name?: string;
  state?: SessionLifecycle;
  error?: string;
}

/** GET /auth/status → sign-in state for the shell's account entry
 * (web/server/auth_m365.py status_payload). The banner renders
 * "Sign in with Microsoft" only when auth_enabled && !signed_in, and the
 * signed-in account (upn) + sign-out when signed_in. Always 200, even with
 * auth disabled — then auth_enabled is false and the entry stays hidden. */
export interface AuthStatus {
  auth_enabled: boolean;
  signed_in: boolean;
  upn: string | null;
}

/** One entry of the Management tab's client-side audit log (localStorage-backed,
 * written by ManagementComponent.audit() — NOT a backend record and NOT an HTTP
 * route: guarded controls are built but disabled while the robot LAN is down,
 * and even a confirmed press must never POST from this tab). */
export interface ManagementAction {
  /** epoch ms when the press was recorded */
  ts: number;
  /** what the operator pressed, e.g. "reboot", "service.stop", "refresh" */
  action: string;
  /** what it targeted, e.g. "robot host", "sport_mode", "telemetry" */
  target: string;
  /** honest outcome, e.g. "blocked — requires robot LAN" | "logged (read-only)" */
  result: string;
}

// ---------------------------------------------------------------------------
// Thin typed client — offline handling (catchError) stays in the components.
// ---------------------------------------------------------------------------

/** Typed GET. Throws if `route` is not a GET route (contract guard). */
export function apiGet<T>(
  http: HttpClient,
  route: ApiGetRoute,
  path?: string,
): Observable<T> {
  if (route.method !== 'GET') {
    throw new Error(`apiGet: ${route.path} is a ${route.method} route`);
  }
  const p = path ?? route.path; const url = p.startsWith("http") ? p : (window.location.hostname === "localhost" ? "http://localhost:8001" : "https://ubuntu-automation.tail8c17d3.ts.net") + p; return http.get<T>(url);
}

/** Typed POST. Throws if `route` is not a POST route (contract guard). */
export function apiPost<T, B = unknown>(
  http: HttpClient,
  route: ApiPostRoute,
  body: B,
  path?: string,
): Observable<T> {
  if (route.method !== 'POST') {
    throw new Error(`apiPost: ${route.path} is a ${route.method} route`);
  }
  const p = path ?? route.path; const url = p.startsWith("http") ? p : (window.location.hostname === "localhost" ? "http://localhost:8001" : "https://ubuntu-automation.tail8c17d3.ts.net") + p; return http.post<T>(url, body);
}
