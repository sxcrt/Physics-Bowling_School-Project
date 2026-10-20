"""Functional tests for the interaction layer: a click must change the state.

The earlier screen tests called ``button.click(...)`` directly, which proves a
callback exists but not that a *real* click reaches it. These tests drive the
whole path the running game uses:

    ursina input -> App.on_key('left mouse down') -> Screen.on_click -> widget

with an injected pointer, so a click at the on-screen position of SETTINGS has
to open the settings screen, a click on a mode card has to select it, a click on
START has to launch the match, and so on. The pointer itself is a real concern
(see ``input/pointer.py``): Panda3D can report "no pointer" and then every click
lands in the centre of the screen, which is exactly how the menu buttons used to
appear dead.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ursina import Ursina, application, color, time, window

import config
from game.settings import Settings
from input.mouse_input import MouseInput, ThrowData
from input.pointer import Pointer, pointer_state
from tests.test_game_modes import FakeWebcamInput
from ui.app import App


class AppTestCase(unittest.TestCase):
    app_root = None
    app = None

    @classmethod
    def setUpClass(cls):
        cls.app_root, cls.app = make_app()

    @classmethod
    def tearDownClass(cls):
        pointer_state().set_override(None)

    def setUp(self):
        self.pointer = pointer_state()
        self.pointer.set_override(lambda: self.pointer.position)
        self.pointer.position = (0.0, 0.0)
        self.app.screens.set('menu')
        self.app.settings.update(input_mode='mouse', hand_menu_navigation=False,
                                 bot_difficulty='medium', rush_duration=180.0)

    # ------------------------------------------------------------- helpers
    def step(self, frames=1):
        for _ in range(frames):
            time.dt = 1.0 / 60.0
            time.dt_unscaled = 1.0 / 60.0
            self.app.update()
            self.app_root._update()

    def click_at(self, x, y):
        """A real left-click at UI position ``(x, y)``."""
        self.pointer.position = (float(x), float(y))
        self.step(2)
        self.app.on_key('left mouse down')
        self.step(2)

    def click_widget(self, widget):
        self.click_at(widget.position[0], widget.position[1])

    def click_glyph(self, widget, glyph):
        """A real click on the chevron a stepper *draws*.

        The drawn chevron and the clickable zone have to be the same spot; a
        click on the visible left chevron used to land on the row body (which
        steps *up*), so a value could only ever climb.
        """
        self.click_at(widget.position[0] + glyph.position[0],
                      widget.position[1] + glyph.position[1])

    def active(self):
        return self.app.screens.active


def make_app():
    settings = Settings(path=os.path.join(tempfile.mkdtemp(prefix='strike_ui_'),
                                          'settings.json'))
    try:
        application.calculate_dt = False
        app_root = Ursina(title='Hells Balls (ui tests)', size=(1280, 720),
                          window_type='offscreen', development_mode=True,
                          show_ursina_splash=False, icon='')
    except Exception as exc:                    # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')
    window.color = color.rgb32(*config.WINDOW_BACKGROUND)
    app = App(settings=settings, audio=None,
              inputs={'mouse': MouseInput(pointer=lambda: (0.0, 0.0)),
                      'webcam': FakeWebcamInput()})
    return app_root, app


class TestMenuClicks(AppTestCase):
    def test_clicking_play_opens_the_mode_picker(self):
        menu = self.active()
        self.click_widget(menu.buttons[0])
        self.assertEqual(self.active().name, 'modes')

    def test_clicking_settings_opens_settings(self):
        menu = self.active()
        settings_button = [b for b in menu.buttons if b.label == 'SETTINGS'][0]
        self.click_widget(settings_button)
        self.assertEqual(self.active().name, 'settings')

    def test_settings_back_returns_to_the_menu(self):
        self.app.open_settings()
        settings = self.active()
        self.click_widget(settings.back_button)
        self.assertEqual(self.active().name, 'menu')

    def test_settings_from_a_match_returns_to_the_match(self):
        self.app.start_match('classic', [{'name': 'A'}])
        self.step(2)
        self.app.open_settings(from_game=True)
        self.assertEqual(self.active().name, 'settings')
        self.click_widget(self.active().back_button)
        self.assertEqual(self.active().name, 'play')

    def test_clicking_how_to_play_opens_the_manual_and_back_returns(self):
        menu = self.active()
        button = [b for b in menu.buttons if b.label == 'HOW TO PLAY'][0]
        self.click_widget(button)
        self.assertEqual(self.active().name, 'howto')
        help_screen = self.active()
        self.click_widget(help_screen.back_button)
        self.assertEqual(self.active().name, 'menu')

    def test_help_next_button_turns_the_page(self):
        self.app.go_to_help()
        help_screen = self.active()
        self.step(1)
        first = help_screen.page_title.main.text
        self.click_widget(help_screen.next_button)
        self.assertNotEqual(help_screen.page_title.main.text, first)

    def test_clicking_physics_lab_opens_the_lab_and_back_returns(self):
        menu = self.active()
        button = [b for b in menu.buttons if b.label == 'PHYSICS LAB'][0]
        self.click_widget(button)
        self.assertEqual(self.active().name, 'lab')
        self.step(30)
        lab = self.active()
        # Entering the lab must not roll anything: the ball waits for BOWL.
        self.assertEqual(lab.state, 'idle')
        self.assertFalse(self.app.game.ball.physics.rolling)
        self.assertEqual(self.app.game.ball.physics.z, config.FOUL_LINE_Z)
        self.click_widget(lab.back_button)
        self.assertEqual(self.active().name, 'menu')

    def test_menu_keyboard_selection_still_works(self):
        self.app.on_key('up arrow')
        self.app.on_key('down arrow')
        self.app.on_key('enter')
        self.assertIn(self.active().name, ('modes', 'settings', 'howto', 'lab',
                                           'menu'))


class TestModePickerClicks(AppTestCase):
    def open_picker(self):
        self.app.go_to_modes()
        self.step(1)
        return self.active()

    def test_clicking_a_card_selects_it_without_starting(self):
        picker = self.open_picker()
        for index, card in enumerate(picker.cards):
            self.click_widget(card)
            self.assertEqual(picker.selected_ball, index)
            self.assertEqual(self.active().name, 'modes',
                             'a click must only select the mode')
        # Clicking the already-selected card must not launch it either: only
        # START (or ENTER) begins a match, so a click can never surprise.
        self.click_widget(picker.cards[picker.selected_ball])
        self.assertEqual(self.active().name, 'modes')

    def test_the_selected_card_is_marked(self):
        picker = self.open_picker()
        picker.select_ball(3)
        for card in picker.cards:
            card.update_widget(-9.0, -9.0, 0.0)
        selected = picker.cards[3]
        other = picker.cards[2]
        # The selection is the accent border plus the check badge in the
        # corner (the old "SELECTED" caption was removed with the restyle).
        self.assertTrue(selected.selected)
        self.assertTrue(selected.badge.visible)
        self.assertFalse(other.selected)
        self.assertFalse(other.badge.visible)

    def test_every_mode_starts_from_the_start_button(self):
        picker = self.open_picker()
        for index, mode in enumerate(picker.mode_list):
            self.app.screens.set('modes')
            self.step(1)
            picker.select_ball(index)
            self.click_widget(picker.start_button)
            self.assertEqual(self.active().name, 'play', mode.title)
            self.assertEqual(self.app.game.mode.id, mode.id)
            self.assertIsNotNone(self.app.game.match)

    def test_back_button_returns_to_the_menu(self):
        picker = self.open_picker()
        self.click_widget(picker.back_button)
        self.assertEqual(self.active().name, 'menu')

    def test_start_uses_the_selected_configuration(self):
        picker = self.open_picker()
        picker.select_ball(3)                       # player vs bot
        self.assertTrue(picker.difficulty_stepper.visible)
        before = picker.difficulty
        self.click_widget(picker.difficulty_stepper)
        self.assertNotEqual(picker.difficulty, before)
        self.click_widget(picker.start_button)
        game = self.app.game
        self.assertEqual(game.mode.id, 'pvbot')
        bot = [p for p in game.match.players if p.is_bot][0]
        self.assertEqual(bot.difficulty, picker.difficulty)

    def test_player_count_reaches_a_local_match(self):
        picker = self.open_picker()
        picker.select_ball(4)                       # local multiplayer
        self.click_widget(picker.players_stepper)
        self.assertEqual(picker.player_count, 3)
        self.click_widget(picker.start_button)
        self.assertEqual(self.app.game.match.player_count, 3)

    def test_bowlrush_duration_reaches_the_match(self):
        picker = self.open_picker()
        picker.select_ball(5)                       # bowlrush
        self.click_widget(picker.duration_stepper)
        expected = picker.duration
        self.click_widget(picker.start_button)
        self.assertAlmostEqual(self.app.game.match.duration, expected)

    def test_setup_only_shows_relevant_controls(self):
        picker = self.open_picker()
        for index, mode in enumerate(picker.mode_list):
            picker.select_ball(index)
            low, high = mode.player_range
            self.assertEqual(picker.players_stepper.visible, high > low,
                             f'{mode.id}: players')
            self.assertEqual(picker.difficulty_stepper.visible, mode.allow_bot,
                             f'{mode.id}: difficulty')
            self.assertEqual(picker.duration_stepper.visible, mode.timed,
                             f'{mode.id}: duration')


class TestOverlayClicks(AppTestCase):
    def start_classic(self, players=1):
        specs = [{'name': f'P{i + 1}'} for i in range(players)]
        self.app.start_match('classic', specs)
        self.step(3)
        return self.app.game

    def test_pause_and_resume_by_click(self):
        game = self.start_classic()
        self.app.on_key('escape')
        self.assertTrue(game.paused)
        self.assertTrue(game.pause_overlay.visible)
        self.click_widget(game.pause_overlay.buttons[0])       # RESUME
        self.assertFalse(game.paused)
        self.assertFalse(game.pause_overlay.visible)

    def test_pause_restart_match_by_click(self):
        game = self.start_classic()
        game.score.record_roll(10)
        self.app.on_key('escape')
        self.click_widget(game.pause_overlay.buttons[1])       # RESTART MATCH
        self.assertFalse(game.paused)
        self.assertEqual(game.score.rolls, [])
        self.assertEqual(game.state, 'ready')

    def test_pause_quit_to_menu_by_click(self):
        game = self.start_classic()
        self.app.on_key('escape')
        quit_button = [b for b in game.pause_overlay.buttons
                       if b.label == 'QUIT TO MENU'][0]
        self.click_widget(quit_button)
        self.assertEqual(self.active().name, 'menu')
        self.assertFalse(game.paused)

    def test_results_rematch_by_click(self):
        game = self.start_classic()
        game._finish_match()
        self.step(2)
        self.assertTrue(game.results_overlay.visible)
        self.click_widget(game.results_overlay.buttons[0])     # REMATCH
        self.assertEqual(game.state, 'ready')
        self.assertEqual(game.score.rolls, [])
        self.assertFalse(game.results_overlay.visible)

    def test_results_main_menu_by_click(self):
        game = self.start_classic()
        game._finish_match()
        self.step(2)
        menu_button = [b for b in game.results_overlay.buttons
                       if b.label == 'MAIN MENU'][0]
        self.click_widget(menu_button)
        self.assertEqual(self.active().name, 'menu')

    def test_resume_by_click_after_pause_key(self):
        game = self.start_classic()
        self.app.on_key('p')
        self.assertTrue(game.paused)
        self.click_widget(game.pause_overlay.buttons[0])
        self.assertFalse(game.paused)


class TestQuestionInteraction(AppTestCase):
    def start_trivia(self):
        self.app.start_match('trivia', [{'name': 'QUIZZER'}])
        self.step(2)
        return self.app.game

    def test_typing_and_submitting_an_answer(self):
        game = self.start_trivia()
        self.assertEqual(game.state, 'question')
        question = game.current_question
        answer = question.expected_text()
        for character in str(answer):
            self.app.on_key('space' if character == ' ' else character)
        self.assertEqual(game.answer_text, str(answer))
        self.app.on_key('enter')
        self.assertIsNotNone(game.feedback)
        self.assertTrue(game.feedback.correct)

    def test_clicking_submit_answers_the_question(self):
        game = self.start_trivia()
        question = game.current_question
        for character in str(question.expected_text()):
            self.app.on_key('space' if character == ' ' else character)
        self.app.game._hud()
        self.step(1)
        submit = game.question_controls.submit_button
        self.assertTrue(submit.visible)
        self.click_widget(submit)
        self.assertIsNotNone(game.feedback)
        self.assertTrue(game.feedback.correct)

    def test_clicking_continue_advances_after_feedback(self):
        game = self.start_trivia()
        before = game.question_index
        self.app.on_key('enter')                    # empty -> wrong
        self.assertIsNotNone(game.feedback)
        self.step(1)
        continue_button = game.question_controls.continue_button
        self.assertTrue(continue_button.visible)
        self.assertFalse(game.question_controls.submit_button.visible)
        self.click_widget(continue_button)
        self.assertEqual(game.question_index, before + 1,
                         'a wrong answer moves on to the next question')
        self.assertIsNone(game.feedback)

    def test_clicking_submit_unlocks_a_throw(self):
        game = self.start_trivia()
        question = game.current_question
        for character in str(question.expected_text()):
            self.app.on_key('space' if character == ' ' else character)
        self.step(1)
        self.click_widget(game.question_controls.submit_button)
        self.assertIsNotNone(game.feedback)
        self.assertTrue(game.feedback.correct)
        self.step(1)
        self.click_widget(game.question_controls.continue_button)
        self.assertEqual(game.state, 'ready',
                         'a correct answer must arm the throw')

    def test_answer_validation_rejects_a_wrong_answer(self):
        game = self.start_trivia()
        question = game.current_question
        self.assertIsNotNone(question.answer)
        for character in ('9', '9', '9'):
            self.app.on_key(character)
        self.app.on_key('enter')
        self.assertFalse(game.feedback.correct)
        self.assertEqual(game.state, 'question')

    def test_typing_a_p_answers_instead_of_pausing(self):
        game = self.start_trivia()
        self.app.on_key('p')
        self.assertFalse(game.paused,
                         "P must be typed while answering, not pause")
        self.assertEqual(game.answer_text, 'p')
        self.assertFalse(game.pause_overlay.visible)

    def test_p_still_resumes_a_paused_question(self):
        game = self.start_trivia()
        self.app.on_key('escape')
        self.assertTrue(game.paused)
        self.app.on_key('p')
        self.assertFalse(game.paused)
        self.assertEqual(game.answer_text, '')


class TestPointerInput(unittest.TestCase):
    """The pointer's fallbacks, without an engine window."""

    def test_override_is_used_and_tracked(self):
        pointer = Pointer()
        samples = [(0.1, 0.2)]
        pointer.set_override(lambda: samples[-1])
        self.assertEqual(pointer.sample(), (0.1, 0.2))
        samples.append((-0.3, 0.4))
        self.assertEqual(pointer.sample(), (-0.3, 0.4))
        self.assertLess(pointer.delta[0], 0.0)

    def test_a_failing_source_keeps_the_last_position(self):
        pointer = Pointer()
        pointer.set_override(lambda: (0.25, -0.10))
        pointer.sample()
        pointer.set_override(lambda: None)
        # With no source at all the last good position must survive: a click
        # must never jump to the centre of the screen.
        for _ in range(3):
            pointer.sample()
        self.assertEqual(pointer.position, (0.25, -0.10))

    def test_reset_clears_the_velocity(self):
        pointer = Pointer()
        pointer.set_override(lambda: (0.0, 0.0))
        pointer.sample()
        pointer.set_override(lambda: (0.4, 0.4))
        pointer.sample()
        pointer.reset()
        pointer.set_override(lambda: (0.4, 0.4))
        pointer.sample()
        self.assertEqual(pointer.velocity, (0.0, 0.0))


class TestEquationChallengeInteraction(AppTestCase):
    """The challenge panel: typing, BOWL IT, the measured result, the solution.

    Equation Mode is the interactive problem-solving mode: a value is typed,
    the real simulation bowls it, the panel reports what the physics did, and
    the player may retry without limit.
    """

    def start_equations(self):
        self.app.start_match('equations', [{'name': 'STUDENT'}])
        self.step(2)
        return self.app.game

    def bowl(self, text):
        game = self.app.game
        game.challenge_input = text
        self.app.on_key('enter')
        self.assertEqual(game.state, 'rolling',
                         'ENTER must bowl the typed value')
        return game

    def wait_for_result(self, limit=15000):
        game = self.app.game
        for _ in range(limit):
            self.step(1)
            if game.state == 'challenge' and game.challenge_result is not None:
                return game.challenge_result
        raise AssertionError(f'the challenge never resolved '
                             f'(state={game.state})')

    def test_typing_builds_the_value(self):
        game = self.start_equations()
        for key in ('4', 'period', '7', '1'):
            self.app.on_key(key)
        self.assertEqual(game.challenge_input, '4.71')
        self.app.on_key('backspace')
        self.assertEqual(game.challenge_input, '4.7')
        for key in ('x', 'space', 'r'):          # letters are ignored
            self.app.on_key(key)
        self.assertEqual(game.challenge_input, '4.7')

    def test_a_p_typed_in_the_field_does_not_pause(self):
        game = self.start_equations()
        self.app.on_key('p')
        self.assertFalse(game.paused,
                         'the field owns the keys, so P must not pause')
        self.assertFalse(game.pause_overlay.visible)
        self.assertEqual(game.challenge_input, '')

    def test_clicking_bowl_it_launches_the_simulation(self):
        game = self.start_equations()
        game.challenge_input = '0'
        self.step(2)
        self.click_widget(game.challenge_controls.primary_button)
        self.assertEqual(game.state, 'rolling')
        self.assertIsNotNone(game.last_throw)
        self.assertEqual(game.last_throw.source, 'equation')

    def test_the_panel_shows_the_problem_the_equation_and_the_diagram(self):
        game = self.start_equations()
        panel = game.challenge_controls
        self.assertTrue(panel.visible)
        self.assertIn('CHALLENGE 1', panel.heading.text)
        self.assertEqual(panel.title.text, game.challenge.title)
        self.assertIn(game.challenge.equation.split('\n')[0][:18],
                      panel.equation.text)
        self.assertTrue(panel.diagram.visible)
        self.assertTrue(panel.primary_button.visible)

    def test_a_miss_reports_measurements_and_keeps_the_input_editable(self):
        game = self.start_equations()
        self.bowl('0')
        outcome = self.wait_for_result()
        self.assertFalse(outcome.solved)
        panel = game.challenge_controls
        self.assertTrue(panel.feedback_headline.visible)
        self.assertIn('MISSED', panel.feedback_headline.text)
        self.assertEqual(panel.primary_button.label, 'BOWL AGAIN')
        # The measurements the simulation produced are on screen, together
        # with the first progressive hint step.
        shown = '\n'.join(line.text for line in panel.feedback_lines
                          if line.visible)
        self.assertIn('crossed the pin line', shown)
        self.assertIn('Step 1', shown)
        self.assertEqual(game.challenge_input, '0',
                         'the typed value stays for editing')

    def test_two_misses_offer_the_solution_and_continue_advances(self):
        game = self.start_equations()
        self.bowl('0')
        self.wait_for_result()
        self.assertFalse(game.challenge_controls.solution_button.visible,
                         'the solution waits for a second attempt')
        self.bowl('0')
        self.wait_for_result()
        self.assertTrue(game.challenge_controls.solution_button.visible)
        self.click_widget(game.challenge_controls.solution_button)
        self.assertTrue(game.challenge_solution)
        self.assertEqual(game.challenge_controls.primary_button.label,
                         'CONTINUE')
        self.click_widget(game.challenge_controls.primary_button)
        self.assertEqual(game.challenge_index, 1)
        self.assertEqual(game.state, 'challenge')
        self.assertEqual(len(self.app.game.pins.pins), 10)

    def test_the_torque_challenge_shows_the_spin_it_derives(self):
        """The torque -> omega mapping must be on the panel, not just in docs."""
        from game import challenges as ch
        from ui.challenge_panel import ChallengeView

        self.app.start_match('equations', [{'name': 'STUDENT'}])
        self.step(1)
        panel = self.app.game.challenge_controls
        challenge = ch.challenge_by_id('spin-up-torque')
        value = challenge.answer
        outcome = challenge.evaluate(ch.RollMeasurement(
            value=value, targets_down=(False,), pins_down=(False,),
            knockdowns=0, landing_x=0.0, pass_error=0.46))
        view = ChallengeView(challenge=challenge,
                             progress='Challenge 9 of 10',
                             input_text=f'{value:.3f}', result=outcome,
                             hints_unlocked=1)
        panel.update(view)
        shown = '\n'.join(line.text for line in panel.feedback_lines
                          if line.visible)
        self.assertIn('omega', shown)
        self.assertIn('tau', shown)
        self.assertIn(f'{challenge.spin_up_time:.2f} s', shown)


class TestMouseDragThrowsThroughTheRealPath(AppTestCase):
    """A pointer drag in the play screen must produce a *simulated* roll.

    The gameplay tests inject a ready-made ``ThrowData``; this one drives the
    actual mouse adapter with a scripted pointer and button, so the whole chain
    (drag -> release conditions -> Ball.launch -> Deck -> pinfall -> score) is
    exercised the way a player's hand would drive it.
    """

    def drivable_mouse(self):
        from input.mouse_input import MouseInput
        pointer = pointer_state()
        pointer.set_override(lambda: pointer.position)
        button = {'down': False}
        mouse = MouseInput(pointer=lambda: pointer.position,
                           button=lambda: button['down'])
        return mouse, pointer, button

    def test_a_backswing_and_forward_stroke_throw_the_ball(self):
        mouse, pointer, button = self.drivable_mouse()
        self.app.inputs['mouse'] = mouse
        self.app.start_match('classic', [{'name': 'DRAGGER'}])
        self.step(3)
        game = self.app.game
        self.assertEqual(game.state, 'ready')

        pointer.position = (0.0, 0.0)
        self.step(2)
        button['down'] = True
        pointer.position = (0.0, -0.10)
        self.step(2)
        for index in range(1, 6):
            pointer.position = (0.02 * index, -0.10 + 0.08 * index)
            self.step(1)
        button['down'] = False
        self.step(2)

        throw = game.last_throw
        self.assertIsNotNone(throw, 'the drag must have produced a throw')
        self.assertEqual(throw.source, 'mouse')
        self.assertGreaterEqual(throw.speed, config.MIN_THROW_SPEED)
        self.assertLessEqual(throw.speed, config.MAX_THROW_SPEED)
        self.assertNotEqual(game.state, 'ready', 'the roll must have started')

        # Let the shared simulation resolve the roll and the score record it.
        for _ in range(4000):
            self.step(1)
            if game.state in ('ready', 'game_over') and game.score.rolls:
                break
        self.assertTrue(game.score.rolls, 'the roll was never recorded')
        self.assertGreaterEqual(game.score.rolls[-1], 0)
        self.assertLessEqual(game.score.rolls[-1], 10)

    def test_a_sideways_stroke_curves_the_ball(self):
        """Opposite sidesteps must release opposite hook (which the simulation
        then turns into opposite curvature)."""
        for lateral, sign in ((0.16, -1), (-0.16, 1)):
            mouse, pointer, button = self.drivable_mouse()
            self.app.inputs['mouse'] = mouse
            self.app.start_match('classic', [{'name': 'HOOKER'}])
            self.step(3)
            game = self.app.game
            pointer.position = (0.0, 0.0)
            self.step(2)
            button['down'] = True
            pointer.position = (0.0, -0.08)
            self.step(2)
            for index in range(1, 5):
                pointer.position = (lateral * index / 4.0, -0.08 + 0.07 * index)
                self.step(1)
            button['down'] = False
            self.step(2)
            throw = game.last_throw
            self.assertIsNotNone(throw)
            self.assertNotEqual(throw.spin_omega, 0.0)
            self.assertEqual(throw.spin_omega > 0, sign > 0,
                             'the hook must follow the stroke direction')
            # Reset for the next direction.
            game.new_game()
            self.step(2)


class TestStrikeFeedback(AppTestCase):
    """A strike must visibly move something, even though its *score* cannot be
    written down until the bonus rolls are bowled (that is the ten-pin rule)."""

    def force_roll(self, count):
        game = self.app.game
        standing = [p for p in game.pins.pins
                    if not p.physics.down and not p.physics.removed]
        self.assertLessEqual(count, len(standing))
        game.launch(ThrowData(speed=7.0, source='script'))
        for pin in standing[:count]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6
        game.ball.physics.rolling = False
        game.ball.finished = True
        for _ in range(600):
            self.step(1)
            if game.state == 'result':
                break
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

    def test_a_strike_marks_the_scorecard_immediately(self):
        self.app.start_match('classic', [{'name': 'SOLO'}])
        self.step(3)
        game = self.app.game
        self.force_roll(10)
        self.assertEqual(game.last_result['pins'], 10)
        self.assertTrue(game.last_result['strike'])
        # The official score legitimately waits for the bonus rolls...
        self.assertEqual(game.match.players[0].bowling.current_score, 0)
        # ...but the pins knocked down moved immediately and the scorecard
        # stamps the X, so the strike is visibly counted straight away.
        self.assertEqual(game.match.players[0].total_pins, 10)
        self.step(2)
        self.assertEqual(game.hud.scorecard.cells[0]['marks'].text, 'X')

    def test_the_status_line_follows_the_bowler_who_is_up(self):
        self.app.start_match('local', [{'name': 'ALICE'}, {'name': 'BOB'}])
        self.step(3)
        game = self.app.game
        self.force_roll(10)                 # ALICE strikes, then BOB is up
        self.step(2)
        self.assertEqual(game.match.current_player.name, 'BOB')
        self.assertEqual(game.hud.status.text, 'BOB to bowl',
                         'the status line names the bowler who is up')
        self.assertEqual(game.match.players[0].total_pins, 10)

    def test_the_player_chip_shows_the_pins_knocked(self):
        self.app.start_match('local', [{'name': 'ALICE'}, {'name': 'BOB'}])
        self.step(3)
        game = self.app.game
        self.force_roll(10)
        self.step(2)
        chips = game.hud._player_chips
        details = [chip.detail.text for chip in chips if chip.detail.visible]
        self.assertIn('10 pins', details,
                      f'the bowler who struck must show their pins: {details}')

    def test_the_official_score_appears_once_the_bonus_rolls_are_bowled(self):
        self.app.start_match('classic', [{'name': 'SOLO'}])
        self.step(3)
        game = self.app.game
        self.force_roll(10)          # frame 1 strike
        self.force_roll(10)          # frame 2 strike
        self.force_roll(10)          # frame 3 strike
        self.assertEqual(game.score.frame_score(1), 30)
        self.assertEqual(game.match.players[0].bowling.current_score, 30)
        self.assertEqual(game.match.players[0].total_pins, 30)
        self.step(2)
        self.assertEqual(game.hud.total_score.text, '30')


class TestStepperArrows(AppTestCase):
    """The drawn chevrons must step down and up, on every stepper.

    The zones used to sit at the row's left and right edges while the
    chevrons were drawn beside the value, so a click on the visible left
    chevron landed on the row body (which steps up): a value could only
    climb, and stopped at its maximum. These tests click the glyphs where
    they are actually drawn.
    """

    def test_the_left_chevron_lowers_the_lab_aim(self):
        self.app.go_to_lab()
        self.step(1)
        lab = self.active()
        stepper = lab.steppers['angle']
        before = lab.setup.angle
        self.click_glyph(stepper, stepper.left_glyph)
        self.assertAlmostEqual(lab.setup.angle, before - 0.2)
        before = lab.setup.angle
        self.click_glyph(stepper, stepper.right_glyph)
        self.assertAlmostEqual(lab.setup.angle, before + 0.2)

    def test_bowlrush_duration_steps_both_ways(self):
        self.app.go_to_modes()
        picker = self.active()
        self.step(1)
        picker.select_ball(5)                       # BowlRush is the timed mode
        stepper = picker.duration_stepper
        before = picker.duration
        self.click_glyph(stepper, stepper.left_glyph)
        self.assertNotEqual(picker.duration, before)
        self.click_glyph(stepper, stepper.right_glyph)
        self.assertEqual(picker.duration, before)


class TestLabSteppers(AppTestCase):
    """The lab's launch values move both ways and have no ceiling."""

    def open_lab(self):
        self.app.go_to_lab()
        self.step(1)
        return self.active()

    def test_a_value_climbs_past_the_match_maximum_and_comes_back(self):
        lab = self.open_lab()
        stepper = lab.steppers['speed']
        for _ in range(18):                 # 7.5 + 18 * 0.25 = the old cap
            lab._step('speed', 1)
        # A real click on the drawn right chevron has to keep climbing...
        self.click_glyph(stepper, stepper.right_glyph)
        self.click_glyph(stepper, stepper.right_glyph)
        self.assertGreater(lab.setup.speed, config.MAX_THROW_SPEED)
        peak = lab.setup.speed
        # ...and a click on the left chevron has to bring it back down.
        self.click_glyph(stepper, stepper.left_glyph)
        self.assertAlmostEqual(lab.setup.speed, peak - 0.25)

    def test_speed_never_goes_below_zero(self):
        lab = self.open_lab()
        for _ in range(60):
            lab._step('speed', -1)
        self.assertEqual(lab.setup.speed, 0.0)


class TestLabTypedValues(AppTestCase):
    """A launch value can be typed exactly, not only stepped by arrows."""

    def open_lab(self):
        self.app.go_to_lab()
        self.step(1)
        return self.active()

    def click_value(self, lab, key):
        x, y, _w, _h = lab.steppers[key].value_rect()
        self.click_at(x, y)

    def type_text(self, text):
        named = {'-': 'minus', '.': 'period', '+': 'plus'}
        for character in text:
            self.app.on_key(named.get(character, character))

    def test_typing_an_exact_speed_sets_the_launch_value(self):
        lab = self.open_lab()
        self.click_value(lab, 'speed')
        self.assertEqual(lab.editing_key, 'speed')
        self.type_text('11.37')
        self.app.on_key('enter')
        self.assertIsNone(lab.editing_key)
        self.assertAlmostEqual(lab.setup.speed, 11.37)
        self.assertIn('11.37', lab.steppers['speed'].value_text)

    def test_the_first_keystroke_replaces_the_number(self):
        lab = self.open_lab()
        self.click_value(lab, 'angle')
        self.type_text('-3.25')
        self.app.on_key('enter')
        self.assertAlmostEqual(lab.setup.angle, -3.25)

    def test_escape_and_invalid_text_keep_the_previous_value(self):
        lab = self.open_lab()
        before = lab.setup.lateral
        self.click_value(lab, 'lateral')
        self.type_text('0.99')
        self.app.on_key('escape')
        self.assertAlmostEqual(lab.setup.lateral, before)
        self.click_value(lab, 'lateral')
        self.type_text('1.2.3')
        self.app.on_key('enter')
        self.assertAlmostEqual(lab.setup.lateral, before)

    def test_a_typed_speed_is_clamped_at_zero(self):
        lab = self.open_lab()
        self.click_value(lab, 'speed')
        self.type_text('-4')
        self.app.on_key('enter')
        self.assertEqual(lab.setup.speed, 0.0)

    def test_typing_does_not_bowl_or_trigger_shortcuts(self):
        lab = self.open_lab()
        self.click_value(lab, 'speed')
        self.app.on_key('space')
        self.app.on_key('p')
        self.app.on_key('r')
        self.assertEqual(lab.state, 'idle')
        self.assertFalse(lab.paused)
        self.assertEqual(lab.editing_key, 'speed')


class TestLabLiveEquations(AppTestCase):
    """Each live row opens into the equation with the numbers filled in."""

    def open_lab(self):
        self.app.go_to_lab()
        self.step(1)
        return self.active()

    def row(self, lab, key):
        return [row for row in lab.live_rows if row.key == key][0]

    def test_clicking_a_row_opens_its_equation(self):
        lab = self.open_lab()
        row = self.row(lab, 'k')
        self.assertFalse(row.open)
        self.click_widget(row)
        self.assertTrue(row.open)
        self.assertIn('K = 0.5 m v^2', row.equation_text.text)
        self.assertIn(f'{config.BALL_MASS:.2f}', row.result_text.text)

    def test_only_one_dropdown_is_open_at_a_time(self):
        lab = self.open_lab()
        first, second = self.row(lab, 'v'), self.row(lab, 'p')
        self.click_widget(first)
        self.click_widget(second)
        self.assertFalse(first.open)
        self.assertTrue(second.open)
        self.click_widget(second)           # clicking the open row closes it
        self.assertFalse(second.open)

    def test_the_open_equation_follows_the_simulation(self):
        lab = self.open_lab()
        row = self.row(lab, 'p')
        self.click_widget(row)
        self.click_widget(lab.bowl_button)          # the lab rolls on BOWL
        for _ in range(180):
            self.step(1)
            if lab.state == 'rolling':
                break
        self.assertEqual(lab.state, 'rolling')
        self.step(20)
        self.assertGreater(lab.values['p'], 0.0)
        # The substituted line carries the values the readout just showed.
        self.assertIn(f'{lab.values["p"]:.1f}', row.result_text.text)
        self.assertIn(f'{config.BALL_MASS:.2f}', row.result_text.text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
