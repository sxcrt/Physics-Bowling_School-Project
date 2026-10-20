// Moment of inertia and angular momentum on the shared relation engine.
//
// Each shape has one definition object. The displayed formula and the compute
// relation are generated from the same coefficient, so they cannot drift:
//   disk  I = ½ M R²      ring  I = M R²
//   sphere I = ⅖ M R²     shell I = ⅔ M R²
//   rodEnd I = ⅓ M L²     rodCenter I = 1/12 M L²
//   point  I = m r²       custom I = Σ m r²
//
// L = Iω, conservation I1ω1 = I2ω2, and composite I_total = I_platform + mr².

import { fmt } from './lab_solver.js';
import { Impossible, solveRelations } from './lab_engine.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const EPS = 1e-9;

export const INERTIA_KEYS = ['M', 'R', 'L', 'I', 'w', 'Lm', 'I1', 'w1', 'I2', 'w2'];

export const INERTIA_META = {
  M: { label: 'Mass', unit: 'kg', symbol: 'M', min: 0, sample: 4 },
  R: { label: 'Radius', unit: 'm', symbol: 'R', min: 0, sample: 0.3 },
  L: { label: 'Length', unit: 'm', symbol: 'L', min: 0, sample: 2 },
  I: { label: 'Moment of inertia', unit: 'kg·m²', symbol: 'I', min: 0, sample: 0.18 },
  w: { label: 'Angular velocity', unit: 'rad/s', symbol: 'ω', sample: 12 },
  Lm: { label: 'Angular momentum', unit: 'kg·m²/s', symbol: 'L', sample: 1.5 },
  I1: { label: 'Initial moment of inertia', unit: 'kg·m²', symbol: 'I_1', min: 0, sample: 4 },
  w1: { label: 'Initial angular velocity', unit: 'rad/s', symbol: 'ω_1', sample: 2 },
  I2: { label: 'Final moment of inertia', unit: 'kg·m²', symbol: 'I_2', min: 0, sample: 1 },
  w2: { label: 'Final angular velocity', unit: 'rad/s', symbol: 'ω_2', sample: 8 },
};

export const SHAPES = [
  { id: 'disk', label: 'Solid disk / cylinder', formula: 'I = ½ M R²', coefficient: 0.5, uses: 'R' },
  { id: 'ring', label: 'Thin ring / hoop', formula: 'I = M R²', coefficient: 1, uses: 'R' },
  { id: 'sphere', label: 'Solid sphere', formula: 'I = ⅖ M R²', coefficient: 2 / 5, uses: 'R' },
  { id: 'shell', label: 'Spherical shell', formula: 'I = ⅔ M R²', coefficient: 2 / 3, uses: 'R' },
  { id: 'rodEnd', label: 'Rod about one end', formula: 'I = ⅓ M L²', coefficient: 1 / 3, uses: 'L' },
  { id: 'rodCenter', label: 'Rod about center', formula: 'I = 1/12 M L²', coefficient: 1 / 12, uses: 'L' },
  { id: 'point', label: 'Point mass', formula: 'I = m r²', coefficient: 1, uses: 'R' },
  { id: 'custom', label: 'Custom sum of m r²', formula: 'I = Σ m r²', coefficient: 1, uses: 'R' },
];

export const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((shape) => [shape.id, shape]));

export function shapeRelationFor(shapeId) {
  return shapeRelation(SHAPE_BY_ID[shapeId] || SHAPE_BY_ID.disk);
}

function require(values, key) {
  if (!isNum(values[key])) throw new Impossible(`${INERTIA_META[key].label} is needed.`);
  return values[key];
}

function nonZero(value, key, relation) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(`${INERTIA_META[key].label} is zero in ${relation}.`);
  }
  return value;
}

function result(value, expr, sub, extra = {}) {
  return { value, expr, sub, ...extra };
}

function shapeRelation(shape) {
  const dimension = shape.uses;
  return {
    id: `I-${shape.id}`,
    name: shape.label,
    formula: shape.formula,
    vars: ['I', 'M', dimension],
    residual: (v) => v.I - shape.coefficient * v.M * v[dimension] * v[dimension],
    scale: (v) => Math.max(1, Math.abs(v.I), Math.abs(shape.coefficient * v.M * v[dimension] * v[dimension])),
    solveFor: {
      I: (v) => result(shape.coefficient * v.M * v[dimension] * v[dimension],
        shape.formula.replace(/^I = /, ''),
        `${fmt(shape.coefficient)} × ${fmt(v.M)} × ${fmt(v[dimension])}²`),
      M: (v) => {
        const denominator = nonZero(shape.coefficient * v[dimension] * v[dimension], dimension, shape.formula);
        return result(v.I / denominator, `I/(${fmt(shape.coefficient)} ${dimension}²)`,
          `${fmt(v.I)}/(${fmt(shape.coefficient)}×${fmt(v[dimension])}²)`);
      },
      [dimension]: (v) => {
        const denominator = nonZero(shape.coefficient * v.M, 'M', shape.formula);
        return result(Math.sqrt(v.I / denominator),
          `√(I/(${fmt(shape.coefficient)} M))`,
          `√(${fmt(v.I)}/(${fmt(shape.coefficient)}×${fmt(v.M)}))`);
      },
    },
  };
}

const ANGULAR_MOMENTUM = {
  id: 'I6',
  name: 'Angular momentum',
  formula: 'L = I·ω',
  vars: ['Lm', 'I', 'w'],
  residual: (v) => v.Lm - v.I * v.w,
  scale: (v) => Math.max(1, Math.abs(v.Lm), Math.abs(v.I * v.w)),
  solveFor: {
    Lm: (v) => result(v.I * v.w, 'I·ω', `${fmt(v.I)}×${fmt(v.w)}`),
    I: (v) => {
      const w = nonZero(require(v, 'w'), 'w', 'L = Iω');
      return result(v.Lm / w, 'L/ω', `${fmt(v.Lm)}/${fmt(w)}`);
    },
    w: (v) => {
      const I = nonZero(require(v, 'I'), 'I', 'L = Iω');
      return result(v.Lm / I, 'L/I', `${fmt(v.Lm)}/${fmt(I)}`);
    },
  },
};

const CONSERVATION = {
  id: 'I7',
  name: 'Conservation of angular momentum',
  formula: 'I_1·ω_1 = I_2·ω_2',
  vars: ['I1', 'w1', 'I2', 'w2'],
  residual: (v) => v.I1 * v.w1 - v.I2 * v.w2,
  scale: (v) => Math.max(1, Math.abs(v.I1 * v.w1), Math.abs(v.I2 * v.w2)),
  solveFor: {
    I1: (v) => {
      const w1 = nonZero(require(v, 'w1'), 'w1', 'I1 ω1 = I2 ω2');
      return result((v.I2 * v.w2) / w1, 'I_2 ω_2/ω_1',
        `${fmt(v.I2)}×${fmt(v.w2)}/${fmt(w1)}`);
    },
    w1: (v) => {
      const I1 = nonZero(require(v, 'I1'), 'I1', 'I1 ω1 = I2 ω2');
      return result((v.I2 * v.w2) / I1, 'I_2 ω_2/I_1',
        `${fmt(v.I2)}×${fmt(v.w2)}/${fmt(I1)}`);
    },
    I2: (v) => {
      const w2 = nonZero(require(v, 'w2'), 'w2', 'I1 ω1 = I2 ω2');
      return result((v.I1 * v.w1) / w2, 'I_1 ω_1/ω_2',
        `${fmt(v.I1)}×${fmt(v.w1)}/${fmt(w2)}`);
    },
    w2: (v) => {
      const I2 = nonZero(require(v, 'I2'), 'I2', 'I1 ω1 = I2 ω2');
      return result((v.I1 * v.w1) / I2, 'I_1 ω_1/I_2',
        `${fmt(v.I1)}×${fmt(v.w1)}/${fmt(I2)}`);
    },
  },
};

const COMPOSITE = {
  id: 'I8',
  name: 'Composite moment of inertia',
  formula: 'I_total = I_platform + m·r²',
  vars: ['I1', 'I2', 'M', 'R'],
  residual: (v) => v.I2 - (v.I1 + v.M * v.R * v.R),
  scale: (v) => Math.max(1, Math.abs(v.I2), Math.abs(v.I1), Math.abs(v.M * v.R * v.R)),
  solveFor: {
    I2: (v) => result(v.I1 + v.M * v.R * v.R, 'I_platform + m r²',
      `${fmt(v.I1)} + ${fmt(v.M)}×${fmt(v.R)}²`),
    I1: (v) => result(v.I2 - v.M * v.R * v.R, 'I_total − m r²',
      `${fmt(v.I2)} − ${fmt(v.M)}×${fmt(v.R)}²`),
    M: (v) => {
      const r = nonZero(require(v, 'R'), 'R', 'I_total = I_platform + m r²');
      return result((v.I2 - v.I1) / (r * r), '(I_total − I_platform)/r²',
        `(${fmt(v.I2)} − ${fmt(v.I1)})/${fmt(r)}²`);
    },
    R: (v) => {
      const inside = (v.I2 - v.I1) / nonZero(require(v, 'M'), 'M', 'I_total = I_platform + m r²');
      if (inside < 0) throw new Impossible('The total moment of inertia is smaller than the platform.');
      return result(Math.sqrt(inside), '√((I_total − I_platform)/m)',
        `√((${fmt(v.I2)} − ${fmt(v.I1)})/${fmt(v.M)})`);
    },
  },
};

export const INERTIA_RELATIONS = [
  ...SHAPES.map((shape) => shapeRelation(shape)),
  ANGULAR_MOMENTUM,
  CONSERVATION,
  COMPOSITE,
];

export function solveInertia({
  known = {},
  submode = 'shape',
  shape = 'disk',
  customParts = [],
  meta = INERTIA_META,
  focusKey = null,
} = {}) {
  const definition = SHAPE_BY_ID[shape] || SHAPE_BY_ID.disk;
  const typed = {};
  for (const [key, raw] of Object.entries(known)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) typed[key] = value;
  }

  if (submode === 'shape') {
    const dimension = definition.uses;
    const relations = [shapeRelation(definition), ANGULAR_MOMENTUM];
    const locked = {};
    let extraWork = null;
    const shapeKnown = Number.isFinite(typed.I)
      || (Number.isFinite(typed.M) && Number.isFinite(typed[dimension]))
      || (Number.isFinite(typed.Lm) && Number.isFinite(typed.w));
    const goal = shapeKnown ? ['I'] : ['M', dimension, 'I'];
    if (Number.isFinite(typed.w) || Number.isFinite(typed.Lm)) goal.push('w', 'Lm');
    if (shape === 'custom') {
      const parts = Array.isArray(customParts)
        ? customParts.filter((part) => isNum(part.m) && isNum(part.r)) : [];
      if (parts.length) {
        locked.I = {
          value: parts.reduce((total, part) => total + part.m * part.r * part.r, 0),
          caption: 'Set by the custom parts',
        };
        extraWork = {
          key: 'I',
          label: INERTIA_META.I.label,
          symbol: INERTIA_META.I.symbol,
          unit: INERTIA_META.I.unit,
          equation: 'I-custom',
          equationName: 'Custom sum',
          formula: 'I = Σ m r²',
          expr: 'Σ m r²',
          sub: parts.map((part) => `${fmt(part.m)}×${fmt(part.r)}²`).join(' + '),
          value: locked.I.value,
          note: '',
          others: [],
          softUsed: [],
        };
      }
    }
    const result = solveRelations({
      keys: INERTIA_KEYS,
      relations,
      typed,
      locked,
      soft: [],
      goal,
      candidateKeys: INERTIA_KEYS,
      meta,
      samples: Object.fromEntries(INERTIA_KEYS.map((key) => [key, INERTIA_META[key].sample])),
      focusKey,
      blameOrder: ['I', dimension, 'M', 'w', 'Lm'],
      pick: (key, candidates) => candidates[0],
    });
    if (extraWork && !result.work.some((entry) => entry.key === 'I')) {
      result.work.unshift(extraWork);
    }
    result.shape = definition;
    result.submode = submode;
    return result;
  }

  if (submode === 'conservation') {
    const result = solveRelations({
      keys: INERTIA_KEYS,
      relations: [CONSERVATION],
      typed,
      soft: [],
      goal: ['I1', 'w1', 'I2', 'w2'],
      candidateKeys: INERTIA_KEYS,
      meta,
      samples: Object.fromEntries(INERTIA_KEYS.map((key) => [key, INERTIA_META[key].sample])),
      focusKey,
      blameOrder: ['w2', 'I2', 'w1', 'I1'],
      pick: (key, candidates) => candidates[0],
    });
    result.shape = definition;
    result.submode = submode;
    return result;
  }

  // Collision / composite.
  const result = solveRelations({
    keys: INERTIA_KEYS,
    relations: [COMPOSITE, CONSERVATION, ANGULAR_MOMENTUM],
    typed,
    soft: [],
    goal: ['I1', 'w1', 'M', 'R', 'I2', 'w2'],
    candidateKeys: INERTIA_KEYS,
    meta,
    samples: Object.fromEntries(INERTIA_KEYS.map((key) => [key, INERTIA_META[key].sample])),
    focusKey,
    blameOrder: ['w2', 'I2', 'R', 'M', 'w1', 'I1'],
    pick: (key, candidates) => (key === 'R' ? Math.abs(candidates[0]) : candidates[0]),
  });
  result.shape = definition;
  result.submode = submode;
  return result;
}
