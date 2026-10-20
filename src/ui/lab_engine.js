// General relation engine shared by every Physics Lab mode.
//
// A relation is a formula with a list of variables:
//
//   { id, name, formula, vars, residual(values),
//     solveFor: { key: (values) => number | { value, expr, sub, note, others } },
//     range: { key: [min, max] }, scale(values) }
//
// The engine seeds typed and locked values, then repeatedly applies the
// simplest relation that has exactly one unknown. Closed forms are preferred;
// a bracketing bisection solver covers the directions a relation did not
// rearrange by hand. Soft defaults are activated one at a time and only when
// the typed values have not already determined the quantity they describe.
//
// The result is deliberately the same shape the Lab UI already consumes:
// values, sources, work, status, message, conflictKeys, missing, suggestions.

import { fmt } from './lab_solver.js';

export const REL_TOL = 1e-6;
export const ROUNDED_TOL = 0.005;
const EPS = 1e-9;
const MAX_STEPS = 96;

export class Impossible extends Error {
  constructor(message, fix = '') {
    super(message);
    this.name = 'Impossible';
    this.fix = fix;
  }
}

export class Ambiguous extends Error {
  constructor(message) {
    super(message);
    this.name = 'Ambiguous';
  }
}

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function cloneValues(values) {
  return { ...values };
}

function labelOf(meta, key) {
  return (meta && meta[key] && meta[key].label) || key;
}

function unitOf(meta, key) {
  return (meta && meta[key] && meta[key].unit) || '';
}

function withUnit(meta, key, value) {
  const unit = unitOf(meta, key);
  return unit ? `${fmt(value)} ${unit}` : fmt(value);
}

function normaliseResult(result, meta, key) {
  if (isNum(result)) return { value: result };
  if (Array.isArray(result)) return { candidates: result.filter(isNum) };
  if (!result || !isNum(result.value)) return null;
  return {
    value: result.value,
    expr: result.expr || '',
    sub: result.sub || '',
    note: result.note || '',
    others: Array.isArray(result.others) ? result.others.filter(isNum) : [],
  };
}

// Pick a root. Catalogs can override this per variable; the defaults match
// the class-notes conventions: times are non-negative, speeds positive, and
// the first (lower) angle is preferred with the other reported as "also valid".
function chooseRoot(key, candidates, values, meta, pick) {
  let list = candidates.filter((value) => isNum(value));
  if (!list.length) return null;
  const range = (meta && meta[key] && meta[key].range) || null;
  if (range) list = list.filter((value) => value >= range[0] - EPS && value <= range[1] + EPS);
  if (!list.length) return null;
  if (typeof pick === 'function') {
    const chosen = pick(key, list, values);
    if (isNum(chosen)) return chosen;
    if (chosen && isNum(chosen.value)) return chosen.value;
  }
  if (meta && meta[key] && isNum(meta[key].min)) {
    const positive = list.filter((value) => value >= meta[key].min - EPS);
    if (positive.length) list = positive;
  }
  if (key === 't' || key === 'T' || key === 'timeApex' || key === 'tTarget') {
    const positive = list.filter((value) => value >= -EPS);
    if (positive.length) list = positive;
    list.sort((left, right) => left - right);
  } else if (key === 'angle' || key === 'landingAngle') {
    list.sort((left, right) => Math.abs(left) - Math.abs(right));
  } else {
    list.sort((left, right) => Math.abs(left) - Math.abs(right));
  }
  return list[0];
}

function otherRoots(key, chosen, candidates) {
  return candidates.filter((value) => isNum(value)
    && Math.abs(value - chosen) > 1e-7 * Math.max(1, Math.abs(value)));
}

function checkRange(key, value, meta) {
  if (!isNum(value)) throw new Impossible('That can\'t happen with these values.');
  const range = (meta && meta[key] && meta[key].range) || null;
  if (range && (value < range[0] - 1e-7 || value > range[1] + 1e-7)) {
    const unit = unitOf(meta, key);
    throw new Impossible(
      `${labelOf(meta, key)} would be ${fmt(value)}${unit ? ` ${unit}` : ''}, outside the valid range.`);
  }
  if (meta && meta[key] && isNum(meta[key].min) && value < meta[key].min - 1e-7) {
    const unit = unitOf(meta, key);
    if (key === 't' || key === 'T' || key === 'tTarget') {
      throw new Impossible(
        `The math gives a negative time (${fmt(value)} s), which has no physical solution.`,
        'Try a bigger speed or a smaller distance.');
    }
    throw new Impossible(
      `${labelOf(meta, key)} would be ${fmt(value)}${unit ? ` ${unit}` : ''}, below the valid minimum.`);
  }
  return value;
}

// --- Numeric root finder -----------------------------------------------------

function numericRoots(relation, key, values, meta) {
  const range = (relation.range && relation.range[key])
    || (meta && meta[key] && meta[key].range)
    || [-1e6, 1e6];
  let [low, high] = range;
  if (!(high > low)) [low, high] = [-1e6, 1e6];
  const evaluate = (x) => {
    const trial = { ...values, [key]: x };
    try {
      const residual = relation.residual(trial);
      return isNum(residual) ? residual : null;
    } catch (_error) {
      return null;
    }
  };
  // Sample densely near zero and logarithmically on the positive side: many
  // physical answers (gravity, speed, radius) live just above zero while the
  // declared search range reaches 1e6.
  const xs = [];
  const push = (x) => {
    if (!Number.isFinite(x) || x < low - 1e-12 || x > high + 1e-12) return;
    xs.push(x);
  };
  if (low < 0 && high > 0) {
    for (let i = 0; i <= 700; i += 1) push(low + ((0 - low) * i) / 700);
    const start = Math.max(low, 1e-9);
    for (let i = 0; i <= 900; i += 1) {
      push(start * (high / start) ** (i / 900));
    }
  } else if (low >= 0) {
    const start = Math.max(low, 1e-9);
    for (let i = 0; i <= 1400; i += 1) {
      push(start * (high / start) ** (i / 1400));
    }
  } else {
    for (let i = 0; i <= 1400; i += 1) push(low + ((high - low) * i) / 1400);
  }
  xs.sort((a, b) => a - b);
  const roots = [];
  let previousX = null;
  let previous = null;
  for (const x of xs) {
    if (previousX !== null && Math.abs(x - previousX) < 1e-15) continue;
    const value = evaluate(x);
    if (value !== null) {
      if (Math.abs(value) < 1e-10) {
        roots.push(x);
      } else if (previous !== null && previous * value < 0) {
        let a = previousX;
        let b = x;
        let fa = previous;
        for (let j = 0; j < 90; j += 1) {
          const mid = (a + b) / 2;
          const fm = evaluate(mid);
          if (fm === null) break;
          if (Math.abs(fm) < 1e-12) { a = mid; b = mid; break; }
          if (fa * fm <= 0) { b = mid; } else { a = mid; fa = fm; }
        }
        roots.push((a + b) / 2);
      }
    }
    previousX = x;
    previous = value;
  }
  // Deduplicate.
  const unique = [];
  for (const root of roots) {
    if (!unique.some((value) => Math.abs(value - root) < 1e-6 * Math.max(1, Math.abs(root)))) {
      unique.push(root);
    }
  }
  return unique;
}

function solveRelationFor(relation, key, values, context) {
  const { meta, pick } = context;
  const closed = relation.solveFor && relation.solveFor[key];
  let closedError = null;
  if (typeof closed === 'function') {
    let result;
    try {
      result = normaliseResult(closed(values, context), meta, key);
    } catch (error) {
      if (error instanceof Impossible) throw error;
      if (error instanceof Ambiguous) closedError = error;
      else throw new Impossible(`That can't happen in ${relation.formula}.`);
    }
    if (result) {
      if (result.candidates) {
        const chosen = chooseRoot(key, result.candidates, values, meta, pick);
        if (chosen === null) {
          throw new Impossible(`No valid ${labelOf(meta, key).toLowerCase()} satisfies ${relation.formula}.`,
            relation.fix || '');
        }
        const others = otherRoots(key, chosen, result.candidates);
        return {
          value: chosen,
          expr: key,
          sub: fmt(chosen),
          note: others.length
            ? `Also valid: ${others.map((value) => withUnit(meta, key, value)).join(', ')}.`
            : '',
          others,
        };
      }
      checkRange(key, result.value, meta);
      return result;
    }
  }
  // Numeric fallback: enumerate every root, then choose one.
  const roots = numericRoots(relation, key, values, meta);
  if (closedError && roots.length > 2) throw closedError;
  const chosen = chooseRoot(key, roots, values, meta, pick);
  if (chosen === null) {
    if (closedError) throw closedError;
    throw new Impossible(
      `No value of ${labelOf(meta, key).toLowerCase()} satisfies ${relation.formula} with these values.`,
      relation.fix || '');
  }
  checkRange(key, chosen, meta);
  const others = otherRoots(key, chosen, roots);
  return {
    value: chosen,
    expr: key,
    sub: fmt(chosen),
    note: others.length
      ? `Also valid: ${others.map((value) => withUnit(meta, key, value)).join(', ')}.`
      : '',
    others,
  };
}

// --- Coupled numeric solve (fallback) ---------------------------------------
//
// Small Newton solve for a square set of relations. Used only when ordinary
// propagation stalls. Several deterministic starts are tried so that a root
// in a different basin (the low and high launch angles, for example) is found.

function coupledSolve(relations, unknownKeys, values, context) {
  const starts = [];
  const base = unknownKeys.map((key) => {
    const sample = context.samples && isNum(context.samples[key]) ? context.samples[key] : 1;
    return sample;
  });
  starts.push(base);
  for (const key of unknownKeys) {
    for (const offset of [-2, -0.5, 0.5, 2]) {
      const start = base.slice();
      start[unknownKeys.indexOf(key)] += offset;
      starts.push(start);
    }
  }
  const residualOf = (trial) => {
    const merged = { ...values };
    unknownKeys.forEach((key, index) => { merged[key] = trial[index]; });
    return relations.map((relation) => {
      try {
        const residual = relation.residual(merged);
        return isNum(residual) ? residual : NaN;
      } catch (_error) {
        return NaN;
      }
    });
  };
  for (const start of starts) {
    let x = start.slice();
    let converged = false;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const f = residualOf(x);
      if (f.some((value) => !Number.isFinite(value))) break;
      const scale = Math.max(1, ...f.map(Math.abs));
      if (Math.max(...f.map(Math.abs)) < 1e-10 * scale) { converged = true; break; }
      const n = x.length;
      const jacobian = Array.from({ length: n }, () => Array(n).fill(0));
      for (let column = 0; column < n; column += 1) {
        const step = 1e-6 * Math.max(1, Math.abs(x[column]));
        const shifted = x.slice();
        shifted[column] += step;
        const fs = residualOf(shifted);
        for (let row = 0; row < n; row += 1) {
          jacobian[row][column] = (fs[row] - f[row]) / step;
        }
      }
      // Gaussian elimination with partial pivoting.
      const matrix = jacobian.map((row, index) => [...row, -f[index]]);
      let singular = false;
      for (let column = 0; column < n; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < n; row += 1) {
          if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
        }
        if (Math.abs(matrix[pivot][column]) < 1e-14) { singular = true; break; }
        [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
        for (let row = column + 1; row < n; row += 1) {
          const factor = matrix[row][column] / matrix[column][column];
          for (let k = column; k <= n; k += 1) matrix[row][k] -= factor * matrix[column][k];
        }
      }
      if (singular) break;
      const delta = Array(n).fill(0);
      for (let row = n - 1; row >= 0; row -= 1) {
        let sum = matrix[row][n];
        for (let column = row + 1; column < n; column += 1) sum -= matrix[row][column] * delta[column];
        delta[row] = sum / matrix[row][row];
      }
      // Damped step keeps the iteration inside a sensible range.
      const damp = Math.min(1, 10 / Math.max(1, ...delta.map(Math.abs)));
      x = x.map((value, index) => value + delta[index] * damp);
    }
    if (converged) {
      // Reject a numerically singular system: two copies of the same
      // constraint (R and target distance, for example) leave a free variable.
      const f = residualOf(x);
      const n = x.length;
      if (n > 1) {
        const jacobian = Array.from({ length: n }, () => Array(n).fill(0));
        for (let column = 0; column < n; column += 1) {
          const step = 1e-6 * Math.max(1, Math.abs(x[column]));
          const shifted = x.slice();
          shifted[column] += step;
          const fs = residualOf(shifted);
          for (let row = 0; row < n; row += 1) {
            jacobian[row][column] = (fs[row] - f[row]) / step;
          }
        }
        const norm = Math.max(1, ...jacobian.flat().map(Math.abs));
        const singularFloor = 1e-6 * norm ** n;
        let determinant = 1;
        const matrix = jacobian.map((row) => row.slice());
        for (let column = 0; column < n; column += 1) {
          let pivot = column;
          for (let row = column + 1; row < n; row += 1) {
            if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
          }
          if (Math.abs(matrix[pivot][column]) < singularFloor / norm) { determinant = 0; break; }
          [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
          determinant *= matrix[column][column];
          for (let row = column + 1; row < n; row += 1) {
            const factor = matrix[row][column] / matrix[column][column];
            for (let k = column; k < n; k += 1) matrix[row][k] -= factor * matrix[column][k];
          }
        }
        if (determinant === 0) continue;
      }
      const result = {};
      unknownKeys.forEach((key, index) => { result[key] = x[index]; });
      return result;
    }
  }
  return null;
}

// --- Main solver -------------------------------------------------------------

function relationScale(relation, values) {
  if (typeof relation.scale === 'function') {
    const value = relation.scale(values);
    return isNum(value) && value > 0 ? value : 1;
  }
  const magnitudes = relation.vars.map((key) => Math.abs(values[key])).filter(isNum);
  return Math.max(1, ...magnitudes);
}

function predictedFor(relation, blame, values, context) {
  try {
    return solveRelationFor(relation, blame, values, context);
  } catch (_error) {
    return null;
  }
}

function conflictOf(relation, values, sources, context, editedKey) {
  const typed = relation.vars.filter((key) => sources[key] === 'known');
  const order = context.blameOrder || ['t', 'T', 's', 'distance', 'v', 'finalSpeed', 'u', 'speed', 'a', 'accel'];
  const ranked = [...typed].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
  });
  let blame = editedKey && typed.includes(editedKey)
    ? editedKey
    : ranked[0] || typed[0] || relation.vars.find((key) => isNum(values[key])) || relation.vars[0];
  // Prefer a typed value that the relation can predict from the others.
  const candidates = typed.length ? [blame, ...ranked.filter((key) => key !== blame)] : relation.vars.filter((key) => isNum(values[key]));
  let predicted = null;
  for (const key of candidates) {
    const trial = predictedFor(relation, key, values, context);
    if (trial && isNum(trial.value)) { blame = key; predicted = trial; break; }
  }
  const meta = context.meta;
  const message = predicted
    ? `${labelOf(meta, blame)} should be ${withUnit(meta, blame, predicted.value)}, not ${fmt(values[blame])}.`
    : `These values do not satisfy ${relation.formula}.`;
  return {
    relation,
    blame,
    predicted: predicted ? predicted.value : null,
    message,
    keys: new Set(predicted ? [blame] : (candidates.length ? candidates : relation.vars)),
  };
}

function findConflict(values, sources, context) {
  for (const relation of context.relations) {
    if (!relation.vars.every((key) => isNum(values[key]))) continue;
    const residual = Math.abs(relation.residual(values));
    const typedCount = relation.vars.filter((key) => sources[key] === 'known').length;
    const tolerance = (typedCount >= 3 ? context.roundedTol : context.relTol)
      * relationScale(relation, values);
    if (residual > tolerance) return conflictOf(relation, values, sources, context, context.editedKey);
  }
  return null;
}

function propagate(values, sources, state, context) {
  let steps = 0;
  while (steps < MAX_STEPS) {
    steps += 1;
    const conflict = findConflict(values, sources, context);
    if (conflict) return conflict;

    let chosen = null;
    for (const relation of context.relations) {
      const unknown = relation.vars.filter((key) => !isNum(values[key]));
      if (unknown.length !== 1) continue;
      const key = unknown[0];
      let result;
      try {
        result = solveRelationFor(relation, key, values, context);
      } catch (error) {
        if (error instanceof Ambiguous) continue;
        if (error instanceof Impossible) throw error;
        throw new Impossible(`That can't happen in ${relation.formula}.`);
      }
      chosen = { relation, key, result };
      break;
    }
    if (!chosen) return null;

    values[chosen.key] = chosen.result.value;
    sources[chosen.key] = 'solved';
    if (!state.work.some((entry) => entry.key === chosen.key)) {
      state.work.push({
        key: chosen.key,
        label: labelOf(context.meta, chosen.key),
        symbol: (context.meta[chosen.key] && context.meta[chosen.key].symbol) || chosen.key,
        unit: unitOf(context.meta, chosen.key),
        equation: chosen.relation.id,
        equationName: chosen.relation.name,
        formula: chosen.relation.formula,
        expr: chosen.result.expr || chosen.key,
        sub: chosen.result.sub || fmt(chosen.result.value),
        value: chosen.result.value,
        note: chosen.result.note || '',
        others: chosen.result.others || [],
        softUsed: [...state.softUsed],
      });
      if (chosen.result.others && chosen.result.others.length) {
        state.alsoValid[chosen.key] = chosen.result.others.slice();
      }
    }
  }
  throw new Impossible('The solver did not converge; check the values.');
}

function activateSoft(values, sources, state, context) {
  for (const soft of context.soft) {
    if (context.goal && allKnown(context.goal, values)) break;
    if (isNum(values[soft.key])) continue;
    if (typeof soft.when === 'function' && !soft.when(values, context)) continue;
    let value = soft.value;
    if (typeof value === 'function') {
      try {
        value = value(values, context);
      } catch (_error) {
        continue;
      }
    }
    if (!isNum(value)) continue;
    const snapshot = cloneValues(values);
    const snapshotSources = { ...sources };
    const snapshotSoft = [...state.softUsed];
    const snapshotWork = state.work.length;
    const snapshotAlso = { ...state.alsoValid };
    values[soft.key] = value;
    sources[soft.key] = 'auto';
    if (!state.softUsed.includes(soft.key)) state.softUsed.push(soft.key);
    try {
      const conflict = propagate(values, sources, state, context);
      if (conflict) throw conflict;
    } catch (error) {
      if (error instanceof Impossible && soft.fatal) throw error;
      // The default would over-determine something the player typed. Drop it
      // silently: soft defaults never create contradictions.
      Object.assign(values, {});
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, snapshot);
      for (const key of Object.keys(sources)) delete sources[key];
      Object.assign(sources, snapshotSources);
      state.softUsed = snapshotSoft;
      state.work.length = snapshotWork;
      state.alsoValid = snapshotAlso;
    }
  }
}

function allKnown(goal, values) {
  return goal.every((key) => isNum(values[key]));
}

// Structural diagnosis: try one candidate at a time, then pairs and triples,
// and keep only the smallest set that actually makes the requested variable
// (or the whole goal) solvable. The chips show that set; once the player adds
// one, the next call diagnoses the remainder.
function diagnose(values, sources, state, context) {
  const goal = context.focusKey ? [context.focusKey] : context.goal;
  const candidates = context.candidateKeys.filter((key) => (
    key !== context.focusKey && !isNum(values[key])));
  const attempt = (keys) => {
    const trialValues = cloneValues(values);
    const trialSources = { ...sources };
    for (const key of keys) {
      const sample = (context.samples && context.samples[key])
        ?? (context.meta[key] && context.meta[key].sample)
        ?? 1;
      if (!isNum(sample)) return false;
      trialValues[key] = sample;
      trialSources[key] = 'known';
    }
    const trialState = { work: [], softUsed: [...state.softUsed], alsoValid: {} };
    try {
      const conflict = propagate(trialValues, trialSources, trialState, context);
      if (conflict) return false;
      return allKnown(goal, trialValues);
    } catch (_error) {
      return false;
    }
  };

  for (let size = 1; size <= 3; size += 1) {
    const combos = combinations(candidates, size);
    const working = [];
    for (const combo of combos) {
      if (attempt(combo)) working.push(combo);
      if (size === 1 && working.length >= 4) break;
      if (size > 1 && working.length >= 1) break;
    }
    if (working.length) {
      return {
        suggestions: size === 1 ? working.map((combo) => combo[0]) : working[0],
        requiredExtra: size,
      };
    }
    if (size === 1 && candidates.length > 18) {
      // Keep the pair search bounded for the busiest catalogs.
      break;
    }
  }
  return { suggestions: [], requiredExtra: null };
}

/**
 * Solve a relation system.
 *
 * @param {object} options
 * @param {string[]} options.keys
 * @param {Array} options.relations
 * @param {object} options.typed
 * @param {object} options.locked   key -> value or { value, caption }
 * @param {Array} options.soft      [{ key, value, priority, when, label }]
 * @param {string[]} options.goal
 * @param {object} options.meta
 * @param {string[]} options.goalOrder
 * @param {string[]} options.candidateKeys
 * @param {object} options.samples
 * @param {Function} options.pick
 * @param {Function} options.notes
 * @param {string|null} options.focusKey
 * @param {boolean} options.diagnose
 */
export function solveRelations(options = {}) {
  const {
    keys = [],
    relations = [],
    typed = {},
    locked = {},
    soft = [],
    meta = {},
    goal = keys,
    candidateKeys = keys,
    samples = {},
    pick = null,
    notes = null,
    focusKey = null,
    editedKey = null,
    diagnose: shouldDiagnose = true,
    relTol = REL_TOL,
    roundedTol = ROUNDED_TOL,
    blameOrder = null,
    allowCoupled = false,
  } = options;

  const context = {
    relations, meta, samples, pick, editedKey, relTol, roundedTol, blameOrder, goal,
    soft: [...soft].sort((left, right) => (left.priority || 0) - (right.priority || 0)),
  };

  const values = Object.fromEntries(keys.map((key) => [key, null]));
  const sources = Object.fromEntries(keys.map((key) => [key, 'missing']));
  const state = { work: [], softUsed: [], alsoValid: {} };
  const lockedKeys = new Set();
  const lockedCaptions = {};
  const conflictKeys = new Set();

  // Locked values describe a choice (Ground launch, Free Fall, Constant speed).
  for (const [key, raw] of Object.entries(locked)) {
    if (!keys.includes(key)) continue;
    const value = typeof raw === 'object' && raw !== null ? raw.value : raw;
    if (!isNum(value)) continue;
    values[key] = value;
    sources[key] = 'locked';
    lockedKeys.add(key);
    if (raw && typeof raw === 'object' && raw.caption) lockedCaptions[key] = raw.caption;
  }

  // Typed values are constraints. A typed value that disagrees with a lock is
  // a real contradiction, not a reason to hide the player's number.
  const typedKeys = [];
  for (const [key, raw] of Object.entries(typed)) {
    if (!keys.includes(key)) continue;
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(raw);
    if (!isNum(value)) continue;
    if (lockedKeys.has(key) && Math.abs(value - values[key]) > relTol * Math.max(1, Math.abs(value))) {
      conflictKeys.add(key);
    } else if (!lockedKeys.has(key)) {
      values[key] = value;
      sources[key] = 'known';
      typedKeys.push(key);
    }
  }

  let status = 'solved';
  let message = '';
  let conflict = null;

  if (conflictKeys.size) {
    const key = [...conflictKeys][0];
    conflict = {
      message: `${labelOf(meta, key)} is set to ${withUnit(meta, key, values[key])} by this mode, not ${fmt(Number(typed[key]))}.`,
      keys: conflictKeys,
    };
  } else {
    try {
      conflict = propagate(values, sources, state, context);
    } catch (error) {
      if (error instanceof Impossible) {
        status = 'impossible';
        message = error.fix ? `${error.message} ${error.fix}` : error.message;
        typedKeys.forEach((key) => conflictKeys.add(key));
      } else {
        throw error;
      }
    }
  }

  if (!conflict && status !== 'impossible' && !allKnown(goal, values)) {
    try {
      activateSoft(values, sources, state, context);
    } catch (error) {
      if (error instanceof Impossible) {
        status = 'impossible';
        message = error.fix ? `${error.message} ${error.fix}` : error.message;
        typedKeys.forEach((key) => conflictKeys.add(key));
      } else throw error;
    }
    // Soft activation may have solved everything; if it introduced a conflict
    // it was already reverted. Do one final consistency pass.
    if (status !== 'impossible') conflict = findConflict(values, sources, context);
  }

  if (allowCoupled && !conflict && status !== 'impossible' && !allKnown(goal, values)) {
    // Coupled fallback: find the smallest square set of stalled relations.
    const unknown = keys.filter((key) => !isNum(values[key])
      && (goal.includes(key) || relations.some((relation) => relation.vars.includes(key))));
    const stalled = relations.filter((relation) => (
      relation.vars.some((key) => !isNum(values[key]))));
    let solvedCoupled = null;
    for (let size = 2; size <= Math.min(3, unknown.length); size += 1) {
      const combos = combinations(stalled, size);
      for (const combo of combos) {
        const shared = [...new Set(combo.flatMap((relation) => relation.vars))]
          .filter((key) => !isNum(values[key]));
        if (shared.length !== size) continue;
        const result = coupledSolve(combo, shared, values, context);
        if (!result) continue;
        // Verify the candidate actually satisfies every relation.
        const trial = { ...values, ...result };
        if (!combo.every((relation) => {
          const residual = relation.residual(trial);
          return isNum(residual)
            && Math.abs(residual) <= 1e-5 * relationScale(relation, trial);
        })) continue;
        solvedCoupled = { combo, result };
        break;
      }
      if (solvedCoupled) break;
    }
    if (solvedCoupled) {
      const trialValues = { ...values, ...solvedCoupled.result };
      const trialSources = { ...sources };
      for (const key of Object.keys(solvedCoupled.result)) {
        if (!isNum(values[key])) {
          trialSources[key] = 'solved';
          state.work.push({
            key,
            label: labelOf(meta, key),
            symbol: (meta[key] && meta[key].symbol) || key,
            unit: unitOf(meta, key),
            equation: solvedCoupled.combo.map((relation) => relation.id).join(' + '),
            equationName: 'Coupled solve',
            formula: solvedCoupled.combo.map((relation) => relation.formula).join(' ; '),
            expr: key,
            sub: fmt(solvedCoupled.result[key]),
            value: solvedCoupled.result[key],
            note: 'Solved together with the other unknowns.',
            others: [],
            softUsed: [...state.softUsed],
          });
        }
      }
      Object.assign(values, trialValues);
      Object.assign(sources, trialSources);
      // Let the ordinary engine finish from the coupled seed.
      try {
        const later = propagate(values, sources, state, context);
        if (later) conflict = later;
      } catch (error) {
        if (error instanceof Impossible) {
          status = 'impossible';
          message = error.fix ? `${error.message} ${error.fix}` : error.message;
        } else throw error;
      }
    }
  }

  if (status !== 'impossible') {
    if (conflict) {
      status = 'conflict';
      message = conflict.message;
      (conflict.keys || []).forEach((key) => conflictKeys.add(key));
    } else if (!allKnown(goal, values)) {
      status = 'underdetermined';
    }
  }

  const missing = keys.filter((key) => !isNum(values[key]));
  const diagnosis = (status === 'underdetermined' && shouldDiagnose)
    ? diagnose(values, sources, state, { ...context, goal, focusKey, candidateKeys })
    : { suggestions: [], requiredExtra: null };
  const suggestions = diagnosis.suggestions;

  const noteList = typeof notes === 'function'
    ? (notes(values, { status, suggestions, softUsed: state.softUsed }) || [])
    : [];

  return {
    ok: status === 'solved',
    status,
    message,
    values,
    sources,
    work: state.work,
    conflictKeys,
    missing,
    missingKeys: new Set(missing),
    suggestions,
    requiredExtra: diagnosis.requiredExtra,
    noteList,
    notes: noteList,
    softUsed: state.softUsed.slice(),
    alsoValid: state.alsoValid,
    lockedKeys,
    lockedCaptions,
    focusKey,
    blame: conflict ? conflict.blame : null,
    predicted: conflict ? conflict.predicted : null,
  };
}

function combinations(items, size) {
  const out = [];
  const walk = (start, chosen) => {
    if (chosen.length === size) { out.push(chosen.slice()); return; }
    for (let index = start; index < items.length; index += 1) {
      chosen.push(items[index]);
      walk(index + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

export function normaliseSoft(entries = []) {
  return entries.filter((entry) => entry && entry.key);
}

// Plain-language guidance shared by the sidebar and the tests.
export function guidance(solution, labelOfKey = (key) => key, neededFallback = 1) {
  if (!solution) return '';
  if (solution.status === 'conflict' || solution.status === 'impossible') {
    return solution.message || 'These values disagree.';
  }
  if (solution.status === 'solved') return 'All values found.';
  const suggestions = solution.suggestions || [];
  if (!suggestions.length) {
    return solution.message || 'Not enough values yet. Add another value.';
  }
  const names = suggestions.map(labelOfKey);
  const needed = solution.requiredExtra || solution.needed || neededFallback;
  const list = needed > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : (names.length > 1
      ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
      : names[0]);
  if (solution.focusKey) {
    return `To find ${labelOfKey(solution.focusKey)}, add ${list}.`;
  }
  return `${needed === 1 ? 'One more value needed' : `${needed} more values needed`}. Add ${list}.`;
}

export { isNum, labelOf, unitOf, withUnit };
