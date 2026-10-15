"""One place to tune the whole animation system.

``MOTION`` is a single mutable object (an instance of :class:`MotionConfig`)
that every effect in :mod:`motion` reads at the moment it runs, so a timing or
an intensity can be changed live from the console or a test:

.. code-block:: python

    from motion import MOTION
    MOTION.board_stagger = 0.02        # faster scoreboard reveal
    MOTION.reduce_motion = True        # no shake, no flashes, no pulses

The two easings from the design spec live here as well:

* ``MOTION.standard`` - ``cubic-bezier(0.22, 1.00, 0.36, 1.00)``: fast out,
  soft landing. The default for anything that moves.
* ``MOTION.overshoot`` - ``cubic-bezier(0.34, 1.56, 0.64, 1.00)``: pops and
  impacts (score pops, stamps, result text).

``MOTION.ui_max_duration`` encodes the house rule that no *UI feedback* may
run longer than 600 ms; celebratory moments (result cards, the game-end
score count, the shimmer sweep) are allowed to run past it and are marked with
``_long`` in their names.

This module imports nothing from the engine, so it can be read from the
physics layer, the tools and the tests without starting Ursina.
"""
import json

# House rule: UI feedback never exceeds this many seconds.
UI_MAX_DURATION = 0.6


class MotionConfig:
    """Every timing (seconds), distance (UI units / metres) and intensity."""

    # ------------------------------------------------------------------ easings
    # Tuples, not functions: ``motion.ease`` turns them into callables, and a
    # tuple can be printed, logged and tuned from settings.json.
    standard = (0.22, 1.00, 0.36, 1.00)      # fast out, soft landing
    overshoot = (0.34, 1.56, 0.64, 1.00)     # pops and impacts
    ease_in = (0.55, 0.06, 0.68, 0.19)       # the one "anticipation" curve
    ui_max_duration = UI_MAX_DURATION

    # ------------------------------------------------------------------- global
    reduce_motion = False        # disables shake, flashes and pulses
    master_intensity = 1.0       # multiplies every flash / shake / particle count
    particle_budget = 1.0        # scaled down automatically on slow machines
    quality_min_scale = 0.35     # the low-end floor for particle_budget
    slow_motion_enabled = True   # the optional strike slow-motion (independent
                                 # of reduce motion: it slows, never flashes)
    slow_motion_scale = 0.4      # time scale during it
    slow_motion_time = 0.30      # seconds it lasts
    debug = False                # print a line when a trigger fires

    # ------------------------------------------------------- scoreboard: reveal
    board_stagger = 0.040        # 40 ms between frames
    board_enter_time = 0.34
    board_enter_rise = 0.075     # UI units the frame falls from
    board_enter_alpha_from = 0.0

    # ------------------------------------------- scoreboard: active frame glow
    frame_pulse_period = 1.6     # the slow breathing loop
    frame_pulse_min = 0.30       # glow alpha at the bottom of the breath
    frame_pulse_max = 0.95
    frame_scale = 1.05           # active frame scale-up
    frame_switch_out = 0.20      # old glow fades out
    frame_switch_in = 0.25       # new highlight slides in
    frame_slide = 0.035          # UI units the new highlight slides from

    # ---------------------------------------------------- scoreboard: entries
    score_pop_time = 0.25        # number pops in 0.6 -> 1.15 -> 1.0
    score_pop_small = 0.60
    score_pop_big = 1.15
    score_flash_time = 0.20      # brief amber flash on the cell
    score_flash_gain = 0.55
    total_count_time = 0.50      # the cumulative total counts up
    mark_stamp_time = 0.34       # X and / stamp in
    mark_stamp_scale = 2.00      # from 2.0 ...
    mark_stamp_rotate = 8.0      # ... with a -8 degree settle
    mark_glow_time = 0.30        # the glow burst behind the stamp

    # ------------------------------------------------ scoreboard: celebrations
    final_pulse_scale = 1.10     # the last frame's larger pulse
    final_pulse_time = 0.50
    shimmer_time = 0.90          # gold sweep across the final total
    shimmer_width = 0.28         # fraction of the sweep width

    # ------------------------------------------------------ HUD: player card
    card_slide_time = 0.35       # panel slides in from the side
    card_slide_distance = 0.075
    pin_dim_time = 0.20          # knocked pin icons dim and shrink
    pin_dim_alpha = 0.30
    pin_dim_scale = 0.84
    pin_wave_stagger = 0.030     # reset pop, 30 ms apart
    pin_pop_time = 0.26
    pin_pop_scale = 1.30

    # -------------------------------------------------------- HUD: prompt text
    prompt_crossfade = 0.25      # text crossfade ...
    prompt_rise = 0.011          # ... with an 8 px upward drift
    prompt_pulse_period = 2.0    # "Ready to throw" invites action
    prompt_pulse_min = 0.75
    prompt_pulse_max = 1.00
    prompt_roll_fade = 0.18      # fades out entirely while rolling

    # ----------------------------------------------------------- HUD: power bar
    meter_fill_smoothing = 0.20  # per-frame catch-up of the fill
    meter_pulse_from = 0.999     # soft pulse near full power
    meter_pulse_period = 0.7
    meter_flash_time = 0.12      # white flash on release
    meter_fade_out = 0.20
    meter_fade_in = 0.12
    # The fill's colour ramp: cyan -> amber -> magenta.
    meter_colors = ((96, 226, 255), (255, 214, 130), (232, 72, 168))

    # ------------------------------------------------- pin drop pop-ups
    pinpop_time = 0.60           # a "+1 PIN!" pop lives this long
    pinpop_slam = 2.30           # ... slamming in from this scale
    pinpop_scale = 1.80          # resting scale for a single pin
    pinpop_scale_max = 2.60      # cap when several pins fall together
    pinpop_rise = 0.085          # UI units it floats up while fading
    pinpop_fade_at = 0.55        # fraction of the life where the fade starts
    pinpop_x = 0.115             # pops alternate this far either side of centre
    pinpop_y = -0.30             # below the ball's lane (over the approach)
    pinpop_jitter_x = 0.022      # so two pops never land exactly on top
    pinpop_jitter_y = 0.012
    pinpop_step_y = 0.020        # consecutive pops sit a little higher
    pinpop_drift = 0.030         # ... and spray outwards as they rise
    pindrop_shake_px = 0.55      # camera thud per pin that fell
    pindrop_shake_max = 2.60
    pindrop_dust = 3             # 3D sparks per pin drop

    # ------------------------------------------------------------ result bursts
    result_in_time = 0.40        # scale 0.3 -> 1.0, overshoot
    result_slam_time = 0.24      # the card's punch-in
    result_slam_scale = 2.35     # ... from this scale (a slam, not a fade)
    result_slam_rotate = 4.0     # degrees of rotate-and-settle
    result_pulse_period = 1.05   # the held card breathes
    result_pulse_depth = 0.035
    result_sub_gap = 0.105       # UI units under the main line (the sub-line)
    result_sub_time = 0.28       # sub-line slide-in
    result_ring_time = 0.45      # the impact ring expanding behind the card
    result_ring_scale = 1.90
    result_plate_alpha = 0.40    # the soft dark band behind the card
    result_max_total = 1.85      # a card's whole life (in + hold + out), so a
                                 # long streak cannot run into the next ball
    result_hold = 0.90
    result_out_time = 0.35
    result_float = 0.055         # UI units it floats up as it fades
    result_flash_time = 0.12     # per screen-edge flash
    result_flash_alpha = 0.30
    strike_flashes = 3           # cyan / magenta alternating
    strike_shake_px = 6.0
    strike_shake_time = 0.40
    strike_particles = 42
    strike_dust = 10
    spare_shake_px = 3.0
    spare_particles = 16
    spare_slide_x = 0.075        # slash text slides in diagonally
    spare_slide_y = 0.030
    spare_sub_text = 'CLEANED UP'
    gutter_drop = 0.30           # text drops in from above
    gutter_sag = 0.028           # ... and sags
    gutter_vignette = 0.34       # the soft low-pass "thud"
    gutter_vignette_time = 0.50
    pins_rise = 0.075            # "7 PINS" floats up from the deck
    turkey_flashes = 5
    turkey_particles = 96
    turkey_hold = 1.30
    turkey_text = 'TURKEY!'

    # ------------------------------------------------- combo / progression
    combo_intensity_step = 0.35  # media growth per consecutive strike
    combo_intensity_max = 2.00   # the cap (turkey and beyond stop growing)
    combo_hold_bonus = 0.22      # extra hold per streak step, capped
    combo_hold_max = 0.55

    # ----------------------------------------------------------------- impact
    impact_soft_speed = 4.60     # below this the hit earns no shake
    impact_reference_speed = 8.60  # the speed that earns the full treatment
    impact_shake_min = 1.40      # px at the soft threshold
    impact_shake_max = 6.50      # px at the reference speed
    impact_flash_min_intensity = 0.72   # below: dust and shake only
    impact_flash_alpha = 0.16    # a hard hit's brief edge flash
    impact_ring_time = 0.42      # the 3D shockwave at the deck
    impact_ring_size = 0.85      # metres (before the impact scale)

    # --------------------------------------------------------------- 3D: neon
    strip_period_min = 3.0       # ambient breathe, per strip (offset phases)
    strip_period_max = 5.0
    strip_floor = 0.35           # brightness at the bottom of the breath
    strip_ceiling = 0.95
    strip_spike = 1.55           # brightness multiplier spiked by a strike
    strip_spike_decay = 1.35     # 1/s
    glow_breathe_depth = 0.18    # the pin glow behind the pins
    glow_breathe_period = 2.6
    glow_surge = 1.35            # surge when pins are hit
    glow_surge_decay = 1.7

    # ------------------------------------------------------ 3D: ball and pins
    trail_alpha_min = 0.06
    trail_alpha_max = 0.58
    trail_scale = 1.0
    dust_puff_release = 7        # sparks on release
    dust_puff_impact = 12        # sparks on pin impact
    dust_life = 0.55

    # ----------------------------------------------------------- 3D: camera
    deck_fov = 54.0              # 60 -> 54 as the ball nears the pins
    deck_fov_time = 0.60
    camera_shake_decay = 2.6     # 1/s
    # 6 px of shake at 720p is about 3.6 cm of world offset at the pin deck
    # (see docs/ANIMATION.md), so pixel amplitudes convert through this.
    shake_metres_per_px = 0.006

    # -------------------------------------------------------- 3D: pin reset
    sweeper_time = 0.42          # the bar lowers and clears
    sweeper_height = 0.95
    drop_stagger = 0.035         # pins rise back, staggered
    drop_height = 0.55
    drop_time = 0.28

    # -------------------------------------------------------- 3D: aim guide
    guide_dash_count = 14
    guide_dash_length = 0.36     # metres
    guide_dash_gap = 0.30
    guide_flow_speed = 2.4       # metres/second the dashes march
    guide_alpha = 0.42
    guide_arrow_pulse = 0.30     # subtle pulse on the lane arrows
    guide_arrow_period = 2.2
    guide_fade_out = 0.15        # released: the guide fades over 150 ms

    # ------------------------------------------------------------ transitions
    pause_dim_alpha = 0.55
    pause_dim_time = 0.25
    pause_panel_from = 0.95      # menu panel scales in from 0.95
    pause_panel_time = 0.28
    panel_slide_time = 0.28      # physics panel in/out
    panel_slide_distance = 0.62
    sweep_time = 0.35            # frame-change light sweep
    sweep_width = 0.30           # fraction of the screen
    sweep_alpha = 0.30

    # ------------------------------------------------------------- game end
    end_expand_time = 0.45       # scoreboard expands to centre
    end_count_time = 1.20        # final score counts up, large
    end_confetti = 120           # celebratory neon confetti
    end_confetti_life = 2.2
    end_results_delay = 1.45     # before the buttons appear
    # The award banner on the results panel (see motion/celebrate.py): only the
    # best one that applies is shown, and its tier decides the celebration size.
    perfect_text = 'PERFECT GAME!'
    perfect_sub_text = 'Twelve strikes - a 300.'
    best_text = 'NEW PERSONAL BEST!'
    best_sub_text = 'Your best game yet.'
    win_text = 'YOU WIN!'
    win_sub_text = 'The match is yours.'
    award_in_time = 0.42         # the banner pops in
    award_pulse_period = 1.2
    award_pulse_depth = 0.06
    perfect_confetti = 260       # particles for the biggest celebration
    best_confetti = 170
    win_confetti = 120
    perfect_flashes = 5
    best_flashes = 3
    win_flashes = 2

    # ------------------------------------------------------------- API helpers
    def to_dict(self):
        """Every knob as a plain dict (for logging, tools and tests)."""
        data = {}
        for name in dir(self):
            if name.startswith('_') or callable(getattr(self, name)):
                continue
            data[name] = getattr(self, name)
        return data

    def load(self, values):
        """Apply a mapping of overrides (unknown keys are ignored).

        Read-only computed keys (``motion_scale`` and friends, which
        ``to_dict`` includes) are skipped, so ``load(config.to_dict())`` is a
        safe round trip and not an exception.
        """
        for key, value in dict(values).items():
            if isinstance(getattr(type(self), key, None), property):
                continue
            if hasattr(self, key):
                setattr(self, key, value)
        return self

    def snapshot(self):
        return json.dumps(self.to_dict(), indent=2, default=str)

    # ----------------------------------------------------------- reduce motion
    @property
    def motion_scale(self):
        """``1.0`` normally, ``0.0`` when reduce motion is on."""
        return 0.0 if self.reduce_motion else 1.0

    def allow_shake(self):
        """Shake is a vestibular trigger: off under reduce motion."""
        return (not self.reduce_motion) and self.master_intensity > 0.0

    def allow_flash(self):
        """Flashes follow the same rule as shake."""
        return (not self.reduce_motion) and self.master_intensity > 0.0

    def allow_pulse(self):
        """Breathing / pulsing loops are off under reduce motion."""
        return not self.reduce_motion

    def scaled_count(self, count):
        """A particle count, clamped to the current quality and intensity."""
        value = int(round(count * self.particle_budget * self.master_intensity))
        return max(1, value) if count > 0 else 0


# The one shared instance every module reads (see the module docstring).
MOTION = MotionConfig()
