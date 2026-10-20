// Linear Motion (Free Fall, Straight Line) on the shared relation engine.
//
// The catalog is the class-notes set:
//   vf = vi + a t
//   vf² = vi² + 2 a Δx
//   Δx = vi t + ½ a t²
//   Δx = ½ (vi + vf) t
//   average speed = distance / time
//   average velocity = displacement / time
//
// Every three-known combination of {vi, vf, Δx, t, a} solves, and a locked
// a = 0 (Constant speed) or a = −g (Free Fall) counts as known.

import { fmt } from './lab_solver.js';
import { Impossible, Ambiguous, solveRelations } from './lab_engine.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const EPS = 1e-9;

export const LINEAR_KEYS = ['u', 'v', 's', 't', 'a'];

export const LINEAR_META = {
  u: { label: 'Initial velocity', unit: 'm/s', symbol: 'v_i', sample: 5 },
  v: { label: 'Final velocity', unit: 'm/s', symbol: 'v_f', sample: 11 },
  s: { label: 'Displacement', unit: 'm', symbol: 'Δx', sample: 24 },
  t: { label: 'Time', unit: 's', symbol: 't', min: 0, sample: 3 },
  a: { label: 'Acceleration', unit: 'm/s²', symbol: 'a', sample: 2 },
};

function require(values, key) {
  if (!isNum(values[key])) throw new Impossible(`${LINEAR_META[key].label} is needed.`);
  return values[key];
}

function nonZero(value, key, relation) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(`${LINEAR_META[key].label} is zero in ${relation}.`);
  }
  return value;
}

function result(value, expr, sub, extra = {}) {
  return { value, expr, sub, ...extra };
}

export const LINEAR_RELATIONS = [
  {
    id: 'L1',
    name: 'Velocity–time',
    formula: 'v_f = v_i + a·t',
    vars: ['v', 'u', 'a', 't'],
    residual: (x) => x.v - (x.u + x.a * x.t),
    scale: (x) => Math.max(1, Math.abs(x.v), Math.abs(x.u), Math.abs(x.a * x.t)),
    solveFor: {
      v: (x) => result(x.u + x.a * x.t, 'v_i + a·t', `${fmt(x.u)} + ${fmt(x.a)}×${fmt(x.t)}`),
      u: (x) => result(x.v - x.a * x.t, 'v_f − a·t', `${fmt(x.v)} − ${fmt(x.a)}×${fmt(x.t)}`),
      a: (x) => {
        const t = nonZero(require(x, 't'), 't', 'v_f = v_i + a·t');
        return result((x.v - x.u) / t, '(v_f − v_i)/t', `(${fmt(x.v)} − ${fmt(x.u)})/${fmt(t)}`);
      },
      t: (x) => {
        if (Math.abs(x.a) <= EPS) {
          if (Math.abs(x.v - x.u) <= EPS) throw new Ambiguous('Time is not determined when speed does not change.');
          throw new Impossible('The speed changes but acceleration is zero.');
        }
        return result((x.v - x.u) / x.a, '(v_f − v_i)/a', `(${fmt(x.v)} − ${fmt(x.u)})/${fmt(x.a)}`);
      },
    },
  },
  {
    id: 'L4',
    name: 'Average velocity',
    formula: 'Δx = ½·(v_i + v_f)·t',
    vars: ['s', 'u', 'v', 't'],
    residual: (x) => x.s - 0.5 * (x.u + x.v) * x.t,
    scale: (x) => Math.max(1, Math.abs(x.s), Math.abs(0.5 * (x.u + x.v) * x.t)),
    solveFor: {
      s: (x) => result(0.5 * (x.u + x.v) * x.t, '½(v_i + v_f)t',
        `0.5×(${fmt(x.u)} + ${fmt(x.v)})×${fmt(x.t)}`),
      u: (x) => {
        const t = nonZero(require(x, 't'), 't', 'Δx = ½(v_i + v_f)t');
        return result((2 * x.s) / t - x.v, '2Δx/t − v_f', `2×${fmt(x.s)}/${fmt(t)} − ${fmt(x.v)}`);
      },
      v: (x) => {
        const t = nonZero(require(x, 't'), 't', 'Δx = ½(v_i + v_f)t');
        return result((2 * x.s) / t - x.u, '2Δx/t − v_i', `2×${fmt(x.s)}/${fmt(t)} − ${fmt(x.u)}`);
      },
      t: (x) => {
        const sum = x.u + x.v;
        if (Math.abs(sum) <= EPS) {
          if (Math.abs(x.s) <= EPS) throw new Ambiguous('Time is not determined when v_i + v_f = 0.');
          throw new Impossible('v_i + v_f is zero, so that displacement needs infinite time.');
        }
        return result((2 * x.s) / sum, '2Δx/(v_i + v_f)',
          `2×${fmt(x.s)}/(${fmt(x.u)} + ${fmt(x.v)})`);
      },
    },
  },
  {
    id: 'L3',
    name: 'Displacement–time',
    formula: 'Δx = v_i·t + ½·a·t²',
    vars: ['s', 'u', 'a', 't'],
    residual: (x) => x.s - (x.u * x.t + 0.5 * x.a * x.t * x.t),
    scale: (x) => Math.max(1, Math.abs(x.s), Math.abs(x.u * x.t), Math.abs(0.5 * x.a * x.t * x.t)),
    solveFor: {
      s: (x) => result(x.u * x.t + 0.5 * x.a * x.t * x.t, 'v_i·t + ½a t²',
        `${fmt(x.u)}×${fmt(x.t)} + 0.5×${fmt(x.a)}×${fmt(x.t)}²`),
      u: (x) => {
        const t = nonZero(require(x, 't'), 't', 'Δx = v_i t + ½a t²');
        return result(x.s / t - 0.5 * x.a * t, 'Δx/t − ½a t',
          `${fmt(x.s)}/${fmt(t)} − 0.5×${fmt(x.a)}×${fmt(t)}`);
      },
      a: (x) => {
        const t = nonZero(require(x, 't'), 't', 'Δx = v_i t + ½a t²');
        return result((2 * (x.s - x.u * t)) / (t * t), '2(Δx − v_i t)/t²',
          `2(${fmt(x.s)} − ${fmt(x.u)}×${fmt(t)})/${fmt(t)}²`);
      },
      t: (x) => {
        if (Math.abs(x.a) <= EPS) {
          const u = nonZero(require(x, 'u'), 'u', 'Δx = v_i t (a = 0)');
          return result(x.s / u, 'Δx/v_i', `${fmt(x.s)}/${fmt(u)}`,
            { note: 'a = 0, so the motion is at constant speed.' });
        }
        const disc = x.u * x.u + 2 * x.a * x.s;
        if (disc < 0) throw new Impossible('No real time satisfies Δx = v_i t + ½a t².',
          'Try a bigger speed or a smaller distance.');
        const root = Math.sqrt(disc);
        const roots = [(-x.u + root) / x.a, (-x.u - root) / x.a]
          .filter((value) => isNum(value) && value >= -EPS);
        if (!roots.length) throw new Impossible('No positive time satisfies Δx = v_i t + ½a t².',
          'Try a bigger speed or a smaller distance.');
        roots.sort((left, right) => left - right);
        return result(roots[0], '(−v_i ± √(v_i² + 2aΔx))/a',
          `(−${fmt(x.u)} ± √(${fmt(x.u)}² + 2×${fmt(x.a)}×${fmt(x.s)}))/${fmt(x.a)}`,
          { others: roots.slice(1), note: roots.length > 1
            ? `Also valid: t = ${fmt(roots[1])} s, the later return past that point.` : '' });
      },
    },
  },
  {
    id: 'L2',
    name: 'Velocity–displacement',
    formula: 'v_f² = v_i² + 2·a·Δx',
    vars: ['v', 'u', 'a', 's'],
    residual: (x) => x.v * x.v - (x.u * x.u + 2 * x.a * x.s),
    scale: (x) => Math.max(1, x.v * x.v, x.u * x.u, Math.abs(2 * x.a * x.s)),
    solveFor: {
      v: (x) => {
        const inside = x.u * x.u + 2 * x.a * x.s;
        if (inside < 0) throw new Impossible('No real final velocity satisfies v_f² = v_i² + 2aΔx.');
        const root = Math.sqrt(inside);
        // Follow the direction of travel when the time is available; otherwise
        // keep the sign of v_i.
        let sign = Math.sign(x.u) || 1;
        if (isNum(x.t)) sign = Math.sign(x.u + x.a * x.t) || sign;
        return result(root * sign, '±√(v_i² + 2aΔx)',
          `±√(${fmt(x.u)}² + 2×${fmt(x.a)}×${fmt(x.s)})`,
          { note: `The other root is v_f = ${fmt(-root * sign)} m/s (moving the other way).` });
      },
      u: (x) => {
        const inside = x.v * x.v - 2 * x.a * x.s;
        if (inside < 0) throw new Impossible('No real initial velocity satisfies v_f² = v_i² + 2aΔx.');
        const sign = Math.sign(x.v) || 1;
        return result(Math.sqrt(inside) * sign, '±√(v_f² − 2aΔx)',
          `±√(${fmt(x.v)}² − 2×${fmt(x.a)}×${fmt(x.s)})`);
      },
      a: (x) => {
        const s = nonZero(require(x, 's'), 's', 'v_f² = v_i² + 2aΔx');
        return result((x.v * x.v - x.u * x.u) / (2 * s), '(v_f² − v_i²)/(2Δx)',
          `(${fmt(x.v)}² − ${fmt(x.u)}²)/(2×${fmt(s)})`);
      },
      s: (x) => {
        if (Math.abs(x.a) <= EPS) {
          if (Math.abs(x.v - x.u) <= EPS) throw new Ambiguous('Displacement is not determined when speed does not change.');
          throw new Impossible('The speed changes but acceleration is zero.');
        }
        return result((x.v * x.v - x.u * x.u) / (2 * x.a), '(v_f² − v_i²)/(2a)',
          `(${fmt(x.v)}² − ${fmt(x.u)}²)/(2×${fmt(x.a)})`);
      },
    },
  },
];

export function solveLinear({
  known = {},
  fixed = {},
  editedKey = null,
  meta = LINEAR_META,
  focusKey = null,
  constantSpeed = false,
  gravity = null,
} = {}) {
  const typed = {};
  for (const [key, raw] of Object.entries(known)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) typed[key] = value;
  }
  const locked = {};
  for (const [key, raw] of Object.entries(fixed)) {
    const value = typeof raw === 'object' && raw !== null ? raw.value : raw;
    if (!Number.isFinite(Number(value))) continue;
    locked[key] = typeof raw === 'object' && raw !== null
      ? raw : { value: Number(value), caption: 'Set by the mode' };
  }
  if (constantSpeed && !Number.isFinite(locked.a && locked.a.value)) {
    locked.a = { value: 0, caption: 'Set by Constant speed' };
  }
  const keys = [...LINEAR_KEYS];
  const relations = [...LINEAR_RELATIONS];
  const samples = Object.fromEntries(LINEAR_KEYS.map((key) => [key, LINEAR_META[key].sample]));
  const effectiveMeta = { ...meta };
  if (Number.isFinite(gravity)) {
    keys.push('g');
    if (Number.isFinite(typed.g)) {
      samples.g = typed.g;
    } else {
      typed.g = gravity;
      locked.g = { value: gravity, caption: 'Set by the Gravity setting' };
      samples.g = gravity;
    }
    effectiveMeta.g = meta.g || { label: 'Gravity', unit: 'm/s²', symbol: 'g' };
    relations.push({
      id: 'FF-G',
      name: 'Free-fall acceleration',
      formula: 'a = −g',
      vars: ['a', 'g'],
      residual: (v) => v.a + v.g,
      scale: (v) => Math.max(1, Math.abs(v.a), Math.abs(v.g)),
      solveFor: {
        a: (v) => ({ value: -v.g, expr: '−g', sub: `−${fmt(v.g)}` }),
        g: (v) => ({ value: -v.a, expr: '−a', sub: `−(${fmt(v.a)})` }),
      },
    });
  }

  const result = solveRelations({
    keys,
    relations,
    typed,
    locked,
    soft: [],
    goal: LINEAR_KEYS,
    candidateKeys: LINEAR_KEYS,
    meta: effectiveMeta,
    samples,
    editedKey,
    focusKey,
    relTol: 1e-6,
    roundedTol: 0.005,
  });
  result.meta = effectiveMeta;
  const knownCore = LINEAR_KEYS.filter((key) => (
    result.sources[key] === 'known' || result.sources[key] === 'locked')).length;
  const targetCount = result.sources.a === 'locked' ? 2 : 3;
  result.needed = Math.max(1, targetCount - knownCore);
  return result;
}

/** Derived quantities that are not part of the five-variable core. */
export function addLinearExtras(solution, modeId = 'straight') {
  const values = solution.values;
  const sources = solution.sources;
  if (modeId === 'freefall') {
    values.h = values.s;
    sources.h = sources.s;
    values.displacement = values.s;
    sources.displacement = sources.s;
    values.distance = isNum(values.s) ? Math.abs(values.s) : null;
    sources.distance = isNum(values.s) ? 'solved' : 'missing';
    const g = Math.abs(values.a);
    if (isNum(values.u) && isNum(g) && g > 0) {
      values.maxHeight = values.u > 0 ? (values.u * values.u) / (2 * g) : 0;
      values.tApex = values.u > 0 ? values.u / g : 0;
      sources.maxHeight = 'solved';
      sources.tApex = 'solved';
    }
  } else if (modeId === 'straight') {
    values.displacement = values.s;
    sources.displacement = sources.s;
    values.distance = isNum(values.s) ? Math.abs(values.s) : null;
    sources.distance = isNum(values.s) ? 'solved' : 'missing';
  }
  if (isNum(values.s) && isNum(values.t) && values.t > 0) {
    values.avgSpeed = Math.abs(values.s) / values.t;
    values.avgVelocity = values.s / values.t;
    sources.avgSpeed = 'solved';
    sources.avgVelocity = 'solved';
  }
  solution.values = values;
  solution.sources = sources;
  return solution;
}
