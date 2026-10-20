// Torque on the shared relation engine.
//
//   τ = r F sin θ,  τ = F d,  τ = r F⊥,  d = r sin θ
//   F⊥ = F sin θ,  F∥ = F cos θ (no torque)
//   τ_net = Σ signed torques (CCW +),  τ_net = I α
//   seesaw balance: m1 g r1 = m2 g r2
//
// A force list with several CW/CCW entries still works exactly as before: the
// wrapper computes each entry's signed torque and hands the net to the engine.

import { fmt } from './lab_solver.js';
import { Impossible, solveRelations } from './lab_engine.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const EPS = 1e-9;
const rad = (degrees) => (degrees * Math.PI) / 180;

export const TORQUE_KEYS = [
  'F', 'r', 'angle', 'torque', 'Fperp', 'Fpar', 'leverArm',
  'I', 'alpha', 'netTorque', 'm1', 'r1', 'm2', 'r2',
];

export const TORQUE_META = {
  F: { label: 'Force', unit: 'N', symbol: 'F', min: 0, sample: 100 },
  r: { label: 'Lever arm', unit: 'm', symbol: 'r', min: 0, sample: 0.2 },
  angle: { label: 'Angle between F and r', unit: 'deg', symbol: 'θ', sample: 90 },
  torque: { label: 'Torque', unit: 'N·m', symbol: 'τ', sample: 20 },
  Fperp: { label: 'Perpendicular force', unit: 'N', symbol: 'F⊥', sample: 100 },
  Fpar: { label: 'Parallel force', unit: 'N', symbol: 'F∥', sample: 0 },
  leverArm: { label: 'Lever arm distance', unit: 'm', symbol: 'd', sample: 0.2 },
  I: { label: 'Moment of inertia', unit: 'kg·m²', symbol: 'I', min: 0, sample: 5 },
  alpha: { label: 'Angular acceleration', unit: 'rad/s²', symbol: 'α', sample: 4 },
  netTorque: { label: 'Net torque', unit: 'N·m', symbol: 'τ_net', sample: 20 },
  m1: { label: 'Mass 1', unit: 'kg', symbol: 'm_1', min: 0, sample: 90 },
  r1: { label: 'Lever arm 1', unit: 'm', symbol: 'r_1', min: 0, sample: 0.5 },
  m2: { label: 'Mass 2', unit: 'kg', symbol: 'm_2', min: 0, sample: 30 },
  r2: { label: 'Lever arm 2', unit: 'm', symbol: 'r_2', min: 0, sample: 1.5 },
};

export function signedDirection(direction) {
  if (direction === 'cw' || direction === -1 || direction === '-1'
      || direction === 'clockwise') return -1;
  return 1;
}

export function torqueOf(force) {
  if (!force) return null;
  const F = Number(force.F);
  const r = Number(force.r);
  const angle = Number(force.angle);
  if (![F, r, angle].every(Number.isFinite)) return null;
  return r * F * Math.sin(rad(angle)) * signedDirection(force.direction);
}

export function netTorqueOf(forces = []) {
  const list = forces.map(torqueOf).filter((value) => isNum(value));
  if (!list.length) return null;
  return list.reduce((total, value) => total + value, 0);
}

export function seesawBalanceDistance(m1, r1, m2) {
  if (![m1, r1, m2].every(Number.isFinite) || Math.abs(m2) < 1e-12) return null;
  return (m1 * r1) / m2;
}

function require(values, key) {
  if (!isNum(values[key])) throw new Impossible(`${TORQUE_META[key].label} is needed.`);
  return values[key];
}

function nonZero(value, key, relation) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(`${TORQUE_META[key].label} is zero in ${relation}.`);
  }
  return value;
}

function result(value, expr, sub, extra = {}) {
  return { value, expr, sub, ...extra };
}

export const TORQUE_RELATIONS = [
  {
    id: 'T1',
    name: 'Torque',
    formula: 'τ = r·F·sin θ',
    vars: ['torque', 'F', 'r', 'angle'],
    residual: (v) => v.torque - v.dirSign * v.r * v.F * Math.sin(rad(v.angle)),
    scale: (v) => Math.max(1, Math.abs(v.torque), Math.abs(v.r * v.F)),
    solveFor: {
      torque: (v) => result(v.dirSign * v.r * v.F * Math.sin(rad(v.angle)),
        'r·F·sin θ', `${fmt(v.r)}×${fmt(v.F)}×sin(${fmt(v.angle)}°)`),
      F: (v) => {
        const denominator = nonZero(v.r * Math.sin(rad(v.angle)), 'r', 'τ = r F sin θ');
        return result(v.torque / (v.dirSign * denominator), 'τ/(r sin θ)',
          `${fmt(v.torque)}/(${fmt(v.r)}×sin(${fmt(v.angle)}°))`);
      },
      r: (v) => {
        const denominator = nonZero(v.F * Math.sin(rad(v.angle)), 'F', 'τ = r F sin θ');
        return result(v.torque / (v.dirSign * denominator), 'τ/(F sin θ)',
          `${fmt(v.torque)}/(${fmt(v.F)}×sin(${fmt(v.angle)}°))`);
      },
      angle: (v) => {
        const denominator = nonZero(v.r * v.F, 'r', 'τ = r F sin θ');
        const ratio = (v.torque / v.dirSign) / denominator;
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('Torque is larger than r·F.');
        const value = Math.asin(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI;
        const candidates = [value, 180 - value, -180 - value]
          .filter((candidate) => candidate >= -360 && candidate <= 360);
        return result(value, 'asin(τ/(rF))', `asin(${fmt(ratio)})`,
          { others: candidates.filter((candidate) => Math.abs(candidate - value) > 1e-7),
            note: 'A supplementary angle gives the same torque.' });
      },
    },
  },
  {
    id: 'T2',
    name: 'Perpendicular force',
    formula: 'F⊥ = F·sin θ',
    vars: ['Fperp', 'F', 'angle'],
    residual: (v) => v.Fperp - v.F * Math.sin(rad(v.angle)),
    scale: (v) => Math.max(1, Math.abs(v.Fperp), Math.abs(v.F)),
    solveFor: {
      Fperp: (v) => result(v.F * Math.sin(rad(v.angle)), 'F·sin θ',
        `${fmt(v.F)}×sin(${fmt(v.angle)}°)`),
      F: (v) => {
        const sine = Math.sin(rad(v.angle));
        if (Math.abs(sine) <= 1e-9) throw new Impossible('At this angle the perpendicular component is zero.');
        return result(v.Fperp / sine, 'F⊥/sin θ', `${fmt(v.Fperp)}/sin(${fmt(v.angle)}°)`);
      },
      angle: (v) => {
        if (Math.abs(v.F) <= EPS) throw new Impossible('Force is zero, so the angle is not determined.');
        const ratio = v.Fperp / v.F;
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('Perpendicular force cannot exceed the total force.');
        return result(Math.asin(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI,
          'asin(F⊥/F)', `asin(${fmt(ratio)})`);
      },
    },
  },
  {
    id: 'T3',
    name: 'Parallel force',
    formula: 'F∥ = F·cos θ',
    vars: ['Fpar', 'F', 'angle'],
    residual: (v) => v.Fpar - v.F * Math.cos(rad(v.angle)),
    scale: (v) => Math.max(1, Math.abs(v.Fpar), Math.abs(v.F)),
    solveFor: {
      Fpar: (v) => result(v.F * Math.cos(rad(v.angle)), 'F·cos θ',
        `${fmt(v.F)}×cos(${fmt(v.angle)}°)`),
      F: (v) => {
        const cosine = Math.cos(rad(v.angle));
        if (Math.abs(cosine) <= 1e-9) throw new Impossible('At this angle the parallel component is zero.');
        return result(v.Fpar / cosine, 'F∥/cos θ', `${fmt(v.Fpar)}/cos(${fmt(v.angle)}°)`);
      },
      angle: (v) => {
        if (Math.abs(v.F) <= EPS) throw new Impossible('Force is zero, so the angle is not determined.');
        const ratio = v.Fpar / v.F;
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('Parallel force cannot exceed the total force.');
        return result(Math.acos(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI,
          'acos(F∥/F)', `acos(${fmt(ratio)})`);
      },
    },
  },
  {
    id: 'T4',
    name: 'Lever arm distance',
    formula: 'd = r·sin θ',
    vars: ['leverArm', 'r', 'angle'],
    residual: (v) => v.leverArm - v.r * Math.sin(rad(v.angle)),
    scale: (v) => Math.max(1, Math.abs(v.leverArm), Math.abs(v.r)),
    solveFor: {
      leverArm: (v) => result(v.r * Math.sin(rad(v.angle)), 'r·sin θ',
        `${fmt(v.r)}×sin(${fmt(v.angle)}°)`),
      r: (v) => {
        const sine = Math.sin(rad(v.angle));
        if (Math.abs(sine) <= 1e-9) throw new Impossible('At this angle the lever arm distance is zero.');
        return result(v.leverArm / sine, 'd/sin θ', `${fmt(v.leverArm)}/sin(${fmt(v.angle)}°)`);
      },
      angle: (v) => {
        const ratio = v.leverArm / nonZero(require(v, 'r'), 'r', 'd = r sin θ');
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('Lever arm distance cannot exceed r.');
        return result(Math.asin(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI,
          'asin(d/r)', `asin(${fmt(ratio)})`);
      },
    },
  },
  {
    id: 'T5',
    name: 'Angular acceleration',
    formula: 'τ_net = I·α',
    vars: ['netTorque', 'I', 'alpha'],
    residual: (v) => v.netTorque - v.I * v.alpha,
    scale: (v) => Math.max(1, Math.abs(v.netTorque), Math.abs(v.I * v.alpha)),
    solveFor: {
      netTorque: (v) => result(v.I * v.alpha, 'I·α', `${fmt(v.I)}×${fmt(v.alpha)}`),
      I: (v) => {
        const alpha = nonZero(require(v, 'alpha'), 'alpha', 'τ_net = Iα');
        return result(v.netTorque / alpha, 'τ_net/α', `${fmt(v.netTorque)}/${fmt(alpha)}`);
      },
      alpha: (v) => {
        const I = nonZero(require(v, 'I'), 'I', 'τ_net = Iα');
        return result(v.netTorque / I, 'τ_net/I', `${fmt(v.netTorque)}/${fmt(I)}`);
      },
    },
  },
  {
    id: 'T6',
    name: 'Seesaw balance',
    formula: 'm_1·g·r_1 = m_2·g·r_2',
    vars: ['m1', 'r1', 'm2', 'r2'],
    residual: (v) => v.m1 * v.r1 - v.m2 * v.r2,
    scale: (v) => Math.max(1, Math.abs(v.m1 * v.r1), Math.abs(v.m2 * v.r2)),
    solveFor: {
      m1: (v) => {
        const r1 = nonZero(require(v, 'r1'), 'r1', 'm1 g r1 = m2 g r2');
        return result((v.m2 * v.r2) / r1, 'm2 r2 / r1', `${fmt(v.m2)}×${fmt(v.r2)}/${fmt(r1)}`);
      },
      r1: (v) => {
        const m1 = nonZero(require(v, 'm1'), 'm1', 'm1 g r1 = m2 g r2');
        return result((v.m2 * v.r2) / m1, 'm2 r2 / m1', `${fmt(v.m2)}×${fmt(v.r2)}/${fmt(m1)}`);
      },
      m2: (v) => {
        const r2 = nonZero(require(v, 'r2'), 'r2', 'm1 g r1 = m2 g r2');
        return result((v.m1 * v.r1) / r2, 'm1 r1 / r2', `${fmt(v.m1)}×${fmt(v.r1)}/${fmt(r2)}`);
      },
      r2: (v) => {
        const m2 = nonZero(require(v, 'm2'), 'm2', 'm1 g r1 = m2 g r2');
        return result((v.m1 * v.r1) / m2, 'm1 r1 / m2', `${fmt(v.m1)}×${fmt(v.r1)}/${fmt(m2)}`);
      },
    },
  },
];

const CORE_GOAL = ['F', 'r', 'angle', 'torque', 'Fperp', 'Fpar', 'leverArm', 'I', 'alpha', 'netTorque'];
const SEESAW_GOAL = ['m1', 'r1', 'm2', 'r2'];

export function solveTorque({
  known = {},
  forces = [],
  editedKey = null,
  meta = TORQUE_META,
  focusKey = null,
} = {}) {
  const list = (forces.length ? forces : [])
    .map((force) => ({
      F: Number.isFinite(Number(force.F)) && force.F !== null && force.F !== '' ? Number(force.F) : null,
      r: Number.isFinite(Number(force.r)) && force.r !== null && force.r !== '' ? Number(force.r) : null,
      angle: Number.isFinite(Number(force.angle)) && force.angle !== null && force.angle !== '' ? Number(force.angle) : null,
      direction: signedDirection(force.direction),
    }));
  const first = list[0] || null;

  const typed = {};
  for (const [key, raw] of Object.entries(known)) {
    if (key === 'direction') continue;
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) typed[key] = value;
  }
  if (first) {
    for (const key of ['F', 'r', 'angle']) {
      if (Number.isFinite(first[key]) && !Number.isFinite(typed[key])) typed[key] = first[key];
    }
  }

  const netFromForces = netTorqueOf(list);
  const locked = {};
  if (isNum(netFromForces)) {
    locked.netTorque = { value: netFromForces, caption: 'Set by the force list' };
  } else if (list.length <= 1 && isNum(typed.torque)) {
    locked.netTorque = { value: typed.torque, caption: 'Set by the single force' };
  }
  if (first) {
    locked.dirSign = {
      value: first.direction,
      caption: first.direction === -1 ? 'Set by Clockwise' : 'Set by Counterclockwise',
    };
    if (isNum(first.F) && isNum(first.r) && isNum(first.angle)) {
      const signed = torqueOf(first);
      if (isNum(signed) && !Number.isFinite(typed.torque)) {
        locked.torque = { value: signed, caption: 'Set by the force list' };
      }
    }
  } else {
    locked.dirSign = { value: 1, caption: 'Set by Counterclockwise' };
  }

  const seesawTyped = SEESAW_GOAL.some((key) => Number.isFinite(typed[key]));
  const forceTyped = ['F', 'r', 'angle', 'torque', 'Fperp', 'Fpar', 'leverArm']
    .some((key) => Number.isFinite(typed[key])) || list.length > 0;
  const dynamicsTyped = ['I', 'alpha', 'netTorque'].some((key) => Number.isFinite(typed[key]))
    || list.length > 1;
  let goal = CORE_GOAL;
  if (seesawTyped) {
    goal = SEESAW_GOAL;
  } else if (!dynamicsTyped && forceTyped) {
    goal = ['F', 'r', 'angle', 'torque', 'Fperp', 'Fpar', 'leverArm'];
  } else if (dynamicsTyped && !forceTyped) {
    goal = ['I', 'alpha', 'netTorque'];
  }
  const result = solveRelations({
    keys: [...TORQUE_KEYS, 'dirSign'],
    relations: TORQUE_RELATIONS,
    typed,
    locked,
    soft: [],
    goal,
    candidateKeys: [...CORE_GOAL, ...SEESAW_GOAL],
    meta: { ...meta, dirSign: { label: 'Direction sign', unit: '', symbol: '±1' } },
    samples: Object.fromEntries(TORQUE_KEYS.map((key) => [key, TORQUE_META[key].sample])),
    editedKey,
    focusKey,
    blameOrder: ['torque', 'netTorque', 'alpha', 'angle', 'r', 'F', 'I'],
    pick: (key, candidates) => {
      if (key === 'angle') return [...candidates].sort((a, b) => Math.abs(a) - Math.abs(b))[0];
      return candidates[0];
    },
  });

  // Preserve the established direction display.
  const dirSign = isNum(result.values.dirSign) ? result.values.dirSign : 1;
  result.values.direction = dirSign === -1 ? 'cw' : 'ccw';
  result.sources.direction = Number.isFinite(typed.direction) ? 'known' : 'solved';

  // Update each force's computed torque for the scene and net direction.
  for (const force of list) {
    const computed = torqueOf(force);
    if (isNum(computed)) force.torque = computed;
  }
  const net = isNum(result.values.netTorque) ? result.values.netTorque : netFromForces;
  result.forces = list;
  result.netDirection = isNum(net)
    ? (Math.abs(net) < 1e-9 ? 'balanced' : (net > 0 ? 'counterclockwise' : 'clockwise'))
    : '';
  result.equilibrium = isNum(net) && Math.abs(net) < 1e-9;
  result.seesaw = seesawTyped;
  result.meta = meta;
  return result;
}
