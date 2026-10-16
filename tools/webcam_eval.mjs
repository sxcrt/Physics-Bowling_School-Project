// Repeatable evaluation harness for the temporal webcam swing classifier.
//
//   node tools/webcam_eval.mjs                      # run and print the report
//   node tools/webcam_eval.mjs --json report.json   # also write machine-readable results
//   node tools/webcam_eval.mjs --export traces.json # export the labeled traces for the Python runner
//   python tools/webcam_eval.py traces.json         # the same expectations, Python classifier
//
// The dataset (tools/webcam_eval_data.mjs) contains labeled synthetic
// movement sequences and the recorded real-human landmark traces that exist in
// this repository (both negative motions: jumping jacks/burpees and waving).
// There is no recorded genuine bowling footage in the repository, so recall
// figures rest on synthetic positives only; the report states this explicitly.
//
// Exit status is 1 when any sequence releases the wrong number of times, so
// this doubles as a regression gate.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildEvaluationSequences, randomArmSequence, unconstrainedRandomArmSequence,
} from './webcam_eval_data.mjs';
import { SwingClassifier } from '../src/input/classifier.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

export function runClassifierSequence(sequence) {
  const classifier = new SwingClassifier();
  const fps = sequence.fps || 30;
  const defaultDt = 1.0 / fps;
  const events = [];
  const phases = [];
  let lastPhase = null;
  let maxDepth = 0.0; let maxRise = 0.0; let maxPeak = 0.0;
  sequence.frames.forEach((frame, index) => {
    const tracked = frame.tracked === undefined ? true : !!frame.tracked;
    const dt = Number(frame.dt) > 0 ? Number(frame.dt) : defaultDt;
    const result = {
      landmarks: tracked ? (frame.landmarks || {}) : {},
      confidence: frame.confidence === undefined ? 0.95 : frame.confidence,
      tracked,
      timestamp: 0,
    };
    const event = classifier.update(result, dt);
    const telemetry = classifier.telemetry;
    maxDepth = Math.max(maxDepth, telemetry.depth);
    maxRise = Math.max(maxRise, telemetry.rise);
    maxPeak = Math.max(maxPeak, telemetry.peak_up);
    if (event !== null) {
      events.push({
        frame: index, arm: event.arm, up_speed: event.up_speed,
        rise: event.rise, depth: event.depth, hand_source: event.hand_source,
      });
    }
    if (classifier.phase !== lastPhase) {
      phases.push({ phase: classifier.phase, frame: index });
      lastPhase = classifier.phase;
    }
  });
  return {
    events,
    phases,
    maxDepth: Number(maxDepth.toFixed(3)),
    maxRise: Number(maxRise.toFixed(3)),
    maxPeak: Number(maxPeak.toFixed(3)),
    lastRejectReason: classifier.last_reject_reason,
    counters: {
      releases: classifier.release_count,
      blocked: classifier.blocked_count,
      aborts: classifier.abort_count,
      rejects: classifier.rejected_count,
      lost: classifier.lost_count,
    },
  };
}

export function evaluate(sequences) {
  const results = [];
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  for (const sequence of sequences) {
    const run = runClassifierSequence(sequence);
    const expected = sequence.expect;
    const got = run.events.length;
    const pass = got === expected;
    if (expected > 0) {
      if (got > 0) tp += 1; else fn += 1;
    } else if (got > 0) fp += 1; else tn += 1;
    results.push({
      name: sequence.name, kind: sequence.kind, motion: sequence.motion,
      note: sequence.note || '', expected, got, pass,
      frames: sequence.frames.length, ...run,
    });
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0.0;
  return { results, totals: { tp, fp, tn, fn, precision, recall, f1 } };
}

function motionGroups(results) {
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.motion)) groups.set(r.motion, { motion: r.motion, count: 0, expected: 0, got: 0, pass: 0 });
    const g = groups.get(r.motion);
    g.count += 1; g.expected += r.expected; g.got += r.got;
    if (r.pass) g.pass += 1;
  }
  return [...groups.values()];
}

// Compact trace export for the Python runner: one landmark-name table plus
// flat per-frame arrays.
export function exportTraces(sequences, path) {
  const names = [];
  for (const sequence of sequences) {
    for (const frame of sequence.frames) {
      if (!frame || !frame.landmarks) continue;
      for (const name of Object.keys(frame.landmarks)) {
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  const exported = sequences.map((sequence) => ({
    name: sequence.name,
    kind: sequence.kind,
    motion: sequence.motion,
    expect: sequence.expect,
    note: sequence.note || '',
    fps: sequence.fps || 30,
    frames: sequence.frames.map((frame) => {
      if (!frame || frame.tracked === false || !frame.landmarks) return null;
      const values = [];
      for (const name of names) {
        const lm = frame.landmarks[name];
        values.push(lm ? [lm.x, lm.y, lm.visibility] : null);
      }
      const entry = { l: values, c: frame.confidence === undefined ? 0.95 : frame.confidence };
      if (Number(frame.dt) > 0) entry.dt = Number(frame.dt);
      return entry;
    }),
  }));
  fs.writeFileSync(path, JSON.stringify({ version: 1, landmarks: names, sequences: exported }));
}

function formatPercent(value) { return `${(value * 100).toFixed(1)}%`; }

function printReport(evaluation, verbose) {
  const { results, totals } = evaluation;
  const synthetic = results.filter((r) => r.kind === 'synthetic').length;
  const recorded = results.filter((r) => r.kind === 'recorded-human').length;
  console.log(`webcam classifier evaluation: ${results.length} sequences`
    + ` (${synthetic} synthetic, ${recorded} recorded-human negative)`);
  console.log('');
  console.log(`${'sequence'.padEnd(28)} ${'kind'.padEnd(15)} ${'motion'.padEnd(16)} exp got  result`);
  for (const r of results) {
    console.log(`${r.name.padEnd(28)} ${r.kind.padEnd(15)} ${r.motion.padEnd(16)}`
      + ` ${String(r.expected).padStart(3)} ${String(r.got).padStart(3)}  ${r.pass ? 'pass' : 'FAIL'}`);
  }
  if (verbose) {
    console.log('');
    console.log('diagnostics (max depth / rise / peak, states reached, last rejection):');
    for (const r of results) {
      console.log(`  ${r.name.padEnd(28)} depth=${String(r.maxDepth).padEnd(6)} rise=${String(r.maxRise).padEnd(6)}`
        + ` peak=${String(r.maxPeak).padEnd(7)} states=${r.phases.map((p) => p.phase).join('>')}`
        + `${r.lastRejectReason ? `  reject: ${r.lastRejectReason}` : ''}`);
    }
  }
  console.log('');
  console.log('per-motion:');
  for (const group of motionGroups(results)) {
    console.log(`  ${group.motion.padEnd(16)} sequences ${String(group.pass).padStart(2)}/${group.count} pass`
      + `   expected releases ${group.expected}  got ${group.got}`);
  }
  console.log('');
  console.log(`positives detected: ${totals.tp}   false negatives: ${totals.fn}`);
  console.log(`false positives: ${totals.fp}   true negatives: ${totals.tn}`);
  console.log(`precision ${formatPercent(totals.precision)}  recall ${formatPercent(totals.recall)}`
    + `  f1 ${formatPercent(totals.f1)}`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.log('');
    console.log(`FAILURES (${failed.length}):`);
    for (const r of failed) {
      console.log(`- ${r.name}: expected ${r.expected} release(s), got ${r.got}`
        + `  releases=[${r.events.map((e) => `f${e.frame}:${e.arm}`).join(', ')}]`
        + `  depth=${r.maxDepth} rise=${r.maxRise} peak=${r.maxPeak}`
        + `  blocked=${r.counters.blocked} aborts=${r.counters.aborts} rejects=${r.counters.rejects} lost=${r.counters.lost}`
        + `${r.lastRejectReason ? `  last reject: ${r.lastRejectReason}` : ''}`);
    }
  }
  return failed.length === 0;
}

// Seed sweep: verifies the decision is not a property of one lucky example.
// The bounded fidgeting generator must never release; the unconstrained walk
// is reported as an ambiguity measurement (some seeds do build a delivery).
function runSeedSweep(iterations) {
  const bounded = { released: 0, total: iterations };
  const unconstrained = { released: 0, total: iterations };
  for (let seed = 1; seed <= iterations; seed++) {
    for (const [bucket, frames] of [
      [bounded, randomArmSequence({ seed })],
      [unconstrained, unconstrainedRandomArmSequence(seed)],
    ]) {
      const classifier = new SwingClassifier();
      let released = false;
      for (const frame of frames) {
        const event = classifier.update({
          landmarks: frame.landmarks || {}, confidence: frame.confidence ?? 0.95, tracked: true,
        }, 1 / 30);
        if (event) released = true;
      }
      if (released) bucket.released += 1;
    }
  }
  console.log('');
  console.log(`seed sweep (${iterations} seeds each):`);
  console.log(`  bounded fidgeting random motion   releases ${bounded.released}/${bounded.total}`);
  console.log(`  unconstrained random arm motion   releases ${unconstrained.released}/${unconstrained.total}`
    + '   (ambiguity measurement: those seeds built a settled wind-up + sustained rise)');
  return bounded.released === 0;
}

function main() {
  const sequences = buildEvaluationSequences();
  const exportPath = argValue('--export');
  if (exportPath) {
    exportTraces(sequences, exportPath);
    console.log(`exported ${sequences.length} labeled sequences to ${exportPath}`);
  }
  const evaluation = evaluate(sequences);
  let ok = printReport(evaluation, process.argv.includes('--verbose'));
  const sweepCount = argValue('--sweep');
  if (sweepCount !== null) {
    ok = runSeedSweep(Math.max(1, Number(sweepCount) || 100)) && ok;
  }
  const jsonPath = argValue('--json');
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify({
      generated: new Date().toISOString(),
      dataset: {
        sequences: sequences.length,
        synthetic: sequences.filter((s) => s.kind === 'synthetic').length,
        recorded_human: sequences.filter((s) => s.kind === 'recorded-human').length,
        recorded_positive_bowling: 0,
      },
      classifier: 'src/input/classifier.js',
      sweep: sweepCount !== null ? Number(sweepCount) : null,
      ...evaluation,
    }, null, 2));
    console.log(`wrote ${jsonPath}`);
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/webcam_eval.mjs')) {
  main();
}
