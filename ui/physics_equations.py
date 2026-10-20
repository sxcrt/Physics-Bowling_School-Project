"""The Physics Lab's inverse equation engine.

Each equation lists its variables and one closed-form solver per variable.
The caller supplies the variables it knows and the single variable it wants
to find. If the selected equation lacks information the engine reports the
missing variable; if another supported equation can use the same known values
it offers that equation instead.

Results are analytical: exact under the equation's stated assumptions. They
are not simulation measurements. The LIVE panel and timeline remain the real
simulation. Pure Python (no Ursina) so the engine is testable on its own.
"""
import math

GRAVITY = 9.81
EPS = 1e-12
POSITIVE = {'m', 'r', 'g', 't'}
NON_NEGATIVE = {'d', 'v', 'u', 'K', 'omega', 'mu'}


class EquationError(Exception):
    pass


VARIABLES = {
    'd': {'label': 'Distance', 'unit': 'm'},
    't': {'label': 'Time', 'unit': 's'},
    'v': {'label': 'Speed', 'unit': 'm/s'},
    'u': {'label': 'Initial speed', 'unit': 'm/s'},
    'a': {'label': 'Acceleration', 'unit': 'm/s2'},
    'F': {'label': 'Force', 'unit': 'N'},
    'm': {'label': 'Mass', 'unit': 'kg'},
    'K': {'label': 'Kinetic energy', 'unit': 'J'},
    'W': {'label': 'Work', 'unit': 'J'},
    'tau': {'label': 'Torque', 'unit': 'N m'},
    'r': {'label': 'Lever arm / radius', 'unit': 'm'},
    'omega': {'label': 'Angular velocity', 'unit': 'rad/s'},
    'mu': {'label': 'Friction coefficient', 'unit': ''},
    'g': {'label': 'Gravity', 'unit': 'm/s2', 'default': GRAVITY},
    'theta': {'label': 'Aim angle', 'unit': 'deg'},
    'vx': {'label': 'Sideways speed', 'unit': 'm/s'},
}


def fmt(value, decimals=3):
    if not math.isfinite(value):
        return 'never'
    text = f'{value:.{decimals}f}'.rstrip('0').rstrip('.')
    if text in ('-0', ''):
        text = '0'
    return text


def _need(values, symbol, formula):
    value = values.get(symbol)
    if value is None or not _finite(value):
        raise EquationError(
            f'{VARIABLES[symbol]["label"]} ({symbol}) is required to use {formula}.')
    return float(value)


def _nonzero(value, symbol, formula):
    if abs(value) <= EPS:
        raise EquationError(f'{symbol} cannot be zero in {formula}.')
    return value


def _positive_root(value, message):
    if not math.isfinite(value) or value < 0:
        raise EquationError(message)
    return math.sqrt(value)


def _step(value, rearranged, substitution, steps, notes=None, alternatives=None):
    return {
        'value': value, 'rearranged': rearranged,
        'substitution': substitution, 'steps': steps,
        'notes': notes or [], 'alternatives': alternatives or [],
    }


def _validate_given(equation, values, find):
    for symbol in equation['variables']:
        if symbol == find:
            continue
        value = values.get(symbol)
        if not _finite(value):
            continue
        if symbol in POSITIVE and value <= 0:
            raise EquationError(
                f'{VARIABLES[symbol]["label"]} ({symbol}) must be greater than zero.')
        if symbol in NON_NEGATIVE and value < 0:
            raise EquationError(
                f'{VARIABLES[symbol]["label"]} ({symbol}) cannot be negative.')


def _validate_result(find, value):
    if find in POSITIVE and value <= 0:
        raise EquationError(
            f'{VARIABLES[find]["label"]} ({find}) must be greater than zero.')
    if find in NON_NEGATIVE and value < 0:
        raise EquationError(
            f'{VARIABLES[find]["label"]} ({find}) cannot be negative.')


# ---------------------------------------------------------------------------
def _uniform_motion():
    formula = 'd = v t'

    def d(g):
        v = _need(g, 'v', formula)
        t = _need(g, 't', formula)
        return _step(v * t, 'd = v t', f'd = {fmt(v)} x {fmt(t)}',
                     [f'd = {fmt(v)} x {fmt(t)}', f'd = {fmt(v * t)} m'])

    def v(g):
        d = _need(g, 'd', formula)
        t = _nonzero(_need(g, 't', formula), 't', formula)
        return _step(d / t, 'v = d / t', f'v = {fmt(d)} / {fmt(t)}',
                     [f'v = {fmt(d)} / {fmt(t)}', f'v = {fmt(d / t)} m/s'])

    def t(g):
        d = _need(g, 'd', formula)
        v = _nonzero(_need(g, 'v', formula), 'v', formula)
        return _step(d / v, 't = d / v', f't = {fmt(d)} / {fmt(v)}',
                     [f't = {fmt(d)} / {fmt(v)}', f't = {fmt(d / v)} s'])

    return {
        'id': 'uniform_motion', 'name': 'Uniform motion', 'formula': formula,
        'variables': ('d', 'v', 't'),
        'assumptions': ('Constant speed', 'No acceleration or friction',
                        'Straight-line travel'),
        'solve': {'d': d, 'v': v, 't': t},
        'apply': {'v': 'speed'},
    }


# ---------------------------------------------------------------------------
def _velocity_time():
    formula = 'v = u + a t'

    def v(g):
        u, a, t = (_need(g, s, formula) for s in ('u', 'a', 't'))
        return _step(u + a * t, 'v = u + a t',
                     f'v = {fmt(u)} + {fmt(a)} x {fmt(t)}',
                     [f'v = {fmt(u)} + {fmt(a * t)}',
                      f'v = {fmt(u + a * t)} m/s'])

    def u(g):
        v_, a, t = (_need(g, s, formula) for s in ('v', 'a', 't'))
        return _step(v_ - a * t, 'u = v - a t',
                     f'u = {fmt(v_)} - {fmt(a)} x {fmt(t)}',
                     [f'u = {fmt(v_)} - {fmt(a * t)}',
                      f'u = {fmt(v_ - a * t)} m/s'])

    def a(g):
        v_, u_, t = _need(g, 'v', formula), _need(g, 'u', formula), \
            _nonzero(_need(g, 't', formula), 't', formula)
        return _step((v_ - u_) / t, 'a = (v - u) / t',
                     f'a = ({fmt(v_)} - {fmt(u_)}) / {fmt(t)}',
                     [f'a = {fmt(v_ - u_)} / {fmt(t)}',
                      f'a = {fmt((v_ - u_) / t)} m/s2'])

    def t(g):
        v_, u_, a_ = _need(g, 'v', formula), _need(g, 'u', formula), \
            _nonzero(_need(g, 'a', formula), 'a', formula)
        return _step((v_ - u_) / a_, 't = (v - u) / a',
                     f't = ({fmt(v_)} - {fmt(u_)}) / {fmt(a_)}',
                     [f't = {fmt(v_ - u_)} / {fmt(a_)}',
                      f't = {fmt((v_ - u_) / a_)} s'])

    return {
        'id': 'velocity_time', 'name': 'Velocity and time', 'formula': formula,
        'variables': ('u', 'v', 'a', 't'),
        'assumptions': ('Constant acceleration', 'Straight-line motion',
                        'Signed values (negative a = deceleration)'),
        'solve': {'v': v, 'u': u, 'a': a, 't': t},
        'apply': {'u': 'speed', 'a': 'deceleration'},
    }


# ---------------------------------------------------------------------------
def _displacement_time():
    formula = 'd = u t + 0.5 a t^2'

    def d(g):
        u, t, a = (_need(g, s, formula) for s in ('u', 't', 'a'))
        value = u * t + 0.5 * a * t * t
        return _step(value, 'd = u t + 0.5 a t^2',
                     f'd = {fmt(u)} x {fmt(t)} + 0.5 x {fmt(a)} x {fmt(t)}^2',
                     [f'd = {fmt(u * t)} + {fmt(0.5 * a * t * t)}',
                      f'd = {fmt(value)} m'])

    def u(g):
        d_, a, t = _need(g, 'd', formula), _need(g, 'a', formula), \
            _nonzero(_need(g, 't', formula), 't', formula)
        value = (d_ - 0.5 * a * t * t) / t
        return _step(value, 'u = (d - 0.5 a t^2) / t',
                     f'u = ({fmt(d_)} - 0.5 x {fmt(a)} x {fmt(t)}^2) / {fmt(t)}',
                     [f'u = ({fmt(d_)} - {fmt(0.5 * a * t * t)}) / {fmt(t)}',
                      f'u = {fmt(value)} m/s'])

    def a(g):
        d_, u_, t = _need(g, 'd', formula), _need(g, 'u', formula), \
            _nonzero(_need(g, 't', formula), 't', formula)
        value = 2 * (d_ - u_ * t) / (t * t)
        return _step(value, 'a = 2(d - u t) / t^2',
                     f'a = 2({fmt(d_)} - {fmt(u_)} x {fmt(t)}) / {fmt(t)}^2',
                     [f'a = 2({fmt(d_ - u_ * t)}) / {fmt(t * t)}',
                      f'a = {fmt(value)} m/s2'])

    def t(g):
        d_, u_, a_ = _need(g, 'd', formula), _need(g, 'u', formula), \
            _need(g, 'a', formula)
        if abs(a_) <= EPS:
            _nonzero(u_, 'u', 't = d / u (a = 0)')
            value = d_ / u_
            return _step(value, 't = d / u (a = 0)',
                         f't = {fmt(d_)} / {fmt(u_)}',
                         ['a = 0, so t = d / u', f't = {fmt(value)} s'],
                         notes=['With zero acceleration, uniform motion is used.'])
        discriminant = u_ * u_ + 2 * a_ * d_
        if discriminant < -1e-9:
            raise EquationError('The ball never reaches that distance with '
                                'this deceleration (the discriminant is negative).')
        root = math.sqrt(max(0.0, discriminant))
        roots = [(-u_ + root) / a_, (-u_ - root) / a_]
        positive = sorted(value for value in roots
                          if value > 0 and math.isfinite(value))
        if not positive:
            raise EquationError('No positive travel time satisfies these values.')
        notes = []
        if len(positive) > 1:
            notes.append('Two positive times satisfy the equation; the first '
                         f'arrival is shown (the other is {fmt(positive[1])} s).')
        value = positive[0]
        return _step(value, 't = (-u +/- sqrt(u^2 + 2 a d)) / a',
                     f't = (-{fmt(u_)} +/- sqrt({fmt(u_)}^2 + 2 x {fmt(a_)} x {fmt(d_)})) / {fmt(a_)}',
                     [f'discriminant = {fmt(discriminant)}',
                      f't = (-{fmt(u_)} + {fmt(root)}) / {fmt(a_)} = {fmt(value)} s'],
                     notes=notes,
                     alternatives=[{'value': other, 'note': 'second crossing'}
                                   for other in positive[1:]])

    return {
        'id': 'displacement_time', 'name': 'Displacement and time',
        'formula': formula, 'variables': ('d', 'u', 'a', 't'),
        'assumptions': ('Constant acceleration', 'Straight-line motion',
                        'Signed values (negative a = deceleration)'),
        'solve': {'d': d, 'u': u, 'a': a, 't': t},
        'apply': {'u': 'speed', 'a': 'deceleration'},
    }


# ---------------------------------------------------------------------------
def _velocity_displacement():
    formula = 'v^2 = u^2 + 2 a d'

    def v(g):
        u, a, d = (_need(g, s, formula) for s in ('u', 'a', 'd'))
        value = _positive_root(u * u + 2 * a * d,
                               'The quantity under the square root is negative; '
                               'this motion cannot reach that distance.')
        return _step(value, 'v = sqrt(u^2 + 2 a d)',
                     f'v = sqrt({fmt(u)}^2 + 2 x {fmt(a)} x {fmt(d)})',
                     [f'v = sqrt({fmt(u * u + 2 * a * d)})',
                      f'v = {fmt(value)} m/s'],
                     notes=['The positive root is shown; a reversing motion '
                            'would use the negative root.'])

    def u(g):
        v_, a, d = (_need(g, s, formula) for s in ('v', 'a', 'd'))
        value = _positive_root(v_ * v_ - 2 * a * d,
                               'The quantity under the square root is negative; '
                               'the initial speed is not real.')
        return _step(value, 'u = sqrt(v^2 - 2 a d)',
                     f'u = sqrt({fmt(v_)}^2 - 2 x {fmt(a)} x {fmt(d)})',
                     [f'u = sqrt({fmt(v_ * v_ - 2 * a * d)})',
                      f'u = {fmt(value)} m/s'],
                     notes=['The positive root is shown.'])

    def a(g):
        v_, u_, d = _need(g, 'v', formula), _need(g, 'u', formula), \
            _nonzero(_need(g, 'd', formula), 'd', formula)
        value = (v_ * v_ - u_ * u_) / (2 * d)
        return _step(value, 'a = (v^2 - u^2) / (2 d)',
                     f'a = ({fmt(v_)}^2 - {fmt(u_)}^2) / (2 x {fmt(d)})',
                     [f'a = {fmt(v_ * v_ - u_ * u_)} / {fmt(2 * d)}',
                      f'a = {fmt(value)} m/s2'])

    def d(g):
        v_, u_, a_ = _need(g, 'v', formula), _need(g, 'u', formula), \
            _nonzero(_need(g, 'a', formula), 'a', formula)
        value = (v_ * v_ - u_ * u_) / (2 * a_)
        return _step(value, 'd = (v^2 - u^2) / (2 a)',
                     f'd = ({fmt(v_)}^2 - {fmt(u_)}^2) / (2 x {fmt(a_)})',
                     [f'd = {fmt(v_ * v_ - u_ * u_)} / {fmt(2 * a_)}',
                      f'd = {fmt(value)} m'])

    return {
        'id': 'velocity_displacement', 'name': 'Velocity and distance',
        'formula': formula, 'variables': ('u', 'v', 'a', 'd'),
        'assumptions': ('Constant acceleration', 'Straight-line motion',
                        'Speed is the non-negative root'),
        'solve': {'v': v, 'u': u, 'a': a, 'd': d},
        'apply': {'u': 'speed', 'a': 'deceleration'},
    }


# ---------------------------------------------------------------------------
def _simple_linear(eid, name, formula, variables, assumptions, solve_map, apply_map):
    return {'id': eid, 'name': name, 'formula': formula,
            'variables': variables, 'assumptions': assumptions,
            'solve': solve_map, 'apply': apply_map}


def _force():
    formula = 'F = m a'

    def F(g):
        m, a = _need(g, 'm', formula), _need(g, 'a', formula)
        return _step(m * a, 'F = m a', f'F = {fmt(m)} x {fmt(a)}',
                     [f'F = {fmt(m * a)} N'])

    def m(g):
        F_, a = _need(g, 'F', formula), _nonzero(_need(g, 'a', formula), 'a', formula)
        return _step(F_ / a, 'm = F / a', f'm = {fmt(F_)} / {fmt(a)}',
                     [f'm = {fmt(F_ / a)} kg'])

    def a(g):
        F_, m_ = _need(g, 'F', formula), _nonzero(_need(g, 'm', formula), 'm', formula)
        return _step(F_ / m_, 'a = F / m', f'a = {fmt(F_)} / {fmt(m_)}',
                     [f'a = {fmt(F_ / m_)} m/s2'])

    return _simple_linear('force', 'Force', formula, ('F', 'm', 'a'),
                          ('Net force', 'Constant mass',
                           'Straight-line acceleration'),
                          {'F': F, 'm': m, 'a': a}, {})


def _work():
    formula = 'W = F d'

    def W(g):
        F, d = _need(g, 'F', formula), _need(g, 'd', formula)
        return _step(F * d, 'W = F d', f'W = {fmt(F)} x {fmt(d)}',
                     [f'W = {fmt(F * d)} J'])

    def F(g):
        W_, d = _need(g, 'W', formula), _nonzero(_need(g, 'd', formula), 'd', formula)
        return _step(W_ / d, 'F = W / d', f'F = {fmt(W_)} / {fmt(d)}',
                     [f'F = {fmt(W_ / d)} N'])

    def d(g):
        W_, F_ = _need(g, 'W', formula), _nonzero(_need(g, 'F', formula), 'F', formula)
        return _step(W_ / F_, 'd = W / F', f'd = {fmt(W_)} / {fmt(F_)}',
                     [f'd = {fmt(W_ / F_)} m'])

    return _simple_linear('work', 'Work', formula, ('W', 'F', 'd'),
                          ('Force along the displacement', 'Constant force'),
                          {'W': W, 'F': F, 'd': d}, {})


def _kinetic_energy():
    formula = 'K = 0.5 m v^2'

    def K(g):
        m, v = _need(g, 'm', formula), _need(g, 'v', formula)
        return _step(0.5 * m * v * v, 'K = 0.5 m v^2',
                     f'K = 0.5 x {fmt(m)} x {fmt(v)}^2',
                     [f'K = 0.5 x {fmt(m)} x {fmt(v * v)}',
                      f'K = {fmt(0.5 * m * v * v)} J'])

    def m(g):
        K_, v = _need(g, 'K', formula), _nonzero(_need(g, 'v', formula), 'v', formula)
        return _step(2 * K_ / (v * v), 'm = 2K / v^2',
                     f'm = 2 x {fmt(K_)} / {fmt(v)}^2',
                     [f'm = {fmt(2 * K_)} / {fmt(v * v)}',
                      f'm = {fmt(2 * K_ / (v * v))} kg'])

    def v(g):
        K_, m_ = _need(g, 'K', formula), _nonzero(_need(g, 'm', formula), 'm', formula)
        value = _positive_root(2 * K_ / m_,
                               'Kinetic energy and mass must give a non-negative speed.')
        return _step(value, 'v = sqrt(2K / m)',
                     f'v = sqrt(2 x {fmt(K_)} / {fmt(m_)})',
                     [f'v = sqrt({fmt(2 * K_ / m_)})', f'v = {fmt(value)} m/s'],
                     notes=['The positive root is shown.'])

    return _simple_linear('kinetic_energy', 'Kinetic energy', formula,
                          ('K', 'm', 'v'),
                          ('Translational kinetic energy',
                           'Speed is the non-negative root'),
                          {'K': K, 'm': m, 'v': v}, {'v': 'speed'})


def _torque():
    formula = 'tau = F r'

    def tau(g):
        F, r = _need(g, 'F', formula), _need(g, 'r', formula)
        return _step(F * r, 'tau = F r', f'tau = {fmt(F)} x {fmt(r)}',
                     [f'tau = {fmt(F * r)} N m'])

    def F(g):
        tau_, r = _need(g, 'tau', formula), _nonzero(_need(g, 'r', formula), 'r', formula)
        return _step(tau_ / r, 'F = tau / r', f'F = {fmt(tau_)} / {fmt(r)}',
                     [f'F = {fmt(tau_ / r)} N'])

    def r(g):
        tau_, F_ = _need(g, 'tau', formula), _nonzero(_need(g, 'F', formula), 'F', formula)
        return _step(tau_ / F_, 'r = tau / F', f'r = {fmt(tau_)} / {fmt(F_)}',
                     [f'r = {fmt(tau_ / F_)} m'])

    return _simple_linear('torque', 'Torque', formula, ('tau', 'F', 'r'),
                          ('Force perpendicular to the lever arm',
                           'Lever arm measured from the pivot'),
                          {'tau': tau, 'F': F, 'r': r}, {})


def _angular_velocity():
    formula = 'v = omega r'

    def v(g):
        omega, r = _need(g, 'omega', formula), _need(g, 'r', formula)
        return _step(omega * r, 'v = omega r', f'v = {fmt(omega)} x {fmt(r)}',
                     [f'v = {fmt(omega * r)} m/s'])

    def omega(g):
        v_, r = _need(g, 'v', formula), _nonzero(_need(g, 'r', formula), 'r', formula)
        return _step(v_ / r, 'omega = v / r', f'omega = {fmt(v_)} / {fmt(r)}',
                     [f'omega = {fmt(v_ / r)} rad/s'])

    def r(g):
        v_, omega_ = _need(g, 'v', formula), \
            _nonzero(_need(g, 'omega', formula), 'omega', formula)
        return _step(v_ / omega_, 'r = v / omega', f'r = {fmt(v_)} / {fmt(omega_)}',
                     [f'r = {fmt(v_ / omega_)} m'])

    return _simple_linear('angular_velocity', 'Angular velocity', formula,
                          ('v', 'omega', 'r'),
                          ('Rolling without slipping',
                           'Radius measured to the rolling surface'),
                          {'v': v, 'omega': omega, 'r': r}, {'v': 'speed'})


def _friction_deceleration():
    formula = 'a = mu g'

    def a(g):
        mu, gravity = _need(g, 'mu', formula), _need(g, 'g', formula)
        return _step(mu * gravity, 'a = mu g', f'a = {fmt(mu)} x {fmt(gravity)}',
                     [f'a = {fmt(mu * gravity)} m/s2'],
                     notes=['This is the magnitude of the deceleration; the lab '
                            'applies it as negative.'])

    def mu(g):
        a_, gravity = _need(g, 'a', formula), _nonzero(_need(g, 'g', formula), 'g', formula)
        return _step(a_ / gravity, 'mu = a / g',
                     f'mu = {fmt(a_)} / {fmt(gravity)}',
                     [f'mu = {fmt(a_ / gravity)}'])

    def g_(g):
        a_, mu_ = _need(g, 'a', formula), _nonzero(_need(g, 'mu', formula), 'mu', formula)
        return _step(a_ / mu_, 'g = a / mu', f'g = {fmt(a_)} / {fmt(mu_)}',
                     [f'g = {fmt(a_ / mu_)} m/s2'])

    return _simple_linear('friction_deceleration', 'Friction deceleration',
                          formula, ('a', 'mu', 'g'),
                          ('Kinetic friction', 'Level surface',
                           'a is the magnitude of deceleration'),
                          {'a': a, 'mu': mu, 'g': g_},
                          {'a': 'deceleration', 'mu': 'friction'})


def _stopping_distance():
    formula = 'd = v^2 / (2 mu g)'

    def d(g):
        v, mu, gravity = (_need(g, s, formula) for s in ('v', 'mu', 'g'))
        denom = _nonzero(2 * mu * gravity, 'mu g', formula)
        return _step(v * v / denom, 'd = v^2 / (2 mu g)',
                     f'd = {fmt(v)}^2 / (2 x {fmt(mu)} x {fmt(gravity)})',
                     [f'd = {fmt(v * v)} / {fmt(denom)}',
                      f'd = {fmt(v * v / denom)} m'])

    def v(g):
        d_, mu, gravity = (_need(g, s, formula) for s in ('d', 'mu', 'g'))
        value = _positive_root(2 * mu * gravity * d_,
                               'The stopping distance and friction cannot give a real speed.')
        return _step(value, 'v = sqrt(2 mu g d)',
                     f'v = sqrt(2 x {fmt(mu)} x {fmt(gravity)} x {fmt(d_)})',
                     [f'v = sqrt({fmt(2 * mu * gravity * d_)})',
                      f'v = {fmt(value)} m/s'])

    def mu(g):
        d_, v_, gravity = _need(g, 'd', formula), _need(g, 'v', formula), \
            _nonzero(_need(g, 'g', formula), 'g', formula)
        _nonzero(d_, 'd', formula)
        value = v_ * v_ / (2 * gravity * d_)
        return _step(value, 'mu = v^2 / (2 g d)',
                     f'mu = {fmt(v_)}^2 / (2 x {fmt(gravity)} x {fmt(d_)})',
                     [f'mu = {fmt(v_ * v_)} / {fmt(2 * gravity * d_)}',
                      f'mu = {fmt(value)}'])

    def g_(g):
        d_, v_, mu_ = _need(g, 'd', formula), _need(g, 'v', formula), \
            _nonzero(_need(g, 'mu', formula), 'mu', formula)
        _nonzero(d_, 'd', formula)
        value = v_ * v_ / (2 * mu_ * d_)
        return _step(value, 'g = v^2 / (2 mu d)',
                     f'g = {fmt(v_)}^2 / (2 x {fmt(mu_)} x {fmt(d_)})',
                     [f'g = {fmt(v_ * v_)} / {fmt(2 * mu_ * d_)}',
                      f'g = {fmt(value)} m/s2'])

    return _simple_linear('stopping_distance', 'Stopping distance', formula,
                          ('d', 'v', 'mu', 'g'),
                          ('Constant kinetic friction', 'Level lane',
                           'No other forces'),
                          {'d': d, 'v': v, 'mu': mu, 'g': g_},
                          {'v': 'speed', 'mu': 'friction'})


def _stopping_time():
    formula = 't = v / (mu g)'

    def t(g):
        v, mu, gravity = (_need(g, s, formula) for s in ('v', 'mu', 'g'))
        denom = _nonzero(mu * gravity, 'mu g', formula)
        return _step(v / denom, 't = v / (mu g)',
                     f't = {fmt(v)} / ({fmt(mu)} x {fmt(gravity)})',
                     [f't = {fmt(v)} / {fmt(denom)}', f't = {fmt(v / denom)} s'])

    def v(g):
        t_, mu, gravity = (_need(g, s, formula) for s in ('t', 'mu', 'g'))
        return _step(t_ * mu * gravity, 'v = t mu g',
                     f'v = {fmt(t_)} x {fmt(mu)} x {fmt(gravity)}',
                     [f'v = {fmt(t_ * mu * gravity)} m/s'])

    def mu(g):
        t_, v_, gravity = _nonzero(_need(g, 't', formula), 't', formula), \
            _need(g, 'v', formula), _nonzero(_need(g, 'g', formula), 'g', formula)
        value = v_ / (gravity * t_)
        return _step(value, 'mu = v / (g t)',
                     f'mu = {fmt(v_)} / ({fmt(gravity)} x {fmt(t_)})',
                     [f'mu = {fmt(v_)} / {fmt(gravity * t_)}',
                      f'mu = {fmt(value)}'])

    def g_(g):
        t_, v_, mu_ = _nonzero(_need(g, 't', formula), 't', formula), \
            _need(g, 'v', formula), _nonzero(_need(g, 'mu', formula), 'mu', formula)
        value = v_ / (mu_ * t_)
        return _step(value, 'g = v / (mu t)',
                     f'g = {fmt(v_)} / ({fmt(mu_)} x {fmt(t_)})',
                     [f'g = {fmt(v_)} / {fmt(mu_ * t_)}',
                      f'g = {fmt(value)} m/s2'])

    return _simple_linear('stopping_time', 'Stopping time', formula,
                          ('t', 'v', 'mu', 'g'),
                          ('Constant kinetic friction', 'Level lane',
                           'No other forces'),
                          {'t': t, 'v': v, 'mu': mu, 'g': g_},
                          {'v': 'speed', 'mu': 'friction'})


def _sideways_velocity():
    formula = 'vx = v sin(theta)'

    def vx(g):
        v, theta = _need(g, 'v', formula), _need(g, 'theta', formula)
        value = v * math.sin(math.radians(theta))
        return _step(value, 'vx = v sin(theta)',
                     f'vx = {fmt(v)} sin({fmt(theta)} deg)',
                     [f'vx = {fmt(value)} m/s'])

    def v(g):
        vx_, theta = _need(g, 'vx', formula), _need(g, 'theta', formula)
        sine = _nonzero(math.sin(math.radians(theta)), 'sin(theta)', formula)
        return _step(vx_ / sine, 'v = vx / sin(theta)',
                     f'v = {fmt(vx_)} / sin({fmt(theta)} deg)',
                     [f'v = {fmt(vx_ / sine)} m/s'])

    def theta(g):
        vx_, v_ = _need(g, 'vx', formula), _nonzero(_need(g, 'v', formula), 'v', formula)
        ratio = vx_ / v_
        if abs(ratio) > 1 + 1e-9:
            raise EquationError('The sideways speed cannot exceed the total speed.')
        value = math.degrees(math.asin(max(-1.0, min(1.0, ratio))))
        return _step(value, 'theta = asin(vx / v)',
                     f'theta = asin({fmt(vx_)} / {fmt(v_)})',
                     [f'theta = asin({fmt(ratio)})',
                      f'theta = {fmt(value)} deg'])

    return _simple_linear('sideways_velocity', 'Sideways velocity', formula,
                          ('vx', 'v', 'theta'),
                          ('Aim is measured from the lane axis',
                           'Positive aim points right'),
                          {'vx': vx, 'v': v, 'theta': theta},
                          {'v': 'speed', 'theta': 'aim'})


EQUATIONS = [
    _uniform_motion(), _velocity_time(), _displacement_time(),
    _velocity_displacement(), _force(), _work(), _kinetic_energy(),
    _torque(), _angular_velocity(), _friction_deceleration(),
    _stopping_distance(), _stopping_time(), _sideways_velocity(),
]


def equation_by_id(equation_id):
    for equation in EQUATIONS:
        if equation['id'] == equation_id:
            return equation
    return None


def _finite(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _with_defaults(equation, given):
    values = dict(given)
    notes = []
    for symbol in equation['variables']:
        meta = VARIABLES.get(symbol, {})
        if meta.get('default') is not None and not _finite(values.get(symbol)):
            values[symbol] = meta['default']
            notes.append(f'{meta["label"]} ({symbol}) was not given; standard '
                         f'{symbol} = {fmt(meta["default"])} {meta["unit"]} is assumed.')
    return values, notes


def _missing_for(equation, find, values):
    missing = []
    for symbol in equation['variables']:
        if symbol == find:
            continue
        meta = VARIABLES.get(symbol, {})
        if meta.get('default') is not None and not _finite(values.get(symbol)):
            continue
        if not _finite(values.get(symbol)):
            missing.append(symbol)
    return missing


def _apply_hints(equation, find, value, values):
    target = (equation.get('apply') or {}).get(find)
    if not target:
        return {}
    if target == 'deceleration':
        if equation['id'] == 'friction_deceleration':
            return {'deceleration': -abs(value)}
        if value > 1e-9:
            return {'unsupported': 'The lane can slow the ball but cannot apply '
                                   'positive acceleration.'}
        return {'deceleration': -abs(value)}
    if target == 'friction':
        gravity = values.get('g')
        if not _finite(gravity):
            gravity = GRAVITY
        return {'friction': value,
                'deceleration': -abs(value * gravity)}
    if target == 'speed':
        return {'speed': max(0.0, value)}
    if target == 'aim':
        return {'aim': value}
    return {}


def _solve_one(equation, find, given):
    if find not in equation['solve']:
        return {'ok': False, 'equationId': equation['id'],
                'equationName': equation['name'],
                'formula': equation['formula'], 'find': find,
                'given': dict(given), 'missing': [],
                'message': f'{equation["name"]} has no solver for {find}.',
                'assumptions': equation['assumptions']}
    values, default_notes = _with_defaults(equation, given)
    missing = _missing_for(equation, find, values)
    if missing:
        labels = [f'{VARIABLES[s]["label"]} ({s})' for s in missing]
        return {
            'ok': False, 'equationId': equation['id'],
            'equationName': equation['name'],
            'formula': equation['formula'], 'find': find,
            'given': values, 'missing': missing,
            'message': (f'{" and ".join(labels)} '
                        f'{"is" if len(missing) == 1 else "are"} required to '
                        f'calculate {VARIABLES[find]["label"]} ({find}) using '
                        f'{equation["formula"]}.'),
            'assumptions': equation['assumptions'],
        }
    try:
        _validate_given(equation, values, find)
        solution = equation['solve'][find](values)
        _validate_result(find, solution['value'])
    except EquationError as error:
        return {'ok': False, 'equationId': equation['id'],
                'equationName': equation['name'],
                'formula': equation['formula'], 'find': find,
                'given': values, 'missing': [],
                'message': str(error), 'assumptions': equation['assumptions']}
    value = solution['value']
    unit = VARIABLES[find]['unit']
    return {
        'ok': True, 'equationId': equation['id'],
        'equationName': equation['name'],
        'formula': equation['formula'], 'find': find, 'given': values,
        'rearranged': solution['rearranged'],
        'substitution': solution['substitution'],
        'steps': solution['steps'], 'value': value, 'unit': unit,
        'answer': f'{find} = {fmt(value)}{" " + unit if unit else ""}',
        'assumptions': list(equation['assumptions']) + default_notes
        + list(solution.get('notes', [])),
        'alternatives': solution.get('alternatives', []),
        'apply': _apply_hints(equation, find, value, values),
        'kind': 'analytical', 'exact': True,
        'note': ' '.join(default_notes),
    }


def _alternative_for(find, given, exclude_id):
    for equation in EQUATIONS:
        if equation['id'] == exclude_id or find not in equation['variables']:
            continue
        attempt = _solve_one(equation, find, given)
        if attempt['ok']:
            return attempt
    return None


def solve_equation(equation_id, find, given=None):
    """Try the selected equation, then any other equation using the same givens."""
    selected = equation_by_id(equation_id) or EQUATIONS[0]
    first = _solve_one(selected, find, given or {})
    if first['ok']:
        first['requestedEquationId'] = selected['id']
        return first
    alternative = _alternative_for(find, given or {}, selected['id'])
    if alternative:
        note = alternative.get('note', '')
        reason = ('needs more information' if first['missing']
                  else f'could not be used ({first["message"]})')
        note = (note + ' ' if note else '') + (
            f'Used {alternative["equationName"]} instead of '
            f'{selected["name"]} because {selected["name"]} {reason}.')
        alternative['note'] = note
        alternative['requestedEquationId'] = selected['id']
        return alternative
    first['requestedEquationId'] = selected['id']
    return first
