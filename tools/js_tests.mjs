// Regression tests for the browser build's logic modules.
//
//   node tools/js_tests.mjs
//
// Runs against the real source modules (no bundler, no test framework) and
// mirrors the scenarios the original Python suite asserts, so a change to the
// ported logic that breaks parity fails here. DOM/three.js behaviour is not
// covered here; tools/browser_checks.md documents the in-browser sweep.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BowlingGame, ValueError } from '../src/scoring.js';
import { Match, Player, PLAYER_COLORS } from '../src/game/session.js';
import * as modes from '../src/game/modes.js';
import { Settings, DEFAULTS } from '../src/game/settings.js';
import { MouseInput, aimAngle, ReleaseNoise, makeThrowData } from '../src/input/mouse.js';
import { eventToThrow, WebcamInput, TrackingService } from '../src/input/webcam.js';
import { SwingDetector, SwingEvent, PHASE_WAITING, PHASE_READY, PHASE_BACKSWING, PHASE_FORWARD, PHASE_FOLLOW } from '../src/input/swing.js';
import {
  SwingClassifier, STATE_TRACKING, STATE_READY, STATE_BACKSWING, STATE_FORWARD, STATE_RELEASE,
} from '../src/input/classifier.js';
import { simulateRoll, Deck, DeckTimeline, rackPositions, PinPhysics } from '../src/physics.js';
import { checkAnswer, TRIVIA_QUESTIONS } from '../src/game/questions.js';
import { AudioSystem, AudioSettings } from '../src/game/audio.js';
import * as celebrate from '../src/motion/celebrate.js';
import { Motion, Tween } from '../src/motion/tween.js';
import * as ease from '../src/motion/ease.js';
import { keyToCharacter } from '../src/ui/theme.js';
import { parseLaunchValue, clampLaunchValue } from '../src/ui/number_field.js';
import { cardModel, frameBoxes, boxCountFor, normaliseMark, isBonusMark } from '../src/ui/cardmodel.js';
import { BotPlanner } from '../src/game/bot.js';
import * as config from '../src/config.js';

let passed = 0;
let failed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    failures.push([name, err]);
    console.error(`FAIL ${name}: ${err && err.message}`);
  }
}
function section(name) { console.log(`\n== ${name}`); }
const DT = 1.0 / 30.0;
const rad = (deg) => deg * Math.PI / 180;

// Async tests (camera lifecycle involves real timers and promises). They are
// queued and run sequentially: each one installs process-global browser stubs.
const asyncTests = [];
function testAsync(name, fn) { asyncTests.push([name, fn]); }

// ---------------------------------------------------------------------------
section('theme helpers (space key regression)');
test('keyToCharacter maps named keys and characters', () => {
  assert.equal(keyToCharacter('space'), ' ');
  assert.equal(keyToCharacter('a'), 'a');
  assert.equal(keyToCharacter('-'), '-');
  assert.equal(keyToCharacter('Enter'), null);
  assert.equal(keyToCharacter(''), null);
});
test('keyToCharacter covers the Python named-key table', () => {
  for (const [key, ch] of [['period', '.'], ['minus', '-'], ['comma', ','], ['slash', '/'],
    ['semicolon', ';'], ['equal', '='], ['plus', '+'], ['asterisk', '*'], ['underscore', '_']]) {
    assert.equal(keyToCharacter(key), ch, key);
  }
});

// ---------------------------------------------------------------------------
section('lab launch values (typed entry)');
test('plain decimals, signs and comma decimal points parse', () => {
  assert.equal(parseLaunchValue('speed', '11.37'), 11.37);
  assert.equal(parseLaunchValue('angle', '-3.25'), -3.25);
  assert.equal(parseLaunchValue('lateral', '+0.75'), 0.75);
  assert.equal(parseLaunchValue('spin', '2,5'), 2.5);
  assert.equal(parseLaunchValue('spin', '.5'), 0.5);
});
test('units, empty text and malformed numbers are rejected', () => {
  for (const text of ['', '   ', '7.5 m/s', 'abc', '1.2.3', '--1', 'NaN', '1e3']) {
    assert.equal(parseLaunchValue('speed', text), null, text);
  }
});
test('speed never goes below zero, the other rows keep their sign', () => {
  assert.equal(parseLaunchValue('speed', '-4'), 0.0);
  assert.equal(clampLaunchValue('speed', -0.25), 0.0);
  assert.equal(parseLaunchValue('lateral', '-1.25'), -1.25);
  assert.equal(clampLaunchValue('angle', -12.5), -12.5);
});

// ---------------------------------------------------------------------------
section('scoring (from tests/test_scoring.py)');
function rollMany(g, rolls) { for (const r of rolls) g.recordRoll(r); }
test('perfect game is 300 with the documented cumulative scores', () => {
  const g = new BowlingGame();
  rollMany(g, Array(12).fill(10));
  assert.equal(g.is_complete, true);
  assert.equal(g.total_score, 300);
  assert.deepEqual(g.cumulativeScores(), [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
});
test('all spares score 150', () => {
  const g = new BowlingGame();
  rollMany(g, Array(10).fill([5, 5]).flat().concat([5]));
  assert.equal(g.is_complete, true);
  assert.equal(g.total_score, 150);
});
test('all nines score 90', () => {
  const g = new BowlingGame();
  rollMany(g, Array(10).fill([9, 0]).flat());
  assert.equal(g.total_score, 90);
});
test('strike waits for exactly two bonus rolls', () => {
  const g = new BowlingGame();
  g.recordRoll(10);
  assert.equal(g.frameScore(1), null);
  g.recordRoll(3);
  assert.equal(g.frameScore(1), null);
  g.recordRoll(4);
  assert.equal(g.frameScore(1), 17);
  assert.equal(g.frameScore(2), 7);
});
test('tenth frame bonus balls and completion', () => {
  const g = new BowlingGame();
  rollMany(g, Array(9).fill([0, 0]).flat().concat([10, 10]));
  assert.equal(g.is_complete, false);
  g.recordRoll(10);
  assert.equal(g.is_complete, true);
  assert.equal(g.frameScore(10), 30);
});
test('tenth-frame spare racks reset', () => {
  const g = new BowlingGame();
  rollMany(g, Array(9).fill([0, 0]).flat());
  g.recordRoll(7);
  assert.equal(g.standingPins(), 3);
  g.recordRoll(3);
  assert.equal(g.standingPins(), 10);
  g.recordRoll(5);
  assert.equal(g.is_complete, true);
});
test('illegal rolls are rejected', () => {
  const g = new BowlingGame();
  g.recordRoll(6);
  assert.throws(() => g.recordRoll(5), ValueError);
  assert.throws(() => g.recordRoll(true), TypeError);
  assert.throws(() => g.recordRoll(11), ValueError);
});
test('final marks handle a tenth-frame strike then spare', () => {
  const g = new BowlingGame();
  rollMany(g, Array(9).fill([0, 0]).flat().concat([10, 7, 3]));
  assert.deepEqual(g.frameMarks(10), ['X', '7', '/']);
});

// ---------------------------------------------------------------------------
section('match / session (from tests/test_session.py)');
function single() { return Match.create(modes.CLASSIC, [{ name: 'A' }]); }
test('classic turn events follow the frame', () => {
  const m = single();
  assert.equal(m.recordRoll(9), 'same_player');
  assert.equal(m.recordRoll(0), 'round_changed');   // frame completed, solo player
  assert.equal(m.recordRoll(8), 'same_player');
});
test('turn passes to the next player after a completed frame', () => {
  const m = Match.create(modes.LOCAL, [{ name: 'A' }, { name: 'B' }]);
  assert.equal(m.recordRoll(10), 'turn_changed');
  assert.equal(m.turn_index, 1);
  assert.equal(m.recordRoll(10), 'round_changed');
  assert.equal(m.turn_index, 0);
});
test('recordRoll clamps against the scorer', () => {
  const m = single();
  m.recordRoll(7);
  m.recordRoll(99);            // clamped to the 3 pins standing
  assert.deepEqual(m.players[0].bowling.rolls, [7, 3]);
});
test('winners and result lines', () => {
  const m = Match.create(modes.LOCAL, [{ name: 'A' }, { name: 'B' }]);
  for (const p of m.players) { p.total_pins = 5; p.bowling.rolls = [5, 0]; }
  m.finished = true;
  assert.equal(m.resultLine(), 'DRAW: A & B');
});
test('nextTurn skips players who are done', () => {
  const m = Match.create(modes.LOCAL, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  rollMany(m.players[0].bowling, Array(12).fill(10));
  m.nextTurn();
  assert.notEqual(m.current_player.name, 'A');
});

// ---------------------------------------------------------------------------
section('modes and settings');
test('the six modes and picker order are intact', () => {
  assert.deepEqual(modes.PICKER_ORDER,
    ['classic', 'trivia', 'equations', 'pvbot', 'local', 'bowlrush']);
  assert.equal(modes.LOCAL.player_range[0], 2);
  assert.equal(modes.LOCAL.player_range[1], 4);
  assert.equal(modes.RUSHRUSH.timed, true);
  assert.equal(modes.TRIVIA.resolves_every_throw, true);
  assert.equal(modes.EQUATIONS.gate, modes.GATE_EQUATIONS);
});
test('invalid settings fall back to the defaults', () => {
  const s = new Settings({ input_mode: 'banana', throwing_arm: 'foot', master_volume: 5, rush_duration: 999 });
  s.validate();
  assert.equal(s.get('input_mode'), DEFAULTS.input_mode);
  assert.equal(s.get('throwing_arm'), DEFAULTS.throwing_arm);
  assert.equal(s.get('master_volume'), 1);
  assert.equal(s.get('rush_duration'), DEFAULTS.rush_duration);
  assert.equal(s.get('muted'), false);
});
test('cycle wraps around', () => {
  const s = new Settings();
  assert.equal(s.cycle('throwing_arm', ['auto', 'left', 'right']), 'left');
  assert.equal(s.cycle('throwing_arm', ['auto', 'left', 'right']), 'right');
  assert.equal(s.cycle('throwing_arm', ['auto', 'left', 'right']), 'auto');
});

// ---------------------------------------------------------------------------
section('mouse release model (from tests/test_release_model.py)');
class Drag {
  constructor(start = [0, 0]) {
    this.position = start;
    this.button = false;
    this.mouse = new MouseInput(() => this.position, () => this.button, null, () => 1 / 60);
  }
  frame(x, y, dt = 1 / 60) {
    this.position = [x, y];
    this.mouse._dtProvider = () => dt;
    this.mouse.update();
  }
  stroke(lateralEnd = 0, forward = 0.30, frames = 6, dt = 1 / 60) {
    const [x0, y0] = this.position;
    this.button = true;
    this.frame(x0, y0 - 0.10, dt);
    for (let i = 1; i <= frames; i++) {
      const f = i / frames;
      this.frame(x0 + lateralEnd * f, y0 - 0.10 + (0.10 + forward) * f, dt);
    }
    this.button = false;
    this.frame(x0 + lateralEnd, y0 + forward, dt);
    return this.mouse.throw_data;
  }
}
test('a straight stroke throws straight', () => {
  const t = new Drag().stroke(0);
  assert.ok(t);
  assert.ok(Math.abs(t.launch_angle) < 1e-6);
  assert.ok(t.speed >= config.MIN_THROW_SPEED);
});
test('a leftward stroke releases left and vice versa', () => {
  const left = new Drag().stroke(-0.12);
  const right = new Drag().stroke(0.12);
  assert.ok(left.launch_angle < 0);
  assert.ok(right.launch_angle > 0);
  assert.ok(Math.abs(left.launch_angle) <= rad(config.MAX_LAUNCH_ANGLE) + 1e-9);
});
test('faster strokes throw faster', () => {
  const slow = new Drag().stroke(0, 0.10, 8);
  const fast = new Drag().stroke(0, 0.40, 4);
  assert.ok(fast.speed > slow.speed);
  assert.ok(fast.speed <= config.MAX_THROW_SPEED);
});
test('a twitch does not launch the ball', () => {
  const drag = new Drag();
  drag.button = true;
  drag.frame(0, 0.004);
  drag.button = false;
  drag.frame(0, 0.004);
  assert.equal(drag.mouse.throw_data, null);
});
test('sideways drag sets the hook and reverses with direction', () => {
  const left = new Drag().stroke(-0.12, 0.30, 4);
  const right = new Drag().stroke(0.12, 0.30, 4);
  assert.ok(left.spin_omega * right.spin_omega < 0);
  assert.ok(Math.abs(right.spin_omega) <= config.MAX_SPIN);
});
test('aim helper matches its geometry and clamps', () => {
  const yaw = aimAngle(0.15, 0.0);
  assert.ok(Math.abs(yaw - Math.atan2(0.15, config.AIM_ARROW_Z)) < 1e-9);
  assert.ok(Math.abs(aimAngle(0.50, 0.0) - rad(config.MAX_AIM_ANGLE)) < 1e-9);
});
test('a rightward hook curves the ball right over the lane', () => {
  const t = new Drag().stroke(0.12, 0.30, 4);
  const result = simulateRoll({ speed: t.speed, spin_omega: t.spin_omega }, null, null, null, true);
  assert.ok(result.lateralDrift() > 0.05);
});
test('release noise is off by default and seed-reproducible when on', () => {
  assert.equal(config.RELEASE_NOISE_YAW, 0.0);
  assert.equal(config.RELEASE_NOISE_SPEED, 0.0);
  const a = new ReleaseNoise(7);
  const b = new ReleaseNoise(7);
  a.apply(0, 7, 0); b.apply(0, 7, 0);      // seeds differ; only determinism per instance
  const one = new ReleaseNoise(11).apply(0.1, 7, 0.5);
  const two = new ReleaseNoise(11).apply(0.1, 7, 0.5);
  assert.deepEqual(one, two);
});
test('throw data carries launch conditions only', () => {
  const t = makeThrowData({});
  assert.deepEqual(Object.keys(t).sort(),
    ['confidence', 'launch_angle', 'lateral_position', 'source', 'speed', 'spin_omega'].sort());
});

// ---------------------------------------------------------------------------
section('webcam mapping (from tests/test_release_model.py)');
function swingEvent(kwargs = {}) {
  return new SwingEvent(kwargs.up_speed ?? 2.0, kwargs.body_x ?? 0.5, kwargs.arm ?? 'right',
    kwargs.duration ?? 0.6, 1.0, 0.0, 0.0, 0.0, 0.9, 'wrist',
    kwargs.lateral_speed ?? 0.0, kwargs.hand_offset ?? 0.0);
}
test('swing direction adds a capped release yaw', () => {
  const straight = eventToThrow(swingEvent(), false);
  const left = eventToThrow(swingEvent({ lateral_speed: -0.8 }), false);
  const right = eventToThrow(swingEvent({ lateral_speed: 0.8 }), false);
  assert.ok(Math.abs(straight.launch_angle) < 1e-9);
  assert.ok(left.launch_angle < 0);
  assert.ok(right.launch_angle > 0);
  assert.ok(Math.abs(right.launch_angle) <= rad(config.MAX_LAUNCH_ANGLE) + 1e-9);
});
test('body position sets the start, not the aim', () => {
  const left = eventToThrow(swingEvent({ body_x: 0.2 }), false);
  const right = eventToThrow(swingEvent({ body_x: 0.8 }), false);
  assert.ok(left.lateral_position < right.lateral_position);
  assert.ok(Math.abs(left.launch_angle) < 1e-9);
});
test('swing speed maps into the throw speed band', () => {
  const slow = eventToThrow(swingEvent({ up_speed: 0.6 }), false);
  const fast = eventToThrow(swingEvent({ up_speed: 2.0 }), false);
  assert.ok(slow.speed < fast.speed);
  assert.ok(slow.speed >= config.MIN_THROW_SPEED);
  assert.ok(fast.speed <= config.MAX_THROW_SPEED);
});

// ---------------------------------------------------------------------------
section('swing detector (from tests/test_swing.py)');
function landmark(x, y, visibility = 0.95) { return { x, y, z: 0, visibility }; }
const KEY = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee'];
function poseResult({ rightWristY = 0.62, leftWristY = 0.62, rightWristX = null, leftWristX = null,
                      shoulderY = 0.40, hipY = 0.65, bodyX = 0.5,
                      rightVisibility = 0.95, leftVisibility = 0.95, tracked = true } = {}) {
  if (!tracked) return { landmarks: null, confidence: 0.0, tracked: false, timestamp: 0 };
  const lm = {};
  const put = (n, x, y, v = 0.95) => { lm[n] = landmark(x, y, v); };
  put('left_shoulder', bodyX - 0.12, shoulderY);
  put('right_shoulder', bodyX + 0.12, shoulderY);
  put('left_hip', bodyX - 0.10, hipY);
  put('right_hip', bodyX + 0.10, hipY);
  put('left_knee', bodyX - 0.10, hipY + 0.25);
  put('right_knee', bodyX + 0.10, hipY + 0.25);
  put('left_wrist', leftWristX === null ? bodyX - 0.18 : leftWristX, leftWristY, leftVisibility);
  put('right_wrist', rightWristX === null ? bodyX + 0.18 : rightWristX, rightWristY, rightVisibility);
  let total = 0;
  for (const name of KEY) total += lm[name] ? lm[name].visibility : 0;
  return { landmarks: lm, confidence: total / KEY.length, tracked: true, timestamp: 0 };
}
class SwingScript {
  constructor() { this.detector = new SwingDetector(); this.events = []; }
  feed(result, dt = DT) {
    const e = this.detector.update(result, dt);
    if (e !== null) this.events.push(e);
    return e;
  }
  feedY(y, dt = DT, kwargs = {}) { return this.feed(poseResult({ rightWristY: y, ...kwargs }), dt); }
  holdReady(frames = 12) {
    for (let i = 0; i < frames; i++) this.feedY(0.62);
    return this.detector.phase === PHASE_READY;
  }
  swing() {
    const start = 0.62, deep = 0.90, top = 0.30;
    for (let i = 1; i <= 6; i++) this.feedY(start + (deep - start) * i / 6);
    for (let i = 1; i <= 8; i++) this.feedY(deep + (top - deep) * i / 8);
  }
}
test('holding the ready pose arms the detector', () => {
  const s = new SwingScript();
  assert.equal(s.holdReady(), true);
  assert.equal(s.detector.phase, PHASE_READY);
});
test('a short hold is not enough', () => {
  const s = new SwingScript();
  for (let i = 0; i < 6; i++) s.feedY(0.62);
  assert.equal(s.detector.phase, PHASE_WAITING);
});
test('a full swing emits exactly one event', () => {
  const s = new SwingScript();
  s.holdReady();
  s.swing();
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].arm, 'right');
  assert.equal(s.detector.phase, PHASE_FOLLOW);
});
test('follow-through does not emit a second throw', () => {
  const s = new SwingScript();
  s.holdReady();
  s.swing();
  for (let i = 0; i < 10; i++) s.feedY(0.25);
  assert.equal(s.events.length, 1);
});
test('re-arming requires the ready pose again', () => {
  const s = new SwingScript();
  s.holdReady();
  s.swing();
  assert.equal(s.events.length, 1);
  s.swing();
  assert.equal(s.events.length, 1);
  s.holdReady(40);
  s.swing();
  assert.equal(s.events.length, 2);
});
test('a fast forward stroke from ready throws directly', () => {
  const s = new SwingScript();
  s.holdReady();
  for (const y of [0.58, 0.52, 0.45, 0.38, 0.32, 0.28]) s.feedY(y);
  assert.equal(s.events.length, 1);
  assert.equal(s.detector.phase, PHASE_FOLLOW);
});
test('single-frame spikes never throw', () => {
  const s = new SwingScript();
  s.holdReady();
  s.feedY(0.95);
  for (let i = 0; i < 60; i++) s.feedY(0.62);
  assert.equal(s.events.length, 0);
});
test('tracking loss during the backswing aborts the swing', () => {
  const s = new SwingScript();
  s.holdReady();
  s.feedY(0.75);
  s.feedY(0.85);
  assert.equal(s.detector.phase, PHASE_BACKSWING);
  for (let i = 0; i < 15; i++) s.feed(poseResult({ tracked: false }));
  assert.equal(s.events.length, 0);
  assert.equal(s.detector.phase, PHASE_WAITING);
});
test('leaning and body sway never throw', () => {
  const s = new SwingScript();
  s.holdReady();
  // 90 frames of the player swaying around and shifting weight, arm still
  for (let i = 0; i < 90; i++) {
    const sway = 0.05 * Math.sin(i / 6);
    const crouch = 0.02 * Math.sin(i / 9);
    s.feed(poseResult({ bodyX: 0.5 + sway, shoulderY: 0.40 + crouch, hipY: 0.65 + crouch }));
  }
  assert.equal(s.events.length, 0);
});

// ---------------------------------------------------------------------------
section('webcam tracking service (browser lifecycle)');
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeStream() {
  const track = { kind: 'video', state: 'live', stop() { this.state = 'ended'; } };
  return { tracks: [track], getTracks() { return this.tracks; } };
}

function fakeVideo({ stallPlay = false } = {}) {
  return {
    muted: false, playsInline: false, srcObject: null,
    readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480,
    play() { return stallPlay ? new Promise(() => {}) : Promise.resolve(); },
    advance(dt = 1 / 30) { this.currentTime += dt; },
  };
}

// Installs browser stubs (document/navigator/rAF) for one test and restores
// them afterwards. ``fn`` receives a handle with the mutable stubs.
function withBrowserStubs(fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedDoc = globalThis.document;
  const savedRaf = globalThis.requestAnimationFrame;
  const handle = {
    videoFactory: () => fakeVideo(),
    gum: async () => fakeStream(),
    enumerate: async () => [],
  };
  const mediaDevices = {
    getUserMedia: (...args) => handle.gum(...args),
    enumerateDevices: (...args) => handle.enumerate(...args),
  };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices }, configurable: true, writable: true });
  globalThis.document = { hidden: false, createElement: () => handle.videoFactory() };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 1);
  const restore = () => {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
    else delete globalThis.navigator;
    globalThis.document = savedDoc;
    globalThis.requestAnimationFrame = savedRaf;
  };
  try { return Promise.resolve(fn(handle)).finally(restore); }
  catch (err) { restore(); return Promise.reject(err); }
}

testAsync('camera index setting selects the enumerated device', async () => {
  await withBrowserStubs(async (handle) => {
    handle.enumerate = async () => [
      { kind: 'videoinput', deviceId: 'cam-a' },
      { kind: 'videoinput', deviceId: 'cam-b' },
      { kind: 'audioinput', deviceId: 'mic' },
    ];
    const service = new TrackingService();
    assert.equal(service._preferredIndex, null);
    assert.equal((await service._videoConstraints()).facingMode, 'user');
    service.setPreferredCamera(1);
    assert.deepEqual(await service._videoConstraints(), { deviceId: { exact: 'cam-b' } });
    service.setPreferredCamera(7);          // out of range: default camera
    assert.equal((await service._videoConstraints()).facingMode, 'user');
    service.setPreferredCamera(null);
    assert.equal(service._preferredIndex, null);
  });
});

testAsync('permission denial is reported with recovery guidance', async () => {
  await withBrowserStubs(async (handle) => {
    handle.gum = async () => { const error = new Error('Permission denied'); error.name = 'NotAllowedError'; throw error; };
    const service = new TrackingService();
    await service.start();
    const snap = service.snapshot();
    assert.equal(snap.running, false);
    assert.equal(service.is_running, false);
    assert.match(String(snap.error), /permission denied/i);
    assert.match(String(snap.error), /retry/i);
  });
});

testAsync('a missing getUserMedia explains the secure-context requirement', async () => {
  await withBrowserStubs(async () => {
    delete globalThis.navigator.mediaDevices;
    const service = new TrackingService();
    await service.start();
    assert.equal(service.snapshot().running, false);
    assert.match(String(service.snapshot().error), /https|localhost|secure/i);
  });
});

testAsync('a camera that opens but never delivers frames times out', async () => {
  await withBrowserStubs(async (handle) => {
    const stream = fakeStream();
    handle.gum = async () => stream;
    handle.videoFactory = () => fakeVideo({ stallPlay: true });
    const service = new TrackingService({ frame_timeout_ms: 120 });
    await service.start();
    const snap = service.snapshot();
    assert.equal(snap.running, false);
    assert.match(String(snap.error), /no frames/i);
    assert.equal(stream.tracks[0].state, 'ended', 'the camera stream is released');
  });
});

testAsync('stop() during start() releases the camera and never starts tracking', async () => {
  await withBrowserStubs(async (handle) => {
    const stream = fakeStream();
    let answer = null;
    handle.gum = () => new Promise((resolve) => { answer = resolve; });
    let trackerLoads = 0;
    const service = new TrackingService();
    service._loadLandmarker = async () => { trackerLoads += 1; return { close() {} }; };
    const starting = service.start();
    await sleepMs(5);                 // start() is now awaiting the camera
    await service.stop();             // the player leaves webcam mode
    answer(stream);                   // the late permission answer arrives
    await starting;
    assert.equal(trackerLoads, 0, 'no pose tracker may be created after stop');
    assert.equal(service.is_running, false);
    assert.equal(service._stream, null);
    assert.equal(stream.tracks[0].state, 'ended', 'the late camera stream is released');
  });
});

testAsync('restart after a failure really restarts and processes frames', async () => {
  await withBrowserStubs(async (handle) => {
    const service = new TrackingService({ stall_timeout_ms: 60000 });
    let failFirst = true;
    handle.gum = async () => {
      if (failFirst) { failFirst = false; throw new Error('device busy'); }
      return fakeStream();
    };
    service._loadLandmarker = async () => {
      service._delegate = 'GPU';
      return { detectForVideo: (video) => { video.advance(); return { landmarks: [] }; }, close() {} };
    };
    await service.start();
    assert.equal(service.snapshot().running, false, 'first attempt failed');
    assert.match(String(service.snapshot().error), /device busy/);
    await service.start();            // retry
    assert.equal(service.is_running, true);
    await sleepMs(60);
    assert.ok(service.snapshot().frame_count > 1, 'frames are processed after the retry');
    assert.equal(service.snapshot().tracked, false);
    await service.stop();
    assert.equal(service.is_running, false);
  });
});

testAsync('a camera that stops delivering frames mid-session reports a stall', async () => {
  await withBrowserStubs(async (handle) => {
    const service = new TrackingService({ stall_timeout_ms: 150, frame_timeout_ms: 5000 });
    handle.gum = async () => fakeStream();
    let frames = 0;
    service._loadLandmarker = async () => {
      service._delegate = 'GPU';
      return {
        detectForVideo: (video) => { frames += 1; if (frames < 3) video.advance(); return { landmarks: [] }; },
        close() {},
      };
    };
    await service.start();
    assert.equal(service.is_running, true);
    await sleepMs(500);
    assert.equal(service.is_running, false);
    assert.match(String(service.snapshot().error), /stopped delivering frames/i);
  });
});

testAsync('a GPU detection failure rebuilds once on the CPU delegate', async () => {
  await withBrowserStubs(async (handle) => {
    const service = new TrackingService({ stall_timeout_ms: 60000 });
    const built = [];
    handle.gum = async () => fakeStream();
    service._loadLandmarker = async (options = {}) => {
      const delegate = options.delegate || 'GPU';
      service._delegate = delegate;
      built.push(delegate);
      return delegate === 'GPU'
        ? { detectForVideo: (video) => { video.advance(); throw new Error('WebGL context lost'); }, close() {} }
        : { detectForVideo: (video) => { video.advance(); return { landmarks: [] }; }, close() {} };
    };
    await service.start();
    await sleepMs(80);
    assert.deepEqual(built, ['GPU', 'CPU']);
    assert.equal(service._delegate, 'CPU');
    assert.ok(service.snapshot().frame_count > 0, 'CPU frames are processed');
    await service.stop();
  });
});

testAsync('switching the throwing arm clears swing history without a throw', async () => {
  await withBrowserStubs(async () => {
    const service = {
      _snapshot: { running: true, tracked: true, confidence: 0.9, landmarks: {}, fps: 30, frame_count: 0, error: null, message: 'tracking' },
      is_running: true,
      _frameTime: 0.0,
      snapshot() { return this._snapshot; },
      async start() { this.is_running = true; },
      async stop() { this.is_running = false; },
      setPreferredCamera() {},
      publish(landmarks) {
        // One camera frame per call, 1/30 s apart: the snapshot carries the
        // frame's own timestamp, which is what now drives the detector's dt.
        this._frameTime += DT;
        this._snapshot = {
          ...this._snapshot, tracked: true, confidence: 0.9, landmarks,
          frame_count: this._snapshot.frame_count + 1, frame_time: this._frameTime,
        };
      },
    };
    const input = new WebcamInput(service, new SwingClassifier());
    input.setGameReady(true);
    const step = (landmarks) => {
      service.publish(landmarks);
      input.update();
    };
    // ready pose, then part-way into a backswing on the default arm
    for (let i = 0; i < 12; i++) step(poseResult({}).landmarks);
    for (const y of [0.66, 0.72, 0.78]) step(poseResult({ rightWristY: y }).landmarks);
    assert.equal(input._classifier.phase, STATE_BACKSWING);
    input.setPreferredArm('left');
    assert.equal(input.preferred_arm, 'left');
    assert.equal(input._classifier.phase, STATE_TRACKING);
    assert.equal(input.throw_data, null, 'the interrupted swing must not queue a throw');
  });
});

// ---------------------------------------------------------------------------
section('webcam real-landmark fixtures (recorded MediaPipe traces)');
function loadWebcamFixture(name) {
  const path = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;
}
function feedFixture(fixture, detector) {
  const names = fixture.landmarks;
  const n = names.length;
  const dt = 1 / (fixture.fps || 30);   // the Python reference used the video's own fps
  const events = [];
  const runs = [];
  fixture.frames.forEach((entry, frame) => {
    let result;
    if (!entry.t || !entry.l) {
      result = { landmarks: null, confidence: 0.0, tracked: false, timestamp: 0 };
    } else {
      const lm = {};
      for (let i = 0; i < n; i++) {
        const x = entry.l[i];
        if (x === null) continue;
        lm[names[i]] = { x, y: entry.l[n + i], z: 0, visibility: entry.l[2 * n + i] };
      }
      result = { landmarks: lm, confidence: entry.c, tracked: true, timestamp: 0 };
    }
    const event = detector.update(result, dt);
    if (event !== null) events.push({ frame, event });
    if (!runs.length || runs[lastRunIndex(runs)].phase !== detector.phase) {
      runs.push({ phase: detector.phase, from: frame });
    }
  });
  return { events, runs };
}
function lastRunIndex(runs) { return runs.length - 1; }

// IMPORTANT: tools/webcam_landmarks.json is *exercise footage* (Wikimedia
// "Jumping jacks and burpees" by Taco fleur), not a genuine arm swing. The
// fixture was previously mislabelled as a recorded swing, and its false
// release became the Python/JavaScript parity reference - the exact mistake
// this overhaul fixes. The legacy detector's reference behaviour is kept as a
// parity contract below; the temporal classifier must reject the same trace
// (tested in the classification section with the real WebcamInput).
const swingFixture = loadWebcamFixture('webcam_landmarks.json');
if (swingFixture) {
  test('the legacy phase machine reproduces its Python reference on the recorded exercise footage', () => {
    const detector = new SwingDetector();
    const { events, runs } = feedFixture(swingFixture, detector);
    const reference = swingFixture.reference;
    assert.equal(events.length, reference.releases.length, 'release count matches the Python reference');
    assert.equal(events.length, 1, 'the exercise footage triggers exactly one legacy release');
    const ref = reference.releases[0];
    assert.ok(Math.abs(events[0].frame - ref.frame) <= 1, `release frame ${events[0].frame} vs reference ${ref.frame}`);
    assert.equal(events[0].event.arm, ref.arm, 'throwing arm');
    assert.ok(Math.abs(events[0].event.up_speed - ref.up_speed) < 0.01, 'peak hand speed');
    assert.ok(Math.abs(events[0].event.rise - ref.rise) < 0.01, 'hand rise');
    assert.deepEqual(runs.map((r) => r.phase), reference.phase_runs.map((r) => r[0]), 'phase sequence');
    assert.deepEqual(runs.map((r) => r.from), reference.phase_runs.map((r) => r[1]), 'phase frames');
  });
} else {
  console.log('  (tools/webcam_landmarks.json missing; run python tools/export_landmarks.py first)');
}

const waveFixture = loadWebcamFixture('webcam_wave_landmarks.json');
if (waveFixture) {
  test('real people waving at the camera never produce a throw', () => {
    const detector = new SwingDetector();
    const { events, runs } = feedFixture(waveFixture, detector);
    assert.equal(events.length, 0);
    assert.equal(detector.release_count, 0);
    assert.deepEqual(runs.map((r) => r.phase), ['waiting'], 'waving must not even arm the ready pose');
  });
} else {
  console.log('  (tools/webcam_wave_landmarks.json missing; run python tools/export_landmarks.py first)');
}

// ---------------------------------------------------------------------------
section('webcam python parity (tools/webcam_parity_py.json)');
// The Python reference dump (tools/webcam_parity_dump.py) records, per frame:
// the smoothed hand offsets, both velocities, the lateral velocity, the hand
// source, the phase, the release decisions and the final ThrowData. Replaying
// it here proves the browser pipeline is the same pipeline, frame by frame -
// the webcam counterpart of the physics fidelity diff.
const parityPath = fileURLToPath(new URL('./webcam_parity_py.json', import.meta.url));
if (fs.existsSync(parityPath)) {
  const parity = JSON.parse(fs.readFileSync(parityPath, 'utf8'));
  function parityPose(entry, names) {
    if (!entry) return { landmarks: null, confidence: 0.0, tracked: false, timestamp: 0 };
    const lm = {};
    entry.forEach((values, index) => {
      if (!values) return;
      lm[names[index]] = { x: values[0], y: values[1], z: 0, visibility: values[2] };
    });
    let total = 0;
    for (const name of KEY) total += lm[name] ? lm[name].visibility : 0;
    return { landmarks: lm, confidence: total / KEY.length, tracked: true, timestamp: 0 };
  }
  function parityClose(a, b, tol = 1e-9) {
    if (a === null || a === undefined || b === null || b === undefined) return a === b;
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  test('the browser detector reproduces the Python reference exactly', () => {
    const mismatches = [];
    for (const [name, sequence] of Object.entries(parity.sequences)) {
      const detector = new SwingDetector();
      const dt = 1.0 / (sequence.fps || 30.0);
      let frame = 0;
      const events = [];
      sequence.landmarks.forEach((entry, index) => {
        frame = index;
        const event = detector.update(parityPose(entry, parity.landmarks), dt);
        const ref = sequence.trace[index];
        if (!parityClose(detector._time, ref.t)) mismatches.push(`${name} f${index} time`);
        const depth = detector._swing_arm !== null && detector._torso_height > 0
          ? Math.max(0.0, (detector._backswing_deepest_rel - detector._swing_start_rel) / detector._torso_height)
          : 0.0;
        if (!parityClose(depth, ref.depth, 1e-6)) mismatches.push(`${name} f${index} depth`);
        if (detector.phase !== ref.phase) mismatches.push(`${name} f${index} phase ${detector.phase} vs ${ref.phase}`);
        if ((detector._swing_arm || null) !== (ref.arm || null)) mismatches.push(`${name} f${index} arm`);
        if (!parityClose(detector._rise, ref.rise)) mismatches.push(`${name} f${index} rise`);
        if (!parityClose(detector._peak_up_speed, ref.peak)) mismatches.push(`${name} f${index} peak`);
        if (!parityClose(detector.swing_pose, ref.pose)) mismatches.push(`${name} f${index} pose`);
        for (const arm of ['right', 'left']) {
          const a = detector._smooth[arm];
          const b = ref.arms[arm];
          if ((a === null) !== (b.sx === null)) mismatches.push(`${name} f${index} ${arm} presence`);
          const fields = [['vel', detector._vel[arm], b.vel], ['raw', detector._raw_vel[arm], b.raw],
            ['lat', detector._lateral_vel[arm], b.lat]];
          for (const [field, value, wanted] of fields) {
            if (!parityClose(value, wanted)) mismatches.push(`${name} f${index} ${arm}.${field} ${value} vs ${wanted}`);
          }
          if (detector._hand_source[arm] !== b.src) mismatches.push(`${name} f${index} ${arm}.src`);
        }
        if (event !== null) events.push({ frame: index, event });
      });
      assert.equal(events.length, sequence.events.length, `${name}: release count`);
      events.forEach((entry, index) => {
        const ref = sequence.events[index];
        assert.ok(Math.abs(entry.frame - ref.frame) <= 1, `${name}: release frame`);
        assert.equal(entry.event.arm, ref.arm, `${name}: arm`);
        for (const field of ['up_speed', 'lateral_speed', 'hand_offset', 'rise', 'depth']) {
          assert.ok(parityClose(entry.event[field], ref[field]),
            `${name}: ${field} ${entry.event[field]} vs ${ref[field]}`);
        }
        const throwData = eventToThrow(entry.event);
        const refThrow = sequence.throws[index];
        for (const field of ['speed', 'lateral_position', 'launch_angle', 'spin_omega']) {
          assert.ok(parityClose(throwData[field], refThrow[field]),
            `${name}: throw ${field} ${throwData[field]} vs ${refThrow[field]}`);
        }
      });
      assert.ok(mismatches.length === 0, mismatches.slice(0, 5).join(' | '));
    }
  });
  test('the synthetic sequences cover the acceptance cases', () => {
    const sequences = parity.sequences;
    for (const name of ['still', 'lean', 'walk', 'wave']) {
      assert.equal(sequences[name].events.length, 0, `${name} must not release`);
    }
    for (const name of ['swing_straight', 'swing_slow', 'swing_fast', 'swing_hook_left',
      'swing_hook_right', 'swing_short', 'occlusion']) {
      assert.equal(sequences[name].events.length, 1, `${name} must release once`);
    }
    assert.equal(sequences.tracking_lost.events.length, 0);
    assert.equal(sequences.repeated.events.length, 3);
    assert.equal(sequences.arm_switch.events.length, 2);
    assert.equal(sequences.arm_switch.events[0].arm, 'right');
    assert.equal(sequences.arm_switch.events[1].arm, 'left');
  });
  test('hook direction and swing intensity reach the throw parameters', () => {
    const left = parity.sequences.swing_hook_left.throws[0];
    const right = parity.sequences.swing_hook_right.throws[0];
    const straight = parity.sequences.swing_straight.throws[0];
    assert.ok(Math.abs(straight.spin_omega) < 1e-9, 'a straight release spins nothing');
    assert.ok(left.spin_omega < 0 && right.spin_omega > 0, 'opposite hooks');
    assert.ok(left.launch_angle > 0 && right.launch_angle < 0, 'opposite release yaw');
    const slow = parity.sequences.swing_slow.throws[0];
    const fast = parity.sequences.swing_fast.throws[0];
    assert.ok(fast.speed > slow.speed, 'a harder swing throws faster');
  });
} else {
  console.log('  (tools/webcam_parity_py.json missing; run python tools/webcam_parity_dump.py)');
}

// ---------------------------------------------------------------------------
section('webcam tracking service (frame pacing and pose engines)');
testAsync('the classifier is stepped with camera frame times, not render frames', async () => {
  await withBrowserStubs(async () => {
    const service = {
      _snapshot: { running: true, tracked: true, confidence: 0.9, landmarks: {}, fps: 25,
        frame_count: 0, error: null, message: 'tracking', frame_time: null },
      is_running: true,
      snapshot() { return this._snapshot; },
      async start() {}, async stop() {}, setPreferredCamera() {},
      publish(landmarks, frameTime) {
        this._snapshot = { ...this._snapshot, landmarks, frame_time: frameTime,
          frame_count: this._snapshot.frame_count + 1 };
      },
    };
    const input = new WebcamInput(service, new SwingClassifier());
    input.setGameReady(true);
    service.publish(poseResult({ rightWristY: 0.60 }).landmarks, 1.0);
    input.update();
    service.publish(poseResult({ rightWristY: 0.66 }).landmarks, 1.1);   // 100 ms later
    input.update();
    const classifier = input._classifier;
    // The classifier stores hand offsets relative to the shoulders in torso
    // heights (y grows downward; this motion is downward). The first frame
    // establishes the baseline; the second smooths with
    // CLASSIFIER_POSITION_SMOOTHING (0.55), differentiated over the measured
    // 100 ms camera gap; the velocity is EMA-smoothed (0.45):
    //   rel = (wristY - shoulderY) / torso
    const torso = 0.25;
    const rel1 = (0.60 - 0.40) / torso;
    const rel2 = (0.66 - 0.40) / torso;
    const smoothed = 0.55 * rel2 + 0.45 * rel1;
    const raw = (smoothed - rel1) / 0.1;
    assert.ok(Math.abs(classifier._vel.right.y - 0.45 * raw) < 1e-9,
      `smoothed velocity must use the 100 ms camera gap, got ${classifier._vel.right.y}`);
    assert.ok(Math.abs(classifier._vel.right.y - 0.45 * (smoothed - rel1) / (1 / 60)) > 1e-3,
      'a render-rate assumption would differ');
  });
});

testAsync('a worker engine publishes frames and reports its delegate', async () => {
  await withBrowserStubs(async (handle) => {
    const savedBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => ({ close() {} });
    try {
      const service = new TrackingService({ stall_timeout_ms: 60000 });
      const video = handle.videoFactory();
      let posted = 0;
      service._workerFactory = () => ({
        onmessage: null, onerror: null,
        postMessage(message) {
          if (message.type === 'init') {
            setTimeout(() => this.onmessage && this.onmessage({ data: { type: 'ready', delegate: 'GPU' } }), 1);
          } else if (message.type === 'frame') {
            posted += 1;
            video.advance(1 / 30);
            const timestamp = message.timestamp;
            setTimeout(() => this.onmessage && this.onmessage({
              data: { type: 'result', timestamp, inferMs: 4, landmarks: [] },
            }), 1);
          }
        },
        terminate() { this.terminated = true; },
      });
      handle.videoFactory = () => video;
      service._useWorker = true;
      await service.start();
      assert.equal(service.snapshot().worker, true, 'the worker engine is used');
      assert.equal(service.snapshot().delegate, 'GPU (worker)');
      await sleepMs(80);
      assert.ok(posted > 1, `frames were posted to the worker (${posted})`);
      assert.ok(service.snapshot().frame_count > 1, 'results were published to the snapshot');
      assert.ok(Number.isFinite(service.snapshot().frame_time), 'snapshots carry the frame time');
      await service.stop();
    } finally {
      if (savedBitmap === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = savedBitmap;
    }
  });
});

testAsync('a worker that dies falls back to the main-thread engine', async () => {
  await withBrowserStubs(async (handle) => {
    const savedBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => ({ close() {} });
    try {
      const service = new TrackingService({ stall_timeout_ms: 60000 });
      service._workerFactory = () => ({
        onmessage: null, onerror: null,
        postMessage(message) {
          if (message.type === 'init') {
            setTimeout(() => this.onmessage && this.onmessage({ data: { type: 'ready', delegate: 'CPU' } }), 1);
          } else if (message.type === 'frame') {
            // the engine dies mid-session
            setTimeout(() => this.onerror && this.onerror({ message: 'worker died' }), 1);
          }
        },
        terminate() {},
      });
      let mainStarted = false;
      service._loadLandmarker = async () => {
        mainStarted = true;
        service._delegate = 'CPU';
        return { detectForVideo: (video) => { video.advance(1 / 30); return { landmarks: [] }; }, close() {} };
      };
      await service.start();
      assert.equal(service.snapshot().worker, true);
      await sleepMs(120);
      assert.equal(mainStarted, true, 'the main-thread engine took over');
      assert.equal(service.snapshot().worker, false);
      assert.ok(service.snapshot().frame_count > 1, 'frames are still processed');
      assert.match(String(service.snapshot().engine_fallback), /worker died/);
      await service.stop();
    } finally {
      if (savedBitmap === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = savedBitmap;
    }
  });
});

test('webcam power follows the swing progress, never a stale peak', () => {
  const service = {
    _snapshot: { running: true, tracked: true, confidence: 0.9, landmarks: {}, fps: 30, frame_count: 0, error: null, message: 'tracking' },
    is_running: true,
    snapshot() { return this._snapshot; },
    async start() {}, async stop() {}, setPreferredCamera() {},
  };
  const input = new WebcamInput(service, new SwingClassifier());
  const classifier = input._classifier;
  // Outside a swing the meter is empty even if the hand is high.
  classifier._smooth.right = { x: 0.0, y: -0.25 };
  assert.equal(input.power, 0.0);
  // In the forward stroke the meter follows the measured rise toward the
  // release; the peak speed is not used directly.
  classifier.phase = STATE_FORWARD;
  classifier._swing_arm = 'right';
  classifier._stroke_min_height = -1.0;
  classifier._smooth.right = { x: 0.0, y: 0.73 };    // hand at -0.73, rise = 0.27
  const midPower = input.power;
  assert.ok(midPower > 0.5 && midPower < 1.0, String(midPower));
  assert.equal(input.releaseEligible, true);
  classifier._smooth.right = { x: 0.0, y: 0.8 };     // hand at -0.80, rise = 0.20
  assert.ok(input.power < midPower, 'a smaller rise must not read as more power');
  // Released (or followed through) the meter reads full.
  classifier.phase = STATE_RELEASE;
  assert.equal(input.power, 1.0);
});

// ---------------------------------------------------------------------------
section('webcam temporal classification (no accidental releases)');
// The legacy phase machine in src/input/swing.js is a sensitive *motion*
// sensor and remains a parity-tested module, but it is no longer the release
// authority: WebcamInput drives src/input/classifier.js, which recognizes the
// whole sequence tracking -> ready -> backswing -> forward -> release and
// refuses anything that does not complete it. Fixtures marked "recorded" are
// real MediaPipe traces of a real person from tools/testdata (negative
// motions: exercise and waving); everything else here is synthetic landmark
// sequences. No camera or human is involved in this file.
function webcamHarness() {
  const service = {
    _snapshot: {
      running: true, tracked: true, confidence: 0.95, landmarks: {}, fps: 30,
      frame_count: 0, error: null, message: 'tracking', frame_time: null,
      session: 1, lost_frames: 0,
    },
    is_running: true,
    _time: 0,
    snapshot() { return this._snapshot; },
    async start() { this.is_running = true; },
    async stop() { this.is_running = false; },
    setPreferredCamera() {},
    publish(landmarks, opts = {}) {
      this._time += (opts.dt === undefined ? 1.0 / 30.0 : opts.dt);
      const tracked = opts.tracked === undefined ? true : !!opts.tracked;
      this._snapshot = {
        ...this._snapshot,
        tracked,
        confidence: opts.confidence === undefined ? 0.95 : opts.confidence,
        landmarks: tracked ? (landmarks || {}) : {},
        frame_count: this._snapshot.frame_count + 1,
        frame_time: opts.frameTime === undefined ? this._time : opts.frameTime,
        session: opts.session === undefined ? this._snapshot.session : opts.session,
      };
    },
    restartSession() {
      this._snapshot = {
        ...this._snapshot, session: this._snapshot.session + 1,
        frame_count: 0, frame_time: null,
      };
    },
  };
  const input = new WebcamInput(service, new SwingClassifier());
  input.setGameReady(true);
  const step = (landmarks, opts) => { service.publish(landmarks, opts); input.update(); };
  const stepPose = (poseOpts = {}, opts = {}) => step(poseResult(poseOpts).landmarks, opts);
  const drain = () => {
    const throws = [];
    for (;;) { const data = input.throw_data; if (!data) break; throws.push(data); }
    return throws;
  };
  // A complete, deliberate bowling swing: still ready hold, visible backswing,
  // sustained forward/up delivery. `arm` selects which wrist travels; `hook`
  // drifts the throwing wrist sideways during the delivery.
  const swing = ({ ready = 30, back = 6, forward = 9, start = 0.62, deep = 0.90,
                   top = 0.30, arm = 'right', hook = 0.0 } = {}) => {
    const pose = (y, x) => (arm === 'right'
      ? { rightWristY: y, rightWristX: x }
      : { leftWristY: y, leftWristX: x });
    for (let i = 0; i < ready; i++) stepPose(pose(start, null));
    for (let i = 1; i <= back; i++) stepPose(pose(start + (deep - start) * i / back, null));
    for (let i = 1; i <= forward; i++) {
      const f = i / forward;
      stepPose(pose(deep + (top - deep) * f, hook === 0 ? null : 0.5 + (arm === 'right' ? 1 : -1) * hook * f));
    }
  };
  return { service, input, step, stepPose, drain, swing };
}

test('a deliberate full swing releases exactly one throw', () => {
  const h = webcamHarness();
  h.swing();
  const throws = h.drain();
  assert.equal(throws.length, 1, 'exactly one throw');
  assert.equal(throws[0].source, 'webcam');
  assert.ok(throws[0].speed >= config.MIN_THROW_SPEED && throws[0].speed <= config.MAX_THROW_SPEED);
  assert.equal(h.input._classifier.release_count, 1);
  assert.equal(h.input._classifier.blocked_count, 0);
});

// The common real-world delivery: no separate wind-up, the arm just rises
// forward and up from the settled ready pose. Real players bowl this way
// (see the recorded swing log in the repository history) and the detector
// must accept it, with a higher bar on the rise than a wind-up delivery.
test('a direct forward swing from the ready pose releases (no wind-up)', () => {
  const h = webcamHarness();
  for (let i = 0; i < 30; i++) h.stepPose({});
  for (let i = 1; i <= 14; i++) h.stepPose({ rightWristY: 0.62 - 0.30 * i / 14 });
  const throws = h.drain();
  assert.equal(throws.length, 1, 'a no-wind-up delivery must release');
  assert.equal(h.input._classifier.release_count, 1);
  assert.equal(h.input._classifier.blocked_count, 0);
});

test('the left arm can throw a direct delivery', () => {
  const h = webcamHarness();
  for (let i = 0; i < 30; i++) h.stepPose({});
  for (let i = 1; i <= 14; i++) h.stepPose({ leftWristY: 0.62 - 0.30 * i / 14 });
  const throws = h.drain();
  assert.equal(throws.length, 1);
  assert.equal(h.input._classifier.release_count, 1);
});

// The shallow wind-up from the real recorded session: a fast, small downward
// drift (0.3-0.4 torso/s, a few centimetres deep) reverses immediately into
// the forward swing. It must not be stuck waiting for a deep backswing.
test('a shallow fast wind-up followed by a forward swing releases', () => {
  const h = webcamHarness();
  for (let i = 0; i < 30; i++) h.stepPose({});
  for (const y of [0.635, 0.65, 0.66, 0.67]) h.stepPose({ rightWristY: y });
  for (let i = 1; i <= 14; i++) h.stepPose({ rightWristY: 0.67 - 0.37 * i / 14 });
  const throws = h.drain();
  assert.equal(throws.length, 1, 'a short wind-up must still release');
  assert.equal(h.input._classifier.blocked_count, 0);
});

test('a second deliberate swing after the ready pose releases a second throw', () => {
  const h = webcamHarness();
  h.swing();
  assert.equal(h.drain().length, 1);
  h.swing();
  const second = h.drain();
  assert.equal(second.length, 1, 'one throw per swing');
  assert.equal(h.input._classifier.release_count, 2);
});

test('standing still never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 120; i++) h.stepPose({});
  assert.equal(h.drain().length, 0);
});

test('normal idle sway with the arms down never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 120; i++) {
    const sway = 0.02 * Math.sin(i / 7);
    h.stepPose({ bodyX: 0.5 + sway, rightWristY: 0.62 + sway, leftWristY: 0.62 + sway });
  }
  assert.equal(h.drain().length, 0);
});

test('a natural arm repositioning (slow raise) never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 40; i++) h.stepPose({});
  // A casual reposition is slow: the hand drifts up over ~1.5 s, well under
  // the forward-stroke speed a delivery needs. (A *fast* upward stroke from
  // the ready pose is a delivery by design - see the direct-throw tests.)
  for (let i = 1; i <= 45; i++) h.stepPose({ rightWristY: 0.62 - 0.22 * i / 45 });
  for (let i = 0; i < 20; i++) h.stepPose({ rightWristY: 0.40 });
  assert.equal(h.drain().length, 0, 'a slow raise must never throw');
  assert.equal(h.input._classifier.release_count, 0);
});

test('slow waving (hands above the ready band) never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 90; i++) {
    const y = 0.44 + 0.04 * Math.sin(i / 5);
    h.stepPose({ rightWristY: y, leftWristY: y });
  }
  assert.ok(![STATE_FORWARD, STATE_RELEASE].includes(h.input._classifier.phase));
  assert.equal(h.drain().length, 0);
});

test('fast waving never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 90; i++) {
    const y = 0.44 + 0.08 * Math.sin(i * 0.9);
    h.stepPose({ rightWristY: y, leftWristY: y });
  }
  assert.equal(h.drain().length, 0);
});

test('torso leaning and swaying with the arms down never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 120; i++) {
    const sway = 0.06 * Math.sin(i / 6);
    const crouch = 0.02 * Math.sin(i / 9);
    h.stepPose({ bodyX: 0.5 + sway, shoulderY: 0.40 + crouch, hipY: 0.65 + crouch });
  }
  assert.equal(h.drain().length, 0);
});

test('walking and stepping across the frame never throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 120; i++) {
    const bodyX = 0.5 + 0.22 * Math.sin(i / 12);
    const bob = 0.012 * Math.sin(i / 4);
    h.stepPose({ bodyX, shoulderY: 0.40 + bob, hipY: 0.65 + bob });
  }
  assert.equal(h.drain().length, 0);
});

test('a single landmark jump mid-swing is resynced, not fatal', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  h.stepPose({ rightWristY: 0.70 });
  h.stepPose({ rightWristY: 0.78 });
  h.stepPose({ rightWristY: 1.20 });        // teleporting wrist (one bad frame)
  for (let i = 1; i <= 8; i++) h.stepPose({ rightWristY: 0.88 - 0.6 * i / 8 });
  assert.equal(h.drain().length, 1, 'one glitch frame must not cancel a real swing');
  assert.ok(h.input._classifier.rejected_count >= 1, 'the jump was still recorded as rejected');
});

test('two landmark jumps in one swing abort it', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  h.stepPose({ rightWristY: 0.70 });
  h.stepPose({ rightWristY: 0.78 });
  h.stepPose({ rightWristY: 1.20 });        // teleporting wrist
  h.stepPose({ rightWristY: 0.05 });        // and again, a moment later
  for (let i = 1; i <= 8; i++) h.stepPose({ rightWristY: 0.88 - 0.6 * i / 8 });
  assert.equal(h.drain().length, 0, 'repeated teleports must not stitch into a throw');
  assert.ok(h.input._classifier.abort_count >= 1, 'the second jump aborted the swing');
  assert.ok(h.input._classifier.rejected_count >= 2, 'both jumps were counted');
});

test('low-confidence frames during the swing never release', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 6; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  for (let i = 1; i <= 9; i++) {
    const low = i >= 4 && i <= 6;
    h.stepPose({ rightWristY: 0.90 - 0.6 * i / 9 },
      low ? { confidence: 0.2 } : {});
  }
  assert.equal(h.drain().length, 0);
});

test('hips dropping out of frame mid-swing do not cancel the throw', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 6; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  for (let i = 1; i <= 9; i++) {
    const result = poseResult({ rightWristY: 0.90 - 0.6 * i / 9 });
    if (i >= 4 && i <= 6) { delete result.landmarks.left_hip; delete result.landmarks.right_hip; }
    h.step(result.landmarks);
  }
  assert.equal(h.drain().length, 1, 'a hip dropout must be carried by the last-good scale');
});

test('a long landmark outage during the swing never releases', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 6; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  for (let i = 1; i <= 9; i++) {
    const result = poseResult({ rightWristY: 0.90 - 0.6 * i / 9 });
    if (i >= 4 && i <= 11) {
      delete result.landmarks.left_shoulder; delete result.landmarks.right_shoulder;
    }
    h.step(result.landmarks);
  }
  assert.equal(h.drain().length, 0, 'without the torso anchor nothing may release');
});

test('a brief tracking dropout mid-swing is bridged', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 6; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  for (let i = 1; i <= 9; i++) {
    if (i === 4) { for (let k = 0; k < 3; k++) h.step(null, { tracked: false, confidence: 0 }); }
    h.stepPose({ rightWristY: 0.90 - 0.6 * i / 9 });
  }
  assert.equal(h.drain().length, 1, 'a short dropout must not cancel a real swing');
  assert.equal(h.input._classifier.abort_count, 0);
});

test('a sustained tracking loss during a swing never releases', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 6; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  for (let i = 1; i <= 9; i++) {
    if (i === 5) { for (let k = 0; k < 8; k++) h.step(null, { tracked: false, confidence: 0 }); }
    h.stepPose({ rightWristY: 0.90 - 0.6 * i / 9 });
  }
  assert.equal(h.drain().length, 0, 'a release must never follow a long tracking gap');
  assert.ok(h.input._classifier.abort_count >= 1, 'the interrupted release was aborted');
});

test('tracking loss followed by recovery still allows a fresh deliberate swing', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let k = 0; k < 20; k++) h.step(null, { tracked: false, confidence: 0 });
  h.swing();
  assert.equal(h.drain().length, 1, 'recovery must not disable webcam bowling');
});

test('stale or repeated camera frames are never a release source', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  const frozen = h.service._snapshot.frame_time;
  for (let k = 0; k < 2; k++) h.stepPose({ rightWristY: 0.66 }, { frameTime: frozen });
  assert.ok(h.input._stale_frames >= 2, 'stale frames are detected and skipped');
  h.stepPose({ rightWristY: 0.66 }, { frameTime: frozen - 0.01 });   // rewound
  assert.ok(h.input._stale_frames >= 3, 'a rewound timestamp is stale too');
  h.swing();
  assert.equal(h.drain().length, 1, 'a fresh swing after the stale frames still works');
});

test('a run of stale frames mid-swing cancels the swing', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 4; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  const frozen = h.service._snapshot.frame_time;
  for (let k = 0; k < 5; k++) h.stepPose({ rightWristY: 0.85 }, { frameTime: frozen });
  assert.equal(h.input._classifier.phase, STATE_TRACKING, 'the incomplete swing was reset');
  assert.equal(h.drain().length, 0);
});

test('a camera restart mid-swing never inherits the incomplete swing', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 4; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  assert.equal(h.input._classifier.phase, STATE_BACKSWING);
  h.service.restartSession();
  h.stepPose({});
  assert.equal(h.input._classifier.phase, STATE_TRACKING);
  assert.equal(h.drain().length, 0);
  h.swing();
  assert.equal(h.drain().length, 1, 'a complete swing on the new session works');
});

testAsync('stopping and restarting the camera input clears the swing', async () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 4; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  assert.equal(h.input._classifier.phase, STATE_BACKSWING);
  await h.input.stop();
  await h.input.start();
  h.service._snapshot = { ...h.service._snapshot, running: true, tracked: true };
  assert.equal(h.input._classifier.phase, STATE_TRACKING);
  h.swing();
  assert.equal(h.drain().length, 1);
});

test('switching the preferred arm mid-session clears the swing and the new arm throws', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  for (let i = 1; i <= 4; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  assert.equal(h.input._classifier.phase, STATE_BACKSWING);
  h.input.setPreferredArm('left');
  assert.equal(h.input._classifier.phase, STATE_TRACKING);
  h.swing({ arm: 'left' });
  assert.equal(h.drain().length, 1, 'the selected left arm throws');
  assert.equal(h.input._classifier.release_count, 1);
});

test('returning from mouse mode to webcam mode does not inherit a swing', () => {
  const h = webcamHarness();
  for (let i = 0; i < 12; i++) h.stepPose({});
  h.input.setGameReady(false);               // TAB to mouse, mid-ready
  h.stepPose({ rightWristY: 0.80 });         // motion while mouse mode owns input
  h.input.setGameReady(true);                // TAB back to webcam
  h.stepPose({ rightWristY: 0.30 });         // continuing motion with no fresh hold
  assert.equal(h.drain().length, 0);
  h.swing();
  assert.equal(h.drain().length, 1, 'a fresh swing after re-entering webcam mode works');
});

test('a duplicate acceptance from one physical swing is impossible', () => {
  const h = webcamHarness();
  h.swing();
  assert.equal(h.drain().length, 1);
  // The same motion again, with no ready hold in between: one physical swing
  // must launch at most one ball, and the machine must re-arm first.
  for (let i = 1; i <= 6; i++) h.stepPose({ rightWristY: 0.62 + 0.28 * i / 6 });
  for (let i = 1; i <= 9; i++) h.stepPose({ rightWristY: 0.90 - 0.6 * i / 9 });
  assert.equal(h.drain().length, 0, 'no second throw without re-arming');
  assert.equal(h.input._classifier.release_count, 1);
});

test('a leftward hook and a rightward hook keep their opposite spin', () => {
  const left = webcamHarness();
  left.swing({ hook: -0.06 });
  const leftThrow = left.drain()[0];
  const right = webcamHarness();
  right.swing({ hook: 0.06 });
  const rightThrow = right.drain()[0];
  assert.ok(leftThrow && rightThrow, 'both hooked swings release');
  assert.ok(leftThrow.spin_omega < 0 && rightThrow.spin_omega > 0, 'opposite hook spin');
  assert.ok(Math.abs(leftThrow.spin_omega) <= config.MAX_SPIN);
  assert.ok(leftThrow.launch_angle > 0 && rightThrow.launch_angle < 0, 'opposite release yaw');
});

test('a stronger swing still throws faster than a gentle one', () => {
  const slow = webcamHarness();
  slow.swing({ forward: 18, deep: 0.80, top: 0.50 });      // slow, low delivery
  for (let i = 0; i < 6; i++) slow.stepPose({ rightWristY: 0.50 });   // ease to a stop
  const fast = webcamHarness();
  fast.swing({ forward: 6, top: 0.24 });                   // snappy delivery
  const a = slow.drain()[0];
  const b = fast.drain()[0];
  assert.ok(a && b, `slow=${a ? a.speed : 'none'} fast=${b ? b.speed : 'none'}`);
  assert.ok(b.speed > a.speed, `fast ${b.speed} vs slow ${a.speed}`);
});

// Real recorded footage (tools/testdata/jumping_jacks_burpees.webm): exercise
// arm raises. The legacy phase machine fires on it (the Python reference does
// too), which is exactly why it is no longer the release authority. The
// temporal classifier must refuse the throw even though the raw motion
// contains releases - and it must refuse it *without even recognizing a
// release*.
const jjFixture = loadWebcamFixture('webcam_landmarks.json');
if (jjFixture) {
  test('recorded jumping-jacks footage never produces a throw through the input', () => {
    const h = webcamHarness();
    const names = jjFixture.landmarks;
    const n = names.length;
    const dt = 1 / (jjFixture.fps || 30);
    jjFixture.frames.forEach((entry) => {
      let lm = null; let tracked = false; let confidence = 0.0;
      if (entry.t && entry.l) {
        tracked = true;
        lm = {};
        for (let i = 0; i < n; i++) {
          if (entry.l[i] === null) continue;
          lm[names[i]] = { x: entry.l[i], y: entry.l[n + i], z: 0, visibility: entry.l[2 * n + i] };
        }
        confidence = entry.c;
      }
      h.step(lm, { tracked, confidence, dt });
    });
    assert.equal(h.drain().length, 0, 'exercise motion must not bowl');
    assert.equal(h.input._classifier.release_count, 0,
      'the classifier must not even recognize a release in the exercise trace');
  });
} else {
  console.log('  (tools/webcam_landmarks.json missing; run python tools/export_landmarks.py first)');
}

const waveFixture2 = loadWebcamFixture('webcam_wave_landmarks.json');
if (waveFixture2) {
  test('recorded waving footage never produces a throw through the input', () => {
    const h = webcamHarness();
    const names = waveFixture2.landmarks;
    const n = names.length;
    const dt = 1 / (waveFixture2.fps || 30);
    waveFixture2.frames.forEach((entry) => {
      let lm = null; let tracked = false; let confidence = 0.0;
      if (entry.t && entry.l) {
        tracked = true;
        lm = {};
        for (let i = 0; i < n; i++) {
          if (entry.l[i] === null) continue;
          lm[names[i]] = { x: entry.l[i], y: entry.l[n + i], z: 0, visibility: entry.l[2 * n + i] };
        }
        confidence = entry.c;
      }
      h.step(lm, { tracked, confidence, dt });
    });
    assert.equal(h.drain().length, 0);
    assert.equal(h.input._classifier.release_count, 0);
  });
}

testAsync('a camera restart bumps the tracking session number', async () => {
  await withBrowserStubs(async (handle) => {
    const service = new TrackingService({ stall_timeout_ms: 60000 });
    service._loadLandmarker = async () => {
      service._delegate = 'CPU';
      return { detectForVideo: (video) => { video.advance(); return { landmarks: [] }; }, close() {} };
    };
    await service.start();
    assert.equal(service.snapshot().session, 1, 'the first camera session is numbered');
    await service.stop();
    await service.start();
    assert.equal(service.snapshot().session, 2, 'a restart is a new session');
    await service.stop();
  });
});

// ---------------------------------------------------------------------------
section('physics regression against the Python fidelity dump');
const fixturePath = fileURLToPath(new URL('./physics_py.json', import.meta.url));
if (fs.existsSync(fixturePath)) {
  const CASES = {
    'centre_7.5': [7.5, 0.0, 0.0, 0.0], 'centre_8': [8.0, 0.0, 0.0, 0.0],
    'angle_to_pin': [7.0, 0.0, 1.37, 0.0], 'spin_to_corner': [6.0, 0.0, 0.0, -4.71],
    'spin_to_left': [6.0, 0.0, 0.0, 4.71], 'pocket': [7.5, 0.15, -1.0, -1.6],
    'speed_to_curve': [6.352, 0.0, 0.0, -5.0], 'pin_speed': [4.42, 0.0, 0.0, 0.0],
    'max_speed': [12.0, 0.0, 0.0, 0.0], 'min_speed': [2.0, 0.0, 0.0, 0.0],
    'mixed': [7.5, -0.3, -2.0, 3.0], 'gutter': [8.0, 0.0, 2.0, -5.0],
  };
  const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  for (const [name, [speed, lateral, angleDeg, spin]] of Object.entries(CASES)) {
    test(`physics case ${name} matches the Python simulation`, () => {
      const want = expected[name];
      const result = simulateRoll({
        speed, lateral_position: lateral, launch_angle: rad(angleDeg), spin_omega: spin,
      }, null, null, null, true);
      const deck = result.deck;
      assert.equal(result.knockdowns, want.knockdowns, 'knockdowns');
      assert.equal(result.standing_after, want.standing_after, 'standing_after');
      assert.deepEqual(Array.from(deck.roll_down).sort((a, b) => a - b), want.roll_down, 'roll_down');
      assert.equal(deck.pins.reduce((n, p) => n + p.kickback_hits, 0), want.kickback_hits, 'kickback');
      assert.ok(Math.abs(deck.ball.position[0] - want.ball_x) < 1e-4, 'ball_x');
      assert.ok(Math.abs(deck.ball.position[2] - want.ball_z) < 1e-4, 'ball_z');
    });
  }
} else {
  console.log('  (tools/physics_py.json missing; run python tools/fidelity_dump.py first)');
}
test('identical throws are deterministic', () => {
  const a = simulateRoll({ speed: 7.4, lateral_position: 0.12, launch_angle: rad(0.5), spin_omega: -1.2 });
  const b = simulateRoll({ speed: 7.4, lateral_position: 0.12, launch_angle: rad(0.5), spin_omega: -1.2 });
  assert.equal(a.knockdowns, b.knockdowns);
  assert.deepEqual(a.deck.pins.map((p) => p.down), b.deck.pins.map((p) => p.down));
});
test('the rack is the regulation triangle', () => {
  const positions = rackPositions();
  assert.equal(positions.length, 10);
  assert.ok(Math.abs(positions[0][1] - config.HEAD_PIN_Z) < 1e-9);
});

// ---------------------------------------------------------------------------
section('deck timeline (from tests/test_timeline.py)');
test('timeline records, restores and truncates', () => {
  const deck = new Deck();
  const timeline = new DeckTimeline();
  deck.substep_listener = (d) => timeline.record(d);
  const result = simulateRoll({ speed: 7.5 }, deck, null, null, true);
  assert.ok(timeline.length > 100);
  const duration = timeline.duration();
  const index = timeline.indexAt(duration * 0.5);
  assert.ok(index !== null);
  timeline.restore(deck, index);
  assert.ok(Math.abs(deck.elapsed - timeline.timeOf(index)) < 1e-9);
  const truncated = timeline.truncate(index);
  assert.equal(timeline.length, truncated + 1);
  assert.ok(result.knockdowns >= 0);
});

// ---------------------------------------------------------------------------
section('trivia marking (from tests/test_questions.py)');
test('text answers accept aliases and ignore spacing', () => {
  const q = TRIVIA_QUESTIONS[0];
  assert.equal(checkAnswer(q, 'Momentum').correct, true);
  assert.equal(checkAnswer(q, 'linear momentum').correct, true);
  assert.equal(checkAnswer(q, 'the ball').correct, false);
});
test('numeric answers accept units and reject wrong ones', () => {
  const q = TRIVIA_QUESTIONS[6];         // 6 m/s
  assert.equal(q.answer, 6.0);
  assert.equal(checkAnswer(q, '6').correct, true);
  assert.equal(checkAnswer(q, '6 m/s').correct, true);
  assert.equal(checkAnswer(q, '6 m').correct, false);
  assert.equal(checkAnswer(q, '7').correct, false);
});

// ---------------------------------------------------------------------------
section('celebration rules (from tests/test_celebrate.py)');
test('combo labels escalate', () => {
  assert.equal(celebrate.comboLabel(1), '');
  assert.equal(celebrate.comboLabel(2), 'DOUBLE!');
  assert.equal(celebrate.comboLabel(3), 'TURKEY!');
  assert.equal(celebrate.comboLabel(7), '7 IN A ROW!');
});
test('achievements pick the best award only', () => {
  assert.equal(celebrate.achievement(true, true, true)[0], 'perfect');
  assert.equal(celebrate.achievement(false, true, true)[0], 'best');
  assert.equal(celebrate.achievement(false, false, true)[0], 'win');
  assert.equal(celebrate.achievement(false, false, false), null);
});

// ---------------------------------------------------------------------------
section('audio cue names (menu sounds regression)');
test('the snake_case cue names used by the ported call sites exist', () => {
  const audio = new AudioSystem(new AudioSettings(), false);
  for (const name of ['menu_move', 'menu_select', 'menu_back', 'confirm', 'release',
    'gutter', 'strike', 'spare', 'correct', 'wrong', 'tick', 'victory', 'handoff']) {
    assert.equal(typeof audio[name], 'function', name);
  }
  audio.menu_move();
  audio.menu_select();
  audio.menu_back();
  assert.deepEqual(audio.played, ['menu_move', 'menu_select', 'menu_back']);
});

// ---------------------------------------------------------------------------
section('ease / tween');
test('cubic bezier endpoints and monotonicity', () => {
  assert.ok(Math.abs(ease.STANDARD(0)) < 1e-6);
  assert.ok(Math.abs(ease.STANDARD(1) - 1) < 1e-6);
  assert.ok(ease.STANDARD(0.5) > 0.5);
});
test('tween completes and reports progress', () => {
  let last = -1;
  const t = new Tween(0.5, (p) => { last = p; });
  t.update(0.6);
  assert.ok(t.finished);
  assert.ok(Math.abs(last - 1) < 1e-9);
});
test('Motion.countUp reaches the end value', () => {
  const motion = new Motion();
  let value = null;
  motion.countUp(0, 100, 0.2, (v) => { value = v; });
  motion.update(0.3);
  assert.equal(value, 100);
});

// ---------------------------------------------------------------------------
section('bot');
test('a planner completes and returns a candidate for a full rack', () => {
  const bot = new BotPlanner('medium');
  const throwData = bot.planNow(rackPositions().map(([x, z]) => [x, z]));
  assert.ok(throwData);
  assert.equal(throwData.source, 'bot');
  assert.ok(throwData.speed >= config.MIN_THROW_SPEED);
  assert.ok(throwData.speed <= config.MAX_THROW_SPEED);
  assert.ok(bot.last_best_score >= 0);
});

// ---------------------------------------------------------------------------
section('scorecard model (matches the scoring engine)');
test('a fresh card has empty boxes and no totals', () => {
  const score = new BowlingGame();
  const view = cardModel(score);
  for (let frame = 1; frame <= 10; frame++) {
    assert.deepEqual(view.boxes[frame - 1], frame === 10 ? ['', '', ''] : ['', ''], `frame ${frame}`);
    assert.equal(view.totals[frame - 1], null, `total ${frame}`);
  }
  assert.equal(view.official, 0);
  assert.equal(view.currentFrame, 1);
  assert.equal(view.complete, false);
  assert.equal(isBonusMark(view.boxes[0][0]), false);
});

test('strikes and spares land in the right boxes', () => {
  const score = new BowlingGame();
  for (const roll of [10, 7, 3, 4, 5, 0, 3]) score.recordRoll(roll);
  assert.deepEqual(frameBoxes(score, 1), ['X', '']);
  assert.deepEqual(frameBoxes(score, 2), ['7', '/']);
  assert.deepEqual(frameBoxes(score, 3), ['4', '5']);
  assert.deepEqual(frameBoxes(score, 4), ['-', '3']);   // 0 prints as a miss
  assert.deepEqual(frameBoxes(score, 5), ['', '']);
  assert.equal(isBonusMark(frameBoxes(score, 2)[1]), true);
  assert.equal(isBonusMark(frameBoxes(score, 3)[1]), false);
});

test('a zero followed by a ten is a spare, not a strike', () => {
  // The engine scores any two rolls summing to ten as a spare, which is correct
  // USBC behaviour; the card has to show the same thing. The frame total stays
  // blank until the spare's bonus roll has been bowled.
  const score = new BowlingGame();
  for (const roll of [0, 10]) score.recordRoll(roll);
  assert.deepEqual(frameBoxes(score, 1), ['-', '/']);
  assert.equal(score.frameScore(1), null);
  score.recordRoll(7);
  assert.equal(score.frameScore(1), 17);
  assert.deepEqual(cardModel(score).totals.slice(0, 2), [17, null]);
});

test('a frame whose bonus rolls are outstanding shows marks but no total', () => {
  const score = new BowlingGame();
  for (const roll of [10, 10]) score.recordRoll(roll);
  const view = cardModel(score);
  assert.deepEqual(view.boxes[0], ['X', '']);
  assert.deepEqual(view.boxes[1], ['X', '']);
  assert.equal(view.totals[0], null, 'a strike still owes its two bonus rolls');
  assert.equal(view.totals[1], null);
  assert.equal(view.official, 0);
});

test('an open frame scores immediately', () => {
  const score = new BowlingGame();
  for (const roll of [10, 10, 3, 4]) score.recordRoll(roll);
  const view = cardModel(score);
  assert.deepEqual(view.boxes[2], ['3', '4']);
  assert.deepEqual(view.totals.slice(0, 3), [23, 40, 47]);
  assert.equal(view.official, 47);
});

test('running totals accumulate exactly as the engine computes them', () => {
  const score = new BowlingGame();
  for (const roll of [10, 7, 3, 4, 5, 10, 0, 0, 9, 1, 10]) score.recordRoll(roll);
  const view = cardModel(score);
  assert.deepEqual(view.totals.slice(0, 6), [20, 34, 43, 53, 53, 73]);
  assert.deepEqual(view.totals.slice(6), [null, null, null, null]);
  assert.equal(view.official, 73);
});

test('the tenth frame carries three boxes and its bonus balls', () => {
  assert.equal(boxCountFor(10), 3);
  assert.equal(boxCountFor(9), 2);
  const blank = new BowlingGame();
  for (const roll of Array(18).fill(0)) blank.recordRoll(roll);
  assert.deepEqual(frameBoxes(blank, 10), ['', '', '']);
  const open = new BowlingGame();
  for (const roll of Array(18).fill(0).concat([4, 3])) open.recordRoll(roll);
  assert.deepEqual(frameBoxes(open, 10), ['4', '3', '']);
  const spare = new BowlingGame();
  for (const roll of Array(18).fill(0).concat([6, 4, 8])) spare.recordRoll(roll);
  assert.deepEqual(frameBoxes(spare, 10), ['6', '/', '8']);
  const turkey = new BowlingGame();
  for (const roll of Array(18).fill(0).concat([10, 10, 10])) turkey.recordRoll(roll);
  assert.deepEqual(frameBoxes(turkey, 10), ['X', 'X', 'X']);
  assert.equal(turkey.is_complete, true);
});

test('a completed card reports the final score and no current frame', () => {
  const perfect = new BowlingGame();
  for (const roll of Array(12).fill(10)) perfect.recordRoll(roll);
  const view = cardModel(perfect);
  assert.equal(view.complete, true);
  assert.equal(view.currentFrame, null);
  assert.equal(view.final, 300);
  assert.equal(view.official, 300);
  assert.deepEqual(view.totals, [30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  for (let frame = 1; frame <= 9; frame++) assert.deepEqual(view.boxes[frame - 1], ['X', '']);
  assert.deepEqual(view.boxes[9], ['X', 'X', 'X']);
});

test('the current frame tracks the engine while a game is in progress', () => {
  const score = new BowlingGame();
  const frames = [];
  for (const roll of [10, 7, 3, 4, 5, 10, 10, 2, 8, 9]) {
    frames.push(cardModel(score).currentFrame);
    score.recordRoll(roll);
  }
  assert.deepEqual(frames, [1, 2, 2, 3, 3, 4, 5, 6, 6, 7]);
  assert.equal(cardModel(score).currentFrame, 7);
  assert.equal(normaliseMark('0'), '-');
  assert.equal(normaliseMark('X'), 'X');
});

test('every card box is filled only by a mark the engine actually produced', () => {
  // A mixed game: random but valid rolls, checked box by box against the engine.
  const score = new BowlingGame();
  let guard = 0;
  while (!score.is_complete && guard < 40) {
    const standing = score.standingPins();
    const pins = standing === null ? 0 : (guard % 4 === 0 ? standing : Math.min(standing, guard % 5));
    score.recordRoll(pins);
    guard += 1;
  }
  const view = cardModel(score);
  for (let frame = 1; frame <= 10; frame++) {
    const engineMarks = score.frameMarks(frame).map(normaliseMark);
    const boxes = view.boxes[frame - 1];
    assert.equal(boxes.length, boxCountFor(frame));
    engineMarks.forEach((mark, i) => assert.equal(boxes[i], mark, `frame ${frame} box ${i}`));
    for (let i = engineMarks.length; i < boxes.length; i++) assert.equal(boxes[i], '', `frame ${frame} box ${i} unplayed`);
  }
  assert.equal(view.official, score.current_score);
  assert.equal(view.final, score.total_score);
});

// ---------------------------------------------------------------------------
for (const [name, fn] of asyncTests) {
  try { await fn(); passed += 1; }
  catch (err) { failed += 1; failures.push([name, err]); console.error(`FAIL ${name}: ${err && err.message}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const [name, err] of failures) console.error(`- ${name}: ${err && err.stack || err}`);
  process.exit(1);
}
