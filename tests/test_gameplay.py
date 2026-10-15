"""Offscreen integration tests for the full game loop.

These build the real ``Game`` inside an offscreen Ursina window and drive the
loop with a fixed timestep, so the state machine, pin rack, roll recording and
game-over handling are exercised without a visible window.

Run with:
    python -m unittest discover -s tests
or:
    python tests/test_gameplay.py
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
MAX_FRAMES = 8000


class Harness:
    """Drives the real Game one fixed timestep at a time."""

    def __init__(self):
        application.calculate_dt = False        # we control time.dt ourselves
        self.app = Ursina(
            title='Hells Balls (test)', size=(1280, 720),
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
                return
        raise AssertionError(
            f'game did not reach the expected state within {max_frames} frames '
            f'(state={self.game.state!r})')

    # ------------------------------------------------------------ gameplay
    def standing_pins(self):
        return [p for p in self.game.pins.pins
                if not p.physics.down and not p.physics.removed]

    def launch(self, speed=7.0, lateral=0.0, spin=0.0):
        """Queue a throw through the input layer and wait for launch."""
        self.game.input_source._pending = ThrowData(
            lateral_position=lateral, speed=speed, spin_omega=spin)
        self.run_until(lambda: self.game.state != 'ready')

    def force_roll(self, count):
        """Drive one roll that knocks over exactly ``count`` standing pins.

        Bypasses ball physics so outcomes are deterministic, but runs the real
        settling/result/rack-reset state machine between rolls. The pins are
        marked as they fall *after* the roll has started, because a roll only
        counts pins that go down during it (a pin already down when the roll
        begins is excluded by ``PinRack.begin_roll``).
        """
        assert self.game.state == 'ready', self.game.state
        standing = self.standing_pins()
        assert 0 <= count <= len(standing), (count, len(standing))
        self.launch()
        for pin in standing[:count]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6
        self.game.ball.physics.rolling = False
        self.game.ball.finished = True
        self.run_until(lambda: self.game.state == 'result')
        self.run_until(lambda: self.game.state in ('ready', 'game_over'))


def make_harness():
    try:
        return Harness()
    except Exception as exc:                     # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')


class GameplayTestCase(unittest.TestCase):
    harness = None

    @classmethod
    def setUpClass(cls):
        cls.harness = make_harness()

    def setUp(self):
        self.harness.game.new_game()


class TestInitialState(GameplayTestCase):
    def test_initial_rack_and_score(self):
        g = self.harness.game
        self.assertEqual(g.state, 'ready')
        self.assertEqual(len(self.harness.standing_pins()), 10)
        self.assertEqual(g.score.rolls, [])
        self.assertFalse(g.score.is_complete)
        self.assertEqual(int(g.ball.physics.z), config.FOUL_LINE_Z)


class TestScriptedGame(GameplayTestCase):
    MIXED_PER_FRAME = [
        [10], [7, 3], [9, 0], [10], [0, 8], [8, 2], [0, 6],
        [10], [10], [10, 8, 1],
    ]
    MIXED_CUMULATIVE = [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]

    def test_full_mixed_game(self):
        for frame_rolls in self.MIXED_PER_FRAME:
            for count in frame_rolls:
                g = self.harness.game
                # The physical rack must match what the scorer expects.
                self.assertEqual(len(self.harness.standing_pins()),
                                 g.score.standing_pins())
                self.harness.force_roll(count)
        g = self.harness.game
        self.assertTrue(g.score.is_complete)
        self.assertEqual(g.state, 'game_over')
        self.assertEqual(g.score.cumulative_scores(), self.MIXED_CUMULATIVE)
        self.assertEqual(g.score.total_score, 167)

    def test_strike_and_spare_transitions(self):
        h = self.harness
        h.force_roll(10)                                  # frame 1 strike
        self.assertEqual(h.game.score.frame_marks(1), ['X'])
        self.assertEqual(len(h.standing_pins()), 10)      # full rack
        h.force_roll(7)                                   # frame 2 first roll
        self.assertEqual(len(h.standing_pins()), 3)
        removed = [p for p in h.game.pins.pins if p.physics.removed]
        self.assertEqual(len(removed), 7)
        self.assertTrue(all(not p.visible for p in removed))
        h.force_roll(3)                                   # spare
        self.assertEqual(h.game.score.frame_marks(2), ['7', '/'])
        self.assertEqual(len(h.standing_pins()), 10)      # full rack again

    def test_tenth_frame_strike_bonus(self):
        h = self.harness
        for _ in range(9):
            h.force_roll(0)
            h.force_roll(0)
        h.force_roll(10)
        self.assertEqual(h.game.state, 'ready')           # two bonus rolls left
        h.force_roll(10)
        self.assertEqual(h.game.state, 'ready')           # one bonus roll left
        h.force_roll(10)
        self.assertEqual(h.game.state, 'game_over')
        self.assertEqual(h.game.score.frame_score(10), 30)
        self.assertEqual(h.game.score.total_score, 30)

    def test_game_over_and_restart(self):
        h = self.harness
        for _ in range(10):
            h.force_roll(0)
            h.force_roll(0)
        self.assertEqual(h.game.state, 'game_over')
        self.assertEqual(h.game.score.total_score, 0)
        h.game.on_key('r')
        self.assertEqual(h.game.state, 'ready')
        self.assertEqual(h.game.score.rolls, [])
        self.assertEqual(len(h.standing_pins()), 10)
        self.assertTrue(all(p.visible for p in h.game.pins.pins))


class TestRealPhysics(GameplayTestCase):
    def test_throw_end_to_end_records_a_roll(self):
        h = self.harness
        h.launch(speed=7.0, lateral=0.0)
        h.run_until(lambda: h.game.state == 'result', max_frames=6000)
        knockdowns = h.game.knockdowns
        self.assertGreaterEqual(knockdowns, 0)
        self.assertLessEqual(knockdowns, 10)
        self.assertEqual(h.game.score.rolls[-1], knockdowns)
        h.run_until(lambda: h.game.state in ('ready', 'game_over'))
        # Rack and ball must be set up consistently for the next roll.
        self.assertEqual(len(h.standing_pins()), h.game.score.standing_pins())
        self.assertEqual(int(h.game.ball.physics.z), config.FOUL_LINE_Z)
        self.assertFalse(h.game.ball.finished)

    def test_weak_throw_does_not_hang(self):
        """A throw slower than ~2.75 m/s stops before reaching the pins."""
        h = self.harness
        h.launch(speed=2.0, lateral=0.0)
        h.run_until(lambda: h.game.state == 'result', max_frames=6000)
        self.assertEqual(h.game.knockdowns, 0)
        h.run_until(lambda: h.game.state in ('ready', 'game_over'))
        self.assertEqual(h.game.score.rolls, [0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
