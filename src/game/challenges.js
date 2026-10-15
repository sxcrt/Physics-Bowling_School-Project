// Equation Mode: physics challenges (ported from game/challenges.py).
import * as config from '../config.js';

export const GRAVITY = config.GRAVITY;
export const BALL_R = config.BALL_RADIUS;
export const BALL_MASS = config.BALL_MASS;
export const PIN_MASS = config.PIN_MASS;
export const MU_K = config.SLIDING_FRICTION;
export const MU_R = config.ROLLING_FRICTION;
export const RESTITUTION = config.RESTITUTION_BALL_PIN;

export const ROW_DEPTH = config.PIN_SPACING * Math.cos(30.0 * Math.PI / 180);
export const HEAD_Z = config.HEAD_PIN_Z;

export const PIN_SLOTS = [
  ['1', 0.0000, HEAD_Z],
  ['2', -0.1525, HEAD_Z + ROW_DEPTH],
  ['3', 0.1525, HEAD_Z + ROW_DEPTH],
  ['4', -0.3050, HEAD_Z + 2 * ROW_DEPTH],
  ['5', 0.0000, HEAD_Z + 2 * ROW_DEPTH],
  ['6', 0.3050, HEAD_Z + 2 * ROW_DEPTH],
  ['7', -0.4575, HEAD_Z + 3 * ROW_DEPTH],
  ['8', -0.1525, HEAD_Z + 3 * ROW_DEPTH],
  ['9', 0.1525, HEAD_Z + 3 * ROW_DEPTH],
  ['10', 0.4575, HEAD_Z + 3 * ROW_DEPTH],
];
export const SLOTS = Object.fromEntries(PIN_SLOTS.map(([label, x, z]) => [label, [x, z]]));

export const CONTACT_REACH = BALL_R + config.PIN_MAX_RADIUS;
export const A_SLIDE = MU_K * GRAVITY;
export const DRIFT_PER_SPIN = (2.0 / 7.0) * BALL_R;
export const DRIFT_QUADRATIC = (2.0 / 49.0) * BALL_R ** 2 / A_SLIDE;

// --- number formatters matching Python's format specifiers ---
function gfmt(x, sig) {
  if (x === 0) return '0';
  let s = x.toPrecision(sig);
  if (s.includes('e')) return s.replace(/\.?0+e/, 'e').replace('e+', 'e');
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s;
}
function gsign(x, sig) { return (x >= 0 ? '+' : '') + gfmt(x, sig); }
function ffmt(x, places) { return x.toFixed(places); }
function fsign(x, places) { return (x >= 0 ? '+' : '') + x.toFixed(places); }

export function momentOfInertia(mass = BALL_MASS, radius = BALL_R) {
  if (config.BALL_INERTIA_TYPE === 'shell') return (2.0 / 3.0) * mass * radius ** 2;
  return (2.0 / 5.0) * mass * radius ** 2;
}
export function slipTime(spin) { return 2.0 * BALL_R * Math.abs(spin) / (7.0 * MU_K * GRAVITY); }

export function hookDrift(spin, speed, distance) {
  if (speed <= 0.0) return 0.0;
  const travelTime = distance / speed;
  return -DRIFT_PER_SPIN * spin * (travelTime - 0.5 * slipTime(spin));
}

export function spinForDrift(drift, speed, distance) {
  if (Math.abs(drift) < 1e-12) return 0.0;
  if (speed <= 0.0) return null;
  const travelTime = distance / speed;
  const b = DRIFT_PER_SPIN * travelTime;
  const discriminant = b * b - 4.0 * DRIFT_QUADRATIC * Math.abs(drift);
  if (discriminant < 0.0) return null;
  const magnitude = (b - Math.sqrt(discriminant)) / (2.0 * DRIFT_QUADRATIC);
  return -Math.sign(drift) * magnitude;
}

export function arrivalSpeed(releaseSpeed, distance, mu = MU_R) {
  const remaining = releaseSpeed ** 2 - 2.0 * mu * GRAVITY * distance;
  return remaining > 0.0 ? Math.sqrt(remaining) : 0.0;
}
export function releaseSpeedForArrival(arrival, distance, mu = MU_R) {
  return Math.sqrt(arrival ** 2 + 2.0 * mu * GRAVITY * distance);
}
export function pinSpeedFromImpact(ballSpeed) {
  const inverse = 1.0 / BALL_MASS + 2.0 / PIN_MASS;
  return (1.0 + RESTITUTION) * ballSpeed / inverse / PIN_MASS;
}
export function impactSpeedForPinSpeed(pinSpeed) {
  const inverse = 1.0 / BALL_MASS + 2.0 / PIN_MASS;
  return pinSpeed * PIN_MASS * inverse / (1.0 + RESTITUTION);
}
export function spinFromAngularMomentum(momentum, inertia = null) {
  inertia = inertia === null ? momentOfInertia() : inertia;
  return momentum / inertia;
}
export function angularMomentumOfSpin(spin, inertia = null) {
  inertia = inertia === null ? momentOfInertia() : inertia;
  return inertia * spin;
}
export function spinFromTorque(torque, spinUpTime, inertia = null) {
  inertia = inertia === null ? momentOfInertia() : inertia;
  return torque * spinUpTime / inertia;
}
export function torqueForSpin(spin, spinUpTime, inertia = null) {
  inertia = inertia === null ? momentOfInertia() : inertia;
  return inertia * spin / spinUpTime;
}

// --- data structures ---
export class ChallengeInput {
  constructor(key, label, unit, low, high, def = 0.0) {
    this.key = key; this.label = label; this.unit = unit;
    this.low = low; this.high = high; this.default = def;
  }
}

export class RollMeasurement {
  constructor(data = {}) { Object.assign(this, {
    value: 0, targets_down: [], pins_down: [], knockdowns: 0, launch_x: 0.0,
    landing_x: null, pass_error: null, impact_speed: null, pin_speed: null,
    gutter: false, gutter_z: null, path: [], spin: 0.0,
  }, data); }
  targetDown() { return this.targets_down.length > 0 && this.targets_down.every(Boolean); }
}

export class ChallengeOutcome {
  constructor(solved, headline, verdict = '', lines = [], measurement = {}) {
    this.solved = solved; this.headline = headline; this.verdict = verdict;
    this.lines = lines; this.measurement = measurement;
  }
}

export class EquationChallenge {
  constructor(data) {
    // Dataclass defaults from game/challenges.py.
    this.id = '';
    this.case = '';
    this.title = '';
    this.brief = '';
    this.target = '';
    this.rack = [];
    this.control = null;
    this.fixed = {};
    this.answer = 0.0;
    this.kind = 'hit';
    this.threshold = 0.0;
    this.targets = [0];
    this.equation = '';
    this.equation_note = '';
    this.given = [];
    this.given_values = {};
    this.steps = [];
    this.working = '';
    this.advice = [];
    this.assumptions = '';
    this.sign_note = '';
    this.spin_up_time = 0.0;
    this.tolerance = 0.05;
    Object.assign(this, data);
  }

  positions() { return this.rack.map(([, x, z]) => [x, z]); }
  targetPins() { return this.targets.map((i) => this.rack[i]); }
  aimX() { return this.rack[this.targets[0]][1]; }
  aimZ() { return Math.max(...this.targets.map((i) => this.rack[i][2])); }

  launchValues(value) {
    let position = this.fixed.position ?? 0.0;
    let speed = this.fixed.speed ?? 0.0;
    let angle = this.fixed.angle_deg ?? 0.0;
    let spin = this.fixed.spin ?? 0.0;
    const key = this.control.key;
    if (key === 'position') position = value;
    else if (key === 'speed') speed = value;
    else if (key === 'angle') angle = value;
    else if (key === 'spin') spin = value;
    else if (key === 'torque') spin = spinFromTorque(value, this.spin_up_time, momentOfInertia());
    return [position, speed, angle, spin];
  }

  expectedText() { return `${gfmt(this.answer, 3)} ${this.control.unit}`.trim(); }

  derivedText(value) {
    if (this.control.key !== 'torque') return '';
    const spin = spinFromTorque(value, this.spin_up_time, momentOfInertia());
    return `tau = ${gfmt(value, 3)} N m over ${ffmt(this.spin_up_time, 2)} s -> omega = tau dt / I = ${gsign(spin, 3)} rad/s`;
  }

  evaluate(measurement) {
    if (this.kind === 'hit') return this._evaluateHit(measurement);
    if (this.kind === 'arrival') return this._evaluateArrival(measurement);
    return this._evaluatePinSpeed(measurement);
  }

  _directionText(measurement) {
    if (measurement.landing_x === null) return 'the ball never reached the pin line';
    const offset = measurement.landing_x - this.aimX();
    const side = offset >= 0 ? 'right' : 'left';
    return `the ball crossed the pin line at x = ${fsign(measurement.landing_x, 3)} m (${ffmt(Math.abs(offset), 3)} m to the ${side} of the pin)`;
  }

  _evaluateHit(measurement) {
    const solved = measurement.targetDown();
    const pin = this.targetPins()[0][0];
    const needed = this.aimX() - measurement.launch_x;
    const got = measurement.landing_x !== null ? measurement.landing_x - measurement.launch_x : null;
    if (solved) {
      return new ChallengeOutcome(true, `PIN ${pin} DOWN!`,
        'Solved: the simulation agrees with the calculation.',
        [
          `Input ${gfmt(measurement.value, 3)} ${this.control.unit}: the ball crossed the pin line within ${ffmt(measurement.pass_error, 3)} m of the ${pin} pin axis (contact is within ${ffmt(CONTACT_REACH, 3)} m).`,
          `It moved ${fsign(needed, 3)} m sideways over ${ffmt(this.aimZ(), 2)} m of lane - the drift you calculated.`,
          'The pin fell because the physics moved it: same launch data, same deck, same integration as every other mode.',
        ], this._summary(measurement));
    }
    const offset = measurement.landing_x !== null ? measurement.landing_x - this.aimX() : null;
    const wrongWay = got === null || needed === null || got * needed < 0.0 || Math.abs(got) < Math.abs(needed);
    let headline, verdict, why;
    if (measurement.gutter) {
      headline = 'IN THE GUTTER';
      verdict = 'Too much spin: the ball left the lane before the pin.';
      why = `The hook slip and its friction over-curved the path: the spin was too large, so the ball reached the gutter at ${ffmt(measurement.gutter_z, 1)} m, before the ${pin} pin at ${ffmt(this.aimZ(), 2)} m.`;
    } else if (offset === null) {
      headline = `NEVER REACHED THE ${pin} PIN`;
      verdict = 'The ball stopped short of the pin.';
      why = this.advice.length > 0 ? this.advice[0] : 'Increase the value and bowl again: the equation says how much.';
    } else {
      const side = offset < 0 ? 'LEFT' : 'RIGHT';
      headline = `MISSED THE ${pin} PIN - TOO FAR ${side}`;
      verdict = wrongWay ? 'The ball fell short of the pin.' : 'The ball went past the pin.';
      why = wrongWay
        ? (this.advice.length > 0 ? this.advice[0] : 'Increase the value and bowl again: the equation says how much.')
        : (this.advice.length > 1 ? this.advice[1] : 'Reduce the value and bowl again: the equation says how much.');
    }
    return new ChallengeOutcome(false, headline, verdict,
      [
        `Input ${gfmt(measurement.value, 3)} ${this.control.unit}: ${this._directionText(measurement)}.`,
        `The pin needed ${fsign(needed, 3)} m of sideways movement; the ball produced ${fsign(got !== null ? got : 0.0, 3)} m (contact needs the ball within ${ffmt(CONTACT_REACH, 3)} m of the axis).`,
        why,
      ], this._summary(measurement));
  }

  _evaluateArrival(measurement) {
    const pin = this.targetPins()[0][0];
    const speed = measurement.impact_speed;
    if (speed === null) {
      return new ChallengeOutcome(false, `THE BALL NEVER REACHED PIN ${pin}`,
        'Too slow: rolling resistance stopped the ball first.',
        [
          `Input ${gfmt(measurement.value, 3)} ${this.control.unit}: the ball did not reach the ${pin} pin at ${ffmt(this.aimZ(), 2)} m.`,
          'Below this release speed the friction deceleration wins; v^2 = u^2 - 2 a d reaches zero first.',
          `The model's release speed for an arrival of ${ffmt(this.threshold, 2)} m/s is ${ffmt(this.answer, 2)} m/s.`,
        ], this._summary(measurement));
    }
    const solved = speed >= this.threshold && measurement.targetDown();
    const headline = solved ? `ARRIVED AT ${ffmt(speed, 2)} m/s - PIN DOWN!` : `ARRIVED AT ${ffmt(speed, 2)} m/s - TOO SLOW`;
    const verdict = solved ? 'Solved: the ball still had the speed you calculated.' : `The pin needed at least ${ffmt(this.threshold, 2)} m/s.`;
    return new ChallengeOutcome(solved, headline, verdict,
      [
        `Input ${gfmt(measurement.value, 3)} ${this.control.unit}: measured arrival speed at the pin ${ffmt(speed, 3)} m/s.`,
        `v^2 = u^2 - 2 a d with a = mu_r g = ${ffmt(MU_R * GRAVITY, 3)} m/s^2: ${ffmt(measurement.value, 2)}^2 - 2 x ${ffmt(MU_R * GRAVITY, 3)} x ${ffmt(this.aimZ(), 2)} = ${ffmt(Math.max(0.0, speed ** 2), 2)}, v = ${ffmt(speed, 2)} m/s.`,
        `The model's minimum release speed is ${ffmt(this.answer, 2)} m/s (arrival ${ffmt(this.threshold, 2)} m/s).`,
      ], this._summary(measurement));
  }

  _evaluatePinSpeed(measurement) {
    const pin = this.targetPins()[0][0];
    const speed = measurement.pin_speed;
    if (speed === null) {
      return new ChallengeOutcome(false, 'THE PIN WAS NEVER STRUCK',
        'Too slow: the ball stopped before the rack.',
        [
          `Input ${gfmt(measurement.value, 3)} ${this.control.unit}: the ball did not reach pin ${pin}. Release faster.`,
          `The arrival speed must beat the rolling deceleration over ${ffmt(this.aimZ(), 2)} m before the impact can happen.`,
        ], this._summary(measurement));
    }
    const solved = speed >= this.threshold && measurement.targetDown();
    const headline = solved ? `PIN ${pin} LEFT THE IMPACT AT ${ffmt(speed, 2)} m/s - DOWN!` : `PIN ${pin} LEFT AT ${ffmt(speed, 2)} m/s - TOO SOFT`;
    const verdict = solved ? 'Solved: the impulse carried enough momentum into the pin.' : `The pin needed at least ${ffmt(this.threshold, 2)} m/s.`;
    const arrival = measurement.impact_speed !== null ? measurement.impact_speed : 0.0;
    return new ChallengeOutcome(solved, headline, verdict,
      [
        `Input ${gfmt(measurement.value, 3)} ${this.control.unit}: the ball arrived at ${ffmt(arrival, 3)} m/s and left the pin at ${ffmt(speed, 2)} m/s.`,
        `Impulse: J = (1 + e) v / (1/m + 2/m_p) = ${ffmt(1.0 + RESTITUTION, 1)} x ${ffmt(arrival, 2)} / (${ffmt(1.0 / BALL_MASS, 3)} + ${ffmt(2.0 / PIN_MASS, 3)}) = ${ffmt(EquationChallenge._impulse(measurement), 2)} kg m/s.`,
        `Pin speed: v_pin = J / m_p = ${ffmt(EquationChallenge._impulse(measurement), 2)} / ${ffmt(PIN_MASS, 2)} = ${ffmt(speed, 2)} m/s (the model needs ${ffmt(this.threshold, 2)} m/s).`,
      ], this._summary(measurement));
  }

  static _impulse(measurement) {
    const inverse = 1.0 / BALL_MASS + 2.0 / PIN_MASS;
    const speed = measurement.impact_speed || 0.0;
    return (1.0 + RESTITUTION) * speed / inverse;
  }

  _summary(measurement) {
    return {
      input: `${gfmt(measurement.value, 3)} ${this.control.unit}`,
      landing: measurement.landing_x,
      drift: measurement.landing_x !== null ? measurement.landing_x - measurement.launch_x : null,
      pass_error: measurement.pass_error, impact_speed: measurement.impact_speed,
      pin_speed: measurement.pin_speed, gutter: measurement.gutter,
      pins: measurement.knockdowns, spin: measurement.spin,
    };
  }
}

// --- builders ---
export const CASE_AIM = 'CASE 1 - LINE IT UP';
export const CASE_SPEED = 'CASE 2 - SPEED DOWN THE LANE';
export const CASE_SPIN = 'CASE 3 - SPIN AND THE HOOK';
export const CASE_ROTATION = 'CASE 4 - ROTATION DYNAMICS';
export const CASE_IMPACT = 'CASE 5 - THE IMPACT';

function slot(label) { const [x, z] = SLOTS[label]; return [[label, x, z]]; }

// Case 1
const [ANGLE_WINNER_X, ANGLE_WINNER_Z] = SLOTS['10'];
export const ANGLE_TO_PIN = new EquationChallenge({
  id: 'angle-to-pin', case: CASE_AIM, title: 'Point the release at the pin',
  brief: `The 10 pin is the only pin left. You release the ball from the lane centre (x0 = 0.00 m) straight at 7.0 m/s, but with no spin at all. The pin stands x = ${ffmt(ANGLE_WINNER_X, 4)} m to the right at ${ffmt(ANGLE_WINNER_Z, 2)} m down the lane. What launch angle theta points the ball straight at it?`,
  target: 'Knock the 10 pin down with a straight, spinning-neutral release.',
  rack: slot('10'),
  control: new ChallengeInput('angle', 'LAUNCH ANGLE theta', 'deg', -2.0, 2.0),
  fixed: { position: 0.0, speed: 7.0, spin: 0.0 },
  answer: Math.atan2(ANGLE_WINNER_X, ANGLE_WINNER_Z) * 180 / Math.PI,
  kind: 'hit', targets: [0],
  equation: 'theta = atan( (x_pin - x0) / d )',
  equation_note: "Measured from the lane's forward axis; positive aims right. No spin, so the path is straight and the speed cancels out.",
  given: [['start x0', '0.000 m'], ['pin x', `${ffmt(ANGLE_WINNER_X, 4)} m`],
          ['distance d', `${ffmt(ANGLE_WINNER_Z, 2)} m`], ['speed v', '7.00 m/s'],
          ['hook spin', '0.00 rad/s']],
  given_values: { x0: 0.0, x_pin: ANGLE_WINNER_X, d: ANGLE_WINNER_Z },
  steps: [
    'A straight path changes x linearly with the distance travelled: tan(theta) = sideways / forward.',
    `tan(theta) = ${ffmt(ANGLE_WINNER_X, 4)} / ${ffmt(ANGLE_WINNER_Z, 2)} = ${ffmt(ANGLE_WINNER_X / ANGLE_WINNER_Z, 4)}.`,
    `Take the inverse tangent in degrees: theta = atan(${ffmt(ANGLE_WINNER_X / ANGLE_WINNER_Z, 4)}).`,
  ],
  working: `theta = atan((x_pin - x0) / d) = atan((${ffmt(ANGLE_WINNER_X, 4)} - 0.000) / ${ffmt(ANGLE_WINNER_Z, 2)}) = atan(${ffmt(ANGLE_WINNER_X / ANGLE_WINNER_Z, 4)}) = ${ffmt(Math.atan2(ANGLE_WINNER_X, ANGLE_WINNER_Z) * 180 / Math.PI, 3)} degrees. The speed does not appear: a straight path has the same direction at every distance.`,
  advice: ['Aim further right (a larger angle).', 'Aim further left (a smaller angle).'],
  assumptions: 'Straight, constant-velocity path; rolling resistance only slows it.',
  sign_note: 'positive angle aims right of the lane axis.',
});

const [POSITION_PIN_X, POSITION_PIN_Z] = SLOTS['3'];
const POSITION_ANGLE = 1.0;
const POSITION_ANSWER = POSITION_PIN_X - POSITION_PIN_Z * Math.tan(POSITION_ANGLE * Math.PI / 180);
export const RELEASE_POSITION = new EquationChallenge({
  id: 'release-position', case: CASE_AIM, title: 'Pick the release spot',
  brief: `The 3 pin is up. This time the release angle is fixed at ${ffmt(POSITION_ANGLE, 1)} degrees to the right and you choose where on the lane to stand. The pin is ${ffmt(POSITION_PIN_Z, 2)} m away at x = ${ffmt(POSITION_PIN_X, 4)} m. Which release position x0 sends the straight path through the pin?`,
  target: 'Knock the 3 pin down with the fixed 1 degree release angle.',
  rack: slot('3'),
  control: new ChallengeInput('position', 'RELEASE POSITION x0', 'm', -0.42, 0.42),
  fixed: { speed: 7.0, angle_deg: POSITION_ANGLE, spin: 0.0 },
  answer: POSITION_ANSWER, kind: 'hit', targets: [0],
  equation: 'x0 = x_pin - d tan(theta)',
  equation_note: "The straight path obeys x(d) = x0 + d tan(theta); set x(d) = x_pin and solve for x0.",
  given: [['pin x', `${ffmt(POSITION_PIN_X, 4)} m`], ['distance d', `${ffmt(POSITION_PIN_Z, 2)} m`],
          ['angle theta', `${ffmt(POSITION_ANGLE, 1)} deg`], ['speed v', '7.00 m/s'],
          ['hook spin', '0.00 rad/s']],
  given_values: { x_pin: POSITION_PIN_X, d: POSITION_PIN_Z, angle_deg: POSITION_ANGLE },
  steps: [
    "Start from the path equation x = x0 + d tan(theta) and put the pin's position in for x.",
    `d tan(theta) = ${ffmt(POSITION_PIN_Z, 2)} x tan(${ffmt(POSITION_ANGLE, 1)} deg) = ${ffmt(POSITION_PIN_Z * Math.tan(POSITION_ANGLE * Math.PI / 180), 3)} m.`,
    `x0 = ${ffmt(POSITION_PIN_X, 4)} - ${ffmt(POSITION_PIN_Z * Math.tan(POSITION_ANGLE * Math.PI / 180), 3)}.`,
  ],
  working: `x0 = x_pin - d tan(theta) = ${ffmt(POSITION_PIN_X, 4)} m - ${ffmt(POSITION_PIN_Z, 2)} m x tan(${ffmt(POSITION_ANGLE, 1)} deg) = ${ffmt(POSITION_PIN_X, 4)} - ${ffmt(POSITION_PIN_Z * Math.tan(POSITION_ANGLE * Math.PI / 180), 3)} = ${fsign(POSITION_ANSWER, 3)} m. Standing left of centre while aiming to the right makes the path cross the lane centre on the way to the pin.`,
  advice: ['Stand further right (a larger x0).', 'Stand further left (a smaller x0).'],
  assumptions: 'A straight release path at the stated angle; no hook.',
  sign_note: 'x0 is metres from the lane centre: negative is left, positive right.',
});

// Case 2
const ARRIVAL_TARGET = 6.0;
const ARRIVAL_DISTANCE = HEAD_Z;
const ARRIVAL_ANSWER = releaseSpeedForArrival(ARRIVAL_TARGET, ARRIVAL_DISTANCE);
export const ARRIVAL_SPEED = new EquationChallenge({
  id: 'arrival-speed', case: CASE_SPEED, title: 'Carry enough speed to the pin',
  brief: `The head pin at ${ffmt(ARRIVAL_DISTANCE, 2)} m must be hit with at least ${ffmt(ARRIVAL_TARGET, 1)} m/s for the shot to carry. Rolling resistance decelerates a rolling ball at a = mu_r g with mu_r = ${ffmt(MU_R, 3)}. What release speed u gets the ball there at ${ffmt(ARRIVAL_TARGET, 1)} m/s?`,
  target: `Reach the head pin with at least ${ffmt(ARRIVAL_TARGET, 1)} m/s.`,
  rack: slot('1'),
  control: new ChallengeInput('speed', 'RELEASE SPEED u', 'm/s', 4.0, 12.0),
  fixed: { position: 0.0, angle_deg: 0.0, spin: 0.0 },
  answer: ARRIVAL_ANSWER, kind: 'arrival', threshold: ARRIVAL_TARGET, targets: [0],
  equation: 'v = sqrt( u^2 - 2 a d ),   a = mu_r g',
  equation_note: `With mu_r = 0.020 and g = 9.81 m/s^2 the deceleration is a = ${ffmt(MU_R * GRAVITY, 3)} m/s^2 - the same term the engine applies while the ball rolls.`,
  given: [['distance d', `${ffmt(ARRIVAL_DISTANCE, 2)} m`], ['target speed v', `${ffmt(ARRIVAL_TARGET, 1)} m/s`],
          ['mu_r', `${ffmt(MU_R, 3)}`], ['g', `${ffmt(GRAVITY, 2)} m/s^2`],
          ['deceleration a', `${ffmt(MU_R * GRAVITY, 3)} m/s^2`]],
  given_values: { d: ARRIVAL_DISTANCE, v: ARRIVAL_TARGET, a: MU_R * GRAVITY },
  steps: [
    'Rearrange v^2 = u^2 - 2 a d for the release speed: u^2 = v^2 + 2 a d.',
    `2 a d = 2 x ${ffmt(MU_R * GRAVITY, 3)} x ${ffmt(ARRIVAL_DISTANCE, 2)} = ${ffmt(2 * MU_R * GRAVITY * ARRIVAL_DISTANCE, 3)}.`,
    `u = sqrt(${ffmt(ARRIVAL_TARGET ** 2, 1)} + ${ffmt(2 * MU_R * GRAVITY * ARRIVAL_DISTANCE, 3)}).`,
  ],
  working: `u = sqrt(v^2 + 2 a d) = sqrt(${ffmt(ARRIVAL_TARGET, 1)}^2 + 2 x ${ffmt(MU_R * GRAVITY, 3)} x ${ffmt(ARRIVAL_DISTANCE, 2)}) = sqrt(${ffmt(ARRIVAL_TARGET ** 2 + 2 * MU_R * GRAVITY * ARRIVAL_DISTANCE, 2)}) = ${ffmt(ARRIVAL_ANSWER, 2)} m/s. Below this the ball arrives slower than ${ffmt(ARRIVAL_TARGET, 1)} m/s; above it, faster - that is the whole equation.`,
  advice: ['Release faster: the ball arrives slower than the target.', 'Release slower: the ball arrives faster than needed.'],
  assumptions: 'The ball is rolling (no skid); constant deceleration mu_r g.',
});

const SPEED_CURVE_SPIN = -5.0;
const [SPEED_CURVE_TARGET_X, SPEED_CURVE_DISTANCE] = SLOTS['10'];
const SPEED_CURVE_ANSWER = DRIFT_PER_SPIN * Math.abs(SPEED_CURVE_SPIN) * SPEED_CURVE_DISTANCE
  / (Math.abs(SPEED_CURVE_TARGET_X) + DRIFT_QUADRATIC * SPEED_CURVE_SPIN ** 2);
export const SPEED_TO_CURVE = new EquationChallenge({
  id: 'speed-to-curve', case: CASE_SPEED, title: 'Curve to the corner by speed alone',
  brief: `The 10 pin is up and the release has a fixed hook spin of ${fsign(SPEED_CURVE_SPIN, 1)} rad/s (a right-hand hook). You choose the release speed. The ball starts on the lane centre and must drift ${ffmt(Math.abs(SPEED_CURVE_TARGET_X), 4)} m to the right over ${ffmt(SPEED_CURVE_DISTANCE, 2)} m. How fast must it be released? (Faster leaves less time to curve.)`,
  target: 'Knock the 10 pin down with the fixed -5.0 rad/s hook spin.',
  rack: slot('10'),
  control: new ChallengeInput('speed', 'RELEASE SPEED v', 'm/s', 4.0, 10.0),
  fixed: { position: 0.0, angle_deg: 0.0, spin: SPEED_CURVE_SPIN },
  answer: SPEED_CURVE_ANSWER, kind: 'hit', targets: [0],
  equation: 'D = (2/7) R |omega| (t - t_s/2),   t = d/v,   t_s = 2 R |omega| / (7 mu_k g)',
  equation_note: 'The drift is fixed; a faster ball has less time on the lane, so t = d/v has to be larger (a slower release).',
  given: [['hook spin omega', `${fsign(SPEED_CURVE_SPIN, 1)} rad/s`],
          ['drift needed D', `${ffmt(Math.abs(SPEED_CURVE_TARGET_X), 4)} m to the right`],
          ['distance d', `${ffmt(SPEED_CURVE_DISTANCE, 2)} m`], ['radius R', `${ffmt(BALL_R, 3)} m`],
          ['friction mu_k', `${ffmt(MU_K, 3)}`], ['gravity g', `${ffmt(GRAVITY, 2)} m/s^2`]],
  given_values: { spin: SPEED_CURVE_SPIN, D: Math.abs(SPEED_CURVE_TARGET_X), d: SPEED_CURVE_DISTANCE, R: BALL_R, mu_k: MU_K },
  steps: [
    `First the skid time: t_s = 2 R |omega| / (7 mu_k g) = ${ffmt(slipTime(SPEED_CURVE_SPIN), 4)} s.`,
    'The drift equation is D = (2/7) R |omega| (d/v - t_s/2). Rearrange for d/v.',
    `d/v = D / ((2/7) R |omega|) + t_s/2 = ${ffmt(Math.abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * Math.abs(SPEED_CURVE_SPIN)), 4)} + ${ffmt(slipTime(SPEED_CURVE_SPIN) / 2, 4)} s, then v = d / that.`,
  ],
  working: `t_s = 2 x ${ffmt(BALL_R, 3)} x ${ffmt(Math.abs(SPEED_CURVE_SPIN), 1)} / (7 x ${ffmt(MU_K, 3)} x ${ffmt(GRAVITY, 2)}) = ${ffmt(slipTime(SPEED_CURVE_SPIN), 4)} s. t = d/v = D/((2/7) R |omega|) + t_s/2 = ${ffmt(Math.abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * Math.abs(SPEED_CURVE_SPIN)), 4)} + ${ffmt(slipTime(SPEED_CURVE_SPIN) / 2, 4)} = ${ffmt(Math.abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * Math.abs(SPEED_CURVE_SPIN)) + slipTime(SPEED_CURVE_SPIN) / 2, 4)} s, so v = ${ffmt(SPEED_CURVE_DISTANCE, 2)} / ${ffmt(Math.abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * Math.abs(SPEED_CURVE_SPIN)) + slipTime(SPEED_CURVE_SPIN) / 2, 4)} = ${ffmt(SPEED_CURVE_ANSWER, 2)} m/s.`,
  advice: ['Too fast: the ball ran out of lane before the hook could bite - release slower.',
           'Too slow: the ball curved past the pin - release faster.'],
  assumptions: 'The closed-form skid model; rolling resistance during the roll is neglected (it changes the drift by a few millimetres).',
  sign_note: 'the fixed spin -5.0 rad/s curls the ball to the right.',
});

// Case 3
const SPIN_PIN_ANSWER = spinForDrift(Math.abs(SLOTS['6'][0]), 7.0, SLOTS['6'][1]);
export const SPIN_TO_PIN = new EquationChallenge({
  id: 'spin-to-pin', case: CASE_SPIN, title: 'Hook into the 6 pin',
  brief: `The 6 pin is up at x = ${ffmt(SLOTS['6'][0], 4)} m, ${ffmt(SLOTS['6'][1], 2)} m away. You release from the lane centre at 7.0 m/s with a launch angle of 0.0 degrees, and you choose the hook spin. The release slip makes the contact point slide; friction against it is what bends the path. What signed hook spin omega curves the ball onto the pin?`,
  target: 'Knock the 6 pin down with the hook, releasing straight.',
  rack: slot('6'),
  control: new ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
  fixed: { position: 0.0, speed: 7.0, angle_deg: 0.0 },
  answer: SPIN_PIN_ANSWER, kind: 'hit', targets: [0],
  equation: 'D = (2/7) R omega (t - t_s/2),   t = d/v,   t_s = 2 R |omega| / (7 mu_k g)',
  equation_note: 'A positive spin curves left; a negative spin curves right. The ball must move right, so omega is negative.',
  given: [['pin x', `${ffmt(SLOTS['6'][0], 4)} m`], ['distance d', `${ffmt(SLOTS['6'][1], 2)} m`],
          ['speed v', '7.00 m/s'], ['radius R', `${ffmt(BALL_R, 3)} m`],
          ['friction mu_k', `${ffmt(MU_K, 3)}`], ['gravity g', `${ffmt(GRAVITY, 2)} m/s^2`]],
  given_values: { D: Math.abs(SLOTS['6'][0]), d: SLOTS['6'][1], v: 7.0, R: BALL_R, mu_k: MU_K },
  steps: [
    `The ball must drift ${ffmt(Math.abs(SLOTS['6'][0]), 4)} m to the right, so the signed spin is negative.`,
    `Skid time: t_s = 2 R |omega| / (7 mu_k g); travel time: t = d/v = ${ffmt(SLOTS['6'][1] / 7.0, 4)} s.`,
    `Solve ${ffmt(Math.abs(SLOTS['6'][0]), 4)} = (2/7) R |omega| (t - t_s/2) for |omega| - the t_s term is small but keep it.`,
  ],
  working: `t = d/v = ${ffmt(SLOTS['6'][1], 2)} / 7.0 = ${ffmt(SLOTS['6'][1] / 7.0, 4)} s. Solving D = (2/7) R |omega| (t - t_s/2) with D = ${ffmt(Math.abs(SLOTS['6'][0]), 4)} m gives |omega| = ${ffmt(Math.abs(SPIN_PIN_ANSWER), 2)} rad/s (t_s = ${ffmt(slipTime(SPIN_PIN_ANSWER), 4)} s). The pin is to the right, so the ball must curl right: omega = ${fsign(SPIN_PIN_ANSWER, 2)} rad/s.`,
  advice: ['Under-spun: the ball curved less than the pin needs - increase |omega| (more negative).',
           'Over-spun: the ball curved past the pin - reduce |omega|.'],
  assumptions: 'Closed-form skid model; the engine then rolls the ball straight with the sideways velocity the skid gave it.',
  sign_note: 'positive omega curls left; negative curls right.',
});

const SPIN_CORNER_ANSWER = spinForDrift(Math.abs(SLOTS['10'][0]), 6.0, SLOTS['10'][1]);
export const SPIN_TO_CORNER = new EquationChallenge({
  id: 'spin-to-corner', case: CASE_SPIN, title: 'The lone 10 pin - and the gutter',
  brief: `The 10 pin is the only pin standing, x = ${ffmt(SLOTS['10'][0], 4)} m at ${ffmt(SLOTS['10'][1], 2)} m. You release from the lane centre at 6.0 m/s, straight. The lane is only ${ffmt(config.LANE_WIDTH, 3)} m wide, so this shot needs a big hook - and too much spin puts the ball in the gutter. What signed hook spin hits the pin?`,
  target: 'Knock the 10 pin down without going into the gutter.',
  rack: slot('10'),
  control: new ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
  fixed: { position: 0.0, speed: 6.0, angle_deg: 0.0 },
  answer: SPIN_CORNER_ANSWER, kind: 'hit', targets: [0],
  equation: 's = R omega   (slip)  ->  D = (2/7) R |omega| (t - t_s/2)',
  equation_note: 'The slip speed is R|omega|; the friction against it curves the path. A slower ball has more time, so it needs less spin than at 7 m/s - but the drift grows with omega, so over-spinning sends it wide and into the gutter.',
  given: [['pin x', `${ffmt(SLOTS['10'][0], 4)} m`], ['distance d', `${ffmt(SLOTS['10'][1], 2)} m`],
          ['speed v', '6.00 m/s'], ['lane half-width', `${ffmt(config.LANE_WIDTH / 2, 4)} m`],
          ['radius R', `${ffmt(BALL_R, 3)} m`], ['friction mu_k', `${ffmt(MU_K, 3)}`]],
  given_values: { D: Math.abs(SLOTS['10'][0]), d: SLOTS['10'][1], v: 6.0, R: BALL_R, mu_k: MU_K },
  steps: [
    `Travel time: t = d/v = ${ffmt(SLOTS['10'][1] / 6.0, 4)} s; the required drift is ${ffmt(Math.abs(SLOTS['10'][0]), 4)} m to the right.`,
    's = R |omega| is the sideways slip the friction has to cancel; it takes t_s = 2 R |omega| / (7 mu_k g).',
    `Solve ${ffmt(Math.abs(SLOTS['10'][0]), 4)} = (2/7) R |omega| (t - t_s/2) for |omega|, then choose the sign for "right".`,
  ],
  working: `t = ${ffmt(SLOTS['10'][1], 2)} / 6.0 = ${ffmt(SLOTS['10'][1] / 6.0, 4)} s. With D = ${ffmt(Math.abs(SLOTS['10'][0]), 4)} m the model gives |omega| = ${ffmt(Math.abs(SPIN_CORNER_ANSWER), 2)} rad/s (t_s = ${ffmt(slipTime(SPIN_CORNER_ANSWER), 4)} s), and the pin is to the right, so omega = ${fsign(SPIN_CORNER_ANSWER, 2)} rad/s. The ball crosses ${ffmt(Math.abs(SLOTS['10'][0]), 3)} m of a ${ffmt(config.LANE_WIDTH / 2, 3)} m half-lane - and at about -6.5 rad/s the curve reaches the gutter before the pin, which is the other failure mode to learn.`,
  advice: ['Under-spun: it never reached the pin - increase |omega| (more negative).',
           'Over-spun: it curved too far. At around -6.5 rad/s or beyond the ball gutters before the pin - reduce |omega|.'],
  assumptions: "Closed-form skid model; the gutter is the engine's lateral bound at half-lane width.",
  sign_note: 'positive omega curls left; negative curls right.',
});

const SPIN_LEFT_ANSWER = spinForDrift(-Math.abs(SLOTS['7'][0]), 6.0, SLOTS['7'][1]);
export const SPIN_TO_LEFT = new EquationChallenge({
  id: 'spin-to-left', case: CASE_SPIN, title: 'The other corner: hook the other way',
  brief: `The 7 pin is the only pin up at x = ${ffmt(SLOTS['7'][0], 4)} m (left of centre) and ${ffmt(SLOTS['7'][1], 2)} m away. Released straight from the lane centre at 6.0 m/s, the hook has to carry the ball the other way this time. Which signed hook spin does it?`,
  target: 'Knock the 7 pin down with a left-hand hook.',
  rack: slot('7'),
  control: new ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
  fixed: { position: 0.0, speed: 6.0, angle_deg: 0.0 },
  answer: SPIN_LEFT_ANSWER, kind: 'hit', targets: [0],
  equation: 'D = (2/7) R omega (t - t_s/2)',
  equation_note: 'Same equation, mirrored geometry: the drift needed is negative, so omega is positive.',
  given: [['pin x', `${ffmt(SLOTS['7'][0], 4)} m`], ['distance d', `${ffmt(SLOTS['7'][1], 2)} m`],
          ['speed v', '6.00 m/s'], ['radius R', `${ffmt(BALL_R, 3)} m`], ['mu_k', `${ffmt(MU_K, 3)}`]],
  given_values: { D: SLOTS['7'][0], d: SLOTS['7'][1], v: 6.0, R: BALL_R, mu_k: MU_K },
  steps: [
    'The ball must move left, and positive spin curls left.',
    `|omega| solves ${ffmt(Math.abs(SLOTS['7'][0]), 4)} = (2/7) R |omega| (t - t_s/2) with t = ${ffmt(SLOTS['7'][1], 2)} / 6.0.`,
    'Same magnitudes as the 10-pin challenge, opposite sign.',
  ],
  working: `t = ${ffmt(SLOTS['7'][1] / 6.0, 4)} s; |omega| = ${ffmt(Math.abs(SPIN_LEFT_ANSWER), 2)} rad/s; the pin is to the left, so omega = ${fsign(SPIN_LEFT_ANSWER, 2)} rad/s. The sign convention is the only difference from the other corner shot.`,
  advice: ['Under-spun: it fell short of the pin - increase omega.', 'Over-spun: it curved past the pin - reduce omega.'],
  assumptions: 'Closed-form skid model.',
  sign_note: 'positive omega curls left; negative curls right.',
});

// Case 4
const ANGULAR_MOMENTUM_ANSWER = spinForDrift(Math.abs(SLOTS['10'][0]), 6.0, SLOTS['10'][1]);
const INERTIA = momentOfInertia();
const ANGULAR_MOMENTUM_L = Math.abs(angularMomentumOfSpin(ANGULAR_MOMENTUM_ANSWER));
export const ANGULAR_MOMENTUM = new EquationChallenge({
  id: 'angular-momentum', case: CASE_ROTATION, title: 'From angular momentum to hook spin',
  brief: `The lone 10 pin is up at x = ${ffmt(SLOTS['10'][0], 4)} m, ${ffmt(SLOTS['10'][1], 2)} m away. The coach tells you the release must carry L = ${ffmt(ANGULAR_MOMENTUM_L, 4)} kg m^2/s of angular momentum about the line of travel, curling to the right. The ball is a solid sphere, m = ${ffmt(BALL_MASS, 1)} kg, R = ${ffmt(BALL_R, 3)} m. What signed hook spin omega gives it that angular momentum?`,
  target: 'Knock the 10 pin down from the stated angular momentum.',
  rack: slot('10'),
  control: new ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
  fixed: { position: 0.0, speed: 6.0, angle_deg: 0.0 },
  answer: ANGULAR_MOMENTUM_ANSWER, kind: 'hit', targets: [0],
  equation: 'L = I omega,    I = (2/5) m R^2',
  equation_note: 'The moment of inertia is a property of the solid sphere the engine integrates, not a free parameter. The direction ("curling right") fixes the sign of omega.',
  given: [['angular momentum L', `${ffmt(ANGULAR_MOMENTUM_L, 4)} kg m^2/s`], ['mass m', `${ffmt(BALL_MASS, 1)} kg`],
          ['radius R', `${ffmt(BALL_R, 3)} m`], ['direction', 'curling right'],
          ['spin needed by the shot', `the 10 pin at x = ${ffmt(SLOTS['10'][0], 4)} m`]],
  given_values: { L: ANGULAR_MOMENTUM_L, m: BALL_MASS, R: BALL_R },
  steps: [
    `First the moment of inertia: I = (2/5) m R^2 = (2/5) x ${ffmt(BALL_MASS, 1)} x ${ffmt(BALL_R, 3)}^2 = ${ffmt(INERTIA, 5)} kg m^2.`,
    `Then omega = L / I = ${ffmt(ANGULAR_MOMENTUM_L, 4)} / ${ffmt(INERTIA, 5)}.`,
    'The spin must curl the ball to the right, so report it with the matching sign (positive curls left).',
  ],
  working: `I = (2/5) m R^2 = 0.4 x ${ffmt(BALL_MASS, 1)} x ${ffmt(BALL_R, 3)}^2 = ${ffmt(INERTIA, 5)} kg m^2. omega = L / I = ${ffmt(ANGULAR_MOMENTUM_L, 4)} / ${ffmt(INERTIA, 5)} = ${ffmt(Math.abs(ANGULAR_MOMENTUM_ANSWER), 3)} rad/s in magnitude; curling right makes it omega = ${fsign(ANGULAR_MOMENTUM_ANSWER, 3)} rad/s. That spin produces the ${ffmt(Math.abs(SLOTS['10'][0]), 4)} m of drift the pin needs, so the two problems agree - as they must.`,
  advice: ['The spin is under-sized: recompute omega = L / I and check the sign (right needs a negative spin).',
           'The spin is over-sized: check the moment of inertia and the sign.'],
  assumptions: 'Solid sphere inertia (config.BALL_INERTIA_TYPE = solid).',
  sign_note: 'positive omega curls left; negative curls right.',
});

const TORQUE_TIME = 0.20;
const TORQUE_ANSWER = torqueForSpin(SPIN_LEFT_ANSWER, TORQUE_TIME);
export const SPIN_UP_TORQUE = new EquationChallenge({
  id: 'spin-up-torque', case: CASE_ROTATION, title: 'Spin the ball up with a torque',
  brief: `The lone 7 pin is up at x = ${ffmt(SLOTS['7'][0], 4)} m, ${ffmt(SLOTS['7'][1], 2)} m away, and the release speed is 6.0 m/s. This time the hook spin comes from the wind-up: you apply a constant torque tau about the line of travel for ${ffmt(TORQUE_TIME, 2)} s, giving the solid ball (I = ${ffmt(INERTIA, 5)} kg m^2) omega = tau t / I. What torque spins the ball onto the pin?`,
  target: 'Knock the 7 pin down using the torque-driven spin.',
  rack: slot('7'),
  control: new ChallengeInput('torque', 'WIND-UP TORQUE tau', 'N m', 0.0, 1.5),
  fixed: { position: 0.0, speed: 6.0, angle_deg: 0.0 },
  answer: TORQUE_ANSWER, kind: 'hit', targets: [0],
  equation: 'omega = tau dt / I,    I = (2/5) m R^2',
  equation_note: `The ball spins up frictionlessly during the ${ffmt(TORQUE_TIME, 2)} s wind-up, then is released; the game uses omega = tau dt / I as the launch spin. A positive torque curves the ball left, like the release.`,
  given: [['spin-up time dt', `${ffmt(TORQUE_TIME, 2)} s`], ['ball inertia I', `${ffmt(INERTIA, 5)} kg m^2`],
          ['pin', `the 7 pin at x = ${ffmt(SLOTS['7'][0], 4)} m, d = ${ffmt(SLOTS['7'][1], 2)} m`],
          ['release speed', '6.00 m/s'], ['spin needed', `about ${ffmt(Math.abs(SPIN_LEFT_ANSWER), 2)} rad/s, curling left`]],
  given_values: { dt: TORQUE_TIME, I: INERTIA, spin: SPIN_LEFT_ANSWER },
  spin_up_time: TORQUE_TIME,
  steps: [
    `Work out the spin the shot needs first: solve the drift equation for the 7 pin (about ${ffmt(Math.abs(SPIN_LEFT_ANSWER), 2)} rad/s, positive for a left-hand curve).`,
    `Invert omega = tau dt / I: tau = I omega / dt = ${ffmt(INERTIA, 5)} x |omega| / ${ffmt(TORQUE_TIME, 2)}.`,
    'A torque that spins the ball to curve left is the positive one.',
  ],
  working: `The shot needs the 7-pin spin: |omega| = ${ffmt(Math.abs(SPIN_LEFT_ANSWER), 2)} rad/s, and it must curl left, so omega = ${fsign(SPIN_LEFT_ANSWER, 2)}. tau = I omega / dt = ${ffmt(INERTIA, 5)} x ${ffmt(Math.abs(SPIN_LEFT_ANSWER), 2)} / ${ffmt(TORQUE_TIME, 2)} = ${ffmt(TORQUE_ANSWER, 3)} N m. The engine then releases the ball with that omega, and the friction-driven skid does the rest.`,
  advice: ['Too little torque: the ball under-curves. tau = I omega / dt.', 'Too much torque: the ball over-curves. tau = I omega / dt.'],
  assumptions: "Idealised frictionless spin-up: all of tau dt becomes ball angular momentum. The release itself then uses the engine's skid model.",
  sign_note: 'a positive torque spins the ball to curve left.',
});

// Case 5
const PIN_SPEED_TARGET = 2.5;
const PIN_SPEED_DISTANCE = HEAD_Z;
const PIN_SPEED_ANSWER = releaseSpeedForArrival(impactSpeedForPinSpeed(PIN_SPEED_TARGET), PIN_SPEED_DISTANCE);
export const PIN_SPEED = new EquationChallenge({
  id: 'pin-speed', case: CASE_IMPACT, title: 'Hit the pin hard enough',
  brief: `A lone head pin at ${ffmt(PIN_SPEED_DISTANCE, 2)} m must be struck hard enough to leave the contact at ${ffmt(PIN_SPEED_TARGET, 1)} m/s (that is the kind of pin speed that carries into the next row). The ball and pin collide with restitution e = ${ffmt(RESTITUTION, 1)}; the pin leaves with v_pin = J / m_p. What release speed does it take?`,
  target: `Leave the head pin with at least ${ffmt(PIN_SPEED_TARGET, 1)} m/s.`,
  rack: slot('1'),
  control: new ChallengeInput('speed', 'RELEASE SPEED u', 'm/s', 4.0, 12.0),
  fixed: { position: 0.0, angle_deg: 0.0, spin: 0.0 },
  answer: PIN_SPEED_ANSWER, kind: 'pin_speed', threshold: PIN_SPEED_TARGET, targets: [0],
  equation: 'J = (1 + e) v / (1/m + 2/m_p),    v_pin = J / m_p',
  equation_note: "The pin's mobility is 2/m_p: the impulse splits into translation and the rotation of the topple, so this is the same two-body collision the engine resolves.",
  given: [['pin mass m_p', `${ffmt(PIN_MASS, 1)} kg`], ['ball mass m', `${ffmt(BALL_MASS, 1)} kg`],
          ['restitution e', `${ffmt(RESTITUTION, 1)}`], ['target pin speed', `${ffmt(PIN_SPEED_TARGET, 1)} m/s`],
          ['distance d', `${ffmt(PIN_SPEED_DISTANCE, 2)} m`]],
  given_values: { m_p: PIN_MASS, m: BALL_MASS, e: RESTITUTION, target: PIN_SPEED_TARGET, d: PIN_SPEED_DISTANCE },
  steps: [
    `First the arrival speed the collision needs: v_pin = (1 + e) v / (m_p (1/m + 2/m_p)) so v = ${ffmt(impactSpeedForPinSpeed(PIN_SPEED_TARGET), 3)} m/s.`,
    `Then the release speed from rolling resistance: u = sqrt(v^2 + 2 a d) with a = mu_r g = ${ffmt(MU_R * GRAVITY, 3)} m/s^2.`,
    `u = sqrt(${ffmt(impactSpeedForPinSpeed(PIN_SPEED_TARGET), 3)}^2 + 2 x ${ffmt(MU_R * GRAVITY, 3)} x ${ffmt(PIN_SPEED_DISTANCE, 2)}).`,
  ],
  working: `v_pin = ${ffmt(PIN_SPEED_TARGET, 2)} m/s needs an arrival speed v = v_pin m_p (1/m + 2/m_p) / (1 + e) = ${ffmt(impactSpeedForPinSpeed(PIN_SPEED_TARGET), 3)} m/s. Over ${ffmt(PIN_SPEED_DISTANCE, 2)} m the rolling deceleration a = ${ffmt(MU_R * GRAVITY, 3)} m/s^2 costs 2 a d = ${ffmt(2 * MU_R * GRAVITY * PIN_SPEED_DISTANCE, 3)} (m/s)^2, so u = sqrt(${ffmt(impactSpeedForPinSpeed(PIN_SPEED_TARGET), 3)}^2 + ${ffmt(2 * MU_R * GRAVITY * PIN_SPEED_DISTANCE, 3)}) = ${ffmt(PIN_SPEED_ANSWER, 2)} m/s.`,
  advice: ['Too slow: the pin leaves softer than the target. Release faster.', 'Faster than needed: the pin leaves harder than the target.'],
  assumptions: 'Head-on impulse, no spin; the pin is free to translate and topple, which is exactly the mobility used above.',
});

export const CHALLENGES = [
  ANGLE_TO_PIN, RELEASE_POSITION, ARRIVAL_SPEED, SPEED_TO_CURVE, SPIN_TO_PIN,
  SPIN_TO_CORNER, SPIN_TO_LEFT, ANGULAR_MOMENTUM, SPIN_UP_TORQUE, PIN_SPEED,
];

export function challengesForSession(count = null) {
  const challenges = CHALLENGES.slice();
  return count ? challenges.slice(0, count) : challenges;
}
export function challengeById(id) {
  for (const c of CHALLENGES) if (c.id === id) return c;
  throw new Error(`unknown challenge ${id}`);
}
export function bankSize() { return CHALLENGES.length; }
