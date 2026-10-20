# Testing

The suite runs headless apart from the integration tests, which create an
**offscreen** Ursina window (no camera, no audio device needed). No
third-party test framework is required beyond `pytest` for convenience.

Verified against: Python 3.14.7, ursina 8.3.0, Pillow 12.3.0, mediapipe 1.1.0,
opencv-contrib-python 5.0.0.93, numpy 2.5.4 (Windows).

```
python -m pytest tests -q                     # everything (slow: ~30 min)
python -m pytest tests -q -k "not play_modes"  # everything but the mode integration tests
python -m unittest discover -s tests -v        # the same tests via unittest
python -m pytest tests/test_motion.py -q       # the animation core (fast)
python tools/motion_check.py                   # print what every animation trigger did
```

`pytest` is convenient but not required: every test is a `unittest.TestCase`, so
the suite also runs with the standard library alone. The physics-heavy files
run full simulations, which is where most of the time goes; run a single file
while iterating:

```
python -m pytest tests/test_lateral_movement.py -q
python -m pytest tests/test_questions.py tests/test_session.py tests/test_audio.py -q
```

## What each file covers

| File | Covers |
| --- | --- |
| `test_physics.py` | ball rolling/skidding, friction, frame-rate independence, collisions, energy and momentum, pin tipping and sliding, gutter handling |
| `test_scoring.py` | ten-frame scoring, strikes, spares, the tenth frame, invalid sequences, cumulative totals |
| `test_pin_state.py` | the rack state machine: sweeps, resets, survivors, double-counting, rack/scorer agreement |
| `test_gameplay.py` | the full single-player loop through the real play screen: state transitions, real throws, game over, restart, scripted famous games |
| `test_game_modes.py` | input-mode switching, webcam fallback, the webcam feed panel, and a synthetic swing end-to-end |
| `test_lateral_movement.py` | the regression suite for "the ball does not move sideways": aim angles, hook drift and direction, mouse aim mapping, webcam aim/hook mapping, determinism, frame-rate independence |
| `test_session.py` | players, turns, frame completion, tie handling, BowlRush total-pin rules and clock, bot turns, question-gated scoring, all mode definitions |
| `test_questions.py` | Physics Trivia: bank integrity, concept coverage, numeric parsing, tolerances, unit checking, text aliases, feedback content |
| `test_challenges.py` | Equation Mode: bank integrity and regulation leaves, every answer recomputed from independent formulas, the drift model's properties (invertibility, monotonicity, speed dependence), marking of synthetic measurements, and **engine verification** - every expected value launched through the real `Deck` must defeat its challenge while clearly wrong values must fail, including the insufficient/correct/excessive spin demonstration |
| `test_audio.py` | generated sounds are valid, non-silent, peak-normalised WAVs; deterministic; volume/mute rules; no-mixer fallback |
| `test_avatar.py` | the character's pose maths (every state, swing offsets, arm switching, dejection/celebration) plus an offscreen model/animation test and a check that the avatar cannot touch the physics |
| `test_play_modes.py` | every mode through the real play screen: classic scoring, trivia gates, the Equation Mode challenge flow (attempt, measurement, retry, solution, finish), two-player Local turns and handoff, local 3/4-player rotation, BowlRush clock and expiry, the bot's turn, pause/resume, rematch |
| `test_swing.py`, `test_swing_release.py` | swing recognition: phases, rejects, release conditions, duplicate prevention |
| `test_tracking.py`, `test_webcam_input.py` | the tracking service, camera errors, snapshots, and the event-to-throw mapping |
| `test_release_model.py` | the mouse release model: A/D positioning, aim sweeping, release-direction yaw, speed from the stroke, hook from the sidestep, capped values, determinism, the off-by-default release noise, and that the input layer cannot decide a pin count |
| `test_ui_interactions.py` | real clicks through the input path (Settings opens, Back returns, Play opens the picker, every mode starts, overlays act), typed launch values in the Physics Lab, the pointer fallbacks, the progressive-hint trivia flow and the Equation Mode panel (typing, BOWL IT, measured feedback, the solution button) |
| `test_timeline.py` | the Physics Lab's recorded simulation states: capture/restore round trips, exact resume, the sub-step listener's neutrality, timeline indexing/restoring/forking, and the torque readout |
| `test_lab_timeline.py` | the Physics Lab through the real screen: nothing rolls on entry, BOWL/PAUSE/RESET, scrubbing restores the exact state, resuming from a scrubbed state forks the timeline, and the lab leaves the shared deck clean |
| `test_motion.py` | the animation core: the two easing curves, tween delay/loop/cancel, timelines, count-ups, the config object, reduce motion and the scoreboard state machine (reveal, breathing highlight, score pop, mark stamp, count-up, final pulse) |
| `test_motion_runtime.py` | the animation system driven through the real play screen offscreen: every trigger (`onMatchStart`, `onThrowRelease`, `onPinsResolved`, `onScoreEntry`, `onFrameAdvance`, `onPinReset`, `onGameEnd`), the key chips, the power meter, the pin wave, the paused branch and reduce motion |

## Regression suites worth knowing about

* **Lateral movement** (`test_lateral_movement.py`): the original game could
  not move the ball sideways at all - every throw was launched with a zero aim
  and its spin was a vertical axis rotation, which produces no lateral force.
  These tests assert that different aims produce different paths *and*
  different pinfall, that hook spin bends the path in the documented
  direction, and that both stay inside the lane/gutter bounds.
* **Clicks reach their buttons** (`test_ui_interactions.py`): the menus used
  to look alive and ignore the mouse. Two separate faults caused it - screens
  that overrode `on_key` never routed clicks, and Panda3D can report "no
  pointer", which made every click land in the centre of the screen. The tests
  drive `App.on_key('left mouse down')` with a pointer and assert the resulting
  screen/state change, and `input/pointer.py` has its own fallback tests.
* **The avatar is on screen** (`test_avatar.py`): `Bowler(parent=None)` passed
  an explicit `None` to ursina's `Entity`, which leaves the node out of the
  render graph. The character was built, animated and reported visible for
  several milestones while never being drawn; the test now asserts it is
  parented into the scene.
* **Physics Trivia stays a knowledge mode** (`test_questions.py`): the trivia
  bank tests concepts, no question asks the player to steer the ball, and the
  marking is knowledge-based. Equation Mode's *interactive* marking is a
  separate system (`test_challenges.py`), so the two modes cannot drift into
  each other.
* **The simulation is the judge** (`test_challenges.py`): for all ten
  Equation Mode challenges the model's expected value is launched through the
  real engine on the challenge's own rack, and the target pin must fall (or
  the measured speed must pass). A clearly wrong value must fail. The flagship
  10-pin challenge is checked three ways: too little spin misses, the
  calculated spin hits, and excess spin puts the ball in the gutter.
* **Frame-rate independence**: the deck integrates on a fixed sub-step, so
  `test_frame_rate_does_not_change_the_outcome` asserts identical pinfall at
  240/120/60/30 fps.
* **Rack/scorer agreement**: `test_pin_state.py` and `test_play_modes.py`
  assert that the standing pins on the deck always equal the pins the scorer
  believes are standing, in every mode.
* **No stale throws**: a throw queued during a result, a handoff or a pause is
  discarded, and `test_play_modes.py` asserts it.

## What the automated tests do *not* prove

* Real webcam tracking on real hardware. The swing detector is tested with
  synthetic landmark streams; the camera, the pose model and the handing over
  of the machine between players have not been verified with a physical
  camera here.
* That the game *looks* right. `tools/screenshot_tour.py` exists for that: it
  drives the real window and writes a PNG of every screen, and the images are
  inspected by eye rather than asserted on.
* That a real mouse behaves like the injected pointer in the UI tests. The
  tests use `input.pointer`'s override seam, which exercises the routing but
  not the OS/driver layer; the fallback sources are covered by their own unit
  tests and were checked once against a real window and a moved OS cursor.
* Audio playback quality (the files are verified, the mixer output is not).

## Tools

```
python tools/screenshot_tour.py --frames 20 --out docs/screens
python tools/make_sounds.py            # regenerate assets/audio without launching the game
STRIKE_LAB_SCENE_DEBUG=1 python main.py   # print the startup scene dump
STRIKE_LAB_SKIP_SPLASH=1 python main.py   # boot straight to the main menu
```
