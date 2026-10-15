// Mouse + keyboard input (ported from input/mouse_input.py).
import * as config from '../config.js';
import { uiPointer, pointerState, ASPECT } from './pointer.js';
import { heldKeys } from './keyboard.js';

export function makeThrowData(data = {}) {
  return {
    lateral_position: 0.0, launch_angle: 0.0, speed: 0.0, spin_omega: 0.0,
    source: 'mouse', confidence: 1.0, ...data,
  };
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

export function aimAngle(aimOffset, lateralPosition, distance = null) {
  distance = distance === null ? config.AIM_ARROW_Z : distance;
  if (distance <= 1e-6) return 0.0;
  const limit = config.MAX_AIM_ANGLE * Math.PI / 180;
  const yaw = Math.atan2(aimOffset - lateralPosition, distance);
  return clamp(yaw, -limit, limit);
}

export class ReleaseNoise {
  constructor(seed = null) {
    if (seed === null) seed = config.RELEASE_NOISE_SEED;
    this.seed = seed;
    let a = (seed === null ? (Math.random() * 0xffffffff) : (seed >>> 0));
    this._random = (() => {
      return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
  }
  uniform(low, high) { return low + this._random() * (high - low); }

  apply(launchAngle, speed, spin) {
    const yaw = config.RELEASE_NOISE_YAW;
    const speedNoise = config.RELEASE_NOISE_SPEED;
    const spinNoise = config.RELEASE_NOISE_SPIN;
    if (yaw <= 0.0 && speedNoise <= 0.0 && spinNoise <= 0.0) return [launchAngle, speed, spin];
    if (yaw > 0.0) launchAngle += this.uniform(-yaw, yaw) * Math.PI / 180;
    if (speedNoise > 0.0) speed += this.uniform(-speedNoise, speedNoise);
    if (spinNoise > 0.0) spin += this.uniform(-spinNoise, spinNoise);
    return [launchAngle, speed, spin];
  }
}

export class MouseInput {
  constructor(pointer = null, button = null, noise = null, dtProvider = null) {
    this.lateral = 0.0;
    this.aim_offset = 0.0;
    this.aim_angle = 0.0;
    this._pointer = pointer || uiPointer;
    this._button = button;
    this._noise = noise || new ReleaseNoise();
    this._dtProvider = dtProvider || (() => 1 / 60);
    this._prev_pointer = null;
    this._velocity = [0.0, 0.0];
    this._holding = false;
    this._press = null;
    this._peak_forward = 0.0;
    this._peak_lateral = 0.0;
    this._stroke_forward = 0.0;
    this._stroke_lateral = 0.0;
    this._travel = 0.0;
    this._pending = null;
    this._aim_locked = null;
    this.last_release = null;
  }

  get pointer_available() { return pointerState().available; }

  _samplePointer() {
    const [x, y] = this._pointer();
    const dt = clamp(this._dtProvider(), 1e-4, 0.1);
    if (this._prev_pointer !== null && dt > 1e-3) {
      const dx = x - this._prev_pointer[0];
      const dy = y - this._prev_pointer[1];
      const aspect = ASPECT;
      this._velocity = [dx / aspect / dt, dy / dt];
    } else {
      this._velocity = [0.0, 0.0];
    }
    this._prev_pointer = [x, y];
    return [x, y, dt];
  }

  _buttonDown() {
    if (this._button !== null) {
      try { return !!this._button(); } catch (_e) { return false; }
    }
    return pointerState().left;
  }

  update() {
    const [x, y, dt] = this._samplePointer();
    this._updateLateral(dt);
    this._updateAim();
    this._updateThrow(x, y, dt);
  }

  _updateLateral(dt) {
    let direction = 0.0;
    if (heldKeys.has('a') || heldKeys.has('left arrow')) direction -= 1.0;
    if (heldKeys.has('d') || heldKeys.has('right arrow')) direction += 1.0;
    this.lateral += direction * config.LATERAL_SPEED * dt;
    this.lateral = clamp(this.lateral, -config.LATERAL_LIMIT, config.LATERAL_LIMIT);
  }

  _updateAim() {
    if (this._aim_locked !== null) {
      this.aim_offset = this._aim_locked;
    } else {
      const [cursorX] = this._pointer();
      const half = ASPECT / 2.0;
      const fraction = clamp(cursorX / half, -1.0, 1.0);
      this.aim_offset = fraction * config.MOUSE_AIM_RANGE;
    }
    this.aim_angle = aimAngle(this.aim_offset, this.lateral);
  }

  _updateThrow(x, y, dt) {
    const held = this._buttonDown();
    if (held && !this._holding) {
      this._holding = true;
      this._press = [x, y];
      this._aim_locked = this.aim_offset;
      this._peak_forward = 0.0; this._peak_lateral = 0.0;
      this._stroke_forward = 0.0; this._stroke_lateral = 0.0;
      this._travel = 0.0; this._velocity = [0.0, 0.0];
      return;
    }
    if (held) {
      const [lateral, forward] = this._velocity;
      this._travel += Math.max(0.0, forward * dt);
      if (forward > this._peak_forward) {
        this._peak_forward = forward;
        this._stroke_forward = forward;
        this._stroke_lateral = lateral;
      }
      if (Math.abs(lateral) > Math.abs(this._peak_lateral)) this._peak_lateral = lateral;
      return;
    }
    if (!this._holding) return;
    this._holding = false;
    this._release();
    this._aim_locked = null;
    this._press = null;
  }

  _release() {
    let speed = this._peak_forward * config.THROW_SPEED_SCALE;
    if (speed < config.MIN_THROW_SPEED || this._travel < config.MIN_DRAG_DISTANCE) return;
    speed = clamp(speed, config.MIN_THROW_SPEED, config.MAX_THROW_SPEED);
    const direction = this._releaseDirection();
    let launchAngle = clamp(this.aim_angle + direction,
      -config.MAX_LAUNCH_ANGLE * Math.PI / 180, config.MAX_LAUNCH_ANGLE * Math.PI / 180);
    let spin = clamp(this._peak_lateral * config.SPIN_SCALE * config.SPIN_SIGN,
      -config.MAX_SPIN, config.MAX_SPIN);
    [launchAngle, speed, spin] = this._noise.apply(launchAngle, speed, spin);
    speed = clamp(speed, config.MIN_THROW_SPEED, config.MAX_THROW_SPEED);
    spin = clamp(spin, -config.MAX_SPIN, config.MAX_SPIN);
    const throwData = makeThrowData({
      lateral_position: this.lateral, launch_angle: launchAngle, speed: speed,
      spin_omega: spin, source: 'mouse',
    });
    this._pending = throwData;
    this.last_release = throwData;
  }

  _releaseDirection() {
    if (this._stroke_forward <= 1e-3) return 0.0;
    const ratio = this._stroke_lateral / this._stroke_forward;
    const yaw = Math.atan(ratio) * 180 / Math.PI * config.RELEASE_DIRECTION_GAIN;
    return clamp(yaw, -config.MAX_RELEASE_YAW, config.MAX_RELEASE_YAW) * Math.PI / 180;
  }

  get throw_data() {
    const data = this._pending;
    this._pending = null;
    return data;
  }

  discardPending() { this._pending = null; }

  get swing_pose() {
    if (!this._holding || this._press === null) return 0.0;
    const [, y] = this._pointer();
    return clamp((y - this._press[1]) / 0.30, -1.0, 1.0);
  }

  get dragging() { return !!this._holding; }

  get power() {
    const fastest = config.MAX_THROW_SPEED / Math.max(1e-6, config.THROW_SPEED_SCALE);
    return clamp(this._peak_forward / fastest, 0.0, 1.0);
  }

  reset() {
    this._holding = false;
    this._peak_forward = 0.0; this._peak_lateral = 0.0;
    this._stroke_forward = 0.0; this._stroke_lateral = 0.0;
    this._travel = 0.0; this._aim_locked = null; this._pending = null;
    this._press = null; this._velocity = [0.0, 0.0]; this._prev_pointer = null;
  }
}
