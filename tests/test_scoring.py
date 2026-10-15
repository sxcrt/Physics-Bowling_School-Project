"""Unit tests for the ten-pin bowling scoring engine (scoring.BowlingGame).

Run with:
    python -m unittest discover -s tests
or:
    python tests/test_scoring.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scoring import BowlingGame


def roll_many(game, sequence):
    for pins in sequence:
        game.record_roll(pins)


class TestStateAndValidation(unittest.TestCase):
    def test_empty_game(self):
        g = BowlingGame()
        self.assertFalse(g.is_complete)
        self.assertEqual(g.current_frame_number, 1)
        self.assertEqual(g.roll_in_frame, 0)
        self.assertEqual(g.standing_pins(), 10)
        self.assertEqual(g.cumulative_scores(), [None] * 10)
        self.assertIsNone(g.total_score)
        self.assertEqual(g.current_score, 0)

    def test_rejects_non_int(self):
        g = BowlingGame()
        with self.assertRaises(TypeError):
            g.record_roll(3.0)
        with self.assertRaises(TypeError):
            g.record_roll("3")
        with self.assertRaises(TypeError):
            g.record_roll(True)          # bool is an int subclass, but illegal

    def test_rejects_out_of_range(self):
        g = BowlingGame()
        with self.assertRaises(ValueError):
            g.record_roll(-1)
        with self.assertRaises(ValueError):
            g.record_roll(11)

    def test_rejects_more_pins_than_standing(self):
        g = BowlingGame()
        g.record_roll(7)
        with self.assertRaises(ValueError):
            g.record_roll(5)             # 7 + 5 = 12 > 10

    def test_rejects_roll_after_complete(self):
        g = BowlingGame()
        roll_many(g, [0] * 20)           # complete gutter game
        self.assertTrue(g.is_complete)
        with self.assertRaises(ValueError):
            g.record_roll(0)

    def test_reset_clears_game(self):
        g = BowlingGame()
        roll_many(g, [10, 3, 4])
        g.reset()
        self.assertEqual(g.rolls, [])
        self.assertEqual(g.current_frame_number, 1)


class TestOpenAndGutterFrames(unittest.TestCase):
    def test_single_open_frame(self):
        g = BowlingGame()
        roll_many(g, [7, 2])
        self.assertEqual(g.frame_score(1), 9)
        self.assertEqual(g.cumulative_scores()[0], 9)
        self.assertEqual(g.current_frame_number, 2)

    def test_gutter_game(self):
        g = BowlingGame()
        roll_many(g, [0] * 20)
        self.assertTrue(g.is_complete)
        self.assertEqual(g.total_score, 0)

    def test_all_nines(self):
        g = BowlingGame()
        roll_many(g, [9, 0] * 10)
        self.assertTrue(g.is_complete)
        self.assertEqual(g.total_score, 90)


class TestStrikeScoring(unittest.TestCase):
    def test_strike_waits_for_two_rolls(self):
        g = BowlingGame()
        g.record_roll(10)
        self.assertIsNone(g.frame_score(1))
        g.record_roll(3)
        self.assertIsNone(g.frame_score(1))      # still one bonus roll short
        g.record_roll(4)
        self.assertEqual(g.frame_score(1), 17)   # 10 + 3 + 4
        self.assertEqual(g.frame_score(2), 7)

    def test_double_strike_bonus(self):
        g = BowlingGame()
        roll_many(g, [10, 10, 10])
        # frame 1 = 10 + 10 + 10 = 30 (resolved), frame 2 still needs a roll.
        self.assertEqual(g.frame_score(1), 30)
        self.assertIsNone(g.frame_score(2))

    def test_perfect_game(self):
        g = BowlingGame()
        roll_many(g, [10] * 12)
        self.assertTrue(g.is_complete)
        self.assertEqual(g.total_score, 300)
        self.assertEqual(g.cumulative_scores(), [30, 60, 90, 120, 150, 180, 210, 240, 270, 300])


class TestSpareScoring(unittest.TestCase):
    def test_spare_waits_for_one_roll(self):
        g = BowlingGame()
        roll_many(g, [7, 3])
        self.assertIsNone(g.frame_score(1))
        g.record_roll(4)
        self.assertEqual(g.frame_score(1), 14)   # 10 + 4

    def test_all_spares(self):
        g = BowlingGame()
        roll_many(g, [5, 5] * 10 + [5])          # 5/ in every frame, then 5
        self.assertTrue(g.is_complete)
        self.assertEqual(g.total_score, 150)


class TestTenthFrame(unittest.TestCase):
    def test_tenth_strike_with_bonus(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [10, 10, 10])
        self.assertTrue(g.is_complete)
        self.assertEqual(g.frame_score(10), 30)
        self.assertEqual(g.total_score, 30)

    def test_tenth_spare_with_bonus(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [7, 3, 5])
        self.assertTrue(g.is_complete)
        self.assertEqual(g.frame_score(10), 15)
        self.assertEqual(g.total_score, 15)

    def test_tenth_open_frame(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [7, 1])
        self.assertTrue(g.is_complete)
        self.assertEqual(g.frame_score(10), 8)
        self.assertEqual(g.total_score, 8)

    def test_tenth_strike_is_not_complete_after_two_rolls(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [10, 10])
        self.assertFalse(g.is_complete)
        g.record_roll(10)
        self.assertTrue(g.is_complete)


class TestStandingPins(unittest.TestCase):
    def test_regular_frame(self):
        g = BowlingGame()
        self.assertEqual(g.standing_pins(), 10)
        g.record_roll(7)
        self.assertEqual(g.standing_pins(), 3)
        g.record_roll(3)                # spare -> new frame
        self.assertEqual(g.standing_pins(), 10)

    def test_final_frame_strike_resets_rack(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9)
        g.record_roll(10)               # 10th frame strike -> fresh rack
        self.assertEqual(g.standing_pins(), 10)
        g.record_roll(7)                # second ball leaves 3 standing
        self.assertEqual(g.standing_pins(), 3)
        g.record_roll(3)                # open finish (no spare)
        self.assertTrue(g.is_complete)
        self.assertIsNone(g.standing_pins())

    def test_final_frame_spare_resets_rack(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9)
        g.record_roll(7)
        g.record_roll(3)                # spare -> fresh rack for the bonus ball
        self.assertEqual(g.standing_pins(), 10)
        g.record_roll(5)
        self.assertTrue(g.is_complete)

    def test_final_frame_open_ends(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [4, 3])
        self.assertTrue(g.is_complete)
        self.assertIsNone(g.standing_pins())


class TestFrameMarks(unittest.TestCase):
    def test_regular_marks(self):
        g = BowlingGame()
        roll_many(g, [10, 7, 3, 9, 0])
        self.assertEqual(g.frame_marks(1), ["X"])
        self.assertEqual(g.frame_marks(2), ["7", "/"])
        self.assertEqual(g.frame_marks(3), ["9", "0"])

    def test_gutter_then_spare(self):
        g = BowlingGame()
        roll_many(g, [0, 10])
        self.assertEqual(g.frame_marks(1), ["0", "/"])

    def test_final_frame_marks(self):
        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [10, 10, 10])
        self.assertEqual(g.frame_marks(10), ["X", "X", "X"])

        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [7, 3, 5])
        self.assertEqual(g.frame_marks(10), ["7", "/", "5"])

        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [10, 0, 10])
        self.assertEqual(g.frame_marks(10), ["X", "0", "/"])

        g = BowlingGame()
        roll_many(g, [0, 0] * 9 + [0, 10, 5])
        self.assertEqual(g.frame_marks(10), ["0", "/", "5"])


class TestCompleteGame(unittest.TestCase):
    # A mixed game, computed by hand:
    #   F1  X          -> 10 + 7 + 3         = 20
    #   F2  7/         -> 10 + 9             = 19
    #   F3  9 0        -> 9                  =  9
    #   F4  X          -> 10 + 0 + 8         = 18
    #   F5  0 8        -> 8                  =  8
    #   F6  8/         -> 10 + 0             = 10
    #   F7  0 6        -> 6                  =  6
    #   F8  X          -> 10 + 10 + 10       = 30
    #   F9  X          -> 10 + 10 + 8        = 28
    #   F10 X 8 1      -> 10 + 8 + 1         = 19
    #                                       total = 167
    MIXED = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]
    MIXED_CUMULATIVE = [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]

    def test_mixed_game_total(self):
        g = BowlingGame()
        roll_many(g, self.MIXED)
        self.assertTrue(g.is_complete)
        self.assertEqual(g.total_score, 167)
        self.assertEqual(g.cumulative_scores(), self.MIXED_CUMULATIVE)

    def test_intermediate_cumulative(self):
        g = BowlingGame()
        for pins in self.MIXED[:4]:        # 10, 7, 3, 9
            g.record_roll(pins)
        # F1 resolved (20), F2 resolved (19), F3 has one roll (9 -> pending).
        self.assertEqual(g.cumulative_scores()[:3], [20, 39, None])
        self.assertEqual(g.current_frame_number, 3)
        self.assertEqual(g.roll_in_frame, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
