// The play screen: one mode, its players, and the shared bowling simulation
// (ported from game/play.py).
import * as config from '../config.js';
import * as modes from './modes.js';
import { Match } from './session.js';
import { BowlingGame } from '../scoring.js';
import { BotPlanner } from './bot.js';
import { RollMeasurement, pinSpeedFromImpact, challengesForSession } from './challenges.js';
import { checkAnswer, parseAnswer, triviaForSession } from './questions.js';
import { MouseInput } from '../input/mouse.js';
import { pointerState } from '../input/pointer.js';
import { WebcamInput } from '../input/webcam.js';
import { MotionDirector } from '../motion/director.js';
import { Ball } from '../scene/ball.js';
import { PinRack } from '../scene/pins.js';
import {
  fovPushIn, fovReset, setShakeProvider, setView, setupCamera, updateCamera,
} from '../scene/camera.js';
import { buildLane } from '../scene/lane.js';
import * as avatarStates from '../scene/avatar.js';
import { Bowler } from '../scene/avatar.js';
import { Hud } from '../ui/hud.js';
import { keyToCharacter } from '../ui/theme.js';
import { HandoffBanner, PauseOverlay, ResultsOverlay } from '../ui/overlays.js';
import { WebcamPanel } from '../ui/webcam_panel.js';
import { makeChallengeView } from '../ui/challenge_panel.js';

export const AVATAR_X = -1.35;
export const AVATAR_Z = -0.15;
export const AVATAR_SECOND_X = 1.35;
export const BOT_PREPARE_TIME = 0.7;
export const BOT_SWING_TIME = 0.45;
export const HANDOFF_STABLE_TIME = 0.6;
export const HANDOFF_CONFIRM_TIME = 1.2;
export const HANDOFF_TIMEOUT = 25.0;

function clamp(v, low, high) { return Math.max(low, Math.min(high, v)); }

export class Game {
  constructor({ inputs = null, audio = null, settings = null, app = null, uiRoot = null } = {}) {
    this.name = 'play';
    this.app = app;
    this.audio = audio;
    this.settings = settings;
    this.state = 'ready';
    this.timer = 0.0;
    this.settle_elapsed = 0.0;
    this.knockdowns = 0;
    this.score = new BowlingGame();

    buildLane();
    this.ball = new Ball();
    this.pins = new PinRack();
    this.inputs = inputs || { mouse: new MouseInput(), webcam: new WebcamInput() };
    this.input_mode = 'mouse';
    this._webcam_status = null;
    this._webcam_error_handled = false;
    this.message = '';
    this.message_timer = 0.0;
    this.message_warning = false;

    this.ui_root = uiRoot || document.body;
    this.uiRootEl = document.createElement('div');
    this.uiRootEl.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;pointer-events:none;';
    this.ui_root.appendChild(this.uiRootEl);
    this.webcam_panel = new WebcamPanel(this.uiRootEl);
    this.hud = new Hud(this.uiRootEl);
    this.question_controls = this.hud.question_panel;
    this.question_controls.setCallbacks(() => this.submit_answer(), () => this.continue_question());
    this.challenge_controls = this.hud.challenge_panel;
    this.challenge_controls.setCallbacks((action) => this._challenge_primary(action), () => this.show_challenge_solution());
    setupCamera();

    this.mode = modes.CLASSIC;
    this.match = null;
    this.paused = false;
    this.last_throw = null;
    this.last_result = null;
    this.pending_action = 'next_roll';
    this._best_scores = {};
    this._impact_announced = false;
    this.questions = [];
    this.question_index = 0;
    this.current_question = null;
    this.answer_text = '';
    this.feedback = null;
    this.question_count = 0;
    this.attempts = 0;
    this.hints_unlocked = 0;
    this.throw_earned = false;
    this.challenges = [];
    this.challenge_index = 0;
    this.challenge = null;
    this.challenge_input = '';
    this.challenge_result = null;
    this.challenge_attempts = 0;
    this.challenge_hints = 0;
    this.challenge_solution = '';
    this.challenge_error = '';
    this.challenge_value = null;
    this._challenge_measurement = null;
    this._challenge_path = [];
    this._challenge_launched = false;
    this._bot = null;
    this._bot_phase = 'idle';
    this._bot_timer = 0.0;
    this._handoff_timer = 0.0;
    this._handoff_stable = 0.0;
    this._handoff_progress = 0.0;
    this._physics_lines = [];
    this.show_physics_panel = true;
    this.results_lines = [];
    this._swing_pose = 0.0;
    this._avatars = {};
    this._active_avatar = null;

    this.pause_overlay = new PauseOverlay(this.uiRootEl, {
      onResume: () => { this._play('menu_select'); this.resume(); },
      onRestart: () => { this._play('menu_select'); this.restart_match(); },
      onMenu: () => { this._play('menu_select'); this._quit_to_menu(); },
      onSettings: () => { this._play('menu_select'); this._open_settings(); },
    });
    this.results_overlay = new ResultsOverlay(this.uiRootEl, {
      onRematch: () => this.restart_match(),
      onMenu: () => this._quit_to_menu(),
      onLab: () => this._open_lab(),
    });
    this.handoff_banner = new HandoffBanner(this.uiRootEl);
    this._overlay = null;

    this.motion = new MotionDirector(this.hud, this.ball, this.pins, this.uiRootEl);    this.motion.bindOverlays(this.pause_overlay, this.results_overlay);
    setShakeProvider(() => this.motion.cameraShake());

    this.start_match(modes.CLASSIC, [{ name: 'PLAYER 1' }]);
  }

  // ==== Match setup ====
  start_match(mode, playerSpecs = null, duration = null) {
    this.mode = mode;
    this.match = Match.create(mode, playerSpecs, duration);
    this.score = this.match.current_player.bowling;
    this.pins.reset();
    this.paused = false;
    this.question_index = 0;
    this.answer_text = '';
    this.feedback = null;
    this.current_question = null;
    this.challenge_index = 0;
    this.challenge = null;
    this.challenge_input = '';
    this.challenge_result = null;
    this.challenge_attempts = 0;
    this.challenge_hints = 0;
    this.challenge_solution = '';
    this.challenge_error = '';
    this.challenge_value = null;
    this._challenge_measurement = null;
    this._challenge_path = [];
    this._challenge_launched = false;
    if (mode.gate === modes.GATE_TRIVIA) { this.questions = triviaForSession(mode.questions || null); this.challenges = []; }
    else if (mode.gate === modes.GATE_EQUATIONS) { this.questions = []; this.challenges = challengesForSession(mode.questions || null); }
    else { this.questions = []; this.challenges = []; }
    this.question_count = this.questions.length || this.challenges.length;
    this._bot = null;
    this._physics_lines = [];
    this.results_lines = [];
    this.last_throw = null;
    this.last_result = null;
    this._hide_overlays();
    this._show_avatar_for(this.match.current_player);
    setView('game');
    this.motion.onMatchStart(this.input_mode, this.match.current_player.throws);
    if (this.mode.gate === modes.GATE_EQUATIONS) this._enter_challenge(true);
    else if (this.mode.gate !== modes.GATE_NONE) this._enter_question(true);
    else this._enter_ready();
  }

  configure(modeId, playerSpecs = null, duration = null) {
    return this.start_match(modes.get(modeId), playerSpecs, duration);
  }

  new_game() { return this.restart_match(); }

  restart_match() {
    const specs = this.match.players.map((p) => ({ name: p.name, rgb: p.rgb, is_bot: p.is_bot, difficulty: p.difficulty }));
    const previousMode = this.mode;
    const duration = previousMode.timed ? this.match.duration : null;
    this.paused = false;
    this.start_match(previousMode, specs, duration);
    this._show_message(`New match: ${previousMode.title}`, 2.5);
    return this;
  }

  show() {
    this.paused = false;
    this.uiRootEl.style.display = 'block';
    this._syncAvatarVisibility();
    setView('game');
    this.input_source.discardPending();
  }

  _syncAvatarVisibility() {
    // The original switches avatars off with ``enabled`` (the scene keeps
    // them out of the frame without touching the play screen's own choice of
    // which slot is visible), so only the player who is up may be shown.
    const current = this.match ? this.match.current_player.index : -1;
    for (const [index, avatar] of Object.entries(this._avatars)) {
      avatar.visible = Number(index) === current;
    }
  }

  hide() {
    this._hide_overlays();
    this.uiRootEl.style.display = 'none';
    for (const avatar of Object.values(this._avatars)) avatar.visible = false;
    if (this.input_source.reset) this.input_source.reset();
    const webcam = this.inputs.webcam;
    if (webcam && webcam.setGameReady) webcam.setGameReady(false);
  }

  get input_source() { return this.inputs[this.input_mode]; }
  get current_player() { return this.match ? this.match.current_player : null; }

  _show_message(text, duration = null, warning = false) {
    this.message = text;
    this.message_timer = duration === null ? config.MESSAGE_DURATION : duration;
    this.message_warning = warning;
  }

  set_input_mode(mode, announce = true) {
    if (!(mode in this.inputs) || mode === this.input_mode) return;
    const source = this.inputs[this.input_mode];
    source.discardPending();
    if (source.reset) source.reset();
    if (this.input_mode === 'webcam' && this.inputs.webcam.stop) this.inputs.webcam.stop();
    this.input_mode = mode;
    this.inputs[mode].discardPending();
    this._webcam_error_handled = false;
    if (mode === 'webcam') {
      if (this.inputs.webcam.start) this.inputs.webcam.start();
      if (announce) this._show_message('Webcam mode: stand where your upper body is visible and wait for tracking.', 6.0);
    } else if (announce) this._show_message('Mouse mode.', 2.0);
  }

  // ==== Roll lifecycle ====
  _enter_ready() {
    this.input_source.discardPending();
    this.score = this.match.current_player.bowling;
    this.ball.reset(this.input_source.lateral);
    const standing = this.mode.resolves_every_throw ? null : this.score.standing_pins();
    let fullReset;
    if (standing === null || standing >= BowlingGame.MAX_PINS) { this.pins.reset(); fullReset = true; }
    else { this.pins.sweep(); this.pins.restore_survivors(); fullReset = false; }
    this._check_rack();
    this.motion.onPinReset(standing, fullReset);
    this.motion.onFrameChange(this.score.current_frame_number);
    fovReset();
    this.knockdowns = 0;
    this.settle_elapsed = 0.0;
    this.state = 'ready';
    this.timer = 0.0;
    this._bot_reset();
    this._set_avatar_state(avatarStates.READY);
    this._show_ball_for_ready();
  }

  _check_rack() {
    if (this.mode.resolves_every_throw) return;
    const standing = this.score.standing_pins();
    if (standing === null || this.pins.standingCount() === standing) return;
    if (standing >= BowlingGame.MAX_PINS) this.pins.reset();
    else { this.pins.sweep(); this.pins.restore_survivors(); }
  }

  _begin_roll() {
    this.knockdowns = 0;
    this.settle_elapsed = 0.0;
    this._hit_announced = false;
    this._impact_announced = false;
    this.pins.beginRoll();
  }

  _count_roll() {
    let counted = this.pins.knockdownCount();
    if (this.mode.resolves_every_throw) return counted;
    const standing = this.score.standing_pins();
    if (standing !== null && counted > standing) counted = standing;
    return counted;
  }

  launch(throwData) {
    this.last_throw = throwData;
    this._begin_roll();
    this.ball.launch(throwData);
    this.state = 'rolling';
    this._play('release');
    this._set_avatar_state(throwData.source === 'bot' ? avatarStates.FOLLOW : avatarStates.RELEASE);
    this.motion.onThrowRelease(throwData, this._drag_power());
  }

  // ==== Question gate ====
  _enter_question(first = false) {
    if (this.question_index >= this.questions.length) { this._finish_match(); return; }
    this.current_question = this.questions[this.question_index];
    this.answer_text = '';
    this.feedback = null;
    this.attempts = 0;
    this.hints_unlocked = 0;
    this.throw_earned = false;
    this.state = 'question';
    this.timer = 0.0;
    this.score = this.match.current_player.bowling;
    if (!first) this.input_source.discardPending();
    this._set_avatar_state(avatarStates.WAIT);
    this._update_physics_readout();
  }

  submit_answer() {
    if (this.state !== 'question' || this.current_question === null) return null;
    if (this.feedback !== null) {
      if (this.feedback.correct || this.attempts_left <= 0) { this.continue_question(); return this.feedback; }
      this.feedback = null;
    }
    const question = this.current_question;
    this.attempts += 1;
    this.feedback = checkAnswer(question, this.answer_text);
    if (this.attempts === 1) {
      this.throw_earned = this.feedback.correct;
      this.match.recordAnswer(this.feedback.correct);
    }
    if (this.feedback.correct) { this.timer = this.throw_earned ? 3.0 : 2.4; this._play('correct'); }
    else {
      this.hints_unlocked = Math.min((question.hints || []).length, this.hints_unlocked + 1);
      this.timer = this.attempts_left > 0 ? 0.0 : 5.0;
      this._play('wrong');
    }
    return this.feedback;
  }

  continue_question() {
    if (this.state !== 'question' || this.feedback === null) return false;
    this._advance_question();
    return true;
  }

  get attempts_left() {
    if (this.current_question === null) return 0;
    return Math.max(0, (this.current_question.hints || []).length - this.hints_unlocked);
  }

  _advance_question() {
    if (this.throw_earned) { this._enter_ready(); return; }
    this.question_index += 1;
    if (this.question_index >= this.questions.length) this._finish_match();
    else this._enter_question();
  }

  get question_progress() {
    const total = this.questions.length;
    if (!total) return '';
    return `Question ${Math.min(this.question_index + 1, total)} of ${total}`;
  }

  // ==== Equation Mode ====
  _enter_challenge(first = false) {
    if (this.challenge_index >= this.challenges.length) { this._finish_match(); return; }
    this.challenge = this.challenges[this.challenge_index];
    this.challenge_input = '';
    this.challenge_result = null;
    this.challenge_attempts = 0;
    this.challenge_hints = 0;
    this.challenge_solution = '';
    this.challenge_error = '';
    this.challenge_value = null;
    this._challenge_measurement = null;
    this._challenge_path = [];
    this._challenge_launched = false;
    this.state = 'challenge';
    this.timer = 0.0;
    this.score = this.match.current_player.bowling;
    if (!first) this.input_source.discardPending();
    this._challenge_setup();
    this._set_avatar_state(avatarStates.WAIT);
    this._update_physics_readout();
  }

  _challenge_setup() {
    const challenge = this.challenge;
    this.pins.setLayout(challenge.positions());
    this.ball.reset(challenge.fixed.position ?? 0.0);
    this.knockdowns = 0;
    this.settle_elapsed = 0.0;
    this._bot_reset();
    this.motion.onPinReset(challenge.rack.length, true);
    this.motion.onFrameChange(1);
    fovReset();
    this._show_ball_for_ready();
  }

  _challenge_throw(challenge, value) {
    const [position, speed, angle, spin] = challenge.launchValues(value);
    return {
      lateral_position: position, launch_angle: angle * Math.PI / 180,
      speed: speed, spin_omega: spin, source: 'equation', confidence: 1.0,
    };
  }

  submit_challenge() {
    if (this.state !== 'challenge' || this.challenge === null) return null;
    const challenge = this.challenge;
    if (this.challenge_solution || (this.challenge_result !== null && this.challenge_result.solved)) {
      return this.continue_challenge();
    }
    const [value] = parseAnswer(this.challenge_input);
    const control = challenge.control;
    if (value === null) {
      this.challenge_error = 'Enter a number to bowl - for example 4.7 or -4.7. The unit is shown next to the field.';
      return null;
    }
    if (value < control.low - 1e-9 || value > control.high + 1e-9) {
      this.challenge_error = `That is outside the range this challenge tests (${control.low} to ${control.high} ${control.unit}).`;
      return null;
    }
    this.challenge_error = '';
    this.challenge_value = value;
    this.challenge_attempts += 1;
    this.challenge_result = null;
    this.pins.deck.recordStart();
    const throwData = this._challenge_throw(challenge, value);
    this.launch(throwData);
    return throwData;
  }

  continue_challenge() {
    if (this.state !== 'challenge' || this.challenge === null) return false;
    const solved = this.challenge_result !== null && this.challenge_result.solved;
    const revealing = !!this.challenge_solution;
    if (!solved && !revealing) return false;
    this.match.recordAnswer(solved);
    this.challenge_index += 1;
    if (this.challenge_index >= this.challenges.length) this._finish_match();
    else this._enter_challenge();
    return true;
  }

  show_challenge_solution() {
    if (this.state !== 'challenge' || this.challenge === null) return false;
    if (this.challenge_solution) return false;
    this.challenge_solution = this.challenge.working;
    this.challenge_error = '';
    return true;
  }

  _resolve_challenge_roll() {
    const challenge = this.challenge;
    this.knockdowns = this._count_roll();
    const player = this.match.current_player;
    this.match.recordRoll(this.knockdowns, false);
    this.last_result = { player: player.name, pins: this.knockdowns, strike: this.knockdowns >= challenge.rack.length };
    const measurement = this._challenge_measurement_for(challenge);
    const outcome = challenge.evaluate(measurement);
    this._challenge_measurement = measurement;
    this._challenge_path = measurement.path;
    this._challenge_launched = true;
    this.challenge_result = outcome;
    this.challenge_value = measurement.value;
    if (!outcome.solved) this.challenge_hints = Math.min(challenge.steps.length, this.challenge_hints + 1);
    const style = this._announce_roll(1);
    this._update_physics_readout();
    this.motion.onShotHit([this.ball.x, 0.30, Math.max(this.ball.z, 16.0)], style);
    this.state = 'challenge';
    this.timer = 0.0;
    this._set_avatar_state(outcome.solved ? avatarStates.CELEBRATE : avatarStates.WAIT);
  }

  _challenge_measurement_for(challenge) {
    const deck = this.pins.deck;
    const value = this.challenge_value === null ? challenge.answer : this.challenge_value;
    const [positions, _speed, _angle, spins] = challenge.launchValues(value);
    const aimX = challenge.aimX();
    const aimZ = challenge.aimZ();
    const path = this._sampled_path(deck);
    let landingX = null, passError = null;
    if (path.length) {
      let closest = path[0];
      for (const point of path) if (Math.abs(point[1] - aimZ) < Math.abs(closest[1] - aimZ)) closest = point;
      landingX = closest[0];
      const near = path.filter(([x, z]) => Math.abs(z - aimZ) <= 0.12).map(([x]) => Math.abs(x - aimX));
      passError = near.length ? Math.min(...near) : Math.abs(landingX - aimX);
    }
    const impact = deck.impact_speed;
    return new RollMeasurement({
      value: value,
      targets_down: challenge.targets.map((index) => deck.roll_down.has(index)),
      pins_down: Array.from({ length: challenge.rack.length }, (_, i) => deck.roll_down.has(i)),
      knockdowns: this.knockdowns,
      launch_x: positions,
      landing_x: landingX,
      pass_error: passError,
      impact_speed: impact,
      pin_speed: impact !== null ? pinSpeedFromImpact(impact) : null,
      gutter: !!deck.ball.in_gutter,
      gutter_z: deck.ball.in_gutter ? deck.ball.z : null,
      path: path,
      spin: spins,
    });
  }

  _sampled_path(deck, limit = 80) {
    const samples = deck.trajectory.map(([_t, x, z]) => [x, z]);
    if (samples.length <= limit) return samples;
    const step = Math.max(1, Math.floor(samples.length / limit));
    const thinned = samples.filter((_, i) => i % step === 0);
    if (thinned.length === 0 || thinned[thinned.length - 1][0] !== samples[samples.length - 1][0]
        || thinned[thinned.length - 1][1] !== samples[samples.length - 1][1]) thinned.push(samples[samples.length - 1]);
    return thinned;
  }

  _challenge_view() {
    const challenge = this.challenge;
    const measurement = this._challenge_measurement;
    const pins = challenge.rack.map(([label, x, z], index) => {
      const isTarget = challenge.targets.includes(index);
      const isDown = !!(measurement && index < measurement.pins_down.length && measurement.pins_down[index]);
      return [label, x, z, isTarget, isDown];
    });
    const solved = this.challenge_result !== null && this.challenge_result.solved;
    return makeChallengeView({
      challenge, progress: this.challenge_progress, input_text: this.challenge_input,
      result: this.challenge_result, attempts: this.challenge_attempts,
      hints_unlocked: this.challenge_hints, solution: this.challenge_solution,
      show_solution: this.challenge_attempts >= 2 && !solved && !this.challenge_solution,
      caret: !solved && !this.challenge_solution, path: this._challenge_path,
      pins: pins, launched: this._challenge_launched || this._challenge_path.length > 0,
      gutter_x: this.pins.deck.ball.in_gutter ? this.pins.deck.ball.x : null,
      error: this.challenge_error,
    });
  }

  get challenge_progress() {
    const total = this.challenges.length;
    if (!total) return '';
    return `Challenge ${Math.min(this.challenge_index + 1, total)} of ${total}`;
  }

  _challenge_primary(action) {
    if (action === 'continue') return this.continue_challenge();
    return this.submit_challenge();
  }

  _challenge_key(key) {
    const solved = this.challenge_result !== null && this.challenge_result.solved;
    if (key === 'enter' || key === 'return') {
      if (this.challenge_solution || solved) this.continue_challenge();
      else this.submit_challenge();
      return;
    }
    if (key === 'backspace') { this.challenge_input = this.challenge_input.slice(0, -1); this.challenge_error = ''; return; }
    if (this.challenge_solution || solved) return;
    const character = keyToCharacter(key);
    if (!character || !'0123456789.eE+-'.includes(character)) return;
    if (this.challenge_input.length < 12) { this.challenge_input += character; this.challenge_error = ''; }
  }

  // ==== Turn handoff ====
  _enter_handoff() {
    this.state = 'handoff';
    this._handoff_timer = 0.0;
    this._handoff_stable = 0.0;
    this._handoff_progress = 0.0;
    if (this.input_source.reset) this.input_source.reset();
    this.input_source.discardPending();
    this._show_avatar_for(this.match.current_player);
    this._set_avatar_state(avatarStates.WAIT);
    this._play('handoff');
  }

  _update_handoff(dt) {
    const player = this.match.current_player;
    this._handoff_timer += dt;
    let trackingReady = false;
    let confirmed = false;
    if (this.input_mode === 'webcam') {
      const status = this._webcam_status;
      const detection = !!(status && status.tracked && !status.error);
      if (detection) this._handoff_stable += dt;
      else this._handoff_stable = 0.0;
      const readyPose = detection && (status.phase === 'waiting' || status.phase === 'ready');
      trackingReady = this._handoff_stable >= HANDOFF_STABLE_TIME && readyPose;
      if (trackingReady) this._handoff_progress = Math.min(1.0, this._handoff_progress + dt / HANDOFF_CONFIRM_TIME);
      else this._handoff_progress = Math.max(0.0, this._handoff_progress - dt / HANDOFF_CONFIRM_TIME);
      confirmed = this._handoff_progress >= 1.0;
    } else {
      // Mouse: the handoff is confirmed by the player pressing ENTER (or
      // clicking), which is what stops a stale drag from a previous player
      // firing a throw. A held button keeps the progress at zero.
      this._handoff_progress = this._mouseBusy() ? 0.0 : 1.0;
      confirmed = false;
    }
    if (confirmed || this._handoff_timer > HANDOFF_TIMEOUT) this._confirm_handoff();
    this._render_handoff(player, trackingReady);
  }

  _mouseBusy() { return !!pointerState().left; }

  _confirm_handoff() {
    this._show_message(`${this.match.current_player.name} to bowl.`, 2.0);
    this._enter_ready();
  }

  _handoff_lines() {
    if (this.input_mode === 'webcam') {
      const status = this._webcam_status;
      if (!status || status.error) return ['Camera unavailable - press ENTER to bowl with the mouse.'];
      if (!status.tracked) return ['Step into the camera view so the next bowler is tracked.'];
      if (this._handoff_stable < HANDOFF_STABLE_TIME) return ['Hold still - confirming the new player...'];
      return ['Hold your ready pose (arms down) to confirm your turn, or press ENTER.'];
    }
    return ['Press ENTER or click to start your turn.', "The previous player's swing has been cleared."];
  }

  _render_handoff(player, trackingReady) {
    const progress = this.input_mode !== 'webcam' ? 1.0 : this._handoff_progress;
    this.handoff_banner.update(player.name, this._handoff_lines(), progress,
      player.rgb, trackingReady ? [120, 230, 140] : [255, 214, 130]);
  }

  // ==== Bot ====
  _bot_reset() { this._bot_phase = 'idle'; this._bot_timer = 0.0; }

  _bot_planner(player) {
    if (this._bot === null || this._bot.difficulty !== player.difficulty) this._bot = new BotPlanner(player.difficulty);
    return this._bot;
  }

  _standing_positions() {
    return this.pins.pins.filter((pin) => pin.physics.standing)
      .map((pin) => [pin.physics.base[0], pin.physics.base[1]]);
  }

  _update_bot(dt) {
    const planner = this._bot_planner(this.match.current_player);
    if (this._bot_phase === 'idle') {
      planner.start(this._standing_positions());
      this._bot_phase = 'think';
      this._bot_timer = 0.0;
      this._set_avatar_state(avatarStates.WAIT);
      this._show_message(`${this.match.current_player.name} is lining up the shot...`, 3.0);
      return;
    }
    if (this._bot_phase === 'think') {
      const throwData = planner.step();
      this._bot_timer += dt;
      if (throwData !== null) {
        this.planned_throw = throwData;
        this._bot_phase = 'prepare';
        this._bot_timer = 0.0;
        this._set_avatar_state(avatarStates.READY);
      }
      return;
    }
    this._bot_timer += dt;
    if (this._bot_phase === 'prepare') {
      if (this._bot_timer >= BOT_PREPARE_TIME) {
        this._bot_phase = 'swing';
        this._bot_timer = 0.0;
        this._set_avatar_state(avatarStates.BACKSWING);
        this._set_swing(-1.0);
      }
      return;
    }
    if (this._bot_phase === 'swing') {
      const progress = Math.min(1.0, this._bot_timer / BOT_SWING_TIME);
      this._set_swing(-1.0 + 2.0 * progress);
      if (progress >= 1.0) {
        this._bot_phase = 'done';
        this._set_swing(1.0);
        this.launch(this.planned_throw);
      }
    }
  }

  // ==== Avatar ====
  _avatar_for(player) {
    const key = player.index;
    if (!(key in this._avatars)) {
      const side = key % 2 === 0 ? -1.0 : 1.0;
      this._avatars[key] = new Bowler(player.rgb,
        [side < 0 ? AVATAR_X : AVATAR_SECOND_X, 0.0, AVATAR_Z], 1.0, `avatar_${key}`);
    }
    const avatar = this._avatars[key];
    avatar.setColors(player.rgb);
    return avatar;
  }

  _show_avatar_for(player) {
    for (const [index, avatar] of Object.entries(this._avatars)) {
      avatar.visible = Number(index) === player.index;
    }
    this._active_avatar = this._avatar_for(player);
    this._active_avatar.rotation_y = 0.0;
    this._set_avatar_state(avatarStates.READY);
    this._show_ball_for_ready();
    if (this.input_mode === 'webcam') {
      const arm = this.input_source.preferred_arm || 'auto';
      if (arm === 'left' || arm === 'right') this._active_avatar.setThrowArm(arm);
    }
  }

  _set_avatar_state(state) { if (this._active_avatar) this._active_avatar.setState(state); }

  _set_swing(value) {
    this._swing_pose = value;
    if (this._active_avatar) this._active_avatar.setSwing(value);
  }

  _update_avatar(dt = 1 / 60) {
    if (this.input_mode === 'webcam' && this._active_avatar) {
      const arm = this.input_source.preferred_arm || 'auto';
      if (arm === 'left' || arm === 'right') this._active_avatar.setThrowArm(arm);
    }
    if (this.state === 'ready' && !this.match.current_player.is_bot) {
      const pose = this.input_source.swing_pose || 0.0;
      this._set_swing(pose);
      if (pose > 0.35) this._set_avatar_state(avatarStates.FORWARD);
      else if (pose < -0.35) this._set_avatar_state(avatarStates.BACKSWING);
      else this._set_avatar_state(avatarStates.READY);
    }
    this._sync_ball_in_hand();
    if (this.active_avatar_is_visible) this._active_avatar.update(dt);
  }

  _ball_in_hand() {
    if (this.state !== 'ready' || this.paused) return false;
    const player = this.match ? this.match.current_player : null;
    if (player && player.is_bot) return ['prepare', 'swing'].includes(this._bot_phase || '');
    return !!this.input_source.dragging;
  }

  _sync_ball_in_hand() {
    const held = this._ball_in_hand();
    if (held === this._ball_held) return;
    this._ball_held = held;
    this.ball.visible = !held;
    this.ball.shadow.visible = !held;
    if (this._active_avatar) this._active_avatar.setBallVisible(held);
  }

  _show_ball_for_ready() {
    this._ball_held = null;
    this.ball.visible = true;
    this.ball.shadow.visible = true;
    if (this._active_avatar) this._active_avatar.setBallVisible(false);
  }

  get active_avatar_is_visible() { return !!this._active_avatar && this._active_avatar.visible; }

  // ==== Roll resolution ====
  _resolve_roll() {
    if (this.mode.gate === modes.GATE_EQUATIONS && this.challenge !== null) { this._resolve_challenge_roll(); return; }
    this.knockdowns = this._count_roll();
    const player = this.match.current_player;
    const frameBefore = this.score.current_frame_number;
    const framesBefore = this.score.cumulativeScores();
    const officialBefore = this.score.current_score;
    if (this.mode.gate === modes.GATE_TRIVIA) {
      this.match.recordRoll(this.knockdowns, false);
      this.question_index += 1;
      this._last_event = 'recorded';
    } else if (this.mode.timed) {
      this.match.recordRoll(this.knockdowns, false);
      this.match.nextTurn();
      this._last_event = 'turn_changed';
    } else {
      this._last_event = this.match.recordRoll(this.knockdowns);
    }
    this.last_result = { player: player.name, pins: this.knockdowns, strike: this.knockdowns === 10 };
    const style = this._announce_roll(frameBefore);
    this._update_physics_readout();
    this.pending_action = this._next_action();
    this.state = 'result';
    this.timer = config.RESULT_DELAY;
    this._set_avatar_state(this.knockdowns >= 8 ? avatarStates.CELEBRATE
      : (this.knockdowns <= 1 ? avatarStates.DISAPPOINTED : avatarStates.WAIT));
    this._motion_roll_recorded(style, frameBefore, framesBefore, officialBefore);
  }

  _motion_roll_recorded(style, frameBefore, framesBefore, officialBefore) {
    const framesAfter = this.score.cumulativeScores();
    const officialAfter = this.score.current_score;
    let cell = null, cellTotal = null;
    if (frameBefore >= 1 && frameBefore <= 10) {
      cell = frameBefore - 1;
      const before = framesBefore.length > cell ? framesBefore[cell] : null;
      const after = framesAfter.length > cell ? framesAfter[cell] : null;
      if (before !== null && after !== null && before !== after) cellTotal = [before, after];
    }
    const mark = { strike: 'X', spare: '/' }[style] || null;
    const official = officialBefore !== officialAfter ? [officialBefore, officialAfter] : null;
    this.motion.onScoreEntry(cell, cellTotal, official, mark);
    this.motion.onPinsResolved(this.knockdowns, style,
      [this.ball.x, 0.30, Math.max(this.ball.z, 16.0)], cell);
    const frameAfter = this.score.current_frame_number;
    if (frameAfter !== frameBefore) this.motion.onFrameAdvance(frameAfter, frameBefore);
  }

  _next_action() {
    if (this.mode.gate === modes.GATE_TRIVIA) {
      if (this.question_index >= this.questions.length) return 'match_over';
      return 'next_question';
    }
    if (this.mode.gate === modes.GATE_EQUATIONS) return 'match_over';
    if (this.match.is_complete) return 'match_over';
    if (this.mode.timed) {
      if (this.match.time_up) return 'match_over';
      return this.match.player_count > 1 ? 'handoff' : 'next_roll';
    }
    const event = this._last_event || 'same_player';
    if (event === 'match_over') return 'match_over';
    if ((event === 'turn_changed' || event === 'round_changed') && this.match.player_count > 1) return 'handoff';
    return 'next_roll';
  }

  _announce_roll(frame = null) {
    const count = this.knockdowns;
    if (count === 10) { this._play('strike'); return 'strike'; }
    if (count === 0) { this._play('gutter'); return 'gutter'; }
    this._play('pin');
    if (this.mode.score_style === 'frames') {
      if (frame === null) frame = this.score.current_frame_number;
      const frameRolls = this.score.frameRolls(frame) || [];
      if (frameRolls.length >= 2 && frameRolls[0] + frameRolls[1] === 10) { this._play('spare'); return 'spare'; }
    }
    return 'pins';
  }

  // ==== Match end ====
  _finish_match() {
    this.match.finished = true;
    this.pending_action = 'match_over';
    this.results_lines = this._results_lines();
    this.state = 'game_over';
    this.paused = false;
    this._set_avatar_state(avatarStates.VICTORY);
    const winner = this.match.winners();
    this._play('victory');
    this.results_overlay.setLines(this.results_lines);
    const total = this._final_score();
    const previous = this._best_scores[this.mode.id];
    const perfect = this.mode.score_style === 'frames' && this.score.total_score === 300;
    const best = !perfect && previous !== undefined && total > previous;
    const won = winner.length > 0 && this.match.player_count > 1;
    if (previous === undefined || total > previous) this._best_scores[this.mode.id] = total;
    this.motion.onGameEnd(total, 0, this.results_overlay, won, best, perfect, previous);
    this._overlay = this.results_overlay;
    setView('deck');
  }

  _final_score() {
    if (this.mode.score_style === 'frames') return this.score.current_score;
    const player = this.match ? this.match.current_player : null;
    return player ? player.total_pins : this.score.current_score;
  }

  _results_lines() {
    const lines = [this.match.resultLine(), ''];
    for (const [player, score] of this.match.scoreboard()) {
      let extra = '';
      if (this.mode.gate === modes.GATE_TRIVIA) extra = `   (${player.correct}/${player.answered} answers correct)`;
      else if (this.mode.gate === modes.GATE_EQUATIONS) extra = `   (${player.correct}/${player.answered} challenges solved)`;
      else if (player.is_bot) extra = `   (bot, ${player.difficulty})`;
      lines.push(`${player.name.padEnd(10)} ${String(score).padStart(5)}${extra}`);
    }
    if (this.mode.timed) { lines.push(''); lines.push('BowlRush: most pins knocked down in the time limit.'); }
    else if (this.mode.gate === modes.GATE_TRIVIA) { lines.push(''); lines.push('Score = pins knocked down; answers unlock throws.'); }
    else if (this.mode.gate === modes.GATE_EQUATIONS) { lines.push(''); lines.push('Score = pins knocked down on every attempt; challenges solved count separately.'); }
    return lines;
  }

  // ==== Pause / overlays ====
  pause() {
    if (this.state === 'game_over') return;
    this.paused = true;
    if (this.input_source.reset) this.input_source.reset();
    this.input_source.discardPending();
    this.pause_overlay.show();
    this.motion.onPause(true);
    this._overlay = this.pause_overlay;
  }

  resume() {
    this.paused = false;
    this.pause_overlay.hide();
    this.motion.onPause(false);
    this._overlay = null;
  }

  toggle_pause() { if (this.state === 'game_over') return; if (this.paused) this.resume(); else this.pause(); }

  _hide_overlays() {
    this.pause_overlay.hide();
    this.results_overlay.hide();
    this.handoff_banner.hide();
    this._overlay = null;
  }

  _quit_to_menu() {
    this.paused = false;
    this._hide_overlays();
    if (this.app) this.app.goToMenu();
  }
  _open_settings() { if (this.app) this.app.open_settings(true); }
  _open_lab() { if (this.app) this.app.goToLab(this, this.last_throw); }

  // ==== Audio ====
  _play(cue) {
    if (!this.audio) return;
    const method = this.audio[cue];
    if (typeof method !== 'function') return;
    try { if (cue === 'pin') method.call(this.audio, this.knockdowns); else method.call(this.audio); }
    catch (_e) {}
  }

  // ==== Physics readout ====
  _physics_visible() {
    if (!this.show_physics_panel) return false;
    if (this.settings === null) return true;
    return !!this.settings.get('show_physics_readout', true);
  }

  toggle_physics_panel() {
    this.show_physics_panel = !this.show_physics_panel;
    this._show_message(`Physics panel ${this.show_physics_panel ? 'on' : 'off'}`, 1.5);
    this.motion.onPhysicsPanel(this.show_physics_panel);
    return this.show_physics_panel;
  }

  _update_physics_readout() {
    const throwData = this.last_throw;
    const deck = this.pins.deck;
    const ball = this.ball.physics;
    if (throwData === null) { this._physics_lines = []; return; }
    const source = { mouse: 'player input (mouse)', webcam: 'estimated from tracked motion',
      bot: 'bot launch conditions', equation: 'your challenge value', script: 'scripted' }[throwData.source] || throwData.source;
    const momentum = config.BALL_MASS * throwData.speed;
    const energy = 0.5 * config.BALL_MASS * throwData.speed ** 2;
    const signed = (value, digits) => `${value >= 0 ? '+' : ''}${Number(value).toFixed(digits)}`;
    const lines = [
      `RELEASE ${throwData.speed.toFixed(2)} m/s   yaw ${signed(throwData.launch_angle * 180 / Math.PI, 2)} deg`,
      `START x ${signed(throwData.lateral_position, 3)} m   hook ${signed(throwData.spin_omega, 2)} rad/s`,
    ];
    const measurement = this._challenge_measurement;
    if (this.mode.gate === modes.GATE_EQUATIONS && measurement !== null) {
      const drift = measurement.landing_x === null ? '--' : signed(measurement.landing_x - measurement.launch_x, 3);
      const passed = measurement.pass_error === null ? '--' : measurement.pass_error.toFixed(3);
      lines.push(`drift ${drift} m   pass ${passed} m   pins ${measurement.knockdowns}`);
    } else {
      lines.push(`p = ${momentum.toFixed(1)} kg m/s   KE = ${energy.toFixed(1)} J`);
    }
    if (deck.first_contact_time) lines.push(`impact at ${deck.first_contact_time.toFixed(2)} s   ${deck.impact_speed.toFixed(2)} m/s`);
    lines.push(`L = ${ball.angular_momentum.toFixed(2)} kg m^2/s   revs ${ball.revolutions.toFixed(1)}`);
    if (this.mode.gate !== modes.GATE_NONE || this.last_result === null) lines.push(`source: ${source}`);
    else lines.push(`pins ${this.last_result.pins}   (${source})`);
    this._physics_lines = lines;
  }

  // ==== Per-frame update ====
  update(dt) {
    const webcam = this.inputs.webcam;
    if (webcam) {
      if (webcam.setGameReady) webcam.setGameReady(this.state === 'ready' && !this.paused);
    }
    if (!this.paused) this.input_source.update();

    if (this.input_mode === 'webcam' && webcam) {
      this._webcam_status = webcam.status();
      if (this._webcam_status.error && !this._webcam_error_handled) {
        this._webcam_error_handled = true;
        this._show_message(`Webcam unavailable: ${this._webcam_status.error}  -  switched to MOUSE controls (TAB/2 to retry).`, 10.0, true);
        this.set_input_mode('mouse', false);
        if (this.state === 'handoff') this._handoff_progress = 1.0;
      }
    } else this._webcam_status = null;

    if (this.paused) {
      this._overlay_update(dt);
      this._webcam_panel_update(webcam);
      this._hud();
      this._update_motion(dt, true);
      return;
    }

    if (this.mode.timed && (this.state === 'ready' || this.state === 'handoff')) {
      this.match.tick(dt);
      if (this.match.time_up) {
        this._finish_match();
        this._webcam_panel_update(webcam);
        updateCamera(this.ball, this.state, dt);
        this._hud();
        return;
      }
    }
    if (this.mode.timed && this.state === 'ready') this._rush_warning();

    if (this.state === 'question') this._update_question(dt);
    else if (this.state === 'challenge') this._update_challenge(dt);
    else if (this.state === 'ready') this._update_ready(dt);
    else if (this.state === 'rolling') {
      this._advance_roll(dt);
      if (this.ball.finished) { this.state = 'settling'; this.timer = config.SETTLE_DELAY; }
    } else if (this.state === 'settling') {
      this.pins.settle(dt * this.motion.slowMotionScale());
      this.settle_elapsed += dt;
      this.timer -= dt;
      if (this.timer <= 0.0 && (this.pins.deckQuiet() || this.settle_elapsed >= config.SETTLE_MAX_TIME)) this._resolve_roll();
    } else if (this.state === 'result') this._update_result(dt);
    else if (this.state === 'handoff') this._update_handoff(dt);

    this._update_avatar(dt);
    if (this.message_timer > 0.0) this.message_timer = Math.max(0.0, this.message_timer - dt);

    this.pins.update();
    this.ball.update();
    this._webcam_panel_update(webcam);
    updateCamera(this.ball, this.state, dt);
    this._overlay_update(dt);
    this._hud();
    this._update_motion(dt, false);
  }

  _advance_roll(dt) {
    if (!this._hit_announced && this.ball.physics.z >= config.PIN_CAMERA_TRIGGER_Z) {
      this._hit_announced = true;
      fovPushIn();
      this.motion.onShotHit([this.ball.x, 0.30, this.ball.physics.z], null, this._ball_speed());
    }
    const deck = this.pins.deck;
    if (!this._impact_announced && deck.first_contact_time !== null) {
      this._impact_announced = true;
      this.motion.onPinImpact([this.ball.x, 0.30, this.ball.physics.z], deck.impact_speed);
    }
    this.pins.advance(this.ball, dt * this.motion.slowMotionScale());
  }

  _ball_speed() {
    const velocity = this.ball.physics.velocity;
    return Math.hypot(velocity[0], velocity[2]);
  }

  _update_motion(dt, paused = false) {
    let meter = null;
    const source = this.input_source;
    if (source.dragging !== undefined && !paused) meter = [!!source.dragging, this._drag_power()];
    if (!paused) this._update_aim_indicator(dt);
    this.motion.update(dt, this.ball, this.pins, this.state, meter);
  }

  _drag_power() {
    const power = this.input_source.power;
    const value = Number(power);
    return Number.isFinite(value) ? clamp(value, 0.0, 1.0) : 0.0;
  }

  _update_ready(dt) {
    const player = this.match.current_player;
    if (player.is_bot) { this._update_bot(dt); return; }
    this.ball.x = this.input_source.lateral;
    this.ball.physics.x = this.input_source.lateral;
    const throwData = this.input_source.throw_data;
    if (throwData !== null) this.launch(throwData);
  }

  _update_aim_indicator(dt) {
    let active = this.state === 'ready' && !this.paused && this.match !== null && !this.match.current_player.is_bot;
    let aimOffset = this.input_source.aim_offset;
    let aimAngle = this.input_source.aim_angle;
    if (aimOffset === undefined || aimAngle === undefined) { active = false; aimOffset = 0.0; aimAngle = 0.0; }
    this.motion.updateAimGuide(dt, active, this.ball.physics.x, aimAngle,
      config.FOUL_LINE_Z, config.AIM_ARROW_Z, aimOffset);
  }

  _update_question(dt) {
    if (this.feedback === null) return;
    if (!this.feedback.correct && this.attempts_left > 0) return;
    this.timer -= dt;
    if (this.timer <= 0.0) this._advance_question();
  }

  _update_challenge(dt) { /* Equation Mode has no timers */ }

  _update_result(dt) {
    this.timer -= dt;
    if (this.timer > 0.0) return;
    const action = this.pending_action;
    const webcam = this.inputs.webcam;
    if (webcam && webcam.setGameReady) webcam.setGameReady(false);
    if (action === 'next_roll') this._enter_ready();
    else if (action === 'next_question') this._enter_question();
    else if (action === 'handoff') this._enter_handoff();
    else if (this.state !== 'game_over') this._finish_match();
  }

  _rush_warning() {
    const remaining = Math.ceil(this.match.time_left || 0.0);
    if (remaining <= 5 && remaining !== this._last_rush_tick) {
      this._last_rush_tick = remaining;
      this._play('tick');
      this._show_message(`${remaining} seconds left!`, 1.2);
    }
  }

  _webcam_panel_update(webcam) {
    if (this.input_mode === 'webcam' && webcam) this.webcam_panel.update(webcam.latestSnapshot(), this._webcam_status, true);
    else this.webcam_panel.update(null, null, false);
  }

  _overlay_update(dt) {
    if (!this._overlay) return;
    this._overlay.layout();
  }

  _hud() {
    const knockdowns = this.state === 'result' ? this.knockdowns : null;
    const timer = this.mode.timed && this.match ? this.match.time_left : null;
    const usesFrames = this.mode.score_style === 'frames';
    const standing = usesFrames ? this.score.standing_pins() : this.pins.standingCount();
    const player = this.match ? this.match.current_player : null;
    const scoreValue = usesFrames ? this.score.current_score : (player ? player.total_pins : 0);
    this.hud.update(this.ball, knockdowns, this.score, this.state, {
      input_mode: this.input_mode, webcam_status: this._webcam_status,
      message: this.message_timer > 0.0 ? this.message : '', message_warning: this.message_warning,
      match: this.match, mode: this.mode, paused: this.paused,
      question: this.state === 'question' ? this.current_question : null,
      answer_text: this.answer_text, feedback: this.feedback, question_progress: this.question_progress,
      results: this.state === 'game_over' && this._overlay === null ? this.results_lines : null,
      physics_lines: this._physics_visible() ? this._physics_lines : null,
      timer: timer, rush: this.mode.timed, hide_scorecard: !usesFrames,
      standing_pins: standing === null ? 0 : standing, score_value: scoreValue,
      hints_unlocked: this.hints_unlocked, attempts_left: this.attempts_left,
      throw_earned: this.throw_earned,
      challenge_state: this.state === 'challenge' && this.challenge !== null ? this._challenge_view() : null,
    });
    if (this.state !== 'handoff') this.handoff_banner.hide();
  }

  // ==== Input ====
  onKey(key) { return this.on_key(key); }

  on_key(key) {
    if (this._overlay !== null) {
      if (key === 'up arrow') { this._overlay.moveSelection(-1); return; }
      if (key === 'down arrow') { this._overlay.moveSelection(1); return; }
      if (key === 'enter') { this._overlay.activate(); return; }
    }
    if (key === 'escape') {
      if (this.state === 'game_over') this._quit_to_menu();
      else this.toggle_pause();
      return;
    }
    if (key === 'tab') { this.set_input_mode(this.input_mode === 'webcam' ? 'mouse' : 'webcam'); return; }
    if (key === 'p' && (this.paused || !['question', 'challenge'].includes(this.state))) { this.toggle_pause(); return; }
    if (this.paused) return;
    if (this.state === 'question') { this._question_key(key); return; }
    if (this.state === 'challenge') { this._challenge_key(key); return; }
    if (key === '1') { this.set_input_mode('mouse'); return; }
    if (key === '2') { this.set_input_mode('webcam'); return; }
    if (key === 'c' && this.input_mode === 'webcam') {
      const cycle = this.input_source.cyclePreferredArm;
      if (typeof cycle === 'function') {
        const arm = cycle.call(this.input_source);
        this._show_message(`Throwing arm: ${String(arm).toUpperCase()}  (C to change)`, 2.5);
      }
      return;
    }
    if (key === 'r') {
      if (this.state === 'game_over') this.new_game();
      else if (this.state === 'ready') this._enter_ready();
      return;
    }
    if (key === 'h') { this.toggle_physics_panel(); return; }
    if (this.state === 'handoff' && ['enter', 'space'].includes(key)) { this._confirm_handoff(); return; }
    if (this.state === 'game_over' && key === 'enter') this.restart_match();
  }

  _question_key(key) {
    if (key === 'enter') { this.submit_answer(); return; }
    if (key === 'backspace') { this.answer_text = this.answer_text.slice(0, -1); return; }
    if (this.feedback !== null && !this.feedback.correct && this.attempts_left > 0) {
      this.answer_text = '';
      this.feedback = null;
    }
    if (key === 'space' && !this.answer_text) return;
    const character = keyToCharacter(key);
    if (character && this.answer_text.length < 24) this.answer_text += character;
  }

  on_click(x, y) {
    // Mirrors game/play.py's on_click: overlays and the active panel own the
    // click; a click on the background confirms a handoff / continues a marked
    // question. DOM controls stop propagation, so reaching here means the
    // click was on the game itself.
    if (this._overlay !== null) return true;
    if (this.state === 'question') {
      if (this.feedback !== null) { this.continue_question(); return true; }
      return false;
    }
    if (this.state === 'challenge') return false;
    if (this.state === 'handoff') { this._confirm_handoff(); return true; }
    if (this.state === 'game_over') return true;
    return false;
  }

  shutdown() {
    const webcam = this.inputs.webcam;
    if (webcam && webcam.stop) webcam.stop();
  }
}
