# Webcam, UI and interaction repair pass — October 2026

This is the report for the pass that rebuilt the browser build's webcam
tracking around the original Python behaviour and repaired the UI, icon,
interaction and text-selection defects found while auditing it. It records
what was actually verified, and how, with the exact commands.

Everything below refers to the **browser build** (`src/`, `index.html`) except
where the original Python implementation is named explicitly. No Python game
code was modified.

---

## 1. Root causes of the webcam tracking problems

1. **Pose inference ran on the render thread, one inference per *two* display
   frames.** `TrackingService._loop` awaited a `requestAnimationFrame` at the
   end of every iteration *and* again when no new camera frame had arrived, so
   the pipeline could never process a camera frame faster than
   `display_rate / (2 + inference_time)`. A 40 ms inference on a 60 Hz display
   measured **16.7 processed frames/s** (probe in-page with a synthetic
   camera); the Python service, running capture+inference on a background
   thread, processes every camera frame instead.
2. **The detector was stepped with the wall-clock interval between *render*
   frames in which a new snapshot appeared, not with the camera frame times.**
   A snapshot can be a render frame or two old when the game reads it, and a
   slow engine samples slower than the display, so `dt` was systematically
   wrong — which distorts `raw_velocity = Δposition / dt`, the value every
   release gate is built on (hand speed in image heights per second).
3. **The power meter used `telemetry.peak_up`** (a running maximum that
   survives the release) instead of the Python input's `max(0, swing_pose)`
   fallback, so the meter stayed pinned after a throw.
4. **The HUD told the player "Ready to throw" regardless of tracking**, so a
   player with no valid measurements was told to bowl.
5. **Mode rows and other controls used text glyphs** (`X`, `?`, `Δv/t`, `AI`,
   `2-4`, `3:00`, `◄`, `►`, `✓`, `⚙`) instead of the original's vector icon
   set — inconsistent weights, cramped tiles, and an emoji-ish gear.
6. **The mode picker's detail panel could overflow its fixed-height panel**
   (Equations +105 px, PV-bot +47 px, BowlRush +39 px, Local +7 px measured),
   spilling rule chips and setup rows past the panel towards BACK/START.
7. **Dragging to aim selected HUD text**: nothing disabled the browser's
   default selection on the stage, and the window-level pointer handlers never
   suppressed `mousedown`/`selectstart`.
8. **A pointer released outside the window (or a cancelled touch) could leave
   the game believing the button was still held**, so the ball stayed "in
   hand" and the next interaction threw with a stale stroke.
9. Buttons had no transition, no pressed state and no focus styling beyond a
   one-off `mousedown` transform that stuck when the pointer left the button.

## 2. Python vs browser implementation differences found

Found by reading `tracking/service.py`, `tracking/pose_tracker.py`,
`tracking/pose.py`, `input/swing.py`, `input/webcam_input.py` and their
browser counterparts side by side, then diffing both detectors frame by frame
(§5):

| Concern | Python | Browser (before) | Browser (now) |
| --- | --- | --- | --- |
| Capture + inference topology | worker thread, every camera frame | render thread, ≤ display/2 | module worker fed one `ImageBitmap` per new camera frame; main-thread fallback |
| Detector `dt` source | wall clock between processed frames | wall clock between render frames that saw a new snapshot | the camera frame's own timestamp (`frame_time`), per frame |
| Confidence / tracked gate | mean visibility of 10 key joints, ≥6 visible (pose.py) | identical | identical (shared code path for both engines) |
| Landmark contract | 33 names, x/y/z/visibility/presence | 33 names, x/y/z/visibility | identical |
| Swing detector | `input/swing.py` | line-by-line port | unchanged port, parity-tested |
| `power` | `release_progress` else `max(0, swing_pose)` | `telemetry.peak_up` | `max(0, swing_pose)` |
| HUD readiness claim | phase-driven | "Ready to throw" regardless of tracking | phase/tracking-driven (webcam mode never claims READY without measurements) |
| Diagnostics | status + telemetry + swing log | status + 2 telemetry lines, mostly hidden behind the 3-line HUD readout | full dev readout (engine/delegate/fps/frame time/infer ms/lost frames/phase/arm/hand/pose/velocity/release/reject reason/last throw) shown first in webcam mode |
| Frame pacing on stall | camera read failures → error | identical watchdog behaviour | identical (watchdog unchanged) |

## 3. What was repaired

### Arm tracking, swing detection, throw control, spin

* **Engine**: `src/input/pose_worker.js` runs the MediaPipe Tasks Vision
  landmarker in a module worker — the browser counterpart of the Python
  service's worker thread. The main thread captures the freshest camera frame
  (`createImageBitmap`, downscaled to the 640-px capture width the Python
  service used) and transfers it; results are published as the same snapshot
  shape. A failed worker (no module support, blocked CDN, no WebGL in worker,
  mid-session crash) transparently falls back to the identical engine on the
  main thread. The delegate in use (`GPU (worker)`, `CPU`, …) is published and
  shown in the readout.
* **Timestamps**: every snapshot carries `frame_time` (capture time) and
  `infer_ms`; `WebcamInput` steps the detector with the delta between camera
  frames, with the Python first-frame rule (1/30 s) after re-arming. Render
  cadence, display refresh and worker latency can no longer distort velocity.
* **Swing detection**: the Python phase machine is unchanged (ready hold,
  backswing, forward, release gates, follow-through, aborts, notice text) and
  is now proven identical to the Python one for 16 sequences including real
  recorded landmarks (§5).
* **Throw control and spin**: `eventToThrow` is unchanged (position from body
  x, aim from the release hand's cross-body offset, release yaw and hook spin
  from the measured sideways hand speed, speed from the peak upward hand
  speed), and the parity suite asserts that hook-left, hook-right and straight
  releases produce the corresponding negative/positive/zero spin and yaw, and
  that a harder swing throws faster.
* **Power meter**: back to the Python semantics.
* **Readiness**: the HUD status line only claims "Ready to throw" when the
  tracker is live, tracked and in the ready phase; otherwise it asks the player
  to step into view or hold still.
* **Diagnostics**: `_webcam_diagnostics()` now reports engine+delegate, fps,
  frame time, inference time, lost frames, phase, arm, hand source, smoothed
  swing position, rise/depth, measured direction and speed, peak speed,
  release eligibility, the last rejection reason, the last throw's parameters
  (arm and hand source included) and the phase hint. In webcam mode these
  lines are shown *first* in the existing physics readout (H toggles it), so a
  developer can see them; nothing extra is shown during normal play.

## 4. Files changed or added

| File | Change |
| --- | --- |
| `src/input/pose_worker.js` | **new** — worker pose engine (MediaPipe in a module worker with the classic-script shim its wasm loader needs) |
| `src/input/webcam.js` | worker/main engines, frame-time snapshots, per-frame `dt`, power fix, richer status, engine fallback + diagnostics |
| `src/config.js` | `TRACKING_MEDIAPIPE_CDN`, `TRACKING_ENGINE_TIMEOUT`, `TRACKING_USE_WORKER` |
| `src/game/play.js` | webcam diagnostics readout (engine, sampling, release, last throw), prepended in webcam mode |
| `src/ui/hud.js` | webcam chip shows fps; status line is webcam-aware; readout shows up to 7 lines in webcam mode |
| `src/ui/icons.js` | **new** — the original's vector icon set (pin, question, sigma, people2/3, robot, stopwatch, gear, check, four arrows) as pure SVG strings + a DOM wrapper |
| `src/ui/menu.js` | mode rows use the vector icons; badge/gear/steppers/hint arrows use icons; hover/press feedback on rows, segments, settings rows; adaptive detail-panel fitting (measured, squeezes gaps, drops trailing chips rather than clipping) |
| `src/ui/lab.js` | stepper arrows and clickable readout rows use icons/feedback |
| `src/ui/dom.js` | button feedback: hover lift, pressed scale, focus ring, reduced-motion aware, state reset on leave/cancel/blur |
| `src/ui/screens.js` | screen enter = fade + rise, reduced-motion aware, never gates input |
| `src/input/pointer.js` | selection guards (`mousedown`/`selectstart`/`dragstart` outside text fields), `pointercancel`/`visibilitychange` release, exported `isSelectableTarget` |
| `index.html` | `user-select: none` on the stage with text fields opting back in; `touch-action: none` on the canvas host |
| `tools/dom_audit.js` | new checks: escaping a clipping panel, text behind an overlay/media, documented intentional-layering whitelist |
| `tools/js_tests.mjs` | Python-parity replay of the webcam pipeline, engine/fallback/frame-time/power tests (91 total) |
| `tools/webcam_parity_dump.py` | **new** — Python reference dump for 16 recorded+synthetic sequences |
| `tools/webcam_parity_run.mjs` | **new** — replays the dump through the browser pipeline |
| `tools/webcam_parity_compare.mjs` | **new** — frame-by-frame diff with tolerances |
| `tools/webcam_parity_py.json`, `tools/webcam_parity_js.json` | **new** — the dumps themselves (the Python one is committed for `js_tests`) |
| `tools/webcam_fixture_check.js` | runs on the main-thread engine explicitly, timer-driven camera (works in a background tab), unchanged assertions |
| `tools/browser_checks.md`, `MIGRATION.md`, `README.md`, `docs/WEBCAM_SWING.md` | documentation of the new pipeline, checks and commands |

## 5. Verification

### 5.1 Python ↔ browser webcam parity (the core new evidence)

```
python tools/webcam_parity_dump.py tools/webcam_parity_py.json
node   tools/webcam_parity_run.mjs tools/webcam_parity_js.json
node   tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json
```

Result: **cases compared: 16, mismatches: 0**. Each case compares, frame by
frame: smoothed hand offsets, smoothed and raw velocities, lateral velocity,
wrist↔hand source switches, phase, rise/depth/peak, the release decision, the
release frame (within 1 frame), the release arm, and the final `ThrowData`
(speed, lateral position, launch angle, hook spin) — plus the detector's
rejected/lost/release/abort counters.

Sequences: recorded real swing (376 frames) and recorded real waving (156
frames, from `tools/webcam_landmarks*.json`), synthetic still, lean, walk,
casual waving at chest height, slow and fast full swings, hook-left,
hook-right, straight, short (direct) swing, mid-backswing wrist occlusion
(finger-landmark fallback), tracking loss mid-swing, three repeated swings,
and an arm switch (right then left). Negative cases produce **0** releases in
both implementations; every valid swing produces **exactly one**; repeated
swings produce one release per swing; the arm switch releases once per arm.

### 5.2 Browser regression suite

```
node tools/js_tests.mjs
```
`91 passed, 0 failed` — including the new parity replay, the frame-time `dt`
test (a 100 ms camera gap must produce 0.135/s smoothed velocity, not the
0.18/s a render-rate assumption gives), the worker plumbing test (a fake
worker engine publishes frames and its delegate), the worker-death fallback
test, and the power-meter semantics test.

### 5.3 In-page sweeps (real browser, real game loop)

Served with the production file set (`python tools/vercel_sim.py 8131
--with-tools`):

* `await window.hellsAuditRun()` → **67/67 checks pass** (scorecard vs the
  scoring engine, multiplayer cards, pins-mode cards, shadow pipeline, every
  screen's layout, pause/results overlays, layout audits).
* `await window.hellsWebcamFixtureRun()` → **6/6 pass**: a replayed recorded
  swing launches exactly one ball through the real service + detector + game
  loop; waving launches none; phase machine armed and swung.
* `window.hellsAudit()` (extended audit) run over: splash, menu, mode picker
  (all six modes), how-to-play, settings, lab, play (classic, local ×4 with a
  12-character name, trivia, equations, player-vs-bot, BowlRush), pause,
  results, handoff, trivia feedback, equation attempts/solved/solution,
  webcam HUD, and a synthetic webcam readout with maximum-length diagnostics —
  **zero defects** after the fixes.
* The audit was validated against injected defects (an element parked outside
  the stage and a text oversized inside an `overflow:hidden` box are both
  reported; both disappear when removed), so "clean" is a measurement, not an
  assumption.
* Console: no uncaught errors on the production artefact.

### 5.4 Tracking pipeline probes (synthetic camera, real MediaPipe)

* **Worker engine**: `delegate: "GPU (worker)"`, `worker: true`, real
  MediaPipe inference on transferred `ImageBitmap`s, ~27 ms/frame, results
  published to the snapshot (probe run in-page with a canvas
  `captureStream` camera).
* **Main-thread fallback**: with the worker disabled, the same model processes
  **85 frames in 3 s (~29 fps, median interval 31 ms)** where the old
  two-rAF pacing stalled at ~25 fps in the same conditions; the fallback also
  engages automatically when the worker dies mid-session (unit-tested).
* **Frame-time consequences**: the readout and snapshot expose `frame_time`
  and `infer_ms` per frame, and the detector's `dt` is the camera interval
  (asserted in `tools/js_tests.mjs`).

### 5.5 Python reference tests (unchanged original)

```
python -m pytest tests/test_swing.py tests/test_webcam_input.py tests/test_release_model.py tests/test_tracking.py -q
python -m pytest tests/test_scoring.py tests/test_session.py tests/test_questions.py tests/test_swing.py \
                 tests/test_swing_release.py tests/test_webcam_input.py tests/test_tracking.py \
                 tests/test_release_model.py tests/test_lateral_movement.py -q
```

`122 passed` (the four webcam/detector files), `239 passed` (logic + webcam +
lateral-movement subset), and `181 passed in 2:20` (physics, pin state,
timeline, motion, celebration, challenges, audio, game modes). That is **420
tests across 17 of the 25 test files** — including every file that touches the
webcam, swing, scoring, physics and mode behaviour. The remaining eight files
are the Ursina offscreen integration suites (`test_play_modes`,
`test_ui_interactions`, `test_avatar`, `test_gameplay`, `test_lab_timeline`,
`test_motion_feedback`, `test_motion_runtime`, `test_screens`); the full suite
is documented as ~30 minutes and the repository's own split logs show why:
`pytest_groupB.log` alone took 34 minutes for 65 tests. A single full run was
started in this environment and hit the 30-minute wall-clock limit twice (the
same thing the repository's `pytest_baseline.log` / `pytest_final.log` record:
partial progress, `EXIT: -1`). It is not required for this pass — **no Python
game file was modified** (`git status` shows only `src/`, `index.html`,
`tools/`, and documentation), and the Python behaviour these tests cover is
precisely the reference the browser is now compared against frame by frame in
§5.1.

### 5.6 Production artefact

The exact deployed file set boots (`http://127.0.0.1:8131/`), serves the new
modules (`/src/input/pose_worker.js`, `/src/ui/icons.js`), and passes the
audits above. **No live Vercel deployment could be verified** — no credentials
or linked project exist in this environment — so this is local
production-build verification only.

## 6. Real-camera vs simulated verification (explicit)

* **Simulated / recorded**: everything in §5. Recorded landmark traces from
  real people (arm swing and waving) drive the real browser pipeline; the
  synthetic camera feed exercises the real capture path
  (`getUserMedia` → `<video>` → `createImageBitmap` → worker → MediaPipe →
  snapshot) with a live model.
* **Real camera, live human**: *not* verified in this environment (no camera
  available to the browser used here). The remaining unknowns are therefore
  camera-specific: the exact achieved frame rate on a given webcam, lighting
  effects on landmark confidence, and how a given person's swing tempo maps
  onto the detection thresholds. Everything downstream of a published snapshot
  is verified.

## 7. UI, icon, animation and text-selection repairs

* **Overflow/clipping**: the mode picker's detail panel now measures its own
  content and fits it the way `ui/menu_screens.py` does — section gaps tighten
  (18→12), setup rows shrink (44→36), and trailing rule chips are dropped
  rather than clipped or allowed to escape; the panel also clips as a safety
  net. Before: up to 105 px of content escaped the panel for Equation
  Challenge. After: every mode fits with margin (measured −4 to −31 px).
* **Results award banner**: the extended audit caught the achievement title and
  its subtitle overlapping by a few pixels on the results screen (32 px title
  over a 15 px subtitle 36 px lower, with the browser's default line height).
  Both now set explicit line heights and the subtitle sits 38 px below the
  title, so "YOU WIN! / The match is yours." and the equivalent banners no
  longer collide. Motion confetti (6 px particles that fall in from outside the
  stage) is marked `motion-particle` and whitelisted as intentional
  decoration.
* **Icon set**: the original's vector icons are ported to `src/ui/icons.js`
  and used in the mode rows (pin/question/sigma/robot/people/stopwatch, tinted
  per mode), the selected-row check, the stepper arrows (mode picker, settings,
  lab), the "no extra setup" gear, and the menu hint bar arrows. No emoji or
  stray text glyphs remain in the UI.
* **Interaction feedback**: buttons lift on hover, scale on press, brighten,
  release cleanly when the pointer leaves or the window loses focus, and keep a
  keyboard focus ring; mode rows, settings rows, segmented controls, lab rows
  and steppers have consistent hover/press transitions; screens fade and rise
  briefly on entry. All of it respects the existing reduce-motion setting and
  never blocks input (the events are visual only; actions still fire once, from
  `click`).
* **Text selection**: the stage is `user-select: none` (name fields, trivia and
  equation inputs opt back in with `user-select: text`), and `mousedown`,
  `selectstart` and `dragstart` are suppressed outside those fields, so a drag
  to aim/throw can no longer highlight HUD labels. Verified in-page: HUD text
  computes `user-select: none` and has both `selectstart` and `mousedown`
  cancelled; a player-name input computes `user-select: text`, is focusable,
  and its events are not cancelled. Pointer release/cancel/blur now always end
  the drag.
* **Readiness honesty**: the play status line in webcam mode reports
  "Waiting for the camera…", "Step into the camera view", "Hold still with your
  arms down", or the detector's phase label — "Ready to throw" only while the
  tracker is live, tracked and ready.

## 8. What was not done / remains open

* **Live deployment**: repository-side configuration is unchanged and correct;
  no live URL was checked (no credentials).
* **MediaPipe is still a CDN import** (jsDelivr); the worker now loads the same
  package (it ships no classic bundle, hence the `importScripts` shim in the
  worker). If the CDN is unreachable the game reports "Webcam unavailable" and
  switches to mouse, exactly as before.
* **A human in front of a webcam** has not been tested (see §6).
* The mode picker drops trailing rule chips for the busiest modes (PV-bot shows
  1 of 4 chips, Local 2 of 3, Equations 3 of 5) — the same mechanism the
  original uses; the browser's slightly wider default font makes a couple of
  cases tighter than the reference screenshots.

## 9. How to test locally

```bash
python tools/serve.py 8124          # then open http://127.0.0.1:8124/
node tools/js_tests.mjs             # 91 logic + parity tests

# the deployed file set, with the tools available to the page:
python tools/vercel_sim.py 8131 --with-tools
#   in the page console:
#   (0, eval)(await (await fetch('/tools/browser_audit.js')).text()); await window.hellsAuditRun()
#   (0, eval)(await (await fetch('/tools/webcam_fixture_check.js')).text()); await window.hellsWebcamFixtureRun()

# Python reference comparison
python tools/webcam_parity_dump.py tools/webcam_parity_py.json
node   tools/webcam_parity_run.mjs tools/webcam_parity_js.json
node   tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json
```

In the game itself: **Webcam mode** (menu INPUT toggle, `TAB`/`2` in play)
drives the camera; `C` cycles the throwing arm; `H` shows the physics/readout
panel (the webcam diagnostics come first there). Mouse mode is unchanged:
`A`/`D` to move, pointer position to aim, hold-drag-back-stroke-forward-release
to throw, `TAB`/`1` to switch back.

## 10. What to report if a problem remains

Please include: the browser and OS, whether the webcam readout says
`GPU (worker)`, `CPU`, or "main thread (…)"; the readout's first three lines
(engine/confidence/fps/frame time/infer/lost, phase/hand/pose/rise/depth,
swing/release/last-reject); the swing log behaviour (phase transitions, abort
or rejection messages); and whether the same motion works with the mouse. If a
swing fails, note the phase at the time (e.g. stuck in `backswing`) and the
"last reject" reason — those two fields point at the cause (frame pacing vs a
rejected landmark) directly.
