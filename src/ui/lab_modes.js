// Physics Lab mode and lab definitions.
//
// A LAB is a full screen. A MODE is a calculator inside a lab. Bowling and the
// four new labs have one mode each; Linear Motion keeps the original Free Fall,
// Straight Line and Journey modes behind its own small switcher.
//
// Mode shape:
//   { id, label, variables[], defaultRows[], settings[], equations[],
//     scene, actionLabel, presets[] }
//
// Variable shape:
//   { key, label, unit, symbol, decimals, signed, group, ... }
//
// Groups are Given, Derived and Optional. The + Add variable menu shows every
// variable, grouped, even when only a few rows are visible by default.

import {
  VAR_FIELDS, CONST_FIELDS, EQUATIONS_BY_ID,
} from './lab_solver.js';
import { SUVAT_EQUATIONS } from './lab_suvat.js';

const BOWLING_NAMES = {
  start: 'Starting position',
  aim: 'Aim angle',
  hook: 'Hook spin',
  speed: 'Initial speed',
  finalSpeed: 'Final speed',
  distance: 'Distance travelled',
  time: 'Time',
  accel: 'Acceleration',
  sideways: 'Sideways speed',
  momentum: 'Momentum',
  energy: 'Energy',
  mass: 'Ball mass',
  mu: 'Friction coefficient',
  gravity: 'Gravity',
  length: 'Lane length',
  hookK: 'Hook constant',
};

const BOWLING_SYMBOLS = {
  start: 'x_0',
  aim: 'θ',
  hook: 'ω_s',
  speed: 'v_i',
  finalSpeed: 'v_f',
  distance: 'Δx',
  time: 't',
  accel: 'a',
  sideways: 'v_x',
  momentum: 'p',
  energy: 'K',
  mass: 'm',
  mu: 'μ',
  gravity: 'g',
  length: 'L',
  hookK: 'k',
};

const cleanLabel = (label) => String(label || '')
  .replace(/\s*\([^)]*\)\s*$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const cleanSymbol = (symbol) => {
  const text = String(symbol || '');
  const mapped = {
    vi: 'v_i', vf: 'v_f', vx: 'v_x', vy: 'v_y',
    v0: 'v_0', h0: 'h_0', vx0: 'v_x0', vy0: 'v_y0',
    xT: 'x_T', yT: 'y_T', vL: 'v_L', tA: 't_A', tH: 't_H',
    v̄x: 'v̄_x', v̄y: 'v̄_y', τnet: 'τ_net',
  }[text];
  if (mapped) return mapped;
  if (text === 'w') return 'ω';
  if (/^w\d$/.test(text)) return `ω_${text.slice(1)}`;
  if (/^I\d$/.test(text)) return `I_${text.slice(1)}`;
  if (text === 'at') return 'a_t';
  if (text === 'ac') return 'a_c';
  if (text === 'vt') return 'v_t';
  return text;
};

const cleanVariables = (variables) => variables.map((field) => ({
  ...field,
  label: cleanLabel(field.label),
  symbol: cleanSymbol(field.symbol),
}));

const BOWLING_BASE_VARIABLES = cleanVariables(VAR_FIELDS.map((field) => ({
  ...field,
  label: BOWLING_NAMES[field.key] || field.label,
  symbol: BOWLING_SYMBOLS[field.key] || field.symbol,
  decimals: 4,
  signed: field.min === undefined || field.min < 0,
  max: field.key === 'accel' ? undefined : field.max,
  help: field.key === 'accel'
    ? 'Signed constant acceleration. Positive means the ball is pushed forward.'
    : field.help,
  group: ['momentum', 'energy', 'sideways'].includes(field.key) ? 'Derived' : 'Given',
})));

const BOWLING_EXTRA_VARIABLES = cleanVariables([
  {
    key: 'finalSpeed',
    label: 'Final speed (vf)',
    unit: 'm/s',
    symbol: 'v_f',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Derived',
    help: 'Speed at the end of the measured travel.',
  },
  {
    key: 'distance',
    label: 'Distance travelled (dx)',
    unit: 'm',
    symbol: 'Δx',
    decimals: 4,
    signed: false,
    step: 0.1,
    min: 0,
    group: 'Given',
    help: 'Distance covered by the analytical motion. It defaults to the lane length.',
  },
  {
    key: 'mass',
    label: 'Ball mass (m)',
    unit: 'kg',
    symbol: 'm',
    decimals: 4,
    signed: false,
    step: 0.1,
    min: 0,
    group: 'Optional',
    help: 'Ball mass. It is also in Settings; typing it here overrides that setting.',
  },
  {
    key: 'mu',
    label: 'Friction coefficient (μ)',
    unit: '',
    symbol: 'μ',
    decimals: 4,
    signed: false,
    step: 0.001,
    min: 0,
    group: 'Optional',
    help: 'Rolling-resistance coefficient. Typing it here overrides the setting.',
  },
  {
    key: 'gravity',
    label: 'Gravity (g)',
    unit: 'm/s²',
    symbol: 'g',
    decimals: 4,
    signed: false,
    step: 0.01,
    min: 0,
    group: 'Optional',
    help: 'Gravitational acceleration. Typing it here overrides the setting.',
  },
  {
    key: 'length',
    label: 'Lane length (L)',
    unit: 'm',
    symbol: 'L',
    decimals: 4,
    signed: false,
    step: 0.01,
    min: 0,
    group: 'Optional',
    help: 'Foul line to head pin. It supplies the default distance.',
  },
  {
    key: 'hookK',
    label: 'Hook constant (k)',
    unit: 'm/s² per rad/s',
    symbol: 'k',
    decimals: 4,
    signed: false,
    step: 0.01,
    min: 0,
    group: 'Optional',
    help: 'Hook model constant: lateral acceleration per rad/s of spin.',
  },
]);

const BOWLING_VARIABLES = [...BOWLING_BASE_VARIABLES, ...BOWLING_EXTRA_VARIABLES];

const BOWLING_SETTINGS = [
  ...CONST_FIELDS.map((field) => ({
    ...field,
    type: 'number',
    decimals: 4,
  })),
  {
    key: 'laneMode',
    label: 'Lane',
    type: 'select',
    options: [
      { value: 'regulation', label: 'Regulation 18.29 m' },
      { value: 'extend', label: 'Extend to fit my values' },
    ],
    default: 'regulation',
    help: 'The analytical motion always uses the distance you type. Regulation shows the real lane; Extend follows a longer motion.',
  },
];

const BOWLING_EQUATIONS = Object.values(EQUATIONS_BY_ID).map((equation) => ({
  id: equation.id,
  name: equation.name,
  formula: equation.formula,
}));

// --- Linear Motion ---------------------------------------------------------

const FREE_FALL_VARIABLES = [
  {
    key: 'h',
    label: 'Signed height (y)',
    unit: 'm',
    symbol: 'y',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Signed height relative to the release point.',
  },
  {
    key: 'u',
    label: 'Initial velocity (vi)',
    unit: 'm/s',
    symbol: 'vi',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Velocity at release, with the sign convention applied.',
  },
  {
    key: 'v',
    label: 'Final velocity (vf)',
    unit: 'm/s',
    symbol: 'vf',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Velocity at the end of the interval.',
  },
  {
    key: 'a',
    label: 'Acceleration (a)',
    unit: 'm/s²',
    symbol: 'a',
    decimals: 4,
    signed: true,
    step: 0.01,
    group: 'Given',
    lockedIn: 'freefall',
    help: 'In Free Fall this is fixed to the gravity setting and is read-only.',
  },
  {
    key: 't',
    label: 'Time (t)',
    unit: 's',
    symbol: 't',
    decimals: 4,
    signed: false,
    step: 0.1,
    min: 0,
    group: 'Given',
    help: 'Time since release.',
  },
  {
    key: 'displacement',
    label: 'Displacement',
    unit: 'm',
    symbol: 'Δy',
    decimals: 4,
    signed: true,
    group: 'Derived',
    help: 'Signed change in position.',
  },
  {
    key: 'distance',
    label: 'Distance',
    unit: 'm',
    symbol: 'd',
    decimals: 4,
    signed: false,
    group: 'Derived',
    help: 'How far the object travelled, ignoring direction.',
  },
  {
    key: 'maxHeight',
    label: 'Max height',
    unit: 'm',
    symbol: 'H',
    decimals: 4,
    signed: false,
    group: 'Derived',
    help: 'Greatest height above the release point.',
  },
  {
    key: 'tApex',
    label: 'Time to highest point',
    unit: 's',
    symbol: 'tH',
    decimals: 4,
    signed: false,
    group: 'Derived',
    help: 'Time until the vertical velocity reaches zero.',
  },
  {
    key: 'avgSpeed',
    label: 'Average speed',
    unit: 'm/s',
    symbol: 'v̄',
    decimals: 4,
    signed: false,
    group: 'Derived',
    help: 'Distance divided by total time.',
  },
  {
    key: 'avgVelocity',
    label: 'Average velocity',
    unit: 'm/s',
    symbol: 'v̄y',
    decimals: 4,
    signed: true,
    group: 'Derived',
    help: 'Displacement divided by total time.',
  },
  {
    key: 'g',
    label: 'Gravity (g)',
    unit: 'm/s²',
    symbol: 'g',
    decimals: 4,
    signed: false,
    step: 0.01,
    min: 0,
    group: 'Optional',
    help: 'Gravitational acceleration. Typing it here overrides the Gravity setting.',
  },
];

const STRAIGHT_VARIABLES = [
  {
    key: 'u',
    label: 'Initial velocity (vi)',
    unit: 'm/s',
    symbol: 'vi',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Velocity at the start of the measured run.',
  },
  {
    key: 'v',
    label: 'Final velocity (vf)',
    unit: 'm/s',
    symbol: 'vf',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Velocity at the end of the run.',
  },
  {
    key: 's',
    label: 'Displacement (s)',
    unit: 'm',
    symbol: 's',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Signed displacement along the road. Forward is positive.',
  },
  {
    key: 'a',
    label: 'Acceleration (a)',
    unit: 'm/s²',
    symbol: 'a',
    decimals: 4,
    signed: true,
    step: 0.1,
    group: 'Given',
    help: 'Constant acceleration. Negative means braking.',
  },
  {
    key: 't',
    label: 'Time (t)',
    unit: 's',
    symbol: 't',
    decimals: 4,
    signed: false,
    step: 0.1,
    min: 0,
    group: 'Given',
    help: 'Duration of the run.',
  },
  {
    key: 'distance',
    label: 'Distance',
    unit: 'm',
    symbol: 'd',
    decimals: 4,
    signed: false,
    group: 'Derived',
    help: 'How far the object travelled, ignoring direction.',
  },
  {
    key: 'avgSpeed',
    label: 'Average speed',
    unit: 'm/s',
    symbol: 'v̄',
    decimals: 4,
    signed: false,
    group: 'Derived',
    help: 'Distance divided by total time.',
  },
  {
    key: 'avgVelocity',
    label: 'Average velocity',
    unit: 'm/s',
    symbol: 'v̄x',
    decimals: 4,
    signed: true,
    group: 'Derived',
    help: 'Displacement divided by total time.',
  },
];

const JOURNEY_VARIABLES = [
  {
    key: 'distance',
    label: 'Distance',
    unit: 'm',
    symbol: 'd',
    decimals: 4,
    signed: false,
    step: 0.1,
    min: 0,
    group: 'Given',
    help: 'Distance travelled on this leg.',
  },
  {
    key: 'direction',
    label: 'Direction',
    unit: '',
    symbol: '→',
    decimals: 0,
    signed: true,
    group: 'Given',
    help: 'East is positive, west is negative.',
  },
  {
    key: 'time',
    label: 'Time',
    unit: 's',
    symbol: 't',
    decimals: 4,
    signed: false,
    step: 0.01,
    min: 0,
    group: 'Given',
    help: 'Duration of this leg.',
  },
];

// --- Projectile Motion -----------------------------------------------------

const PROJECTILE_VARIABLES = [
  { key: 'v0', label: 'Launch speed (v0)', unit: 'm/s', symbol: 'v0', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Given', help: 'Initial speed at launch.' },
  { key: 'angle', label: 'Launch angle (θ)', unit: 'deg', symbol: 'θ', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: [{ unit: 'deg', label: 'deg' }, { unit: 'rad', label: 'rad', factor: Math.PI / 180 }], help: 'Launch angle above the horizontal.' },
  { key: 'h0', label: 'Launch height (h0)', unit: 'm', symbol: 'h0', decimals: 4, signed: true, step: 0.1, group: 'Given', help: 'Height of the launch point above the ground.' },
  { key: 'vx0', label: 'Horizontal velocity (vx0)', unit: 'm/s', symbol: 'vx0', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Horizontal component of launch velocity. It stays constant.' },
  { key: 'vy0', label: 'Initial vertical velocity (vy0)', unit: 'm/s', symbol: 'vy0', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Vertical component of launch velocity.' },
  { key: 'T', label: 'Flight time (T)', unit: 's', symbol: 'T', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Time from launch until the ball reaches the ground.' },
  { key: 'R', label: 'Range (R)', unit: 'm', symbol: 'R', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Horizontal distance travelled during the flight.' },
  { key: 'H', label: 'Max height (H)', unit: 'm', symbol: 'H', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Greatest height above the ground.' },
  { key: 'targetR', label: 'Target distance (xT)', unit: 'm', symbol: 'x_T', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Optional', help: 'Distance at which the barrier or target sits. It is also the horizontal position used by the target marker.' },
  { key: 'yTarget', label: 'Height at target (yT)', unit: 'm', symbol: 'y_T', decimals: 4, signed: true, step: 0.1, group: 'Given', help: 'Height of the ball when it reaches the target distance. It defaults to the launch height.' },
  { key: 'tTarget', label: 'Time at target (tT)', unit: 's', symbol: 't_T', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Time at which the ball reaches the target distance.' },
  { key: 'vTarget', label: 'Speed at target (vT)', unit: 'm/s', symbol: 'v_T', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Speed of the ball at the target distance.' },
  { key: 'landingSpeed', label: 'Landing speed', unit: 'm/s', symbol: 'vL', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Speed at the instant the ball lands.' },
  { key: 'timeApex', label: 'Time to apex', unit: 's', symbol: 'tA', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Derived', help: 'Time until the vertical velocity reaches zero.' },
  { key: 'landingAngle', label: 'Landing angle', unit: 'deg', symbol: 'φ', decimals: 4, signed: true, step: 0.1, group: 'Derived', unitOptions: [{ unit: 'deg', label: 'deg' }, { unit: 'rad', label: 'rad', factor: Math.PI / 180 }], help: 'Direction of travel at landing.' },
  { key: 'g', label: 'Gravity (g)', unit: 'm/s²', symbol: 'g', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Optional', help: 'Gravitational acceleration. Typing it here overrides the Gravity setting.' },
  { key: 'xAtT', label: 'Horizontal position at time t', unit: 'm', symbol: 'x(t)', decimals: 4, signed: true, step: 0.1, group: 'Optional', help: 'Horizontal position at the current flight time.' },
  { key: 'yAtT', label: 'Height at time t', unit: 'm', symbol: 'y(t)', decimals: 4, signed: true, step: 0.1, group: 'Optional', help: 'Height at the current flight time.' },
  { key: 'vyAtT', label: 'Vertical velocity at time t', unit: 'm/s', symbol: 'vy(t)', decimals: 4, signed: true, step: 0.1, group: 'Optional', help: 'Vertical velocity at the current flight time.' },
  { key: 'speedAtT', label: 'Speed at time t', unit: 'm/s', symbol: 'v(t)', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Optional', help: 'Speed at the current flight time.' },
  { key: 'dirAtT', label: 'Direction at time t', unit: 'deg', symbol: 'θ(t)', decimals: 4, signed: true, step: 0.1, group: 'Optional', unitOptions: [{ unit: 'deg', label: 'deg' }, { unit: 'rad', label: 'rad', factor: Math.PI / 180 }], help: 'Direction of travel at the current flight time.' },
];

// --- Rotational Motion -----------------------------------------------------

const RAD_PER_SEC_OPTIONS = [
  { unit: 'rad/s', label: 'rad/s' },
  { unit: 'rpm', label: 'rpm', factor: 60 / (Math.PI * 2) },
];
const RAD_OPTIONS = [
  { unit: 'rad', label: 'rad' },
  { unit: 'rev', label: 'rev', factor: 1 / (Math.PI * 2) },
];

const ROTATIONAL_VARIABLES = [
  { key: 'w0', label: 'Initial angular velocity (w0)', unit: 'rad/s', symbol: 'w0', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: RAD_PER_SEC_OPTIONS, help: 'Angular velocity at the start.' },
  { key: 'w', label: 'Final angular velocity (w)', unit: 'rad/s', symbol: 'w', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: RAD_PER_SEC_OPTIONS, help: 'Angular velocity at the end.' },
  { key: 'alpha', label: 'Angular acceleration (α)', unit: 'rad/s²', symbol: 'α', decimals: 4, signed: true, step: 0.1, group: 'Given', help: 'Constant angular acceleration.' },
  { key: 't', label: 'Time (t)', unit: 's', symbol: 't', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Given', help: 'Duration of the interval.' },
  { key: 'theta', label: 'Angular displacement (θ)', unit: 'rad', symbol: 'θ', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: RAD_OPTIONS, help: 'Angle turned through.' },
  { key: 'revolutions', label: 'Revolutions', unit: 'rev', symbol: 'N', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Angle divided by 2π.' },
  { key: 'rpm', label: 'Revolutions per minute', unit: 'rpm', symbol: 'rpm', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Angular velocity converted to rpm.' },
  { key: 'r', label: 'Radius (r)', unit: 'm', symbol: 'r', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Given', help: 'Radius of the rolling wheel or rotating object.' },
  { key: 'v', label: 'Tangential speed (vt)', unit: 'm/s', symbol: 'vt', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Tangential speed, vt = w r.' },
  { key: 'at', label: 'Tangential acceleration (at)', unit: 'm/s²', symbol: 'at', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Tangential acceleration, at = α r.' },
  { key: 'ac', label: 'Centripetal acceleration (ac)', unit: 'm/s²', symbol: 'ac', decimals: 4, signed: false, step: 0.1, group: 'Derived', help: 'Centripetal acceleration, ac = w² r = v²/r.' },
  { key: 'distance', label: 'Arc length (s)', unit: 'm', symbol: 's', decimals: 4, signed: false, step: 0.1, group: 'Derived', help: 'Arc length, s = θ r (rolling distance without slipping).' },
];

// --- Torque ----------------------------------------------------------------

const TORQUE_VARIABLES = [
  { key: 'F', label: 'Force (F)', unit: 'N', symbol: 'F', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Given', help: 'Magnitude of the first force.' },
  { key: 'r', label: 'Lever arm (r)', unit: 'm', symbol: 'r', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Given', help: 'Distance from the pivot to the force.' },
  { key: 'angle', label: 'Angle between F and r (θ)', unit: 'deg', symbol: 'θ', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: [{ unit: 'deg', label: 'deg' }, { unit: 'rad', label: 'rad', factor: Math.PI / 180 }], help: 'Angle between the force and the lever arm.' },
  { key: 'torque', label: 'Torque (τ)', unit: 'N·m', symbol: 'τ', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Torque from the first force, τ = r F sin θ.' },
  { key: 'Fperp', label: 'Perpendicular force (F sin θ)', unit: 'N', symbol: 'F⊥', decimals: 4, signed: false, step: 0.1, group: 'Derived', help: 'Component that produces torque.' },
  { key: 'Fpar', label: 'Parallel force (F cos θ)', unit: 'N', symbol: 'F∥', decimals: 4, signed: false, step: 0.1, group: 'Derived', help: 'Component along the lever arm. It produces no torque.' },
  { key: 'leverArm', label: 'Lever arm (r sin θ)', unit: 'm', symbol: 'd', decimals: 4, signed: false, step: 0.01, group: 'Derived', help: 'Perpendicular distance from the pivot to the force line.' },
  { key: 'direction', label: 'Direction', unit: '', symbol: '↻', decimals: 0, signed: false, group: 'Optional', type: 'select', options: [{ value: 'ccw', label: 'Counterclockwise' }, { value: 'cw', label: 'Clockwise' }], help: 'Direction of the first force about the pivot.' },
  { key: 'I', label: 'Moment of inertia (I)', unit: 'kg·m²', symbol: 'I', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Given', help: 'Resistance to angular acceleration.' },
  { key: 'alpha', label: 'Angular acceleration (α)', unit: 'rad/s²', symbol: 'α', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Angular acceleration from the net torque.' },
  { key: 'netTorque', label: 'Net torque (τnet)', unit: 'N·m', symbol: 'τnet', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'Signed sum of all torques, counterclockwise positive.' },
  { key: 'm1', label: 'Mass 1 (m1)', unit: 'kg', symbol: 'm_1', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Optional', help: 'First mass on the seesaw balance.' },
  { key: 'r1', label: 'Lever arm 1 (r1)', unit: 'm', symbol: 'r_1', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Optional', help: 'Distance of the first mass from the pivot.' },
  { key: 'm2', label: 'Mass 2 (m2)', unit: 'kg', symbol: 'm_2', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Optional', help: 'Second mass on the seesaw balance.' },
  { key: 'r2', label: 'Lever arm 2 (r2)', unit: 'm', symbol: 'r_2', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Optional', help: 'Distance of the second mass from the pivot.' },
];

// --- Moment of Inertia -----------------------------------------------------

const INERTIA_VARIABLES = [
  { key: 'M', label: 'Mass (M)', unit: 'kg', symbol: 'M', decimals: 4, signed: false, step: 0.1, min: 0, group: 'Given', help: 'Mass of the shape or moving object.' },
  { key: 'R', label: 'Radius (R)', unit: 'm', symbol: 'R', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Given', help: 'Radius used by the selected shape.' },
  { key: 'L', label: 'Length (L)', unit: 'm', symbol: 'L', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Given', help: 'Rod length, when the selected shape needs it.' },
  { key: 'I', label: 'Moment of inertia (I)', unit: 'kg·m²', symbol: 'I', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Derived', help: 'Moment of inertia for the selected shape.' },
  { key: 'w', label: 'Angular velocity (w)', unit: 'rad/s', symbol: 'w', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: RAD_PER_SEC_OPTIONS, help: 'Angular velocity of the spinning object.' },
  { key: 'Lm', label: 'Angular momentum (L)', unit: 'kg·m²/s', symbol: 'L', decimals: 4, signed: true, step: 0.1, group: 'Derived', help: 'L = I w.' },
  { key: 'I1', label: 'Initial moment of inertia (I1)', unit: 'kg·m²', symbol: 'I1', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Given', help: 'Moment of inertia before the change.' },
  { key: 'w1', label: 'Initial angular velocity (w1)', unit: 'rad/s', symbol: 'w1', decimals: 4, signed: true, step: 0.1, group: 'Given', unitOptions: RAD_PER_SEC_OPTIONS, help: 'Angular velocity before the change.' },
  { key: 'I2', label: 'Final moment of inertia (I2)', unit: 'kg·m²', symbol: 'I2', decimals: 4, signed: false, step: 0.01, min: 0, group: 'Derived', help: 'Moment of inertia after the change.' },
  { key: 'w2', label: 'Final angular velocity (w2)', unit: 'rad/s', symbol: 'w2', decimals: 4, signed: true, step: 0.1, group: 'Derived', unitOptions: RAD_PER_SEC_OPTIONS, help: 'Angular velocity after the change.' },
];

const GRAVITY_SETTING = {
  key: 'gravity',
  label: 'Gravity',
  type: 'select-number',
  options: [
    { value: 9.8, label: '9.8 m/s²' },
    { value: 9.81, label: '9.81 m/s²' },
  ],
  default: 9.8,
  help: 'Use 9.8 unless your class asks for 9.81.',
};

const SIGN_SETTING = {
  key: 'signConvention',
  label: 'Sign convention',
  type: 'select',
  options: [
    { value: 'notes', label: 'Class notes (up +)' },
    { value: 'travel', label: 'Travel direction +' },
  ],
  default: 'notes',
  help: 'Class notes: up is positive, down is negative. Travel: the initial direction is positive.',
};

export const MODES = [
  {
    id: 'bowling',
    label: 'Bowling',
    variables: BOWLING_VARIABLES,
    defaultRows: ['speed', 'time', 'accel'],
    settings: BOWLING_SETTINGS,
    equations: BOWLING_EQUATIONS,
    scene: 'bowling',
    actionLabel: 'BOWL',
    presets: [],
  },
  {
    id: 'freefall',
    label: 'Free Fall',
    variables: cleanVariables(FREE_FALL_VARIABLES),
    defaultRows: ['h', 'u', 'v', 't', 'a'],
    settings: [
      GRAVITY_SETTING,
      SIGN_SETTING,
      {
        key: 'note',
        label: 'Model note',
        type: 'note',
        text: 'These equations need constant, non-zero acceleration along a straight path.',
      },
    ],
    equations: [
      ...SUVAT_EQUATIONS,
      { id: 'FF', name: 'Free-fall direction', formula: 'a = −g (up +) or a = +g (travel +)' },
    ],
    scene: 'freefall',
    actionLabel: 'RUN',
    directionKey: 'direction',
    presets: [
      { id: 'dropped-44', label: 'Dropped from 44.1 m', direction: 'dropped', values: { h: -44.1 } },
      { id: 'thrown-up-19', label: 'Thrown up at 19.6 m/s', direction: 'up', values: { u: 19.6, v: 0 } },
    ],
  },
  {
    id: 'straight',
    label: 'Straight Line',
    variables: cleanVariables(STRAIGHT_VARIABLES),
    defaultRows: ['u', 'v', 's'],
    settings: [
      {
        key: 'body',
        label: 'Object type',
        type: 'select',
        options: ['Car', 'Ball', 'Cyclist'],
        default: 'Car',
        help: 'Only changes the scene sprite.',
      },
      {
        key: 'constantSpeed',
        label: 'Constant speed',
        type: 'checkbox',
        default: false,
        help: 'Locks acceleration to 0, so two knowns are enough.',
      },
      {
        key: 'note',
        label: 'Model note',
        type: 'note',
        text: 'These equations need constant acceleration along a straight path.',
      },
    ],
    equations: SUVAT_EQUATIONS,
    scene: 'straight',
    actionLabel: 'RUN',
    presets: [
      { id: 'braking-car', label: 'Braking car (20 m/s to rest over 50 m)', values: { u: 20, v: 0, s: 50 } },
    ],
  },
  {
    id: 'journey',
    label: 'Journey',
    variables: cleanVariables(JOURNEY_VARIABLES),
    defaultRows: [],
    settings: [],
    equations: [
      { id: 'JD', name: 'Total distance', formula: 'total distance = Σ |leg|' },
      { id: 'JX', name: 'Displacement', formula: 'displacement = Σ direction·leg' },
      { id: 'JS', name: 'Average speed', formula: 'average speed = total distance / total time' },
      { id: 'JV', name: 'Average velocity', formula: 'average velocity = displacement / total time' },
    ],
    scene: 'journey',
    actionLabel: 'RUN',
    presets: [
      {
        id: 'cyclist-out-back',
        label: 'Cyclist: 120 m east in 20 s, then 80 m west in 10 s',
        legs: [
          { distance: 120, direction: 1, time: 20 },
          { distance: 80, direction: -1, time: 10 },
        ],
      },
    ],
  },
  {
    id: 'projectile',
    label: 'Projectile Motion',
    variables: cleanVariables(PROJECTILE_VARIABLES),
    defaultRows: ['v0', 'angle', 'h0', 'R'],
    settings: [
      GRAVITY_SETTING,
      {
        key: 'launchType',
        label: 'Launch type',
        type: 'select',
        options: [
          { value: 'ground', label: 'Ground launch' },
          { value: 'horizontal', label: 'Horizontal launch' },
          { value: 'angled', label: 'From a height' },
        ],
        default: 'angled',
        help: 'Ground launch locks height to 0; horizontal launch locks the angle to 0.',
      },
      {
        key: 'barrierEnabled',
        label: 'Barrier',
        type: 'checkbox',
        default: false,
        help: 'Show a barrier and report whether the ball clears it.',
      },
      {
        key: 'barrierDistance',
        label: 'Barrier distance',
        unit: 'm',
        type: 'number',
        step: 0.1,
        min: 0,
        default: 8,
        help: 'Horizontal distance to the barrier.',
      },
      {
        key: 'barrierHeight',
        label: 'Barrier height',
        unit: 'm',
        type: 'number',
        step: 0.1,
        min: 0,
        default: 2,
        help: 'Height of the barrier.',
      },
      {
        key: 'note',
        label: 'Model note',
        type: 'note',
        text: 'These equations need constant, non-zero acceleration along a straight path.',
      },
    ],
    equations: [
      { id: 'P1', name: 'Horizontal velocity', formula: 'vx0 = v0·cos θ' },
      { id: 'P2', name: 'Vertical velocity', formula: 'vy0 = v0·sin θ' },
      { id: 'P3', name: 'Flight time', formula: 'T from h0 + vy0·T − ½gT² = 0' },
      { id: 'P4', name: 'Range', formula: 'R = vx0·T' },
      { id: 'P5', name: 'Maximum height', formula: 'H = h0 + vy0²/(2g)' },
      { id: 'P6', name: 'Trajectory', formula: 'y(x) = h0 + x·tan θ − gx²/(2v0²cos²θ)' },
    ],
    scene: 'projectile',
    actionLabel: 'RUN',
    presets: [
      { id: 'q6', label: 'Q6 Horizontal launch (19.6 m, 5 m/s)', launchType: 'horizontal', values: { v0: 5, angle: 0, h0: 19.6 } },
      { id: 'q7', label: 'Q7 Football kick (20 m/s, 30°)', launchType: 'angled', values: { v0: 20, angle: 30, h0: 0 } },
      { id: 'q8', label: 'Q8 Fountain (14 m/s, 45°)', launchType: 'angled', values: { v0: 14, angle: 45, h0: 0 } },
      { id: 'q9', label: 'Q9 Barrier (12 m/s, 30°, 2 m at 8 m)', launchType: 'angled', values: { v0: 12, angle: 30, h0: 0, targetR: 8 }, barrier: { enabled: true, height: 2, distance: 8 } },
      { id: 'q10', label: 'Q10 Reach a target (30°, 30 m)', launchType: 'angled', values: { angle: 30, h0: 0, R: 30, targetR: 30 } },
    ],
  },
  {
    id: 'rotational',
    label: 'Rotational Motion',
    variables: cleanVariables(ROTATIONAL_VARIABLES),
    defaultRows: ['w0', 'w', 'alpha', 't'],
    settings: [
      {
        key: 'constantSpeed',
        label: 'Constant speed',
        type: 'checkbox',
        default: false,
        help: 'Locks angular acceleration to 0, so two knowns are enough.',
      },
    ],
    equations: [
      { id: 'R1', name: 'Angular velocity–time', formula: 'w = w0 + α t' },
      { id: 'R2', name: 'Angle–time', formula: 'θ = w0 t + ½ α t²' },
      { id: 'R3', name: 'Angular velocity–angle', formula: 'w² = w0² + 2 α θ' },
      { id: 'R4', name: 'Average angular velocity', formula: 'θ = ½ (w0 + w) t' },
      { id: 'R5', name: 'Revolutions', formula: 'revolutions = θ / 2π' },
      { id: 'R6', name: 'rpm', formula: 'rpm = w × 60 / 2π' },
      { id: 'R7', name: 'Linear speed', formula: 'v = w r' },
      { id: 'R8', name: 'Rolling distance', formula: 'distance = θ r' },
    ],
    scene: 'rotational',
    actionLabel: 'RUN',
    presets: [
      { id: 'q11', label: 'Q11 Fan (α = 3.14 rad/s², 9 rev)', values: { w0: 0, t: 6, alpha: 3.141592653589793 } },
      { id: 'q12', label: 'Q12 Accelerating wheel (w = 20, θ = 96)', values: { w0: 4, alpha: 2, t: 8 } },
      { id: 'q13', label: 'Q13 Turntable (30 rev, 188.5 rad)', values: { w0: 0, t: 10, theta: 188.4955592153876 } },
      { id: 'q14', label: 'Q14 Bicycle wheel (v = 3.5 m/s, d = 21 m)', values: { w0: 10, w: 10, t: 6, r: 0.35, theta: 60 } },
      { id: 'q15', label: 'Q15 Stopping motor (t = 10 s, θ = 150 rad)', values: { w0: 10, t: 10, theta: 150 } },
    ],
  },
  {
    id: 'torque',
    label: 'Torque',
    variables: cleanVariables(TORQUE_VARIABLES),
    defaultRows: ['torque', 'I', 'alpha'],
    settings: [],
    equations: [
      { id: 'T1', name: 'Torque', formula: 'τ = r F sin θ' },
      { id: 'T2', name: 'Net torque', formula: 'τnet = Σ signed torques (CCW +)' },
      { id: 'T3', name: 'Angular acceleration', formula: 'α = τnet / I' },
      { id: 'T4', name: 'Seesaw balance', formula: 'm1 g r1 = m2 g r2' },
    ],
    scene: 'torque',
    actionLabel: 'RUN',
    presets: [
      { id: 'q16', label: 'Q16 Door (100 N at 0.2 m, 90°)', scene: 'door', values: { I: 5 }, forces: [{ F: 100, r: 0.2, angle: 90, direction: 1 }] },
      { id: 'q17', label: 'Q17 Wrench (30 N at 0.3 m, 90°)', scene: 'wrench', values: { I: 3 }, forces: [{ F: 30, r: 0.3, angle: 90, direction: 1 }] },
      { id: 'q18', label: 'Q18 Seesaw (90 kg at 0.5 m, 30 kg at 1.5 m)', scene: 'seesaw', values: { I: 12 }, forces: [{ F: 90 * 9.8, r: 0.5, angle: 90, direction: -1 }, { F: 30 * 9.8, r: 1.5, angle: 90, direction: 1 }] },
      { id: 'q19', label: 'Q19 Opposing torques (4 CCW, 7.2 CW)', scene: 'wheel', values: { I: 2 }, forces: [{ F: 20, r: 0.2, angle: 90, direction: 1 }, { F: 36, r: 0.2, angle: 90, direction: -1 }] },
      { id: 'q20', label: 'Q20 Pulley (15 N at 0.2 m, I = 0.5)', scene: 'pulley', values: { I: 0.5 }, forces: [{ F: 15, r: 0.2, angle: 90, direction: 1 }] },
    ],
  },
  {
    id: 'inertia',
    label: 'Moment of Inertia',
    variables: cleanVariables(INERTIA_VARIABLES),
    defaultRows: ['M', 'R', 'I', 'w', 'Lm'],
    settings: [],
    equations: [
      { id: 'I1', name: 'Solid disk', formula: 'I = ½ M R²' },
      { id: 'I2', name: 'Thin ring', formula: 'I = M R²' },
      { id: 'I3', name: 'Rod about end', formula: 'I = ⅓ M L²' },
      { id: 'I4', name: 'Rod about center', formula: 'I = 1/12 M L²' },
      { id: 'I5', name: 'Point mass', formula: 'I = m r²' },
      { id: 'I6', name: 'Angular momentum', formula: 'L = I w' },
      { id: 'I7', name: 'Conservation', formula: 'I1 w1 = I2 w2' },
      { id: 'I8', name: 'Composite', formula: 'I_total = I_platform + m r²' },
    ],
    scene: 'inertia',
    actionLabel: 'RUN',
    presets: [
      { id: 'q21', label: 'Q21 Solid disk (4 kg, R = 0.3 m)', submode: 'shape', shape: 'disk', values: { M: 4, R: 0.3 } },
      { id: 'q22', label: 'Q22 Rod (3 kg, L = 2 m)', submode: 'shape', shape: 'rodEnd', values: { M: 3, L: 2 } },
      { id: 'q23', label: 'Q23 Ring (I = 0.125, L = 1.5)', submode: 'shape', shape: 'ring', values: { M: 0.5, R: 0.5, w: 12 } },
      { id: 'q24', label: 'Q24 Skater (arms in)', submode: 'conservation', values: { I1: 4, w1: 2, I2: 1 } },
      { id: 'q25', label: 'Q25 Sandbag (I = 2.25, w = 3.56)', submode: 'collision', values: { I1: 2, w1: 4, M: 1, R: 0.5 } },
    ],
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((mode) => [mode.id, mode]));
export const DEFAULT_MODE = 'bowling';

export const LABS = [
  { id: 'bowling', label: 'Bowling', title: 'PHYSICS LAB', modes: ['bowling'] },
  { id: 'linear', label: 'Linear Motion', title: 'LINEAR MOTION', modes: ['freefall', 'straight', 'journey'] },
  { id: 'projectile', label: 'Projectile Motion', title: 'PROJECTILE MOTION', modes: ['projectile'] },
  { id: 'rotational', label: 'Rotational Motion', title: 'ROTATIONAL MOTION', modes: ['rotational'] },
  { id: 'torque', label: 'Torque', title: 'TORQUE', modes: ['torque'] },
  { id: 'inertia', label: 'Moment of Inertia & Angular Momentum', title: 'MOMENT OF INERTIA & ANGULAR MOMENTUM', modes: ['inertia'] },
];

export const LAB_BY_ID = Object.fromEntries(LABS.map((lab) => [lab.id, lab]));
export const LINEAR_MODES = ['freefall', 'straight', 'journey'];

export function variablesFor(mode) {
  return Object.fromEntries(mode.variables.map((field) => [field.key, field]));
}

export function newModeState(mode) {
  if (mode.id === 'journey') {
    return {
      given: {},
      rowKeys: [],
      openFormulas: new Set(),
      lastCommitted: {},
      lastEditedKey: null,
      legs: [
        { distance: null, direction: 1, time: null },
        { distance: null, direction: 1, time: null },
      ],
      typedResults: {},
    };
  }
  const settings = {};
  for (const setting of mode.settings) {
    if (setting.type === 'note') continue;
    settings[setting.key] = setting.default;
  }
  if (mode.id === 'freefall') {
    settings.direction = 'dropped';
    settings.atHighest = false;
    settings.signConvention = settings.signConvention || 'notes';
    settings.gravity = settings.gravity || 9.8;
  }
  if (mode.id === 'projectile') {
    settings.launchType = 'angled';
    settings.gravity = settings.gravity || 9.8;
  }
  if (mode.id === 'torque') {
    settings.scene = 'door';
  }
  if (mode.id === 'rotational') {
    settings.rolling = false;
  }
  if (mode.id === 'inertia') {
    settings.submode = 'shape';
    settings.shape = 'disk';
  }  const state = {
    given: {},
    rowKeys: [...mode.defaultRows],
    openFormulas: new Set(),
    lastCommitted: {},
    lastEditedKey: null,
    settings,
  };
  if (mode.id === 'torque') {
    state.forces = [{ F: 100, r: 0.2, angle: 90, direction: 1 }];
  }
  if (mode.id === 'inertia') {
    state.customParts = [{ m: 1, r: 0.5 }];
  }
  return state;
}
