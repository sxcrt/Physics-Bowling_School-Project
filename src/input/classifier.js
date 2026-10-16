// Temporal movement classifier for webcam bowling (browser build).
//
// The legacy phase machine in src/input/swing.js is a byte-parity port of the
// original Python detector. It is deliberately sensitive: it recognizes
// *motion*, not intent, and a fast two-arm exercise stroke passes its gates
// (the recorded jumping-jacks fixture releases through its "direct throw"
// path). Parity between the two implementations therefore says nothing about
// behavioural correctness, and the previous browser-side SwingValidator only
// inspected the window around a release the phase machine had already fired.
//
// This classifier replaces both as the shipping decision layer. It reads the
// raw landmarks and recognizes the *sequence* of a bowling action with an
// explicit state machine:
//
//   tracking -> ready -> backswing -> forward -> release -> follow_through
//            -> rearm -> ready -> ...
//
// A throw is only produced by a convincing sequence:
//
//   * the player is first reliably tracked, still, with both hands low (ready);
//   * one arm then performs a sustained down/back stroke (backswing) whose
//     depth is measured in the player's own torso heights; a hidden wrist can
//     keep the stroke alive through the visible elbow chain, but never starts
//     one from nothing;
//   * the arm reverses into a sustained forward/up stroke with a real rise, a
//     real peak speed, continuity and an acceleration that decays (release);
//   * the other arm stays quiet throughout (a symmetric two-arm raise is
//     exercise, not bowling);
//   * the body does not jump, crouch away or oscillate like an exercise
//     rhythm, and the player does not turn away from the camera;
//   * the whole stroke is recently and densely tracked, the throwing hand
//     stays the same hand, and one accepted swing disarms the machine until
//     the ready pose is re-established.
//
// Features are normalized against body proportions (torso height) and elapsed
// time, so camera distance, player size, swing speed and moderate body
// translation do not change the decision. Every rejection carries a
// player-readable reason; the HUD shows the current state and the most recent
// rejection, and the developer diagnostics readout can show full telemetry.
//
// Design note: unlike src/input/swing.js this module is *not* a parity port.
// It is verified against labeled synthetic and recorded traces by
// tools/webcam_eval.mjs (browser) and tools/webcam_eval.py (Python port); the
// old detector remains exported and parity-tested as the low-level motion
// sensor it is.
import * as config from '../config.js';
import { SwingEvent } from './swing.js';

export const STATE_TRACKING = 'tracking';
export const STATE_READY = 'ready';
export const STATE_BACKSWING = 'backswing';
export const STATE_FORWARD = 'forward';
export const STATE_RELEASE = 'release';
export const STATE_FOLLOW = 'follow_through';
export const STATE_REARM = 'rearm';

export const STATE_LABELS = {
  [STATE_TRACKING]: 'Tracking',
  [STATE_READY]: 'Ready',
  [STATE_BACKSWING]: 'Backswing',
  [STATE_FORWARD]: 'Forward swing',
  [STATE_RELEASE]: 'Release',
  [STATE_FOLLOW]: 'Throw released',
  [STATE_REARM]: 'Re-arming',
};

export const STATE_HINTS = {
  [STATE_TRACKING]: 'Stand still where the camera can see your shoulders and hips.',
  [STATE_READY]: 'Ready: swing your arm back, then forward and up.',
  [STATE_BACKSWING]: 'Now swing forward and up!',
  [STATE_FORWARD]: 'Keep going - release!',
  [STATE_RELEASE]: 'Throw released.',
  [STATE_FOLLOW]: 'Lower your arms to get ready for the next throw.',
  [STATE_REARM]: 'Hold still with your arms down to be ready again.',
};

const ARMS = ['right', 'left'];
const OTHER = { right: 'left', left: 'right' };
const WRISTS = { right: 'right_wrist', left: 'left_wrist' };
const ELBOWS = { right: 'right_elbow', left: 'left_elbow' };
const OWN_SHOULDER = { right: 'right_shoulder', left: 'left_shoulder' };
const HANDS = {
  right: ['right_index', 'right_pinky', 'right_thumb'],
  left: ['left_index', 'left_pinky', 'left_thumb'],
};
const TORSO_POINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'];
const PREFERRED_ARMS = ['auto', 'left', 'right'];

function clamp(v, low, high) { return Math.max(low, Math.min(high, v)); }

// One arm sample: the wrist when visible, else the mean of the visible hand
// landmarks; null when neither exists. No position is invented.
function armSample(landmarks, arm, minVisibility) {
  const wrist = landmarks[WRISTS[arm]];
  if (wrist && Number(wrist.visibility || 0) >= minVisibility) {
    const x = Number(wrist.x); const y = Number(wrist.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y, visibility: Number(wrist.visibility || 0), source: 'wrist' };
    }
  }
  let sx = 0.0; let sy = 0.0; let sv = 0.0; let count = 0;
  for (const name of HANDS[arm]) {
    const lm = landmarks[name];
    if (!lm || Number(lm.visibility || 0) < minVisibility) continue;
    sx += Number(lm.x); sy += Number(lm.y); sv += Number(lm.visibility || 0);
    count += 1;
  }
  if (count === 0) return null;
  const x = sx / count; const y = sy / count;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, visibility: sv / count, source: 'hand' };
}

function point(landmarks, name) {
  const lm = landmarks[name];
  if (!lm) return null;
  const x = Number(lm.x); const y = Number(lm.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, visibility: Number(lm.visibility || 0) };
}

function angleAt(a, b, c) {
  const v1x = a.x - b.x; const v1y = a.y - b.y;
  const v2x = c.x - b.x; const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y); const n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  return Math.acos(clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1.0, 1.0)) * 180.0 / Math.PI;
}

export class SwingClassifier {
  constructor(overrides = null) {
    this._overrides = overrides || {};
    this.phase = STATE_TRACKING;
    this._time = 0.0;
    this._phase_started = 0.0;
    this._notice = null;
    this._notice_time = -Infinity;
    this._tracking_reason = 'waiting for the first frame';
    this._consecutive_valid = 0;
    this._consecutive_invalid = 0;
    this._total_frames = 0;
    this._smooth = { right: null, left: null };
    this._vel = { right: { x: 0.0, y: 0.0 }, left: { x: 0.0, y: 0.0 } };
    this._prev_raw = { right: null, left: null };
    this._prev_source = { right: null, left: null };
    this._prev_elbow_raw = { right: null, left: null };
    this._elbow_smooth = { right: null, left: null };
    this._elbow_vel = { right: { x: 0.0, y: 0.0 }, left: { x: 0.0, y: 0.0 } };
    this._prev_shoulder_mid = null;
    this._shoulder_angle = null;
    this._body_vel = { x: 0.0, y: 0.0 };
    this._torso_height = 0.0;
    this._ready_hold = 0.0;
    this._ready_bad = 0.0;
    this._symmetric_frames = 0;
    this._below_band_since = { right: null, left: null };
    this._elbow_band_since = { right: null, left: null };
    this._swing_arm = null;
    this._stroke_started = 0.0;
    this._stroke_origin_height = 0.0;
    this._stroke_min_height = 0.0;
    this._forward_started = 0.0;
    this._peak_up = 0.0;
    this._rising_frames = 0;
    this._rising_run = 0;
    this._max_rising_run = 0;
    this._reversals = 0;
    this._last_direction = 0;
    this._stroke_body_min = 0.0;
    this._stroke_body_max = 0.0;
    this._stroke_torso_min = 0.0;
    this._stroke_torso_max = 0.0;
    this._stroke_angle_delta = 0.0;
    this._stroke_angle_ref = 0.0;
    this._activity = { right: 0.0, left: 0.0 };
    this._peak_speed = { right: 0.0, left: 0.0 };
    this._occluded_backswing = false;
    this._hand_source = { right: 'wrist', left: 'wrist' };
    this._history = [];
    // Session statistics (not cleared by reset(), like the legacy detector).
    this.release_count = 0;
    this.blocked_count = 0;
    this.abort_count = 0;
    this.rejected_count = 0;
    this.lost_count = 0;
    this.last_reject_reason = null;
    this.last_release = null;
  }

  _c(name) { return name in this._overrides ? this._overrides[name] : config[name]; }

  get preferred_arm() {
    const value = String(this._c('CLASSIFIER_PREFERRED_ARM') || '').toLowerCase();
    if (PREFERRED_ARMS.includes(value)) return value;
    const fallback = String(config.SWING_PREFERRED_ARM || 'auto').toLowerCase();
    return PREFERRED_ARMS.includes(fallback) ? fallback : 'auto';
  }

  setPreferredArm(arm) {
    arm = String(arm).toLowerCase();
    if (!PREFERRED_ARMS.includes(arm)) throw new Error(`unknown throwing arm: ${arm}`);
    this._overrides.CLASSIFIER_PREFERRED_ARM = arm;
    this.reset();
  }

  get label() { return STATE_LABELS[this.phase] || this.phase; }

  get hint() {
    if (this._notice !== null && this._time - this._notice_time <= this._c('CLASSIFIER_NOTICE_TIME')) {
      return this._notice;
    }
    if (this.phase === STATE_TRACKING && this._tracking_reason) {
      return this._tracking_reason;
    }
    return STATE_HINTS[this.phase] || '';
  }

  // Why the ready pose is not established yet (player-facing, for tracking).
  get tracking_reason() { return this._tracking_reason; }

  get telemetry() {
    const arm = this._swing_arm
      || (Math.abs(this._vel.right.y) >= Math.abs(this._vel.left.y) ? 'right' : 'left');
    const velocity = this._vel[arm];
    const speed = -velocity.y;                    // + = rising
    let direction;
    if (speed > 0.08) direction = 'up';
    else if (speed < -0.08) direction = 'down';
    else direction = 'still';
    const last = this._history.length ? this._history[this._history.length - 1] : null;
    return {
      state: this.phase,
      arm,
      speed,
      lateral_speed: velocity.x,
      direction,
      depth: this._depth(),
      rise: this._rise(),
      peak_up: this._peak_up,
      confidence: last ? last.confidence : 0.0,
      hand: this._hand_source[arm] || 'wrist',
      tracking: this._tracking_reason,
      other_ratio: this._dominance_ratio(),
      rejects: this.rejected_count,
      blocked: this.blocked_count,
    };
  }

  telemetrySummary() {
    const t = this.telemetry;
    return `state=${t.state} arm=${t.arm} v=${t.speed >= 0 ? '+' : ''}${t.speed.toFixed(2)} (${t.direction})`
      + ` depth=${t.depth.toFixed(2)} rise=${t.rise.toFixed(2)} peak=${t.peak_up.toFixed(2)}`
      + ` hand=${t.hand} other=${t.other_ratio.toFixed(2)}`;
  }

  // Hand height above the shoulders in torso heights (for the avatar).
  get swing_pose() {
    const arm = this._swing_arm || this._dominant_arm();
    const pos = this._smooth[arm];
    if (pos === null) return 0.0;
    return clamp(-pos.y / 0.35, -1.0, 1.0);
  }

  // 0..1 progress toward a release, for the power meter.
  get release_progress() {
    if (this.phase === STATE_RELEASE || this.phase === STATE_FOLLOW) return 1.0;
    if (this.phase === STATE_BACKSWING) {
      const needed = Math.max(this._c('CLASSIFIER_BACK_MIN_DEPTH'), 1e-6);
      return 0.35 * clamp(this._depth() / needed, 0.0, 1.0);
    }
    if (this.phase === STATE_FORWARD) {
      const needed = Math.max(this._c('CLASSIFIER_FORWARD_MIN_RISE') * 0.9, 1e-6);
      return clamp(0.35 + 0.65 * (this._rise() / needed), 0.0, 1.0);
    }
    return 0.0;
  }

  reset() {
    this.phase = STATE_TRACKING;
    this._time = 0.0;
    this._phase_started = 0.0;
    this._notice = null;
    this._notice_time = -Infinity;
    this._tracking_reason = 'waiting for the first frame';
    this._consecutive_valid = 0;
    this._consecutive_invalid = 0;
    this._total_frames = 0;
    this._smooth = { right: null, left: null };
    this._vel = { right: { x: 0.0, y: 0.0 }, left: { x: 0.0, y: 0.0 } };
    this._prev_raw = { right: null, left: null };
    this._prev_source = { right: null, left: null };
    this._prev_elbow_raw = { right: null, left: null };
    this._elbow_smooth = { right: null, left: null };
    this._elbow_vel = { right: { x: 0.0, y: 0.0 }, left: { x: 0.0, y: 0.0 } };
    this._prev_shoulder_mid = null;
    this._shoulder_angle = null;
    this._body_vel = { x: 0.0, y: 0.0 };
    this._torso_height = 0.0;
    this._ready_hold = 0.0;
    this._ready_bad = 0.0;
    this._symmetric_frames = 0;
    this._below_band_since = { right: null, left: null };
    this._elbow_band_since = { right: null, left: null };
    this._clear_stroke();
    this._hand_source = { right: 'wrist', left: 'wrist' };
    this._history = [];
  }

  _clear_stroke() {
    this._swing_arm = null;
    this._stroke_started = 0.0;
    this._stroke_origin_height = 0.0;
    this._stroke_min_height = 0.0;
    this._forward_started = 0.0;
    this._peak_up = 0.0;
    this._rising_frames = 0;
    this._rising_run = 0;
    this._max_rising_run = 0;
    this._reversals = 0;
    this._last_direction = 0;
    this._stroke_body_min = 0.0;
    this._stroke_body_max = 0.0;
    this._stroke_torso_min = 0.0;
    this._stroke_torso_max = 0.0;
    this._stroke_angle_delta = 0.0;
    this._stroke_angle_ref = 0.0;
    this._activity = { right: 0.0, left: 0.0 };
    this._peak_speed = { right: 0.0, left: 0.0 };
    this._occluded_backswing = false;
  }

  // ------------------------------------------------------------ main update
  // One processed camera frame. Returns a SwingEvent exactly when a
  // convincing bowling sequence completes, otherwise null.
  update(result, dt = 1.0 / 30.0) {
    const rawDt = Number(dt);
    const stepDt = Number.isFinite(rawDt) && rawDt > 0.0 ? rawDt : 1.0 / 30.0;
    this._time += stepDt;
    this._total_frames += 1;
    if (stepDt > this._c('CLASSIFIER_MAX_FRAME_GAP')) {
      this._lost_frame('irregular camera frames');
      return null;
    }
    const frame = this._ingest(result, stepDt);
    if (frame === null) return null;
    this._consecutive_valid += 1;
    this._consecutive_invalid = 0;
    this._tracking_reason = this._describe_ready(frame);
    this._history.push(frame);
    const keep = this._c('CLASSIFIER_HISTORY_TIME') + 0.5;
    while (this._history.length && this._history[0].t < this._time - keep) this._history.shift();
    return this._machine(frame, stepDt);
  }

  // A frame that cannot be trusted: count it, decay velocities, and abort a
  // stroke after a sustained loss. Outside a stroke short gaps are tolerated
  // (the player can re-establish the ready pose); inside a stroke the limit is
  // strict, so unrelated motion on either side of an interruption can never
  // combine into a throw.
  _lost_frame(reason) {
    this.lost_count += 1;
    this.last_reject_reason = reason;
    this._consecutive_valid = 0;
    this._consecutive_invalid += 1;
    this._decay_velocities();
    const limit = this._phase_in_stroke()
      ? this._c('CLASSIFIER_STROKE_MAX_INVALID_RUN')
      : this._c('CLASSIFIER_MAX_INVALID_RUN');
    if (this._consecutive_invalid > limit) {
      if (this._phase_in_stroke()) {
        this._abort(`tracking was interrupted (${reason}) - try again`);
      } else if (this.phase === STATE_READY || this.phase === STATE_FOLLOW || this.phase === STATE_REARM) {
        this._to_tracking('tracking lost - stand back into the camera view');
      }
    }
  }

  _decay_velocities() {
    const decay = 1.0 - this._c('CLASSIFIER_VELOCITY_SMOOTHING');
    for (const arm of ARMS) {
      this._vel[arm].x *= decay; this._vel[arm].y *= decay;
      this._elbow_vel[arm].x *= decay; this._elbow_vel[arm].y *= decay;
    }
  }

  // Build the normalized feature record for one frame, or reject the frame.
  _ingest(result, dt) {
    if (!result || !result.tracked || !result.landmarks) {
      this._lost_frame('no pose detected');
      return null;
    }
    const confidence = Number(result.confidence || 0.0);
    if (confidence < this._c('CLASSIFIER_MIN_CONFIDENCE')) {
      this._lost_frame('low tracking confidence');
      return null;
    }
    const landmarks = result.landmarks;
    const minVisibility = this._c('CLASSIFIER_TORSO_VISIBILITY');
    const torsoPoints = {};
    for (const name of TORSO_POINTS) {
      const lm = point(landmarks, name);
      if (lm === null || lm.visibility < minVisibility) {
        this._lost_frame('torso landmark missing');
        return null;
      }
      torsoPoints[name] = lm;
    }
    const ls = torsoPoints.left_shoulder; const rs = torsoPoints.right_shoulder;
    const lh = torsoPoints.left_hip; const rh = torsoPoints.right_hip;
    const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    const torsoH = hipMid.y - shoulderMid.y;
    if (!(torsoH >= this._c('CLASSIFIER_MIN_TORSO_HEIGHT'))) {
      this._lost_frame('move back so your hips and shoulders are visible');
      return null;
    }
    if (this._prev_shoulder_mid !== null
        && Math.hypot(shoulderMid.x - this._prev_shoulder_mid.x,
          shoulderMid.y - this._prev_shoulder_mid.y) > this._c('CLASSIFIER_MAX_TORSO_JUMP')) {
      this._lost_frame('torso landmark jumped');
      return null;
    }
    const frame = {
      t: this._time, dt, confidence,
      torsoH, shoulderMid, hipMid,
      bodyX: (ls.x + rs.x + lh.x + rh.x) / 4,
      shoulderAngle: Math.atan2(rs.y - ls.y, rs.x - ls.x),
      bodySpeedX: 0.0, bodySpeedY: 0.0,
      arms: { right: null, left: null },
    };
    if (this._prev_shoulder_mid !== null) {
      const alpha = this._c('CLASSIFIER_VELOCITY_SMOOTHING');
      this._body_vel.x = alpha * (shoulderMid.x - this._prev_shoulder_mid.x) / dt
        + (1 - alpha) * this._body_vel.x;
      this._body_vel.y = alpha * (shoulderMid.y - this._prev_shoulder_mid.y) / dt
        + (1 - alpha) * this._body_vel.y;
    }
    frame.bodySpeedX = this._body_vel.x;
    frame.bodySpeedY = this._body_vel.y;
    this._prev_shoulder_mid = { ...shoulderMid };
    this._shoulder_angle = frame.shoulderAngle;
    this._torso_height = torsoH;

    const posSmoothing = this._c('CLASSIFIER_POSITION_SMOOTHING');
    const velSmoothing = this._c('CLASSIFIER_VELOCITY_SMOOTHING');
    const maxJump = this._c('CLASSIFIER_MAX_HAND_JUMP');
    const maxSpeed = this._c('CLASSIFIER_MAX_HAND_SPEED');

    for (const arm of ARMS) {
      const shoulder = torsoPoints[OWN_SHOULDER[arm]];
      const sample = armSample(landmarks, arm, this._c('CLASSIFIER_WRIST_VISIBILITY'));
      const elbow = point(landmarks, ELBOWS[arm]);
      const elbowVisible = elbow !== null
        && elbow.visibility >= this._c('CLASSIFIER_TORSO_VISIBILITY');
      // ---- elbow chain -------------------------------------------------
      let elbowRel = null;
      if (elbowVisible) {
        elbowRel = { x: (elbow.x - shoulder.x) / torsoH, y: (elbow.y - shoulder.y) / torsoH };
        const prevRaw = this._prev_elbow_raw[arm];
        let accept = true;
        if (prevRaw !== null) {
          const jump = Math.hypot(elbowRel.x - prevRaw.x, elbowRel.y - prevRaw.y);
          if (jump > maxJump || jump / dt > maxSpeed) {
            accept = false;
            this._frame_reject(`${arm} elbow jumped ${jump.toFixed(2)} torso units in one frame`);
          }
        }
        if (accept) {
          this._prev_elbow_raw[arm] = elbowRel;
          const prev = this._elbow_smooth[arm];
          if (prev === null) {
            this._elbow_smooth[arm] = { ...elbowRel };
          } else {
            const sx = posSmoothing * elbowRel.x + (1 - posSmoothing) * prev.x;
            const sy = posSmoothing * elbowRel.y + (1 - posSmoothing) * prev.y;
            const rawX = (sx - prev.x) / dt; const rawY = (sy - prev.y) / dt;
            this._elbow_smooth[arm] = { x: sx, y: sy };
            this._elbow_vel[arm].x = velSmoothing * rawX + (1 - velSmoothing) * this._elbow_vel[arm].x;
            this._elbow_vel[arm].y = velSmoothing * rawY + (1 - velSmoothing) * this._elbow_vel[arm].y;
          }
        } else {
          this._prev_elbow_raw[arm] = elbowRel;
          this._elbow_smooth[arm] = null;
          elbowRel = null;
        }
      } else {
        this._elbow_smooth[arm] = null;
      }
      const elbowUp = -this._elbow_vel[arm].y;
      const elbowHeight = this._elbow_smooth[arm] === null ? null : -this._elbow_smooth[arm].y;

      // ---- hand sample -------------------------------------------------
      let accepted = null;
      if (sample !== null) {
        const rel = { x: (sample.x - shoulder.x) / torsoH, y: (sample.y - shoulder.y) / torsoH };
        const prevRaw = this._prev_raw[arm];
        const prevSource = this._prev_source[arm];
        let reject = false;
        if (prevRaw !== null && prevSource === sample.source) {
          const jump = Math.hypot(rel.x - prevRaw.x, rel.y - prevRaw.y);
          if (jump > maxJump || jump / dt > maxSpeed) {
            reject = true;
            this._frame_reject(`${arm} hand jumped ${jump.toFixed(2)} torso units in one frame`);
            if (this._swing_arm === arm && this._phase_in_stroke()) {
              this._abort('hand tracking jumped mid-swing - try again');
            }
          }
        }
        if (reject) {
          // Adopt the new position as the baseline so a genuine fast
          // re-acquisition does not lock the arm out, but never let the
          // rejected sample move the machine this frame.
          this._prev_raw[arm] = rel;
          this._prev_source[arm] = sample.source;
          this._hand_source[arm] = sample.source;
          this._smooth[arm] = null;
          this._vel[arm].x = 0.0; this._vel[arm].y = 0.0;
        } else {
          this._prev_raw[arm] = rel;
          this._prev_source[arm] = sample.source;
          this._hand_source[arm] = sample.source;
          const prev = this._smooth[arm];
          const reset = prev === null || prevSource !== sample.source;
          let smoothed;
          let rawVelX = 0.0; let rawVelY = 0.0;
          if (reset) {
            smoothed = { ...rel };
          } else {
            smoothed = {
              x: posSmoothing * rel.x + (1 - posSmoothing) * prev.x,
              y: posSmoothing * rel.y + (1 - posSmoothing) * prev.y,
            };
            rawVelX = (smoothed.x - prev.x) / dt;
            rawVelY = (smoothed.y - prev.y) / dt;
          }
          this._smooth[arm] = smoothed;
          this._vel[arm].x = velSmoothing * rawVelX + (1 - velSmoothing) * this._vel[arm].x;
          this._vel[arm].y = velSmoothing * rawVelY + (1 - velSmoothing) * this._vel[arm].y;
          const elbowAngle = (elbow !== null && elbowVisible)
            ? angleAt({ x: shoulder.x, y: shoulder.y }, elbow, { x: sample.x, y: sample.y })
            : null;
          accepted = {
            present: true, source: sample.source, x: smoothed.x, y: smoothed.y,
            height: -smoothed.y,                        // + = above the shoulder
            reach: Math.hypot(smoothed.x, smoothed.y),  // torso units
            elbowRel, elbowAngle, elbowHeight,
            up: -this._vel[arm].y,                      // + = rising
            vx: this._vel[arm].x,
          };
        }
      } else {
        this._prev_raw[arm] = null;
        this._prev_source[arm] = null;
        this._smooth[arm] = null;
        this._vel[arm].x *= (1 - velSmoothing);
        this._vel[arm].y *= (1 - velSmoothing);
      }
      if (accepted === null) {
        accepted = {
          present: false, source: null, x: null, y: null, height: null, reach: null,
          elbowRel, elbowAngle: null, elbowHeight,
          up: -this._vel[arm].y, vx: this._vel[arm].x,
        };
      }
      frame.arms[arm] = accepted;
      // Band membership: a backswing may only start after the hand has been
      // low (the ready pose) for a moment. This is what separates a deliberate
      // wind-up from the return stroke of an arm raise/pump: in the pump the
      // hand was above the band moments before, so the descent cannot start a
      // stroke and the machine never leaves ready.
      if (accepted.present && accepted.height <= this._c('CLASSIFIER_READY_HAND_BELOW')) {
        if (this._below_band_since[arm] === null) this._below_band_since[arm] = this._time;
      } else if (accepted.present) {
        this._below_band_since[arm] = null;
      }
      if (accepted.elbowHeight !== null
          && accepted.elbowHeight <= this._c('CLASSIFIER_READY_HAND_BELOW') + this._c('CLASSIFIER_ELBOW_BAND_MARGIN')) {
        if (this._elbow_band_since[arm] === null) this._elbow_band_since[arm] = this._time;
      } else if (accepted.elbowHeight !== null) {
        this._elbow_band_since[arm] = null;
      }
      // Stroke activity accumulates for both arms while a swing is in flight,
      // so the dominance ratio compares like with like.
      if (this._swing_arm !== null && this._phase_in_stroke()) {
        this._activity[arm] += Math.abs(accepted.up) * dt;
        this._peak_speed[arm] = Math.max(this._peak_speed[arm], accepted.up);
      }
      if (this._swing_arm === arm) {
        if (accepted.present && accepted.height !== null) {
          this._stroke_min_height = Math.min(this._stroke_min_height, accepted.height);
        } else if (this._occluded_backswing && accepted.elbowHeight !== null) {
          // The wrist and hand are hidden: the elbow chain carries the
          // stroke, measured in the same torso-height units.
          this._stroke_min_height = Math.min(this._stroke_min_height, accepted.elbowHeight);
        }
      }
    }
    this._update_stroke_extents(frame);
    return frame;
  }

  _frame_reject(reason) {
    this.rejected_count += 1;
    this.last_reject_reason = reason;
  }

  // Track the stroke envelope (shoulder height, torso size, torso rotation)
  // from the moment a swing starts until it releases or aborts.
  _update_stroke_extents(frame) {
    if (this._swing_arm === null) return;
    const bodyY = frame.shoulderMid.y;
    const torso = frame.torsoH;
    this._stroke_body_min = Math.min(this._stroke_body_min, bodyY);
    this._stroke_body_max = Math.max(this._stroke_body_max, bodyY);
    this._stroke_torso_min = Math.min(this._stroke_torso_min, torso);
    this._stroke_torso_max = Math.max(this._stroke_torso_max, torso);
    let delta = frame.shoulderAngle - this._stroke_angle_ref;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    this._stroke_angle_delta = Math.max(this._stroke_angle_delta, Math.abs(delta));
  }

  _phase_in_stroke() {
    return this.phase === STATE_BACKSWING || this.phase === STATE_FORWARD
      || this.phase === STATE_RELEASE;
  }

  // ------------------------------------------------------------- reporting
  _dominant_arm() {
    const preferred = this.preferred_arm;
    if (preferred === 'left' || preferred === 'right') return preferred;
    const left = this._smooth.left; const right = this._smooth.right;
    if (left === null) return 'right';
    if (right === null) return 'left';
    const rightSpeed = Math.abs(this._vel.right.y) + Math.abs(this._vel.right.x);
    const leftSpeed = Math.abs(this._vel.left.y) + Math.abs(this._vel.left.x);
    return rightSpeed >= leftSpeed ? 'right' : 'left';
  }

  _depth() {
    if (this._swing_arm === null) return 0.0;
    return Math.max(0.0, this._stroke_origin_height - this._stroke_min_height);
  }

  _rise() {
    if (this._swing_arm === null) return 0.0;
    const pos = this._smooth[this._swing_arm];
    if (pos === null) return 0.0;
    return Math.max(0.0, -pos.y - this._stroke_min_height);
  }

  _dominance_ratio() {
    if (this._swing_arm === null) return 0.0;
    const own = this._activity[this._swing_arm];
    return this._activity[OTHER[this._swing_arm]] / Math.max(own, 1e-6);
  }

  // A player-facing reason why the ready pose is not established.
  _describe_ready(frame) {
    let handsSeen = 0;
    for (const arm of ARMS) {
      const a = frame.arms[arm];
      if (!a.present) continue;
      handsSeen += 1;
      if (a.height > this._c('CLASSIFIER_READY_HAND_BELOW')) {
        return 'lower your arms to your sides to get ready';
      }
      if (Math.abs(a.up) > this._c('CLASSIFIER_READY_MAX_HAND_SPEED')) {
        return 'hold still with your arms down to get ready';
      }
    }
    if (handsSeen === 0) return 'keep your hands visible to the camera';
    if (Math.abs(frame.bodySpeedY) / frame.torsoH > this._c('CLASSIFIER_READY_MAX_BODY_SPEED')) {
      return 'hold still to get ready';
    }
    return '';
  }

  // ---------------------------------------------------------- state machine
  _machine(frame, dt) {
    switch (this.phase) {
      case STATE_TRACKING: return this._state_tracking(frame, dt);
      case STATE_READY: return this._state_ready(frame, dt);
      case STATE_BACKSWING: return this._state_backswing(frame, dt);
      case STATE_FORWARD: return this._state_forward(frame, dt);
      case STATE_RELEASE: return this._state_release(frame);
      case STATE_FOLLOW: return this._state_follow(frame);
      default: return this._state_rearm(frame, dt);
    }
  }

  _state_tracking(frame, dt) {
    if (!this._ready_pose(frame)) { this._ready_hold = 0.0; return null; }
    this._ready_hold += dt;
    if (this._ready_hold >= this._c('CLASSIFIER_READY_HOLD')
        && this._consecutive_valid >= this._c('CLASSIFIER_TRACK_MIN_FRAMES')) {
      this._set_phase(STATE_READY);
    }
    return null;
  }

  _state_ready(frame, dt) {
    if (!this._ready_pose(frame)) {
      this._ready_bad += dt;
      if (this._ready_bad >= this._c('CLASSIFIER_READY_GRACE')) {
        this._to_tracking('hold still with your arms down to be ready');
      }
    } else {
      this._ready_bad = 0.0;
    }
    const start = this._backswing_start(frame);
    if (start !== null) this._begin_backswing(start);
    return null;
  }

  // Which arm is deliberately swinging down/back from the ready pose? The
  // wrist (or the visible elbow chain when the wrist is hidden) must be near
  // the ready band, descending, and must have been low for a moment first -
  // so the return stroke of an arm raise cannot start a wind-up.
  _backswing_start(frame) {
    const settle = this._c('CLASSIFIER_BACK_SETTLE_TIME');
    const candidates = [];
    for (const arm of this._candidate_arms()) {
      const a = frame.arms[arm];
      const downSpeed = a.present
        ? -a.up
        : (a.elbowRel !== null ? this._elbow_vel[arm].y * this._c('CLASSIFIER_ELBOW_SPEED_SCALE') : null);
      if (downSpeed === null || downSpeed < this._c('CLASSIFIER_BACK_START_SPEED')) continue;
      const height = a.present ? a.height : a.elbowHeight;
      if (height === null) continue;
      const band = this._c('CLASSIFIER_READY_HAND_BELOW') + this._c('CLASSIFIER_BACK_BAND_MARGIN');
      if (height > band) continue;
      // Settled: this same evidence source has been low long enough.
      const lowSince = a.present ? this._below_band_since[arm] : this._elbow_band_since[arm];
      if (lowSince === null || frame.t - lowSince < settle) continue;
      candidates.push({ arm, height, occluded: !a.present, speed: downSpeed });
    }
    if (!candidates.length) return null;
    if (candidates.length === 2) {
      const slower = Math.min(candidates[0].speed, candidates[1].speed);
      const faster = Math.max(candidates[0].speed, candidates[1].speed);
      if (faster > 1e-6 && slower / faster > this._c('CLASSIFIER_SYMMETRY_START_RATIO')) {
        this._symmetric_frames += 1;
        if (this._symmetric_frames === this._c('CLASSIFIER_SYMMETRY_FRAMES') + 1) {
          this._set_notice('both arms are moving together - throw with one arm');
        }
        return null;
      }
    }
    this._symmetric_frames = 0;
    candidates.sort((a, b) => b.speed - a.speed);
    return candidates[0];
  }

  _begin_backswing(start) {
    this._clear_stroke();
    this.phase = STATE_BACKSWING;
    this._phase_started = this._time;
    this._stroke_started = this._time;
    this._swing_arm = start.arm;
    this._occluded_backswing = !!start.occluded;
    this._stroke_origin_height = start.height;
    this._stroke_min_height = start.height;
    if (this._prev_shoulder_mid !== null) {
      this._stroke_body_min = this._prev_shoulder_mid.y;
      this._stroke_body_max = this._prev_shoulder_mid.y;
    }
    this._stroke_torso_min = this._torso_height;
    this._stroke_torso_max = this._torso_height;
    this._stroke_angle_ref = this._shoulder_angle || 0.0;
    this._stroke_angle_delta = 0.0;
  }

  _state_backswing(frame, dt) {
    const arm = this._swing_arm;
    const a = frame.arms[arm];
    const depth = this._depth();
    const elapsed = this._time - this._phase_started;
    const upSpeed = a.present
      ? a.up
      : (a.elbowRel !== null ? -this._elbow_vel[arm].y * this._c('CLASSIFIER_ELBOW_SPEED_SCALE') : 0.0);
    const reversal = this._c('CLASSIFIER_BACK_REVERSAL_SPEED');
    if (depth >= this._c('CLASSIFIER_BACK_MIN_DEPTH')
        && elapsed >= this._c('CLASSIFIER_BACK_MIN_TIME')
        && upSpeed >= reversal && (a.present || this._occluded_backswing)) {
      this._begin_forward();
      return null;
    }
    // The hand returned to the ready band without a real stroke.
    if (a.present && elapsed > this._c('CLASSIFIER_BACK_MIN_TIME')
        && depth < this._c('CLASSIFIER_BACK_MIN_DEPTH')
        && Math.abs(a.up) <= this._c('CLASSIFIER_READY_MAX_HAND_SPEED')) {
      this._to_ready('the swing stopped - try a full backswing');
      return null;
    }
    if (elapsed >= this._c('CLASSIFIER_BACK_TIMEOUT')) {
      this._abort('no forward swing detected - swing your arm forward');
    }
    return null;
  }

  _begin_forward() {
    this.phase = STATE_FORWARD;
    this._phase_started = this._time;
    this._forward_started = this._time;
    this._peak_up = 0.0;
    this._rising_frames = 0;
    this._rising_run = 0;
    this._max_rising_run = 0;
    this._reversals = 0;
    this._last_direction = 0;
  }

  _state_forward(frame, dt) {
    const arm = this._swing_arm;
    const a = frame.arms[arm];
    const elapsed = this._time - this._forward_started;
    if (a.present && a.height !== null) {
      this._stroke_min_height = Math.min(this._stroke_min_height, a.height);
      const up = a.up;
      this._peak_up = Math.max(this._peak_up, up);
      const upThreshold = this._c('CLASSIFIER_FORWARD_UP_SPEED');
      if (up >= upThreshold) {
        this._rising_frames += 1;
        this._rising_run += 1;
        this._max_rising_run = Math.max(this._max_rising_run, this._rising_run);
        if (this._last_direction === -1) this._reversals += 1;
        this._last_direction = 1;
      } else if (up <= -upThreshold * 0.5) {
        this._rising_run = 0;
        if (this._last_direction === 1) this._reversals += 1;
        this._last_direction = -1;
      } else {
        this._rising_run = 0;
      }
    } else if (!this._occluded_backswing && elapsed > this._c('CLASSIFIER_HAND_LOSS_GRACE')) {
      // The throwing hand vanished mid-delivery without a tracked occlusion.
      this._blocked('the throwing hand disappeared mid-swing - try again');
      return null;
    }
    const ready = this._release_ready(frame, elapsed);
    if (ready.ok) {
      const event = this._release(ready);
      return event;
    }
    if (ready.block !== undefined) {
      this._blocked(ready.block);
      return null;
    }
    if (elapsed >= this._c('CLASSIFIER_FORWARD_TIMEOUT')) {
      this._abort('no release detected - swing your arm forward and up');
    }
    return null;
  }

  // Evaluate every release gate; the first failure gives the player-facing
  // reason. Returns { ok, event, arm } on release, { block } on a definitive
  // rejection, or {} while the stroke is still in progress.
  _release_ready(frame, elapsed) {
    const arm = this._swing_arm;
    const a = frame.arms[arm];
    if (!a.present || a.height === null) return {};
    const up = a.up;
    const rise = this._rise();
    const depth = this._depth();
    const peak = this._peak_up;
    if (elapsed < this._c('CLASSIFIER_FORWARD_MIN_TIME')) return {};
    if (this._max_rising_run < this._c('CLASSIFIER_FORWARD_MIN_RISING_RUN')) return {};
    if (rise < this._c('CLASSIFIER_FORWARD_MIN_RISE')) return {};
    if (peak < this._c('CLASSIFIER_FORWARD_MIN_PEAK')) return {};
    const crossed = a.height >= this._c('CLASSIFIER_RELEASE_HAND_HEIGHT')
      && up >= this._c('CLASSIFIER_RELEASE_UP_SPEED');
    const peaked = up < Math.max(this._c('CLASSIFIER_FORWARD_MIN_PEAK') * 0.5, peak * 0.5);
    if (!crossed && !peaked) return {};

    // ---- definitive gate region: every failure now blocks the throw.
    if (depth < this._c('CLASSIFIER_BACK_MIN_DEPTH') && !this._occluded_backswing) {
      return { block: 'no backswing - swing your arm back, then forward' };
    }
    const other = OTHER[arm];
    const otherPeak = this._peak_speed[other];
    const ownActivity = this._activity[arm];
    const otherActivity = this._activity[other];
    const otherMoved = frame.arms[other].present || otherPeak > 0.0;
    if (otherMoved && otherPeak > this._c('CLASSIFIER_OTHER_ARM_ABS')) {
      if (otherActivity > ownActivity * this._c('CLASSIFIER_DOMINANCE_RATIO')) {
        return { block: 'both arms moved together - throw with one arm' };
      }
      if (otherActivity > ownActivity * this._c('CLASSIFIER_DOMINANCE_MAX_RATIO')) {
        return { block: 'the other arm moved more than the throwing arm' };
      }
    }
    const bodyLift = Math.abs(this._stroke_body_max - this._stroke_body_min);
    if (bodyLift > this._c('CLASSIFIER_MAX_BODY_LIFT') * frame.torsoH) {
      return { block: 'your body jumped during the swing - keep your feet settled' };
    }
    if (this._stroke_torso_min > 0
        && (this._stroke_torso_max - this._stroke_torso_min) / this._stroke_torso_min
          > this._c('CLASSIFIER_MAX_TORSO_CHANGE')) {
      return { block: 'you crouched too far mid-swing - stay upright' };
    }
    if (this._stroke_angle_delta > this._c('CLASSIFIER_MAX_TORSO_TURN') * Math.PI / 180) {
      return { block: 'you turned away from the camera mid-swing' };
    }
    if (this._reversals > this._c('CLASSIFIER_MAX_REVERSALS')) {
      return { block: 'the swing stuttered - use one smooth forward swing' };
    }
    const event = new SwingEvent(
      Math.max(peak, 0.0), frame.bodyX, arm,
      this._stroke_started > 0.0 ? this._time - this._stroke_started : elapsed,
      this._time, Math.max(0.0, up), rise, depth,
      frame.confidence, this._hand_source[arm] || 'wrist',
      a.vx, a.x);
    return { ok: true, event, arm };
  }

  _release(ready) {
    const event = ready.event;
    this.release_count += 1;
    this.last_release = {
      t: this._time, arm: ready.arm, up_speed: event.up_speed,
      rise: event.rise, depth: event.depth,
    };
    this.phase = STATE_RELEASE;
    this._phase_started = this._time;
    this._notice = null;
    return event;
  }

  _state_release(frame) {
    if (this._time - this._phase_started >= this._c('CLASSIFIER_RELEASE_FLASH')) {
      this.phase = STATE_FOLLOW;
      this._phase_started = this._time;
      this._set_notice('throw released - lower your arms to get ready again');
    }
    return null;
  }

  _state_follow(frame) {
    if (this._time - this._phase_started >= this._c('CLASSIFIER_FOLLOW_TIME')) {
      this.phase = STATE_REARM;
      this._phase_started = this._time;
    }
    return null;
  }

  _state_rearm(frame, dt) {
    if (!this._ready_pose(frame)) { this._ready_hold = 0.0; return null; }
    this._ready_hold += dt;
    if (this._ready_hold >= this._c('CLASSIFIER_READY_HOLD')) {
      this._set_phase(STATE_READY);
    }
    return null;
  }

  // ------------------------------------------------------------- helpers
  _candidate_arms() {
    const preferred = this.preferred_arm;
    return (preferred === 'left' || preferred === 'right') ? [preferred] : ['right', 'left'];
  }

  _set_phase(phase) {
    this.phase = phase;
    this._phase_started = this._time;
    this._ready_hold = 0.0;
    this._ready_bad = 0.0;
  }

  _to_tracking(reason) {
    this.phase = STATE_TRACKING;
    this._phase_started = this._time;
    this._ready_hold = 0.0;
    this._ready_bad = 0.0;
    this._clear_stroke();
    if (reason) this._set_notice(reason);
  }

  _to_ready(reason) {
    this._clear_stroke();
    this.phase = STATE_READY;
    this._phase_started = this._time;
    this._ready_bad = 0.0;
    if (reason) this._set_notice(reason);
  }

  _blocked(reason) {
    this.blocked_count += 1;
    this.last_reject_reason = reason;
    this._abort(reason);
    return null;
  }

  _abort(reason) {
    this.abort_count += 1;
    this.last_reject_reason = reason || this.last_reject_reason;
    // After a rejected attempt the player must re-establish the ready pose;
    // the rearm state does exactly that, so the failed motion cannot leak
    // into the next roll.
    this._clear_stroke();
    this.phase = STATE_REARM;
    this._phase_started = this._time;
    this._ready_hold = 0.0;
    this._ready_bad = 0.0;
    this._set_notice(reason || 'swing not accepted - return to the ready position');
  }

  _set_notice(reason) {
    this._notice = reason;
    this._notice_time = this._time;
  }

  _ready_pose(frame) {
    const top = this._c('CLASSIFIER_READY_HAND_BELOW');
    const maxSpeed = this._c('CLASSIFIER_READY_MAX_HAND_SPEED');
    let visible = 0;
    for (const arm of ARMS) {
      const a = frame.arms[arm];
      if (!a.present) continue;
      visible += 1;
      if (a.height > top) return false;
      if (Math.abs(a.up) > maxSpeed) return false;
    }
    if (visible === 0) return false;
    return Math.abs(frame.bodySpeedY) / frame.torsoH <= this._c('CLASSIFIER_READY_MAX_BODY_SPEED');
  }
}