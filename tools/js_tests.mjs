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
import { simulateRoll, Deck, DeckTimeline, rackPositions, PinPhysics } from '../src/physics.js';
import { checkAnswer, TRIVIA_QUESTIONS } from '../src/game/questions.js';
import { AudioSystem, AudioSettings } from '../src/game/audio.js';
import * as celebrate from '../src/motion/celebrate.js';
import { Motion, Tween } from '../src/motion/tween.js';
import * as ease from '../src/motion/ease.js';
import { keyToCharacter } from '../src/ui/theme.js';
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
function poseResult({ rightWristY = 0.62, leftWristY = 0.62, shoulderY = 0.40, hipY = 0.65,
                      bodyX = 0.5, rightVisibility = 0.95, tracked = true } = {}) {
  if (!tracked) return { landmarks: null, confidence: 0.0, tracked: false, timestamp: 0 };
  const lm = {};
  const put = (n, x, y, v = 0.95) => { lm[n] = landmark(x, y, v); };
  put('left_shoulder', bodyX - 0.12, shoulderY);
  put('right_shoulder', bodyX + 0.12, shoulderY);
  put('left_hip', bodyX - 0.10, hipY);
  put('right_hip', bodyX + 0.10, hipY);
  put('left_knee', bodyX - 0.10, hipY + 0.25);
  put('right_knee', bodyX + 0.10, hipY + 0.25);
  put('left_wrist', bodyX - 0.18, leftWristY);
  put('right_wrist', bodyX + 0.18, rightWristY, rightVisibility);
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
      snapshot() { return this._snapshot; },
      async start() { this.is_running = true; },
      async stop() { this.is_running = false; },
      setPreferredCamera() {},
      publish(landmarks) {
        this._snapshot = { ...this._snapshot, tracked: true, confidence: 0.9, landmarks, frame_count: this._snapshot.frame_count + 1 };
      },
    };
    const input = new WebcamInput(service, new SwingDetector());
    input.setGameReady(true);
    const step = (landmarks) => {
      service.publish(landmarks);
      // pin the processed-frame clock to the detector's nominal 30 fps
      input._last_process_time = performance.now() / 1000 - DT;
      input.update();
    };
    // ready pose, then part-way into a backswing on the default arm
    for (let i = 0; i < 12; i++) step(poseResult({}).landmarks);
    for (const y of [0.66, 0.72, 0.78]) step(poseResult({ rightWristY: y }).landmarks);
    assert.equal(input._detector.phase, PHASE_BACKSWING);
    input.setPreferredArm('left');
    assert.equal(input.preferred_arm, 'left');
    assert.equal(input._detector.phase, PHASE_WAITING);
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
    if (!runs.length || runs[runs.length - 1].phase !== detector.phase) {
      runs.push({ phase: detector.phase, from: frame });
    }
  });
  return { events, runs };
}

const swingFixture = loadWebcamFixture('webcam_landmarks.json');
if (swingFixture) {
  test('a real recorded arm swing releases exactly once at the reference frame', () => {
    const detector = new SwingDetector();
    const { events, runs } = feedFixture(swingFixture, detector);
    const reference = swingFixture.reference;
    assert.equal(events.length, reference.releases.length, 'release count matches the Python reference');
    assert.equal(events.length, 1, 'the fixture contains one deliberate swing');
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
