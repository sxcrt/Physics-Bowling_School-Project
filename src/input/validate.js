// Acceptance gate for recognized webcam swings.
//
// `src/input/swing.js` is a byte-parity port of the Python phase machine: it
// recognizes *motion*, and deliberately errs on the sensitive side. Motion
// alone is not intent, though - a two-arm stretch, a wave, a casual arm raise
// or a tracking flicker can satisfy the phase machine's release gates. This
// validator sits between the detector and ThrowData creation and only lets a
// release through when the movement is a deliberate, single-arm,
// well-tracked bowling-like stroke:
//
//   * the whole window before the release is recently and reliably tracked
//     (no stale frames, no confidence drops, no tracking gaps);
//   * the throwing hand sustains a real upward stroke on several frames and
//     the stroke is recent (a stalled peak cannot release);
//   * the hand actually rises, measured from the played-back positions;
//   * the stroke either followed a visible backswing (the hand travelled
//     down first) or is an unusually strong direct stroke;
//   * the other arm stays quiet: a two-arm raise (jumping jacks, a stretch)
//     is rejected even though its trajectory matches the throwing arm's;
//   * one acceptance per ready cycle (a duplicate release from the same
//     physical swing is impossible).
//
// It reads only the frames the detector itself saw (landmarks, confidence,
// detector state), so it cannot be fooled by data the detector rejected, and
// it never invents a release. Rejections are reported with a player-readable
// reason, which the input layer turns into a detector notice.
import * as config from '../config.js';

const ARMS = ['right', 'left'];
const OTHER_ARM = { right: 'left', left: 'right' };

export class SwingValidator {
  constructor(overrides = null) {
    this._overrides = overrides || {};
    this._history = [];
    this._time = 0.0;
    this._last_sample = { right: null, left: null };   // { t, y } per arm
    this._armed = true;
    this._last_accepted = null;
    this.blocked_count = 0;
    this.accepted_count = 0;
    this.last_block_reason = null;
  }

  _c(name) { return name in this._overrides ? this._overrides[name] : config[name]; }

  get enabled() { return !!this._c('SWING_VALIDATE_ENABLED'); }

  reset() {
    this._history = [];
    this._time = 0.0;
    this._last_sample = { right: null, left: null };
    this._armed = true;
    this._last_accepted = null;
  }

  // Record one processed camera frame, after the detector consumed it. The
  // detector's own post-frame state is the source of truth so the validator
  // can never see a landmark the detector rejected.
  observe(result, dt, detector) {
    const t = Number(detector._time) || 0.0;
    // `_lost_frames === 0` means the detector actually consumed this frame
    // (its reliability block ran to the end); the raw gates below mirror the
    // detector's own inputs so the validator never trusts a frame the
    // detector rejected.
    const valid = detector._lost_frames === 0 && !!(
      result && result.tracked && result.landmarks
      && Number(result.confidence || 0.0) >= this._c('SWING_MIN_CONFIDENCE')
      && Number.isFinite(dt) && dt > 0.0 && dt <= this._c('SWING_MAX_FRAME_GAP')
    );
    const y = { right: null, left: null };
    const up = { right: 0.0, left: 0.0 };
    if (valid) {
      for (const arm of ARMS) {
        const pos = detector._smooth[arm];
        y[arm] = pos === null || pos === undefined ? null : Number(pos[1]);
      }
      for (const arm of ARMS) {
        const current = y[arm];
        const previous = this._last_sample[arm];
        if (current === null) { this._last_sample[arm] = null; continue; }
        if (previous !== null && t > previous.t) {
          up[arm] = (previous.y - current) / (t - previous.t);
        }
        this._last_sample[arm] = { t, y: current };
      }
    } else {
      this._last_sample = { right: null, left: null };
    }
    const entry = {
      t, valid, dt,
      phase: detector.phase,
      y, up,
      torso: Number(detector._torso_height) || 0.0,
    };
    this._history.push(entry);
    this._time = t;
    const keep = this._c('SWING_VALIDATE_WINDOW') + 0.5;
    while (this._history.length && this._history[0].t < t - keep) this._history.shift();
    if (entry.phase === 'waiting' || entry.phase === 'ready') this._armed = true;
    return entry;
  }

  // Decide whether the detector's release event may become a throw.
  // Returns { ok, reason }; a rejection also updates the counters.
  check(event) {
    if (!this.enabled) return { ok: true, reason: null };
    if (!event) return this._block('no swing event');
    const now = this._time;
    const window = this._c('SWING_VALIDATE_WINDOW');
    const frames = this._history.filter((f) => f.t >= now - window);
    const minFrames = this._c('SWING_VALIDATE_MIN_CRITICAL_FRAMES') + 2;
    if (frames.length < minFrames) return this._block('not enough recent camera frames');

    // The critical window (right before the release) must be fully valid and
    // dense: a brief confidence spike or a jump-recovered frame cannot throw.
    const critical = frames.filter((f) => f.t >= now - this._c('SWING_VALIDATE_CRITICAL_TIME'));
    if (critical.length < this._c('SWING_VALIDATE_MIN_CRITICAL_FRAMES')) {
      return this._block('the camera slowed down before the release');
    }
    if (critical.some((f) => !f.valid)) {
      return this._block('tracking was interrupted just before the release');
    }

    // The whole stroke window must be reliably tracked, without long gaps.
    const invalid = frames.filter((f) => !f.valid).length;
    if ((frames.length - invalid) / frames.length < this._c('SWING_VALIDATE_MIN_VALID_RATIO')) {
      return this._block('tracking was unreliable during the swing');
    }
    let run = 0;
    let maxRun = 0;
    for (const f of frames) {
      run = f.valid ? 0 : run + 1;
      maxRun = Math.max(maxRun, run);
    }
    if (maxRun > this._c('SWING_VALIDATE_MAX_INVALID_RUN')) {
      return this._block('tracking dropped during the swing');
    }

    const arm = event.arm === 'left' ? 'left' : 'right';
    const other = OTHER_ARM[arm];
    const present = frames.filter((f) => f.y[arm] !== null && f.valid);
    if (present.length < minFrames) return this._block('the throwing arm was not visible enough');
    const torso = present[present.length - 1].torso;
    if (!(torso > this._c('SWING_MIN_TORSO_HEIGHT'))) return this._block('the torso could not be measured');

    // Sustained upward progression of the throwing hand.
    const upFrames = frames.filter((f) => f.y[arm] !== null && f.up[arm] >= this._c('SWING_VALIDATE_UP_SPEED')).length;
    if (upFrames < this._c('SWING_VALIDATE_MIN_UP_FRAMES')) {
      return this._block('no sustained forward swing - swing your arm forward and up');
    }
    const lastUp = [...frames].reverse().find((f) => f.y[arm] !== null && f.up[arm] >= this._c('SWING_VALIDATE_UP_SPEED'));
    if (lastUp && now - lastUp.t > this._c('SWING_VALIDATE_RECENT_UP_TIME')) {
      return this._block('the swing had already stalled before the release');
    }
    const peak = Math.max(...frames.map((f) => (f.y[arm] === null ? -Infinity : f.up[arm])));
    if (!(peak >= this._c('SWING_VALIDATE_MIN_PEAK'))) {
      return this._block('the arm moved too gently for a throw');
    }

    // Positional evidence: how far the hand travelled down (backswing) and
    // how far it then rose. Measured from the same played-back positions the
    // detector differentiated, in torso heights.
    const yValues = present.map((f) => f.y[arm]);
    const yFirst = yValues[0];
    const yLast = yValues[yValues.length - 1];
    const yMax = Math.max(...yValues);
    const rise = (yMax - yLast) / torso;
    const depth = (yMax - yFirst) / torso;
    if (rise < this._c('SWING_VALIDATE_MIN_RISE')) {
      return this._block('the hand did not rise enough for a throw');
    }
    const backswing = this._c('SWING_VALIDATE_MIN_BACKSWING');
    const direct = peak >= this._c('SWING_VALIDATE_DIRECT_PEAK')
      && rise >= this._c('SWING_VALIDATE_DIRECT_RISE');
    if (depth < backswing && !direct) {
      return this._block('no backswing - swing your arm back, then forward');
    }

    // One-armed dominance: an equal two-arm raise is exercise, not bowling.
    const otherFrames = frames.filter((f) => f.y[other] !== null && f.valid);
    if (otherFrames.length) {
      const otherPeak = Math.max(...otherFrames.map((f) => f.up[other]));
      const otherYs = otherFrames.map((f) => f.y[other]);
      const otherRise = (Math.max(...otherYs) - otherYs[otherYs.length - 1]) / torso;
      const allowedPeak = Math.max(this._c('SWING_VALIDATE_OTHER_UP_ABS'),
        peak / this._c('SWING_VALIDATE_DOMINANCE'));
      if (otherPeak > allowedPeak) {
        return this._block('both arms moved together - throw with one arm');
      }
      const allowedRise = Math.max(this._c('SWING_VALIDATE_OTHER_RISE_ABS'),
        rise / this._c('SWING_VALIDATE_DOMINANCE'));
      if (otherRise > allowedRise) {
        return this._block('both arms rose together - throw with one arm');
      }
    }

    // One acceptance per armed cycle: the player must return to the ready
    // pose (observed as a waiting/ready frame) before another throw counts.
    if (!this._armed) {
      return this._block('the swing was already used - return to the ready pose');
    }
    this._armed = false;
    this._last_accepted = { t: now, arm };
    this.accepted_count += 1;
    return { ok: true, reason: null };
  }

  _block(reason) {
    this.blocked_count += 1;
    this.last_block_reason = reason;
    return { ok: false, reason };
  }
}
