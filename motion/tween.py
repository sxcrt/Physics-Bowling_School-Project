"""The tween / timeline utility the whole game animates through.

Three small pieces, all engine-free and unit-testable:

* :class:`Tween` - one value animated over time, reported to a callback.
  It never touches an entity itself: the caller decides what the value means
  (a scale multiplier, an alpha, a UI offset, a count-up number). That keeps
  every effect in this codebase a tween plus a tiny apply function instead of a
  bespoke update loop.
* :class:`Timeline` - an ordered script of waits, tweens and callbacks, for the
  multi-stage moments (result text: in -> hold -> float out; pin reset:
  sweeper -> drop-in).
* :class:`Motion` - the runner. One instance owns a list of live tweens and
  timelines and is stepped once per frame by the game loop.

House rules encoded here:

* ``MOTION.ui_max_duration`` is the default cap for a new tween, unless the
  caller marks it a celebration (``celebrate=True``).
* A tween never runs with a zero or negative duration: it completes
  immediately, so callers can write the same code whether or not the motion is
  suppressed (reduce motion).
* Nothing throws if a callback fails: an animation must never break a match.
"""
from motion import ease as _ease
from motion.config import MOTION


class Tween:
    """One animated value.

    ``on_update(progress)`` receives the *eased* progress (which may overshoot
    1.0 with :data:`motion.ease.OVERSHOOT`), so a caller can map it onto
    anything: ``entity.scale_y * progress``, ``lerp(old, new, progress)``,
    ``int(round(lerp(old, new, progress)))``.
    """

    __slots__ = ('duration', 'on_update', 'delay', 'easing', 'on_complete',
                 'loop', 'yoyo', 'tag', 'owner', 'time', 'elapsed',
                 'finished', 'cancelled', '_direction', '_started')

    def __init__(self, duration, on_update, easing=None, delay=0.0,
                 on_complete=None, loop=False, yoyo=False, tag=None,
                 owner=None, celebrate=False):
        if duration is None:
            duration = MOTION.ui_max_duration
        self.duration = max(0.0, float(duration))
        self.on_update = on_update
        self.delay = max(0.0, float(delay))
        self.easing = _ease.resolve(easing)
        self.on_complete = on_complete
        self.loop = bool(loop)
        self.yoyo = bool(yoyo)
        self.tag = tag
        self.owner = owner
        self.time = 0.0
        self.elapsed = 0.0
        self.finished = False
        self.cancelled = False
        self._direction = 1.0
        self._started = False
        if not celebrate and self.duration > MOTION.ui_max_duration:
            # Enforce the house rule gently: a forgotten cap becomes the cap.
            self.duration = MOTION.ui_max_duration

    # ------------------------------------------------------------------ runner
    def update(self, dt):
        """Advance the tween; returns True while it is still running."""
        if self.finished or self.cancelled:
            return False
        dt = max(0.0, float(dt))
        self.elapsed += dt
        if self.delay > 0.0:
            if self.elapsed < self.delay:
                return True
            # The delay is done: only the time spent past it belongs to the
            # tween itself, so a long frame cannot skip the animation.
            dt = max(0.0, self.elapsed - self.delay)
            self.delay = 0.0
        self.time += dt
        if self.duration <= 0.0:
            self._emit(1.0)
            self._finish()
            return False
        raw = self.time / self.duration
        if raw >= 1.0:
            if self.loop or self.yoyo:
                # Wrap, preserving the remainder so a long frame cannot stall.
                self.time = raw = raw % 1.0
                if self.yoyo:
                    self._direction *= -1.0
            else:
                self._emit(1.0)
                self._finish()
                return False
        value = self.easing(raw)
        if self._direction < 0.0:
            value = self.easing(1.0 - raw)
        self._emit(value)
        return True

    def _emit(self, value):
        self._started = True
        callback = self.on_update
        if callback is None:
            return
        try:
            callback(value)
        except Exception:                    # pragma: no cover - animation only
            # A broken apply function must not take the frame (or the match)
            # down with it.
            self.finished = True
            self.cancelled = True

    def _finish(self):
        self.finished = True
        callback = self.on_complete
        if callback is None:
            return
        try:
            callback()
        except Exception:                    # pragma: no cover - animation only
            pass

    # ----------------------------------------------------------------- control
    def cancel(self, call_complete=False):
        """Stop the tween (no further ``on_update`` calls)."""
        if self.finished:
            return
        self.cancelled = True
        self.finished = True
        if call_complete:
            self._finish()

    def complete(self):
        """Jump to the end and run the completion callback."""
        if self.finished or self.cancelled:
            return
        self._emit(1.0)
        self._finish()

    def restart(self):
        self.time = 0.0
        self.elapsed = 0.0
        self.finished = False
        self.cancelled = False
        self._direction = 1.0
        return self

    @property
    def progress(self):
        if self.duration <= 0.0:
            return 1.0
        return min(1.0, self.time / self.duration)


class Timeline:
    """A sequence of waits, tweens and callbacks, run one step at a time.

    Example - the STRIKE result card::

        Motion.timeline([
            steps.tween(0.40, pop_in, easing=OVERSHOOT),
            steps.wait(0.90),
            steps.tween(0.35, fade_out),
        ])

    Steps are plain dicts built by :func:`wait`, :func:`tween_step` and
    :func:`call_step`; a step may also be a ``(delay, callable)`` pair or a
    :class:`Tween` instance, which keeps ad-hoc sequences readable.
    """

    __slots__ = ('steps', 'index', 'timer', 'active_tween', 'finished',
                 'cancelled', 'tag', 'owner')

    def __init__(self, steps=None, tag=None, owner=None):
        self.steps = list(steps or [])
        self.index = 0
        self.timer = 0.0
        self.active_tween = None
        self.finished = False
        self.cancelled = False
        self.tag = tag
        self.owner = owner

    def add(self, step):
        self.steps.append(step)
        return self

    def update(self, dt):
        """Advance the timeline; returns True while it is still running."""
        if self.finished or self.cancelled:
            return False
        dt = max(0.0, float(dt))
        guard = 0
        while not self.finished and not self.cancelled:
            guard += 1
            if guard > 128:                 # a script that only waits: bail out
                break
            if self.active_tween is not None:
                if self.active_tween.finished:
                    self.active_tween = None
                    self.index += 1
                    self.timer = 0.0
                    continue
                self.active_tween.update(dt)
                dt = 0.0
                if self.active_tween is not None \
                        and not self.active_tween.finished:
                    return True
                continue
            if self.index >= len(self.steps):
                self.finished = True
                return False
            step = self.steps[self.index]
            kind, payload = _normalise_step(step)
            if kind == 'wait':
                self.timer += dt
                dt = 0.0
                if self.timer >= payload:
                    self.index += 1
                    self.timer = 0.0
                    continue
                return True
            if kind == 'call':
                self.index += 1
                try:
                    payload()
                except Exception:                # pragma: no cover
                    pass
                continue
            if kind == 'tween':
                self.active_tween = payload
                payload.update(dt)
                dt = 0.0
                continue
            # Unknown step: skip it rather than hang the script.
            self.index += 1
        return not self.finished

    def cancel(self):
        self.cancelled = True
        self.finished = True
        if self.active_tween is not None:
            self.active_tween.cancel()
            self.active_tween = None

    def complete(self):
        """Run the rest of the script immediately (used by reduce motion)."""
        guard = 0
        while not self.finished and guard < 512:
            guard += 1
            self.update(1e6)

    @property
    def progress(self):
        if not self.steps:
            return 1.0
        return min(1.0, self.index / len(self.steps))


def _normalise_step(step):
    """Return ``(kind, payload)`` for any of the accepted step shapes."""
    if isinstance(step, Tween):
        return 'tween', step
    if isinstance(step, (int, float)):
        return 'wait', max(0.0, float(step))
    if callable(step):
        return 'call', step
    if isinstance(step, dict):
        kind = step.get('type', 'wait')
        if kind == 'tween':
            return 'tween', step['tween']
        return kind, step.get('value', step.get('delay', 0.0))
    if isinstance(step, (tuple, list)) and len(step) == 2:
        first, second = step
        if callable(second):
            return ('wait', float(first)) if isinstance(first, (int, float)) \
                else ('call', second)
        return 'wait', float(first)
    return 'skip', None


def wait(delay):
    """A timeline step that waits ``delay`` seconds."""
    return {'type': 'wait', 'value': float(delay)}


def call(callback):
    """A timeline step that calls ``callback`` once."""
    return {'type': 'call', 'value': callback}


def tween_step(duration, on_update, easing=None, delay=0.0, tag=None,
               celebrate=False):
    """A timeline step that runs one :class:`Tween` and waits for it."""
    return {'type': 'tween',
            'tween': Tween(duration, on_update, easing=easing, delay=delay,
                           tag=tag, celebrate=celebrate)}


class Motion:
    """The runner: owns every live tween and timeline for one context.

    The game creates one (through :class:`motion.director.MotionDirector`),
    the HUD widgets share it, and the play loop calls :meth:`update` exactly
    once per frame. Groups can be cancelled by tag or owner, which is how a
    re-triggered effect (a second strike) cleanly replaces the first.
    """

    def __init__(self):
        self.tweens = []
        self.timelines = []
        self.time = 0.0
        self.last_dt = 1.0 / 60.0

    # -------------------------------------------------------------- factories
    def tween(self, duration, on_update, easing=None, delay=0.0,
              on_complete=None, loop=False, yoyo=False, tag=None, owner=None,
              celebrate=False):
        """Create, start and return a :class:`Tween`.

        The tween's start value is emitted immediately (``progress 0``), so a
        pop or a stamp is on screen the moment it is triggered instead of
        waiting one frame; a tween with a delay stays quiet until its delay is
        over.
        """
        tween = Tween(duration, on_update, easing=easing, delay=delay,
                      on_complete=on_complete, loop=loop, yoyo=yoyo, tag=tag,
                      owner=owner, celebrate=celebrate)
        if not tween.finished:
            tween.update(0.0)
        if not tween.finished:
            self.tweens.append(tween)
        return tween

    def timeline(self, steps=None, tag=None, owner=None):
        """Create, start and return a :class:`Timeline`."""
        timeline = Timeline(steps, tag=tag, owner=owner)
        self.timelines.append(timeline)
        return timeline

    def count_up(self, start, end, duration, setter, formatter=None,
                 easing=None, tag=None, on_complete=None, celebrate=False):
        """Animate a number from ``start`` to ``end``, reporting every step.

        ``setter(value)`` receives the rounded intermediate value; this is the
        one implementation behind the scoreboard total, the HUD score and the
        game-end total (see the spec's "counts up numerically instead of
        snapping").
        """
        return self.tween(
            duration,
            lambda p: _report_count(start, end, p, setter, formatter),
            easing=easing, tag=tag, on_complete=on_complete,
            celebrate=celebrate)

    # ------------------------------------------------------------------ update
    def update(self, dt):
        """Step every tween and timeline (called once per frame)."""
        dt = max(0.0, min(0.25, float(dt)))      # a hitch must not jump an anim
        self.last_dt = dt or self.last_dt
        self.time += dt
        if self.tweens:
            for tween in self.tweens:
                tween.update(dt)
            if any(tween.finished for tween in self.tweens):
                self.tweens = [t for t in self.tweens if not t.finished]
        if self.timelines:
            for timeline in self.timelines:
                timeline.update(dt)
            if any(timeline.finished for timeline in self.timelines):
                self.timelines = [t for t in self.timelines
                                  if not t.finished]

    # ----------------------------------------------------------------- control
    def cancel(self, tag=None, owner=None):
        """Cancel tweets by tag, owner, or everything when both are None."""
        for collection in (self.tweens, self.timelines):
            for item in collection:
                if tag is None and owner is None:
                    item.cancel()
                elif tag is not None and getattr(item, 'tag', None) == tag:
                    item.cancel()
                elif owner is not None and getattr(item, 'owner', None) is owner:
                    item.cancel()
        self.tweens = [t for t in self.tweens if not t.finished]
        self.timelines = [t for t in self.timelines if not t.finished]

    def clear(self):
        """Drop everything (used when a screen is hidden)."""
        self.cancel()

    @property
    def busy(self):
        return bool(self.tweens or self.timelines)


def _report_count(start, end, progress, setter, formatter):
    """Emit one frame of a count-up.

    ``formatter`` (when given) turns the rounded number into the string or
    object the caller wants to show; without one the raw integer is reported.
    """
    rounded = int(round(start + (end - start) * progress))
    setter(formatter(rounded) if formatter is not None else rounded)


# A module-level default runner for widgets that do not get one injected
# (kept tiny on purpose: the director owns the real one).
DEFAULT = Motion()
