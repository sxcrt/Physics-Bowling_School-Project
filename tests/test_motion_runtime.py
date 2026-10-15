"""Integration tests for the animation system, driven through the real game.

Where ``tests/test_motion.py`` checks the maths, this file drives the play
screen in an offscreen Ursina window and asserts what each *trigger* did:

* ``onMatchStart`` reveals the scoreboard and the pin rack;
* a mouse drag fills the power meter and the aim guide flows;
* ``onThrowRelease`` flashes the meter out and fades the guide;
* ``onPinsResolved('strike')`` shows the result card, shakes the camera and
  spikes the lane lights;
* ``onScoreEntry`` counts the total up instead of snapping;
* ``onGameEnd`` expands the results panel and counts the final score;
* reduce motion switches shake, flashes and pulses off.

The window is offscreen (no camera, no audio, no display needed), following the
conventions of ``tests/test_ui_interactions.py``.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ursina import Ursina, application, color, time, window    # noqa: E402

import config                                                  # noqa: E402
from game.settings import Settings                             # noqa: E402
from input.mouse_input import MouseInput, ThrowData            # noqa: E402
from motion import MOTION                                      # noqa: E402
from ui.app import App                                         # noqa: E402


def make_app():
    settings = Settings(path=os.path.join(tempfile.mkdtemp(prefix='strike_mo_'),
                                          'settings.json'))
    try:
        application.calculate_dt = False
        root = Ursina(title='Hells Balls (motion tests)', size=(1280, 720),
                      window_type='offscreen', development_mode=True,
                      show_ursina_splash=False, icon='')
    except Exception as exc:                     # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')
    window.color = color.rgb32(*config.WINDOW_BACKGROUND)
    held = {'down': False, 'x': 0.0, 'y': 0.0}
    mouse = MouseInput(pointer=lambda: (held['x'], held['y']),
                       button=lambda: held['down'])
    app = App(settings=settings, audio=None,
              inputs={'mouse': mouse, 'webcam': None})
    return root, app, held


class MotionTestCase(unittest.TestCase):
    """One shared app: creating an Ursina window is the slow part."""

    app_root = None
    app = None
    held = None

    @classmethod
    def setUpClass(cls):
        cls.app_root, cls.app, cls.held = make_app()

    def setUp(self):
        MOTION.reduce_motion = False
        MOTION.particle_budget = 1.0
        self.held['down'] = False
        self.held['x'] = 0.0
        self.held['y'] = 0.0
        self.app.start_match('classic', [{'name': 'MOTION'}])
        self.game = self.app.game
        self.motion = self.game.motion
        self.step(2)

    # ------------------------------------------------------------- helpers
    def step(self, frames=1):
        for _ in range(frames):
            time.dt = 1.0 / 60.0
            time.dt_unscaled = 1.0 / 60.0
            self.app.update()
            self.app_root._update()

    def force_roll(self, count):
        """Bowl a scripted roll that knocks ``count`` pins down."""
        game = self.game
        game.launch(ThrowData(speed=7.5, source='script'))
        self.step(2)
        standing = [p for p in game.pins.pins
                    if not p.physics.down and not p.physics.removed]
        for pin in standing[:count]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6
        game.ball.physics.rolling = False
        game.ball.finished = True
        for _ in range(600):
            self.step(1)
            if game.state in ('result', 'game_over'):
                break

    def let_roll_finish(self):
        game = self.game
        for _ in range(600):
            self.step(1)
            if game.state in ('ready', 'handoff', 'game_over'):
                break
        if game.state == 'handoff':
            game.on_key('enter')
            for _ in range(600):
                self.step(1)
                if game.state == 'ready':
                    break

    def visible_card(self):
        """The result card currently on screen (the pool round-robins)."""
        for card in self.motion.cards.cards:
            if card.visible:
                return card
        return None


class TestScoreboardMotion(MotionTestCase):
    def test_the_board_reveals_staggered_and_marks_the_active_frame(self):
        board = self.motion.hud.scoreboard
        self.assertTrue(board.revealed)
        self.step(60)
        for index in range(10):
            transform = board.cell_transform(index)
            self.assertAlmostEqual(transform['alpha'], 1.0, places=2)
            self.assertAlmostEqual(transform['dy'], 0.0, places=3)
        self.assertEqual(board.active_index, 0)
        self.assertGreater(board.cell_transform(0)['glow'], 0.0)

    def test_a_roll_counts_the_total_up_instead_of_snapping(self):
        game = self.game
        self.step(20)
        # A 7-pin first ball, then a 2-pin second: the frame's total appears.
        self.force_roll(7)
        self.let_roll_finish()
        self.step(20)
        self.force_roll(2)
        # The total counts up: some frame of the animation shows a value
        # between the old and the new one, and it ends on the real total.
        seen = []
        for _ in range(45):
            self.step(1)
            text = game.hud.total_score.text.strip()
            if text.isdigit():
                seen.append(int(text))
        self.assertTrue(seen, 'the top-right total never showed a number')
        self.assertEqual(seen[-1], game.score.current_score)
        self.assertIn(seen[-1], (7, 9))
        self.assertTrue(any(0 < value < seen[-1] for value in seen),
                        f'the total snapped instead of counting: {seen}')


class TestHudMotion(MotionTestCase):
    def test_the_power_meter_fills_with_the_drag_and_flashes_on_release(self):
        meter = self.motion.hud.meter
        self.held['down'] = True
        self.held['y'] = -0.25
        self.step(4)
        for _ in range(8):                        # the backswing
            self.held['y'] -= 0.03
            self.step(1)
        for _ in range(20):                       # the forward stroke
            self.held['y'] += 0.05
            self.step(1)
        self.assertTrue(meter.visible)
        self.assertGreater(meter.power, 0.2)
        self.assertGreater(meter.target_power, meter.power - 0.35)
        self.held['down'] = False
        self.step(4)
        self.assertGreater(meter.flash, 0.0)      # the white release flash
        self.step(40)
        self.assertFalse(meter.visible)

    def test_the_prompt_crossfades_and_hides_while_rolling(self):
        prompt = self.motion.hud.prompt
        self.step(30)
        self.assertEqual(prompt._text, 'Ready to throw')
        # While the ball is rolling the prompt fades out entirely.
        self.game.launch(ThrowData(speed=7.0, source='script'))
        self.step(30)
        self.assertLess(prompt.opacity, 0.2)

    def test_the_aim_guide_marches_forward_and_fades_on_the_throw(self):
        motion = self.motion
        self.step(20)
        visible = [d for d in motion.guide.dashes if d.visible]
        self.assertGreater(len(visible), 2)
        first = [tuple(round(v, 4) for v in dash.position) for dash in visible]
        self.step(6)
        second = [tuple(round(v, 4) for v in dash.position)
                  for dash in motion.guide.dashes if dash.visible]
        self.assertNotEqual(first, second, 'the dashes never marched')
        # Releasing fades the guide out over 150 ms rather than popping it.
        self.game.launch(ThrowData(speed=7.0, source='script'))
        self.step(3)
        self.assertGreater(motion.guide.fade, 0.0)
        self.step(12)
        self.assertFalse(motion.guide.visible)

    def test_the_duplicate_ball_hides_while_the_player_holds_one(self):
        game = self.game
        self.step(10)
        self.assertTrue(game.ball.visible)
        self.assertFalse(game._active_avatar.ball.visible)
        self.held['down'] = True
        self.step(4)
        self.assertFalse(game.ball.visible)
        self.assertTrue(game._active_avatar.ball.visible)
        self.held['down'] = False
        self.step(4)
        self.assertTrue(game.ball.visible)
        self.assertFalse(game._active_avatar.ball.visible)

    def test_the_pin_icons_dim_and_pop_back_on_a_reset(self):
        pins = self.motion.hud.pins
        self.step(10)
        self.assertEqual(len(pins.icons), 10)
        # Drive the icon state directly (the HUD feeds it the scorer's count
        # every frame, which would restore it): knocked pins dim and shrink.
        pins.set_standing(4)
        for _ in range(20):
            self.motion.motion.update(1.0 / 60.0)
        knocked = sum(1 for value in pins.values if value < 0.1)
        self.assertEqual(knocked, 6)
        # A reset pops them back in a staggered wave, back row first.
        pins.set_standing(10)
        peaked = False
        for _ in range(30):
            self.motion.motion.update(1.0 / 60.0)
            peaked = peaked or max(pins.pops) > 1.1
        self.assertTrue(peaked, 'the reset wave never popped the icons')


class TestResultMoments(MotionTestCase):
    def test_a_strike_shows_the_card_shakes_and_spikes_the_lights(self):
        motion = self.motion
        self.force_roll(10)
        self.assertEqual(self.game.last_result['pins'], 10)
        card = self.visible_card()
        self.assertIsNotNone(card)
        self.assertEqual(card.text.text, 'STRIKE!')
        self.assertGreater(motion.shake.amplitude, 0.0)
        self.assertGreater(motion.strips.spike_level, 0.0)
        self.assertGreater(motion.pin_glow.surge, 0.0)
        self.assertEqual(motion.slow_motion_scale(), MOTION.slow_motion_scale)
        # The tenth-frame celebration is not part of a first-frame strike.
        self.assertIsNone(motion.hud.scoreboard.final_index)

    def test_a_gutter_ball_has_no_flash_but_a_vignette(self):
        motion = self.motion
        self.force_roll(0)
        card = self.visible_card()
        self.assertIsNotNone(card)
        self.assertEqual(card.text.text, 'GUTTER')
        self.assertFalse(motion.flash.entity.enabled)
        self.assertTrue(motion.vignette.entity.enabled)
        self.assertEqual(motion.shake.amplitude, 0.0)

    def test_three_strikes_escalate_to_a_turkey(self):
        motion = self.motion
        for index in range(3):
            self.force_roll(10)
            if index == 2:
                card = self.visible_card()
                self.assertEqual(card.text.text, MOTION.turkey_text)
                self.assertTrue(motion.strips.sequence)
            self.let_roll_finish()
            self.step(30)

    def test_a_frame_advance_sweeps_and_the_tenth_frame_shimmers(self):
        motion = self.motion
        motion.onFrameAdvance(frame=2, previous=1)
        self.assertTrue(motion.sweep.entity.enabled)
        self.step(40)
        motion.onFrameAdvance(frame=10, previous=9)
        self.step(10)
        self.assertEqual(motion.hud.scoreboard.final_index, 9)
        self.assertTrue(motion.sweep.entity.enabled)   # the gold shimmer

    def test_reduce_motion_switches_shake_flashes_and_pulses_off(self):
        motion = self.motion
        MOTION.reduce_motion = True
        try:
            self.force_roll(10)
            self.assertEqual(motion.shake.amplitude, 0.0)
            self.assertFalse(motion.flash.entity.enabled)
            self.assertEqual(motion.strips.spike_level, 0.0)
            self.assertEqual(motion.pin_glow.surge, 0.0)
            board = motion.hud.scoreboard
            self.step(20)
            transform = board.cell_transform(board.active_index)
            # The highlight holds steady instead of breathing.
            self.assertGreaterEqual(transform['glow'], MOTION.frame_pulse_max)
            first = transform['glow']
            self.step(20)
            self.assertAlmostEqual(board.cell_transform(
                board.active_index)['glow'], first, places=3)
        finally:
            MOTION.reduce_motion = False


class TestTransitionsAndEnd(MotionTestCase):
    def test_the_pin_reset_sweeps_and_drops_the_rack_back_in(self):
        game = self.game
        motion = self.motion
        self.step(5)
        motion.onPinReset(standing=10, full=True)
        lifted = [pin.fx_offset for pin in game.pins.pins]
        self.assertTrue(any(value > 0.1 for value in lifted),
                        'the rack was not lifted for the drop-in')
        self.assertTrue(motion.racks.bar.visible, 'the sweeper never appeared')
        for _ in range(180):
            self.step(1)
        self.assertTrue(all(abs(pin.fx_offset) < 0.01
                            for pin in game.pins.pins))
        self.assertTrue(all(pin.fx_scale > 0.99 for pin in game.pins.pins))
        self.assertFalse(motion.racks.bar.visible)
        self.assertTrue(all(pin.visible for pin in game.pins.pins))

    def test_pausing_dims_the_background_and_scales_the_panel_in(self):
        motion = self.motion
        self.step(10)
        self.game.pause()
        self.step(2)
        self.assertTrue(motion.vignette.entity.enabled)
        panel = self.game.pause_overlay.panel
        entering = float(panel.scale[0])
        self.step(40)
        settled = float(panel.scale[0])
        self.assertLess(entering, settled)
        self.game.resume()
        self.step(2)
        self.assertFalse(motion.vignette.entity.enabled)

    def test_the_physics_panel_slides_in_and_out(self):
        motion = self.motion
        self.step(10)
        self.game.toggle_physics_panel()
        self.step(4)
        self.assertGreater(motion.hud.physics_offset, 0.0)
        self.game.toggle_physics_panel()
        self.step(40)
        self.assertLess(motion.hud.physics_offset, 0.05)

    def test_the_game_end_expands_the_panel_and_counts_the_final_score(self):
        game = self.game
        self.force_roll(7)
        self.let_roll_finish()
        game._finish_match()
        overlay = game.results_overlay
        self.assertTrue(overlay.visible)
        self.step(2)
        panel = overlay.panel
        self.assertLess(float(panel.scale[0]), 0.74)     # mid-expansion
        seen = []
        for _ in range(160):
            self.step(1)
            text = overlay.total_score.text.strip()
            if text.isdigit():
                seen.append(int(text))
        self.assertTrue(seen)
        self.assertEqual(seen[-1], game.match.current_player.bowling.current_score)
        self.assertGreaterEqual(float(panel.scale[0]), 0.74)


if __name__ == '__main__':
    unittest.main(verbosity=2)
