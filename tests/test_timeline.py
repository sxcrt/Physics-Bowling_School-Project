"""The Physics Lab's timeline: recorded states restore the real simulation.

These tests are pure Python (no engine): they exercise the snapshot layer in
:mod:`physics` - the layer the lab's scrubber is built on - and the claim that
matters there: restoring a recorded state and continuing integrates the same
continuation the original run would have produced, so the timeline is the
simulation and not an animation over it.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
import physics


def start_roll(deck=None, **launch):
    deck = physics.Deck() if deck is None else deck
    deck.full_rack()
    deck.begin_roll()
    deck.ball.launch(**launch)
    return deck


def run_roll(deck, max_frames=4000):
    """Step a deck until the ball is done and the pins have settled."""
    for _ in range(max_frames):
        if deck.ball_done:
            if deck.quiet():
                break
            deck.settle(config.PHYSICS_SUBSTEP)
        else:
            deck.advance(config.PHYSICS_SUBSTEP)
    return deck


class TestCaptureRestore(unittest.TestCase):
    """``capture_state`` / ``restore_state`` must round-trip exactly."""

    def test_a_ball_round_trip_restores_every_field(self):
        ball = physics.BallPhysics()
        ball.launch(speed=7.5, lateral_position=0.2, launch_angle=0.01,
                    spin_omega=-1.2)
        for _ in range(40):
            ball.step(config.PHYSICS_SUBSTEP)
        state = ball.capture_state()
        for _ in range(80):
            ball.step(config.PHYSICS_SUBSTEP)
        ball.restore_state(state)
        self.assertEqual(ball.capture_state(), state)

    def test_a_deck_round_trip_restores_the_whole_rack(self):
        deck = start_roll(speed=7.6, lateral_position=0.16, spin_omega=-1.6)
        run_roll(deck, max_frames=600)
        state = deck.capture_state()
        run_roll(deck, max_frames=600)
        deck.restore_state(state)
        self.assertEqual(deck.capture_state(), state)
        self.assertEqual(deck.elapsed, state.elapsed)
        self.assertEqual(deck.ball.position, state.ball.position)
        self.assertEqual(deck.ball_done, state.ball_done)
        self.assertEqual(deck.roll_down, set(state.roll_down))

    def test_resuming_a_restored_state_repeats_the_continuation(self):
        """The deterministic heart of the feature: a restored state plus the
        same sub-steps produces the same states the original run produced."""
        deck = start_roll(speed=7.4, lateral_position=0.18, spin_omega=-1.4)
        for _ in range(300):
            deck.advance(config.PHYSICS_SUBSTEP)
        state = deck.capture_state()
        original = []
        for _ in range(240):
            deck.advance(config.PHYSICS_SUBSTEP)
            original.append((deck.ball.position, deck.ball.velocity))
        deck.restore_state(state)
        repeated = []
        for _ in range(240):
            deck.advance(config.PHYSICS_SUBSTEP)
            repeated.append((deck.ball.position, deck.ball.velocity))
        self.assertEqual(original, repeated)


class TestSubstepListener(unittest.TestCase):
    """The recorder hook must observe every sub-step and change nothing."""

    def test_the_listener_sees_every_substep_with_its_time(self):
        deck = start_roll(speed=7.0)
        seen = []
        deck.substep_listener = lambda d: seen.append(d.elapsed)
        for _ in range(50):
            deck.advance(config.PHYSICS_SUBSTEP)
        self.assertEqual(len(seen), 50)
        self.assertAlmostEqual(seen[-1], 50 * config.PHYSICS_SUBSTEP,
                               places=9)

    def test_the_listener_does_not_change_the_outcome(self):
        def record(attach):
            deck = start_roll(speed=7.6, lateral_position=0.18,
                              spin_omega=-1.6)
            deck.record_start()
            if attach:
                deck.substep_listener = lambda d: None
            run_roll(deck)
            return deck.knockdown_count(), list(deck.trajectory)

        self.assertEqual(record(False), record(True))


class TestDeckTimeline(unittest.TestCase):
    """The lab's recording: indexing, restoring and forking."""

    def make_timeline(self, frames=240):
        deck = start_roll(speed=7.0, lateral_position=0.2, spin_omega=-1.0)
        deck.record_start()
        timeline = physics.DeckTimeline()
        deck.substep_listener = timeline.record
        timeline.record(deck)               # t = 0: the release state
        for _ in range(frames):
            deck.advance(config.PHYSICS_SUBSTEP)
        return deck, timeline

    def test_one_state_per_substep_plus_the_release(self):
        _deck, timeline = self.make_timeline(frames=240)
        self.assertEqual(len(timeline), 241)
        self.assertEqual(timeline.time_of(0), 0.0)
        self.assertAlmostEqual(timeline.time_of(240), 1.0, places=9)

    def test_index_at_picks_the_nearest_recorded_time(self):
        _deck, timeline = self.make_timeline()
        self.assertEqual(timeline.index_at(0.0), 0)
        self.assertEqual(timeline.index_at(0.5), 120)
        self.assertEqual(timeline.index_at(-5.0), 0)
        self.assertEqual(timeline.index_at(99.0), len(timeline) - 1)

    def test_an_empty_timeline_reports_no_index(self):
        timeline = physics.DeckTimeline()
        self.assertIsNone(timeline.index_at(0.0))
        self.assertEqual(timeline.duration(), 0.0)
        self.assertEqual(len(timeline), 0)

    def test_restoring_an_index_returns_that_exact_state(self):
        deck, timeline = self.make_timeline()
        index = 100
        timeline.restore(deck, index)
        self.assertEqual(deck.ball.capture_state(),
                         timeline.states[index].ball)
        self.assertAlmostEqual(deck.elapsed, timeline.time_of(index),
                               places=9)
        self.assertEqual(deck._accumulator, 0.0)
        # The recorded path belongs to the inspected moment.
        self.assertEqual(len(deck.trajectory), index)

    def test_resuming_from_a_restored_state_extends_the_recording(self):
        deck, timeline = self.make_timeline()
        index = 120
        timeline.restore(deck, index)
        timeline.truncate(index)
        self.assertEqual(len(timeline), index + 1)
        for _ in range(60):
            deck.advance(config.PHYSICS_SUBSTEP)
        self.assertEqual(len(timeline), index + 61)
        self.assertTrue(all(timeline.times[k] < timeline.times[k + 1]
                            for k in range(len(timeline) - 1)))


class TestTorque(unittest.TestCase):
    """The lab's torque readout is physical, not decorative."""

    def test_torque_is_recorded_while_the_ball_moves_and_zero_at_rest(self):
        ball = physics.BallPhysics()
        ball.launch(speed=7.0, spin_omega=-1.5)     # released sliding
        ball.step(config.PHYSICS_SUBSTEP)
        sliding_torque = ball.last_torque
        self.assertGreater(math.hypot(sliding_torque[0], sliding_torque[2]),
                           0.0)
        ball.set_speed(0.0)                          # comes to rest
        self.assertEqual(ball.last_torque, (0.0, 0.0, 0.0))

    def test_rolling_torque_matches_the_constraint_tau_equals_i_alpha(self):
        ball = physics.BallPhysics()
        ball.launch(speed=7.0, spin_omega=-1.5)
        for _ in range(120):
            ball.step(config.PHYSICS_SUBSTEP)
        self.assertTrue(ball.rolling)
        self.assertAlmostEqual(ball.slip_speed(), 0.0, places=9)
        # alpha = (y x a) / R, so |tau| = I |alpha| = (I / R) * |a|.
        ax, _ay, az = ball.last_acceleration
        expected = ball.inertia / ball.radius * math.hypot(ax, az)
        actual = math.hypot(ball.last_torque[0], ball.last_torque[2])
        self.assertAlmostEqual(actual, expected, places=9)


if __name__ == '__main__':
    unittest.main(verbosity=2)
