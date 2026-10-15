// Players, turns and match state (ported from game/session.py).
import { BowlingGame } from '../scoring.js';

export const PLAYER_COLORS = [
  [120, 220, 255], [255, 122, 122], [255, 214, 130], [150, 230, 150],
];
export const MAX_NAME_LENGTH = 12;
export const ROLL_RECORDED = 'recorded';
export const SAME_PLAYER = 'same_player';
export const TURN_CHANGED = 'turn_changed';
export const ROUND_CHANGED = 'round_changed';
export const MATCH_OVER = 'match_over';

export function defaultName(index) { return `PLAYER ${index + 1}`; }

export class Player {
  constructor(index, name = '', rgb = [255, 255, 255], isBot = false, difficulty = 'medium') {
    this.index = index;
    this.name = name || defaultName(index);
    this.rgb = rgb;
    this.is_bot = !!isBot;
    this.difficulty = difficulty;
    this.bowling = new BowlingGame();
    this.total_pins = 0;
    this.throws = 0;
    this.answered = 0;
    this.correct = 0;
    this.last_knockdowns = 0;
    this.finished_pending = false;
  }

  get frame_score() { return this.bowling.current_score; }
  get final_score() {
    if (this.bowling.is_complete && this.bowling.total_score !== null) return this.bowling.total_score;
    return null;
  }
  get score() {
    const final = this.final_score;
    return final !== null ? final : this.bowling.current_score;
  }
  get is_done() { return this.bowling.is_complete; }

  resetScores() {
    this.bowling.reset();
    this.total_pins = 0;
    this.throws = 0;
    this.answered = 0;
    this.correct = 0;
    this.last_knockdowns = 0;
  }
}

export class Match {
  constructor(mode, players = null, duration = null) {
    this.mode = mode;
    this.players = players && players.length ? players.slice() : [new Player(0, '', PLAYER_COLORS[0])];
    this.turn_index = 0;
    this.round_number = 1;
    this.duration = duration !== null ? duration : mode.default_duration;
    this.time_left = mode.timed ? this.duration : null;
    this.finished = false;
    this.rolls_taken = 0;
  }

  static create(mode, playerSpecs = null, duration = null) {
    const specs = (playerSpecs || []).slice();
    const players = specs.map((spec, index) => {
      if (spec instanceof Player) { spec.index = index; return spec; }
      return new Player(index, spec.name || '', spec.rgb || PLAYER_COLORS[index % PLAYER_COLORS.length],
                        !!spec.is_bot, spec.difficulty || 'medium');
    });
    if (!players.length) players.push(new Player(0, '', PLAYER_COLORS[0]));
    return new Match(mode, players, duration);
  }

  rebuild(playerSpecs = null, duration = null) {
    let specs = playerSpecs;
    if (specs === null) {
      specs = this.players.map((p) => ({ name: p.name, rgb: p.rgb, is_bot: p.is_bot, difficulty: p.difficulty }));
    }
    const fresh = Match.create(this.mode, specs, duration);
    this.players = fresh.players;
    this.duration = fresh.duration;
    this.time_left = fresh.time_left;
    this.turn_index = 0;
    this.round_number = 1;
    this.finished = false;
    this.rolls_taken = 0;
    return this;
  }

  get current_player() { return this.players[this.turn_index % this.players.length]; }
  get player_count() { return this.players.length; }
  get uses_frames() { return this.mode.score_style === 'frames'; }

  setTurn(index) { this.turn_index = index % this.players.length; this.round_number = this.turn_index + 1; }

  nextTurn() {
    for (let step = 1; step <= this.players.length; step++) {
      const index = (this.turn_index + step) % this.players.length;
      if (!this.players[index].is_done) { this.setTurn(index); return true; }
    }
    this.finished = true;
    return false;
  }

  advance() {
    if (!this.uses_frames) return this.nextTurn() ? 'turn_changed' : 'match_over';
    const player = this.current_player;
    if (!player.is_done) return 'same_player';
    if (!this.nextTurn()) return 'match_over';
    return this.turn_index !== 0 ? 'turn_changed' : 'round_changed';
  }

  recordRoll(pins, advance = true) {
    if (this.is_complete) return 'match_over';
    pins = Math.floor(pins);
    const player = this.current_player;
    player.throws += 1;
    player.last_knockdowns = pins;
    this.rolls_taken += 1;
    if (!this.uses_frames) {
      player.total_pins += Math.max(0, pins);
      if (!advance) return 'recorded';
      if (!this.nextTurn()) return 'match_over';
      return 'turn_changed';
    }
    let legal = player.bowling.standingPins();
    if (legal !== null) pins = Math.max(0, Math.min(pins, legal));
    const frameBefore = player.bowling.current_frame_number;
    player.bowling.recordRoll(pins);
    player.total_pins += pins;
    if (!advance) return 'recorded';
    if (player.bowling.is_complete || player.bowling.current_frame_number !== frameBefore) {
      if (!this.nextTurn()) return 'match_over';
      return this.turn_index !== 0 ? 'turn_changed' : 'round_changed';
    }
    return 'same_player';
  }

  recordAnswer(correct) {
    const student = this.current_player;
    student.answered += 1;
    if (correct) student.correct += 1;
  }

  finish() {
    this.finished = true;
    for (const player of this.players) player.finished_pending = true;
  }

  tick(dt) {
    if (!this.mode.timed || this.time_left === null) return true;
    this.time_left = Math.max(0.0, this.time_left - dt);
    return this.time_left > 0.0;
  }

  get time_up() { return this.mode.timed && this.time_left !== null && this.time_left <= 0.0; }

  get is_complete() {
    if (this.mode.timed) return this.finished || this.time_up;
    if (this.finished) return true;
    return this.players.every((p) => p.is_done);
  }

  scoreOf(player) { return this.uses_frames ? player.score : player.total_pins; }
  scoreboard() { return this.players.map((p) => [p, this.scoreOf(p)]); }

  winners() {
    const board = this.scoreboard();
    if (!board.length) return [];
    const best = Math.max(...board.map(([, s]) => s));
    return board.filter(([, s]) => s === best).map(([p]) => p);
  }

  resultLine() {
    if (!this.is_complete) return '';
    const winners = this.winners();
    if (winners.length === 1) return `${winners[0].name} WINS!`;
    const names = winners.map((p) => p.name).join(' & ');
    return `DRAW: ${names}`;
  }
}
