// Bowling relations for the shared Physics Lab engine.
//
// The original analytical plan (lab_solver.js) used five relations:
//   p = m v, K = ½ m v², a = −μ g, L = v t + ½ a t², vx = v sin(aim).
// This catalog expresses the same motion in the class-notes form and adds the
// two quantities the solver pass asks for (final speed and distance travelled).
// The numbers are unchanged: speed 7.5 with the default lane still gives
// a = −0.1962 m/s², t = 2.5219 s, vx = −0.0524 m/s, p = 45, K = 168.75.

import * as config from '../config.js';
import { fmt } from './lab_solver.js';
import { Impossible, Ambiguous, solveRelations } from './lab_engine.js';
import { CONSTANT_DEFAULTS } from './lab_solver.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const EPS = 1e-9;
const rad = (degrees) => (degrees * Math.PI) / 180;

export const BOWLING_KEYS = [
  'start', 'aim', 'hook', 'speed', 'finalSpeed', 'distance', 'time', 'accel',
  'sideways', 'momentum', 'energy',
  'mass', 'mu', 'gravity', 'length', 'hookK',
];

export const BOWLING_CORE_KEYS = [
  'start', 'aim', 'hook', 'speed', 'finalSpeed', 'distance', 'time', 'accel',
  'sideways', 'momentum', 'energy',
];

export const BOWLING_META = {
  start: { label: 'Starting position', unit: 'm', symbol: 'x_0', sample: 0.2 },
  aim: { label: 'Aim angle', unit: 'deg', symbol: 'θ', range: [-90, 90], sample: -0.4 },
  hook: { label: 'Hook spin', unit: 'rad/s', symbol: 'ω_s', sample: -1.6 },
  speed: { label: 'Initial speed', unit: 'm/s', symbol: 'v_i', min: 0, sample: 7.5 },
  finalSpeed: { label: 'Final speed', unit: 'm/s', symbol: 'v_f', sample: 7.0 },
  distance: { label: 'Distance travelled', unit: 'm', symbol: 'Δx', min: 0, sample: 18.29 },
  time: { label: 'Time', unit: 's', symbol: 't', min: 0, sample: 2.5 },
  accel: { label: 'Acceleration', unit: 'm/s²', symbol: 'a', sample: -0.1962 },
  sideways: { label: 'Sideways speed', unit: 'm/s', symbol: 'v_x', sample: -0.0524 },
  momentum: { label: 'Momentum', unit: 'kg·m/s', symbol: 'p', min: 0, sample: 45 },
  energy: { label: 'Kinetic energy', unit: 'J', symbol: 'K', min: 0, sample: 168.75 },
  mass: { label: 'Ball mass', unit: 'kg', symbol: 'm', min: 0, sample: config.BALL_MASS },
  mu: { label: 'Friction coefficient', unit: '', symbol: 'μ', min: 0, sample: config.ROLLING_FRICTION },
  gravity: { label: 'Gravity', unit: 'm/s²', symbol: 'g', min: 0, sample: config.GRAVITY },
  length: { label: 'Lane length', unit: 'm', symbol: 'L', min: 0, sample: config.LANE_LENGTH },
  hookK: { label: 'Hook constant', unit: 'm/s² per rad/s', symbol: 'k', min: 0, sample: 0.55 },
};

function require(values, key) {
  if (!isNum(values[key])) throw new Impossible(`${BOWLING_META[key].label} is needed.`);
  return values[key];
}

function nonZero(value, key, relation) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(`${BOWLING_META[key].label} is zero in ${relation}, so the division has no answer.`);
  }
  return value;
}

function result(value, expr, sub, extra = {}) {
  return { value, expr, sub, ...extra };
}

export const BOWLING_RELATIONS = [
  {
    id: 'B1',
    name: 'Velocity–time',
    formula: 'v_f = v_i + a·t',
    vars: ['finalSpeed', 'speed', 'accel', 'time'],
    residual: (v) => v.finalSpeed - (v.speed + v.accel * v.time),
    scale: (v) => Math.max(1, Math.abs(v.finalSpeed), Math.abs(v.speed), Math.abs(v.accel * v.time)),
    solveFor: {
      finalSpeed: (v) => result(v.speed + v.accel * v.time, 'v_i + a·t',
        `${fmt(v.speed)} + ${fmt(v.accel)}×${fmt(v.time)}`),
      speed: (v) => result(v.finalSpeed - v.accel * v.time, 'v_f − a·t',
        `${fmt(v.finalSpeed)} − ${fmt(v.accel)}×${fmt(v.time)}`),
      accel: (v) => {
        const time = nonZero(require(v, 'time'), 'time', 'v_f = v_i + a·t');
        return result((v.finalSpeed - v.speed) / time, '(v_f − v_i) / t',
          `(${fmt(v.finalSpeed)} − ${fmt(v.speed)}) / ${fmt(time)}`);
      },
      time: (v) => {
        if (Math.abs(v.accel) <= EPS) {
          if (Math.abs(v.finalSpeed - v.speed) <= 1e-9) {
            throw new Ambiguous('Time is not determined when the speed does not change.');
          }
          throw new Impossible('The speed changes but acceleration is zero.');
        }
        return result((v.finalSpeed - v.speed) / v.accel, '(v_f − v_i) / a',
          `(${fmt(v.finalSpeed)} − ${fmt(v.speed)}) / ${fmt(v.accel)}`);
      },
    },
  },
  {
    id: 'B2',
    name: 'Distance–time',
    formula: 'Δx = v_i·t + ½·a·t²',
    vars: ['distance', 'speed', 'accel', 'time'],
    residual: (v) => v.distance - (v.speed * v.time + 0.5 * v.accel * v.time * v.time),
    scale: (v) => Math.max(1, Math.abs(v.distance), Math.abs(v.speed * v.time),
      Math.abs(0.5 * v.accel * v.time * v.time)),
    solveFor: {
      distance: (v) => result(v.speed * v.time + 0.5 * v.accel * v.time * v.time,
        'v_i·t + ½·a·t²',
        `${fmt(v.speed)}×${fmt(v.time)} + 0.5×${fmt(v.accel)}×${fmt(v.time)}²`),
      speed: (v) => {
        const time = nonZero(require(v, 'time'), 'time', 'Δx = v_i·t + ½·a·t²');
        return result(v.distance / time - 0.5 * v.accel * time, 'Δx/t − ½·a·t',
          `${fmt(v.distance)}/${fmt(time)} − 0.5×${fmt(v.accel)}×${fmt(time)}`);
      },
      accel: (v) => {
        const time = nonZero(require(v, 'time'), 'time', 'Δx = v_i·t + ½·a·t²');
        return result((2 * (v.distance - v.speed * time)) / (time * time), '2(Δx − v_i·t)/t²',
          `2(${fmt(v.distance)} − ${fmt(v.speed)}×${fmt(time)})/${fmt(time)}²`);
      },
      time: (v) => {
        if (Math.abs(v.accel) <= EPS) {
          const speed = nonZero(require(v, 'speed'), 'speed', 'Δx = v_i·t (a = 0)');
          return result(v.distance / speed, 'Δx/v_i', `${fmt(v.distance)}/${fmt(speed)}`,
            { note: 'a = 0, so the motion is at constant speed.' });
        }
        const disc = v.speed * v.speed + 2 * v.accel * v.distance;
        if (disc < 0) {
          throw new Impossible('The ball would stop before covering that distance.',
            'Try a bigger speed, a smaller distance or a smaller deceleration.');
        }
        const root = Math.sqrt(disc);
        const roots = [(-v.speed + root) / v.accel, (-v.speed - root) / v.accel]
          .filter((value) => isNum(value) && value >= -EPS);
        if (!roots.length) {
          throw new Impossible('No positive time satisfies Δx = v_i·t + ½·a·t².',
            'Try a bigger speed or a smaller distance.');
        }
        roots.sort((left, right) => left - right);
        return result(roots[0], '(−v_i ± √(v_i² + 2aΔx)) / a',
          `(−${fmt(v.speed)} ± √(${fmt(v.speed)}² + 2×${fmt(v.accel)}×${fmt(v.distance)})) / ${fmt(v.accel)}`,
          { others: roots.slice(1), note: roots.length > 1
            ? `Also valid: t = ${fmt(roots[1])} s, the later return past that point.` : '' });
      },
    },
  },
  {
    id: 'B3',
    name: 'Velocity–distance',
    formula: 'v_f² = v_i² + 2·a·Δx',
    vars: ['finalSpeed', 'speed', 'accel', 'distance'],
    residual: (v) => v.finalSpeed * v.finalSpeed - (v.speed * v.speed + 2 * v.accel * v.distance),
    scale: (v) => Math.max(1, v.finalSpeed * v.finalSpeed, v.speed * v.speed,
      Math.abs(2 * v.accel * v.distance)),
    solveFor: {
      finalSpeed: (v) => {
        const inside = v.speed * v.speed + 2 * v.accel * v.distance;
        if (inside < 0) throw new Impossible('That motion has no real final speed.');
        return result(Math.sqrt(inside), '√(v_i² + 2aΔx)',
          `√(${fmt(v.speed)}² + 2×${fmt(v.accel)}×${fmt(v.distance)})`);
      },
      speed: (v) => {
        const inside = v.finalSpeed * v.finalSpeed - 2 * v.accel * v.distance;
        if (inside < 0) throw new Impossible('That motion has no real initial speed.');
        return result(Math.sqrt(inside), '√(v_f² − 2aΔx)',
          `√(${fmt(v.finalSpeed)}² − 2×${fmt(v.accel)}×${fmt(v.distance)})`);
      },
      accel: (v) => {
        const distance = nonZero(require(v, 'distance'), 'distance', 'v_f² = v_i² + 2aΔx');
        return result((v.finalSpeed * v.finalSpeed - v.speed * v.speed) / (2 * distance),
          '(v_f² − v_i²)/(2Δx)',
          `(${fmt(v.finalSpeed)}² − ${fmt(v.speed)}²)/(2×${fmt(distance)})`);
      },
      distance: (v) => {
        if (Math.abs(v.accel) <= EPS) {
          if (Math.abs(v.finalSpeed - v.speed) <= 1e-9) {
            throw new Ambiguous('Distance is not determined when the speed does not change.');
          }
          throw new Impossible('The speed changes but acceleration is zero.');
        }
        return result((v.finalSpeed * v.finalSpeed - v.speed * v.speed) / (2 * v.accel),
          '(v_f² − v_i²)/(2a)',
          `(${fmt(v.finalSpeed)}² − ${fmt(v.speed)}²)/(2×${fmt(v.accel)})`);
      },
    },
  },
  {
    id: 'B4',
    name: 'Average velocity',
    formula: 'Δx = ½·(v_i + v_f)·t',
    vars: ['distance', 'speed', 'finalSpeed', 'time'],
    residual: (v) => v.distance - 0.5 * (v.speed + v.finalSpeed) * v.time,
    scale: (v) => Math.max(1, Math.abs(v.distance), Math.abs(0.5 * (v.speed + v.finalSpeed) * v.time)),
    solveFor: {
      distance: (v) => result(0.5 * (v.speed + v.finalSpeed) * v.time, '½(v_i + v_f)t',
        `0.5×(${fmt(v.speed)} + ${fmt(v.finalSpeed)})×${fmt(v.time)}`),
      speed: (v) => {
        const time = nonZero(require(v, 'time'), 'time', 'Δx = ½(v_i + v_f)t');
        return result((2 * v.distance) / time - v.finalSpeed, '2Δx/t − v_f',
          `2×${fmt(v.distance)}/${fmt(time)} − ${fmt(v.finalSpeed)}`);
      },
      finalSpeed: (v) => {
        const time = nonZero(require(v, 'time'), 'time', 'Δx = ½(v_i + v_f)t');
        return result((2 * v.distance) / time - v.speed, '2Δx/t − v_i',
          `2×${fmt(v.distance)}/${fmt(time)} − ${fmt(v.speed)}`);
      },
      time: (v) => {
        const sum = v.speed + v.finalSpeed;
        if (Math.abs(sum) <= EPS) {
          if (Math.abs(v.distance) <= EPS) throw new Ambiguous('Time is not determined when v_i + v_f = 0.');
          throw new Impossible('v_i + v_f is zero, so that distance needs infinite time.');
        }
        return result((2 * v.distance) / sum, '2Δx/(v_i + v_f)',
          `2×${fmt(v.distance)}/(${fmt(v.speed)} + ${fmt(v.finalSpeed)})`);
      },
    },
  },
  {
    id: 'B5',
    name: 'Friction deceleration',
    formula: 'a = −μ·g',
    vars: ['accel', 'mu', 'gravity'],
    residual: (v) => v.accel + v.mu * v.gravity,
    scale: (v) => Math.max(1, Math.abs(v.accel), Math.abs(v.mu * v.gravity)),
    solveFor: {
      accel: (v) => result(-v.mu * v.gravity, '−μ·g', `−${fmt(v.mu)}×${fmt(v.gravity)}`),
      mu: (v) => {
        const gravity = nonZero(require(v, 'gravity'), 'gravity', 'a = −μ·g');
        return result(-v.accel / gravity, '−a/g', `−(${fmt(v.accel)})/${fmt(gravity)}`);
      },
      gravity: (v) => {
        if (Math.abs(v.mu) <= EPS) {
          if (Math.abs(v.accel) <= EPS) throw new Ambiguous('Gravity is ambiguous when a = 0 and μ = 0.');
          throw new Impossible('Acceleration is non-zero but μ = 0, so no gravity can satisfy a = −μ·g.');
        }
        return result(-v.accel / v.mu, '−a/μ', `−(${fmt(v.accel)})/${fmt(v.mu)}`);
      },
    },
  },
  {
    id: 'B6',
    name: 'Sideways velocity',
    formula: 'v_x = v_i·sin θ',
    vars: ['sideways', 'speed', 'aim'],
    residual: (v) => v.sideways - v.speed * Math.sin(rad(v.aim)),
    scale: (v) => Math.max(1, Math.abs(v.sideways), Math.abs(v.speed)),
    solveFor: {
      sideways: (v) => result(v.speed * Math.sin(rad(v.aim)), 'v_i·sin θ',
        `${fmt(v.speed)}×sin(${fmt(v.aim)}°)`),
      speed: (v) => {
        const sine = Math.sin(rad(v.aim));
        if (Math.abs(sine) <= EPS) {
          if (Math.abs(v.sideways) <= EPS) throw new Ambiguous('Speed is ambiguous when v_x = 0 and sin θ = 0.');
          throw new Impossible('Sideways speed is non-zero but sin θ = 0.');
        }
        return result(v.sideways / sine, 'v_x / sin θ',
          `${fmt(v.sideways)}/sin(${fmt(v.aim)}°)`);
      },
      aim: (v) => {
        if (Math.abs(v.speed) <= EPS) {
          if (Math.abs(v.sideways) <= EPS) throw new Ambiguous('Aim is ambiguous when v_i = 0 and v_x = 0.');
          throw new Impossible('Sideways speed cannot be non-zero when speed is zero.');
        }
        const ratio = v.sideways / v.speed;
        if (Math.abs(ratio) > 1 + 1e-9) {
          throw new Impossible('Sideways speed cannot exceed the launch speed.');
        }
        return result(Math.asin(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI,
          'asin(v_x/v_i)', `asin(${fmt(v.sideways)}/${fmt(v.speed)})`);
      },
    },
  },
  {
    id: 'B7',
    name: 'Momentum',
    formula: 'p = m·v_i',
    vars: ['momentum', 'mass', 'speed'],
    residual: (v) => v.momentum - v.mass * v.speed,
    scale: (v) => Math.max(1, Math.abs(v.momentum), Math.abs(v.mass * v.speed)),
    solveFor: {
      momentum: (v) => result(v.mass * v.speed, 'm·v_i', `${fmt(v.mass)}×${fmt(v.speed)}`),
      mass: (v) => {
        const speed = nonZero(require(v, 'speed'), 'speed', 'p = m·v_i');
        return result(v.momentum / speed, 'p/v_i', `${fmt(v.momentum)}/${fmt(speed)}`);
      },
      speed: (v) => {
        const mass = nonZero(require(v, 'mass'), 'mass', 'p = m·v_i');
        return result(v.momentum / mass, 'p/m', `${fmt(v.momentum)}/${fmt(mass)}`);
      },
    },
  },
  {
    id: 'B8',
    name: 'Kinetic energy',
    formula: 'K = ½·m·v_i²',
    vars: ['energy', 'mass', 'speed'],
    residual: (v) => v.energy - 0.5 * v.mass * v.speed * v.speed,
    scale: (v) => Math.max(1, Math.abs(v.energy), Math.abs(0.5 * v.mass * v.speed * v.speed)),
    solveFor: {
      energy: (v) => result(0.5 * v.mass * v.speed * v.speed, '½·m·v_i²',
        `0.5×${fmt(v.mass)}×${fmt(v.speed)}²`),
      mass: (v) => {
        const speed = nonZero(require(v, 'speed'), 'speed', 'K = ½m v_i²');
        return result((2 * v.energy) / (speed * speed), '2K/v_i²',
          `2×${fmt(v.energy)}/${fmt(speed)}²`);
      },
      speed: (v) => {
        const mass = nonZero(require(v, 'mass'), 'mass', 'K = ½m v_i²');
        const inside = (2 * v.energy) / mass;
        if (inside < 0) throw new Impossible('Energy and mass cannot give a real speed.');
        return result(Math.sqrt(inside), '√(2K/m)', `√(2×${fmt(v.energy)}/${fmt(mass)})`);
      },
    },
  },
];

/** Soft defaults only supply what the typed values left undetermined. */
export function bowlingSoft(constants = CONSTANT_DEFAULTS) {
  const value = (key) => (isNum(constants[key]) ? constants[key] : CONSTANT_DEFAULTS[key]);
  return [
    { key: 'gravity', value: value('gravity'), priority: 10, label: 'Gravity' },
    { key: 'mu', value: value('mu'), priority: 20, label: 'Friction coefficient' },
    { key: 'mass', value: value('mass'), priority: 30, label: 'Ball mass' },
    { key: 'hookK', value: value('hookK'), priority: 40, label: 'Hook constant' },
    { key: 'length', value: value('length'), priority: 50, label: 'Lane length' },
    { key: 'distance', value: (values) => (isNum(values.length) ? values.length : value('length')),
      priority: 55, label: 'Distance travelled', when: (values) => !isNum(values.distance) },
    { key: 'finalSpeed', value: 0, priority: 60, label: 'Final speed',
      when: (values) => !isNum(values.distance) && isNum(values.speed)
        && isNum(values.accel) && values.accel < 0 },
    { key: 'start', value: 0.2, priority: 70, label: 'Starting position' },
    { key: 'hook', value: -1.6, priority: 80, label: 'Hook spin' },
    { key: 'aim', value: -0.4, priority: 90, label: 'Aim angle' },
  ];
}

function pinNote(values) {
  const lane = values.length;
  const speed = values.speed;
  const accel = values.accel;
  if (![lane, speed, accel].every(isNum) || lane <= 0) return null;
  if (Math.abs(accel) <= EPS || speed < 0) return null;

  const disc = speed * speed + 2 * accel * lane;
  if (disc < 0) {
    const stopTime = accel < 0 ? -speed / accel : null;
    const stopDistance = accel < 0 ? (speed * speed) / (-2 * accel) : null;
    if (isNum(stopDistance)) {
      return `The ball stops after ${fmt(stopDistance)} m at t = ${fmt(stopTime)} s and does not reach the pins.`;
    }
    return null;
  }
  const root = Math.sqrt(disc);
  const roots = [(-speed + root) / accel, (-speed - root) / accel]
    .filter((value) => isNum(value) && value > 1e-9).sort((left, right) => left - right);
  if (!roots.length) return null;
  const time = roots[0];
  const finalSpeed = speed + accel * time;
  return `The lane is ${fmt(lane)} m, so the ball reaches the pins at t = ${fmt(time)} s going ${fmt(finalSpeed)} m/s.`;
}

export function bowlingNotes(values, info = {}) {
  const notes = [];
  const distance = values.distance;
  const lane = values.length;
  if (isNum(values.accel) && values.accel > EPS) {
    notes.push('Positive acceleration is allowed here; a real lane would slow the ball.');
  }
  if (isNum(distance) && isNum(lane) && distance > lane + 1e-6) {
    const pin = pinNote(values);
    if (pin) notes.push(pin);
  }
  if (isNum(distance) && isNum(lane) && lane > 0 && distance > lane + 1e-6
      && info.status === 'solved') {
    // The animation runs the full distance when the typed motion is longer.
  }
  if (isNum(lane) && isNum(values.speed) && isNum(values.accel)
      && values.accel < 0 && isNum(distance) && distance <= lane + 1e-6) {
    const stopDistance = (values.speed * values.speed) / (-2 * values.accel);
    if (stopDistance < lane - 1e-6) {
      notes.push(`The ball stops after ${fmt(stopDistance)} m and does not reach the pins.`);
    }
  }
  const softLength = info.softUsed && info.softUsed.includes('length');
  if (softLength && isNum(lane) && isNum(values.speed)) {
    notes.push(`Using the default lane length ${fmt(lane)} m.`);
  }
  return notes;
}

export function solveBowling({ known = {}, constants = {}, editedKey = null, focusKey = null } = {}) {
  const typed = {};
  for (const [key, raw] of Object.entries(known)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) typed[key] = value;
  }
  const result = solveRelations({
    keys: BOWLING_KEYS,
    relations: BOWLING_RELATIONS,
    typed,
    soft: bowlingSoft(constants),
    goal: BOWLING_CORE_KEYS,
    candidateKeys: ['speed', 'time', 'distance', 'accel', 'finalSpeed', 'momentum',
      'energy', 'sideways', 'start', 'aim', 'hook'],
    meta: BOWLING_META,
    samples: Object.fromEntries(BOWLING_KEYS.map((key) => [key, BOWLING_META[key].sample])),
    editedKey,
    focusKey,
    notes: bowlingNotes,
  });
  result.hook = isNum(result.values.hook) && isNum(result.values.hookK)
    ? { hook: result.values.hook, k: result.values.hookK,
      lateralAccel: result.values.hook * result.values.hookK }
    : null;
  result.constants = {
    mass: result.values.mass,
    mu: result.values.mu,
    gravity: result.values.gravity,
    length: result.values.length,
    hookK: result.values.hookK,
  };
  return result;
}

export { pinNote };
