"""Physics Trivia questions and the free-response answer checking they share.

Pure Python + stdlib: no engine, no rendering, so the bank and its marking can
be unit-tested directly (see ``tests/test_questions.py``).

Physics Trivia - a knowledge mode
---------------------------------
:data:`TRIVIA_QUESTIONS` **tests understanding of physics concepts** - what
momentum is, why friction matters, how a collision transfers momentum. The
answers are words (or one clearly stated number) and the explanation says why.
A correct answer earns one throw at a full rack; a wrong one forfeits it.

That is deliberately different from Equation Mode, which is a *problem-solving*
mode: its interactive challenges live in :mod:`game.challenges`, where the
player's value is launched into the simulation instead of being marked right
or wrong, and the equations are used to steer the ball.

Answer checking
---------------
* ``check_answer`` accepts the same value written in several reasonable ways:
  ``20``, ``20.0``, ``20 m/s``, ``2.0e1 m/s`` and ``20.0 m / s`` are the same
  answer to a question that asks for a speed. Unit spellings are normalised
  (``kg*m/s`` = ``kg·m/s`` = ``kg m/s``) and a unit the question does not
  expect is rejected rather than ignored.
* Numerical answers are compared with a tolerance (2 % relative, 0.05
  absolute by default) because a hand-rounded value is a correct answer.
* Text answers are matched against a small set of accepted spellings after
  normalisation; nothing fuzzy, so an unrelated answer cannot be accepted by
  accident.
"""
import re
from dataclasses import dataclass, field

_NUMBER_RE = re.compile(r'[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?')
_MULTIPLY = ('*', '·', '⋅', '×', '∙')
_NORMALISE_CHARS = {
    '\u2212': '-',      # unicode minus
    '\u2013': '-',
    '\u00b7': '*',
    '\u22c5': '*',
    '\u00d7': '*',
    '\u00b0': '',
}


@dataclass(frozen=True)
class Question:
    """One trivia question or equation problem."""

    prompt: str
    answer: object                    # float for numerical, str for text
    unit: str = ''                    # expected unit ('' = unitless / text)
    accepted_units: tuple = ()        # other spellings that mean the unit
    tolerance: float = 0.02           # relative tolerance
    abs_tolerance: float = 0.05       # absolute tolerance
    aliases: tuple = ()               # accepted text answers
    equation: str = ''                # the formula the player should apply
    given: tuple = ()                 # (('m', '6.0 kg'), ...)
    unknown: str = ''                 # what is being asked for
    working: str = ''                 # worked solution / explanation
    concept: str = ''                 # short concept tag
    assumptions: str = ''             # stated assumptions, when they matter
    id: str = ''                      # stable key for tests and diagnostics
    given_values: dict = field(default_factory=dict)   # the numbers behind ``given``
    bowling: str = ''                 # how the answer connects to a real throw
    case: str = ''                    # the case label shown above the question
    hints: tuple = ()                 # progressive steps, unlocked one per attempt

    @property
    def is_numeric(self):
        return isinstance(self.answer, (int, float))

    def expected_text(self):
        """The answer as it should be shown to the player."""
        if not self.is_numeric:
            return str(self.answer)
        value = _format_number(float(self.answer))
        return f'{value} {self.unit}'.strip()


@dataclass
class Feedback:
    """The result of checking one answer."""

    correct: bool
    summary: str = ''
    parsed_value: float = None
    parsed_unit: str = ''
    expected: str = ''
    working: str = ''
    detail: str = ''

    def __bool__(self):
        return self.correct


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def normalise(text):
    """Lower-case, unify minus/multiply glyphs and collapse whitespace."""
    if text is None:
        return ''
    out = str(text).strip()
    for source, target in _NORMALISE_CHARS.items():
        out = out.replace(source, target)
    return out.lower()


def normalise_unit(text):
    """Unit text reduced to a comparable form: ``kg*m/s`` -> ``kgm/s``."""
    out = normalise(text)
    for glyph in _MULTIPLY:
        out = out.replace(glyph, '')
    for token in (' ', '\t', '^', '**', 'per '):
        out = out.replace(token, '')
    out = out.replace('1/s', '/s')
    out = out.replace('s-1', '/s')
    out = out.replace('s^-1', '/s')
    out = out.replace('m/s2', 'm/s^2')
    out = out.replace('m/s²', 'm/s^2')
    return out


def normalise_words(text):
    """Text answer reduced to its letters and digits: ``kg·m/s`` -> ``kgms``."""
    out = normalise(text)
    return ''.join(ch for ch in out if ch.isalnum())


def parse_number(text):
    """Return the first number in ``text`` as a float, or None.

    Scientific notation (``2.5e1``) and a leading sign are accepted, which is
    what lets ``-4.0`` and ``2.0e1`` be checked like plain decimals.
    """
    match = _NUMBER_RE.search(normalise(text))
    if match is None:
        return None
    try:
        return float(match.group(0))
    except ValueError:                      # pragma: no cover - regex guards it
        return None


def parse_answer(text):
    """Split raw player input into ``(value, unit_text)``.

    ``value`` is the first number (or None when there is none) and
    ``unit_text`` is everything else, normalised.
    """
    cleaned = normalise(text)
    match = _NUMBER_RE.search(cleaned)
    if match is None:
        return None, normalise_unit(cleaned)
    value = parse_number(match.group(0))
    unit = cleaned[:match.start()] + ' ' + cleaned[match.end():]
    return value, normalise_unit(unit)


def _format_number(value):
    """Shortest reasonable display of a computed answer."""
    if value == int(value) and abs(value) < 1e6:
        return str(int(value))
    return f'{value:.4g}'


def _close(measured, expected, question):
    if measured is None:
        return False
    tolerance = max(question.abs_tolerance,
                    abs(expected) * question.tolerance)
    return abs(measured - expected) <= tolerance


def check_numeric(question, value, unit_text):
    """Check a numeric answer; returns a :class:`Feedback`."""
    expected = float(question.answer)
    if value is None:
        return Feedback(False, 'No number found in that answer.',
                        expected=question.expected_text(),
                        working=question.working,
                        detail='Type the value, for example "6" or "6 m/s".')
    if unit_text:
        allowed = {normalise_unit(question.unit)} | {
            normalise_unit(extra) for extra in question.accepted_units}
        allowed.discard('')
        if allowed and unit_text not in allowed:
            return Feedback(
                False,
                f'That unit is not the one this question is asking for '
                f'(expected {question.unit or "no unit"}).',
                parsed_value=value, parsed_unit=unit_text,
                expected=question.expected_text(), working=question.working)
    if not _close(value, expected, question):
        return Feedback(
            False, 'Not quite - check the substitution and the arithmetic.',
            parsed_value=value, parsed_unit=unit_text,
            expected=question.expected_text(), working=question.working,
            detail=f'Your answer: {_format_number(value)}. '
                   f'Expected: {question.expected_text()}.')
    return Feedback(True, f'Correct: {question.expected_text()}.',
                    parsed_value=value, parsed_unit=unit_text,
                    expected=question.expected_text(),
                    working=question.working)


def check_text(question, text):
    """Check a text answer; returns a :class:`Feedback`."""
    candidate = normalise_words(text)
    accepted = {normalise_words(question.answer)}
    accepted.update(normalise_words(alias) for alias in question.aliases)
    if candidate and candidate in accepted:
        return Feedback(True, f'Correct: {question.answer}.',
                        expected=str(question.answer),
                        working=question.working)
    return Feedback(False, 'That is not the answer this question is after.',
                    expected=str(question.answer), working=question.working,
                    detail=f'You answered: "{str(text).strip()}".')


def check_answer(question, text):
    """Mark ``text`` against ``question`` (#1 public entry point)."""
    if text is None or not str(text).strip():
        return Feedback(False, 'Enter an answer first.',
                        expected=question.expected_text(),
                        working=question.working)
    if question.is_numeric:
        value, unit_text = parse_answer(text)
        return check_numeric(question, value, unit_text)
    return check_text(question, text)


# ---------------------------------------------------------------------------
# The trivia bank
# ---------------------------------------------------------------------------

TRIVIA_QUESTIONS = (
    Question(
        prompt='Which physical quantity is the product of mass and velocity?',
        answer='momentum',
        aliases=('linear momentum', 'the momentum', 'p', 'momenta'),
        concept='Momentum',
        working='p = m v. Mass times velocity is momentum, measured in '
                'kg m/s.',
    ),
    Question(
        prompt='What is the SI unit of force?',
        answer='newton',
        aliases=('newtons', 'n', 'newton (n)'),
        concept='Force and units',
        working='The newton (N): 1 N = 1 kg m/s^2, the force that gives 1 kg '
                'an acceleration of 1 m/s^2.',
    ),
    Question(
        prompt='A bowling ball rolls down the lane at a constant speed in a '
               'straight line. What is its acceleration? Give the value.',
        answer=0.0,
        unit='m/s^2',
        accepted_units=('m/s2', 'm s^-2', 'm/s/s', 'ms-2'),
        concept='Acceleration',
        working='a = dv/dt. Velocity is not changing, so the acceleration is '
                '0 m/s^2 (friction and the lane force balance out).',
    ),
    Question(
        prompt='A ball is sliding forward on the lane. Which way does the '
               'kinetic friction force on the ball point?',
        answer='backwards',
        aliases=('backward', 'opposite the motion', 'opposite to the motion',
                 'against the motion', 'opposite the direction of motion',
                 'opposite', 'back', 'in the opposite direction'),
        concept='Friction',
        working='Kinetic friction always opposes the relative sliding, so on a '
                'forward-sliding ball it points backwards along the lane.',
    ),
    Question(
        prompt='Which has more kinetic energy: a 6 kg ball rolling at 8 m/s, '
               'or a 2 kg ball rolling at 16 m/s?',
        answer='2 kg ball',
        aliases=('the 2 kg ball', '2kg', '2 kg', 'the 2kg ball',
                 'second', 'the second', 'b', '2 kilogram ball',
                 'the 2 kilogram ball'),
        concept='Kinetic energy',
        working='KE = 1/2 m v^2: the 6 kg ball has 192 J, the 2 kg ball has '
                '256 J, so the lighter but much faster ball has more.',
    ),
    Question(
        prompt='During the impact between a heavy ball and a light pin, how do '
               'the magnitudes of the forces on the two bodies compare?',
        answer='equal',
        aliases=('they are equal', 'the same', 'same', 'equal and opposite',
                 'equal in magnitude', 'the same magnitude', 'both the same',
                 'they are the same'),
        concept="Newton's third law",
        working='The forces are an action-reaction pair: equal in magnitude, '
                'opposite in direction. The *accelerations* differ because the '
                'masses differ.',
    ),
    Question(
        prompt='A ball travels 18 m in 3 s at a constant speed. What is its '
               'speed?',
        answer=6.0,
        unit='m/s',
        accepted_units=('m s^-1', 'ms-1', 'm.s^-1', 'mps'),
        concept='Speed',
        working='v = d/t = 18 m / 3 s = 6 m/s.',
    ),
    Question(
        prompt='Which quantity is the rate of change of velocity?',
        answer='acceleration',
        aliases=('the acceleration', 'a', 'acceleration of the body'),
        concept='Acceleration',
        working='Acceleration is how fast velocity changes: a = dv/dt, in '
                'm/s^2.',
    ),
    Question(
        prompt='A bowler speeds a ball up from 4 m/s to 8 m/s in 2 s. What is '
               'the acceleration?',
        answer=2.0,
        unit='m/s^2',
        accepted_units=('m/s2', 'm/s/s', 'ms-2', 'm s^-2'),
        concept='Acceleration',
        working='a = (v - u)/t = (8 - 4)/2 = 2 m/s^2.',
    ),
    Question(
        prompt='Impulse is equal to the change in which quantity?',
        answer='momentum',
        aliases=('linear momentum', 'the momentum', 'p', 'momenta'),
        concept='Impulse',
        working='J = F dt = dp. An impulse changes momentum, which is why a '
                'hard hit (short contact, large force) changes it quickly.',
    ),
)


# ---------------------------------------------------------------------------
# Trivia sessions
# ---------------------------------------------------------------------------

def trivia_for_session(count=None):
    """The trivia questions for one session (in bank order)."""
    questions = list(TRIVIA_QUESTIONS)
    return questions[:count] if count else questions


def bank_size(gate):
    """How many questions a gate's bank holds (trivia only now)."""
    return len(TRIVIA_QUESTIONS)
