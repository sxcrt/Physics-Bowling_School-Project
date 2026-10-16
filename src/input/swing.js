// Bowling swing recognition from tracked body landmarks (ported from input/swing.py).
import * as config from '../config.js';

export const PHASE_WAITING = 'waiting';
export const PHASE_READY = 'ready';
export const PHASE_BACKSWING = 'backswing';
export const PHASE_FORWARD = 'forward';
export const PHASE_FOLLOW = 'follow_through';

export const PHASE_LABELS = {
  [PHASE_WAITING]: 'Waiting for ready position', [PHASE_READY]: 'Ready',
  [PHASE_BACKSWING]: 'Backswing', [PHASE_FORWARD]: 'Forward swing',
  [PHASE_FOLLOW]: 'Throw released',
};
export const PHASE_HINTS = {
  [PHASE_WAITING]: 'Stand still with your arms down and wait for READY.',
  [PHASE_READY]: 'Swing your arm forward and up to throw.',
  [PHASE_BACKSWING]: 'Now swing forward!',
  [PHASE_FORWARD]: 'Keep going - release!',
  [PHASE_FOLLOW]: 'Throw detected - return to the ready position.',
};

const WRISTS = { left: 'left_wrist', right: 'right_wrist' };
const ELBOWS = { left: 'left_elbow', right: 'right_elbow' };
const HANDS = {
  left: ['left_index', 'left_pinky', 'left_thumb'],
  right: ['right_index', 'right_pinky', 'right_thumb'],
};
const ARMS = ['right', 'left'];
const PREFERRED_ARMS = ['auto', 'left', 'right'];

export class SwingEvent {
  constructor(upSpeed, bodyX, arm, duration, time, releaseSpeed = 0.0, rise = 0.0,
              depth = 0.0, confidence = 0.0, handSource = 'wrist', lateralSpeed = 0.0,
              handOffset = 0.0) {
    this.up_speed = upSpeed; this.body_x = bodyX; this.arm = arm;
    this.duration = duration; this.time = time; this.release_speed = releaseSpeed;
    this.rise = rise; this.depth = depth; this.confidence = confidence;
    this.hand_source = handSource; this.lateral_speed = lateralSpeed;
    this.hand_offset = handOffset;
  }
}

export class SwingDetector {
  constructor(overrides = null) {
    this._overrides = overrides || {};
    this.phase = PHASE_WAITING;
    this._time = 0.0;
    this._frames = 0;
    this._ready_hold = 0.0;
    this._ready_bad_time = 0.0;
    this._swing_arm = null;
    this._swing_start_rel = 0.0;
    this._backswing_deepest_rel = 0.0;
    this._phase_started = 0.0;
    this._swing_started_at = null;
    this._peak_up_speed = 0.0;
    this._forward_low_rel = 0.0;
    this._forward_rising_frames = 0;
    this._rise = 0.0;
    this._lost_frames = 0;
    this._prev_shoulder_y = null;
    this._notice = null;
    this._notice_time = 0.0;
    this._prev_raw = { right: null, left: null };
    this._smooth = { right: null, left: null };
    this._prev_source = { right: null, left: null };
    this._prev_elbow = { right: null, left: null };
    this._vel = { right: 0.0, left: 0.0 };
    this._raw_vel = { right: 0.0, left: 0.0 };
    this._lateral_vel = { right: 0.0, left: 0.0 };
    this._hand_source = { right: 'wrist', left: 'wrist' };
    this._ready_rel = { right: null, left: null };
    this._frame_confidence = 0.0;
    this._torso_height = 0.0;
    this.rejected_count = 0;
    this.lost_count = 0;
    this.release_count = 0;
    this.abort_count = 0;
    this.last_reject_reason = null;
  }

  _c(name) { return name in this._overrides ? this._overrides[name] : config[name]; }

  get preferred_arm() {
    const value = String(this._c('SWING_PREFERRED_ARM')).toLowerCase();
    return PREFERRED_ARMS.includes(value) ? value : 'auto';
  }
  setPreferredArm(arm) {
    arm = String(arm).toLowerCase();
    if (!PREFERRED_ARMS.includes(arm)) throw new Error(`unknown throwing arm: ${arm}`);
    this._overrides.SWING_PREFERRED_ARM = arm;
  }

  get label() { return PHASE_LABELS[this.phase] || this.phase; }
  get hint() {
    if (this._notice !== null && this._time - this._notice_time <= this._c('SWING_NOTICE_TIME')) return this._notice;
    return PHASE_HINTS[this.phase] || '';
  }

  get telemetry() {
    let arm = this._swing_arm;
    if (arm === null) arm = Math.abs(this._vel.right) >= Math.abs(this._vel.left) ? 'right' : 'left';
    const speed = this._vel[arm];
    let direction;
    if (speed > 0.05) direction = 'down';
    else if (speed < -0.05) direction = 'up';
    else direction = 'still';
    let depth = 0.0;
    if (this._swing_arm !== null) depth = Math.max(0.0, this._backswing_deepest_rel - this._swing_start_rel);
    return {
      arm, speed, direction, depth, rise: this._rise, peak_up: this._peak_up_speed,
      confidence: this._frame_confidence, hand: this._hand_source[arm] || 'wrist',
      jumps: this.rejected_count,
    };
  }

  telemetrySummary() {
    const t = this.telemetry;
    return `arm=${t.arm} v=${t.speed >= 0 ? '+' : ''}${t.speed.toFixed(2)} (${t.direction}) depth=${t.depth.toFixed(2)} rise=${t.rise.toFixed(2)} peak=${t.peak_up.toFixed(2)} hand=${t.hand}`;
  }

  get swing_pose() {
    if (this._torso_height <= 0.0) return 0.0;
    let arm = this._swing_arm;
    if (arm === null) arm = Math.abs(this._vel.right) >= Math.abs(this._vel.left) ? 'right' : 'left';
    const pos = this._smooth[arm];
    if (pos === null) return 0.0;
    const value = -pos[1] / (0.35 * this._torso_height);
    return Math.max(-1.0, Math.min(1.0, value));
  }

  reset() {
    this.phase = PHASE_WAITING;
    this._ready_hold = 0.0; this._ready_bad_time = 0.0;
    this._swing_arm = null; this._swing_start_rel = 0.0; this._backswing_deepest_rel = 0.0;
    this._swing_started_at = null; this._peak_up_speed = 0.0; this._forward_low_rel = 0.0;
    this._forward_rising_frames = 0; this._rise = 0.0; this._lost_frames = 0;
    this._prev_shoulder_y = null; this._notice = null;
    this._prev_raw = { right: null, left: null };
    this._smooth = { right: null, left: null };
    this._prev_source = { right: null, left: null };
    this._prev_elbow = { right: null, left: null };
    this._vel = { right: 0.0, left: 0.0 };
    this._raw_vel = { right: 0.0, left: 0.0 };
    this._lateral_vel = { right: 0.0, left: 0.0 };
    this._hand_source = { right: 'wrist', left: 'wrist' };
    this._ready_rel = { right: null, left: null };
  }

  // Browser-only extension (not part of the Python parity contract): the
  // deliberate-swing validator in src/input/validate.js refused a release the
  // phase machine recognized. Return to waiting and tell the player what to
  // correct; the physical swing can never leak into the next roll.
  reject(reason) {
    this._abort(reason || 'Swing not accepted - return to the ready position.');
  }

  update(result, dt = 1.0 / 30.0) {
    let rawDt = Number(dt);
    if (!Number.isFinite(rawDt) || rawDt <= 0.0) rawDt = 1.0 / 30.0;
    const stepDt = Math.max(1.0 / 240.0, Math.min(0.2, rawDt));
    this._time += stepDt;
    this._frames += 1;
    this._frame_confidence = Number(result.confidence || 0.0);

    if (!result.tracked || !result.landmarks) return this._unreliable('no pose detected');
    if (this._frame_confidence < this._c('SWING_MIN_CONFIDENCE')) return this._unreliable('low tracking confidence');
    if (rawDt > this._c('SWING_MAX_FRAME_GAP')) return this._unreliable('irregular frame timing');

    const torso = this._torso(result.landmarks);
    if (torso === null) return this._unreliable('torso not visible');
    const [shoulderY, hipY, bodyX, shoulderX] = torso;
    const torsoH = hipY - shoulderY;
    if (torsoH < this._c('SWING_MIN_TORSO_HEIGHT')) return this._unreliable('torso too small');
    this._torso_height = torsoH;
    if (this._prev_shoulder_y !== null && Math.abs(shoulderY - this._prev_shoulder_y) > this._c('SWING_MAX_TORSO_JUMP')) {
      return this._unreliable('torso landmark jump');
    }
    this._prev_shoulder_y = shoulderY;
    this._lost_frames = 0;

    if (this._trackSamples(result.landmarks, shoulderX, shoulderY, stepDt)) return null;

    if (this.phase === PHASE_WAITING) this._updateWaiting(torsoH, stepDt);
    else if (this.phase === PHASE_READY) this._updateReady(torsoH, stepDt);
    else if (this.phase === PHASE_BACKSWING) this._updateBackswing(torsoH);
    else if (this.phase === PHASE_FORWARD) {
      const event = this._updateForward(torsoH, bodyX);
      if (event !== null) return event;
    } else if (this.phase === PHASE_FOLLOW) {
      if (this._time - this._phase_started >= this._c('SWING_FOLLOW_TIME')) this._toWaiting();
    }
    return null;
  }

  _updateWaiting(torsoH, dt) {
    this._rememberReadyPositions(torsoH);
    if (this._isReadyPose(torsoH)) {
      this._ready_hold += dt;
      if (this._ready_hold >= this._c('SWING_READY_HOLD')) { this.phase = PHASE_READY; this._ready_bad_time = 0.0; }
    } else this._ready_hold = 0.0;
  }

  _updateReady(torsoH, dt) {
    const arm = this._backswingCandidate();
    if (arm !== null) { this._beginBackswing(arm); return; }
    const arm2 = this._directThrowCandidate();
    if (arm2 !== null) { this._beginForward(arm2, this._ready_rel[arm2]); return; }
    this._rememberReadyPositions(torsoH);
    if (this._isReadyPose(torsoH)) { this._ready_bad_time = 0.0; return; }
    this._ready_bad_time += dt;
    if (this._ready_bad_time >= this._c('SWING_READY_GRACE_TIME')) { this.phase = PHASE_WAITING; this._ready_hold = 0.0; }
  }

  _updateBackswing(torsoH) {
    const arm = this._swing_arm;
    const pos = this._pos(arm);
    if (pos !== null) this._backswing_deepest_rel = Math.max(this._backswing_deepest_rel, pos[1]);
    const depth = (this._backswing_deepest_rel - this._swing_start_rel) / torsoH;
    const elapsed = this._time - this._phase_started;
    const upSpeed = -this._vel[arm];
    if (depth >= this._c('SWING_BACK_MIN_DEPTH') && elapsed >= this._c('SWING_BACK_MIN_TIME')
        && upSpeed >= this._c('SWING_FORWARD_UP_SPEED')) {
      this._beginForward(arm);
    } else if (elapsed >= this._c('SWING_BACK_TIMEOUT')) {
      this._abort('No forward swing detected - swing your arm forward.');
    }
  }

  _updateForward(torsoH, bodyX) {
    const arm = this._swing_arm;
    const pos = this._pos(arm);
    const elapsed = this._time - this._phase_started;
    if (pos !== null) {
      const upSmoothed = -this._vel[arm];
      const upRaw = -this._raw_vel[arm];
      this._peak_up_speed = Math.max(this._peak_up_speed, upSmoothed);
      this._rise = Math.max(0.0, (this._forward_low_rel - pos[1]) / torsoH);
      if (upRaw >= this._c('SWING_FORWARD_UP_SPEED')) this._forward_rising_frames += 1;

      const releaseRel = this._c('SWING_RELEASE_FRACTION') * torsoH;
      const crossed = pos[1] <= releaseRel && upRaw >= this._c('SWING_RELEASE_UP_SPEED');
      const minSpeed = this._c('SWING_RELEASE_MIN_SPEED');
      const peaked = this._peak_up_speed >= minSpeed
        && upSmoothed < Math.max(minSpeed * 0.5, this._peak_up_speed * 0.5);
      const releaseReady = elapsed >= this._c('SWING_FORWARD_MIN_TIME')
        && this._forward_rising_frames >= this._c('SWING_RELEASE_MIN_FRAMES')
        && this._rise >= this._c('SWING_RELEASE_MIN_RISE')
        && this._peak_up_speed >= minSpeed;
      if (releaseReady && (crossed || peaked)) return this._release(arm, bodyX, torsoH);
    }
    if (elapsed >= this._c('SWING_FORWARD_TIMEOUT')) {
      this._abort('No release detected - swing your arm forward and up.');
    }
    return null;
  }

  _pos(arm) { return this._smooth[arm]; }

  _torso(landmarks) {
    const points = [];
    for (const name of ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']) {
      const landmark = landmarks[name];
      if (landmark === undefined || landmark === null || landmark.visibility < this._c('SWING_WRIST_VISIBILITY')) return null;
      points.push(landmark);
    }
    const shoulderY = (points[0].y + points[1].y) / 2.0;
    const hipY = (points[2].y + points[3].y) / 2.0;
    const bodyX = points.reduce((s, p) => s + p.x, 0) / 4.0;
    const shoulderX = (points[0].x + points[1].x) / 2.0;
    return [shoulderY, hipY, bodyX, shoulderX];
  }

  _sample(landmarks, arm) {
    const minVisibility = this._c('SWING_WRIST_VISIBILITY');
    const wrist = landmarks[WRISTS[arm]];
    if (wrist !== undefined && wrist !== null && wrist.visibility >= minVisibility) {
      return { x: wrist.x, y: wrist.y, visibility: wrist.visibility, source: 'wrist' };
    }
    const pts = [];
    for (const name of HANDS[arm]) {
      const landmark = landmarks[name];
      if (landmark !== undefined && landmark !== null && landmark.visibility >= minVisibility) pts.push(landmark);
    }
    if (!pts.length) return null;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      visibility: pts.reduce((s, p) => s + p.visibility, 0) / pts.length,
      source: 'hand',
    };
  }

  _trackSamples(landmarks, shoulderX, shoulderY, dt) {
    let rejected = false;
    const smoothing = this._c('SWING_LANDMARK_SMOOTHING');
    const velSmoothing = this._c('SWING_VELOCITY_SMOOTHING');
    const maxJump = this._c('SWING_MAX_JUMP');
    const maxSpeed = this._c('SWING_MAX_SPEED');
    const minVisibility = this._c('SWING_WRIST_VISIBILITY');
    for (const arm of ARMS) {
      const sample = this._sample(landmarks, arm);
      const elbow = landmarks[ELBOWS[arm]];
      let elbowRel = null;
      if (elbow !== undefined && elbow !== null && elbow.visibility >= minVisibility) {
        elbowRel = [elbow.x - shoulderX, elbow.y - shoulderY];
      }
      if (sample === null) {
        this._hand_source[arm] = 'wrist';
        this._prev_raw[arm] = null; this._smooth[arm] = null; this._prev_source[arm] = null;
        this._prev_elbow[arm] = null; this._raw_vel[arm] = 0.0;
        this._vel[arm] *= (1.0 - velSmoothing);
        this._lateral_vel[arm] *= (1.0 - velSmoothing);
        continue;
      }
      this._hand_source[arm] = sample.source;
      const rel = [sample.x - shoulderX, sample.y - shoulderY];
      const previousRaw = this._prev_raw[arm];
      let invalid = null;
      if (previousRaw !== null && sample.source === this._prev_source[arm]) {
        const jump = Math.hypot(rel[0] - previousRaw[0], rel[1] - previousRaw[1]);
        if (jump > maxJump || jump / dt > maxSpeed) invalid = `${arm} hand jumped ${jump.toFixed(2)} units in one frame`;
      }
      const previousElbow = this._prev_elbow[arm];
      if (invalid === null && elbowRel !== null && previousElbow !== null) {
        const jump = Math.hypot(elbowRel[0] - previousElbow[0], elbowRel[1] - previousElbow[1]);
        if (jump > maxJump || jump / dt > maxSpeed) invalid = `${arm} elbow jumped ${jump.toFixed(2)} units in one frame`;
      }
      if (invalid !== null) {
        rejected = true;
        this.rejected_count += 1;
        this.last_reject_reason = invalid;
        if (this._swing_arm === arm && (this.phase === PHASE_BACKSWING || this.phase === PHASE_FORWARD)) {
          this._abort('Hand tracking jumped mid-swing - try again.');
        }
        this._prev_raw[arm] = rel; this._prev_elbow[arm] = elbowRel;
        this._smooth[arm] = null; this._raw_vel[arm] = 0.0;
        this._vel[arm] = 0.0; this._lateral_vel[arm] = 0.0;
        continue;
      }
      this._prev_elbow[arm] = elbowRel;
      if (sample.source !== this._prev_source[arm]) this._smooth[arm] = null;
      this._prev_source[arm] = sample.source;
      const previous = this._smooth[arm];
      let smoothed, rawX, rawY;
      if (previous === null) { smoothed = rel; rawX = rawY = 0.0; }
      else {
        smoothed = [smoothing * rel[0] + (1.0 - smoothing) * previous[0],
                    smoothing * rel[1] + (1.0 - smoothing) * previous[1]];
        rawX = (smoothed[0] - previous[0]) / dt;
        rawY = (smoothed[1] - previous[1]) / dt;
      }
      this._prev_raw[arm] = rel;
      this._smooth[arm] = smoothed;
      this._raw_vel[arm] = rawY;
      this._vel[arm] = velSmoothing * rawY + (1.0 - velSmoothing) * this._vel[arm];
      this._lateral_vel[arm] = velSmoothing * rawX + (1.0 - velSmoothing) * this._lateral_vel[arm];
    }
    return rejected;
  }

  _isReadyPose(torsoH) {
    const top = this._c('SWING_READY_BELOW_SHOULDER') * torsoH;
    const maxSpeed = this._c('SWING_READY_MAX_SPEED');
    for (const arm of ARMS) {
      const pos = this._pos(arm);
      if (pos === null) continue;
      if (pos[1] < top) return false;
      if (Math.abs(this._raw_vel[arm]) > maxSpeed) return false;
    }
    return true;
  }

  _rememberReadyPositions(torsoH) {
    const top = this._c('SWING_READY_BELOW_SHOULDER') * torsoH;
    for (const arm of ARMS) {
      const pos = this._pos(arm);
      if (pos !== null && pos[1] >= top) this._ready_rel[arm] = pos[1];
    }
  }

  _candidateArms() {
    const preferred = this.preferred_arm;
    return (preferred in WRISTS) ? [preferred] : ['right', 'left'];
  }

  _backswingCandidate() {
    const threshold = this._c('SWING_BACK_DOWN_SPEED');
    let best = null, bestSpeed = 0.0;
    for (const arm of this._candidateArms()) {
      if (this._pos(arm) === null) continue;
      const speed = this._vel[arm];
      if (speed >= threshold && speed > bestSpeed) { best = arm; bestSpeed = speed; }
    }
    return best;
  }

  _directThrowCandidate() {
    const threshold = this._c('SWING_DIRECT_THROW_SPEED');
    let best = null, bestSpeed = 0.0;
    for (const arm of this._candidateArms()) {
      if (this._pos(arm) === null) continue;
      const speed = -this._vel[arm];
      if (speed >= threshold && speed > bestSpeed) { best = arm; bestSpeed = speed; }
    }
    return best;
  }

  _beginBackswing(arm) {
    const pos = this._pos(arm);
    let start = this._ready_rel[arm];
    if (start === null || start === undefined) start = pos !== null ? pos[1] : 0.0;
    this.phase = PHASE_BACKSWING;
    this._swing_arm = arm;
    this._phase_started = this._time;
    if (this._swing_started_at === null) this._swing_started_at = this._time;
    this._swing_start_rel = start;
    this._backswing_deepest_rel = pos !== null ? pos[1] : start;
    this._peak_up_speed = 0.0;
  }

  _beginForward(arm, baseline = null) {
    const pos = this._pos(arm);
    this.phase = PHASE_FORWARD;
    this._swing_arm = arm;
    this._phase_started = this._time;
    if (this._swing_started_at === null) this._swing_started_at = this._time;
    let base = baseline !== null && baseline !== undefined ? baseline : this._backswing_deepest_rel;
    if (base === null || base === undefined) base = pos !== null ? pos[1] : 0.0;
    this._forward_low_rel = pos !== null ? Math.max(base, pos[1]) : base;
    this._forward_rising_frames = (-this._raw_vel[arm] >= this._c('SWING_FORWARD_UP_SPEED')) ? 1 : 0;
    this._peak_up_speed = Math.max(0.0, -this._vel[arm]);
    this._rise = 0.0;
  }

  _release(arm, bodyX, torsoH) {
    const depth = Math.max(0.0, (this._backswing_deepest_rel - this._swing_start_rel) / torsoH);
    const pos = this._pos(arm);
    const handOffset = pos === null ? 0.0 : pos[0] / torsoH;
    const event = new SwingEvent(
      Math.max(this._peak_up_speed, 0.0), bodyX, arm,
      this._swing_started_at === null ? 0.0 : this._time - this._swing_started_at,
      this._time, Math.max(0.0, -this._vel[arm]), this._rise, depth,
      this._frame_confidence, this._hand_source[arm], this._lateral_vel[arm], handOffset);
    this.release_count += 1;
    this.phase = PHASE_FOLLOW;
    this._phase_started = this._time;
    this._notice = null;
    return event;
  }

  _unreliable(reason) {
    this._lost_frames += 1;
    this.lost_count += 1;
    this.last_reject_reason = reason;
    this._prev_shoulder_y = null;
    this._prev_raw = { right: null, left: null };
    this._smooth = { right: null, left: null };
    this._prev_source = { right: null, left: null };
    this._prev_elbow = { right: null, left: null };
    this._raw_vel = { right: 0.0, left: 0.0 };
    const decay = 1.0 - this._c('SWING_VELOCITY_SMOOTHING');
    for (const arm of ARMS) { this._vel[arm] *= decay; this._lateral_vel[arm] *= decay; }
    if (this._lost_frames > this._c('SWING_LOST_GRACE_FRAMES')) {
      if (this.phase === PHASE_BACKSWING || this.phase === PHASE_FORWARD) {
        this._abort(`Tracking lost during the swing (${reason}) - try again.`);
      } else if (this.phase === PHASE_READY || this.phase === PHASE_FOLLOW) {
        this._toWaiting();
        this._setNotice('Tracking lost - step back into the camera view.');
      }
    }
    return null;
  }

  _abort(message) { this.abort_count += 1; this._toWaiting(); this._setNotice(message); }
  _setNotice(message) { this._notice = message; this._notice_time = this._time; }
  _toWaiting() {
    this.phase = PHASE_WAITING;
    this._ready_hold = 0.0; this._ready_bad_time = 0.0;
    this._swing_arm = null; this._swing_start_rel = 0.0; this._backswing_deepest_rel = 0.0;
    this._swing_started_at = null; this._peak_up_speed = 0.0; this._forward_low_rel = 0.0;
    this._forward_rising_frames = 0; this._rise = 0.0;
  }
}
