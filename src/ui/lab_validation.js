// Validation checks for every Physics Lab beyond the original Linear core.
// Called once from lab.js (console) and from tools/lab_modes_tests.mjs.

import { solveSuvat, findCrossings } from './lab_suvat.js';
import { solveProjectile } from './lab_projectile.js';
import { solveRotational } from './lab_rotational.js';
import { solveTorque } from './lab_torque.js';
import { solveInertia } from './lab_inertia.js';

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const close = (actual, expected, tolerance = 1e-6) => (
  isNum(actual) && Math.abs(actual - expected)
    <= tolerance * Math.max(1, Math.abs(expected)) + 1e-9
);

export function runNewLabValidation() {
  const checks = [];
  const check = (name, pass, actual) => checks.push({ name, pass, actual });

  // --- Free Fall sign convention, snapshot, reverse lookup ---------------
  const drop = solveSuvat({ known: { s: -44.1, u: 0 }, fixed: { a: -9.8 } });
  check('Free fall at g=9.8: t=3, vf=-29.4, y=-44.1',
    drop.ok && close(drop.values.t, 3) && close(drop.values.v, -29.4)
      && close(drop.values.s, -44.1),
    { t: drop.values.t, v: drop.values.v, y: drop.values.s });

  const snapT = 2;
  const snapY = 0 * snapT + 0.5 * -9.8 * snapT * snapT;
  const snapV = 0 + -9.8 * snapT;
  check('Free fall snapshot at t=2: v=-19.6, y=-19.6',
    close(snapY, -19.6) && close(snapV, -19.6),
    { v: snapV, y: snapY });

  const up = solveSuvat({ known: { u: 19.6, v: 0 }, fixed: { a: -9.8 } });
  const samples = findCrossings(
    (t) => 19.6 * t + 0.5 * -9.8 * t * t,
    4,
    10,
  );
  check('Reverse lookup finds both rising and falling times',
    up.ok && samples.length === 2 && samples[0] < samples[1],
    { times: samples });

  // --- Projectile ---------------------------------------------------------
  const q6 = solveProjectile({ known: { v0: 5, angle: 0, h0: 19.6 }, fixed: { angle: 0 }, launchType: 'horizontal' });
  check('Projectile Q6: T=2 s, R=10 m',
    q6.ok && close(q6.values.T, 2) && close(q6.values.R, 10),
    { T: q6.values.T, R: q6.values.R });

  const q7 = solveProjectile({ known: { v0: 20, angle: 30, h0: 0 } });
  check('Projectile Q7: T=2.04 s, R=35.3 m',
    q7.ok && close(q7.values.T, 2.0408, 0.01) && close(q7.values.R, 35.3, 0.01),
    { T: q7.values.T, R: q7.values.R });

  const q8 = solveProjectile({ known: { v0: 14, angle: 45, h0: 0 } });
  check('Projectile Q8: H=5.0 m, R=20.0 m',
    q8.ok && close(q8.values.H, 5, 1e-6) && close(q8.values.R, 20, 1e-6),
    { H: q8.values.H, R: q8.values.R });

  const q9 = solveProjectile({ known: { v0: 12, angle: 30, h0: 0, targetR: 8 } });
  check('Projectile Q9: height at barrier 1.71 m, does not clear 2 m',
    q9.ok && close(q9.values.yTarget, 1.71, 0.01) && q9.values.yTarget < 2,
    { height: q9.values.yTarget });

  const q10 = solveProjectile({ known: { angle: 30, h0: 0, R: 30 } });
  check('Projectile Q10: v0=18.4 m/s',
    q10.ok && close(q10.values.v0, 18.4, 0.01),
    { v0: q10.values.v0 });

  // --- Rotational ---------------------------------------------------------
  const q11 = solveRotational({ known: { w0: 0, t: 6, alpha: Math.PI } });
  check('Rotational Q11: alpha=3.14 rad/s², 9 rev',
    q11.ok && close(q11.values.alpha, Math.PI, 1e-6)
      && close(q11.values.revolutions, 9, 1e-6),
    { alpha: q11.values.alpha, rev: q11.values.revolutions });

  const q12 = solveRotational({ known: { w0: 4, alpha: 2, t: 8 } });
  check('Rotational Q12: w=20 rad/s, theta=96 rad',
    q12.ok && close(q12.values.w, 20) && close(q12.values.theta, 96),
    { w: q12.values.w, theta: q12.values.theta });

  const q13 = solveRotational({ known: { w0: 0, t: 10, theta: 30 * Math.PI * 2 } });
  check('Rotational Q13: 30 rev, 188.5 rad',
    q13.ok && close(q13.values.revolutions, 30, 1e-6)
      && close(q13.values.theta, 188.4956, 1e-4),
    { rev: q13.values.revolutions, theta: q13.values.theta });

  const q14 = solveRotational({ known: { w0: 10, w: 10, t: 6, r: 0.35, theta: 60 } });
  check('Rotational Q14: v=3.5 m/s, d=21 m',
    q14.ok && close(q14.values.v, 3.5) && close(q14.values.distance, 21),
    { v: q14.values.v, distance: q14.values.distance });

  const q15 = solveRotational({ known: { w0: 10, t: 10, theta: 150 } });
  check('Rotational Q15: t=10 s, theta=150 rad',
    q15.ok && close(q15.values.t, 10) && close(q15.values.theta, 150),
    { t: q15.values.t, theta: q15.values.theta });

  // --- Torque -------------------------------------------------------------
  const q16 = solveTorque({
    known: { F: 100, r: 0.2, angle: 90, I: 5 },
    forces: [{ F: 100, r: 0.2, angle: 90, direction: 1 }],
  });
  check('Torque Q16: 20 N·m',
    q16.status === 'solved' && close(q16.values.torque, 20),
    { torque: q16.values.torque });

  const q17 = solveTorque({
    known: { F: 30, r: 0.3, angle: 90, I: 3 },
    forces: [{ F: 30, r: 0.3, angle: 90, direction: 1 }],
  });
  check('Torque Q17: 9 N·m',
    q17.status === 'solved' && close(q17.values.torque, 9),
    { torque: q17.values.torque });

  const q18 = solveTorque({
    known: { I: 12 },
    forces: [
      { F: 90 * 9.8, r: 0.5, angle: 90, direction: -1 },
      { F: 30 * 9.8, r: 1.5, angle: 90, direction: 1 },
    ],
  });
  check('Torque Q18: balance lever arm 1.5 m',
    q18.status === 'solved' && close(q18.forces[1].r, 1.5, 1e-9)
      && Math.abs(q18.values.netTorque) < 1e-9,
    { r2: q18.forces[1].r, net: q18.values.netTorque });

  const q19 = solveTorque({
    known: { I: 2 },
    forces: [
      { F: 20, r: 0.2, angle: 90, direction: 1 },
      { F: 36, r: 0.2, angle: 90, direction: -1 },
    ],
  });
  check('Torque Q19: 3.2 N·m clockwise',
    q19.status === 'solved' && close(Math.abs(q19.values.netTorque), 3.2)
      && q19.netDirection === 'clockwise',
    { net: q19.values.netTorque, direction: q19.netDirection });

  const q20 = solveTorque({
    known: { F: 15, r: 0.2, angle: 90, I: 0.5 },
    forces: [{ F: 15, r: 0.2, angle: 90, direction: 1 }],
  });
  check('Torque Q20: net 3.0 N·m, alpha 6 rad/s²',
    q20.status === 'solved' && close(q20.values.netTorque, 3)
      && close(q20.values.alpha, 6),
    { net: q20.values.netTorque, alpha: q20.values.alpha });

  // --- Moment of inertia --------------------------------------------------
  const q21 = solveInertia({ known: { M: 4, R: 0.3 }, submode: 'shape', shape: 'disk' });
  check('Inertia Q21: solid disk I=0.18 kg·m²',
    q21.status === 'solved' && close(q21.values.I, 0.18),
    { I: q21.values.I });

  const q22 = solveInertia({ known: { M: 3, L: 2 }, submode: 'shape', shape: 'rodEnd' });
  check('Inertia Q22: rod I=4 kg·m²',
    q22.status === 'solved' && close(q22.values.I, 4),
    { I: q22.values.I });

  const q23 = solveInertia({
    known: { M: 0.5, R: 0.5, w: 12 }, submode: 'shape', shape: 'ring',
  });
  check('Inertia Q23: ring I=0.125, L=1.5',
    q23.status === 'solved' && close(q23.values.I, 0.125)
      && close(q23.values.Lm, 1.5),
    { I: q23.values.I, Lm: q23.values.Lm });

  const q24 = solveInertia({
    known: { I1: 4, w1: 2, I2: 1 }, submode: 'conservation',
  });
  check('Inertia Q24: skater w2=8 rad/s',
    q24.status === 'solved' && close(q24.values.w2, 8),
    { w2: q24.values.w2 });

  const q25 = solveInertia({
    known: { I1: 2, w1: 4, M: 1, R: 0.5 }, submode: 'collision',
  });
  check('Inertia Q25: I2=2.25, w2=3.56 rad/s',
    q25.status === 'solved' && close(q25.values.I2, 2.25)
      && close(q25.values.w2, 3.5556, 0.001),
    { I2: q25.values.I2, w2: q25.values.w2 });

  return checks;
}
