"""The play screen: one mode, its players, and the shared bowling simulation.

This is the class the game has always had at its centre, extended from a
single classic game into every mode. It owns:

* the **roll lifecycle** - ``ready -> rolling -> settling -> result`` - during
  which the ball and the pins are integrated together by the shared
  :class:`physics.Deck` (through :class:`scene.pins.PinRack`);
* the **match** - players, turns, frames and scores (:mod:`game.session`);
* the **mode rules** - question gates (Trivia, Equations), the countdown
  (BowlRush), the bot's turns (Player vs Bot) and local turn handoff;
* the **presentation** - the HUD, the avatar, the overlays and the camera.

Every mode runs the *same* simulation. A mode changes who throws, when, what
counts as a score and what is shown - never how a pin falls.

Input adapters (:mod:`input.mouse_input`, :mod:`input.webcam_input`) produce
the same ``ThrowData`` launch conditions, so a webcam throw, a mouse throw and
the bot's throw all enter the simulation through ``Ball.launch``.
"""
import math

from ursina import Entity, camera, time

import config
import game.modes as modes
from avatar import character as avatar_states
from avatar.character import Bowler
from game.bot import BotPlanner
from game.challenges import (RollMeasurement, challenges_for_session,
                             pin_speed_from_impact)
from game.questions import check_answer, parse_answer, trivia_for_session
from game.session import Match
from input.mouse_input import MouseInput, ThrowData
from input.webcam_input import WebcamInput
from motion import MotionDirector
from scene.ball import Ball
from scene.camera import (fov_push_in, fov_reset, set_shake_provider, set_view,
                          setup_camera, update_camera)
from scene.lane import build_lane
from scene.pins import PinRack
from ui import theme
from ui.challenge_panel import ChallengeView
from ui.hud import Hud
from ui.overlays import HandoffBanner, PauseOverlay, ResultsOverlay
from ui.webcam_panel import WebcamPanel
from scoring import BowlingGame

# Where the current bowler stands on the approach (left of the lane), so the
# ball and the pins stay clear and the character is visible in the lower-left
# of the frame without standing in front of the lane.
AVATAR_X = -1.35
AVATAR_Z = -0.15
AVATAR_SECOND_X = 1.35          # the second player stands on the other side

# Bot presentation timeline (seconds): plan -> set -> swing -> release.
BOT_PREPARE_TIME = 0.7
BOT_SWING_TIME = 0.45

# Webcam handoff: tracking must be stable this long before the ready pose is
# accepted, and the ready pose must be held this long to confirm the turn.
HANDOFF_STABLE_TIME = 0.6
HANDOFF_CONFIRM_TIME = 1.2
# A handoff can always be confirmed with a key, so a camera problem can never
# leave the match waiting forever.
HANDOFF_TIMEOUT = 25.0

# The fading trail behind a rolling ball (presentation only): how many samples
# are kept and how far apart they are taken. A curved hook is what this makes
# visible: the markers follow the simulated path, not a straight line.
TRAIL_MAX = 52
TRAIL_SPACING = 0.30            # m between samples
TRAIL_LENGTH = 7.0              # m the intended-line indicator is drawn for


def _clamp(value, low, high):
    return max(low, min(high, value))


class Game:
    """The play screen. States: question | ready | rolling | settling | result
    | handoff | game_over (plus the orthogonal ``paused`` flag)."""

    name = 'play'
    camera_view = 'game'

    def __init__(self, inputs=None, audio=None, settings=None, app=None):
        self.app = app
        self.audio = audio
        self.settings = settings
        self.state = 'ready'
        self.timer = 0.0
        self.settle_elapsed = 0.0
        self.knockdowns = 0
        self.score = BowlingGame()

        build_lane()
        self.ball = Ball()
        self.pins = PinRack()
        self.inputs = inputs if inputs is not None else {
            'mouse': MouseInput(),
            'webcam': WebcamInput(),
        }
        self.input_mode = 'mouse'
        self._webcam_status = None
        self._webcam_error_handled = False
        self.message = ''
        self.message_timer = 0.0
        self.message_warning = False
        # The play screen's own UI lives under one root so it can be hidden
        # whenever another screen is on top (the HUD and overlays must never
        # draw over the menus).
        self.ui_root = Entity(parent=camera.ui, enabled=False)
        self.webcam_panel = WebcamPanel(parent=self.ui_root)
        self.hud = Hud(parent=self.ui_root)
        self.question_controls = self.hud.question_panel
        self.question_controls.set_callbacks(self.submit_answer,
                                             self.continue_question)
        self.challenge_controls = self.hud.challenge_panel
        self.challenge_controls.set_callbacks(self._challenge_primary,
                                              self.show_challenge_solution)
        setup_camera()

        # Aim guide and ball trail are drawn by the motion layer
        # (motion/scene_fx.py: AimGuide and BallTrail), registered through the
        # director below: the dashes march forward, the trail fades along the
        # roll, and both are pooled and reusable.

        # Mode / match state.
        self.mode = modes.CLASSIC
        self.match = None
        self.paused = False
        self.last_throw = None
        self.last_result = None
        self.pending_action = 'next_roll'
        # The session's best total per mode: the results screen celebrates a
        # match that beats the previous one (see _finish_match). Kept off the
        # match itself so a rematch still knows the record it has to beat.
        self._best_scores = {}
        self._impact_announced = False
        self.questions = []
        self.question_index = 0
        self.current_question = None
        self.answer_text = ''
        self.feedback = None
        self.question_count = 0
        self.attempts = 0
        self.hints_unlocked = 0
        self.throw_earned = False
        # Equation Mode: the challenge bank, the current problem and its state.
        self.challenges = []
        self.challenge_index = 0
        self.challenge = None
        self.challenge_input = ''
        self.challenge_result = None
        self.challenge_attempts = 0
        self.challenge_hints = 0
        self.challenge_solution = ''
        self.challenge_error = ''
        self.challenge_value = None      # the last submitted value, for display
        self._challenge_measurement = None
        self._challenge_path = ()
        self._challenge_launched = False
        self._bot = None
        self._bot_phase = 'idle'
        self._bot_timer = 0.0
        self._handoff_timer = 0.0
        self._handoff_stable = 0.0
        self._handoff_progress = 0.0
        # Empty until a throw has happened: the compact physics readout only
        # appears once there is something real to show (the old placeholder
        # line was an empty box in the corner of every fresh match).
        self._physics_lines = []
        self.show_physics_panel = True
        self.results_lines = []
        self._swing_pose = 0.0

        # Avatars (one per player slot, built on demand).
        self._avatars = {}
        self._active_avatar = None

        # Overlays.
        self.pause_overlay = PauseOverlay(
            on_resume=self.resume,
            on_restart=self.restart_match,
            on_menu=self._quit_to_menu,
            on_settings=self._open_settings,
            parent=self.ui_root,
        )
        self.results_overlay = ResultsOverlay(
            on_rematch=self.restart_match,
            on_menu=self._quit_to_menu,
            on_lab=self._open_lab,
            parent=self.ui_root,
        )
        self.handoff_banner = HandoffBanner(parent=self.ui_root)
        self._overlay = None

        # The animation system. It owns every effect and exposes the trigger
        # functions the game calls (onThrowRelease, onPinsResolved,
        # onFrameAdvance, onGameEnd, ...); see the module docstring of
        # motion/director.py and docs/ANIMATION.md for the wiring.
        self.motion = MotionDirector(hud=self.hud, ball=self.ball,
                                     pins=self.pins)
        self.motion.bind_overlays(pause=self.pause_overlay,
                                  results=self.results_overlay)
        set_shake_provider(self.motion.camera_shake)
        self._motion_dt = 1.0 / 60.0

        self.start_match(modes.CLASSIC, [{'name': 'PLAYER 1'}])

    # ==================================================================
    # Match setup
    # ==================================================================
    def start_match(self, mode, player_specs=None, duration=None):
        """Begin a match of ``mode`` with the given players."""
        self.mode = mode
        self.match = Match.create(mode, player_specs, duration=duration)
        # The HUD reads the current player's scorer; keep it in step from the
        # first frame (question-gated modes never pass through _enter_ready
        # before their first question).
        self.score = self.match.current_player.bowling
        # A new match always starts on a fresh rack, so the deck on screen
        # matches what the first throw will face.
        self.pins.reset()
        self.paused = False
        self.question_index = 0
        self.answer_text = ''
        self.feedback = None
        self.current_question = None
        self.challenge_index = 0
        self.challenge = None
        self.challenge_input = ''
        self.challenge_result = None
        self.challenge_attempts = 0
        self.challenge_hints = 0
        self.challenge_solution = ''
        self.challenge_error = ''
        self.challenge_value = None
        self._challenge_measurement = None
        self._challenge_path = ()
        self._challenge_launched = False
        if mode.gate == modes.GATE_TRIVIA:
            self.questions = trivia_for_session(mode.questions or None)
            self.challenges = []
        elif mode.gate == modes.GATE_EQUATIONS:
            self.questions = []
            self.challenges = challenges_for_session(mode.questions or None)
        else:
            self.questions = []
            self.challenges = []
        self.question_count = len(self.questions) or len(self.challenges)
        self._bot = None
        self._physics_lines = []
        self.results_lines = []
        self.last_throw = None
        self.last_result = None
        self._hide_overlays()
        self._show_avatar_for(self.match.current_player)
        set_view('game')
        # The scoreboard drops in, the player card slides in, the key chips
        # fade up: one trigger for the whole screen (section 1/2/4).
        self.motion.onMatchStart(self.input_mode,
                                 throws=self.match.current_player.throws)
        if self.mode.gate == modes.GATE_EQUATIONS:
            self._enter_challenge(first=True)
        elif self.mode.gate != modes.GATE_NONE:
            self._enter_question(first=True)
        else:
            self._enter_ready()

    def configure(self, mode_id, player_specs=None, duration=None):
        """Start a match by mode id (used by the app and the tests)."""
        return self.start_match(modes.get(mode_id), player_specs, duration)

    def new_game(self):
        """Restart the current match from scratch (same mode and players)."""
        return self.restart_match()

    def restart_match(self):
        """Reset the match: same mode, players and settings, fresh scores."""
        specs = [{'name': p.name, 'rgb': p.rgb, 'is_bot': p.is_bot,
                  'difficulty': p.difficulty} for p in self.match.players]
        previous_mode = self.mode
        duration = self.match.duration if previous_mode.timed else None
        self.paused = False
        self.start_match(previous_mode, specs, duration=duration)
        self._show_message('New match: ' + previous_mode.title, 2.5)
        return self

    def show(self, **kwargs):
        """Screen protocol: the play screen is active."""
        self.paused = False
        self.ui_root.enabled = True
        for avatar in self._avatars.values():
            avatar.enabled = True
        set_view('game')
        self.input_source.discard_pending()

    def hide(self):
        """Screen protocol: leave the play screen (menus, lab, ...)."""
        self._hide_overlays()
        self.ui_root.enabled = False
        # The avatars are scene entities, so they have to leave with the
        # screen: otherwise the bowler keeps standing beside the lane behind
        # every menu (and doubles up with the menu character).
        for avatar in self._avatars.values():
            avatar.enabled = False
        reset = getattr(self.input_source, 'reset', None)
        if callable(reset):
            reset()
        webcam = self.inputs.get('webcam')
        set_ready = getattr(webcam, 'set_game_ready', None)
        if callable(set_ready):
            set_ready(False)

    # ------------------------------------------------------------- helpers
    @property
    def input_source(self):
        """The ThrowSource currently driving the ball."""
        return self.inputs[self.input_mode]

    @property
    def current_player(self):
        return self.match.current_player if self.match is not None else None

    def _show_message(self, text, duration=None, warning=False):
        self.message = text
        self.message_timer = config.MESSAGE_DURATION if duration is None else duration
        self.message_warning = warning

    @staticmethod
    def _input_lifecycle(source, action):
        method = getattr(source, action, None)
        if callable(method):
            method()

    def set_input_mode(self, mode, announce=True):
        """Switch input sources without touching the game state or score."""
        if mode not in self.inputs or mode == self.input_mode:
            return
        self.inputs[self.input_mode].discard_pending()
        reset = getattr(self.inputs[self.input_mode], 'reset', None)
        if callable(reset):
            reset()
        if self.input_mode == 'webcam':
            self._input_lifecycle(self.inputs['webcam'], 'stop')
        self.input_mode = mode
        self.inputs[mode].discard_pending()
        self._webcam_error_handled = False
        if mode == 'webcam':
            self._input_lifecycle(self.inputs['webcam'], 'start')
            if announce:
                self._show_message(
                    'Webcam mode: stand where your upper body is visible '
                    'and wait for tracking.', 6.0)
        elif announce:
            self._show_message('Mouse mode.', 2.0)

    # ==================================================================
    # Roll lifecycle
    # ==================================================================
    def _enter_ready(self):
        """Configure the ball and rack for the next roll.

        The scorer decides how many pins the roll faces; the rack is rebuilt
        from that number and never from its own leftover state:

        * a full rack (10) means a fresh frame, or a reset after a strike or
          spare in the tenth frame, so every pin is re-stood and put back in
          play;
        * otherwise the pins this frame already knocked down are swept away
          (hidden and out of play) and only the survivors are re-stood.

        Every mode funnels through here, so the pin bookkeeping is identical
        for a classic frame, a Trivia throw, the bot's turn and a BowlRush
        throw; only ``resolves_every_throw`` modes always rebuild the rack.
        """
        self.input_source.discard_pending()
        self.score = self.match.current_player.bowling
        self.ball.reset(lateral=self.input_source.lateral)
        standing = None if self.mode.resolves_every_throw \
            else self.score.standing_pins()
        if standing is None or standing >= self.score.MAX_PINS:
            self.pins.reset()
            full_reset = True
        else:
            self.pins.sweep()
            self.pins.restore_survivors()
            full_reset = False
        self._check_rack()
        # Presentation only: the sweeper lowers, clears, and the pins drop
        # back in with a quick stagger (section 6). The physics reset above
        # has already happened.
        self.motion.onPinReset(standing=standing, full=full_reset)
        self.motion.onFrameChange(self.score.current_frame_number)
        fov_reset()
        self.knockdowns = 0
        self.settle_elapsed = 0.0
        self.state = 'ready'
        self.timer = 0.0
        self._bot_reset()
        self._set_avatar_state(avatar_states.READY)
        self._show_ball_for_ready()

    def _check_rack(self):
        """Keep the rack and the scorer in agreement before a roll starts."""
        if self.mode.resolves_every_throw:
            return
        standing = self.score.standing_pins()
        if standing is None or self.pins.standing_count() == standing:
            return
        print(f'[strike-lab] rack/scorer mismatch: rack has '
              f'{self.pins.standing_count()} standing pin(s), the scorer '
              f'expects {standing}; rebuilding the rack')
        if standing >= self.score.MAX_PINS:
            self.pins.reset()
        else:
            self.pins.sweep()
            self.pins.restore_survivors()

    def _begin_roll(self):
        """Freeze the rack as the starting state of the roll about to start."""
        self.knockdowns = 0
        self.settle_elapsed = 0.0
        self._hit_announced = False
        self._impact_announced = False
        self.pins.begin_roll()

    def _count_roll(self):
        """Pins this roll knocked down, as the scorer will record them."""
        counted = self.pins.knockdown_count()
        if self.mode.resolves_every_throw:
            return counted
        standing = self.score.standing_pins()
        if standing is not None and counted > standing:
            print(f'[strike-lab] rack/scorer mismatch: the rack counted '
                  f'{counted} pin(s) but only {standing} are standing; '
                  f'recording {standing}')
            counted = standing
        return counted

    def launch(self, throw):
        """Send a throw into the simulation (the single entry point)."""
        self.last_throw = throw
        self._begin_roll()
        self.ball.launch(throw)
        self.state = 'rolling'
        self._play('release')
        self._set_avatar_state(avatar_states.FOLLOW
                               if throw.source == 'bot'
                               else avatar_states.RELEASE)
        # Trigger: the throw left the hand. The power meter flashes out, the
        # aim guide fades over 150 ms and a dust puff kicks off the foul line.
        self.motion.onThrowRelease(throw, power=self._drag_power())

    # ==================================================================
    # Question gate (Trivia / Equations)
    # ==================================================================
    def _enter_question(self, first=False):
        """Show the next question; a correct answer earns one throw."""
        if self.question_index >= len(self.questions):
            self._finish_match()
            return
        self.current_question = self.questions[self.question_index]
        self.answer_text = ''
        self.feedback = None
        self.attempts = 0
        self.hints_unlocked = 0
        self.throw_earned = False
        self.state = 'question'
        self.timer = 0.0
        self.score = self.match.current_player.bowling
        if not first:
            self.input_source.discard_pending()
        self._set_avatar_state(avatar_states.WAIT)
        self._update_physics_readout()

    def submit_answer(self):
        """Mark the typed answer against the current question.

        The challenge is a progressive calculator, like the case studies it is
        modelled on: a wrong answer does not just end the question, it unlocks
        the next hint step so the player can see where their reasoning went
        wrong. The *throw* is still earned by the first attempt only (a wrong
        first answer forfeits that question's throw), and once every hint is
        unlocked the question closes and shows the worked solution.
        """
        if self.state != 'question' or self.current_question is None:
            return None
        if self.feedback is not None:
            if self.feedback.correct or self.attempts_left <= 0:
                self.continue_question()
                return self.feedback
            # A retry with the same text: fall through and mark it again.
            self.feedback = None
        question = self.current_question
        self.attempts += 1
        self.feedback = check_answer(question, self.answer_text)
        if self.attempts == 1:
            # The session tally counts the first attempt: a retry earns the
            # explanation, not a second chance at the throw.
            self.throw_earned = self.feedback.correct
            self.match.record_answer(self.feedback.correct)
        if self.feedback.correct:
            self.timer = 3.0 if self.throw_earned else 2.4
            self._play('correct')
        else:
            self.hints_unlocked = min(len(question.hints),
                                      self.hints_unlocked + 1)
            # With hints left the question waits for a retry; otherwise the
            # explanation is shown for a few seconds and the challenge moves on
            # (ENTER or CONTINUE skips the wait).
            self.timer = 0.0 if self.attempts_left > 0 else 5.0
            self._play('wrong')
        return self.feedback

    def continue_question(self):
        """Leave the feedback: take the earned throw, or move on."""
        if self.state != 'question' or self.feedback is None:
            return False
        self._advance_question()
        return True

    @property
    def attempts_left(self):
        question = self.current_question
        if question is None:
            return 0
        return max(0, len(question.hints) - self.hints_unlocked)

    def _advance_question(self):
        """Move to the next question, or end a question-gated session.

        The throw is only granted when it was *earned* (a correct answer,
        normally on the first attempt). A question the player worked through
        with hints is closed and the challenge moves on.
        """
        if self.throw_earned:
            # A correct answer earned a throw; the question is consumed when
            # that throw has been resolved (see ``_resolve_roll``).
            self._enter_ready()
            return
        self.question_index += 1
        if self.question_index >= len(self.questions):
            self._finish_match()
        else:
            self._enter_question()

    @property
    def question_progress(self):
        total = len(self.questions)
        if not total:
            return ''
        return f'Question {min(self.question_index + 1, total)} of {total}'

    # ==================================================================
    # Equation Mode: interactive challenges
    # ==================================================================
    def _enter_challenge(self, first=False):
        """Set up the next challenge: its leave, its ball and the panel.

        Unlimited time and attempts: the challenge waits for a value, and the
        player may bowl as many times as they like (each attempt is a real
        simulated roll).
        """
        if self.challenge_index >= len(self.challenges):
            self._finish_match()
            return
        self.challenge = self.challenges[self.challenge_index]
        self.challenge_input = ''
        self.challenge_result = None
        self.challenge_attempts = 0
        self.challenge_hints = 0
        self.challenge_solution = ''
        self.challenge_error = ''
        self.challenge_value = None
        self._challenge_measurement = None
        self._challenge_path = ()
        self._challenge_launched = False
        self.state = 'challenge'
        self.timer = 0.0
        self.score = self.match.current_player.bowling
        if not first:
            self.input_source.discard_pending()
        self._challenge_setup()
        self._set_avatar_state(avatar_states.WAIT)
        self._update_physics_readout()

    def _challenge_setup(self):
        """Stand the challenge's leave and put the ball at the release point."""
        challenge = self.challenge
        self.pins.set_layout(challenge.positions())
        self.ball.reset(lateral=challenge.fixed.get('position', 0.0))
        self.knockdowns = 0
        self.settle_elapsed = 0.0
        self._bot_reset()
        # Presentation only: the pins drop back in with a quick stagger.
        self.motion.onPinReset(standing=len(challenge.rack), full=True)
        self.motion.onFrameChange(1)
        fov_reset()
        self._show_ball_for_ready()

    def _challenge_throw(self, challenge, value):
        """The player's value as the launch conditions the engine accepts."""
        position, speed, angle, spin = challenge.launch_values(value)
        return ThrowData(lateral_position=position,
                         launch_angle=math.radians(angle),
                         speed=speed, spin_omega=spin, source='equation')

    def submit_challenge(self):
        """Bowl the challenge with the typed value (the primary action)."""
        if self.state != 'challenge' or self.challenge is None:
            return None
        challenge = self.challenge
        if self.challenge_solution or (
                self.challenge_result is not None
                and self.challenge_result.solved):
            return self.continue_challenge()
        value, _unit = parse_answer(self.challenge_input)
        control = challenge.control
        if value is None:
            self.challenge_error = ('Enter a number to bowl - for example '
                                    '4.7 or -4.7. The unit is shown next to '
                                    'the field.')
            return None
        if value < control.low - 1e-9 or value > control.high + 1e-9:
            self.challenge_error = (
                f'That is outside the range this challenge tests '
                f'({control.low:g} to {control.high:g} {control.unit}).')
            return None
        self.challenge_error = ''
        self.challenge_value = value
        self.challenge_attempts += 1
        self.challenge_result = None
        self.pins.deck.record_start()
        throw = self._challenge_throw(challenge, value)
        self.launch(throw)
        return throw

    def continue_challenge(self):
        """Leave the marked challenge: next problem, or close the session."""
        if self.state != 'challenge' or self.challenge is None:
            return False
        solved = (self.challenge_result is not None
                  and self.challenge_result.solved)
        revealing = bool(self.challenge_solution)
        if not solved and not revealing:
            return False
        self.match.record_answer(solved)
        self.challenge_index += 1
        if self.challenge_index >= len(self.challenges):
            self._finish_match()
        else:
            self._enter_challenge()
        return True

    def show_challenge_solution(self):
        """Reveal the worked solution (offered after two failed attempts)."""
        if self.state != 'challenge' or self.challenge is None:
            return False
        if self.challenge_solution:
            return False
        self.challenge_solution = self.challenge.working
        self.challenge_error = ''
        return True

    def _resolve_challenge_roll(self):
        """Mark the roll the challenge just produced against the challenge."""
        challenge = self.challenge
        self.knockdowns = self._count_roll()
        player = self.match.current_player
        self.match.record_roll(self.knockdowns, advance=False)
        self.last_result = {
            'player': player.name,
            'pins': self.knockdowns,
            'strike': self.knockdowns >= len(challenge.rack),
        }
        measurement = self._challenge_measurement_for(challenge)
        outcome = challenge.evaluate(measurement)
        self._challenge_measurement = measurement
        self._challenge_path = measurement.path
        self._challenge_launched = True
        self.challenge_result = outcome
        self.challenge_value = measurement.value
        if not outcome.solved:
            self.challenge_hints = min(len(challenge.steps),
                                       self.challenge_hints + 1)
        style = self._announce_roll(1)
        self._update_physics_readout()
        # Scene-side impact feedback only: the challenge panel owns the result
        # text, so the big centre card (``onPinsResolved``) is deliberately not
        # fired here - it would draw over the panel.
        self.motion.onShotHit(
            position=(self.ball.x, 0.30, max(self.ball.z, 16.0)), style=style)
        self.state = 'challenge'
        self.timer = 0.0
        self._set_avatar_state(avatar_states.CELEBRATE if outcome.solved
                               else avatar_states.WAIT)

    def _challenge_measurement_for(self, challenge):
        """What the real simulation produced for the attempt (no model maths).

        The pass error, the landing position and the arrival speed are read
        from the deck's own trajectory and contact records; the pin's exit
        speed follows from the engine's recorded impact speed through the same
        impulse equation the collision solver used.
        """
        deck = self.pins.deck
        value = challenge.answer if self.challenge_value is None \
            else self.challenge_value
        positions, _speed, _angle, spins = challenge.launch_values(value)
        aim_x, aim_z = challenge.aim_x(), challenge.aim_z()
        path = self._sampled_path(deck)
        landing_x = None
        pass_error = None
        if path:
            closest = min(path, key=lambda point: abs(point[1] - aim_z))
            landing_x = closest[0]
            near = [abs(x - aim_x) for x, z in path
                    if abs(z - aim_z) <= 0.12]
            pass_error = min(near) if near else abs(landing_x - aim_x)
        impact = deck.impact_speed
        return RollMeasurement(
            value=value,
            targets_down=tuple(index in deck.roll_down
                               for index in challenge.targets),
            pins_down=tuple(index in deck.roll_down
                            for index in range(len(challenge.rack))),
            knockdowns=self.knockdowns,
            launch_x=positions,
            landing_x=landing_x,
            pass_error=pass_error,
            impact_speed=impact,
            pin_speed=(pin_speed_from_impact(impact)
                       if impact is not None else None),
            gutter=bool(deck.ball.in_gutter),
            gutter_z=(deck.ball.z if deck.ball.in_gutter else None),
            path=path,
            spin=spins,
        )

    @staticmethod
    def _sampled_path(deck, limit=80):
        """The recorded trajectory, thinned to at most ``limit`` samples."""
        samples = [(x, z) for _t, x, z in deck.trajectory]
        if len(samples) <= limit:
            return tuple(samples)
        step = max(1, len(samples) // limit)
        thinned = samples[::step]
        if thinned[-1] != samples[-1]:
            thinned.append(samples[-1])
        return tuple(thinned)

    def _challenge_view(self):
        """The draw-ready state of the challenge panel."""
        challenge = self.challenge
        measurement = self._challenge_measurement
        pins = []
        for index, (label, x, z) in enumerate(challenge.rack):
            is_target = index in challenge.targets
            is_down = bool(measurement is not None
                           and index < len(measurement.pins_down)
                           and measurement.pins_down[index])
            pins.append((label, x, z, is_target, is_down))
        solved = (self.challenge_result is not None
                  and self.challenge_result.solved)
        return ChallengeView(
            challenge=challenge,
            progress=self.challenge_progress,
            input_text=self.challenge_input,
            result=self.challenge_result,
            attempts=self.challenge_attempts,
            hints_unlocked=self.challenge_hints,
            solution=self.challenge_solution,
            show_solution=(self.challenge_attempts >= 2
                           and not solved
                           and not self.challenge_solution),
            caret=not solved and not self.challenge_solution,
            path=self._challenge_path,
            pins=tuple(pins),
            launched=self._challenge_launched or bool(self._challenge_path),
            gutter_x=(self.pins.deck.ball.x
                      if self.pins.deck.ball.in_gutter else None),
            error=self.challenge_error,
        )

    @property
    def challenge_progress(self):
        total = len(self.challenges)
        if not total:
            return ''
        return (f'Challenge {min(self.challenge_index + 1, total)} of {total}')

    def _challenge_primary(self, action):
        if action == 'continue':
            return self.continue_challenge()
        return self.submit_challenge()

    def _challenge_key(self, key):
        """Answer entry for Equation Mode (see :meth:`_question_key`)."""
        solved = (self.challenge_result is not None
                  and self.challenge_result.solved)
        if key in ('enter', 'return'):
            if self.challenge_solution or solved:
                self.continue_challenge()
            else:
                self.submit_challenge()
            return
        if key == 'backspace':
            self.challenge_input = self.challenge_input[:-1]
            self.challenge_error = ''
            return
        if self.challenge_solution or solved:
            return
        character = theme.key_to_character(key)
        if not character or character not in '0123456789.eE+-':
            return
        if len(self.challenge_input) < 12:
            self.challenge_input += character
            self.challenge_error = ''

    def _update_challenge(self, dt):
        """Equation Mode per-frame state: nothing is timed, by design."""
        return

    # ==================================================================
    # Turn handoff between players
    # ==================================================================
    def _enter_handoff(self):
        """Wait for the next player to take over before arming the throw."""
        self.state = 'handoff'
        self._handoff_timer = 0.0
        self._handoff_stable = 0.0
        self._handoff_progress = 0.0
        reset = getattr(self.input_source, 'reset', None)
        if callable(reset):
            reset()
        self.input_source.discard_pending()
        self._show_avatar_for(self.match.current_player)
        self._set_avatar_state(avatar_states.WAIT)
        self._play('handoff')

    def _update_handoff(self, dt):
        """Accumulate the handoff confirmation (gesture and/or a key)."""
        player = self.match.current_player
        self._handoff_timer += dt
        tracking_ready = False
        if self.input_mode == 'webcam':
            status = self._webcam_status
            detection = bool(status is not None and status.tracked
                             and not status.error)
            if detection:
                self._handoff_stable += dt
            else:
                self._handoff_stable = 0.0
            # During the handoff the input is not game-ready, so the classifier
            # is idle in 'tracking'; 'ready' covers the moment it has armed.
            ready_pose = detection and status.phase in ('tracking', 'ready')
            tracking_ready = (self._handoff_stable >= HANDOFF_STABLE_TIME
                              and ready_pose)
            if tracking_ready:
                self._handoff_progress = min(
                    1.0, self._handoff_progress + dt / HANDOFF_CONFIRM_TIME)
            else:
                self._handoff_progress = max(
                    0.0, self._handoff_progress - dt / HANDOFF_CONFIRM_TIME)
            confirmed = self._handoff_progress >= 1.0
        else:
            # Mouse: the handoff is confirmed by the player pressing ENTER (or
            # clicking), which is what stops a stale drag from a previous
            # player firing a throw.
            self._handoff_progress = 1.0 if not self._mouse_busy() else 0.0
            confirmed = False
        if confirmed or (self._handoff_timer > HANDOFF_TIMEOUT):
            self._confirm_handoff()
        self._render_handoff(player, tracking_ready)

    def _mouse_busy(self):
        from ursina import mouse
        return bool(getattr(mouse, 'left', False))

    def _confirm_handoff(self):
        self._show_message(f'{self.match.current_player.name} to bowl.', 2.0)
        self._enter_ready()

    def _handoff_lines(self):
        if self.input_mode == 'webcam':
            status = self._webcam_status
            if status is None or status.error:
                return ['Camera unavailable - press ENTER to bowl with the '
                        'mouse.']
            if not status.tracked:
                return ['Step into the camera view so the next bowler is '
                        'tracked.']
            if self._handoff_stable < HANDOFF_STABLE_TIME:
                return ['Hold still - confirming the new player...']
            return ['Hold your ready pose (arms down) to confirm your turn, '
                    'or press ENTER.']
        return ['Press ENTER or click to start your turn.',
                'The previous player\'s swing has been cleared.']

    def _render_handoff(self, player, tracking_ready):
        progress = 1.0 if self.input_mode != 'webcam' else self._handoff_progress
        accent = player.rgb
        self.handoff_banner.update(player.name, self._handoff_lines(),
                                   progress, accent=accent,
                                   colour=(theme.PALETTE['green']
                                           if tracking_ready
                                           else theme.PALETTE['amber']))

    # ==================================================================
    # Bot
    # ==================================================================
    def _bot_reset(self):
        self._bot_phase = 'idle'
        self._bot_timer = 0.0

    def _bot_planner(self, player):
        if self._bot is None or self._bot.difficulty != player.difficulty:
            self._bot = BotPlanner(player.difficulty)
        return self._bot

    def _standing_positions(self):
        """Live positions of the standing pins (for the bot's planning)."""
        return [(pin.physics.base[0], pin.physics.base[1])
                for pin in self.pins.pins if pin.physics.standing]

    def _update_bot(self, dt):
        """Plan and perform the bot's throw through the real simulation."""
        planner = self._bot_planner(self.match.current_player)
        if self._bot_phase == 'idle':
            planner.start(self._standing_positions())
            self._bot_phase = 'think'
            self._bot_timer = 0.0
            self._set_avatar_state(avatar_states.WAIT)
            self._show_message(f'{self.match.current_player.name} is lining '
                               f'up the shot...', 3.0)
            return
        if self._bot_phase == 'think':
            throw = planner.step()
            self._bot_timer += dt
            if throw is not None:
                self.planned_throw = throw
                self._bot_phase = 'prepare'
                self._bot_timer = 0.0
                self._set_avatar_state(avatar_states.READY)
            return
        self._bot_timer += dt
        if self._bot_phase == 'prepare':
            if self._bot_timer >= BOT_PREPARE_TIME:
                self._bot_phase = 'swing'
                self._bot_timer = 0.0
                self._set_avatar_state(avatar_states.BACKSWING)
                self._set_swing(-1.0)
            return
        if self._bot_phase == 'swing':
            progress = min(1.0, self._bot_timer / BOT_SWING_TIME)
            self._set_swing(-1.0 + 2.0 * progress)
            if progress >= 1.0:
                self._bot_phase = 'done'
                self._set_swing(1.0)
                self.launch(self.planned_throw)
            return

    # ==================================================================
    # Avatar
    # ==================================================================
    def _avatar_for(self, player):
        key = player.index
        if key not in self._avatars:
            side = -1.0 if key % 2 == 0 else 1.0
            self._avatars[key] = Bowler(
                rgb=player.rgb,
                position=(AVATAR_X if side < 0 else AVATAR_SECOND_X, 0.0,
                          AVATAR_Z),
                name=f'avatar_{key}')
        avatar = self._avatars[key]
        avatar.set_colors(player.rgb)
        return avatar

    def _show_avatar_for(self, player):
        for index, avatar in self._avatars.items():
            avatar.visible = (index == player.index)
        self._active_avatar = self._avatar_for(player)
        self._active_avatar.rotation_y = 0.0
        self._set_avatar_state(avatar_states.READY)
        self._show_ball_for_ready()
        if self.input_mode == 'webcam':
            arm = getattr(self.input_source, 'preferred_arm', 'auto')
            if arm in ('left', 'right'):
                self._active_avatar.set_throw_arm(arm)

    def _set_avatar_state(self, state):
        """Set the pose; the held ball is managed by :meth:`_sync_ball_in_hand`.

        The ball used to be shown for every state except the throw itself,
        which drew a second ball beside the bowler at rest. Now the character
        only holds one while it is about to throw.
        """
        if self._active_avatar is not None:
            self._active_avatar.set_state(state)

    def _set_swing(self, value):
        self._swing_pose = value
        if self._active_avatar is not None:
            self._active_avatar.set_swing(value)

    def _update_avatar(self):
        """Feed the character the live swing position and the right pose.

        While the player is holding the ball (dragging with the mouse, or mid
        swing on the webcam) the character holds it and the duplicate ball on
        the lane is hidden (section 6).
        """
        if self.input_mode == 'webcam':
            arm = getattr(self.input_source, 'preferred_arm', 'auto')
            if arm in ('left', 'right'):
                self._active_avatar.set_throw_arm(arm)
        if self.state == 'ready':
            if not self.match.current_player.is_bot:
                self._set_swing(getattr(self.input_source, 'swing_pose', 0.0))
                pose = getattr(self.input_source, 'swing_pose', 0.0)
                if pose > 0.35:
                    self._set_avatar_state(avatar_states.FORWARD)
                elif pose < -0.35:
                    self._set_avatar_state(avatar_states.BACKSWING)
                else:
                    self._set_avatar_state(avatar_states.READY)
        self._sync_ball_in_hand()
        if self.active_avatar_is_visible:
            self._active_avatar.update()

    def _ball_in_hand(self):
        """True while the character is holding the ball, about to throw.

        Mouse / webcam: the player is dragging (the ball is picked up). Bot:
        its wind-up is underway. Either way the ball on the lane is hidden, so
        the same ball is never drawn twice - at rest the lane ball *is* the
        ball (it is the aiming reference), and the character's is put away.
        """
        if self.state != 'ready' or self.paused:
            return False
        player = self.match.current_player if self.match is not None else None
        if player is not None and player.is_bot:
            return getattr(self, '_bot_phase', '') in ('prepare', 'swing')
        return bool(getattr(self.input_source, 'dragging', False))

    def _sync_ball_in_hand(self):
        """Show the ball in the character's hands, not on the lane, while held."""
        held = self._ball_in_hand()
        if held == getattr(self, '_ball_held', None):
            return
        self._ball_held = held
        self.ball.visible = not held
        self.ball.shadow.visible = not held
        if self._active_avatar is not None:
            self._active_avatar.set_ball_visible(held)

    def _show_ball_for_ready(self):
        """Make sure the lane ball is back for the next throw."""
        self._ball_held = None
        self.ball.visible = True
        self.ball.shadow.visible = True
        if self._active_avatar is not None:
            self._active_avatar.set_ball_visible(False)

    @property
    def active_avatar_is_visible(self):
        return self._active_avatar is not None and self._active_avatar.visible

    # ==================================================================
    # Roll resolution
    # ==================================================================
    def _resolve_roll(self):
        """Count the roll, record it, and decide what happens next."""
        if self.mode.gate == modes.GATE_EQUATIONS and self.challenge is not None:
            # Equation Mode: the roll is marked against the challenge and the
            # panel comes back for another attempt or the next challenge.
            self._resolve_challenge_roll()
            return
        self.knockdowns = self._count_roll()
        player = self.match.current_player
        # Snapshots for the animated readouts: the frame the roll was bowled
        # in, the cumulative totals before/after, and the official score.
        frame_before = self.score.current_frame_number
        frames_before = self.score.cumulative_scores()
        official_before = self.score.current_score
        if self.mode.gate == modes.GATE_TRIVIA:
            # Trivia: every throw faces a fresh rack and the pins are the
            # session score; the question index advances instead of a frame.
            self.match.record_roll(self.knockdowns, advance=False)
            self.question_index += 1
            self._last_event = 'recorded'
        elif self.mode.timed:
            self.match.record_roll(self.knockdowns, advance=False)
            self.match.next_turn()
            self._last_event = 'turn_changed'
        else:
            self._last_event = self.match.record_roll(self.knockdowns)
        self.last_result = {
            'player': player.name,
            'pins': self.knockdowns,
            'strike': self.knockdowns == 10,
        }
        style = self._announce_roll(frame_before)
        self._update_physics_readout()
        self.pending_action = self._next_action()
        self.state = 'result'
        self.timer = config.RESULT_DELAY
        self._set_avatar_state(avatar_states.CELEBRATE
                               if self.knockdowns >= 8
                               else (avatar_states.DISAPPOINTED
                                     if self.knockdowns <= 1
                                     else avatar_states.WAIT))
        self._motion_roll_recorded(style, frame_before, frames_before,
                                   official_before)

    def _motion_roll_recorded(self, style, frame_before, frames_before,
                              official_before):
        """Feed the recorded roll to the animation system (sections 1/5)."""
        frames_after = self.score.cumulative_scores()
        official_after = self.score.current_score
        cell = None
        cell_total = None
        if 1 <= frame_before <= 10:
            cell = frame_before - 1
            before = (frames_before[cell]
                      if frames_before and len(frames_before) > cell else None)
            after = (frames_after[cell]
                     if frames_after and len(frames_after) > cell else None)
            if before is not None and after is not None and before != after:
                cell_total = (before, after)
        mark = {'strike': 'X', 'spare': '/'}.get(style)
        official = ((official_before, official_after)
                    if official_before != official_after else None)
        self.motion.onScoreEntry(frame_index=cell, cell_total=cell_total,
                                 official=official, mark=mark)
        self.motion.onPinsResolved(self.knockdowns, style=style,
                                   position=(self.ball.x, 0.30,
                                             max(self.ball.z, 16.0)),
                                   frame_index=cell)
        # The scorer moved to a new frame: a light sweep, plus the tenth-frame
        # celebration.
        frame_after = self.score.current_frame_number
        if frame_after != frame_before:
            self.motion.onFrameAdvance(frame=frame_after,
                                       previous=frame_before)

    def _next_action(self):
        """What to do when the result delay expires."""
        if self.mode.gate == modes.GATE_TRIVIA:
            if self.question_index >= len(self.questions):
                return 'match_over'
            return 'next_question'
        # Equation Mode resolves its rolls in place (``_resolve_challenge_roll``)
        # and never reaches the timed result state.
        if self.mode.gate == modes.GATE_EQUATIONS:
            return 'match_over'
        if self.match.is_complete:
            return 'match_over'
        if self.mode.timed:
            if self.match.time_up:
                return 'match_over'
            return 'handoff' if self.match.player_count > 1 else 'next_roll'
        event = getattr(self, '_last_event', 'same_player')
        if event == 'match_over':
            return 'match_over'
        if event in ('turn_changed', 'round_changed') \
                and self.match.player_count > 1:
            # A different person bowls next: hand the machine over explicitly.
            return 'handoff'
        return 'next_roll'

    def _no_throws_left(self):
        return False

    def _announce_roll(self, frame=None):
        """Play the roll's sound cue and return the result style for motion.

        ``frame`` is the frame the roll was bowled in: the scorer may already
        have advanced to the next one by the time the roll is resolved, and a
        completed spare has to be recognised from the frame it happened in.
        """
        count = self.knockdowns
        if count == 10:
            self._play('strike')
            return 'strike'
        if count == 0:
            self._play('gutter')
            return 'gutter'
        self._play('pin')
        if self.mode.score_style == 'frames':
            if frame is None:
                frame = self.score.current_frame_number
            frame_rolls = self.score.frame_rolls(frame) or []
            if len(frame_rolls) >= 2 and sum(frame_rolls[:2]) == 10:
                self._play('spare')
                return 'spare'
        return 'pins'

    # ==================================================================
    # Match end
    # ==================================================================
    def _finish_match(self):
        """End the match, build the results, and show the results overlay."""
        self.match.finished = True
        self.pending_action = 'match_over'
        self.results_lines = self._results_lines()
        self.state = 'game_over'
        self.paused = False
        self._set_avatar_state(avatar_states.VICTORY)
        winner = self.match.winners()
        self._play('victory')
        self.results_overlay.set_lines(self.results_lines)
        # The award the results screen celebrates (the director plays the
        # biggest one only): a perfect game (a 300 in a frames mode), a new
        # personal best for this mode in this session, or a won multi-player
        # match. A solo classic game is not a "win" - the score is the story.
        total = self._final_score()
        previous = self._best_scores.get(self.mode.id)
        perfect = (self.mode.score_style == 'frames'
                   and self.score.total_score == 300)
        best = (not perfect) and previous is not None and total > previous
        won = bool(winner) and self.match.player_count > 1
        if previous is None or total > previous:
            self._best_scores[self.mode.id] = total
        # Trigger: the game ended. The results panel expands out of the top
        # bar's score block, the final score counts up large, confetti falls,
        # and an award banner is raised for a genuine achievement (section 7).
        self.motion.onGameEnd(total=total, start_from=0,
                              overlay=self.results_overlay, won=won,
                              best=best, perfect=perfect, previous=previous)
        self._overlay = self.results_overlay
        set_view('deck')

    def _final_score(self):
        """The score the game-end count lands on."""
        if self.mode.score_style == 'frames':
            return self.score.current_score
        player = self.match.current_player if self.match is not None else None
        return (player.total_pins if player is not None
                else self.score.current_score)

    def _results_lines(self):
        lines = [self.match.result_line(), '']
        for player, score in self.match.scoreboard():
            extra = ''
            if self.mode.gate == modes.GATE_TRIVIA:
                extra = (f'   ({player.correct}/{player.answered} answers '
                         f'correct)')
            elif self.mode.gate == modes.GATE_EQUATIONS:
                extra = (f'   ({player.correct}/{player.answered} challenges '
                         f'solved)')
            elif player.is_bot:
                extra = f'   (bot, {player.difficulty})'
            lines.append(f'{player.name:<10} {score:>5}{extra}')
        if self.mode.timed:
            lines.append('')
            lines.append('BowlRush: most pins knocked down in the time limit.')
        elif self.mode.gate == modes.GATE_TRIVIA:
            lines.append('')
            lines.append('Score = pins knocked down; answers unlock throws.')
        elif self.mode.gate == modes.GATE_EQUATIONS:
            lines.append('')
            lines.append('Score = pins knocked down on every attempt; '
                         'challenges solved count separately.')
        return lines

    # ==================================================================
    # Pause / overlays
    # ==================================================================
    def pause(self):
        if self.state == 'game_over':
            return
        self.paused = True
        reset = getattr(self.input_source, 'reset', None)
        if callable(reset):
            reset()
        self.input_source.discard_pending()
        self.pause_overlay.layout()
        self.pause_overlay.show()
        # The background dims (and blurs where the engine supports it) over
        # 250 ms, and the panel scales in from 0.95.
        self.motion.onPause(True)
        self._overlay = self.pause_overlay

    def resume(self):
        self.paused = False
        self.pause_overlay.hide()
        self.motion.onPause(False)
        self._overlay = None

    def toggle_pause(self):
        if self.state == 'game_over':
            return
        self.resume() if self.paused else self.pause()

    def _hide_overlays(self):
        self.pause_overlay.hide()
        self.results_overlay.hide()
        self.handoff_banner.hide()
        self._overlay = None

    def _quit_to_menu(self):
        # Leaving a match always un-pauses it: a paused game must never be
        # waiting behind the menu.
        self.paused = False
        self._hide_overlays()
        if self.app is not None:
            self.app.go_to_menu()

    def _open_settings(self):
        if self.app is not None:
            self.app.open_settings(from_game=True)

    def _open_lab(self):
        if self.app is not None:
            self.app.go_to_lab(match=self,
                               throw=getattr(self, 'last_throw', None))

    # ==================================================================
    # Audio
    # ==================================================================
    def _play(self, cue):
        if self.audio is None:
            return
        method = getattr(self.audio, cue, None)
        if callable(method):
            try:
                if cue == 'pin':
                    method(self.knockdowns)
                else:
                    method()
            except Exception:                    # pragma: no cover
                pass

    # ==================================================================
    # Physics readout
    # ==================================================================
    def _physics_visible(self):
        """Whether the compact physics panel should be drawn right now."""
        if not getattr(self, 'show_physics_panel', True):
            return False
        if self.settings is None:
            return True
        return bool(self.settings.get('show_physics_readout', True))

    def toggle_physics_panel(self):
        """Show or hide the in-game physics numbers (the ``H`` key)."""
        self.show_physics_panel = not getattr(self, 'show_physics_panel', True)
        self._show_message('Physics panel '
                           + ('on' if self.show_physics_panel else 'off'), 1.5)
        # The panel slides in from the right edge instead of snapping.
        self.motion.onPhysicsPanel(self.show_physics_panel)
        return self.show_physics_panel

    def _update_physics_readout(self):
        """Build the bottom-right readout from the simulation itself.

        Left empty until a throw exists, so a fresh match shows no readout
        panel at all (and ``H`` still toggles it once there is data).
        """
        throw = self.last_throw
        deck = self.pins.deck
        ball = self.ball.physics
        if throw is None:
            self._physics_lines = []
            return
        source = {'mouse': 'player input (mouse)',
                  'webcam': 'estimated from tracked motion',
                  'bot': 'bot launch conditions',
                  'equation': 'your challenge value',
                  'script': 'scripted'}.get(throw.source, throw.source)
        momentum = config.BALL_MASS * throw.speed
        energy = 0.5 * config.BALL_MASS * throw.speed ** 2
        lines = [
            f'RELEASE {throw.speed:4.2f} m/s   yaw {math.degrees(throw.launch_angle):+4.2f} deg',
            f'START x {throw.lateral_position:+.3f} m   hook {throw.spin_omega:+4.2f} rad/s',
        ]
        measurement = self._challenge_measurement
        if self.mode.gate == modes.GATE_EQUATIONS and measurement is not None:
            drift = ('--' if measurement.landing_x is None
                     else f'{measurement.landing_x - measurement.launch_x:+.3f}')
            passed = ('--' if measurement.pass_error is None
                      else f'{measurement.pass_error:.3f}')
            lines.append(f'drift {drift} m   pass {passed} m'
                         f'   pins {measurement.knockdowns}')
        else:
            lines.append(f'p = {momentum:5.1f} kg m/s   KE = {energy:6.1f} J')
        if deck.first_contact_time:
            lines.append(f'impact at {deck.first_contact_time:4.2f} s'
                         f'   {deck.impact_speed:4.2f} m/s')
        lines.append(f'L = {ball.angular_momentum:5.2f} kg m^2/s'
                     f'   revs {ball.revolutions:4.1f}')
        if self.mode.gate != modes.GATE_NONE or self.last_result is None:
            lines.append(f'source: {source}')
        else:
            lines.append(f'pins {self.last_result["pins"]}   ({source})')
        self._physics_lines = lines

    # ==================================================================
    # Per-frame update
    # ==================================================================
    def update(self):
        webcam = self.inputs.get('webcam')
        if webcam is not None:
            # Throws may only be generated while the game waits for a roll.
            set_ready = getattr(webcam, 'set_game_ready', None)
            if callable(set_ready):
                set_ready(self.state == 'ready' and not self.paused)

        if not self.paused:
            self.input_source.update()

        if self.input_mode == 'webcam' and webcam is not None:
            self._webcam_status = webcam.status()
            if self._webcam_status.error and not self._webcam_error_handled:
                self._webcam_error_handled = True
                self._show_message(
                    'Webcam unavailable: ' + self._webcam_status.error
                    + '  -  switched to MOUSE controls (TAB/2 to retry).',
                    10.0, warning=True)
                self.set_input_mode('mouse', announce=False)
                if self.state == 'handoff':
                    self._handoff_progress = 1.0
        else:
            self._webcam_status = None

        if self.paused:
            self._overlay_update()
            self._webcam_panel_update(webcam)
            self._hud()
            # The pause menu's own entrance (the panel scaling in, the backdrop
            # dimming) has to keep animating while the simulation is frozen.
            self._update_motion(time.dt, paused=True)
            return

        # BowlRush: the clock runs while a ball may be thrown (never during a
        # roll, a result or a handoff), so a throw always resolves in full.
        if self.mode.timed and self.state in ('ready', 'handoff'):
            self.match.tick(time.dt)
            if self.match.time_up:
                self._finish_match()
                self._webcam_panel_update(webcam)
                update_camera(self.ball, self.state)
                self._hud()
                return
        if self.mode.timed and self.state == 'ready':
            self._rush_warning()

        if self.state == 'question':
            self._update_question(time.dt)
        elif self.state == 'challenge':
            self._update_challenge(time.dt)
        elif self.state == 'ready':
            self._update_ready(time.dt)
        elif self.state == 'rolling':
            self._advance_roll(time.dt)
            if self.ball.finished:
                self.state = 'settling'
                self.timer = config.SETTLE_DELAY
        elif self.state == 'settling':
            self.pins.settle(time.dt * self.motion.slow_motion_scale())
            self.settle_elapsed += time.dt
            self.timer -= time.dt
            if self.timer <= 0.0 and (self.pins.deck_quiet()
                                      or self.settle_elapsed >= config.SETTLE_MAX_TIME):
                self._resolve_roll()
        elif self.state == 'result':
            self._update_result(time.dt)
        elif self.state == 'handoff':
            self._update_handoff(time.dt)
        # game_over: the results overlay waits for the player.

        self._update_avatar()
        self._update_trail()
        if self.message_timer > 0.0:
            self.message_timer = max(0.0, self.message_timer - time.dt)

        self._webcam_panel_update(webcam)
        update_camera(self.ball, self.state)
        self._overlay_update()
        self._hud()
        self._update_motion(time.dt)

    def _advance_roll(self, dt):
        """Integrate one frame of the roll (with the optional slow motion).

        On a strike the simulation briefly runs at ``MOTION.slow_motion_scale``
        (0.4x for 300 ms) so the pins are readable; the deck integrates on its
        own fixed sub-steps, so slowing the *feed* changes nothing about the
        outcome (a test asserts the pinfall is frame-rate independent).

        The presentation hooks fire here as well: as the ball crosses into the
        deck the camera pushes in (FOV 60 -> 54) and a dust burst kicks off;
        the *true* first contact with a pin (recorded by the deck) fires the
        impact thud - shake, shockwave and dust scaled by the speed it arrived
        with - which is what makes a hard hit read as hard.
        """
        if not getattr(self, '_hit_announced', True) \
                and self.ball.physics.z >= config.PIN_CAMERA_TRIGGER_Z:
            self._hit_announced = True
            fov_push_in()
            self.motion.onShotHit(
                position=(self.ball.x, 0.30, self.ball.physics.z),
                speed=self._ball_speed())
        deck = self.pins.deck
        if not getattr(self, '_impact_announced', True) \
                and deck.first_contact_time is not None:
            self._impact_announced = True
            self.motion.onPinImpact(
                position=(self.ball.x, 0.30, self.ball.physics.z),
                speed=deck.impact_speed)
        self.pins.advance(self.ball, dt * self.motion.slow_motion_scale())

    def _ball_speed(self):
        """The ball's horizontal speed (m/s), for the impact scale."""
        velocity = self.ball.physics.velocity
        return math.hypot(velocity[0], velocity[2])

    def _update_motion(self, dt, paused=False):
        """Step the animation system (one call per frame, after the HUD)."""
        meter = None
        source = self.input_source
        if hasattr(source, 'dragging') and not paused:
            meter = (bool(source.dragging), self._drag_power())
        if not paused:
            self._update_aim_indicator(dt)
        self.motion.update(dt, ball=self.ball, pins=self.pins,
                           state=self.state, meter=meter)

    def _drag_power(self):
        """The active input's drag power, 0..1 (for the power meter)."""
        power = getattr(self.input_source, 'power', None)
        try:
            return max(0.0, min(1.0, float(power)))
        except (TypeError, ValueError):
            return 0.0

    def _update_ready(self, dt):
        player = self.match.current_player
        if player.is_bot:
            self._update_bot(dt)
            return
        # Track the aiming position before the throw.
        self.ball.x = self.input_source.lateral
        self.ball.physics.x = self.input_source.lateral
        throw = self.input_source.throw_data
        if throw is not None:
            self.launch(throw)

    def _update_aim_indicator(self, dt):
        """Draw the dashed glow line along the *intended* launch direction.

        This is the *aim*, not the predicted path: the ball's own simulation
        (with its hook and its friction) decides where it actually goes, and
        the trail records what happened after the release. The dashes flow
        forward continuously and the whole guide fades out over 150 ms when the
        throw begins (section 6).
        """
        active = (self.state == 'ready' and not self.paused
                  and self.match is not None
                  and not self.match.current_player.is_bot)
        aim_offset = getattr(self.input_source, 'aim_offset', None)
        aim_angle = getattr(self.input_source, 'aim_angle', None)
        if aim_offset is None or aim_angle is None:
            active = False
            aim_offset = 0.0
            aim_angle = 0.0
        self.motion.update_aim_guide(
            dt, active, self.ball.physics.x, aim_angle, config.FOUL_LINE_Z,
            config.AIM_ARROW_Z, mark_x=aim_offset)

    def _update_trail(self):
        """Kept for callers that used it; the motion layer owns the trail now.

        The recording itself lives in :class:`motion.scene_fx.BallTrail`
        (pooled markers, alpha and size fading along the path), stepped by the
        director every frame.
        """
        return

    def _update_question(self, dt):
        if self.feedback is None:
            return
        # A correct answer (or a question whose hints are exhausted) advances
        # on its own; a wrong answer waits for the player so the unlocked hint
        # can be read and another attempt made.
        if not self.feedback.correct and self.attempts_left > 0:
            return
        self.timer -= dt
        if self.timer <= 0.0:
            self._advance_question()

    def _update_result(self, dt):
        self.timer -= dt
        if self.timer > 0.0:
            return
        action = self.pending_action
        webcam = self.inputs.get('webcam')
        if webcam is not None:
            set_ready = getattr(webcam, 'set_game_ready', None)
            if callable(set_ready):
                set_ready(False)
        if action == 'next_roll':
            self._enter_ready()
        elif action == 'next_question':
            self._enter_question()
        elif action == 'handoff':
            self._enter_handoff()
        else:
            if self.state != 'game_over':
                self._finish_match()

    def _rush_warning(self):
        """Count down the last seconds audibly (once per second)."""
        remaining = int(math.ceil(self.match.time_left or 0.0))
        if remaining <= 5 and remaining != getattr(self, '_last_rush_tick', None):
            self._last_rush_tick = remaining
            self._play('tick')
            self._show_message(f'{remaining} seconds left!', 1.2)

    # ------------------------------------------------------------- helpers
    def _webcam_panel_update(self, webcam):
        if self.input_mode == 'webcam' and webcam is not None:
            self.webcam_panel.update(webcam.latest_snapshot(),
                                     self._webcam_status, True)
        else:
            self.webcam_panel.update(None, None, False)

    def _overlay_update(self):
        if self._overlay is None:
            return
        x, y = theme.pointer()
        self._overlay.update_widgets(x, y, time.dt)

    def _hud(self):
        knockdowns = self.knockdowns if self.state == 'result' else None
        timer = self.match.time_left if (self.mode.timed and self.match) else None
        uses_frames = self.mode.score_style == 'frames'
        # Frame-based modes show the scorer's count; the others show the rack's
        # own count and the player's running total.
        standing = (self.score.standing_pins() if uses_frames
                    else self.pins.standing_count())
        player = self.match.current_player if self.match is not None else None
        score_value = self.score.current_score if uses_frames \
            else (player.total_pins if player is not None else 0)
        self.hud.update(
            self.ball, knockdowns, self.score, self.state,
            input_mode=self.input_mode,
            webcam_status=self._webcam_status,
            message=self.message if self.message_timer > 0.0 else '',
            message_warning=self.message_warning,
            match=self.match,
            mode=self.mode,
            paused=self.paused,
            question=self.current_question if self.state == 'question' else None,
            answer_text=self.answer_text,
            feedback=self.feedback,
            question_progress=self.question_progress,
            results=self.results_lines
            if (self.state == 'game_over' and self._overlay is None) else None,
            physics_lines=self._physics_lines
            if self._physics_visible() else None,
            timer=timer,
            rush=self.mode.timed,
            hide_scorecard=not uses_frames,
            standing_pins=0 if standing is None else standing,
            score_value=score_value,
            hints_unlocked=self.hints_unlocked,
            attempts_left=self.attempts_left,
            throw_earned=self.throw_earned,
            challenge_state=(self._challenge_view()
                             if (self.state == 'challenge'
                                 and self.challenge is not None) else None),
        )
        if self.state != 'handoff':
            self.handoff_banner.hide()

    # ==================================================================
    # Input
    # ==================================================================
    def on_key(self, key):
        # Overlay navigation takes precedence.
        if self._overlay is not None:
            if key in ('up arrow', 'up'):
                self._overlay.move_selection(-1)
                return
            if key in ('down arrow', 'down'):
                self._overlay.move_selection(1)
                return
            if key in ('enter', 'return'):
                self._overlay.activate()
                return
        if key == 'escape':
            if self.state == 'game_over':
                self._quit_to_menu()
            else:
                self.toggle_pause()
            return
        if key == 'tab':
            self.set_input_mode('mouse' if self.input_mode == 'webcam' else 'webcam')
            return
        if key == 'p' and (self.paused
                           or self.state not in ('question', 'challenge')):
            # P is the pause shortcut, but while an answer is being typed
            # (Trivia / Equations) the letter keys belong to the answer: a 'p'
            # in "momentum" must be typed, not pause the match. A paused
            # question still resumes with P.
            self.toggle_pause()
            return
        if self.paused:
            return
        if self.state == 'question':
            # Answer entry owns every other key, including the digits 1 and 2
            # that select the input mode during play.
            self._question_key(key)
            return
        if self.state == 'challenge':
            # Equation Mode's field owns the typing keys as well.
            self._challenge_key(key)
            return
        if key == '1':
            self.set_input_mode('mouse')
            return
        if key == '2':
            self.set_input_mode('webcam')
            return
        if key == 'c' and self.input_mode == 'webcam':
            # Cycle the throwing arm: auto -> right -> left -> auto.
            cycle = getattr(self.input_source, 'cycle_preferred_arm', None)
            if callable(cycle):
                arm = cycle()
                self._show_message(
                    f'Throwing arm: {str(arm).upper()}  (C to change)', 2.5)
            return
        if key == 'r':
            if self.state == 'game_over':
                self.new_game()
            elif self.state == 'ready':
                # Reset the current throw's rack and ball position.
                self._enter_ready()
            return
        if key == 'h':
            self.toggle_physics_panel()
            return
        if self.state == 'handoff' and key in ('enter', 'return', 'space'):
            self._confirm_handoff()
            return
        if self.state == 'game_over' and key in ('enter', 'return'):
            self.restart_match()

    def _question_key(self, key):
        """Answer entry for Trivia / Equations.

        Typing after a wrong answer starts a fresh attempt: the previous
        answer and its feedback are cleared so the player can redo the working
        (the unlocked hint steps stay unlocked).
        """
        if key in ('enter', 'return'):
            self.submit_answer()
            return
        if key == 'backspace':
            self.answer_text = self.answer_text[:-1]
            return
        if self.feedback is not None and not self.feedback.correct \
                and self.attempts_left > 0:
            self.answer_text = ''
            self.feedback = None
        if key == 'space' and not self.answer_text:
            return
        character = theme.key_to_character(key)
        if character and len(self.answer_text) < 24:
            self.answer_text += character

    def on_click(self, x, y):
        """Route a click: overlays first, then the question, then the game."""
        if self._overlay is not None:
            if self._overlay.click(x, y):
                if self._overlay is self.pause_overlay:
                    self._play('menu_select')
                return True
            return False
        if self.state == 'question':
            if self.question_controls.click(x, y):
                return True
            if self.feedback is not None:
                self.continue_question()
                return True
            return False
        if self.state == 'challenge':
            # The panel's buttons are the only click targets in this state.
            return bool(self.challenge_controls.click(x, y))
        if self.state == 'handoff':
            self._confirm_handoff()
            return True
        if self.state == 'game_over':
            return True
        return False

    # ==================================================================
    # Shutdown
    # ==================================================================
    def shutdown(self):
        """Release the camera and stop background work (called on exit)."""
        self._input_lifecycle(self.inputs.get('webcam'), 'stop')
