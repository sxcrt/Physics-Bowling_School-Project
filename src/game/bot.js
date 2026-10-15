// The bot bowler (ported from game/bot.py).
import * as config from '../config.js';
import { simulateRoll } from '../physics.js';

export const DIFFICULTIES = {
  easy: { label: 'Easy', candidates: 1, line_sigma: 0.130, speed_sigma: 1.10, spin_sigma: 1.30, deadline: 1.0 },
  medium: { label: 'Medium', candidates: 3, line_sigma: 0.075, speed_sigma: 0.55, spin_sigma: 0.80, deadline: 3.0 },
  hard: { label: 'Hard', candidates: 6, line_sigma: 0.030, speed_sigma: 0.22, spin_sigma: 0.35, deadline: 6.0 },
};

export const POCKET_OFFSET = 0.076;
export const HOOK_DRIFT_PER_RAD = -0.075;
export const BASE_SPEED = 7.6;
export const DEFAULT_SPIN = -1.6;

// A small seeded PRNG (mulberry32) with a Box-Muller gaussian.
function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    gauss(mu = 0, sigma = 1) {
      let u = 0, v = 0;
      while (u === 0) u = this.next();
      while (v === 0) v = this.next();
      return mu + sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    },
  };
}

export function makeThrowData(data = {}) {
  return {
    lateral_position: 0.0, launch_angle: 0.0, speed: 0.0, spin_omega: 0.0,
    source: 'mouse', confidence: 1.0, ...data,
  };
}

export class BotPlanner {
  constructor(difficulty = 'medium', rng = null) {
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'medium';
    this._rng = rng || makeRng((Math.random() * 0xffffffff) >>> 0);
    this._candidates = [];
    this._index = 0;
    this._best = null;
    this._best_score = -1;
    this._elapsed = 0.0;
    this._active = false;
    this._standing = [];
  }
  get settings() { return DIFFICULTIES[this.difficulty]; }
  get label() { return this.settings.label; }
  get is_planning() { return this._active; }
  get progress() {
    const total = this._candidates.length;
    return total === 0 ? 1.0 : Math.min(1.0, this._index / total);
  }

  start(standing) {
    this._standing = standing.slice();
    this._candidates = this._buildCandidates(this._standing);
    this._index = 0;
    this._best = null;
    this._best_score = -1;
    this._elapsed = 0.0;
    this._active = true;
  }
  cancel() { this._active = false; this._candidates = []; this._index = 0; }

  step(budgetSeconds = 0.02) {
    if (!this._active) return null;
    const started = performance.now() / 1000;
    while (this._index < this._candidates.length && this._active) {
      const candidate = this._candidates[this._index];
      const result = simulateRoll({
        speed: candidate.speed, lateral_position: candidate.lateral_position,
        launch_angle: candidate.launch_angle, spin_omega: candidate.spin_omega,
      }, null, this._standing);
      this._index += 1;
      const score = result.knockdowns;
      this._note(candidate, score);
      if (score > this._best_score) { this._best_score = score; this._best = candidate; }
      this._elapsed += performance.now() / 1000 - started;
      if (this._elapsed > this.settings.deadline || performance.now() / 1000 - started > budgetSeconds) break;
    }
    if (this._index >= this._candidates.length || this._elapsed > this.settings.deadline) {
      this._active = false;
      if (this._best === null && this._candidates.length) this._best = this._candidates[0];
      return this._best;
    }
    return null;
  }

  planNow(standing, seed = null) {
    const rng = seed === null ? this._rng : makeRng(seed);
    const previous = this._rng;
    this._rng = rng;
    try {
      this.start(standing);
      let result = null;
      while (result === null) result = this.step(1.0);
      return result;
    } finally { this._rng = previous; }
  }

  get last_best_score() { return this._best_score; }

  _note(candidate, score) { candidate.predicted = score; }

  _buildCandidates(standing) {
    const settings = this.settings;
    const count = Math.max(1, settings.candidates);
    const front = this._frontPin(standing);
    const candidates = [];
    for (let i = 0; i < count; i++) {
      let targetX;
      if (front === null) targetX = 0.0;
      else if (Math.abs(front[0]) < 1e-6) targetX = POCKET_OFFSET;
      else targetX = front[0];
      const entry = targetX + this._rng.gauss(0.0, settings.line_sigma);
      let speed = BASE_SPEED + this._rng.gauss(0.0, settings.speed_sigma);
      speed = Math.max(config.MIN_THROW_SPEED + 0.5, Math.min(config.MAX_THROW_SPEED, speed));
      let spin = DEFAULT_SPIN + this._rng.gauss(0.0, settings.spin_sigma);
      spin = Math.max(-config.MAX_SPIN, Math.min(config.MAX_SPIN, spin));
      candidates.push(this._throwForEntry(entry, speed, spin));
    }
    return candidates;
  }

  _throwForEntry(entryX, speed, spin) {
    const drift = HOOK_DRIFT_PER_RAD * spin;
    const lineX = entryX - drift;
    const lateral = Math.max(-config.LATERAL_LIMIT, Math.min(config.LATERAL_LIMIT, lineX * 0.5));
    let yaw = Math.atan2(lineX - lateral, config.LANE_LENGTH);
    const limit = config.MAX_AIM_ANGLE * Math.PI / 180;
    yaw = Math.max(-limit, Math.min(limit, yaw));
    return makeThrowData({
      lateral_position: lateral, launch_angle: yaw, speed: speed,
      spin_omega: spin, source: 'bot', confidence: 1.0,
    });
  }

  _frontPin(standing) {
    if (!standing.length) return null;
    return standing.reduce((a, b) => (b[1] < a[1] ? b : a));
  }
}
