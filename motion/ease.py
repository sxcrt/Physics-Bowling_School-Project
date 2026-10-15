"""The shared easing set: two cubic-beziers, plus the small helpers effects need.

The design spec names two curves and says everything must use them, so this
module exposes them as the de-facto default:

* :data:`STANDARD` - ``cubic-bezier(0.22, 1.0, 0.36, 1.0)`` (fast out, soft
  landing) for anything that moves, fades or slides;
* :data:`OVERSHOOT` - ``cubic-bezier(0.34, 1.56, 0.64, 1.0)`` (pops and
  impacts) for score pops, stamps and result text.

:func:`cubic_bezier` is a direct port of the CSS timing-function definition:
the curve is parameterised by ``(x1, y1, x2, y2)``, and solving for the ``t``
whose x equals the input is done with Newton-Raphson plus a bisection fallback
(the same approach WebKit uses), so an overshooting y is handled correctly.

Nothing here imports Ursina, so the maths can be unit-tested headlessly.
"""
import math

# ---------------------------------------------------------------------------
# Scalar helpers
# ---------------------------------------------------------------------------


def clamp01(value):
    """Clamp to ``[0, 1]``."""
    return 0.0 if value < 0.0 else (1.0 if value > 1.0 else value)


def clamp(value, low, high):
    return low if value < low else (high if value > high else value)


def lerp(a, b, t):
    """Linear interpolation (``t`` is not clamped: overshoot is allowed)."""
    return a + (b - a) * t


def mix_rgb(a, b, t):
    """Blend two 0-255 colour triples by ``t`` (clamped to 0..1)."""
    t = clamp01(t)
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def ramp(t, *stops):
    """Sample a piecewise ramp at ``t`` in ``[0, 1]``.

    ``stops`` are ``(position, value)`` pairs in ascending order, e.g.
    ``ramp(t, (0.0, 0.6), (0.5, 1.15), (1.0, 1.0))`` is the score pop
    (scale 0.6 -> 1.15 -> 1.0). Positions are absolute, not deltas, so a
    multi-stop pop reads exactly like the spec writes it.
    """
    if not stops:
        return t
    if t <= stops[0][0]:
        return stops[0][1]
    for (p0, v0), (p1, v1) in zip(stops, stops[1:]):
        if t <= p1:
            span = p1 - p0
            local = 0.0 if span <= 1e-9 else (t - p0) / span
            return lerp(v0, v1, local)
    return stops[-1][1]


def ping_pong(t, period):
    """A 0..1..0 triangle wave over ``period`` seconds."""
    if period <= 1e-6:
        return 0.0
    phase = (t % period) / period
    return 1.0 - abs(2.0 * phase - 1.0)


def breathe(t, period, low, high, phase=0.0):
    """A slow sine "breathing" value between ``low`` and ``high``."""
    if period <= 1e-6:
        return high
    angle = (t + phase) / period * 2.0 * math.pi
    return low + (high - low) * (0.5 + 0.5 * math.sin(angle))


def pulse(t, period, low, high, phase=0.0):
    """Alias of :func:`breathe` with the name the effects use."""
    return breathe(t, period, low, high, phase)


def hold(value, low=None, high=None):
    """Clamp a value that may overshoot an easing back into a safe range."""
    return clamp01(value) if low is None else clamp(value, low, high)


# ---------------------------------------------------------------------------
# Cubic bezier timing functions
# ---------------------------------------------------------------------------

_NEWTON_ITERATIONS = 8
_NEWTON_EPSILON = 1e-7
_BISECTION_EPSILON = 1e-7
_SAMPLE_COUNT = 11


def _bezier_coefficients(a, b):
    """Polynomial coefficients of a 1-D cubic bezier with ends at 0 and 1."""
    c = 3.0 * a
    b_co = 3.0 * (b - a) - c
    a_co = 1.0 - c - b_co
    return a_co, b_co, c


def _sample_curve(a, b, t):
    """Evaluate one axis of the curve at parameter ``t``."""
    a_co, b_co, c_co = _bezier_coefficients(a, b)
    return ((a_co * t + b_co) * t + c_co) * t


def _sample_derivative(a, b, t):
    a_co, b_co, c_co = _bezier_coefficients(a, b)
    return (3.0 * a_co * t + 2.0 * b_co) * t + c_co


def _solve_parameter(x1, x2, x):
    """Find ``t`` such that ``sample_curve(x1, x2, t) == x``."""
    # Newton-Raphson first: it converges in a handful of steps for well
    # behaved curves. Fall back to bisection where the derivative is tiny
    # (flat sections near x=0 or x=1).
    t = x
    for _ in range(_NEWTON_ITERATIONS):
        error = _sample_curve(x1, x2, t) - x
        if abs(error) < _NEWTON_EPSILON:
            return t
        derivative = _sample_derivative(x1, x2, t)
        if abs(derivative) < 1e-6:
            break
        t = t - error / derivative
    low, high, t = 0.0, 1.0, x
    for _ in range(60):
        current = _sample_curve(x1, x2, t)
        if abs(current - x) < _BISECTION_EPSILON:
            return t
        if current < x:
            low = t
        else:
            high = t
        t = (low + high) * 0.5
        if high - low < _BISECTION_EPSILON:
            break
    return t


def cubic_bezier(x1, y1, x2, y2):
    """Build a timing function from the CSS ``cubic-bezier`` control points.

    The returned callable maps input progress ``0..1`` to output progress. Y
    may exceed 1 (that is what makes :data:`OVERSHOOT` pop) and may go below 0
    (anticipation); the x control points must stay inside ``[0, 1]``.
    """
    x1 = clamp01(x1)
    x2 = clamp01(x2)

    def timing(x):
        if x <= 0.0:
            return 0.0
        if x >= 1.0:
            return 1.0
        t = _solve_parameter(x1, x2, x)
        return _sample_curve(y1, y2, t)

    timing.control_points = (x1, y1, x2, y2)
    timing.name = f'cubic-bezier({x1:g}, {y1:g}, {x2:g}, {y2:g})'
    return timing


# The two curves from the design spec.
STANDARD = cubic_bezier(0.22, 1.00, 0.36, 1.00)
OVERSHOOT = cubic_bezier(0.34, 1.56, 0.64, 1.00)

# Simple curves the effects use where a bezier would be overkill.
LINEAR = lambda x: clamp01(x)
EASE_OUT = lambda x: 1.0 - (1.0 - clamp01(x)) ** 3
EASE_IN = lambda x: clamp01(x) ** 3
EASE_IN_OUT = lambda x: (clamp01(x) * 2.0) ** 2 / 2.0 if x < 0.5 \
    else 1.0 - ((1.0 - clamp01(x)) * 2.0) ** 2 / 2.0

# Name -> callable, so a config string can select an easing.
EASE = {
    'standard': STANDARD,
    'overshoot': OVERSHOOT,
    'linear': LINEAR,
    'out': EASE_OUT,
    'in': EASE_IN,
    'in_out': EASE_IN_OUT,
}


def resolve(easing):
    """Accept a callable, a name from :data:`EASE`, or a bezier control tuple."""
    if easing is None:
        return STANDARD
    if callable(easing):
        return easing
    if isinstance(easing, str):
        return EASE.get(easing, STANDARD)
    if isinstance(easing, (tuple, list)) and len(easing) == 4:
        return cubic_bezier(*easing)
    return STANDARD
