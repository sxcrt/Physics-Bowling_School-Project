"""Scoreboard animation state: the scorecard's per-cell presentation values.

The :class:`~ui.scorecard.Scorecard` still owns *layout*: it decides where a
cell is, what its text is and which frame is current. This module owns the
*motion* of those cells, and the scorecard asks it, once per cell per frame,
for a small transform bundle:

.. code-block:: python

    t = motion.cell_transform(index)
    background.position = (x, y + t['dy'])          # stagger-in / pops
    background.scale = (w * t['scale'], h * t['scale'])
    glow.color = rgba(cyan, t['glow'])              # active-frame breathing
    flash.color = rgba(amber, t['flash'])           # score-entry flash
    marks.scale *= t['mark_scale']                  # stamp
    marks.rotation_z = t['rotation']

Everything that changes is a tween on the shared :class:`motion.tween.Motion`
clock, so a re-triggered effect (a second strike in a row) cancels and
replaces the first cleanly, and nothing here allocates per frame.

Pure Python: no engine import, so the reveal/stamp/pop behaviour is unit
testable (see ``tests/test_motion.py``).
"""
import math

from motion import ease
from motion.config import MOTION


def rotate_about_centre(pivot, centre, degrees):
    """Move ``pivot`` so that ``centre`` stays put while rotating by ``degrees``.

    Used for the mark stamp: the text's own origin (top-centre) is the pivot,
    but a stamp should rotate about the glyph's middle. Offsetting the pivot
    by ``centre - R * (centre - pivot)`` keeps the middle in place.
    """
    dx = pivot[0] - centre[0]
    dy = pivot[1] - centre[1]
    radians = math.radians(degrees)
    cos_t, sin_t = math.cos(radians), math.sin(radians)
    rotated_x = dx * cos_t - dy * sin_t
    rotated_y = dx * sin_t + dy * cos_t
    return (centre[0] + rotated_x, centre[1] + rotated_y)


class CellMotion:
    """The animation values of one frame cell."""

    __slots__ = ('enter', 'enter_from', 'glow', 'glow_out', 'slide', 'scale',
                 'flash', 'pop', 'rotation', 'burst', 'total_shown')

    def __init__(self):
        self.enter = 1.0              # reveal progress (0..1)
        self.enter_from = 0.0         # vertical offset while revealing
        self.glow = 0.0               # active-frame glow alpha (0..1)
        self.glow_out = 0.0           # fading highlight of the previous frame
        self.slide = 0.0              # highlight slide-in offset
        self.scale = 1.0              # cell scale multiplier
        self.flash = 0.0              # amber flash strength (0..1)
        self.pop = 1.0                # marks scale multiplier
        self.rotation = 0.0           # marks rotation (degrees)
        self.burst = 0.0              # white glow burst of a stamp
        self.total_shown = None       # the value shown mid count-up

    def reset(self):
        self.enter = 1.0
        self.enter_from = 0.0
        self.glow = 0.0
        self.glow_out = 0.0
        self.slide = 0.0
        self.scale = 1.0
        self.flash = 0.0
        self.pop = 1.0
        self.rotation = 0.0
        self.burst = 0.0
        self.total_shown = None


class ScorecardMotion:
    """All ten cells, plus the board-level reveal and the final celebration."""

    CELLS = 10

    def __init__(self, motion):
        self.motion = motion
        self.cells = [CellMotion() for _ in range(self.CELLS)]
        self.clock = 0.0
        self.revealed = False
        self.active_index = None
        self.final_index = None
        self.final_total = None
        self.total_display = None
        self.total_counting = False

    # ------------------------------------------------------------------ reveal
    def start_reveal(self, stagger=True):
        """Frames slide down from the top, 40 ms apart, fading in."""
        self.revealed = True
        self.motion.cancel(tag='board_reveal')
        for index, state in enumerate(self.cells):
            state.enter = 1.0
            state.enter_from = 0.0
            if MOTION.reduce_motion or not stagger:
                # The reveal still happens (an entrance is not a vestibular
                # trigger) but without the fall.
                continue
            state.enter = 0.0
            state.enter_from = MOTION.board_enter_rise
            delay = MOTION.board_stagger * index

            def reveal(progress, index=index):
                cell = self.cells[index]
                cell.enter = progress
                cell.enter_from = MOTION.board_enter_rise * (1.0 - progress)

            self.motion.tween(MOTION.board_enter_time, reveal,
                              easing=ease.STANDARD, delay=delay,
                              tag='board_reveal')

    def hide_board(self):
        self.revealed = False

    # ------------------------------------------------------------ active frame
    def set_active(self, index):
        """Move the highlight: old glow fades out, new one slides in."""
        previous = self.active_index
        if self.final_index is not None:
            # The final-frame celebration owns the board; the highlight stays
            # on the last frame.
            index = self.final_index
        if previous == index:
            return
        self.active_index = index
        if previous is not None and previous != index:
            old = self.cells[previous]

            def fade_out(progress, old=old):
                old.glow_out = max(0.0, 1.0 - progress)
                old.glow = 0.0
                # Scale back down with the glow (same 200 ms as its fade).
                old.scale = ease.lerp(MOTION.frame_scale, 1.0, progress)

            self.motion.tween(MOTION.frame_switch_out, fade_out,
                              easing=ease.STANDARD, tag='frame_glow')
        if index is None:
            return
        state = self.cells[index]

        def slide_in(progress, state=state):
            state.glow = progress
            state.slide = MOTION.frame_slide * (1.0 - progress)
            state.glow_out = 0.0

        self.motion.tween(MOTION.frame_switch_in, slide_in,
                          easing=ease.STANDARD, tag='frame_glow')

    # ------------------------------------------------------------ score entry
    def score_entry(self, index, total_from=None, total_to=None):
        """A roll landed in ``index``: pop the number, flash amber, count up."""
        if index is None or not (0 <= index < self.CELLS):
            return
        state = self.cells[index]
        self.motion.cancel(tag=f'score_pop_{index}')
        self.motion.cancel(tag=f'score_flash_{index}')

        def pop(progress):
            if MOTION.reduce_motion:
                # No overshoot: pop straight from small to full.
                state.pop = ease.ramp(progress, (0.0, 1.0), (1.0, 1.0))
                return
            state.pop = ease.ramp(progress,
                                  (0.0, MOTION.score_pop_small),
                                  (0.55, MOTION.score_pop_big),
                                  (1.0, 1.0))

        self.motion.tween(MOTION.score_pop_time, pop, easing=ease.STANDARD,
                          tag=f'score_pop_{index}', celebrate=True)

        def flash(progress):
            state.flash = (1.0 - progress) * MOTION.score_flash_gain

        self.motion.tween(MOTION.score_flash_time, flash,
                          easing=ease.STANDARD, tag=f'score_flash_{index}')
        if total_from is not None and total_to is not None:
            self.count_total(index, total_from, total_to)

    def count_total(self, index, start, end):
        """Count the cell's cumulative total from ``start`` to ``end``."""
        state = self.cells[index]
        state.total_shown = start
        self.total_counting = True
        self.total_display = start
        self.motion.cancel(tag='total_count')

        def step(progress):
            value = start + (end - start) * progress
            state.total_shown = int(round(value))
            self.total_display = state.total_shown

        self.motion.tween(MOTION.total_count_time, step, easing=ease.STANDARD,
                          tag='total_count', celebrate=True,
                          on_complete=self._count_done)

    def _count_done(self):
        self.total_counting = False
        for state in self.cells:
            state.total_shown = None

    def displayed_total(self, index):
        """The number the cell should draw right now (count-up aware).

        While a count-up is running the intermediate value wins; afterwards
        ``None`` means "use the real total from the scorer", so the scorer
        stays the single source of truth.
        """
        if index is None or not (0 <= index < self.CELLS):
            return None
        return self.cells[index].total_shown

    # ------------------------------------------------------------------ stamps
    def mark_stamp(self, index):
        """Stamp the ``X`` / ``/`` mark: scale 2.0 -> 1.0 and a -8 deg settle."""
        if index is None or not (0 <= index < self.CELLS):
            return
        state = self.cells[index]
        self.motion.cancel(tag=f'mark_{index}')
        self.motion.cancel(tag=f'mark_glow_{index}')
        from_scale = 1.0 if MOTION.reduce_motion else MOTION.mark_stamp_scale
        from_rotate = 0.0 if MOTION.reduce_motion else -MOTION.mark_stamp_rotate

        def stamp(progress):
            state.pop = ease.lerp(from_scale, 1.0, progress)
            state.rotation = ease.lerp(from_rotate, 0.0, progress)

        def burst(progress):
            state.burst = 1.0 - progress

        self.motion.tween(MOTION.mark_stamp_time, stamp, easing=ease.STANDARD,
                          tag=f'mark_{index}')
        self.motion.tween(MOTION.mark_glow_time, burst, easing=ease.STANDARD,
                          tag=f'mark_glow_{index}')

    # ------------------------------------------------------------- final frame
    def final_frame(self, index=None):
        """The tenth frame: a larger celebratory pulse of its glow."""
        if index is None:
            index = self.CELLS - 1
        self.final_index = index
        state = self.cells[index]
        amplitude = (0.0 if MOTION.reduce_motion
                     else MOTION.final_pulse_scale - MOTION.frame_scale)
        self.motion.cancel(tag='final_pulse')

        def pulse(progress):
            env = ease.ramp(progress, (0.0, 0.0), (0.45, 1.0), (1.0, 0.0))
            state.scale = MOTION.frame_scale + amplitude * env
            state.glow = max(state.glow, 0.80 + 0.20 * env)

        self.motion.tween(MOTION.final_pulse_time, pulse,
                          easing=ease.STANDARD, tag='final_pulse',
                          celebrate=True)

    def final_total(self, value):
        """Remember the final score (the HUD's big count-up reads it)."""
        self.final_total = value

    def reset(self):
        self.motion.cancel(owner=self)
        for state in self.cells:
            state.reset()
        self.active_index = None
        self.final_index = None
        self.revealed = False
        self.total_display = None
        self.total_counting = False

    # ------------------------------------------------------------------ update
    def update(self, dt):
        """Advance the board clock (the tweens are stepped by the director)."""
        self.clock += dt

    def cell_transform(self, index):
        """The values the scorecard applies to one cell this frame."""
        if 0 <= index < self.CELLS:
            state = self.cells[index]
        else:
            state = CellMotion()
        active = index == self.active_index
        glow = state.glow
        if active:
            # The active frame always carries a visible highlight: it breathes
            # when pulses are allowed, and holds steady when they are not.
            if MOTION.allow_pulse() and self.final_index is None:
                glow = max(glow, ease.breathe(self.clock,
                                              MOTION.frame_pulse_period,
                                              MOTION.frame_pulse_min,
                                              MOTION.frame_pulse_max))
            else:
                glow = max(glow, MOTION.frame_pulse_max)
            state.scale = max(state.scale, MOTION.frame_scale)
        return {
            'dy': state.enter_from,
            'alpha': state.enter,
            'scale': state.scale,
            'glow': min(1.0, glow + state.glow_out * 0.5),
            'glow_slide': state.slide,
            'flash': state.flash,
            'burst': state.burst,
            'mark_scale': state.pop,
            'rotation': state.rotation,
            'active': active,
        }
