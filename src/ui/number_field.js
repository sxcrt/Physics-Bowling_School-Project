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

export function clampLaunchValue(key, value) {
  if (!Number.isFinite(value)) return NaN;
  const floor = VALUE_FLOORS[key];
  return floor === undefined ? value : Math.max(floor, value);
}

export function parseLaunchValue(key, text) {
  const cleaned = String(text === undefined || text === null ? '' : text)
    .trim()
    .replace(/,/g, '.');
  if (!PLAIN_DECIMAL.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return clampLaunchValue(key, value);
}
