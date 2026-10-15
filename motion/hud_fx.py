"""HUD animation widgets: prompt text, power meter, pin icons, scoreboard.

The HUD (:mod:`ui.hud`) owns *layout*: it writes a position, a scale and a
colour onto every entity each frame. This module owns the *motion* of those
same entities. The split is deliberate: the HUD keeps laying itself out from
``window.aspect_ratio`` exactly as before, and the animation is applied as a
small offset / multiplier / alpha on top, after the layout has run. A resize
mid-animation can therefore never desync the two.

Every widget follows the same rules:

* the base values come from the HUD; the animation only perturbs them;
* all clocks are tweens on the shared :class:`motion.tween.Motion`, so a
  re-trigger replaces the old animation cleanly;
* reduce motion is honoured where it matters (pulses hold constant, flashes
  and shakes never start).
"""
import math

from ursina import Entity, Text, color

from motion import ease
from motion.config import MOTION
from motion.effects import ParticlesFX, rgba
from motion.score_fx import ScorecardMotion

# ---------------------------------------------------------------------------
# Pin icon geometry: the classic 10-pin triangle, read from the top
# ---------------------------------------------------------------------------
# Row 0 is the back row (four pins, drawn at the top of the icon block) and
# row 3 the head pin, so the rack is 4 + 3 + 2 + 1 = 10 icons. The columns are
# offsets in pin-spacing units, which is what makes the triangle line up. The
# reset wave pops the back row first, the order a real rack is set.
PIN_ROW_X = {
    0: (-1.5, -0.5, 0.5, 1.5),
    1: (-1.0, 0.0, 1.0),
    2: (-0.5, 0.5),
    3: (0.0,),
}
PIN_ROW_Y = {0: 0.0, 1: -1.0, 2: -2.0, 3: -3.0}


def pin_icon_slots():
    """``(index, row, column)`` for the ten icons, back row first."""
    slots = []
    index = 0
    for row in range(4):
        for column in PIN_ROW_X[row]:
            slots.append((index, row, column))
            index += 1
    return slots


PIN_SLOTS = pin_icon_slots()


def _with_alpha(colour, alpha):
    """A copy of ``colour`` with a new alpha (ursina colours are 0-1 floats)."""
    try:
        r, g, b = colour[0], colour[1], colour[2]
    except (TypeError, IndexError):
        return colour
    return color.rgba32(r * 255.0, g * 255.0, b * 255.0,
                        max(0.0, min(1.0, alpha)) * 255.0)


# ---------------------------------------------------------------------------
# Reusable text crossfade
# ---------------------------------------------------------------------------
class CrossfadeText:
    """A line of text that crossfades with a small vertical drift on change.

    ``current`` is the entity the HUD lays out; ``outgoing`` is a spare clone
    that only exists while the old string fades away. The owner calls
    :meth:`set_text` with the string it *would* have written, then applies
    :meth:`alpha` / :meth:`dy` after its own layout.
    """

    def __init__(self, motion, current, outgoing=None, drift=None,
                 duration=None, pulse=False):
        self.motion = motion
        self.current = current
        self.outgoing = outgoing
        self.drift = MOTION.prompt_rise if drift is None else drift
        self.duration = (MOTION.prompt_crossfade if duration is None
                         else duration)
        self.pulse = bool(pulse)
        self.alpha = 1.0
        self.visible_alpha = 1.0
        self.dy = 0.0
        self.hidden = False
        self.enabled_flag = True
        self.base_rgb = None
        self._text = ''
        self._outgoing_alpha = 0.0
        self._outgoing_y = 0.0
        self._outgoing_dy = 0.0
        if self.outgoing is not None:
            self.outgoing.enabled = False

    # ------------------------------------------------------------------ state
    def set_text(self, text, rgb=None):
        """Set the string; a change starts the crossfade."""
        if rgb is not None:
            self.base_rgb = tuple(rgb)
        elif self.base_rgb is None and self.current is not None:
            self.base_rgb = _rgb_of(self.current)
        text = '' if text is None else str(text)
        if text == self._text:
            return
        previous = self._text
        self._text = text
        if self.current is not None:
            # The motion layer owns the string now: the HUD delegates it here.
            self.current.text = text
        if self.outgoing is None or not previous:
            self.alpha = 1.0
            self.dy = 0.0
            return
        target = self.current
        self.outgoing.text = previous
        self.outgoing.enabled = True
        try:
            self.outgoing.scale = target.scale
            self.outgoing.origin = target.origin
            self.outgoing.position = target.position
            self.outgoing.color = rgb and rgba(rgb, 1.0) or target.color
        except Exception:                    # pragma: no cover - engine quirk
            self.outgoing.enabled = False
            return
        self._outgoing_alpha = 1.0
        self._outgoing_y = target.position[1] if target is not None \
            else self.outgoing.position[1]
        self.alpha = 0.0
        self.dy = -self.drift

        def fade_in(progress):
            self.alpha = progress
            self.dy = ease.lerp(-self.drift, 0.0, progress)

        def fade_out(progress):
            # The old line drifts *up* and out while the new one rises into
            # place: one 8 px movement, read twice (section 3).
            self._outgoing_alpha = 1.0 - progress
            self._outgoing_dy = self.drift * progress

        self.motion.cancel(tag=self)
        self.motion.tween(self.duration, fade_in, easing=ease.STANDARD,
                          tag=self)
        self.motion.tween(self.duration, fade_out, easing=ease.STANDARD,
                          tag=self, on_complete=self._hide_outgoing)

    def _hide_outgoing(self):
        self._outgoing_alpha = 0.0
        if self.outgoing is not None:
            self.outgoing.enabled = False

    def set_hidden(self, hidden, duration=None):
        """Fade the line out entirely (the rolling prompt does this).

        Kept on its own channel (``visible_alpha``) so it cannot fight the
        crossfade, which owns ``alpha``: both are multiplied in :meth:`apply`.
        """
        hidden = bool(hidden)
        if hidden == self.hidden:
            return
        self.hidden = hidden
        duration = MOTION.prompt_roll_fade if duration is None else duration
        start = self.visible_alpha
        target = 0.0 if hidden else 1.0

        def fade(progress):
            self.visible_alpha = ease.lerp(start, target, progress)

        self.motion.cancel(tag=('fade', self))
        self.motion.tween(duration, fade, easing=ease.STANDARD,
                          tag=('fade', self))

    # ------------------------------------------------------------------ apply
    def apply(self, clock=0.0):
        """Write the animated alpha and drift onto the two entities."""
        alpha = self.opacity
        if self.pulse and MOTION.allow_pulse() and alpha > 0.5:
            alpha *= ease.breathe(clock, MOTION.prompt_pulse_period,
                                  MOTION.prompt_pulse_min,
                                  MOTION.prompt_pulse_max)
        alpha = max(0.0, min(1.0, alpha))
        if self.current is not None:
            self.current.enabled = self.enabled_flag and alpha > 0.01
            base = self.base_rgb
            if base is None:
                base = _rgb_of(self.current)
                self.base_rgb = base
            if base is not None:
                self.current.color = rgba(base, alpha)
        if self.outgoing is not None and self.outgoing.enabled:
            base = self.base_rgb or (245, 245, 252)
            self.outgoing.color = rgba(base, self._outgoing_alpha)
            self.outgoing.y = self._outgoing_y + self._outgoing_dy

    def offset(self, base_y):
        """Where the line should sit this frame."""
        return base_y + self.dy

    @property
    def opacity(self):
        """The alpha the line is actually drawn with."""
        return max(0.0, min(1.0, self.alpha * self.visible_alpha))

    def reset(self):
        self.motion.cancel(tag=self)
        self.motion.cancel(tag=('fade', self))
        self._text = ''
        self.alpha = 1.0
        self.visible_alpha = 1.0
        self.dy = 0.0
        self.hidden = False
        self.enabled_flag = True
        self._outgoing_alpha = 0.0
        if self.outgoing is not None:
            self.outgoing.enabled = False


def _rgb_of(entity):
    """Read an entity's colour back as a 0-255 RGB triple (None if unknown)."""
    colour = getattr(entity, 'color', None)
    if colour is None:
        return None
    try:
        return (int(round(colour[0] * 255)), int(round(colour[1] * 255)),
                int(round(colour[2] * 255)))
    except (TypeError, IndexError):
        return None


def _alpha_of_colour(colour):
    """Read a colour's alpha (0-1), defaulting to opaque."""
    try:
        return float(colour[3])
    except (TypeError, IndexError):
        return 1.0


# ---------------------------------------------------------------------------
# Power meter
# ---------------------------------------------------------------------------
class PowerMeter:
    """The drag power bar: fills, shifts hue, pulses at the top, flashes out."""

    WIDTH = 0.34
    HEIGHT = 0.030

    def __init__(self, parent, motion):
        self.motion = motion
        self.root = Entity(parent=parent, enabled=False, z=0.0)
        self.track = Entity(parent=self.root, model='quad', z=0.016,
                            color=rgba((14, 11, 30), 0.85))
        self.fill = Entity(parent=self.track, model='quad', origin=(-0.5, 0),
                           position=(-0.5, 0, -0.01),
                           color=rgba((96, 226, 255), 0.9))
        self.glow = Entity(parent=self.root, model='quad', z=0.014,
                           color=rgba((96, 226, 255), 0.0))
        self.value_text = Text(parent=self.root, text='0%', origin=(1, 0.5),
                               scale=0.45, color=rgba((245, 245, 252), 0.95),
                               z=-0.01)
        self.visible = False
        self.shown = 0.0
        self.target_power = 0.0
        self.power = 0.0
        self.flash = 0.0
        self.release_fade = 1.0

    def turn_on(self):
        if self.visible:
            return
        self.visible = True
        self.power = 0.0
        self.flash = 0.0
        self.release_fade = 1.0
        self.root.enabled = True

        def fade(progress):
            self.shown = progress

        self.motion.cancel(tag='meter_fade')
        self.motion.tween(MOTION.meter_fade_in, fade, easing=ease.STANDARD,
                          tag='meter_fade')

    def turn_off(self):
        if not self.visible:
            return
        start = self.shown

        def fade(progress):
            self.shown = ease.lerp(start, 0.0, progress)

        self.motion.cancel(tag='meter_fade')
        self.motion.tween(MOTION.meter_fade_out, fade, easing=ease.STANDARD,
                          tag='meter_fade', on_complete=self._hide)

    def _hide(self):
        self.visible = False
        self.root.enabled = False
        self.target_power = 0.0

    def set_power(self, value):
        self.target_power = max(0.0, min(1.0, float(value)))

    def release(self):
        """The throw left: flash white once, then fade out over 200 ms."""
        if not self.visible:
            return

        def flash(progress):
            self.flash = 1.0 - progress
            self.release_fade = 1.0 - progress * 0.5

        self.motion.cancel(tag='meter_release')
        self.motion.tween(MOTION.meter_flash_time, flash,
                          easing=ease.STANDARD, tag='meter_release')
        self.turn_off()

    # ------------------------------------------------------------------ update
    def update(self, dt, clock=0.0):
        if not self.visible:
            return
        smoothing = min(1.0, max(0.05, MOTION.meter_fill_smoothing))
        self.power += (self.target_power - self.power) * smoothing
        if abs(self.target_power - self.power) < 0.002:
            self.power = self.target_power
        index = self.power * (len(MOTION.meter_colors) - 1)
        low = MOTION.meter_colors[int(math.floor(index))]
        high = MOTION.meter_colors[min(len(MOTION.meter_colors) - 1,
                                       int(math.floor(index)) + 1)]
        rgb = ease.mix_rgb(low, high, index - math.floor(index))
        pulse = 1.0
        if self.power >= MOTION.meter_pulse_from and MOTION.allow_pulse():
            pulse = 1.0 + 0.35 * ease.breathe(clock, MOTION.meter_pulse_period,
                                              0.0, 1.0)
        alpha = self.shown * self.release_fade
        self.root.enabled = alpha > 0.02
        self.fill.scale = (max(0.001, self.power), 1.0)
        self.fill.color = rgba(
            ease.mix_rgb(rgb, (255, 255, 255), min(0.8, self.flash)),
            min(1.0, (0.55 + 0.45 * self.power) * alpha))
        self.glow.color = rgba(rgb, 0.22 * alpha * (0.5 + 0.5 * self.power))
        self.value_text.text = f'{int(round(self.power * 100))}%'
        self.value_text.color = rgba((245, 245, 252), alpha)
        self.track.color = rgba((14, 11, 30), 0.85 * alpha)

    def layout(self, x, y):
        self.root.position = (x, y, 0.0)
        self.track.scale = (self.WIDTH, self.HEIGHT)
        self.glow.scale = (self.WIDTH * 1.05, self.HEIGHT * 1.7)
        self.value_text.position = (self.WIDTH / 2.0, self.HEIGHT * 0.9, -0.01)


# ---------------------------------------------------------------------------
# Pin icons
# ---------------------------------------------------------------------------
class PinIcons:
    """The ten-pin triangle of icons in the top bar.

    Knocked pins dim and shrink over 200 ms; a reset is a staggered wave that
    pops the back row first, 30 ms apart. A strike or a spare sets the whole
    triangle alight for a moment (a wave of accent light, back row first),
    which is the HUD's own answer to the pins falling.
    """

    def __init__(self, parent, motion):
        self.motion = motion
        self.icons = [Entity(parent=parent, model='quad',
                             color=rgba((250, 250, 255), 0.92))
                      for _slot in PIN_SLOTS]
        self.standing = 10
        self.visible = True
        self.values = [1.0] * 10
        self.pops = [1.0] * 10
        self.flashes = [0.0] * 10
        self.flash_rgb = [(250, 250, 255)] * 10

    def set_visible(self, visible):
        self.visible = bool(visible)
        if not self.visible:
            for icon in self.icons:
                icon.enabled = False

    def celebrate(self, kind='strike'):
        """A wave of accent light across the triangle (strike / spare).

        Under reduce motion the wave is skipped: it is a flash-like strobe.
        """
        if not MOTION.allow_flash():
            return
        rgb = {'strike': (255, 214, 130), 'turkey': (255, 164, 96),
               'spare': (96, 226, 255)}.get(kind, (245, 245, 252))
        for index in range(10):
            # Back row first (slot 0 is the back row's left pin), 20 ms apart.
            delay = MOTION.pin_wave_stagger * 0.65 * index
            self._flash(index, rgb, delay)

    def _flash(self, index, rgb, delay=0.0):
        tag = ('pin_flash', index)
        self.flash_rgb[index] = tuple(rgb)

        def flash(progress):
            env = ease.ramp(progress, (0.0, 0.0), (0.25, 1.0), (1.0, 0.0))
            self.flashes[index] = env

        self.motion.cancel(tag=tag)
        self.motion.tween(MOTION.pin_pop_time * 1.6, flash,
                          easing=ease.STANDARD, delay=delay, tag=tag)

    def set_standing(self, count):
        """Knocked pins dim and shrink; standing pins stay bright."""
        count = max(0, min(10, int(count)))
        if count == self.standing:
            return
        previous = self.standing
        self.standing = count
        for index in range(10):
            standing = index >= (10 - count)
            target = 1.0 if standing else 0.0
            if abs(self.values[index] - target) < 1e-3:
                continue
            start = self.values[index]
            if target > start and count > previous:
                # A reset(ish) change: pop in, staggered back row first.
                self._pop(index, delay=MOTION.pin_wave_stagger * index)
            tag = ('pin', index)

            def fade(progress, index=index, start=start, target=target):
                self.values[index] = ease.lerp(start, target, progress)

            self.motion.cancel(tag=tag)
            self.motion.tween(MOTION.pin_dim_time, fade,
                              easing=ease.STANDARD, tag=tag)

    def _pop(self, index, delay=0.0):
        tag = ('pin_pop', index)

        def pop(progress):
            env = ease.ramp(progress, (0.0, 0.0), (0.5, 1.0), (1.0, 0.0))
            self.pops[index] = 1.0 + (MOTION.pin_pop_scale - 1.0) * env

        self.motion.cancel(tag=tag)
        self.motion.tween(MOTION.pin_pop_time, pop, easing=ease.STANDARD,
                          delay=delay, tag=tag)

    def apply(self, base_x, base_y, size, spacing):
        """Lay the triangle out and apply the animation values."""
        if not self.visible:
            return
        icon_w = size * 0.58
        for index, icon in enumerate(self.icons):
            _i, row, column = PIN_SLOTS[index]
            value = self.values[index]
            pop = self.pops[index] if MOTION.allow_pulse() else 1.0
            flash = self.flashes[index]
            dim = ease.lerp(MOTION.pin_dim_scale, 1.0, value)
            alpha = ease.lerp(MOTION.pin_dim_alpha, 0.92, value)
            rgb = (ease.mix_rgb((250, 250, 255), self.flash_rgb[index], flash)
                   if flash > 0.01 else (250, 250, 255))
            x = base_x + column * spacing
            y = base_y + PIN_ROW_Y[row] * spacing * 0.82
            icon.enabled = True
            icon.position = (x, y, 0.01)
            icon.scale = (icon_w * dim * pop, icon_w * dim * pop)
            icon.color = rgba(rgb, min(1.0, alpha + 0.08 * flash))


# ---------------------------------------------------------------------------
# The HUD's animation container
# ---------------------------------------------------------------------------
class HudMotion:
    """Every animated HUD element, wired to an existing :class:`ui.hud.Hud`.

    The play screen creates one through :class:`motion.director.MotionDirector`
    and hands it to the HUD (``hud.motion = ...``). The HUD keeps its own
    layout; this object only needs to know which entity is which.
    """

    def __init__(self, hud, motion):
        self.hud = hud
        self.motion = motion
        self.clock = 0.0
        self.root = getattr(hud, 'root', None)
        self.scoreboard = ScorecardMotion(motion)
        self.particles = ParticlesFX(self.root, motion, capacity=320)
        self.pins = PinIcons(self.root, motion)
        self.meter = PowerMeter(self.root, motion)
        # The one text line that crossfades: the centre status prompt.
        self.prompt = CrossfadeText(
            motion, getattr(hud, 'status', None),
            _clone_text(hud, getattr(hud, 'status', None)), pulse=True)
        # Panels / strips.
        self.card_slide = 0.0
        self.physics_offset = 0.0
        self.physics_alpha = 1.0
        self._physics_target = 1.0
        self._fade_base = {}
        self._total_display = None
        self._total_counting = False
        self._official = 0

    # ------------------------------------------------------------------ setup
    def on_show(self):
        """A match is starting: reveal the board, the rack and the prompt."""
        self.scoreboard.reset()
        self.scoreboard.start_reveal()
        self.particles.clear()
        self.prompt.reset()
        self.set_panel_slide(from_side=True)
        self.meter.turn_off()
        self._official = 0
        self._total_display = None
        # No celebration light may survive into the next match (a strike wave
        # or a held pop would otherwise still be on screen at the first ball).
        for index in range(10):
            self.pins.flashes[index] = 0.0
            self.pins.pops[index] = 1.0
            self.motion.cancel(tag=('pin_flash', index))

    def _fade_entity(self, entity, alpha):
        """Multiply an entity's colour alpha, remembering its base colour.

        The base is cached the first time (per entity), so fading the same
        entity every frame cannot compound.
        """
        base = self._fade_base.get(id(entity))
        if base is None:
            base = _rgb_of(entity), _alpha_of_colour(entity)
            self._fade_base[id(entity)] = base
        rgb, base_alpha = base
        entity.color = rgba(rgb, base_alpha * max(0.0, min(1.0, alpha)))

    def set_panel_slide(self, from_side=False):
        """The player strip slides in from the side with a fade."""
        if not from_side or MOTION.reduce_motion:
            self.card_slide = 0.0
            return

        def slide(progress):
            self.card_slide = MOTION.card_slide_distance * (1.0 - progress)

        self.motion.cancel(tag='card_slide')
        self.motion.tween(MOTION.card_slide_time, slide,
                          easing=ease.STANDARD, tag='card_slide')

    # --------------------------------------------------------------- scoreboard
    def frame_changed(self, index):
        self.scoreboard.set_active(index)

    def roll_recorded(self, frame_index, cell_from=None, cell_to=None,
                      official_from=None, official_to=None, mark=None):
        """A roll landed: pop the mark, flash the cell, count both totals."""
        if mark:
            self.scoreboard.mark_stamp(frame_index)
        self.scoreboard.score_entry(frame_index, cell_from, cell_to)
        if official_from is not None and official_to is not None:
            self.count_official(official_from, official_to)

    def count_official(self, start, end):
        """The top-right total counts up from old to new (500 ms)."""
        self._total_counting = True
        self._total_display = start
        self.motion.cancel(tag='official_count')

        def set_value(value):
            self._total_display = value

        self.motion.count_up(start, end, MOTION.total_count_time, set_value,
                             easing=ease.STANDARD, tag='official_count',
                             on_complete=self._official_done)

    def _official_done(self):
        self._total_counting = False
        self._total_display = None

    def display_score(self, official):
        """What the top-right score should read this frame."""
        self._official = official
        if self._total_counting and self._total_display is not None:
            return self._total_display
        return official

    def official_changed(self, start, end):
        """The displayed total changed: count it up (500 ms)."""
        if start == end:
            return
        self.count_official(start, end)

    # ------------------------------------------------------- text crossfades
    def set_prompt(self, text, rgb, pulsing=False, hidden=False):
        """The centre status line: crossfade, drift, pulse, fade while rolling."""
        self.prompt.pulse = bool(pulsing)
        self.prompt.set_text(text, rgb)
        self.prompt.set_hidden(hidden)

    def final_frame(self, index=None):
        self.scoreboard.final_frame(index)

    def final_total(self, total):
        self.scoreboard.final_total(total)

    # -------------------------------------------------------------- result card
    def confetti(self, count=None):
        """Neon confetti over the whole screen (the game-end celebration)."""
        self.particles.confetti(count=count)

    # ------------------------------------------------------------------ physics
    def set_physics_visible(self, visible):
        self._physics_target = 1.0 if visible else 0.0

    def update_physics_panel(self, dt):
        """Slide the physics readout in from the right edge (toggling).

        Toggling is smooth both ways: the panel slides a fraction of the
        screen and fades, so ``H`` reads as one continuous movement rather
        than a pop.
        """
        target = self._physics_target
        offset = MOTION.panel_slide_distance * (1.0 - target)
        rate = min(1.0, dt / max(1e-3, MOTION.panel_slide_time / 3.0))
        self.physics_offset += (offset - self.physics_offset) * rate
        self.physics_alpha = 1.0 - 0.9 * (1.0 - target)
        if abs(self.physics_offset - offset) < 0.002:
            self.physics_offset = offset

    # --------------------------------------------------------------------- inputs
    def meter_update(self, dragging, power, dt):
        if dragging:
            self.meter.turn_on()
            self.meter.set_power(power)
        elif self.meter.visible and self.meter.release_fade >= 1.0:
            self.meter.turn_off()
        self.meter.update(dt, self.clock)

    def meter_released(self):
        self.meter.release()

    # ------------------------------------------------------------------ layout
    def layout(self, hud, aspect, input_mode, state):
        """Lay out the animated widgets inside the HUD's own geometry.

        Called by :meth:`ui.hud.Hud.update` at the end of its layout pass; the
        animated offsets are applied afterwards by :meth:`update`, which the
        director runs once per frame *after* the HUD has been laid out.
        """
        # The power meter sits just above the lane's lower edge, centred.
        self.meter.layout(0.0, -0.408)

    def layout_pins(self, right_x, top_bar_bottom):
        """Place the ten-pin triangle down the right edge of the top bar."""
        self.pins.apply(right_x - 0.045, top_bar_bottom + 0.030, 0.009,
                        0.0095)

    def apply_layout(self):
        """Apply the animated offsets on top of the HUD's fresh layout."""
        hud = self.hud
        if hud is None:
            return
        # The prompt drifts up as it crossfades.
        status = getattr(hud, 'status', None)
        if status is not None and self.prompt is not None:
            status.y = self.prompt.offset(status.y)
        # The player strip slides in from the side.
        if self.card_slide:
            for chip in getattr(hud, '_player_chips', ()):
                for part in (chip.body, chip.name, chip.score, chip.detail):
                    if getattr(part, 'enabled', True):
                        part.x -= self.card_slide
        # The physics panel slides in from the right edge and fades with it.
        if self.physics_offset or self.physics_alpha < 1.0:
            for name in ('readout', '_readout_panel'):
                entity = getattr(hud, name, None)
                if entity is not None:
                    entity.x += self.physics_offset
                    self._fade_entity(entity, self.physics_alpha)

    # ------------------------------------------------------------------ update
    def update(self, dt, aspect=0.0):
        self.clock += dt
        self.scoreboard.update(dt)
        self.apply_layout()
        self.prompt.apply(self.clock)
        self.particles.update(dt)
        self.update_physics_panel(dt)


def _clone_text(hud, source):
    """A hidden copy of a HUD text entity, parented beside it."""
    if source is None:
        return None
    parent = getattr(source, 'parent', None)
    clone = Text(parent=parent, text='', origin=source.origin,
                 scale=source.scale, color=source.color, z=0.0)
    clone.enabled = False
    return clone
