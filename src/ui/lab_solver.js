// The Physics Lab's rotational/kinematics constraint solver.
//
// Every panel field is either KNOWN (the player typed it) or UNKNOWN. The
// solver repeatedly applies any equation that has exactly one unknown until no
// further equation can be applied. Constants are constraints too: clearing m,
// mu, g or L turns them into unknowns and the same rules apply.
//
// The model is analytical and deliberately small:
//
//   p  = m v
//   K  = 1/2 m v^2
//   a  = -mu g
//   L  = v t + 1/2 a t^2
//   vx = v sin(aim)
//   aLat = k hook                         (documented hook model)
//
// The BOWL run remains the real rigid-body simulation. These values describe
// the launch plan and the analytical travel time; they do not replace the lane
// physics or the collision solver.

import * as config from '../config.js';

// --- Field definitions ------------------------------------------------------

export const VAR_FIELDS = [
  {
    key: 'start', label: 'START X', messageLabel: 'Start X', symbol: 'start',
    unit: 'm', step: 0.01, min: -config.LATERAL_LIMIT, max: config.LATERAL_LIMIT,
    default: 0.2, direct: true,
    help: 'Lateral launch position at the foul line.',
  },
  {
    key: 'aim', label: 'AIM', messageLabel: 'Aim', symbol: 'aim',
    unit: 'deg', step: 0.1, min: -90, max: 90,
    default: -0.4, direct: true,
    help: 'Launch angle across the lane, measured from the lane axis.',
  },
  {
    key: 'hook', label: 'HOOK', messageLabel: 'Hook', symbol: 'hook',
    unit: 'rad/s', step: 0.1, min: -config.MAX_SPIN, max: config.MAX_SPIN,
    default: -1.6, direct: true,
    help: 'Spin about the vertical axis. Feeds the hook model and the BOWL launch.',
  },
  {
    key: 'speed', label: 'SPEED', messageLabel: 'Speed', symbol: 'v',
    unit: 'm/s', step: 0.1, min: 0,
    default: 7.5,
    help: 'Launch speed magnitude.',
  },
  {
    key: 'time', label: 'TIME', messageLabel: 'Time', symbol: 't',
    unit: 's', step: 0.01, min: 0.0001,
    help: 'Analytical travel time from the foul line to the head pin.',
  },
  {
    key: 'accel', label: 'ACCEL', messageLabel: 'Accel', symbol: 'a',
    unit: 'm/s²', step: 0.01, max: 0,
    help: 'Signed constant acceleration. The lane can only decelerate, so a <= 0.',
  },
  {
    key: 'sideways', label: 'SIDEWAYS', messageLabel: 'Sideways vx', symbol: 'vx',
    unit: 'm/s', step: 0.01,
    help: 'Sideways component of the launch velocity.',
  },
  {
    key: 'momentum', label: 'MOMENTUM', messageLabel: 'Momentum', symbol: 'p',
    unit: 'kg·m/s', step: 0.1, min: 0,
    help: 'Translational momentum.',
  },
  {
    key: 'energy', label: 'ENERGY', messageLabel: 'Energy', symbol: 'K',
    unit: 'J', step: 0.1, min: 0,
    help: 'Translational kinetic energy.',
  },
];

export const CONST_FIELDS = [
  {
    key: 'mass', label: 'MASS', messageLabel: 'Mass m', symbol: 'm',
    unit: 'kg', step: 0.1, min: 0.0001, default: config.BALL_MASS,
    help: 'Ball mass.',
  },
  {
    key: 'mu', label: 'FRICTION', messageLabel: 'Friction μ', symbol: 'μ',
    unit: '', step: 0.001, min: 0, default: config.ROLLING_FRICTION,
    help: 'Rolling-resistance coefficient.',
  },
  {
    key: 'gravity', label: 'GRAVITY', messageLabel: 'Gravity g', symbol: 'g',
    unit: 'm/s²', step: 0.01, min: 0.0001, default: config.GRAVITY,
    help: 'Gravitational acceleration.',
  },
  {
    key: 'length', label: 'LANE', messageLabel: 'Lane length L', symbol: 'L',
    unit: 'm', step: 0.01, min: 0.0001, default: config.LANE_LENGTH,
    help: 'Foul line to head pin.',
  },
  {
    key: 'hookK', label: 'HOOK k', messageLabel: 'Hook k', symbol: 'k',
    unit: '', step: 0.01, min: 0, default: 0.55,
    help: 'Hook model constant: lateral acceleration per rad/s of spin.',
  },
];

export const ALL_FIELDS = [...VAR_FIELDS, ...CONST_FIELDS];
export const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f]));
export const DEFAULT_VALUES = Object.fromEntries(
  ALL_FIELDS.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));

// The initial panel: four launch values are known, constants are known, and
// the remaining variables are derived. This makes the lab immediately runnable
// while still demonstrating the KNOWN/SOLVED split.
export const INITIAL_TYPED = {
  start: 0.20,
  aim: -0.4,
  hook: -1.6,
  speed: 7.5,
  mass: config.BALL_MASS,
  mu: config.ROLLING_FRICTION,
  gravity: config.GRAVITY,
  length: config.LANE_LENGTH,
  hookK: 0.55,
};

// CLEAR ALL keeps the physical constants and clears the variable fields.
// Clearing every constant as well would leave the system with no scale at all.
export const CONSTANT_DEFAULTS = {
  mass: config.BALL_MASS,
  mu: config.ROLLING_FRICTION,
  gravity: config.GRAVITY,
  length: config.LANE_LENGTH,
  hookK: 0.55,
};

// Fields with no equation in the requested model. They are direct throw
// inputs; a blank one falls back to its documented default rather than
// pretending it was derived.
const DIRECT_AUTO_KEYS = ['start', 'hook', 'hookK'];
const AUTO_AIM = true;

const REL_TOL = 2e-4;   // forgiving enough for 4-decimal display values
const EPS = 1e-12;
const MAX_PASSES = 128;

// --- Small utilities --------------------------------------------------------

export function fmt(value, decimals = 4) {
  if (!Number.isFinite(value)) return '--';
  let text = Number(value).toFixed(decimals);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0' || text === '') text = '0';
  return text;
}

export function labelOf(key) {
  return FIELD_BY_KEY[key] ? FIELD_BY_KEY[key].messageLabel : key;
}

export function symbolOf(key) {
  return FIELD_BY_KEY[key] ? FIELD_BY_KEY[key].symbol : key;
}

export function unitOf(key) {
  return FIELD_BY_KEY[key] ? FIELD_BY_KEY[key].unit : '';
}

function withUnit(key, value) {
  const unit = unitOf(key);
  const text = fmt(value);
  return unit ? `${text} ${unit}` : text;
}

function closeValues(a, b) {
  return Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b)) + 1e-12;
}

class SolveError extends Error {
  constructor(message, keys = [], ambiguous = false) {
    super(message);
    this.name = 'SolveError';
    this.keys = keys;
    this.ambiguous = ambiguous;
  }
}

function requireKnown(values, key) {
  const value = values[key];
  if (!Number.isFinite(value)) {
    throw new SolveError(`${labelOf(key)} is required.`, [key]);
  }
  return value;
}

function requireNonZero(value, key, equation) {
  if (Math.abs(value) <= EPS) {
    throw new SolveError(`${labelOf(key)} cannot be zero in ${equation}.`, [key]);
  }
  return value;
}

// --- Domain validation ------------------------------------------------------

const VALIDATORS = {
  start: (x) => (Math.abs(x) <= config.LATERAL_LIMIT + 1e-9
    ? null : `Start X must be within ±${fmt(config.LATERAL_LIMIT)} m.`),
  aim: (x) => (x >= -90 && x <= 90 ? null : 'Aim must be between −90° and 90°.'),
  hook: (x) => (Math.abs(x) <= config.MAX_SPIN + 1e-9
    ? null : `Hook must be within ±${fmt(config.MAX_SPIN)} rad/s.`),
  speed: (x) => (x >= 0 ? null : 'Speed cannot be negative.'),
  time: (x) => (x > 0 ? null : 'Time must be greater than zero.'),
  accel: (x) => (x <= 0 ? null : 'Accel must be ≤ 0; the lane cannot accelerate the ball.'),
  sideways: () => null,
  momentum: (x) => (x >= 0 ? null : 'Momentum cannot be negative.'),
  energy: (x) => (x >= 0 ? null : 'Energy cannot be negative.'),
  mass: (x) => (x > 0 ? null : 'Mass must be greater than zero.'),
  mu: (x) => (x >= 0 ? null : 'Friction μ cannot be negative.'),
  gravity: (x) => (x > 0 ? null : 'Gravity must be greater than zero.'),
  length: (x) => (x > 0 ? null : 'Lane length must be greater than zero.'),
  hookK: (x) => (x >= 0 ? null : 'Hook k cannot be negative.'),
};

export function validateValue(key, value) {
  if (!Number.isFinite(value)) return `${labelOf(key)} must be finite.`;
  const validator = VALIDATORS[key];
  return validator ? validator(value) : null;
}

// --- Equations --------------------------------------------------------------
//
// Each solve function returns:
//   value: the numeric answer
//   expr:  the symbolic right-hand side
//   sub:   the same expression with the known numbers substituted
//   note:  optional extra explanation
//
// A solve function only reads the *other* variables, so it is safe to call it
// for a fully-known equation to find out what the reported field would have to
// be for the relation to balance.

const EQUATIONS = [
  {
    id: 'friction',
    name: 'Friction deceleration',
    formula: 'a = −μ·g',
    vars: ['accel', 'mu', 'gravity'],
    report: ['accel', 'mu', 'gravity'],
    note: 'Signed acceleration: the lane only decelerates.',
    scale: (v) => Math.max(1, Math.abs(v.accel), Math.abs(v.mu * v.gravity)),
    check: (v) => v.accel + v.mu * v.gravity,
    solve: {
      accel: (v) => {
        const mu = requireKnown(v, 'mu');
        const g = requireKnown(v, 'gravity');
        return {
          value: -mu * g,
          expr: '−μ·g',
          sub: `−${fmt(mu)}·${fmt(g)}`,
        };
      },
      mu: (v) => {
        const a = requireKnown(v, 'accel');
        const g = requireNonZero(requireKnown(v, 'gravity'), 'gravity', 'a = −μ·g');
        return {
          value: -a / g,
          expr: '−a/g',
          sub: `−(${fmt(a)})/${fmt(g)}`,
        };
      },
      gravity: (v) => {
        const a = requireKnown(v, 'accel');
        const mu = requireKnown(v, 'mu');
        if (Math.abs(mu) <= EPS) {
          if (Math.abs(a) <= EPS) {
            throw new SolveError(
              'Gravity is ambiguous when accel = 0 and friction μ = 0.',
              ['gravity', 'mu'], true);
          }
          throw new SolveError(
            'Accel is non-zero but μ = 0, so no gravity can satisfy a = −μ·g.',
            ['accel', 'mu']);
        }
        return {
          value: -a / mu,
          expr: '−a/μ',
          sub: `−(${fmt(a)})/${fmt(mu)}`,
        };
      },
    },
  },
  {
    id: 'travel',
    name: 'Lane travel',
    formula: 'L = v·t + ½·a·t²',
    vars: ['length', 'speed', 'time', 'accel'],
    report: ['time', 'speed', 'accel', 'length'],
    note: 'Constant acceleration; t uses the smallest positive root.',
    scale: (v) => Math.max(1, Math.abs(v.length),
      Math.abs(v.speed * v.time), Math.abs(0.5 * v.accel * v.time * v.time)),
    check: (v) => v.length - (v.speed * v.time + 0.5 * v.accel * v.time * v.time),
    solve: {
      length: (v) => {
        const speed = requireKnown(v, 'speed');
        const time = requireKnown(v, 'time');
        const accel = requireKnown(v, 'accel');
        return {
          value: speed * time + 0.5 * accel * time * time,
          expr: 'v·t + ½·a·t²',
          sub: `${fmt(speed)}·${fmt(time)} + 0.5·(${fmt(accel)})·${fmt(time)}²`,
        };
      },
      time: (v) => {
        const length = requireKnown(v, 'length');
        const speed = requireKnown(v, 'speed');
        const accel = requireKnown(v, 'accel');
        if (length <= 0) {
          throw new SolveError('Lane length must be greater than zero.', ['length']);
        }
        if (Math.abs(accel) <= EPS) {
          const v = requireNonZero(speed, 'speed', 't = L/v (a = 0)');
          return {
            value: length / v,
            expr: 'L/v',
            sub: `${fmt(length)}/${fmt(v)}`,
            note: 'a = 0, so uniform motion is used.',
          };
        }
        const discriminant = speed * speed + 2 * accel * length;
        if (discriminant < -EPS) {
          throw new SolveError(
            'The ball stops before the lane length (v² + 2·a·L < 0).',
            ['speed', 'accel', 'length']);
        }
        const root = Math.sqrt(Math.max(0, discriminant));
        const roots = [
          (-speed + root) / accel,
          (-speed - root) / accel,
        ].filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
        if (!roots.length) {
          throw new SolveError(
            'No positive travel time satisfies L = v·t + ½·a·t².',
            ['speed', 'accel', 'length']);
        }
        const note = roots.length > 1
          ? `Two positive roots: ${fmt(roots[0])} s and ${fmt(roots[1])} s. The first arrival is used.`
          : '';
        return {
          value: roots[0],
          expr: '(−v + √(v² + 2·a·L)) / a',
          sub: `(−${fmt(speed)} + √(${fmt(speed)}² + 2·(${fmt(accel)})·${fmt(length)})) / (${fmt(accel)})`,
          note,
        };
      },
      speed: (v) => {
        const length = requireKnown(v, 'length');
        const time = requireNonZero(requireKnown(v, 'time'), 'time', 'L = v·t + ½·a·t²');
        const accel = requireKnown(v, 'accel');
        return {
          value: (length - 0.5 * accel * time * time) / time,
          expr: '(L − ½·a·t²)/t',
          sub: `(${fmt(length)} − 0.5·(${fmt(accel)})·${fmt(time)}²)/${fmt(time)}`,
        };
      },
      accel: (v) => {
        const length = requireKnown(v, 'length');
        const speed = requireKnown(v, 'speed');
        const time = requireNonZero(requireKnown(v, 'time'), 'time', 'L = v·t + ½·a·t²');
        return {
          value: 2 * (length - speed * time) / (time * time),
          expr: '2(L − v·t)/t²',
          sub: `2(${fmt(length)} − ${fmt(speed)}·${fmt(time)})/${fmt(time)}²`,
        };
      },
    },
  },
  {
    id: 'sideways',
    name: 'Sideways velocity',
    formula: 'vx = v·sin(aim)',
    vars: ['sideways', 'speed', 'aim'],
    report: ['sideways', 'aim', 'speed'],
    note: 'Aim is in degrees from the lane axis.',
    scale: (v) => Math.max(1, Math.abs(v.sideways),
      Math.abs(v.speed * Math.sin(v.aim * Math.PI / 180))),
    check: (v) => v.sideways - v.speed * Math.sin(v.aim * Math.PI / 180),
    solve: {
      sideways: (v) => {
        const speed = requireKnown(v, 'speed');
        const aim = requireKnown(v, 'aim');
        return {
          value: speed * Math.sin(aim * Math.PI / 180),
          expr: 'v·sin(aim)',
          sub: `${fmt(speed)}·sin(${fmt(aim)}°)`,
        };
      },
      speed: (v) => {
        const sideways = requireKnown(v, 'sideways');
        const aim = requireKnown(v, 'aim');
        const sine = Math.sin(aim * Math.PI / 180);
        if (Math.abs(sine) <= EPS) {
          if (Math.abs(sideways) <= EPS) {
            throw new SolveError(
              'Speed is ambiguous when vx = 0 and sin(aim) = 0.',
              ['speed', 'sideways'], true);
          }
          throw new SolveError(
            'Sideways vx is non-zero but sin(aim) = 0, so no speed can satisfy it.',
            ['sideways', 'aim']);
        }
        return {
          value: sideways / sine,
          expr: 'vx/sin(aim)',
          sub: `${fmt(sideways)}/sin(${fmt(aim)}°)`,
        };
      },
      aim: (v) => {
        const sideways = requireKnown(v, 'sideways');
        const speed = requireKnown(v, 'speed');
        if (Math.abs(speed) <= EPS) {
          if (Math.abs(sideways) <= EPS) {
            throw new SolveError(
              'Aim is ambiguous when speed = 0 and vx = 0.',
              ['aim', 'speed'], true);
          }
          throw new SolveError('Aim cannot be determined when speed = 0.', ['aim', 'speed']);
        }
        const ratio = sideways / speed;
        if (Math.abs(ratio) > 1 + 1e-9) {
          throw new SolveError('Sideways vx cannot exceed speed.', ['sideways', 'speed']);
        }
        const aim = Math.asin(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI;
        return {
          value: aim,
          expr: 'asin(vx/v)',
          sub: `asin(${fmt(sideways)}/${fmt(speed)})`,
        };
      },
    },
  },
  {
    id: 'momentum',
    name: 'Momentum',
    formula: 'p = m·v',
    vars: ['momentum', 'mass', 'speed'],
    report: ['momentum', 'speed', 'mass'],
    note: 'Translational momentum.',
    scale: (v) => Math.max(1, Math.abs(v.momentum), Math.abs(v.mass * v.speed)),
    check: (v) => v.momentum - v.mass * v.speed,
    solve: {
      momentum: (v) => {
        const mass = requireKnown(v, 'mass');
        const speed = requireKnown(v, 'speed');
        return {
          value: mass * speed,
          expr: 'm·v',
          sub: `${fmt(mass)}·${fmt(speed)}`,
        };
      },
      mass: (v) => {
        const momentum = requireKnown(v, 'momentum');
        const speed = requireKnown(v, 'speed');
        if (Math.abs(speed) <= EPS) {
          if (Math.abs(momentum) <= EPS) {
            throw new SolveError(
              'Mass is ambiguous when speed = 0 and momentum = 0.',
              ['mass', 'speed'], true);
          }
          throw new SolveError(
            'Momentum is non-zero but speed = 0, so no mass can satisfy p = m·v.',
            ['momentum', 'speed']);
        }
        return {
          value: momentum / speed,
          expr: 'p/v',
          sub: `${fmt(momentum)}/${fmt(speed)}`,
        };
      },
      speed: (v) => {
        const momentum = requireKnown(v, 'momentum');
        const mass = requireNonZero(requireKnown(v, 'mass'), 'mass', 'p = m·v');
        return {
          value: momentum / mass,
          expr: 'p/m',
          sub: `${fmt(momentum)}/${fmt(mass)}`,
        };
      },
    },
  },
  {
    id: 'energy',
    name: 'Kinetic energy',
    formula: 'K = ½·m·v²',
    vars: ['energy', 'mass', 'speed'],
    report: ['energy', 'speed', 'mass'],
    note: 'Translational energy; rotational energy is ignored.',
    scale: (v) => Math.max(1, Math.abs(v.energy), Math.abs(0.5 * v.mass * v.speed * v.speed)),
    check: (v) => v.energy - 0.5 * v.mass * v.speed * v.speed,
    solve: {
      energy: (v) => {
        const mass = requireKnown(v, 'mass');
        const speed = requireKnown(v, 'speed');
        return {
          value: 0.5 * mass * speed * speed,
          expr: '½·m·v²',
          sub: `0.5·${fmt(mass)}·${fmt(speed)}²`,
        };
      },
      mass: (v) => {
        const energy = requireKnown(v, 'energy');
        const speed = requireKnown(v, 'speed');
        if (Math.abs(speed) <= EPS) {
          if (Math.abs(energy) <= EPS) {
            throw new SolveError(
              'Mass is ambiguous when speed = 0 and energy = 0.',
              ['mass', 'speed'], true);
          }
          throw new SolveError(
            'Energy is non-zero but speed = 0, so no mass can satisfy K = ½·m·v².',
            ['energy', 'speed']);
        }
        return {
          value: 2 * energy / (speed * speed),
          expr: '2K/v²',
          sub: `2·${fmt(energy)}/${fmt(speed)}²`,
        };
      },
      speed: (v) => {
        const energy = requireKnown(v, 'energy');
        const mass = requireNonZero(requireKnown(v, 'mass'), 'mass', 'K = ½·m·v²');
        const under = 2 * energy / mass;
        if (under < -EPS) {
          throw new SolveError('Energy and mass cannot give a real speed.', ['energy', 'mass']);
        }
        return {
          value: Math.sqrt(Math.max(0, under)),
          expr: '√(2K/m)',
          sub: `√(2·${fmt(energy)}/${fmt(mass)})`,
        };
      },
    },
  },
];

export const EQUATIONS_BY_ID = Object.fromEntries(EQUATIONS.map((e) => [e.id, e]));

export function equationSheet() {
  return [
    ...EQUATIONS.map((e) => ({
      id: e.id,
      name: e.name,
      formula: e.formula,
      note: e.note,
      solves: e.vars
        .filter((key) => e.solve[key])
        .map((key) => FIELD_BY_KEY[key].symbol)
        .join(' · '),
    })),
    {
      id: 'hook',
      name: 'Hook model',
      formula: 'a_lat = k·hook',
      note: 'Simplified linear model. Positive hook curves the ball right.',
      solves: 'a_lat',
    },
  ];
}

// --- Hook model -------------------------------------------------------------

export const HOOK_MODEL_DESCRIPTION =
  'a_lat = k·hook, with k = 0.55 m/s² per rad/s by default.';

export function hookModel(hook, k) {
  if (!Number.isFinite(hook) || !Number.isFinite(k)) return null;
  return {
    hook,
    k,
    lateralAccel: k * hook,
    formula: 'a_lat = k·hook',
    substitution: `a_lat = ${fmt(k)}·(${fmt(hook)})`,
  };
}

// --- Conflict construction --------------------------------------------------

function conflict(keys, message, equationId = null) {
  return { keys: [...new Set(keys)], message, equationId };
}

function residualConflict(eq, values, sources) {
  const key = eq.report.find((k) => Number.isFinite(values[k]) && sources[k] === 'known')
    || eq.report.find((k) => Number.isFinite(values[k]))
    || eq.vars[0];
  try {
    const predicted = eq.solve[key](values);
    return conflict(
      eq.vars,
      `${labelOf(key)} ${withUnit(key, values[key])} ≠ `
        + `${predicted.expr} = ${withUnit(key, predicted.value)}`,
      eq.id);
  } catch (_e) {
    return conflict(eq.vars, `${labelOf(key)} does not balance in ${eq.formula}.`, eq.id);
  }
}

function candidateConflict(key, first, second, values, sources) {
  // Try to report the mismatch in the "Known value ≠ expression = predicted"
  // form the lab uses. Prefer an equation output that is itself known.
  for (const candidate of [first, second]) {
    const other = candidate === first ? second : first;
    const outKey = candidate.eq.vars[0];
    if (outKey === key || !Number.isFinite(values[outKey])) continue;
    if (sources[outKey] !== 'known' && sources[outKey] !== 'solved') continue;
    try {
      const trial = { ...values, [key]: other.value };
      const predicted = candidate.eq.solve[outKey](trial);
      if (!closeValues(values[outKey], predicted.value)) {
        return conflict(
          [...candidate.eq.vars, ...other.eq.vars],
          `${labelOf(outKey)} ${withUnit(outKey, values[outKey])} ≠ `
            + `${predicted.expr} = ${withUnit(outKey, predicted.value)}`,
          candidate.eq.id);
      }
    } catch (_e) { /* fall through to the plain message */ }
  }
  return conflict(
    [key, ...first.eq.vars, ...second.eq.vars],
    `${labelOf(key)} cannot be both ${withUnit(key, first.value)} (${first.eq.name}) `
      + `and ${withUnit(key, second.value)} (${second.eq.name}).`,
    first.eq.id);
}

// --- Underdetermined message ------------------------------------------------

function listLabels(keys) {
  const labels = keys.map(labelOf);
  if (labels.length <= 1) return labels[0] || 'one more value';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

function missingMessage(missing, values) {
  const stalled = [];
  for (const eq of EQUATIONS) {
    const unknown = eq.vars.filter((key) => !Number.isFinite(values[key]));
    if (unknown.length >= 2) stalled.push(...unknown);
  }
  let suggestions = [...new Set(stalled)].filter((key) => missing.includes(key));
  if (!suggestions.length) suggestions = missing.slice();
  // The four motion variables are the most useful next entry. Side fields and
  // constants stay highlighted but are not listed when a primary is available.
  const primary = ['speed', 'time', 'momentum', 'energy'].filter((key) => suggestions.includes(key));
  const listed = primary.length ? primary : suggestions;
  return `Need one more of: ${listLabels(listed)}.`;
}

// --- The solver -------------------------------------------------------------

export function solveSystem(typed = {}) {
  const values = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, null]));
  const sources = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, 'missing']));
  const conflicts = [];
  const work = [];

  // Seed the player's typed values first; these are fixed constraints.
  for (const field of ALL_FIELDS) {
    const raw = typed[field.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const error = validateValue(field.key, value);
    if (error) {
      conflicts.push(conflict([field.key], error));
      // Keep the offending value so the row can show it in red instead of
      // silently clearing what the player typed.
      values[field.key] = value;
      sources[field.key] = 'known';
      continue;
    }
    values[field.key] = value;
    sources[field.key] = 'known';
  }

  // Direct throw inputs have no equation; a blank one uses its documented
  // default. Aim is held back because it can be solved from vx and v.
  if (!conflicts.length) {
    for (const key of DIRECT_AUTO_KEYS) {
      if (!Number.isFinite(values[key])) {
        values[key] = DEFAULT_VALUES[key];
        sources[key] = 'auto';
      }
    }
  }

  const runPropagation = () => {
    let pass = 0;
    while (!conflicts.length && pass < MAX_PASSES) {
      pass += 1;

      // 1. A fully-known equation must balance.
      for (const eq of EQUATIONS) {
        if (!eq.vars.every((key) => Number.isFinite(values[key]))) continue;
        const residual = eq.check(values);
        if (Math.abs(residual) > REL_TOL * eq.scale(values) + 1e-12) {
          conflicts.push(residualConflict(eq, values, sources));
          break;
        }
      }
      if (conflicts.length) return;

      // 2. Collect every equation with exactly one unknown.
      const candidates = new Map();
      for (const eq of EQUATIONS) {
        const unknown = eq.vars.filter((key) => !Number.isFinite(values[key]));
        if (unknown.length !== 1) continue;
        const key = unknown[0];
        if (!eq.solve[key]) continue;
        let result;
        try {
          result = eq.solve[key](values);
        } catch (error) {
          if (error instanceof SolveError) {
            if (error.ambiguous) continue;   // leave it missing, not contradictory
            conflicts.push(conflict([...eq.vars], `${eq.name}: ${error.message}`, eq.id));
            continue;
          }
          throw error;
        }
        if (!Number.isFinite(result.value)) {
          conflicts.push(conflict([...eq.vars], `${eq.name}: the result is not finite.`, eq.id));
          continue;
        }
        const domainError = validateValue(key, result.value);
        if (domainError) {
          conflicts.push(conflict([...eq.vars], `${eq.name}: ${domainError}`, eq.id));
          continue;
        }
        if (!candidates.has(key)) candidates.set(key, []);
        candidates.get(key).push({ eq, key, ...result });
      }
      if (conflicts.length) return;

      // 3. Different equations must not produce different answers.
      for (const [key, list] of candidates) {
        for (let i = 1; i < list.length; i += 1) {
          if (!closeValues(list[0].value, list[i].value)) {
            conflicts.push(candidateConflict(key, list[0], list[i], values, sources));
          }
        }
      }
      if (conflicts.length) return;

      // 4. Commit simultaneously.
      let changed = false;
      for (const [key, list] of candidates) {
        if (Number.isFinite(values[key])) continue;
        const answer = list[0];
        values[key] = answer.value;
        sources[key] = 'solved';
        changed = true;
        if (!work.some((entry) => entry.key === key)) {
          work.push({
            key,
            label: labelOf(key),
            symbol: symbolOf(key),
            unit: unitOf(key),
            equation: answer.eq.name,
            formula: answer.eq.formula,
            expr: answer.expr,
            sub: answer.sub,
            value: answer.value,
            note: answer.note || '',
          });
        }
      }
      if (!changed) return;
    }
    if (pass >= MAX_PASSES && !conflicts.length) {
      conflicts.push(conflict([], 'The solver did not converge; check the values.'));
    }
  };

  runPropagation();

  // Aim is a direct input that the sideways equation can also solve. Only
  // default it after the equations have had their chance, then propagate the
  // newly available relation (for example, vx + default aim -> speed).
  if (!conflicts.length && AUTO_AIM && !Number.isFinite(values.aim)) {
    values.aim = DEFAULT_VALUES.aim;
    sources.aim = 'auto';
    runPropagation();
  }

  const missing = ALL_FIELDS
    .map((f) => f.key)
    .filter((key) => !Number.isFinite(values[key]));

  let status = 'solved';
  let message = '';
  if (conflicts.length) {
    status = 'conflict';
    message = conflicts[0].message;
  } else if (missing.length) {
    status = 'underdetermined';
    message = missingMessage(missing, values);
  }

  const conflictKeys = new Set();
  for (const item of conflicts) for (const key of item.keys) conflictKeys.add(key);

  const knownCount = Object.values(sources).filter((s) => s === 'known').length;
  const solvedCount = Object.values(sources).filter((s) => s === 'solved').length;

  return {
    ok: status === 'solved',
    status,
    message,
    values: { ...values },
    sources: { ...sources },
    conflicts,
    conflictKeys,
    missing,
    missingKeys: new Set(missing),
    work,
    knownCount,
    solvedCount,
    hook: hookModel(values.hook, values.hookK),
    constants: Object.fromEntries(CONST_FIELDS.map((f) => [f.key, values[f.key]])),
  };
}
