// Rotational Motion on the shared relation engine.
//
//   ω_f = ω_i + α t
//   θ = ω_i t + ½ α t²
//   ω_f² = ω_i² + 2 α θ
//   θ = ½ (ω_i + ω_f) t
//   revolutions = θ/2π,  rpm = ω·60/2π
//   v_t = rω,  a_t = rα,  a_c = ω²r,  s = rθ
//
// A typed rpm or revolution count is a first-class known: it chains into the
// kinematic relations in both directions.

import { fmt } from './lab_solver.js';
import { Impossible, Ambiguous, solveRelations } from './lab_engine.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const EPS = 1e-9;

export const ROTATIONAL_KEYS = [
  'w0', 'w', 'alpha', 't', 'theta', 'revolutions', 'rpm',
  'r', 'v', 'at', 'ac', 'distance',
];

export const ROTATIONAL_META = {
  w0: { label: 'Initial angular velocity', unit: 'rad/s', symbol: 'ω_i', sample: 4 },
  w: { label: 'Final angular velocity', unit: 'rad/s', symbol: 'ω_f', sample: 20 },
  alpha: { label: 'Angular acceleration', unit: 'rad/s²', symbol: 'α', sample: 2 },
  t: { label: 'Time', unit: 's', symbol: 't', min: 0, sample: 8 },
  theta: { label: 'Angular displacement', unit: 'rad', symbol: 'θ', sample: 96 },
  revolutions: { label: 'Revolutions', unit: 'rev', symbol: 'N', sample: 9 },
  rpm: { label: 'Revolutions per minute', unit: 'rpm', symbol: 'rpm', sample: 60 },
  r: { label: 'Radius', unit: 'm', symbol: 'r', min: 0, sample: 0.35 },
  v: { label: 'Tangential speed', unit: 'm/s', symbol: 'v_t', sample: 3.5 },
  at: { label: 'Tangential acceleration', unit: 'm/s²', symbol: 'a_t', sample: 0.7 },
  ac: { label: 'Centripetal acceleration', unit: 'm/s²', symbol: 'a_c', sample: 24 },
  distance: { label: 'Arc length', unit: 'm', symbol: 's', min: 0, sample: 21 },
};

function require(values, key) {
  if (!isNum(values[key])) throw new Impossible(`${ROTATIONAL_META[key].label} is needed.`);
  return values[key];
}

function nonZero(value, key, relation) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(`${ROTATIONAL_META[key].label} is zero in ${relation}.`);
  }
  return value;
}

function result(value, expr, sub, extra = {}) {
  return { value, expr, sub, ...extra };
}

export const ROTATIONAL_RELATIONS = [
  {
    id: 'R1',
    name: 'Angular velocity–time',
    formula: 'ω_f = ω_i + α·t',
    vars: ['w', 'w0', 'alpha', 't'],
    residual: (v) => v.w - (v.w0 + v.alpha * v.t),
    scale: (v) => Math.max(1, Math.abs(v.w), Math.abs(v.w0), Math.abs(v.alpha * v.t)),
    solveFor: {
      w: (v) => result(v.w0 + v.alpha * v.t, 'ω_i + α·t', `${fmt(v.w0)} + ${fmt(v.alpha)}×${fmt(v.t)}`),
      w0: (v) => result(v.w - v.alpha * v.t, 'ω_f − α·t', `${fmt(v.w)} − ${fmt(v.alpha)}×${fmt(v.t)}`),
      alpha: (v) => {
        const t = nonZero(require(v, 't'), 't', 'ω_f = ω_i + α t');
        return result((v.w - v.w0) / t, '(ω_f − ω_i)/t', `(${fmt(v.w)} − ${fmt(v.w0)})/${fmt(t)}`);
      },
      t: (v) => {
        if (Math.abs(v.alpha) <= EPS) {
          if (Math.abs(v.w - v.w0) <= EPS) throw new Ambiguous('Time is not determined when ω does not change.');
          throw new Impossible('Angular velocity changes but α is zero.');
        }
        return result((v.w - v.w0) / v.alpha, '(ω_f − ω_i)/α',
          `(${fmt(v.w)} − ${fmt(v.w0)})/${fmt(v.alpha)}`);
      },
    },
  },
  {
    id: 'R4',
    name: 'Average angular velocity',
    formula: 'θ = ½·(ω_i + ω_f)·t',
    vars: ['theta', 'w0', 'w', 't'],
    residual: (v) => v.theta - 0.5 * (v.w0 + v.w) * v.t,
    scale: (v) => Math.max(1, Math.abs(v.theta), Math.abs(0.5 * (v.w0 + v.w) * v.t)),
    solveFor: {
      theta: (v) => result(0.5 * (v.w0 + v.w) * v.t, '½(ω_i + ω_f)t',
        `0.5×(${fmt(v.w0)} + ${fmt(v.w)})×${fmt(v.t)}`),
      w0: (v) => {
        const t = nonZero(require(v, 't'), 't', 'θ = ½(ω_i + ω_f)t');
        return result((2 * v.theta) / t - v.w, '2θ/t − ω_f',
          `2×${fmt(v.theta)}/${fmt(t)} − ${fmt(v.w)}`);
      },
      w: (v) => {
        const t = nonZero(require(v, 't'), 't', 'θ = ½(ω_i + ω_f)t');
        return result((2 * v.theta) / t - v.w0, '2θ/t − ω_i',
          `2×${fmt(v.theta)}/${fmt(t)} − ${fmt(v.w0)}`);
      },
      t: (v) => {
        const sum = v.w0 + v.w;
        if (Math.abs(sum) <= EPS) {
          if (Math.abs(v.theta) <= EPS) throw new Ambiguous('Time is not determined when ω_i + ω_f = 0.');
          throw new Impossible('ω_i + ω_f is zero, so that angle needs infinite time.');
        }
        return result((2 * v.theta) / sum, '2θ/(ω_i + ω_f)',
          `2×${fmt(v.theta)}/(${fmt(v.w0)} + ${fmt(v.w)})`);
      },
    },
  },
  {
    id: 'R2',
    name: 'Angle–time',
    formula: 'θ = ω_i·t + ½·α·t²',
    vars: ['theta', 'w0', 'alpha', 't'],
    residual: (v) => v.theta - (v.w0 * v.t + 0.5 * v.alpha * v.t * v.t),
    scale: (v) => Math.max(1, Math.abs(v.theta), Math.abs(v.w0 * v.t),
      Math.abs(0.5 * v.alpha * v.t * v.t)),
    solveFor: {
      theta: (v) => result(v.w0 * v.t + 0.5 * v.alpha * v.t * v.t, 'ω_i t + ½αt²',
        `${fmt(v.w0)}×${fmt(v.t)} + 0.5×${fmt(v.alpha)}×${fmt(v.t)}²`),
      w0: (v) => {
        const t = nonZero(require(v, 't'), 't', 'θ = ω_i t + ½αt²');
        return result(v.theta / t - 0.5 * v.alpha * t, 'θ/t − ½αt',
          `${fmt(v.theta)}/${fmt(t)} − 0.5×${fmt(v.alpha)}×${fmt(t)}`);
      },
      alpha: (v) => {
        const t = nonZero(require(v, 't'), 't', 'θ = ω_i t + ½αt²');
        return result((2 * (v.theta - v.w0 * t)) / (t * t), '2(θ − ω_i t)/t²',
          `2(${fmt(v.theta)} − ${fmt(v.w0)}×${fmt(t)})/${fmt(t)}²`);
      },
      t: (v) => {
        if (Math.abs(v.alpha) <= EPS) {
          const w0 = nonZero(require(v, 'w0'), 'w0', 'θ = ω_i t (α = 0)');
          return result(v.theta / w0, 'θ/ω_i', `${fmt(v.theta)}/${fmt(w0)}`,
            { note: 'α = 0, so the rotation is at constant angular speed.' });
        }
        const disc = v.w0 * v.w0 + 2 * v.alpha * v.theta;
        if (disc < 0) throw new Impossible('No real time satisfies θ = ω_i t + ½αt².');
        const root = Math.sqrt(disc);
        const roots = [(-v.w0 + root) / v.alpha, (-v.w0 - root) / v.alpha]
          .filter((value) => isNum(value) && value >= -EPS).sort((left, right) => left - right);
        if (!roots.length) throw new Impossible('No positive time satisfies θ = ω_i t + ½αt².');
        return result(roots[0], '(−ω_i ± √(ω_i² + 2αθ))/α',
          `(−${fmt(v.w0)} ± √(${fmt(v.w0)}² + 2×${fmt(v.alpha)}×${fmt(v.theta)}))/${fmt(v.alpha)}`,
          { others: roots.slice(1), note: roots.length > 1
            ? `Also valid: t = ${fmt(roots[1])} s.` : '' });
      },
    },
  },
  {
    id: 'R3',
    name: 'Angular velocity–angle',
    formula: 'ω_f² = ω_i² + 2·α·θ',
    vars: ['w', 'w0', 'alpha', 'theta'],
    residual: (v) => v.w * v.w - (v.w0 * v.w0 + 2 * v.alpha * v.theta),
    scale: (v) => Math.max(1, v.w * v.w, v.w0 * v.w0, Math.abs(2 * v.alpha * v.theta)),
    solveFor: {
      w: (v) => {
        const inside = v.w0 * v.w0 + 2 * v.alpha * v.theta;
        if (inside < 0) throw new Impossible('No real final angular velocity.');
        return result(Math.sqrt(inside), '√(ω_i² + 2αθ)',
          `√(${fmt(v.w0)}² + 2×${fmt(v.alpha)}×${fmt(v.theta)})`);
      },
      w0: (v) => {
        const inside = v.w * v.w - 2 * v.alpha * v.theta;
        if (inside < 0) throw new Impossible('No real initial angular velocity.');
        return result(Math.sqrt(inside), '√(ω_f² − 2αθ)',
          `√(${fmt(v.w)}² − 2×${fmt(v.alpha)}×${fmt(v.theta)})`);
      },
      alpha: (v) => {
        const theta = nonZero(require(v, 'theta'), 'theta', 'ω_f² = ω_i² + 2αθ');
        return result((v.w * v.w - v.w0 * v.w0) / (2 * theta), '(ω_f² − ω_i²)/(2θ)',
          `(${fmt(v.w)}² − ${fmt(v.w0)}²)/(2×${fmt(theta)})`);
      },
      theta: (v) => {
        if (Math.abs(v.alpha) <= EPS) {
          if (Math.abs(v.w - v.w0) <= EPS) throw new Ambiguous('Angle is not determined when ω does not change.');
          throw new Impossible('Angular velocity changes but α is zero.');
        }
        return result((v.w * v.w - v.w0 * v.w0) / (2 * v.alpha), '(ω_f² − ω_i²)/(2α)',
          `(${fmt(v.w)}² − ${fmt(v.w0)}²)/(2×${fmt(v.alpha)})`);
      },
    },
  },
  {
    id: 'R5',
    name: 'Revolutions',
    formula: 'revolutions = θ/2π',
    vars: ['revolutions', 'theta'],
    residual: (v) => v.revolutions - v.theta / (2 * Math.PI),
    scale: (v) => Math.max(1, Math.abs(v.revolutions), Math.abs(v.theta / (2 * Math.PI))),
    solveFor: {
      revolutions: (v) => result(v.theta / (2 * Math.PI), 'θ/2π', `${fmt(v.theta)}/2π`),
      theta: (v) => result(v.revolutions * 2 * Math.PI, 'rev·2π', `${fmt(v.revolutions)}×2π`),
    },
  },
  {
    id: 'R6',
    name: 'rpm',
    formula: 'rpm = ω·60/2π',
    vars: ['rpm', 'w'],
    residual: (v) => v.rpm - (v.w * 60) / (2 * Math.PI),
    scale: (v) => Math.max(1, Math.abs(v.rpm), Math.abs((v.w * 60) / (2 * Math.PI))),
    solveFor: {
      rpm: (v) => result((v.w * 60) / (2 * Math.PI), 'ω×60/2π', `${fmt(v.w)}×60/2π`),
      w: (v) => result((v.rpm * 2 * Math.PI) / 60, 'rpm×2π/60', `${fmt(v.rpm)}×2π/60`),
    },
  },
  {
    id: 'R7',
    name: 'Tangential speed',
    formula: 'v_t = r·ω',
    vars: ['v', 'r', 'w'],
    residual: (v) => v.v - v.r * v.w,
    scale: (v) => Math.max(1, Math.abs(v.v), Math.abs(v.r * v.w)),
    solveFor: {
      v: (v) => result(v.r * v.w, 'r·ω', `${fmt(v.r)}×${fmt(v.w)}`),
      r: (v) => {
        const w = nonZero(require(v, 'w'), 'w', 'v_t = rω');
        return result(v.v / w, 'v_t/ω', `${fmt(v.v)}/${fmt(w)}`);
      },
      w: (v) => {
        const r = nonZero(require(v, 'r'), 'r', 'v_t = rω');
        return result(v.v / r, 'v_t/r', `${fmt(v.v)}/${fmt(r)}`);
      },
    },
  },
  {
    id: 'R8',
    name: 'Tangential acceleration',
    formula: 'a_t = r·α',
    vars: ['at', 'r', 'alpha'],
    residual: (v) => v.at - v.r * v.alpha,
    scale: (v) => Math.max(1, Math.abs(v.at), Math.abs(v.r * v.alpha)),
    solveFor: {
      at: (v) => result(v.r * v.alpha, 'r·α', `${fmt(v.r)}×${fmt(v.alpha)}`),
      r: (v) => {
        const alpha = nonZero(require(v, 'alpha'), 'alpha', 'a_t = rα');
        return result(v.at / alpha, 'a_t/α', `${fmt(v.at)}/${fmt(alpha)}`);
      },
      alpha: (v) => {
        const r = nonZero(require(v, 'r'), 'r', 'a_t = rα');
        return result(v.at / r, 'a_t/r', `${fmt(v.at)}/${fmt(r)}`);
      },
    },
  },
  {
    id: 'R9',
    name: 'Centripetal acceleration',
    formula: 'a_c = ω²·r',
    vars: ['ac', 'w', 'r'],
    residual: (v) => v.ac - v.w * v.w * v.r,
    scale: (v) => Math.max(1, Math.abs(v.ac), Math.abs(v.w * v.w * v.r)),
    solveFor: {
      ac: (v) => result(v.w * v.w * v.r, 'ω²·r', `${fmt(v.w)}²×${fmt(v.r)}`),
      w: (v) => {
        const r = nonZero(require(v, 'r'), 'r', 'a_c = ω²r');
        if (v.ac / r < 0) throw new Impossible('Centripetal acceleration cannot be negative for this radius.');
        return result(Math.sqrt(v.ac / r), '√(a_c/r)', `√(${fmt(v.ac)}/${fmt(r)})`);
      },
      r: (v) => {
        const w = nonZero(require(v, 'w'), 'w', 'a_c = ω²r');
        return result(v.ac / (w * w), 'a_c/ω²', `${fmt(v.ac)}/${fmt(w)}²`);
      },
    },
  },
  {
    id: 'R11',
    name: 'Centripetal acceleration from speed',
    formula: 'a_c = v_t²/r',
    vars: ['ac', 'v', 'r'],
    residual: (v) => v.ac - (v.v * v.v) / (Math.abs(v.r) < 1e-12 ? 1e-12 : v.r),
    scale: (v) => Math.max(1, Math.abs(v.ac), Math.abs((v.v * v.v) / (Math.abs(v.r) < 1e-12 ? 1e-12 : v.r))),
    solveFor: {
      ac: (v) => result((v.v * v.v) / nonZero(require(v, 'r'), 'r', 'a_c = v²/r'),
        'v_t²/r', `${fmt(v.v)}²/${fmt(v.r)}`),
      v: (v) => {
        const inside = v.ac * v.r;
        if (inside < 0) throw new Impossible('Centripetal acceleration and radius cannot give a real speed.');
        return result(Math.sqrt(inside), '√(a_c·r)', `√(${fmt(v.ac)}×${fmt(v.r)})`);
      },
      r: (v) => {
        const ac = nonZero(require(v, 'ac'), 'ac', 'a_c = v²/r');
        return result((v.v * v.v) / ac, 'v_t²/a_c', `${fmt(v.v)}²/${fmt(ac)}`);
      },
    },
  },
  {
    id: 'R10',
    name: 'Rolling distance',
    formula: 's = r·θ',
    vars: ['distance', 'r', 'theta'],
    residual: (v) => v.distance - v.r * v.theta,
    scale: (v) => Math.max(1, Math.abs(v.distance), Math.abs(v.r * v.theta)),
    solveFor: {
      distance: (v) => result(v.r * v.theta, 'r·θ', `${fmt(v.r)}×${fmt(v.theta)}`),
      r: (v) => {
        const theta = nonZero(require(v, 'theta'), 'theta', 's = rθ');
        return result(v.distance / theta, 's/θ', `${fmt(v.distance)}/${fmt(theta)}`);
      },
      theta: (v) => {
        const r = nonZero(require(v, 'r'), 'r', 's = rθ');
        return result(v.distance / r, 's/r', `${fmt(v.distance)}/${fmt(r)}`);
      },
    },
  },
];

export const ROTATIONAL_CORE = ['w0', 'w', 'alpha', 't', 'theta', 'revolutions', 'rpm'];

export function solveRotational({
  known = {},
  editedKey = null,
  meta = ROTATIONAL_META,
  constantSpeed = false,
  focusKey = null,
} = {}) {
  const typed = {};
  for (const [key, raw] of Object.entries(known)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) typed[key] = value;
  }
  const locked = constantSpeed
    ? { alpha: { value: 0, caption: 'Set by Constant speed' } }
    : {};
  const result = solveRelations({
    keys: ROTATIONAL_KEYS,
    relations: ROTATIONAL_RELATIONS,
    typed,
    locked,
    soft: [],
    goal: ROTATIONAL_CORE,
    candidateKeys: ROTATIONAL_KEYS,
    meta,
    samples: Object.fromEntries(ROTATIONAL_KEYS.map((key) => [key, ROTATIONAL_META[key].sample])),
    editedKey,
    focusKey,
    blameOrder: ['t', 'theta', 'w', 'w0', 'alpha'],
    pick: (key, candidates) => {
      if (key === 't') return [...candidates].sort((a, b) => a - b)[0];
      return candidates[0];
    },
  });
  result.meta = meta;
  return result;
}
