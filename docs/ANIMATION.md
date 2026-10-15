# The animation system

This document describes the neon-alley motion layer: what it is made of, how to
tune it, and - most importantly - **where to hook each trigger**. It follows
the design brief section by section, so the spec and the code can be read side
by side.

Everything is original code built on the engine's own primitives; nothing is
copied from another product, and the game ships no new assets (the effect
textures are painted at start-up, like the lane wood).

## 1. The shape of it

```
motion/
  config.py    MOTION: every timing, intensity and toggle in one object
  ease.py      the shared easing set (the spec's two cubic-beziers + helpers)
  tween.py     Tween / Timeline / Motion - the reusable tween utility
  celebrate.py the wording and the escalation rules (pure): combo labels,
               "+1 PIN!" pop text, the impact scale, the end-of-match awards
  gfx.py       generated effect textures (edge glow, band, soft dot, ring)
  effects.py   pooled UI effects: flashes, particles, pop-ups, pin pops,
               sweeps, shake, result cards
  score_fx.py  the scoreboard's animation state (reveal, glow, pop, stamp)
  hud_fx.py    HUD widgets: prompt, key chips, power meter, pin icons, cards
  scene_fx.py  the 3D layer: neon strips, pin glow, ball trail, sweeper,
               aim guide, dust, impact shockwaves
  director.py  MotionDirector - the trigger API the game calls
```

Two layers, deliberately:

* **engine-free** (`config`, `ease`, `tween`, `celebrate`, `score_fx`) - pure
  Python, unit tested in milliseconds by `tests/test_motion.py` and
  `tests/test_celebrate.py`;
* **engine-bound** (`gfx`, `effects`, `hud_fx`, `scene_fx`, `director`) - only
  touched in the offscreen integration tests `tests/test_motion_runtime.py`
  and `tests/test_motion_feedback.py`.

The HUD keeps owning its layout; the motion layer only *perturbs* it (an
offset, a scale multiplier, an alpha), applied after the layout has run. That
is why a window resize mid-animation cannot desync anything, and why the HUD
still works unchanged if the motion layer is absent.

## 2. One config object

`motion.config.MOTION` is a single mutable object. Every effect reads it at the
moment it runs, so it can be tuned live:

```python
from motion import MOTION
MOTION.board_stagger = 0.02          # faster scoreboard reveal
MOTION.strike_particles = 80         # a bigger strike burst
MOTION.master_intensity = 0.6        # calmer flashes and shakes everywhere
MOTION.reduce_motion = True          # no shake, no flashes, no pulses
```

The two easings are the spec's, as tuples so they can be printed and tuned:

| Name | Curve | Used for |
| --- | --- | --- |
| `MOTION.standard` | `cubic-bezier(0.22, 1.00, 0.36, 1.00)` | everything that moves, slides or fades |
| `MOTION.overshoot` | `cubic-bezier(0.34, 1.56, 0.64, 1.00)` | score pops, stamps, result cards |

`MOTION.ui_max_duration` is the house rule (0.6 s): a new tween is capped to it
unless the caller marks the animation a celebration (`celebrate=True`), which
is how the result cards, the shimmer and the game-end count are allowed to run
longer while everything else obeys the cap.

The main knobs, by feature:

| Feature | Keys |
| --- | --- |
| Scoreboard reveal | `board_stagger` (40 ms), `board_enter_time`, `board_enter_rise` |
| Active frame | `frame_pulse_period` (1.6 s), `frame_pulse_min/max`, `frame_scale` (1.05), `frame_switch_out/in`, `frame_slide` |
| Score entry | `score_pop_time` (250 ms), `score_pop_small/big`, `score_flash_time/gain`, `total_count_time` (500 ms) |
| Marks | `mark_stamp_time`, `mark_stamp_scale` (2.0), `mark_stamp_rotate` (8°), `mark_glow_time` |
| Final frame / total | `final_pulse_scale`, `final_pulse_time`, `shimmer_time/width` |
| Player card | `card_slide_time` (350 ms), `card_slide_distance`, `indicator_crossfade`, `indicator_rise` |
| Pin icons | `pin_dim_time` (200 ms), `pin_dim_alpha/scale`, `pin_wave_stagger` (30 ms), `pin_pop_time/scale` |
| Prompt text | `prompt_crossfade` (250 ms), `prompt_rise` (8 px), `prompt_pulse_period` (2 s), `prompt_pulse_min/max`, `prompt_roll_fade` |
| Controls bar | `chip_stagger` (60 ms), `chip_enter_time/rise`, `chip_press_time/scale`, `bar_idle_alpha` (0.30), `bar_idle_scale`, `bar_idle_after_throws` (3), `bar_dim_time` |
| Power meter | `meter_fill_smoothing`, `meter_pulse_from/period`, `meter_flash_time`, `meter_fade_in/out`, `meter_colors` (cyan → amber → magenta) |
| Result moments | `result_in_time`, `result_hold`, `result_out_time`, `result_float`, `result_flash_time/alpha`, `strike_flashes/shake_px/particles`, `spare_*`, `gutter_*` (drop, sag, vignette), `pins_rise`, `turkey_*` |
| Pin-drop pops | `pinpop_time/slam/scale/scale_max/rise/fade_at/x/y/jitter_x/jitter_y`, `pindrop_shake_px/max`, `pindrop_dust` |
| Result slam | `result_slam_time/scale/rotate`, `result_pulse_period/depth`, `result_sub_gap/time`, `result_ring_time/scale`, `result_plate_alpha`, `result_max_total` |
| Combo / progression | `combo_intensity_step/max`, `combo_hold_bonus/max`, `spare_sub_text` |
| Impact | `impact_soft_speed`, `impact_reference_speed`, `impact_shake_min/max`, `impact_flash_min_intensity/alpha`, `impact_ring_time/size` |
| Awards (game end) | `perfect_text/sub_text`, `best_text/sub_text`, `win_text/sub_text`, `award_in_time`, `award_pulse_*`, `perfect/best/win_confetti`, `perfect/best/win_flashes` |
| Neon strips | `strip_period_min/max`, `strip_floor/ceiling`, `strip_spike`, `strip_spike_decay` |
| Pin glow | `glow_breathe_depth/period`, `glow_surge`, `glow_surge_decay` |
| Ball | `trail_alpha_min/max`, `trail_scale`, `dust_puff_release/impact`, `dust_life` |
| Camera | `deck_fov` (54°), `deck_fov_time` (600 ms), `shake_metres_per_px` |
| Pin reset | `sweeper_time/height`, `drop_stagger`, `drop_height`, `drop_time` |
| Aim guide | `guide_dash_count/length/gap`, `guide_flow_speed`, `guide_alpha`, `guide_arrow_pulse/period`, `guide_fade_out` (150 ms) |
| Transitions | `pause_dim_alpha/time`, `pause_panel_from/time`, `panel_slide_time/distance`, `sweep_time/width/alpha` |
| Game end | `end_expand_time`, `end_count_time`, `end_confetti`, `end_confetti_life` |
| Performance | `particle_budget`, `quality_min_scale`, `master_intensity`, `debug` |

`MOTION.to_dict()` / `MOTION.load({...})` make the whole set easy to log or
drive from a tool.

## 3. Where to hook the triggers

The single object the game talks to is `game.motion` (a `MotionDirector`),
created in `Game.__init__` (``game/play.py``):

```python
self.motion = MotionDirector(hud=self.hud, ball=self.ball, pins=self.pins)
self.motion.bind_overlays(pause=self.pause_overlay,
                          results=self.results_overlay)
set_shake_provider(self.motion.camera_shake)   # scene/camera.py
```

Then, in the game loop:

| Trigger | Where it is called | What it does |
| --- | --- | --- |
| `onMatchStart(input_mode, throws)` | `Game.start_match` (after `set_view('game')`) | scoreboard reveal (staggered, 40 ms), player-strip slide-in, pin rack reset, meter reset |
| `onThrowRelease(throw, power)` | `Game.launch` (after `self._play('release')`) | power meter flashes white and fades, aim guide fades over 150 ms, dust puff at the foul line, the pin tally is armed |
| `onPinDrop(count, delta)` | `MotionDirector.update` (the live pin watcher, only while `rolling`/`settling`) | a "+1 PIN!" / "+n PINS!" pop low on the lane (consecutive pops alternate sides and climb), a small camera thud (capped) and dust when several fall together |
| `onShotHit(position, style, speed)` | `Game._advance_roll` (the ball crosses into the deck) and `Game._motion_roll_recorded` | dust and glow, the FOV push-in; at the result, the strike extras (lane spike, slow motion) scaled by the speed the ball arrived at |
| `onPinImpact(position, speed)` | `Game._advance_roll` (the deck records its first contact) | the true impact thud: camera shake and a 3D shockwave scaled by the speed, an edge flash for a very hard hit |
| `onScoreEntry(frame_index, cell_total, official, mark)` | `Game._motion_roll_recorded` (from `_resolve_roll`) | number pop + amber flash on the cell, cumulative count-up, `X` / `/` stamp, top-right total count-up |
| `onPinsResolved(pins, style, position, frame_index)` | `Game._motion_roll_recorded` | the big result moment: STRIKE / SPARE / GUTTER / n PINS DOWN! / TURKEY card (slam in, ring, sub-line, breath, float out), edge flashes, camera shake, particles, the pin-triangle wave, vignette, lane-light flash |
| `onFrameAdvance(frame, previous)` | `Game._motion_roll_recorded` when the scorer moved on | horizontal light sweep, new active frame, tenth-frame celebration + gold shimmer |
| `onFrameChange(frame)` | `Game._enter_ready` | moves the active-frame highlight |
| `onPinReset(standing, full)` | `Game._enter_ready` (after the rack is reset) | sweeper bar lowers and clears, pins drop back in staggered (30 ms, back row first) |
| `onGameEnd(total, start_from, overlay, won, best, perfect, previous)` | `Game._finish_match` | the results panel expands out of the top-bar score block, the final score counts up large, confetti falls sized by the award, and a `PERFECT GAME!` / `NEW PERSONAL BEST!` / `YOU WIN!` banner pops in with extra celebration beats |
| `onPause(paused)` | `Game.pause` / `Game.resume` | dims (and vignettes) the background over 250 ms; the panel itself scales in from 0.95 via the overlay's `animate_in` hook |
| `onPhysicsPanel(visible)` | `Game.toggle_physics_panel` | slides the physics readout in from the right edge with a fade |
| `update(dt, ball, pins, state, meter)` | `Game._update_motion` (end of `Game.update`, and in the paused branch) | steps every tween, timeline and pooled effect; watches the rack for pin drops; also degrades the particle budget on slow machines |
| `update_aim_guide(dt, active, ...)` | inside `_update_motion` (via `Game._update_aim_indicator`) | marching dashes + pulsing arrows, faded out when the throw begins |
| `slow_motion_scale()` | `Game._advance_roll` / the settling branch | 0.4× feed for 300 ms from the true pin contact (physics only; the deck's fixed sub-steps keep the outcome identical) |
| `camera_shake()` | `scene/camera.py::update_camera` (registered through `set_shake_provider`) | decaying 6 px-equivalent offset, applied on top of the smoothed camera |

### What each celebration is made of

Everything reads :mod:`motion.celebrate`, so the words and the escalation live
in one place and the director only plays them:

| Moment | The effect |
| --- | --- |
| A pin falls | `+1 PIN!` (amber, cyan glow, dark outline) slams in at 2.3× and floats up over 0.6 s; consecutive pops alternate sides and climb, so a rack falling pin by pin reads as a run of stamps; a capped camera thud; dust when several fall together |
| Several pins together | `+n PINS!` (the pop grows with the count) |
| 1-9 pins counted | `n PINS DOWN!` (8-9 pins adds the shockwave ring and a bigger burst); 1 pin reads `1 PIN DOWN!` |
| Spare | `SPARE` with the `CLEANED UP` sub-line, a diagonal slide-in and a cyan flash |
| Gutter | `GUTTER` drops in, sags, and the frame vignettes (no flash, no shake) |
| Strike | `STRIKE!` slams in from 2.35× with a rotation settle, a ring expands behind it, then the card breathes and floats out; edge flashes, particles, shake, the pin triangle answers with a wave, and the simulation slows from the true contact |
| 2nd strike | the `DOUBLE!` sub-line (slide-in under the main line) and more flashes/particles/shake |
| 3rd strike | `TURKEY!`, the lane lights flash in sequence, 96 particles, 5 flashes, the longest hold |
| 4th+ strike | the sub-line names the streak (`FOUR-BAGGER!`, `5 IN A ROW!` ...) and the media keeps its escalated size (capped by `combo_intensity_max`) |
| Hard hit | the shake, the dust and the deck shockwave scale with the ball's speed; above `impact_flash_min_intensity` a brief edge flash |
| Perfect game (300) | `PERFECT GAME!` banner in gold, 260 confetti (in front of the panel), 5 edge flashes and two extra celebration beats |
| Personal best | `NEW PERSONAL BEST!` (amber) with the score it beat, 170 confetti, one extra beat |
| A won match | `YOU WIN!` with 120 confetti |

The pin pops are the only *always-on* effect: they are small, they live over
the deck area (never over the result card, the status line or the physics
readout) and they fade on their own. Everything bigger than that is reserved
for spares, strikes, streaks and the end of a match.

The only other hooks are two one-liners:

* `Game._update_avatar` calls `_sync_ball_in_hand()`: while the player holds the
  ball (mouse drag / webcam swing) the lane ball is hidden and the character
  holds it, as the brief asks;
* `Game._advance_roll` calls `fov_push_in()` the first time the ball passes
  `config.PIN_CAMERA_TRIGGER_Z`, and `_enter_ready` calls `fov_reset()`.

If your own loop is not `game/play.py`, the contract is small: create one
`MotionDirector`, call `director.update(dt, ...)` once a frame, and call the
triggers when your own events happen. Nothing else about the game changes.

## 4. Reduce motion

`MOTION.reduce_motion` is wired to the `reduce_motion` setting (Settings →
**REDUCE MOTION**, persisted in `settings.json`) and is pushed into the system
by `App.apply_settings()`:

* **shake** - `ShakeBuffer.trigger` refuses to start;
* **flashes** - `FlashFX`, the neon strip spikes, the lane-light sequence and
  the pin-glow surge all refuse to start;
* **pulses** - the active-frame breath, the prompt's invitation pulse, the
  arrow pulse, the strip breathing and the meter's near-full pulse all hold a
  constant value instead of oscillating;
* the slow motion on a strike is **not** part of reduce motion (it slows the
  simulation rather than shaking or flashing); turn it off with
  ``MOTION.slow_motion_enabled = False`` if it is unwanted;
* entrances, crossfades, slides and count-ups still run (they carry meaning,
  and they are not vestibular triggers), but the overshoot curves are dropped
  where they would pop (the score pop becomes a plain scale-up, the stamp
  starts at rest).

Particles are not disabled under reduce motion (they are not a vestibular
trigger), only made cheaper by the automatic budget; a player who wants calmer
effects can lower `MOTION.master_intensity`, which scales flashes, shakes and
particle counts together.

## 5. Performance rules

* **UI animates transform and opacity only** - no layout property (no
  re-fitting text mid-animation, no alpha-driven relayout). Text is only
  re-measured when its string changes, through the existing `ui.layout`
  cache.
* **Everything is pooled**: particles (220 UI + 64 world), result cards (2),
  trail markers (52), dust puffs - all created once and re-used.
* **Particle counts degrade automatically**: the director measures the frame
  time once a second and walks `MOTION.particle_budget` down towards
  `quality_min_scale` (0.35) on a machine that cannot hold 60 fps, and back up
  when there is headroom.
* **Colour writes are change-guarded** where they would otherwise churn the
  attribute system (the scorecard, the pin icons, the power meter).
* **One clock**: every tween is stepped by one `Motion.update(dt)` call, so
  there is no per-effect update loop to keep in sync.

## 6. Spec section → code map

| Brief | Implemented by |
| --- | --- |
| 1. Scoreboard reveal / active frame / entry / stamps / final | `motion/score_fx.py::ScorecardMotion` (`start_reveal`, `set_active`, `score_entry`, `mark_stamp`, `final_frame`), applied in `ui/scorecard.py::Scorecard.update` |
| 2. Player card / HUD | `motion/hud_fx.py::HudMotion` (player-strip slide, `PinIcons`) |
| 3. State prompt | `motion/hud_fx.py::CrossfadeText` + `HudMotion.set_prompt` (crossfade, 8 px drift, pulse, hidden while rolling) |
| 4. Input feedback | `motion/hud_fx.py::PowerMeter` (the drag power bar; the key-cap row was removed - the HUD is wordless) |
| 5. Result moments | `motion/director.py::MotionDirector._play_result` + `motion/effects.py::ResultCardPool`, `PopTextPool`, `FlashFX`, `ParticlesFX`, `VignetteFX` |
| 6. 3D scene | `motion/scene_fx.py` (`NeonStrips`, `PinGlow`, `BallTrail`, `DustPuffs`, `ImpactRings`, `RackResetFX`, `AimGuide`) + `scene/camera.py` (shake, FOV) + `avatar/character.py` (breathing) |
| 7. Transitions / menus | `MotionDirector.onPause` / `animate_results_in` / `onPhysicsPanel` / `_play_award`, `motion/effects.py::SweepFX`, `ui/overlays.py` entrances (with the award banner) |
| 8. Feedback wording / escalation | `motion/celebrate.py` (labels, pop text, impact scale, awards), unit tested by `tests/test_celebrate.py` |
| 8. Performance / config / triggers | sections 2-5 of this document |

## 7. Verification

* `python -m pytest tests/test_motion.py -q` - 33 pure unit tests: the easing
  curves, tween delay/loop/cancel, timelines, count-ups, reduce motion, the
  config object and the whole scoreboard state machine (reveal, breathing
  highlight, pop, stamp, count-up, final pulse).
* `python -m pytest tests/test_celebrate.py -q` - 29 fast tests of the feedback
  rules: the pin pop text, the combo labels (`DOUBLE!`, `TURKEY!`,
  `FOUR-BAGGER!`, `n IN A ROW!`), the impact scale, the end-of-match awards and
  the result specs the director plays.
* `python -m pytest tests/test_motion_runtime.py -q` - 16 offscreen integration
  tests: every trigger driven through the real play screen, including the
  paused branch, the meter, the chips, the pin wave and the game-end count.
* `python -m pytest tests/test_motion_feedback.py -q` - 16 offscreen
  integration tests of the feedback pass: the live pin pops (and that they are
  gone before the next roll), the roll summary text and its ring, the strike
  slam + the streak sub-lines, the impact scaling (hard vs soft), the
  pin-triangle wave, the personal-best and perfect-game awards, a bounded
  high-streak card, reduce motion staying calm, and that a new match clears
  every effect.
* `python tools/motion_check.py` - the same walk-through with printed state,
  for eyeballing while tuning (it also prints the pin pops, the impact scale
  and the award tier).
* `python tools/feedback_tour.py` - renders the new feedback moments to PNGs
  (pin pops, the roll summary, STRIKE!, DOUBLE!, TURKEY!, FOUR-BAGGER!, the
  gutter, and the results screen with each award) for inspection.
* Visual checks were rendered with the real window and inspected
  (`docs/screens*` style tours): the scoreboard reveal, the active-frame glow,
  a STRIKE result, the paused menu, the results expansion and the counted
  final score.
* `python smoke_motion.py` - the same walk-through with printed state, for
  eyeballing while tuning.

### Known limitations

* **The pause "blur" is a dim, not a real blur.** Panda's `CommonFilters`
  refuses to attach to this window setup ("Could not find appropriate
  DisplayRegion to filter"), so the pause dims the background and darkens the
  rim (a vignette) over 250 ms instead. Set `MOTION.pause_dim_alpha` to taste.
* **The character's throw is pose-driven**, not keyframed: the wind-up, swing,
  release and follow-through come from the existing pose blend plus the live
  `swing_pose` from the drag (or the webcam), with breathing added in idle. A
  scripted animation clip would be a larger change to `avatar/character.py`.
* **Slow motion only scales the physics feed** (the ball and pin integration),
  not the rendered clock, so the HUD and UI keep full speed - which is what
  keeps the result card readable during it.
* Particle counts are a *budget*, not a promise: on a slow machine the bursts
  are smaller by design (section 5).
