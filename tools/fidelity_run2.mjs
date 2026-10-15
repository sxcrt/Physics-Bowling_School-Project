// Run the browser ports of scoring / challenges / questions on the same cases
// and write JSON for tools/fidelity_compare2.mjs.
import fs from 'fs';
import { BowlingGame } from '../src/scoring.js';
import * as ch from '../src/game/challenges.js';
import * as q from '../src/game/questions.js';

const ROLL_SEQUENCES = [
  Array(12).fill(10),
  Array(9).fill([9, 0]).flat().concat([9, 0]),
  Array(20).fill(1),
  Array(20).fill(0),
  [7, 3, 10, 4, 6, 5, 5, 8, 2, 10, 9, 1, 6, 2, 10, 10, 7, 3],
  Array(10).fill([3, 4]).flat(),
  Array(12).fill(10),
  [0, 10, 10, 5, 5, 0, 0, 10, 2, 8, 10, 4, 6, 10],
];

function dumpScoring() {
  const out = [];
  for (const rolls of ROLL_SEQUENCES) {
    const game = new BowlingGame();
    try {
      for (const pins of rolls) {
        game.recordRoll(pins);
        if (game.is_complete) break;
      }
    } catch (exc) { out.push({ rolls, error: String(exc) }); continue; }
    out.push({
      rolls: game.rolls,
      frames: Array.from({ length: 10 }, (_, i) => game.frameRolls(i + 1)),
      marks: Array.from({ length: 10 }, (_, i) => game.frameMarks(i + 1)),
      cumulative: game.cumulativeScores().map((s) => (s === null ? null : s)),
      current: game.current_score,
      total: game.total_score,
      complete: game.is_complete,
      current_frame: game.current_frame_number,
      standing: game.standingPins(),
    });
  }
  return out;
}

function round9(v) { return Math.round(v * 1e9) / 1e9; }

function dumpChallenges() {
  return ch.CHALLENGES.map((challenge) => ({
    id: challenge.id,
    answer: round9(challenge.answer),
    expected: challenge.expectedText(),
    targets: challenge.targets.slice(),
    rack: challenge.rack.map((pin) => pin.slice()),
    aim_x: round9(challenge.aimX()),
    aim_z: round9(challenge.aimZ()),
    launch_values: challenge.launchValues(challenge.answer).map((v) => round9(v)),
    equation: challenge.equation,
    working: challenge.working,
    brief: challenge.brief,
    steps: challenge.steps.slice(),
  }));
}

function dumpQuestions() {
  const samples = [
    ['momentum', 'momentum'], ['newton', 'newton'], ['0', '0 m/s^2'],
    ['backwards', 'backward'], ['2 kg ball', 'the 2 kg ball'], ['equal', 'equal'],
    ['6', '18/3'], ['acceleration', 'a'], ['2.0', '2 m/s^2'], ['p', 'impulse'],
  ];
  const out = [];
  samples.forEach(([text, label], index) => {
    const question = q.TRIVIA_QUESTIONS[index % q.TRIVIA_QUESTIONS.length];
    const feedback = q.checkAnswer(question, text);
    out.push({
      label,
      correct: feedback.correct,
      summary: feedback.summary,
      expected: feedback.expected,
      detail: feedback.detail,
    });
  });
  return out;
}

const payload = {
  scoring: dumpScoring(),
  challenges: dumpChallenges(),
  questions: dumpQuestions(),
};
const target = process.argv[2];
const text = JSON.stringify(payload, null, 1);
if (target) fs.writeFileSync(target, text, 'utf8');
else console.log(text);
