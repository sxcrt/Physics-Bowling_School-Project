"""Tests for the shared player/turn/match layer that every mode uses.

Pure Python (no window), so the turn order, scoring style, timer rules and
winner determination of all six modes are checked directly.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game import modes
from game.session import PLAYER_COLORS, Match, Player


def specs(*names, **kwargs):
    bot = kwargs.get('bot', False)
    difficulty = kwargs.get('difficulty', 'medium')
    return [{'name': name, 'is_bot': bot and index > 0,
             'difficulty': difficulty, 'rgb': PLAYER_COLORS[index % 4]}
            for index, name in enumerate(names)]


def play_frame(match, *rolls):
    """Roll a full frame through the match, returning the events."""
    events = []
    for pins in rolls:
        events.append(match.record_roll(pins))
    return events


class TestClassicMatch(unittest.TestCase):
    def setUp(self):
        self.match = Match.create(modes.CLASSIC, specs('SOLO'))

    def test_single_player_keeps_the_turn_until_the_frame_end(self):
        self.assertEqual(self.match.record_roll(4), 'same_player')
        event = self.match.record_roll(3)
        self.assertIn(event, ('round_changed', 'turn_changed'))
        self.assertEqual(self.match.current_player.bowling.frame_rolls(1), [4, 3])
        self.assertEqual(self.match.current_player.bowling.current_frame_number, 2)

    def test_single_player_finishes_after_ten_frames(self):
        for _frame in range(10):
            self.match.record_roll(0)
            event = self.match.record_roll(0)
            self.assertIn(event, ('same_player', 'round_changed',
                                  'turn_changed', 'match_over'))
        self.assertTrue(self.match.is_complete)
        self.assertEqual(self.match.current_player.bowling.total_score, 0)

    def test_strike_ends_the_frame_immediately(self):
        self.match.record_roll(10)
        self.assertEqual(self.match.current_player.bowling.frame_rolls(1), [10])
        self.assertEqual(self.match.current_player.bowling.current_frame_number, 2)

    def test_perfect_game_scores_three_hundred(self):
        for _ in range(12):
            self.match.record_roll(10)
        self.assertTrue(self.match.is_complete)
        self.assertEqual(self.match.current_player.bowling.total_score, 300)
        self.assertEqual(self.match.winners()[0].name, 'SOLO')


class TestTwoPlayerMatch(unittest.TestCase):
    """Two humans on one machine: the Local Multiplayer turn rules."""

    def setUp(self):
        self.match = Match.create(modes.LOCAL, specs('ALICE', 'BOB'))

    def test_turns_alternate_frame_by_frame(self):
        self.assertEqual(self.match.current_player.name, 'ALICE')
        self.match.record_roll(5)
        self.assertEqual(self.match.current_player.name, 'ALICE')
        event = self.match.record_roll(3)
        self.assertEqual(event, 'turn_changed')
        self.assertEqual(self.match.current_player.name, 'BOB')
        self.match.record_roll(10)
        self.assertEqual(self.match.current_player.name, 'ALICE')

    def test_scores_stay_separate(self):
        self.match.record_roll(10)          # ALICE strike
        self.match.record_roll(4)           # BOB
        self.match.record_roll(4)           # BOB
        self.assertEqual(self.match.players[0].bowling.frame_rolls(1), [10])
        self.assertEqual(self.match.players[1].bowling.frame_rolls(1), [4, 4])
        self.assertEqual(self.match.score_of(self.match.players[1]), 8)

    def test_match_ends_when_both_players_are_done(self):
        while not self.match.is_complete:
            self.match.record_roll(0)
            self.match.record_roll(0)
        self.assertTrue(self.match.is_complete)
        self.assertEqual(self.match.players[0].bowling.total_score, 0)

    def test_winner_is_the_higher_score_and_ties_are_reported(self):
        self.match.players[0].bowling.record_roll(10)
        self.match.players[1].bowling.record_roll(0)
        self.match.finished = True
        self.assertEqual(self.match.winners()[0].name, 'ALICE')
        self.match.players[1].bowling.reset()
        self.match.players[1].bowling.record_roll(10)
        self.assertEqual(len(self.match.winners()), 2)
        self.assertIn('DRAW', self.match.result_line())

    def test_roll_after_the_match_is_ignored_safely(self):
        while not self.match.is_complete:
            self.match.record_roll(0)
            self.match.record_roll(0)
        self.assertEqual(self.match.record_roll(5), 'match_over')
        self.assertTrue(self.match.is_complete)


class TestLocalMultiplayer(unittest.TestCase):
    def test_two_to_four_players_rotate(self):
        for count in (2, 3, 4):
            match = Match.create(modes.LOCAL,
                                 specs(*[f'P{i}' for i in range(count)]))
            self.assertEqual(match.player_count, count)
            order = []
            for _turn in range(count):
                order.append(match.current_player.name)
                match.record_roll(10)
            self.assertEqual(order, [f'P{i}' for i in range(count)])
            self.assertEqual(match.current_player.name, 'P0')

    def test_every_player_scores_independently(self):
        match = Match.create(modes.LOCAL, specs('A', 'B', 'C'))
        match.record_roll(7)
        match.record_roll(2)          # A: 9
        match.record_roll(10)         # B: strike
        match.record_roll(3)
        match.record_roll(4)          # C: 7
        self.assertEqual(match.score_of(match.players[0]), 9)
        self.assertEqual(match.score_of(match.players[1]), 0)   # waits on bonus
        self.assertEqual(match.score_of(match.players[2]), 7)


class TestBowlRush(unittest.TestCase):
    def setUp(self):
        self.match = Match.create(modes.RUSHRUSH, specs('RED', 'BLUE'),
                                  duration=60.0)

    def test_every_throw_changes_player_and_accumulates_pins(self):
        self.assertEqual(self.match.current_player.name, 'RED')
        self.match.record_roll(7)
        self.assertEqual(self.match.current_player.name, 'BLUE')
        self.match.record_roll(3)
        self.assertEqual(self.match.current_player.name, 'RED')
        self.assertEqual(self.match.score_of(self.match.players[0]), 7)
        self.assertEqual(self.match.score_of(self.match.players[1]), 3)

    def test_total_pin_scoring_is_not_frame_scoring(self):
        for pins in (10, 10, 10, 10):
            self.match.record_roll(pins)
        self.assertEqual(self.match.score_of(self.match.players[0]), 20)
        self.assertEqual(self.match.score_of(self.match.players[1]), 20)
        # A frame-based scorer would refuse a second 10 in the same frame.
        self.assertFalse(self.match.uses_frames)

    def test_countdown_and_time_up(self):
        self.assertTrue(self.match.tick(30.0))
        self.assertFalse(self.match.time_up)
        self.assertFalse(self.match.tick(40.0))
        self.assertTrue(self.match.time_up)
        self.assertTrue(self.match.is_complete)

    def test_a_throw_started_in_time_finishes(self):
        """The countdown stops while a roll is resolving, so no throw is cut."""
        self.match.tick(59.0)
        # Simulate the play screen: no tick while the ball is rolling, then a
        # recorded result after the clock would otherwise have expired.
        self.match.record_roll(8)
        self.assertEqual(self.match.score_of(self.match.players[0]), 8)
        self.assertFalse(self.match.time_up)

    def test_winner_is_decided_by_total_pins(self):
        for pins in (5, 9, 5, 2):
            self.match.record_roll(pins)
        self.match.finish()
        self.assertTrue(self.match.is_complete)
        self.assertEqual(self.match.winners()[0].name, 'BLUE')
        self.assertIn('WINS', self.match.result_line())

    def test_duration_is_configurable(self):
        match = Match.create(modes.RUSHRUSH, specs('A', 'B'), duration=120.0)
        self.assertEqual(match.duration, 120.0)
        self.assertEqual(match.time_left, 120.0)


class TestBotMatch(unittest.TestCase):
    def test_bot_is_a_separate_player_with_a_difficulty(self):
        match = Match.create(modes.PVBOT,
                             specs('HUMAN', 'BOT', bot=True, difficulty='hard'))
        self.assertEqual(match.player_count, 2)
        self.assertTrue(match.players[1].is_bot)
        self.assertEqual(match.players[1].difficulty, 'hard')
        self.assertFalse(match.players[0].is_bot)

    def test_bot_turns_follow_the_player(self):
        match = Match.create(modes.PVBOT,
                             specs('HUMAN', 'BOT', bot=True, difficulty='easy'))
        events = play_frame(match, 10)
        self.assertEqual(events, ['turn_changed'])
        self.assertTrue(match.current_player.is_bot)
        play_frame(match, 4, 5)
        self.assertFalse(match.current_player.is_bot)


class TestQuestionGatedMatches(unittest.TestCase):
    def test_trivia_records_answers_and_pins_without_frames(self):
        match = Match.create(modes.TRIVIA, specs('STUDENT'))
        match.record_answer(True)
        match.record_roll(6, advance=False)
        match.record_answer(False)
        match.record_roll(0, advance=False)
        player = match.players[0]
        self.assertEqual(player.answered, 2)
        self.assertEqual(player.correct, 1)
        self.assertEqual(player.total_pins, 6)
        self.assertFalse(match.is_complete)

    def test_equations_uses_the_same_gate(self):
        match = Match.create(modes.EQUATIONS, specs('STUDENT'))
        self.assertEqual(match.mode.gate, modes.GATE_EQUATIONS)
        self.assertEqual(match.mode.score_style, 'pins')
        self.assertTrue(match.mode.resolves_every_throw)


class TestPlayerIdentity(unittest.TestCase):
    def test_default_names_and_colours(self):
        player = Player(2)
        self.assertEqual(player.name, 'PLAYER 3')
        self.assertEqual(player.rgb, (255, 255, 255))

    def test_rebuild_keeps_identities_and_clears_scores(self):
        match = Match.create(modes.LOCAL, specs('ALICE', 'BOB'))
        match.record_roll(10)
        match.rebuild()
        self.assertEqual([p.name for p in match.players], ['ALICE', 'BOB'])
        self.assertEqual(match.players[0].bowling.rolls, [])
        self.assertEqual(match.current_player.name, 'ALICE')

    def test_all_modes_have_a_definition(self):
        for mode in modes.ALL:
            self.assertTrue(mode.title)
            self.assertTrue(mode.description)
            self.assertTrue(mode.motif)
            low, high = mode.player_range
            self.assertLessEqual(low, high)
            self.assertGreaterEqual(low, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
