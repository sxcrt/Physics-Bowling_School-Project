"""The Physics Lab driven through the real screen: manual control + timeline.

These tests run the lab the way the player does - offscreen Ursina, a real
pointer, ``App.on_key`` for keyboard and mouse events - and assert the
behaviour the lab promises:

* entering it rolls nothing; BOWL starts the run; PAUSE freezes it; RESUME
  continues it; RESET returns it to the start;
* scrubbing the timeline restores the *exact* recorded simulation state (the
  readout, the ball and the deck all describe the selected moment), and the
  simulation does not advance while a historical state is inspected;
* resuming from a selected state continues forward from there;
* leaving the lab leaves the shared deck as the rest of the game expects it.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from input.mouse_input import ThrowData
from tests.test_ui_interactions import AppTestCase


class LabTestCase(AppTestCase):
    """Shared lab helpers; the app itself comes from ``AppTestCase``."""

    def open_lab(self):
        self.app.go_to_lab()
        self.step(2)
        return self.active()

    def open_rolling_lab(self, frames=90):
        lab = self.open_lab()
        self.click_widget(lab.bowl_button)
        self.step(frames)
        return lab


class TestLabManualControl(LabTestCase):
    """Nothing moves unless the player asks it to."""

    def test_entering_the_lab_does_not_roll(self):
        lab = self.open_lab()
        ball = self.app.game.ball.physics
        for _ in range(6):                      # 4 simulated seconds of frames
            self.step(60)
            self.assertEqual(lab.state, 'idle')
            self.assertFalse(ball.rolling)
            self.assertEqual(ball.z, config.FOUL_LINE_Z)
            self.assertEqual(len(lab.timeline), 0)

    def test_bowl_starts_the_simulation_and_records_it(self):
        lab = self.open_lab()
        self.assertFalse(self.app.game.ball.physics.rolling)
        self.click_widget(lab.bowl_button)
        self.assertEqual(lab.state, 'rolling')
        self.assertTrue(self.app.game.ball.physics.rolling)
        self.step(30)
        self.assertGreater(self.app.game.ball.physics.z, config.FOUL_LINE_Z)
        self.assertGreater(len(lab.timeline), 0)
        self.assertEqual(lab.timeline.time_of(0), 0.0)
        self.assertAlmostEqual(
            lab.timeline.time_of(len(lab.timeline) - 1),
            self.app.game.pins.deck.elapsed, places=9)
        self.assertIn('t =', lab.tl_time.text)

    def test_pause_freezes_the_simulation_and_resume_continues(self):
        lab = self.open_rolling_lab(frames=30)
        self.click_widget(lab.pause_button)
        self.assertTrue(lab.paused)
        ball = self.app.game.ball.physics
        deck = self.app.game.pins.deck
        z, elapsed = ball.z, deck.elapsed
        states = len(lab.timeline)
        self.step(120)                          # 2 simulated seconds
        self.assertEqual(ball.z, z)
        self.assertEqual(deck.elapsed, elapsed)
        self.assertEqual(len(lab.timeline), states)
        self.assertFalse(ball.stopped)
        self.click_widget(lab.pause_button)     # RESUME
        self.assertFalse(lab.paused)
        self.step(30)
        self.assertGreater(ball.z, z)
        self.assertGreater(deck.elapsed, elapsed)

    def test_reset_returns_everything_to_the_initial_state(self):
        lab = self.open_rolling_lab(frames=60)
        self.assertGreater(self.app.game.ball.physics.z, config.FOUL_LINE_Z)
        self.click_widget(lab.reset_button)
        ball = self.app.game.ball.physics
        deck = self.app.game.pins.deck
        self.assertEqual(lab.state, 'idle')
        self.assertFalse(ball.rolling)
        self.assertEqual(ball.position,
                         (lab.setup.lateral, config.BALL_RADIUS,
                          config.FOUL_LINE_Z))
        self.assertEqual(len(lab.timeline), 0)
        self.assertEqual(deck.elapsed, 0.0)
        self.assertEqual(self.app.game.pins.standing_count(),
                         config.PIN_COUNT)
        self.step(120)                          # and it stays still
        self.assertFalse(ball.rolling)
        self.assertEqual(ball.z, config.FOUL_LINE_Z)

    def test_keyboard_controls_pause_reset_and_bowl(self):
        lab = self.open_rolling_lab(frames=30)
        self.app.on_key('p')
        self.assertTrue(lab.paused)
        self.app.on_key('p')
        self.assertFalse(lab.paused)
        self.app.on_key('r')
        self.assertEqual(lab.state, 'idle')
        self.assertEqual(len(lab.timeline), 0)
        self.app.on_key('space')
        self.assertEqual(lab.state, 'rolling')
        self.assertTrue(self.app.game.ball.physics.rolling)


class TestLabTimeline(LabTestCase):
    """Scrubbing must restore and show the real recorded state."""

    def test_scrubbing_pauses_and_restores_the_exact_state(self):
        lab = self.open_rolling_lab()
        deck = self.app.game.pins.deck
        ball = self.app.game.ball
        index = len(lab.timeline) // 2
        state = lab.timeline.ball_state(index)
        lab.scrub_to(index)
        self.assertTrue(lab.paused)
        self.assertEqual(deck.ball.capture_state(), state)
        self.assertAlmostEqual(deck.elapsed, lab.timeline.time_of(index),
                               places=9)
        self.assertAlmostEqual(ball.physics.z, state.position[2])
        self.assertAlmostEqual(lab.values['t'], lab.timeline.time_of(index))
        self.assertIn(f'{lab.timeline.time_of(index):6.3f}', lab.tl_time.text)
        # While inspecting, rendered frames must not advance the simulation.
        before = deck.capture_state()
        self.step(60)
        self.assertEqual(deck.capture_state(), before)
        # Scrubbing only inspects: it must not truncate the recorded future.
        self.assertGreater(len(lab.timeline), index)
        self.assertTrue(lab.paused)

    def test_displayed_values_match_the_selected_moment(self):
        lab = self.open_rolling_lab()
        ball = self.app.game.ball.physics
        for index in (5, 100, 250):
            lab.scrub_to(index)
            state = lab.timeline.ball_state(index)
            speed = math.hypot(state.velocity[0], state.velocity[2])
            self.assertAlmostEqual(lab.values['v'], speed, places=6)
            self.assertAlmostEqual(
                lab.values['vx'],
                state.velocity[0] if state.rolling else 0.0, places=6)
            self.assertAlmostEqual(lab.values['p'],
                                   config.BALL_MASS * speed, places=6)
        self.assertEqual(ball.z, lab.timeline.ball_state(250).position[2])

    def test_clicking_the_track_scrubs_to_that_time(self):
        lab = self.open_rolling_lab()
        track = lab.tl_scrub
        fraction = 0.3
        x = track.position[0] - track.size[0] / 2.0 \
            + track.size[0] * fraction
        self.click_at(x, track.position[1])
        self.assertTrue(lab.paused)
        self.assertAlmostEqual(self.app.game.pins.deck.elapsed,
                               lab.timeline.duration() * fraction,
                               delta=0.02)

    def test_resuming_after_scrubbing_continues_from_the_selected_state(self):
        lab = self.open_rolling_lab()
        deck = self.app.game.pins.deck
        index = 60
        lab.scrub_to(index)
        selected_time = lab.timeline.time_of(index)
        selected_z = deck.ball.z
        self.click_widget(lab.pause_button)     # RESUME
        self.assertFalse(lab.paused)
        self.assertEqual(lab.state, 'rolling')
        self.step(1)
        # It continued forward from the selected state, without jumping.
        self.assertGreater(deck.ball.z, selected_z)
        self.assertLess(deck.ball.z, selected_z + 1.0)
        self.assertGreater(deck.elapsed, selected_time)
        self.assertAlmostEqual(
            lab.timeline.time_of(lab.timeline_index), deck.elapsed, places=9)

    def test_scrubbed_history_is_forked_on_resume(self):
        lab = self.open_rolling_lab()
        index = 45
        lab.scrub_to(index)
        self.assertGreater(len(lab.timeline), index + 1)   # future is there
        self.click_widget(lab.pause_button)     # RESUME from the past
        self.assertFalse(lab.paused)
        self.step(2)
        # The future was dropped and rebuilt from the selected state, so the
        # recording continued forward instead of replaying the old samples.
        self.assertGreater(len(lab.timeline), index + 1)
        self.assertLess(lab.timeline.duration(), 0.5)
        times = lab.timeline.times
        self.assertTrue(all(times[k] < times[k + 1]
                            for k in range(len(times) - 1)))


class TestLabScope(LabTestCase):
    """The lab must not leak its recorder into the rest of the game."""

    def test_leaving_the_lab_clears_the_recorder_and_the_rack(self):
        lab = self.open_rolling_lab(frames=30)
        self.click_widget(lab.back_button)
        self.assertEqual(self.active().name, 'menu')
        deck = self.app.game.pins.deck
        self.assertIsNone(deck.substep_listener)
        self.assertFalse(deck.record_trajectory)
        self.assertEqual(deck.trajectory, [])
        self.assertEqual(self.app.game.pins.standing_count(),
                         config.PIN_COUNT)

    def test_a_classic_match_still_rolls_after_a_lab_visit(self):
        self.open_rolling_lab(frames=30)
        self.active().app.go_to_menu()
        self.app.start_match('classic', [{'name': 'A'}])
        self.step(3)
        game = self.app.game
        self.assertEqual(game.state, 'ready')
        game.launch(ThrowData(speed=7.0, source='script'))
        self.step(60)
        self.assertGreater(game.ball.physics.z, config.FOUL_LINE_Z)
        self.assertEqual(game.pins.deck.substep_listener, None)


if __name__ == '__main__':
    unittest.main(verbosity=2)
