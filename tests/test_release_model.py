"""Tests for the release model: position, direction and hook are separate.

The control scheme the player learns is:

* **A/D** move the ball's starting position (position),
* the **mouse's horizontal position** aims the shot at the targeting arrows
  (direction),
* the **forward drag** sets the release speed,
* the **direction of that drag** adds a release-direction yaw (a leftward
  stroke releases left), and
* the **sideways speed** of the drag adds hook spin (curvature).

These tests drive ``MouseInput`` with a scripted pointer, so they exercise the
same code a real mouse runs, and then feed the resulting ``ThrowData`` into the
shared simulation to show the outcomes differ without anything random.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ursina import held_keys, time, window

import config
import physics
from input.mouse_input import MouseInput, ThrowData, aim_angle


class Drag:
    """A scripted pointer with a button, driven frame by frame."""

    def __init__(self, start=(0.0, 0.0)):
        self.position = start
        self.button = False
        self.mouse = MouseInput(pointer=lambda: self.position,
                                button=lambda: self.button)

    def frame(self, x, y, dt=1.0 / 60.0):
        time.dt = dt
        time.dt_unscaled = dt
        self.position = (x, y)
        self.mouse.update()

    def press(self):
        self.button = True

    def release(self):
        self.button = False

    def stroke(self, lateral_end=0.0, forward=0.30, frames=6, dt=1.0 / 60.0):
        """Backswing down, then a forward stroke drifting ``lateral_end``.

        ``forward`` is the total upward distance in screen heights and
        ``lateral_end`` the sideways drift of the stroke.
        """
        x0, y0 = self.position
        self.press()
        self.frame(x0, y0 - 0.10, dt)               # backswing
        for index in range(1, frames + 1):
            fraction = index / frames
            self.frame(x0 + lateral_end * fraction,
                       y0 - 0.10 + (0.10 + forward) * fraction, dt)
        self.release()
        self.frame(x0 + lateral_end, y0 + forward, dt)
        return self.mouse.throw_data


def lateral_at_pins(result):
    for _t, x, z in result.trajectory:
        if z >= config.HEAD_PIN_Z:
            return x
    return result.ball.position[0]


class TestPositionIsIndependent(unittest.TestCase):
    def test_a_and_d_move_the_starting_position(self):
        mouse = MouseInput(pointer=lambda: (0.0, 0.0))
        held_keys['a'] = 1
        for _ in range(10):
            time.dt = 1.0 / 60.0
            mouse.update()
        held_keys['a'] = 0
        self.assertLess(mouse.lateral, 0.0)
        left = mouse.lateral
        held_keys['d'] = 1
        for _ in range(20):
            time.dt = 1.0 / 60.0
            mouse.update()
        held_keys['d'] = 0
        self.assertGreater(mouse.lateral, left)

    def test_position_is_clamped_to_the_lane(self):
        mouse = MouseInput(pointer=lambda: (0.0, 0.0))
        held_keys['d'] = 1
        for _ in range(200):
            time.dt = 1.0 / 60.0
            mouse.update()
        held_keys['d'] = 0
        self.assertLessEqual(mouse.lateral, config.LATERAL_LIMIT + 1e-9)


class TestAimAndReleaseDirection(unittest.TestCase):
    def test_aim_sweeps_with_the_pointer(self):
        mouse = MouseInput(pointer=lambda: (0.0, 0.0))
        window_aspect = float(window.aspect_ratio)
        mouse._update_aim()
        centre = mouse.aim_angle
        mouse._pointer = lambda: (-window_aspect / 2.0 + 0.01, 0.0)
        mouse._update_aim()
        left = mouse.aim_angle
        mouse._pointer = lambda: (window_aspect / 2.0 - 0.01, 0.0)
        mouse._update_aim()
        right = mouse.aim_angle
        self.assertAlmostEqual(centre, 0.0, places=6)
        self.assertLess(left, -math.radians(config.MAX_AIM_ANGLE) * 0.9)
        self.assertGreater(right, math.radians(config.MAX_AIM_ANGLE) * 0.9)

    def test_straight_drag_adds_no_release_direction(self):
        throw = Drag().stroke(lateral_end=0.0)
        self.assertIsNotNone(throw)
        self.assertAlmostEqual(throw.launch_angle, 0.0, places=6)

    def test_a_leftward_stroke_releases_left_and_vice_versa(self):
        left = Drag().stroke(lateral_end=-0.12)
        right = Drag().stroke(lateral_end=0.12)
        self.assertIsNotNone(left)
        self.assertIsNotNone(right)
        self.assertLess(left.launch_angle, 0.0)
        self.assertGreater(right.launch_angle, 0.0)
        limit = math.radians(config.MAX_LAUNCH_ANGLE)
        self.assertLessEqual(abs(left.launch_angle), limit + 1e-9)
        self.assertLessEqual(abs(right.launch_angle), limit + 1e-9)

    def test_release_direction_is_capped(self):
        steep = Drag().stroke(lateral_end=0.60)
        self.assertIsNotNone(steep)
        self.assertLessEqual(abs(steep.launch_angle),
                             math.radians(config.MAX_LAUNCH_ANGLE) + 1e-9)

    def test_different_release_directions_follow_different_paths(self):
        left = Drag().stroke(lateral_end=-0.10)
        straight = Drag().stroke(lateral_end=0.0)
        right = Drag().stroke(lateral_end=0.10)
        results = [physics.simulate_roll(speed=throw.speed,
                                         lateral_position=throw.lateral_position,
                                         launch_angle=throw.launch_angle,
                                         spin_omega=throw.spin_omega,
                                         record=True)
                   for throw in (left, straight, right)]
        positions = [lateral_at_pins(result) for result in results]
        self.assertLess(positions[0], positions[1])
        self.assertLess(positions[1], positions[2])
        self.assertGreater(positions[2] - positions[0], 0.10,
                           'left and right releases must actually spread the '
                           'ball across the lane')


class TestSpeedFromTheDrag(unittest.TestCase):
    def test_faster_strokes_throw_faster(self):
        slow = Drag().stroke(forward=0.10, frames=8)
        fast = Drag().stroke(forward=0.40, frames=4)
        self.assertIsNotNone(slow)
        self.assertIsNotNone(fast)
        self.assertGreater(fast.speed, slow.speed)
        self.assertLessEqual(fast.speed, config.MAX_THROW_SPEED)
        self.assertGreaterEqual(slow.speed, config.MIN_THROW_SPEED)

    def test_a_twitch_does_not_launch_the_ball(self):
        drag = Drag()
        drag.press()
        drag.frame(0.0, 0.004)                      # a 4 mm jump
        drag.release()
        drag.frame(0.0, 0.004)
        self.assertIsNone(drag.mouse.throw_data)

    def test_a_slow_drag_does_not_launch_the_ball(self):
        drag = Drag()
        drag.press()
        for index in range(20):                     # a very slow, long drag
            drag.frame(0.0, -0.10 + index * 0.01, dt=1.0)
        drag.release()
        drag.frame(0.0, 0.10, dt=1.0)
        self.assertIsNone(drag.mouse.throw_data)


class TestHookFromTheSidestep(unittest.TestCase):
    def test_sideways_drag_sets_the_hook(self):
        hook = Drag().stroke(lateral_end=0.10, frames=4)
        self.assertIsNotNone(hook)
        self.assertNotEqual(hook.spin_omega, 0.0)
        self.assertLessEqual(abs(hook.spin_omega), config.MAX_SPIN)

    def test_hook_reverses_with_the_drag_direction(self):
        left = Drag().stroke(lateral_end=-0.12, frames=4)
        right = Drag().stroke(lateral_end=0.12, frames=4)
        self.assertLess(left.spin_omega * right.spin_omega, 0.0,
                        'opposite sidesteps must produce opposite hook')

    def test_hook_curves_the_ball_in_the_drag_direction(self):
        right = Drag().stroke(lateral_end=0.12, frames=4)
        result = physics.simulate_roll(speed=right.speed,
                                       spin_omega=right.spin_omega,
                                       record=True)
        self.assertGreater(result.lateral_drift(), 0.05,
                           'dragging right must curve the ball right')


class TestDeterminism(unittest.TestCase):
    def test_the_same_drag_produces_the_same_conditions(self):
        first = Drag().stroke(lateral_end=0.05, forward=0.30)
        second = Drag().stroke(lateral_end=0.05, forward=0.30)
        self.assertAlmostEqual(first.speed, second.speed, places=9)
        self.assertAlmostEqual(first.launch_angle, second.launch_angle, places=9)
        self.assertAlmostEqual(first.spin_omega, second.spin_omega, places=9)

    def test_release_noise_is_off_by_default(self):
        self.assertEqual(config.RELEASE_NOISE_YAW, 0.0)
        self.assertEqual(config.RELEASE_NOISE_SPEED, 0.0)
        self.assertEqual(config.RELEASE_NOISE_SPIN, 0.0)

    def test_bounded_noise_can_be_enabled_and_is_seed_reproducible(self):
        from input.mouse_input import ReleaseNoise

        first = ReleaseNoise(seed=7)
        second = ReleaseNoise(seed=7)
        offsets = [first.apply(0.0, 7.0, 0.0) for _ in range(20)]
        repeats = [second.apply(0.0, 7.0, 0.0) for _ in range(20)]
        self.assertEqual(offsets, repeats, 'the same seed must repeat')
        for angle, speed, spin in offsets:
            self.assertLessEqual(abs(math.degrees(angle)),
                                 config.RELEASE_NOISE_YAW + 1e-9)
            self.assertLessEqual(abs(speed - 7.0),
                                 config.RELEASE_NOISE_SPEED + 1e-9)
            self.assertLessEqual(abs(spin), config.RELEASE_NOISE_SPIN + 1e-9)

    def test_the_input_layer_cannot_decide_the_pin_count(self):
        """ThrowData has launch conditions only - never a result."""
        fields = set(ThrowData.__dataclass_fields__)
        self.assertNotIn('pins', fields)
        self.assertNotIn('knockdowns', fields)
        self.assertEqual(fields,
                         {'lateral_position', 'launch_angle', 'speed',
                          'spin_omega', 'source', 'confidence'})

    def test_identical_throws_produce_identical_pinfall(self):
        conditions = dict(speed=7.4, lateral_position=0.12, spin_omega=-1.2,
                          launch_angle=math.radians(0.5))
        first = physics.simulate_roll(**conditions)
        second = physics.simulate_roll(**conditions)
        self.assertEqual(first.knockdowns, second.knockdowns)
        self.assertEqual([p.down for p in first.deck.pins],
                         [p.down for p in second.deck.pins])


class TestTrajectoryVariation(unittest.TestCase):
    def test_meaningful_input_differences_change_the_trajectory(self):
        """The whole point: the ball is not always straight."""
        paths = [physics.simulate_roll(speed=7.0, lateral_position=lateral,
                                       launch_angle=math.radians(yaw),
                                       spin_omega=spin, record=True)
                 for lateral, yaw, spin in ((0.0, 0.0, 0.0),
                                            (0.25, 0.0, 0.0),
                                            (0.0, 1.0, 0.0),
                                            (0.0, 0.0, -2.0),
                                            (-0.2, 0.6, 1.0))]
        pins = [result.knockdowns for result in paths]
        self.assertGreater(len(set(pins)), 1,
                           f'these five throws all ended the same way: {pins}')
        drifts = [result.lateral_drift() for result in paths]
        self.assertGreater(max(drifts) - min(drifts), 0.20,
                           'the paths must differ laterally')

    def test_aim_angle_helper_matches_its_documented_geometry(self):
        yaw = aim_angle(0.15, 0.0)
        self.assertAlmostEqual(math.degrees(yaw),
                               math.degrees(math.atan2(0.15,
                                                       config.AIM_ARROW_Z)),
                               places=6)
        # Beyond the cap the yaw stops growing.
        self.assertAlmostEqual(math.degrees(aim_angle(0.50, 0.0)),
                               config.MAX_AIM_ANGLE, places=6)


class TestWebcamReleaseModel(unittest.TestCase):
    """The webcam produces the same *kind* of conditions as the mouse."""

    def event(self, **kwargs):
        from input.swing import SwingEvent
        base = dict(up_speed=2.0, body_x=0.5, arm='right', duration=0.6,
                    time=1.0)
        base.update(kwargs)
        return SwingEvent(**base)

    def test_swing_direction_adds_a_release_yaw(self):
        from input.webcam_input import event_to_throw
        straight = event_to_throw(self.event(), mirror=False)
        left = event_to_throw(self.event(lateral_speed=-0.8), mirror=False)
        right = event_to_throw(self.event(lateral_speed=0.8), mirror=False)
        self.assertAlmostEqual(straight.launch_angle, 0.0, places=6)
        self.assertLess(left.launch_angle, 0.0)
        self.assertGreater(right.launch_angle, 0.0)
        limit = math.radians(config.MAX_LAUNCH_ANGLE)
        for throw in (left, right):
            self.assertLessEqual(abs(throw.launch_angle), limit + 1e-9)

    def test_body_position_sets_the_starting_position_not_the_direction(self):
        from input.webcam_input import event_to_throw
        left = event_to_throw(self.event(body_x=0.2), mirror=False)
        right = event_to_throw(self.event(body_x=0.8), mirror=False)
        self.assertLess(left.lateral_position, right.lateral_position)
        self.assertAlmostEqual(left.launch_angle, 0.0, places=6)
        self.assertAlmostEqual(right.launch_angle, 0.0, places=6)

    def test_swing_speed_sets_the_release_speed(self):
        from input.webcam_input import event_to_throw
        slow = event_to_throw(self.event(up_speed=0.6), mirror=False)
        fast = event_to_throw(self.event(up_speed=2.0), mirror=False)
        self.assertLess(slow.speed, fast.speed)
        self.assertGreaterEqual(slow.speed, config.MIN_THROW_SPEED)
        self.assertLessEqual(fast.speed, config.MAX_THROW_SPEED)

    def test_both_inputs_produce_the_same_condition_shape(self):
        from input.webcam_input import event_to_throw
        mouse = Drag().stroke(lateral_end=0.08)
        webcam = event_to_throw(self.event(body_x=0.62, lateral_speed=0.5,
                                           hand_offset=0.2), mirror=False)
        for throw in (mouse, webcam):
            self.assertLessEqual(abs(throw.lateral_position),
                                 config.LATERAL_LIMIT + 1e-9)
            self.assertLessEqual(abs(throw.launch_angle),
                                 math.radians(config.MAX_LAUNCH_ANGLE) + 1e-9)
            self.assertLessEqual(abs(throw.spin_omega),
                                 config.MAX_SPIN + 1e-9)
            self.assertGreaterEqual(throw.speed, config.MIN_THROW_SPEED)
            self.assertLessEqual(throw.speed, config.MAX_THROW_SPEED)


if __name__ == '__main__':
    unittest.main(verbosity=2)
