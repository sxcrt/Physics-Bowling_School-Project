// The shared easing set (ported from motion/ease.py): two cubic-beziers plus helpers.
export function clamp01(value) { return value < 0.0 ? 0.0 : (value > 1.0 ? 1.0 : value); }
export function clamp(value, low, high) { return value < low ? low : (value > high ? high : value); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function mixRgb(a, b, t) {
  t = clamp01(t);
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

export function ramp(t, ...stops) {
  if (!stops.length) return t;
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, v0] = stops[i], [p1, v1] = stops[i + 1];
    if (t <= p1) {
      const span = p1 - p0;
      const local = span <= 1e-9 ? 0.0 : (t - p0) / span;
      return lerp(v0, v1, local);
    }
  }
  return stops[stops.length - 1][1];
}

export function pingPong(t, period) {
  if (period <= 1e-6) return 0.0;
  const phase = (t % period) / period;
  return 1.0 - Math.abs(2.0 * phase - 1.0);
}

export function breathe(t, period, low, high, phase = 0.0) {
  if (period <= 1e-6) return high;
  const angle = (t + phase) / period * 2.0 * Math.PI;
  return low + (high - low) * (0.5 + 0.5 * Math.sin(angle));
}
export const pulse = breathe;

export function hold(value, low = null, high = null) {
  return low === null ? clamp01(value) : clamp(value, low, high);
}

// Cubic bezier timing functions (CSS definition).
const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;
const BISECTION_EPSILON = 1e-7;

function bezierCoefficients(a, b) {
  const c = 3.0 * a;
  const bCo = 3.0 * (b - a) - c;
  const aCo = 1.0 - c - bCo;
  return [aCo, bCo, c];
}
function sampleCurve(a, b, t) {
  const [aCo, bCo, cCo] = bezierCoefficients(a, b);
  return ((aCo * t + bCo) * t + cCo) * t;
}
function sampleDerivative(a, b, t) {
  const [aCo, bCo, cCo] = bezierCoefficients(a, b);
  return (3.0 * aCo * t + 2.0 * bCo) * t + cCo;
}
function solveParameter(x1, x2, x) {
  let t = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const error = sampleCurve(x1, x2, t) - x;
    if (Math.abs(error) < NEWTON_EPSILON) return t;
    const derivative = sampleDerivative(x1, x2, t);
    if (Math.abs(derivative) < 1e-6) break;
    t = t - error / derivative;
  }
  let low = 0.0, high = 1.0;
  t = x;
  for (let i = 0; i < 60; i++) {
    const current = sampleCurve(x1, x2, t);
    if (Math.abs(current - x) < BISECTION_EPSILON) return t;
    if (current < x) low = t; else high = t;
    t = (low + high) * 0.5;
    if (high - low < BISECTION_EPSILON) break;
  }
  return t;
}

export function cubicBezier(x1, y1, x2, y2) {
  x1 = clamp01(x1); x2 = clamp01(x2);
  const timing = (x) => {
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    const t = solveParameter(x1, x2, x);
    return sampleCurve(y1, y2, t);
  };
  timing.control_points = [x1, y1, x2, y2];
  return timing;
}

export const STANDARD = cubicBezier(0.22, 1.00, 0.36, 1.00);
export const OVERSHOOT = cubicBezier(0.34, 1.56, 0.64, 1.00);

export const LINEAR = (x) => clamp01(x);
export const EASE_OUT = (x) => 1.0 - (1.0 - clamp01(x)) ** 3;
export const EASE_IN = (x) => clamp01(x) ** 3;
export const EASE_IN_OUT = (x) => clamp01(x) < 0.5
  ? (clamp01(x) * 2.0) ** 2 / 2.0
  : 1.0 - ((1.0 - clamp01(x)) * 2.0) ** 2 / 2.0;

export const EASE = {
  standard: STANDARD, overshoot: OVERSHOOT, linear: LINEAR,
  out: EASE_OUT, in: EASE_IN, in_out: EASE_IN_OUT,
};

export function resolve(easing) {
  if (easing === null || easing === undefined) return STANDARD;
  if (typeof easing === 'function') return easing;
  if (typeof easing === 'string') return EASE[easing] || STANDARD;
  if (Array.isArray(easing) && easing.length === 4) return cubicBezier(...easing);
  return STANDARD;
}
