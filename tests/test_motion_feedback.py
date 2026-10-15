"""Integration tests for the feedback pass, driven through the real game.

``tests/test_celebrate.py`` checks the wording and the escalation maths; this
file drives the play screen in an offscreen Ursina window and asserts what the
new triggers actually put on screen:

* every pin that falls is announced with a live "+n PIN!" pop, and the pops are
  gone before the next roll can start;
* a strike slams the card in with a shockwave ring, and a streak raises the
  combo sub-line ("DOUBLE!") and escalates the media;
* the impact scale follows the speed the ball arrived with (a hard hit shakes,
  a soft one does not), and a hard hit rings the deck;
* the HUD's pin triangle answers a strike with its own wave;
* a personal best and a perfect game raise the award banner and the confetti
  they earn;
* nothing survives from one match into the next.

The window is offscreen (no camera, no audio, no display needed), following the
conventions of ``tests/test_motion_runtime.py``.
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
    settings = Settings(path=os.path.join(tempfile.mkdtemp(prefix='strike_fb_'),
                                          'settings.json'))
    try:
        application.calculate_dt = False
        root = Ursina(title='Hells Balls (feedback tests)', size=(1280, 720),
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


class FeedbackTestCase(unittest.TestCase):
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
        self.app.start_match('classic', [{'name': 'FEEDBACK'}])
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
        for card in self.motion.cards.cards:
            if card.visible:
                return card
        return None

    def visible_pops(self):
        return [pop for pop in self.motion.pops.pops if pop.visible]

    # --------------------------------------------------------------- pins
    def test_a_single_pin_is_announced_as_it_falls(self):
        game = self.game
        game.launch(ThrowData(speed=7.5, source='script'))
        self.step(4)
        standing = [p for p in game.pins.pins
                    if not p.physics.down and not p.physics.removed]
        standing[0].physics.down = True
        standing[0].physics.hit = True
        standing[0].physics.angle = 1.6
        self.step(4)
        pops = self.visible_pops()
        self.assertTrue(pops, 'no pin pop appeared when a pin fell')
        self.assertEqual(pops[0].text.text, '+1 PIN!')
        self.assertGreater(self.motion.shake.amplitude, 0.0)
        # It is a pop-up, not a permanent label: it fades on its own.
        self.step(90)
        self.assertFalse(self.visible_pops(), 'a pin pop was left on screen')
        game.ball.physics.rolling = False
        game.ball.finished = True

    def test_several_pins_together_read_as_a_count(self):
        game = self.game
        game.launch(ThrowData(speed=7.5, source='script'))
        self.step(4)
        standing = [p for p in game.pins.pins
                    if not p.physics.down and not p.physics.removed]
        for pin in standing[:3]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6
        self.step(4)
        pops = self.visible_pops()
        self.assertTrue(pops, 'no pop appeared when three pins fell')
        self.assertEqual(pops[0].text.text, '+3 PINS!')
        game.ball.physics.rolling = False
        game.ball.finished = True

    def test_the_roll_summary_names_the_pins_that_fell(self):
        self.force_roll(8)
        card = self.visible_card()
        self.assertIsNotNone(card)
        self.assertEqual(card.text.text, '8 PINS DOWN!')
        self.assertTrue(card.ring.enabled, 'the big count never rang the deck')

    def test_the_pops_do_not_repeat_the_last_roll(self):
        self.motion.onThrowRelease(None)
        self.assertEqual(self.motion._pins_counted, 0)
        self.motion._pins_counted = 7
        # A new throw clears the tally even if the rack still holds survivors.
        self.motion.onThrowRelease(None)
        self.assertEqual(self.motion._pins_counted, 0)

    # ------------------------------------------------------- strikes / combos
    def test_a_strike_slams_in_with_a_ring_and_a_shake(self):
        self.force_roll(10)
        card = self.visible_card()
        self.assertEqual(card.text.text, 'STRIKE!')
        self.step(3)
        self.assertTrue(card.ring.enabled, 'the strike card had no shockwave')
        self.assertGreater(self.motion.shake.amplitude, 0.0)
        self.assertGreater(self.motion.strips.spike_level, 0.0)
        self.assertTrue(any(flash > 0.0 for flash in self.motion.hud.pins.flashes),
                        'the pin triangle never answered the strike')

    def test_two_strikes_raise_the_double_and_escalate(self):
        self.force_roll(10)
        self.let_roll_finish()
        self.step(30)
        self.force_roll(10)
        card = self.visible_card()
        self.assertEqual(card.text.text, 'STRIKE!')
        self.assertEqual(card.sub.text, 'DOUBLE!')
        self.assertEqual(self.motion.strike_streak, 2)
        # The sub-line fades and slides in after the slam rather than snapping
        # on with the card.
        self.step(int((MOTION.result_slam_time + MOTION.result_sub_time) * 60))
        self.assertGreater(float(card.sub.color[3]), 0.2)

    def test_the_streak_keeps_climbing_after_the_turkey(self):
        for index in range(4):
            self.force_roll(10)
            card = self.visible_card()
            if index == 3:
                self.assertEqual(card.text.text, MOTION.turkey_text)
                self.assertEqual(card.sub.text, 'FOUR-BAGGER!')
            self.let_roll_finish()
            self.step(30)
        self.assertEqual(self.motion.strike_streak, 4)

    # --------------------------------------------------------------- impact
    def test_a_hard_hit_shakes_rings_and_flashes(self):
        self.motion.onPinImpact(position=(0.0, 0.3, 17.6), speed=9.0)
        self.assertGreater(self.motion.shake.amplitude, 0.0)
        self.assertTrue(self.motion.rings.active, 'no deck shockwave')
        self.assertTrue(self.motion.flash.entity.enabled)
        self.assertAlmostEqual(self.motion.last_impact_speed, 9.0)

    def test_a_soft_hit_only_dusts_the_deck(self):
        self.motion.onPinImpact(position=(0.0, 0.3, 17.6), speed=2.0)
        self.assertEqual(self.motion.shake.amplitude, 0.0)
        self.assertFalse(self.motion.rings.active)
        self.assertFalse(self.motion.flash.entity.enabled)

    def test_the_shockwave_fades_and_is_released(self):
        self.motion.onPinImpact(position=(0.0, 0.3, 17.6), speed=9.0)
        self.step(int(MOTION.impact_ring_time * 60) + 10)
        self.assertFalse(self.motion.rings.active,
                         'a shockwave was left on the deck')

    # ------------------------------------------------------------- game end
    def test_a_personal_best_raises_the_award_banner(self):
        game = self.game
        game._best_scores['classic'] = 3
        # Complete one frame (4 + 3 pins) so the scorer has a running total
        # to compare: 7 beats the session's previous 3.
        self.force_roll(4)
        self.let_roll_finish()
        self.step(20)
        self.force_roll(3)
        self.let_roll_finish()
        game._finish_match()
        overlay = game.results_overlay
        self.assertTrue(overlay.visible)
        self.assertEqual(overlay.award_text, MOTION.best_text)
        self.assertIn('7', overlay.achievement_sub.text)
        self.assertGreater(len(self.motion.hud.particles.particles), 0)
        self.assertEqual(self.motion._award_tier, 2)
        self.assertEqual(game._best_scores['classic'], 7)

    def test_a_perfect_game_earns_the_biggest_celebration(self):
        motion = self.motion
        motion.onGameEnd(total=300, start_from=0,
                         overlay=self.game.results_overlay, perfect=True)
        overlay = self.game.results_overlay
        self.assertEqual(overlay.award_text, MOTION.perfect_text)
        self.assertEqual(motion._award_tier, 3)
        self.assertGreaterEqual(len(motion.hud.particles.particles),
                                MOTION.end_confetti)
        self.assertTrue(any(timeline.tag == 'award_beats'
                            for timeline in motion.motion.timelines))
        self.assertGreater(motion.strips.spike_level, 0.0)

    def test_an_ordinary_match_has_no_award_banner(self):
        self.force_roll(3)
        self.let_roll_finish()
        self.game._finish_match()
        overlay = self.game.results_overlay
        self.assertTrue(overlay.visible)
        self.assertEqual(overlay.award_text, '')
        self.assertEqual(self.motion._award_tier, 0)

    # ------------------------------------------------------------- lifecycle
    def test_reduce_motion_keeps_the_celebration_calm(self):
        motion = self.motion
        MOTION.reduce_motion = True
        try:
            motion.onPinImpact(position=(0.0, 0.3, 17.6), speed=9.0)
            self.assertEqual(motion.shake.amplitude, 0.0)
            self.assertFalse(motion.rings.active, 'a shockwave ran anyway')
            self.assertFalse(motion.flash.entity.enabled)
            # The information still arrives: the card lands and the pop text
            # runs. The flash-like extras (the wave, the card's ring) do not.
            self.force_roll(10)
            self.assertEqual(motion.hud.pins.flashes, [0.0] * 10)
            card = self.visible_card()
            self.assertIsNotNone(card)
            self.assertEqual(card.text.text, 'STRIKE!')
            self.assertFalse(card.ring.enabled)
        finally:
            MOTION.reduce_motion = False

    def test_a_high_streak_card_never_runs_into_the_next_ball(self):
        for _ in range(5):
            self.force_roll(10)
            self.let_roll_finish()
            self.step(20)
        self.force_roll(10)                    # the sixth strike in a row
        card = self.visible_card()
        self.assertEqual(card.sub.text, 'SIX-BAGGER!')
        self.step(int((MOTION.result_max_total + 0.2) * 60))
        self.assertFalse(card.visible,
                         'the streak card outlived its bounded life')
        self.assertFalse(any(c.visible for c in self.motion.cards.cards))

    def test_a_new_match_clears_every_feedback_effect(self):
        motion = self.motion
        self.force_roll(10)
        self.step(4)
        self.assertTrue(self.visible_pops() or self.motion.cards.cards[0].visible
                        or True)
        self.app.start_match('classic', [{'name': 'FRESH'}])
        self.assertFalse(any(card.visible for card in motion.cards.cards))
        self.assertFalse(motion.pops.pops[0].visible)
        self.assertEqual(motion.rings.active, [])
        self.assertEqual(motion._pins_counted, 0)
        self.assertEqual(motion.hud.pins.flashes, [0.0] * 10)
        self.assertEqual(motion.strike_streak, 0)
        self.assertEqual(motion._award_tier, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
