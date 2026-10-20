// Shared kinematics solver for the Physics Lab's non-bowling modes.
//
// The model is the standard constant-acceleration set (SUVAT):
//
//   E1: v = u + a·t
//   E2: s = u·t + ½·a·t²
//   E3: v² = u² + 2·a·s
//   E4: s = ½·(u + v)·t
//
// One equation is enough to solve one unknown. The solver repeatedly applies
// the simplest equation that has exactly one unknown. Preference order is
// E1, E4, E2, E3, so the "ƒ" explanation reads as naturally as possible.
//
// Every three-known combination is covered. The chains the order produces:
//
//   u v s  -> E4 gives t          -> E1 gives a
//   u v t  -> E1 gives a          -> E4 gives s
//   u v a  -> E1 gives t          -> E4 gives s
//   u s t  -> E4 gives v          -> E1 gives a
//   u s a  -> E2 gives t (quad.)  -> E1 gives v
//   u t a  -> E1 gives v          -> E4 gives s
//   v s t  -> E4 gives u          -> E1 gives a
//   v s a  -> E3 gives u (± root) -> E1 gives t
//   v t a  -> E1 gives u          -> E4 gives s
//   s t a  -> E2 gives u          -> E1 gives v
//
// A fixed value (free fall's a = ±g, a locked u = 0, or v = 0 at the highest
// point) counts as known but is never offered as a row unknown.
//
// Journey uses the same module for its totals and its optional one-blank
// back-solve, so the Lab has a single non-bowling solver file.

import { fmt } from './lab_solver.js';

// Contradictions from exact, internally-derived values may only be rounding
// noise. Values the player typed are often rounded by hand, so they get the
// wider allowance described in the Lab spec.
export const REL_TOL = 1e-6;
export const ROUNDED_TOL = 0.005;
const EPS = 1e-9;
const MAX_STEPS = 32;

export const SUVAT_KEYS = ['u', 'v', 's', 't', 'a'];

export const SUVAT_META = {
  u: { key: 'u', label: 'Initial speed', unit: 'm/s', symbol: 'u' },
  v: { key: 'v', label: 'Final speed', unit: 'm/s', symbol: 'v' },
  s: { key: 's', label: 'Distance', unit: 'm', symbol: 's' },
  t: { key: 't', label: 'Time', unit: 's', symbol: 't' },
  a: { key: 'a', label: 'Acceleration', unit: 'm/s²', symbol: 'a' },
};

// When a set of typed values disagrees, prefer blaming the time first: it is
// the value the spec's worked contradiction calls out, and it is the easiest
// one to re-derive from the others.
const BLAME_ORDER = ['t', 's', 'v', 'u', 'a'];

class Impossible extends Error {
  constructor(message) {
    super(message);
    this.name = 'Impossible';
  }
}

class Ambiguous extends Error {
  constructor(message) {
    super(message);
    this.name = 'Ambiguous';
  }
}

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function closeTo(a, b, tol = ROUNDED_TOL) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)) + EPS;
}

function labelOf(meta, key) {
  return (meta && meta[key] && meta[key].label) || key;
}

function unitOf(meta, key) {
  return (meta && meta[key] && meta[key].unit) || '';
}

function withUnit(meta, key, value) {
  const unit = unitOf(meta, key);
  return unit ? `${fmt(value)} ${unit}` : fmt(value);
}

function impossible(message) {
  return new Impossible(message);
}

function requireValue(values, key, meta, context) {
  const value = values[key];
  if (!isNum(value)) {
    throw new Impossible(`${labelOf(meta, key)} is needed${context ? ` for ${context}` : ''}.`);
  }
  return value;
}

function requireNonZero(value, key, meta, context) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(
      `That can't happen${context ? ` in ${context}` : ''}: ${labelOf(meta, key).toLowerCase()} is zero.`);
  }
  return value;
}

// --- Equations --------------------------------------------------------------
//
// Each solve function returns { value, expr, sub, note }. "sub" is the same
// expression with the known numbers substituted so the ƒ panel can show the
// whole chain. Functions only read the other variables.

function eqE1Time(values, meta) {
  const u = requireValue(values, 'u', meta, 'v = u + a·t');
  const v = requireValue(values, 'v', meta, 'v = u + a·t');
  const a = requireValue(values, 'a', meta, 'v = u + a·t');
  if (Math.abs(a) <= EPS) {
    if (closeTo(u, v, REL_TOL)) {
      throw new Ambiguous('Time is not determined when speed does not change.');
    }
    throw impossible('That can\'t happen: the speed changes but acceleration is zero.');
  }
  const value = (v - u) / a;
  if (value < -EPS) {
    throw impossible(`That can't happen: time works out to ${fmt(value)} s.`);
  }
  return {
    value: Math.max(0, value),
    expr: '(v − u) / a',
    sub: `(${fmt(v)} − ${fmt(u)}) / ${fmt(a)}`,
  };
}

function eqE2Time(values, meta) {
  const u = requireValue(values, 'u', meta, 's = u·t + ½·a·t²');
  const s = requireValue(values, 's', meta, 's = u·t + ½·a·t²');
  const a = requireValue(values, 'a', meta, 's = u·t + ½·a·t²');

  if (Math.abs(a) <= EPS) {
    if (Math.abs(u) <= EPS) {
      if (Math.abs(s) <= EPS) {
        throw new Ambiguous('Time is not determined when the object does not move.');
      }
      throw impossible('That can\'t happen with these values.');
    }
    const value = s / u;
    if (value < -EPS) {
      throw impossible(`That can't happen: time works out to ${fmt(value)} s.`);
    }
    return {
      value: Math.max(0, value),
      expr: 's / u',
      sub: `${fmt(s)} / ${fmt(u)}`,
      note: 'a = 0, so the motion is uniform.',
    };
  }

  const discriminant = u * u + 2 * a * s;
  const scale = Math.max(1, u * u, Math.abs(2 * a * s));
  if (discriminant < -REL_TOL * scale) {
    throw impossible('That can\'t happen with these values.');
  }
  const root = Math.sqrt(Math.max(0, discriminant));
  const rawRoots = [(-u + root) / a, (-u - root) / a]
    .filter((x) => isNum(x) && x >= -EPS)
    .map((x) => Math.max(0, x))
    .sort((left, right) => left - right);
  const roots = [];
  for (const value of rawRoots) {
    if (!roots.some((other) => Math.abs(other - value) <= 1e-9)) roots.push(value);
  }
  if (!roots.length) {
    throw impossible('That can\'t happen with these values.');
  }
  const value = roots[0];
  const other = roots.find((candidate) => candidate > value + 1e-9);
  const note = other !== undefined
    ? `Also valid: t = ${fmt(other)} s, the object comes back past that point.`
    : '';
  return {
    value,
    expr: '(−u ± √(u² + 2·a·s)) / a',
    sub: `(−${fmt(u)} ± √(${fmt(u)}² + 2×${fmt(a)}×${fmt(s)})) / ${fmt(a)}`,
    note,
    other,
  };
}

const EQUATIONS = [
  {
    id: 'E1',
    name: 'Velocity–time',
    formula: 'v = u + a·t',
    vars: ['u', 'v', 'a', 't'],
    residual: (v) => v.v - (v.u + v.a * v.t),
    scale: (v) => Math.max(1, Math.abs(v.v), Math.abs(v.u), Math.abs(v.a * v.t)),
    solve: {
      v: (v) => ({
        value: v.u + v.a * v.t,
        expr: 'u + a·t',
        sub: `${fmt(v.u)} + ${fmt(v.a)}×${fmt(v.t)}`,
      }),
      u: (v) => {
        const a = requireValue(v, 'a', v.meta, 'v = u + a·t');
        const t = requireNonZero(requireValue(v, 't', v.meta, 'v = u + a·t'), 't', v.meta, 'v = u + a·t');
        return {
          value: v.v - a * t,
          expr: 'v − a·t',
          sub: `${fmt(v.v)} − ${fmt(a)}×${fmt(t)}`,
        };
      },
      a: (v) => {
        const t = requireNonZero(requireValue(v, 't', v.meta, 'v = u + a·t'), 't', v.meta, 'v = u + a·t');
        return {
          value: (v.v - v.u) / t,
          expr: '(v − u) / t',
          sub: `(${fmt(v.v)} − ${fmt(v.u)}) / ${fmt(t)}`,
        };
      },
      t: (v) => eqE1Time(v, v.meta),
    },
  },
  {
    id: 'E4',
    name: 'Average velocity',
    formula: 's = ½·(u + v)·t',
    vars: ['s', 'u', 'v', 't'],
    residual: (v) => v.s - 0.5 * (v.u + v.v) * v.t,
    scale: (v) => Math.max(1, Math.abs(v.s), Math.abs(0.5 * (v.u + v.v) * v.t)),
    solve: {
      s: (v) => ({
        value: 0.5 * (v.u + v.v) * v.t,
        expr: '½·(u + v)·t',
        sub: `0.5×(${fmt(v.u)} + ${fmt(v.v)})×${fmt(v.t)}`,
      }),
      u: (v) => {
        const t = requireNonZero(requireValue(v, 't', v.meta, 's = ½·(u + v)·t'), 't', v.meta, 's = ½·(u + v)·t');
        return {
          value: (2 * v.s) / t - v.v,
          expr: '2·s / t − v',
          sub: `2×${fmt(v.s)} / ${fmt(t)} − ${fmt(v.v)}`,
        };
      },
      v: (v) => {
        const t = requireNonZero(requireValue(v, 't', v.meta, 's = ½·(u + v)·t'), 't', v.meta, 's = ½·(u + v)·t');
        return {
          value: (2 * v.s) / t - v.u,
          expr: '2·s / t − u',
          sub: `2×${fmt(v.s)} / ${fmt(t)} − ${fmt(v.u)}`,
        };
      },
      t: (v) => {
        const denominator = v.u + v.v;
        if (Math.abs(denominator) <= EPS) {
          if (Math.abs(v.s) <= EPS) {
            throw new Ambiguous('Time is not determined when u + v = 0 and s = 0.');
          }
          throw impossible('That can\'t happen: u + v is zero, so this distance needs infinite time.');
        }
        const value = (2 * v.s) / denominator;
        if (value < -EPS) {
          throw impossible(`That can't happen: time works out to ${fmt(value)} s.`);
        }
        return {
          value: Math.max(0, value),
          expr: '2·s / (u + v)',
          sub: `2×${fmt(v.s)} / (${fmt(v.u)} + ${fmt(v.v)})`,
        };
      },
    },
  },
  {
    id: 'E2',
    name: 'Distance–time',
    formula: 's = u·t + ½·a·t²',
    vars: ['s', 'u', 'a', 't'],
    residual: (v) => v.s - (v.u * v.t + 0.5 * v.a * v.t * v.t),
    scale: (v) => Math.max(1, Math.abs(v.s), Math.abs(v.u * v.t),
      Math.abs(0.5 * v.a * v.t * v.t)),
    solve: {
      s: (v) => ({
        value: v.u * v.t + 0.5 * v.a * v.t * v.t,
        expr: 'u·t + ½·a·t²',
        sub: `${fmt(v.u)}×${fmt(v.t)} + 0.5×${fmt(v.a)}×${fmt(v.t)}²`,
      }),
      u: (v) => {
        const t = requireNonZero(requireValue(v, 't', v.meta, 's = u·t + ½·a·t²'), 't', v.meta, 's = u·t + ½·a·t²');
        return {
          value: v.s / t - 0.5 * v.a * t,
          expr: 's / t − ½·a·t',
          sub: `${fmt(v.s)} / ${fmt(t)} − 0.5×${fmt(v.a)}×${fmt(t)}`,
        };
      },
      a: (v) => {
        const t = requireNonZero(requireValue(v, 't', v.meta, 's = u·t + ½·a·t²'), 't', v.meta, 's = u·t + ½·a·t²');
        return {
          value: (2 * (v.s - v.u * t)) / (t * t),
          expr: '2·(s − u·t) / t²',
          sub: `2×(${fmt(v.s)} − ${fmt(v.u)}×${fmt(t)}) / ${fmt(t)}²`,
        };
      },
      t: (v) => eqE2Time(v, v.meta),
    },
  },
  {
    id: 'E3',
    name: 'Velocity–distance',
    formula: 'v² = u² + 2·a·s',
    vars: ['v', 'u', 'a', 's'],
    residual: (v) => v.v * v.v - (v.u * v.u + 2 * v.a * v.s),
    scale: (v) => Math.max(1, Math.abs(v.v * v.v), Math.abs(v.u * v.u),
      Math.abs(2 * v.a * v.s)),
    solve: {
      s: (v) => {
        if (Math.abs(v.a) <= EPS) {
          if (closeTo(v.v * v.v, v.u * v.u, REL_TOL)) {
            throw new Ambiguous('Distance is not determined when acceleration is zero and speed does not change.');
          }
          throw impossible('That can\'t happen: the speed changes but acceleration is zero.');
        }
        return {
          value: (v.v * v.v - v.u * v.u) / (2 * v.a),
          expr: '(v² − u²) / (2·a)',
          sub: `(${fmt(v.v)}² − ${fmt(v.u)}²) / (2×${fmt(v.a)})`,
        };
      },
      u: (v) => {
        const inside = v.v * v.v - 2 * v.a * v.s;
        const scale = Math.max(1, v.v * v.v, Math.abs(2 * v.a * v.s));
        if (inside < -REL_TOL * scale) throw impossible('That can\'t happen with these values.');
        const root = Math.sqrt(Math.max(0, inside));
        const sign = Math.abs(v.v) > EPS ? Math.sign(v.v) : 1;
        const value = root * (sign || 1);
        const other = -value;
        return {
          value,
          expr: '±√(v² − 2·a·s)',
          sub: `±√(${fmt(v.v)}² − 2×${fmt(v.a)}×${fmt(v.s)})`,
          note: Math.abs(other - value) > EPS
            ? `The other root is u = ${fmt(other)} m/s (moving the other way).`
            : '',
          other,
        };
      },
      a: (v) => {
        if (Math.abs(v.s) <= EPS) {
          if (closeTo(v.v * v.v, v.u * v.u, REL_TOL)) {
            throw new Ambiguous('Acceleration is not determined when the distance is zero and speed does not change.');
          }
          throw impossible('That can\'t happen with these values.');
        }
        return {
          value: (v.v * v.v - v.u * v.u) / (2 * v.s),
          expr: '(v² − u²) / (2·s)',
          sub: `(${fmt(v.v)}² − ${fmt(v.u)}²) / (2×${fmt(v.s)})`,
        };
      },
      v: (v) => {
        const inside = v.u * v.u + 2 * v.a * v.s;
        const scale = Math.max(1, v.u * v.u, Math.abs(2 * v.a * v.s));
        if (inside < -REL_TOL * scale) throw impossible('That can\'t happen with these values.');
        const root = Math.sqrt(Math.max(0, inside));
        // Choose the root on the part of the flight that reaches s first. This
        // keeps a thrown-up object's descending leg negative instead of
        // silently reporting a positive speed.
        let sign = Math.sign(v.u) || 1;
        let timeNote = '';
        try {
          const time = eqE2Time(v, v.meta);
          const velocity = v.u + v.a * time.value;
          if (Number.isFinite(velocity) && Math.abs(velocity) > EPS) sign = Math.sign(velocity);
          if (Number.isFinite(time.other)) {
            const otherVelocity = v.u + v.a * time.other;
            if (Number.isFinite(otherVelocity)) {
              timeNote = `The other root is v = ${fmt(otherVelocity)} m/s.`;
            }
          }
        } catch (_error) {
          // No real time of flight: fall back to the direction of u.
        }
        const value = root * (sign || 1);
        const other = -value;
        return {
          value,
          expr: '±√(u² + 2·a·s)',
          sub: `±√(${fmt(v.u)}² + 2×${fmt(v.a)}×${fmt(v.s)})`,
          note: timeNote || (Math.abs(other - value) > EPS
            ? `The other root is v = ${fmt(other)} m/s (moving the other way).`
            : ''),
          other,
        };
      },
    },
  },
];

export const SUVAT_EQUATIONS = EQUATIONS.map((equation) => ({
  id: equation.id,
  name: equation.name,
  formula: equation.formula,
  vars: [...equation.vars],
}));

function solveKey(equation, key, values, meta) {
  const result = equation.solve[key]({ ...values, meta });
  if (!isNum(result.value)) {
    throw impossible('That can\'t happen with these values.');
  }
  return result;
}

function conflictResult(values, sources, work, equation, meta, editedKey) {
  const typed = equation.vars.filter((key) => sources[key] === 'known');
  let blame = editedKey && typed.includes(editedKey)
    ? editedKey
    : BLAME_ORDER.find((key) => typed.includes(key)) || typed[0] || equation.vars[0];
  let predicted = null;
  try {
    predicted = solveKey(equation, blame, values, meta);
  } catch (_error) {
    // Fall back to the residual text below.
  }
  let message;
  if (predicted && isNum(predicted.value)) {
    message = `${labelOf(meta, blame)} should be ${withUnit(meta, blame, predicted.value)}, not ${fmt(values[blame])}.`;
  } else {
    message = `These values do not satisfy ${equation.formula}.`;
  }
  return {
    ok: false,
    status: 'conflict',
    message,
    values: { ...values },
    sources: { ...sources },
    work: work.slice(),
    conflictKeys: new Set([blame]),
    missing: [],
    missingKeys: new Set(),
    equation: equation.id,
    blame,
    predicted: predicted ? predicted.value : null,
  };
}

function impossibleResult(values, sources, work, message) {
  return {
    ok: false,
    status: 'impossible',
    message,
    values: { ...values },
    sources: { ...sources },
    work: work.slice(),
    conflictKeys: new Set(),
    missing: [],
    missingKeys: new Set(),
    blame: null,
    predicted: null,
  };
}

function fullyKnownConflict(values, sources, work, meta, editedKey) {
  for (const equation of EQUATIONS) {
    if (!equation.vars.every((key) => isNum(values[key]))) continue;
    const residual = Math.abs(equation.residual(values));
    const typedCount = equation.vars.filter((key) => sources[key] === 'known').length;
    const tolerance = (typedCount >= 3 ? ROUNDED_TOL : REL_TOL) * equation.scale(values);
    if (residual > tolerance) {
      return conflictResult(values, sources, work, equation, meta, editedKey);
    }
  }
  return null;
}

function underdeterminedMessage(values, fixedKeys, meta) {
  const missing = SUVAT_KEYS.filter((key) => !isNum(values[key]) && !fixedKeys.has(key));
  const knownCount = SUVAT_KEYS.filter((key) => isNum(values[key])).length;
  const needed = Math.max(1, 3 - knownCount);
  const suggestions = missing.map((key) => labelOf(meta, key)).slice(0, 2);
  const list = suggestions.length > 1
    ? `${suggestions[0]} or ${suggestions[1]}`
    : (suggestions[0] || 'another value');
  if (needed === 1) return `Add one more value, like ${list}.`;
  return `Add ${needed} more values, like ${list}.`;
}

/**
 * Solve the SUVAT system.
 *
 * @param {object} options
 * @param {object} options.known   Player-typed values keyed u,v,s,t,a.
 * @param {object} options.fixed   Locked values (for example free-fall a and
 *                                 the dropped/at-highest locks).
 * @param {string|null} options.editedKey  Prefer blaming this typed value.
 * @param {object} options.meta    Labels/units per key.
 */
export function solveSuvat({
  known = {},
  fixed = {},
  editedKey = null,
  meta = SUVAT_META,
} = {}) {
  const values = Object.fromEntries(SUVAT_KEYS.map((key) => [key, null]));
  const sources = Object.fromEntries(SUVAT_KEYS.map((key) => [key, 'missing']));
  const work = [];
  const fixedKeys = new Set(Object.keys(fixed).filter((key) => isNum(fixed[key])));

  for (const key of SUVAT_KEYS) {
    const fixedValue = fixed[key];
    if (isNum(fixedValue)) {
      values[key] = fixedValue;
      sources[key] = 'fixed';
    }
    const raw = known[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (!isNum(value) || fixedKeys.has(key)) continue;
    if (key === 't' && value < 0) {
      return impossibleResult(values, sources, work, 'That can\'t happen: time cannot be negative.');
    }
    values[key] = value;
    sources[key] = 'known';
  }

  let guard = 0;
  while (guard < MAX_STEPS) {
    guard += 1;

    const conflict = fullyKnownConflict(values, sources, work, meta, editedKey);
    if (conflict) return conflict;

    let chosen = null;
    for (const equation of EQUATIONS) {
      const unknown = equation.vars.filter((key) => !isNum(values[key]));
      if (unknown.length !== 1) continue;
      const key = unknown[0];
      if (!equation.solve[key]) continue;
      try {
        const result = solveKey(equation, key, values, meta);
        chosen = { equation, key, result };
        break;
      } catch (error) {
        if (error instanceof Impossible) {
          return impossibleResult(values, sources, work, error.message);
        }
        if (error instanceof Ambiguous) continue;
        throw error;
      }
    }
    if (!chosen) break;

    values[chosen.key] = chosen.result.value;
    sources[chosen.key] = 'solved';
    if (!work.some((entry) => entry.key === chosen.key)) {
      work.push({
        key: chosen.key,
        label: labelOf(meta, chosen.key),
        symbol: (meta[chosen.key] && meta[chosen.key].symbol) || chosen.key,
        unit: unitOf(meta, chosen.key),
        equation: chosen.equation.id,
        equationName: chosen.equation.name,
        formula: chosen.equation.formula,
        expr: chosen.result.expr,
        sub: chosen.result.sub,
        value: chosen.result.value,
        note: chosen.result.note || '',
        other: chosen.result.other,
      });
    }
  }

  const conflict = fullyKnownConflict(values, sources, work, meta, editedKey);
  if (conflict) return conflict;

  const missing = SUVAT_KEYS.filter((key) => !isNum(values[key]) && !fixedKeys.has(key));
  let status = 'solved';
  let message = '';
  if (missing.length) {
    status = 'underdetermined';
    message = underdeterminedMessage(values, fixedKeys, meta);
  }

  return {
    ok: status === 'solved',
    status,
    message,
    values: { ...values },
    sources: { ...sources },
    work,
    conflictKeys: new Set(),
    missing,
    missingKeys: new Set(missing),
    fixedKeys,
    blame: null,
    predicted: null,
  };
}

// --- Journey ---------------------------------------------------------------
//
// Distance and displacement are different quantities:
//   total distance = Σ |leg|
//   displacement   = Σ direction·leg      (East positive)
// Average speed and average velocity then divide by the total time.

export const JOURNEY_RESULTS = [
  { key: 'totalDistance', label: 'Total distance', unit: 'm', symbol: 'd' },
  { key: 'displacement', label: 'Displacement', unit: 'm', symbol: 'Δx' },
  { key: 'totalTime', label: 'Total time', unit: 's', symbol: 't' },
  { key: 'avgSpeed', label: 'Average speed', unit: 'm/s', symbol: 'v̄' },
  { key: 'avgVelocity', label: 'Average velocity', unit: 'm/s', symbol: 'v̄x' },
];

export const JOURNEY_RESULT_BY_KEY = Object.fromEntries(
  JOURNEY_RESULTS.map((item) => [item.key, item]),
);

function journeyEmptyResult(message, status = 'underdetermined') {
  return {
    ok: false,
    status,
    message,
    results: Object.fromEntries(JOURNEY_RESULTS.map((item) => [item.key, null])),
    sources: Object.fromEntries(JOURNEY_RESULTS.map((item) => [item.key, 'missing'])),
    conflictKeys: new Set(),
    solvedLeg: null,
    legs: [],
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Compute Journey totals and, when exactly one leg value is blank and the
 * player has typed a result, solve that blank.
 *
 * @param {Array} legs  [{ distance, direction: 1|-1, time }]
 * @param {object} typedResults  Player-typed result values.
 */
export function solveJourney(legs = [], typedResults = {}) {
  const cleanLegs = legs.map((leg) => ({
    distance: isNum(leg.distance) ? leg.distance : null,
    direction: leg.direction === -1 ? -1 : 1,
    time: isNum(leg.time) ? leg.time : null,
  }));

  if (!cleanLegs.length) {
    return journeyEmptyResult('Add at least one leg.');
  }

  for (const leg of cleanLegs) {
    if (leg.distance !== null && leg.distance < 0) {
      return {
        ...journeyEmptyResult('Distance cannot be negative. Use the direction toggle.', 'conflict'),
        conflictKeys: new Set(['distance']),
      };
    }
    if (leg.time !== null && leg.time < 0) {
      return {
        ...journeyEmptyResult('Time cannot be negative.', 'conflict'),
        conflictKeys: new Set(['time']),
      };
    }
  }

  const blanks = [];
  cleanLegs.forEach((leg, index) => {
    if (leg.distance === null) blanks.push({ index, key: 'distance' });
    if (leg.time === null) blanks.push({ index, key: 'time' });
  });

  const typed = {};
  for (const item of JOURNEY_RESULTS) {
    if (isNum(typedResults[item.key])) typed[item.key] = Number(typedResults[item.key]);
  }
  const typedKeys = Object.keys(typed);

  let solvedLeg = null;
  if (blanks.length === 1 && Object.keys(typed).length) {
    const blank = blanks[0];
    const leg = cleanLegs[blank.index];
    const otherDistances = sum(cleanLegs
      .filter((_item, index) => index !== blank.index)
      .map((item) => item.distance || 0));
    const allDistances = sum(cleanLegs.map((item) => item.distance || 0));
    const otherTimes = sum(cleanLegs
      .filter((_item, index) => index !== blank.index)
      .map((item) => item.time || 0));
    const allTimes = sum(cleanLegs.map((item) => item.time || 0));
    const signedOthers = sum(cleanLegs
      .filter((_item, index) => index !== blank.index)
      .map((item) => (item.distance || 0) * item.direction));
    const totalTimeKnown = cleanLegs.every((item) => item.time !== null);
    const totalDistanceKnown = cleanLegs.every((item) => item.distance !== null);

    const candidates = [];
    const addCandidate = (value, from) => {
      if (isNum(value) && value > EPS) candidates.push({ value, from });
    };

    if (blank.key === 'time') {
      if (isNum(typed.totalTime)) addCandidate(typed.totalTime - otherTimes, 'totalTime');
      if (isNum(typed.avgSpeed) && typed.avgSpeed > EPS && totalDistanceKnown) {
        addCandidate(allDistances / typed.avgSpeed - otherTimes, 'avgSpeed');
      }
      if (isNum(typed.avgVelocity) && Math.abs(typed.avgVelocity) > EPS && totalDistanceKnown) {
        const displacement = sum(cleanLegs.map((item) => (item.distance || 0) * item.direction));
        addCandidate(displacement / typed.avgVelocity - otherTimes, 'avgVelocity');
      }
    } else if (blank.key === 'distance') {
      if (isNum(typed.totalDistance)) {
        addCandidate(typed.totalDistance - otherDistances, 'totalDistance');
      }
      if (isNum(typed.displacement)) {
        addCandidate((typed.displacement - signedOthers) / leg.direction, 'displacement');
      }
      if (isNum(typed.avgSpeed) && totalTimeKnown && allTimes > EPS) {
        addCandidate(typed.avgSpeed * allTimes - otherDistances, 'avgSpeed');
      }
      if (isNum(typed.avgVelocity) && totalTimeKnown && allTimes > EPS) {
        addCandidate((typed.avgVelocity * allTimes - signedOthers) / leg.direction, 'avgVelocity');
      }
    }

    if (candidates.length) {
      const first = candidates[0];
      const disagreement = candidates.find(
        (candidate) => !closeTo(candidate.value, first.value, ROUNDED_TOL));
      if (disagreement) {
        return {
          ...journeyEmptyResult(
            'Those results disagree, so the blank value cannot be solved.', 'conflict'),
          conflictKeys: new Set(['results']),
        };
      }
      cleanLegs[blank.index][blank.key] = first.value;
      solvedLeg = { index: blank.index, key: blank.key, value: first.value, from: first.from };
    }
  }

  const hasBlank = cleanLegs.some((leg) => leg.distance === null || leg.time === null);
  if (hasBlank) {
    const message = blanks.length === 1
      ? (typedKeys.length
        ? `That result doesn't determine the blank ${blanks[0].key}.`
        : `Type a result to solve the blank ${blanks[0].key}.`)
      : 'Fill all but one leg value to use a result.';
    return {
      ...journeyEmptyResult(message),
      legs: cleanLegs,
      solvedLeg,
    };
  }

  const totalDistance = sum(cleanLegs.map((leg) => leg.distance));
  const displacement = sum(cleanLegs.map((leg) => leg.direction * leg.distance));
  const totalTime = sum(cleanLegs.map((leg) => leg.time));
  if (totalTime <= EPS) {
    return {
      ...journeyEmptyResult('Total time must be greater than zero.', 'impossible'),
      legs: cleanLegs,
      solvedLeg,
    };
  }

  const results = {
    totalDistance,
    displacement,
    totalTime,
    avgSpeed: totalDistance / totalTime,
    avgVelocity: displacement / totalTime,
  };

  const sources = Object.fromEntries(JOURNEY_RESULTS.map((item) => [item.key, 'solved']));
  const conflictKeys = new Set();
  let message = '';
  for (const item of JOURNEY_RESULTS) {
    if (!isNum(typed[item.key])) continue;
    sources[item.key] = 'known';
    if (!closeTo(typed[item.key], results[item.key], ROUNDED_TOL)) {
      conflictKeys.add(item.key);
      message = `${item.label} should be ${fmt(results[item.key])} ${item.unit}, not ${fmt(typed[item.key])}.`;
    }
  }

  if (conflictKeys.size) {
    return {
      ok: false,
      status: 'conflict',
      message,
      results,
      sources,
      conflictKeys,
      solvedLeg,
      legs: cleanLegs,
    };
  }

  return {
    ok: true,
    status: 'solved',
    message: '',
    results,
    sources,
    conflictKeys,
    solvedLeg,
    legs: cleanLegs,
  };
}

// --- Self-check -------------------------------------------------------------
//
// The Lab calls this once on first load. It is silent unless something fails,
// but the returned rows are also used by tools/lab_modes_tests.mjs.

// Sample a scalar function and return the times where it crosses a target.
// Used by the snapshot reverse lookup and by the validation suite.
export function findCrossings(sample, duration, target, samples = 600) {
  const times = [];
  if (!(duration > 0) || typeof sample !== 'function') return times;
  let previousT = 0;
  let previous = sample(0) - target;
  for (let i = 1; i <= samples; i += 1) {
    const t = (i / samples) * duration;
    const value = sample(t);
    if (!isNum(value)) continue;
    const delta = value - target;
    if (Math.abs(delta) < 1e-7) times.push(t);
    else if (Number.isFinite(previous) && previous * delta < 0) {
      let low = previousT;
      let high = t;
      for (let j = 0; j < 40; j += 1) {
        const mid = (low + high) / 2;
        const midDelta = sample(mid) - target;
        if (previous * midDelta <= 0) high = mid;
        else low = mid;
      }
      times.push((low + high) / 2);
    }
    previousT = t;
    previous = delta;
  }
  const unique = [];
  for (const value of times) {
    if (!unique.some((other) => Math.abs(other - value) < 0.01)) unique.push(value);
  }
  return unique;
}

export function runLabValidation() {
  const checks = [];
  const near = (actual, expected, tolerance = 0.005) => (
    isNum(actual) && Math.abs(actual - expected)
      <= tolerance * Math.max(1, Math.abs(expected)) + 1e-9
  );

  const drop = solveSuvat({
    known: { s: -44.1, u: 0 },
    fixed: { a: -9.8 },
  });
  checks.push({
    name: 'Free fall: dropped from 44.1 m at g = 9.8',
    pass: drop.ok && near(drop.values.t, 3, 1e-9) && near(drop.values.v, -29.4, 1e-9),
    actual: { t: drop.values.t, v: drop.values.v, status: drop.status },
  });

  const up = solveSuvat({
    known: { u: 19.6, v: 0 },
    fixed: { a: -9.8 },
  });
  checks.push({
    name: 'Free fall: thrown up at 19.6 m/s at g = 9.8',
    pass: up.ok && near(up.values.t, 2, 1e-9) && near(up.values.s, 19.6, 1e-9),
    actual: { t: up.values.t, h: up.values.s, status: up.status },
  });

  const brake = solveSuvat({ known: { u: 20, v: 0, s: 50 } });
  checks.push({
    name: 'Straight line: braking car',
    pass: brake.ok && near(brake.values.a, -4) && near(brake.values.t, 5, 1e-6),
    actual: { a: brake.values.a, t: brake.values.t, status: brake.status },
  });

  const uniform = solveSuvat({ known: { u: 0, a: 2, t: 5 } });
  checks.push({
    name: 'Straight line: uniform acceleration',
    pass: uniform.ok && near(uniform.values.v, 10, 1e-6) && near(uniform.values.s, 25, 1e-6),
    actual: { v: uniform.values.v, s: uniform.values.s, status: uniform.status },
  });

  const journey = solveJourney([
    { distance: 120, direction: 1, time: 20 },
    { distance: 80, direction: -1, time: 10 },
  ]);
  checks.push({
    name: 'Journey: out and back',
    pass: journey.ok
      && near(journey.results.totalDistance, 200, 1e-6)
      && near(journey.results.displacement, 40, 1e-6)
      && near(journey.results.totalTime, 30, 1e-6)
      && near(journey.results.avgSpeed, 6.6667, 0.001)
      && near(journey.results.avgVelocity, 1.3333, 0.001),
    actual: journey.results,
  });

  const contradiction = solveSuvat({ known: { u: 20, v: 0, s: 50, t: 4 } });
  checks.push({
    name: 'Contradiction: time should be 5 s',
    pass: contradiction.status === 'conflict'
      && contradiction.blame === 't'
      && near(contradiction.predicted, 5, 1e-6),
    actual: {
      status: contradiction.status,
      blame: contradiction.blame,
      predicted: contradiction.predicted,
      message: contradiction.message,
    },
  });

  const impossible = solveSuvat({ known: { u: 0, v: 10, a: -2 } });
  checks.push({
    name: 'Impossible: negative time',
    pass: impossible.status === 'impossible'
      && !/NaN|Infinity/.test(impossible.message),
    actual: { status: impossible.status, message: impossible.message },
  });

  // Every three-known combination shares one consistent physical case:
  // u = 5, a = 2, t = 3 -> v = 11, s = 24.
  const combos = [
    ['u', 'v', 's', { u: 5, v: 11, s: 24 }],
    ['u', 'v', 't', { u: 5, v: 11, t: 3 }],
    ['u', 'v', 'a', { u: 5, v: 11, a: 2 }],
    ['u', 's', 't', { u: 5, s: 24, t: 3 }],
    ['u', 's', 'a', { u: 5, s: 24, a: 2 }],
    ['u', 't', 'a', { u: 5, t: 3, a: 2 }],
    ['v', 's', 't', { v: 11, s: 24, t: 3 }],
    ['v', 's', 'a', { v: 11, s: 24, a: 2 }],
    ['v', 't', 'a', { v: 11, t: 3, a: 2 }],
    ['s', 't', 'a', { s: 24, t: 3, a: 2 }],
  ];
  for (let index = 0; index < combos.length; index += 1) {
    const [first, second, third, known] = combos[index];
    const result = solveSuvat({ known });
    const expected = { u: 5, v: 11, s: 24, t: 3, a: 2 };
    const pass = result.ok && SUVAT_KEYS.every(
      (key) => near(result.values[key], expected[key], 1e-6));
    checks.push({
      name: `Three-known combination: ${first} ${second} ${third}`,
      pass,
      actual: result.values,
    });
  }

  return checks;
}
