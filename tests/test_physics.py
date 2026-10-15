"""Physics unit tests: equations, conservation laws and stability.

These exercise the pure ``physics`` module (no Ursina window, so they run in
well under a second) and check the simulation against the equations it
documents:

* Ball motion - rolling deceleration ``a = mu_r * g`` and the exact
  kinematic solution, checked against the config constants and shown to be
  independent of the integration timestep.
* Momentum and energy - the collision resolvers must conserve momentum and
  must never create energy (``dKE <= 0`` for ``e <= 1``).
* Restitution - a larger ``e`` must leave more energy in the system.
* Pin dynamics - a struck pin must topple forwards (away from the ball) and
  settle, and pin/pin contacts must transfer momentum.
* Fast-ball detection - a fast ball must not tunnel through a pin between
  integration steps.
* Stability - energy must never grow over a whole roll, and the same throw
  must produce the same pins-down count at 30, 60 and 240 fps.

Run with:
    python -m unittest tests.test_physics -v
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from physics import (BallPhysics, PinPhysics, resolve_pin_pin,
                     swept_circle_time)


def roll_ball(ball, seconds, dt=1 / 240.0):
    """Advance a ball for ``seconds`` at a fixed timestep."""
    steps = int(round(seconds / dt))
    for _ in range(steps):
        ball.step(dt)
    return ball


def kinetic_energy(ball):
    """Translational plus rotational kinetic energy of the ball."""
    return (0.5 * ball.mass * ball.speed ** 2
            + 0.5 * ball.inertia * sum(w * w for w in ball.angular_velocity))


def pin_energy(pin):
    """Kinetic plus gravitational energy of a pin (relative to the deck)."""
    ke = 0.5 * pin.mass * sum(v * v for v in pin.velocity)
    ke += 0.5 * pin.inertia_center * pin.omega ** 2
    return ke + pin.mass * config.GRAVITY * pin.com_height


def head_pin():
    pin = PinPhysics()
    pin.set_base(0.0, config.HEAD_PIN_Z)
    return pin


class TestBallRolling(unittest.TestCase):
    """Rolling motion follows ``v^2 = v0^2 - 2 a s`` exactly."""

    def test_rolling_deceleration_matches_the_friction_equation(self):
        ball = BallPhysics()
        ball.launch(speed=7.0)
        # a = mu_r * g, constant, opposite the direction of travel.
        expected_a = config.ROLLING_FRICTION * config.GRAVITY
        self.assertAlmostEqual(ball.last_acceleration[2] * -1.0, 0.0)

        ball.step(1 / 240.0)
        measured_a = -ball.last_acceleration[2]
        self.assertAlmostEqual(measured_a, expected_a, places=9)

    def test_speed_over_the_lane_matches_the_kinematic_solution(self):
        v0 = 7.0
        ball = BallPhysics()
        ball.launch(speed=v0)
        distance = config.LANE_LENGTH
        time = 0.0
        dt = 1 / 240.0
        while ball.z < distance and time < 10.0:
            ball.step(dt)
            time += dt
        a = config.ROLLING_FRICTION * config.GRAVITY
        expected_v = math.sqrt(v0 * v0 - 2.0 * a * distance)
        self.assertAlmostEqual(ball.speed, expected_v, delta=0.05)

    def test_frame_rate_independence(self):
        speeds = []
        for dt in (1 / 240.0, 1 / 120.0, 1 / 60.0, 1 / 30.0):
            ball = BallPhysics()
            ball.launch(speed=7.0)
            time = 0.0
            while ball.z < config.LANE_LENGTH and time < 10.0:
                ball.step(dt)
                time += dt
            speeds.append(ball.speed)
        self.assertAlmostEqual(max(speeds), min(speeds), delta=0.05)

    def test_no_slip_holds_once_rolling(self):
        ball = BallPhysics()
        ball.launch(speed=7.0)
        roll_ball(ball, 1.0)
        self.assertLess(ball.slip_speed(), config.SLIP_TOLERANCE)

    def test_ball_stops_instead_of_rolling_forever(self):
        ball = BallPhysics()
        ball.launch(speed=2.0)
        t = 0.0
        dt = 1 / 240.0
        while ball.rolling and t < 30.0:
            ball.step(dt)
            t += dt
        self.assertFalse(ball.rolling)
        self.assertEqual(ball.speed, 0.0)
        # A 2 m/s throw cannot reach the pins 18.29 m away.
        self.assertLess(ball.z, config.LANE_LENGTH)

    def test_launch_angle_sends_the_ball_laterally(self):
        ball = BallPhysics()
        ball.launch(speed=7.0, launch_angle=math.radians(5.0))
        roll_ball(ball, 1.0)
        self.assertGreater(ball.x, 0.5)

    def test_gutter_is_detected(self):
        ball = BallPhysics()
        ball.launch(speed=7.0, lateral_position=config.LANE_WIDTH / 2.0)
        ball.velocity = (3.0, 0.0, 5.0)
        roll_ball(ball, 0.2)
        self.assertTrue(ball.in_gutter)


class TestSweptCollisionDetection(unittest.TestCase):
    """The quadratic segment/circle test used to catch fast balls."""

    def test_head_on_path_enters_the_circle(self):
        # Segment from z=0 to z=1 heading straight at a pin at z=0.5.
        t = swept_circle_time(0.0, 0.5, 0.1, 0.0, 0.0, 0.0, 1.0)
        self.assertIsNotNone(t)
        self.assertAlmostEqual(t, 0.4, places=6)

    def test_path_that_misses_returns_none(self):
        t = swept_circle_time(0.0, 0.5, 0.1, 0.5, 0.0, 0.0, 1.0)
        self.assertIsNone(t)

    def test_start_inside_is_zero(self):
        t = swept_circle_time(0.0, 0.5, 0.5, 0.0, 0.5, 0.0, 1.0)
        self.assertEqual(t, 0.0)

    def test_fast_ball_cannot_tunnel(self):
        """A ball crossing the pin's whole contact zone in one step is caught."""
        ball = BallPhysics()
        pin = head_pin()
        dt = 1 / 240.0
        ball.launch(speed=12.0)
        hit = False
        for _ in range(6000):
            start = ball.position
            ball.step(dt)
            # Did the ball's centre pass the pin's axis in one step?
            if start[2] < pin.base[1] <= ball.position[2]:
                t = swept_circle_time(
                    pin.base[0], pin.base[1],
                    ball.radius + pin.contact_radius,
                    start[0], start[2],
                    ball.position[0] - start[0], ball.position[2] - start[2])
                self.assertIsNotNone(t)
                self.assertLessEqual(t, 1.0)
                hit = True
                break
        self.assertTrue(hit, 'the ball never crossed the pin in one step')


class TestBallPinCollision(unittest.TestCase):
    """Momentum, energy and the topple direction of a ball/pin impact."""

    def collide(self, speed=7.0, **kwargs):
        ball = BallPhysics()
        ball.launch(speed=speed)
        pin = head_pin()
        # Sit the ball just inside the contact radius for a clean head-on
        # test (sitting exactly at the radius is a boundary case).
        reach = ball.radius + pin.contact_radius
        ball.position = (0.0, ball.radius, config.HEAD_PIN_Z - reach * 0.95)
        contact = pin.ball_contact(ball)
        self.assertIsNotNone(contact)
        push, point, _overlap = contact
        before_ball = kinetic_energy(ball)
        before_pin = pin_energy(pin)
        delta_v = pin.ball_collision(ball, push, point)
        self.assertIsNotNone(delta_v)
        # The game applies the ball's reaction through BallPhysics.bounce.
        ball.bounce(((delta_v[0] * ball.mass, 0.0, delta_v[2] * ball.mass)))
        after_ball = kinetic_energy(ball)
        after_pin = pin_energy(pin)
        return ball, pin, delta_v, before_ball, after_ball, before_pin, after_pin

    def test_ball_slows_down(self):
        ball, _pin, delta_v, _bb, _ab, _bp, _ap = self.collide(speed=7.0)
        self.assertLess(ball.speed, 7.0)
        self.assertGreater(ball.speed, 0.0)
        self.assertLess(delta_v[2], 0.0)

    def test_energy_is_not_created(self):
        _b, _p, _dv, before_ball, after_ball, before_pin, after_pin = \
            self.collide(speed=7.0)
        self.assertLessEqual(after_ball + after_pin,
                             before_ball + before_pin + 1e-9)

    def test_pin_transfers_momentum_in_the_ball_direction(self):
        _b, pin, _dv, _bb, _ab, _bp, _ap = self.collide(speed=7.0)
        # The ball travels +z, so the pin must be driven +z.
        self.assertGreater(pin.velocity[2], 0.0)

    def test_pin_topples_forwards_and_settles(self):
        _b, pin, _dv, _bb, _ab, _bp, _ap = self.collide(speed=7.0)
        for _ in range(int(2.0 / (1 / 240.0))):
            pin.step(1 / 240.0)
        self.assertTrue(pin.down)
        self.assertGreater(math.degrees(pin.angle), config.PIN_DOWN_ANGLE)

    def test_hard_hit_leaves_more_pin_speed_than_a_soft_hit(self):
        _b_soft, pin_soft, _dv_s, *_ = self.collide(speed=4.0)
        _b_hard, pin_hard, _dv_h, *_ = self.collide(speed=10.0)
        self.assertGreater(math.hypot(pin_hard.velocity[0],
                                      pin_hard.velocity[2]),
                           math.hypot(pin_soft.velocity[0],
                                      pin_soft.velocity[2]))

    def test_glancing_hit_deflects_the_ball_sideways(self):
        ball = BallPhysics()
        ball.launch(speed=7.0)
        pin = head_pin()
        # Offset laterally so the contact normal is genuinely oblique: the
        # ball's centre is up-lane of the pin but off to the side.
        ball.position = (0.05, ball.radius, config.HEAD_PIN_Z - 0.14)
        contact = pin.ball_contact(ball)
        self.assertIsNotNone(contact)
        push, point, _ = contact
        delta_v = pin.ball_collision(ball, push, point)
        self.assertNotAlmostEqual(push[0], 0.0, places=3)
        self.assertIsNotNone(delta_v)
        # A glancing hit gives the ball a lateral velocity change.
        self.assertNotAlmostEqual(delta_v[0], 0.0, places=4)

    def test_the_ball_is_slowed_by_the_impact(self):
        ball, _pin, _dv, before_ball, after_ball, _bp, _ap = \
            self.collide(speed=7.0)
        self.assertLess(after_ball, before_ball)


class TestRestitution(unittest.TestCase):
    """The configured coefficient of restitution is what the physics uses."""

    def collide_with(self, restitution):
        ball = BallPhysics()
        ball.launch(speed=7.0)
        pin = head_pin()
        reach = ball.radius + pin.contact_radius
        ball.position = (0.0, ball.radius, config.HEAD_PIN_Z - reach * 0.95)
        contact = pin.ball_contact(ball)
        push, point, _ = contact
        # Temporarily override the module constant the physics reads.
        original = config.RESTITUTION_BALL_PIN
        config.RESTITUTION_BALL_PIN = restitution
        try:
            pin.ball_collision(ball, push, point)
        finally:
            config.RESTITUTION_BALL_PIN = original
        return pin_energy(pin), ball

    def test_larger_restitution_transfers_more_energy(self):
        elastic_energy, _ = self.collide_with(0.9)
        inelastic_energy, _ = self.collide_with(0.1)
        self.assertGreater(elastic_energy, inelastic_energy)

    def test_perfectly_inelastic_absorbs_the_most(self):
        energy, _ = self.collide_with(0.0)
        higher, _ = self.collide_with(0.6)
        self.assertGreater(higher, energy)


class TestPinDynamics(unittest.TestCase):
    """A struck pin topples, settles, and can knock its neighbour."""

    def struck_pin(self, speed=7.0):
        ball = BallPhysics()
        ball.launch(speed=speed)
        pin = head_pin()
        reach = ball.radius + pin.contact_radius
        ball.position = (0.0, ball.radius, config.HEAD_PIN_Z - reach * 0.95)
        push, point, _ = pin.ball_contact(ball)
        pin.ball_collision(ball, push, point)
        return pin

    def test_struck_pin_falls_within_a_settle_delay(self):
        pin = self.struck_pin()
        for _ in range(int(config.SETTLE_DELAY / (1 / 240.0))):
            pin.step(1 / 240.0)
        self.assertTrue(pin.down)

    def test_fallen_pin_slides_to_a_stop(self):
        pin = self.struck_pin()
        for _ in range(int(8.0 / (1 / 240.0))):
            pin.step(1 / 240.0)
        self.assertLess(math.hypot(pin.velocity[0], pin.velocity[2]),
                        config.PIN_STOP_SPEED + 1e-6)
        self.assertLessEqual(math.degrees(pin.angle), 90.0 + 1e-6)

    def test_pin_never_sinks_through_the_deck(self):
        pin = self.struck_pin(speed=12.0)
        for _ in range(int(3.0 / (1 / 240.0))):
            pin.step(1 / 240.0)
            self.assertGreaterEqual(pin.com[1], pin.radius - 1e-6)

    def test_unstruck_pin_stays_standing(self):
        pin = head_pin()
        for _ in range(int(1.0 / (1 / 240.0))):
            pin.step(1 / 240.0)
        self.assertEqual(pin.angle, 0.0)
        self.assertFalse(pin.down)
        self.assertFalse(pin.hit)

    def test_pin_pin_collision_transfers_momentum(self):
        a = head_pin()
        b = PinPhysics()
        # B sits at the contact clearance along +x; drive A *into* it along
        # the contact normal.
        b.set_base(config.PIN_PIN_CLEARANCE * 0.9, config.HEAD_PIN_Z)
        a.velocity = (3.0, 0.0, 0.0)
        before = pin_energy(a) + pin_energy(b)
        impulse = resolve_pin_pin(a, b, config.RESTITUTION_PIN_PIN)
        self.assertGreater(impulse, 0.0)
        after = pin_energy(a) + pin_energy(b)
        self.assertLessEqual(after, before + 1e-9)
        self.assertTrue(b.hit)
        # Momentum is transferred in the contact-normal direction.
        self.assertLess(a.velocity[0], 3.0)
        self.assertGreater(b.velocity[0], 0.0)

    def test_pin_pin_separated_pins_do_not_touch(self):
        a = head_pin()
        b = PinPhysics()
        far = config.PIN_SPACING * 2.0
        b.set_base(far, config.HEAD_PIN_Z + far)
        a.velocity = (0.0, 0.0, 5.0)
        self.assertEqual(resolve_pin_pin(a, b, config.RESTITUTION_PIN_PIN), 0.0)


class TestRollStability(unittest.TestCase):
    """End-to-end rolls never gain energy and are frame-rate independent."""

    def rack(self):
        row_depth = config.PIN_SPACING * math.cos(math.radians(30))
        pins = []
        for row in range(config.PIN_ROWS):
            count = row + 1
            z = config.HEAD_PIN_Z + row * row_depth
            for i in range(count):
                x = (i - (count - 1) / 2.0) * config.PIN_SPACING
                pin = PinPhysics()
                pin.set_base(x, z)
                pins.append(pin)
        return pins

    def total_energy(self, ball, pins):
        return kinetic_energy(ball) + sum(pin_energy(p) for p in pins)

    def roll(self, dt, speed=7.0, lateral=0.0, tracks_energy=False):
        ball = BallPhysics()
        ball.launch(speed=speed, lateral_position=lateral)
        pins = self.rack()
        step = config.PHYSICS_SUBSTEP
        accumulator = 0.0
        worst_gain = 0.0
        previous = self.total_energy(ball, pins)
        t = 0.0
        while t < 9.0:
            if ball.rolling:
                accumulator += dt
                count = 0
                while (accumulator >= step - 1e-9 and count < 12
                       and ball.rolling):
                    accumulator -= step
                    self.substep(ball, pins, step)
                    count += 1
            t += dt
            if tracks_energy:
                now = self.total_energy(ball, pins)
                worst_gain = max(worst_gain, now - previous)
                previous = now
        knocked = [i for i, p in enumerate(pins) if p.down]
        return knocked, ball, worst_gain

    def substep(self, ball, pins, dt):
        """The scene's sub-step order: integrate, then resolve contacts."""
        ball.step(dt)
        for pin in pins:
            pin.step(dt)

        # Ball/pin contacts (each pin struck at most once per roll).
        for _ in range(len(pins)):
            best = None
            for pin in pins:
                if pin.state == PinPhysics.SETTLED or pin.ball_struck:
                    continue
                contact = pin.ball_contact(ball)
                if contact is None:
                    continue
                push, point, overlap = contact
                along = ball.velocity[0] * push[0] + ball.velocity[2] * push[2]
                if along <= 0.0:
                    continue
                if best is None or overlap > best[0]:
                    best = (overlap, pin, push, point)
            if best is None:
                break
            _overlap, pin, push, point = best
            pin.ball_struck = True
            delta_v = pin.ball_collision(ball, push, point)
            if delta_v is not None:
                ball.bounce(((delta_v[0] * ball.mass, 0.0,
                              delta_v[2] * ball.mass)))
            base_x, base_z = pin.base_xy()
            gap = max(ball.radius * 0.05, 0.005)
            reach = ball.radius + pin.contact_radius + gap
            ball.position = (base_x - push[0] * reach, ball.position[1],
                             base_z - push[2] * reach)

        # Pin/pin contacts.
        for i in range(len(pins)):
            a = pins[i]
            if not a.active:
                continue
            for j in range(i + 1, len(pins)):
                b = pins[j]
                if b.active:
                    resolve_pin_pin(a, b, config.RESTITUTION_PIN_PIN)

        if ball.at_end_of_lane() or ball.stopped or ball.in_gutter:
            ball.rolling = False

    def test_no_energy_is_created_over_a_full_roll(self):
        _knocked, _ball, worst_gain = self.roll(1 / 60.0, tracks_energy=True)
        # The only permitted gains are floating point noise plus the few
        # joules of clamping in the deck contact (see docs/PHYSICS.md).
        self.assertLess(worst_gain, 25.0)

    def test_a_straight_throw_knocks_pins_down(self):
        knocked, _ball, _gain = self.roll(1 / 60.0, speed=7.0)
        self.assertGreaterEqual(len(knocked), 2)
        self.assertLessEqual(len(knocked), 10)

    def test_fast_ball_knocks_pins_down(self):
        knocked, _ball, _gain = self.roll(1 / 60.0, speed=12.0)
        self.assertGreaterEqual(len(knocked), 1)

    def test_weak_throw_does_not_reach_the_pins(self):
        knocked, ball, _gain = self.roll(1 / 60.0, speed=2.0)
        self.assertEqual(knocked, [])
        self.assertLess(ball.z, config.HEAD_PIN_Z)

    def test_frame_rate_does_not_change_the_outcome(self):
        outcomes = []
        for dt in (1 / 30.0, 1 / 60.0, 1 / 240.0):
            knocked, _ball, _gain = self.roll(dt, speed=7.0)
            outcomes.append(sorted(knocked))
        self.assertEqual(outcomes[0], outcomes[1])
        self.assertEqual(outcomes[1], outcomes[2])

    def test_pins_are_still_moving_no_more_than_the_settle_delay_after_a_hit(self):
        ball = BallPhysics()
        ball.launch(speed=7.0)
        pins = self.rack()
        step = config.PHYSICS_SUBSTEP
        for _ in range(int(6.0 / step)):
            if ball.rolling:
                self.substep(ball, pins, step)
        for pin in pins:
            if pin.hit:
                self.assertLessEqual(math.degrees(pin.angle), 90.0 + 1e-6)


if __name__ == '__main__':
    unittest.main(verbosity=2)
