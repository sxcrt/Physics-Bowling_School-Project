# Hells Balls — browser migration

This document records how the original native **Ursina / Panda3D** game was
migrated into a **browser game** that runs from a URL and deploys to Vercel,
what was preserved, how it was verified, and where it necessarily differs.

The original Python project is **still in the repository, untouched**
(`main.py`, `physics.py`, `scene/`, `ui/`, `tests/`, …). The browser build is a
new, parallel source tree under `src/` plus `index.html`; nothing in the Python
game was modified or deleted.

---

## 1. What the original is

An original motion-controlled 3D physics bowling game:

* a real rigid-body bowling simulation (`physics.py`: sphere with skid / roll /
  hook, pins as toppling + sliding rods, impulse collisions with restitution,
  kickback walls, the pit) on a fixed 1/240 s sub-step clock;
* USBC ten-frame scoring (`scoring.py`);
* six modes (`game/modes.py`, `game/session.py`): Classic Bowling, Physics
  Trivia, Equation Challenge, Player vs Bot, Local Multiplayer (2–4), BowlRush;
* mouse input and webcam (MediaPipe pose) input producing the same `ThrowData`
  (`input/`);
* a procedural bowler avatar (`avatar/character.py`), a Physics Lab
  (`ui/lab_screen.py`), a neon UI design system (`ui/theme.py`), an animation
  system (`motion/`), and audio synthesised with the Python stdlib
  (`game/audio.py`).

## 2. The browser build

### 2.1 Technology

| Concern | Original | Browser build | Why |
| --- | --- | --- | --- |
| 3D engine | Panda3D via Ursina | **Three.js** (ES module, vendored in `vendor/three/`, resolved by an import map) | The only realistic browser WebGL path; no build step needed. |
| App structure | Ursina entities + `main.py` hooks | ES modules + a `requestAnimationFrame` loop | Same shape: one update entry point, one input router. |
| UI | Ursina `camera.ui` entities, Pillow-painted textures | **DOM + CSS** over the WebGL canvas, laid out on the same 1280×720 reference grid | CSS reproduces the neon glow, gradients, rounded plates and exact type sizes far more faithfully than hand-drawn textures, and gives real hit-testing. |
| Physics | `physics.py` | `src/physics.js` — a line-by-line port | The simulation is the specification; nothing was re-derived. |
| Scoring / modes / session / questions / challenges / bot | Python modules | `src/game/*.js` — line-by-line ports | Pure logic, no engine dependency in either version. |
| Audio | stdlib-synthesised WAVs in `assets/audio/` | the **same WAV files**, played through the Web Audio API | The files are the original synthesiser's exact output, so the sound is bit-identical; the browser cannot run the Python synthesiser, so shipping its output is the faithful choice. |
| Webcam pose | OpenCV + MediaPipe (Python) | **MediaPipe Tasks Vision** (`pose_landmarker_lite.task`, CDN WASM) | The same model and the same landmark set; `input/swing.py`'s detector is ported and unchanged. |
| Deployment | `vercel.json` pointing at a static landing page | the repo root is the static site | No build step: ES modules + one import map. |

### 2.1.1 Deployment shape

The deployed artefact is the repository root served as static files:

```
index.html                 entry point (import map -> vendor/three, stage markup)
vercel.json                framework:null, no build/install command, outputDirectory "."
.vercelignore              the files Vercel does not upload (Python game, docs, tools)
vendor/three/three.module.js   the vendored renderer (see 2.3.1)
src/…                      the browser build
assets/…                   audio WAVs and the pose-landmarker model
```

`tools/vercel_sim.py` serves exactly that file set with Vercel's
`cleanUrls`/`trailingSlash` redirects and the same `Cache-Control` values, so the
production artefact can be exercised locally before a deploy.

### 2.2 Layout

```
index.html                 entry point (import map for three.js, stage markup)
vercel.json                static deployment config
.vercelignore              files Vercel does not upload
vendor/three/              the vendored renderer (three r160)
src/
  config.js                every game constant (port of config.py)
  physics.js               the rigid-body simulation (port of physics.py)
  scoring.js               USBC ten-pin scoring (port of scoring.py)
  main.js                  the App: screens, settings, audio, input routing
  game/
    modes.js  session.js  settings.js  questions.js  challenges.js
    bot.js  audio.js  play.js
  input/
    pointer.js  keyboard.js  mouse.js  swing.js  webcam.js
  scene/
    renderer.js  camera.js  lane.js  ball.js  pins.js  avatar.js
    geometry.js  shader.js  textures.js  shadow.js
  motion/
    ease.js  tween.js  config.js  celebrate.js  effects.js  scene_fx.js
    director.js
  ui/
    theme.js  dom.js  screens.js  menu.js  hud.js  scorecard.js
    fullscorecard.js  cardmodel.js
    overlays.js  lab.js  challenge_panel.js  diagram.js  webcam_panel.js
assets/…                   unchanged (audio WAVs, pose model)
```

### 2.3 Key implementation decisions

1. **No bundler, no runtime CDN for the renderer.** The site is plain ES modules
   plus an import map. `three.module.js` is **vendored in `vendor/three/`** rather
   than fetched from jsDelivr: a bare CDN import means a third-party outage
   blanks the production page (observed: a jsDelivr `502` while verifying), and an
   import map value must be an absolute, `/`-rooted or `./`-relative URL, which
   makes the vendored file the only form that is also sub-path safe. MediaPipe is
   still imported from its CDN **only when webcam mode is first entered**, so
   mouse-only play downloads nothing extra.

2. **The physics port is exact.** `src/physics.js` mirrors `physics.py`
   statement for statement (same sub-step, same swept-circle test, same impulse
   equations, same kickback/pit rules, same capture/restore snapshot shape).
   `tools/fidelity_run.mjs` runs both and `tools/fidelity_compare.mjs` diffs
   them: **0 mismatches** across 12 throws (see §4).

3. **Colour pipeline.** Panda3D writes colours straight to the framebuffer with
   no gamma conversion. Three.js is therefore configured with
   `THREE.ColorManagement.enabled = false` and a linear output colour space, and
   every generated texture is `NoColorSpace`. A colour of `(24, 22, 62)` in
   `config.js` renders as those literal bytes, exactly as in the original.

4. **Handedness.** The game's world is right-handed with `+z` down-lane and `+x`
   to the bowler's right, and the camera looks towards `+z`. Three.js shows
   world `+x` on the **left** in that setup (the original shows it on the
   right), so the projection matrix's x-scale is negated and every material is
   double-sided — the image then matches the original's framing exactly
   (verified by comparing against `docs/screens/*.png`).

5. **The 1280×720 reference grid.** All UI sizes are the original's reference
   pixels; the stage is a 1280×720 box scaled to fit the window. The original
   re-anchors its UI for arbitrary aspect ratios; the browser build letterboxes
   to the reference 16:9 instead (see §5).

6. **Snake-case aliases.** The ported call sites read like the Python
   (`standing_pins()`, `restore_survivors()`, …). The JS classes define the
   camelCase implementation and a one-line snake_case alias, so the port stays
   reviewable against the original.

7. **Audio.** `AudioSystem` fetches the 18 WAVs from `assets/audio/`, decodes
   them into `AudioBuffer`s and plays them through a `GainNode` per sound.
   Master/SFX/music volumes and mute map exactly as `AudioSettings.volume_for`
   does. Playback is unlocked on the first user gesture (browser autoplay
   policy).

8. **Webcam.** A `TrackingService` replaces `tracking/service.py`: same
   snapshot contract (`tracked`, `confidence`, `landmarks`, `fps`,
   `frame_count`, `last_tracked_at`, `error`, `frame`), same landmark names
   (MediaPipe's 33), same confidence/visibility thresholds. Pose inference runs
   in a module worker (`src/input/pose_worker.js`) - the browser counterpart of
   the Python service's background thread - with an automatic fall back to the
   same model on the main thread where workers are unavailable. Every snapshot
   carries the *camera frame's* own timestamp (`frame_time`), so the detector
   differentiates real elapsed time instead of a constant frame rate.
   `input/swing.py`'s phase machine is ported unchanged, and `event_to_throw`
   maps a recognised swing onto `ThrowData` with the same constants; the two
   pipelines are compared frame by frame by `tools/webcam_parity_dump.py`,
   `tools/webcam_parity_run.mjs` and `tools/webcam_parity_compare.mjs` (§4.5).
   The in-game feed panel shows the live `<video>` (mirrored) with the skeleton
   drawn on a canvas.

9. **Settings** persist to `localStorage` under `hells-balls-settings` with the
   same defaults and the same validation as `game/settings.py`.

10. **Tests.** The Python test suite is untouched and still runs against the
    original. For the browser build, verification is (a) the physics/scoring/
    challenge/question fidelity diffs against the Python originals (§4), and
    (b) scripted browser runs that drive the real game loop (§5).

---

## 3. Feature-by-feature checklist

Every row was taken from the actual repository (not from documentation) and
checked in the browser build.

### Core simulation

| Feature (source) | Browser | Evidence |
| --- | --- | --- |
| Ball skid → roll transition, kinetic + rolling friction (`physics.BallPhysics.step`) | ✔ | fidelity diff, §4 |
| Hook spin as axis rotation along travel, sideways slip friction (`BallPhysics.launch`) | ✔ | fidelity diff (spin cases), challenge runs |
| Orientation integration `R ← exp([ω dt]×) R` | ✔ | ball texture wheels in `docs/screens` comparison |
| Ball bounds + gutter entry (`_apply_bounds`) | ✔ | `gutter` fidelity case |
| Swept-path ball↔pin contact, one strike per pin per roll (`Deck._resolve_ball_contacts`) | ✔ | fidelity diff (pin counts + trajectories) |
| Pin toppling (pendulum then free rod), sliding, deck friction | ✔ | fidelity diff (trajectories, knockdowns) |
| Pin↔pin closest-point impulses, overlap correction | ✔ | fidelity diff (roll_down sets, kickback hits) |
| Kickback walls + pit removal (`PinPhysics._resolve_bounds`) | ✔ | fidelity diff (`kickback_hits`) |
| Fixed 1/240 s sub-step clock, bounded backlog (`Deck._run_substeps`) | ✔ | fidelity diff (elapsed + trajectory timings) |
| Frame-rate independence | ✔ | sub-step clock ported; bot + rolls use the same `Deck` |
| `capture_state` / `restore_state` snapshots | ✔ | Physics Lab scrub verified in-browser |

### Scoring / rules

| Feature | Browser | Evidence |
| --- | --- | --- |
| Ten frames, strikes, spares, open frames | ✔ | scoring fidelity diff (8 sequences) |
| Tenth-frame bonus balls + rack resets | ✔ | scoring diff; `12×10 → 300` |
| Cumulative running totals, unresolved frames stay blank | ✔ | scoring diff |
| Pin-count clamping against the scorer | ✔ | `Match.recordRoll` ported; browser runs |
| Turn order: keep bowling until the frame completes | ✔ | browser: 9 then 0 → turn passed |
| Local 2–4 players with explicit handoff | ✔ | browser: 4-player rotation, handoff banner |
| BowlRush clock (runs in ready/handoff, freezes in a roll) | ✔ | browser: timer 59.5 → tick, handoff |
| BowlRush throw-in-flight finishes after time-out | ✔ | same state machine as the original |
| Results aggregation + winners/ties | ✔ | browser: `DRAW: P1 & P2` result line |

### Modes

| Mode | Browser | Evidence |
| --- | --- | --- |
| Classic Bowling | ✔ | full frame played, scorecard marks `9 0` |
| Physics Trivia (10 questions, free-response marking, throw gate) | ✔ | correct → throw; wrong → forfeits, next question; question-marking diff |
| Equation Challenge (10 interactive challenges, real leaves, unlimited attempts, measurements, hints, solution) | ✔ | `1.37°` → **PIN 10 DOWN!** through the real deck; miss → hint unlocked; challenge-bank diff (all 10 answers, values, working text) |
| Player vs Bot (Easy/Medium/Hard) | ✔ | hard bot bowled a **strike** through the real simulation after the human's frame |
| Local Multiplayer (2–4) | ✔ | 4-player rotation + handoff confirmed |
| BowlRush | ✔ | timer, fresh rack per throw, alternation |

### Input

| Feature | Browser | Evidence |
| --- | --- | --- |
| Mouse aim (pointer x → aim point at the arrows, ±2°, frozen during a drag) | ✔ | aim swept ±0.382 m with the pointer at the edges |
| A/D (or ←/→) lateral position | ✔ | ported `MouseInput._update_lateral` |
| Drag back → stroke forward → release; speed from the fastest stroke | ✔ | a scripted drag produced `speed 5.4 m/s` |
| Stroke direction → release yaw; sideways speed → hook | ✔ | the same drag produced `yaw +2.0°`, `hook −0.69 rad/s` |
| `MIN_DRAG_DISTANCE` / `MIN_THROW_SPEED` release gates | ✔ | ported |
| Seeded `ReleaseNoise` (off by default) | ✔ | ported |
| Webcam pose → swing detector → throw (full phase machine) | ✔ | recorded real-person MediaPipe traces replay through the browser detector and the real page (`tools/webcam_fixture_check.js`: one swing → one launch, waving → none); live MediaPipe inference drives the service end-to-end; the no-camera path falls back to mouse with the message |
| `TAB` / `1` / `2` input switching, `C` throwing-arm cycle | ✔ | ported and reachable |
| Turn handoff (mouse ENTER/click; webcam ready-pose progress) | ✔ | banner + progress bar + ENTER confirmed in-browser |
| Hand menu navigation (experimental, off by default) | ✔ | ported (dwell cursor), settings toggle |

### Presentation

| Feature | Browser | Evidence |
| --- | --- | --- |
| Neon city, lane, gutters, markings, pin deck | ✔ | canvas captures match `docs/screens` framing |
| Procedural textures (wood, approach, ball crackle, facade windows, skyline with moon, glow, gradients) | ✔ | canvas textures generated at runtime; compared against Pillow output |
| Pin mesh: monotone-cubic lathe of the regulation profile + white/red skin | ✔ | ported; NaN-vertex bug found and fixed by comparison |
| Soft key/fill lighting shader | ✔ | ported GLSL as a `ShaderMaterial` |
| Camera rig: ready / rolling dolly / deck push-in / menu / modes / splash / lab shots, FOV 60→54 | ✔ | captures at three shots |
| Procedural bowler avatar + 20-channel pose blend + swing following | ✔ | visible in captures; pose table ported |
| HUD: scorecard, score, pin rack, status line, player chips, timer, webcam chip, physics readout | ✔ | DOM verified: 10 cells, 10 ticks, correct texts |
| Scorecard marks/scores/highlight | ✔ | `9 0` rendered, active frame highlighted |
| Question panel (Trivia) with hints and worked solution | ✔ | live in browser |
| Challenge panel with lane diagram, measured feedback, buttons | ✔ | live in browser; diagram drawn from the real rack |
| Overlays: pause (4 actions), results (rematch/lab/menu + award banner), handoff banner | ✔ | DOM-click tests |
| Physics Lab: launch steppers, BOWL/PAUSE/RESET, live equations, scrubbable timeline | ✔ | bowled, paused, scrubbed to t=0.04 s, reset |
| Motion system: result cards, pin pops, flashes, confetti, camera shake, neon breathing/spike, pin glow, dust, impact rings, ball trail, aim guide, sweeper + staggered rack reset | ✔ | ported in `motion/`; triggers fire from the same call sites |
| Reduce motion | ✔ | a roll completes with shake/flash/pulse suppressed |
| Synthesised SFX + music bed, volume/mute | ✔ | all 18 buffers decode and play; settings apply live |

### Modes of engagement

| Feature | Browser | Evidence |
| --- | --- | --- |
| Splash (any key/click, auto-advance) | ✔ | boots here |
| Main menu (PLAY / HOW TO PLAY / PHYSICS LAB / SETTINGS / QUIT, input toggle, hint bar) | ✔ | DOM-click test |
| Mode picker (6 rows, detail panel, rules chips, match setup, START/BACK) | ✔ | DOM-click test; 6 rows confirmed |
| How to Play (4 tabs, exact text, scroll, PREVIOUS/NEXT/BACK) | ✔ | 4 tabs, rows render |
| Settings (input, arm, volumes, mute, physics readout, reduce motion, hand nav) | ✔ | 9 rows, cycling verified |
| Pause / resume / restart / quit to menu | ✔ | DOM-click test |
| Rematch / open Physics Lab from results | ✔ | overlay wired |
| F1x screenshot (F12) | ✔ | downloads the canvas as a PNG |

---

## 4. Test results

### 4.1 Physics fidelity vs the original Python (the strongest evidence)

```
> python tools/fidelity_dump.py tools/physics_py.json
> node   tools/fidelity_run.mjs tools/physics_js.json
> node   tools/fidelity_compare.mjs tools/physics_py.json tools/physics_js.json
cases compared: 12
mismatches: 0
```

Each case compares **knockdowns, standing pins, first-contact time, impact
speed, final ball position, simulation elapsed time, the roll-down pin set,
kickback contacts, and the recorded ball trajectory** (every 40th sub-step).
Cases cover: centre throws at 7.5/8/12/2 m/s, the angle-to-pin shot, −4.71 and
+4.71 rad/s hook shots, the 1-3 pocket, the speed-to-curve shot, a mixed
lateral/angle/spin throw and a gutter ball. **Zero mismatches** — the browser
simulation produces the identical outcome to the original.

### 4.2 Scoring / challenges / questions fidelity

```
> python tools/fidelity_dump2.py tools/logic_py.json
> node   tools/fidelity_run2.mjs tools/logic_js.json
> node   tools/fidelity_compare2.mjs tools/logic_py.json tools/logic_js.json
scoring cases: 8
challenges: 10
question samples: 10
problems: 0
```

* **Scoring**: 8 roll sequences (including 12 strikes = 300, a 167 mixed game,
  all-spares, all-ones, all-gutters, tenth-frame bonus cases) — rolls, frame
  bounds, marks, cumulative totals, current/total score, completion, current
  frame and standing-pin counts all identical.
* **Challenges**: for all ten challenges — the solved answer, the display text,
  the rack, the aim point, the launch values the answer produces, the equation,
  the brief, the working and the progressive hints — identical.
* **Questions**: ten sample answers (correct and wrong, numeric with/without
  units, text with aliases) — identical marking, summaries and detail lines.

### 4.3 Browser runs

Scripted through the real game loop in a browser (headless Chromium):

| Check | Result |
| --- | --- |
| Boot → splash → menu → mode picker (6 rows) | pass |
| Classic: 9-pin ball, then 0; scorecard `9 0`, frame advances | pass |
| Trivia: correct answer → throw earned → 9 pins → question 2 | pass |
| Trivia: wrong answer → throw forfeited → question 2, no roll recorded | pass |
| Equation: `0` → “MISSED THE 10 PIN - TOO FAR LEFT” + hint; `1.37` → “PIN 10 DOWN!”; continue → challenge 2 | pass |
| Player vs Bot: human frame → handoff → hard bot bowls a **strike** → turn returns | pass |
| Local Multiplayer: 4-player rotation; frame end → handoff banner → confirm | pass |
| BowlRush: clock ticks only while eligible; result → handoff | pass |
| Pause overlay: RESUME, 4 buttons, sim frozen | pass |
| Physics Lab: BOWL → rolling → settling → “9 PINS”; scrub to t=0.04 s (paused); RESET → idle, 10 standing | pass |
| Settings: 9 rows; cycling input/arm/volumes writes and applies | pass |
| Webcam with no camera: reports unavailable and switches to mouse | pass |
| Reduce motion: roll completes, effects suppressed | pass |
| Mouse drag → throw: 5.4 m/s, yaw +2.0°, hook −0.69 rad/s → real roll recorded | pass |
| Audio: 18/18 buffers decode; context running | pass |
| Console: no uncaught errors after the full sweep | pass |

### 4.4 Visual comparison

Frames captured from the browser canvas were compared against the original's own
screenshots in `docs/screens/` (splash/menu/ready/rolling/deck). Framing, lane
and neon colours, pin look, ball crackle, avatar placement and the city facade
were matched; that comparison drove three real fixes: the horizontal mirror,
the gamma/washed-out colours, and a facade texture that had degenerated to no
windows for its seed.

---

## 5. Known differences

These are the places where the browser build cannot be byte-identical, all of
them cosmetic or environmental:

1. **Letterboxing instead of re-anchoring.** The original recomputes every UI
   position from the live window aspect ratio. The browser build lays out on
   the 1280×720 reference grid and scales the whole stage to fit the window
   (letterboxed). At 16:9 — the original's default window — the picture is
   identical; at other aspect ratios the original would reflow while the
   browser build letterboxes.
2. **Webcam pose runs in the browser's MediaPipe build.** Same model, same 33
   landmarks, same thresholds; the underlying inference runtime differs
   (MediaPipe Tasks Web vs the Python Tasks API). It is exercised whenever a
   camera is present; in this headless environment only the no-camera fallback
   could be verified.
3. **Hand menu navigation** remains experimental and off by default, exactly as
   in the original; it is ported but not human-verified.
4. **Audio** is the original's synthesised WAV output played through Web Audio
   rather than generated at runtime (Python's `wave`/`struct` synthesiser has no
   browser runtime). The samples are identical.
5. **Timing granularity.** The original frame hook uses Panda3D's frame delta;
   the browser build uses `requestAnimationFrame` deltas with the same 0.1 s
   clamp, plus a timer fallback for throttled/hidden tabs (a little extra
   robustness, no gameplay change — the deck integrates on its own fixed
   sub-steps either way).
6. **Popup/persistence details.** Settings live in `localStorage` instead of
   `settings.json`, and the in-game webcam feed is a `<video>` element with a
   canvas skeleton overlay instead of a Panda3D RAM texture.
7. **`F12` screenshot** downloads a PNG of the 3D canvas (the DOM UI is not part
   of the canvas; the original captured the whole window).

Nothing in the game's rules, physics, scoring, controls, modes or content was
changed, simplified or omitted.

---

## 6. Running and deploying

### Local

The site is static. Any static server works from the repository root:

```
python tools/serve.py 8124        # a no-cache static server for local testing
# then open http://127.0.0.1:8124/
```

(Any other static file server is fine; a server is needed because ES modules
cannot be loaded from `file://`.)

### Vercel

`vercel.json` deploys the repository root as a static site:

```json
{ "framework": null, "buildCommand": null, "installCommand": null,
  "outputDirectory": ".", "cleanUrls": true, "trailingSlash": false, "headers": [...] }
```

No build step and no install step run: the repository *is* the site. `.vercelignore`
keeps the original Python game, the docs and the verification tools out of the
upload, so the deployed tree is `index.html`, `vercel.json`, `src/`, `vendor/`
and `assets/` only.

**Automatic deployments from GitHub:** import the repository in Vercel
("Add New… → Project"), pick the repository, and leave the framework preset on
"Other"/"No framework". Vercel will then deploy every push to the production
branch automatically and every pull request as a preview. There is nothing else
to configure — no environment variables, no build settings. This is the one step
that has to be done in the Vercel dashboard; it cannot be performed from the
repository.

**Verifying the production artefact locally:**

```
python tools/vercel_sim.py 8130              # exactly the deployed file set
python tools/vercel_sim.py 8130 --with-tools # the same, plus tools/ so the audit can load
# then open http://127.0.0.1:8130/
```

### Verification tools

```
node   tools/js_tests.mjs                              # 72 logic regression tests
python tools/serve.py 8124                             # then, in the page:
#   (0, eval)(await (await fetch('/tools/browser_audit.js')).text())
#   await window.hellsAuditRun()                       # 67 in-browser checks

python tools/fidelity_dump.py  tools/physics_py.json   # original physics
node   tools/fidelity_run.mjs  tools/physics_js.json   # browser physics
node   tools/fidelity_compare.mjs tools/physics_py.json tools/physics_js.json

python tools/fidelity_dump2.py tools/logic_py.json     # scoring/challenges/questions
node   tools/fidelity_run2.mjs tools/logic_js.json
node   tools/fidelity_compare2.mjs tools/logic_py.json tools/logic_js.json

python tools/webcam_parity_dump.py tools/webcam_parity_py.json   # webcam pipeline
node   tools/webcam_parity_run.mjs tools/webcam_parity_js.json
node   tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json

node   tools/check_methods.mjs                         # port sanity check
python tools/dump_facade.py                            # original facade stats
```

### 4.5 Webcam pipeline parity vs the original Python

```
> python tools/webcam_parity_dump.py tools/webcam_parity_py.json
> node   tools/webcam_parity_run.mjs tools/webcam_parity_js.json
> node   tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json
cases compared: 16
mismatches: 0
```

Each case replays one landmark sequence through both detectors and compares the
*per-frame* state (smoothed hand offsets, both smoothed and raw velocities, the
lateral velocity, the hand-source fallback, the swing phase, `rise`/`depth`/
`peak`, the release decision) and the recognised releases with the `ThrowData`
they map to. Sequences: recorded jumping-jacks/burpees footage and recorded
waving (from `tools/webcam_landmarks.json` / `webcam_wave_landmarks.json`),
plus synthetic still, lean, walk, casual waving, a slow and a fast full swing,
a left hook, a right hook, a straight release, a short swing, a mid-backswing
occlusion (finger-landmark fallback), tracking loss mid-swing, three repeated
swings and an arm switch. The same comparison runs inside `tools/js_tests.mjs`
against the committed `tools/webcam_parity_py.json`.

> **Correction (2026-10-16).** The fixture historically described here as a
> "recorded real swing" is exercise footage (Wikimedia *Jumping jacks and
> burpees*), and the legacy detectors release on it in both languages. Parity
> is therefore a statement about the two implementations agreeing, not about
> recognizing bowling. The browser release authority is now the temporal
> classifier (`src/input/classifier.js` / `input/classifier.py`), which is
> evaluated against labeled traces (`tools/webcam_eval.mjs` /
> `tools/webcam_eval.py`) and does not release on that footage. See
> `docs/WEBCAM_SWING.md`.

## 7. Remaining issues

* **Webcam release timing on a real human swing** is verified against recorded
  footage rather than a live human in front of this machine's camera. That
  footage is two *negative* motions (exercise and waving); the positive
  evidence is synthetic only, and a real deliberate bowling swing in front of
  a live camera has **not** been verified in this repository. The manual
  procedure is in `docs/WEBCAM_MANUAL_TEST.md`. The old "short swing" path
  that a fast hand wave from the ready pose could satisfy has been removed:
  the classifier requires a settled wind-up and a sustained expanding forward
  stroke, and the legacy phase machine is no longer the release authority.
* **The browser deployment is configured but not live-verified.** No Vercel
  credentials or linked project exist in this environment, and the GitHub remote
  is not reachable from it, so the repository-side configuration is complete and
  the production file set is verified locally (`tools/vercel_sim.py`) but no
  live URL has been checked.
* **MediaPipe still comes from a CDN.** The webcam mode imports
  `@mediapipe/tasks-vision` from jsDelivr on first use (the worker engine
  `importScripts` its wasm loader through a shim, because the package ships no
  classic bundle); the pose model itself
  (`assets/models/pose_landmarker_lite.task`) is local. If that CDN is
  unreachable the game reports "Webcam unavailable" and switches to mouse, which
  is the same path a missing camera takes.
* The original's Python test suite (378 tests) still applies to the Python
  code; it was not ported to JavaScript (the full Python suite also takes about
  30 minutes). The browser build's assurance is the fidelity diff suites
  (physics, scoring/challenges/questions, **and the webcam pipeline**), the
  regression suite `tools/js_tests.mjs` and the in-page `tools/browser_audit.js`
  + `tools/dom_audit.js`, which compare the ported logic against the Python
  originals and drive the real page respectively.

## 8. Webcam, UI and interaction repair pass (October 2026)

A later pass rebuilt the browser tracking pipeline around the original's
behaviour and fixed the UI defects that pass found. It is documented in full in
`docs/REPORT_WEBCAM_UI_PASS.md`; the short version:

* **Pose inference moved off the render thread** (`src/input/pose_worker.js`).
  The main thread captures one frame per *new* camera frame as an
  `ImageBitmap` and transfers it to the worker; the worker owns the
  MediaPipe landmarker (GPU, falling back to CPU) and posts results back. If
  workers cannot load the model, the identical engine runs on the main thread
  paced by `currentTime` polling; a worker that dies mid-session also falls
  back, so webcam mode never drops to mouse-only because of the engine.
* **Frame timestamps drive the detector.** Snapshots carry `frame_time` and the
  swing detector is stepped with the delta between the *camera* frames it is
  fed, not with the render-frame delta.
* **Parity with the Python reference is a test, not a claim**:
  `tools/webcam_parity_dump.py` → `tools/webcam_parity_run.mjs` →
  `tools/webcam_parity_compare.mjs` compare 16 sequences (recorded real swings
  and waving, plus synthetic still/lean/walk/wave/slow/fast/hook-left/
  hook-right/short/occluded/lost/repeated/arm-switch cases) frame by frame:
  smoothed positions, velocities, hand-source switches, phases, release frames
  and the final `ThrowData`. Result: **0 mismatches**.
* **UI**: the mode picker's detail panel now fits its content the way the
  original does (squeeze, then drop trailing rule chips - never clip or
  overlap); the mode rows, steppers, gear, check badge and hint arrows use the
  original's ported vector icon set instead of text glyphs; buttons and rows
  have hover/pressed/focus feedback and respect reduced motion; screens fade
  and rise briefly.
* **Text selection**: the stage is `user-select: none` with `mousedown` /
  `selectstart` / `dragstart` suppressed outside real text fields, so dragging
  to aim no longer highlights HUD labels; name/answer fields keep normal
  selection, focus and typing.
* **Audits**: `tools/dom_audit.js` now also flags content escaping a clipping
  panel, text hidden behind an overlay, and text under a video/canvas, with
  documented whitelists for intentional layering (backdrops, glows).
