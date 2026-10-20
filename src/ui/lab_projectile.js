// Projectile Motion on the shared relation engine.
//
// Up is positive. The class-notes relations are all here:
//   vx = v_i cos θ, vy = v_i sin θ
//   T from h0 + vy T − ½gT² = 0
//   R = vx T, H = h0 + vy²/(2g)
//   y(x) = h0 + x tan θ − gx²/(2v_i²cos²θ)
// plus the target-distance / height-at-target machinery. Every relation can be
// solved in every direction: closed forms where they are short, a bracketed
// numeric solve otherwise (the engine enumerates both launch angles).

import { fmt } from './lab_solver.js';
import { Impossible, Ambiguous, solveRelations } from './lab_engine.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const EPS = 1e-9;
const rad = (degrees) => (degrees * Math.PI) / 180;
const deg = (radians) => (radians * 180) / Math.PI;

export const PROJECTILE_KEYS = [
  'v0', 'angle', 'h0', 'vx0', 'vy0', 'T', 'R', 'H',
  'landingSpeed', 'timeApex', 'landingAngle',
  'targetR', 'yTarget', 'tTarget', 'vTarget', 'g',
];

export const PROJECTILE_META = {
  v0: { label: 'Launch speed', unit: 'm/s', symbol: 'v_0', min: 0, sample: 18.425 },
  angle: { label: 'Launch angle', unit: 'deg', symbol: 'θ', range: [-90, 90], sample: 30 },
  h0: { label: 'Launch height', unit: 'm', symbol: 'h_0', sample: 0 },
  vx0: { label: 'Horizontal velocity', unit: 'm/s', symbol: 'v_x', sample: 15.96 },
  vy0: { label: 'Initial vertical velocity', unit: 'm/s', symbol: 'v_y', sample: 9.21 },
  T: { label: 'Flight time', unit: 's', symbol: 'T', min: 0, sample: 2.04 },
  R: { label: 'Range', unit: 'm', symbol: 'R', min: 0, sample: 35.35 },
  H: { label: 'Max height', unit: 'm', symbol: 'H', min: 0, sample: 5.1 },
  landingSpeed: { label: 'Landing speed', unit: 'm/s', symbol: 'v_L', min: 0, sample: 20 },
  timeApex: { label: 'Time to apex', unit: 's', symbol: 't_A', sample: 0.94 },
  landingAngle: { label: 'Landing angle', unit: 'deg', symbol: 'φ', range: [-90, 90], sample: -30 },
  targetR: { label: 'Target distance', unit: 'm', symbol: 'x_T', min: 0, sample: 30 },
  yTarget: { label: 'Height at target', unit: 'm', symbol: 'y_T', sample: 0 },
  tTarget: { label: 'Time at target', unit: 's', symbol: 't_T', min: 0, sample: 1.88 },
  vTarget: { label: 'Speed at target', unit: 'm/s', symbol: 'v_T', min: 0, sample: 18.4 },
  g: { label: 'Gravity', unit: 'm/s²', symbol: 'g', min: 0, sample: 9.8 },
};

function require(values, key) {
  if (!isNum(values[key])) throw new Impossible(`${PROJECTILE_META[key].label} is needed.`);
  return values[key];
}

function nonZero(value, key, relation) {
  if (Math.abs(value) <= EPS) {
    throw new Impossible(`${PROJECTILE_META[key].label} is zero in ${relation}.`);
  }
  return value;
}

function result(value, expr, sub, extra = {}) {
  return { value, expr, sub, ...extra };
}

function flightTime(vy, h0, g) {
  const disc = vy * vy + 2 * g * h0;
  if (disc < 0) return null;
  return (vy + Math.sqrt(disc)) / g;
}

export const PROJECTILE_RELATIONS = [
  {
    id: 'P1',
    name: 'Horizontal velocity',
    formula: 'v_x = v_0·cos θ',
    vars: ['vx0', 'v0', 'angle'],
    residual: (v) => v.vx0 - v.v0 * Math.cos(rad(v.angle)),
    scale: (v) => Math.max(1, Math.abs(v.vx0), Math.abs(v.v0)),
    solveFor: {
      vx0: (v) => result(v.v0 * Math.cos(rad(v.angle)), 'v_0·cos θ',
        `${fmt(v.v0)}×cos(${fmt(v.angle)}°)`),
      v0: (v) => {
        const cosine = Math.cos(rad(v.angle));
        if (Math.abs(cosine) <= 1e-7) {
          throw new Impossible('A vertical launch has no horizontal velocity to use.');
        }
        return result(v.vx0 / cosine, 'v_x / cos θ', `${fmt(v.vx0)}/cos(${fmt(v.angle)}°)`);
      },
      angle: (v) => {
        if (Math.abs(v.v0) <= EPS) throw new Ambiguous('Angle is not determined when launch speed is zero.');
        const ratio = v.vx0 / v.v0;
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('Horizontal velocity cannot exceed launch speed.');
        const value = deg(Math.acos(Math.max(-1, Math.min(1, ratio))));
        const other = -value;
        return result(value, '±acos(v_x/v_0)', `±acos(${fmt(v.vx0)}/${fmt(v.v0)})`,
          { others: other === value ? [] : [other],
            note: other === value ? '' : `Also valid: θ = ${fmt(other)}°.` });
      },
    },
  },
  {
    id: 'P2',
    name: 'Vertical velocity',
    formula: 'v_y = v_0·sin θ',
    vars: ['vy0', 'v0', 'angle'],
    residual: (v) => v.vy0 - v.v0 * Math.sin(rad(v.angle)),
    scale: (v) => Math.max(1, Math.abs(v.vy0), Math.abs(v.v0)),
    solveFor: {
      vy0: (v) => result(v.v0 * Math.sin(rad(v.angle)), 'v_0·sin θ',
        `${fmt(v.v0)}×sin(${fmt(v.angle)}°)`),
      v0: (v) => {
        const sine = Math.sin(rad(v.angle));
        if (Math.abs(sine) <= 1e-7) {
          throw new Impossible('A horizontal launch has no vertical velocity to use.');
        }
        return result(v.vy0 / sine, 'v_y / sin θ', `${fmt(v.vy0)}/sin(${fmt(v.angle)}°)`);
      },
      angle: (v) => {
        if (Math.abs(v.v0) <= EPS) throw new Ambiguous('Angle is not determined when launch speed is zero.');
        const ratio = v.vy0 / v.v0;
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('Vertical velocity cannot exceed launch speed.');
        const value = deg(Math.asin(Math.max(-1, Math.min(1, ratio))));
        const other = value >= 0 ? 180 - value : -180 - value;
        const validOther = other >= -90 && other <= 90 ? [other] : [];
        return result(value, 'asin(v_y/v_0)', `asin(${fmt(v.vy0)}/${fmt(v.v0)})`,
          { others: validOther,
            note: validOther.length ? `Also valid: θ = ${fmt(validOther[0])}°.` : '' });
      },
    },
  },
  {
    id: 'P3',
    name: 'Flight time',
    formula: 'h_0 + v_y·T − ½gT² = 0',
    vars: ['h0', 'vy0', 'T', 'g'],
    residual: (v) => v.h0 + v.vy0 * v.T - 0.5 * v.g * v.T * v.T,
    scale: (v) => Math.max(1, Math.abs(v.h0), Math.abs(v.vy0 * v.T), Math.abs(0.5 * v.g * v.T * v.T)),
    solveFor: {
      T: (v) => {
        const value = flightTime(v.vy0, v.h0, v.g);
        if (value === null) throw new Impossible('That launch never reaches the ground.',
          'Try a higher launch or a bigger speed.');
        if (value < -EPS) throw new Impossible('The flight time works out negative.');
        return result(Math.max(0, value), '(v_y + √(v_y² + 2gh_0))/g',
          `(${fmt(v.vy0)} + √(${fmt(v.vy0)}² + 2×${fmt(v.g)}×${fmt(v.h0)}))/${fmt(v.g)}`);
      },
      vy0: (v) => {
        const T = nonZero(require(v, 'T'), 'T', 'h_0 + v_y T − ½gT² = 0');
        return result((0.5 * v.g * T * T - v.h0) / T, '(½gT² − h_0)/T',
          `(0.5×${fmt(v.g)}×${fmt(T)}² − ${fmt(v.h0)})/${fmt(T)}`);
      },
      h0: (v) => result(0.5 * v.g * v.T * v.T - v.vy0 * v.T, '½gT² − v_y T',
        `0.5×${fmt(v.g)}×${fmt(v.T)}² − ${fmt(v.vy0)}×${fmt(v.T)}`),
    },
  },
  {
    id: 'P4',
    name: 'Range',
    formula: 'R = v_x·T',
    vars: ['vx0', 'T', 'R'],
    residual: (v) => v.R - v.vx0 * v.T,
    scale: (v) => Math.max(1, Math.abs(v.R), Math.abs(v.vx0 * v.T)),
    solveFor: {
      R: (v) => result(v.vx0 * v.T, 'v_x·T', `${fmt(v.vx0)}×${fmt(v.T)}`),
      vx0: (v) => {
        const T = nonZero(require(v, 'T'), 'T', 'R = v_x T');
        return result(v.R / T, 'R/T', `${fmt(v.R)}/${fmt(T)}`);
      },
      T: (v) => {
        const vx = nonZero(require(v, 'vx0'), 'vx0', 'R = v_x T');
        return result(v.R / vx, 'R/v_x', `${fmt(v.R)}/${fmt(vx)}`);
      },
    },
  },
  {
    id: 'P5',
    name: 'Maximum height',
    formula: 'H = h_0 + v_y²/(2g)',
    vars: ['h0', 'vy0', 'H', 'g'],
    residual: (v) => v.H - (v.h0 + (v.vy0 * v.vy0) / (2 * v.g)),
    scale: (v) => Math.max(1, Math.abs(v.H), Math.abs(v.h0), Math.abs(v.vy0 * v.vy0 / (2 * v.g))),
    solveFor: {
      H: (v) => result(v.h0 + (v.vy0 * v.vy0) / (2 * v.g), 'h_0 + v_y²/(2g)',
        `${fmt(v.h0)} + ${fmt(v.vy0)}²/(2×${fmt(v.g)})`),
      h0: (v) => result(v.H - (v.vy0 * v.vy0) / (2 * v.g), 'H − v_y²/(2g)',
        `${fmt(v.H)} − ${fmt(v.vy0)}²/(2×${fmt(v.g)})`),
      vy0: (v) => {
        const inside = 2 * v.g * (v.H - v.h0);
        if (inside < 0) throw new Impossible('Maximum height is below the launch point.');
        const root = Math.sqrt(inside);
        return result(root, '√(2g(H − h_0))', `√(2×${fmt(v.g)}×(${fmt(v.H)} − ${fmt(v.h0)}))`,
          { note: 'The upward root is used.' });
      },
    },
  },
  {
    id: 'P6',
    name: 'Landing speed',
    formula: 'v_L² = v_0² + 2gh_0',
    vars: ['v0', 'h0', 'landingSpeed', 'g'],
    residual: (v) => v.landingSpeed * v.landingSpeed - (v.v0 * v.v0 + 2 * v.g * v.h0),
    scale: (v) => Math.max(1, v.landingSpeed * v.landingSpeed, v.v0 * v.v0, Math.abs(2 * v.g * v.h0)),
    solveFor: {
      landingSpeed: (v) => {
        const inside = v.v0 * v.v0 + 2 * v.g * v.h0;
        if (inside < 0) throw new Impossible('That launch has no real landing speed.');
        return result(Math.sqrt(inside), '√(v_0² + 2gh_0)',
          `√(${fmt(v.v0)}² + 2×${fmt(v.g)}×${fmt(v.h0)})`);
      },
      v0: (v) => {
        const inside = v.landingSpeed * v.landingSpeed - 2 * v.g * v.h0;
        if (inside < 0) throw new Impossible('That landing speed is too small for this height.');
        return result(Math.sqrt(inside), '√(v_L² − 2gh_0)',
          `√(${fmt(v.landingSpeed)}² − 2×${fmt(v.g)}×${fmt(v.h0)})`);
      },
      h0: (v) => result((v.landingSpeed * v.landingSpeed - v.v0 * v.v0) / (2 * v.g),
        '(v_L² − v_0²)/(2g)',
        `(${fmt(v.landingSpeed)}² − ${fmt(v.v0)}²)/(2×${fmt(v.g)})`),
    },
  },
  {
    id: 'P7',
    name: 'Time to apex',
    formula: 't_A = v_y/g',
    vars: ['vy0', 'timeApex', 'g'],
    residual: (v) => v.timeApex * v.g - v.vy0,
    scale: (v) => Math.max(1, Math.abs(v.timeApex * v.g), Math.abs(v.vy0)),
    solveFor: {
      timeApex: (v) => result(v.vy0 / v.g, 'v_y/g', `${fmt(v.vy0)}/${fmt(v.g)}`),
      vy0: (v) => result(v.timeApex * v.g, 'g·t_A', `${fmt(v.g)}×${fmt(v.timeApex)}`),
    },
  },
  {
    id: 'P8',
    name: 'Landing angle',
    formula: 'φ = atan2(v_y − gT, v_x)',
    vars: ['vx0', 'vy0', 'T', 'landingAngle', 'g'],
    residual: (v) => v.landingAngle - deg(Math.atan2(v.vy0 - v.g * v.T, v.vx0)),
    scale: () => 180,
    solveFor: {
      landingAngle: (v) => result(deg(Math.atan2(v.vy0 - v.g * v.T, v.vx0)),
        'atan2(v_y − gT, v_x)',
        `atan2(${fmt(v.vy0)} − ${fmt(v.g)}×${fmt(v.T)}, ${fmt(v.vx0)})`),
      vx0: (v) => {
        const tangent = Math.tan(rad(v.landingAngle));
        if (Math.abs(tangent) <= 1e-9) {
          throw new Impossible('A vertical landing angle leaves the horizontal velocity undetermined.');
        }
        return result((v.vy0 - v.g * v.T) / tangent, '(v_y − gT)/tan φ',
          `(${fmt(v.vy0)} − ${fmt(v.g)}×${fmt(v.T)})/tan(${fmt(v.landingAngle)}°)`);
      },
      vy0: (v) => result(v.vx0 * Math.tan(rad(v.landingAngle)) + v.g * v.T,
        'v_x·tan φ + gT',
        `${fmt(v.vx0)}×tan(${fmt(v.landingAngle)}°) + ${fmt(v.g)}×${fmt(v.T)}`),
      T: (v) => result((v.vy0 - v.vx0 * Math.tan(rad(v.landingAngle))) / v.g,
        '(v_y − v_x tan φ)/g',
        `(${fmt(v.vy0)} − ${fmt(v.vx0)}×tan(${fmt(v.landingAngle)}°))/${fmt(v.g)}`),
    },
  },
  {
    id: 'P9',
    name: 'Trajectory at the target',
    formula: 'y_T = h_0 + x_T·tan θ − gx_T²/(2v_0²cos²θ)',
    vars: ['h0', 'angle', 'v0', 'targetR', 'yTarget', 'g'],
    residual: (v) => {
      const cosine = Math.cos(rad(v.angle));
      return v.yTarget - (v.h0 + v.targetR * Math.tan(rad(v.angle))
        - (v.g * v.targetR * v.targetR) / (2 * v.v0 * v.v0 * cosine * cosine));
    },
    scale: (v) => Math.max(1, Math.abs(v.yTarget), Math.abs(v.h0),
      Math.abs(v.targetR * Math.tan(rad(v.angle)))),
    solveFor: {
      yTarget: (v) => {
        const cosine = Math.cos(rad(v.angle));
        return result(v.h0 + v.targetR * Math.tan(rad(v.angle))
          - (v.g * v.targetR * v.targetR) / (2 * v.v0 * v.v0 * cosine * cosine),
        'h_0 + x_T tan θ − gx_T²/(2v_0²cos²θ)',
        `${fmt(v.h0)} + ${fmt(v.targetR)}×tan(${fmt(v.angle)}°) − ${fmt(v.g)}×${fmt(v.targetR)}²/(2×${fmt(v.v0)}²cos²(${fmt(v.angle)}°))`);
      },
      v0: (v) => {
        const cosine = Math.cos(rad(v.angle));
        const drop = v.h0 + v.targetR * Math.tan(rad(v.angle)) - v.yTarget;
        if (drop <= 1e-12) {
          throw new Impossible('At this angle the ball can never reach that point.',
            'Try a steeper angle.');
        }
        const inside = (v.g * v.targetR * v.targetR) / (2 * cosine * cosine * drop);
        if (inside < 0) throw new Impossible('That target needs an imaginary launch speed.');
        return result(Math.sqrt(inside), '√(g x_T² / (2cos²θ(h_0 + x_T tan θ − y_T)))',
          `√(${fmt(v.g)}×${fmt(v.targetR)}²/(2×cos²(${fmt(v.angle)}°)×(${fmt(v.h0)} + ${fmt(v.targetR)}×tan(${fmt(v.angle)}°) − ${fmt(v.yTarget)})))`);
      },
      targetR: (v) => {
        const cosine = Math.cos(rad(v.angle));
        const a = v.g / (2 * v.v0 * v.v0 * cosine * cosine);
        const b = Math.tan(rad(v.angle));
        const c = v.h0 - v.yTarget;
        const disc = b * b - 4 * a * c;
        if (disc < -1e-12) throw new Impossible('The ball never reaches that height.');
        const root = Math.sqrt(Math.max(0, disc));
        const roots = [(-b + root) / (2 * a), (-b - root) / (2 * a)]
          .filter((value) => value >= -EPS).sort((left, right) => left - right);
        if (!roots.length) throw new Impossible('That height is not reached in front of the launch point.');
        return result(roots[0], 'positive root of the trajectory',
          `a=${fmt(a)}, b=${fmt(b)}, c=${fmt(c)}`,
          { others: roots.slice(1), note: roots.length > 1
            ? `Also valid: x_T = ${fmt(roots[1])} m, the later crossing.` : '' });
      },
      angle: (v) => {
        const x = v.targetR;
        const k = v.g * x * x / (2 * v.v0 * v.v0);
        const a = k;
        const b = -x;
        const c = k + v.h0 - v.yTarget;
        const disc = b * b - 4 * a * c;
        if (disc < -1e-12) throw new Impossible('At this speed the ball cannot reach that point.',
          'Try a bigger speed.');
        const root = Math.sqrt(Math.max(0, disc));
        const roots = [(-b + root) / (2 * a), (-b - root) / (2 * a)]
          .map((tangent) => deg(Math.atan(tangent)))
          .filter((value) => value >= -90 && value <= 90)
          .sort((left, right) => Math.abs(left) - Math.abs(right));
        if (!roots.length) throw new Impossible('No launch angle reaches that point.');
        return result(roots[0], 'θ = atan(root of the trajectory quadratic)',
          `x_T=${fmt(x)}, v_0=${fmt(v.v0)}, y_T=${fmt(v.yTarget)}`,
          { others: roots.slice(1), note: roots.length > 1
            ? `Also valid: θ = ${fmt(roots[1])}°, the high arc.` : '' });
      },
    },
  },
  {
    id: 'P10',
    name: 'Horizontal position at the target',
    formula: 'x_T = v_x·t_T',
    vars: ['vx0', 'targetR', 'tTarget'],
    residual: (v) => v.targetR - v.vx0 * v.tTarget,
    scale: (v) => Math.max(1, Math.abs(v.targetR), Math.abs(v.vx0 * v.tTarget)),
    solveFor: {
      targetR: (v) => result(v.vx0 * v.tTarget, 'v_x·t_T', `${fmt(v.vx0)}×${fmt(v.tTarget)}`),
      vx0: (v) => {
        const t = nonZero(require(v, 'tTarget'), 'tTarget', 'x_T = v_x t_T');
        return result(v.targetR / t, 'x_T/t_T', `${fmt(v.targetR)}/${fmt(t)}`);
      },
      tTarget: (v) => {
        const vx = nonZero(require(v, 'vx0'), 'vx0', 'x_T = v_x t_T');
        return result(v.targetR / vx, 'x_T/v_x', `${fmt(v.targetR)}/${fmt(vx)}`);
      },
    },
  },
  {
    id: 'P11',
    name: 'Height at the target time',
    formula: 'y_T = h_0 + v_y·t_T − ½g t_T²',
    vars: ['h0', 'vy0', 'yTarget', 'tTarget', 'g'],
    residual: (v) => v.yTarget - (v.h0 + v.vy0 * v.tTarget - 0.5 * v.g * v.tTarget * v.tTarget),
    scale: (v) => Math.max(1, Math.abs(v.yTarget), Math.abs(v.h0),
      Math.abs(v.vy0 * v.tTarget), Math.abs(0.5 * v.g * v.tTarget * v.tTarget)),
    solveFor: {
      yTarget: (v) => result(v.h0 + v.vy0 * v.tTarget - 0.5 * v.g * v.tTarget * v.tTarget,
        'h_0 + v_y t_T − ½g t_T²',
        `${fmt(v.h0)} + ${fmt(v.vy0)}×${fmt(v.tTarget)} − 0.5×${fmt(v.g)}×${fmt(v.tTarget)}²`),
      h0: (v) => result(v.yTarget - v.vy0 * v.tTarget + 0.5 * v.g * v.tTarget * v.tTarget,
        'y_T − v_y t_T + ½g t_T²',
        `${fmt(v.yTarget)} − ${fmt(v.vy0)}×${fmt(v.tTarget)} + 0.5×${fmt(v.g)}×${fmt(v.tTarget)}²`),
      vy0: (v) => {
        const t = nonZero(require(v, 'tTarget'), 'tTarget', 'y_T = h_0 + v_y t_T − ½g t_T²');
        return result((v.yTarget - v.h0 + 0.5 * v.g * t * t) / t, '(y_T − h_0 + ½g t_T²)/t_T',
          `(${fmt(v.yTarget)} − ${fmt(v.h0)} + 0.5×${fmt(v.g)}×${fmt(t)}²)/${fmt(t)}`);
      },
      tTarget: (v) => {
        const disc = v.vy0 * v.vy0 - 2 * v.g * (v.h0 - v.yTarget);
        if (disc < 0) throw new Impossible('The ball never reaches that height.');
        const root = Math.sqrt(disc);
        const roots = [(v.vy0 + root) / v.g, (v.vy0 - root) / v.g]
          .filter((value) => value >= -EPS).sort((left, right) => left - right);
        if (!roots.length) throw new Impossible('That height is not reached in front of the launch.');
        return result(roots[0], '(v_y ± √(v_y² − 2g(h_0 − y_T)))/g',
          `(${fmt(v.vy0)} ± √(${fmt(v.vy0)}² − 2×${fmt(v.g)}×(${fmt(v.h0)} − ${fmt(v.yTarget)})))/${fmt(v.g)}`,
          { others: roots.slice(1), note: roots.length > 1
            ? `Also valid: t_T = ${fmt(roots[1])} s, on the way down.` : '' });
      },
    },
  },
  {
    id: 'P12',
    name: 'Speed at the target',
    formula: 'v_T² = v_x² + (v_y − g t_T)²',
    vars: ['vTarget', 'vx0', 'vy0', 'tTarget', 'g'],
    residual: (v) => v.vTarget * v.vTarget
      - (v.vx0 * v.vx0 + (v.vy0 - v.g * v.tTarget) ** 2),
    scale: (v) => Math.max(1, v.vTarget * v.vTarget, v.vx0 * v.vx0,
      Math.abs((v.vy0 - v.g * v.tTarget) ** 2)),
    solveFor: {
      vTarget: (v) => result(Math.hypot(v.vx0, v.vy0 - v.g * v.tTarget),
        '√(v_x² + (v_y − g t_T)²)',
        `√(${fmt(v.vx0)}² + (${fmt(v.vy0)} − ${fmt(v.g)}×${fmt(v.tTarget)})²)`),
      vx0: (v) => {
        const inside = v.vTarget * v.vTarget - (v.vy0 - v.g * v.tTarget) ** 2;
        if (inside < 0) throw new Impossible('That target speed is too small for this vertical velocity.');
        return result(Math.sqrt(inside), '√(v_T² − (v_y − g t_T)²)',
          `√(${fmt(v.vTarget)}² − (${fmt(v.vy0)} − ${fmt(v.g)}×${fmt(v.tTarget)})²)`);
      },
      vy0: (v) => {
        const inside = v.vTarget * v.vTarget - v.vx0 * v.vx0;
        if (inside < 0) throw new Impossible('That target speed is smaller than the horizontal velocity.');
        const root = Math.sqrt(inside);
        const candidates = [v.g * v.tTarget + root, v.g * v.tTarget - root];
        return result(candidates[0], 'g t_T ± √(v_T² − v_x²)',
          `${fmt(v.g)}×${fmt(v.tTarget)} ± √(${fmt(v.vTarget)}² − ${fmt(v.vx0)}²)`,
          { others: candidates.slice(1), note: `Also valid: v_y = ${fmt(candidates[1])} m/s.` });
      },
    },
  },
  {
    id: 'P14',
    name: 'Height–range geometry',
    formula: 'tan θ = 4(H − h_0)/R',
    vars: ['angle', 'H', 'h0', 'R'],
    residual: (v) => Math.tan(rad(v.angle)) - (4 * (v.H - v.h0)) / (Math.abs(v.R) < 1e-12 ? 1e-12 : v.R),
    scale: (v) => Math.max(1, Math.abs(Math.tan(rad(v.angle))),
      Math.abs((4 * (v.H - v.h0)) / (Math.abs(v.R) < 1e-12 ? 1e-12 : v.R))),
    solveFor: {
      angle: (v) => result(deg(Math.atan((4 * (v.H - v.h0)) / nonZero(require(v, 'R'), 'R', 'tan θ = 4(H − h_0)/R'))),
        'atan(4(H − h_0)/R)',
        `atan(4×(${fmt(v.H)} − ${fmt(v.h0)})/${fmt(v.R)})`),
      H: (v) => result(v.h0 + (v.R * Math.tan(rad(v.angle))) / 4, 'h_0 + R tan θ/4',
        `${fmt(v.h0)} + ${fmt(v.R)}×tan(${fmt(v.angle)}°)/4`),
      h0: (v) => result(v.H - (v.R * Math.tan(rad(v.angle))) / 4, 'H − R tan θ/4',
        `${fmt(v.H)} − ${fmt(v.R)}×tan(${fmt(v.angle)}°)/4`),
      R: (v) => {
        const tangent = Math.tan(rad(v.angle));
        if (Math.abs(tangent) <= 1e-9) throw new Impossible('A horizontal launch has no finite range for that height.');
        return result((4 * (v.H - v.h0)) / tangent, '4(H − h_0)/tan θ',
          `4×(${fmt(v.H)} − ${fmt(v.h0)})/tan(${fmt(v.angle)}°)`);
      },
    },
  },
  {
    id: 'P15',
    name: 'Flight time and launch',
    formula: 'T = (v_0 sin θ + √(v_0²sin²θ + 2gh_0))/g',
    vars: ['T', 'v0', 'angle', 'h0', 'g'],
    residual: (v) => {
      const vy = v.v0 * Math.sin(rad(v.angle));
      const value = flightTime(vy, v.h0, v.g);
      return value === null ? NaN : v.T - value;
    },
    scale: (v) => Math.max(1, Math.abs(v.T), Math.abs(v.v0)),
    solveFor: {
      T: (v) => {
        const vy = v.v0 * Math.sin(rad(v.angle));
        const value = flightTime(vy, v.h0, v.g);
        if (value === null) throw new Impossible('That launch never reaches the ground.');
        return result(value, '(v_0 sin θ + √(v_0²sin²θ + 2gh_0))/g',
          `(${fmt(v.v0)}×sin(${fmt(v.angle)}°) + √(...))/${fmt(v.g)}`);
      },
      v0: (v) => {
        const T = nonZero(require(v, 'T'), 'T', 'T = flight time');
        const sine = Math.sin(rad(v.angle));
        if (Math.abs(sine) <= 1e-9) throw new Impossible('A horizontal launch is handled by the vertical relation.');
        return result((v.g * T * T - 2 * v.h0) / (2 * T * sine),
          '(gT² − 2h_0)/(2T sin θ)',
          `(${fmt(v.g)}×${fmt(T)}² − 2×${fmt(v.h0)})/(2×${fmt(T)}×sin(${fmt(v.angle)}°))`);
      },
      angle: (v) => {
        const T = nonZero(require(v, 'T'), 'T', 'T = flight time');
        const v0 = nonZero(require(v, 'v0'), 'v0', 'T = flight time');
        const ratio = (v.g * T * T - 2 * v.h0) / (2 * v0 * T);
        if (Math.abs(ratio) > 1 + 1e-9) throw new Impossible('That combination cannot produce this flight time.');
        const value = deg(Math.asin(Math.max(-1, Math.min(1, ratio))));
        const other = value >= 0 ? 180 - value : -180 - value;
        const validOther = other >= -90 && other <= 90 ? [other] : [];
        return result(value, 'asin((gT² − 2h_0)/(2v_0T))',
          `asin((${fmt(v.g)}×${fmt(T)}² − 2×${fmt(v.h0)})/(2×${fmt(v0)}×${fmt(T)}))`,
          { others: validOther, note: validOther.length ? `Also valid: θ = ${fmt(validOther[0])}°.` : '' });
      },
      h0: (v) => result(v.g * v.T * v.T / 2 - v.T * v.v0 * Math.sin(rad(v.angle)),
        'gT²/2 − T v_0 sin θ',
        `${fmt(v.g)}×${fmt(v.T)}²/2 − ${fmt(v.T)}×${fmt(v.v0)}×sin(${fmt(v.angle)}°)`),
    },
  },
  {
    id: 'P16',
    name: 'Maximum height and launch',
    formula: 'H = h_0 + v_0²sin²θ/(2g)',
    vars: ['H', 'h0', 'v0', 'angle', 'g'],
    residual: (v) => v.H - (v.h0 + (v.v0 * v.v0 * Math.sin(rad(v.angle)) ** 2) / (2 * v.g)),
    scale: (v) => Math.max(1, Math.abs(v.H), Math.abs(v.h0), Math.abs(v.v0 * v.v0 / (2 * v.g))),
    solveFor: {
      H: (v) => result(v.h0 + (v.v0 * v.v0 * Math.sin(rad(v.angle)) ** 2) / (2 * v.g),
        'h_0 + v_0²sin²θ/(2g)',
        `${fmt(v.h0)} + ${fmt(v.v0)}²×sin²(${fmt(v.angle)}°)/(2×${fmt(v.g)})`),
      h0: (v) => result(v.H - (v.v0 * v.v0 * Math.sin(rad(v.angle)) ** 2) / (2 * v.g),
        'H − v_0²sin²θ/(2g)',
        `${fmt(v.H)} − ${fmt(v.v0)}²×sin²(${fmt(v.angle)}°)/(2×${fmt(v.g)})`),
      v0: (v) => {
        const rise = v.H - v.h0;
        const sine = Math.sin(rad(v.angle));
        if (rise < 0) throw new Impossible('Maximum height is below the launch point.');
        if (Math.abs(sine) <= 1e-9) throw new Impossible('A horizontal launch cannot rise above its launch height.');
        return result(Math.sqrt((2 * v.g * rise) / (sine * sine)),
          '√(2g(H − h_0))/sin θ',
          `√(2×${fmt(v.g)}×(${fmt(v.H)} − ${fmt(v.h0)}))/sin(${fmt(v.angle)}°)`);
      },
      angle: (v) => {
        const rise = v.H - v.h0;
        if (rise < 0) throw new Impossible('Maximum height is below the launch point.');
        const v0 = nonZero(require(v, 'v0'), 'v0', 'H = h_0 + v_0²sin²θ/(2g)');
        const sine = Math.sqrt(2 * v.g * rise) / v0;
        if (sine > 1 + 1e-9) throw new Impossible('That height needs a bigger launch speed.');
        const value = deg(Math.asin(Math.max(-1, Math.min(1, sine))));
        const other = 180 - value;
        return result(value, 'asin(√(2g(H − h_0))/v_0)', `asin(${fmt(sine)})`,
          { others: other <= 90 ? [other] : [],
            note: other <= 90 ? `Also valid: θ = ${fmt(other)}°.` : '' });
      },
    },
  },
  {
    id: 'P13',
    name: 'Range relation',
    formula: 'R = v_x·(v_y + √(v_y² + 2gh_0))/g',
    vars: ['R', 'v0', 'angle', 'h0', 'g'],
    residual: (v) => {
      const vx = v.v0 * Math.cos(rad(v.angle));
      const vy = v.v0 * Math.sin(rad(v.angle));
      const T = flightTime(vy, v.h0, v.g);
      return T === null ? NaN : v.R - vx * T;
    },
    scale: (v) => Math.max(1, Math.abs(v.R), Math.abs(v.v0)),
    // Closed forms for the ground-launch special case; the engine's numeric
    // fallback handles the platform case and both launch angles.
    solveFor: {
      R: (v) => {
        const vx = v.v0 * Math.cos(rad(v.angle));
        const vy = v.v0 * Math.sin(rad(v.angle));
        const T = flightTime(vy, v.h0, v.g);
        if (T === null) throw new Impossible('That launch never reaches the ground.');
        return result(vx * T, 'v_x·T', `${fmt(vx)}×${fmt(T)}`);
      },
      v0: (v) => {
        if (Math.abs(v.h0) <= 1e-9) {
          const sine = Math.sin(2 * rad(v.angle));
          if (Math.abs(sine) <= 1e-7) throw new Impossible('That angle gives no horizontal range.');
          return result(Math.sqrt((v.R * v.g) / Math.abs(sine)),
            '√(Rg/sin 2θ)', `√(${fmt(v.R)}×${fmt(v.g)}/sin(2×${fmt(v.angle)}°))`,
            { note: 'Ground launch: R = v_0² sin 2θ / g.' });
        }
        // Platform launch: let the numeric solver find v0.
        throw new Ambiguous('Platform range needs the numeric solver.');
      },
    },
    range: { angle: [-90, 90], v0: [0, 1e6], h0: [-1e5, 1e5] },
    fix: 'Try a bigger range or a smaller angle.',
  },
];

export function projectileSoft(gravity = 9.8, launchType = 'angled') {
  const soft = [
    { key: 'g', value: gravity, priority: 10, label: 'Gravity', fatal: true },
  ];
  if (launchType === 'angled') {
    soft.push({ key: 'h0', value: 0, priority: 15, label: 'Launch height', fatal: true });
  }
  soft.push({
    key: 'yTarget',
    value: (values) => (isNum(values.h0) ? values.h0 : 0),
    priority: 20,
    label: 'Height at target',
    when: (values) => isNum(values.targetR),
  });
  return soft;
}

export function projectileLocked(launchType) {
  if (launchType === 'ground') {
    return { h0: { value: 0, caption: 'Set by Ground launch' } };
  }
  if (launchType === 'horizontal') {
    return { angle: { value: 0, caption: 'Set by Horizontal launch' } };
  }
  return {};
}

export function projectileGoal(typed = {}) {
  const base = ['v0', 'angle', 'h0', 'vx0', 'vy0', 'T', 'R', 'H',
    'landingSpeed', 'timeApex', 'landingAngle'];
  if (Number.isFinite(Number(typed.targetR)) || Number.isFinite(Number(typed.tTarget))) {
    return [...base, 'targetR', 'yTarget', 'tTarget', 'vTarget'];
  }
  return base;
}

export function solveProjectile({
  known = {},
  fixed = {},
  gravity = 9.8,
  editedKey = null,
  meta = PROJECTILE_META,
  launchType = 'angled',
  focusKey = null,
} = {}) {
  const typed = {};
  for (const [key, raw] of Object.entries(known)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) typed[key] = value;
  }
  if (!Number.isFinite(typed.g)) typed.g = undefined;
  const locked = { ...projectileLocked(launchType) };
  for (const [key, raw] of Object.entries(fixed || {})) {
    if (Number.isFinite(Number(raw))) {
      locked[key] = {
        value: Number(raw),
        caption: key === 'h0' ? 'Set by Ground launch'
          : (key === 'angle' ? 'Set by Horizontal launch' : 'Set by the launch type'),
      };
    }
  }
  const goal = projectileGoal(typed);
  const result = solveRelations({
    keys: PROJECTILE_KEYS,
    relations: PROJECTILE_RELATIONS,
    typed,
    locked,
    soft: projectileSoft(Number.isFinite(gravity) && gravity > 0 ? gravity : 9.8, launchType),
    goal,
    candidateKeys: ['R', 'T', 'H', 'targetR', 'tTarget', 'v0', 'angle', 'h0',
      'vx0', 'vy0', 'landingSpeed', 'timeApex', 'landingAngle'],
    meta,
    samples: Object.fromEntries(PROJECTILE_KEYS.map((key) => [key, PROJECTILE_META[key].sample])),
    editedKey,
    focusKey,
    blameOrder: ['angle', 'tTarget', 'T', 'targetR', 'R', 'v0', 'h0', 'yTarget', 'H'],
    pick: (key, candidates) => {
      if (key === 'angle' || key === 'landingAngle') {
        return [...candidates].sort((left, right) => Math.abs(left) - Math.abs(right))[0];
      }
      return candidates[0];
    },
  });

  // Target defaults: the point sits at the range when no target distance was
  // named, and the target height follows the launch height unless typed.
  if (!isNum(result.values.targetR) && isNum(result.values.R)) {
    result.values.targetR = result.values.R;
    result.sources.targetR = 'auto';
  }
  if (isNum(result.values.targetR) && isNum(result.values.h0) && !isNum(result.values.yTarget)) {
    result.values.yTarget = result.values.h0;
    result.sources.yTarget = 'auto';
  }
  result.meta = meta;
  return result;
}
