// Rigid-body bowling physics. Ported 1:1 from physics.py.
// Units: SI. Lane frame: +z toward pins, +x lateral (right), +y up.
import * as config from './config.js';

// ---------------------------------------------------------------------------
// Small linear-algebra helpers. Vectors are [x, y, z] arrays; matrices are
// arrays of three row arrays.
// ---------------------------------------------------------------------------
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
export function length(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
export function normalize(a) {
  const len = length(a);
  if (len <= 1e-12) return [0.0, 0.0, 0.0];
  const inv = 1.0 / len;
  return [a[0] * inv, a[1] * inv, a[2] * inv];
}
export function unit2(x, z) {
  const len = Math.hypot(x, z);
  if (len <= 1e-12) return [0.0, 0.0, 0.0];
  return [x / len, 0.0, z / len];
}
export function matrixMultiply(a, b) {
  return a.map((row, i) =>
    [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}
export function matrixVector(m, v) {
  return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
          m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
          m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}
function quatFromAxisAngle(axis, angle) {
  const half = 0.5 * angle;
  const sinHalf = Math.sin(half);
  return [Math.cos(half), axis[0] * sinHalf, axis[1] * sinHalf, axis[2] * sinHalf];
}
function quatToMatrix(q) {
  let [w, x, y, z] = q;
  const norm = Math.sqrt(w * w + x * x + y * y + z * z);
  if (norm <= 1e-12) return IDENTITY_MATRIX.map((r) => r.slice());
  w /= norm; x /= norm; y /= norm; z /= norm;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    [1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy)],
    [2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx)],
    [2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy)],
  ];
}
export function matrixToEulerDegrees(m) {
  const sinB = Math.max(-1.0, Math.min(1.0, m[0][2]));
  const b = Math.asin(sinB);
  let a, c;
  if (Math.abs(sinB) < 0.99999) {
    a = Math.atan2(-m[1][2], m[2][2]);
    c = Math.atan2(-m[0][1], m[0][0]);
  } else {
    a = Math.atan2(m[2][1], m[1][1]);
    c = 0.0;
  }
  return [a * 180 / Math.PI, b * 180 / Math.PI, c * 180 / Math.PI];
}
export function eulerDegrees(matrix) { return matrixToEulerDegrees(matrix); }

function integrateOrientation(orientation, angularVelocity, dt) {
  const magnitude = length(angularVelocity);
  if (magnitude <= 1e-12) return orientation;
  const axis = scale(angularVelocity, 1.0 / magnitude);
  const step = quatToMatrix(quatFromAxisAngle(axis, magnitude * dt));
  return matrixMultiply(step, orientation);
}

const IDENTITY_MATRIX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function rollingAngularVelocity(velocity, radius) {
  return scale(cross([0, 1, 0], velocity), 1.0 / radius);
}

// ---------------------------------------------------------------------------
// Collision primitives
// ---------------------------------------------------------------------------
export function sweptCircleTime(cx, cz, radius, px, pz, dx, dz) {
  const ex = px - cx;
  const ez = pz - cz;
  const a = dx * dx + dz * dz;
  if (a <= 1e-18) return (ex * ex + ez * ez <= radius * radius) ? 0.0 : null;
  const b = 2.0 * (ex * dx + ez * dz);
  const c = ex * ex + ez * ez - radius * radius;
  if (c <= 0.0) return 0.0;
  const discriminant = b * b - 4.0 * a * c;
  if (discriminant < 0.0) return null;
  const root = Math.sqrt(discriminant);
  const denominator = 2.0 * a;
  const t0 = (-b - root) / denominator;
  if (0.0 <= t0 && t0 <= 1.0) return t0;
  const t1 = (-b + root) / denominator;
  if (0.0 <= t1 && t1 <= 1.0) return t1;
  return null;
}

function closestPointOnSegment2d(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq <= 1e-18) return [ax, az];
  let t = ((px - ax) * abx + (pz - az) * abz) / lengthSq;
  t = Math.max(0.0, Math.min(1.0, t));
  return [ax + abx * t, az + abz * t];
}

function closestPointsBetweenSegments2d(a0, a1, b0, b1) {
  const [ax0, az0] = a0, [ax1, az1] = a1, [bx0, bz0] = b0, [bx1, bz1] = b1;
  const ux = ax1 - ax0, uz = az1 - az0;
  const vx = bx1 - bx0, vz = bz1 - bz0;
  const wx = ax0 - bx0, wz = az0 - bz0;
  const a = ux * ux + uz * uz;
  const b = ux * vx + uz * vz;
  const c = vx * vx + vz * vz;
  const d = ux * wx + uz * wz;
  const e = vx * wx + vz * wz;
  const denominator = a * c - b * b;
  let s, t;
  if (denominator <= 1e-18) {
    s = 0.0;
    t = (c > 1e-18) ? e / c : 0.0;
  } else {
    s = (b * e - c * d) / denominator;
    t = (a * e - b * d) / denominator;
  }
  s = Math.max(0.0, Math.min(1.0, s));
  if (c > 1e-18) t = (b * s + e) / c;
  t = Math.max(0.0, Math.min(1.0, t));
  if (a > 1e-18) s = (b * t - d) / a;
  s = Math.max(0.0, Math.min(1.0, s));
  return [[ax0 + ux * s, az0 + uz * s], [bx0 + vx * t, bz0 + vz * t]];
}

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------
export class BallPhysics {
  constructor(radius = null, mass = null, inertiaType = null) {
    this.radius = radius !== null ? radius : config.BALL_RADIUS;
    this.mass = mass !== null ? mass : config.BALL_MASS;
    this.inertiaType = inertiaType || config.BALL_INERTIA_TYPE;
    if (this.inertiaType === 'shell') {
      this.inertia = (2.0 / 3.0) * this.mass * this.radius ** 2;
    } else {
      this.inertia = (2.0 / 5.0) * this.mass * this.radius ** 2;
    }
    this.reset();
  }

  reset() {
    this.position = [0.0, this.radius, config.FOUL_LINE_Z];
    this.velocity = [0.0, 0.0, 0.0];
    this.angular_velocity = [0.0, 0.0, 0.0];
    this.orientation = IDENTITY_MATRIX.map((r) => r.slice());
    this.theta = 0.0;
    this.rolling = false;
    this.in_gutter = false;
    this.finished = false;
    this.stopped = false;
    this.launch_angle = 0.0;
    this.spin_omega = 0.0;
    this.last_acceleration = [0.0, 0.0, 0.0];
    this.last_torque = [0.0, 0.0, 0.0];
  }

  get speed() { return Math.hypot(this.velocity[0], this.velocity[2]); }
  get linear_momentum() { return scale(this.velocity, this.mass); }
  get angular_momentum() { return this.inertia * length(this.angular_velocity); }
  get angular_momentum_vector() { return scale(this.angular_velocity, this.inertia); }
  get revolutions() { return this.theta / (2.0 * Math.PI); }

  get x() { return this.position[0]; }
  set x(v) { this.position = [v, this.position[1], this.position[2]]; }
  get z() { return this.position[2]; }
  set z(v) { this.position = [this.position[0], this.position[1], v]; }
  get v() { return this.velocity[2]; }
  set v(val) { this.velocity = [this.velocity[0], 0.0, val]; }

  launch(speed, lateralPosition = 0.0, launchAngle = 0.0, spinOmega = 0.0) {
    this.position = [lateralPosition, this.radius, config.FOUL_LINE_Z];
    speed = Math.max(0.0, Number(speed));
    this.velocity = [Math.sin(launchAngle) * speed, 0.0, Math.cos(launchAngle) * speed];
    const rollingSpin = rollingAngularVelocity(this.velocity, this.radius);
    const travel = normalize(this.velocity);
    this.angular_velocity = add(rollingSpin, scale(travel, Number(spinOmega)));
    this.orientation = IDENTITY_MATRIX.map((r) => r.slice());
    this.theta = 0.0;
    this.launch_angle = launchAngle;
    this.spin_omega = spinOmega;
    this.in_gutter = false;
    this.finished = false;
    this.stopped = false;
    this.rolling = speed > 1e-6;
    this.last_acceleration = [0.0, 0.0, 0.0];
    this.last_torque = [0.0, 0.0, 0.0];
  }

  contactPointVelocity() {
    return add(this.velocity, cross(this.angular_velocity, [0.0, -this.radius, 0.0]));
  }
  slipSpeed() { return length(this.contactPointVelocity()); }

  step(dt) {
    if (!this.rolling || dt <= 0.0) return;
    const velocity = this.velocity;
    const speed = this.speed;
    if (speed <= config.BALL_STOP_SPEED) { this._comeToRest(); return; }
    const slipSpeed = this.slipSpeed();
    const wasSliding = slipSpeed > config.SLIP_TOLERANCE;
    let mu, direction;
    if (wasSliding) {
      mu = this.in_gutter ? config.GUTTER_FRICTION : config.SLIDING_FRICTION;
      direction = scale(this.contactPointVelocity(), -1.0 / slipSpeed);
    } else {
      mu = this.in_gutter ? config.GUTTER_FRICTION : config.ROLLING_FRICTION;
      direction = scale(velocity, -1.0 / speed);
    }
    const acceleration = scale(direction, mu * config.GRAVITY);
    this.last_acceleration = acceleration;
    const newVelocity = add(velocity, scale(acceleration, dt));
    this.velocity = newVelocity;
    this.position = add(this.position, scale(add(velocity, newVelocity), 0.5 * dt));
    if (wasSliding) {
      const torque = cross([0.0, -this.radius, 0.0], scale(acceleration, this.mass));
      this.last_torque = torque;
      this.angular_velocity = add(this.angular_velocity, scale(scale(torque, 1.0 / this.inertia), dt));
    } else {
      const angularAcceleration = scale(cross([0, 1, 0], acceleration), 1.0 / this.radius);
      this.last_torque = scale(angularAcceleration, this.inertia);
      this.angular_velocity = add(this.angular_velocity, scale(angularAcceleration, dt));
    }
    const newSpeed = this.speed;
    if (newSpeed <= config.BALL_STOP_SPEED) { this._comeToRest(); return; }
    if (!wasSliding && this.slipSpeed() <= config.SLIP_TOLERANCE) {
      this.angular_velocity = rollingAngularVelocity(this.velocity, this.radius);
    }
    this.orientation = integrateOrientation(this.orientation, this.angular_velocity, dt);
    this.theta += length(this.angular_velocity) * dt;
    this._applyBounds();
  }

  _applyBounds() {
    const lateralLimit = config.LANE_WIDTH / 2.0 + config.GUTTER_WIDTH;
    let [x, y, z] = this.position;
    if (Math.abs(x) > lateralLimit) x = Math.sign(x) * lateralLimit;
    if (Math.abs(x) > config.LANE_WIDTH / 2.0) this.in_gutter = true;
    this.position = [x, y, z];
  }

  _comeToRest() {
    this.velocity = [0, 0, 0];
    this.angular_velocity = [0, 0, 0];
    this.rolling = false;
    this.stopped = true;
    this.last_acceleration = [0, 0, 0];
    this.last_torque = [0, 0, 0];
  }

  _resetRoll() {
    if (this.speed > config.BALL_STOP_SPEED) {
      this.angular_velocity = rollingAngularVelocity(this.velocity, this.radius);
      this.rolling = true;
    } else {
      this._comeToRest();
    }
  }

  bounce(impulse) {
    this.velocity = add(this.velocity, scale(impulse, 1.0 / this.mass));
    this._resetRoll();
  }
  applyImpulse(impulse) { this.bounce(impulse); }

  setSpeed(speed, direction = null) {
    speed = Math.max(0.0, Number(speed));
    if (speed <= config.BALL_STOP_SPEED) { this._comeToRest(); return; }
    let dir = direction;
    if (dir === null || length(dir) <= 1e-12) dir = normalize(this.velocity);
    if (length(dir) <= 1e-12) dir = [0, 0, 1];
    this.velocity = scale(dir, speed);
    this.angular_velocity = rollingAngularVelocity(this.velocity, this.radius);
    this.rolling = true;
    this.stopped = false;
  }

  rotationEuler() { return matrixToEulerDegrees(this.orientation); }
  atEndOfLane() {
    return this.z >= (config.LANE_LENGTH + config.PIN_DECK_LENGTH + config.BALL_RADIUS);
  }

  captureState() {
    return {
      position: this.position.slice(), velocity: this.velocity.slice(),
      angular_velocity: this.angular_velocity.slice(),
      orientation: this.orientation.map((r) => r.slice()), theta: this.theta,
      rolling: this.rolling, in_gutter: this.in_gutter, finished: this.finished,
      stopped: this.stopped, launch_angle: this.launch_angle,
      spin_omega: this.spin_omega, last_acceleration: this.last_acceleration.slice(),
      last_torque: this.last_torque.slice(),
    };
  }
  restoreState(s) {
    this.position = s.position.slice(); this.velocity = s.velocity.slice();
    this.angular_velocity = s.angular_velocity.slice();
    this.orientation = s.orientation.map((r) => r.slice()); this.theta = s.theta;
    this.rolling = s.rolling; this.in_gutter = s.in_gutter; this.finished = s.finished;
    this.stopped = s.stopped; this.launch_angle = s.launch_angle;
    this.spin_omega = s.spin_omega; this.last_acceleration = s.last_acceleration.slice();
    this.last_torque = s.last_torque.slice();
  }
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------
export class PinPhysics {
  constructor(height = null, mass = null, radius = null) {
    this.height = height !== null ? height : config.PIN_HEIGHT;
    this.mass = mass !== null ? mass : config.PIN_MASS;
    this.radius = radius !== null ? radius : config.PIN_MAX_RADIUS;
    this.inertia_center = (1.0 / 12.0) * this.mass * this.height ** 2;
    this.inertia_base = (1.0 / 3.0) * this.mass * this.height ** 2;
    this.inertia_axis = 0.5 * this.mass * this.radius ** 2;
    this.contact_height = Math.max(this.radius, config.PIN_CONTACT_HEIGHT);
    this.contact_radius = this.radius;
    this.reset();
  }

  reset() {
    this.base = [0.0, 0.0];
    this.com = [0.0, this.height / 2.0, 0.0];
    this.velocity = [0.0, 0.0, 0.0];
    this.lean = [0.0, 0.0, 1.0];
    this.angle = 0.0;
    this.omega = 0.0;
    this.spin = 0.0;
    this.pinned = true;
    this.state = PinPhysics.STANDING;
    this.hit = false;
    this.down = false;
    this.removed = false;
    this.ball_struck = false;
    this.in_pit = false;
    this.kickback_hits = 0;
  }

  get axis() {
    const s = Math.sin(this.angle);
    return [s * this.lean[0], Math.cos(this.angle), s * this.lean[2]];
  }
  get com_height() { return (this.height / 2.0) * Math.cos(this.angle); }
  get center() { return this.com; }
  get center_position() { return this.com; }
  base_xy() { return this.base; }
  _tipAxis() { return [this.lean[2], 0.0, -this.lean[0]]; }
  tipComponents() { return [this.angle * this.lean[2], -this.angle * this.lean[0]]; }

  setBase(x, z) {
    this.base = [x, z];
    this.angle = 0.0;
    this.pinned = true;
    this._place();
  }

  _place() {
    const half = this.height / 2.0;
    const s = Math.sin(this.angle);
    const height = Math.max(this.radius, half * Math.cos(this.angle));
    this.com = [this.base[0] + half * s * this.lean[0], height,
                this.base[1] + half * s * this.lean[2]];
  }

  _placeBase() {
    const axis = this.axis;
    this.base = [this.com[0] - axis[0] * this.height / 2.0,
                 this.com[2] - axis[2] * this.height / 2.0];
  }

  pointVelocity(offset) {
    const omegaVector = scale(this._tipAxis(), this.omega);
    return add(this.velocity, cross(omegaVector, offset));
  }

  shift(delta) {
    this.base = [this.base[0] + delta[0], this.base[1] + delta[2]];
    this._place();
  }

  contactPoint(radialDir) {
    const axis = this.axis;
    const onAxis = sub(this.com, scale(axis, this.height / 2.0 - this.contact_height));
    let radial = sub(radialDir, scale(axis, dot(radialDir, axis)));
    radial = normalize(radial);
    return add(onAxis, scale(radial, this.contact_radius));
  }

  _tipInertia() { return this.inertia_center; }
  inverseMassAt() { return 2.0 / this.mass; }

  applyImpulse(impulseVector, contactPoint) {
    const magnitude = Math.hypot(impulseVector[0], impulseVector[2]);
    if (magnitude <= 0.0) return;
    const normal = unit2(impulseVector[0], impulseVector[2]);
    this.velocity = add(this.velocity, scale(normal, magnitude / this.mass));
    if (normal[0] !== 0.0 || normal[2] !== 0.0) this.lean = normal;
    this.omega += magnitude * (this.height / 2.0) / this.inertia_base;
    this._clampSpin();
    this.hit = true;
  }

  _clampSpin() {
    if (Math.abs(this.omega) > config.PIN_MAX_TUMBLE_SPIN) {
      this.omega = Math.sign(this.omega) * config.PIN_MAX_TUMBLE_SPIN;
    }
  }

  resolveBallContact(contactPoint, ballVelocity, ballMass, push, restitution) {
    const normal = unit2(push[0], push[2]);
    const approach = dot(ballVelocity, normal);
    if (approach <= 0.0) return 0.0;
    const inverse = 1.0 / ballMass + this.inverseMassAt(contactPoint, normal);
    if (inverse <= 1e-12) return 0.0;
    const impulse = (1.0 + restitution) * approach / inverse;
    this.applyImpulse(scale(normal, impulse), contactPoint);
    return impulse;
  }

  step(dt) {
    if (!this.hit || dt <= 0.0) return;
    const inertia = this.inertia_center;
    const alpha = (this.height / 2.0) * config.GRAVITY * Math.sin(this.angle) / inertia;
    this.omega = Math.abs(this.omega) + Math.abs(alpha) * dt;
    this._clampSpin();
    let angle = this.angle + this.omega * dt;
    if (angle >= Math.PI / 2.0) { angle = Math.PI / 2.0; this.omega = 0.0; }
    this.angle = angle;
    this._slide(dt);
    this._place();
    this._resolveDeck(dt);
    this._updateState();
    this.spin += 0.5 * this.omega * dt;
  }

  _slide(dt) {
    const speed = Math.hypot(this.velocity[0], this.velocity[2]);
    if (speed > 0.0) {
      const change = Math.min(speed, config.PIN_DECK_FRICTION * config.GRAVITY * dt);
      const factor = (speed - change) / speed;
      this.velocity = [this.velocity[0] * factor, 0.0, this.velocity[2] * factor];
      if (Math.abs(this.velocity[0]) < 1e-9 && Math.abs(this.velocity[2]) < 1e-9) {
        this.velocity = [0.0, 0.0, 0.0];
      }
    }
    this.base = [this.base[0] + this.velocity[0] * dt,
                 this.base[1] + this.velocity[2] * dt];
    this._resolveBounds();
  }

  _resolveBounds() {
    const limit = config.LANE_WIDTH / 2.0;
    const bounce = config.PIN_KICKBACK_RESTITUTION;
    let [x, z] = this.base;
    if (x > limit) {
      x = limit;
      if (this.velocity[0] > 0.0) {
        this.velocity = [-this.velocity[0] * bounce, 0.0, this.velocity[2]];
        this.kickback_hits += 1;
      }
    } else if (x < -limit) {
      x = -limit;
      if (this.velocity[0] < 0.0) {
        this.velocity = [-this.velocity[0] * bounce, 0.0, this.velocity[2]];
        this.kickback_hits += 1;
      }
    }
    const pitZ = config.LANE_LENGTH + config.PIN_DECK_LENGTH;
    if (z > pitZ) {
      z = pitZ;
      this.velocity = [0.0, 0.0, 0.0];
      this.in_pit = true;
    }
    this.base = [x, z];
  }

  _resolveDeck(dt) {
    if (this.com[1] < this.radius) this.com = [this.com[0], this.radius, this.com[2]];
  }

  _updateDown() {
    if (Math.abs(this.angle) >= config.PIN_DOWN_ANGLE * Math.PI / 180) this.down = true;
  }

  _updateState() {
    if (Math.abs(this.angle) >= config.PIN_FALL_ANGLE && this.state !== PinPhysics.FALLEN) {
      this.state = PinPhysics.FALLEN;
    }
    const moving = length(this.velocity) > config.PIN_STOP_SPEED || Math.abs(this.omega) > config.PIN_SPIN_STOP;
    if (this.hit) this.down = this.down || this.downThresholdMet();
    if (moving) {
      if (this.state === PinPhysics.STANDING) this.state = PinPhysics.TIPPING;
    } else if (this.state === PinPhysics.FALLEN || this.state === PinPhysics.TIPPING) {
      this.state = PinPhysics.SETTLED;
    }
  }

  downThresholdMet() { return Math.abs(this.angle) >= config.PIN_DOWN_ANGLE * Math.PI / 180; }
  get upright() { return this.angle < config.PIN_PLANT_ANGLE; }
  get angleFromVertical() { return Math.abs(this.angle); }
  get active() { return this.state !== PinPhysics.SETTLED; }
  get atRest() { return length(this.velocity) <= config.PIN_STOP_SPEED && Math.abs(this.omega) <= config.PIN_SPIN_STOP; }
  get standing() { return !this.down && !this.removed; }

  captureState() {
    return {
      base: this.base.slice(), com: this.com.slice(), velocity: this.velocity.slice(),
      lean: this.lean.slice(), angle: this.angle, omega: this.omega, spin: this.spin,
      pinned: this.pinned, state: this.state, hit: this.hit, down: this.down,
      removed: this.removed, ball_struck: this.ball_struck, in_pit: this.in_pit,
      kickback_hits: this.kickback_hits,
    };
  }
  restoreState(s) {
    this.base = s.base.slice(); this.com = s.com.slice(); this.velocity = s.velocity.slice();
    this.lean = s.lean.slice(); this.angle = s.angle; this.omega = s.omega; this.spin = s.spin;
    this.pinned = s.pinned; this.state = s.state; this.hit = s.hit; this.down = s.down;
    this.removed = s.removed; this.ball_struck = s.ball_struck; this.in_pit = s.in_pit;
    this.kickback_hits = s.kickback_hits;
  }

  ballContact(ball) {
    const position = ball.position;
    const px = position[0], pz = position[2];
    const [ax, az] = this.base;
    const axis = this.axis;
    const closest = closestPointOnSegment2d(px, pz, ax, az,
      ax + this.height * axis[0], az + this.height * axis[2]);
    const offsetX = px - closest[0];
    const offsetZ = pz - closest[1];
    const distance = Math.hypot(offsetX, offsetZ);
    const reach = ball.radius + this.contact_radius;
    if (distance > reach || distance <= 1e-9) return null;
    const outward = [offsetX / distance, 0.0, offsetZ / distance];
    const push = scale(outward, -1.0);
    const height = Math.max(this.radius, Math.min(position[1], this.height - this.radius));
    const contactPoint = [closest[0] + outward[0] * this.contact_radius, height,
                          closest[1] + outward[2] * this.contact_radius];
    return [push, contactPoint, reach - distance];
  }

  ballCollision(ball, push, contactPoint) {
    if (this.state === PinPhysics.SETTLED) return null;
    const impulse = this.resolveBallContact(contactPoint, ball.velocity, ball.mass,
                                            push, config.RESTITUTION_BALL_PIN);
    if (impulse <= 0.0) return null;
    return scale(push, -impulse / ball.mass);
  }
}

PinPhysics.STANDING = 'standing';
PinPhysics.TIPPING = 'tipping';
PinPhysics.FALLEN = 'fallen';
PinPhysics.SETTLED = 'settled';

export function resolvePinPin(a, b, restitution) {
  if (!(a.active && b.active)) return 0.0;
  const [ax, az] = a.base, [bx, bz] = b.base;
  const aAxis = a.axis, bAxis = b.axis;
  const a0 = [ax, az], a1 = [ax + aAxis[0] * a.height, az + aAxis[2] * a.height];
  const b0 = [bx, bz], b1 = [bx + bAxis[0] * b.height, bz + bAxis[2] * b.height];
  const [[paX, paZ], [pbX, pbZ]] = closestPointsBetweenSegments2d(a0, a1, b0, b1);
  const dx = pbX - paX, dz = pbZ - paZ;
  const distance = Math.hypot(dx, dz);
  const clearance = config.PIN_PIN_CLEARANCE;
  if (distance <= 1e-9 || distance > clearance) return 0.0;
  const normal = [dx / distance, 0.0, dz / distance];
  const height = Math.min(lineHeight(a, segmentParameter(paX, paZ, a0, a1)),
                          lineHeight(b, segmentParameter(pbX, pbZ, b0, b1)));
  const pointA = [paX, height, paZ];
  const pointB = [pbX, height, pbZ];
  const velocityA = a.pointVelocity(sub(pointA, a.center_position));
  const velocityB = b.pointVelocity(sub(pointB, b.center_position));
  const approach = dot(sub(velocityA, velocityB), normal);
  if (approach <= 0.0) return 0.0;
  const inverse = 1.0 / a.mass + a.inverseMassAt(pointA, normal)
    + 1.0 / b.mass + b.inverseMassAt(pointB, normal);
  if (inverse <= 1e-12) return 0.0;
  const impulse = (1.0 + restitution) * approach / inverse;
  const half = 0.5 * (clearance - distance);
  a.shift([-normal[0] * half, 0.0, -normal[2] * half]);
  b.shift([normal[0] * half, 0.0, normal[2] * half]);
  a.applyImpulse(scale(normal, -impulse), pointA);
  b.applyImpulse(scale(normal, impulse), pointB);
  return impulse;
}

function segmentParameter(px, pz, start, end) {
  const dx = end[0] - start[0], dz = end[1] - start[1];
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-18) return 0.0;
  const t = ((px - start[0]) * dx + (pz - start[1]) * dz) / lengthSq;
  return Math.max(0.0, Math.min(1.0, t));
}

function lineHeight(pin, parameter) {
  return Math.min(pin.height - pin.radius, Math.max(pin.radius, parameter * pin.height));
}

// ---------------------------------------------------------------------------
// Rack layout and the shared deck simulation
// ---------------------------------------------------------------------------
export function rackPositions() {
  const rowDepth = config.PIN_SPACING * Math.cos(30.0 * Math.PI / 180);
  const positions = [];
  for (let row = 0; row < config.PIN_ROWS; row++) {
    const count = row + 1;
    const z = config.HEAD_PIN_Z + row * rowDepth;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2.0) * config.PIN_SPACING;
      positions.push([x, z]);
    }
  }
  return positions;
}

export class Deck {
  constructor(pins = null, ball = null) {
    this.pins = pins === null
      ? Array.from({ length: config.PIN_COUNT }, () => new PinPhysics())
      : pins.slice();
    this.ball = ball === null ? new BallPhysics() : ball;
    this.ball_done = false;
    this.roll_down = new Set();
    this.ignore = new Set();
    this.elapsed = 0.0;
    this.trajectory = [];
    this.record_trajectory = false;
    this.first_contact_time = null;
    this.impact_speed = null;
    this.substep_listener = null;
    this._accumulator = 0.0;
  }

  fullRack() { this.setRack(rackPositions()); }

  setRack(positions) {
    for (let index = 0; index < this.pins.length; index++) {
      const pin = this.pins[index];
      if (index < positions.length) {
        const [x, z] = positions[index];
        pin.reset();
        pin.setBase(x, z);
      } else {
        pin.reset();
        pin.removed = true;
        pin.down = true;
      }
    }
  }

  beginRoll() {
    for (const pin of this.pins) pin.ball_struck = false;
    this.roll_down = new Set();
    this.ignore = new Set();
    for (let index = 0; index < this.pins.length; index++) {
      const pin = this.pins[index];
      if (pin.down || pin.removed) this.ignore.add(index);
    }
    this.ball_done = false;
    this._accumulator = 0.0;
    this.elapsed = 0.0;
    this.first_contact_time = null;
    this.impact_speed = null;
  }

  recordStart() { this.trajectory = []; this.record_trajectory = true; }

  captureState() {
    return {
      ball: this.ball.captureState(),
      pins: this.pins.map((p) => p.captureState()),
      elapsed: this.elapsed, roll_down: new Set(this.roll_down),
      ignore: new Set(this.ignore), ball_done: this.ball_done,
      first_contact_time: this.first_contact_time, impact_speed: this.impact_speed,
    };
  }
  restoreState(state) {
    this.ball.restoreState(state.ball);
    for (let i = 0; i < this.pins.length; i++) this.pins[i].restoreState(state.pins[i]);
    this.elapsed = state.elapsed;
    this.roll_down = new Set(state.roll_down);
    this.ignore = new Set(state.ignore);
    this.ball_done = state.ball_done;
    this.first_contact_time = state.first_contact_time;
    this.impact_speed = state.impact_speed;
    this._accumulator = 0.0;
  }

  standingCount() { return this.pins.reduce((n, p) => n + (p.standing ? 1 : 0), 0); }

  knockdownCount() { this._collect(); return this.roll_down.size; }
  quiet() { return this.pins.every((p) => p.atRest); }

  advance(dt) {
    if (!this.ball.rolling) { this.ball_done = true; return; }
    this._runSubsteps(dt, true);
    this._collect();
  }
  settle(dt) {
    this._runSubsteps(dt, false);
    this._collect();
  }

  _runSubsteps(dt, withBall) {
    if (dt <= 0.0) return;
    this._accumulator += dt;
    const step = config.PHYSICS_SUBSTEP;
    let ran = 0;
    while (this._accumulator >= step - 1e-9 && ran < config.PHYSICS_MAX_SUBSTEPS) {
      this._accumulator -= step;
      this._substep(step, withBall);
      ran += 1;
      this.elapsed += step;
      if (this.substep_listener !== null) this.substep_listener(this);
      if (withBall && this.ball_done) break;
    }
    if (ran >= config.PHYSICS_MAX_SUBSTEPS) this._accumulator = 0.0;
  }

  _substep(dt, withBall) {
    const ballPhysics = withBall ? this.ball : null;
    if (ballPhysics !== null && ballPhysics.rolling) ballPhysics.step(dt);
    for (const pin of this.pins) pin.step(dt);
    if (ballPhysics !== null && ballPhysics.rolling) this._resolveBallContacts(ballPhysics);
    this._collidePins();
    if (ballPhysics !== null) {
      if (ballPhysics.atEndOfLane() || ballPhysics.stopped || ballPhysics.in_gutter) {
        ballPhysics.rolling = false;
        this.ball_done = true;
      }
    }
    if (this.record_trajectory && ballPhysics !== null) {
      this.trajectory.push([this.elapsed, ballPhysics.position[0], ballPhysics.position[2]]);
    }
  }

  _collect() {
    for (let index = 0; index < this.pins.length; index++) {
      const pin = this.pins[index];
      if (pin.down && !pin.removed && !this.ignore.has(index)) this.roll_down.add(index);
    }
  }

  _resolveBallContacts(ballPhysics) {
    for (let _i = 0; _i < this.pins.length; _i++) {
      let best = null;
      for (const pin of this.pins) {
        if (pin.state === PinPhysics.SETTLED || pin.ball_struck) continue;
        const contact = pin.ballContact(ballPhysics);
        if (contact === null) continue;
        const [push, point, overlap] = contact;
        const along = ballPhysics.velocity[0] * push[0] + ballPhysics.velocity[2] * push[2];
        if (along <= 0.0) continue;
        if (best === null || overlap > best[0]) best = [overlap, pin, push, point];
      }
      if (best === null) return;
      const [_overlap, pin, push, point] = best;
      pin.ball_struck = true;
      if (this.first_contact_time === null) {
        this.first_contact_time = this.elapsed;
        this.impact_speed = Math.hypot(ballPhysics.velocity[0], ballPhysics.velocity[2]);
      }
      const deltaV = pin.ballCollision(ballPhysics, push, point);
      if (deltaV !== null && deltaV.length === 3) {
        ballPhysics.bounce([deltaV[0] * ballPhysics.mass, 0.0, deltaV[2] * ballPhysics.mass]);
      }
      const [baseX, baseZ] = pin.base_xy();
      const gap = Math.max(ballPhysics.radius * 0.05, 0.005);
      const reach = ballPhysics.radius + pin.contact_radius + gap;
      ballPhysics.position = [baseX - push[0] * reach, ballPhysics.position[1],
                              baseZ - push[2] * reach];
    }
  }

  _collidePins() {
    const pins = this.pins;
    for (let i = 0; i < pins.length; i++) {
      const a = pins[i];
      if (!a.active) continue;
      for (let j = i + 1; j < pins.length; j++) {
        const b = pins[j];
        if (!b.active) continue;
        resolvePinPin(a, b, config.RESTITUTION_PIN_PIN);
      }
    }
  }
}

export class RollResult {
  constructor(deck, frames, releaseSpeed = 0.0) {
    this.deck = deck;
    this.frames = frames;
    this.knockdowns = deck.knockdownCount();
    this.ball = deck.ball;
    this.trajectory = deck.trajectory.slice();
    this.travel_time = deck.elapsed;
    this.standing_after = deck.standingCount();
    this.release_speed = releaseSpeed;
  }
  get distance() {
    if (!this.trajectory.length) return 0.0;
    return this.trajectory[this.trajectory.length - 1][2] - config.FOUL_LINE_Z;
  }
  lateralDrift() {
    if (!this.trajectory.length) return 0.0;
    return this.trajectory[this.trajectory.length - 1][1] - this.trajectory[0][1];
  }
}

export class DeckTimeline {
  constructor() { this.states = []; this.times = []; }
  get length() { return this.states.length; }
  clear() { this.states = []; this.times = []; }
  record(deck) { this.states.push(deck.captureState()); this.times.push(deck.elapsed); }
  duration() { return this.times.length ? this.times[this.times.length - 1] : 0.0; }
  indexAt(time) {
    if (!this.times.length) return null;
    let t = Math.max(this.times[0], Math.min(Number(time), this.times[this.times.length - 1]));
    let index = bisectLeft(this.times, t);
    if (index >= this.times.length) return this.times.length - 1;
    if (index > 0 && (t - this.times[index - 1]) < (this.times[index] - t)) return index - 1;
    return index;
  }
  timeOf(index) { return this.times[index]; }
  ballState(index) { return this.states[index].ball; }
  restore(deck, index) {
    index = Math.max(0, Math.min(index | 0, this.states.length - 1));
    deck.restoreState(this.states[index]);
    if (deck.record_trajectory) {
      deck.trajectory = [];
      for (let k = 1; k <= index; k++) {
        deck.trajectory.push([this.times[k], this.states[k].ball.position[0],
                              this.states[k].ball.position[2]]);
      }
    }
    return index;
  }
  truncate(index) {
    index = Math.max(0, Math.min(index | 0, this.states.length - 1));
    this.states.length = index + 1;
    this.times.length = index + 1;
    return index;
  }
}

function bisectLeft(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

export function simulateRoll({ speed = 7.0, lateral_position = 0.0, launch_angle = 0.0,
                               spin_omega = 0.0 } = {}, deck = null, standing = null,
                               dt = null, record = false, max_time = 20.0) {
  const d = deck === null ? new Deck() : deck;
  if (standing === null) d.fullRack(); else d.setRack(standing);
  d.beginRoll();
  d.ball.launch(speed, lateral_position, launch_angle, spin_omega);
  const releaseSpeed = Math.hypot(d.ball.velocity[0], d.ball.velocity[2]);
  if (record) d.recordStart();
  const step = dt === null ? config.PHYSICS_SUBSTEP : dt;
  let frames = 0, time = 0.0;
  while (time < max_time) {
    if (d.ball_done) { if (d.quiet()) break; d.settle(step); }
    else d.advance(step);
    time += step;
    frames += 1;
  }
  return new RollResult(d, frames, releaseSpeed);
}
