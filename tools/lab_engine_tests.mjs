// Physics Lab engine round-trip suite.
//
//   node tools/lab_engine_tests.mjs
//
// The truth in this file is computed with independent formulas written here,
// never by calling the engine under test. For each lab the suite then enters
// only the smallest sufficient subsets of that truth and checks that the engine
// recovers every other quantity.
//
// It also walks every relation in both directions, checks the status text and
// suggestion chips, and keeps the earlier Q2-Q25 validation cases passing.

import assert from 'node:assert/strict';
import {
  solveRelations, guidance, REL_TOL,
} from '../src/ui/lab_engine.js';
import {
  solveBowling, BOWLING_RELATIONS, BOWLING_META,
} from '../src/ui/lab_bowling.js';
import {
  solveLinear, LINEAR_RELATIONS, LINEAR_META,
} from '../src/ui/lab_linear.js';
import {
  solveProjectile, PROJECTILE_RELATIONS, PROJECTILE_META,
} from '../src/ui/lab_projectile.js';
import {
  solveRotational, ROTATIONAL_RELATIONS, ROTATIONAL_META,
} from '../src/ui/lab_rotational.js';
import {
  solveTorque, TORQUE_RELATIONS, TORQUE_META,
} from '../src/ui/lab_torque.js';
import {
  solveInertia, INERTIA_RELATIONS, INERTIA_META, SHAPES,
} from '../src/ui/lab_inertia.js';
import {
  runLabValidation, solveJourney, findCrossings,
} from '../src/ui/lab_suvat.js';
import { runNewLabValidation } from '../src/ui/lab_validation.js';

let passed = 0;
let assertions = 0;
const failures = [];

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function ok(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

function near(actual, expected, tolerance = 1e-6) {
  return isNum(actual)
    && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)) + 1e-9;
}

function closeEnough(actual, expected, label, tolerance = 1e-6) {
  ok(near(actual, expected, tolerance),
    `${label}: expected ${expected}, got ${actual}`);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function combinations(items, size) {
  const out = [];
  const walk = (start, chosen) => {
    if (chosen.length === size) { out.push(chosen.slice()); return; }
    for (let index = start; index < items.length; index += 1) {
      chosen.push(items[index]);
      walk(index + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

function relationScale(relation, values) {
  if (typeof relation.scale === 'function') {
    const value = relation.scale(values);
    if (isNum(value) && value > 0) return value;
  }
  const numbers = relation.vars.map((key) => Math.abs(values[key])).filter(isNum);
  return Math.max(1, ...numbers);
}

// ---------------------------------------------------------------------------
// Every relation, every direction.
// ---------------------------------------------------------------------------

function catalog(lab, relations, meta, extraSamples = {}, extraLocked = {}) {
  const samples = {
    ...Object.fromEntries(Object.entries(meta).map(([key, field]) => [key, field.sample])),
    ...extraSamples,
  };
  let directions = 0;
  for (const relation of relations) {
    for (const target of relation.vars) {
      const typed = {};
      for (const key of relation.vars) {
        if (key === target) continue;
        const sample = samples[key];
        ok(isNum(sample), `${lab}/${relation.id}: no sample for ${key}`);
        typed[key] = sample;
      }
      const keys = [...new Set([...relation.vars, ...Object.keys(extraLocked)])];
      const result = solveRelations({
        keys,
        relations: [relation],
        typed,
        locked: extraLocked,
        goal: [target],
        meta,
        samples,
        diagnose: false,
      });
      ok(result.status === 'solved',
        `${lab}/${relation.id} solve ${target}: ${result.status} ${result.message}`);
      const values = { ...typed, [target]: result.values[target] };
      for (const [key, raw] of Object.entries(extraLocked)) {
        values[key] = typeof raw === 'object' ? raw.value : raw;
      }
      const residual = relation.residual(values);
      ok(isNum(residual),
        `${lab}/${relation.id} solve ${target}: residual is not finite`);
      ok(Math.abs(residual) <= 1e-5 * relationScale(relation, values),
        `${lab}/${relation.id} solve ${target}: residual ${residual}`);
      ok(isNum(result.values[target]) && Number.isFinite(result.values[target]),
        `${lab}/${relation.id} solve ${target}: non-finite answer`);
      directions += 1;
    }
  }
  return { relations: relations.length, directions };
}

const catalogCounts = {};
test('relation catalog: every relation solves in every direction', () => {
  catalogCounts.bowling = catalog('bowling', BOWLING_RELATIONS, BOWLING_META);
  catalogCounts.linear = catalog('linear', LINEAR_RELATIONS, LINEAR_META);
  catalogCounts.projectile = catalog('projectile', PROJECTILE_RELATIONS, PROJECTILE_META,
    { h0: 10, yTarget: 10, targetR: 30, H: 15 });
  catalogCounts.rotational = catalog('rotational', ROTATIONAL_RELATIONS, ROTATIONAL_META);
  catalogCounts.torque = catalog('torque', TORQUE_RELATIONS, TORQUE_META,
    { angle: 60 }, { dirSign: 1 });
  catalogCounts.inertia = catalog('inertia', INERTIA_RELATIONS, INERTIA_META, {
    I1: 2, I2: 2.25, M: 1, R: 0.5, I: 0.125, w: 12, Lm: 1.5, w1: 4, w2: 8,
  });
  for (const [lab, counts] of Object.entries(catalogCounts)) {
    ok(counts.relations > 0, `${lab} has relations`);
    ok(counts.directions >= counts.relations, `${lab} directions ${counts.directions}`);
  }
});

// ---------------------------------------------------------------------------
// Round-trip helpers.
// ---------------------------------------------------------------------------

function roundTrip(label, forward, candidates, maxSize, run, compareKeys = candidates) {
  let minimalSize = null;
  let solvedAtMinimal = 0;
  for (let size = 1; size <= maxSize && minimalSize === null; size += 1) {
    for (const subset of combinations(candidates, size)) {
      const known = Object.fromEntries(subset.map((key) => [key, forward[key]]));
      const result = run(known);
      if (result.status !== 'solved') continue;
      solvedAtMinimal += 1;
      for (const key of compareKeys) {
        if (!isNum(forward[key])) continue;
        closeEnough(result.values[key], forward[key],
          `${label} [${subset.join(',')}] ${key}`, 1e-5);
      }
    }
    if (solvedAtMinimal > 0) minimalSize = size;
  }
  ok(minimalSize !== null, `${label}: no sufficient subset found up to size ${maxSize}`);
  ok(solvedAtMinimal > 0, `${label}: no solved subset at the minimal size`);
  return { minimalSize, solvedAtMinimal };
}

// ---------------------------------------------------------------------------
// Bowling
// ---------------------------------------------------------------------------

const BOWLING_CONSTANTS = {
  mass: 6,
  mu: 0.02,
  gravity: 9.81,
  length: 18.29,
  hookK: 0.55,
};

test('bowling round-trip: smallest sufficient sets recover the whole truth', () => {
  const rng = mulberry32(0xB011);
  for (let scenario = 0; scenario < 6; scenario += 1) {
    const speed = 6 + rng() * 2;
    const aim = -0.4;
    const hook = -1.6;
    const accel = -BOWLING_CONSTANTS.mu * BOWLING_CONSTANTS.gravity;
    const length = BOWLING_CONSTANTS.length;
    const disc = speed * speed + 2 * accel * length;
    const time = (-speed + Math.sqrt(disc)) / accel;
    const distance = length;
    const forward = {
      start: 0.2,
      aim,
      hook,
      speed,
      finalSpeed: speed + accel * time,
      distance,
      time,
      accel,
      sideways: speed * Math.sin((aim * Math.PI) / 180),
      momentum: BOWLING_CONSTANTS.mass * speed,
      energy: 0.5 * BOWLING_CONSTANTS.mass * speed * speed,
    };
    roundTrip(`bowling ${scenario}`, forward,
      ['speed', 'time', 'accel', 'finalSpeed', 'distance', 'sideways', 'momentum', 'energy'],
      2,
      (known) => solveBowling({
        known,
        constants: BOWLING_CONSTANTS,
      }),
      ['speed', 'finalSpeed', 'distance', 'time', 'accel', 'sideways', 'momentum', 'energy']);
  }
});

test('bowling works for every supported combination', () => {
  const speed = 6;
  const accel = -0.1962;
  const time = 2.4;
  const distance = speed * time + 0.5 * accel * time * time;
  const forward = {
    speed,
    time,
    accel,
    distance,
    finalSpeed: speed + accel * time,
    sideways: speed * Math.sin((-0.4 * Math.PI) / 180),
    momentum: 36,
    energy: 108,
  };
  const pairs = [
    ['speed', 'time'],
    ['speed', 'accel'],
    ['speed', 'distance'],
    ['time', 'accel'],
    ['time', 'distance'],
    ['speed', 'finalSpeed'],
    ['speed', 'momentum'],
    ['speed', 'energy'],
    ['speed', 'sideways'],
  ];
  for (const pair of pairs) {
    const known = Object.fromEntries(pair.map((key) => [key, forward[key]]));
    const result = solveBowling({ known, constants: BOWLING_CONSTANTS });
    ok(result.status === 'solved', `bowling ${pair.join('+')}: ${result.status} ${result.message}`);
    for (const key of Object.keys(known)) closeEnough(result.values[key], forward[key], `${pair.join('+')} ${key}`);
  }
  const triple = solveBowling({
    known: { speed, time, accel },
    constants: BOWLING_CONSTANTS,
  });
  ok(triple.status === 'solved', triple.message);
  closeEnough(triple.values.distance, distance, 'triple distance');
  closeEnough(triple.values.finalSpeed, forward.finalSpeed, 'triple final speed');
});

test('bowling soft defaults: speed only uses the lane length', () => {
  const result = solveBowling({ known: { speed: 7.5 } });
  ok(result.status === 'solved', result.message);
  closeEnough(result.values.accel, -0.1962, 'accel', 1e-4);
  closeEnough(result.values.time, 2.521852, 'time', 1e-5);
  closeEnough(result.values.sideways, -0.05236, 'sideways', 1e-3);
  closeEnough(result.values.momentum, 45, 'momentum');
  closeEnough(result.values.energy, 168.75, 'energy');
  closeEnough(result.values.distance, 18.29, 'distance');
  ok(result.noteList.some((note) => /default lane length/.test(note)),
    JSON.stringify(result.noteList));
});

test('bowling Speed 2 + Time 5 + Accel 11 drops the lane length for the math', () => {
  const result = solveBowling({ known: { speed: 2, time: 5, accel: 11 } });
  ok(result.status === 'solved', result.message);
  ok(result.status !== 'conflict', 'positive acceleration must not be a conflict');
  closeEnough(result.values.finalSpeed, 57, 'v_final');
  closeEnough(result.values.distance, 147.5, 'distance');
  ok(result.values.distance > result.values.length, 'distance is not clamped to the lane');
  const note = result.noteList.join(' ');
  ok(/18\.29/.test(note), `lane note missing: ${note}`);
  ok(/1\.65/.test(note), `pin time note missing: ${note}`);
  ok(/20\.1/.test(note), `pin speed note missing: ${note}`);
  ok(!/must be|conflict|cannot/i.test(result.message || ''),
    `status should not refuse the math: ${result.message}`);
});

test('bowling positive acceleration is a note, not an error', () => {
  const result = solveBowling({ known: { speed: 3, accel: 2, time: 4 } });
  ok(result.status === 'solved', result.message);
  ok(result.values.distance > 0, 'distance');
  ok(result.noteList.some((note) => /real lane would slow/.test(note)),
    JSON.stringify(result.noteList));
});

test('bowling says when the ball stops before the pins', () => {
  const result = solveBowling({ known: { speed: 1, accel: -1 } });
  ok(result.status === 'solved', `${result.status} ${result.message}`);
  closeEnough(result.values.distance, 0.5, 'stopping distance');
  closeEnough(result.values.time, 1, 'stopping time');
  ok(result.noteList.some((note) => /stops after/.test(note)),
    JSON.stringify(result.noteList));
});

// ---------------------------------------------------------------------------
// Linear Motion
// ---------------------------------------------------------------------------

test('straight line: all ten three-known combinations solve fully', () => {
  const rng = mulberry32(0x11EA);
  for (let scenario = 0; scenario < 4; scenario += 1) {
    const u = 1 + rng() * 8;
    const a = -2 + rng() * 5;
    const t = 1 + rng() * 4;
    const forward = {
      u,
      a,
      t,
      v: u + a * t,
      s: u * t + 0.5 * a * t * t,
    };
    const result = roundTrip(`straight ${scenario}`, forward,
      ['u', 'v', 's', 't', 'a'], 3,
      (known) => solveLinear({ known }), ['u', 'v', 's', 't', 'a']);
    ok(result.minimalSize === 3, `minimal size ${result.minimalSize}`);
    ok(result.solvedAtMinimal === 10, `solved ${result.solvedAtMinimal}/10`);
  }
});

test('straight line: two knowns plus Constant speed solve fully', () => {
  const cases = [
    { known: { u: 5, s: 100 }, forward: { v: 5, t: 20, a: 0 } },
    { known: { u: 5, t: 20 }, forward: { s: 100, v: 5, a: 0 } },
    { known: { v: 5, s: 100 }, forward: { u: 5, t: 20, a: 0 } },
    { known: { v: 5, t: 20 }, forward: { u: 5, s: 100, a: 0 } },
  ];
  for (const item of cases) {
    const result = solveLinear({ known: item.known, constantSpeed: true });
    ok(result.status === 'solved', `${JSON.stringify(item.known)}: ${result.message}`);
    closeEnough(result.values.a, 0, 'constant speed a');
    for (const [key, value] of Object.entries(item.forward)) {
      closeEnough(result.values[key], value, `${JSON.stringify(item.known)} ${key}`);
    }
  }
});

test('free fall: a = −g is locked and one known value completes the fall', () => {
  const g = 9.8;
  const fixed = { a: { value: -g, caption: 'Set by Free Fall' }, u: { value: 0, caption: 'Set by Dropped' } };
  const cases = [
    { known: { t: 2 }, t: 2, s: -19.6, v: -19.6 },
    { known: { s: -19.6 }, t: 2, s: -19.6, v: -19.6 },
    { known: { v: -19.6 }, t: 2, s: -19.6, v: -19.6 },
  ];
  for (const item of cases) {
    const result = solveLinear({ known: item.known, fixed });
    ok(result.status === 'solved', `${JSON.stringify(item.known)}: ${result.message}`);
    closeEnough(result.values.t, item.t, 't');
    closeEnough(result.values.s, item.s, 's');
    closeEnough(result.values.v, item.v, 'v');
  }
  const up = solveLinear({
    known: { u: 19.6, v: 0 },
    fixed: { a: { value: -g, caption: 'Set by Free Fall' } },
  });
  ok(up.status === 'solved', up.message);
  closeEnough(up.values.t, 2, 'up t');
  closeEnough(up.values.s, 19.6, 'up height');
});

// ---------------------------------------------------------------------------
// Projectile Motion
// ---------------------------------------------------------------------------

function projectileForward(v0, angle, h0, g = 9.8) {
  const rad = (angle * Math.PI) / 180;
  const vx0 = v0 * Math.cos(rad);
  const vy0 = v0 * Math.sin(rad);
  const T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h0)) / g;
  return {
    v0,
    angle,
    h0,
    g,
    vx0,
    vy0,
    T,
    R: vx0 * T,
    H: h0 + (vy0 * vy0) / (2 * g),
    landingSpeed: Math.sqrt(v0 * v0 + 2 * g * h0),
    timeApex: vy0 / g,
    landingAngle: (Math.atan2(vy0 - g * T, vx0) * 180) / Math.PI,
    targetR: vx0 * T,
    yTarget: h0,
    tTarget: T,
    vTarget: Math.sqrt(v0 * v0 + 2 * g * h0),
  };
}

test('projectile round-trip: every minimal pair recovers the trajectory', () => {
  const rng = mulberry32(0x9A1C);
  for (let scenario = 0; scenario < 5; scenario += 1) {
    const v0 = 15 + rng() * 10;
    const angle = 25 + rng() * 15;
    const h0 = 0;
    const forward = projectileForward(v0, angle, h0);
    roundTrip(`projectile ${scenario}`, forward,
      ['v0', 'angle', 'R', 'T', 'H', 'vx0', 'vy0', 'targetR', 'landingSpeed', 'timeApex'],
      3,
      (known) => solveProjectile({ known, launchType: 'ground' }),
      ['v0', 'angle', 'vx0', 'vy0', 'T', 'R', 'H', 'landingSpeed', 'timeApex', 'landingAngle']);
  }
});

test('projectile: the reported entries all work with g = 9.8', () => {
  const entries = [
    { known: { angle: 30, targetR: 30 }, launchType: 'ground', expect: { v0: 18.425 } },
    { known: { angle: 30, R: 30 }, launchType: 'ground', expect: { v0: 18.425 } },
    { known: { angle: 60, R: 30 }, launchType: 'ground', expect: { v0: 18.425 } },
    { known: { v0: 20, R: 35.348 }, launchType: 'ground', expect: { angle: 30 } },
    { known: { v0: 20, angle: 30 }, launchType: 'ground',
      expect: { T: 2.0408, R: 35.348, H: 5.102 } },
    { known: { v0: 5, h0: 19.6 }, launchType: 'horizontal',
      expect: { T: 2, R: 10 } },
  ];
  for (const entry of entries) {
    const result = solveProjectile({
      known: entry.known,
      launchType: entry.launchType,
    });
    ok(result.status === 'solved', `${JSON.stringify(entry.known)}: ${result.status} ${result.message}`);
    for (const [key, value] of Object.entries(entry.expect)) {
      closeEnough(result.values[key], value, `${JSON.stringify(entry.known)} ${key}`, 1e-4);
    }
  }
});

test('projectile: the high arc is reported as also valid', () => {
  const result = solveProjectile({ known: { v0: 20, R: 35.348 }, launchType: 'ground' });
  ok(result.status === 'solved', result.message);
  closeEnough(result.values.angle, 30, 'lower angle', 1e-3);
  const also = result.alsoValid.angle || [];
  ok(also.some((value) => near(value, 60, 1e-3)),
    `also-valid roots: ${JSON.stringify(also)}`);
});

test('projectile: target height defaults to the launch height', () => {
  const result = solveProjectile({
    known: { angle: 30, h0: 0, targetR: 30 },
    launchType: 'angled',
  });
  ok(result.status === 'solved', result.message);
  closeEnough(result.values.yTarget, 0, 'target height');
  closeEnough(result.values.tTarget, result.values.T, 'time at target');
});

test('projectile: an unreachable target is a plain impossible sentence', () => {
  const result = solveProjectile({
    known: { angle: 30, targetR: 30, yTarget: 25, h0: 0 },
    launchType: 'angled',
  });
  ok(result.status === 'impossible', result.status);
  ok(/never reach|steeper angle/i.test(result.message), result.message);
  ok(!/NaN|Infinity/.test(result.message), result.message);
});

// ---------------------------------------------------------------------------
// Rotational Motion
// ---------------------------------------------------------------------------

test('rotational: all three-known kinematic combinations solve fully', () => {
  const rng = mulberry32(0x007);
  for (let scenario = 0; scenario < 3; scenario += 1) {
    const w0 = 1 + rng() * 4;
    const alpha = 0.5 + rng() * 3;
    const t = 2 + rng() * 4;
    const w = w0 + alpha * t;
    const theta = w0 * t + 0.5 * alpha * t * t;
    const forward = {
      w0, alpha, t, w, theta,
      revolutions: theta / (2 * Math.PI),
      rpm: (w * 60) / (2 * Math.PI),
    };
    const result = roundTrip(`rotational ${scenario}`, forward,
      ['w0', 'w', 'alpha', 't', 'theta', 'revolutions', 'rpm'], 3,
      (known) => solveRotational({ known }),
      ['w0', 'w', 'alpha', 't', 'theta', 'revolutions', 'rpm']);
    ok(result.minimalSize === 3, `minimal size ${result.minimalSize}`);
  }
});

test('rotational: rpm and revolutions chain into the kinematics', () => {
  const rpmResult = solveRotational({ known: { rpm: 60, t: 10, alpha: 0 } });
  ok(rpmResult.status === 'solved', rpmResult.message);
  closeEnough(rpmResult.values.w, (60 * 2 * Math.PI) / 60, 'rpm -> w');
  const revResult = solveRotational({ known: { revolutions: 30, t: 10, alpha: 0 } });
  ok(revResult.status === 'solved', revResult.message);
  closeEnough(revResult.values.theta, 60 * Math.PI, 'revolutions -> theta');
  closeEnough(revResult.values.w, 6 * Math.PI, 'revolutions -> w');
});

test('rotational: Constant speed locks alpha to 0', () => {
  const result = solveRotational({ known: { w0: 10, t: 6 }, constantSpeed: true });
  ok(result.status === 'solved', result.message);
  closeEnough(result.values.alpha, 0, 'alpha');
  closeEnough(result.values.w, 10, 'w');
  closeEnough(result.values.theta, 60, 'theta');
  ok(result.sources.alpha === 'locked', result.sources.alpha);
});

// ---------------------------------------------------------------------------
// Torque
// ---------------------------------------------------------------------------

test('torque: any one of τ, F, r, θ solves from the others', () => {
  const forward = { F: 80, r: 0.35, angle: 60, torque: 24.2487 };
  const cases = [
    { F: forward.F, r: forward.r, angle: forward.angle, target: 'torque' },
    { torque: forward.torque, r: forward.r, angle: forward.angle, target: 'F' },
    { torque: forward.torque, F: forward.F, angle: forward.angle, target: 'r' },
    { torque: forward.torque, F: forward.F, r: forward.r, target: 'angle' },
  ];
  for (const item of cases) {
    const known = { ...item };
    delete known.target;
    const result = solveTorque({
      known,
      forces: known.F && known.r && known.angle
        ? [{ F: known.F, r: known.r, angle: known.angle, direction: 1 }] : [],
    });
    ok(result.status === 'solved', `${item.target}: ${result.status} ${result.message}`);
    closeEnough(result.values[item.target], forward[item.target], item.target, 1e-4);
  }
});

test('torque: τnet, I and α solve in every direction', () => {
  const cases = [
    { known: { netTorque: 10, I: 2 }, expected: { alpha: 5 } },
    { known: { netTorque: 10, alpha: 5 }, expected: { I: 2 } },
    { known: { I: 2, alpha: 5 }, expected: { netTorque: 10 } },
  ];
  for (const item of cases) {
    const result = solveTorque({ known: item.known, forces: [] });
    ok(result.status === 'solved', `${JSON.stringify(item.known)}: ${result.message}`);
    for (const [key, value] of Object.entries(item.expected)) {
      closeEnough(result.values[key], value, `${JSON.stringify(item.known)} ${key}`);
    }
  }
});

test('torque: a single force has net torque equal to its torque', () => {
  const result = solveTorque({
    known: { F: 100, r: 0.2, angle: 90, I: 5 },
    forces: [{ F: 100, r: 0.2, angle: 90, direction: 1 }],
  });
  ok(result.status === 'solved', result.message);
  closeEnough(result.values.torque, 20, 'torque');
  closeEnough(result.values.netTorque, 20, 'net torque');
  closeEnough(result.values.alpha, 4, 'alpha');
  closeEnough(result.values.Fperp, 100, 'F perp');
  closeEnough(result.values.Fpar, 0, 'F parallel', 1e-9);
  closeEnough(result.values.leverArm, 0.2, 'lever arm');
});

test('torque: opposing forces keep the CW/CCW net direction', () => {
  const result = solveTorque({
    known: { I: 2 },
    forces: [
      { F: 20, r: 0.2, angle: 90, direction: 1 },
      { F: 36, r: 0.2, angle: 90, direction: -1 },
    ],
  });
  ok(result.status === 'solved', result.message);
  closeEnough(Math.abs(result.values.netTorque), 3.2, 'net torque');
  closeEnough(result.values.alpha, -1.6, 'alpha');
  ok(result.netDirection === 'clockwise', result.netDirection);
});

test('torque: seesaw solves any one of m1, r1, m2, r2', () => {
  const full = { m1: 90, r1: 0.5, m2: 30, r2: 1.5 };
  for (const target of Object.keys(full)) {
    const known = { ...full };
    delete known[target];
    const result = solveTorque({ known, forces: [] });
    ok(result.status === 'solved', `${target}: ${result.message}`);
    closeEnough(result.values[target], full[target], target);
  }
});

// ---------------------------------------------------------------------------
// Inertia and angular momentum
// ---------------------------------------------------------------------------

test('inertia: every shape solves I, M and R/L from the other two', () => {
  for (const shape of SHAPES) {
    if (shape.id === 'custom') continue;
    const dimension = shape.uses;
    const M = 2;
    const D = 1;
    const I = shape.coefficient * M * D * D;
    const cases = [
      { known: { M, [dimension]: D }, expected: { I } },
      { known: { I, M }, expected: { [dimension]: D } },
      { known: { I, [dimension]: D }, expected: { M } },
    ];
    for (const item of cases) {
      const result = solveInertia({ known: item.known, submode: 'shape', shape: shape.id });
      ok(result.status === 'solved', `${shape.id}: ${result.message}`);
      for (const [key, value] of Object.entries(item.expected)) {
        closeEnough(result.values[key], value, `${shape.id} ${key}`);
      }
    }
    ok(shape.formula === (shape.id === 'ring' ? 'I = M R²' : shape.formula),
      `${shape.id} formula`);
  }
});

test('inertia: L = Iω solves in every direction', () => {
  const cases = [
    { known: { I: 0.18, w: 12 }, expected: { Lm: 2.16 } },
    { known: { Lm: 2.16, w: 12 }, expected: { I: 0.18 } },
    { known: { Lm: 2.16, I: 0.18 }, expected: { w: 12 } },
  ];
  for (const item of cases) {
    const result = solveInertia({
      known: item.known, submode: 'shape', shape: 'disk', customParts: [{ m: 0.04, r: 3 }],
    });
    ok(result.status === 'solved', `${JSON.stringify(item.known)}: ${result.message}`);
    for (const [key, value] of Object.entries(item.expected)) {
      closeEnough(result.values[key], value, `${JSON.stringify(item.known)} ${key}`);
    }
  }
});

test('inertia: conservation solves any one of I1, w1, I2, w2', () => {
  const full = { I1: 4, w1: 2, I2: 1, w2: 8 };
  for (const target of Object.keys(full)) {
    const known = { ...full };
    delete known[target];
    const result = solveInertia({ known, submode: 'conservation' });
    ok(result.status === 'solved', `${target}: ${result.message}`);
    closeEnough(result.values[target], full[target], target);
  }
});

test('inertia: composite collision solves I2 and w2 from the known parts', () => {
  const result = solveInertia({
    known: { I1: 2, w1: 4, M: 1, R: 0.5 },
    submode: 'collision',
  });
  ok(result.status === 'solved', result.message);
  closeEnough(result.values.I2, 2.25, 'I2');
  closeEnough(result.values.w2, 32 / 9, 'w2');
});

// ---------------------------------------------------------------------------
// Status line, suggestions, contradictions
// ---------------------------------------------------------------------------

test('guidance: projectile names the real missing count and suggests Range/Time/Height', () => {
  const result = solveProjectile({
    known: { angle: 30 },
    launchType: 'ground',
    focusKey: 'v0',
  });
  ok(result.status === 'underdetermined', result.status);
  ok(result.focusKey === 'v0', result.focusKey);
  ok(!result.suggestions.includes('v0'), 'must not suggest the variable being solved for');
  ok(result.suggestions.includes('R'), JSON.stringify(result.suggestions));
  ok(result.suggestions.includes('T'), JSON.stringify(result.suggestions));
  ok(result.suggestions.includes('H'), JSON.stringify(result.suggestions));
  const text = guidance(result, (key) => PROJECTILE_META[key].label);
  ok(/To find Launch speed/.test(text), text);
  ok(/Range/.test(text) && /Flight time/.test(text) && /Max height/.test(text), text);
});

test('guidance: a two-value shortfall is stated as two values', () => {
  const result = solveLinear({ known: { u: 5 }, focusKey: 't' });
  ok(result.status === 'underdetermined', result.status);
  ok(result.requiredExtra === 2, String(result.requiredExtra));
  const text = guidance(result, (key) => LINEAR_META[key].label);
  ok(/To find Time/.test(text), text);
  ok(/and/.test(text), text);
});

test('contradiction: the plain sentence blames the time', () => {
  const result = solveLinear({ known: { u: 20, v: 0, s: 50, t: 4 } });
  ok(result.status === 'conflict', result.status);
  ok(result.message === 'Time should be 5 s, not 4.', result.message);
  ok(result.conflictKeys.has('t'), JSON.stringify([...result.conflictKeys]));
  ok(!/NaN|Infinity/.test(result.message), result.message);
});

test('impossible: negative time is a sentence, never NaN or Infinity', () => {
  const result = solveLinear({ known: { u: 0, v: 10, a: -2 } });
  ok(result.status === 'impossible', result.status);
  ok(/negative time/i.test(result.message), result.message);
  ok(/bigger speed|smaller distance/i.test(result.message), result.message);
  ok(!/NaN|Infinity/.test(result.message), result.message);
  for (const value of Object.values(result.values)) {
    ok(value === null || Number.isFinite(value), `finite value ${value}`);
  }
});

test('no solved value is ever NaN or Infinity', () => {
  const samples = [
    solveBowling({ known: { speed: 2, time: 5, accel: 11 } }),
    solveProjectile({ known: { v0: 20, angle: 30 }, launchType: 'ground' }),
    solveRotational({ known: { w0: 4, alpha: 2, t: 8 } }),
    solveTorque({ known: { F: 100, r: 0.2, angle: 90, I: 5 }, forces: [] }),
    solveInertia({ known: { M: 4, R: 0.3 }, submode: 'shape', shape: 'disk' }),
  ];
  for (const solution of samples) {
    for (const [key, value] of Object.entries(solution.values)) {
      if (typeof value !== 'number') continue;
      ok(Number.isFinite(value), `${key} = ${value}`);
    }
  }
});

test('guidance: chips never include the variable being solved for', () => {
  const cases = [
    [solveBowling({ known: {}, focusKey: 'speed' }), 'speed'],
    [solveLinear({ known: { u: 5 }, focusKey: 'v' }), 'v'],
    [solveRotational({ known: { w0: 4 }, focusKey: 'w' }), 'w'],
    [solveInertia({ known: { M: 4 }, submode: 'shape', shape: 'disk', focusKey: 'I' }), 'I'],
  ];
  for (const [result, focus] of cases) {
    ok(result.status === 'underdetermined', `${focus}: ${result.status}`);
    ok(!result.suggestions.includes(focus),
      `${focus} suggested itself: ${JSON.stringify(result.suggestions)}`);
    ok(result.suggestions.length <= 4, `${focus}: too many chips`);
  }
});

// ---------------------------------------------------------------------------
// Earlier validation cases
// ---------------------------------------------------------------------------

test('all earlier Q2-Q25 validation checks still pass', () => {
  const checks = [...runLabValidation(), ...runNewLabValidation()];
  for (const check of checks) {
    ok(check.pass, `${check.name}: ${JSON.stringify(check.actual)}`);
  }
  ok(checks.length === 40, `checks: ${checks.length}`);
});

test('earlier snapshot and reverse lookup still work', () => {
  const t = 2;
  const y = 0.5 * -9.8 * t * t;
  closeEnough(y, -19.6, 'snapshot y');
  const crossings = findCrossings(
    (time) => 19.6 * time + 0.5 * -9.8 * time * time,
    4,
    10,
  );
  ok(crossings.length === 2, JSON.stringify(crossings));
  const journey = solveJourney([
    { distance: 120, direction: 1, time: 20 },
    { distance: 80, direction: -1, time: 10 },
  ]);
  ok(journey.status === 'solved', journey.status);
  closeEnough(journey.results.avgSpeed, 200 / 30, 'journey average speed');
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('\nRelation coverage');
for (const [lab, counts] of Object.entries(catalogCounts)) {
  console.log(`  ${lab}: ${counts.relations} relations, ${counts.directions} directions`);
}
console.log(`\n${passed} engine tests passed, ${assertions} individual assertions.`);
if (failures.length) {
  console.error(`${failures.length} test(s) failed.`);
  process.exitCode = 1;
}
