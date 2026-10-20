"""The Physics Lab's calculator model.

The lab is a plan as well as a replay: the throw is described by five core
values (speed, aim, hook, rolling deceleration and start position), and the
readout adds the quantities that follow from them.

Editing a readout is deterministic: the edited value picks the one core value
it needs and every other core value is copied from the previous plan
bit-for-bit. Locks are processed after the edit, so a lock either holds or the
edit is rejected with the name of the value that cannot move.

The time relation is the standard constant-acceleration travel to the head
pin (distance ``d``, initial speed ``v``, deceleration ``b``)::

    d = v t - 1/2 b t^2   =>   t = (v - sqrt(v^2 - 2 b d)) / b

and the rest are the definitions the lab already shows::

    vx = v sin(theta)      p = m v      K = 1/2 m v^2
    spin = |(v / R, hook)| a = -b

The live replay keeps using the real simulation; this model is the plan BOWL
launches and the numbers the calculator solves. Keeping it free of Ursina
lets the solver be tested on its own.
"""
import math
import re

import config

PLAN_KEYS = ('t', 'v', 'a', 'vx', 'spin', 'p', 'K')
CORE_KEYS = ('v', 'angle', 'hook', 'a')

MASS = config.BALL_MASS
RADIUS = config.BALL_RADIUS
DISTANCE = config.LANE_LENGTH

_PLAIN_DECIMAL = re.compile(r'^[+-]?(?:\d+\.?\d*|\.\d+)$')
_READOUT_UNITS = {
    't': ('s',),
    'v': ('m/s',), 'vx': ('m/s',),
    'a': ('m/s^2', 'm/s2'),
    'p': ('kg*m/s', 'kgm/s', 'kg/ms'),
    'K': ('j',),
}


def parse_readout_value(key, text):
    """A readout number, tolerating the unit printed beside the field.

    ``5kg/ms``, ``0m/s^2`` and ``3 s`` are accepted; anything else is left to
    the plain decimal check so a typo still fails instead of being guessed.
    """
    raw = str(text if text is not None else '').strip()
    compact = re.sub(r'\s+', '', raw).lower()
    for unit in _READOUT_UNITS.get(key, ()):
        if not compact.endswith(unit):
            continue
        prefix = compact[:len(compact) - len(unit)]
        if not _PLAIN_DECIMAL.match(prefix):
            return None
        value = float(prefix)
        return value if math.isfinite(value) else None
    if not _PLAIN_DECIMAL.match(raw):
        return None
    value = float(raw)
    return value if math.isfinite(value) else None

# Which core value each readout is allowed to move, in preference order.
# The first free candidate is claimed; if every candidate is already claimed
# by an earlier target, the two targets conflict.
CANDIDATES = {
    'v': ('v',), 'p': ('v',), 'K': ('v',),
    'angle': ('angle',), 'hook': ('hook',), 'a': ('a',),
    'vx': ('angle', 'v'),
    'spin': ('hook', 'v'),
    't': ('v', 'a'),
}

# Dependencies of a (target, knob) pair on the other core values.
DEPENDENCIES = {
    'vx': {'v': ('angle',), 'angle': ('v',)},
    'spin': {'v': ('hook',), 'hook': ('v',)},
    't': {'v': ('a',), 'a': ('v',)},
}


def _dependencies_for(key, knob):
    table = DEPENDENCIES.get(key)
    return table.get(knob, ()) if table else ()


def deceleration_to_scale(a):
    base = config.ROLLING_FRICTION * config.GRAVITY
    if base <= 1e-12:
        return 1.0
    return max(0.0, -float(a or 0.0)) / base


def scale_to_deceleration(scale):
    return -config.ROLLING_FRICTION * config.GRAVITY * max(0.0,
                                                           float(scale or 0.0))


def head_pin_time(v, a):
    speed = max(0.0, float(v or 0.0))
    decel = max(0.0, -float(a or 0.0))
    if speed <= 1e-9:
        return float('inf')
    if decel <= 1e-12:
        return DISTANCE / speed
    discriminant = speed * speed - 2.0 * decel * DISTANCE
    if discriminant < 0.0:             # stops before the head pin
        return float('inf')
    return (speed - math.sqrt(discriminant)) / decel


def plan_derived(core):
    v = max(0.0, float(core.get('v', 0.0) or 0.0))
    angle_deg = float(core.get('angle', 0.0) or 0.0)
    angle = math.radians(angle_deg)
    hook = float(core.get('hook', 0.0) or 0.0)
    a = min(0.0, float(core.get('a', 0.0) or 0.0))
    lateral = float(core.get('lateral', 0.0) or 0.0)
    vx = v * math.sin(angle)
    vz = v * math.cos(angle)
    spin = math.hypot(v / RADIUS, hook)
    angular = (
        vz / RADIUS + ((vx / v) * hook if v > 1e-9 else 0.0),
        0.0,
        -vx / RADIUS + ((vz / v) * hook if v > 1e-9 else 0.0),
    )
    return {
        't': head_pin_time(v, a), 'v': v, 'a': a, 'vx': vx, 'spin': spin,
        'p': MASS * v, 'K': 0.5 * MASS * v * v,
        'angle': angle_deg, 'hook': hook, 'lateral': lateral, 'vz': vz,
        'angular': angular, 'friction_scale': deceleration_to_scale(a),
    }


def _conflict(core, targets, key):
    return {'ok': False, 'core': dict(core),
            'derived': plan_derived(core), 'error': float('inf'),
            'targets': targets, 'conflict': key}


def _knob_resolved(knob, decisions):
    for decision in decisions:
        if decision['knob'] == knob:
            return decision['resolved']
    return True


def _solve_decision(decision, core):
    key, value, knob = decision['key'], decision['value'], decision['knob']

    if knob == 'v':
        if key == 'v':
            core['v'] = max(0.0, value)
        elif key == 'p':
            core['v'] = max(0.0, value / MASS)
        elif key == 'K':
            core['v'] = math.sqrt(max(0.0, 2.0 * value / MASS))
        elif key == 'vx':
            sine = math.sin(math.radians(core['angle']))
            if abs(sine) < 1e-12:
                return False
            core['v'] = value / sine
            if not math.isfinite(core['v']) or core['v'] < 0.0:
                return False
        elif key == 'spin':
            room = value * value - core['hook'] * core['hook']
            if room < -1e-9:
                return False
            core['v'] = RADIUS * math.sqrt(max(0.0, room))
        elif key == 't':
            decel = max(0.0, -core['a'])
            core['v'] = DISTANCE / value + 0.5 * decel * value
    elif knob == 'angle':
        if key == 'angle':
            core['angle'] = value
        elif key == 'vx':
            if core['v'] <= 1e-12:
                if abs(value) > 1e-12:
                    return False
                # vx = 0 is true for every aim: keep the existing aim.
            else:
                ratio = value / core['v']
                if abs(ratio) > 1.0 + 1e-9:
                    return False
                core['angle'] = math.degrees(
                    math.asin(max(-1.0, min(1.0, ratio))))
    elif knob == 'hook':
        if key == 'hook':
            core['hook'] = value
        elif key == 'spin':
            rolling = core['v'] / RADIUS
            room = value * value - rolling * rolling
            if room < -1e-9:
                return False
            sign = -1.0 if core['hook'] < 0.0 else 1.0
            core['hook'] = sign * math.sqrt(max(0.0, room))
    elif knob == 'a':
        if key == 'a':
            core['a'] = value if value < 0.0 else 0.0
        elif key == 't':
            decel = 2.0 * (core['v'] * value - DISTANCE) / (value * value)
            if decel < -1e-9:
                return False
            core['a'] = -max(0.0, decel)

    return all(math.isfinite(core[name])
               for name in ('v', 'angle', 'hook', 'a'))


def solve_plan(previous, targets):
    """Solve for the core values satisfying ``targets`` in priority order.

    The edited value should come first, followed by the locks. Every core
    value no target claims is copied from ``previous`` unchanged. Returns
    ``{'ok', 'core', 'derived', 'error', 'targets', 'conflict'}``; ``conflict``
    names the target that could not be satisfied.
    """
    clean = {}
    for key, raw in (targets or {}).items():
        if key not in CANDIDATES:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value):
            continue
        if key == 'a':
            value = -abs(value) if abs(value) > 0.0 else 0.0
        clean[key] = value
    keys = list(clean)

    previous_a = float(previous.get('a', 0.0) or 0.0)
    core = {
        'v': max(0.0, float(previous.get('v', 0.0) or 0.0)),
        'angle': float(previous.get('angle', 0.0) or 0.0),
        'hook': float(previous.get('hook', 0.0) or 0.0),
        'a': previous_a if previous_a < 0.0 else 0.0,
        'lateral': float(previous.get('lateral', 0.0) or 0.0),
    }
    if not keys:
        return {'ok': True, 'core': core, 'derived': plan_derived(core),
                'error': 0.0, 'targets': clean, 'conflict': None}

    for key in keys:
        value = clean[key]
        if key == 't' and value <= 0.0:
            return _conflict(core, clean, key)
        if key in ('p', 'K') and value < 0.0:
            return _conflict(core, clean, key)
        if key == 'spin' and value <= 0.0:
            return _conflict(core, clean, key)

    def assign(index, used, decisions):
        if index == len(keys):
            return list(decisions)
        key = keys[index]
        for knob in CANDIDATES[key]:
            if knob in used:
                continue
            used.add(knob)
            decisions.append({
                'key': key, 'value': clean[key], 'knob': knob,
                'resolved': False,
                'deps': _dependencies_for(key, knob),
            })
            result = assign(index + 1, used, decisions)
            if result is not None:
                return result
            decisions.pop()
            used.discard(knob)
        return None

    decisions = assign(0, set(), [])
    if decisions is None:
        # Name a target with no remaining candidate under a simple pass, so
        # the UI can say which lock/value could not move.
        used = set()
        blocker = keys[0]
        for key in keys:
            knob = next((candidate for candidate in CANDIDATES[key]
                         if candidate not in used), None)
            if knob is None:
                blocker = key
                break
            used.add(knob)
        return _conflict(core, clean, blocker)

    progress = True
    while progress:
        progress = False
        for decision in decisions:
            if decision['resolved']:
                continue
            if not all(_knob_resolved(dep, decisions)
                       for dep in decision['deps']):
                continue
            if not _solve_decision(decision, core):
                return _conflict(core, clean, decision['key'])
            decision['resolved'] = True
            progress = True

    unresolved = [d for d in decisions if not d['resolved']]
    if unresolved:
        return _conflict(core, clean, unresolved[0]['key'])

    derived = plan_derived(core)
    for key in keys:
        target = clean[key]
        computed = derived[key]
        tolerance = 1e-9 * max(1.0, abs(target)) + 1e-9
        if not math.isfinite(computed) or abs(computed - target) > tolerance:
            return _conflict(core, clean, key)
    return {'ok': True, 'core': core, 'derived': derived,
            'error': 0.0, 'targets': clean, 'conflict': None}
