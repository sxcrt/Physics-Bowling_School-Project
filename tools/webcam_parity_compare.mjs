// Compare two webcam parity dumps (Python reference vs browser port).
//
//   node tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json
//
// Exit code 0 = parity. Every numeric field is compared with an absolute
// tolerance: the two implementations run the same double-precision arithmetic
// in the same order, so the expected difference is exactly 0; the small
// allowance covers Python's math.hypot vs JavaScript's Math.hypot rounding in
// the jump guards.
import fs from 'node:fs';

const [pyPath, jsPath] = process.argv.slice(2);
if (!pyPath || !jsPath) {
  console.error('usage: node tools/webcam_parity_compare.mjs <python.json> <browser.json>');
  process.exit(2);
}
const py = JSON.parse(fs.readFileSync(pyPath, 'utf8'));
const js = JSON.parse(fs.readFileSync(jsPath, 'utf8'));

const TOL = 1e-9;          // numeric fields (identical arithmetic)
const TOL_HYPOT = 1e-6;    // anything that passed through hypot()
const problems = [];
const notes = [];

function near(a, b, tol) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  const diff = Math.abs(a - b);
  return diff <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function compareFrames(name, index, row, ref) {
  const where = `${name} frame ${index}`;
  for (const field of ['t', 'rise', 'peak', 'depth', 'pose']) {
    if (!near(row[field], ref[field], TOL)) {
      problems.push(`${where}: ${field} ${row[field]} vs ${ref[field]}`);
    }
  }
  if (row.phase !== ref.phase) problems.push(`${where}: phase ${row.phase} vs ${ref.phase}`);
  if ((row.arm || null) !== (ref.arm || null)) problems.push(`${where}: arm ${row.arm} vs ${ref.arm}`);
  if (row.hint !== ref.hint) problems.push(`${where}: hint "${row.hint}" vs "${ref.hint}"`);
  for (const arm of ['right', 'left']) {
    const a = row.arms[arm]; const b = ref.arms[arm];
    for (const field of ['sx', 'sy', 'vel', 'raw', 'lat']) {
      if (!near(a[field], b[field], field === 'sx' || field === 'sy' ? TOL_HYPOT : TOL)) {
        problems.push(`${where}: ${arm}.${field} ${a[field]} vs ${b[field]}`);
      }
    }
    if (a.src !== b.src) problems.push(`${where}: ${arm}.src ${a.src} vs ${b.src}`);
  }
}

function compareEvents(name, events, refEvents) {
  if (events.length !== refEvents.length) {
    problems.push(`${name}: ${events.length} releases vs ${refEvents.length}`);
    return;
  }
  events.forEach((event, index) => {
    const ref = refEvents[index];
    if (Math.abs(event.frame - ref.frame) > 1) {
      problems.push(`${name}: release ${index} at frame ${event.frame} vs ${ref.frame}`);
    }
    if (event.arm !== ref.arm) problems.push(`${name}: release ${index} arm ${event.arm} vs ${ref.arm}`);
    if (event.hand_source !== ref.hand_source) {
      problems.push(`${name}: release ${index} hand ${event.hand_source} vs ${ref.hand_source}`);
    }
    for (const field of ['up_speed', 'body_x', 'duration', 'time', 'release_speed',
      'rise', 'depth', 'confidence', 'lateral_speed', 'hand_offset']) {
      if (!near(event[field], ref[field], TOL)) {
        problems.push(`${name}: release ${index} ${field} ${event[field]} vs ${ref[field]}`);
      }
    }
  });
}

function compareThrows(name, throws, refThrows) {
  if (throws.length !== refThrows.length) {
    problems.push(`${name}: ${throws.length} throws vs ${refThrows.length}`);
    return;
  }
  throws.forEach((data, index) => {
    const ref = refThrows[index];
    if (data.source !== ref.source) problems.push(`${name}: throw ${index} source ${data.source} vs ${ref.source}`);
    for (const field of ['lateral_position', 'launch_angle', 'speed', 'spin_omega', 'confidence']) {
      if (!near(data[field], ref[field], TOL)) {
        problems.push(`${name}: throw ${index} ${field} ${data[field]} vs ${ref[field]}`);
      }
    }
  });
}

const names = Object.keys(py.sequences);
if (names.length !== Object.keys(js.sequences).length) {
  problems.push(`sequence count ${Object.keys(js.sequences).length} vs ${names.length}`);
}
for (const name of names) {
  const reference = py.sequences[name];
  const browser = js.sequences[name];
  if (!browser) { problems.push(`${name}: missing from the browser dump`); continue; }
  if (browser.trace.length !== reference.trace.length) {
    problems.push(`${name}: ${browser.trace.length} frames vs ${reference.trace.length}`);
    continue;
  }
  for (let index = 0; index < reference.trace.length; index += 1) {
    compareFrames(name, index, browser.trace[index], reference.trace[index]);
    if (problems.length > 40) break;
  }
  compareEvents(name, browser.events, reference.events);
  compareThrows(name, browser.throws, reference.throws);
  for (const key of ['rejected', 'lost', 'releases', 'aborts']) {
    if (browser.counters[key] !== reference.counters[key]) {
      problems.push(`${name}: counter ${key} ${browser.counters[key]} vs ${reference.counters[key]}`);
    }
  }
  notes.push(`${name.padEnd(20)} frames=${reference.trace.length} releases=${reference.events.length}`);
}

console.log(`cases compared: ${names.length}`);
for (const line of notes) console.log('  ' + line);
if (problems.length) {
  console.error(`mismatches: ${problems.length}`);
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}
console.log('mismatches: 0');
