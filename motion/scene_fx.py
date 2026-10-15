"""The 3D presentation layer: neon, pins, ball, camera, aim guide, sweeper.

Everything here is *presentation only*: it never writes a physics body, never
decides a pin count, and every animation is driven by the shared
:class:`motion.tween.Motion`. The rules from the spec:

* **neon strips** breathe slowly, each on its own phase, and spike on a strike;
* the **pink glow behind the pins** breathes, and surges when pins are hit;
* the **ball** leaves a fading trail, sparks on release and on pin impact;
* an **impact ring** expands flat across the deck when the ball lands on the
  rack (scaled by the speed it arrived with);
* the **camera** pushes in (FOV 60 -> 54) as the ball nears the pins, shakes on
  an impact and eases back for the next ball;
* the **rack reset** lowers the sweeper bar, clears, then drops the pins back in
  with a quick stagger;
* the **aim guide** is a dashed line whose dashes march forward, with arrows
  that pulse, and fades out over 150 ms once the throw begins;
* the **avatar** breathes while idle and its throw pose follows the drag.

The scene code (``scene/lane.py``, ``scene/pins.py``) stays authoritative: it
records the entities it builds in module-level lists, and this module animates
them. That keeps the physics layer untouched and the animation optional.
"""
import math
import random

from ursina import Entity
from ursina.shaders import unlit_shader

import config
from motion import ease
from motion.config import MOTION
from motion.effects import rgba
from scene.geometry import disc, quad


# ---------------------------------------------------------------------------
# Neon strips and the pin glow
# ---------------------------------------------------------------------------
class NeonStrips:
    """The city's neon tubes: slow ambient pulse + a strike spike.

    ``scene.lane`` records every tube in ``scene.lane.NEON_STRIPS`` as
    ``(entity, base_rgb)``; each strip gets its own phase so the city breathes
    asynchronously instead of flashing in lockstep. A strike multiplies the
    brightness for a moment (``spike``).
    """

    def __init__(self, strips=None, lane_arrows=None):
        if strips is None:
            from scene import lane as lane_module
            strips = getattr(lane_module, 'NEON_STRIPS', [])
        if lane_arrows is None:
            from scene import lane as lane_module
            lane_arrows = getattr(lane_module, 'LANE_ARROWS', [])
        # (entity, base_rgb, base_alpha) - the alpha is read back from the tube
        # once, so a half-transparent strip stays half-transparent.
        self.strips = [(entity, tuple(rgb), _alpha_of_colour(entity.color))
                       for entity, rgb in strips]
        self.arrows = list(lane_arrows)
        self.clock = 0.0
        self.spike_level = 0.0
        self.sequence = []          # lane-light flash sequence (turkey)
        self.sequence_time = 0.0
        self._arrow_base = [(entity, entity.color) for entity in self.arrows]

    # ------------------------------------------------------------------ events
    def spike(self, amount=1.0, duration=None):
        """Brightness multiplier after a strike / a pin hit.

        A brightness spike is a flash in all but name, so reduce motion
        suppresses it (the strips then hold a steady glow).
        """
        if not MOTION.allow_flash():
            return
        self.spike_level = max(self.spike_level,
                               MOTION.strip_spike * max(0.0, float(amount)))

    def lane_flash(self, duration=1.2):
        """Flash the lane lights in sequence down the lane (turkey)."""
        if not MOTION.allow_flash():
            return
        self.sequence_time = 0.0
        self.sequence = sorted(self.strips, key=lambda item: item[0].world_z)

    # ------------------------------------------------------------------ update
    def update(self, dt):
        self.clock += dt
        if self.spike_level > 0.0:
            self.spike_level = max(
                0.0, self.spike_level
                - MOTION.strip_spike_decay * dt * MOTION.strip_spike)
        if self.sequence:
            self.sequence_time += dt
            if self.sequence_time > 1.6:
                self.sequence = []
        sequence_index = int(self.sequence_time / 0.10) if self.sequence else -1
        for index, (entity, base_rgb, base_alpha) in enumerate(self.strips):
            if entity is None or entity.enabled is False:
                continue
            phase = index * 0.7
            if MOTION.allow_pulse():
                breath = ease.breathe(self.clock, MOTION.strip_period_min
                                      + (index % 3) * 0.5,
                                      MOTION.strip_floor, MOTION.strip_ceiling,
                                      phase)
            else:
                breath = MOTION.strip_ceiling
            gain = breath + self.spike_level
            if self.sequence and index == min(sequence_index,
                                              len(self.strips) - 1):
                gain += 1.6
            entity.color = rgba(_scaled(base_rgb, gain), base_alpha)
        if MOTION.allow_pulse() and self.arrows:
            pulse = ease.breathe(self.clock, MOTION.guide_arrow_period, 0.0, 1.0)
            for entity, base_colour in self._arrow_base:
                alpha = _alpha_of_colour(base_colour) \
                    * (0.65 + MOTION.guide_arrow_pulse * pulse)
                entity.color = rgba(_rgb_of_colour(base_colour), alpha)


class PinGlow:
    """The glow behind the pins: breathing, plus a surge on a pin hit."""

    def __init__(self, entity=None):
        if entity is None:
            from scene import lane as lane_module
            entity = getattr(lane_module, 'PIN_GLOW', None)
        self.entity = entity
        self.clock = 0.0
        self.surge = 0.0
        self.base = (255, 255, 255)

    def hit(self, amount=1.0):
        """Surge with the impact (a flash-like spike: off under reduce motion)."""
        if not MOTION.allow_flash():
            return MOTION.scaled_count(0)
        self.surge = max(self.surge, MOTION.glow_surge * float(amount))
        return MOTION.scaled_count(MOTION.dust_puff_impact)

    def update(self, dt):
        if self.entity is None:
            return
        self.clock += dt
        if self.surge > 0.0:
            self.surge = max(0.0, self.surge
                             - MOTION.glow_surge_decay * dt * MOTION.glow_surge)
        depth = MOTION.glow_breathe_depth
        if MOTION.allow_pulse():
            breathe = ease.breathe(self.clock, MOTION.glow_breathe_period,
                                   0.0, 1.0)
        else:
            breathe = 0.5
        alpha = 0.55 + depth * (0.5 + 0.5 * breathe) + self.surge
        self.entity.color = rgba(self.base, min(1.0, alpha))


# ---------------------------------------------------------------------------
# Ball trail and dust
# ---------------------------------------------------------------------------
class BallTrail:
    """The fading trail that records the path the ball actually took.

    Older markers are dimmer and smaller, so a hook reads as a curve with a
    direction; the trail also carries the ball's angular velocity into the
    marker rotation, which makes the spin visible on the lane surface.
    """

    MAX = 52
    SPACING = 0.30

    def __init__(self, ball, parent=None):
        self.ball = ball
        self.markers = [Entity(model=disc(0.032, segments=8),
                               color=rgba((150, 232, 255), 0.5),
                               shader=unlit_shader, visible=False)
                        for _ in range(self.MAX)]
        self.points = []
        self._visible = False

    def clear(self):
        if self.points:
            self.points = []
        for marker in self.markers:
            marker.visible = False

    def update(self, dt, window_visible):
        if not window_visible:
            self.clear()
            return
        position = self.ball.physics.position
        if not self.points or math.dist((position[0], position[2]),
                                        self.points[-1]) >= self.SPACING:
            self.points.append((position[0], position[2]))
            if len(self.points) > self.MAX:
                self.points.pop(0)
        count = len(self.points)
        for index, marker in enumerate(self.markers):
            if index < count:
                x, z = self.points[index]
                age = (count - index) / max(1, count)
                alpha = ease.lerp(MOTION.trail_alpha_min,
                                  MOTION.trail_alpha_max, 1.0 - age)
                scale = MOTION.trail_scale * (0.55 + 0.45 * (1.0 - age))
                marker.position = (x, 0.006, z)
                marker.scale = (scale, scale, scale)
                marker.color = rgba((150, 232, 255), alpha)
                marker.visible = True
            else:
                marker.visible = False


class DustPuffs:
    """Small 3D sparks: release, pin impact and gutter thud."""

    def __init__(self, capacity=64):
        self.pool = []
        self.active = []
        for _ in range(capacity):
            entity = Entity(model=disc(0.05, segments=8), shader=unlit_shader,
                            color=rgba((255, 255, 255), 0.0), visible=False)
            self.pool.append(entity)

    def burst(self, position, count=None, rgb=(150, 232, 255), speed=1.1,
              spread=1.0):
        count = MOTION.scaled_count(6 if count is None else count)
        for _ in range(count):
            if not self.pool:
                return
            entity = self.pool.pop()
            entity.visible = True
            entity.position = (position[0], max(0.02, position[1]), position[2])
            angle = _random_range(0.0, math.tau)
            magnitude = speed * _random_range(0.4, 1.3) * max(0.2, spread)
            entity.scale = (_random_range(0.5, 1.4),) * 3
            entity.rotation_z = _random_range(0, 360)
            self.active.append([entity,
                                math.cos(angle) * magnitude,
                                _random_range(0.3, 0.9) * magnitude,
                                math.sin(angle) * magnitude,
                                0.0, MOTION.dust_life * _random_range(0.6, 1.3),
                                tuple(rgb)])

    def update(self, dt):
        if not self.active:
            return
        alive = []
        for particle in self.active:
            entity, vx, vy, vz, life, max_life, rgb = particle
            life += dt
            if life >= max_life:
                entity.visible = False
                self.pool.append(entity)
                continue
            vy += -3.4 * dt
            entity.x = entity.x + vx * dt
            entity.y = max(0.01, entity.y + vy * dt)
            entity.z = entity.z + vz * dt
            fraction = life / max_life
            entity.color = rgba(rgb, 0.8 * (1.0 - fraction))
            scale = (0.05 * (0.5 + 0.8 * (1.0 - fraction)),) * 3
            entity.scale = scale
            particle[4] = life
            alive.append(particle)
        self.active = alive

    def clear(self):
        for particle in self.active:
            particle[0].visible = False
            self.pool.append(particle[0])
        self.active = []


class ImpactRings:
    """Flat shockwave rings on the pin deck when the ball lands on it.

    A ring lies on the (nearly) horizontal deck, expands and fades - the
    arcade "thump" that makes a hard hit read as hard. It is pooled (four at
    once) and skipped under reduce motion, because an expanding shockwave is a
    flash in all but name.
    """

    MAX = 4

    def __init__(self, capacity=MAX):
        from motion.gfx import ring as ring_texture
        self.texture = ring_texture(128, 0.11, 1.4)
        self.pool = [Entity(model='quad', texture=self.texture,
                            shader=unlit_shader, rotation_x=90,
                            color=rgba((255, 255, 255), 0.0), visible=False)
                     for _ in range(max(1, int(capacity)))]
        self.active = []

    def burst(self, position, rgb=(255, 226, 150), size=None, time=None):
        """One ring at ``position`` (world metres), scaled by the hit."""
        if not MOTION.allow_flash():
            return
        if not self.pool:
            return
        entity = self.pool.pop()
        entity.visible = True
        entity.position = (position[0], max(0.02, position[1]), position[2])
        entity.scale = (0.2, 0.2, 0.2)
        self.active.append([entity, 0.0,
                            (MOTION.impact_ring_time if time is None else time),
                            tuple(rgb),
                            (MOTION.impact_ring_size if size is None else size)])

    def update(self, dt):
        if not self.active:
            return
        alive = []
        for item in self.active:
            entity, life, duration, rgb, size = item
            life += dt
            if life >= duration:
                entity.visible = False
                self.pool.append(entity)
                continue
            fraction = life / max(1e-5, duration)
            # Fast out, slow landing, fading as it goes.
            grown = 1.0 - (1.0 - fraction) ** 2.4
            scale = size * (0.22 + 0.95 * grown)
            entity.scale = (scale, scale, scale)
            entity.color = rgba(rgb, 0.75 * (1.0 - fraction) ** 1.3)
            item[1] = life
            alive.append(item)
        self.active = alive

    def clear(self):
        for item in self.active:
            item[0].visible = False
            self.pool.append(item[0])
        self.active = []


# ---------------------------------------------------------------------------
# Pin reset: sweeper bar + staggered drop-in
# ---------------------------------------------------------------------------
class RackResetFX:
    """The sweeper bar lowering, clearing, and the pins dropping back in.

    The rack's *physics* reset is instantaneous (it always was); this only
    animates the presentation:

    * the sweeper bar drops from ``sweeper_height`` and slides back up;
    * pins that are being re-stood are held invisible until the bar has
      passed, then dropped from ``drop_height`` with a small stagger, back
      row first.

    ``PinRack`` exposes its pins, and :class:`scene.pins.Pin` applies
    ``fx_offset`` / ``fx_scale`` / ``fx_visible`` in its own ``update``, so the
    physics pose is still the source of truth.
    """

    def __init__(self, motion, pins=None):
        self.motion = motion
        self.bar = Entity(model='cube', shader=unlit_shader,
                          scale=(config.TOTAL_WIDTH * 0.98, 0.06, 0.10),
                          color=rgba((226, 58, 40), 0.85),
                          position=(0, 2.4, config.HEAD_PIN_Z),
                          visible=False)
        self.pins = []
        self.bind(pins)
        self._tag = 'sweeper'

    def bind(self, rack):
        """Point the effect at a rack (a ``PinRack``) or an explicit pin list."""
        pins = getattr(rack, 'pins', None)
        if pins is None:
            pins = rack
        self.pins = list(pins or [])

    def play(self, standing_only=True):
        """Run the reset: sweeper, then a staggered drop-in of the rack."""
        pins = [pin for pin in self.pins
                if (pin.physics.standing if standing_only else True)]
        pins.sort(key=lambda pin: -pin.position[2])   # back row first
        # Cancel any drop still in flight for the previous rack *once*, before
        # the new wave starts (cancelling inside the loop would kill the pins
        # scheduled before the current one and leave them floating).
        self.motion.cancel(tag='pin_drop')
        self.bar.visible = False
        for pin in pins:
            pin.fx_offset = MOTION.drop_height
            pin.fx_scale = 0.85
            pin.fx_visible = True
        self._animate_sweeper()
        for index, pin in enumerate(pins):
            delay = (MOTION.sweeper_time * 0.55
                     + MOTION.drop_stagger * index)

            def drop(progress, pin=pin):
                pin.fx_offset = MOTION.drop_height * (1.0 - progress)
                pin.fx_scale = ease.lerp(0.85, 1.0, progress)

            self.motion.tween(MOTION.drop_time, drop, easing=ease.OVERSHOOT,
                              delay=delay, tag='pin_drop',
                              owner=self)

    def _animate_sweeper(self):
        if MOTION.reduce_motion:
            # No bar sweeping: the drop-in alone reads as a reset.
            return
        self.bar.visible = True
        half = MOTION.sweeper_time * 0.5

        def lower(progress):
            self.bar.y = ease.lerp(2.4, 0.16, progress)
            self.bar.color = rgba((226, 58, 40), 0.85 * progress)

        def raise_bar(progress):
            self.bar.y = ease.lerp(0.16, 2.4, progress)
            self.bar.color = rgba((226, 58, 40), 0.85 * (1.0 - progress))

        self.motion.cancel(tag=self._tag)
        self.motion.tween(half, lower, easing=ease.STANDARD, tag=self._tag)
        self.motion.tween(half, raise_bar, easing=ease.STANDARD, delay=half,
                          tag=self._tag,
                          on_complete=lambda: setattr(self.bar, 'visible',
                                                      False))


# ---------------------------------------------------------------------------
# Aim guide
# ---------------------------------------------------------------------------
class AimGuide:
    """The dashed aiming line: marching dashes, pulsing arrows, quick fade.

    The line is drawn from the ball to the targeting arrows, exactly where the
    old solid quad was, but as a row of dashes whose offset flows forward. The
    lane's own arrows pulse subtly (through :class:`NeonStrips`), and the whole
    guide fades out over 150 ms the moment the throw begins.
    """

    def __init__(self, parent=None):
        count = max(4, int(MOTION.guide_dash_count))
        self.dashes = [Entity(model=quad(0.02, 1.0), shader=unlit_shader,
                              color=rgba((120, 226, 255), MOTION.guide_alpha),
                              visible=False)
                       for _ in range(count)]
        self.mark = Entity(model=disc(0.05, segments=16), shader=unlit_shader,
                           color=rgba((120, 226, 255), 0.8), visible=False)
        self.visible = False
        self.flow = 0.0
        self.fade = 1.0          # 1 = up, 0 = faded out (over guide_fade_out)

    def update(self, dt, active, start_x, aim_angle, start_z, end_z):
        """Draw the guide; when ``active`` goes false it fades over 150 ms."""
        if active and not self.visible:
            self.visible = True
            self.fade = 1.0
            self.flow = 0.0
        if active:
            self.fade = 1.0
        elif self.visible:
            # Released: fade the whole guide out, then hide it.
            self.fade = max(0.0, self.fade
                            - dt / max(1e-4, MOTION.guide_fade_out))
            if self.fade <= 0.0:
                self._hide()
                return
        if not self.visible:
            return
        self.flow += MOTION.guide_flow_speed * dt
        length = max(0.2, end_z - start_z)
        dash_length = max(0.05, MOTION.guide_dash_length)
        spacing = dash_length + max(0.02, MOTION.guide_dash_gap)
        offset = self.flow % spacing
        sin_a = math.sin(aim_angle)
        cos_a = math.cos(aim_angle)
        for index, dash in enumerate(self.dashes):
            along = index * spacing + offset
            if along > length:
                dash.visible = False
                continue
            centre = along + dash_length / 2.0
            x = start_x + centre * sin_a
            z = start_z + centre * cos_a
            fade = (1.0 - (along / length) * 0.35) * self.fade
            dash.visible = True
            dash.position = (x, 0.004, z)
            dash.rotation_y = math.degrees(aim_angle)
            dash.scale = (1.0, 1.0, dash_length * (1.0 - (along / length) * 0.2))
            dash.color = rgba((120, 226, 255), MOTION.guide_alpha * fade)
        self.mark.visible = True
        self.mark.color = rgba((120, 226, 255), 0.8 * self.fade)

    def place_mark(self, x, z):
        self.mark.position = (x, 0.005, z)

    def _hide(self):
        self.visible = False
        self.fade = 0.0
        for dash in self.dashes:
            dash.visible = False
        self.mark.visible = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _random_range(low, high):
    return random.uniform(low, high)


def _scaled(rgb, gain):
    return tuple(min(255, int(round(channel * gain))) for channel in rgb)


def _rgb_of_colour(colour):
    try:
        return (int(round(colour[0] * 255)), int(round(colour[1] * 255)),
                int(round(colour[2] * 255)))
    except (TypeError, IndexError):
        return (255, 255, 255)


def _alpha_of_colour(colour):
    try:
        return float(colour[3])
    except (TypeError, IndexError):
        return 1.0
