# Hells Balls webcam swing and release detection

This document describes how the webcam input turns tracked body landmarks
into a bowling throw, which measurements it trusts, and what it deliberately
does *not* claim to measure. It reflects `input/swing.py`,
`input/webcam_input.py` and the `SWING_*` constants in `config.py`.

The detector is heuristic. A single frontal webcam estimates *image-relative*
body motion; it does not measure real-world speed, depth, or the ball's spin.
`input.webcam_input.event_to_throw` maps the recognized gesture onto the same
`ThrowData` the mouse produces, and the existing physics engine takes over
from there. No physical quantity is fabricated: launch angle is always 0 and
hook spin is 0 unless `SWING_SPIN_SCALE` is explicitly enabled (see §6).

## 1. Coordinate conventions

* MediaPipe landmarks are normalized image coordinates: `x` in `0..1` to the
  right, `y` in `0..1` downward. A *backswing* (hand moving down/back) has
  positive `y` velocity; a *forward swing* (forward and up) has negative.
* The detector measures every hand position **relative to the mid-shoulder
  point**: `dx = hand.x - shoulder_x`, `dy = hand.y - shoulder_y`. Torso
  motion (leaning, stepping, drifting in frame) cancels out; it is a
  reference, never a throwing control.
* Displacements (backswing depth, release rise, the release plane, the ready
  band) are divided by the player's own shoulder-to-hip distance, so they are
  fractions of torso height and survive different camera distances and player
  sizes. Speeds stay in *image heights per second* (hand displacement dt),
  because a 2D camera cannot give metres.
* Velocity uses the measured interval between processed camera frames
  (monotonic clock), never an assumed constant frame rate.

## 2. Hand measurement and smoothing

The hand position for each arm is:

1. the wrist landmark, when its visibility is at least
   `SWING_WRIST_VISIBILITY`, otherwise
2. the mean of the visible hand landmarks (index, pinky, thumb), otherwise
3. `None` (no sample this frame - no position is invented).

Positions are smoothed with an exponential moving average
(`SWING_LANDMARK_SMOOTHING`) before differentiation; the resulting velocity is
smoothed again (`SWING_VELOCITY_SMOOTHING`). Switching between wrist and hand
samples resets the velocity baseline so the switch itself cannot create a
spike. Raw per-frame speed is kept alongside the smoothed value and is used
for the "is the player still?" ready check, where smoothing could otherwise
hide a fast wobble.

The elbow landmark is not interpolated or used to invent a missing wrist; it
is validated against the same jump/speed limits as the hand (§3), so a
glitching elbow chain is rejected even when the wrist happens to stay put.
An elbow angle is deliberately *not* required for a release: a bent-arm
throw must remain possible.

## 3. Rejected frames

A frame is treated as untrustworthy (state preserved, velocities reset) when:

| Condition | Constant |
| --- | --- |
| No pose, or no landmarks | - |
| Mean confidence below the limit | `SWING_MIN_CONFIDENCE` |
| Shoulders/hips not visible | `SWING_WRIST_VISIBILITY` |
| Torso smaller than the sanity floor | `SWING_MIN_TORSO_HEIGHT` |
| Torso landmark jumped between frames | `SWING_MAX_TORSO_JUMP` |
| Camera gap longer than the limit | `SWING_MAX_FRAME_GAP` |
| Hand or elbow jumped more than the limit in one frame | `SWING_MAX_JUMP` |
| Implausible hand or elbow speed | `SWING_MAX_SPEED` |

Unreliable frames suspend recognition: after `SWING_LOST_GRACE_FRAMES`
consecutive unreliable frames an in-flight swing is aborted and must be
started again. A rejected hand jump additionally aborts an in-flight swing
immediately. A tracking failure is never treated as evidence of a release,
and the ball state is untouched (the game only consumes throw data while it
is waiting for a roll).

## 4. Gesture state machine

`input.swing.SwingDetector` implements the six conceptual states:

| Milestone state | `SwingDetector.phase` | Meaning |
| --- | --- | --- |
| A: READY | `ready` | armed; can be held indefinitely (no timeout) |
| B: BACKSWING | `backswing` | deliberate back/down movement detected |
| C: FORWARD SWING | `forward` | release conditions are evaluated |
| D: RELEASE | `SwingEvent` | returned exactly once by `update()` |
| E: FOLLOW-THROUGH | `follow_through` | no further throws until reset |
| F: RESET | `waiting` | must hold the ready pose again to re-arm |

Transitions:

* `waiting -> ready`: every visible hand is below chest height
  (`SWING_READY_BELOW_SHOULDER`), raw speed below `SWING_READY_MAX_SPEED`,
  held for `SWING_READY_HOLD`. Timeouts never leave this state.
* `ready -> backswing`: smoothed downward hand speed at least
  `SWING_BACK_DOWN_SPEED`.
* `ready -> forward` (short swing): a strong upward stroke straight from the
  ready pose (at least `SWING_DIRECT_THROW_SPEED`). Real backswings are often
  hidden behind the body, so the forward stroke alone is accepted - provided
  it passes the same release gates below.
* `backswing -> forward`: depth at least `SWING_BACK_MIN_DEPTH`, at least
  `SWING_BACK_MIN_TIME` elapsed, and upward speed at least
  `SWING_FORWARD_UP_SPEED`.
* `backswing -> waiting`: no forward swing within `SWING_BACK_TIMEOUT`.
* `forward -> follow_through`: the release conditions are met (below).
* `forward -> waiting`: no release within `SWING_FORWARD_TIMEOUT`.
* `follow_through -> waiting`: after `SWING_FOLLOW_TIME`.
* `waiting -> ready` again requires a fresh `SWING_READY_HOLD`.

The `ready -> waiting` edge has hysteresis (`SWING_READY_GRACE_TIME`): a brief
wobble does not drop the armed state, but a sustained loss of the ready pose
does. This stops tracking noise from oscillating the phase.

## 5. Release conditions (state D)

A release fires inside `forward` only when **all** of these hold:

1. at least `SWING_FORWARD_MIN_TIME` has elapsed since entering the state;
2. at least `SWING_RELEASE_MIN_FRAMES` frames showed real upward motion
   (raw speed >= `SWING_FORWARD_UP_SPEED`);
3. the hand rose at least `SWING_RELEASE_MIN_RISE` torso heights above its
   lowest point in this stroke;
4. the peak upward speed reached `SWING_RELEASE_MIN_SPEED`;
5. **and** either
   * the hand crossed the release plane (`SWING_RELEASE_FRACTION` of a torso
     below the shoulders) while moving up at least `SWING_RELEASE_UP_SPEED`;
   * or the stroke peaked (smoothed speed fell to half the peak) after
     condition 4.

Condition 5-or lets a soft toss that peaks below the plane still count,
while conditions 1-4 stop one-frame spikes, slow lifts and small wiggles
from producing a throw. After a release the ball cannot be steered by the
hand: the game launches the ball through `BallPhysics` and the player must
return to the ready pose for the next roll.

These are *motion* gates, not *intent* gates. A symmetric two-arm raise, a
casual arm lift or a tracking flicker can satisfy them; the 2026-10-16
accidental-throw investigation found exactly that (recorded jumping-jacks
footage released a ball through the direct path). In the browser build a
release recognized by this phase machine is therefore still checked by the
deliberate-swing validator below before it becomes a throw. The Python
detector's own behaviour is unchanged (it remains the parity reference).

## 5a. Deliberate-swing validation (browser)

`src/input/validate.js` (`SwingValidator`) sits between the detector and
`ThrowData` creation in the browser build. It records every processed frame
(the detector's post-frame hand positions, upward deltas, phase, validity)
and only accepts a release when **all** of these hold:

1. **Tracked throughout the critical window.** Every camera frame in the last
   `SWING_VALIDATE_CRITICAL_TIME` (0.35 s) before the release is valid (pose
   present, confidence above `SWING_MIN_CONFIDENCE`, sane frame interval),
   with at least `SWING_VALIDATE_MIN_CRITICAL_FRAMES` frames in it. A release
   can never ride on stale data, a confidence spike or tracking loss.
2. **Reliable stroke window.** At least `SWING_VALIDATE_MIN_VALID_RATIO`
   (80 %) of the last `SWING_VALIDATE_WINDOW` (0.9 s) is valid, with no more
   than `SWING_VALIDATE_MAX_INVALID_RUN` consecutive unreliable frames
   anywhere in it.
3. **Sustained upward progression.** At least `SWING_VALIDATE_MIN_UP_FRAMES`
   frames moved the throwing hand up at `SWING_VALIDATE_UP_SPEED` or faster,
   the last one within `SWING_VALIDATE_RECENT_UP_TIME` of the release, and the
   measured peak is at least `SWING_VALIDATE_MIN_PEAK`. A stalled stroke
   cannot release.
4. **Positional evidence.** Measured from the same played-back positions the
   detector differentiated, scaled by torso height: the hand must rise at
   least `SWING_VALIDATE_MIN_RISE`, and the stroke must either be preceded by
   a visible backswing of `SWING_VALIDATE_MIN_BACKSWING` or be an
   exceptionally strong direct stroke (`SWING_VALIDATE_DIRECT_PEAK` and
   `SWING_VALIDATE_DIRECT_RISE`).
5. **One-arm dominance.** The other arm's measured upward motion must stay
   below both `SWING_VALIDATE_OTHER_UP_ABS` and the throwing arm's motion
   divided by `SWING_VALIDATE_DOMINANCE` (and the same for its net rise), so
   two-arm exercise cannot ride the throwing arm's trajectory.
6. **One acceptance per ready cycle.** After an accepted throw, a
   waiting/ready frame must be observed again before another release counts.

A refusal aborts the detector back to `waiting` with a player-readable notice
("no backswing - swing your arm back, then forward", "both arms moved together
- throw with one arm", "tracking was interrupted just before the release"),
counts in `WebcamInput.status().blocked_count`, and logs one `console.debug`
line (`SWING_VALIDATE_LOG_BLOCKED`). The game input layer additionally never
steps the detector with a repeated or rewound camera frame
(`SWING_VALIDATE_MAX_STALE_FRAMES` consecutive stale frames reset the swing),
never inherits a swing across a camera restart (the service numbers its
sessions and the input resets on a change), an arm switch, `setGameReady`, or
a transition back from mouse mode.

Calibration (the `SWING_VALIDATE_*` block in `src/config.js`): synthetic
one-arm swings (straight, slow, fast, both hooks, wrist-occlusion fallback,
repeated swings, arm switch) release exactly once each; recorded
jumping-jacks/burpees footage - which the phase machine does recognize - is
refused; recorded waving never arms at all. A direct (no visible backswing)
stroke needs a genuinely fast, large delivery; everything slower must show
the backswing, which is the movement a frontal camera sees in a real bowling
swing. `tools/js_tests.mjs` covers the whole matrix (stillness, idle sway,
repositioning, slow/fast waving, leaning, walking, landmark jumps, low
confidence, missing torso landmarks, tracking loss, loss+recovery, stale
frames, camera restart, arm switch, mouse->webcam return, duplicate
prevention, hooks and swing intensity).

## 6. Mapping to physics

`event_to_throw` (the single calibration point):

* **speed** = peak upward hand speed * `SWING_SPEED_SCALE`, clamped to the
  same `MIN_THROW_SPEED`/`MAX_THROW_SPEED` as mouse throws;
* **lateral position** = body centre at release, mirrored like the on-screen
  feed (`WEBCAM_MIRROR`), scaled by `WEBCAM_AIM_SCALE` and clamped to the
  lane;
* **launch angle** = 0 (a frontal camera cannot measure it);
* **hook spin** = 0 by default. When `SWING_SPIN_SCALE` is non-zero, the
  measured sideways hand speed at release is scaled like the mouse drag -
  a documented heuristic, not a measured spin axis.

The resulting `ThrowData` goes through the same `Ball.launch` ->
`BallPhysics.launch` path as a mouse throw; the physics layer never learns
which device produced it.

## 7. Calibration and the throwing arm

There is no separate calibration screen and no per-throw ritual. The
detector calibrates itself continuously:

* the ready-stillness check establishes the player's comfortable starting
  pose and baseline hand height before every throw;
* torso-relative units make the thresholds independent of camera distance.

Two practical adjustments are available:

* **Throwing arm**: `C` in webcam mode cycles `auto -> right -> left ->
  auto`; `auto` accepts whichever arm performs the gesture. The selected arm
  is shown in the HUD and in `WebcamStatus.arm`.
* **Thresholds**: tune the `SWING_*` block in `config.py`
  (defaults are starting heuristics, not universal calibration).

The player can stand in one place; power comes from the arm swing relative
to the shoulders, not from stepping or leaning.

## 8. Diagnostics

The normal player HUD (webcam chip) shows only player-facing information:
tracking state, the current gesture phase, the selected throwing arm and the
next-action hint. Engine details (GPU/CPU delegate, fps, frame time,
inference time, confidence percentage, per-frame telemetry) are not part of
normal play.

Developer diagnostics live behind an explicit toggle: **Settings → DEVELOPER
DIAGNOSTICS** (setting `debug_diagnostics`, off by default). With it on, the
physics readout (`H`) prepends the webcam engine/phase/release lines, the
blocked-release counter and the last rejection/validation reason; the same
values are on `WebcamInput.status()` and blocked releases are logged to the
console. Turning the toggle off clears the readout immediately, so no
diagnostic text can linger on any screen.

`webcam_swing.log` records phase transitions, releases (arm, peak speed and
the mapped ball speed/lateral), and rejected frames with their reason
(landmark jumps, tracking loss, bad timing). Set `SWING_LOG_VERBOSE = True`
to additionally log per-frame telemetry every `SWING_LOG_EVERY_FRAMES`
processed frames; leave it off for normal play so the log stays small.

## 9. Known limitations

* A frontal webcam cannot measure camera-relative depth, real-world speed,
  launch angle, or the ball's spin axis. Speed is an image-relative
  heuristic; `SWING_SPEED_SCALE` is the place to calibrate it per setup.
* Left/right body-motion ambiguity: with `auto`, whichever arm performs the
  gesture is treated as the throwing arm. Select an arm to fence off the
  other one.
* A deliberate, fast forward/up arm stroke from a still ready pose can be
  accepted as a short throw when it is genuinely fast and large (the direct
  fallback in §5a). Slower arm raises and continuous smooth waving are
  rejected. This is the residual ambiguity of a single frontal camera; an
  explicit backswing always has priority.
* `SWING_MAX_JUMP` is a per-frame displacement limit. On a very slow camera
  (below roughly 15 processed frames/s) the fastest swings can exceed it and
  be rejected as tracking jumps; keep the capture rate up or raise the limit
  on such setups.
* Thresholds have been validated with synthetic landmark sequences, recorded
  real-person footage (jumping jacks and waving as negative cases) and a
  hardware sanity check (camera + model + idle run); a real deliberate
  bowling swing in front of a live camera has still not been recorded in
  this repository, so the positive calibration rests on the synthetic
  one-arm swings.

## 10. The browser build

`src/input/swing.js` is this detector, ported unchanged (same constants from
`src/config.js`, same smoothing, same phase machine). What differs is the
runtime around it:

* **Pose inference runs in a worker** (`src/input/pose_worker.js`), the
  browser counterpart of `tracking/service.py`'s worker thread. The render
  thread grabs one frame per *new* camera frame as an `ImageBitmap` and
  transfers it to the worker, which owns the MediaPipe landmarker and posts
  the results back, so pose detection never stalls the game. If the worker
  cannot be created or the model cannot load there, the identical engine runs
  on the main thread, paced by `video.currentTime` polling; a worker that dies
  mid-session also falls back, so webcam mode never degrades to mouse-only
  because of the engine. The delegate in use is published in the snapshot
  (`GPU (worker)`, `CPU`, ...) and shown in the developer diagnostics readout,
  never in the normal player HUD.
* **Frame timestamps, not render frames, drive the detector.** Every snapshot
  carries `frame_time` (the capture time of the frame it came from); the
  input steps the detector with the delta between the camera frames it is
  fed, exactly the interval a velocity estimate needs, even when the display
  runs faster than the camera or the engine drops frames under load.
* **Parity is tested**, not assumed: `tools/webcam_parity_dump.py` records the
  Python detector's per-frame state and releases for recorded and synthetic
  sequences, `tools/webcam_parity_run.mjs` replays the identical landmarks
  through the browser detector, and `tools/webcam_parity_compare.mjs` diffs
  the two (smoothed positions, velocities, lateral velocity, hand-source
  switches, phases, release frames, throw parameters). `tools/js_tests.mjs`
  runs the same comparison in CI-style form.
* **The deliberate-swing validator** (`src/input/validate.js`, §5a) is what
  turns a recognized release into a throw in the browser; the raw detector
  stays parity-true. The full 16-sequence parity diff therefore still reports
  0 mismatches *and* the jumping-jacks trace is refused by the input layer
  (asserted in `tools/js_tests.mjs` with `detector.release_count >= 1` and
  `blocked_count >= 1`).
