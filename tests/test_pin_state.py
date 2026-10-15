"""Regression tests for pin counting and rack resets.

The bug these cover: the pin simulation stopped the moment the *ball* finished
a roll, so a pin that was still toppling froze below the knockdown angle. It
was not counted, and the sweep then re-stood it for the next ball - so pins
knocked down by the first throw reappeared for the second and could be knocked
down (and counted) a second time. The frame could record more pins than the
rack ever held (the reported "8 + 2 = 12" family of symptoms).

What is checked here:

* the exact 8-pins-then-2-pins frame, driven through the real game loop;
* that a pin still falling when the ball stops keeps falling and is counted;
* that a swept pin can never be counted again, however it moves;
* that the physical rack and the scoring engine always agree;
* strike / spare / tenth-frame rack resets.

Run with:
    python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ursina import Ursina, application, time, window, color

import config
import main as game_main
from input.mouse_input import ThrowData

FIXED_DT = 1.0 / 60.0
MAX_FRAMES = 9000


class RackHarness:
    """Drives the real Game one fixed timestep at a time (offscreen)."""

    def __init__(self):
        application.calculate_dt = False
        self.app = Ursina(
            title='Hells Balls (pin state tests)', size=(1280, 720),
            window_type='offscreen', development_mode=True,
            show_ursina_splash=False, icon='',
        )
        window.color = color.rgb32(*config.WINDOW_BACKGROUND)
        self.game = game_main.Game()
        game_main.game = self.game
        game_main.app = self.app

    # ------------------------------------------------------------- stepping
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
                return True
        raise AssertionError(
            f'game did not reach the expected state within {max_frames} frames '
            f'(state={self.game.state!r})')

    # ------------------------------------------------------------- gameplay
    def physical_standing(self):
        return sum(1 for pin in self.game.pins.pins if pin.physics.standing)

    def launch(self, speed=7.0, lateral=0.0):
        self.game.input_source._pending = ThrowData(
            speed=speed, lateral_position=lateral)
        self.run_until(lambda: self.game.state != 'ready')

    def roll_until_counted(self):
        """Let the current roll finish, settle and be counted."""
        self.game.ball.physics.rolling = False
        self.game.ball.finished = True
        self.run_until(lambda: self.game.state == 'result')

    def force_roll(self, count):
        """Knock over exactly ``count`` standing pins through the real loop.

        The pins are marked as they fall *after* the roll has started, which is
        what happens in play: a pin that is already down when a roll begins is
        never counted by that roll (see ``PinRack.begin_roll``).
        """
        assert self.game.state == 'ready', self.game.state
        standing = [pin for pin in self.game.pins.pins if pin.physics.standing]
        assert 0 <= count <= len(standing), (count, len(standing))
        self.launch()
        for pin in standing[:count]:
            pin.physics.hit = True
            pin.physics.down = True
            pin.physics.angle = 1.6
        self.roll_until_counted()
        counted = self.game.knockdowns
        self.run_until(lambda: self.game.state in ('ready', 'game_over'))
        return counted


def make_harness():
    try:
        return RackHarness()
    except Exception as exc:                     # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')


class RackTestCase(unittest.TestCase):
    harness = None

    @classmethod
    def setUpClass(cls):
        cls.harness = make_harness()

    def setUp(self):
        self.harness.game.new_game()


# ---------------------------------------------------------------------------
# The reported scenario
# ---------------------------------------------------------------------------
class TestEightThenTwo(RackTestCase):
    """First ball takes 8, second ball takes the last 2: a 10-pin frame."""

    def test_frame_records_ten_pins(self):
        h = self.harness
        first = h.force_roll(8)
        self.assertEqual(first, 8)
        self.assertEqual(h.physical_standing(), 2)
        self.assertEqual(h.game.score.standing_pins(), 2)

        second = h.force_roll(2)
        self.assertEqual(second, 2)
        self.assertEqual(h.game.score.frame_rolls(1), [8, 2])
        self.assertEqual(sum(h.game.score.frame_rolls(1)), 10)
        self.assertEqual([pin.physics.standing
                          for pin in h.game.pins.pins].count(True), 10)

    def test_second_throw_only_offers_survivors(self):
        h = self.harness
        h.force_roll(8)
        standing = [pin for pin in h.game.pins.pins if pin.physics.standing]
        self.assertEqual(len(standing), 2)
        swept = [pin for pin in h.game.pins.pins if pin.physics.removed]
        self.assertEqual(len(swept), 8)
        # Swept pins are hidden and are not targets any more.
        self.assertTrue(all(not pin.visible for pin in swept))
        self.assertFalse(any(pin.physics.standing for pin in swept))
        # ...and the survivors are upright and in play.
        self.assertTrue(all(pin.visible for pin in standing))
        self.assertTrue(all(not pin.physics.removed for pin in standing))

    def test_swept_pin_cannot_be_counted_again(self):
        h = self.harness
        h.force_roll(8)
        swept = [pin for pin in h.game.pins.pins if pin.physics.removed]
        self.assertTrue(swept)
        # Move a swept pin into the rack, tip it and let the ball hit it: the
        # roll must still not count it.
        victim = swept[0]
        victim.physics.shift((0.4, 0.0, -0.4))
        victim.physics.angle = 1.55
        h.game.pins.begin_roll()
        self.assertEqual(h.game.pins.knockdown_count(), 0)
        victim.physics.apply_impulse((2.0, 0.0, 2.0),
                                     victim.physics.contact_point((0.7, 0.0, 0.7)))
        victim.physics.step(1.0 / 60.0)
        self.assertEqual(h.game.pins.knockdown_count(), 0)

    def test_each_pin_counts_at_most_once_per_roll(self):
        h = self.harness
        h.game.pins.begin_roll()
        pin = h.game.pins.pins[0]
        pin.physics.hit = True
        pin.physics.apply_impulse((4.0, 0.0, 0.0), pin.physics.contact_point((1, 0, 0)))
        for _ in range(30):
            h.game.pins.pins[0].physics.step(1.0 / 60.0)
        self.assertEqual(h.game.pins.knockdown_count(), 1)
        # Bouncing the pin about must not add to the count.
        for _ in range(10):
            pin.physics.apply_impulse((3.0, 0.0, 3.0),
                                      pin.physics.contact_point((1, 0, 1)))
            pin.physics.step(1.0 / 60.0)
        self.assertEqual(h.game.pins.knockdown_count(), 1)


# ---------------------------------------------------------------------------
# The root cause: pins frozen mid-fall
# ---------------------------------------------------------------------------
class TestFallingPinsAreNotFrozen(RackTestCase):
    """A pin still toppling when the ball stops must finish its fall."""

    def test_pin_keeps_falling_after_the_ball_finishes(self):
        h = self.harness
        h.game.pins.begin_roll()
        pin = h.game.pins.pins[0]
        pin.physics.hit = True
        # A gentle nudge: the pin is barely tipped when the ball ends.
        pin.physics.apply_impulse((0.5, 0.0, 0.0),
                                  pin.physics.contact_point((1.0, 0.0, 0.0)))
        self.assertLess(pin.physics.angle, 1.0)
        self.assertFalse(pin.physics.down)

        h.launch()
        h.roll_until_counted()
        # The count happens only after the deck is quiet, so the pin finished
        # falling and was counted instead of being re-stood.
        self.assertTrue(pin.physics.down)
        self.assertEqual(h.game.knockdowns, 1)
        self.assertEqual(h.game.score.rolls, [1])
        h.run_until(lambda: h.game.state in ('ready', 'game_over'))
        self.assertTrue(pin.physics.removed)
        self.assertFalse(pin.visible)
        self.assertEqual(h.game.score.standing_pins(), 9)

    def test_settle_advances_the_deck_without_the_ball(self):
        h = self.harness
        rack = h.game.pins
        rack.reset()
        pin = rack.pins[3]
        pin.physics.hit = True
        pin.physics.apply_impulse((1.2, 0.0, 0.2),
                                 pin.physics.contact_point((1.0, 0.0, 0.0)))
        angle_before = pin.physics.angle
        self.assertLess(angle_before, 1.0)
        self.assertFalse(rack.deck_quiet())
        for _ in range(240):
            rack.settle(1.0 / 60.0)
            if rack.deck_quiet():
                break
        self.assertTrue(rack.deck_quiet())
        self.assertGreater(pin.physics.angle, angle_before)
        self.assertTrue(pin.physics.down)


# ---------------------------------------------------------------------------
# Rack / scorer agreement across frames
# ---------------------------------------------------------------------------
class TestRackScorerConsistency(RackTestCase):
    SCRIPT = [8, 2, 10, 7, 3, 9, 1, 0, 10, 10, 4, 6, 10, 10, 10]

    def test_rack_matches_the_scorer_after_every_roll(self):
        h = self.harness
        for index, count in enumerate(self.SCRIPT):
            if h.game.state != 'ready':
                break
            expected = h.game.score.standing_pins()
            self.assertEqual(h.physical_standing(), expected,
                             f'before roll {index}: {h.game.score.rolls}')
            counted = h.force_roll(count)
            self.assertEqual(counted, count, f'roll {index}')
            self.assertLessEqual(counted, expected, f'roll {index}')
            # No frame may ever hold more than ten pins of rolls.
            for frame in range(1, h.game.score.NUM_FRAMES + 1):
                rolls = h.game.score.frame_rolls(frame)
                self.assertLessEqual(sum(rolls), 10,
                                     f'frame {frame} recorded {rolls}')
                self.assertTrue(all(0 <= roll <= 10 for roll in rolls))


class TestRackResets(RackTestCase):
    def test_strike_resets_the_whole_rack_in_a_new_frame(self):
        h = self.harness
        h.force_roll(10)
        self.assertEqual(h.physical_standing(), 10)
        self.assertEqual(h.game.score.current_frame_number, 2)
        self.assertTrue(all(not pin.physics.removed
                            for pin in h.game.pins.pins))
        self.assertEqual(h.physical_standing(), h.game.score.standing_pins())

    def test_spare_resets_the_rack_for_the_next_frame(self):
        h = self.harness
        h.force_roll(7)
        self.assertEqual(h.physical_standing(), 3)
        h.force_roll(3)
        self.assertEqual(h.game.score.frame_marks(1), ['7', '/'])
        self.assertEqual(h.physical_standing(), 10)
        self.assertEqual(h.game.score.current_frame_number, 2)

    def test_open_frame_keeps_only_the_survivors(self):
        h = self.harness
        h.force_roll(6)
        h.force_roll(2)
        self.assertEqual(h.game.score.frame_rolls(1), [6, 2])
        self.assertEqual(h.game.score.current_frame_number, 2)
        self.assertEqual(h.physical_standing(), 10)

    def test_tenth_frame_resets_after_strike_and_spare(self):
        h = self.harness
        for _ in range(9):
            h.force_roll(0)
            h.force_roll(0)
        self.assertEqual(h.game.score.current_frame_number, 10)

        h.force_roll(10)                       # a strike resets the rack
        self.assertEqual(h.physical_standing(), 10)
        self.assertEqual(h.game.score.standing_pins(), 10)
        h.force_roll(7)                        # seven down, three standing
        self.assertEqual(h.physical_standing(), 3)
        h.force_roll(3)                        # spare: the rack resets again
        self.assertEqual(h.game.score.frame_score(10), 20)
        self.assertTrue(h.game.score.is_complete)
        self.assertEqual(h.game.state, 'game_over')
        # The game is over, so the deck is left as it was: no next ball.
        self.assertEqual(h.physical_standing(), 0)

    def test_tenth_frame_spare_resets_the_rack_for_the_bonus_ball(self):
        h = self.harness
        for _ in range(9):
            h.force_roll(0)
            h.force_roll(0)
        h.force_roll(4)
        self.assertEqual(h.physical_standing(), 6)
        h.force_roll(6)                        # spare: bonus ball on a full rack
        self.assertFalse(h.game.score.is_complete)
        self.assertEqual(h.game.state, 'ready')
        self.assertEqual(h.physical_standing(), 10)
        self.assertEqual(h.game.score.standing_pins(), 10)
        h.force_roll(10)
        self.assertTrue(h.game.score.is_complete)
        self.assertEqual(h.game.score.frame_score(10), 20)

    def test_frame_count_never_exceeds_ten_after_a_miss(self):
        """8 then 0 must leave a new frame with a full rack."""
        h = self.harness
        h.force_roll(8)
        h.force_roll(0)
        self.assertEqual(h.game.score.frame_rolls(1), [8, 0])
        self.assertEqual(h.physical_standing(), 10)
        self.assertEqual(h.game.score.standing_pins(), 10)


if __name__ == '__main__':
    unittest.main(verbosity=2)
