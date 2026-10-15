// Compare the ported scoring / challenges / questions with the Python originals.
import fs from 'fs';

const [pyPath, jsPath] = process.argv.slice(2);
const py = JSON.parse(fs.readFileSync(pyPath, 'utf8').replace(/^\uFEFF/, ''));
const js = JSON.parse(fs.readFileSync(jsPath, 'utf8').replace(/^\uFEFF/, ''));

const problems = [];
function compare(label, a, b) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) problems.push(`${label}:\n    py=${sa}\n    js=${sb}`);
}

if (py.scoring.length !== js.scoring.length) problems.push('scoring length differs');
py.scoring.forEach((row, i) => {
  const other = js.scoring[i] || {};
  // The Python dump's 'scores' key was a leftover; compare the real fields.
  compare(`scoring[${i}].rolls`, row.rolls, other.rolls);
  compare(`scoring[${i}].frames`, row.frames, other.frames);
  compare(`scoring[${i}].marks`, row.marks, other.marks);
  compare(`scoring[${i}].cumulative`, row.cumulative, other.cumulative);
  compare(`scoring[${i}].current`, row.current, other.current);
  compare(`scoring[${i}].total`, row.total, other.total);
  compare(`scoring[${i}].complete`, row.complete, other.complete);
  compare(`scoring[${i}].current_frame`, row.current_frame, other.current_frame);
  compare(`scoring[${i}].standing`, row.standing, other.standing);
});

if (py.challenges.length !== js.challenges.length) problems.push('challenge count differs');
py.challenges.forEach((row, i) => {
  const other = js.challenges[i] || {};
  for (const key of Object.keys(row)) {
    if (key === 'answer' || key === 'aim_x' || key === 'aim_z') {
      if (Math.abs(row[key] - other[key]) > 1e-9) problems.push(`challenge[${i}].${key}: py=${row[key]} js=${other[key]}`);
    } else if (key === 'launch_values') {
      row[key].forEach((v, j) => {
        if (Math.abs(v - other[key][j]) > 1e-9) problems.push(`challenge[${i}].launch_values[${j}]: py=${v} js=${other[key][j]}`);
      });
    } else {
      compare(`challenge[${i}].${key}`, row[key], other[key]);
    }
  }
});

py.questions.forEach((row, i) => {
  const other = js.questions[i] || {};
  for (const key of Object.keys(row)) compare(`question[${i}].${key}`, row[key], other[key]);
});

console.log(`scoring cases: ${py.scoring.length}`);
console.log(`challenges: ${py.challenges.length}`);
console.log(`question samples: ${py.questions.length}`);
console.log(`problems: ${problems.length}`);
for (const line of problems.slice(0, 30)) console.log('  ' + line);
process.exit(problems.length ? 1 : 0);
