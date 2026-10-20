"""Rigid-body bowling physics. Pure Python + stdlib, no engine imports.

Units and conventions
---------------------
* SI units throughout (metres, kilograms, seconds, radians). Angles are
  counter-clockwise positive.
* Lane frame: ``+z`` points from the foul line towards the pins, ``+x`` is
  lateral (right as seen from behind the foul line), ``+y`` is up. Gravity
  acts along ``-y``.
* Ball: a homogeneous sphere. Pin: a homogeneous rod with a belly and a head
  (an idealised pin; a real pin's mass is not uniformly distributed).
* Collisions are resolved with impulses and a coefficient of restitution.
  Every equation is written out next to the code that uses it, together with
  its assumptions. Parameters live in :mod:`config`.

This is a standard idealised rigid-body model, not a measured replication of
real bowling. See docs/PHYSICS.md for derivations and known limitations.
"""
import bisect
import math
from collections import namedtuple

import config

# ---------------------------------------------------------------------------
# Recorded states (the Physics Lab's timeline)
# ---------------------------------------------------------------------------
# ``capture_state`` / ``restore_state`` freeze and restore every *mutable*
# field a body carries, so restoring a recorded state is exact: continuing
# from it integrates the same trajectory the simulation would have produced.
# Build-time properties that never change during a run (masses, radii,
# inertias, geometry) are deliberately not part of a state - they belong to
# the body, not to the run.

BallState = namedtuple('BallState', (
    'position velocity angular_velocity orientation theta rolling in_gutter '
    'finished stopped launch_angle spin_omega last_acceleration last_torque'))
PinState = namedtuple('PinState', (
    'base com velocity lean angle omega spin pinned state hit down removed '
    'ball_struck in_pit kickback_hits'))
DeckState = namedtuple('DeckState', (
    'ball pins elapsed roll_down ignore ball_done first_contact_time '
    'impact_speed'))


# ---------------------------------------------------------------------------
# Small linear-algebra helpers. Vectors are (x, y, z) tuples; matrices are
# tuples of three row tuples.
# ---------------------------------------------------------------------------


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _length(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _normalize(a):
    length = _length(a)
    if length <= 1e-12:
        return (0.0, 0.0, 0.0)
    inverse = 1.0 / length
    return (a[0] * inverse, a[1] * inverse, a[2] * inverse)


def _unit2(x, z):
    """Return a unit ``(x, 0, z)`` vector; ``(0, 0, 0)`` if the input is 0."""
    length = math.hypot(x, z)
    if length <= 1e-12:
        return (0.0, 0.0, 0.0)
    return (x / length, 0.0, z / length)


def _matrix_multiply(a, b):
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )


def _matrix_vector(m, v):
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


def _quat_from_axis_angle(axis, angle):
    """Quaternion ``q = (cos(a/2), sin(a/2) * axis)`` for a unit axis."""
    half = 0.5 * angle
    sin_half = math.sin(half)
    return (math.cos(half),
            axis[0] * sin_half,
            axis[1] * sin_half,
            axis[2] * sin_half)


def _quat_to_matrix(q):
    """Rotation matrix for a (possibly unnormalised) quaternion."""
    w, x, y, z = q
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if norm <= 1e-12:
        return _IDENTITY_MATRIX
    w, x, y, z = w / norm, x / norm, y / norm, z / norm
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return (
        (1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy)),
        (2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx)),
        (2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy)),
    )


def _matrix_to_euler_degrees(m):
    """Intrinsic X, then Y, then Z Euler angles, matching Ursina's rotation.

    For ``R = Rx(a) * Ry(b) * Rz(c)`` the matrix elements give
    ``b = asin(m02)``, ``a = atan2(-m12, m22)``, ``c = atan2(-m01, m00)``
    (with the usual gimbal-lock fallback when ``|m02| ~ 1``).
    """
    sin_b = max(-1.0, min(1.0, m[0][2]))
    b = math.asin(sin_b)
    if abs(sin_b) < 0.99999:
        a = math.atan2(-m[1][2], m[2][2])
        c = math.atan2(-m[0][1], m[0][0])
    else:                                    # pitch = +-90 degrees
        a = math.atan2(m[2][1], m[1][1])
        c = 0.0
    return (math.degrees(a), math.degrees(b), math.degrees(c))


def euler_degrees(matrix):
    """Public wrapper: rotation matrix -> Ursina-compatible rotation tuple."""
    return _matrix_to_euler_degrees(matrix)


def _integrate_orientation(orientation, angular_velocity, dt):
    """Rotate an orientation matrix by ``omega * dt`` (axis-angle, exact).

    ``R_new = exp([omega dt]_x) * R_old`` is exact for constant omega, and
    building it from a quaternion avoids matrix drift.
    """
    magnitude = _length(angular_velocity)
    if magnitude <= 1e-12:
        return orientation
    axis = _scale(angular_velocity, 1.0 / magnitude)
    step = _quat_to_matrix(_quat_from_axis_angle(axis, magnitude * dt))
    return _matrix_multiply(step, orientation)


_IDENTITY_MATRIX = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _rolling_angular_velocity(velocity, radius):
    """Angular velocity of a ball rolling without slipping on level ground.

    The contact point is the material point at ``r = -R * y_hat``; rolling
    without slipping means ``v_contact = v + omega x r = 0``. Solving for
    ``omega`` gives ``omega = (y_hat x v) / R``. For ``v = +z`` that is
    ``omega = -|v|/R * x_hat``: seen from the ``+x`` side, a ball rolling
    away from the player spins clockwise.
    """
    return _scale(_cross((0.0, 1.0, 0.0), velocity), 1.0 / radius)


# ---------------------------------------------------------------------------
# Collision primitives
# ---------------------------------------------------------------------------


def swept_circle_time(cx, cz, radius, px, pz, dx, dz):
    """Fraction ``t in [0, 1]`` of a segment that first enters a circle.

    The ball centre travels from ``p`` to ``p + d``. A pin is a vertical body
    of radius ``radius``, and contact happens when the distance between the
    ball centre and the pin axis is ``radius`` (the sum of the two radii).
    Solving ``|p + t d - c|^2 = radius^2`` is a quadratic in ``t``; the
    smallest root in ``[0, 1]`` is the impact fraction. Returns ``0.0`` if
    the path already starts inside the circle, ``None`` if it never enters.

    Testing the whole segment rather than only the frame end points is what
    prevents a fast ball from tunnelling through a pin between frames.
    """
    ex = px - cx
    ez = pz - cz
    a = dx * dx + dz * dz
    if a <= 1e-18:
        return 0.0 if ex * ex + ez * ez <= radius * radius else None
    b = 2.0 * (ex * dx + ez * dz)
    c = ex * ex + ez * ez - radius * radius
    if c <= 0.0:
        return 0.0                     # already in contact at the start
    discriminant = b * b - 4.0 * a * c
    if discriminant < 0.0:
        return None
    root = math.sqrt(discriminant)
    denominator = 2.0 * a
    t0 = (-b - root) / denominator
    if 0.0 <= t0 <= 1.0:
        return t0
    t1 = (-b + root) / denominator
    if 0.0 <= t1 <= 1.0:
        return t1
    return None


def _closest_point_on_segment_2d(px, pz, ax, az, bx, bz):
    """Closest point of segment AB to P in the lane plane, as ``(x, z)``."""
    abx = bx - ax
    abz = bz - az
    length_sq = abx * abx + abz * abz
    if length_sq <= 1e-18:
        return (ax, az)
    t = ((px - ax) * abx + (pz - az) * abz) / length_sq
    t = max(0.0, min(1.0, t))
    return (ax + abx * t, az + abz * t)


def _closest_points_between_segments_2d(a0, a1, b0, b1):
    """Closest pair of points on two 2D segments, as ``((x, z), (x, z))``.

    Standard clamped parametric solution of the two-line least-squares
    problem (Ericson, Real-Time Collision Detection, 5.1.9). The segments are
    the lane-plane footprints of two pins regarded as flat, upright bars.
    """
    ax0, az0 = a0
    ax1, az1 = a1
    bx0, bz0 = b0
    bx1, bz1 = b1
    ux, uz = ax1 - ax0, az1 - az0
    vx, vz = bx1 - bx0, bz1 - bz0
    wx, wz = ax0 - bx0, az0 - bz0

    a = ux * ux + uz * uz
    b = ux * vx + uz * vz
    c = vx * vx + vz * vz
    d = ux * wx + uz * wz
    e = vx * wx + vz * wz
    denominator = a * c - b * b

    if denominator <= 1e-18:
        s = 0.0
        t = (e / c) if c > 1e-18 else 0.0
    else:
        s = (b * e - c * d) / denominator
        t = (a * e - b * d) / denominator
    s = max(0.0, min(1.0, s))
    if c > 1e-18:
        t = (b * s + e) / c
    t = max(0.0, min(1.0, t))
    if a > 1e-18:
        s = (b * t - d) / a
    s = max(0.0, min(1.0, s))
    return ((ax0 + ux * s, az0 + uz * s), (bx0 + vx * t, bz0 + vz * t))


# ---------------------------------------------------------------------------
# Ball
# ---------------------------------------------------------------------------


class BallPhysics:
    """A homogeneous sphere rolling on a horizontal lane.

    Three regimes with established equations:

    * Skid (the release): the contact point slips, so kinetic friction acts
      opposite the slip direction; its torque spins the ball up until the
      contact point is instantaneously at rest.
    * Roll: ``v = R * omega`` with ``omega`` perpendicular to the travel
      direction; rolling resistance decelerates the ball.
    * Collisions: impulses from :meth:`PinPhysics.resolve_ball_contact` and
      :func:`resolve_pin_pin` (the scene layer calls these; this class only
      owns the state).
    """

    def __init__(self, radius=None, mass=None, inertia_type=None):
        self.radius = radius if radius is not None else config.BALL_RADIUS
        self.mass = mass if mass is not None else config.BALL_MASS
        self.inertia_type = inertia_type or config.BALL_INERTIA_TYPE

        # Moment of inertia about an axis through the centre:
        #   solid sphere:  I = (2/5) * M * R^2
        #   hollow shell:  I = (2/3) * M * R^2
        if self.inertia_type == "shell":
            self.inertia = (2.0 / 3.0) * self.mass * self.radius ** 2
        else:
            self.inertia = (2.0 / 5.0) * self.mass * self.radius ** 2

        # The Physics Lab can study a different surface: a multiplier on every
        # friction coefficient. Normal play leaves it at 1.0, and the lab puts
        # it back when it closes.
        self.friction_scale = 1.0
        self.reset()

    # ------------------------------------------------------------------ state
    def reset(self):
        self.position = (0.0, self.radius, config.FOUL_LINE_Z)
        self.velocity = (0.0, 0.0, 0.0)
        self.angular_velocity = (0.0, 0.0, 0.0)
        self.orientation = _IDENTITY_MATRIX
        self.theta = 0.0             # accumulated roll angle (rad)
        self.rolling = False         # True while the ball is moving down-lane
        self.in_gutter = False
        self.finished = False        # set by the scene when the roll is over
        self.stopped = False
        self.launch_angle = 0.0      # yaw of the initial velocity (rad)
        self.spin_omega = 0.0        # hook spin about +y at launch (rad/s)
        self.last_acceleration = (0.0, 0.0, 0.0)
        self.last_torque = (0.0, 0.0, 0.0)   # last torque acting (for display)

    # ------------------------------------------------------- derived values
    @property
    def speed(self):
        """Scalar ground speed (m/s)."""
        return math.hypot(self.velocity[0], self.velocity[2])

    @property
    def linear_momentum(self):
        """p = m * v  (kg m/s)."""
        return _scale(self.velocity, self.mass)

    @property
    def angular_momentum(self):
        """|L| = I * |omega|  (kg m^2/s), for display and tests."""
        return self.inertia * _length(self.angular_velocity)

    @property
    def angular_momentum_vector(self):
        """L = I * omega  (kg m^2/s) as a vector."""
        return _scale(self.angular_velocity, self.inertia)

    @property
    def revolutions(self):
        """Number of full rotations since launch."""
        return self.theta / (2.0 * math.pi)

    # ---------------------------------------------------------- scalar views
    # Kept so the rest of the game can address the ball as (x, z, v) without
    # caring that the physics state is a 3-vector.
    @property
    def x(self):
        return self.position[0]

    @x.setter
    def x(self, value):
        self.position = (value, self.position[1], self.position[2])

    @property
    def z(self):
        return self.position[2]

    @z.setter
    def z(self, value):
        self.position = (self.position[0], self.position[1], value)

    @property
    def v(self):
        """Down-lane speed component (m/s)."""
        return self.velocity[2]

    @v.setter
    def v(self, value):
        self.velocity = (self.velocity[0], 0.0, value)

    # ------------------------------------------------------------------ motion
    def launch(self, speed, lateral_position=0.0, launch_angle=0.0, spin_omega=0.0):
        """Begin a roll from a ThrowData-shaped set of values.

        The launch velocity is ``v0 = (sin(a) * s, 0, cos(a) * s)``.

        Release spin is the sum of two measured parts:

        * the rolling component ``(y_hat x v) / R``, i.e. the ball released
          already spinning to roll without slipping along ``v``;
        * the hook component ``spin_omega`` about the *travel direction*
          (``+v_hat``), which is the "axis rotation" of a real release: the
          spin axis is tilted away from the pure-roll axis towards the line of
          travel, exactly as a bowler's ball does.

        With a hook component the ball is no longer rolling without slipping:
        the contact point slips sideways by ``R * spin_omega`` and friction
        acts against that slip, which is what bends the path (see
        :meth:`step`). A pure spin about +y would instead produce *no* lateral
        motion at all (its contribution to the contact-point velocity is
        zero), which is why the hook is modelled on the travel axis.
        """
        self.position = (lateral_position, self.radius, config.FOUL_LINE_Z)
        speed = max(0.0, float(speed))
        self.velocity = (math.sin(launch_angle) * speed,
                         0.0,
                         math.cos(launch_angle) * speed)
        rolling_spin = _rolling_angular_velocity(self.velocity, self.radius)
        travel = _normalize(self.velocity)
        self.angular_velocity = _add(
            rolling_spin, _scale(travel, float(spin_omega)))
        self.orientation = _IDENTITY_MATRIX
        self.theta = 0.0
        self.launch_angle = launch_angle
        self.spin_omega = spin_omega
        self.in_gutter = False
        self.finished = False
        self.stopped = False
        self.rolling = speed > 1e-6
        # A new roll starts with no recorded force history (display only).
        self.last_acceleration = (0.0, 0.0, 0.0)
        self.last_torque = (0.0, 0.0, 0.0)

    def contact_point_velocity(self):
        """Velocity of the material point of the ball touching the ground.

        ``v_c = v + omega x r`` with ``r = -R * y_hat``.
        """
        return _add(self.velocity,
                    _cross(self.angular_velocity, (0.0, -self.radius, 0.0)))

    def slip_speed(self):
        """How fast the contact point is slipping (m/s); 0 = pure rolling."""
        return _length(self.contact_point_velocity())

    def step(self, dt):
        """Advance the roll by ``dt`` seconds.

        Sliding phase - kinetic friction:
            ``F = mu_k * m * g``, ``a = -mu_k * g * v_slip_hat``
            ``tau = r x F``,  ``alpha = tau / I``
        Roll phase - rolling resistance:
            ``F = mu_r * m * g``, ``a = -mu_r * g * v_hat``
        The ball switches to the roll phase once the contact point stops
        slipping (``|v_slip| <= SLIP_TOLERANCE``); the angular velocity is
        then snapped exactly onto the no-slip solution ``omega = (y_hat x v)/R``.
        """
        if not self.rolling or dt <= 0.0:
            return

        velocity = self.velocity
        speed = self.speed
        if speed <= config.BALL_STOP_SPEED:
            self._come_to_rest()
            return

        # The friction type is fixed for the whole substep from the state at
        # its start; the contact point is re-tested afterwards.
        slip_speed = self.slip_speed()
        was_sliding = slip_speed > config.SLIP_TOLERANCE
        if was_sliding:
            mu = (config.GUTTER_FRICTION if self.in_gutter
                  else config.SLIDING_FRICTION)
            direction = _scale(self.contact_point_velocity(), -1.0 / slip_speed)
        else:
            mu = (config.GUTTER_FRICTION if self.in_gutter
                  else config.ROLLING_FRICTION)
            direction = _scale(velocity, -1.0 / speed)
        mu *= self.friction_scale

        # F = mu * m * g and a = F / m, so a = mu * g in the friction direction.
        acceleration = _scale(direction, mu * config.GRAVITY)
        self.last_acceleration = acceleration

        # Numerically stable explicit update for the constant acceleration
        # over this substep:  v1 = v0 + a*dt,  s = (v0 + v1)/2 * dt.
        new_velocity = _add(velocity, _scale(acceleration, dt))
        self.velocity = new_velocity
        self.position = _add(self.position,
                             _scale(_add(velocity, new_velocity), 0.5 * dt))

        if was_sliding:
            # Dry friction acts at the contact point, so
            # ``tau = r x F = r x (m a)`` and ``alpha = tau / I``. For a solid
            # sphere this reduces to ``alpha = -(5 a)/(2 R)``.
            torque = _cross((0.0, -self.radius, 0.0),
                            _scale(acceleration, self.mass))
            self.last_torque = torque
            self.angular_velocity = _add(
                self.angular_velocity,
                _scale(_scale(torque, 1.0 / self.inertia), dt))
        else:
            # Rolling: the no-slip constraint fixes the angular acceleration to
            # ``alpha = (y_hat x a) / R`` (the time derivative of
            # ``omega = (y_hat x v)/R``). Updating from the constraint keeps the
            # contact velocity zero at any timestep; through a separate torque
            # update it would disagree with the linear update by O(dt) and a
            # large frame could nudge the ball into a spurious slide. The
            # equivalent torque ``I * alpha`` is recorded for the readout.
            angular_acceleration = _scale(
                _cross((0.0, 1.0, 0.0), acceleration), 1.0 / self.radius)
            self.last_torque = _scale(angular_acceleration, self.inertia)
            self.angular_velocity = _add(
                self.angular_velocity,
                _scale(angular_acceleration, dt))

        new_speed = self.speed
        if new_speed <= config.BALL_STOP_SPEED:
            self._come_to_rest()
            return
        if not was_sliding and self.slip_speed() <= config.SLIP_TOLERANCE:
            self.angular_velocity = _rolling_angular_velocity(
                self.velocity, self.radius)

        self.orientation = _integrate_orientation(
            self.orientation, self.angular_velocity, dt)
        self.theta += _length(self.angular_velocity) * dt
        self._apply_bounds()

    def _apply_bounds(self):
        """Keep the ball on the lane; mark it once it enters a gutter."""
        lateral_limit = config.LANE_WIDTH / 2.0 + config.GUTTER_WIDTH
        x, y, z = self.position
        if abs(x) > lateral_limit:
            x = math.copysign(lateral_limit, x)
        if abs(x) > config.LANE_WIDTH / 2.0:
            self.in_gutter = True
        self.position = (x, y, z)

    def _come_to_rest(self):
        self.velocity = (0.0, 0.0, 0.0)
        self.angular_velocity = (0.0, 0.0, 0.0)
        self.rolling = False
        self.stopped = True
        self.last_acceleration = (0.0, 0.0, 0.0)
        self.last_torque = (0.0, 0.0, 0.0)

    # ----------------------------------------------------------------- helpers
    def _reset_roll(self):
        """Restore the no-slip relation for the current velocity."""
        if self.speed > config.BALL_STOP_SPEED:
            self.angular_velocity = _rolling_angular_velocity(
                self.velocity, self.radius)
            self.rolling = True
        else:
            self._come_to_rest()

    def bounce(self, impulse):
        """Collision response: ``delta_v = J / m`` plus the matching spin.

        The contact point of a ball is on its centre line (the pin is hit at
        the ball's height), so the impulse acts through the centre of mass and
        produces no torque. The angular velocity is reset to the no-slip value
        so a collision cannot leave the ball in a permanent skid. Unlike
        :meth:`apply_impulse` this leaves the accumulated roll angle alone, so
        it is safe to call inside the physics sub-steps.
        """
        self.velocity = _add(self.velocity, _scale(impulse, 1.0 / self.mass))
        self._reset_roll()

    def apply_impulse(self, impulse):
        """Legacy alias of :meth:`bounce` (kept for tests and tools)."""
        self.bounce(impulse)

    def set_speed(self, speed, direction=None):
        """Force a new ground speed, keeping the roll consistent."""
        speed = max(0.0, float(speed))
        if speed <= config.BALL_STOP_SPEED:
            self._come_to_rest()
            return
        if direction is None or _length(direction) <= 1e-12:
            direction = _normalize(self.velocity)
        if _length(direction) <= 1e-12:
            direction = (0.0, 0.0, 1.0)
        self.velocity = _scale(direction, speed)
        self.angular_velocity = _rolling_angular_velocity(
            self.velocity, self.radius)
        self.rolling = True
        self.stopped = False

    def rotation_euler(self):
        """Current orientation as Ursina-compatible (x, y, z) degrees."""
        return _matrix_to_euler_degrees(self.orientation)

    def at_end_of_lane(self):
        """True once the ball has rolled past the pin deck into the pit."""
        return self.z >= (config.LANE_LENGTH + config.PIN_DECK_LENGTH
                          + config.BALL_RADIUS)

    # -------------------------------------------------------------- snapshots
    def capture_state(self):
        """A restorable copy of every field a roll can change (see module doc)."""
        return BallState(
            self.position, self.velocity, self.angular_velocity,
            self.orientation, self.theta, self.rolling, self.in_gutter,
            self.finished, self.stopped, self.launch_angle, self.spin_omega,
            self.last_acceleration, self.last_torque)

    def restore_state(self, state):
        """Restore a :meth:`capture_state` snapshot exactly."""
        (self.position, self.velocity, self.angular_velocity,
         self.orientation, self.theta, self.rolling, self.in_gutter,
         self.finished, self.stopped, self.launch_angle, self.spin_omega,
         self.last_acceleration, self.last_torque) = state


# ---------------------------------------------------------------------------
# Pins
# ---------------------------------------------------------------------------


class PinPhysics:
    """A bowling pin as a planar rigid rod: translation plus tilt.

    A pin's interesting motion is planar: it translates over the deck and
    leans in one direction, and that is enough to model toppling, skidding
    and the pin-to-pin chain reaction. The state is a base position, a lean
    direction (a horizontal unit vector), a tip angle and a tip rate.

    Phases

    * *Planted* (upright, base on the deck): a physical pendulum about the
      base, ``I_base = (1/3) M L^2``. A blow rotates it without launching it.
    * *Released* (tipped past ``PIN_PLANT_ANGLE``): a free rod translating at
      its centre of mass and rotating about it, ``I_cm = (1/12) M L^2``. The
      handover preserves ``v_cm = omega x (base - cm)`` so no energy appears.
    * *Lying flat* (90 degrees): it cannot rotate further; friction stops the
      skid.

    Inertia values (rod, length L, radius r, mass M):
        transverse through the centre: ``(1/12) M L^2``
        about the base:                ``(1/3) M L^2``
        about the long axis:           ``(1/2) M r^2``
    """

    STANDING = 'standing'
    TIPPING = 'tipping'
    FALLEN = 'fallen'
    SETTLED = 'settled'

    def __init__(self, height=None, mass=None, radius=None):
        self.height = height if height is not None else config.PIN_HEIGHT
        self.mass = mass if mass is not None else config.PIN_MASS
        self.radius = radius if radius is not None else config.PIN_MAX_RADIUS

        self.inertia_center = (1.0 / 12.0) * self.mass * self.height ** 2
        self.inertia_base = (1.0 / 3.0) * self.mass * self.height ** 2
        self.inertia_axis = 0.5 * self.mass * self.radius ** 2

        # The belly is the widest part and the part that meets the ball and
        # the neighbouring pins at rack spacing.
        self.contact_height = max(self.radius, config.PIN_CONTACT_HEIGHT)
        self.contact_radius = self.radius
        self.reset()

    # ------------------------------------------------------------------ state
    def reset(self):
        self.base = (0.0, 0.0)             # contact patch (x, z)
        self.com = (0.0, self.height / 2.0, 0.0)
        self.velocity = (0.0, 0.0, 0.0)    # centre-of-mass velocity
        self.lean = (0.0, 0.0, 1.0)        # horizontal unit vector
        self.angle = 0.0                   # tilt from vertical (rad)
        self.omega = 0.0                   # tip rate (rad/s)
        self.spin = 0.0                    # rotation about its long axis (rad)
        self.pinned = True
        self.state = PinPhysics.STANDING
        self.hit = False
        self.down = False
        self.removed = False
        self.ball_struck = False     # the current roll's ball has hit this pin
        self.in_pit = False          # slid past the deck into the pit
        self.kickback_hits = 0       # diagnostics: kickback contacts this roll

    # --------------------------------------------------------------- geometry
    @property
    def axis(self):
        """Unit vector along the pin, base to head."""
        s = math.sin(self.angle)
        return (s * self.lean[0], math.cos(self.angle), s * self.lean[2])

    @property
    def com_height(self):
        """Height of the centre of mass above the deck (m)."""
        return (self.height / 2.0) * math.cos(self.angle)

    @property
    def center(self):
        return self.com

    @property
    def center_position(self):
        return self.com

    def base_xy(self):
        return self.base

    def _tip_axis(self):
        """Horizontal axis a positive ``omega`` rotates about.

        With ``lean = (sin(angle) * u_x, cos(angle), sin(angle) * u_z)`` a
        positive rate must tip the pin further along the lean, so for
        ``u = (0, 0, 1)`` (leaning towards +z) it needs ``omega = +x_hat``:
        ``axis = (u_z, 0, -u_x)``.
        """
        return (self.lean[2], 0.0, -self.lean[0])

    def tip_components(self):
        """Euler angles (x, z) in radians that reproduce the current lean."""
        return (self.angle * self.lean[2], -self.angle * self.lean[0])

    def set_base(self, x, z):
        self.base = (x, z)
        self.angle = 0.0
        self.pinned = True
        self._place()

    def _place(self):
        """Re-derive the centre of mass from the base and the lean.

        The rod's centre sits half its length along the axis, but it can never
        sink to the deck: once the pin is flat, its remaining thickness holds
        the centre at the belly radius (the pin lies *on* the deck, it does not
        pass through it).
        """
        half = self.height / 2.0
        s = math.sin(self.angle)
        height = max(self.radius, half * math.cos(self.angle))
        self.com = (self.base[0] + half * s * self.lean[0],
                    height,
                    self.base[1] + half * s * self.lean[2])

    def _place_base(self):
        """Re-derive the base from the centre of mass and the lean."""
        axis = self.axis
        self.base = (self.com[0] - axis[0] * self.height / 2.0,
                     self.com[2] - axis[2] * self.height / 2.0)

    def point_velocity(self, offset):
        """Velocity of the material point at ``offset`` from the base.

        ``v = v_cm + omega x offset`` with ``omega`` along the tip axis plus
        any residual spin about the pin's own axis.
        """
        omega_vector = _scale(self._tip_axis(), self.omega)
        return _add(self.velocity, _cross(omega_vector, offset))

    def shift(self, delta):
        """Move the pin horizontally (overlap correction), keeping the lean."""
        self.base = (self.base[0] + delta[0], self.base[1] + delta[2])
        self._place()

    def contact_point(self, radial_dir):
        """Material contact point at the belly for an approach direction."""
        axis = self.axis
        on_axis = _sub(self.com,
                       _scale(axis, self.height / 2.0 - self.contact_height))
        radial = _sub(radial_dir, _scale(axis, _dot(radial_dir, axis)))
        radial = _normalize(radial)
        return _add(on_axis, _scale(radial, self.contact_radius))

    # -------------------------------------------------------------- mobility
    def _tip_inertia(self):
        """Moment of inertia for the topple: ``I_cm = (1/12) M L^2``.

        The pin is modelled as a free rigid rod (the deck restrains its base
        only through friction, which cannot supply a rigid pivot reaction),
        so every impulse, every rotation and the energy audit share the same
        inertia. Mixed inertias were the source of earlier phantom energy.
        """
        return self.inertia_center

    def inverse_mass_at(self, contact_point, direction):
        """Mobility ``q``: contact velocity change per unit impulse.

        ``apply_impulse`` splits the impulse into centre-of-mass motion
        (``J/m``) and rotation about the base (``J (L/2) / I_base``). With
        ``I_base = (1/3) M L^2`` those two carry *equal* energy, so the
        contact's effective inverse mass is
            ``q = 2 / m``.
        This is the value the collision resolvers use to size ``J``, which is
        what makes the collision exactly conservative: the energy accounting
        below was checked symbolically for ``e <= 1``.
        """
        return 2.0 / self.mass

    def apply_impulse(self, impulse_vector, contact_point):
        """Apply a horizontal impulse; the pin skids and topples.

        Split into two parts so the bookkeeping stays exact:

        * The **linear** exchange uses the pin's full mass along the contact
          normal, which conserves momentum exactly:
          ``delta_v = J * n / m``.
        * The **rotation** is added on top from the same impulse acted about
          the deck contact patch, ``delta_omega = (L/2) * J / I_base``, which
          is what makes a struck pin topple *away* from the blow instead of
          back-spinning. It carries ``(1/2) J^2 (L/2)^2 / I_base`` of energy,
          and the caller caps ``J`` so that never exceeds what the ball gave
          up (see :meth:`resolve_ball_contact`).

        The tip rate is capped at ``PIN_MAX_TUMBLE_SPIN``: the cap only ever
        removes energy, standing in for the deformation losses of a real pin.
        """
        magnitude = math.hypot(impulse_vector[0], impulse_vector[2])
        if magnitude <= 0.0:
            return
        normal = _unit2(impulse_vector[0], impulse_vector[2])
        self.velocity = _add(self.velocity,
                             _scale(normal, magnitude / self.mass))
        # The pin topples away from the blow, so the lean follows the
        # impulse's horizontal direction and the tip axis is re-derived from
        # it before the spin is added. Applying the same signed rate in both
        # directions is what makes a pin/pin collision conserve energy.
        if normal[0] != 0.0 or normal[2] != 0.0:
            self.lean = normal
        self.omega += magnitude * (self.height / 2.0) / self.inertia_base
        self._clamp_spin()
        self.hit = True

    def _clamp_spin(self):
        """Cap the tip rate (a numerical guard that can only remove energy)."""
        if abs(self.omega) > config.PIN_MAX_TUMBLE_SPIN:
            self.omega = math.copysign(config.PIN_MAX_TUMBLE_SPIN, self.omega)

    def resolve_ball_contact(self, contact_point, ball_velocity, ball_mass,
                            push, restitution):
        """Resolve a ball impact; returns the impulse magnitude (0 = none).

        The impulse uses the pin's contact mobility ``q`` (see
        :meth:`inverse_mass_at`) in the standard one-dimensional collision:

            ``J = (1 + e) * v_closing / (1/m_ball + q)``

        ``q = 2/m`` is what makes the exchange exactly conservative once
        :meth:`apply_impulse` has added the matching rotation: the pin's
        gain can never exceed the ball's loss, for any ``e <= 1``. The tip
        rate is therefore implied by ``J``; no post-hoc cap is needed.
        """
        normal = _unit2(push[0], push[2])
        approach = _dot(ball_velocity, normal)
        if approach <= 0.0:
            return 0.0
        inverse = 1.0 / ball_mass + self.inverse_mass_at(contact_point, normal)
        if inverse <= 1e-12:
            return 0.0
        impulse = (1.0 + restitution) * approach / inverse
        self.apply_impulse(_scale(normal, impulse), contact_point)
        return impulse

    # --------------------------------------------------------------- dynamics
    def step(self, dt):
        """Advance the pin by ``dt`` seconds.

        The pin is a free rod in the lane plane:

        * **Toppling** - gravity's torque about the centre of mass is
          ``tau = (L/2) M g sin(angle)``, so ``alpha = 6 g sin(angle) / L``
          with ``I_cm = (1/12) M L^2``. The magnitude of the tip rate only
          ever grows, because a struck pin falls away from the blow and cannot
          back-spin off its base.
        * **Sliding** - the contact patch travels with the centre-of-mass
          velocity, decelerated by deck friction ``a = mu_k g``. This is what
          makes a struck pin skid down the deck while it falls, which is what
          carries it into its neighbours.
        * **Kickbacks and the pit** - the deck is closed by a wall at each lane
          edge (a pin that slides into it is thrown back into the rack) and by
          the pit behind the deck (a pin that reaches it is out of play).
        """
        if not self.hit or dt <= 0.0:
            return

        inertia = self.inertia_center
        alpha = (self.height / 2.0) * config.GRAVITY \
            * math.sin(self.angle) / inertia
        self.omega = abs(self.omega) + abs(alpha) * dt
        self._clamp_spin()
        angle = self.angle + self.omega * dt

        if angle >= math.pi / 2.0:
            # It cannot rotate through the deck.
            angle = math.pi / 2.0
            self.omega = 0.0
        self.angle = angle
        self._slide(dt)
        self._place()
        self._resolve_deck(dt)
        self._update_state()
        # Visual detail: the pin also turns about its own axis as it tumbles.
        # It is purely cosmetic (never fed back into the physics), so it
        # cannot affect the energy balance.
        self.spin += 0.5 * self.omega * dt

    def _slide(self, dt):
        """Slide the contact patch: friction ``a = mu_k g`` then ``s = v dt``.

        The pin's planar position is the contact patch (``base``); the centre
        of mass is derived from it and the lean (see :meth:`_place`), so
        translating the base is exactly "the pin skids over the deck".
        """
        speed = math.hypot(self.velocity[0], self.velocity[2])
        if speed > 0.0:
            change = min(speed, config.PIN_DECK_FRICTION * config.GRAVITY * dt)
            factor = (speed - change) / speed
            self.velocity = (self.velocity[0] * factor, 0.0,
                             self.velocity[2] * factor)
            if abs(self.velocity[0]) < 1e-9 and abs(self.velocity[2]) < 1e-9:
                self.velocity = (0.0, 0.0, 0.0)
        self.base = (self.base[0] + self.velocity[0] * dt,
                     self.base[1] + self.velocity[2] * dt)
        self._resolve_bounds()

    def _resolve_bounds(self):
        """Kickback walls at the lane edges, and the pit behind the deck.

        A real pin deck is closed by a steel kickback on each side. A pin that
        slides into it is thrown back towards the rack, which is a large part
        of real pin carry; without it a pin would slide off the deck sideways
        and vanish. Behind the deck is the pit: a pin that reaches it is out
        of play (it has already been counted as down).
        """
        limit = config.LANE_WIDTH / 2.0
        bounce = config.PIN_KICKBACK_RESTITUTION
        x, z = self.base
        if x > limit:
            x = limit
            if self.velocity[0] > 0.0:
                self.velocity = (-self.velocity[0] * bounce, 0.0,
                                 self.velocity[2])
                self.kickback_hits += 1
        elif x < -limit:
            x = -limit
            if self.velocity[0] < 0.0:
                self.velocity = (-self.velocity[0] * bounce, 0.0,
                                 self.velocity[2])
                self.kickback_hits += 1
        pit_z = config.LANE_LENGTH + config.PIN_DECK_LENGTH
        if z > pit_z:
            z = pit_z
            self.velocity = (0.0, 0.0, 0.0)
            self.in_pit = True
        self.base = (x, z)

    def _resolve_deck(self, dt):
        """Deck contact: the pin rests on the deck while it topples.

        The centre of mass is derived from the base and the lean (see
        :meth:`_place`), so the pin cannot sink into the deck; this is only a
        numerical guard. Sliding is handled by :meth:`_slide`.
        """
        if self.com[1] < self.radius:
            self.com = (self.com[0], self.radius, self.com[2])

    def _update_down(self):
        if abs(self.angle) >= math.radians(config.PIN_DOWN_ANGLE):
            self.down = True

    def _update_state(self):
        """Standing / tipping / fallen / settled, and the knocked-over flag."""
        if abs(self.angle) >= config.PIN_FALL_ANGLE \
                and self.state != PinPhysics.FALLEN:
            self.state = PinPhysics.FALLEN
        moving = _length(self.velocity) > config.PIN_STOP_SPEED \
            or abs(self.omega) > config.PIN_SPIN_STOP
        if self.hit:
            self.down = self.down or self.down_threshold_met()
        if moving:
            if self.state == PinPhysics.STANDING:
                self.state = PinPhysics.TIPPING
        elif self.state in (PinPhysics.FALLEN, PinPhysics.TIPPING):
            self.state = PinPhysics.SETTLED

    def down_threshold_met(self):
        """True once the pin has leaned past ``PIN_DOWN_ANGLE``."""
        return abs(self.angle) >= math.radians(config.PIN_DOWN_ANGLE)

    @property
    def upright(self):
        return self.angle < config.PIN_PLANT_ANGLE

    @property
    def angle_from_vertical(self):
        return abs(self.angle)

    @property
    def active(self):
        """True while the pin can still collide with something."""
        return self.state != PinPhysics.SETTLED

    @property
    def at_rest(self):
        """True while the pin is not translating, tipping or spinning.

        Standing pins that were never struck are at rest too, so this is the
        deck's "nothing more will happen" test used before a roll is counted.
        """
        return (_length(self.velocity) <= config.PIN_STOP_SPEED
                and abs(self.omega) <= config.PIN_SPIN_STOP)

    @property
    def standing(self):
        """True while the pin is upright and still part of the rack.

        A knocked-down pin is not standing, and a swept (removed) pin is not
        standing even if its body is still lying where it fell.
        """
        return not self.down and not self.removed

    # -------------------------------------------------------------- snapshots
    def capture_state(self):
        """A restorable copy of every field a roll can change (see module doc)."""
        return PinState(
            self.base, self.com, self.velocity, self.lean, self.angle,
            self.omega, self.spin, self.pinned, self.state, self.hit,
            self.down, self.removed, self.ball_struck, self.in_pit,
            self.kickback_hits)

    def restore_state(self, state):
        """Restore a :meth:`capture_state` snapshot exactly."""
        (self.base, self.com, self.velocity, self.lean, self.angle,
         self.omega, self.spin, self.pinned, self.state, self.hit,
         self.down, self.removed, self.ball_struck, self.in_pit,
         self.kickback_hits) = state

    # ------------------------------------------------------- ball collisions
    def ball_contact(self, ball):
        """Find the ball's contact with this pin, or ``None``.

        Returns ``(push, contact_point, overlap)``: ``push`` is the unit
        direction the ball drives the pin (inwards, from the ball towards the
        pin's axis, always horizontal), ``contact_point`` is the material
        point the impulse acts on, and ``overlap`` is how far the ball is
        inside the contact radius (0 at first touch).

        The contact is resolved in the lane plane: the pin's footprint is the
        segment from its belly to its head with radius ``contact_radius``,
        and the ball's centre is projected onto it horizontally. A full 3D
        offset would tilt the normal whenever the ball's centre height
        differs from the contact height, and a tilted normal silently kills
        the collision.
        """
        position = ball.position
        px, pz = position[0], position[2]
        ax, az = self.base
        axis = self.axis
        closest = _closest_point_on_segment_2d(
            px, pz, ax, az,
            ax + self.height * axis[0], az + self.height * axis[2])
        offset_x = px - closest[0]
        offset_z = pz - closest[1]
        distance = math.hypot(offset_x, offset_z)
        reach = ball.radius + self.contact_radius
        if distance > reach or distance <= 1e-9:
            return None
        outward = (offset_x / distance, 0.0, offset_z / distance)
        push = _scale(outward, -1.0)
        # The impulse acts at the ball's own height, clamped to the pin's
        # body. A ball rolling at 0.109 m strikes the belly just below the
        # pin's centre of mass (0.19 m), so the lever tips the pin *backwards*
        # about its centre - the same backspin a broom gets when you push its
        # bristles. The pin is still toppled by the resulting momentum and by
        # gravity, and the free-rod response is exactly conservative.
        height = max(self.radius,
                     min(position[1], self.height - self.radius))
        contact_point = (closest[0] + outward[0] * self.contact_radius,
                         height,
                         closest[1] + outward[2] * self.contact_radius)
        return push, contact_point, reach - distance

    def ball_collision(self, ball, push, contact_point):
        """Resolve a ball against this pin; returns the ball's velocity delta.

        The rack supplies the contact geometry from :meth:`ball_contact`, so
        the impulse is exactly the one at the moment of impact. The impulse
        comes from :meth:`resolve_ball_contact`, which shares its mobility
        with :meth:`apply_impulse`: the ball always loses speed and the pin's
        motion always accounts for the transferred energy.
        """
        if self.state == PinPhysics.SETTLED:
            return None
        impulse = self.resolve_ball_contact(contact_point, ball.velocity,
                                            ball.mass, push,
                                            config.RESTITUTION_BALL_PIN)
        if impulse <= 0.0:
            return None
        # The pin's surface faces the ball, so the ball's reaction is opposite
        # to the push: back along the contact normal, slowing it down.
        return _scale(push, -impulse / ball.mass)


# Pin vs pin
# ---------------------------------------------------------------------------


def resolve_pin_pin(a, b, restitution):
    """Resolve a collision between two pins; returns the impulse magnitude.

    Each pin is represented by its lane-plane centreline, from the base
    contact point to the head tip. Contact happens when the closest points of
    the two lines come within ``PIN_PIN_CLEARANCE``, a tuned average of the
    pin radius along the body (a rack already seats neighbours one belly
    diameter apart, and a tipping pin presents its narrow head as well as its
    wide belly).

    Both pins use the same ``apply_impulse`` response, so the impulse and the
    resulting motion agree and the equal-and-opposite pair cannot create
    energy. Overlap is removed geometrically (a position-only correction) so
    the pair cannot stay in contact and re-fire.
    """
    if not (a.active and b.active):
        return 0.0
    ax, az = a.base
    bx, bz = b.base
    a_axis = a.axis
    b_axis = b.axis
    a0 = (ax, az)
    a1 = (ax + a_axis[0] * a.height, az + a_axis[2] * a.height)
    b0 = (bx, bz)
    b1 = (bx + b_axis[0] * b.height, bz + b_axis[2] * b.height)
    (pa_x, pa_z), (pb_x, pb_z) = _closest_points_between_segments_2d(
        a0, a1, b0, b1)

    dx = pb_x - pa_x
    dz = pb_z - pa_z
    distance = math.hypot(dx, dz)
    clearance = config.PIN_PIN_CLEARANCE
    if distance <= 1e-9 or distance > clearance:
        return 0.0
    normal = (dx / distance, 0.0, dz / distance)

    # Contact heights: interpolate each pin's line at the closest point.
    height = min(_line_height(a, _segment_parameter(pa_x, pa_z, a0, a1)),
                 _line_height(b, _segment_parameter(pb_x, pb_z, b0, b1)))
    point_a = (pa_x, height, pa_z)
    point_b = (pb_x, height, pb_z)

    velocity_a = a.point_velocity(_sub(point_a, a.center_position))
    velocity_b = b.point_velocity(_sub(point_b, b.center_position))
    # normal runs from a to b, so how fast a closes on b is (v_a - v_b) . n;
    # the equal-and-opposite impulse then slows a and pushes b away.
    approach = _dot(_sub(velocity_a, velocity_b), normal)
    if approach <= 0.0:
        return 0.0
    inverse = 1.0 / a.mass + a.inverse_mass_at(point_a, normal) \
        + 1.0 / b.mass + b.inverse_mass_at(point_b, normal)
    if inverse <= 1e-12:
        return 0.0
    impulse = (1.0 + restitution) * approach / inverse

    # Remove the overlap geometrically so the pair separates.
    half = 0.5 * (clearance - distance)
    a.shift((-normal[0] * half, 0.0, -normal[2] * half))
    b.shift((normal[0] * half, 0.0, normal[2] * half))

    # The equal-and-opposite impulse slows a (it loses momentum along n) and
    # pushes b away from it.
    a.apply_impulse(_scale(normal, -impulse), point_a)
    b.apply_impulse(_scale(normal, impulse), point_b)
    return impulse


def _segment_parameter(px, pz, start, end):
    """Fraction ``t in [0, 1]`` of the closest point along a segment."""
    dx = end[0] - start[0]
    dz = end[1] - start[1]
    length_sq = dx * dx + dz * dz
    if length_sq <= 1e-18:
        return 0.0
    t = ((px - start[0]) * dx + (pz - start[1]) * dz) / length_sq
    return max(0.0, min(1.0, t))


def _line_height(pin, parameter):
    """World height along a pin's base-to-head line at ``parameter in [0, 1]``."""
    return min(pin.height - pin.radius,
               max(pin.radius, parameter * pin.height))


# ---------------------------------------------------------------------------
# Rack layout and the shared deck simulation
# ---------------------------------------------------------------------------


def rack_positions():
    """Return the ``(x, z)`` base position of all ten pins, head pin first.

    Rows are spaced by the equilateral-triangle depth
    ``PIN_SPACING * cos(30 deg)``; each row has one more pin than the last, so
    the rack is the standard 1-2-3-4 triangle.
    """
    row_depth = config.PIN_SPACING * math.cos(math.radians(30.0))
    positions = []
    for row in range(config.PIN_ROWS):
        count = row + 1
        z = config.HEAD_PIN_Z + row * row_depth
        for i in range(count):
            x = (i - (count - 1) / 2.0) * config.PIN_SPACING
            positions.append((x, z))
    return positions


class Deck:
    """Ball + rack, integrated together on a fixed sub-step clock.

    This is the single simulation the whole game shares: the on-screen rack
    (:class:`scene.pins.PinRack`) drives one of these, the bot plans its shots
    by running one headlessly, the Physics Lab compares throws with one, and
    the tests exercise it without any engine objects.

    Lifecycle::

        deck = Deck()
        deck.begin_roll()          # freeze the rack state of the next roll
        deck.ball.launch(...)      # set the release conditions
        while not deck.ball_done:  # advance() until the ball is done
            deck.advance(1/240)
        deck.knockdown_count()     # pins this roll took down

    ``advance`` integrates *then* resolves contacts at the positions actually
    reached, and runs in ``config.PHYSICS_SUBSTEP`` slices, so the outcome does
    not depend on the frame rate and a fast ball cannot tunnel through a pin.
    """

    def __init__(self, pins=None, ball=None):
        self.pins = ([PinPhysics() for _ in range(config.PIN_COUNT)]
                     if pins is None else list(pins))
        self.ball = BallPhysics() if ball is None else ball
        self.ball_done = False
        self.roll_down = set()      # pins knocked down by the current roll
        self.ignore = set()         # pins already down when the roll started
        self.elapsed = 0.0
        self.trajectory = []        # (t, x, z) samples, when recording
        self.record_trajectory = False
        self.first_contact_time = None    # s from release to the first pin hit
        self.impact_speed = None          # ball speed at that first contact
        # Optional ``callable(deck)`` invoked after every physics sub-step.
        # The Physics Lab attaches its timeline recorder here; with no
        # listener the simulation behaves exactly as before.
        self.substep_listener = None
        self._accumulator = 0.0

    # ------------------------------------------------------------------ setup
    def full_rack(self):
        """Stand a complete rack at the regulation positions."""
        self.set_rack(rack_positions())

    def set_rack(self, positions):
        """Stand the given pins at ``positions`` and remove the rest.

        ``positions`` is a list of ``(x, z)`` for the pins that are in play,
        ordered from the head pin outwards (the order of
        :func:`rack_positions`).
        """
        for index, pin in enumerate(self.pins):
            if index < len(positions):
                x, z = positions[index]
                pin.reset()
                pin.set_base(x, z)
            else:
                pin.reset()
                pin.removed = True
                pin.down = True

    def begin_roll(self):
        """Freeze the rack as the starting state of the next roll.

        Pins already down or swept are excluded from this roll's count, so a
        pin can never be counted by two rolls, and every pin is re-armed for
        ball contact (a pin that was left lying on the deck can still be hit).
        """
        for pin in self.pins:
            pin.ball_struck = False
        self.roll_down = set()
        self.ignore = set(index for index, pin in enumerate(self.pins)
                          if pin.down or pin.removed)
        self.ball_done = False
        self._accumulator = 0.0
        self.elapsed = 0.0
        self.first_contact_time = None    # s from release to the first pin hit
        self.impact_speed = None          # ball speed when it reached the pins

    def record_start(self):
        self.trajectory = []
        self.record_trajectory = True

    # -------------------------------------------------------------- snapshots
    def capture_state(self):
        """A complete restorable copy of the running simulation.

        The ball, every pin and the deck's own bookkeeping (elapsed time, the
        pin sets, the first-contact record) are captured together, so a
        restored state is the whole simulation, not just the ball.
        """
        return DeckState(
            self.ball.capture_state(),
            tuple(pin.capture_state() for pin in self.pins),
            self.elapsed, frozenset(self.roll_down), frozenset(self.ignore),
            self.ball_done, self.first_contact_time, self.impact_speed)

    def restore_state(self, state):
        """Restore a :meth:`capture_state` snapshot exactly.

        The accumulator is cleared: the restored state sits exactly on a
        ``PHYSICS_SUBSTEP`` boundary, so the next ``advance`` starts the same
        fixed-step sequence the recorded run continued with.
        """
        self.ball.restore_state(state.ball)
        for pin, pin_state in zip(self.pins, state.pins):
            pin.restore_state(pin_state)
        self.elapsed = state.elapsed
        self.roll_down = set(state.roll_down)
        self.ignore = set(state.ignore)
        self.ball_done = state.ball_done
        self.first_contact_time = state.first_contact_time
        self.impact_speed = state.impact_speed
        self._accumulator = 0.0

    # -------------------------------------------------------------- queries
    def standing_count(self):
        return sum(1 for pin in self.pins if pin.standing)

    def knockdown_count(self):
        """Pins this roll knocked down (a set: no pin can count twice)."""
        self._collect()
        return len(self.roll_down)

    def quiet(self):
        """True once no pin is still translating, tipping or spinning."""
        return all(pin.at_rest for pin in self.pins)

    # ----------------------------------------------------------- simulation
    def advance(self, dt):
        """One frame of ball + pins. No-op once the ball has stopped."""
        if not self.ball.rolling:
            self.ball_done = True
            return
        self._run_substeps(dt, with_ball=True)
        self._collect()

    def settle(self, dt):
        """One frame of pin-only motion, after the ball has stopped."""
        self._run_substeps(dt, with_ball=False)
        self._collect()

    def _run_substeps(self, dt, with_ball):
        if dt <= 0.0:
            return
        self._accumulator += dt
        step = config.PHYSICS_SUBSTEP
        ran = 0
        while self._accumulator >= step - 1e-9 \
                and ran < config.PHYSICS_MAX_SUBSTEPS:
            self._accumulator -= step
            self._substep(step, with_ball)
            ran += 1
            self.elapsed += step
            if self.substep_listener is not None:
                # The listener sees the deck after the sub-step, with
                # ``elapsed`` already advanced to that state's time.
                self.substep_listener(self)
            if with_ball and self.ball_done:
                break
        if ran >= config.PHYSICS_MAX_SUBSTEPS:
            # A frame longer than the sub-step budget (a hitch): drop the
            # backlog rather than let it spiral.
            self._accumulator = 0.0

    def _substep(self, dt, with_ball):
        ball_physics = self.ball if with_ball else None
        if ball_physics is not None and ball_physics.rolling:
            ball_physics.step(dt)
        for pin in self.pins:
            pin.step(dt)
        if ball_physics is not None and ball_physics.rolling:
            self._resolve_ball_contacts(ball_physics)
        self._collide_pins()
        if ball_physics is not None:
            if (ball_physics.at_end_of_lane() or ball_physics.stopped
                    or ball_physics.in_gutter):
                ball_physics.rolling = False
                self.ball_done = True
        if self.record_trajectory and ball_physics is not None:
            self.trajectory.append((self.elapsed,
                                    ball_physics.position[0],
                                    ball_physics.position[2]))

    def _collect(self):
        """Fold the current pin states into this roll's knockdown set."""
        for index, pin in enumerate(self.pins):
            if pin.down and not pin.removed and index not in self.ignore:
                self.roll_down.add(index)

    def _resolve_ball_contacts(self, ball_physics):
        """Resolve the ball's contact with any pin it currently overlaps.

        Each pin is struck at most once by a given roll: a real ball does not
        bounce off the same pin repeatedly, and allowing it to do so re-fires
        the contact every frame as the pair drift together, which both drains
        the ball and pumps energy into the pin. After the impulse the ball is
        placed on the struck pin's surface so it cannot end the frame embedded
        in it.
        """
        for _ in range(len(self.pins)):
            best = None
            for pin in self.pins:
                if pin.state == PinPhysics.SETTLED or pin.ball_struck:
                    continue
                contact = pin.ball_contact(ball_physics)
                if contact is None:
                    continue
                push, point, overlap = contact
                along = (ball_physics.velocity[0] * push[0]
                         + ball_physics.velocity[2] * push[2])
                if along <= 0.0:
                    continue
                if best is None or overlap > best[0]:
                    best = (overlap, pin, push, point)
            if best is None:
                return
            _overlap, pin, push, point = best
            pin.ball_struck = True
            if self.first_contact_time is None:
                self.first_contact_time = self.elapsed
                self.impact_speed = math.hypot(ball_physics.velocity[0],
                                               ball_physics.velocity[2])
            delta_v = pin.ball_collision(ball_physics, push, point)
            if delta_v is not None and len(delta_v) == 3:
                ball_physics.bounce((delta_v[0] * ball_physics.mass, 0.0,
                                     delta_v[2] * ball_physics.mass))
            # Move the ball clear of the pin's surface: the push points from
            # the ball towards the pin, so the ball is separated by moving
            # against it, plus a small gap.
            base_x, base_z = pin.base_xy()
            gap = max(ball_physics.radius * 0.05, 0.005)
            reach = ball_physics.radius + pin.contact_radius + gap
            ball_physics.position = (base_x - push[0] * reach,
                                     ball_physics.position[1],
                                     base_z - push[2] * reach)

    def _collide_pins(self):
        """Every pair of still-moving pins (pin/pin momentum exchange)."""
        pins = self.pins
        for i in range(len(pins)):
            a = pins[i]
            if not a.active:
                continue
            for j in range(i + 1, len(pins)):
                b = pins[j]
                if not b.active:
                    continue
                resolve_pin_pin(a, b, config.RESTITUTION_PIN_PIN)


class RollResult:
    """Everything one simulated roll produced (used by the bot and the lab)."""

    def __init__(self, deck, frames, release_speed=0.0):
        self.deck = deck
        self.frames = frames
        self.knockdowns = deck.knockdown_count()
        self.ball = deck.ball
        self.trajectory = list(deck.trajectory)
        self.travel_time = deck.elapsed
        self.standing_after = deck.standing_count()
        self.release_speed = release_speed

    @property
    def distance(self):
        """How far down the lane the ball travelled (m)."""
        if not self.trajectory:
            return 0.0
        return self.trajectory[-1][2] - config.FOUL_LINE_Z

    def lateral_drift(self):
        """Net sideways movement of the ball from release to rest (m)."""
        if not self.trajectory:
            return 0.0
        return self.trajectory[-1][1] - self.trajectory[0][1]


class DeckTimeline:
    """A run recorded as complete deck states, one per physics sub-step.

    The Physics Lab uses this to scrub through a roll. Every entry is the
    exact state the deck had after one fixed sub-step (``PHYSICS_SUBSTEP``),
    captured by :meth:`Deck.capture_state`: restoring an entry is not an
    interpolation, and resuming from it continues the same trajectory the
    simulation integrated (the sub-step sequence does not depend on how the
    rendered frames sliced the time). ``record`` is a
    ``Deck.substep_listener``.

    Memory note: a state is a handful of tuples per body (about 1.5 kB for a
    full rack), so a ten-second run at 240 Hz is a few megabytes - fine for
    one lab session, and cleared whenever the lab resets.
    """

    def __init__(self):
        self.states = []
        self.times = []

    def __len__(self):
        return len(self.states)

    def clear(self):
        self.states = []
        self.times = []

    # ------------------------------------------------------------- recording
    def record(self, deck):
        """``Deck.substep_listener``: append the deck's current state."""
        self.states.append(deck.capture_state())
        self.times.append(deck.elapsed)

    # ---------------------------------------------------------------- queries
    def duration(self):
        """Wall-simulation length of the recording (seconds)."""
        return self.times[-1] if self.times else 0.0

    def index_at(self, time):
        """Nearest stored index to ``time`` (clamped to the recording)."""
        if not self.times:
            return None
        time = max(self.times[0], min(float(time), self.times[-1]))
        index = bisect.bisect_left(self.times, time)
        if index >= len(self.times):
            return len(self.times) - 1
        if index > 0 and (time - self.times[index - 1]) \
                < (self.times[index] - time):
            return index - 1
        return index

    def time_of(self, index):
        return self.times[index]

    def ball_state(self, index):
        """The recorded :class:`BallState` at ``index`` (no restore needed)."""
        return self.states[index].ball

    # -------------------------------------------------------------- restoring
    def restore(self, deck, index):
        """Restore entry ``index`` into ``deck``; returns the clamped index.

        The deck's recorded path is rebuilt from the recorded samples up to
        this state, so the trail on the lane belongs to the moment being
        inspected - scrubbing back and then forward again restores the full
        path either way. Resuming from here then extends the same recording
        (call :meth:`truncate` first to drop the future this restore is forking
        away from).
        """
        index = max(0, min(int(index), len(self.states) - 1))
        deck.restore_state(self.states[index])
        if deck.record_trajectory:
            deck.trajectory = [
                (self.times[k], self.states[k].ball.position[0],
                 self.states[k].ball.position[2])
                for k in range(1, index + 1)]
        return index

    def truncate(self, index):
        """Drop every state after ``index`` (resuming forks the timeline)."""
        index = max(0, min(int(index), len(self.states) - 1))
        del self.states[index + 1:]
        del self.times[index + 1:]
        return index


def simulate_roll(speed=7.0, lateral_position=0.0, launch_angle=0.0,
                  spin_omega=0.0, deck=None, standing=None, dt=None,
                  record=False, max_time=20.0):
    """Run one complete roll on a fresh :class:`Deck` and return the result.

    ``standing`` may be a list of ``(x, z)`` positions for a partial rack
    (default: the full regulation rack). The simulation runs until the ball is
    done *and* the deck has settled, so the count is the same one the game
    would record. Pure Python: no engine objects involved.

    This is the same code path the on-screen rack uses, so a prediction made
    here (by the bot or the Physics Lab) is exactly the simulation the player
    will see.
    """
    deck = Deck() if deck is None else deck
    if standing is None:
        deck.full_rack()
    else:
        deck.set_rack(standing)
    deck.begin_roll()
    deck.ball.launch(speed=speed, lateral_position=lateral_position,
                     launch_angle=launch_angle, spin_omega=spin_omega)
    release_speed = math.hypot(deck.ball.velocity[0], deck.ball.velocity[2])
    if record:
        deck.record_start()
    step = config.PHYSICS_SUBSTEP if dt is None else dt
    frames = 0
    time = 0.0
    while time < max_time:
        if deck.ball_done:
            if deck.quiet():
                break
            deck.settle(step)
        else:
            deck.advance(step)
        time += step
        frames += 1
    return RollResult(deck, frames, release_speed)
