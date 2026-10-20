// The Physics Lab's inverse equation engine.
//
// Each equation lists its variables and one closed-form solver per variable.
// The caller supplies the variables it knows and the single variable it wants
// to find. If the selected equation lacks information the engine reports the
// missing variable; if another supported equation can use the same known
// values it offers that equation instead.
//
// Results are analytical: exact under the equation's stated assumptions. They
// are not simulation measurements. The LIVE panel and timeline remain the
// real simulation.

const GRAVITY = 9.81;
const EPS = 1e-12;
const POSITIVE = new Set(['m', 'r', 'g', 't']);
const NON_NEGATIVE = new Set(['d', 'v', 'u', 'K', 'omega', 'mu']);

export class EquationError extends Error {}

export const VARIABLES = {
  d: { label: 'Distance', unit: 'm' },
  t: { label: 'Time', unit: 's' },
  v: { label: 'Speed', unit: 'm/s' },
  u: { label: 'Initial speed', unit: 'm/s' },
  a: { label: 'Acceleration', unit: 'm/s2' },
  F: { label: 'Force', unit: 'N' },
  m: { label: 'Mass', unit: 'kg' },
  K: { label: 'Kinetic energy', unit: 'J' },
  W: { label: 'Work', unit: 'J' },
  tau: { label: 'Torque', unit: 'N m' },
  r: { label: 'Lever arm / radius', unit: 'm' },
  omega: { label: 'Angular velocity', unit: 'rad/s' },
  mu: { label: 'Friction coefficient', unit: '' },
  g: { label: 'Gravity', unit: 'm/s2', default: GRAVITY },
  theta: { label: 'Aim angle', unit: 'deg' },
  vx: { label: 'Sideways speed', unit: 'm/s' },
};

export function fmt(value, decimals = 3) {
  if (!Number.isFinite(value)) return 'never';
  let text = Number(value).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0' || text === '') text = '0';
  return text;
}

function need(values, symbol, formula) {
  const value = values[symbol];
  if (!Number.isFinite(value)) {
    throw new EquationError(`${VARIABLES[symbol].label} (${symbol}) is required to use ${formula}.`);
  }
  return value;
}

function requireNonZero(value, symbol, formula) {
  if (Math.abs(value) <= EPS) {
    throw new EquationError(`${symbol} cannot be zero in ${formula}.`);
  }
  return value;
}

function positiveRoot(value, message) {
  if (!Number.isFinite(value) || value < 0) throw new EquationError(message);
  return Math.sqrt(value);
}

function stepSet(rearranged, substitution, steps, notes = [], alternatives = []) {
  return { rearranged, substitution, steps, notes, alternatives };
}

function validateGiven(equation, values, find) {
  for (const symbol of equation.variables) {
    if (symbol === find) continue;
    const value = values[symbol];
    if (!Number.isFinite(value)) continue;
    if (POSITIVE.has(symbol) && value <= 0) {
      throw new EquationError(`${VARIABLES[symbol].label} (${symbol}) must be greater than zero.`);
    }
    if (NON_NEGATIVE.has(symbol) && value < 0) {
      throw new EquationError(`${VARIABLES[symbol].label} (${symbol}) cannot be negative.`);
    }
  }
}

function validateResult(find, value) {
  if (POSITIVE.has(find) && value <= 0) {
    throw new EquationError(`${VARIABLES[find].label} (${find}) must be greater than zero.`);
  }
  if (NON_NEGATIVE.has(find) && value < 0) {
    throw new EquationError(`${VARIABLES[find].label} (${find}) cannot be negative.`);
  }
}

// ---------------------------------------------------------------------------
// Uniform motion: d = v t
const uniformMotion = {
  id: 'uniform_motion',
  name: 'Uniform motion',
  formula: 'd = v t',
  variables: ['d', 'v', 't'],
  assumptions: ['Constant speed', 'No acceleration or friction', 'Straight-line travel'],
  solve: {
    d: (g) => {
      const v = need(g, 'v', 'd = v t');
      const t = need(g, 't', 'd = v t');
      return stepSet('d = v t', `d = ${fmt(v)} x ${fmt(t)}`,
        [`d = ${fmt(v)} x ${fmt(t)}`, `d = ${fmt(v * t)} m`]);
    },
    v: (g) => {
      const d = need(g, 'd', 'd = v t');
      const t = requireNonZero(need(g, 't', 'd = v t'), 't', 'd = v t');
      return stepSet('v = d / t', `v = ${fmt(d)} / ${fmt(t)}`,
        [`v = ${fmt(d)} / ${fmt(t)}`, `v = ${fmt(d / t)} m/s`]);
    },
    t: (g) => {
      const d = need(g, 'd', 'd = v t');
      const v = requireNonZero(need(g, 'v', 'd = v t'), 'v', 'd = v t');
      return stepSet('t = d / v', `t = ${fmt(d)} / ${fmt(v)}`,
        [`t = ${fmt(d)} / ${fmt(v)}`, `t = ${fmt(d / v)} s`]);
    },
  },
  apply: { v: 'speed' },
};

// ---------------------------------------------------------------------------
// Constant acceleration, velocity and time: v = u + a t
const velocityTime = {
  id: 'velocity_time',
  name: 'Velocity and time',
  formula: 'v = u + a t',
  variables: ['u', 'v', 'a', 't'],
  assumptions: ['Constant acceleration', 'Straight-line motion', 'Signed values (negative a = deceleration)'],
  solve: {
    v: (g) => {
      const u = need(g, 'u', 'v = u + a t');
      const a = need(g, 'a', 'v = u + a t');
      const t = need(g, 't', 'v = u + a t');
      return stepSet('v = u + a t', `v = ${fmt(u)} + ${fmt(a)} x ${fmt(t)}`,
        [`v = ${fmt(u)} + ${fmt(a * t)}`, `v = ${fmt(u + a * t)} m/s`]);
    },
    u: (g) => {
      const v = need(g, 'v', 'v = u + a t');
      const a = need(g, 'a', 'v = u + a t');
      const t = need(g, 't', 'v = u + a t');
      return stepSet('u = v - a t', `u = ${fmt(v)} - ${fmt(a)} x ${fmt(t)}`,
        [`u = ${fmt(v)} - ${fmt(a * t)}`, `u = ${fmt(v - a * t)} m/s`]);
    },
    a: (g) => {
      const v = need(g, 'v', 'v = u + a t');
      const u = need(g, 'u', 'v = u + a t');
      const t = requireNonZero(need(g, 't', 'v = u + a t'), 't', 'v = u + a t');
      return stepSet('a = (v - u) / t',
        `a = (${fmt(v)} - ${fmt(u)}) / ${fmt(t)}`,
        [`a = ${fmt(v - u)} / ${fmt(t)}`, `a = ${fmt((v - u) / t)} m/s2`]);
    },
    t: (g) => {
      const v = need(g, 'v', 'v = u + a t');
      const u = need(g, 'u', 'v = u + a t');
      const a = requireNonZero(need(g, 'a', 'v = u + a t'), 'a', 'v = u + a t');
      return stepSet('t = (v - u) / a',
        `t = (${fmt(v)} - ${fmt(u)}) / ${fmt(a)}`,
        [`t = ${fmt(v - u)} / ${fmt(a)}`, `t = ${fmt((v - u) / a)} s`]);
    },
  },
  apply: { u: 'speed', a: 'deceleration' },
};

// ---------------------------------------------------------------------------
// Constant acceleration, displacement and time: d = u t + 0.5 a t^2
const displacementTime = {
  id: 'displacement_time',
  name: 'Displacement and time',
  formula: 'd = u t + 0.5 a t^2',
  variables: ['d', 'u', 'a', 't'],
  assumptions: ['Constant acceleration', 'Straight-line motion', 'Signed values (negative a = deceleration)'],
  solve: {
    d: (g) => {
      const u = need(g, 'u', 'd = u t + 0.5 a t^2');
      const t = need(g, 't', 'd = u t + 0.5 a t^2');
      const a = need(g, 'a', 'd = u t + 0.5 a t^2');
      return stepSet('d = u t + 0.5 a t^2',
        `d = ${fmt(u)} x ${fmt(t)} + 0.5 x ${fmt(a)} x ${fmt(t)}^2`,
        [`d = ${fmt(u * t)} + ${fmt(0.5 * a * t * t)}`,
          `d = ${fmt(u * t + 0.5 * a * t * t)} m`]);
    },
    u: (g) => {
      const d = need(g, 'd', 'd = u t + 0.5 a t^2');
      const a = need(g, 'a', 'd = u t + 0.5 a t^2');
      const t = requireNonZero(need(g, 't', 'd = u t + 0.5 a t^2'), 't',
        'd = u t + 0.5 a t^2');
      const u = (d - 0.5 * a * t * t) / t;
      return stepSet('u = (d - 0.5 a t^2) / t',
        `u = (${fmt(d)} - 0.5 x ${fmt(a)} x ${fmt(t)}^2) / ${fmt(t)}`,
        [`u = (${fmt(d)} - ${fmt(0.5 * a * t * t)}) / ${fmt(t)}`,
          `u = ${fmt(u)} m/s`]);
    },
    a: (g) => {
      const d = need(g, 'd', 'd = u t + 0.5 a t^2');
      const u = need(g, 'u', 'd = u t + 0.5 a t^2');
      const t = requireNonZero(need(g, 't', 'd = u t + 0.5 a t^2'), 't',
        'd = u t + 0.5 a t^2');
      const a = 2 * (d - u * t) / (t * t);
      return stepSet('a = 2(d - u t) / t^2',
        `a = 2(${fmt(d)} - ${fmt(u)} x ${fmt(t)}) / ${fmt(t)}^2`,
        [`a = 2(${fmt(d - u * t)}) / ${fmt(t * t)}`, `a = ${fmt(a)} m/s2`]);
    },
    t: (g) => {
      const d = need(g, 'd', 'd = u t + 0.5 a t^2');
      const u = need(g, 'u', 'd = u t + 0.5 a t^2');
      const a = need(g, 'a', 'd = u t + 0.5 a t^2');
      if (Math.abs(a) <= EPS) {
        const v = requireNonZero(u, 'u', 't = d / u (a = 0)');
        return stepSet('t = d / u (a = 0)', `t = ${fmt(d)} / ${fmt(u)}`,
          [`a = 0, so t = d / u`, `t = ${fmt(d / u)} s`],
          ['With zero acceleration, uniform motion is used.']);
      }
      const discriminant = u * u + 2 * a * d;
      if (discriminant < -1e-9) {
        throw new EquationError(
          'The ball never reaches that distance with this deceleration (the discriminant is negative).');
      }
      const root = Math.sqrt(Math.max(0, discriminant));
      const t1 = (-u + root) / a;
      const t2 = (-u - root) / a;
      const positive = [t1, t2].filter((value) => value > 0 && Number.isFinite(value))
        .sort((x, y) => x - y);
      if (!positive.length) {
        throw new EquationError('No positive travel time satisfies these values.');
      }
      const notes = [];
      if (positive.length > 1) {
        notes.push(`Two positive times satisfy the equation; the first arrival is shown (the other is ${fmt(positive[1])} s).`);
      }
      return stepSet('t = (-u +/- sqrt(u^2 + 2 a d)) / a',
        `t = (-${fmt(u)} +/- sqrt(${fmt(u)}^2 + 2 x ${fmt(a)} x ${fmt(d)})) / ${fmt(a)}`,
        [`discriminant = ${fmt(discriminant)}`,
          `t = (-${fmt(u)} + ${fmt(root)}) / ${fmt(a)} = ${fmt(positive[0])} s`],
        notes, positive.slice(1).map((value) => ({ value, note: 'second crossing' })));
    },
  },
  apply: { u: 'speed', a: 'deceleration' },
};

// ---------------------------------------------------------------------------
// Constant acceleration without time: v^2 = u^2 + 2 a d
const velocityDisplacement = {
  id: 'velocity_displacement',
  name: 'Velocity and distance',
  formula: 'v^2 = u^2 + 2 a d',
  variables: ['u', 'v', 'a', 'd'],
  assumptions: ['Constant acceleration', 'Straight-line motion', 'Speed is the non-negative root'],
  solve: {
    v: (g) => {
      const u = need(g, 'u', 'v^2 = u^2 + 2 a d');
      const a = need(g, 'a', 'v^2 = u^2 + 2 a d');
      const d = need(g, 'd', 'v^2 = u^2 + 2 a d');
      const v = positiveRoot(u * u + 2 * a * d,
        'The quantity under the square root is negative; this motion cannot reach that distance.');
      return stepSet('v = sqrt(u^2 + 2 a d)',
        `v = sqrt(${fmt(u)}^2 + 2 x ${fmt(a)} x ${fmt(d)})`,
        [`v = sqrt(${fmt(u * u + 2 * a * d)})`, `v = ${fmt(v)} m/s`],
        ['The positive root is shown; a reversing motion would use the negative root.']);
    },
    u: (g) => {
      const v = need(g, 'v', 'v^2 = u^2 + 2 a d');
      const a = need(g, 'a', 'v^2 = u^2 + 2 a d');
      const d = need(g, 'd', 'v^2 = u^2 + 2 a d');
      const u = positiveRoot(v * v - 2 * a * d,
        'The quantity under the square root is negative; the initial speed is not real.');
      return stepSet('u = sqrt(v^2 - 2 a d)',
        `u = sqrt(${fmt(v)}^2 - 2 x ${fmt(a)} x ${fmt(d)})`,
        [`u = sqrt(${fmt(v * v - 2 * a * d)})`, `u = ${fmt(u)} m/s`],
        ['The positive root is shown; a reversing motion would use the negative root.']);
    },
    a: (g) => {
      const v = need(g, 'v', 'v^2 = u^2 + 2 a d');
      const u = need(g, 'u', 'v^2 = u^2 + 2 a d');
      const d = requireNonZero(need(g, 'd', 'v^2 = u^2 + 2 a d'), 'd',
        'v^2 = u^2 + 2 a d');
      const a = (v * v - u * u) / (2 * d);
      return stepSet('a = (v^2 - u^2) / (2 d)',
        `a = (${fmt(v)}^2 - ${fmt(u)}^2) / (2 x ${fmt(d)})`,
        [`a = ${fmt(v * v - u * u)} / ${fmt(2 * d)}`, `a = ${fmt(a)} m/s2`]);
    },
    d: (g) => {
      const v = need(g, 'v', 'v^2 = u^2 + 2 a d');
      const u = need(g, 'u', 'v^2 = u^2 + 2 a d');
      const a = requireNonZero(need(g, 'a', 'v^2 = u^2 + 2 a d'), 'a',
        'v^2 = u^2 + 2 a d');
      const d = (v * v - u * u) / (2 * a);
      return stepSet('d = (v^2 - u^2) / (2 a)',
        `d = (${fmt(v)}^2 - ${fmt(u)}^2) / (2 x ${fmt(a)})`,
        [`d = ${fmt(v * v - u * u)} / ${fmt(2 * a)}`, `d = ${fmt(d)} m`]);
    },
  },
  apply: { u: 'speed', a: 'deceleration' },
};

// ---------------------------------------------------------------------------
// Force: F = m a
const force = {
  id: 'force',
  name: 'Force',
  formula: 'F = m a',
  variables: ['F', 'm', 'a'],
  assumptions: ['Net force', 'Constant mass', 'Straight-line acceleration'],
  solve: {
    F: (g) => {
      const m = need(g, 'm', 'F = m a');
      const a = need(g, 'a', 'F = m a');
      return stepSet('F = m a', `F = ${fmt(m)} x ${fmt(a)}`,
        [`F = ${fmt(m * a)} N`]);
    },
    m: (g) => {
      const F = need(g, 'F', 'F = m a');
      const a = requireNonZero(need(g, 'a', 'F = m a'), 'a', 'F = m a');
      return stepSet('m = F / a', `m = ${fmt(F)} / ${fmt(a)}`,
        [`m = ${fmt(F / a)} kg`]);
    },
    a: (g) => {
      const F = need(g, 'F', 'F = m a');
      const m = requireNonZero(need(g, 'm', 'F = m a'), 'm', 'F = m a');
      return stepSet('a = F / m', `a = ${fmt(F)} / ${fmt(m)}`,
        [`a = ${fmt(F / m)} m/s2`]);
    },
  },
  apply: {},
};

// ---------------------------------------------------------------------------
// Work: W = F d
const work = {
  id: 'work',
  name: 'Work',
  formula: 'W = F d',
  variables: ['W', 'F', 'd'],
  assumptions: ['Force along the displacement', 'Constant force'],
  solve: {
    W: (g) => {
      const F = need(g, 'F', 'W = F d');
      const d = need(g, 'd', 'W = F d');
      return stepSet('W = F d', `W = ${fmt(F)} x ${fmt(d)}`,
        [`W = ${fmt(F * d)} J`]);
    },
    F: (g) => {
      const W = need(g, 'W', 'W = F d');
      const d = requireNonZero(need(g, 'd', 'W = F d'), 'd', 'W = F d');
      return stepSet('F = W / d', `F = ${fmt(W)} / ${fmt(d)}`,
        [`F = ${fmt(W / d)} N`]);
    },
    d: (g) => {
      const W = need(g, 'W', 'W = F d');
      const F = requireNonZero(need(g, 'F', 'W = F d'), 'F', 'W = F d');
      return stepSet('d = W / F', `d = ${fmt(W)} / ${fmt(F)}`,
        [`d = ${fmt(W / F)} m`]);
    },
  },
  apply: {},
};

// ---------------------------------------------------------------------------
// Kinetic energy: K = 0.5 m v^2
const kineticEnergy = {
  id: 'kinetic_energy',
  name: 'Kinetic energy',
  formula: 'K = 0.5 m v^2',
  variables: ['K', 'm', 'v'],
  assumptions: ['Translational kinetic energy', 'Speed is the non-negative root'],
  solve: {
    K: (g) => {
      const m = need(g, 'm', 'K = 0.5 m v^2');
      const v = need(g, 'v', 'K = 0.5 m v^2');
      return stepSet('K = 0.5 m v^2', `K = 0.5 x ${fmt(m)} x ${fmt(v)}^2`,
        [`K = 0.5 x ${fmt(m)} x ${fmt(v * v)}`, `K = ${fmt(0.5 * m * v * v)} J`]);
    },
    m: (g) => {
      const K = need(g, 'K', 'K = 0.5 m v^2');
      const v = requireNonZero(need(g, 'v', 'K = 0.5 m v^2'), 'v',
        'K = 0.5 m v^2');
      return stepSet('m = 2K / v^2', `m = 2 x ${fmt(K)} / ${fmt(v)}^2`,
        [`m = ${fmt(2 * K)} / ${fmt(v * v)}`, `m = ${fmt(2 * K / (v * v))} kg`]);
    },
    v: (g) => {
      const K = need(g, 'K', 'K = 0.5 m v^2');
      const m = requireNonZero(need(g, 'm', 'K = 0.5 m v^2'), 'm',
        'K = 0.5 m v^2');
      const v = positiveRoot(2 * K / m,
        'Kinetic energy and mass must give a non-negative speed.');
      return stepSet('v = sqrt(2K / m)',
        `v = sqrt(2 x ${fmt(K)} / ${fmt(m)})`,
        [`v = sqrt(${fmt(2 * K / m)})`, `v = ${fmt(v)} m/s`],
        ['The positive root is shown.']);
    },
  },
  apply: { v: 'speed' },
};

// ---------------------------------------------------------------------------
// Torque: tau = F r
const torque = {
  id: 'torque',
  name: 'Torque',
  formula: 'tau = F r',
  variables: ['tau', 'F', 'r'],
  assumptions: ['Force perpendicular to the lever arm', 'Lever arm measured from the pivot'],
  solve: {
    tau: (g) => {
      const F = need(g, 'F', 'tau = F r');
      const r = need(g, 'r', 'tau = F r');
      return stepSet('tau = F r', `tau = ${fmt(F)} x ${fmt(r)}`,
        [`tau = ${fmt(F * r)} N m`]);
    },
    F: (g) => {
      const tau = need(g, 'tau', 'tau = F r');
      const r = requireNonZero(need(g, 'r', 'tau = F r'), 'r', 'tau = F r');
      return stepSet('F = tau / r', `F = ${fmt(tau)} / ${fmt(r)}`,
        [`F = ${fmt(tau / r)} N`]);
    },
    r: (g) => {
      const tau = need(g, 'tau', 'tau = F r');
      const F = requireNonZero(need(g, 'F', 'tau = F r'), 'F', 'tau = F r');
      return stepSet('r = tau / F', `r = ${fmt(tau)} / ${fmt(F)}`,
        [`r = ${fmt(tau / F)} m`]);
    },
  },
  apply: {},
};

// ---------------------------------------------------------------------------
// Angular and linear velocity: v = omega r
const angularVelocity = {
  id: 'angular_velocity',
  name: 'Angular velocity',
  formula: 'v = omega r',
  variables: ['v', 'omega', 'r'],
  assumptions: ['Rolling without slipping', 'Radius measured to the rolling surface'],
  solve: {
    v: (g) => {
      const omega = need(g, 'omega', 'v = omega r');
      const r = need(g, 'r', 'v = omega r');
      return stepSet('v = omega r', `v = ${fmt(omega)} x ${fmt(r)}`,
        [`v = ${fmt(omega * r)} m/s`]);
    },
    omega: (g) => {
      const v = need(g, 'v', 'v = omega r');
      const r = requireNonZero(need(g, 'r', 'v = omega r'), 'r', 'v = omega r');
      return stepSet('omega = v / r', `omega = ${fmt(v)} / ${fmt(r)}`,
        [`omega = ${fmt(v / r)} rad/s`]);
    },
    r: (g) => {
      const v = need(g, 'v', 'v = omega r');
      const omega = requireNonZero(need(g, 'omega', 'v = omega r'), 'omega',
        'v = omega r');
      return stepSet('r = v / omega', `r = ${fmt(v)} / ${fmt(omega)}`,
        [`r = ${fmt(v / omega)} m`]);
    },
  },
  apply: { v: 'speed' },
};

// ---------------------------------------------------------------------------
// Kinetic friction deceleration: a = mu g
const frictionDeceleration = {
  id: 'friction_deceleration',
  name: 'Friction deceleration',
  formula: 'a = mu g',
  variables: ['a', 'mu', 'g'],
  assumptions: ['Kinetic friction', 'Level surface', 'a is the magnitude of deceleration'],
  solve: {
    a: (g) => {
      const mu = need(g, 'mu', 'a = mu g');
      const gravity = need(g, 'g', 'a = mu g');
      return stepSet('a = mu g', `a = ${fmt(mu)} x ${fmt(gravity)}`,
        [`a = ${fmt(mu * gravity)} m/s2`],
        ['This is the magnitude of the deceleration; the lab applies it as negative.']);
    },
    mu: (g) => {
      const a = need(g, 'a', 'a = mu g');
      const gravity = requireNonZero(need(g, 'g', 'a = mu g'), 'g', 'a = mu g');
      return stepSet('mu = a / g', `mu = ${fmt(a)} / ${fmt(gravity)}`,
        [`mu = ${fmt(a / gravity)}`]);
    },
    g: (g) => {
      const a = need(g, 'a', 'a = mu g');
      const mu = requireNonZero(need(g, 'mu', 'a = mu g'), 'mu', 'a = mu g');
      return stepSet('g = a / mu', `g = ${fmt(a)} / ${fmt(mu)}`,
        [`g = ${fmt(a / mu)} m/s2`]);
    },
  },
  apply: { a: 'deceleration', mu: 'friction' },
};

// ---------------------------------------------------------------------------
// Stopping distance under friction: d = v^2 / (2 mu g)
const stoppingDistance = {
  id: 'stopping_distance',
  name: 'Stopping distance',
  formula: 'd = v^2 / (2 mu g)',
  variables: ['d', 'v', 'mu', 'g'],
  assumptions: ['Constant kinetic friction', 'Level lane', 'No other forces'],
  solve: {
    d: (g) => {
      const v = need(g, 'v', 'd = v^2 / (2 mu g)');
      const mu = need(g, 'mu', 'd = v^2 / (2 mu g)');
      const gravity = need(g, 'g', 'd = v^2 / (2 mu g)');
      const denom = requireNonZero(2 * mu * gravity, 'mu g', 'd = v^2 / (2 mu g)');
      return stepSet('d = v^2 / (2 mu g)',
        `d = ${fmt(v)}^2 / (2 x ${fmt(mu)} x ${fmt(gravity)})`,
        [`d = ${fmt(v * v)} / ${fmt(denom)}`, `d = ${fmt(v * v / denom)} m`]);
    },
    v: (g) => {
      const d = need(g, 'd', 'd = v^2 / (2 mu g)');
      const mu = need(g, 'mu', 'd = v^2 / (2 mu g)');
      const gravity = need(g, 'g', 'd = v^2 / (2 mu g)');
      const v = positiveRoot(2 * mu * gravity * d,
        'The stopping distance and friction cannot give a real speed.');
      return stepSet('v = sqrt(2 mu g d)',
        `v = sqrt(2 x ${fmt(mu)} x ${fmt(gravity)} x ${fmt(d)})`,
        [`v = sqrt(${fmt(2 * mu * gravity * d)})`, `v = ${fmt(v)} m/s`]);
    },
    mu: (g) => {
      const d = requireNonZero(need(g, 'd', 'd = v^2 / (2 mu g)'), 'd',
        'd = v^2 / (2 mu g)');
      const v = need(g, 'v', 'd = v^2 / (2 mu g)');
      const gravity = requireNonZero(need(g, 'g', 'd = v^2 / (2 mu g)'), 'g',
        'd = v^2 / (2 mu g)');
      const mu = v * v / (2 * gravity * d);
      return stepSet('mu = v^2 / (2 g d)',
        `mu = ${fmt(v)}^2 / (2 x ${fmt(gravity)} x ${fmt(d)})`,
        [`mu = ${fmt(v * v)} / ${fmt(2 * gravity * d)}`, `mu = ${fmt(mu)}`]);
    },
    g: (g) => {
      const d = requireNonZero(need(g, 'd', 'd = v^2 / (2 mu g)'), 'd',
        'd = v^2 / (2 mu g)');
      const v = need(g, 'v', 'd = v^2 / (2 mu g)');
      const mu = requireNonZero(need(g, 'mu', 'd = v^2 / (2 mu g)'), 'mu',
        'd = v^2 / (2 mu g)');
      const gravity = v * v / (2 * mu * d);
      return stepSet('g = v^2 / (2 mu d)',
        `g = ${fmt(v)}^2 / (2 x ${fmt(mu)} x ${fmt(d)})`,
        [`g = ${fmt(v * v)} / ${fmt(2 * mu * d)}`, `g = ${fmt(gravity)} m/s2`]);
    },
  },
  apply: { v: 'speed', mu: 'friction' },
};

// ---------------------------------------------------------------------------
// Stopping time under friction: t = v / (mu g)
const stoppingTime = {
  id: 'stopping_time',
  name: 'Stopping time',
  formula: 't = v / (mu g)',
  variables: ['t', 'v', 'mu', 'g'],
  assumptions: ['Constant kinetic friction', 'Level lane', 'No other forces'],
  solve: {
    t: (g) => {
      const v = need(g, 'v', 't = v / (mu g)');
      const mu = need(g, 'mu', 't = v / (mu g)');
      const gravity = need(g, 'g', 't = v / (mu g)');
      const denom = requireNonZero(mu * gravity, 'mu g', 't = v / (mu g)');
      return stepSet('t = v / (mu g)',
        `t = ${fmt(v)} / (${fmt(mu)} x ${fmt(gravity)})`,
        [`t = ${fmt(v)} / ${fmt(denom)}`, `t = ${fmt(v / denom)} s`]);
    },
    v: (g) => {
      const t = need(g, 't', 't = v / (mu g)');
      const mu = need(g, 'mu', 't = v / (mu g)');
      const gravity = need(g, 'g', 't = v / (mu g)');
      return stepSet('v = t mu g',
        `v = ${fmt(t)} x ${fmt(mu)} x ${fmt(gravity)}`,
        [`v = ${fmt(t * mu * gravity)} m/s`]);
    },
    mu: (g) => {
      const t = requireNonZero(need(g, 't', 't = v / (mu g)'), 't',
        't = v / (mu g)');
      const v = need(g, 'v', 't = v / (mu g)');
      const gravity = requireNonZero(need(g, 'g', 't = v / (mu g)'), 'g',
        't = v / (mu g)');
      const mu = v / (gravity * t);
      return stepSet('mu = v / (g t)',
        `mu = ${fmt(v)} / (${fmt(gravity)} x ${fmt(t)})`,
        [`mu = ${fmt(v)} / ${fmt(gravity * t)}`, `mu = ${fmt(mu)}`]);
    },
    g: (g) => {
      const t = requireNonZero(need(g, 't', 't = v / (mu g)'), 't',
        't = v / (mu g)');
      const v = need(g, 'v', 't = v / (mu g)');
      const mu = requireNonZero(need(g, 'mu', 't = v / (mu g)'), 'mu',
        't = v / (mu g)');
      const gravity = v / (mu * t);
      return stepSet('g = v / (mu t)',
        `g = ${fmt(v)} / (${fmt(mu)} x ${fmt(t)})`,
        [`g = ${fmt(v)} / ${fmt(mu * t)}`, `g = ${fmt(gravity)} m/s2`]);
    },
  },
  apply: { v: 'speed', mu: 'friction' },
};

// ---------------------------------------------------------------------------
// Sideways velocity from speed and aim: vx = v sin(theta)
const sidewaysVelocity = {
  id: 'sideways_velocity',
  name: 'Sideways velocity',
  formula: 'vx = v sin(theta)',
  variables: ['vx', 'v', 'theta'],
  assumptions: ['Aim is measured from the lane axis', 'Positive aim points right'],
  solve: {
    vx: (g) => {
      const v = need(g, 'v', 'vx = v sin(theta)');
      const theta = need(g, 'theta', 'vx = v sin(theta)');
      const vx = v * Math.sin(theta * Math.PI / 180);
      return stepSet('vx = v sin(theta)',
        `vx = ${fmt(v)} sin(${fmt(theta)} deg)`,
        [`vx = ${fmt(vx)} m/s`]);
    },
    v: (g) => {
      const vx = need(g, 'vx', 'vx = v sin(theta)');
      const theta = need(g, 'theta', 'vx = v sin(theta)');
      const sine = requireNonZero(Math.sin(theta * Math.PI / 180), 'sin(theta)',
        'vx = v sin(theta)');
      return stepSet('v = vx / sin(theta)',
        `v = ${fmt(vx)} / sin(${fmt(theta)} deg)`,
        [`v = ${fmt(vx / sine)} m/s`]);
    },
    theta: (g) => {
      const vx = need(g, 'vx', 'vx = v sin(theta)');
      const v = requireNonZero(need(g, 'v', 'vx = v sin(theta)'), 'v',
        'vx = v sin(theta)');
      const ratio = vx / v;
      if (Math.abs(ratio) > 1 + 1e-9) {
        throw new EquationError('The sideways speed cannot exceed the total speed.');
      }
      const theta = Math.asin(Math.max(-1, Math.min(1, ratio))) * 180 / Math.PI;
      return stepSet('theta = asin(vx / v)',
        `theta = asin(${fmt(vx)} / ${fmt(v)})`,
        [`theta = asin(${fmt(ratio)})`, `theta = ${fmt(theta)} deg`]);
    },
  },
  apply: { v: 'speed', theta: 'aim' },
};

export const EQUATIONS = [
  uniformMotion, velocityTime, displacementTime, velocityDisplacement,
  force, work, kineticEnergy, torque, angularVelocity,
  frictionDeceleration, stoppingDistance, stoppingTime, sidewaysVelocity,
];

export function equationById(id) {
  return EQUATIONS.find((equation) => equation.id === id) || null;
}

function withDefaults(equation, given) {
  const values = { ...given };
  const notes = [];
  for (const symbol of equation.variables) {
    const meta = VARIABLES[symbol];
    if (meta && meta.default !== undefined && !Number.isFinite(values[symbol])) {
      values[symbol] = meta.default;
      notes.push(`${meta.label} (${symbol}) was not given; standard ${symbol} = ${fmt(meta.default)} ${meta.unit} is assumed.`);
    }
  }
  return { values, notes };
}

function missingFor(equation, find, values) {
  return equation.variables.filter((symbol) => {
    if (symbol === find) return false;
    const meta = VARIABLES[symbol];
    if (meta && meta.default !== undefined && !Number.isFinite(values[symbol])) return false;
    return !Number.isFinite(values[symbol]);
  });
}

function solveOne(equation, find, given) {
  if (!equation.solve[find]) {
    return {
      ok: false, equationId: equation.id, equationName: equation.name,
      formula: equation.formula, find, given: { ...given }, missing: [],
      message: `${equation.name} has no solver for ${find}.`,
      assumptions: equation.assumptions,
    };
  }
  const { values, notes: defaultNotes } = withDefaults(equation, given);
  const missing = missingFor(equation, find, values);
  if (missing.length) {
    const labels = missing.map((symbol) => `${VARIABLES[symbol].label} (${symbol})`);
    return {
      ok: false, equationId: equation.id, equationName: equation.name,
      formula: equation.formula, find, given: values, missing,
      message: `${labels.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} required to calculate ${VARIABLES[find].label} (${find}) using ${equation.formula}.`,
      assumptions: equation.assumptions,
    };
  }
  try {
    validateGiven(equation, values, find);
    const solution = equation.solve[find](values);
    const numeric = numericFromSolution(equation, find, values, solution);
    validateResult(find, numeric);
    const unit = VARIABLES[find].unit;
    return {
      ok: true, equationId: equation.id, equationName: equation.name,
      formula: equation.formula, find, given: values,
      rearranged: solution.rearranged, substitution: solution.substitution,
      steps: solution.steps, value: numeric, unit,
      answer: `${find} = ${fmt(numeric)}${unit ? ' ' + unit : ''}`,
      assumptions: [...equation.assumptions, ...defaultNotes, ...(solution.notes || [])],
      alternatives: solution.alternatives || [],
      apply: applyHints(equation, find, numeric, values),
      kind: 'analytical',
      exact: true,
      note: defaultNotes.join(' '),
    };
  } catch (error) {
    if (error instanceof EquationError) {
      return {
        ok: false, equationId: equation.id, equationName: equation.name,
        formula: equation.formula, find, given: values, missing: [],
        message: error.message, assumptions: equation.assumptions,
      };
    }
    throw error;
  }
}

function numericFromSolution(equation, find, values, solution) {
  // Each solver's final step ends in the numeric answer. Re-evaluate the
  // preferred formula directly so the UI never scrapes a rounded string.
  const table = {
    uniform_motion: {
      d: () => values.v * values.t,
      v: () => values.d / values.t,
      t: () => values.d / values.v,
    },
    velocity_time: {
      v: () => values.u + values.a * values.t,
      u: () => values.v - values.a * values.t,
      a: () => (values.v - values.u) / values.t,
      t: () => (values.v - values.u) / values.a,
    },
    displacement_time: {
      d: () => values.u * values.t + 0.5 * values.a * values.t * values.t,
      u: () => (values.d - 0.5 * values.a * values.t * values.t) / values.t,
      a: () => 2 * (values.d - values.u * values.t) / (values.t * values.t),
      t: () => {
        if (Math.abs(values.a) <= EPS) return values.d / values.u;
        const disc = values.u * values.u + 2 * values.a * values.d;
        return (-values.u + Math.sqrt(Math.max(0, disc))) / values.a;
      },
    },
    velocity_displacement: {
      v: () => Math.sqrt(Math.max(0, values.u * values.u + 2 * values.a * values.d)),
      u: () => Math.sqrt(Math.max(0, values.v * values.v - 2 * values.a * values.d)),
      a: () => (values.v * values.v - values.u * values.u) / (2 * values.d),
      d: () => (values.v * values.v - values.u * values.u) / (2 * values.a),
    },
    force: {
      F: () => values.m * values.a,
      m: () => values.F / values.a,
      a: () => values.F / values.m,
    },
    work: {
      W: () => values.F * values.d,
      F: () => values.W / values.d,
      d: () => values.W / values.F,
    },
    kinetic_energy: {
      K: () => 0.5 * values.m * values.v * values.v,
      m: () => 2 * values.K / (values.v * values.v),
      v: () => Math.sqrt(Math.max(0, 2 * values.K / values.m)),
    },
    torque: {
      tau: () => values.F * values.r,
      F: () => values.tau / values.r,
      r: () => values.tau / values.F,
    },
    angular_velocity: {
      v: () => values.omega * values.r,
      omega: () => values.v / values.r,
      r: () => values.v / values.omega,
    },
    friction_deceleration: {
      a: () => values.mu * values.g,
      mu: () => values.a / values.g,
      g: () => values.a / values.mu,
    },
    stopping_distance: {
      d: () => values.v * values.v / (2 * values.mu * values.g),
      v: () => Math.sqrt(Math.max(0, 2 * values.mu * values.g * values.d)),
      mu: () => values.v * values.v / (2 * values.g * values.d),
      g: () => values.v * values.v / (2 * values.mu * values.d),
    },
    stopping_time: {
      t: () => values.v / (values.mu * values.g),
      v: () => values.t * values.mu * values.g,
      mu: () => values.v / (values.g * values.t),
      g: () => values.v / (values.mu * values.t),
    },
    sideways_velocity: {
      vx: () => values.v * Math.sin(values.theta * Math.PI / 180),
      v: () => values.vx / Math.sin(values.theta * Math.PI / 180),
      theta: () => Math.asin(Math.max(-1, Math.min(1, values.vx / values.v))) * 180 / Math.PI,
    },
  };
  const value = table[equation.id][find]();
  if (!Number.isFinite(value)) {
    throw new EquationError('The result is not a finite number.');
  }
  return value;
}

function applyHints(equation, find, value, values) {
  const mapping = equation.apply || {};
  const target = mapping[find];
  if (!target) return {};
  if (target === 'deceleration') {
    if (equation.id === 'friction_deceleration') {
      return { deceleration: -Math.abs(value) };
    }
    if (value > 1e-9) {
      return { unsupported: 'The lane can slow the ball but cannot apply positive acceleration.' };
    }
    return { deceleration: -Math.abs(value) };
  }
  if (target === 'friction') {
    const gravity = Number.isFinite(values.g) ? values.g : GRAVITY;
    return { friction: value, deceleration: -Math.abs(value * gravity) };
  }
  if (target === 'speed') return { speed: Math.max(0, value) };
  if (target === 'aim') return { aim: value };
  return {};
}

function alternativeFor(find, given, excludeId) {
  for (const equation of EQUATIONS) {
    if (equation.id === excludeId || !equation.variables.includes(find)) continue;
    const attempt = solveOne(equation, find, given);
    if (attempt.ok) return attempt;
  }
  return null;
}

// Try the selected equation first, then any other supported equation that can
// use the same known values. Returns the result plus a `note` when a fallback
// equation was used.
export function solveEquation({ equationId, find, given = {} }) {
  const selected = equationById(equationId) || EQUATIONS[0];
  const first = solveOne(selected, find, given);
  if (first.ok) return { ...first, requestedEquationId: selected.id };
  const alternative = alternativeFor(find, given, selected.id);
  if (alternative) {
    const reason = first.missing.length
      ? 'needs more information'
      : `could not be used (${first.message})`;
    return {
      ...alternative,
      requestedEquationId: selected.id,
      note: `${alternative.note ? alternative.note + ' ' : ''}Used ${alternative.equationName} instead of ${selected.name} because ${selected.name} ${reason}.`,
    };
  }
  return { ...first, requestedEquationId: selected.id };
}
