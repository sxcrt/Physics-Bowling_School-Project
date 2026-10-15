# The feedback pass: pinfalls, strikes, streaks and awards

This pass makes the *moment* of a roll feel like an arcade sports game: every
pin that falls is announced, a strike or a spare is a screen event, streaks
escalate, and the end of a match celebrates what was actually achieved. It
changes **presentation only** - the simulation, the scoring, the controls and
every mode rule are untouched.

The design rules it follows:

* **readability first** - the result type is layered (dark plate, halo, glow
  copies, near-black outline, accent sub-line) so it reads over the bright lane;
* **reserved celebration** - ordinary rolls get pin pops and a small thud; the
  big flashes, shakes, shockwaves and confetti are reserved for spares,
  strikes, streaks, wins, personal bests and a perfect game;
* **nothing outlives its moment** - every effect is pooled, timed, cancelled on
  a new match, and sized so it cannot run into the next ball;
* **reduce motion still works** - shake, flashes, shockwaves and the
  pin-triangle wave refuse to start; entrances, crossfades and the pop text
  still run (they carry the information).

## What is on screen now

| Moment | Feedback |
| --- | --- |
| A pin falls | a `+1 PIN!` pop slams in at 2.3x and floats up over 0.6 s (amber type, cyan glow, dark outline, slight rotation settle); consecutive pops alternate sides and climb; plus a capped camera thud |
| Several pins together | `+n PINS!`, the pop growing with the count, plus deck dust |
| 1-9 pins counted | `1 PIN DOWN!` / `n PINS DOWN!`; 8-9 pins adds a shockwave ring and a bigger particle burst |
| Spare | `SPARE` slides in diagonally with a `CLEANED UP` sub-line, one cyan edge flash, particles |
| Gutter | `GUTTER` drops in, sags and vignettes the frame (no flash, no shake) |
| Strike | `STRIKE!` slams in from 2.35x with a rotation settle and an expanding ring, breathes, then floats out; cyan/magenta edge flashes, particles, shake, a wave across the HUD pin triangle, and the simulation slows from the true contact |
| 2nd strike | a `DOUBLE!` sub-line and more flashes/particles/shake |
| 3rd strike | `TURKEY!`, the lane lights flash in sequence, 96 particles, 5 flashes, the longest hold |
| 4th+ strike | the sub-line names the streak (`FOUR-BAGGER!` ... `n IN A ROW!`); the media keeps its escalated size (capped) |
| Hard hit | the camera shake, the deck dust and the 3D shockwave scale with the ball's speed; above a threshold a brief edge flash |
| Perfect game (300) | `PERFECT GAME!` in gold with 260 confetti in front of the results, 5 edge flashes and two extra celebration beats |
| Personal best | `NEW PERSONAL BEST!` with the score it beat, 170 confetti and an extra beat |
| Won match | `YOU WIN!` with 120 confetti |

The live pin pops are the only always-on effect. They sit low on the lane
(under where the ball rolls), never over the result card, the status line or
the physics readout, and consecutive pops alternate sides so they stay
readable even when a whole rack falls.

## Where the code lives

| File | What changed |
| --- | --- |
| `motion/celebrate.py` | **new, engine-free**: the pop text, the combo labels (`DOUBLE!`, `TURKEY!`, `FOUR-BAGGER!`, `n IN A ROW!`), the streak escalation, the impact scale and the end-of-match awards - all in one testable place |
| `motion/config.py` | new knobs: `pinpop_*`, `pindrop_*`, `result_slam/pulse/sub/ring/plate/max_total`, `combo_*`, `impact_*`, `perfect/best/win_*`, `award_*`; `load()` now skips read-only properties so `to_dict()` round-trips |
| `motion/effects.py` | `ResultCard` grew a dark plate, a near-black outline, a shockwave ring and a sub-line; new `PopText` / `PopTextPool`; the game-end confetti now falls in front of the results panel; new `ring()` texture use |
| `motion/gfx.py` | `ring()` - a generated shockwave texture |
| `motion/scene_fx.py` | `ImpactRings` - flat shockwave rings on the deck, scaled by the hit |
| `motion/hud_fx.py` | the pin triangle's celebration wave (`PinIcons.celebrate`), cleared on a new match; the HUD particle pool is larger so a perfect game's shower fits |
| `motion/director.py` | `onPinDrop` (the live pin watcher in `update`), `onPinImpact` (the true contact), the strike/spare media now scales with the streak and the impact, the new result choreography, the award banner and its beats in `onGameEnd` |
| `game/play.py` | passes the ball's speed to the impact hooks, detects the deck's true first contact, and decides the award (`won` / `best` / `perfect`) with a session best per mode |
| `ui/overlays.py` | the results panel grew the award banner (with room reserved so the table never overlaps it) |
| `ui/theme.py` | `set_glow_colours()` to re-tint a glow-text banner |

## How to see it

```
python -m pytest tests/test_celebrate.py -q         # the rules (fast)
python -m pytest tests/test_motion_feedback.py -q   # the FX, offscreen
python tools/motion_check.py                        # printed state of every trigger
python tools/feedback_tour.py                       # PNGs of every new moment
```

`tools/feedback_tour.py` writes the pin pops, the roll summary, the strike, the
double, the turkey, the four-bagger, the gutter and the results screen (with a
personal best and a perfect game) to PNGs so the effects can be inspected
without playing.
