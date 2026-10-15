// Run the browser physics port on the same cases and print JSON, so the output
// can be diffed against tools/fidelity_dump.py (the original Python physics).
import { simulateRoll } from '../src/physics.js';
import fs from 'fs';

const CASES = [
  ['centre_7.5', 7.5, 0.0, 0.0, 0.0],
  ['centre_8', 8.0, 0.0, 0.0, 0.0],
  ['angle_to_pin', 7.0, 0.0, 1.37, 0.0],
  ['spin_to_corner', 6.0, 0.0, 0.0, -4.71],
  ['spin_to_left', 6.0, 0.0, 0.0, 4.71],
  ['pocket', 7.5, 0.15, -1.0, -1.6],
  ['speed_to_curve', 6.352, 0.0, 0.0, -5.0],
  ['pin_speed', 4.42, 0.0, 0.0, 0.0],
  ['max_speed', 12.0, 0.0, 0.0, 0.0],
  ['min_speed', 2.0, 0.0, 0.0, 0.0],
  ['mixed', 7.5, -0.3, -2.0, 3.0],
  ['gutter', 8.0, 0.0, 2.0, -5.0],
];

const out = {};
for (const [name, speed, lateral, angleDeg, spin] of CASES) {
  const result = simulateRoll({
    speed, lateral_position: lateral,
    launch_angle: angleDeg * Math.PI / 180, spin_omega: spin,
  }, null, null, null, true);
  const deck = result.deck;
  out[name] = {
    knockdowns: result.knockdowns,
    standing_after: result.standing_after,
    elapsed: Number(deck.elapsed.toFixed(6)),
    first_contact_time: deck.first_contact_time === null ? null : Number(deck.first_contact_time.toFixed(6)),
    impact_speed: deck.impact_speed === null ? null : Number(deck.impact_speed.toFixed(6)),
    ball_x: Number(deck.ball.position[0].toFixed(6)),
    ball_z: Number(deck.ball.position[2].toFixed(6)),
    roll_down: Array.from(deck.roll_down).sort((a, b) => a - b),
    kickback_hits: deck.pins.reduce((n, p) => n + p.kickback_hits, 0),
    trajectory: deck.trajectory.filter((_, i) => i % 40 === 0)
      .map(([t, x, z]) => [Number(t.toFixed(4)), Number(x.toFixed(6)), Number(z.toFixed(6))]),
  };
}
const target = process.argv[2];
const text = JSON.stringify(out, null, 1);
if (target) fs.writeFileSync(target, text, 'utf8');
else console.log(text);
