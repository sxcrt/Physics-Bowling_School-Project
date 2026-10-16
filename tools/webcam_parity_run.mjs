// Replay the Python webcam parity dump through the browser swing pipeline.
//
//   python tools/webcam_parity_dump.py tools/webcam_parity_py.json
//   node   tools/webcam_parity_run.mjs  tools/webcam_parity_js.json
//   node   tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json
//
// The exact same landmark sequences (parsed from the Python dump, so both
// sides see bit-identical doubles) are fed to src/input/swing.js and
// src/input/webcam.js's eventToThrow. The output has the same shape as the
// Python file so the comparator can diff it frame by frame.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SwingDetector } from '../src/input/swing.js';
import { eventToThrow } from '../src/input/webcam.js';

const ARMS = ['right', 'left'];
const KEY = ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee'];

function poseResult(entry, names) {
  if (!entry) return { landmarks: null, confidence: 0.0, tracked: false, timestamp: 0 };
  const landmarks = {};
  entry.forEach((values, index) => {
    if (!values) return;
    landmarks[names[index]] = { x: values[0], y: values[1], z: 0, visibility: values[2] };
  });
  let total = 0;
  for (const name of KEY) if (landmarks[name]) total += landmarks[name].visibility;
  return { landmarks, confidence: total / KEY.length, tracked: true, timestamp: 0 };
}

function traceRow(detector, event, time) {
  const arms = {};
  for (const arm of ARMS) {
    const smooth = detector._smooth[arm];
    arms[arm] = {
      sx: smooth ? smooth[0] : null,
      sy: smooth ? smooth[1] : null,
      vel: detector._vel[arm],
      raw: detector._raw_vel[arm],
      lat: detector._lateral_vel[arm],
      src: detector._hand_source[arm],
    };
  }
  let depth = 0.0;
  if (detector._swing_arm !== null && detector._torso_height > 0.0) {
    depth = Math.max(0.0, (detector._backswing_deepest_rel - detector._swing_start_rel)
      / detector._torso_height);
  }
  return {
    t: time,
    phase: detector.phase,
    arm: detector._swing_arm,
    rise: detector._rise,
    peak: detector._peak_up_speed,
    depth,
    torso: detector._torso_height,
    pose: detector.swing_pose,
    hint: detector.hint,
    arms,
    event: event === null ? null : eventFields(event),
  };
}

function eventFields(event) {
  return {
    up_speed: event.up_speed, body_x: event.body_x, arm: event.arm,
    duration: event.duration, time: event.time,
    release_speed: event.release_speed, rise: event.rise, depth: event.depth,
    confidence: event.confidence, hand_source: event.hand_source,
    lateral_speed: event.lateral_speed, hand_offset: event.hand_offset,
  };
}

function throwFields(data) {
  return {
    lateral_position: data.lateral_position, launch_angle: data.launch_angle,
    speed: data.speed, spin_omega: data.spin_omega, source: data.source,
    confidence: data.confidence,
  };
}

function runSequence(sequence, names) {
  const detector = new SwingDetector();
  const dt = 1.0 / (sequence.fps || 30.0);
  const trace = [];
  const events = [];
  const throws = [];
  sequence.landmarks.forEach((entry, index) => {
    const event = detector.update(poseResult(entry, names), dt);
    if (event !== null) {
      events.push({ frame: index, ...eventFields(event) });
      throws.push({ frame: index, ...throwFields(eventToThrow(event)) });
    }
    trace.push(traceRow(detector, event, detector._time));
  });
  return {
    trace, events, throws,
    counters: {
      rejected: detector.rejected_count, lost: detector.lost_count,
      releases: detector.release_count, aborts: detector.abort_count,
    },
  };
}

const source = process.argv[2] || fileURLToPath(new URL('./webcam_parity_py.json', import.meta.url));
const outPath = process.argv[3] || fileURLToPath(new URL('./webcam_parity_js.json', import.meta.url));
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
const payload = { version: data.version, landmarks: data.landmarks, dt: data.dt, sequences: {} };
const summary = [];
for (const [name, sequence] of Object.entries(data.sequences)) {
  const result = runSequence(sequence, data.landmarks);
  payload.sequences[name] = {
    fps: sequence.fps, kind: sequence.kind, ...result,
  };
  summary.push([name, sequence.landmarks.length, result.events.length, result.throws.length]);
}
fs.writeFileSync(outPath, JSON.stringify(payload));
console.log(`${outPath}: ${summary.length} sequences`);
for (const [name, frames, events, throws] of summary) {
  console.log(`  ${name.padEnd(20)} frames=${String(frames).padStart(4)} releases=${events} throws=${throws}`);
}
