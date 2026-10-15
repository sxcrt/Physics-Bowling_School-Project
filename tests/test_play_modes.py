"""Offscreen integration tests: every game mode through the real play screen.

These drive :class:`game.play.Game` (the play screen) one fixed timestep at a
time in an offscreen Ursina window, so the mode rules, the roll lifecycle, the
question gates, the BowlRush clock, the bot's turn and the pause/handoff
transitions are all exercised for real - with the physics running.

Run with:  ``python -m unittest tests.test_play_modes -v``
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ursina import Ursina, application, color, time, window

import config
from game.play import Game
from input.mouse_input import MouseInput, ThrowData
from input.webcam_input import WebcamStatus
from tests.test_game_modes import FakeWebcamInput

FIXED_DT = 1.0 / 60.0
MAX_FRAMES = 20000


class Harness:
    """Drives the play screen with a fixed timestep."""

    def __init__(self):
        application.calculate_dt = False
        self.app = Ursina(title='Hells Balls (mode tests)', size=(1280, 720),
                          window_type='offscreen', development_mode=True,
                          show_ursina_splash=False, icon='')
        window.color = color.rgb32(*config.WINDOW_BACKGROUND)
        self.webcam = FakeWebcamInput()
        # A mouse input that never reads the real pointer.
        self.mouse = MouseInput(pointer=lambda: (0.0, 0.0))
        self.game = Game(inputs={'mouse': self.mouse, 'webcam': self.webcam})

    def step(self, frames=1):
        for _ in range(frames):
            time.dt = FIXED_DT
            time.dt_unscaled = FIXED_DT
            self.game.update()
            self.app._update()

    def run_until(self, predicate, max_frames=MAX_FRAMES, message=''):
        for _ in range(max_frames):
            self.step()
            if predicate():
                return
        raise AssertionError(
            f'game did not reach the expected state within {max_frames} frames '
            f'(state={self.game.state!r}, match={message})')

    def standing(self):
        return [pin for pin in self.game.pins.pins
                if not pin.physics.down and not pin.physics.removed]

    def force_roll(self, count):
        """Drive one roll that knocks down ``count`` pins, physics bypassed."""
        game = self.game
        assert game.state == 'ready', game.state
        standing = self.standing()
        assert 0 <= count <= len(standing), (count, len(standing))
        game.launch(ThrowData(speed=7.0, lateral_position=0.0, source='script'))
        for pin in standing[:count]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6
        game.ball.physics.rolling = False
        game.ball.finished = True
        self.run_until(lambda: game.state in ('result', 'handoff', 'game_over'))
        self.run_until(lambda: game.state != 'result')

    def play_frame(self, mode, *rolls):
        """Play one frame of the current player (handling handoffs)."""
        for count in rolls:
            if self.game.state == 'handoff':
                self.game.on_key('enter')
                self.run_until(lambda: self.game.state == 'ready')
            self.force_roll(count)


def make_harness():
    try:
        return Harness()
    except Exception as exc:                    # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')


class PlayTestCase(unittest.TestCase):
    harness = None

    @classmethod
    def setUpClass(cls):
        cls.harness = make_harness()

    def setUp(self):
        h = self.harness
        h.game.paused = False
        h.game.configure('classic', [{'name': 'PLAYER 1'}])
        h.game.set_input_mode('mouse')
        h.game._webcam_error_handled = False
        h.webcam.pending = None
        h.webcam.lateral = 0.0
        h.webcam._status = WebcamStatus(running=True, tracked=False,
                                        phase='waiting',
                                        phase_label='Waiting')

    # ------------------------------------------------------------------ helpers
    def assert_eventually(self, predicate, message=''):
        self.harness.run_until(predicate, message=message)


class TestClassicThroughThePlayScreen(PlayTestCase):
    def test_default_construction(self):
        game = self.harness.game
        self.assertEqual(game.state, 'ready')
        self.assertEqual(len(self.harness.standing()), 10)
        self.assertEqual(game.mode.id, 'classic')

    def test_perfect_game_scores_300(self):
        for _ in range(9):
            self.harness.force_roll(10)
        for _ in range(3):
            self.harness.force_roll(10)
        game = self.harness.game
        self.assertEqual(game.state, 'game_over')
        self.assertEqual(game.score.total_score, 300)
        self.assertTrue(any('WINS' in line for line in game.results_lines))

    def test_open_frames_keep_the_survivors_on_the_deck(self):
        self.harness.force_roll(4)
        self.assertEqual(len(self.harness.standing()), 6)
        self.harness.force_roll(3)
        self.assertEqual(len(self.harness.standing()), 10)   # fresh frame

    def test_rematch_clears_the_scores_and_the_rack(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 4, 3)
        game.restart_match()
        self.assertEqual(game.state, 'ready')
        self.assertEqual(game.score.rolls, [])
        self.assertEqual(len(self.harness.standing()), 10)


class TestTriviaMode(PlayTestCase):
    def setUp(self):
        super().setUp()
        self.harness.game.configure('trivia', [{'name': 'STUDENT'}])

    def answer(self, text):
        game = self.harness.game
        answer_question = game.current_question
        correct_text = (str(answer_question.answer)
                        if answer_question.is_numeric else answer_question.answer)
        game.answer_text = correct_text if text is None else text
        game.on_key('enter')
        return game.feedback

    def test_starts_on_a_question_and_waits_for_an_answer(self):
        game = self.harness.game
        self.assertEqual(game.state, 'question')
        self.assertIsNotNone(game.current_question)
        self.assertEqual(game.answer_text, '')

    def test_a_correct_answer_unlocks_the_throw(self):
        game = self.harness.game
        feedback = self.answer(None)
        self.assertTrue(feedback.correct)
        self.harness.run_until(lambda: game.state == 'ready', max_frames=600)
        self.assertEqual(len(self.harness.standing()), 10)

    def test_a_wrong_answer_forfeits_the_throw(self):
        game = self.harness.game
        feedback = self.answer('definitely not the answer')
        self.assertFalse(feedback.correct)
        self.assertTrue(feedback.working, 'the explanation must be shown')
        self.harness.run_until(
            lambda: game.state == 'question' and game.question_index == 1,
            max_frames=600)
        # No throw was granted, and the question advanced.
        self.assertEqual(game.state, 'question')
        self.assertEqual(game.question_index, 1)

    def test_wrong_then_right_keeps_progressing(self):
        game = self.harness.game
        self.answer('nonsense')
        self.harness.run_until(lambda: game.feedback is None, max_frames=600)
        self.answer(None)
        self.harness.run_until(lambda: game.state == 'ready', max_frames=600)
        game.input_source.discard_pending()
        # Force a short throw through the real simulation.
        game.launch(ThrowData(speed=7.0, source='script'))
        self.harness.run_until(lambda: game.state != 'rolling', max_frames=8000)
        self.harness.run_until(lambda: game.state in ('question', 'game_over'),
                               max_frames=8000)

    def test_typing_builds_the_answer_text(self):
        game = self.harness.game
        for key in ('4', '2', 'space', 'm', 'slash', 's'):
            game.on_key(key)
        self.assertEqual(game.answer_text, '42 m/s')
        game.on_key('backspace')
        self.assertEqual(game.answer_text, '42 m/')

    def test_the_session_can_be_finished(self):
        game = self.harness.game
        guard = 0
        while game.state != 'game_over' and guard < 200:
            guard += 1
            if game.state == 'question':
                self.answer('nonsense')
                self.harness.run_until(lambda: game.state != 'question'
                                       or game.feedback is None, max_frames=600)
            elif game.state == 'ready':
                self.harness.force_roll(3)
        self.assertEqual(game.state, 'game_over')
        text = '\n'.join(game.results_lines)
        self.assertIn('answers', text)

    def test_results_report_answers_and_pins(self):
        game = self.harness.game
        game.question_index = len(game.questions) - 1
        self.answer(None)
        self.harness.run_until(lambda: game.state == 'ready', max_frames=600)
        self.harness.force_roll(7)
        self.harness.run_until(lambda: game.state == 'game_over', max_frames=600)
        text = '\n'.join(game.results_lines)
        self.assertIn('answers', text)
        self.assertIn('7', text)


class TestEquationChallengeMode(PlayTestCase):
    """Equation Mode: challenge -> value -> real simulation -> measured result."""

    def setUp(self):
        super().setUp()
        self.harness.game.configure('equations', [{'name': 'STUDENT'}])

    def wait_for_result(self):
        game = self.harness.game
        self.harness.run_until(
            lambda: game.state == 'challenge'
            and game.challenge_result is not None, max_frames=8000,
            message='the challenge roll never resolved')
        return game.challenge_result

    def bowl(self, text):
        game = self.harness.game
        game.challenge_input = text
        game.on_key('enter')
        return game

    def test_starts_on_a_challenge_with_the_leave_on_the_deck(self):
        game = self.harness.game
        self.assertEqual(game.state, 'challenge')
        self.assertIsNotNone(game.challenge)
        self.assertEqual(len(game.challenges), 10)
        self.assertTrue(game.challenge.equation)
        self.assertTrue(game.challenge.control.unit)
        # The challenge's own leave is standing and the ball waits at the
        # release point the challenge fixes.
        standing = self.harness.standing()
        self.assertEqual(len(standing), len(game.challenge.rack))
        position, _speed, _angle, _spin = game.challenge.launch_values(
            game.challenge.answer)
        self.assertAlmostEqual(game.ball.physics.x,
                               game.challenge.fixed.get('position', position))

    def test_an_attempt_launches_the_real_simulation(self):
        game = self.harness.game
        self.bowl('0')
        self.assertEqual(game.state, 'rolling')
        self.assertIsNotNone(game.last_throw)
        self.assertEqual(game.last_throw.source, 'equation',
                         'the launch must come from the challenge value')
        self.assertEqual(game.last_throw.spin_omega,
                         game.challenge.fixed.get('spin', 0.0))
        outcome = self.wait_for_result()
        self.assertEqual(game.challenge_attempts, 1)
        self.assertFalse(outcome.solved, '0 is not the answer to challenge 1')
        self.assertTrue(outcome.lines, 'the result must explain itself')

    def test_unlimited_attempts_and_the_expected_value_solves_it(self):
        game = self.harness.game
        challenge = game.challenge
        self.bowl('0')
        self.wait_for_result()
        self.assertFalse(game.challenge_result.solved)
        self.assertEqual(game.state, 'challenge', 'the panel comes back')
        # A tuned value solves it; the challenge is not consumed by a miss.
        self.bowl(f'{challenge.answer:.2f}')
        outcome = self.wait_for_result()
        self.assertTrue(outcome.solved, outcome.headline)
        self.assertEqual(game.challenge_attempts, 2)
        # CONTINUE moves to the next challenge (same match, same player).
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'challenge'
                               and game.challenge_index == 1, max_frames=600)
        self.assertNotEqual(game.challenge.id, challenge.id)
        self.assertEqual(len(self.harness.standing()),
                         len(game.challenge.rack))

    def test_the_worked_solution_can_be_revealed(self):
        game = self.harness.game
        self.bowl('0')
        self.wait_for_result()
        self.assertFalse(game.challenge_result.solved)
        self.assertTrue(game.show_challenge_solution())
        self.assertTrue(game.challenge_solution,
                        'the solution text must be shown')
        self.assertIn(str(abs(game.challenge.answer))[:4],
                      game.challenge_solution)
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'challenge'
                               and game.challenge_index == 1, max_frames=600)
        self.assertTrue(game.match.players[0].answered >= 1)

    def test_the_session_can_be_finished_from_the_challenge_panel(self):
        game = self.harness.game
        # Jump to the last challenge so the test does not bowl all ten.
        game.challenge_index = len(game.challenges) - 1
        game._enter_challenge()
        self.harness.step(2)
        self.bowl(f'{game.challenge.control.low:.3g}')
        self.wait_for_result()
        self.assertFalse(game.challenge_result.solved)
        game.show_challenge_solution()
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'game_over',
                               max_frames=600)
        text = '\n'.join(game.results_lines)
        self.assertIn('challenges solved', text)
        self.assertIn('Score = pins knocked down', text)

    def test_leaving_equation_mode_restores_the_regulation_rack(self):
        """A challenge's leave must never leak into the next classic match."""
        import physics
        game = self.harness.game
        self.assertEqual(len(self.harness.standing()), 1,
                         'challenge 1 stands a single pin')
        game.configure('classic', [{'name': 'PLAYER 1'}])
        self.harness.step(2)
        standing = self.harness.standing()
        self.assertEqual(len(standing), 10)
        regulation = {(round(x, 4), round(z, 4))
                      for x, z in physics.rack_positions()}
        for pin in standing:
            spot = (round(pin.physics.base[0], 4),
                    round(pin.physics.base[1], 4))
            self.assertIn(spot, regulation,
                          'the rack must stand at the regulation spots')


class TestTwoPlayerLocalMode(PlayTestCase):
    """Two humans on one machine: the handoff, the stale-throw guard, rematch."""

    def setUp(self):
        super().setUp()
        self.harness.game.configure(
            'local', [{'name': 'ALICE'}, {'name': 'BOB'}])

    def test_two_players_alternate_frames(self):
        game = self.harness.game
        self.assertEqual(game.match.player_count, 2)
        self.harness.play_frame(game.mode, 4, 3)
        self.assertEqual(game.state, 'handoff')
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'ready')
        self.assertEqual(game.match.current_player.name, 'BOB')
        self.assertEqual(game.match.current_player.bowling.rolls, [])

    def test_handoff_does_not_allow_a_stale_throw(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 10)
        self.assertEqual(game.state, 'handoff')
        # A throw queued during the handoff (an old drag finishing, say) must
        # not fire when the next player's turn starts.
        game.inputs['mouse']._pending = ThrowData(speed=7.0, source='script')
        self.harness.step(3)
        self.assertEqual(game.state, 'handoff')
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'ready')
        self.assertIsNone(game.inputs['mouse']._pending)
        self.harness.step(3)
        self.assertEqual(game.state, 'ready')

    def test_scores_stay_separate_and_the_winner_is_announced(self):
        game = self.harness.game
        guard = 0
        while game.state != 'game_over' and guard < 40:
            guard += 1
            if game.match.current_player.name == 'ALICE':
                self.harness.play_frame(game.mode, 10)
            else:
                self.harness.play_frame(game.mode, 0, 0)
        self.assertEqual(game.state, 'game_over')
        self.assertEqual(game.match.players[0].bowling.total_score, 300)
        self.assertEqual(game.match.players[1].bowling.total_score, 0)
        self.assertTrue(any('ALICE' in line for line in game.results_lines))

    def test_rematch_keeps_the_players(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 5, 4)
        game.restart_match()
        self.assertEqual([p.name for p in game.match.players], ['ALICE', 'BOB'])
        self.assertEqual(game.match.turn_index, 0)
        self.assertEqual(game.state, 'ready')


class TestLocalMultiplayerMode(PlayTestCase):
    def test_four_players_rotate_and_finish(self):
        game = self.harness.game
        game.configure('local', [{'name': f'P{i}'} for i in range(4)])
        self.assertEqual(game.match.player_count, 4)
        order = []
        for _turn in range(4):
            order.append(game.match.current_player.name)
            self.harness.play_frame(game.mode, 10)
        self.assertEqual(order, ['P0', 'P1', 'P2', 'P3'])
        self.assertEqual(game.match.current_player.name, 'P0')

    def test_three_player_match_completes(self):
        game = self.harness.game
        game.configure('local', [{'name': 'A'}, {'name': 'B'}, {'name': 'C'}])
        guard = 0
        while game.state != 'game_over' and guard < 40:
            guard += 1
            self.harness.play_frame(game.mode, 8, 1)
        self.assertEqual(game.state, 'game_over')
        self.assertTrue(game.match.is_complete)


class TestBowlRushMode(PlayTestCase):
    def setUp(self):
        super().setUp()
        self.harness.game.configure(
            'bowlrush', [{'name': 'RED'}, {'name': 'BLUE'}], duration=60.0)

    def test_default_rules(self):
        self.assertEqual(self.harness.game.mode.default_duration, 180.0)
        self.assertTrue(self.harness.game.mode.timed)
        self.assertTrue(self.harness.game.mode.resolves_every_throw)

    def test_every_throw_gets_a_fresh_rack_and_swaps_player(self):
        game = self.harness.game
        self.harness.force_roll(6)
        self.assertEqual(game.match.current_player.name, 'BLUE')
        # The fallen pins are swept when the next throw is set up, exactly like
        # a pinsetter: no stale pins, no double counting.
        self.harness.run_until(lambda: game.state == 'handoff', max_frames=600)
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'ready', max_frames=600)
        self.assertEqual(len(self.harness.standing()), 10)
        self.harness.force_roll(3)
        self.assertEqual(game.match.current_player.name, 'RED')
        self.assertEqual(game.match.players[0].total_pins, 6)
        self.assertEqual(game.match.players[1].total_pins, 3)

    def test_the_clock_runs_while_waiting_but_not_during_a_roll(self):
        game = self.harness.game
        self.harness.step(60)                      # one second
        self.assertLess(game.match.time_left, 60.0)
        before = game.match.time_left
        game.launch(ThrowData(speed=7.0, source='script'))
        self.harness.step(30)                      # half a second of rolling
        self.assertAlmostEqual(game.match.time_left, before, places=6)

    def test_expiry_finishes_the_match_and_crowns_the_leader(self):
        game = self.harness.game
        self.harness.force_roll(8)
        game.match.time_left = 0.01
        self.harness.run_until(lambda: game.state == 'game_over', max_frames=600)
        self.assertTrue(game.match.is_complete)
        self.assertTrue(any('WINS' in line for line in game.results_lines))

    def test_a_throw_started_before_time_up_still_resolves(self):
        game = self.harness.game
        game.match.time_left = 0.5
        game.launch(ThrowData(speed=7.0, source='script'))
        time_left_at_launch = game.match.time_left
        self.harness.run_until(lambda: game.state in ('result', 'game_over'),
                               max_frames=9000)
        self.assertEqual(game.match.time_left, time_left_at_launch)

    def test_pause_freezes_the_clock(self):
        game = self.harness.game
        self.harness.step(30)
        game.pause()
        frozen = game.match.time_left
        self.harness.step(120)
        self.assertEqual(game.match.time_left, frozen)
        game.resume()
        self.harness.step(30)
        self.assertLess(game.match.time_left, frozen)


class TestPlayerVsBotMode(PlayTestCase):
    def setUp(self):
        super().setUp()
        self.harness.game.configure(
            'pvbot', [{'name': 'YOU'}, {'name': 'BOT', 'is_bot': True,
                                        'difficulty': 'easy'}])

    def test_the_bot_plans_then_throws_through_the_simulation(self):
        game = self.harness.game
        self.harness.force_roll(10)              # human strike
        self.harness.run_until(lambda: game.match.current_player.is_bot,
                               max_frames=600)
        self.harness.run_until(lambda: game.state == 'rolling',
                               max_frames=MAX_FRAMES)
        self.assertIsNotNone(game.last_throw)
        self.assertEqual(game.last_throw.source, 'bot')
        self.assertGreater(game.ball.physics.v, 0.0)

    def test_the_bot_produces_a_real_simulated_result(self):
        game = self.harness.game
        self.harness.force_roll(10)
        self.harness.run_until(lambda: game.state == 'rolling',
                               max_frames=MAX_FRAMES)
        self.harness.run_until(lambda: game.state == 'result', max_frames=9000)
        self.assertGreaterEqual(game.knockdowns, 0)
        self.assertLessEqual(game.knockdowns, 10)
        self.assertEqual(game.match.players[1].bowling.rolls[-1],
                         game.knockdowns)

    def test_difficulties_choose_different_launch_conditions(self):
        from game.bot import BotPlanner
        import physics
        rack = physics.rack_positions()
        conditions = {}
        for difficulty in ('easy', 'medium', 'hard'):
            planner = BotPlanner(difficulty, rng=__import__('random').Random(5))
            throw = planner.plan_now(rack)
            conditions[difficulty] = (round(throw.speed, 3),
                                      round(throw.spin_omega, 3),
                                      round(throw.lateral_position, 4))
        self.assertEqual(len(set(conditions.values())), 3,
                         f'difficulties behaved identically: {conditions}')


class TestWebcamHandoff(PlayTestCase):
    """The webcam handoff: no accidental throws, no stale swings."""

    def setUp(self):
        super().setUp()
        self.harness.game.configure('local', [{'name': 'P1'}, {'name': 'P2'}])
        self._status(tracked=False, phase='waiting', phase_label='Waiting')
        self.harness.game.set_input_mode('webcam')
        self.assertIs(self.harness.game.input_source, self.harness.webcam)

    def _status(self, **kwargs):
        defaults = dict(running=True, tracked=True, confidence=0.9,
                        phase='ready', phase_label='Ready')
        defaults.update(kwargs)
        self.harness.webcam._status = WebcamStatus(**defaults)

    def test_no_person_means_no_progress(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 10)
        self.assertEqual(game.state, 'handoff')
        self._status(tracked=False, phase='waiting', phase_label='Waiting')
        self.harness.step(120)
        self.assertLess(game._handoff_progress, 0.2)
        self.assertEqual(game.state, 'handoff')

    def test_tracking_without_the_ready_pose_does_not_confirm(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 10)
        self._status(phase='forward', phase_label='Forward swing')
        self.harness.step(120)
        self.assertLess(game._handoff_progress, 0.2)

    def test_stable_tracking_and_ready_pose_confirm_the_turn(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 10)
        self._status()
        self.harness.run_until(lambda: game.state == 'ready', max_frames=900)
        self.assertEqual(game.match.current_player.name, 'P2')
        self.assertEqual(game.state, 'ready')

    def test_the_camera_never_receives_throws_during_a_handoff(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 10)
        self._status()
        self.harness.step(10)
        self.assertEqual(game.state, 'handoff')
        self.assertIn(False, self.harness.webcam.ready_log)
        self.assertIsNone(self.harness.webcam.pending)

    def test_a_camera_error_still_lets_the_turn_continue(self):
        game = self.harness.game
        self.harness.play_frame(game.mode, 10)
        self.harness.webcam._status = WebcamStatus(
            error='no webcam could be opened at index 0')
        self.harness.run_until(lambda: game.input_mode == 'mouse',
                               max_frames=120)
        game.on_key('enter')
        self.harness.run_until(lambda: game.state == 'ready', max_frames=600)
        self.assertEqual(game.match.current_player.name, 'P2')


class TestPauseAndState(PlayTestCase):
    def test_pause_freezes_the_ball_and_the_pins(self):
        game = self.harness.game
        game.launch(ThrowData(speed=7.5, source='script'))
        self.harness.step(20)
        game.pause()
        position = tuple(game.ball.physics.position)
        velocities = [tuple(pin.physics.velocity) for pin in game.pins.pins]
        self.harness.step(120)
        self.assertEqual(tuple(game.ball.physics.position), position)
        self.assertEqual([tuple(pin.physics.velocity) for pin in game.pins.pins],
                         velocities)

    def test_pause_does_not_accept_a_throw(self):
        game = self.harness.game
        game.pause()
        game.inputs['mouse']._pending = ThrowData(speed=7.0, source='script')
        self.harness.step(5)
        self.assertEqual(game.state, 'ready')
        self.assertTrue(game.paused)

    def test_resume_continues_the_roll(self):
        game = self.harness.game
        game.launch(ThrowData(speed=7.5, source='script'))
        self.harness.step(20)
        game.pause()
        frozen = tuple(game.ball.physics.position)
        self.harness.step(60)
        game.resume()
        self.harness.step(60)
        self.assertNotEqual(tuple(game.ball.physics.position), frozen)

    def test_escape_toggles_pause_and_never_leaves_the_game_stuck(self):
        game = self.harness.game
        game.on_key('escape')
        self.assertTrue(game.paused)
        game.on_key('escape')
        self.assertFalse(game.paused)
        self.assertEqual(game.state, 'ready')

    def test_returning_to_the_menu_from_the_overlay_hides_it(self):
        game = self.harness.game
        game.pause()
        button = game.pause_overlay.buttons[-1]
        button.click(button.position[0], button.position[1])
        self.assertFalse(game.paused)
        self.assertFalse(game.pause_overlay.visible)


if __name__ == '__main__':
    unittest.main(verbosity=2)
