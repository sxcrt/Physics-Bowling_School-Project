// Game-mode definitions (ported from game/modes.py).
export const SCORE_FRAMES = 'frames';
export const SCORE_TOTAL_PINS = 'pins';
export const GATE_NONE = 'none';
export const GATE_TRIVIA = 'trivia';
export const GATE_EQUATIONS = 'equations';

export class ModeDefinition {
  constructor(data) {
    Object.assign(this, {
      id: '', title: '', subtitle: '', summary: '', description: '',
      motif: '', ball_rgb: [255, 255, 255],
      score_style: SCORE_FRAMES, gate: GATE_NONE, min_players: 1, max_players: 1,
      fixed_players: 0, allow_bot: false, timed: false, default_duration: 180.0,
      duration_options: [60.0, 120.0, 180.0, 300.0], frames: 10, questions: 0,
      resolves_every_throw: false, requires_input_choice: true,
      single_throw_per_player: false, rules: [],
    }, data);
  }
  get player_range() {
    if (this.fixed_players) return [this.fixed_players, this.fixed_players];
    return [this.min_players, this.max_players];
  }
  defaultPlayerCount() {
    if (this.fixed_players) return this.fixed_players;
    return this.min_players + (this.allow_bot ? 1 : 0);
  }
}

export const CLASSIC = new ModeDefinition({
  id: 'classic', title: 'CLASSIC BOWLING', subtitle: 'Ten frames, real scoring',
  summary: 'Play a complete ten-frame bowling game.',
  description: 'A full ten-frame game with standard scoring: strikes, spares, the tenth-frame bonus balls and a running total.',
  motif: 'X', ball_rgb: [34, 78, 200],
  rules: ['10 frames, up to 2 rolls each', 'Strike = 10 + your next 2 rolls',
          'Spare = 10 + your next roll', 'The tenth frame earns bonus balls'],
});

export const TRIVIA = new ModeDefinition({
  id: 'trivia', title: 'PHYSICS TRIVIA', subtitle: 'Right answer, then throw',
  summary: 'Answer physics questions to earn bowling throws.',
  description: 'Answer a physics question to earn a throw. A correct answer unlocks the roll; a wrong one costs you that throw.',
  motif: '?', ball_rgb: [232, 72, 168],
  score_style: SCORE_TOTAL_PINS, gate: GATE_TRIVIA, fixed_players: 1,
  questions: 10, resolves_every_throw: true,
  rules: ['10 physics questions', 'Correct answer = one throw at a full rack',
          'Wrong answer = no throw, the answer is explained', 'Score = total pins knocked down'],
});

export const EQUATIONS = new ModeDefinition({
  id: 'equations', title: 'EQUATION CHALLENGE', subtitle: 'Set the physics, curve the ball',
  summary: 'Solve physics challenges that steer the ball.',
  description: 'Work out the release the challenge asks for - hook spin, speed, angle, torque - and bowl it: the simulation then shows what that value really does to the ball. Tune the value until the pin falls.',
  motif: 'Δv/t', ball_rgb: [96, 226, 176],
  score_style: SCORE_TOTAL_PINS, gate: GATE_EQUATIONS, fixed_players: 1,
  questions: 10, resolves_every_throw: true,
  rules: ['10 interactive physics challenges', 'Work out the one release value each challenge needs',
          'Bowl it: the real simulation decides the outcome', 'Unlimited attempts, equations and measurements shown',
          'Score = pins knocked down'],
});

export const PVBOT = new ModeDefinition({
  id: 'pvbot', title: 'PLAYER VS BOT', subtitle: 'Beat the house bowler',
  summary: 'Challenge a bowling AI with adjustable difficulty.',
  description: 'One player against an AI bowler that aims and throws with the same physics you do. Three difficulties.',
  motif: 'AI', ball_rgb: [150, 96, 232],
  min_players: 1, max_players: 1, allow_bot: true,
  rules: ['You and the bot alternate frames', 'The bot picks its own line, speed and hook, then simulates it',
          'Easy, Medium and Hard change how well it aims', 'Standard ten-frame scoring'],
});

export const LOCAL = new ModeDefinition({
  id: 'local', title: 'LOCAL MULTIPLAYER', subtitle: 'Two to four bowlers',
  summary: 'Compete with two to four local players.',
  description: 'Two to four people share the computer, taking turns frame by frame. Standard ten-frame scoring.',
  motif: '2-4', ball_rgb: [255, 190, 60],
  min_players: 2, max_players: 4,
  rules: ['2 to 4 players, alternating frames', 'Standard ten-frame scoring for everyone',
          'Highest total wins; ties are reported as a draw'],
});

export const RUSHRUSH = new ModeDefinition({
  id: 'bowlrush', title: 'BOWLRUSH', subtitle: 'Timed pin rush',
  summary: 'Race against the clock to knock down the most pins.',
  description: 'Three minutes, two players, fresh rack every throw. Knock down more pins than your rival before the clock runs out.',
  motif: '3:00', ball_rgb: [120, 220, 255],
  score_style: SCORE_TOTAL_PINS, min_players: 2, max_players: 2, timed: true,
  default_duration: 180.0, resolves_every_throw: true, single_throw_per_player: true,
  rules: ['Timed match, 3 minutes by default', 'Frames do not count: every throw faces a fresh rack',
          'Players alternate throws', 'A throw that starts before time runs out is allowed to finish',
          'Most pins knocked down wins'],
});

export const ALL = [CLASSIC, TRIVIA, EQUATIONS, PVBOT, LOCAL, RUSHRUSH];
export const BY_ID = Object.fromEntries(ALL.map((m) => [m.id, m]));
export const PICKER_ORDER = ['classic', 'trivia', 'equations', 'pvbot', 'local', 'bowlrush'];

export function get(modeId) { return BY_ID[modeId]; }
export function pickerModes() { return PICKER_ORDER.map((id) => BY_ID[id]); }
export function botDifficulties() { return [['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']]; }
