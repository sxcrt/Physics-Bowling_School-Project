"""Equation Mode: physics challenges whose inputs drive the *real* simulation.

This module is pure Python (no engine, no rendering), so the whole challenge
bank, its model physics and its marking can be unit-tested directly - see
``tests/test_challenges.py``. The play screen feeds a finished roll's numbers
in as a :class:`RollMeasurement` and asks the challenge to evaluate them; the
physics never lives here, it lives in :mod:`physics`, and every expected value
below is computed from the same equations that module integrates.

How a challenge works
---------------------
Each challenge is a real bowling situation (a leave on the deck, a release
point, a speed) with exactly one launch variable missing - the player's job is
to work out that variable from the physics. Pressing BOWL IT turns the value
into a ``ThrowData`` and launches it into the shared simulation; the pins fall
because the physics moved them. There is no separate outcome calculation: the
same challenge also carries the *expected* value (the model's answer), and the
test suite verifies against the engine that the expected value really does
solve the challenge.

The model (and why it matches the engine)
-----------------------------------------
Equation Mode uses the equations ``physics.py`` implements, and nothing else:

**Curvature (the hook).** The release spin has a component ``omega`` about the
line of travel (``ThrowData.spin_omega``). The contact point then slips
sideways at ``v_slip = R |omega|``. While it slips, kinetic friction acts
opposite the slip, ``a = mu_k g``, which
(a) removes the slip after ``t_s = 2 R |omega| / (7 mu_k g)`` (the classic
solid-sphere result) and (b) gives the ball a sideways velocity
``v_side = -(2/7) R omega`` in the process. Afterwards the ball rolls straight
(rolling resistance only) along the direction it has picked up. The lateral
displacement when the ball reaches a pin ``d`` away is therefore

    D(omega) = -(2/7) R omega (t - t_s/2),   t = d / v,   t_s = 2 R |omega| / (7 mu_k g)

which is the closed form of the skid phase the engine integrates. It depends
on all of ``omega``, ``R``, ``mu_k``, ``v`` and ``d`` - spin alone never
determines curvature. The small ``t_s/2`` term matters (roughly 2% at these
speeds) and is kept.

**Speed (rolling resistance).** In the rolling phase the ball decelerates at
``a = mu_r g``, so over a distance ``d``:

    v^2 = u^2 - 2 a d

**The impact.** The engine resolves a ball/pin contact as an impulse with
restitution ``e`` and the pin's contact mobility ``2/m_p``:

    J = (1 + e) v_arr / (1/m + 2/m_p),      v_pin = J / m_p

**Rotation.** The ball is a solid sphere: ``I = (2/5) m R^2``, so a spin
``omega`` carries angular momentum ``L = I omega``, and a torque ``tau``
applied for a spin-up time ``dt`` gives ``omega = tau dt / I``.

Approximations (documented, and small)
--------------------------------------
* The closed-form ``D(omega)`` ignores rolling resistance *during the roll*
  (it decays the sideways velocity slightly) and the engine's sub-step
  discretisation. Both are well under the 0.17 m contact window; the test
  suite confirms the expected values hit the pin in the engine itself.
* Pin travel and pin/pin scatter are not predicted. Challenges that depend on
  pin carry are not used unless the engine reproduces them robustly.
"""
import math
from dataclasses import dataclass, field

import config

# ---------------------------------------------------------------------------
# Constants of the model (taken from config so they cannot drift from the game)
# ---------------------------------------------------------------------------
GRAVITY = config.GRAVITY
BALL_R = config.BALL_RADIUS
BALL_MASS = config.BALL_MASS
PIN_MASS = config.PIN_MASS
MU_K = config.SLIDING_FRICTION
MU_R = config.ROLLING_FRICTION
RESTITUTION = config.RESTITUTION_BALL_PIN

ROW_DEPTH = config.PIN_SPACING * math.cos(math.radians(30.0))
HEAD_Z = config.HEAD_PIN_Z

# The regulation rack, named as bowlers name it (the layout in
# physics.rack_positions()). Kept here so the bank is engine-free.
PIN_SLOTS = (
    ('1', 0.0000, HEAD_Z),
    ('2', -0.1525, HEAD_Z + ROW_DEPTH),
    ('3', 0.1525, HEAD_Z + ROW_DEPTH),
    ('4', -0.3050, HEAD_Z + 2 * ROW_DEPTH),
    ('5', 0.0000, HEAD_Z + 2 * ROW_DEPTH),
    ('6', 0.3050, HEAD_Z + 2 * ROW_DEPTH),
    ('7', -0.4575, HEAD_Z + 3 * ROW_DEPTH),
    ('8', -0.1525, HEAD_Z + 3 * ROW_DEPTH),
    ('9', 0.1525, HEAD_Z + 3 * ROW_DEPTH),
    ('10', 0.4575, HEAD_Z + 3 * ROW_DEPTH),
)
SLOTS = {label: (x, z) for label, x, z in PIN_SLOTS}

# The lateral reach of a ball/pin contact: the ball centre within this of the
# pin's axis makes contact (ball radius + pin belly radius).
CONTACT_REACH = BALL_R + config.PIN_MAX_RADIUS

# Sliding-friction deceleration and the closed-form drift coefficient.
A_SLIDE = MU_K * GRAVITY                       # m/s^2 sideways while slipping
DRIFT_PER_SPIN = (2.0 / 7.0) * BALL_R          # m/s of sideways speed per rad/s
DRIFT_QUADRATIC = (2.0 / 49.0) * BALL_R ** 2 / A_SLIDE   # m per (rad/s)^2


# ---------------------------------------------------------------------------
# The model functions (each one is the equation the engine integrates)
# ---------------------------------------------------------------------------
def moment_of_inertia(mass=BALL_MASS, radius=BALL_R):
    """``I = (2/5) m R^2`` for the solid ball the engine simulates."""
    if config.BALL_INERTIA_TYPE == 'shell':
        return (2.0 / 3.0) * mass * radius ** 2
    return (2.0 / 5.0) * mass * radius ** 2


def slip_time(spin):
    """How long the release slip lasts: ``t_s = 2 R |omega| / (7 mu_k g)``."""
    return 2.0 * BALL_R * abs(spin) / (7.0 * MU_K * GRAVITY)


def hook_drift(spin, speed, distance):
    """Lateral displacement ``D(omega)`` when the ball reaches ``distance``.

    Negative ``spin`` (a right-hand hook) drifts to ``+x`` (the bowler's
    right), matching the engine's sign convention.
    """
    if speed <= 0.0:
        return 0.0
    travel_time = distance / speed
    return -DRIFT_PER_SPIN * spin * (travel_time - 0.5 * slip_time(spin))


def spin_for_drift(drift, speed, distance):
    """The signed spin whose ``D(omega)`` equals ``drift`` (the inverse map).

    Solves ``A u^2 - B u + |drift| = 0`` for ``u = |omega|`` with
    ``A = 2 R^2 / (49 mu_k g)`` and ``B = (2/7) R t``, taking the smaller root
    (the first spin that reaches the target). Returns ``None`` when the drift
    is beyond what that spin can produce at that speed.
    """
    if abs(drift) < 1e-12:
        return 0.0
    if speed <= 0.0:
        return None
    travel_time = distance / speed
    b = DRIFT_PER_SPIN * travel_time
    discriminant = b * b - 4.0 * DRIFT_QUADRATIC * abs(drift)
    if discriminant < 0.0:
        return None
    magnitude = (b - math.sqrt(discriminant)) / (2.0 * DRIFT_QUADRATIC)
    return -math.copysign(magnitude, drift)


def arrival_speed(release_speed, distance, mu=MU_R):
    """``v^2 = u^2 - 2 mu_r g d`` (0 when the ball stops before the pin)."""
    remaining = release_speed ** 2 - 2.0 * mu * GRAVITY * distance
    return math.sqrt(remaining) if remaining > 0.0 else 0.0


def release_speed_for_arrival(arrival, distance, mu=MU_R):
    """The release speed whose arrival speed is ``arrival``."""
    return math.sqrt(arrival ** 2 + 2.0 * mu * GRAVITY * distance)


def pin_speed_from_impact(ball_speed):
    """``v_pin = J / m_p`` with ``J = (1+e) v / (1/m + 2/m_p)``."""
    inverse = 1.0 / BALL_MASS + 2.0 / PIN_MASS
    return (1.0 + RESTITUTION) * ball_speed / inverse / PIN_MASS


def impact_speed_for_pin_speed(pin_speed):
    """The arrival speed that leaves the pin at ``pin_speed``."""
    inverse = 1.0 / BALL_MASS + 2.0 / PIN_MASS
    return pin_speed * PIN_MASS * inverse / (1.0 + RESTITUTION)


def spin_from_angular_momentum(momentum, inertia=None):
    """``omega = L / I``."""
    inertia = moment_of_inertia() if inertia is None else inertia
    return momentum / inertia


def angular_momentum_of_spin(spin, inertia=None):
    """``L = I omega``."""
    inertia = moment_of_inertia() if inertia is None else inertia
    return inertia * spin


def spin_from_torque(torque, spin_up_time, inertia=None):
    """``omega = tau dt / I`` for a torque applied during the wind-up."""
    inertia = moment_of_inertia() if inertia is None else inertia
    return torque * spin_up_time / inertia


def torque_for_spin(spin, spin_up_time, inertia=None):
    """``tau = I omega / dt``."""
    inertia = moment_of_inertia() if inertia is None else inertia
    return inertia * spin / spin_up_time


def _format(value, places=2):
    """A compact fixed-point display for a computed number."""
    return f'{value:.{places}f}'


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ChallengeInput:
    """The one launch variable the player sets."""

    key: str            # 'spin' | 'angle' | 'position' | 'speed' | 'torque'
    label: str          # shown above the field
    unit: str
    low: float
    high: float
    default: float = 0.0


@dataclass(frozen=True)
class RollMeasurement:
    """What the real simulation produced for one attempt.

    Filled in by the play screen from the live deck: none of these numbers is
    calculated from the model - they are what happened.
    """

    value: float                       # the player's input
    targets_down: tuple = ()           # per target pin: did it fall?
    pins_down: tuple = ()              # per pin in the challenge's rack
    knockdowns: int = 0
    launch_x: float = 0.0
    landing_x: float = None            # ball x when it crossed the target's line
    pass_error: float = None           # |ball - pin| at the closest pass
    impact_speed: float = None         # ball speed at the first contact
    pin_speed: float = None            # pin's exit speed (impulse / m_p)
    gutter: bool = False
    gutter_z: float = None             # where the ball entered the gutter
    path: tuple = ()                   # ((x, z), ...) sampled ball path
    spin: float = 0.0                  # the hook spin the launch actually used

    def target_down(self):
        return bool(self.targets_down) and all(self.targets_down)


@dataclass(frozen=True)
class ChallengeOutcome:
    """The marked result of one attempt."""

    solved: bool
    headline: str
    verdict: str = ''
    lines: tuple = ()
    measurement: dict = field(default_factory=dict)


@dataclass(frozen=True)
class EquationChallenge:
    """One interactive problem: a leave, a missing variable, one equation."""

    id: str
    case: str
    title: str
    brief: str
    target: str
    rack: tuple                        # ((label, x, z), ...) pins on the deck
    control: ChallengeInput
    fixed: dict                        # fixed launch values (position/speed/angle_deg/spin)
    answer: float                      # the model's solution (signed)
    kind: str = 'hit'                  # 'hit' | 'arrival' | 'pin_speed'
    threshold: float = 0.0             # the pass mark for measurement kinds
    targets: tuple = (0,)              # rack indices that must fall
    equation: str = ''
    equation_note: str = ''
    given: tuple = ()
    given_values: dict = field(default_factory=dict)
    steps: tuple = ()                  # progressive hints
    working: str = ''
    advice: tuple = ()                 # (under-spun, over-spun) phrasing
    assumptions: str = ''
    sign_note: str = ''
    spin_up_time: float = 0.0
    tolerance: float = 0.05            # display slack around the expected value

    # ------------------------------------------------------------------ setup
    def positions(self):
        """The ``(x, z)`` rack positions for :meth:`scene.pins.PinRack.set_layout`."""
        return tuple((x, z) for _label, x, z in self.rack)

    def target_pins(self):
        return tuple(self.rack[index] for index in self.targets)

    def aim_x(self):
        """The x the ball must reach: the first target pin's lateral position."""
        return self.rack[self.targets[0]][1]

    def aim_z(self):
        """The down-lane distance to the deepest target pin."""
        return max(self.rack[index][2] for index in self.targets)

    def launch_values(self, value):
        """``(lateral_position, speed, launch_angle_deg, spin_omega)`` for a launch."""
        position = self.fixed.get('position', 0.0)
        speed = self.fixed.get('speed', 0.0)
        angle = self.fixed.get('angle_deg', 0.0)
        spin = self.fixed.get('spin', 0.0)
        key = self.control.key
        if key == 'position':
            position = value
        elif key == 'speed':
            speed = value
        elif key == 'angle':
            angle = value
        elif key == 'spin':
            spin = value
        elif key == 'torque':
            spin = spin_from_torque(value, self.spin_up_time, moment_of_inertia())
        return position, speed, angle, spin

    def expected_text(self):
        return f'{self.answer:.3g} {self.control.unit}'.strip()

    def derived_text(self, value):
        """The quantity the input implies (torque -> spin), or ''."""
        if self.control.key != 'torque':
            return ''
        spin = spin_from_torque(value, self.spin_up_time, moment_of_inertia())
        return (f'tau = {value:.3g} N m over {self.spin_up_time:.2f} s '
                f'-> omega = tau dt / I = {spin:+.3g} rad/s')

    # ----------------------------------------------------------------- marking
    def evaluate(self, measurement):
        """Mark a real roll against this challenge."""
        if self.kind == 'hit':
            return self._evaluate_hit(measurement)
        if self.kind == 'arrival':
            return self._evaluate_arrival(measurement)
        return self._evaluate_pin_speed(measurement)

    def _direction_text(self, measurement):
        """How far - and which way - the ball was from the target pin."""
        if measurement.landing_x is None:
            return 'the ball never reached the pin line'
        offset = measurement.landing_x - self.aim_x()
        side = 'right' if offset >= 0 else 'left'
        return (f'the ball crossed the pin line at x = {measurement.landing_x:+.3f} m '
                f'({abs(offset):.3f} m to the {side} of the pin)')

    def _evaluate_hit(self, measurement):
        solved = measurement.target_down()
        pin = self.target_pins()[0][0]
        needed = self.aim_x() - measurement.launch_x
        got = (measurement.landing_x - measurement.launch_x
               if measurement.landing_x is not None else None)
        if solved:
            headline = f'PIN {pin} DOWN!'
            verdict = 'Solved: the simulation agrees with the calculation.'
            lines = [
                f'Input {measurement.value:.3g} {self.control.unit}: the ball '
                f'crossed the pin line within {measurement.pass_error:.3f} m '
                f'of the {pin} pin axis (contact is within '
                f'{CONTACT_REACH:.3f} m).',
                f'It moved {needed:+.3f} m sideways over '
                f'{self.aim_z():.2f} m of lane - the drift you calculated.',
                'The pin fell because the physics moved it: same launch data, '
                'same deck, same integration as every other mode.',
            ]
            return ChallengeOutcome(True, headline, verdict, tuple(lines),
                                    self._summary(measurement))
        offset = (measurement.landing_x - self.aim_x()
                  if measurement.landing_x is not None else None)
        wrong_way = (got is None or needed is None
                     or got * needed < 0.0 or abs(got) < abs(needed))
        if measurement.gutter:
            headline = 'IN THE GUTTER'
            verdict = 'Too much spin: the ball left the lane before the pin.'
            why = (f'The hook slip and its friction over-curved the path: the '
                   f'spin was too large, so the ball reached the gutter at '
                   f'{measurement.gutter_z:.1f} m, before the {pin} pin at '
                   f'{self.aim_z():.2f} m.')
        elif offset is None:
            headline = f'NEVER REACHED THE {pin} PIN'
            verdict = 'The ball stopped short of the pin.'
            why = self.advice[0] if len(self.advice) > 0 else \
                'Increase the value and bowl again: the equation says how much.'
        else:
            side = 'LEFT' if offset < 0 else 'RIGHT'
            headline = f'MISSED THE {pin} PIN - TOO FAR {side}'
            verdict = ('The ball fell short of the pin.' if wrong_way
                       else 'The ball went past the pin.')
            if wrong_way:
                why = self.advice[0] if len(self.advice) > 0 else \
                    'Increase the value and bowl again: the equation says how much.'
            else:
                why = self.advice[1] if len(self.advice) > 1 else \
                    'Reduce the value and bowl again: the equation says how much.'
        lines = [
            f'Input {measurement.value:.3g} {self.control.unit}: '
            f'{self._direction_text(measurement)}.',
            f'The pin needed {needed:+.3f} m of sideways movement; the ball '
            f'produced {got if got is not None else 0.0:+.3f} m (contact needs '
            f'the ball within {CONTACT_REACH:.3f} m of the axis).',
            why,
        ]
        return ChallengeOutcome(False, headline, verdict, tuple(lines),
                                self._summary(measurement))

    def _evaluate_arrival(self, measurement):
        pin = self.target_pins()[0][0]
        speed = measurement.impact_speed
        if speed is None:
            headline = f'THE BALL NEVER REACHED PIN {pin}'
            verdict = 'Too slow: rolling resistance stopped the ball first.'
            lines = [
                f'Input {measurement.value:.3g} {self.control.unit}: the ball '
                f'did not reach the {pin} pin at {self.aim_z():.2f} m.',
                'Below this release speed the friction deceleration wins; '
                'v^2 = u^2 - 2 a d reaches zero first.',
                f'The model\'s release speed for an arrival of '
                f'{self.threshold:.2f} m/s is {self.answer:.2f} m/s.',
            ]
            return ChallengeOutcome(False, headline, verdict, tuple(lines),
                                    self._summary(measurement))
        solved = speed >= self.threshold and measurement.target_down()
        if solved:
            headline = f'ARRIVED AT {speed:.2f} m/s - PIN DOWN!'
            verdict = 'Solved: the ball still had the speed you calculated.'
        else:
            headline = f'ARRIVED AT {speed:.2f} m/s - TOO SLOW'
            verdict = f'The pin needed at least {self.threshold:.2f} m/s.'
        lines = [
            f'Input {measurement.value:.3g} {self.control.unit}: measured '
            f'arrival speed at the pin {speed:.3f} m/s.',
            f'v^2 = u^2 - 2 a d with a = mu_r g = {MU_R * GRAVITY:.3f} m/s^2: '
            f'{measurement.value:.2f}^2 - 2 x {MU_R * GRAVITY:.3f} x '
            f'{self.aim_z():.2f} = {max(0.0, speed ** 2):.2f}, v = '
            f'{speed:.2f} m/s.',
            f'The model\'s minimum release speed is {self.answer:.2f} m/s '
            f'(arrival {self.threshold:.2f} m/s).',
        ]
        return ChallengeOutcome(solved, headline, verdict, tuple(lines),
                                self._summary(measurement))

    def _evaluate_pin_speed(self, measurement):
        pin = self.target_pins()[0][0]
        speed = measurement.pin_speed
        if speed is None:
            headline = 'THE PIN WAS NEVER STRUCK'
            verdict = 'Too slow: the ball stopped before the rack.'
            return ChallengeOutcome(
                False, headline, verdict,
                (f'Input {measurement.value:.3g} {self.control.unit}: the ball '
                 f'did not reach pin {pin}. Release faster.',
                 'The arrival speed must beat the rolling deceleration over '
                 f'{self.aim_z():.2f} m before the impact can happen.'),
                self._summary(measurement))
        solved = speed >= self.threshold and measurement.target_down()
        if solved:
            headline = f'PIN {pin} LEFT THE IMPACT AT {speed:.2f} m/s - DOWN!'
            verdict = 'Solved: the impulse carried enough momentum into the pin.'
        else:
            headline = f'PIN {pin} LEFT AT {speed:.2f} m/s - TOO SOFT'
            verdict = f'The pin needed at least {self.threshold:.2f} m/s.'
        arrival = (measurement.impact_speed
                   if measurement.impact_speed is not None else 0.0)
        lines = [
            f'Input {measurement.value:.3g} {self.control.unit}: the ball '
            f'arrived at {arrival:.3f} m/s and left the pin at {speed:.2f} m/s.',
            f'Impulse: J = (1 + e) v / (1/m + 2/m_p) = '
            f'{1.0 + RESTITUTION:.1f} x {arrival:.2f} / '
            f'({1.0 / BALL_MASS:.3f} + {2.0 / PIN_MASS:.3f}) = '
            f'{self._impulse(measurement):.2f} kg m/s.',
            f'Pin speed: v_pin = J / m_p = {self._impulse(measurement):.2f} / '
            f'{PIN_MASS:.2f} = {speed:.2f} m/s (the model needs '
            f'{self.threshold:.2f} m/s).',
        ]
        return ChallengeOutcome(solved, headline, verdict, tuple(lines),
                                self._summary(measurement))

    @staticmethod
    def _impulse(measurement):
        inverse = 1.0 / BALL_MASS + 2.0 / PIN_MASS
        speed = measurement.impact_speed or 0.0
        return (1.0 + RESTITUTION) * speed / inverse

    def _summary(self, measurement):
        return {
            'input': f'{measurement.value:.3g} {self.control.unit}',
            'landing': measurement.landing_x,
            'drift': (measurement.landing_x - measurement.launch_x
                      if measurement.landing_x is not None else None),
            'pass_error': measurement.pass_error,
            'impact_speed': measurement.impact_speed,
            'pin_speed': measurement.pin_speed,
            'gutter': measurement.gutter,
            'pins': measurement.knockdowns,
            'spin': measurement.spin,
        }


# ---------------------------------------------------------------------------
# Builders (each challenge is assembled from the model, then verified by tests)
# ---------------------------------------------------------------------------
CASE_AIM = 'CASE 1 - LINE IT UP'
CASE_SPEED = 'CASE 2 - SPEED DOWN THE LANE'
CASE_SPIN = 'CASE 3 - SPIN AND THE HOOK'
CASE_ROTATION = 'CASE 4 - ROTATION DYNAMICS'
CASE_IMPACT = 'CASE 5 - THE IMPACT'


def _slot(label):
    x, z = SLOTS[label]
    return ((label, x, z),)


# --- Case 1: straight-line geometry ----------------------------------------
ANGLE_WINNER_X, ANGLE_WINNER_Z = SLOTS['10']
ANGLE_TO_PIN = EquationChallenge(
    id='angle-to-pin',
    case=CASE_AIM,
    title='Point the release at the pin',
    brief=(
        f'The 10 pin is the only pin left. You release the ball from the lane '
        f'centre (x0 = 0.00 m) straight at 7.0 m/s, but with no spin at all. '
        f'The pin stands x = {ANGLE_WINNER_X:.4f} m to the right at '
        f'{ANGLE_WINNER_Z:.2f} m down the lane. What launch angle theta points '
        f'the ball straight at it?'),
    target='Knock the 10 pin down with a straight, spinning-neutral release.',
    rack=_slot('10'),
    control=ChallengeInput('angle', 'LAUNCH ANGLE theta', 'deg', -2.0, 2.0),
    fixed={'position': 0.0, 'speed': 7.0, 'spin': 0.0},
    answer=math.degrees(math.atan2(ANGLE_WINNER_X, ANGLE_WINNER_Z)),
    kind='hit',
    targets=(0,),
    equation='theta = atan( (x_pin - x0) / d )',
    equation_note=('Measured from the lane\'s forward axis; positive aims right. '
                   'No spin, so the path is straight and the speed cancels out.'),
    given=(('start x0', '0.000 m'), ('pin x', f'{ANGLE_WINNER_X:.4f} m'),
           ('distance d', f'{ANGLE_WINNER_Z:.2f} m'), ('speed v', '7.00 m/s'),
           ('hook spin', '0.00 rad/s')),
    given_values={'x0': 0.0, 'x_pin': ANGLE_WINNER_X, 'd': ANGLE_WINNER_Z},
    steps=(
        'A straight path changes x linearly with the distance travelled: '
        'tan(theta) = sideways / forward.',
        f'tan(theta) = {ANGLE_WINNER_X:.4f} / {ANGLE_WINNER_Z:.2f} = '
        f'{ANGLE_WINNER_X / ANGLE_WINNER_Z:.4f}.',
        f'Take the inverse tangent in degrees: theta = atan('
        f'{ANGLE_WINNER_X / ANGLE_WINNER_Z:.4f}).',
    ),
    working=(
        f'theta = atan((x_pin - x0) / d) = atan(({ANGLE_WINNER_X:.4f} - 0.000) '
        f'/ {ANGLE_WINNER_Z:.2f}) = atan('
        f'{ANGLE_WINNER_X / ANGLE_WINNER_Z:.4f}) = '
        f'{math.degrees(math.atan2(ANGLE_WINNER_X, ANGLE_WINNER_Z)):.3f} degrees. '
        f'The speed does not appear: a straight path has the same direction at '
        f'every distance.'),
    advice=('Aim further right (a larger angle).',
            'Aim further left (a smaller angle).'),
    assumptions='Straight, constant-velocity path; rolling resistance only slows it.',
    sign_note='positive angle aims right of the lane axis.',
)

POSITION_PIN_X, POSITION_PIN_Z = SLOTS['3']
POSITION_ANGLE = 1.0
POSITION_ANSWER = POSITION_PIN_X - POSITION_PIN_Z * math.tan(
    math.radians(POSITION_ANGLE))
RELEASE_POSITION = EquationChallenge(
    id='release-position',
    case=CASE_AIM,
    title='Pick the release spot',
    brief=(
        f'The 3 pin is up. This time the release angle is fixed at '
        f'{POSITION_ANGLE:.1f} degrees to the right and you choose where on '
        f'the lane to stand. The pin is {POSITION_PIN_Z:.2f} m away at '
        f'x = {POSITION_PIN_X:.4f} m. Which release position x0 sends the '
        f'straight path through the pin?'),
    target='Knock the 3 pin down with the fixed 1 degree release angle.',
    rack=_slot('3'),
    control=ChallengeInput('position', 'RELEASE POSITION x0', 'm', -0.42, 0.42),
    fixed={'speed': 7.0, 'angle_deg': POSITION_ANGLE, 'spin': 0.0},
    answer=POSITION_ANSWER,
    kind='hit',
    targets=(0,),
    equation='x0 = x_pin - d tan(theta)',
    equation_note=('The straight path obeys x(d) = x0 + d tan(theta); set '
                   'x(d) = x_pin and solve for x0.'),
    given=(('pin x', f'{POSITION_PIN_X:.4f} m'),
           ('distance d', f'{POSITION_PIN_Z:.2f} m'),
           ('angle theta', f'{POSITION_ANGLE:.1f} deg'),
           ('speed v', '7.00 m/s'), ('hook spin', '0.00 rad/s')),
    given_values={'x_pin': POSITION_PIN_X, 'd': POSITION_PIN_Z,
                  'angle_deg': POSITION_ANGLE},
    steps=(
        'Start from the path equation x = x0 + d tan(theta) and put the pin\'s '
        'position in for x.',
        f'd tan(theta) = {POSITION_PIN_Z:.2f} x tan({POSITION_ANGLE:.1f} deg) = '
        f'{POSITION_PIN_Z * math.tan(math.radians(POSITION_ANGLE)):.3f} m.',
        f'x0 = {POSITION_PIN_X:.4f} - '
        f'{POSITION_PIN_Z * math.tan(math.radians(POSITION_ANGLE)):.3f}.',
    ),
    working=(
        f'x0 = x_pin - d tan(theta) = {POSITION_PIN_X:.4f} m - {POSITION_PIN_Z:.2f} m '
        f'x tan({POSITION_ANGLE:.1f} deg) = {POSITION_PIN_X:.4f} - '
        f'{POSITION_PIN_Z * math.tan(math.radians(POSITION_ANGLE)):.3f} = '
        f'{POSITION_ANSWER:+.3f} m. Standing left of centre while aiming to the '
        f'right makes the path cross the lane centre on the way to the pin.'),
    advice=('Stand further right (a larger x0).',
            'Stand further left (a smaller x0).'),
    assumptions='A straight release path at the stated angle; no hook.',
    sign_note='x0 is metres from the lane centre: negative is left, positive right.',
)

# --- Case 2: speed and friction --------------------------------------------
ARRIVAL_TARGET = 6.0
ARRIVAL_DISTANCE = HEAD_Z
ARRIVAL_ANSWER = release_speed_for_arrival(ARRIVAL_TARGET, ARRIVAL_DISTANCE)
ARRIVAL_SPEED = EquationChallenge(
    id='arrival-speed',
    case=CASE_SPEED,
    title='Carry enough speed to the pin',
    brief=(
        f'The head pin at {ARRIVAL_DISTANCE:.2f} m must be hit with at least '
        f'{ARRIVAL_TARGET:.1f} m/s for the shot to carry. Rolling resistance '
        f'decelerates a rolling ball at a = mu_r g with mu_r = {MU_R:.3f}. '
        f'What release speed u gets the ball there at {ARRIVAL_TARGET:.1f} m/s?'),
    target=f'Reach the head pin with at least {ARRIVAL_TARGET:.1f} m/s.',
    rack=_slot('1'),
    control=ChallengeInput('speed', 'RELEASE SPEED u', 'm/s', 4.0, 12.0),
    fixed={'position': 0.0, 'angle_deg': 0.0, 'spin': 0.0},
    answer=ARRIVAL_ANSWER,
    kind='arrival',
    threshold=ARRIVAL_TARGET,
    targets=(0,),
    equation='v = sqrt( u^2 - 2 a d ),   a = mu_r g',
    equation_note=('With mu_r = 0.020 and g = 9.81 m/s^2 the deceleration is '
                   f'a = {MU_R * GRAVITY:.3f} m/s^2 - the same term the engine '
                   f'applies while the ball rolls.'),
    given=(('distance d', f'{ARRIVAL_DISTANCE:.2f} m'),
           ('target speed v', f'{ARRIVAL_TARGET:.1f} m/s'),
           ('mu_r', f'{MU_R:.3f}'), ('g', f'{GRAVITY:.2f} m/s^2'),
           ('deceleration a', f'{MU_R * GRAVITY:.3f} m/s^2')),
    given_values={'d': ARRIVAL_DISTANCE, 'v': ARRIVAL_TARGET,
                  'a': MU_R * GRAVITY},
    steps=(
        'Rearrange v^2 = u^2 - 2 a d for the release speed: u^2 = v^2 + 2 a d.',
        f'2 a d = 2 x {MU_R * GRAVITY:.3f} x {ARRIVAL_DISTANCE:.2f} = '
        f'{2 * MU_R * GRAVITY * ARRIVAL_DISTANCE:.3f}.',
        f'u = sqrt({ARRIVAL_TARGET ** 2:.1f} + '
        f'{2 * MU_R * GRAVITY * ARRIVAL_DISTANCE:.3f}).',
    ),
    working=(
        f'u = sqrt(v^2 + 2 a d) = sqrt({ARRIVAL_TARGET:.1f}^2 + 2 x '
        f'{MU_R * GRAVITY:.3f} x {ARRIVAL_DISTANCE:.2f}) = '
        f'sqrt({ARRIVAL_TARGET ** 2 + 2 * MU_R * GRAVITY * ARRIVAL_DISTANCE:.2f}) '
        f'= {ARRIVAL_ANSWER:.2f} m/s. Below this the ball arrives slower than '
        f'{ARRIVAL_TARGET:.1f} m/s; above it, faster - that is the whole '
        f'equation.'),
    advice=('Release faster: the ball arrives slower than the target.',
            'Release slower: the ball arrives faster than needed.'),
    assumptions='The ball is rolling (no skid); constant deceleration mu_r g.',
)

SPEED_CURVE_SPIN = -5.0
SPEED_CURVE_DISTANCE, SPEED_CURVE_TARGET_X = SLOTS['10'][1], SLOTS['10'][0]
SPEED_CURVE_ANSWER = (DRIFT_PER_SPIN * abs(SPEED_CURVE_SPIN) * SPEED_CURVE_DISTANCE
                      / (abs(SPEED_CURVE_TARGET_X)
                         + DRIFT_QUADRATIC * SPEED_CURVE_SPIN ** 2))
SPEED_TO_CURVE = EquationChallenge(
    id='speed-to-curve',
    case=CASE_SPEED,
    title='Curve to the corner by speed alone',
    brief=(
        f'The 10 pin is up and the release has a fixed hook spin of '
        f'{SPEED_CURVE_SPIN:+.1f} rad/s (a right-hand hook). You choose the '
        f'release speed. The ball starts on the lane centre and must drift '
        f'{abs(SPEED_CURVE_TARGET_X):.4f} m to the right over '
        f'{SPEED_CURVE_DISTANCE:.2f} m. How fast must it be released? '
        f'(Faster leaves less time to curve.)'),
    target='Knock the 10 pin down with the fixed -5.0 rad/s hook spin.',
    rack=_slot('10'),
    control=ChallengeInput('speed', 'RELEASE SPEED v', 'm/s', 4.0, 10.0),
    fixed={'position': 0.0, 'angle_deg': 0.0, 'spin': SPEED_CURVE_SPIN},
    answer=SPEED_CURVE_ANSWER,
    kind='hit',
    targets=(0,),
    equation='D = (2/7) R |omega| (t - t_s/2),   t = d/v,   t_s = 2 R |omega| / (7 mu_k g)',
    equation_note=('The drift is fixed; a faster ball has less time on the '
                   'lane, so t = d/v has to be larger (a slower release).'),
    given=(('hook spin omega', f'{SPEED_CURVE_SPIN:+.1f} rad/s'),
           ('drift needed D', f'{abs(SPEED_CURVE_TARGET_X):.4f} m to the right'),
           ('distance d', f'{SPEED_CURVE_DISTANCE:.2f} m'),
           ('radius R', f'{BALL_R:.3f} m'), ('friction mu_k', f'{MU_K:.3f}'),
           ('gravity g', f'{GRAVITY:.2f} m/s^2')),
    given_values={'spin': SPEED_CURVE_SPIN, 'D': abs(SPEED_CURVE_TARGET_X),
                  'd': SPEED_CURVE_DISTANCE, 'R': BALL_R, 'mu_k': MU_K},
    steps=(
        f'First the skid time: t_s = 2 R |omega| / (7 mu_k g) = '
        f'{slip_time(SPEED_CURVE_SPIN):.4f} s.',
        'The drift equation is D = (2/7) R |omega| (d/v - t_s/2). Rearrange '
        'for d/v.',
        f'd/v = D / ((2/7) R |omega|) + t_s/2 = '
        f'{abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * abs(SPEED_CURVE_SPIN)):.4f} '
        f'+ {slip_time(SPEED_CURVE_SPIN) / 2:.4f} s, then v = d / that.',
    ),
    working=(
        f't_s = 2 x {BALL_R:.3f} x {abs(SPEED_CURVE_SPIN):.1f} / (7 x {MU_K:.3f} '
        f'x {GRAVITY:.2f}) = {slip_time(SPEED_CURVE_SPIN):.4f} s. '
        f't = d/v = D/((2/7) R |omega|) + t_s/2 = '
        f'{abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * abs(SPEED_CURVE_SPIN)):.4f} '
        f'+ {slip_time(SPEED_CURVE_SPIN) / 2:.4f} = '
        f'{abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * abs(SPEED_CURVE_SPIN)) + slip_time(SPEED_CURVE_SPIN) / 2:.4f} s, '
        f'so v = {SPEED_CURVE_DISTANCE:.2f} / '
        f'{abs(SPEED_CURVE_TARGET_X) / (DRIFT_PER_SPIN * abs(SPEED_CURVE_SPIN)) + slip_time(SPEED_CURVE_SPIN) / 2:.4f} '
        f'= {SPEED_CURVE_ANSWER:.2f} m/s.'),
    advice=('Too fast: the ball ran out of lane before the hook could bite - '
            'release slower.',
            'Too slow: the ball curved past the pin - release faster.'),
    assumptions='The closed-form skid model; rolling resistance during the '
                'roll is neglected (it changes the drift by a few millimetres).',
    sign_note='the fixed spin -5.0 rad/s curls the ball to the right.',
)

# --- Case 3: spin and the hook ----------------------------------------------
SPIN_PIN_ANSWER = spin_for_drift(abs(SLOTS['6'][0]), 7.0, SLOTS['6'][1])
SPIN_TO_PIN = EquationChallenge(
    id='spin-to-pin',
    case=CASE_SPIN,
    title='Hook into the 6 pin',
    brief=(
        f'The 6 pin is up at x = {SLOTS['6'][0]:.4f} m, {SLOTS['6'][1]:.2f} m '
        f'away. You release from the lane centre at 7.0 m/s with a launch '
        f'angle of 0.0 degrees, and you choose the hook spin. The release slip '
        f'makes the contact point slide; friction against it is what bends the '
        f'path. What signed hook spin omega curves the ball onto the pin?'),
    target='Knock the 6 pin down with the hook, releasing straight.',
    rack=_slot('6'),
    control=ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
    fixed={'position': 0.0, 'speed': 7.0, 'angle_deg': 0.0},
    answer=SPIN_PIN_ANSWER,
    kind='hit',
    targets=(0,),
    equation='D = (2/7) R omega (t - t_s/2),   t = d/v,   t_s = 2 R |omega| / (7 mu_k g)',
    equation_note=('A positive spin curves left; a negative spin curves right. '
                   'The ball must move right, so omega is negative.'),
    given=(('pin x', f'{SLOTS['6'][0]:.4f} m'),
           ('distance d', f'{SLOTS['6'][1]:.2f} m'),
           ('speed v', '7.00 m/s'),
           ('radius R', f'{BALL_R:.3f} m'), ('friction mu_k', f'{MU_K:.3f}'),
           ('gravity g', f'{GRAVITY:.2f} m/s^2')),
    given_values={'D': abs(SLOTS['6'][0]), 'd': SLOTS['6'][1], 'v': 7.0,
                  'R': BALL_R, 'mu_k': MU_K},
    steps=(
        f'The ball must drift {abs(SLOTS['6'][0]):.4f} m to the right, so the '
        f'signed spin is negative.',
        f'Skid time: t_s = 2 R |omega| / (7 mu_k g); travel time: '
        f't = d/v = {SLOTS['6'][1] / 7.0:.4f} s.',
        f'Solve {abs(SLOTS['6'][0]):.4f} = (2/7) R |omega| (t - t_s/2) for '
        f'|omega| - the t_s term is small but keep it.',
    ),
    working=(
        f't = d/v = {SLOTS['6'][1]:.2f} / 7.0 = {SLOTS['6'][1] / 7.0:.4f} s. '
        f'Solving D = (2/7) R |omega| (t - t_s/2) with '
        f'D = {abs(SLOTS['6'][0]):.4f} m gives |omega| = '
        f'{abs(SPIN_PIN_ANSWER):.2f} rad/s (t_s = '
        f'{slip_time(SPIN_PIN_ANSWER):.4f} s). The pin is to the right, so the '
        f'ball must curl right: omega = {SPIN_PIN_ANSWER:+.2f} rad/s.'),
    advice=('Under-spun: the ball curved less than the pin needs - increase '
            '|omega| (more negative).',
            'Over-spun: the ball curved past the pin - reduce |omega|.'),
    assumptions='Closed-form skid model; the engine then rolls the ball '
                'straight with the sideways velocity the skid gave it.',
    sign_note='positive omega curls left; negative curls right.',
)

SPIN_CORNER_ANSWER = spin_for_drift(abs(SLOTS['10'][0]), 6.0, SLOTS['10'][1])
SPIN_TO_CORNER = EquationChallenge(
    id='spin-to-corner',
    case=CASE_SPIN,
    title='The lone 10 pin - and the gutter',
    brief=(
        f'The 10 pin is the only pin standing, x = {SLOTS['10'][0]:.4f} m at '
        f'{SLOTS['10'][1]:.2f} m. You release from the lane centre at 6.0 m/s, '
        f'straight. The lane is only {config.LANE_WIDTH:.3f} m wide, so this '
        f'shot needs a big hook - and too much spin puts the ball in the '
        f'gutter. What signed hook spin hits the pin?'),
    target='Knock the 10 pin down without going into the gutter.',
    rack=_slot('10'),
    control=ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
    fixed={'position': 0.0, 'speed': 6.0, 'angle_deg': 0.0},
    answer=SPIN_CORNER_ANSWER,
    kind='hit',
    targets=(0,),
    equation='s = R omega   (slip)  ->  D = (2/7) R |omega| (t - t_s/2)',
    equation_note=('The slip speed is R|omega|; the friction against it curves '
                   'the path. A slower ball has more time, so it needs less '
                   'spin than at 7 m/s - but the drift grows with omega, so '
                   'over-spinning sends it wide and into the gutter.'),
    given=(('pin x', f'{SLOTS['10'][0]:.4f} m'),
           ('distance d', f'{SLOTS['10'][1]:.2f} m'),
           ('speed v', '6.00 m/s'),
           ('lane half-width', f'{config.LANE_WIDTH / 2:.4f} m'),
           ('radius R', f'{BALL_R:.3f} m'), ('friction mu_k', f'{MU_K:.3f}')),
    given_values={'D': abs(SLOTS['10'][0]), 'd': SLOTS['10'][1], 'v': 6.0,
                  'R': BALL_R, 'mu_k': MU_K},
    steps=(
        f'Travel time: t = d/v = {SLOTS['10'][1] / 6.0:.4f} s; the required '
        f'drift is {abs(SLOTS['10'][0]):.4f} m to the right.',
        's = R |omega| is the sideways slip the friction has to cancel; it '
        'takes t_s = 2 R |omega| / (7 mu_k g).',
        f'Solve {abs(SLOTS['10'][0]):.4f} = (2/7) R |omega| (t - t_s/2) for '
        f'|omega|, then choose the sign for "right".',
    ),
    working=(
        f't = {SLOTS['10'][1]:.2f} / 6.0 = {SLOTS['10'][1] / 6.0:.4f} s. '
        f'With D = {abs(SLOTS['10'][0]):.4f} m the model gives |omega| = '
        f'{abs(SPIN_CORNER_ANSWER):.2f} rad/s (t_s = '
        f'{slip_time(SPIN_CORNER_ANSWER):.4f} s), and the pin is to the right, '
        f'so omega = {SPIN_CORNER_ANSWER:+.2f} rad/s. The ball crosses '
        f'{abs(SLOTS['10'][0]):.3f} m of a {config.LANE_WIDTH / 2:.3f} m '
        f'half-lane - and at about -6.5 rad/s the curve reaches the gutter '
        f'before the pin, which is the other failure mode to learn.'),
    advice=('Under-spun: it never reached the pin - increase |omega| (more '
            'negative).',
            'Over-spun: it curved too far. At around -6.5 rad/s or beyond the '
            'ball gutters before the pin - reduce |omega|.'),
    assumptions='Closed-form skid model; the gutter is the engine\'s lateral '
                'bound at half-lane width.',
    sign_note='positive omega curls left; negative curls right.',
)

SPIN_LEFT_ANSWER = spin_for_drift(-abs(SLOTS['7'][0]), 6.0, SLOTS['7'][1])
SPIN_TO_LEFT = EquationChallenge(
    id='spin-to-left',
    case=CASE_SPIN,
    title='The other corner: hook the other way',
    brief=(
        f'The 7 pin is the only pin up at x = {SLOTS['7'][0]:.4f} m (left of '
        f'centre) and {SLOTS['7'][1]:.2f} m away. Released straight from the '
        f'lane centre at 6.0 m/s, the hook has to carry the ball the other way '
        f'this time. Which signed hook spin does it?'),
    target='Knock the 7 pin down with a left-hand hook.',
    rack=_slot('7'),
    control=ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
    fixed={'position': 0.0, 'speed': 6.0, 'angle_deg': 0.0},
    answer=SPIN_LEFT_ANSWER,
    kind='hit',
    targets=(0,),
    equation='D = (2/7) R omega (t - t_s/2)',
    equation_note='Same equation, mirrored geometry: the drift needed is negative, so omega is positive.',
    given=(('pin x', f'{SLOTS['7'][0]:.4f} m'),
           ('distance d', f'{SLOTS['7'][1]:.2f} m'),
           ('speed v', '6.00 m/s'),
           ('radius R', f'{BALL_R:.3f} m'), ('mu_k', f'{MU_K:.3f}')),
    given_values={'D': SLOTS['7'][0], 'd': SLOTS['7'][1], 'v': 6.0,
                  'R': BALL_R, 'mu_k': MU_K},
    steps=(
        'The ball must move left, and positive spin curls left.',
        f'|omega| solves {abs(SLOTS['7'][0]):.4f} = (2/7) R |omega| (t - t_s/2) '
        f'with t = {SLOTS['7'][1]:.2f} / 6.0.',
        'Same magnitudes as the 10-pin challenge, opposite sign.',
    ),
    working=(
        f't = {SLOTS['7'][1] / 6.0:.4f} s; |omega| = '
        f'{abs(SPIN_LEFT_ANSWER):.2f} rad/s; the pin is to the left, so '
        f'omega = {SPIN_LEFT_ANSWER:+.2f} rad/s. The sign convention is the '
        f'only difference from the other corner shot.'),
    advice=('Under-spun: it fell short of the pin - increase omega.',
            'Over-spun: it curved past the pin - reduce omega.'),
    assumptions='Closed-form skid model.',
    sign_note='positive omega curls left; negative curls right.',
)

# --- Case 4: rotation dynamics ----------------------------------------------
ANGULAR_MOMENTUM_ANSWER = spin_for_drift(abs(SLOTS['10'][0]), 6.0, SLOTS['10'][1])
INERTIA = moment_of_inertia()
ANGULAR_MOMENTUM_L = abs(angular_momentum_of_spin(ANGULAR_MOMENTUM_ANSWER))
ANGULAR_MOMENTUM = EquationChallenge(
    id='angular-momentum',
    case=CASE_ROTATION,
    title='From angular momentum to hook spin',
    brief=(
        f'The lone 10 pin is up at x = {SLOTS['10'][0]:.4f} m, '
        f'{SLOTS['10'][1]:.2f} m away. The coach tells you the release must '
        f'carry L = {ANGULAR_MOMENTUM_L:.4f} kg m^2/s of angular momentum '
        f'about the line of travel, curling to the right. The ball is a solid '
        f'sphere, m = {BALL_MASS:.1f} kg, R = {BALL_R:.3f} m. What signed '
        f'hook spin omega gives it that angular momentum?'),
    target='Knock the 10 pin down from the stated angular momentum.',
    rack=_slot('10'),
    control=ChallengeInput('spin', 'HOOK SPIN omega', 'rad/s', -8.0, 8.0),
    fixed={'position': 0.0, 'speed': 6.0, 'angle_deg': 0.0},
    answer=ANGULAR_MOMENTUM_ANSWER,
    kind='hit',
    targets=(0,),
    equation='L = I omega,    I = (2/5) m R^2',
    equation_note=('The moment of inertia is a property of the solid sphere the '
                   'engine integrates, not a free parameter. The direction '
                   '("curling right") fixes the sign of omega.'),
    given=(('angular momentum L', f'{ANGULAR_MOMENTUM_L:.4f} kg m^2/s'),
           ('mass m', f'{BALL_MASS:.1f} kg'),
           ('radius R', f'{BALL_R:.3f} m'),
           ('direction', 'curling right'),
           ('spin needed by the shot', 'the 10 pin at x = '
                                      f'{SLOTS['10'][0]:.4f} m')),
    given_values={'L': ANGULAR_MOMENTUM_L, 'm': BALL_MASS, 'R': BALL_R},
    steps=(
        f'First the moment of inertia: I = (2/5) m R^2 = (2/5) x '
        f'{BALL_MASS:.1f} x {BALL_R:.3f}^2 = {INERTIA:.5f} kg m^2.',
        f'Then omega = L / I = {ANGULAR_MOMENTUM_L:.4f} / {INERTIA:.5f}.',
        'The spin must curl the ball to the right, so report it with the '
        'matching sign (positive curls left).',
    ),
    working=(
        f'I = (2/5) m R^2 = 0.4 x {BALL_MASS:.1f} x {BALL_R:.3f}^2 = '
        f'{INERTIA:.5f} kg m^2. omega = L / I = {ANGULAR_MOMENTUM_L:.4f} / '
        f'{INERTIA:.5f} = {abs(ANGULAR_MOMENTUM_ANSWER):.3f} rad/s in '
        f'magnitude; curling right makes it omega = '
        f'{ANGULAR_MOMENTUM_ANSWER:+.3f} rad/s. That spin produces the '
        f'{abs(SLOTS['10'][0]):.4f} m of drift the pin needs, so the two '
        f'problems agree - as they must.'),
    advice=('The spin is under-sized: recompute omega = L / I and check the '
            'sign (right needs a negative spin).',
            'The spin is over-sized: check the moment of inertia and the sign.'),
    assumptions='Solid sphere inertia (config.BALL_INERTIA_TYPE = solid).',
    sign_note='positive omega curls left; negative curls right.',
)

TORQUE_TIME = 0.20
TORQUE_ANSWER = torque_for_spin(SPIN_LEFT_ANSWER, TORQUE_TIME)
SPIN_UP_TORQUE = EquationChallenge(
    id='spin-up-torque',
    case=CASE_ROTATION,
    title='Spin the ball up with a torque',
    brief=(
        f'The lone 7 pin is up at x = {SLOTS['7'][0]:.4f} m, '
        f'{SLOTS['7'][1]:.2f} m away, and the release speed is 6.0 m/s. This '
        f'time the hook spin comes from the wind-up: you apply a constant '
        f'torque tau about the line of travel for {TORQUE_TIME:.2f} s, giving '
        f'the solid ball (I = {INERTIA:.5f} kg m^2) omega = tau t / I. What '
        f'torque spins the ball onto the pin?'),
    target='Knock the 7 pin down using the torque-driven spin.',
    rack=_slot('7'),
    control=ChallengeInput('torque', 'WIND-UP TORQUE tau', 'N m', 0.0, 1.5),
    fixed={'position': 0.0, 'speed': 6.0, 'angle_deg': 0.0},
    answer=TORQUE_ANSWER,
    kind='hit',
    targets=(0,),
    equation='omega = tau dt / I,    I = (2/5) m R^2',
    equation_note=('The ball spins up frictionlessly during the '
                   f'{TORQUE_TIME:.2f} s wind-up, then is released; the game '
                   f'uses omega = tau dt / I as the launch spin. A positive '
                   f'torque curves the ball left, like the release.'),
    given=(('spin-up time dt', f'{TORQUE_TIME:.2f} s'),
           ('ball inertia I', f'{INERTIA:.5f} kg m^2'),
           ('pin', f'the 7 pin at x = {SLOTS['7'][0]:.4f} m, '
                   f'd = {SLOTS['7'][1]:.2f} m'),
           ('release speed', '6.00 m/s'),
           ('spin needed', f'about {abs(SPIN_LEFT_ANSWER):.2f} rad/s, curling left')),
    given_values={'dt': TORQUE_TIME, 'I': INERTIA, 'spin': SPIN_LEFT_ANSWER},
    spin_up_time=TORQUE_TIME,
    steps=(
        'Work out the spin the shot needs first: solve the drift equation for '
        f'the 7 pin (about {abs(SPIN_LEFT_ANSWER):.2f} rad/s, positive for a '
        f'left-hand curve).',
        f'Invert omega = tau dt / I: tau = I omega / dt = {INERTIA:.5f} x '
        f'|omega| / {TORQUE_TIME:.2f}.',
        'A torque that spins the ball to curve left is the positive one.',
    ),
    working=(
        f'The shot needs the 7-pin spin: |omega| = {abs(SPIN_LEFT_ANSWER):.2f} '
        f'rad/s, and it must curl left, so omega = {SPIN_LEFT_ANSWER:+.2f}. '
        f'tau = I omega / dt = {INERTIA:.5f} x {abs(SPIN_LEFT_ANSWER):.2f} / '
        f'{TORQUE_TIME:.2f} = {TORQUE_ANSWER:.3f} N m. The engine then releases '
        f'the ball with that omega, and the friction-driven skid does the rest.'),
    advice=('Too little torque: the ball under-curves. tau = I omega / dt.',
            'Too much torque: the ball over-curves. tau = I omega / dt.'),
    assumptions=('Idealised frictionless spin-up: all of tau dt becomes ball '
                 'angular momentum. The release itself then uses the engine\'s '
                 'skid model.'),
    sign_note='a positive torque spins the ball to curve left.',
)

# --- Case 5: the impact ------------------------------------------------------
PIN_SPEED_TARGET = 2.5
PIN_SPEED_DISTANCE = HEAD_Z
PIN_SPEED_ANSWER = release_speed_for_arrival(
    impact_speed_for_pin_speed(PIN_SPEED_TARGET), PIN_SPEED_DISTANCE)
PIN_SPEED = EquationChallenge(
    id='pin-speed',
    case=CASE_IMPACT,
    title='Hit the pin hard enough',
    brief=(
        f'A lone head pin at {PIN_SPEED_DISTANCE:.2f} m must be struck hard '
        f'enough to leave the contact at {PIN_SPEED_TARGET:.1f} m/s (that is '
        f'the kind of pin speed that carries into the next row). The ball and '
        f'pin collide with restitution e = {RESTITUTION:.1f}; the pin leaves '
        f'with v_pin = J / m_p. What release speed does it take?'),
    target=f'Leave the head pin with at least {PIN_SPEED_TARGET:.1f} m/s.',
    rack=_slot('1'),
    control=ChallengeInput('speed', 'RELEASE SPEED u', 'm/s', 4.0, 12.0),
    fixed={'position': 0.0, 'angle_deg': 0.0, 'spin': 0.0},
    answer=PIN_SPEED_ANSWER,
    kind='pin_speed',
    threshold=PIN_SPEED_TARGET,
    targets=(0,),
    equation='J = (1 + e) v / (1/m + 2/m_p),    v_pin = J / m_p',
    equation_note=('The pin\'s mobility is 2/m_p: the impulse splits into '
                   'translation and the rotation of the topple, so this is the '
                   'same two-body collision the engine resolves.'),
    given=(('pin mass m_p', f'{PIN_MASS:.1f} kg'),
           ('ball mass m', f'{BALL_MASS:.1f} kg'),
           ('restitution e', f'{RESTITUTION:.1f}'),
           ('target pin speed', f'{PIN_SPEED_TARGET:.1f} m/s'),
           ('distance d', f'{PIN_SPEED_DISTANCE:.2f} m')),
    given_values={'m_p': PIN_MASS, 'm': BALL_MASS, 'e': RESTITUTION,
                  'target': PIN_SPEED_TARGET, 'd': PIN_SPEED_DISTANCE},
    steps=(
        f'First the arrival speed the collision needs: v_pin = '
        f'(1 + e) v / (m_p (1/m + 2/m_p)) so v = '
        f'{impact_speed_for_pin_speed(PIN_SPEED_TARGET):.3f} m/s.',
        f'Then the release speed from rolling resistance: u = sqrt(v^2 + 2 a d) '
        f'with a = mu_r g = {MU_R * GRAVITY:.3f} m/s^2.',
        f'u = sqrt({impact_speed_for_pin_speed(PIN_SPEED_TARGET):.3f}^2 + 2 x '
        f'{MU_R * GRAVITY:.3f} x {PIN_SPEED_DISTANCE:.2f}).',
    ),
    working=(
        f'v_pin = {PIN_SPEED_TARGET:.2f} m/s needs an arrival speed v = '
        f'v_pin m_p (1/m + 2/m_p) / (1 + e) = '
        f'{impact_speed_for_pin_speed(PIN_SPEED_TARGET):.3f} m/s. Over '
        f'{PIN_SPEED_DISTANCE:.2f} m the rolling deceleration a = '
        f'{MU_R * GRAVITY:.3f} m/s^2 costs 2 a d = '
        f'{2 * MU_R * GRAVITY * PIN_SPEED_DISTANCE:.3f} (m/s)^2, so '
        f'u = sqrt({impact_speed_for_pin_speed(PIN_SPEED_TARGET):.3f}^2 + '
        f'{2 * MU_R * GRAVITY * PIN_SPEED_DISTANCE:.3f}) = '
        f'{PIN_SPEED_ANSWER:.2f} m/s.'),
    advice=('Too slow: the pin leaves softer than the target. Release faster.',
            'Faster than needed: the pin leaves harder than the target.'),
    assumptions=('Head-on impulse, no spin; the pin is free to translate and '
                 'topple, which is exactly the mobility used above.'),
)


# ---------------------------------------------------------------------------
# The bank
# ---------------------------------------------------------------------------
CHALLENGES = (
    ANGLE_TO_PIN,
    RELEASE_POSITION,
    ARRIVAL_SPEED,
    SPEED_TO_CURVE,
    SPIN_TO_PIN,
    SPIN_TO_CORNER,
    SPIN_TO_LEFT,
    ANGULAR_MOMENTUM,
    SPIN_UP_TORQUE,
    PIN_SPEED,
)


def challenges_for_session(count=None):
    """The challenges for one session, in progressive order."""
    challenges = list(CHALLENGES)
    return challenges[:count] if count else challenges


def challenge_by_id(challenge_id):
    for challenge in CHALLENGES:
        if challenge.id == challenge_id:
            return challenge
    raise KeyError(challenge_id)


def bank_size():
    return len(CHALLENGES)
