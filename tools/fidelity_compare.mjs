// Compare the JS physics port with the original Python physics output.
// Usage:  node tools/fidelity_compare.mjs tools/physics_py.json tools/physics_js.json
import fs from 'fs';

const [pyPath, jsPath] = process.argv.slice(2);
const py = JSON.parse(fs.readFileSync(pyPath, 'utf8').replace(/^\uFEFF/, ''));
const js = JSON.parse(fs.readFileSync(jsPath, 'utf8').replace(/^\uFEFF/, ''));

const FIELDS = ['knockdowns', 'standing_after', 'first_contact_time', 'impact_speed',
                'ball_x', 'ball_z', 'elapsed'];
const mismatches = [];
const keys = Object.keys(py);
for (const key of keys) {
  const a = py[key], b = js[key];
  if (!b) { mismatches.push(`${key}: missing in JS`); continue; }
  for (const field of FIELDS) {
    const av = a[field], bv = b[field];
    if (av === null || bv === null) {
      if (av !== bv) mismatches.push(`${key}.${field}: py=${av} js=${bv}`);
      continue;
    }
    if (Math.abs(av - bv) > 1e-6) mismatches.push(`${key}.${field}: py=${av} js=${bv}`);
  }
  if (JSON.stringify(a.roll_down) !== JSON.stringify(b.roll_down)) {
    mismatches.push(`${key}.roll_down: py=${JSON.stringify(a.roll_down)} js=${JSON.stringify(b.roll_down)}`);
  }
  if (a.kickback_hits !== b.kickback_hits) mismatches.push(`${key}.kickback_hits: py=${a.kickback_hits} js=${b.kickback_hits}`);
  if (a.trajectory.length !== b.trajectory.length) {
    mismatches.push(`${key}.trajectory length: ${a.trajectory.length} vs ${b.trajectory.length}`);
  } else {
    for (let i = 0; i < a.trajectory.length; i++) {
      for (let c = 0; c < 3; c++) {
        if (Math.abs(a.trajectory[i][c] - b.trajectory[i][c]) > 1e-4) {
          mismatches.push(`${key}.trajectory[${i}][${c}]: py=${a.trajectory[i][c]} js=${b.trajectory[i][c]}`);
        }
      }
    }
  }
}
console.log(`cases compared: ${keys.length}`);
console.log(`mismatches: ${mismatches.length}`);
for (const line of mismatches.slice(0, 40)) console.log('  ' + line);
process.exit(mismatches.length ? 1 : 0);
