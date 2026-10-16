# Hells Balls webcam swing and release detection

This document describes how the webcam input turns tracked body landmarks into
a bowling throw in the browser build (and the equivalent path in the desktop
build), which measurements it trusts, and what it deliberately does *not*
claim to measure. It reflects `src/input/classifier.js` /
`input/classifier.py`, `src/input/swing.js` / `input/swing.py` (the legacy
motion sensor), `src/input/webcam.js` / `input/webcam_input.py`, and the
`CLASSIFIER_*` / `SWING_*` constants in `src/config.js` / `config.py`.

A single frontal webcam estimates *image-relative* body motion; it does not
measure real-world speed, depth, or the ball's spin. `event_to_throw` maps the
recognized gesture onto the same `ThrowData` the mouse produces, and the
existing physics engine takes over from there. No physical quantity is
fabricated: launch angle is always 0 and hook spin is 0 unless
`SWING_SPIN_SCALE` is explicitly enabled (see §7).

## 1. Two layers, and why the original one was not enough

The original detector (`src/input/swing.js`, a byte-parity port of
`input/swing.py`) recognizes *motion*. It is deliberately sensitive: a fast
upward arm stroke from a still pose, even with no backswing, releases through
its "direct throw" path. The recorded jumping-jacks/burpees footage in
`tools/testdata/` releases through it in both languages, and that release was
historically used as the *expected reference* because the fixture was
mislabeled as a recorded arm swing. Python/JavaScript parity therefore passed
while the behaviour was wrong - agreement between two implementations is not
correctness.

The shipping decision layer is now the **temporal movement classifier**
(`src/input/classifier.js`, ported to `input/classifier.py`). It requires the
whole movement sequence instead of isolated velocity thresholds:

```
tracking -> ready -> backswing -> forward -> release -> follow_through
         -> rearm -> ready -> ...
```

The legacy phase machine remains exported, tested and parity-checked as the
low-level motion sensor it is (and for the desktop build's history); it is no
longer the release authority in either build.

## 2. Coordinate conventions and normalization

* MediaPipe landmarks are normalized image coordinates: `x` in `0..1` to the
  right, `y` in `0..1` downward. A *backswing* (hand moving down/back) has
  positive `y` velocity; a *forward swing* (forward and up) has negative.
* Hand positions are measured **relative to the arm's own shoulder** and
  divided by the player's shoulder-to-hip distance. All distances in the
  classifier are therefore *torso heights* and all speeds are *torso heights
  per second*: camera distance, player size and body translation cancel. When
  the hips are out of frame (a close camera) the last hip-to-shoulder height
  is reused for `CLASSIFIER_TORSO_REF_HOLD` seconds, and if the hips have
  never been seen the scale falls back to shoulder width x
  `CLASSIFIER_SHOULDER_TORSO_RATIO`, so a player who cannot fit their whole
  torso on screen can still bowl.
* Elbow positions are measured the same way; the elbow chain keeps a stroke
  alive when the wrist is occluded.
* Torso rotation is the shoulder line's angle (`atan2` of the right shoulder
  minus the left shoulder), and torso size is tracked over the stroke to
  reject collapses.
* Velocity uses the measured interval between processed camera frames
  (monotonic capture clock), never an assumed constant frame rate.

## 3. Hand measurement and smoothing

The hand position for each arm is the wrist landmark when its visibility is at
least `CLASSIFIER_WRIST_VISIBILITY`, else the mean of the visible hand
landmarks (index, pinky, thumb), else *nothing* - no position is invented.
Positions are smoothed with an EMA (`CLASSIFIER_POSITION_SMOOTHING`) before
differentiation, and the resulting velocity is smoothed again
(`CLASSIFIER_VELOCITY_SMOOTHING`). A wrist-to-hand source switch restarts the
velocity baseline so the switch itself cannot create a spike. Per-frame
position and speed limits (below) catch teleports. A rejected sample never
moves the machine and never invents a velocity; a sample that lands close to
the *previous rejected* position is accepted as a genuine fast move
(resync), a sample that lands close to the last accepted position is the
flip-back of a one-frame glitch, and anything else counts as a second jump.
Up to `CLASSIFIER_STROKE_MAX_JUMPS` resyncs are absorbed per stroke; further
glitches abort it.

## 4. Rejected frames and interruptions

A frame is untrusted (state preserved, velocities decayed) when any of these
hold:

| Condition | Constant |
| --- | --- |
| No pose, or no landmarks | - |
| Mean confidence below the limit | `CLASSIFIER_MIN_CONFIDENCE` |
| Shoulders not visible (the hips are optional) | `CLASSIFIER_TORSO_VISIBILITY` |
| Torso smaller than the sanity floor | `CLASSIFIER_MIN_TORSO_HEIGHT` |
| Shoulder midpoint jumped between frames | `CLASSIFIER_MAX_TORSO_JUMP` |
| Camera gap longer than the limit | `CLASSIFIER_MAX_FRAME_GAP` |
| Hand or elbow jumped/flew more than the limit | `CLASSIFIER_MAX_HAND_JUMP`, `CLASSIFIER_MAX_HAND_SPEED` |

Outside a stroke, up to `CLASSIFIER_MAX_INVALID_RUN` consecutive untrusted
frames are tolerated (the player can recover and re-establish the ready pose).
**Inside** a stroke the limit is `CLASSIFIER_STROKE_MAX_INVALID_RUN` (5 -
roughly 0.17 s at 30 fps): a brief dropout is bridged so a real swing is not
lost to it, while a longer interruption aborts the stroke to `rearm`, so
motion on either side of a real tracking gap can never be stitched into a
throw. The game input layer also
never steps the classifier with a repeated or rewound camera frame
(`SWING_VALIDATE_MAX_STALE_FRAMES` consecutive stale frames reset the swing),
and a camera restart (session number change), an arm switch, `set_game_ready`,
or a return from mouse mode resets the state.

## 5. The classifier state machine

| State | `phase` | Meaning |
| --- | --- | --- |
| TRACKING | `tracking` | waiting for reliable, still tracking with hands low |
| READY | `ready` | the ready pose held; a wind-up may start |
| BACKSWING | `backswing` | one arm descending/back after a settled ready pose |
| FORWARD | `forward` | sustained forward/up stroke; release gates evaluated |
| RELEASE | `release` | a throw was emitted (transient, `CLASSIFIER_RELEASE_FLASH`) |
| FOLLOW-THROUGH | `follow_through` | `CLASSIFIER_FOLLOW_TIME` |
| RE-ARMING | `rearm` | the ready pose must be re-established before another swing |

Transitions:

* `tracking -> ready`: every visible hand at/below
  `CLASSIFIER_READY_HAND_BELOW` torso heights below the shoulders, hand speed
  below `CLASSIFIER_READY_MAX_HAND_SPEED`, body speed below
  `CLASSIFIER_READY_MAX_BODY_SPEED`, held for `CLASSIFIER_READY_HOLD`, with at
  least `CLASSIFIER_TRACK_MIN_FRAMES` valid frames.
* `ready -> tracking`: the ready pose is lost for more than
  `CLASSIFIER_READY_GRACE`.
* `ready -> backswing`: one arm's hand (or, with the wrist hidden, its elbow
  chain) is in the ready band and descending at `CLASSIFIER_BACK_START_SPEED`
  or more, **and** that evidence source has been low for
  `CLASSIFIER_BACK_SETTLE_TIME`. This "settled before the wind-up" requirement
  is what stops the return stroke of an arm raise or a continuous one-arm pump
  from starting a *wind-up*: in those motions the hand left the ready band
  moments before the descent. (Their later rise may still qualify as a direct
  delivery - see below.)
* `ready -> backswing` is refused when both arms descend almost equally
  (`CLASSIFIER_SYMMETRY_START_RATIO`); the player is told once.
* `ready -> forward` (a **direct delivery**): one arm's hand, settled low,
  starts rising at `CLASSIFIER_DIRECT_START_SPEED` or more while still in the
  ready band. This is the common real-world throw: standing at the line with
  the arm hanging, one continuous forward/up swing, no separate wind-up. The
  direct stroke is held to a higher release bar (§6); both arms rising almost
  equally is refused exactly like a symmetric wind-up.
* `backswing -> forward`: depth at least `CLASSIFIER_BACK_MIN_DEPTH`, at least
  `CLASSIFIER_BACK_MIN_TIME`, and an upward reversal of at least
  `CLASSIFIER_BACK_REVERSAL_SPEED` (elbow-scaled when the wrist is hidden).
* `backswing -> ready`: the stroke reversed before it ever deepened (a shallow
  wind-up handing its rise to the direct path), or the hand returned to the
  band without a real stroke.
* `backswing -> rearm`: no reversal within `CLASSIFIER_BACK_TIMEOUT`.
* `forward -> release`: all gates in §6.
* `forward -> rearm`: timeout (`CLASSIFIER_FORWARD_TIMEOUT`), a throwing hand
  that vanished (with no visible elbow either) for longer than
  `CLASSIFIER_HAND_LOSS_GRACE`, or a definitive blocked gate in §6.
* `release -> follow_through -> rearm`: fixed holds, no further throws.
* `rearm -> ready`: a fresh `CLASSIFIER_READY_HOLD`, which is what guarantees
  one ball per physical swing.

## 6. Release gates (state FORWARD)

All base gates must hold, then every definitive gate must pass:

**Base (need to keep qualifying while the stroke continues):**

1. at least `CLASSIFIER_FORWARD_MIN_TIME` since the reversal;
2. at least `CLASSIFIER_FORWARD_MIN_RISING_RUN` *consecutive* rising frames
   (`CLASSIFIER_FORWARD_UP_SPEED` or faster) - a one-frame spike cannot pass;
3. the hand rose at least `CLASSIFIER_FORWARD_MIN_RISE` above the stroke's low
   point - or `CLASSIFIER_DIRECT_MIN_RISE` for a direct delivery, whose low
   point is the deepest position of the settled ready pose;
4. peak upward speed at least `CLASSIFIER_FORWARD_MIN_PEAK` - or
   `CLASSIFIER_DIRECT_MIN_PEAK` for a direct delivery;
5. **and** either the hand crossed `CLASSIFIER_RELEASE_HAND_HEIGHT` while still
   rising at `CLASSIFIER_RELEASE_UP_SPEED`, or the stroke visibly peaked
   (smoothed speed below half the peak).

**Definitive (a failure blocks the throw with a player-facing reason):**

6. a wind-up stroke actually had a backswing of `CLASSIFIER_BACK_MIN_DEPTH`
   (or was an occluded-chain stroke); a direct delivery needs no backswing;
7. the non-throwing arm stayed quiet: its measured activity is below
   `CLASSIFIER_DOMINANCE_RATIO` of the throwing arm's unless its peak is under
   `CLASSIFIER_OTHER_ARM_ABS`, with `CLASSIFIER_DOMINANCE_MAX_RATIO` as the
   hard reject - symmetric two-arm raises are exercise;
8. the body did not jump (`CLASSIFIER_MAX_BODY_LIFT`), collapse
   (`CLASSIFIER_MAX_TORSO_CHANGE`) or turn away (`CLASSIFIER_MAX_TORSO_TURN`);
9. the stroke did not stutter (`CLASSIFIER_MAX_REVERSALS` direction changes).

A blocked release counts in `blocked_count`, aborts to `rearm`, and shows its
reason in the HUD for `CLASSIFIER_NOTICE_TIME`.

## 7. Mapping to physics (unchanged)

`event_to_throw` (the single calibration point):

* **speed** = peak upward hand speed * `SWING_SPEED_SCALE`, clamped to the
  same `MIN_THROW_SPEED`/`MAX_THROW_SPEED` as mouse throws;
* **lateral position** = body centre at release, mirrored like the on-screen
  feed (`WEBCAM_MIRROR`), scaled by `WEBCAM_AIM_SCALE` and clamped to the
  lane;
* **launch angle** = `SWING_AIM_SCALE` * the release hand's cross-body offset,
  plus `SWING_RELEASE_DIR_SCALE` * its sideways speed, clamped to
  `MAX_LAUNCH_ANGLE`;
* **hook spin** = `SWING_SPIN_SCALE` * the measured sideways hand speed
  (`SPIN_SIGN`), clamped to `MAX_SPIN`; a frontal camera cannot measure the
  spin axis, so this stays a documented heuristic.

The resulting `ThrowData` goes through the same `Ball.launch` ->
`BallPhysics.launch` path as a mouse throw; the physics layer never learns
which device produced it.

## 8. Evaluation and evidence

The labeled evaluation harness is:

```
node   tools/webcam_eval.mjs --verbose --sweep 200   # browser classifier
node   tools/webcam_eval.mjs --export tools/webcam_eval_sequences.json
python tools/webcam_eval.py tools/webcam_eval_sequences.json   # Python port
```

The dataset (`tools/webcam_eval_data.mjs`) contains:

* **synthetic positives** (28 + 4): standard/slow/fast deliveries, deep and
  shallow backswings, a visible wind-up pause, bent-arm, left-arm, close and
  far cameras, moderate body sway, deterministic landmark noise, 15 fps,
  hidden wrist via the hand fallback, a fully occluded backswing carried by
  the elbow chain, a brief mid-delivery occlusion, long ready holds,
  hooks/cross-body, one-frame tracking gaps, moderate counterbalance from the
  other arm, whole-frame camera shake, borderline confidence, low-visibility
  wrist, swinging after exercise and after walking, a stuttered delivery, and
  three repeated swings with re-arming; plus the four **direct deliveries**
  (no-wind-up raises from the ready pose, incl. the scratch/pump motions) that
  the direct path accepts by design;
* **synthetic negatives**: standing still, idle sway, jumping-jacks cycles,
  burpees, waving, two-arm stretching, walking, stepping, leaning, torso
  twisting, bounded random fidgeting, rapid flicks, backswing without
  delivery, weak lifts, punch-downs, deep crouch deliveries, turning away,
  interrupted tracking, confidence dropouts, wrist identity flips, timestamp
  gaps;
* **recorded real-human negatives** (2): the Wikimedia jumping-jacks/burpees
  trace and the hand-waving trace (see `tools/testdata/README.md`). Both stay
  rejected: the exercise trace is caught by the two-arm dominance gate and the
  wave never builds a settled low start.

**There is no recorded genuine bowling footage in this repository.** Positive
recall therefore rests on synthetic sequences only; the recorded data covers
two negative motions. The report distinguishes the provenance tags and
`tools/webcam_eval.mjs --json` records them.

Measured result (both classifiers, same exported traces): precision 100 %,
recall 100 %, F1 100 % on 59 sequences (35 positives / 24 negatives); the
recorded exercise trace produces 0 releases in both classifiers (the legacy
sensor produces 1, documented in §1). A 200-seed sweep of bounded random
fidgeting produces 0 releases; an *unconstrained* random one-arm walk produced
a throw in 163/200 seeds. Those trajectories built a settled low pose plus a
sustained accelerating rise with no wind-up - a direct delivery by every
observable property. The classifier recognizes the movement sequence, not
intent, so a movement that reproduces the sequence throws; see §10.

The JavaScript and Python classifiers are each measured against these labels
independently. Parity tests (`tools/webcam_parity_*.mjs`, the
`webcam_parity_py.json` replay in `tools/js_tests.mjs`) still prove the
*legacy* detectors agree frame by frame - including their shared release on
the exercise footage - and are explicitly not used as a correctness claim.

## 9. Diagnostics

The normal player HUD shows only player-facing information: tracking state,
classifier state, the selected throwing arm, the current action hint, and the
most recent rejection reason ("no backswing - swing your arm back, then
forward", "both arms moved together - throw with one arm", "tracking was
interrupted - try again", ...). Engine details (GPU/CPU delegate, fps, frame
time, inference time, confidence percentage, per-frame telemetry) are not part
of normal play.

Developer diagnostics live behind **Settings → DEVELOPER DIAGNOSTICS**
(`debug_diagnostics`, off by default). With it on, the physics readout (`H`)
prepends the webcam engine state, classifier phase, hand-source, pose, depth,
rise, peak, blocked/stale counters, the last rejection and the last throw. The
same values are on `WebcamInput.status()` (`input.webcam_input.WebcamStatus` in
the desktop build), and blocked releases are logged once to the console
(`SWING_VALIDATE_LOG_BLOCKED`). The Python build keeps its `webcam_swing.log`
phase/release/rejection log (`SWING_LOG_ENABLED`).

## 10. Known limitations

* A frontal webcam cannot measure camera-relative depth, real-world speed,
  launch angle, or the ball's spin axis. Speed is an image-relative heuristic;
  `SWING_SPEED_SCALE` is the place to calibrate it per setup.
* **No recorded genuine bowling swing exists in this repository**, and the
  maintainers have no live camera in the automated environment: the positives
  are synthetic and a real deliberate bowling swing in front of a real camera
  has *not* been verified here. See `docs/WEBCAM_MANUAL_TEST.md` for the
  manual validation procedure.
* The classifier recognizes movement sequences, not intent. A fast single-arm
  upward stroke from the settled ready pose is accepted as a delivery *with or
  without* a wind-up: real players bowl both ways and the recorded human
  traces show the no-wind-up stroke is the common real-world throw. The price
  is that a vigorous one-arm raise (a scratch, a stretch, an exercise
  rep) performed while the game is waiting for a throw can bowl: those
  motions are geometrically identical to a delivery at the release moment
  (documented in §8 as the direct-delivery trade). Slow raises, waving, and
  every two-arm motion stay rejected. Aimless flailing that *never* settles
  low cannot start a stroke (measured ambiguity: 163/200 unconstrained random
  8-second walks build a direct delivery, see §8).
* A backswing hidden behind the body is handled through the elbow chain and a
  visible hand fallback; a stroke where the wrist, the hand landmarks *and*
  the elbow are all untracked through the wind-up cannot be judged.
* Lift/lean of the body cancels because measurements are body-relative, but a
  player who walks during the delivery changes the torso reference
  continuously; very large translations are refused by the body gate.
* `CLASSIFIER_MAX_HAND_JUMP`/`CLASSIFIER_MAX_HAND_SPEED` are per-frame limits
  normalized by torso height. On a very slow camera (below roughly 15
  processed frames/s) the fastest swings approach them; keep the capture rate
  up or raise the limits on such setups.

## 11. The browser build

`src/input/classifier.js` is the shipping decision layer; `src/input/swing.js`
is the parity port of the legacy Python phase machine, kept as the motion
sensor and parity reference.

* **Pose inference runs in a worker** (`src/input/pose_worker.js`), the
  browser counterpart of `tracking/service.py`'s worker thread. The render
  thread grabs one frame per *new* camera frame as an `ImageBitmap` and
  transfers it to the worker; a worker that cannot start or dies falls back to
  the main-thread engine, so webcam mode never degrades to mouse-only because
  of the engine.
* **Frame timestamps, not render frames, drive the classifier.** Every
  snapshot carries `frame_time`; the input steps the classifier with the delta
  between camera frames, and stale/repeated/rewound frames are dropped before
  the classifier sees them.
* **Parity** is still tested for the legacy detectors: `tools/webcam_parity_dump.py`
  records the Python detector's per-frame state, `tools/webcam_parity_run.mjs`
  replays the identical landmarks through the browser detector, and
  `tools/webcam_parity_compare.mjs` diffs them (0 mismatches on the current
  16-sequence set). The classifier is verified separately against labeled
  synthetic and recorded traces (§8).
