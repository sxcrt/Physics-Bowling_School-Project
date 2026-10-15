"""The director: the one object the game talks to.

:class:`MotionDirector` owns the whole animation system - the tween runner,
the pooled UI effects, the HUD widgets and the 3D presentation - and exposes
the trigger functions the spec asks for:

============================  ==================================================
trigger                       called when
============================  ==================================================
``onMatchStart(...)``         a match is configured (reveals the scoreboard)
``onThrowRelease(...)``       a throw leaves the hand (sections 4 and 6)
``onPinsResolved(...)``       the roll is counted (section 5: the result)
``onScoreEntry(...)``         a roll is written into the scorecard
``onFrameAdvance(frame)``     the scorer moves to the next frame
``onPinReset(...)``           the rack is re-stood (sweeper + drop-in)
``onGameEnd(...)``            the match is over (section 7)
============================  ==================================================

plus one per-frame call:

.. code-block:: python

    director.update(dt, ball=ball, state=self.state, throws=..., meter=...)

The game logic stays in :mod:`game.play`: the director never reads the scorer,
never launches a ball and never decides a pin count. Its inputs are plain
values, which keeps every effect removable and testable.
"""
import math
import random

from motion import celebrate, ease
from motion.config import MOTION
from motion.effects import (FlashFX, ParticlesFX, PopTextPool, ResultCardPool,
                            ShakeBuffer, SweepFX, VignetteFX,
                            adaptive_particle_budget, rgba)
from motion.hud_fx import HudMotion
from motion.scene_fx import (AimGuide, BallTrail, DustPuffs, ImpactRings,
                             NeonStrips, PinGlow, RackResetFX)
from motion.tween import Motion, call, tween_step, wait

# Result colours (RGB 0-255), following the hall's palette.
CYAN = (96, 226, 255)
MAGENTA = (232, 72, 168)
AMBER = (255, 214, 130)
WHITE = (245, 245, 252)
DESAT_BLUE = (126, 152, 196)
GOLD = (255, 214, 130)

# Per-style media budget: text, colours, hold and particle counts. Built by
# :func:`result_spec` so a live change to ``MOTION`` is picked up.
def result_spec(style, pins=0, streak=1):
    """The text, colours, hold and media budget for one result style.

    ``streak`` is the number of consecutive strikes including this one (the
    director tracks it), and it escalates the media: a double, a turkey and
    everything after it hit harder, flash more and stay up longer.
    """
    combo = celebrate.combo_label(streak)
    intensity = celebrate.streak_intensity(streak)
    if style == 'turkey':
        # The main line already says TURKEY!, so the sub-line names the streak
        # only when there is something new to say (four in a row and beyond).
        return dict(text=MOTION.turkey_text, sub=('' if streak <= 3 else combo),
                    rgb=AMBER, glow=MAGENTA, scale=3.0, hold=MOTION.turkey_hold,
                    particles=int(MOTION.turkey_particles * intensity),
                    dust=int(MOTION.strike_dust * intensity),
                    shake=MOTION.strike_shake_px * 1.3 * intensity,
                    flashes=MOTION.turkey_flashes + max(0, streak - 3),
                    flash_colors=(CYAN, MAGENTA, AMBER), position=(0.0, 0.04),
                    slam_from=2.05, rotate=5.5, ring=True,
                    in_time=MOTION.result_slam_time * 1.05)
    if style == 'strike':
        return dict(text='STRIKE!', sub=combo, rgb=AMBER, glow=CYAN,
                    scale=min(3.9, 3.4 + 0.12 * (streak - 1)),
                    hold=MOTION.result_hold * _combo_hold(streak),
                    particles=int(MOTION.strike_particles * intensity),
                    dust=int(MOTION.strike_dust * intensity),
                    shake=MOTION.strike_shake_px * min(1.5, intensity),
                    flashes=MOTION.strike_flashes + min(3, streak - 1),
                    flash_colors=(CYAN, MAGENTA), position=(0.0, 0.04),
                    slam_from=MOTION.result_slam_scale,
                    rotate=MOTION.result_slam_rotate, ring=True,
                    in_time=MOTION.result_slam_time)
    if style == 'spare':
        return dict(text='SPARE', sub=celebrate.spare_label(), rgb=CYAN,
                    glow=MAGENTA, scale=2.8,
                    hold=MOTION.result_hold * 0.9,
                    particles=MOTION.spare_particles,
                    dust=4,
                    shake=MOTION.spare_shake_px, flashes=1,
                    flash_colors=(CYAN,), position=(0.0, 0.04),
                    slam_from=1.55, rotate=2.5, ring=True,
                    in_time=MOTION.result_in_time * 0.9)
    if style == 'gutter':
        return dict(text='GUTTER', sub='', rgb=DESAT_BLUE, glow=(70, 90, 130),
                    scale=2.2, hold=MOTION.result_hold * 0.7, particles=8,
                    dust=0, shake=0.0, flashes=0, flash_colors=(),
                    position=(0.0, 0.04), slam_from=1.0, rotate=0.0,
                    ring=False, in_time=MOTION.result_in_time)
    # A plain count: 8-9 pins is a genuinely good ball, so it earns a shockwave
    # and a slightly bigger card; a single pin stays modest.
    strong = pins >= 8
    return dict(text=celebrate.pins_result_text(pins), sub='', rgb=AMBER,
                glow=CYAN, scale=2.3 if strong else 1.9,
                hold=MOTION.result_hold * 0.6 * celebrate.pins_hold_scale(pins),
                particles=(MOTION.strike_particles // 2 if strong else 10),
                dust=6 if strong else 0,
                shake=0.0 if not strong else 1.4, flashes=0, flash_colors=(),
                position=(0.0, -0.08), slam_from=1.35 if strong else 1.15,
                rotate=1.5, ring=strong,
                in_time=MOTION.result_in_time * (0.85 if strong else 0.75))


def _combo_hold(streak):
    """The hold multiplier for a strike streak (1.0 ... ``combo_hold_max``)."""
    bonus = MOTION.combo_hold_bonus * (max(1, int(streak)) - 1)
    return 1.0 + min(MOTION.combo_hold_max, bonus)


class MotionDirector:
    """Owns every animation and exposes the trigger API (see the module doc)."""

    def __init__(self, hud=None, ball=None, pins=None):
        self.motion = Motion()
        self.parent = getattr(hud, 'root', None) if hud is not None else None
        self.hud = HudMotion(hud, self.motion) if hud is not None else None
        if hud is not None:
            hud.motion = self.hud
        self.ball = ball
        self.pins = pins
        # Pooled UI effects, parented to the HUD root so they hide with it.
        self.flash = FlashFX(self.parent, self.motion)
        self.vignette = VignetteFX(self.parent, self.motion)
        self.sweep = SweepFX(self.parent, self.motion)
        self.particles = ParticlesFX(self.parent, self.motion, capacity=220)
        self.cards = ResultCardPool(self.parent, self.motion, capacity=2)
        self.pops = PopTextPool(self.parent, capacity=5)
        self.shake = ShakeBuffer()
        # 3D presentation.
        self.strips = NeonStrips()
        self.pin_glow = PinGlow()
        self.dust = DustPuffs()
        self.rings = ImpactRings()
        self.trail = BallTrail(ball) if ball is not None else None
        self.racks = RackResetFX(self.motion, pins)
        self.guide = AimGuide()
        # Book-keeping.
        self.throw_count = 0
        self.strike_streak = 0
        self.slow_motion_time = 0.0
        self.last_impact_speed = None
        self._quality_timer = 0.0
        self._last_frame_time = 1.0 / 60.0
        # The live pin watcher: how many pins of this roll have been announced.
        self._pins_counted = 0
        # The alternating side of the pin pops (a rising run of stamps).
        self._pop_seq = 0
        # 0 = no award, 1 = win, 2 = personal best, 3 = perfect game.
        self._award_tier = 0
        self._slow_motion_charged = False

    # ==================================================================
    # Per-frame
    # ==================================================================
    def update(self, dt, ball=None, pins=None, state='ready', meter=None):
        """Step everything: one call per frame, from ``Game.update``.

        ``meter`` is ``(dragging, power)`` from the active input source. While
        the ball is on its way the rack is watched here, so every pin that
        falls is announced the moment it falls (see :meth:`onPinDrop`).
        """
        self.note_frame_time(dt)
        self.motion.update(dt)
        self.slow_motion_time = max(0.0, self.slow_motion_time - dt)
        self.strips.update(dt)
        self.pin_glow.update(dt)
        self.dust.update(dt)
        self.rings.update(dt)
        self.particles.update(dt)
        self.shake.update(dt)
        self._watch_pins(pins, state)
        if self.hud is not None:
            self.hud.update(dt)
            if meter is not None:
                self.hud.meter_update(meter[0], meter[1], dt)
            else:
                self.hud.meter_update(False, 0.0, dt)
        if self.trail is not None:
            self.trail.update(dt, state in ('rolling', 'settling', 'result'))
        self._update_quality(dt)

    def _watch_pins(self, pins, state):
        """Announce each pin that falls while the roll is in flight.

        The rack is authoritative: ``knockdown_count`` only ever grows during a
        roll, and a new roll resets the tally through :meth:`onThrowRelease`.
        Outside a roll the tally is left alone (a rack reset must not read as
        ten pins falling).
        """
        pins = pins if pins is not None else self.pins
        if pins is None or state not in ('rolling', 'settling'):
            return
        try:
            count = int(pins.knockdown_count())
        except Exception:                    # pragma: no cover - engine quirk
            return
        if count > self._pins_counted:
            delta = count - self._pins_counted
            self._pins_counted = count
            self.onPinDrop(count, delta)

    def update_aim_guide(self, dt, active, start_x, aim_angle, start_z, end_z,
                         mark_x=None):
        """Draw the dashed aiming line (see :class:`motion.scene_fx.AimGuide`)."""
        self.guide.update(dt, active, start_x, aim_angle, start_z, end_z)
        if mark_x is not None:
            self.guide.place_mark(mark_x, end_z)

    def _update_quality(self, dt):
        """Degrade the particle budget when the frame time slips."""
        self._quality_timer += dt
        if self._quality_timer < 1.0:
            return
        self._quality_timer = 0.0
        budget = adaptive_particle_budget(self._last_frame_time)
        if budget != MOTION.particle_budget:
            MOTION.particle_budget = budget

    def note_frame_time(self, frame_time):
        self._last_frame_time = max(1e-3, float(frame_time))

    # ==================================================================
    # Camera hook (read by scene.camera)
    # ==================================================================
    def camera_shake(self):
        """The current camera offset in metres, for ``scene.camera``."""
        return self.shake.offset()

    def slow_motion_scale(self):
        """``1.0`` normally; ``0.4`` briefly after a strike (physics only).

        Controlled by ``MOTION.slow_motion_enabled`` alone: slow motion *slows*
        the simulation rather than shaking or flashing, so reduce motion does
        not disable it (the timing of a roll stays identical in both modes).
        """
        if not MOTION.slow_motion_enabled:
            return 1.0
        return MOTION.slow_motion_scale if self.slow_motion_time > 0.0 else 1.0

    # ==================================================================
    # Triggers
    # ==================================================================
    def onMatchStart(self, input_mode='mouse', throws=0):
        """A match was configured: reveal the board, the rack and the prompt."""
        self.throw_count = throws
        self.strike_streak = 0
        self._pins_counted = 0
        self.last_impact_speed = None
        self._award_tier = 0
        self._slow_motion_charged = False
        self.cards.hide_all()
        self.pops.hide_all()
        self.particles.clear()
        self.motion.cancel()
        # A cancelled strobe must not leave a flash or a vignette on screen.
        self.flash.reset()
        self.vignette.clear()
        self.sweep.reset()
        self.dust.clear()
        self.rings.clear()
        if self.trail is not None:
            self.trail.clear()
        if self.hud is not None:
            # Reset the screen last: the entrance animations are the final
            # thing started, so nothing cancels them.
            self.hud.on_show()
        self._log('onMatchStart', input_mode)

    def onThrowRelease(self, throw=None, power=None):
        """The throw left the hand: meter flash, guide fade, release puff."""
        # The pin watcher starts a fresh tally: every pin this roll takes down
        # is announced once, and last round's count can never leak into it.
        self._pins_counted = 0
        self.last_impact_speed = None
        self._slow_motion_charged = False
        self._pop_seq = 0
        if throw is not None:
            # The ball is released on the foul line (z = 0 in lane space).
            position = (getattr(throw, 'lateral_position', 0.0), 0.06, 0.0)
            self.dust.burst(position, count=MOTION.dust_puff_release,
                            rgb=CYAN, speed=0.8)
        if self.hud is not None:
            self.hud.meter_released()
        self._log('onThrowRelease', power)

    def onShotHit(self, position=None, style=None, speed=None):
        """The ball reached the deck: dust, glow surge, camera shake.

        ``speed`` (m/s at the deck, when the game knows it) scales the shake
        and the dust with the impact instead of a fixed amount. The strike
        extras (lane spike, slow motion) still fire here, at the moment the
        ball arrives.
        """
        position = position or (0.0, 0.3, 16.5)
        if speed is not None:
            self.last_impact_speed = speed
        intensity = celebrate.impact_intensity(speed)
        self.dust.burst(position,
                        count=celebrate.impact_dust_count(speed)
                        if speed is not None else MOTION.dust_puff_impact,
                        rgb=WHITE, speed=1.2 + 0.6 * intensity)
        self.pin_glow.hit(0.6 + 0.6 * intensity)
        from scene import camera as scene_camera
        scene_camera.fov_push_in()
        if style in ('strike', 'turkey'):
            self.strips.spike(1.0)
            self.shake.trigger(max(MOTION.strike_shake_px,
                                   celebrate.impact_shake_px(speed)))
            if not getattr(self, '_slow_motion_charged', False):
                self.slow_motion_time = MOTION.slow_motion_time
                self._slow_motion_charged = True
        elif style == 'pins':
            self.shake.trigger(max(MOTION.spare_shake_px * 0.5,
                                   celebrate.impact_shake_px(speed)))

    def onPinImpact(self, position=None, speed=None):
        """The ball actually reached the pins: the impact thud.

        Called by the game the frame the deck records its first contact, which
        is the *real* hit (``onShotHit`` fires a little earlier, as the ball
        crosses into the deck camera). A hard hit earns a shockwave ring
        across the deck and, at the very top of the scale, a brief edge flash.
        """
        position = position or (0.0, 0.30, 17.4)
        intensity = celebrate.impact_intensity(speed)
        self.last_impact_speed = speed
        if intensity > 0.0 and MOTION.slow_motion_enabled \
                and not getattr(self, '_slow_motion_charged', False):
            # The pins are readable because the simulation slows the moment
            # they start moving - the true contact, not the result card.
            self.slow_motion_time = MOTION.slow_motion_time
            self._slow_motion_charged = True
        if intensity > 0.0:
            # A shockwave only when the hit was actually hard: a dribbler that
            # just reaches the head pin keeps the deck quiet.
            self.rings.burst((position[0], 0.02, position[2]),
                             rgb=ease.mix_rgb(WHITE, AMBER, intensity),
                             size=(MOTION.impact_ring_size
                                   * (0.6 + 0.6 * intensity)))
        self.dust.burst(position, count=celebrate.impact_dust_count(speed),
                        rgb=AMBER, speed=1.1 + 0.8 * intensity)
        self.shake.trigger(celebrate.impact_shake_px(speed))
        flash_alpha = celebrate.impact_flash_alpha(speed)
        if flash_alpha > 0.0:
            self.flash.trigger(colors=(WHITE, CYAN), count=1,
                               each=MOTION.result_flash_time * 0.7,
                               alpha=flash_alpha)
        self._log('onPinImpact', round(speed or 0.0, 2))

    def onPinDrop(self, count=1, delta=1):
        """``delta`` pins just fell: the live "+1 PIN!" pop and its thud.

        This is the per-pin feedback the brief asks for: the pop is punchy but
        small, it appears low on the lane (under where the ball is rolling and
        well clear of the result card, the status line and the physics
        readout), it drifts up and fades on its own, and consecutive pops
        alternate sides so a rack falling pin by pin stays legible. It also
        gives the rack's own bookkeeping a visible, immediate answer.
        """
        if self.parent is None or self.hud is None:
            return
        count = max(0, int(count))
        delta = max(1, int(delta))
        pop = self.pops.acquire()
        text = celebrate.pins_popup_text(delta)
        rgb = AMBER if count < 10 else GOLD
        glow = MAGENTA if count >= 10 else CYAN
        # Consecutive pops alternate sides and climb a little, so a rack that
        # falls pin by pin reads as a rising run of "+1 PIN!" stamps instead of
        # one illegible pile of type.
        self._pop_seq += 1
        side = -1.0 if self._pop_seq % 2 else 1.0
        x = (MOTION.pinpop_x * side
             + random.uniform(-MOTION.pinpop_jitter_x, MOTION.pinpop_jitter_x))
        y = (MOTION.pinpop_y
             + MOTION.pinpop_step_y * (self._pop_seq % 3)
             + random.uniform(-MOTION.pinpop_jitter_y, MOTION.pinpop_jitter_y))
        scale = celebrate.pindrop_pop_scale(delta)
        pop.configure(text, rgb, glow, scale, position=(x, y))
        pop.set_state(scale=MOTION.pinpop_slam, alpha=0.0)
        tag = ('pinpop', id(pop))
        self.motion.cancel(tag=tag)
        slam = MOTION.pinpop_time * 0.22
        life = max(slam + 0.05, MOTION.pinpop_time)

        def step_in(progress, pop=pop):
            pop.set_state(scale=ease.lerp(MOTION.pinpop_slam, 1.0, progress),
                          alpha=ease.clamp01(progress * 1.8),
                          rotation=ease.lerp(-4.0, 0.0, progress))

        def float_out(progress, pop=pop, side=side):
            fade_at = MOTION.pinpop_fade_at
            alpha = (1.0 if progress <= fade_at
                     else 1.0 - (progress - fade_at) / max(1e-5, 1.0 - fade_at))
            pop.set_state(scale=1.0, alpha=max(0.0, alpha) ** 1.1,
                          dy=MOTION.pinpop_rise * progress,
                          dx=MOTION.pinpop_drift * side * progress)

        self.motion.timeline([
            tween_step(slam, step_in, easing=ease.OVERSHOOT),
            tween_step(life - slam, float_out, easing=ease.LINEAR),
            call(pop.hide),
        ], tag=tag)
        # The deck thud: small, scaled by how many pins fell together, and
        # never enough to water down the strike's own shake.
        shake_px = celebrate.pindrop_shake_px(delta)
        if shake_px > 0.0:
            self.shake.trigger(shake_px)
        if self.pins is not None and delta > 1:
            # A world-space puff over the pin deck (the pop's x is UI space).
            self.dust.burst((random.uniform(-0.30, 0.30), 0.22, 17.6),
                            count=MOTION.pindrop_dust * delta, rgb=MAGENTA,
                            speed=1.0)
        self._log('onPinDrop', count, delta)

    def onScoreEntry(self, frame_index=None, cell_total=None, official=None,
                     mark=None):
        """A roll is written into the scorecard (pop, flash, count up)."""
        if self.hud is None:
            return
        cell_from = cell_to = None
        if cell_total is not None:
            cell_from, cell_to = cell_total
        official_from = official_to = None
        if official is not None:
            official_from, official_to = official
        self.hud.roll_recorded(frame_index, cell_from, cell_to, official_from,
                               official_to, mark)
        self._log('onScoreEntry', frame_index, mark)

    def onPinsResolved(self, pins=0, style=None, position=None,
                       frame_index=None, cell_total=None, official=None):
        """The roll is counted (section 5): the big result moment.

        ``style`` is ``'strike' | 'spare' | 'gutter' | 'pins'`` (the game
        decides it from the scorer); three strikes in a row escalates to
        ``'turkey'`` automatically, and every further consecutive strike keeps
        raising the media (see :func:`motion.celebrate.combo_label`).
        """
        if style is None:
            style = ('strike' if pins >= 10
                     else ('gutter' if pins <= 0 else 'pins'))
        if style == 'strike':
            self.strike_streak += 1
            if self.strike_streak >= 3:
                style = 'turkey'
        elif style in ('spare', 'gutter'):
            self.strike_streak = 0
        # The approach presentation lands with the result (the true contact
        # thud already fired from onPinImpact); the strike extras scale with
        # the speed the ball actually arrived at.
        self.onShotHit(position=position, style=style,
                       speed=self.last_impact_speed)
        self._play_result(style, pins, frame_index=frame_index,
                          streak=self.strike_streak)
        self._log('onPinsResolved', pins, style, 'streak', self.strike_streak)

    def onFrameAdvance(self, frame=None, previous=None):
        """The scorer moved on: a light sweep, the highlight, the tenth frame."""
        self.sweep.trigger(rgb=(190, 240, 255), width=None)
        if self.hud is not None and frame is not None:
            self.hud.frame_changed(max(0, int(frame) - 1))
            if int(frame) >= 10:
                self.hud.final_frame(9)
                self._final_shimmer()
        self._log('onFrameAdvance', previous, '->', frame)

    def onFrameChange(self, frame):
        """The active frame moved (usually only the highlight)."""
        if self.hud is not None and frame is not None:
            self.hud.frame_changed(max(0, int(frame) - 1))

    def onPinReset(self, standing=None, full=False):
        """The rack is being re-stood: sweeper bar, then the staggered drop-in."""
        self.racks.play(standing_only=not full)
        self._log('onPinReset', standing)

    def onGameEnd(self, total=None, start_from=None, overlay=None,
                  on_ready=None, won=False, best=False, perfect=False,
                  previous=None):
        """The match is over (section 7): the scoreboard expands and counts.

        ``overlay`` is the results panel; the director animates its entrance
        (the panel growing out of the top bar's score block), counts the final
        score up large and fires the confetti.

        ``won`` / ``best`` / ``perfect`` are decided by the game (it owns the
        records and the mode rules); the director plays the *biggest* award
        only - a perfect game beats a personal best, which beats a win - and
        sizes the confetti, the flashes and the banner accordingly.
        """
        award = celebrate.achievement(perfect=perfect, best=best, won=won,
                                      total=total, previous=previous)
        self._award_tier = award[3] if award else 0
        if overlay is not None:
            if award is not None and hasattr(overlay, 'set_achievement'):
                rgb, glow = _award_colours(award[0])
                overlay.set_achievement(award[1], award[2], rgb=rgb, glow=glow)
            overlay.show(total, start_from)
        if award is not None:
            self._play_award(award, overlay)
        if MOTION.allow_flash():
            self.flash.trigger(colors=(CYAN, MAGENTA, WHITE),
                               count=MOTION.turkey_flashes + self._award_tier)
        if callable(on_ready):
            on_ready()
        self._log('onGameEnd', total, 'award', award[0] if award else None)

    def _play_award(self, award, overlay):
        """The award banner and its extra celebration beats."""
        _, title, _subtitle, tier = award
        if overlay is None or self.hud is None:
            return
        banner = getattr(overlay, 'achievement', None)
        if banner is None:
            return
        from ui import theme
        base_scale = theme.TYPE['title']
        self.motion.cancel(tag='award')

        def pop(progress):
            if progress <= 0.0:
                return
            env = ease.ramp(progress, (0.0, 0.0), (0.45, 1.16), (1.0, 1.0))
            _set_glow_alpha(banner, min(1.0, progress * 2.4))
            banner.scale = base_scale * env

        self.motion.tween(MOTION.award_in_time, pop, easing=ease.OVERSHOOT,
                          delay=0.30, tag='award', celebrate=True)
        self.strips.spike(1.0)

        # A perfect game gets the full light show: two extra beats of confetti
        # and a lane flash, spaced so the moments read one after another.
        beats = celebrate.achievement_event_count(tier)
        if beats <= 1:
            return
        script = [wait(MOTION.award_in_time * 0.5)]

        def beat(tier=tier):
            self.hud.confetti(
                count=max(24, celebrate.achievement_confetti(tier) // 3))
            if MOTION.allow_flash():
                self.flash.trigger(colors=(GOLD, CYAN), count=1, each=0.11,
                                   alpha=0.22 * MOTION.master_intensity)
            self.strips.spike(1.0)

        for _ in range(beats - 1):
            script.append(call(beat))
            script.append(wait(0.6))
        self.motion.timeline(script, tag='award_beats')

    def bind_overlays(self, pause=None, results=None):
        """Give the overlays their entrance animations."""
        if pause is not None:
            pause.animate_in = self.animate_pause_in
        if results is not None:
            results.animate_in = self.animate_results_in

    # ------------------------------------------------- overlay entrances
    def animate_pause_in(self, overlay):
        """Pause: the panel scales in from 0.95 while the backdrop dims."""
        panel = getattr(overlay, 'panel', None)
        backdrop = getattr(overlay, 'backdrop', None)
        if panel is None:
            return
        base = (float(panel.scale[0]), float(panel.scale[1]))
        base_position = (panel.position[0], panel.position[1])
        base_alpha = _alpha_of(backdrop) if backdrop is not None else 0.0
        backdrop_rgb = _rgb_of(backdrop) if backdrop is not None else (0, 0, 0)
        start = 1.0 if MOTION.reduce_motion else MOTION.pause_panel_from

        def enter(progress):
            scale = ease.lerp(start, 1.0, progress)
            panel.scale = (base[0] * scale, base[1] * scale)
            panel.position = (base_position[0], base_position[1], panel.z)
            if backdrop is not None:
                backdrop.color = rgba(backdrop_rgb,
                                      base_alpha * (0.4 + 0.6 * progress))

        self.motion.cancel(tag='overlay')
        self.motion.tween(MOTION.pause_dim_time, enter, easing=ease.STANDARD,
                          tag='overlay')

    def animate_results_in(self, overlay):
        """Game end: the panel grows out of the top bar and the score counts."""
        panel = getattr(overlay, 'panel', None)
        if panel is None:
            return
        aspect = _aspect()
        width = max(0.10, float(panel.scale[0]))
        height = max(0.05, float(panel.scale[1]))
        final_x, final_y = panel.position[0], panel.position[1]
        start_w, start_h = width * 0.24, 0.055
        start_x = aspect / 2.0 - 0.16 - start_w / 2.0
        start_y = 0.5 - 0.048 - final_y
        if MOTION.reduce_motion:
            start_w, start_h = width, height
            start_x, start_y = final_x, final_y

        def expand(progress):
            panel.scale = (ease.lerp(start_w, width, progress),
                           ease.lerp(start_h, height, progress))
            panel.position = (ease.lerp(start_x, final_x, progress),
                              ease.lerp(start_y, final_y, progress), panel.z)

        self.motion.cancel(tag='overlay')
        self.motion.tween(MOTION.end_expand_time, expand,
                          easing=ease.OVERSHOOT, tag='overlay',
                          celebrate=True,
                          on_complete=lambda: self._count_final(overlay))
        if self.hud is not None:
            # The celebration scales with the award (see MotionDirector.
            # onGameEnd): a perfect game rains, an ordinary match sprinkles.
            self.hud.confetti(
                count=celebrate.achievement_confetti(self._award_tier))

    def _count_final(self, overlay):
        """Count the final score up, large, over the results panel."""
        text = getattr(overlay, 'total_score', None)
        total = getattr(overlay, 'total', None)
        if text is None or total is None:
            return
        glow = getattr(overlay, 'total_glow', None)
        start = _int_of(text.text) or 0

        def set_value(value):
            text.text = str(value)
            if glow is not None:
                glow.text = str(value)

        def pulse(progress):
            env = ease.ramp(progress, (0.0, 0.0), (0.5, 1.0), (1.0, 0.0))
            if glow is not None:
                glow.color = rgba(CYAN, 0.35 * env)
            scale = base_scale * (1.0 + 0.06 * env)
            text.scale = scale
            if glow is not None:
                glow.scale = scale

        from ui import theme
        base_scale = theme.TYPE['hero']
        text.scale = base_scale
        self.motion.tween(MOTION.end_count_time, pulse, easing=ease.STANDARD,
                          tag='end_count', celebrate=True)
        self.motion.count_up(start, total, MOTION.end_count_time, set_value,
                             easing=ease.STANDARD, tag='end_count',
                             celebrate=True)

    def onPause(self, paused):
        """The pause overlay: dim the background (fired from ``Game.pause``).

        The panel's own scale-in is the overlay's ``animate_in`` hook, which
        runs from ``PauseOverlay.show``.
        """
        if self.hud is None:
            return
        if paused:
            self.vignette.hold(MOTION.pause_dim_alpha)
        else:
            self.vignette.clear()

    def onPhysicsPanel(self, visible):
        if self.hud is not None:
            self.hud.set_physics_visible(visible)

    # ==================================================================
    # Result choreography (section 5)
    # ==================================================================
    def _play_result(self, style, pins, frame_index=None, streak=1):
        """Build and run the timeline for one result style.

        The card's choreography is one sequence for every style: it lands
        (slam / slide / drop), the sub-line slides in, the held card breathes,
        and it floats out. Only the size and the media around it change with
        the style and with the streak.
        """
        if self.parent is None:
            return
        spec = result_spec(style, pins, streak)
        card = self.cards.acquire()
        card.configure(spec['text'], spec['rgb'], spec['glow'], spec['scale'],
                       position=spec['position'], sub=spec['sub'])
        # A cancelled timeline never ran its own hide step: clear the other
        # card so no stale banner can sit behind this one.
        self.cards.hide_others(card)
        self.motion.cancel(tag='result')

        # --- the timeline -------------------------------------------------
        script = []
        if style == 'gutter':
            card.set_state(scale=1.0, alpha=0.0, dy=MOTION.gutter_drop,
                           sub_alpha=0.0)

            def step_in(progress):
                card.set_state(scale=1.0,
                               alpha=ease.clamp01(progress * 1.8),
                               dy=ease.lerp(MOTION.gutter_drop, 0.0, progress))

            script.append(tween_step(MOTION.result_in_time, step_in,
                                     easing=ease.STANDARD))

            def sag(progress):
                card.set_state(scale=1.0, alpha=1.0,
                               dy=ease.lerp(0.0, -MOTION.gutter_sag, progress))

            script.append(tween_step(spec['hold'] * 0.5, sag,
                                     easing=ease.STANDARD))
            script.append(wait(spec['hold'] * 0.5))
        else:
            card.set_state(scale=spec['slam_from'], alpha=0.0,
                           rotation=spec['rotate'], ring=0.0, sub_alpha=0.0)

            def step_in(progress, style=style, spec=spec, card=card):
                dx = dy = 0.0
                if style == 'spare':
                    # A spare slides in diagonally, the way the slash reads.
                    dx = MOTION.spare_slide_x * (1.0 - progress)
                    dy = MOTION.spare_slide_y * (1.0 - progress)
                # The shockwave is flash-like: it holds still under reduce
                # motion (the card itself still lands).
                ring = (ease.clamp01(progress * 1.05)
                        if spec['ring'] and MOTION.allow_flash() else 0.0)
                card.set_state(scale=ease.lerp(spec['slam_from'], 1.0, progress),
                               alpha=ease.clamp01(progress * 2.6),
                               rotation=ease.lerp(spec['rotate'], 0.0, progress),
                               dx=dx, dy=dy, ring=ring, sub_alpha=0.0)

            script.append(tween_step(spec['in_time'], step_in,
                                     easing=ease.OVERSHOOT, celebrate=True))
            # The hold may grow with the streak, but the card's whole life is
            # bounded so the next ball never plays behind a stale banner.
            hold_cap = max(0.20, MOTION.result_max_total - spec['in_time']
                           - MOTION.result_out_time)
            hold = max(0.12, min(spec['hold'], hold_cap))
            if spec['sub']:
                sub_time = min(MOTION.result_sub_time, hold * 0.45)

                def sub_in(progress, card=card):
                    card.set_state(scale=1.0, alpha=1.0, ring=0.0,
                                   sub_alpha=ease.clamp01(progress * 1.5),
                                   sub_dy=ease.lerp(-0.022, 0.0, progress))

                script.append(tween_step(sub_time, sub_in,
                                         easing=ease.STANDARD, celebrate=True))
                hold -= sub_time

            def breathe(progress, hold=hold, card=card):
                # The held card breathes rather than sitting dead still.
                if MOTION.allow_pulse():
                    phase = progress * hold / max(0.05,
                                                  MOTION.result_pulse_period)
                    wobble = MOTION.result_pulse_depth * math.sin(phase * math.tau)
                else:
                    wobble = 0.0
                card.set_state(scale=1.0 + wobble, alpha=1.0, ring=0.0,
                               sub_alpha=1.0)

            # The hold is a celebration (it may exceed the 0.6 s UI cap: a
            # turkey is meant to stay readable in slow motion).
            script.append(tween_step(max(0.05, hold), breathe,
                                     easing=ease.LINEAR, celebrate=True))

        def step_out(progress):
            card.set_state(scale=ease.lerp(1.0, 0.92, progress),
                           alpha=1.0 - progress,
                           dy=MOTION.result_float * progress,
                           sub_alpha=1.0 - progress)

        script.append(tween_step(MOTION.result_out_time, step_out,
                                 easing=ease.STANDARD, celebrate=True))
        script.append(call(card.hide))
        self.motion.timeline(script, tag='result')

        # --- the side effects, fired so they land with the text -----------
        if spec['flashes'] and MOTION.allow_flash():
            self.flash.trigger(colors=spec['flash_colors'],
                               count=spec['flashes'])
        if style == 'turkey':
            self.strips.lane_flash()
        else:
            self.strips.spike(0.6 if style == 'spare' else 1.0)
        if spec['shake']:
            self.shake.trigger(spec['shake'])
        self.particles.burst(spec['position'][0], spec['position'][1],
                             count=spec['particles'],
                             colors=(spec['rgb'], spec['glow'], WHITE),
                             speed=0.6, angle=math.pi / 2.0, gravity=-1.6,
                             life=1.2 if style == 'turkey' else 0.8)
        if style == 'gutter':
            self.vignette.trigger()
        if spec['dust']:
            # A 3D burst from the pin deck, per the spec.
            self.dust.burst((0.0, 0.35, 17.6), count=spec['dust'],
                            rgb=MAGENTA, speed=1.8)
        if self.hud is not None and frame_index is not None \
                and style in ('strike', 'turkey', 'spare'):
            self.hud.scoreboard.mark_stamp(frame_index)
        if self.hud is not None and style in ('strike', 'turkey', 'spare'):
            # The HUD's pin triangle answers too: a wave of accent light
            # sweeps it, back row first.
            self.hud.pins.celebrate(style)

    def _final_shimmer(self):
        """A gold shimmer sweeps across the final total."""
        if self.hud is None:
            return
        total = getattr(self.hud.hud, 'total_score', None)
        if total is None:
            return
        from ursina import window
        aspect = window.aspect_ratio
        self.sweep.trigger(rgb=GOLD, y=total.position[1], height=0.075,
                           time=MOTION.shimmer_time,
                           width=aspect * MOTION.shimmer_width,
                           alpha=0.42 * MOTION.master_intensity)

    # ==================================================================
    # Small helpers
    # ==================================================================
    def _log(self, *args):
        if MOTION.debug:
            print('[motion]', *args)


# ---------------------------------------------------------------------------
# Small colour / value readers (ursina colours are 0-1 floats)
# ---------------------------------------------------------------------------
# Award -> (main colour, glow colour), matching the hall's palette.
AWARD_COLOURS = {
    celebrate.ACHIEVEMENT_PERFECT: (GOLD, (255, 255, 255)),
    celebrate.ACHIEVEMENT_BEST: (AMBER, CYAN),
    celebrate.ACHIEVEMENT_WIN: (CYAN, MAGENTA),
}


def _award_colours(kind):
    return AWARD_COLOURS.get(kind, (WHITE, CYAN))


def _set_glow_alpha(entity, alpha, glow=None):
    """Fade a ``theme.glow_text`` root (its ``main`` and its halo copies)."""
    alpha = max(0.0, min(1.0, float(alpha)))
    main = getattr(entity, 'main', None)
    if main is not None:
        main.color = rgba(_entity_rgb(main), alpha)
    for copy in getattr(entity, 'copies', ()):
        copy.color = rgba(glow or _entity_rgb(copy), alpha * 0.40)


def _entity_rgb(entity):
    """Read an entity's colour back as a 0-255 RGB triple."""
    colour = getattr(entity, 'color', None)
    try:
        return (int(round(colour[0] * 255)), int(round(colour[1] * 255)),
                int(round(colour[2] * 255)))
    except (TypeError, IndexError):
        return (255, 255, 255)


def _rgb_of(colour):
    try:
        return (int(round(colour[0] * 255)), int(round(colour[1] * 255)),
                int(round(colour[2] * 255)))
    except (TypeError, IndexError):
        return (0, 0, 0)


def _alpha_of(colour):
    try:
        return float(colour[3])
    except (TypeError, IndexError):
        return 1.0


def _int_of(text):
    try:
        return int(str(text).strip())
    except (TypeError, ValueError):
        return 0


def _aspect():
    from ursina import window
    return window.aspect_ratio
