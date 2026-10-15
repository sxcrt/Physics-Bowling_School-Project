// The tween / timeline utility (ported from motion/tween.py).
import * as _ease from './ease.js';
import { MOTION } from './config.js';

export class Tween {
  constructor(duration, onUpdate, easing = null, delay = 0.0, onComplete = null,
              loop = false, yoyo = false, tag = null, owner = null, celebrate = false) {
    if (duration === null || duration === undefined) duration = MOTION.ui_max_duration;
    this.duration = Math.max(0.0, Number(duration));
    this.on_update = onUpdate;
    this.delay = Math.max(0.0, Number(delay));
    this.easing = _ease.resolve(easing);
    this.on_complete = onComplete;
    this.loop = !!loop;
    this.yoyo = !!yoyo;
    this.tag = tag;
    this.owner = owner;
    this.time = 0.0;
    this.elapsed = 0.0;
    this.finished = false;
    this.cancelled = false;
    this._direction = 1.0;
    this._started = false;
    if (!celebrate && this.duration > MOTION.ui_max_duration) this.duration = MOTION.ui_max_duration;
  }

  update(dt) {
    if (this.finished || this.cancelled) return false;
    dt = Math.max(0.0, Number(dt));
    this.elapsed += dt;
    if (this.delay > 0.0) {
      if (this.elapsed < this.delay) return true;
      dt = Math.max(0.0, this.elapsed - this.delay);
      this.delay = 0.0;
    }
    this.time += dt;
    if (this.duration <= 0.0) { this._emit(1.0); this._finish(); return false; }
    let raw = this.time / this.duration;
    if (raw >= 1.0) {
      if (this.loop || this.yoyo) {
        this.time = raw = raw % 1.0;
        if (this.yoyo) this._direction *= -1.0;
      } else {
        this._emit(1.0); this._finish(); return false;
      }
    }
    let value = this.easing(raw);
    if (this._direction < 0.0) value = this.easing(1.0 - raw);
    this._emit(value);
    return true;
  }

  _emit(value) {
    this._started = true;
    const cb = this.on_update;
    if (cb === null || cb === undefined) return;
    try { cb(value); }
    catch (_e) { this.finished = true; this.cancelled = true; }
  }

  _finish() {
    this.finished = true;
    const cb = this.on_complete;
    if (cb === null || cb === undefined) return;
    try { cb(); } catch (_e) {}
  }

  cancel(callComplete = false) {
    if (this.finished) return;
    this.cancelled = true;
    this.finished = true;
    if (callComplete) this._finish();
  }
  complete() {
    if (this.finished || this.cancelled) return;
    this._emit(1.0); this._finish();
  }
  restart() {
    this.time = 0.0; this.elapsed = 0.0; this.finished = false;
    this.cancelled = false; this._direction = 1.0;
    return this;
  }
  get progress() {
    if (this.duration <= 0.0) return 1.0;
    return Math.min(1.0, this.time / this.duration);
  }
}

export class Timeline {
  constructor(steps = null, tag = null, owner = null) {
    this.steps = steps ? steps.slice() : [];
    this.index = 0;
    this.timer = 0.0;
    this.active_tween = null;
    this.finished = false;
    this.cancelled = false;
    this.tag = tag;
    this.owner = owner;
  }
  add(step) { this.steps.push(step); return this; }

  update(dt) {
    if (this.finished || this.cancelled) return false;
    dt = Math.max(0.0, Number(dt));
    let guard = 0;
    while (!this.finished && !this.cancelled) {
      guard += 1;
      if (guard > 128) break;
      if (this.active_tween !== null) {
        if (this.active_tween.finished) { this.active_tween = null; this.index += 1; this.timer = 0.0; continue; }
        this.active_tween.update(dt);
        dt = 0.0;
        if (this.active_tween !== null && !this.active_tween.finished) return true;
        continue;
      }
      if (this.index >= this.steps.length) { this.finished = true; return false; }
      const step = this.steps[this.index];
      const [kind, payload] = normalizeStep(step);
      if (kind === 'wait') {
        this.timer += dt; dt = 0.0;
        if (this.timer >= payload) { this.index += 1; this.timer = 0.0; continue; }
        return true;
      }
      if (kind === 'call') { this.index += 1; try { payload(); } catch (_e) {} continue; }
      if (kind === 'tween') { this.active_tween = payload; payload.update(dt); dt = 0.0; continue; }
      this.index += 1;
    }
    return !this.finished;
  }

  cancel() {
    this.cancelled = true; this.finished = true;
    if (this.active_tween !== null) { this.active_tween.cancel(); this.active_tween = null; }
  }
  complete() {
    let guard = 0;
    while (!this.finished && guard < 512) { guard += 1; this.update(1e6); }
  }
  get progress() {
    if (!this.steps.length) return 1.0;
    return Math.min(1.0, this.index / this.steps.length);
  }
}

function normalizeStep(step) {
  if (step instanceof Tween) return ['tween', step];
  if (typeof step === 'number') return ['wait', Math.max(0.0, Number(step))];
  if (typeof step === 'function') return ['call', step];
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    const kind = step.type || 'wait';
    if (kind === 'tween') return ['tween', step.tween];
    return [kind, step.value !== undefined ? step.value : (step.delay !== undefined ? step.delay : 0.0)];
  }
  if (Array.isArray(step) && step.length === 2) {
    const [first, second] = step;
    if (typeof second === 'function') return (typeof first === 'number') ? ['wait', Number(first)] : ['call', second];
    return ['wait', Number(first)];
  }
  return ['skip', null];
}

export function wait(delay) { return { type: 'wait', value: Number(delay) }; }
export function call(callback) { return { type: 'call', value: callback }; }
export function tweenStep(duration, onUpdate, easing = null, delay = 0.0, tag = null, celebrate = false) {
  return { type: 'tween', tween: new Tween(duration, onUpdate, easing, delay, null, false, false, tag, null, celebrate) };
}

export class Motion {
  constructor() {
    this.tweens = [];
    this.timelines = [];
    this.time = 0.0;
    this.last_dt = 1.0 / 60.0;
  }

  tween(duration, onUpdate, easing = null, delay = 0.0, onComplete = null,
        loop = false, yoyo = false, tag = null, owner = null, celebrate = false) {
    const tween = new Tween(duration, onUpdate, easing, delay, onComplete, loop, yoyo, tag, owner, celebrate);
    if (!tween.finished) tween.update(0.0);
    if (!tween.finished) this.tweens.push(tween);
    return tween;
  }

  timeline(steps = null, tag = null, owner = null) {
    const timeline = new Timeline(steps, tag, owner);
    this.timelines.push(timeline);
    return timeline;
  }

  countUp(start, end, duration, setter, formatter = null, easing = null, tag = null, onComplete = null, celebrate = false) {
    return this.tween(duration,
      (p) => reportCount(start, end, p, setter, formatter),
      easing, 0.0, onComplete, false, false, tag, null, celebrate);
  }

  update(dt) {
    dt = Math.max(0.0, Math.min(0.25, Number(dt)));
    this.last_dt = dt || this.last_dt;
    this.time += dt;
    if (this.tweens.length) {
      for (const tween of this.tweens) tween.update(dt);
      this.tweens = this.tweens.filter((t) => !t.finished);
    }
    if (this.timelines.length) {
      for (const timeline of this.timelines) timeline.update(dt);
      this.timelines = this.timelines.filter((t) => !t.finished);
    }
  }

  cancel(tag = null, owner = null) {
    for (const collection of [this.tweens, this.timelines]) {
      for (const item of collection) {
        if (tag === null && owner === null) item.cancel();
        else if (tag !== null && item.tag === tag) item.cancel();
        else if (owner !== null && item.owner === owner) item.cancel();
      }
    }
    this.tweens = this.tweens.filter((t) => !t.finished);
    this.timelines = this.timelines.filter((t) => !t.finished);
  }
  clear() { this.cancel(); }
  get busy() { return !!(this.tweens.length || this.timelines.length); }
}

function reportCount(start, end, progress, setter, formatter) {
  const rounded = Math.round(start + (end - start) * progress);
  setter(formatter ? formatter(rounded) : rounded);
}

export const DEFAULT = new Motion();
