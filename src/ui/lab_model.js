// The Physics Lab's calculator model.
//
// The lab is a plan as well as a replay: the throw is described by five core
// values (speed, aim, hook, rolling deceleration and start position), and the
// readout adds the quantities that follow from them.
//
// Editing a readout is deterministic: the edited value picks the one core
// value it needs and every other core value is copied from the previous plan
// bit-for-bit. Locks are processed after the edit, so a lock either holds or
// the edit is rejected with the name of the value that cannot move.
//
// The time relation is the standard constant-acceleration travel to the head
// pin (distance d, initial speed v, deceleration b):
//
//     d = v t - 1/2 b t^2      =>      t = (v - sqrt(v^2 - 2 b d)) / b
//
// and the rest are the definitions the lab already shows:
//
//     vx = v sin(theta)        p = m v        K = 1/2 m v^2
//     spin = |(v / R, hook)|   a = -b
//
// The live replay keeps using the real simulation; this model is the plan
// BOWL launches and the numbers the calculator solves.

import * as config from '../config.js';

export const PLAN_KEYS = ['t', 'v', 'a', 'vx', 'spin', 'p', 'K'];
export const CORE_KEYS = ['v', 'angle', 'hook', 'a'];

const MASS = config.BALL_MASS;
const RADIUS = config.BALL_RADIUS;
const DISTANCE = config.LANE_LENGTH;
const GRAVITY = config.GRAVITY;

export const DEFAULT_LAB_PLAN = {
  v: 7.5,
  angle: -0.4,
  hook: -1.6,
  a: -config.ROLLING_FRICTION * GRAVITY,
  lateral: 0.20,
};

export const LAB_FIELDS = [
  { key: 'start', label: 'START X', unit: 'm', kind: 'core', default: 0.20 },
  { key: 'aim', label: 'AIM', unit: 'deg', kind: 'core', default: -0.4 },
  { key: 'hook', label: 'HOOK', unit: 'rad/s', kind: 'core', default: -1.6 },
  { key: 'speed', label: 'SPEED', unit: 'm/s', kind: 'core', default: 7.5 },
  { key: 'time', label: 'TIME t', unit: 's', kind: 'derived' },
  { key: 'accel', label: 'ACCEL a', unit: 'm/s2', kind: 'derived' },
  { key: 'sideways', label: 'SIDEWAYS vx', unit: 'm/s', kind: 'derived' },
  { key: 'momentum', label: 'MOMENTUM p', unit: 'kg m/s', kind: 'derived' },
  { key: 'energy', label: 'ENERGY K', unit: 'J', kind: 'derived' },
  { key: 'pins', label: 'PINS', unit: '', kind: 'outcome' },
];
export const LAB_FIELD_BY_KEY = Object.fromEntries(LAB_FIELDS.map((field) => [field.key, field]));

const LAB_UNIT_FACTORS = {
  m: { m: 1, cm: 0.01, mm: 0.001, km: 1000 },
  deg: { deg: 1, rad: 180 / Math.PI },
  'rad/s': { 'rad/s': 1 },
  'm/s': { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704 },
  s: { s: 1, min: 60, h: 3600 },
  'm/s2': { 'm/s2': 1, 'm/s^2': 1 },
  'kg m/s': { 'kgm/s': 1, 'kg*m/s': 1, 'kg/ms': 1 },
  J: { J: 1, kJ: 1000 },
};

export function fmtLab(value, decimals = 4) {
  if (!Number.isFinite(value)) return 'never';
  let text = Number(value).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0' || text === '') text = '0';
  return text;
}

export function parseOptionalValue(key, text) {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  if (!raw) return { value: null, error: null };
  const field = LAB_FIELD_BY_KEY[key];
  if (!field) return { value: null, error: 'Unknown field.' };
  const match = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(.*)$/);
  if (!match) return { value: null, error: 'Enter a number, or leave the field blank.' };
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return { value: null, error: 'Enter a finite number.' };
  const suffix = match[2].replace(/\s+/g, '').toLowerCase();
  if (!suffix) return { value, error: null };
  const factor = (LAB_UNIT_FACTORS[field.unit] || {})[suffix];
  if (factor === undefined) {
    return { value: null, error: `Use ${field.unit || 'a plain number'}.` };
  }
  return { value: value * factor, error: null };
}

function labValues(core) {
  const derived = planDerived(core);
  return {
    start: core.lateral,
    aim: core.angle,
    hook: core.hook,
    speed: core.v,
    time: derived.t,
    accel: core.a,
    sideways: derived.vx,
    momentum: derived.p,
    energy: derived.K,
    pins: null,
  };
}

function closeTo(a, b) {
  return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b)) + 1e-9;
}

function labConflict(previous, sources, key, message) {
  const core = { ...previous };
  return {
    ok: false, core, derived: planDerived(core), values: labValues(core),
    sources, conflict: key, message,
  };
}

export function solveLab(given = {}, previous = DEFAULT_LAB_PLAN) {
  const typed = {};
  const sources = { pins: 'outcome' };
  for (const field of LAB_FIELDS) {
    if (field.key === 'pins') continue;
    const value = given[field.key];
    if (Number.isFinite(value)) {
      typed[field.key] = value;
      sources[field.key] = 'typed';
    } else {
      sources[field.key] = 'auto';
    }
  }

  for (const key of ['speed', 'momentum', 'energy']) {
    if (typed[key] !== undefined && typed[key] < 0) {
      return labConflict(previous, sources, key,
        `${LAB_FIELD_BY_KEY[key].label} cannot be negative.`);
    }
  }
  if (typed.time !== undefined && typed.time <= 0) {
    return labConflict(previous, sources, 'time', 'TIME must be greater than zero.');
  }
  if (typed.accel !== undefined && typed.accel > 0) {
    return labConflict(previous, sources, 'accel',
      'The lane can only decelerate (ACCEL a must be <= 0).');
  }

  const speedCandidates = [];
  if (typed.speed !== undefined) speedCandidates.push({ key: 'speed', v: typed.speed });
  if (typed.momentum !== undefined) speedCandidates.push({ key: 'momentum', v: typed.momentum / MASS });
  if (typed.energy !== undefined) speedCandidates.push({ key: 'energy', v: Math.sqrt(2 * typed.energy / MASS) });
  let vTarget = null;
  let vSourceKey = null;
  if (speedCandidates.length) {
    vTarget = speedCandidates[0].v;
    vSourceKey = speedCandidates[0].key;
    for (const candidate of speedCandidates.slice(1)) {
      if (!closeTo(candidate.v, vTarget)) {
        return labConflict(previous, sources, candidate.key,
          `${LAB_FIELD_BY_KEY[candidate.key].label} and ${LAB_FIELD_BY_KEY[vSourceKey].label} disagree: they imply ${fmtLab(candidate.v)} and ${fmtLab(vTarget)} m/s.`);
      }
    }
  }

  const targets = {};
  if (vTarget !== null) targets.v = vTarget;
  const aimTarget = typed.aim;
  const sidewaysTarget = typed.sideways;
  if (vTarget !== null) {
    if (aimTarget !== undefined && sidewaysTarget !== undefined) {
      const expected = vTarget * Math.sin(aimTarget * Math.PI / 180);
      if (!closeTo(expected, sidewaysTarget)) {
        return labConflict(previous, sources, 'sideways',
          `SIDEWAYS ${fmtLab(sidewaysTarget)} m/s disagrees with SPEED ${fmtLab(vTarget)} m/s and AIM ${fmtLab(aimTarget)} deg.`);
      }
      targets.angle = aimTarget;
    } else if (aimTarget !== undefined) {
      targets.angle = aimTarget;
    } else if (sidewaysTarget !== undefined) {
      targets.vx = sidewaysTarget;
    }
  } else {
    if (aimTarget !== undefined) targets.angle = aimTarget;
    if (sidewaysTarget !== undefined) targets.vx = sidewaysTarget;
  }
  if (typed.hook !== undefined) targets.hook = typed.hook;

  const accelTarget = typed.accel;
  const timeTarget = typed.time;
  if (accelTarget !== undefined && timeTarget !== undefined) {
    const decel = -accelTarget;
    const impliedV = DISTANCE / timeTarget + 0.5 * decel * timeTarget;
    if (vTarget !== null && !closeTo(impliedV, vTarget)) {
      return labConflict(previous, sources, 'time',
        `TIME ${fmtLab(timeTarget)} s and ACCEL ${fmtLab(accelTarget)} m/s2 imply SPEED ${fmtLab(impliedV)} m/s, which disagrees with ${fmtLab(vTarget)} m/s.`);
    }
    targets.a = accelTarget;
    if (vTarget === null) targets.t = timeTarget;
  } else if (accelTarget !== undefined) {
    targets.a = accelTarget;
  } else if (timeTarget !== undefined) {
    targets.t = timeTarget;
  }

  const result = solvePlan(previous, targets);
  if (!result.ok) {
    let key = result.conflict;
    if (key === 'v' && vSourceKey) key = vSourceKey;
    else key = {
      v: 'speed', angle: 'aim', hook: 'hook', a: 'accel',
      vx: 'sideways', t: 'time', p: 'momentum', K: 'energy',
    }[key] || key;
    return labConflict(previous, sources, key,
      `No plan satisfies the current values (conflict at ${LAB_FIELD_BY_KEY[key] ? LAB_FIELD_BY_KEY[key].label : key}).`);
  }

  const core = {
    ...result.core,
    lateral: typed.start !== undefined ? typed.start : previous.lateral,
  };
  const derived = planDerived(core);
  const violations = [
    ['start', core.lateral],
    ['aim', core.angle],
    ['hook', core.hook],
    ['speed', core.v],
    ['time', derived.t],
    ['accel', core.a],
    ['sideways', derived.vx],
    ['momentum', derived.p],
    ['energy', derived.K],
  ];
  for (const [key, actual] of violations) {
    const wanted = typed[key];
    if (wanted === undefined) continue;
    if (!Number.isFinite(actual) || !closeTo(actual, wanted)) {
      return labConflict(previous, sources, key,
        `${LAB_FIELD_BY_KEY[key].label} cannot satisfy the other values (${LAB_FIELD_BY_KEY[key].label} would be ${fmtLab(actual)}, not ${fmtLab(wanted)}).`);
    }
  }

  const values = labValues(core);
  for (const key of Object.keys(typed)) values[key] = typed[key];
  return {
    ok: true, core, derived, values, sources, conflict: null, message: '',
  };
}

const LAB_FIND_KEYS = ['time', 'speed', 'accel', 'sideways', 'momentum', 'energy'];

export function findField(given = {}, find, previous = DEFAULT_LAB_PLAN) {
  if (!LAB_FIND_KEYS.includes(find)) {
    return {
      ok: false, find, conflict: find,
      message: `${LAB_FIELD_BY_KEY[find] ? LAB_FIELD_BY_KEY[find].label : find} is a direct input and cannot be derived from the other panel values.`,
    };
  }
  const typedFind = Number.isFinite(given[find]) ? given[find] : null;
  const rest = { ...given };
  delete rest[find];
  const alreadyGiven = typedFind !== null;
  const result = alreadyGiven ? solveLab(given, previous) : solveLab(rest, previous);
  if (!result.ok) return { ...result, ok: false, find };
  const value = result.values[find];
  if (!Number.isFinite(value)) {
    return {
      ok: false, find, conflict: find,
      message: `${LAB_FIELD_BY_KEY[find].label} never reaches a finite value with these inputs.`,
    };
  }

  const v = result.core.v;
  const a = result.core.a;
  const b = -a;
  const angle = result.core.angle;
  const using = [];
  const auto = [];
  for (const field of LAB_FIELDS) {
    if (field.key === 'pins' || field.key === find) continue;
    if (result.sources[field.key] === 'typed') {
      using.push(`${field.label} = ${fmtLab(given[field.key])} ${field.unit}`);
    } else if (Number.isFinite(result.values[field.key])) {
      auto.push(`${field.label} = ${fmtLab(result.values[field.key])} ${field.unit} (auto)`);
    }
  }

  let formula = '';
  let substitution = '';
  let calculation = [];
  if (find === 'time') {
    if (Math.abs(a) < 1e-9) {
      formula = 't = d / v';
      substitution = `t = ${fmtLab(DISTANCE)} / ${fmtLab(v)}`;
      calculation = [`t = ${fmtLab(DISTANCE / v)} s`];
    } else {
      formula = 't = (v - sqrt(v^2 - 2 b d)) / b   (b = -a)';
      substitution = `t = (${fmtLab(v)} - sqrt(${fmtLab(v)}^2 - 2 x ${fmtLab(b)} x ${fmtLab(DISTANCE)})) / ${fmtLab(b)}`;
      const discriminant = v * v - 2 * b * DISTANCE;
      calculation = [
        `b = -a = ${fmtLab(b)} m/s2`,
        `discriminant = ${fmtLab(discriminant)}`,
        `t = ${fmtLab(value)} s`,
      ];
    }
  } else if (find === 'speed') {
    if (Number.isFinite(given.momentum)) {
      formula = 'v = p / m';
      substitution = `v = ${fmtLab(given.momentum)} / ${fmtLab(MASS)}`;
      calculation = [`v = ${fmtLab(value)} m/s`];
    } else if (Number.isFinite(given.energy)) {
      formula = 'v = sqrt(2K / m)';
      substitution = `v = sqrt(2 x ${fmtLab(given.energy)} / ${fmtLab(MASS)})`;
      calculation = [`v = ${fmtLab(value)} m/s`];
    } else if (Number.isFinite(given.time)) {
      formula = 'v = d / t + 0.5 b t   (b = -a)';
      substitution = `v = ${fmtLab(DISTANCE)} / ${fmtLab(given.time)} + 0.5 x ${fmtLab(b)} x ${fmtLab(given.time)}`;
      calculation = [`v = ${fmtLab(value)} m/s`];
    } else if (Number.isFinite(given.sideways) && Math.abs(Math.sin(angle * Math.PI / 180)) > 1e-9) {
      formula = 'v = vx / sin(aim)';
      substitution = `v = ${fmtLab(given.sideways)} / sin(${fmtLab(angle)} deg)`;
      calculation = [`v = ${fmtLab(value)} m/s`];
    } else {
      formula = 'v = documented default';
      substitution = `v = ${fmtLab(value)} m/s`;
      calculation = ['No typed value determines speed; the default plan is used.'];
    }
  } else if (find === 'accel') {
    if (Number.isFinite(given.time)) {
      formula = 'a = -2(v t - d) / t^2';
      substitution = `a = -2(${fmtLab(v)} x ${fmtLab(given.time)} - ${fmtLab(DISTANCE)}) / ${fmtLab(given.time)}^2`;
      calculation = [`a = ${fmtLab(value)} m/s2`];
    } else {
      formula = 'a = documented default';
      substitution = `a = ${fmtLab(value)} m/s2`;
      calculation = ['No typed value determines acceleration; the default plan is used.'];
    }
  } else if (find === 'sideways') {
    formula = 'vx = v sin(aim)';
    substitution = `vx = ${fmtLab(v)} sin(${fmtLab(angle)} deg)`;
    calculation = [`vx = ${fmtLab(value)} m/s`];
  } else if (find === 'momentum') {
    formula = 'p = m v';
    substitution = `p = ${fmtLab(MASS)} x ${fmtLab(v)}`;
    calculation = [`p = ${fmtLab(value)} kg m/s`];
  } else if (find === 'energy') {
    formula = 'K = 0.5 m v^2';
    substitution = `K = 0.5 x ${fmtLab(MASS)} x ${fmtLab(v)}^2`;
    calculation = [`K = ${fmtLab(value)} J`];
  }

  const assumptions = [
    `Lane distance d = ${fmtLab(DISTANCE)} m to the head pin`,
    `Ball mass m = ${fmtLab(MASS)} kg`,
    `Gravity g = ${fmtLab(GRAVITY)} m/s2`,
    'Constant deceleration a from the panel',
    'START X, AIM and HOOK are direct throw inputs',
    'Blank fields use the documented default plan',
  ];
  const label = LAB_FIELD_BY_KEY[find].label;
  const note = typedFind !== null
    ? `${label} is already given as ${fmtLab(typedFind)} ${LAB_FIELD_BY_KEY[find].unit}; the rest of the panel computes ${fmtLab(value)} ${LAB_FIELD_BY_KEY[find].unit}.`
    : `${label} is auto-filled from the other panel values.`;
  return {
    ok: true, find, value, answer: `${find} = ${fmtLab(value)} ${LAB_FIELD_BY_KEY[find].unit}`,
    formula, substitution, calculation, using, auto, assumptions,
    note, alreadyGiven: typedFind !== null, result,
  };
}

// Which core value each readout is allowed to move, in preference order.
// The first free candidate is claimed; if every candidate is already claimed
// by an earlier target, the two targets conflict.
const CANDIDATES = {
  v: ['v'], p: ['v'], K: ['v'],
  angle: ['angle'], hook: ['hook'], a: ['a'],
  vx: ['angle', 'v'],
  spin: ['hook', 'v'],
  t: ['v', 'a'],
};

// Dependencies of a (target, knob) pair on the other core values.
const DEPENDENCIES = {
  vx: { v: ['angle'], angle: ['v'] },
  spin: { v: ['hook'], hook: ['v'] },
  t: { v: ['a'], a: ['v'] },
};

function dependenciesFor(key, knob) {
  const table = DEPENDENCIES[key];
  return table && table[knob] ? table[knob] : [];
}

export function decelerationToScale(a) {
  const base = config.ROLLING_FRICTION * config.GRAVITY;
  if (base <= 1e-12) return 1.0;
  return Math.max(0.0, -Number(a || 0)) / base;
}

export function scaleToDeceleration(scale) {
  return -config.ROLLING_FRICTION * config.GRAVITY * Math.max(0.0, Number(scale || 0));
}

export function headPinTime(v, a) {
  const speed = Math.max(0.0, Number(v) || 0.0);
  const decel = Math.max(0.0, -(Number(a) || 0.0));
  if (speed <= 1e-9) return Infinity;
  if (decel <= 1e-12) return DISTANCE / speed;
  const discriminant = speed * speed - 2.0 * decel * DISTANCE;
  if (discriminant < 0.0) return Infinity;       // stops before the head pin
  return (speed - Math.sqrt(discriminant)) / decel;
}

export function planDerived(core) {
  const v = Math.max(0.0, Number(core.v) || 0.0);
  const angleDeg = Number(core.angle) || 0.0;
  const angle = angleDeg * Math.PI / 180.0;
  const hook = Number(core.hook) || 0.0;
  const a = Math.min(0.0, Number(core.a) || 0.0);
  const lateral = Number(core.lateral) || 0.0;
  const vx = v * Math.sin(angle);
  const vz = v * Math.cos(angle);
  const spin = Math.hypot(v / RADIUS, hook);
  const angular = [
    vz / RADIUS + (v > 1e-9 ? (vx / v) * hook : 0.0),
    0.0,
    -vx / RADIUS + (v > 1e-9 ? (vz / v) * hook : 0.0),
  ];
  return {
    t: headPinTime(v, a), v, a, vx, spin,
    p: MASS * v,
    K: 0.5 * MASS * v * v,
    angle: angleDeg, hook, lateral, vz, angular,
    frictionScale: decelerationToScale(a),
  };
}

function conflictResult(core, targets, key) {
  return {
    ok: false, core: { ...core }, derived: planDerived(core),
    error: Infinity, targets, conflict: key,
  };
}

function knobIsResolved(knob, decisions) {
  const decision = decisions.find((entry) => entry.knob === knob);
  return !decision || decision.resolved;
}

function solveDecision(decision, core) {
  const { key, value, knob } = decision;

  if (knob === 'v') {
    if (key === 'v') core.v = Math.max(0.0, value);
    else if (key === 'p') core.v = Math.max(0.0, value / MASS);
    else if (key === 'K') core.v = Math.sqrt(Math.max(0.0, 2.0 * value / MASS));
    else if (key === 'vx') {
      const sine = Math.sin(core.angle * Math.PI / 180.0);
      if (Math.abs(sine) < 1e-12) return false;
      core.v = value / sine;
      if (!Number.isFinite(core.v) || core.v < 0.0) return false;
    } else if (key === 'spin') {
      const room = value * value - core.hook * core.hook;
      if (room < -1e-9) return false;
      core.v = RADIUS * Math.sqrt(Math.max(0.0, room));
    } else if (key === 't') {
      const decel = Math.max(0.0, -core.a);
      core.v = DISTANCE / value + 0.5 * decel * value;
    }
  } else if (knob === 'angle') {
    if (key === 'angle') core.angle = value;
    else if (key === 'vx') {
      if (core.v <= 1e-12) {
        if (Math.abs(value) > 1e-12) return false;
        // vx = 0 is true for every aim: keep the aim the player already had.
      } else {
        const ratio = value / core.v;
        if (Math.abs(ratio) > 1.0 + 1e-9) return false;
        core.angle = Math.asin(Math.max(-1.0, Math.min(1.0, ratio))) * 180.0 / Math.PI;
      }
    }
  } else if (knob === 'hook') {
    if (key === 'hook') core.hook = value;
    else if (key === 'spin') {
      const rolling = core.v / RADIUS;
      const room = value * value - rolling * rolling;
      if (room < -1e-9) return false;
      const sign = core.hook < 0.0 ? -1.0 : 1.0;
      core.hook = sign * Math.sqrt(Math.max(0.0, room));
    }
  } else if (knob === 'a') {
    if (key === 'a') core.a = value < 0.0 ? value : 0.0;
    else if (key === 't') {
      const decel = 2.0 * (core.v * value - DISTANCE) / (value * value);
      if (decel < -1e-9) return false;
      core.a = -Math.max(0.0, decel);
    }
  }
  return Number.isFinite(core.v) && Number.isFinite(core.angle)
    && Number.isFinite(core.hook) && Number.isFinite(core.a);
}

// Solve for the core values that satisfy `targets` in order, freezing every
// core value no target claims. Returns `{ ok, core, derived, error, targets,
// conflict }`; `conflict` names the target that could not be satisfied.
export function solvePlan(previous, targets) {
  const clean = {};
  for (const [key, raw] of Object.entries(targets || {})) {
    if (!(key in CANDIDATES)) continue;
    let value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (key === 'a') value = Math.abs(value) > 0 ? -Math.abs(value) : 0;
    clean[key] = value;
  }
  const keys = Object.keys(clean);
  const previousA = Number(previous.a) || 0.0;
  const core = {
    v: Math.max(0.0, Number(previous.v) || 0.0),
    angle: Number(previous.angle) || 0.0,
    hook: Number(previous.hook) || 0.0,
    a: previousA < 0.0 ? previousA : 0.0,
    lateral: Number(previous.lateral) || 0.0,
  };
  if (!keys.length) {
    return {
      ok: true, core, derived: planDerived(core), error: 0.0,
      targets: clean, conflict: null,
    };
  }

  for (const key of keys) {
    const value = clean[key];
    if (key === 't' && value <= 0.0) return conflictResult(core, clean, key);
    if ((key === 'p' || key === 'K') && value < 0.0) return conflictResult(core, clean, key);
    if (key === 'spin' && value <= 0.0) return conflictResult(core, clean, key);
  }

  function assign(index, used, decisions) {
    if (index === keys.length) return decisions.slice();
    const key = keys[index];
    for (const knob of CANDIDATES[key]) {
      if (used.has(knob)) continue;
      used.add(knob);
      decisions.push({
        key, value: clean[key], knob, resolved: false,
        deps: dependenciesFor(key, knob),
      });
      const result = assign(index + 1, used, decisions);
      if (result) return result;
      decisions.pop();
      used.delete(knob);
    }
    return null;
  }

  const decisions = assign(0, new Set(), []);
  if (!decisions) {
    // Name a target that has no remaining candidate under a simple pass, so
    // the UI can say which lock/value could not move.
    const used = new Set();
    let blocker = keys[0];
    for (const key of keys) {
      const knob = CANDIDATES[key].find((candidate) => !used.has(candidate));
      if (!knob) { blocker = key; break; }
      used.add(knob);
    }
    return conflictResult(core, clean, blocker);
  }

  let progress = true;
  while (progress) {
    progress = false;
    for (const decision of decisions) {
      if (decision.resolved) continue;
      if (!decision.deps.every((dep) => knobIsResolved(dep, decisions))) continue;
      if (!solveDecision(decision, core)) {
        return conflictResult(core, clean, decision.key);
      }
      decision.resolved = true;
      progress = true;
    }
  }
  const unresolved = decisions.find((decision) => !decision.resolved);
  if (unresolved) return conflictResult(core, clean, unresolved.key);

  const derived = planDerived(core);
  for (const key of keys) {
    const target = clean[key];
    const computed = derived[key];
    const tolerance = 1e-9 * Math.max(1.0, Math.abs(target)) + 1e-9;
    if (!Number.isFinite(computed) || Math.abs(computed - target) > tolerance) {
      return conflictResult(core, clean, key);
    }
  }
  return {
    ok: true, core, derived, error: 0.0, targets: clean, conflict: null,
  };
}
