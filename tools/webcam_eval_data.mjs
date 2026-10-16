// Labeled movement sequences for the webcam swing classifier evaluation.
//
// Every sequence is tagged with where it comes from:
//   * kind: 'synthetic'       - built by this file from the body model below;
//   * kind: 'recorded-human'  - MediaPipe landmark traces exported from real
//                               footage in tools/testdata (negative motions
//                               only; no genuine bowling footage exists in
//                               this repository - see docs/WEBCAM_SWING.md).
//
// The harness tools/webcam_eval.mjs runs the browser classifier against every
// sequence and checks the expected release count. tools/webcam_eval.py replays
// the same exported traces through the Python port, so both implementations
// are verified against the same labeled expectations instead of against each
// other.
//
// The synthetic body model: landmarks are placed from a shoulder/hip frame
// whose size is the torso height, one arm at a time is driven by a hand height
// (torso heights above the shoulder) and a hand x offset (torso units from the
// shoulder), and elbows are interpolated with an optional bend. Noise is
// deterministic, so a failure is always reproducible.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function poseFrame({
  bodyX = 0.5,
  shoulderY = 0.40,
  torso = 0.25,
  shoulderAngle = 0.0,
  right = null,
  left = null,
  noise = 0.0,
  rng = null,
  confidence = 0.95,
  tracked = true,
} = {}) {
  if (!tracked) return { landmarks: null, confidence: 0.0, tracked: false };
  const H = torso;
  const hipY = shoulderY + H;
  const shoulderHalf = 0.5 * H;
  const hipHalf = 0.4 * H;
  const cos = Math.cos(shoulderAngle); const sin = Math.sin(shoulderAngle);
  const sm = { x: bodyX, y: shoulderY };
  const points = {
    left_shoulder: { x: sm.x - shoulderHalf * cos, y: sm.y - shoulderHalf * sin },
    right_shoulder: { x: sm.x + shoulderHalf * cos, y: sm.y + shoulderHalf * sin },
    left_hip: { x: bodyX - hipHalf, y: hipY },
    right_hip: { x: bodyX + hipHalf, y: hipY },
    left_knee: { x: bodyX - hipHalf, y: hipY + H },
    right_knee: { x: bodyX + hipHalf, y: hipY + H },
    nose: { x: bodyX, y: shoulderY - 0.55 * H },
  };
  const visibility = {
    left_shoulder: 0.95, right_shoulder: 0.95, left_hip: 0.95, right_hip: 0.95,
    left_knee: 0.9, right_knee: 0.9, nose: 0.9,
  };
  const armStates = {
    right: right || { h: -0.88, dx: 0.48 },
    left: left || { h: -0.88, dx: -0.48 },
  };
  for (const arm of ['right', 'left']) {
    const state = armStates[arm];
    const side = arm === 'right' ? 1 : -1;
    const shoulder = points[`${arm}_shoulder`];
    const wrist = {
      x: shoulder.x + state.dx * H,
      y: shoulder.y - state.h * H,
    };
    const bend = state.bend || 0.0;
    let elbow = { x: (shoulder.x + wrist.x) / 2, y: (shoulder.y + wrist.y) / 2 };
    if (bend > 0) {
      const dx = wrist.x - shoulder.x; const dy = wrist.y - shoulder.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      let px = -dy / len; let py = dx / len;
      if (px * side < 0) { px = -px; py = -py; }
      elbow = { x: elbow.x + px * bend * 0.35 * H, y: elbow.y + py * bend * 0.35 * H };
    }
    points[`${arm}_elbow`] = elbow;
    points[`${arm}_wrist`] = wrist;
    points[`${arm}_index`] = { x: wrist.x + 0.07 * H, y: wrist.y + 0.05 * H };
    points[`${arm}_pinky`] = { x: wrist.x - 0.08 * H, y: wrist.y + 0.08 * H };
    points[`${arm}_thumb`] = { x: wrist.x + 0.02 * H, y: wrist.y - 0.09 * H };
    visibility[`${arm}_wrist`] = state.wristVis === undefined ? 0.95 : state.wristVis;
    const handVis = state.handVis === undefined ? 0.95 : state.handVis;
    for (const finger of ['index', 'pinky', 'thumb']) visibility[`${arm}_${finger}`] = handVis;
  }
  const landmarks = {};
  for (const [name, p] of Object.entries(points)) {
    let x = p.x; let y = p.y;
    if (noise > 0 && rng) {
      x += (rng() - 0.5) * 2 * noise * H;
      y += (rng() - 0.5) * 2 * noise * H;
    }
    landmarks[name] = { x, y, z: 0, visibility: visibility[name] === undefined ? 0.95 : visibility[name] };
  }
  return { landmarks, confidence, tracked: true };
}

// ---------------------------------------------------------------------------
// Sequence helpers
// ---------------------------------------------------------------------------

function hold(frames, opts, frameOpts = {}) {
  const out = [];
  for (let i = 0; i < frames; i++) out.push(poseFrame({ ...opts, ...frameOpts }));
  return out;
}

// A full backswing -> forward delivery arc for one arm. Hand heights are torso
// units above the shoulder (negative = below); dx is the hand's x offset from
// its own shoulder in torso units.
export function swingFrames({
  start = -0.88, deep = -1.5, top = 0.7,
  startDx = 0.48, deepDx = 0.55, topDx = 0.15,
  backSteps = 6, forwardSteps = 9, follow = 12,
  bend = 0.0, arm = 'right', ...opts
} = {}) {
  const frames = [];
  const otherArm = arm === 'right' ? 'left' : 'right';
  const armFrame = (h, dx) => {
    const state = { h, dx, bend };
    const other = { h: -0.88, dx: arm === 'right' ? -0.48 : 0.48 };
    return poseFrame(arm === 'right'
      ? { ...opts, right: state, left: other }
      : { ...opts, left: state, right: other });
  };
  void otherArm;
  for (let i = 1; i <= backSteps; i++) {
    const f = i / backSteps;
    frames.push(armFrame(start + (deep - start) * f, startDx + (deepDx - startDx) * f));
  }
  for (let i = 1; i <= forwardSteps; i++) {
    const f = i / forwardSteps;
    frames.push(armFrame(deep + (top - deep) * f, deepDx + (topDx - deepDx) * f));
  }
  for (let i = 1; i <= follow; i++) {
    const f = i / follow;
    frames.push(armFrame(top + (start - top) * f, topDx + (startDx - topDx) * f));
  }
  return frames;
}

function trackingLost(frames) {
  return frames.map((f) => (f === null ? f : { ...f, tracked: false, landmarks: null, confidence: 0.0 }));
}

function lowConfidence(frames, from, to, confidence = 0.2) {
  return frames.map((f, i) => (i >= from && i <= to && f && f.tracked
    ? { ...f, confidence } : f));
}

function withNoise(frames, seed, noise) {
  const rng = mulberry32(seed);
  return frames.map((f) => {
    if (!f || !f.tracked) return f;
    const landmarks = {};
    for (const [name, lm] of Object.entries(f.landmarks)) {
      landmarks[name] = {
        x: lm.x + (rng() - 0.5) * 2 * noise * 0.25,
        y: lm.y + (rng() - 0.5) * 2 * noise * 0.25,
        z: lm.z, visibility: lm.visibility,
      };
    }
    return { ...f, landmarks };
  });
}

// ---------------------------------------------------------------------------
// Synthetic sequences
// ---------------------------------------------------------------------------

const READY = { right: { h: -0.88, dx: 0.48 }, left: { h: -0.88, dx: -0.48 } };

function jumpJackCycle({ bodyX = 0.5, torso = 0.25, up = 1.1, steps = 8, shoulderY = 0.40 } = {}) {
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    const h = -0.88 + (up + 0.88) * (i / steps);
    const spread = 0.25 * (i / steps);
    frames.push(poseFrame({
      bodyX, torso, shoulderY: shoulderY - 0.03 * (i / steps),
      right: { h, dx: 0.48 + spread, bend: 0.05 },
      left: { h, dx: -0.48 - spread, bend: 0.05 },
    }));
  }
  for (let i = 1; i <= steps; i++) {
    const h = up + (-0.88 - up) * (i / steps);
    frames.push(poseFrame({
      bodyX, torso, shoulderY: shoulderY - 0.03 * (1 - i / steps),
      right: { h, dx: 0.73 - 0.25 * (i / steps), bend: 0.05 },
      left: { h, dx: -0.73 + 0.25 * (i / steps), bend: 0.05 },
    }));
  }
  return frames;
}

function burpeeCycle({ bodyX = 0.5, torso = 0.25 } = {}) {
  const frames = [];
  // crouch down while the arms come forward low
  for (let i = 1; i <= 8; i++) {
    const f = i / 8;
    frames.push(poseFrame({
      bodyX, torso, shoulderY: 0.40 + 0.10 * f,
      right: { h: -0.88 - 0.35 * f, dx: 0.48 }, left: { h: -0.88 - 0.35 * f, dx: -0.48 },
    }));
  }
  // jump up with both arms overhead
  for (let i = 1; i <= 8; i++) {
    const f = i / 8;
    frames.push(poseFrame({
      bodyX, torso, shoulderY: 0.50 - 0.16 * f,
      right: { h: -1.23 + 2.1 * f, dx: 0.48 + 0.3 * f },
      left: { h: -1.23 + 2.1 * f, dx: -0.48 - 0.3 * f },
    }));
  }
  // land back into ready
  for (let i = 1; i <= 8; i++) {
    const f = i / 8;
    frames.push(poseFrame({
      bodyX, torso, shoulderY: 0.34 + 0.06 * f,
      right: { h: 0.87 - 1.75 * f, dx: 0.48 }, left: { h: 0.87 - 1.75 * f, dx: -0.48 },
    }));
  }
  return frames;
}

function waveSequence({ frames = 90, torso = 0.25, bodyX = 0.5, handH = 0.15, amplitude = 0.12 } = {}) {
  const out = [];
  for (let i = 1; i <= 6; i++) {               // bring the hand up to the wave
    const f = i / 6;
    out.push(poseFrame({
      torso, bodyX,
      right: { h: -0.88 + (handH + 0.88) * f, dx: 0.48 - 0.23 * f, bend: 0.25 * f },
      left: READY.left,
    }));
  }
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    const dx = 0.25 + amplitude * Math.sin(t * 12);
    out.push(poseFrame({
      torso, bodyX,
      right: { h: handH + 0.04 * Math.sin(t * 8), dx, bend: 0.5 },
      left: READY.left,
    }));
  }
  return out;
}

function scratchHeadSequence() {
  const frames = [];
  frames.push(...hold(20, { right: { h: -0.88, dx: 0.48 } }));
  for (let i = 1; i <= 8; i++) {           // hand up to the ear
    const f = i / 8;
    frames.push(poseFrame({
      right: { h: -0.88 + 1.35 * f, dx: 0.48 - 0.35 * f, bend: 1.0 },
      left: READY.left,
    }));
  }
  for (let i = 0; i < 14; i++) {           // scratch
    const f = i / 14;
    frames.push(poseFrame({
      right: { h: 0.47 + 0.04 * Math.sin(f * 10), dx: 0.13 + 0.03 * Math.sin(f * 8), bend: 1.0 },
      left: READY.left,
    }));
  }
  for (let i = 1; i <= 8; i++) {           // hand back down
    const f = i / 8;
    frames.push(poseFrame({
      right: { h: 0.47 - 1.35 * f, dx: 0.13 + 0.35 * f, bend: 1.0 * (1 - f * 0.4) },
      left: READY.left,
    }));
  }
  frames.push(...hold(20, { right: { h: -0.88, dx: 0.48 } }));
  return frames;
}

function raiseArmSequence({ holdFrames = 12 } = {}) {
  const frames = [];
  frames.push(...hold(20, { right: { h: -0.88, dx: 0.48 } }));
  for (let i = 1; i <= 9; i++) {           // one straight-arm raise, no backswing
    const f = i / 9;
    frames.push(poseFrame({
      right: { h: -0.88 + 1.8 * f, dx: 0.48 - 0.1 * f }, left: READY.left,
    }));
  }
  frames.push(...hold(holdFrames, { right: { h: 0.92, dx: 0.38 } }));
  for (let i = 1; i <= 9; i++) {           // lower it back
    const f = i / 9;
    frames.push(poseFrame({
      right: { h: 0.92 - 1.8 * f, dx: 0.38 + 0.1 * f }, left: READY.left,
    }));
  }
  frames.push(...hold(20, { right: { h: -0.88, dx: 0.48 } }));
  return frames;
}

function stretchSequence() {
  const frames = [];
  frames.push(...hold(20, { right: { h: -0.88, dx: 0.48 } }));
  for (let i = 1; i <= 20; i++) {          // both arms drift overhead, slowly
    const f = i / 20;
    frames.push(poseFrame({
      right: { h: -0.88 + 2.0 * f, dx: 0.48 + 0.35 * f },
      left: { h: -0.88 + 2.0 * f, dx: -0.48 - 0.35 * f },
    }));
  }
  frames.push(...hold(20, {
    right: { h: 1.12, dx: 0.83 }, left: { h: 1.12, dx: -0.83 },
  }));
  for (let i = 1; i <= 20; i++) {
    const f = i / 20;
    frames.push(poseFrame({
      right: { h: 1.12 - 2.0 * f, dx: 0.83 - 0.35 * f },
      left: { h: 1.12 - 2.0 * f, dx: -0.83 + 0.35 * f },
    }));
  }
  frames.push(...hold(20, { right: { h: -0.88, dx: 0.48 } }));
  return frames;
}

function walkSequence({ frames = 110, speed = 12 } = {}) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const bodyX = 0.5 + 0.18 * Math.sin(i / speed);
    const bob = 0.012 * Math.sin(i / 3.5);
    out.push(poseFrame({
      bodyX, shoulderY: 0.40 + bob,
      right: { h: -0.88 + 0.03 * Math.sin(i / 3.5), dx: 0.48 },
      left: { h: -0.88 - 0.03 * Math.sin(i / 3.5), dx: -0.48 },
    }));
  }
  return out;
}

function steppingSequence() {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const target = 0.5 + (i % 2 === 0 ? 0.06 : -0.06);
    const from = 0.5 + ((i + 1) % 2 === 0 ? 0.06 : -0.06);
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      out.push(poseFrame({
        bodyX: from + (target - from) * f,
        shoulderY: 0.40 + 0.02 * Math.sin(f * Math.PI),
      }));
    }
    out.push(...hold(6, {}));
  }
  return out;
}

function leanSequence() {
  const out = [];
  for (let i = 0; i < 110; i++) {
    const lean = 0.03 * Math.sin(i / 7);
    const crouch = 0.02 * Math.sin(i / 9);
    out.push(poseFrame({
      bodyX: 0.5 + lean,
      shoulderY: 0.40 + crouch,
    }));
  }
  return out;
}

function torsoTwistSequence() {
  const out = [];
  for (let i = 0; i < 110; i++) {
    const angle = 0.45 * Math.sin(i / 11);      // ~26 degrees of shoulder roll
    out.push(poseFrame({ shoulderAngle: angle }));
  }
  return out;
}

// Bounded, fidgety random motion: the hand wanders around the ready zone
// with frequent direction changes and never composes a delivery-shaped
// sustained rise. (A completely unconstrained random walk does sometimes
// build a settled wind-up plus an accelerating rise - that trajectory *is*
// a bowling gesture by every observable criterion; see the ambiguity note in
// docs/WEBCAM_SWING.md and the --sweep measurement in webcam_eval.mjs.)
export function randomArmSequence({ seed = 11, frames = 240 } = {}) {
  const rng = mulberry32(seed);
  const out = [];
  let h = -0.88; let dx = 0.48; let vh = 0.0; let vx = 0.0;
  let riseFromMin = 0.0; let minH = h;
  for (let i = 0; i < frames; i++) {
    vh += (rng() - 0.5) * 0.5; vx += (rng() - 0.5) * 0.3;
    vh *= 0.75; vx *= 0.85;
    h += vh; dx += vx;
    h = Math.max(-1.15, Math.min(0.25, h));
    dx = Math.max(0.15, Math.min(0.9, dx));
    if (h < minH) minH = h;
    riseFromMin = h - minH;
    if (riseFromMin > 0.4 && vh > 0) vh = -Math.abs(vh) - 0.2;   // break delivery-shaped rises
    out.push(poseFrame({ right: { h, dx, bend: 0.3 }, left: READY.left }));
  }
  return out;
}

// The unconstrained random walk is a *measurement* of the inherent ambiguity
// of one-arm motion, not a pass/fail negative: some seeds compose a full
// settled wind-up plus a sustained accelerating rise, which is a bowling
// delivery by every observable property. The evaluation harness reports how
// often that happens so the number is on the record.
export function unconstrainedRandomArmSequence(seed, frames = 240) {
  const rng = mulberry32(seed);
  const out = [];
  let h = -0.88; let dx = 0.48; let vh = 0.0; let vx = 0.0;
  for (let i = 0; i < frames; i++) {
    vh += (rng() - 0.5) * 0.35; vx += (rng() - 0.5) * 0.25;
    vh *= 0.9; vx *= 0.9;
    h += vh; dx += vx;
    h = Math.max(-1.6, Math.min(0.7, h));
    dx = Math.max(0.05, Math.min(0.95, dx));
    out.push(poseFrame({ right: { h, dx, bend: 0.3 }, left: READY.left }));
  }
  return out;
}

function rapidFlickSequence({ frames = 120, amplitude = 0.22, period = 7 } = {}) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const h = -0.72 + amplitude * Math.sin((i / period) * Math.PI * 2);
    out.push(poseFrame({ right: { h, dx: 0.48 + 0.05 * Math.cos(i / 9), bend: 0.6 }, left: READY.left }));
  }
  return out;
}

function oneArmPumpSequence({ cycles = 5, up = 0.55, downFrames = 7, upFrames = 7 } = {}) {
  const out = [];
  out.push(...hold(24, { right: { h: -0.88, dx: 0.48 } }));
  for (let c = 0; c < cycles; c++) {
    for (let i = 1; i <= upFrames; i++) {      // raise (first move is up)
      const f = i / upFrames;
      out.push(poseFrame({ right: { h: -0.88 + (up + 0.88) * f, dx: 0.48 }, left: READY.left }));
    }
    for (let i = 1; i <= downFrames; i++) {    // lower straight back down
      const f = i / downFrames;
      out.push(poseFrame({ right: { h: up + (-0.88 - up) * f, dx: 0.48 }, left: READY.left }));
    }
  }
  out.push(...hold(30, { right: { h: -0.88, dx: 0.48 } }));
  return out;
}

function headScratchThenWaveSequence() {
  return [...scratchHeadSequence(), ...hold(10, {}), ...waveSequence({ frames: 90 })];
}

function raiseLowerRaiseSequence() {
  return [...raiseArmSequence({ holdFrames: 4 }), ...hold(6, {}), ...raiseArmSequence({ holdFrames: 4 })];
}

function interruptedSwing({ cut = 'forward', loss = 8 }) {
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  const from = cut === 'backswing' ? 24 : 32;
  for (let i = from; i < from + loss && i < frames.length; i++) {
    frames[i] = { landmarks: null, confidence: 0.0, tracked: false };
  }
  return frames;
}

function confidenceDropSwing() {
  // Six consecutive low-confidence frames right where the delivery starts:
  // beyond the loss grace, so the stroke must abort.
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  for (let i = 27; i <= 32 && i < frames.length; i++) {
    frames[i] = { ...frames[i], confidence: 0.2 };
  }
  return frames;
}

function identityFlipSwing() {
  // A swing where, early in the delivery, the wrist landmarks swap identity:
  // the hand that was rising teleports to the other side of the body and the
  // resting hand takes its place. Nothing may release from the stitched
  // motion.
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  for (let i = 27; i < frames.length; i++) {
    const f = frames[i];
    if (!f || !f.tracked) continue;
    const lm = f.landmarks;
    if (!lm) continue;
    const r = lm.right_wrist; const l = lm.left_wrist;
    const temp = { x: r.x, y: r.y };
    r.x -= 0.35; r.y = 0.62;
    l.x = temp.x; l.y = temp.y;
    // keep elbows/hands near their wrists so the arm chain stays consistent
    for (const finger of ['right_index', 'right_pinky', 'right_thumb']) {
      lm[finger] = { x: r.x + 0.02, y: r.y + 0.02, z: 0, visibility: 0.95 };
    }
    for (const finger of ['left_index', 'left_pinky', 'left_thumb']) {
      lm[finger] = { x: l.x + 0.02, y: l.y + 0.02, z: 0, visibility: 0.95 };
    }
  }
  return frames;
}

function occludedBackswingSwing() {
  // The wrist and hand landmarks are hidden through the ready pose and the
  // whole backswing (the elbow stays visible), then the hand reappears during
  // the delivery. The elbow chain must carry the stroke.
  const frames = [...hold(24, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  for (let i = 0; i <= 30 && i < frames.length; i++) {
    const f = frames[i];
    if (!f || !f.tracked || !f.landmarks) continue;
    for (const name of ['right_wrist', 'right_index', 'right_pinky', 'right_thumb']) {
      if (f.landmarks[name]) f.landmarks[name].visibility = 0.05;
    }
  }
  return frames;
}

function brieflyHiddenWristSwing() {
  // The wrist and hand vanish for three frames mid-delivery (inside the loss
  // grace) and come back: the swing must still be recognized.
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  for (let i = 27; i <= 29 && i < frames.length; i++) {
    const f = frames[i];
    if (!f || !f.tracked || !f.landmarks) continue;
    for (const name of ['right_wrist', 'right_index', 'right_pinky', 'right_thumb']) {
      if (f.landmarks[name]) f.landmarks[name].visibility = 0.05;
    }
  }
  return frames;
}

function timestampAnomalySwing() {
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  return frames.map((f, i) => (i >= 27 && i <= 34 ? { ...f, dt: 0.5 } : f));
}

function oneFrameGapSwing() {
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  return frames.map((f, i) => (i === 27 ? { landmarks: null, confidence: 0.0, tracked: false } : f));
}

function moderateOtherArmSwing() {
  // The non-throwing arm moves a little (a natural counterbalance); the throw
  // must still count because the throwing arm dominates.
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  return frames.map((f, i) => {
    if (i < 32) return f;
    const phase = Math.min(1, (i - 32) / 27);
    const out = JSON.parse(JSON.stringify(f));
    const h = -0.88 + 0.9 * Math.sin(phase * Math.PI);
    const shoulderX = out.landmarks.left_shoulder.x;
    out.landmarks.left_wrist.x = shoulderX - 0.35 * 0.25;
    out.landmarks.left_wrist.y = out.landmarks.left_shoulder.y - h * 0.25;
    return out;
  });
}

function cameraShakeSwing() {
  // Smooth handheld camera drift during the delivery: the whole body (and
  // therefore every landmark) moves together, so body-relative measurements
  // must cancel it.
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  return frames.map((f, i) => {
    const sx = 0.02 * Math.sin(i / 9) + 0.01 * Math.sin(i / 4.3);
    const sy = 0.02 * Math.cos(i / 11) + 0.01 * Math.cos(i / 5.7);
    const out = JSON.parse(JSON.stringify(f));
    for (const lm of Object.values(out.landmarks)) { lm.x += sx; lm.y += sy; }
    return out;
  });
}

function afterExerciseSwing() {
  // The player first does jumping jacks, then settles into the ready pose and
  // bowls. The genuine swing must still be accepted.
  return [
    ...jumpJackCycle(), ...jumpJackCycle(),
    ...hold(40, {}),
    ...swingFrames(),
  ];
}

function afterWalkSwing() {
  const walk = walkSequence({ frames: 70 }).slice(0, 70);
  return [...walk, ...hold(45, {}), ...swingFrames()];
}

function repeatedSwingsWithReady() {
  const out = [...hold(30, {})];
  for (let i = 0; i < 3; i++) {
    out.push(...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 }));
    out.push(...hold(30, {}));
  }
  return out;
}

function fastDirectRaise() {
  const out = [...hold(20, {})];
  for (let i = 1; i <= 6; i++) {               // straight up, no descent at all
    const f = i / 6;
    out.push(poseFrame({ right: { h: -0.88 + 2.7 * f, dx: 0.48 - 0.15 * f }, left: READY.left }));
  }
  out.push(...hold(20, { right: { h: 1.82, dx: 0.33 } }));
  for (let i = 1; i <= 8; i++) {
    const f = i / 8;
    out.push(poseFrame({ right: { h: 1.82 - 2.7 * f, dx: 0.33 + 0.15 * f }, left: READY.left }));
  }
  out.push(...hold(20, {}));
  return out;
}

function singlePumpFromRaised() {
  const out = [...hold(20, {}), ...raiseArmSequence({ holdFrames: 2 }).slice(20)];
  // now the arm is low again after the raise; pump straight back up
  for (let i = 1; i <= 7; i++) {
    const f = i / 7;
    out.push(poseFrame({ right: { h: -0.88 + 1.5 * f, dx: 0.48 }, left: READY.left }));
  }
  for (let i = 1; i <= 7; i++) {
    const f = i / 7;
    out.push(poseFrame({ right: { h: 0.62 - 1.5 * f, dx: 0.48 }, left: READY.left }));
  }
  out.push(...hold(30, {}));
  return out;
}

function backswingOnly() {
  const out = [...hold(20, {})];
  const deep = swingFrames({ backSteps: 6 }).slice(0, 6);
  out.push(...deep);
  out.push(...hold(60, { right: { h: -1.5, dx: 0.55 } }));
  return out;
}

function backswingWeakLift() {
  const out = [...hold(20, {}), ...swingFrames({ backSteps: 6 }).slice(0, 6)];
  for (let i = 1; i <= 8; i++) {               // slow, small lift: no delivery
    const f = i / 8;
    out.push(poseFrame({ right: { h: -1.5 + 0.25 * f, dx: 0.55 }, left: READY.left }));
  }
  out.push(...hold(40, { right: { h: -1.25, dx: 0.55 } }));
  return out;
}

function stutterSwing() {
  const out = [...hold(20, {})];
  out.push(...swingFrames({ backSteps: 6 }).slice(0, 6));      // backswing
  for (let i = 1; i <= 5; i++) {                               // forward, then...
    const f = i / 5;
    out.push(poseFrame({ right: { h: -1.5 + 1.0 * f, dx: 0.55 }, left: READY.left }));
  }
  for (let i = 1; i <= 5; i++) {                               // ...back down
    const f = i / 5;
    out.push(poseFrame({ right: { h: -0.5 - 1.0 * f, dx: 0.3 }, left: READY.left }));
  }
  for (let i = 1; i <= 9; i++) {                               // ...and up again
    const f = i / 9;
    out.push(poseFrame({ right: { h: -1.5 + 2.2 * f, dx: 0.55 - 0.4 * f }, left: READY.left }));
  }
  out.push(...hold(20, {}));
  return out;
}

function punchDown() {
  const out = [...hold(20, {})];
  for (let i = 1; i <= 5; i++) {               // fast punch down and hold
    const f = i / 5;
    out.push(poseFrame({ right: { h: -0.88 - 0.9 * f, dx: 0.48 + 0.1 * f }, left: READY.left }));
  }
  out.push(...hold(50, { right: { h: -1.78, dx: 0.58 } }));
  return out;
}

function crouchDelivery() {
  // A genuine arm swing performed while the torso collapses (shoulders drop
  // toward the hips through the whole stroke, unlike a knee-bend crouch).
  const base = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  const names = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_index', 'left_pinky', 'left_thumb',
    'right_index', 'right_pinky', 'right_thumb'];
  return base.map((f, i) => {
    if (i < 18) return f;
    const progress = Math.min(1, (i - 18) / 12);      // full slouch by frame 30
    const out = JSON.parse(JSON.stringify(f));
    const drop = 0.6 * 0.25 * progress;
    for (const name of names) out.landmarks[name].y += drop;
    return out;
  });
}

function turnAwaySwing() {
  // Rigid upper-body rotation away from the camera through the early delivery:
  // the stroke geometry stays internally consistent, so only the torso-turn
  // gate can catch it.
  const frames = [...hold(20, {}), ...swingFrames({ backSteps: 6, forwardSteps: 9, follow: 12 })];
  const rotating = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_index', 'left_pinky', 'left_thumb',
    'right_index', 'right_pinky', 'right_thumb', 'nose'];
  return frames.map((f, i) => {
    if (i < 22) return f;
    const progress = Math.min(1, (i - 22) / 10);
    const angle = 1.15 * progress;             // rotate ~66 degrees
    const out = JSON.parse(JSON.stringify(f));
    const cx = (out.landmarks.left_shoulder.x + out.landmarks.right_shoulder.x) / 2;
    const cy = (out.landmarks.left_shoulder.y + out.landmarks.right_shoulder.y) / 2;
    const cos = Math.cos(angle); const sin = Math.sin(angle);
    for (const name of rotating) {
      const lm = out.landmarks[name];
      const rx = lm.x - cx; const ry = lm.y - cy;
      lm.x = cx + rx * cos - ry * sin;
      lm.y = cy + rx * sin + ry * cos;
    }
    return out;
  });
}

export function buildSyntheticSequences() {
  const sequences = [];
  const ready20 = hold(20, {});
  const ready90 = hold(90, {});

  // ---- positive controls: genuine bowling deliveries, diverse technique ----
  sequences.push({
    name: 'swing_standard', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'one-arm backswing + delivery at 30 fps',
    frames: [...ready20, ...swingFrames()],
  });
  sequences.push({
    name: 'swing_slow_delivery', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'gentle swing, 14 forward frames',
    frames: [...ready20, ...swingFrames({ forwardSteps: 14, top: 0.55, backSteps: 8, deep: -1.3 })],
  });
  sequences.push({
    name: 'swing_fast_delivery', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'snappy swing, 6 forward frames',
    frames: [...ready20, ...swingFrames({ forwardSteps: 6, top: 0.85, deep: -1.6 })],
  });
  sequences.push({
    name: 'swing_deep_backswing', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'very deep backswing',
    frames: [...ready20, ...swingFrames({ deep: -2.1, deepDx: 0.75 })],
  });
  sequences.push({
    name: 'swing_shallow_backswing', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'minimum-ish backswing depth (0.17 torso heights)',
    frames: [...ready20, ...swingFrames({ deep: -1.05, top: 0.5 })],
  });
  sequences.push({
    name: 'swing_visible_windup_pause', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'a short pause at the top of the backswing',
    frames: [...ready20, ...swingFrames({ backSteps: 6 }).slice(0, 6),
      ...swingFrames({ backSteps: 6 }).slice(5, 6),
      ...swingFrames({ backSteps: 6 }).slice(5, 6),
      ...swingFrames({ backSteps: 6, forwardSteps: 9 }).slice(6)],
  });
  sequences.push({
    name: 'swing_bent_arm', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'bent-elbow delivery',
    frames: [...ready20, ...swingFrames({ bend: 0.9 })],
  });
  sequences.push({
    name: 'swing_left_arm', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'left-handed delivery',
    frames: [...ready20, ...swingFrames({ arm: 'left', startDx: -0.48, deepDx: -0.55, topDx: -0.15 })],
  });
  sequences.push({
    name: 'swing_close_camera', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'player close to the camera (torso 0.38)',
    frames: [...ready20, ...swingFrames({ torso: 0.38, shoulderY: 0.28 })],
  });
  sequences.push({
    name: 'swing_far_camera', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'player far from the camera (torso 0.14)',
    frames: [...ready20, ...swingFrames({ torso: 0.14, shoulderY: 0.44 })],
  });
  sequences.push({
    name: 'swing_body_sway', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'moderate body translation during the delivery',
    frames: [
      ...ready20,
      ...swingFrames({ backSteps: 6 }).map((f, i) => {
        const t = i / 27;
        const out = { ...f };
        for (const lm of Object.values(out.landmarks)) { lm.x += 0.035 * t; lm.y += 0.008 * Math.sin(t * 6); }
        return out;
      }),
      ...hold(12, {}),
    ],
  });
  sequences.push({
    name: 'swing_noisy_tracking', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'realistic landmark noise (deterministic)',
    frames: withNoise([...ready20, ...swingFrames(), ...hold(15, {})], 7, 0.035),
  });
  sequences.push({
    name: 'swing_low_fps', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: '15 fps camera',
    frames: [...ready20, ...swingFrames({ backSteps: 4, forwardSteps: 6, follow: 8 })],
    fps: 15,
  });
  sequences.push({
    name: 'swing_hidden_wrist', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'wrist occluded; visible hand landmarks carry the stroke',
    frames: [...ready20, ...swingFrames({
      wristVis: 0.05, handVis: 0.9,
    })],
  });
  sequences.push({
    name: 'swing_occluded_backswing', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'wrist and hand hidden through the backswing; the elbow chain carries it',
    frames: occludedBackswingSwing(),
  });
  sequences.push({
    name: 'swing_briefly_hidden_wrist', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'hand hidden for five frames mid-delivery (inside the loss grace)',
    frames: brieflyHiddenWristSwing(),
  });
  sequences.push({
    name: 'swing_patient_ready', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'long ready hold before the swing',
    frames: [...ready90, ...swingFrames()],
  });
  sequences.push({
    name: 'swing_two_hooks', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'release across the body (hook direction)',
    frames: [...ready20, ...swingFrames({ topDx: -0.45 })],
  });
  sequences.push({
    name: 'swing_cross_body', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'strong cross-body release',
    frames: [...ready20, ...swingFrames({ topDx: -0.8, top: 0.5 })],
  });
  sequences.push({
    name: 'swing_one_frame_gap', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'a single untracked frame mid-delivery (within the loss grace)',
    frames: oneFrameGapSwing(),
  });
  sequences.push({
    name: 'swing_moderate_other_arm', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'natural counterbalance from the non-throwing arm',
    frames: moderateOtherArmSwing(),
  });
  sequences.push({
    name: 'swing_camera_shake', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'whole-frame camera shake; body-relative features cancel it',
    frames: cameraShakeSwing(),
  });
  sequences.push({
    name: 'swing_borderline_confidence', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'confidence just above the floor',
    frames: [...ready20, ...swingFrames(), ...hold(15, {})].map((f) => ({ ...f, confidence: 0.55 })),
  });
  sequences.push({
    name: 'swing_low_visibility_wrist', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'throwing wrist just above the visibility floor',
    frames: [...ready20, ...swingFrames({ wristVis: 0.35, handVis: 0.95 })],
  });
  sequences.push({
    name: 'swing_after_exercise', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'jumping jacks, then settle, then a genuine delivery',
    frames: afterExerciseSwing(),
  });
  sequences.push({
    name: 'swing_after_walking', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'walk in, settle, then a genuine delivery',
    frames: afterWalkSwing(),
  });
  sequences.push({
    name: 'repeated_swings_rearm', kind: 'synthetic', motion: 'bowling_swing', expect: 3,
    note: 'three complete swings each followed by a fresh ready hold',
    frames: repeatedSwingsWithReady(),
  });

  // ---- negative controls --------------------------------------------------
  sequences.push({
    name: 'stand_still', kind: 'synthetic', motion: 'stillness', expect: 0,
    note: 'arms down, standing still with micro jitter',
    frames: [...hold(150, {}, {})].map((f, i) => {
      const jitter = i % 7 < 3 ? 0.003 : -0.003;
      return poseFrame({ right: { h: -0.88 + jitter, dx: 0.48 }, left: { h: -0.88 - jitter, dx: -0.48 } });
    }),
  });
  sequences.push({
    name: 'idle_sway', kind: 'synthetic', motion: 'idle_sway', expect: 0,
    note: 'weight shifting with arms hanging',
    frames: Array.from({ length: 140 }, (_, i) => {
      const sway = 0.02 * Math.sin(i / 7);
      return poseFrame({ bodyX: 0.5 + sway, right: { h: -0.88, dx: 0.48 }, left: { h: -0.88, dx: -0.48 } });
    }),
  });
  sequences.push({
    name: 'jumping_jacks', kind: 'synthetic', motion: 'jumping_jacks', expect: 0,
    note: 'symmetric two-arm raises, three cycles',
    frames: [
      ...ready20,
      ...jumpJackCycle(), ...jumpJackCycle(), ...jumpJackCycle(),
    ],
  });
  sequences.push({
    name: 'burpees', kind: 'synthetic', motion: 'burpees', expect: 0,
    note: 'crouch + two-arm overhead jump, two cycles',
    frames: [...ready20, ...burpeeCycle(), ...burpeeCycle()],
  });
  sequences.push({
    name: 'waving', kind: 'synthetic', motion: 'waving', expect: 0,
    note: 'hand up at chest/head height, waving sideways',
    frames: waveSequence({ frames: 120 }),
  });
  sequences.push({
    name: 'scratch_head', kind: 'synthetic', motion: 'head_scratch', expect: 0,
    note: 'one hand up to the head, scratch, back down',
    frames: scratchHeadSequence(),
  });
  sequences.push({
    name: 'raise_arm', kind: 'synthetic', motion: 'arm_raise', expect: 0,
    note: 'single straight-arm raise and lower, no wind-up',
    frames: raiseArmSequence(),
  });
  sequences.push({
    name: 'two_arm_stretch', kind: 'synthetic', motion: 'stretch', expect: 0,
    note: 'slow two-arm overhead stretch',
    frames: stretchSequence(),
  });
  sequences.push({
    name: 'walking', kind: 'synthetic', motion: 'walking', expect: 0,
    note: 'walking across the frame, arms hanging',
    frames: walkSequence(),
  });
  sequences.push({
    name: 'stepping', kind: 'synthetic', motion: 'stepping', expect: 0,
    note: 'stepping side to side in place',
    frames: steppingSequence(),
  });
  sequences.push({
    name: 'leaning', kind: 'synthetic', motion: 'leaning', expect: 0,
    note: 'torso lean/weight shift, arms hanging',
    frames: leanSequence(),
  });
  sequences.push({
    name: 'torso_twist', kind: 'synthetic', motion: 'torso_twist', expect: 0,
    note: 'shoulder-line rotation without arm motion',
    frames: torsoTwistSequence(),
  });
  sequences.push({
    name: 'random_arm_motion', kind: 'synthetic', motion: 'random_arm', expect: 0,
    note: 'seeded random one-arm motion around the ready pose',
    frames: randomArmSequence(),
  });
  sequences.push({
    name: 'rapid_flicks', kind: 'synthetic', motion: 'rapid_flick', expect: 0,
    note: 'small fast wrist flicks near the ready pose',
    frames: rapidFlickSequence(),
  });
  sequences.push({
    name: 'one_arm_pumps', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'repeated one-arm raise/lower rhythm without settling',
    frames: oneArmPumpSequence(),
  });
  sequences.push({
    name: 'scratch_then_wave', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'head scratch followed by waving',
    frames: headScratchThenWaveSequence(),
  });
  sequences.push({
    name: 'raise_lower_raise', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'two arm raises with a short pause between',
    frames: raiseLowerRaiseSequence(),
  });
  sequences.push({
    name: 'interrupted_backswing', kind: 'synthetic', motion: 'interrupted', expect: 0,
    note: 'tracking drops during the backswing',
    frames: interruptedSwing({ cut: 'backswing' }),
  });
  sequences.push({
    name: 'interrupted_forward', kind: 'synthetic', motion: 'interrupted', expect: 0,
    note: 'tracking drops during the forward swing',
    frames: interruptedSwing({ cut: 'forward' }),
  });
  sequences.push({
    name: 'low_confidence_swing', kind: 'synthetic', motion: 'low_confidence', expect: 0,
    note: 'a genuine swing with a confidence dropout; must not be trusted',
    frames: confidenceDropSwing(),
  });
  sequences.push({
    name: 'arm_identity_flip', kind: 'synthetic', motion: 'identity_flip', expect: 0,
    note: 'wrist landmarks swap mid-delivery',
    frames: identityFlipSwing(),
  });
  sequences.push({
    name: 'timestamp_gap_mid_swing', kind: 'synthetic', motion: 'timestamp_anomaly', expect: 0,
    note: 'one huge inter-frame gap mid-swing',
    frames: timestampAnomalySwing(),
  });
  sequences.push({
    name: 'fast_direct_raise', kind: 'synthetic', motion: 'arm_raise', expect: 0,
    note: 'explosive one-arm raise with no wind-up',
    frames: fastDirectRaise(),
  });
  sequences.push({
    name: 'single_pump_from_raised', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'lower from a raise and immediately raise again',
    frames: singlePumpFromRaised(),
  });
  sequences.push({
    name: 'backswing_only', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'full backswing, then the player stops',
    frames: backswingOnly(),
  });
  sequences.push({
    name: 'backswing_weak_lift', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'full backswing followed by a small slow lift',
    frames: backswingWeakLift(),
  });
  sequences.push({
    name: 'swing_stuttered_delivery', kind: 'synthetic', motion: 'bowling_swing', expect: 1,
    note: 'delivery with a mid-stroke wobble that still completes the throw',
    frames: stutterSwing(),
  });
  sequences.push({
    name: 'punch_down', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'fast downward punch with no delivery',
    frames: punchDown(),
  });
  sequences.push({
    name: 'crouch_delivery', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'delivery while slouching the torso far below its normal length',
    frames: crouchDelivery(),
  });
  sequences.push({
    name: 'turn_away_mid_swing', kind: 'synthetic', motion: 'combination', expect: 0,
    note: 'player rotates away from the camera mid-delivery',
    frames: turnAwaySwing(),
  });

  return sequences;
}

// ---------------------------------------------------------------------------
// Recorded real-human fixtures (negative motions; see tools/testdata/README)
// ---------------------------------------------------------------------------

export function loadRecordedSequences() {
  const sequences = [];
  const fixtures = [
    ['webcam_landmarks.json', 'recorded_jumping_jacks_burpees', 'jumping_jacks', 0,
      'Wikimedia "Jumping jacks and burpees" landmark trace (real human, negative)'],
    ['webcam_wave_landmarks.json', 'recorded_waving', 'waving', 0,
      'Wikimedia "HandWaveExample" landmark trace (real human, negative)'],
  ];
  for (const [file, name, motion, expect, note] of fixtures) {
    const path = `${HERE}${file}`;
    if (!fs.existsSync(path)) continue;
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    const names = data.landmarks;
    const n = names.length;
    const frames = data.frames.map((entry) => {
      if (!entry.t || !entry.l) return { landmarks: null, confidence: 0.0, tracked: false };
      const landmarks = {};
      for (let i = 0; i < n; i++) {
        const x = entry.l[i];
        if (x === null || x === undefined) continue;
        landmarks[names[i]] = {
          x, y: entry.l[n + i], z: 0, visibility: entry.l[2 * n + i],
        };
      }
      return {
        landmarks,
        confidence: Number(entry.c) || 0.0,
        tracked: true,
      };
    });
    sequences.push({
      name, kind: 'recorded-human', motion, expect, note,
      fps: Number(data.fps) || 30, frames,
    });
  }
  return sequences;
}

export function buildEvaluationSequences() {
  return [...buildSyntheticSequences(), ...loadRecordedSequences()];
}
