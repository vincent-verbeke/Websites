import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import {
  API,
  apiGet,
  apiPost,
  type ApiGetRoute,
  type ApiPostRoute,
  type CapturedWaypointPose,
  type ChatState,
  type CloudTrainingCost,
  type CloudTrainingDetail,
  type CloudTrainingJob,
  type CloudTrainingMetrics,
  type CloudTrainingState,
  type CloudTrainingStopRequest,
  type CloudTrainingStopResponse,
  type IbkrPosition,
  type IbkrSnapshot,
  type ManagementAction,
  type MotionResponse,
  type MotionWaypoint,
  type MotionWaypointList,
  type ReplayFrames,
  type ReplayInfo,
  type ReplayList,
  type ServiceInfo,
  type ServicesMap,
  type ServiceToggleResponse,
  type SessionInfo,
  type SessionSendRequest,
  type SessionSendResponse,
  type SessionsState,
  type Telemetry,
  type TrainingState,
  type VisionStatus,
  type WhatsappInbox,
  type WhatsappInboxMsg,
} from './api';

/** The §3.1 inventory — the 22 legacy routes (8 GET + 14 POST) transcribed
 * from docs/plans/2026-10-13_angular_webui_and_legion1581_integration_plan.md
 * §3.1 "API inventory (evidence for the typed client)", PLUS the 2026-10-17
 * multi-waypoint extension GET /api/motion/waypoints (23 routes, 9 GET —
 * served by the same legacy owner). The legacy owner is
 * scripts/monitoring/dashboard/robot_dashboard_server.py (do_GET/do_POST). */
const SECTION_31: ReadonlyArray<readonly [method: 'GET' | 'POST', path: string]> = [
  // GET (9)
  ['GET', '/api/telemetry'],
  ['GET', '/api/training'],
  ['GET', '/api/motion/safety_lock'],
  // multi-waypoint capture list (2026-10-17 extension, not in the plan doc)
  ['GET', '/api/motion/waypoints'],
  ['GET', '/api/services'],
  ['GET', '/api/system/versions'],
  ['GET', '/api/ollama/models'],
  ['GET', '/api/video/left'],
  ['GET', '/api/video/right'],
  // POST (14)
  ['POST', '/api/motion/execute'],
  ['POST', '/api/motion/jogger/start'],
  ['POST', '/api/motion/jogger/stop'],
  ['POST', '/api/motion/nudge'],
  ['POST', '/api/motion/capture_waypoint'],
  ['POST', '/api/motion/safety_lock/toggle'],
  ['POST', '/api/motion/motion_service/release'],
  ['POST', '/api/service/toggle'],
  ['POST', '/api/service/voice_bot/start'],
  ['POST', '/api/service/voice_bot/stop'],
  ['POST', '/api/ollama/pull'],
  ['POST', '/api/power/set'],
  ['POST', '/api/system/check_update'],
  ['POST', '/api/system/upgrade'],
];

/** Routes API exposes that are NOT part of the legacy §3.1 inventory: they are
 * host-local FastAPI routes (web/server/app.py) the Angular tabs also call.
 * Anything outside this whitelist failing the inventory test is a drift bug. */
const HOST_LOCAL_EXTRA: ReadonlyArray<readonly [method: 'GET' | 'POST', path: string]> = [
  ['GET', '/api/chat/state'],
  ['POST', '/api/chat/prompt'],
  ['POST', '/api/chat/reply'],
  ['GET', '/api/chat/inbox'],
  // Kubot mail watch (2026-10-22, web/server/app.py): dashboard-managed
  // sender allowlist + pending drafts — the Chat-tab card's add/remove
  // (PC-A polls the list with a pure-script 10-min timer, never an LLM)
  ['GET', '/api/mail/watchers'],
  ['POST', '/api/mail/watchers'],
  // WhatsApp session runtime (2026-10-17, scripts/sessions/session_cmd.py):
  // read-only table + the tab's send box + the dashboard close button
  // (Vincent 2026-10-18 13:13 — the earlier "closing is NOT routable from
  // the web app" rule changed; close lands in session_cmd confirm like the
  // WhatsApp `#<name> final close`)
  ['GET', '/api/sessions'],
  ['POST', '/api/sessions/{name}/send'],
  ['POST', '/api/sessions/{name}/close'],
  // Home Assistant bridge (2026-10-18): tab overview + per-button action
  ['GET', '/api/ha/overview'],
  // Investments tab (2026-10-20, web/server/investments.py — portfolio
  // picture: status + YTD/LY/Total, approval-gated BUYS). 2026-10-23:
  // POST /run starts scripts/ibkr/daily_invest.py (gate check / daily run;
  // Vincent: 'start via the dashboard ... run it each day').
  ['GET', '/api/investments'],
  ['POST', '/api/investments/run'],
  // 2026-10-24 (Vincent: "live price ticker … add a buy button … turn it
  // into a proper trading setup … both endpoints need rate limits"):
  // the ticker strip + the per-row Buy button on the Investments tab
  ['GET', '/api/investments/ticker'],
  ['POST', '/api/investments/buy'],
  // 2026-10-25 (Vincent: "update the data on the dashboard live from IBKR",
  // while "IBKR Investments = On Hold until we have a real api key"): the
  // READ-ONLY live gateway picture (auth + summary + positions) — always
  // 200, fail-soft, rate-limited 30/min like its siblings
  ['GET', '/api/investments/ibkr'],
  ['POST', '/api/ha/act'],
  ['GET', '/api/packs'],
  ['GET', '/api/replay'],
  ['GET', '/api/replay/{name}'],
  // host-local alias registered before the /h2_replay catch-all proxy: the
  // newest *_replay.html in REPLAY_DIR by mtime (the /twin iframe's src)
  ['GET', '/h2_replay/latest_replay.html'],
  ['GET', '/api/training/cloud'],
  ['POST', '/api/training/cloud/stop'],
  // H2 stereo vision pipeline (2026-10-16, web/server/vision_pipeline.py):
  // service chips + one-click bring-up + per-service toggles + 3 MJPEG feeds
  ['GET', '/api/vision/status'],
  ['POST', '/api/vision/pipeline/start'],
  ['POST', '/api/vision/service/toggle'],
  ['GET', '/api/vision/stream/binocular'],
  ['GET', '/api/vision/stream/left'],
  ['GET', '/api/vision/stream/right'],
  // Microsoft 365 (Entra ID) sign-in (2026-10-17, web/server/auth_m365.py):
  // the shell polls status; login/logout are full-page navigations. The
  // /auth/callback leg is Microsoft's redirect target (server-only, never
  // declared by the client), hence absent here.
  ['GET', '/auth/status'],
  ['GET', '/auth/login'],
  ['GET', '/auth/logout'],
];

interface FlatRoute {
  method: string;
  path: string;
}

/** Depth-first flatten of the API tree into {method, path} records. */
function flattenRoutes(node: unknown, out: FlatRoute[] = []): FlatRoute[] {
  if (node !== null && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    if (typeof rec['method'] === 'string' && typeof rec['path'] === 'string') {
      out.push({ method: rec['method'], path: rec['path'] });
      return out;
    }
    for (const value of Object.values(rec)) flattenRoutes(value, out);
  }
  return out;
}

const ROUTES = flattenRoutes(API);
const key = (r: { method: string; path: string }): string => `${r.method} ${r.path}`;

describe('API route inventory (plan §3.1)', () => {
  it('covers every legacy route exactly once with the right method + path', () => {
    for (const [method, path] of SECTION_31) {
      const matches = ROUTES.filter((r) => r.path === path);
      expect(matches.length, `route ${path} must exist exactly once`).toBe(1);
      expect(matches[0].method, `route ${path} method`).toBe(method);
    }
  });

  it('declares 23 legacy routes (22 §3.1 + waypoints) + only the documented host-local extras', () => {
    const expected = new Set(
      [...SECTION_31, ...HOST_LOCAL_EXTRA].map(([m, p]) => `${m} ${p}`));
    expect(ROUTES.length, 'no duplicate (method, path) pairs').toBe(expected.size);
    const actual = new Set(ROUTES.map(key));
    expect([...actual].sort()).toEqual([...expected].sort());
    // 9 GET + 14 POST (chat.state/inbox + packs.list add 3 GET,
    // chat.prompt/reply add 2 POST, replay + training.cloud add 3 GET,
    // training.cloudStop adds 1 POST, vision adds 4 GET + 2 POST)
    const legacy = ROUTES.filter((r) =>
      SECTION_31.some(([m, p]) => m === r.method && p === r.path));
    expect(legacy.filter((r) => r.method === 'GET').length).toBe(9);
    expect(legacy.filter((r) => r.method === 'POST').length).toBe(14);
  });
});

describe('investments IBKR contract (GET /api/investments/ibkr, 2026-10-25)', () => {
  /** The fail-soft envelope the server promises on EVERY 200 — pinned so a
   *  backend key drift stops compiling here (mirrors scripts/web/
   *  test_investments_ibkr.py, which checks the same set server-side). */
  const down: IbkrSnapshot = {
    auth: false,
    reachable: false,
    summary: null,
    positions: [],
    ts: '2026-10-25 20:49:47',
  };

  it('IbkrSnapshot pins exactly {auth, reachable, summary, positions, ts}', () => {
    expect(Object.keys(down).sort()).toEqual(
      ['auth', 'positions', 'reachable', 'summary', 'ts']);
    expect(down.reachable).toBe(false);        // tunnel down: still a 200
    expect(down.positions).toEqual([]);
  });

  it('IbkrPosition pins the normalised five fields (+ optional raw pass-through)', () => {
    const p: IbkrPosition = {
      asset: 'CHSPI', qty: 10, mktVal: 1100.5, avgCost: 105.25,
      unrealizedPnl: 48, raw: { acctId: 'U29560672' },
    };
    expect(Object.keys(p).sort()).toEqual(
      ['asset', 'avgCost', 'mktVal', 'qty', 'raw', 'unrealizedPnl']);
    expect(typeof p.unrealizedPnl).toBe('number');
    expect(down.summary).toBeNull();
  });
});

describe('services contract DTOs (GET /api/services, POST /api/service/toggle)', () => {
  /** A legacy APP_SERVICES entry, exactly as robot_dashboard_server.py builds
   * it — the typed fixture pins the DTO: if ServiceInfo gains/loses/renames a
   * field, this stops compiling (and the key assertion below catches drift). */
  const fixture: ServiceInfo = {
    name: 'Video Streaming (videohub)',
    desc: 'Robot head camera stereo/front video pipeline',
    topic: '/api/videohub/request',
    icon: 'camera',
    enabled: false,
    category: 'Vision',
  };
  const legacyFields = ['category', 'desc', 'enabled', 'icon', 'name', 'topic'];

  it('ServiceInfo carries exactly the legacy APP_SERVICES fields', () => {
    expect(Object.keys(fixture).sort()).toEqual(legacyFields);
    expect(typeof fixture.enabled).toBe('boolean');
  });

  it('ServicesMap round-trips the GET /api/services payload shape', () => {
    const payload: ServicesMap = { videohub: fixture, sport: { ...fixture, enabled: true } };
    const list = Object.entries(payload).map(([k, s]) => ({ ...s, key: k }));
    expect(list.map((s) => s.key)).toEqual(['videohub', 'sport']);
    expect(list[0].enabled).toBe(false);
    expect(Object.keys(payload['videohub']).sort()).toEqual(legacyFields);
  });

  it('ServiceToggleResponse accepts both legacy success and error bodies', () => {
    const ok: ServiceToggleResponse =
      { success: true, service: 'videohub', enabled: true, msg: 'Command dispatched' };
    const err: ServiceToggleResponse = { success: false, error: 'exception' };
    expect(ok.success && ok.msg).toBe('Command dispatched');
    expect(err.success).toBe(false);
  });

  it('pins the DTOs the backend contract test asserts (training + chat)', () => {
    // scripts/web/test_api_contract.py asserts these very keys on the live
    // FastAPI app — both sides drift together or not at all.
    const training: TrainingState = {
      running: false, status: 'UNKNOWN', metrics: null, error: 'offline',
    };
    const chat: ChatState = { updated_at: 0, prompt: '', questions: [] };
    expect(Object.keys(training).sort()).toEqual(['error', 'metrics', 'running', 'status']);
    expect(Object.keys(chat).sort()).toEqual(['prompt', 'questions', 'updated_at']);
    const telemetry: Telemetry = { low_state: { online: false } };
    expect(Object.keys(telemetry)).toEqual(['low_state']);
  });
});

describe('vision contract DTOs (GET /api/vision/status + control routes)', () => {
  it('VisionStatus carries services/streams/pipeline + fail-soft fields', () => {
    const status: VisionStatus = {
      services: { video_hub: 'stopped', stereo_patch_pc1: 'running' },
      receiver_ip: '192.168.123.99',
      pc1_9080: true,
      streams: {
        binocular: { port: 5002, running: true, frames: 12, bytes: 3456,
          last_frame_age_s: 0.1, flowing: true, error: null },
        left: { port: 5004, running: true, frames: 8, bytes: 1234,
          last_frame_age_s: 0.2, flowing: true, error: null },
        right: { port: 5006, running: false, frames: 0, bytes: 0,
          last_frame_age_s: null, flowing: false, error: 'gst missing' },
      },
      pipeline: { active: false, step: null, steps_done: ['stop video_hub'],
        error: null, updated_at: 1792170000 },
      sdk_error: null,
    };
    expect(Object.keys(status).sort()).toEqual(
      ['pc1_9080', 'pipeline', 'receiver_ip', 'sdk_error', 'services', 'streams']);
    expect(status.services['video_hub']).toBe('stopped');
    expect(status.streams.binocular.port).toBe(5002);
    expect(status.streams.left.port).toBe(5004);
    expect(status.streams.right.port).toBe(5006);
  });

  it('declares the control routes as host-local (never proxied upstream)', () => {
    expect(API.vision.status.method).toBe('GET');
    expect(API.vision.status.path).toBe('/api/vision/status');
    expect(API.vision.pipelineStart.method).toBe('POST');
    expect(API.vision.serviceToggle.method).toBe('POST');
    expect(API.vision.stream.binocular.path).toBe('/api/vision/stream/binocular');
    expect(API.vision.stream.left.path).toBe('/api/vision/stream/left');
    expect(API.vision.stream.right.path).toBe('/api/vision/stream/right');
  });
});

describe('multi-waypoint contract (GET /api/motion/waypoints + execute play)', () => {
  it('declares the list route as a proxied legacy GET (not host-local)', () => {
    expect(API.motion.waypoints.method).toBe('GET');
    expect(API.motion.waypoints.path).toBe('/api/motion/waypoints');
    expect(SECTION_31).toContainEqual(['GET', '/api/motion/waypoints']);
    expect(HOST_LOCAL_EXTRA).not.toContainEqual(['GET', '/api/motion/waypoints']);
  });

  it('routes waypoint PLAY through the existing execute POST (no new route)', () => {
    // robot_dashboard_server.py::do_POST execute accepts type='waypoint' +
    // {name} and reads the YAML server-side — the body is the contract.
    expect(API.motion.execute.method).toBe('POST');
    expect(API.motion.execute.path).toBe('/api/motion/execute');
    const playBody = { type: 'waypoint', name: 'sit', desc: 'waypoint sit' };
    expect(Object.keys(playBody).sort()).toEqual(['desc', 'name', 'type']);
  });

  it('MotionWaypoint / MotionWaypointList pin the backend payload keys', () => {
    // Mirrors robot_dashboard_server.py list_waypoints(): one entry per
    // web_captured_*.yaml with {name, mtime, joints}, newest first.
    const wp: MotionWaypoint = { name: 'sit', mtime: 1792170000, joints: 31 };
    const list: MotionWaypointList = { waypoints: [wp] };
    expect(Object.keys(wp).sort()).toEqual(['joints', 'mtime', 'name']);
    expect(Object.keys(list)).toEqual(['waypoints']);
    expect(typeof wp.mtime).toBe('number');
    expect(typeof wp.joints).toBe('number');
    expect(list.waypoints[0]?.name).toBe('sit');
    // empty list is a valid answer (fail-soft route, never 500)
    const empty: MotionWaypointList = { waypoints: [] };
    expect(empty.waypoints).toEqual([]);
  });

  it('MotionResponse carries the waypoint echo execute returns for a play', () => {
    const pose: CapturedWaypointPose = {
      name: 'sit', timestamp: '2026-10-17 12:00:00',
      joints_deg: { left_knee_joint: -20.5 },
    };
    const res: MotionResponse = {
      success: true, executed: false, simulated: true, command: 'waypoint',
      message: "Waypoint 'sit' acknowledged in supervised staging mode",
      waypoint: pose,
    };
    expect(Object.keys(pose).sort()).toEqual(['joints_deg', 'name', 'timestamp']);
    expect(res.executed).toBe(false);          // supervised staging, unchanged
    expect(res.waypoint?.joints_deg?.['left_knee_joint']).toBe(-20.5);
    // the structured interlock403 stays part of the same DTO
    const blocked: MotionResponse =
      { success: false, blocked_by_safety: true, error: 'COMMAND BLOCKED…' };
    expect(blocked.success).toBe(false);
    expect(blocked.blocked_by_safety).toBe(true);
  });
});

describe('replay contract (GET /api/replay[/{name}] → /twin replay viewer)', () => {
  it('declares both routes as host-local GETs', () => {
    expect(API.replay.list.method).toBe('GET');
    expect(API.replay.list.path).toBe('/api/replay');
    expect(API.replay.frames.method).toBe('GET');
    expect(API.replay.frames.path).toBe('/api/replay/{name}');
    expect(HOST_LOCAL_EXTRA).toContainEqual(['GET', '/api/replay']);
    expect(HOST_LOCAL_EXTRA).toContainEqual(['GET', '/api/replay/{name}']);
  });

  it('declares the host-local "always latest" HTML alias the twin iframes', () => {
    // web/server/app.py serves the NEWEST *_replay.html (mtime) at this path
    // BEFORE the /h2_replay catch-all proxy — the twin embeds it below the 3D
    // viewport (twin.component.ts source-pinned in twin.component.spec.ts).
    expect(API.replay.latest.method).toBe('GET');
    expect(API.replay.latest.path).toBe('/h2_replay/latest_replay.html');
    expect(HOST_LOCAL_EXTRA).toContainEqual(['GET', '/h2_replay/latest_replay.html']);
  });

  it('ReplayInfo / ReplayList / ReplayFrames pin the backend payload keys', () => {
    // Mirrors web/server/app.py::replay_list / replay_frames — the backend
    // contract suite (scripts/web/test_api_contract.py) asserts the same.
    const info: ReplayInfo = {
      name: 'rl_gate1_eval_it000011', file: 'rl_gate1_eval_it000011.npz',
      frames: 400, fps: 50, duration_s: 8, mtime: 1792016060,
    };
    const list: ReplayList = { dir: '/tmp/h2_replay', replays: [info] };
    expect(Object.keys(info).sort()).toEqual(
      ['duration_s', 'file', 'fps', 'frames', 'mtime', 'name']);
    expect(Object.keys(list).sort()).toEqual(['dir', 'replays']);
    const frames: ReplayFrames = {
      name: info.name, frames: 400, fps: 50, joint_names: [],
      joints: [], base: [], stages: [{ name: 'S0', f0: 0, f1: 50 }],
    };
    expect(Object.keys(frames).sort()).toEqual(
      ['base', 'fps', 'frames', 'joint_names', 'joints', 'name', 'stages']);
    expect(typeof frames.joints.length).toBe('number');
  });
});

describe('WhatsApp session runtime contract (GET /api/sessions + send box)', () => {
  it('declares the read-only list + the send box as host-local routes', () => {
    expect(API.sessions.list.method).toBe('GET');
    expect(API.sessions.list.path).toBe('/api/sessions');
    expect(API.sessions.send.method).toBe('POST');
    expect(API.sessions.send.path).toBe('/api/sessions/{name}/send');
    expect(API.sessions.close.method).toBe('POST');
    expect(API.sessions.close.path).toBe('/api/sessions/{name}/close');
    expect(HOST_LOCAL_EXTRA).toContainEqual(['GET', '/api/sessions']);
    expect(HOST_LOCAL_EXTRA).toContainEqual(['POST', '/api/sessions/{name}/send']);
    expect(HOST_LOCAL_EXTRA).toContainEqual(['POST', '/api/sessions/{name}/close']);
    // exactly ONE closer — the dashboard close (Vincent 2026-10-18 13:13);
    // validate/confirm routes must NEVER exist (session_cmd CLI primitives)
    expect(ROUTES.filter((r) =>
      /\/api\/sessions.*(confirm|close|validate)/.test(r.path))
      .map((r) => r.path)).toEqual(['/api/sessions/{name}/close']);
  });

  it('SessionInfo / SessionsState / SessionSend* pin the backend payload keys', () => {
    // Mirrors scripts/sessions/session_cmd.py's table row + web/server/app.py;
    // the backend contract suite (scripts/web/test_api_contract.py) asserts
    // the same shape from the live FastAPI app.
    const info: SessionInfo = {
      name: 'robot-standup', jcode_session_id: 'session_mosquito_1_abcdef0123456789',
      state: 'OPEN', opened_at: 1792268000, last_msg_at: 1792268100,
      agent_validated_at: null, evidence: null, vincent_confirmed_at: null,
      confirm_note: null,
    };
    const state: SessionsState = { updated_at: 1792268200, sessions: [info] };
    expect(Object.keys(info).sort()).toEqual([
      'agent_validated_at', 'confirm_note', 'evidence', 'jcode_session_id',
      'last_msg_at', 'name', 'opened_at', 'state', 'vincent_confirmed_at',
    ]);
    expect(Object.keys(state).sort()).toEqual(['sessions', 'updated_at']);
    expect(info.state === 'OPEN' || info.state === 'VALIDATED' ||
           info.state === 'CLOSED').toBe(true);
    // the validated + confirmed lifecycle row (evidence then Vincent's note)
    const done: SessionInfo = { ...info, state: 'CLOSED', evidence: 'gate GREEN',
      agent_validated_at: 1792268150, vincent_confirmed_at: 1792268180,
      confirm_note: 'vincent:wamid.HBg' };
    expect(done.state).toBe('CLOSED');
    expect(done.confirm_note).toContain('vincent:');
    const req: SessionSendRequest = { msg: 'continue' };
    expect(Object.keys(req)).toEqual(['msg']);
    const res: SessionSendResponse = { ok: true, dispatched: true, name: 'x' };
    expect(res.ok && res.dispatched).toBe(true);
    const err: SessionSendResponse = { ok: false, error: "session 'x' is CLOSED" };
    expect(err.ok).toBe(false);
    expect(err.error).toContain('CLOSED');
    // fail-soft body (session_cmd unavailable) — empty list + error, never 500
    const degraded: SessionsState = { updated_at: 0, sessions: [], error: 'boom' };
    expect(degraded.sessions).toEqual([]);
  });
});

describe('WhatsApp inbox contract (GET /api/chat/inbox)', () => {
  it('is declared as a GET under chat (whitelisted as a host-local extra)', () => {
    expect(API.chat.inbox.method).toBe('GET');
    expect(API.chat.inbox.path).toBe('/api/chat/inbox');
    expect(HOST_LOCAL_EXTRA).toContainEqual(['GET', '/api/chat/inbox']);
  });

  it('WhatsappInboxMsg pins every field the webhook ingest writes', () => {
    // fixture mirrors web/server/app.py::_wa_ingest's record + the routing
    // hints; the backend contract suite (scripts/web/test_api_contract.py)
    // serves the same shape from the live FastAPI app.
    const msg: WhatsappInboxMsg = {
      id: 'wamid.X', from: '41797481975', type: 'text', text: 'Go for all',
      ts: 1791955052, status: 'new', session: 'sess_abc', opt_out: false,
      answered_question: 'q1',
    };
    const inbox: WhatsappInbox = { messages: [msg] };
    expect(Object.keys(inbox)).toEqual(['messages']);
    expect(Object.keys(msg).sort()).toEqual([
      'answered_question', 'from', 'id', 'opt_out', 'session', 'status',
      'text', 'ts', 'type',
    ]);
    expect(typeof msg.ts).toBe('number');
    expect(typeof msg.opt_out).toBe('boolean');
    expect(inbox.messages[0]?.from).toBe('41797481975');
  });

  it('accepts senderless delivery receipts (type "status", no from/text)', () => {
    const receipt: WhatsappInboxMsg = {
      id: 'wamid.Y', type: 'status', status_type: 'delivered',
      ts: 1791943057, status: 'handled',
    };
    expect(receipt.from).toBeUndefined();
    expect(receipt.text).toBeUndefined();
    const empty: WhatsappInbox = { messages: [] };
    expect(empty.messages).toEqual([]);
  });
});

describe('cloud training contract (GET /api/training/cloud + POST …/stop)', () => {
  it('declares the read-only GET + the single mutating stop POST as host-local', () => {
    expect(API.training.cloud.method).toBe('GET');
    expect(API.training.cloud.path).toBe('/api/training/cloud');
    expect(API.training.cloudStop.method).toBe('POST');
    expect(API.training.cloudStop.path).toBe('/api/training/cloud/stop');
    expect(HOST_LOCAL_EXTRA).toContainEqual(['GET', '/api/training/cloud']);
    expect(HOST_LOCAL_EXTRA).toContainEqual(['POST', '/api/training/cloud/stop']);
  });

  it('CloudTraining* DTOs pin the backend payload keys', () => {
    // Mirrors web/server/app.py::training_cloud_get/_cloud_state — the backend
    // contract suite (scripts/web/test_api_contract.py) asserts the same keys
    // on the live FastAPI app (with the aws CLI monkeypatched, no real AWS).
    const job: CloudTrainingJob = {
      name: 'h2rl-cloud-it42', region: 'us-east-1', status: 'InProgress',
      created: '2026-10-15T09:00:00+00:00', started: '2026-10-15T09:05:00+00:00',
      ended: null,
    };
    const detail: CloudTrainingDetail = {
      secondary_status: 'Training', start_time: '2026-10-15T09:05:00+00:00',
      end_time: null, billable_seconds: 3600, instance_type: 'ml.g5.xlarge',
      max_runtime_seconds: 14400,
    };
    const metrics: CloudTrainingMetrics = {
      iter: 7, step: 12345, ret_mean: 1.25, succ: 0.8, fall: 0.1,
      point1: 0.6, stage: 2, sps: 840,
    };
    const cost: CloudTrainingCost =
      { billable_seconds: 3600, rate_usd_per_hour: 1.212, usd: 1.212 };
    const state: CloudTrainingState =
      { jobs: [job], active: job, detail, metrics, cost };
    const degraded: CloudTrainingState =
      { jobs: [], active: null, detail: null, metrics: null, cost: null,
        error: 'aws CLI not found' };
    expect(Object.keys(job).sort()).toEqual(
      ['created', 'ended', 'name', 'region', 'started', 'status']);
    expect(Object.keys(detail).sort()).toEqual(
      ['billable_seconds', 'end_time', 'instance_type', 'max_runtime_seconds',
        'secondary_status', 'start_time']);
    expect(Object.keys(metrics).sort()).toEqual(
      ['fall', 'iter', 'point1', 'ret_mean', 'sps', 'stage', 'step', 'succ']);
    expect(Object.keys(cost).sort()).toEqual(
      ['billable_seconds', 'rate_usd_per_hour', 'usd']);
    // the five base keys are ALWAYS present; error marks the fail-soft path
    expect(Object.keys(state).sort()).toEqual(
      ['active', 'cost', 'detail', 'jobs', 'metrics']);
    expect(Object.keys(degraded).sort()).toEqual(
      ['active', 'cost', 'detail', 'error', 'jobs', 'metrics']);
    expect(cost.usd).toBeCloseTo(3600 / 3600 * 1.212, 4);
  });

  it('CloudTrainingStop request/response pin the stop contract', () => {
    const req: CloudTrainingStopRequest = { name: 'h2rl-cloud-it42' };
    const ok: CloudTrainingStopResponse = { ok: true, name: req.name };
    const bad: CloudTrainingStopResponse =
      { ok: false, error: "'x' is not a recent non-terminal training job" };
    expect(Object.keys(req)).toEqual(['name']);
    expect(typeof ok.ok).toBe('boolean');
    expect(ok.ok && ok.name).toBe('h2rl-cloud-it42');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('non-terminal');
  });
});

describe('Management audit log DTO (client-side, no route)', () => {
  it('ManagementAction pins exactly {ts, action, target, result}', () => {
    // Purely local (localStorage) record — adding an HTTP route for it would
    // break the route inventory test above, which is the point: the Management
    // tab reads GET /api/system/versions + GET /api/telemetry and POSTs
    // nothing (safety rule: mutation endpoints are never exercised by tests).
    const entry: ManagementAction = {
      ts: 1791955052000, action: 'reboot', target: 'robot host',
      result: 'blocked — requires robot LAN',
    };
    expect(Object.keys(entry).sort()).toEqual(['action', 'result', 'target', 'ts']);
    expect(typeof entry.ts).toBe('number');
    expect(entry.result).toContain('requires robot LAN');
    // no Management* route exists anywhere in the inventory
    expect(ROUTES.filter((r) => r.path.includes('management'))).toEqual([]);
  });
});

describe('apiGet / apiPost typed client', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('apiGet issues GET to the route path (no catchError inside the client)', () => {
    let body: Telemetry | undefined;
    apiGet<Telemetry>(http, API.telemetry.get).subscribe((t) => (body = t));
    // apiGet prefixes the host base (localhost:8001 here, the PC-A funnel in
    // prod) — match on the path so the assertion survives either base.
    const req = ctrl.expectOne((r) => r.url.endsWith('/api/telemetry'));
    expect(req.request.method).toBe('GET');
    req.flush({ low_state: { online: false } });
    expect(body?.low_state?.online).toBe(false);
  });

  it('apiPost issues POST with the exact body to the route path', () => {
    const payload = { service: 'videohub', enabled: true };
    let res: ServiceToggleResponse | undefined;
    apiPost<ServiceToggleResponse>(http, API.service.toggle, payload)
      .subscribe((r) => (res = r));
    const req = ctrl.expectOne((r) => r.url.endsWith('/api/service/toggle'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ success: true, service: 'videohub', enabled: true, msg: 'ok' });
    expect(res?.success).toBe(true);
  });

  it('rejects a GET route passed to apiPost (and vice versa) at runtime', () => {
    expect(() => apiPost(http, API.services.get as unknown as ApiPostRoute, {}))
      .toThrow(/is a GET route/);
    expect(() => apiGet(http, API.service.toggle as unknown as ApiGetRoute))
      .toThrow(/is a POST route/);
  });
});

describe('components never hand-write /api strings', () => {
  /** Every feature source (specs excluded) must route through API.* — this is
   * the grep half of the contract: raw "'/api/…", "`/api/…" literals are
   * forbidden outside core/api.ts (which is the route table itself). */
  function featureSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) featureSources(full, out);
      else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
    }
    return out;
  }

  it('contains no raw "/api/…" string literal in any feature component', () => {
    // check.sh runs from web/; fall back to the repo root invocation as well.
    const candidates = ['src/app/features', 'web/src/app/features'];
    const dir = candidates.find((c) => {
      try { return statSync(c).isDirectory(); } catch { return false; }
    });
    expect(dir, 'features directory not found from cwd').toBeDefined();

    const offenders: string[] = [];
    for (const file of featureSources(dir!)) {
      const source = readFileSync(file as string, 'utf-8');
      if (/['"`]\/api\//.test(source)) offenders.push(file as string);
    }
    expect(offenders).toEqual([]);
  });
});
