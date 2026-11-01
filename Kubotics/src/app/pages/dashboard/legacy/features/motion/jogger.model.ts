/** Waypoint jogger math (pure — no Angular imports, fully unit-testable).
 *
 * Sources of truth (do not invent numbers here):
 *  * joint_id ↔ name mapping: `H2_JOINTS` in
 *    scripts/monitoring/dashboard/robot_dashboard_server.py (31 rows, id 0..30
 *    — the same table GET /api/telemetry's low_state.joints[] is built from
 *    and the id POST /api/motion/nudge expects as `joint_id`).
 *  * soft limits: `SOFT_LIMITS` in scripts/motion/test_h2_lowcmd_joint.py
 *    (index-keyed, radians) — converted to degrees below. The validated
 *    runner scripts/motion/test_h2_arm_raise_sequence.py refuses any endpoint
 *    outside these; the slider clamps to them client-side the same way.
 *  * mirror direction convention: scripts/motion/test_h2_arm_raise_sequence.py
 *    — shoulder_roll is LEFT + / RIGHT − (mirrored signs), shoulder_pitch and
 *    elbow move with the SAME sign on both arms (docstring "Naming" + stages
 *    PITCH1/ROLL/ELBOW). Generalised to the L/R pairs: joints whose axis is a
 *    ROLL or a YAW mirror (−1), joints whose axis is a PITCH (and the elbow)
 *    keep the sign (+1) — exactly what a sagittal-plane mirror of the H2
 *    means. Waist/Head are single central joints: no L/R pair → no mirror.
 *
 * Server-side executor semantics mirrored here (robot_dashboard_server.py
 * ArmSdkJointController.nudge): |delta_deg| ≤ 1.0 per request (hard 1.05 cap),
 * targets clamped to the per-joint limits, and every nudge requires an armed
 * interlock + an active hold ("jogger start" = seated hold).
 */

export interface JogJoint {
  readonly id: number;
  /** H2_JOINTS name (id ↔ name mapping source documented above). */
  readonly name: string;
  readonly group: string;
  /** soft limit, degrees (SOFT_LIMITS converted rad → deg). */
  readonly lo: number;
  readonly hi: number;
  /** L/R partner joint id, when this joint has a mirrored twin. */
  readonly mirror?: number;
  /** +1 = partner moves with the same sign (pitch/elbow family),
   * −1 = partner moves with the opposite sign (roll/yaw family). */
  readonly mirrorSign?: 1 | -1;
}

/** All 31 actuated H2 joints, joint_id order (H2_JOINTS, backend table).
 * 2026-10-17 FIX: hip-roll pairs were left/right swapped relative to the
 * robot's sign convention. FK-verified seated pose (configs/poses
 * h2_seated_rest_pose_v2: LeftHipRoll −0.38 / RightHipRoll +0.38 with legs
 * splayed OUTWARD, review SVG) shows outward = negative-left for hips (the
 * OPPOSITE of shoulders, where LeftShoulderRoll + = out). The old table put
 * LeftHipRoll's wide range on the inward side and capped outward at −26.78 —
 * the real robot demonstrably sits at −29.6 (live low_state), outside it.
 * Corrected: abduction ~124°, adduction ~27° for both legs, wide side on the
 * outward direction of each leg. */
export const JOINT_TABLE: readonly JogJoint[] = [
  { id: 0, name: 'LeftHipPitch', group: 'Left Leg', lo: -140.52, hi: 159.02, mirror: 6, mirrorSign: 1 },
  { id: 1, name: 'LeftHipRoll', group: 'Left Leg', lo: -124.27, hi: 26.78, mirror: 7, mirrorSign: -1 },
  { id: 2, name: 'LeftHipYaw', group: 'Left Leg', lo: -161.98, hi: 161.98, mirror: 8, mirrorSign: -1 },
  { id: 3, name: 'LeftKnee', group: 'Left Leg', lo: -5.0, hi: 144.98, mirror: 9, mirrorSign: 1 },
  { id: 4, name: 'LeftAnklePitch', group: 'Left Leg', lo: -20.0, hi: 17.0, mirror: 10, mirrorSign: 1 },
  { id: 5, name: 'LeftAnkleRoll', group: 'Left Leg', lo: -65.0, hi: 35.0, mirror: 11, mirrorSign: -1 },
  { id: 6, name: 'RightHipPitch', group: 'Right Leg', lo: -140.52, hi: 159.02, mirror: 0, mirrorSign: 1 },
  { id: 7, name: 'RightHipRoll', group: 'Right Leg', lo: -26.78, hi: 124.27, mirror: 1, mirrorSign: -1 },
  { id: 8, name: 'RightHipYaw', group: 'Right Leg', lo: -161.98, hi: 161.98, mirror: 2, mirrorSign: -1 },
  { id: 9, name: 'RightKnee', group: 'Right Leg', lo: -5.0, hi: 144.98, mirror: 3, mirrorSign: 1 },
  { id: 10, name: 'RightAnklePitch', group: 'Right Leg', lo: -17.0, hi: 20.0, mirror: 4, mirrorSign: 1 },
  { id: 11, name: 'RightAnkleRoll', group: 'Right Leg', lo: -65.0, hi: 35.0, mirror: 5, mirrorSign: -1 },
  { id: 12, name: 'WaistYaw', group: 'Waist', lo: -30.0, hi: 30.0 },
  { id: 13, name: 'WaistRoll', group: 'Waist', lo: -25.0, hi: 30.0 },
  { id: 14, name: 'WaistPitch', group: 'Waist', lo: -100.0, hi: 100.0 },
  { id: 15, name: 'LeftShoulderPitch', group: 'Left Arm', lo: -150.0, hi: 105.0, mirror: 22, mirrorSign: 1 },
  { id: 16, name: 'LeftShoulderRoll', group: 'Left Arm', lo: -29.62, hi: 142.9, mirror: 23, mirrorSign: -1 },
  { id: 17, name: 'LeftShoulderYaw', group: 'Left Arm', lo: -150.0, hi: 150.0, mirror: 24, mirrorSign: -1 },
  { id: 18, name: 'LeftElbow', group: 'Left Arm', lo: -56.5, hi: 176.0, mirror: 25, mirrorSign: 1 },
  { id: 19, name: 'LeftWristRoll', group: 'Left Wrist', lo: -150.0, hi: 150.0, mirror: 26, mirrorSign: -1 },
  { id: 20, name: 'LeftWristPitch', group: 'Left Wrist', lo: -33.0, hi: 33.0, mirror: 27, mirrorSign: 1 },
  { id: 21, name: 'LeftWristYaw', group: 'Left Wrist', lo: -70.0, hi: 70.0, mirror: 28, mirrorSign: -1 },
  { id: 22, name: 'RightShoulderPitch', group: 'Right Arm', lo: -150.0, hi: 105.0, mirror: 15, mirrorSign: 1 },
  { id: 23, name: 'RightShoulderRoll', group: 'Right Arm', lo: -142.9, hi: 29.62, mirror: 16, mirrorSign: -1 },
  { id: 24, name: 'RightShoulderYaw', group: 'Right Arm', lo: -150.0, hi: 150.0, mirror: 17, mirrorSign: -1 },
  { id: 25, name: 'RightElbow', group: 'Right Arm', lo: -56.5, hi: 176.0, mirror: 18, mirrorSign: 1 },
  { id: 26, name: 'RightWristRoll', group: 'Right Wrist', lo: -150.0, hi: 150.0, mirror: 19, mirrorSign: -1 },
  { id: 27, name: 'RightWristPitch', group: 'Right Wrist', lo: -33.0, hi: 33.0, mirror: 20, mirrorSign: 1 },
  { id: 28, name: 'RightWristYaw', group: 'Right Wrist', lo: -70.0, hi: 70.0, mirror: 21, mirrorSign: -1 },
  { id: 29, name: 'HeadPitch', group: 'Head', lo: -30.0, hi: 48.0 },
  { id: 30, name: 'HeadYaw', group: 'Head', lo: -100.0, hi: 100.0 },
];

export const JOINT_BY_ID: ReadonlyMap<number, JogJoint> =
  new Map(JOINT_TABLE.map((j) => [j.id, j]));

/** Jog tick: 50 ms → the movement loop and nudge bursts run at 20 Hz max. */
export const JOG_TICK_MS = 50;
export const JOG_TICK_S = JOG_TICK_MS / 1000;

/** Server cap: ArmSdkJointController.nudge rejects |delta_deg| > 1.05. */
export const MAX_NUDGE_DEG = 1.0;

/** Velocity entry default (deg/s). */
export const DEFAULT_VELOCITY_DEG_S = 20;
export const MIN_VELOCITY_DEG_S = 1;
export const MAX_VELOCITY_DEG_S = 60;

/** Sanitised velocity entry: number within [min, max], else the default. */
export function sanitizeVelocity(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VELOCITY_DEG_S;
  return Math.min(MAX_VELOCITY_DEG_S, Math.max(MIN_VELOCITY_DEG_S, n));
}

/** One velocity step = what the configured velocity covers in one tick
 * (deg/s × tick s). This is both the per-tick movement increment and the
 * arrow-key step: at the default 20 °/s → 1.0 ° per tick / per key press. */
export function velocityStepDeg(velocityDegS: number): number {
  return sanitizeVelocity(velocityDegS) * JOG_TICK_S;
}

/** Clamp an absolute position into the joint's soft limits. */
export function clampToLimits(j: JogJoint, v: number): number {
  return Math.min(j.hi, Math.max(j.lo, v));
}

/** Clamp a step so that `target + step` stays inside [lo, hi]. Returns the
 * applied step (0 when the joint is already at a limit). */
export function clampStep(j: JogJoint, target: number, step: number): number {
  return clampToLimits(j, target + step) - clampToLimits(j, target);
}

/** Split a step into nudge requests of at most MAX_NUDGE_DEG each
 * (server rejects anything > 1.0°, so a faster velocity is chunked). */
export function chunkStep(step: number, max = MAX_NUDGE_DEG): number[] {
  const out: number[] = [];
  const sign = Math.sign(step);
  let rest = Math.abs(step);
  if (sign === 0 || rest === 0) return out;
  while (rest > 1e-9) {
    const piece = Math.min(rest, max);
    out.push(sign * piece);
    rest -= piece;
  }
  return out;
}

/** The user's current selection: front checkboxes = same-direction group,
 * rear checkboxes = mirror to the L/R pair. */
export interface JogSelection {
  readonly group: ReadonlySet<number>;
  readonly mirror: ReadonlySet<number>;
}

/** Which joints move, and by how much, when `masterId` moves by `masterStep`.
 *
 * 1. the moved slider is the master: it always gets `masterStep`;
 * 2. GROUP (checkbox in front): when ≥ 2 joints are checked, every checked
 *    joint receives the SAME signed step as the master (same velocity, same
 *    direction — the moved slider is the master);
 * 3. MIRROR (checkbox behind): for every moving joint whose mirror box is
 *    checked, its L/R partner receives `mirrorSign × step`. Mirrors compose
 *    with the group and OVERRIDE the group's same-direction step for that
 *    partner (checked + mirrored = the pair moves mirrored);
 * 4. the master's own step is authoritative — a partner's mirror never
 *    overwrites it.
 *
 * Returns Map<joint_id, signed step> (clamping to limits happens after). */
export function computeJointSteps(
  masterId: number,
  masterStep: number,
  sel: JogSelection,
  table: ReadonlyMap<number, JogJoint> = JOINT_BY_ID,
): Map<number, number> {
  const steps = new Map<number, number>();
  if (!table.has(masterId)) return steps;
  steps.set(masterId, masterStep);

  // 2. group: needs ≥ 2 checked boxes (the master may be unchecked).
  const checked = [...sel.group].filter((id) => table.has(id)).sort((a, b) => a - b);
  if (checked.length >= 2) {
    for (const id of checked) {
      if (id !== masterId) steps.set(id, masterStep);
    }
  }

  // 3. mirrors apply to everything moving so far (master + group), in a
  // deterministic id order; the write wins over a group step for the partner.
  const sources = [...steps.keys()].sort((a, b) => a - b);
  for (const id of sources) {
    if (!sel.mirror.has(id)) continue;
    const j = table.get(id)!;
    if (j.mirror === undefined || !table.has(j.mirror)) continue;
    const s = steps.get(id)!;
    // 4. never overwrite the master's own step.
    if (j.mirror === masterId) continue;
    steps.set(j.mirror, (j.mirrorSign ?? 1) * s);
  }
  return steps;
}

/** Advance `target` toward `desired` by at most one velocity step (deg),
 * clamped so the joint stays inside its soft limits. */
export function approachStep(
  j: JogJoint,
  target: number,
  desired: number,
  velocityDegS: number,
): number {
  const max = velocityStepDeg(velocityDegS);
  const raw = Math.min(max, Math.max(-max, desired - target));
  return clampStep(j, target, raw);
}
