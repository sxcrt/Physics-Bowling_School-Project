"""Regression tests for the "the ball does not move sideways" bug.

The original game could only set the ball's *starting* position: every throw
was launched with ``launch_angle == 0`` and its "spin" was a rotation about the
vertical axis, which produces no lateral force at all, so no throw could ever
curve or cross the lane. Three separate things were wrong, and these tests pin
all three down:

1. the mouse never produced an aim (launch angle) - only a start position;
2. the webcam's lateral hand speed was mapped to a physically inert spin;
3. the physics had no mechanism that could bend a path, because the release
   spin was a pure ``+y`` rotation whose contribution to the contact-point
   velocity is zero.

Run with:  ``python -m unittest tests.test_lateral_movement -v``
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
import physics
from input.mouse_input import MouseInput, aim_angle
from input.swing import SwingEvent
from input.webcam_input import event_to_throw


def final_lateral(result):
    """The ball's lateral position when its roll ended (m)."""
    if result.trajectory:
        return result.trajectory[-1][1]
    return result.ball.position[0]


def lateral_at_pins(result):
    """The ball's lateral position when it reached the head pin (m)."""
    for _t, x, z in result.trajectory:
        if z >= config.HEAD_PIN_Z:
            return x
    return final_lateral(result)


class TestLaunchAngleMovesTheBall(unittest.TestCase):
    def test_positive_angle_moves_the_ball_right(self):
        straight = physics.simulate_roll(speed=7.0, record=True)
        right = physics.simulate_roll(speed=7.0,
                                      launch_angle=math.radians(0.8),
                                      record=True)
        self.assertGreater(lateral_at_pins(right),
                           lateral_at_pins(straight) + 0.10,
                           'a rightward aim must move the ball right')

    def test_left_and_right_aims_go_to_opposite_sides(self):
        left = physics.simulate_roll(speed=7.0,
                                     launch_angle=math.radians(-0.9),
                                     record=True)
        right = physics.simulate_roll(speed=7.0,
                                      launch_angle=math.radians(0.9),
                                      record=True)
        self.assertLess(lateral_at_pins(left), -0.10)
        self.assertGreater(lateral_at_pins(right), 0.10)

    def test_start_position_and_aim_are_independent(self):
        # Standing left with a rightward aim and standing right with a
        # leftward aim must produce mirrored paths.
        left = physics.simulate_roll(speed=7.0, lateral_position=-0.25,
                                     launch_angle=math.radians(0.6),
                                     record=True)
        right = physics.simulate_roll(speed=7.0, lateral_position=0.25,
                                      launch_angle=math.radians(-0.6),
                                      record=True)
        self.assertGreater(lateral_at_pins(left), -0.25)
        self.assertLess(lateral_at_pins(right), 0.25)

    def test_different_aims_change_which_pins_fall(self):
        """The whole point: aim decides the result, and it is simulated."""
        straight = physics.simulate_roll(speed=7.0)
        across = physics.simulate_roll(speed=7.0,
                                       launch_angle=math.radians(1.2))
        self.assertNotEqual(straight.knockdowns, across.knockdowns,
                            'a dead-straight ball and one sent across the lane '
                            'must hit different pins')


class TestHookSpinCurvesTheBall(unittest.TestCase):
    def test_hook_spin_produces_lateral_drift(self):
        straight = physics.simulate_roll(speed=7.0, record=True)
        hooked = physics.simulate_roll(speed=7.0, spin_omega=2.0, record=True)
        self.assertGreater(abs(hooked.lateral_drift()), 0.10,
                           'hook spin must bend the path')
        self.assertGreater(abs(hooked.lateral_drift()),
                           abs(straight.lateral_drift()) + 0.05)

    def test_hook_direction_follows_the_spin_sign(self):
        positive = physics.simulate_roll(speed=7.0, spin_omega=2.0, record=True)
        negative = physics.simulate_roll(speed=7.0, spin_omega=-2.0, record=True)
        self.assertLess(positive.lateral_drift(), -0.05)
        self.assertGreater(negative.lateral_drift(), 0.05)

    def test_hook_is_bounded(self):
        """A maximum-strength hook may leave the lane but never off the world."""
        result = physics.simulate_roll(speed=7.0, spin_omega=config.MAX_SPIN,
                                       record=True)
        limit = config.LANE_WIDTH / 2.0 + config.GUTTER_WIDTH + 1e-6
        for _t, x, _z in result.trajectory:
            self.assertLessEqual(abs(x), limit)

    def test_ball_stays_on_the_lane_or_in_a_gutter(self):
        result = physics.simulate_roll(speed=7.0, lateral_position=0.3,
                                       launch_angle=math.radians(1.2),
                                       spin_omega=-3.0, record=True)
        self.assertTrue(result.trajectory)
        self.assertLessEqual(abs(final_lateral(result)),
                             config.LANE_WIDTH / 2.0 + config.GUTTER_WIDTH
                             + 1e-6)


class TestMouseAimMapping(unittest.TestCase):
    def test_aim_angle_points_at_the_aim_target(self):
        # From the centre, aiming 0.09 m beside centre at the arrows.
        angle = aim_angle(0.09, 0.0)
        self.assertAlmostEqual(math.degrees(angle),
                               math.degrees(math.atan2(0.09,
                                                       config.AIM_ARROW_Z)),
                               places=4)

    def test_aim_angle_is_clamped(self):
        self.assertLessEqual(abs(aim_angle(5.0, 0.0)),
                             math.radians(config.MAX_AIM_ANGLE) + 1e-9)
        self.assertGreaterEqual(aim_angle(-5.0, 0.0),
                                -math.radians(config.MAX_AIM_ANGLE) - 1e-9)

    def test_mouse_aim_reaches_throw_data(self):
        """Two pointer positions must produce two different launch angles."""
        left = MouseInput(pointer=lambda: (-0.06, 0.0))
        right = MouseInput(pointer=lambda: (0.06, 0.0))
        left.update()
        right.update()
        self.assertLess(left.aim_angle, 0.0)
        self.assertGreater(right.aim_angle, 0.0)
        self.assertNotAlmostEqual(left.aim_angle, right.aim_angle, places=4)

    def test_mouse_throws_from_different_aims_follow_different_paths(self):
        throws = []
        for pointer_x in (-0.06, 0.0, 0.06):
            mouse = MouseInput(pointer=lambda px=pointer_x: (px, 0.0))
            mouse.lateral = 0.0
            mouse.update()
            throw = _scripted_throw(mouse, speed=7.0)
            throws.append(throw)
        results = [physics.simulate_roll(
            speed=throw.speed, lateral_position=throw.lateral_position,
            launch_angle=throw.launch_angle, spin_omega=throw.spin_omega,
            record=True) for throw in throws]
        positions = [lateral_at_pins(result) for result in results]
        self.assertLess(positions[0], positions[1])
        self.assertLess(positions[1], positions[2])
        self.assertGreater(positions[2] - positions[0], 0.15,
                           'aiming left and right must spread the ball across '
                           'the lane')


def _scripted_throw(mouse, speed=7.0, spin=None):
    """Build the ThrowData a release would produce for the current aim."""
    from input.mouse_input import ThrowData

    return ThrowData(lateral_position=mouse.lateral,
                     launch_angle=mouse.aim_angle,
                     speed=speed,
                     spin_omega=0.0 if spin is None else spin,
                     source='mouse')


class TestWebcamAimAndHook(unittest.TestCase):
    def test_hand_offset_aims_the_throw(self):
        event = SwingEvent(up_speed=2.0, body_x=0.5, arm='right', duration=0.6,
                           time=1.0, hand_offset=0.4)
        throw = event_to_throw(event, mirror=False)
        self.assertGreater(throw.launch_angle, 0.0)

    def test_lateral_hand_speed_hooks_the_throw(self):
        event = SwingEvent(up_speed=2.0, body_x=0.5, arm='right', duration=0.6,
                           time=1.0, lateral_speed=1.0)
        throw = event_to_throw(event, mirror=False)
        self.assertNotEqual(throw.spin_omega, 0.0)
        self.assertLessEqual(abs(throw.spin_omega), config.MAX_SPIN)

    def test_webcam_throw_travels_sideways_when_aimed(self):
        event = SwingEvent(up_speed=1.6, body_x=0.62, arm='right', duration=0.6,
                           time=1.0, hand_offset=0.35, lateral_speed=0.8)
        throw = event_to_throw(event, mirror=False)
        result = physics.simulate_roll(
            speed=throw.speed, lateral_position=throw.lateral_position,
            launch_angle=throw.launch_angle, spin_omega=throw.spin_omega,
            record=True)
        self.assertNotEqual(lateral_at_pins(result), throw.lateral_position)


class TestRepeatability(unittest.TestCase):
    def test_identical_conditions_produce_identical_results(self):
        first = physics.simulate_roll(speed=7.2, lateral_position=0.12,
                                      launch_angle=math.radians(0.4),
                                      spin_omega=-1.5)
        second = physics.simulate_roll(speed=7.2, lateral_position=0.12,
                                       launch_angle=math.radians(0.4),
                                       spin_omega=-1.5)
        self.assertEqual(first.knockdowns, second.knockdowns)
        self.assertAlmostEqual(first.lateral_drift(), second.lateral_drift(),
                               places=9)

    def test_frame_rate_does_not_change_the_outcome(self):
        """Integration is on a fixed sub-step, so bigger frames must not drift."""
        results = [physics.simulate_roll(speed=7.4, lateral_position=0.1,
                                         spin_omega=-1.0, dt=dt)
                   for dt in (1 / 240.0, 1 / 120.0, 1 / 60.0, 1 / 30.0)]
        counts = [result.knockdowns for result in results]
        self.assertEqual(len(set(counts)), 1,
                         f'pinfall changed with the frame rate: {counts}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
