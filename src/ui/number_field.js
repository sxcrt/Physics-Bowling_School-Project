// Numeric entry for the Physics Lab's launch steppers.
//
// The lab's arrows move a value by a fixed step, which is fine for exploring
// but cannot dial an exact launch. These helpers turn a typed string into the
// number the simulation should receive: a comma is accepted as a decimal
// point, a leading sign is kept, and the one physical floor (speed >= 0) is
// applied. Anything else (an empty field, a stray unit, two decimal points)
// returns null so the caller can restore the previous value instead of
// silently launching with a number the player did not type.

export const VALUE_FLOORS = { speed: 0.0 };

const PLAIN_DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

export function parseNumber(text) {
  const cleaned = String(text === undefined || text === null ? '' : text)
    .trim()
    .replace(/,/g, '.');
  if (!PLAIN_DECIMAL.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function clampLaunchValue(key, value) {
  if (!Number.isFinite(value)) return NaN;
  const floor = VALUE_FLOORS[key];
  return floor === undefined ? value : Math.max(floor, value);
}

export function parseLaunchValue(key, text) {
  const value = parseNumber(text);
  if (value === null) return null;
  return clampLaunchValue(key, value);
}

// Readout fields show their unit beside the number, but players often type it
// anyway ("5kg/ms", "0m/s^2", "3 s"). Strip a known unit suffix, then parse.
const READOUT_UNITS = {
  t: ['s'],
  v: ['m/s'], vx: ['m/s'],
  a: ['m/s^2', 'm/s2'],
  p: ['kg*m/s', 'kgm/s', 'kg/ms'],
  K: ['j'],
};

export function parseReadoutValue(key, text) {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  for (const unit of READOUT_UNITS[key] || []) {
    if (!compact.endsWith(unit)) continue;
    return parseNumber(compact.slice(0, compact.length - unit.length));
  }
  return parseNumber(raw);
}
