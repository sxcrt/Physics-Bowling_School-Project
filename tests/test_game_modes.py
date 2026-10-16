"""Integration tests for input-mode switching inside the real Game.

Uses the real Game (offscreen Ursina window) with a fake webcam input, so no
camera is ever opened by the tests. Verifies that TAB / 1 / 2 switch modes
without touching the score or game state, that webcam throws flow through the
existing launch/physics/scoring pipeline, that a webcam failure falls back to
mouse controls with a visible message, and that shutdown stops the webcam.

Run with:
    python -m unittest discover -s tests -v
"""
import importlib.util
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from ursina import Ursina, application, time, window, color

import config
import main as game_main
from input.mouse_input import MouseInput, ThrowData
from input.webcam_input import WebcamStatus
from tracking.service import TrackingSnapshot
from ui.hud import webcam_feedback_lines
from ui.webcam_panel import WebcamPanel

CV2_AVAILABLE = importlib.util.find_spec('cv2') is not None

FIXED_DT = 1.0 / 60.0
MAX_FRAMES = 8000


class FakeWebcamInput:
    """Duck-typed WebcamInput for the Game (no camera, no threads)."""

    def __init__(self):
        self.lateral = 0.0
        self.pending = None
        self.start_count = 0
        self.stop_count = 0
        self.ready_log = []
        self.arm = 'auto'
        self.arm_cycles = 0
        self._status = WebcamStatus(running=False)

    # ThrowSource
    def update(self):
        pass

    @property
    def throw_data(self):
        data = self.pending
        self.pending = None
        return data

    def discard_pending(self):
        self.pending = None

    # webcam-specific surface used by Game
    def start(self):
        self.start_count += 1

    def stop(self):
        self.stop_count += 1

    def cycle_preferred_arm(self):
        order = ('auto', 'right', 'left')
        self.arm_cycles += 1
        self.arm = order[(order.index(self.arm) + 1) % len(order)]
        return self.arm

    def set_game_ready(self, ready):
        self.ready_log.append(ready)

    def status(self):
        return self._status

    def latest_snapshot(self):
        return None


class ModeHarness:
    def __init__(self):
        application.calculate_dt = False
        self.app = Ursina(
            title='Hells Balls (mode tests)', size=(1280, 720),
            window_type='offscreen', development_mode=True,
            show_ursina_splash=False, icon='',
        )
        window.color = color.rgb32(*config.WINDOW_BACKGROUND)
        self.mouse = MouseInput()
        self.webcam = FakeWebcamInput()
        self.game = game_main.Game(
            inputs={'mouse': self.mouse, 'webcam': self.webcam})
        game_main.game = self.game
        game_main.app = self.app

    def step(self, frames=1):
        for _ in range(frames):
            time.dt = FIXED_DT
            time.dt_unscaled = FIXED_DT
            self.game.update()
            self.app._update()

    def run_until(self, predicate, max_frames=MAX_FRAMES):
        for _ in range(max_frames):
            self.step()
            if predicate():
                return
        raise AssertionError(
            f'game did not reach the expected state within {max_frames} '
            f'frames (state={self.game.state!r})')


def make_harness():
    try:
        return ModeHarness()
    except Exception as exc:                    # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')


class ModeTestCase(unittest.TestCase):
    harness = None

    @classmethod
    def setUpClass(cls):
        cls.harness = make_harness()

    def setUp(self):
        h = self.harness
        h.game.input_mode = 'mouse'
        h.game.new_game()
        h.webcam.pending = None
        h.webcam.lateral = 0.0
        h.webcam.start_count = 0
        h.webcam.stop_count = 0
        h.webcam.arm = 'auto'
        h.webcam.arm_cycles = 0
        h.webcam.ready_log.clear()
        h.webcam._status = WebcamStatus(running=False)


class TestModeSelection(ModeTestCase):
    def test_default_mode_is_mouse(self):
        h = self.harness
        self.assertEqual(h.game.input_mode, 'mouse')
        self.assertIs(h.game.input_source, h.mouse)

    def test_tab_toggles_and_preserves_game_state(self):
        h = self.harness
        g = h.game
        g.score.record_roll(4)
        g.knockdowns = 4
        before = (list(g.score.rolls), g.state, g.score.current_frame_number,
                  g.ball.physics.x, g.ball.physics.z)

        g.on_key('tab')
        self.assertEqual(g.input_mode, 'webcam')
        self.assertEqual(h.webcam.start_count, 1)
        self.assertIs(g.input_source, h.webcam)

        g.on_key('tab')
        self.assertEqual(g.input_mode, 'mouse')
        self.assertEqual(h.webcam.stop_count, 1)
        self.assertIs(g.input_source, h.mouse)

        after = (list(g.score.rolls), g.state, g.score.current_frame_number,
                 g.ball.physics.x, g.ball.physics.z)
        self.assertEqual(before, after)

    def test_number_keys_select_modes_directly(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        self.assertEqual(g.input_mode, 'webcam')
        g.on_key('2')                        # already webcam: no extra start
        self.assertEqual(h.webcam.start_count, 1)
        g.on_key('1')
        self.assertEqual(g.input_mode, 'mouse')
        g.on_key('1')                        # already mouse: no extra stop
        self.assertEqual(h.webcam.stop_count, 1)


class TestThrowingArmKey(ModeTestCase):
    def test_c_key_cycles_the_throwing_arm_in_webcam_mode(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        g.on_key('c')
        self.assertEqual(h.webcam.arm_cycles, 1)
        self.assertEqual(h.webcam.arm, 'right')
        self.assertIn('Throwing arm', g.message)
        g.on_key('c')
        self.assertEqual(h.webcam.arm, 'left')

    def test_c_key_is_ignored_in_mouse_mode(self):
        h = self.harness
        h.game.on_key('c')
        self.assertEqual(h.webcam.arm_cycles, 0)


class TestWebcamGameplay(ModeTestCase):
    def test_webcam_throw_uses_the_existing_launch_and_scoring(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        h.webcam.pending = ThrowData(speed=7.0, lateral_position=0.0)
        h.step(1)
        self.assertEqual(g.state, 'rolling')
        self.assertGreater(g.ball.physics.v, 2.0)
        h.run_until(lambda: g.state == 'result', max_frames=6000)
        self.assertGreaterEqual(g.knockdowns, 0)
        self.assertLessEqual(g.knockdowns, 10)
        # The existing scorer recorded the roll, exactly like a mouse throw.
        self.assertEqual(g.score.rolls[-1], g.knockdowns)
        h.run_until(lambda: g.state in ('ready', 'game_over'))
        self.assertEqual(len([p for p in g.pins.pins
                              if not p.physics.down and not p.physics.removed]),
                         g.score.standing_pins())

    def test_ready_flag_follows_the_game_state(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        h.step(2)
        self.assertIn(True, h.webcam.ready_log)     # state is ready
        h.webcam.pending = ThrowData(speed=7.0, lateral_position=0.0)
        h.step(1)                                    # launches the ball
        h.step(1)
        self.assertIn(False, h.webcam.ready_log)     # rolling: throws blocked
        h.run_until(lambda: g.state in ('ready', 'game_over'))
        h.step(1)
        self.assertTrue(h.webcam.ready_log[-1])

    def test_switching_modes_mid_roll_is_safe(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        h.webcam.pending = ThrowData(speed=7.0, lateral_position=0.0)
        h.step(1)
        self.assertEqual(g.state, 'rolling')
        g.on_key('1')                                # switch away mid-roll
        self.assertEqual(g.input_mode, 'mouse')
        self.assertEqual(h.webcam.stop_count, 1)
        h.run_until(lambda: g.state in ('ready', 'game_over'))
        self.assertNotEqual(g.state, 'rolling')      # roll finished normally


class TestFullWebcamSwing(ModeTestCase):
    def test_synthetic_swing_launches_the_ball_in_game(self):
        """End-to-end: Game -> real WebcamInput -> classifier -> ball."""
        from input.classifier import SwingClassifier
        from input.webcam_input import WebcamInput
        from tests.test_swing import DT, pose_result
        from tests.test_webcam_input import FakeClock, FakeService

        h = self.harness
        g = h.game
        service = FakeService()
        clock = FakeClock()
        log_dir = tempfile.mkdtemp(prefix='strike_lab_swing_test_')
        self.addCleanup(shutil.rmtree, log_dir, ignore_errors=True)
        webcam = WebcamInput(service=service, classifier=SwingClassifier(),
                             clock=clock,
                             log_path=os.path.join(log_dir, 'swing.log'))
        original = h.webcam
        h.webcam = webcam
        g.inputs['webcam'] = webcam
        self.addCleanup(setattr, h, 'webcam', original)

        def feed(y):
            clock.advance(DT)
            service.feed(pose_result(right_wrist_y=y))
            h.step(1)

        g.on_key('2')
        self.addCleanup(g.set_input_mode, 'mouse')

        for _ in range(60):                      # hold the ready position
            feed(0.62)
            if webcam.status().phase == 'ready':
                break
        self.assertEqual(webcam.status().phase, 'ready')

        for i in range(1, 7):                    # backswing
            feed(0.62 + 0.28 * i / 6)
        for i in range(1, 9):                    # forward swing and release
            feed(0.90 - 0.60 * i / 8)
        for _ in range(10):                      # let the physics advance
            feed(0.30)

        self.assertEqual(g.state, 'rolling')
        self.assertGreater(g.ball.physics.v, 2.0)
        self.assertGreater(g.ball.physics.z, config.FOUL_LINE_Z)


class TestWebcamFailureHandling(ModeTestCase):
    def test_camera_error_falls_back_to_mouse_with_a_message(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        h.webcam._status = WebcamStatus(
            error='no webcam could be opened at index 0')
        h.step(1)
        self.assertEqual(g.input_mode, 'mouse')
        self.assertEqual(h.webcam.stop_count, 1)
        self.assertIn('Webcam unavailable', g.message)
        self.assertGreater(g.message_timer, 0.0)
        # The game keeps working with mouse controls.
        h.mouse._pending = ThrowData(speed=7.0, lateral_position=0.0)
        h.step(1)
        self.assertEqual(g.state, 'rolling')

    def test_shutdown_releases_the_camera(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        g.shutdown()
        self.assertEqual(h.webcam.stop_count, 1)
        g.shutdown()                                  # idempotent
        self.assertEqual(h.webcam.stop_count, 2)

    def test_error_message_clears_after_its_duration(self):
        h = self.harness
        g = h.game
        g.on_key('2')
        h.webcam._status = WebcamStatus(error='camera stopped')
        h.step(1)
        self.assertGreater(g.message_timer, 0.0)
        g.message_timer = 0.01
        h.step(2)
        self.assertEqual(g.message_timer, 0.0)


class TestWebcamFeedbackLines(unittest.TestCase):
    """Pure HUD text formatting (no Ursina app needed)."""

    def test_tracked(self):
        lines = webcam_feedback_lines(WebcamStatus(
            running=True, tracked=True, confidence=0.87, fps=20.0,
            phase='ready', phase_label='Ready', hint='Swing now.'))
        text = '\n'.join(t for t, _ in lines)
        self.assertIn('tracking OK', text)
        self.assertIn('87%', text)
        self.assertIn('Ready', text)
        self.assertIn('Swing now.', text)

    def test_no_person(self):
        lines = webcam_feedback_lines(
            WebcamStatus(running=True, tracked=False, lost_seconds=None))
        self.assertIn('no person detected', lines[0][0])

    def test_lost(self):
        lines = webcam_feedback_lines(
            WebcamStatus(running=True, tracked=False, lost_seconds=2.4))
        self.assertIn('tracking lost', lines[0][0])

    def test_error(self):
        lines = webcam_feedback_lines(WebcamStatus(error='no camera'))
        self.assertIn('unavailable', lines[0][0])
        self.assertIn('no camera', lines[0][0])

    def test_starting(self):
        lines = webcam_feedback_lines(WebcamStatus(running=False))
        self.assertIn('starting', lines[0][0])

    def test_telemetry_line_is_included(self):
        lines = webcam_feedback_lines(WebcamStatus(
            running=True, tracked=True, confidence=0.9, phase='ready',
            phase_label='Ready', hint='Swing.', telemetry='R arm: up 1.20/s'))
        text = '\n'.join(t for t, _ in lines)
        self.assertIn('1.20/s', text)

    def test_throwing_arm_is_displayed(self):
        lines = webcam_feedback_lines(WebcamStatus(
            running=True, tracked=True, confidence=0.9, phase='ready',
            phase_label='Ready', hint='Swing.', arm='left'))
        text = '\n'.join(t for t, _ in lines)
        self.assertIn('arm: left', text)

    def test_none(self):
        self.assertEqual(webcam_feedback_lines(None), [])


@unittest.skipUnless(CV2_AVAILABLE, 'OpenCV (cv2) is not available')
class TestWebcamPanelGeometry(ModeTestCase):
    """Regression tests for the invisible-panel bug: in Ursina's UI space a
    quad that is accidentally left at its default scale covers the whole
    screen (world scale 20x20). The panel must start hidden, only show when
    webcam frames arrive, and always sit in the bottom-left corner."""

    def test_panel_entities_start_hidden(self):
        panel = WebcamPanel()
        self.assertFalse(panel._feed.visible)
        self.assertTrue(all(not edge.visible for edge in panel._edges))

    def test_panel_is_hidden_in_mouse_mode(self):
        h = self.harness
        h.step(2)
        panel = h.game.webcam_panel
        self.assertFalse(panel._feed.visible)
        self.assertTrue(all(not edge.visible for edge in panel._edges))

    def test_panel_shows_in_the_bottom_left_corner(self):
        h = self.harness
        panel = h.game.webcam_panel
        frame = np.zeros((360, 640, 3), dtype='uint8')
        snapshot = TrackingSnapshot(running=True, tracked=False,
                                    frame=frame, frame_count=1)
        panel.update(snapshot, WebcamStatus(running=True), True)
        self.assertTrue(panel._feed.visible)
        # Local UI scale must be small (fullscreen would be ~(aspect, 1)).
        self.assertLess(panel._feed.scale[0], 0.5)
        self.assertLess(panel._feed.scale[1], 0.5)
        # World scale is local scale * camera.ui scale (20); fullscreen is 20.
        self.assertLess(panel._feed.world_scale[0], 10.0)
        self.assertLess(panel._feed.world_scale[1], 10.0)
        # Anchored in the bottom-left quadrant.
        self.assertLess(panel._feed.position[0], 0.0)
        self.assertLess(panel._feed.position[1], 0.0)
        panel.update(None, None, False)
        self.assertFalse(panel._feed.visible)


if __name__ == '__main__':
    unittest.main(verbosity=2)
