// Physics Trivia questions and answer checking (ported from game/questions.py).
const NUMBER_RE = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/;
const MULTIPLY = ['*', '·', '⋅', '×', '∙'];
const NORMALISE_CHARS = {
  '\u2212': '-', '\u2013': '-', '\u00b7': '*', '\u22c5': '*', '\u00d7': '*', '\u00b0': '',
};

export class Question {
  constructor(data) {
    // Dataclass defaults from game/questions.py.
    this.prompt = '';
    this.answer = '';
    this.unit = '';
    this.accepted_units = [];
    this.tolerance = 0.02;
    this.abs_tolerance = 0.05;
    this.aliases = [];
    this.equation = '';
    this.given = [];
    this.unknown = '';
    this.working = '';
    this.concept = '';
    this.assumptions = '';
    this.id = '';
    this.given_values = {};
    this.bowling = '';
    this.case = '';
    this.hints = [];
    Object.assign(this, data);
  }
  get is_numeric() { return typeof this.answer === 'number'; }
  expectedText() {
    if (!this.is_numeric) return String(this.answer);
    const value = formatNumber(this.answer);
    return `${value} ${this.unit}`.trim();
  }
}

export class Feedback {
  constructor(correct, summary = '', parsedValue = null, parsedUnit = '', expected = '',
              working = '', detail = '') {
    this.correct = correct; this.summary = summary; this.parsed_value = parsedValue;
    this.parsed_unit = parsedUnit; this.expected = expected; this.working = working;
    this.detail = detail;
  }
  valueOf() { return this.correct; }
}

export function normalise(text) {
  if (text === null || text === undefined) return '';
  let out = String(text).trim();
  for (const [source, target] of Object.entries(NORMALISE_CHARS)) out = out.split(source).join(target);
  return out.toLowerCase();
}

export function normaliseUnit(text) {
  let out = normalise(text);
  for (const glyph of MULTIPLY) out = out.split(glyph).join('');
  for (const token of [' ', '\t', '^', '**', 'per ']) out = out.split(token).join('');
  out = out.split('1/s').join('/s');
  out = out.split('s-1').join('/s');
  out = out.split('s^-1').join('/s');
  out = out.split('m/s2').join('m/s^2');
  out = out.split('m/s²').join('m/s^2');
  return out;
}

export function normaliseWords(text) {
  const out = normalise(text);
  return out.split('').filter((ch) => /[a-z0-9]/.test(ch)).join('');
}

export function parseNumber(text) {
  const match = normalise(text).match(NUMBER_RE);
  if (!match) return null;
  try { return parseFloat(match[0]); } catch (_e) { return null; }
}

export function parseAnswer(text) {
  const cleaned = normalise(text);
  const match = cleaned.match(NUMBER_RE);
  if (!match) return [null, normaliseUnit(cleaned)];
  const value = parseNumber(match[0]);
  const unit = cleaned.slice(0, match.index) + ' ' + cleaned.slice(match.index + match[0].length);
  return [value, normaliseUnit(unit)];
}

function formatNumber(value) {
  if (value === Math.trunc(value) && Math.abs(value) < 1e6) return String(Math.trunc(value));
  return value.toPrecision(4).replace(/\.?0+$/, '').replace(/\.$/, '');
}

function close(measured, expected, question) {
  if (measured === null) return false;
  const tolerance = Math.max(question.abs_tolerance, Math.abs(expected) * question.tolerance);
  return Math.abs(measured - expected) <= tolerance;
}

export function checkNumeric(question, value, unitText) {
  const expected = Number(question.answer);
  if (value === null) {
    return new Feedback(false, 'No number found in that answer.', null, '',
      question.expectedText(), question.working, 'Type the value, for example "6" or "6 m/s".');
  }
  if (unitText) {
    const allowed = new Set([normaliseUnit(question.unit),
      ...(question.accepted_units || []).map((u) => normaliseUnit(u))]);
    allowed.delete('');
    if (allowed.size && !allowed.has(unitText)) {
      return new Feedback(false,
        `That unit is not the one this question is asking for (expected ${question.unit || 'no unit'}).`,
        value, unitText, question.expectedText(), question.working);
    }
  }
  if (!close(value, expected, question)) {
    return new Feedback(false, 'Not quite - check the substitution and the arithmetic.',
      value, unitText, question.expectedText(), question.working,
      `Your answer: ${formatNumber(value)}. Expected: ${question.expectedText()}.`);
  }
  return new Feedback(true, `Correct: ${question.expectedText()}.`,
    value, unitText, question.expectedText(), question.working);
}

export function checkText(question, text) {
  const candidate = normaliseWords(text);
  const accepted = new Set([normaliseWords(question.answer),
    ...(question.aliases || []).map((a) => normaliseWords(a))]);
  if (candidate && accepted.has(candidate)) {
    return new Feedback(true, `Correct: ${question.answer}.`, null, '', String(question.answer), question.working);
  }
  return new Feedback(false, 'That is not the answer this question is after.',
    null, '', String(question.answer), question.working, `You answered: "${String(text).trim()}".`);
}

export function checkAnswer(question, text) {
  if (text === null || text === undefined || !String(text).trim()) {
    return new Feedback(false, 'Enter an answer first.', null, '', question.expectedText(), question.working);
  }
  if (question.is_numeric) {
    const [value, unitText] = parseAnswer(text);
    return checkNumeric(question, value, unitText);
  }
  return checkText(question, text);
}

export const TRIVIA_QUESTIONS = [
  new Question({
    prompt: 'Which physical quantity is the product of mass and velocity?',
    answer: 'momentum', aliases: ['linear momentum', 'the momentum', 'p', 'momenta'],
    concept: 'Momentum', working: 'p = m v. Mass times velocity is momentum, measured in kg m/s.',
  }),
  new Question({
    prompt: 'What is the SI unit of force?',
    answer: 'newton', aliases: ['newtons', 'n', 'newton (n)'],
    concept: 'Force and units',
    working: 'The newton (N): 1 N = 1 kg m/s^2, the force that gives 1 kg an acceleration of 1 m/s^2.',
  }),
  new Question({
    prompt: 'A bowling ball rolls down the lane at a constant speed in a straight line. What is its acceleration? Give the value.',
    answer: 0.0, unit: 'm/s^2', accepted_units: ['m/s2', 'm s^-2', 'm/s/s', 'ms-2'],
    concept: 'Acceleration',
    working: 'a = dv/dt. Velocity is not changing, so the acceleration is 0 m/s^2 (friction and the lane force balance out).',
  }),
  new Question({
    prompt: 'A ball is sliding forward on the lane. Which way does the kinetic friction force on the ball point?',
    answer: 'backwards',
    aliases: ['backward', 'opposite the motion', 'opposite to the motion', 'against the motion',
              'opposite the direction of motion', 'opposite', 'back', 'in the opposite direction'],
    concept: 'Friction',
    working: 'Kinetic friction always opposes the relative sliding, so on a forward-sliding ball it points backwards along the lane.',
  }),
  new Question({
    prompt: 'Which has more kinetic energy: a 6 kg ball rolling at 8 m/s, or a 2 kg ball rolling at 16 m/s?',
    answer: '2 kg ball',
    aliases: ['the 2 kg ball', '2kg', '2 kg', 'the 2kg ball', 'second', 'the second', 'b',
              '2 kilogram ball', 'the 2 kilogram ball'],
    concept: 'Kinetic energy',
    working: 'KE = 1/2 m v^2: the 6 kg ball has 192 J, the 2 kg ball has 256 J, so the lighter but much faster ball has more.',
  }),
  new Question({
    prompt: 'During the impact between a heavy ball and a light pin, how do the magnitudes of the forces on the two bodies compare?',
    answer: 'equal',
    aliases: ['they are equal', 'the same', 'same', 'equal and opposite', 'equal in magnitude',
              'the same magnitude', 'both the same', 'they are the same'],
    concept: "Newton's third law",
    working: 'The forces are an action-reaction pair: equal in magnitude, opposite in direction. The accelerations differ because the masses differ.',
  }),
  new Question({
    prompt: 'A ball travels 18 m in 3 s at a constant speed. What is its speed?',
    answer: 6.0, unit: 'm/s', accepted_units: ['m s^-1', 'ms-1', 'm.s^-1', 'mps'],
    concept: 'Speed', working: 'v = d/t = 18 m / 3 s = 6 m/s.',
  }),
  new Question({
    prompt: 'Which quantity is the rate of change of velocity?',
    answer: 'acceleration', aliases: ['the acceleration', 'a', 'acceleration of the body'],
    concept: 'Acceleration',
    working: 'Acceleration is how fast velocity changes: a = dv/dt, in m/s^2.',
  }),
  new Question({
    prompt: 'A bowler speeds a ball up from 4 m/s to 8 m/s in 2 s. What is the acceleration?',
    answer: 2.0, unit: 'm/s^2', accepted_units: ['m/s2', 'm/s/s', 'ms-2', 'm s^-2'],
    concept: 'Acceleration', working: 'a = (v - u)/t = (8 - 4)/2 = 2 m/s^2.',
  }),
  new Question({
    prompt: 'Impulse is equal to the change in which quantity?',
    answer: 'momentum', aliases: ['linear momentum', 'the momentum', 'p', 'momenta'],
    concept: 'Impulse',
    working: 'J = F dt = dp. An impulse changes momentum, which is why a hard hit (short contact, large force) changes it quickly.',
  }),
];

export function triviaForSession(count = null) {
  const questions = TRIVIA_QUESTIONS.slice();
  return count ? questions.slice(0, count) : questions;
}

export function bankSize() { return TRIVIA_QUESTIONS.length; }
