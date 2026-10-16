# Input: mouse, webcam and the bot

All three input paths produce the **same** launch data,
`input.mouse_input.ThrowData`:

| Field | Meaning | Unit |
| --- | --- | --- |
| `lateral_position` | release position across the lane | m (0 = centre) |
| `launch_angle` | yaw away from straight ahead | rad |
| `speed` | release speed | m/s |
| `spin_omega` | hook spin about the line of travel | rad/s |
| `source` | `'mouse'`, `'webcam'`, `'bot'` or `'script'` | - |
| `confidence` | 1.0 for a direct input, the tracking confidence for webcam | 0-1 |

`Ball.launch(throw)` is the single entry point into the simulation, so nothing
downstream can tell - or needs to know - which device produced a throw.

## Mouse (always available)

| Control | Effect |
| --- | --- |
| Mouse X | aim: sweeps the point the ball is sent at across the lane at the targeting arrows (4.572 m down the lane, capped at +/-2 deg of yaw) |
| `A` / `D` (or arrows) | release position across the lane (position, not direction) |
| Hold left button, drag back then forward, release | throw; the fastest forward stroke sets the speed (2-12 m/s) |
| The stroke's **direction** | release direction: a stroke that drifts left releases left (capped at +/-2 deg) |
| The stroke's **sideways speed** | hook spin (capped at +/-5 rad/s): the ball slips sideways at release and friction curves it |

The aim is drawn on the lane as a line from the ball along the intended
direction, and it is frozen while the drag is held, so the release direction
is exactly what the player lined up. Aim is applied as a real launch angle:
the ball travels laterally *because* of its velocity, not because a position
was copied, and the hook is friction acting on the release slip (see
`docs/PHYSICS.md`). The intended line is **not** a prediction: the hook bends
the real path, and a fading trail on the lane records the path the ball
actually took.

A release is registered only when the drag covered `MIN_DRAG_DISTANCE` (0.04
screen heights) *and* the fastest forward stroke reached `MIN_THROW_SPEED`
(2.0 m/s), so a twitch cannot launch the ball.

### Position, direction and curvature are separate

This is deliberate, and the tests pin it down:

* **position** - `A`/`D` sets `lateral_position`, where the ball starts;
* **direction** - the pointer sets the aim point at the arrows, which becomes
  `launch_angle` (and the stroke's own direction adds to it);
* **curvature** - the stroke's sideways speed becomes `spin_omega`, which the
  simulation turns into a curved path through the release slip.

### Release noise

`input.mouse_input.ReleaseNoise` can perturb the release angle, speed and spin
by small bounded amounts from a seeded generator. It is **off by default**
(`config.RELEASE_NOISE_*` are all 0.0), because variation is supposed to come
from the player's own drag; a test can set a seed to make a noisy release
reproducible. It never touches the pin count.

### Pointer tracking

`input/pointer.py` keeps the UI pointer from three sources: ursina's pointer
when Panda3D reports a mouse, Panda3D's window pointer when it moves, and the
operating-system cursor as a last resort. Without that fallback a window that
never receives pointer events reports `(0, 0)` for both axes - the centre of
the screen - so every click lands in the middle of the window and every drag
records zero speed (that was the "menu buttons do nothing" bug).

## Webcam

`tracking/` captures frames and runs MediaPipe's pose landmarker. The shipping
recognizer is the temporal classifier (`input/classifier.py`, ported from
`src/input/classifier.js`), which owns the release decision;
`input/webcam_input.py` maps its recognized `SwingEvent` onto `ThrowData`.
The older `input/swing.py` phase machine remains the low-level motion sensor
and parity reference.

A throw needs a deliberate motion:

```
tracking -> ready -> (backswing ->) forward -> release -> follow_through
         -> rearm -> ready
```

* `tracking`: reliable, still tracking with both hands low; the reason the
  ready pose is not established is shown to the player.
* `ready`: armed; a settled down/back stroke starts a backswing, or a fast
  forward/up stroke throws directly (the common real-world delivery with no
  separate wind-up).
* `forward` / `release`: the release needs a sustained rise above the stroke's
  low point, a real peak speed and several frames of real upward motion, so a
  wave or a one-frame spike cannot fire it; a direct delivery must rise
  further and faster than a wind-up delivery.
* `follow_through` / `rearm`: no further throw until the player returns to the
  ready pose.

Guards: per-joint visibility, a confidence floor, a per-frame landmark jump
limit (a single glitch frame is resynced, not fatal), a brief tracking-dropout
bridge, a frame-timing check, and one-arm dominance. Everything is logged to
`webcam_swing.log` (phase transitions, rejected frames and every release).

What the camera can and cannot measure:

| Quantity | How the game gets it | Honest label |
| --- | --- | --- |
| Release speed | peak upward wrist speed in image heights/s x `SWING_SPEED_SCALE` | **estimate** from tracked motion |
| Release position | body centre x at release, mirrored | measurement (scaled) |
| Aim yaw | release hand's cross-body offset x `SWING_AIM_SCALE` | **heuristic** from a measured offset |
| Hook spin | sideways hand speed at release x `SWING_SPIN_SCALE` | **heuristic** from a measured offset |
| Ball speed at the pins | from the simulation | simulated |

A frontal webcam cannot measure depth, the ball's direction or its spin axis,
so those three are documented heuristics derived from measured landmark
motion - not claims of measurement. The point being measured (a hand) is also
not the point being simulated (a ball released by that hand).

If the camera cannot be opened, or tracking fails, the play screen reports it
and switches to mouse controls, which are always available.

## Turn handoff (multi-player)

Between players the game enters `handoff`: the detector is suspended
(`set_game_ready(False)`), any queued throw is discarded and the previous
player's swing state is cleared (the detector is reset).

* **Mouse**: the next player presses ENTER (or clicks) to take the turn. A
  stale drag cannot fire, because the input source is reset and its queue
  dropped.
* **Webcam**: tracking must be stable for `HANDOFF_STABLE_TIME` (0.6 s) and the
  next player must hold the still ready pose for `HANDOFF_CONFIRM_TIME`
  (1.2 s), with a progress bar; ENTER always works as a fallback, and the
  handoff gives up after 25 s so a camera problem can never wedge the match.

## Hand menu navigation (experimental, off by default)

Settings can enable a hand-driven menu cursor: the tracked wrist moves a
cursor and a one-second dwell clicks whatever is under it, with visible dwell
progress. It is deliberately separate from bowling: the swing detector is only
armed by the play screen while it waits for a throw, so a menu gesture can
never throw a ball. It is off by default because it has not been verified on
real camera hardware (see the development report).
