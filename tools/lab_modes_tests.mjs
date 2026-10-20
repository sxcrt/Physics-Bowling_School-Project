// Physics Lab checks.
//
//   node tools/lab_modes_tests.mjs
//
// One test per validation check, plus copy/shape audits. The reported count is
// the number of individual assertions, not just test functions.

import assert from 'node:assert/strict';
import { runLabValidation, solveJourney } from '../src/ui/lab_suvat.js';
import { runNewLabValidation } from '../src/ui/lab_validation.js';
import { MODES } from '../src/ui/lab_modes.js';
import { solveInertia, SHAPES } from '../src/ui/lab_inertia.js';

let passed = 0;
let assertions = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};
const ok = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};

const linearChecks = runLabValidation();
const newChecks = runNewLabValidation();
for (const check of [...linearChecks, ...newChecks]) {
  test(check.name, () => ok(check.pass, `${check.name}: ${JSON.stringify(check.actual)}`));
}

test('validation suite reports forty checks', () => {
  ok(linearChecks.length === 17, `Linear checks: ${linearChecks.length}`);
  ok(newChecks.length === 23, `New-lab checks: ${newChecks.length}`);
});

test('every shape formula agrees with its compute function', () => {
  const expected = {
    disk: { formula: 'I = ½ M R²', I: 1 },          // ½ × 2 × 1²
    ring: { formula: 'I = M R²', I: 2 },
    sphere: { formula: 'I = ⅖ M R²', I: 0.8 },
    shell: { formula: 'I = ⅔ M R²', I: 4 / 3 },
    rodEnd: { formula: 'I = ⅓ M L²', I: 2 / 3 },
    rodCenter: { formula: 'I = 1/12 M L²', I: 1 / 6 },
    point: { formula: 'I = m r²', I: 2 },
    custom: { formula: 'I = Σ m r²', I: 2 },
  };
  for (const shape of SHAPES) {
    const known = shape.uses === 'L' ? { M: 2, L: 1 } : { M: 2, R: 1 };
    const result = solveInertia({
      known,
      submode: 'shape',
      shape: shape.id,
      customParts: [{ m: 2, r: 1 }],
    });
    ok(shape.formula === expected[shape.id].formula,
      `${shape.id} formula ${shape.formula}`);
    ok(Math.abs(result.values.I - expected[shape.id].I) < 1e-9,
      `${shape.id} I ${result.values.I}`);
  }
});

test('thin ring is I = M R², not ½ M R²', () => {
  const ring = SHAPES.find((shape) => shape.id === 'ring');
  const disk = SHAPES.find((shape) => shape.id === 'disk');
  ok(ring.formula === 'I = M R²', ring.formula);
  ok(disk.formula === 'I = ½ M R²', disk.formula);
});

test('no variable label leaks a code key or Greek stand-in', () => {
  for (const mode of MODES) {
    for (const field of mode.variables) {
      ok(!/\([a-z]/.test(field.label), `${mode.id}/${field.key}: ${field.label}`);
      ok(!/\b[wa]\b/.test(field.label), `${mode.id}/${field.key}: ${field.label}`);
      ok(field.symbol && field.symbol.length > 0, `${mode.id}/${field.key} symbol`);
      ok(field.label.length > 0, `${mode.id}/${field.key} label`);
    }
  }
});

test('journey still back-solves and totals correctly', () => {
  const legs = [
    { distance: 120, direction: 1, time: 20 },
    { distance: 80, direction: -1, time: 10 },
  ];
  const result = solveJourney(legs);
  ok(result.status === 'solved', result.status);
  ok(result.results.totalDistance === 200, result.results.totalDistance);
  ok(result.results.displacement === 40, result.results.displacement);
  ok(result.results.totalTime === 30, result.results.totalTime);
  const solved = solveJourney([
    { distance: 120, direction: 1, time: 20 },
    { distance: 80, direction: -1, time: null },
  ], { totalTime: 30 });
  ok(solved.solvedLeg?.value === 10, JSON.stringify(solved.solvedLeg));
});

console.log(`\n${passed} Lab tests, ${assertions} individual assertions passed.`);
