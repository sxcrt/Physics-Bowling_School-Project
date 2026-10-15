"""Pooled, reusable effects: flashes, particles, pop-ups, sweeps and shake.

Every effect here is:

* **pooled** - the entity is created once and re-used, so a match that sees
  thirty strikes never allocates thirty sets of nodes;
* **driven by** :class:`motion.tween.Motion` - no effect owns a clock, so all
  of them are stepped by the one call the director makes per frame;
* **reduce-motion aware** - shake and flashes refuse to start, pulses hold a
  constant value, and particle counts drop (see :mod:`motion.config`).

Layer order (Ursina's UI camera draws *smaller* z in front):

====================================  =======  ==========================
element                               z        notes
====================================  =======  ==========================
screen flash / vignette               0.50     behind the whole HUD
HUD panels and text                   0.01-0.03 as laid out by the screens
UI particles / pin pops                -0.02    in front of the HUD
result pop-up text                    -0.03    behind the pause/results deck
overlays (pause, results)             -0.10    in front of the play screen
game-end confetti                     -0.14    the shower over the results
====================================  =======  ==========================
"""
import math
import random

from ursina import Entity, Text, color, window
from ursina.shaders import unlit_shader

from motion import ease
from motion.config import MOTION
from motion.gfx import band, edge_glow, ring, soft_dot

FLASH_Z = 0.50
PARTICLE_Z = -0.02
POPUP_Z = -0.03
SWEEP_Z = 0.48
# The game-end shower falls *in front of* the results panel (smaller z draws in
# front in Ursina's UI camera; the overlays sit at ui.theme.OVERLAY_Z = -0.10),
# so the victory confetti is a shower over the celebration, not behind it.
CONFETTI_Z = -0.14

# Distinct, stable hues for the particle bursts (RGB 0-255).
NEON_COLORS = (
    (96, 226, 255),      # cyan
    (232, 72, 168),      # magenta
    (255, 214, 130),     # amber
    (245, 245, 252),     # white
)

# The result card's dark outline: a near-black copy behind the text keeps the
# big type readable over the bright lane (the "layered text" of the brief).
OUTLINE_RGB = (8, 6, 20)


def _rgba(rgb, alpha=1.0):
    alpha = 0.0 if alpha < 0.0 else (1.0 if alpha > 1.0 else alpha)
    return color.rgba32(*(tuple(rgb) + (alpha * 255.0,)))


def _tint(rgb, alpha):
    return _rgba(rgb, alpha)


# Public alias: HUD widgets in :mod:`motion.hud_fx` build colours with it.
rgba = _rgba


class Pool:
    """A fixed-size pool: acquire a sleeping effect, release it when done."""

    def __init__(self, factory, capacity, name='effect'):
        self._factory = factory
        self.capacity = max(0, int(capacity))
        self.name = name
        self._free = []
        self._active = []

    def acquire(self):
        if self._free:
            item = self._free.pop()
        elif len(self._active) < self.capacity:
            item = self._factory()
        else:
            return None
        self._active.append(item)
        return item

    def release(self, item):
        try:
            self._active.remove(item)
        except ValueError:
            return
        item.enabled = False
        self._free.append(item)

    def release_all(self):
        for item in list(self._active):
            self.release(item)

    def active(self):
        return list(self._active)

    @property
    def free_count(self):
        return len(self._free)


# ---------------------------------------------------------------------------
# Screen flash and vignette
# ---------------------------------------------------------------------------
class FlashFX:
    """A full-screen edge flash, strobed through a list of colours.

    The texture is transparent in the middle, so a strike reads as the *edges*
    of the screen flashing cyan/magenta rather than a wash over the lane,
    which keeps the pins and the result text readable. Reduce motion turns the
    whole effect into a no-op.
    """

    def __init__(self, parent, motion):
        self.motion = motion
        self.entity = Entity(parent=parent, model='quad',
                             position=(0, 0, FLASH_Z),
                             scale=(window.aspect_ratio, 1.0),
                             texture=edge_glow(size=96, power=3.2, inner=0.42),
                             color=_rgba((255, 255, 255), 0.0),
                             shader=unlit_shader, enabled=False)
        self._timeline = None

    def trigger(self, colors=((96, 226, 255), (232, 72, 168)), count=3,
                each=None, alpha=None):
        """Flash ``count`` times, cycling through ``colors``."""
        if not MOTION.allow_flash():
            return
        each = MOTION.result_flash_time if each is None else each
        alpha = MOTION.result_flash_alpha if alpha is None else alpha
        alpha *= MOTION.master_intensity
        colors = list(colors) or [(255, 255, 255)]
        if self._timeline is not None:
            self._timeline.cancel()
        # A cancelled strobe leaves the entity enabled: always reset it before
        # the new sequence starts, so a re-trigger cannot leave a flash stuck
        # on screen (and reduce motion can never show one).
        self._hide()
        self.entity.enabled = True
        self.entity.scale = (window.aspect_ratio, 1.0)
        steps = []
        for index in range(max(1, count)):
            rgb = colors[index % len(colors)]

            def rise(progress, rgb=rgb):
                self.entity.color = _tint(rgb, alpha * progress)

            def fall(progress, rgb=rgb):
                self.entity.color = _tint(rgb, alpha * (1.0 - progress))

            steps.append(('tween', rise, each * 0.35))
            steps.append(('tween', fall, each * 0.65))
        steps.append(('call', self._hide))
        self._timeline = self.motion.timeline(_script(steps), tag='flash')

    def _hide(self):
        self.entity.enabled = False
        self.entity.color = _rgba((255, 255, 255), 0.0)

    def reset(self):
        """Hide immediately, whatever state a cancelled strobe left behind."""
        if self._timeline is not None:
            self._timeline.cancel()
            self._timeline = None
        self._hide()

    def update(self, dt):
        pass


class VignetteFX:
    """A soft dark rim: the "thud" of a gutter ball and the pause dimming."""

    def __init__(self, parent, motion, rgb=(4, 3, 10)):
        self.motion = motion
        self.rgb = tuple(rgb)
        self.entity = Entity(parent=parent, model='quad',
                             position=(0, 0, FLASH_Z),
                             scale=(window.aspect_ratio, 1.0),
                             texture=edge_glow(size=96, power=1.5, inner=0.10),
                             color=_rgba(self.rgb, 0.0),
                             shader=unlit_shader, enabled=False)
        self._timeline = None

    def trigger(self, alpha=None, duration=None, rise=0.35):
        alpha = MOTION.gutter_vignette if alpha is None else alpha
        duration = MOTION.gutter_vignette_time if duration is None else duration
        alpha *= MOTION.master_intensity
        if self._timeline is not None:
            self._timeline.cancel()
        self.entity.enabled = True
        self.entity.scale = (window.aspect_ratio, 1.0)

        def rise_step(progress):
            self.entity.color = _rgba(self.rgb, alpha * progress)

        def fall_step(progress):
            self.entity.color = _rgba(self.rgb, alpha * (1.0 - progress))

        self._timeline = self.motion.timeline([
            _tween_step(duration * rise, rise_step),
            _tween_step(duration * (1.0 - rise), fall_step),
            lambda: setattr(self.entity, 'enabled', False),
        ], tag='vignette')

    def hold(self, alpha):
        """Leave a steady vignette up (used for the pause dim)."""
        self.entity.enabled = True
        self.entity.scale = (window.aspect_ratio, 1.0)
        self.entity.color = _rgba(self.rgb, alpha)

    def clear(self):
        self.entity.enabled = False
        self.entity.color = _rgba(self.rgb, 0.0)


# ---------------------------------------------------------------------------
# UI particles
# ---------------------------------------------------------------------------
class ParticlesFX:
    """A pool of neon sparks in UI space (confetti, bursts, dust)."""

    def __init__(self, parent, motion, capacity=160):
        self.motion = motion
        self.pool = Pool(lambda: self._make(parent), capacity,
                         name='ui_particles')
        self.particles = []          # [entity, vx, vy, life, max_life, ...]

    @staticmethod
    def _make(parent):
        return Entity(parent=parent, model='quad', texture=soft_dot(48),
                      color=_rgba((255, 255, 255), 0.0), shader=unlit_shader,
                      z=PARTICLE_Z, enabled=False)

    # ------------------------------------------------------------------ spawn
    def burst(self, x, y, count=None, colors=NEON_COLORS, speed=0.55,
              spread=math.pi, angle=math.pi / 2.0, gravity=-1.1, life=0.75,
              size=0.014, size_spread=0.6, wobble=0.0):
        """Throw ``count`` sparks from ``(x, y)``.

        ``angle`` is the centre direction in radians (default: straight up),
        ``spread`` the fan around it. Sizes and speeds are randomised inside
        the pool, so a burst never looks like a grid.
        """
        count = MOTION.scaled_count(42 if count is None else count)
        for _ in range(count):
            item = self.pool.acquire()
            if item is None:
                return
            rgb = colors[random.randrange(len(colors))]
            jitter = random.uniform(-spread / 2.0, spread / 2.0)
            direction = angle + jitter
            magnitude = speed * random.uniform(0.45, 1.25)
            item.enabled = True
            item.position = (x + random.uniform(-0.01, 0.01),
                             y + random.uniform(-0.01, 0.01), PARTICLE_Z)
            item.rotation_z = random.uniform(0, 360)
            scale = size * random.uniform(1.0 - size_spread * 0.5,
                                          1.0 + size_spread)
            item.scale = (scale, scale)
            item.color = _rgba(rgb, 0.95)
            self.particles.append([
                item, math.cos(direction) * magnitude,
                math.sin(direction) * magnitude,
                0.0, max(0.05, life * random.uniform(0.7, 1.3)),
                gravity, wobble, random.uniform(-220, 220), scale, rgb,
            ])

    def confetti(self, count=None, area=0.9, life=None):
        """A shower of sparks from the top of the screen (game end)."""
        count = MOTION.scaled_count(MOTION.end_confetti if count is None
                                    else count)
        aspect = window.aspect_ratio
        for _ in range(count):
            item = self.pool.acquire()
            if item is None:
                return
            rgb = NEON_COLORS[random.randrange(len(NEON_COLORS))]
            x = random.uniform(-aspect / 2.0 * area, aspect / 2.0 * area)
            y = random.uniform(0.42, 0.55)
            item.enabled = True
            item.position = (x, y, CONFETTI_Z)
            item.rotation_z = random.uniform(0, 360)
            scale = random.uniform(0.008, 0.017)
            item.scale = (scale, scale)
            item.color = _rgba(rgb, 0.95)
            self.particles.append([
                item, random.uniform(-0.12, 0.12),
                random.uniform(-0.06, 0.10), 0.0,
                (life or MOTION.end_confetti_life) * random.uniform(0.6, 1.1),
                random.uniform(-0.55, -0.30), 0.0,
                random.uniform(-160, 160), scale, rgb,
            ])

    # ----------------------------------------------------------------- update
    def update(self, dt):
        if not self.particles:
            return
        alive = []
        for particle in self.particles:
            (item, vx, vy, lifetime, max_life, gravity, wobble, spin,
             scale, rgb) = particle
            lifetime += dt
            if lifetime >= max_life:
                item.enabled = False
                self.pool.release(item)
                continue
            fraction = lifetime / max_life
            vy += gravity * dt
            dx = vx * dt
            if wobble:
                dx += math.sin(lifetime * 14.0) * wobble * dt
            item.x = item.x + dx
            item.y = item.y + vy * dt
            item.rotation_z = item.rotation_z + spin * dt
            alpha = 0.95 * (1.0 - fraction) ** 1.4
            item.color = _rgba(rgb, alpha)
            shrink = 1.0 - 0.45 * fraction
            item.scale = (scale * shrink, scale * shrink)
            particle[3] = lifetime
            alive.append(particle)
        self.particles = alive

    def clear(self):
        for particle in self.particles:
            particle[0].enabled = False
            self.pool.release(particle[0])
        self.particles = []


# ---------------------------------------------------------------------------
# Sweeps: the frame-change light sweep and the gold shimmer
# ---------------------------------------------------------------------------
class SweepFX:
    """A soft band of light crossing the screen (or a rectangle on it)."""

    def __init__(self, parent, motion):
        self.motion = motion
        self.entity = Entity(parent=parent, model='quad',
                             position=(0, 0, SWEEP_Z),
                             scale=(0.4, 1.0), texture=band(128, 32, 1.6),
                             color=_rgba((255, 255, 255), 0.0),
                             shader=unlit_shader, enabled=False)
        self._tag = 'sweep'

    def trigger(self, rgb=(190, 240, 255), y=0.0, height=1.0, time=None,
                width=None, alpha=None):
        time = MOTION.sweep_time if time is None else time
        width = MOTION.sweep_width if width is None else width
        alpha = MOTION.sweep_alpha if alpha is None else alpha
        aspect = window.aspect_ratio
        self.motion.cancel(tag=self._tag)
        self.entity.enabled = True
        self.entity.position = (-aspect / 2.0 - width, y, SWEEP_Z)
        self.entity.scale = (width, height)
        start_x = -aspect / 2.0 - width
        end_x = aspect / 2.0 + width

        def move(progress):
            self.entity.x = ease.lerp(start_x, end_x, progress)
            # Bright in the middle of the crossing, faded at both ends.
            fade = 1.0 - abs(progress * 2.0 - 1.0)
            self.entity.color = _rgba(rgb, alpha * fade)

        self.motion.tween(time, move, easing=ease.STANDARD, tag=self._tag,
                          on_complete=self._hide)

    def _hide(self):
        self.entity.enabled = False

    def reset(self):
        """Hide immediately (used when a new match resets the screen)."""
        if self._tag:
            self.motion.cancel(tag=self._tag)
        self._hide()


# ---------------------------------------------------------------------------
# Result pop-ups
# ---------------------------------------------------------------------------
def _text_copy(parent, z, position=(0.0, 0.0), origin=(0, 0)):
    return Text(parent=parent, text='', origin=origin, position=position,
                scale=1.0, color=_rgba((255, 255, 255), 0.0), z=z)


class ResultCard:
    """One reusable full-width result banner ("STRIKE!", "8 PINS DOWN!").

    The card is a stack of layers - a soft dark band behind the type, a halo,
    four offset glow copies in the accent colour, a near-black outline, the
    main line and an optional **sub-line** in the accent colour (the combo
    label, the spare's "CLEANED UP") - and every layer is driven from one
    :meth:`set_state` call. The card never plans its own choreography: the
    director slams it in, breathes it and floats it out, which keeps the four
    result styles (strike / spare / gutter / pins) readable as one place.
    """

    def __init__(self, parent, motion):
        self.motion = motion
        self.root = Entity(parent=parent, enabled=False)
        # Far layer: the soft dark band that keeps the type readable over the
        # lane, then the impact ring that expands behind it.
        self.plate = Entity(parent=self.root, model='quad',
                            texture=band(128, 24, 1.35), scale=(1.0, 0.2),
                            color=_rgba(OUTLINE_RGB, 0.0), z=0.09,
                            shader=unlit_shader)
        self.ring = Entity(parent=self.root, model='quad',
                           texture=ring(128, 0.13, 1.5), scale=(0.4, 0.4),
                           color=_rgba((255, 255, 255), 0.0), z=0.08,
                           shader=unlit_shader)
        self.halo = Entity(parent=self.root, model='quad',
                           texture=soft_dot(64, 1.6), scale=(1.2, 0.5),
                           color=_rgba((255, 255, 255), 0.0), z=0.06,
                           shader=unlit_shader)
        self.glow_copies = []
        for dx, dy in ((-0.004, 0.0), (0.004, 0.0), (0.0, -0.004),
                       (0.0, 0.004)):
            self.glow_copies.append(_text_copy(self.root, 0.02, (dx, dy)))
        self.outline = _text_copy(self.root, 0.012, (0.0022, -0.0022))
        self.text = _text_copy(self.root, 0.0)
        self.sub_glow = _text_copy(self.root, 0.02)
        self.sub = _text_copy(self.root, 0.0)
        self.base_rgb = (255, 255, 255)
        self.glow_rgb = (96, 226, 255)
        self.base_scale = 2.4
        self.base_sub_scale = 0.72
        self.base_position = (0.0, 0.06)
        self.base_halo = (1.2, 0.5)
        self.base_plate = (1.0, 0.20)
        self.base_ring = 0.45

    # ------------------------------------------------------------------ setup
    def configure(self, text, rgb, glow_rgb, scale, position=(0.0, 0.06),
                  sub='', plate=True):
        """Set the content and the resting transform (no animation)."""
        self.root.enabled = True
        self.base_rgb = tuple(rgb)
        self.glow_rgb = tuple(glow_rgb)
        self.base_position = (position[0], position[1])
        self.text.text = str(text)
        self.outline.text = str(text)
        for copy in self.glow_copies:
            copy.text = str(text)
        self.sub.text = str(sub)
        self.sub_glow.text = str(sub)
        width = max(1e-4, float(self.text.width))
        aspect = window.aspect_ratio
        # Fit inside the screen with a margin, but never below the requested
        # size for short strings (a strike should read as a strike).
        fitted = min(scale, (aspect - 0.30) / width)
        self.base_scale = max(0.8, fitted)
        for entity in [self.text, self.outline] + self.glow_copies:
            entity.scale = self.base_scale
        # The type's own height is the yardstick for the halo, the plate and
        # the ring, so the layers stay in proportion at every font size.
        text_height = max(0.012, float(getattr(self.text, 'height', 0.0) or 0.0)
                          * self.base_scale)
        self.base_sub_scale = max(0.50, self.base_scale * 0.34)
        self.sub.scale = self.base_sub_scale
        self.sub_glow.scale = self.base_sub_scale
        self.base_halo = (min(aspect - 0.2, width * self.base_scale * 0.85),
                          text_height * 3.2)
        self.halo.scale = self.base_halo
        # The dark band wraps the main line *and*, when there is one, the
        # sub-line: without that the thin cyan label sits half off the band and
        # washes out against the bright lane boards.
        sub_gap = MOTION.result_sub_gap if sub else 0.0
        self.base_plate_offset = -sub_gap * 0.5
        self.base_plate = (
            min(aspect - 0.06, width * self.base_scale + text_height * 2.6),
            max(0.10, text_height * 2.7 + sub_gap * 1.6))
        self.plate.enabled = bool(plate)
        self.base_ring = max(0.26, text_height * 4.2)

    def set_state(self, scale=1.0, alpha=1.0, dy=0.0, dx=0.0, rotation=0.0,
                  sub_alpha=0.0, sub_dy=0.0, ring=0.0, plate=1.0):
        """Apply the animated transform.

        ``scale`` and ``alpha`` are multipliers over the configured values;
        ``dy`` / ``dx`` are UI-space offsets; ``rotation`` is degrees;
        ``sub_alpha`` / ``sub_dy`` drive the sub-line; ``ring`` is the 0..1
        progress of the impact ring behind the card.
        """
        offset_x = self.base_position[0] + dx
        offset_y = self.base_position[1] + dy
        scaled = self.base_scale * scale
        for entity in [self.text] + self.glow_copies:
            entity.position = (offset_x, offset_y)
            entity.rotation_z = rotation
            entity.scale = scaled
        self.outline.position = (offset_x + 0.0022 * scale,
                                 offset_y - 0.0022 * scale)
        self.outline.rotation_z = rotation
        self.outline.scale = scaled
        alpha = 0.0 if alpha < 0.0 else (1.0 if alpha > 1.0 else alpha)
        self.text.color = _rgba(self.base_rgb, alpha)
        self.outline.color = _rgba(OUTLINE_RGB, alpha * 0.80)
        for copy in self.glow_copies:
            copy.color = _rgba(self.glow_rgb, alpha * 0.45)
        self.halo.position = (offset_x, offset_y, 0.06)
        self.halo.scale = (self.base_halo[0] * scale, self.base_halo[1] * scale)
        self.halo.color = _rgba(self.glow_rgb, alpha * 0.16)
        # The sub-line sits under the main line and slides up into place. It is
        # drawn in the accent colour (the main line owns the shout colour) with
        # a soft white halo, so both lines stay legible over the lane.
        sub_alpha = (0.0 if sub_alpha < 0.0
                     else (1.0 if sub_alpha > 1.0 else sub_alpha))
        sub_y = offset_y - MOTION.result_sub_gap * scale + sub_dy
        for entity, colour, gain in ((self.sub, self.glow_rgb, 1.00),
                                     (self.sub_glow, (255, 255, 255), 0.34)):
            entity.position = (offset_x, sub_y)
            entity.scale = self.base_sub_scale
            entity.color = _rgba(colour, alpha * sub_alpha * gain)
        # The plate and the ring (the ring expands as it fades).
        self.plate.position = (offset_x,
                               offset_y + self.base_plate_offset * scale, 0.09)
        self.plate.scale = (self.base_plate[0] * scale,
                            self.base_plate[1] * scale)
        self.plate.color = _rgba(OUTLINE_RGB,
                                 alpha * MOTION.result_plate_alpha * plate)
        ring = 0.0 if ring < 0.0 else (1.0 if ring > 1.0 else ring)
        ring_scale = self.base_ring * (0.45 + 1.15 * ring)
        self.ring.position = (offset_x, offset_y, 0.08)
        self.ring.scale = (ring_scale, ring_scale)
        self.ring.color = _rgba(self.glow_rgb, alpha * 0.55 * (1.0 - ring))
        self.ring.enabled = ring > 0.002 and alpha > 0.01

    def hide(self):
        self.root.enabled = False
        self.ring.enabled = False

    @property
    def visible(self):
        return self.root.enabled


class ResultCardPool:
    """A small pool of :class:`ResultCard` (strike + pins can overlap)."""

    def __init__(self, parent, motion, capacity=2):
        self.cards = [ResultCard(parent, motion) for _ in range(capacity)]
        self._index = 0

    def acquire(self):
        # Round-robin, re-using the least recently used card.
        card = self.cards[self._index % len(self.cards)]
        self._index = (self._index + 1) % len(self.cards)
        return card

    def hide_others(self, keep):
        """Hide every card but ``keep``.

        A cancelled result timeline never runs its own ``hide`` step, so this
        is what stops a stale banner surviving into the next result.
        """
        for card in self.cards:
            if card is not keep:
                card.hide()

    def hide_all(self):
        for card in self.cards:
            card.hide()


# ---------------------------------------------------------------------------
# Pin pops: the small "+1 PIN!" shouts as the pins fall
# ---------------------------------------------------------------------------
class PopText:
    """One small punchy pop-up ("+1 PIN!", "DOUBLE!").

    Deliberately lighter than a :class:`ResultCard`: an outline, four glow
    copies and the main line, no plate and no ring, because up to five of
    these are alive at once while the pins are flying.
    """

    def __init__(self, parent):
        self.root = Entity(parent=parent, enabled=False)
        self.glow_copies = []
        for dx, dy in ((-0.003, 0.0), (0.003, 0.0), (0.0, -0.003),
                       (0.0, 0.003)):
            self.glow_copies.append(_text_copy(self.root, 0.02, (dx, dy)))
        self.outline = _text_copy(self.root, 0.012, (0.0018, -0.0018))
        self.text = _text_copy(self.root, 0.0)
        self.base_rgb = (255, 214, 130)
        self.glow_rgb = (96, 226, 255)
        self.base_scale = 1.0
        self.base_position = (0.0, 0.0)

    def configure(self, text, rgb, glow_rgb, scale, position=(0.0, 0.0)):
        self.root.enabled = True
        self.base_rgb = tuple(rgb)
        self.glow_rgb = tuple(glow_rgb)
        self.base_position = (position[0], position[1])
        self.text.text = str(text)
        self.outline.text = str(text)
        for copy in self.glow_copies:
            copy.text = str(text)
        width = max(1e-4, float(self.text.width))
        aspect = window.aspect_ratio
        self.base_scale = max(0.35, min(scale, (aspect - 0.20) / width))
        for entity in [self.text, self.outline] + self.glow_copies:
            entity.scale = self.base_scale

    def set_state(self, scale=1.0, alpha=1.0, dy=0.0, dx=0.0, rotation=0.0):
        offset_x = self.base_position[0] + dx
        offset_y = self.base_position[1] + dy
        scaled = self.base_scale * scale
        for entity in [self.text] + self.glow_copies:
            entity.position = (offset_x, offset_y)
            entity.rotation_z = rotation
            entity.scale = scaled
        self.outline.position = (offset_x + 0.0018 * scale,
                                 offset_y - 0.0018 * scale)
        self.outline.rotation_z = rotation
        self.outline.scale = scaled
        alpha = 0.0 if alpha < 0.0 else (1.0 if alpha > 1.0 else alpha)
        self.text.color = _rgba(self.base_rgb, alpha)
        self.outline.color = _rgba(OUTLINE_RGB, alpha * 0.80)
        for copy in self.glow_copies:
            copy.color = _rgba(self.glow_rgb, alpha * 0.48)

    def hide(self):
        self.root.enabled = False

    @property
    def visible(self):
        return self.root.enabled


class PopTextPool:
    """A round-robin pool of :class:`PopText` (up to five at once)."""

    def __init__(self, parent, capacity=5):
        self.pops = [PopText(parent) for _ in range(max(1, int(capacity)))]
        self._index = 0

    def acquire(self):
        pop = self.pops[self._index % len(self.pops)]
        self._index = (self._index + 1) % len(self.pops)
        pop.hide()
        return pop

    def hide_all(self):
        for pop in self.pops:
            pop.hide()


# ---------------------------------------------------------------------------
# Camera shake
# ---------------------------------------------------------------------------
class ShakeBuffer:
    """A decaying camera shake, in metres, sampled by the camera rig.

    Two out-of-phase sines rather than a random jitter: random per-frame
    offsets read as a broken frame rate, while a smooth decaying wobble reads
    as impact. ``trigger`` is a no-op under reduce motion.
    """

    def __init__(self, metres_per_pixel=None):
        self.amplitude = 0.0        # metres
        self.duration = 0.0
        self.time = 0.0
        self.metres_per_pixel = (MOTION.shake_metres_per_px
                                 if metres_per_pixel is None
                                 else metres_per_pixel)

    def trigger(self, pixels, duration=None):
        if not MOTION.allow_shake():
            return
        duration = MOTION.strike_shake_time if duration is None else duration
        amplitude = float(pixels) * self.metres_per_pixel \
            * MOTION.master_intensity
        # A new shake replaces the old one unless it is weaker (so a small
        # spare shake cannot water down a strike).
        if amplitude >= self.amplitude or self.time >= self.duration:
            self.amplitude = amplitude
            self.duration = max(1e-3, float(duration))
            self.time = 0.0

    def update(self, dt):
        if self.amplitude <= 0.0:
            return
        self.time += dt
        if self.time >= self.duration:
            self.amplitude = 0.0

    def offset(self):
        """The current world-space offset ``(x, y, z)`` in metres."""
        if self.amplitude <= 0.0:
            return (0.0, 0.0, 0.0)
        decay = 1.0 - min(1.0, self.time / max(1e-6, self.duration))
        decay *= decay                      # quadratic settle
        amplitude = self.amplitude * decay
        t = self.time
        x = math.sin(t * 62.0) * amplitude
        y = math.sin(t * 47.0 + 1.3) * amplitude * 0.7
        return (x, y, 0.0)


# ---------------------------------------------------------------------------
# Helpers used by the director's timelines
# ---------------------------------------------------------------------------
def _tween_step(duration, callback):
    from motion.tween import tween_step
    return tween_step(duration, callback)


def _script(steps):
    """Turn ``(kind, payload[, duration])`` tuples into timeline steps."""
    from motion.tween import call, tween_step, wait

    script = []
    for step in steps:
        kind = step[0]
        if kind == 'wait':
            script.append(wait(step[1]))
        elif kind == 'call':
            script.append(call(step[1]))
        elif kind == 'tween':
            script.append(tween_step(step[2], step[1]))
        elif kind == 'finish':
            script.append(call(lambda: None))
    return script


def pulse_value(clock, period, low, high, phase=0.0):
    """A breathing value - constant at ``high`` under reduce motion."""
    if not MOTION.allow_pulse():
        return high
    return ease.breathe(clock, period, low, high, phase)


def glow_alpha(clock, period, low, high, phase=0.0):
    return pulse_value(clock, period, low, high, phase)


def adaptive_particle_budget(frame_time, current=None, target=1.0 / 60.0):
    """Degrade the particle budget when frames run long.

    Called by the director a few times a second (never per frame): a machine
    that cannot hold 60 fps drops the budget towards
    ``MOTION.quality_min_scale``, and a machine with headroom climbs back.
    """
    current = MOTION.particle_budget if current is None else current
    if frame_time > target * 1.35:
        return max(MOTION.quality_min_scale, current - 0.06)
    if frame_time < target * 0.95:
        return min(1.0, current + 0.02)
    return current
