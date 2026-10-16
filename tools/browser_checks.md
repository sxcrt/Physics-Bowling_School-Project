# Browser verification checks

The browser build has no bundler and no test runner, so the DOM/three.js layer
is verified by driving the real page. This file records the sweep and provides
a self-contained check you can paste into the browser console.

## Tools

* `tools/dom_audit.js` — paste it into the DevTools console (or evaluate it over
  CDP) and call `hellsAudit()`. It returns layout defects for the current
  screen: elements outside the 1280×720 stage, leaf text overlapping other leaf
  text, text clipped by its own box, content that escapes (and is clipped by) a
  scrolling/hidden ancestor, text hidden behind an opaque overlay (or under a
  video/canvas), and buttons whose centre is not hit-testable. Intentional
  layering is whitelisted by name (`.screen-dim`, `.screen-vignette`,
  `.brand-glow`, `.hint-strip`) and anything `pointer-events: none` is never
  treated as obscuring text. Read-only.
* `tools/browser_audit.js` — call `await window.hellsAuditRun()` for the full
  87-check regression sweep: the held RIGHT SHIFT scorecard, its agreement with
  the scoring engine as rendered, focus-loss handling, multiplayer cards,
  pins-mode cards, the shadow pipeline, every screen's layout, the modal
  overlays, viewport fit/centring/no-scroll, fullscreen wiring, and the
  webcam-diagnostics on/off gating. It mutates the game; run it on a throwaway
  load.
* `tools/webcam_fixture_check.js` — call `await window.hellsWebcamFixtureRun()`
  to drive the real `TrackingService` + `WebcamInput` + validator + game loop
  with replayed landmark traces behind a canvas `captureStream` camera: a
  scripted deliberate swing must launch exactly one ball, recorded jumping
  jacks must be recognized but refused, and recorded waving must launch none.
  (It forces the main-thread pose engine, since the worker owns its own model.)
* `tools/snapshot.js` — defines `hellsSnap(name)` and
  `hellsSnapZoom(name, x, y, w, h, scale)`, which composite the WebGL canvas and
  the DOM UI and POST the JPEG to `tools/snap_server.py`
  (`python tools/snap_server.py 8899 ./snaps`). The UI layer is rasterised by the
  browser itself through an SVG `<foreignObject>` — **not** by html2canvas, which
  re-implements layout and both misplaced absolutely positioned panels and
  dropped spaces inside words, so its output could not be trusted. The
  composite works in a background tab, where a screenshot cannot be taken.
* `tools/vercel_sim.py 8130` — serves exactly the file set Vercel would deploy,
  with the same redirects and cache headers, so the production artefact can be
  loaded and audited locally.
* `tools/serve.py 8124` — the no-cache static server used for development runs.

## Running the sweep

```bash
python tools/serve.py 8124        # or any static server from the repo root
```

Open <http://127.0.0.1:8124/>, wait for the splash, then in the console:

```js
(0, eval)(await (await fetch('/tools/browser_audit.js')).text())
await window.hellsAuditRun()      // console.table of 87 checks
```

`tools/browser_checks.md` (this file) records what each pass found.

```js
async function browserAudit() {
  const app = window.__hellsBalls;
  const game = app.game;
  const step = (n) => { for (let i = 0; i < n; i++) app.update(1 / 60); };
  const until = (pred, limit = 40000) => { let g = 0; while (!pred() && g < limit) { step(1); g++; } return g < limit; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message), true);
  const results = [];
  const check = (name, ok) => results.push([name, !!ok]);
  const hittable = (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || (hit && el.contains(hit));
  };

  // click routing: splash background click starts the game
  app.screens.set('splash'); app.screens.get('splash').AUTO_ADVANCE = 9999; step(2);
  app.screens.get('splash').root.querySelector('.screen-dim')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  step(2);
  check('splash click starts', app.screens.active.name === 'menu');

  // in-game DOM controls are hit-testable
  app.startMatch('classic', [{ name: 'AUDIT' }]); step(2);
  game.pause(); step(1);
  check('pause buttons hittable', game.pause_overlay.buttons.every(hittable));
  game.resume(); step(1);

  // no ghost avatars after a 2-player match
  app.startMatch('local', [{ name: 'A' }, { name: 'B' }]);
  app.startMatch('classic', [{ name: 'A' }]); step(2);
  check('one avatar visible', Object.values(game._avatars).filter(a => a.visible).length === 1);

  // handoff click confirms the turn
  app.startMatch('local', [{ name: 'A' }, { name: 'B' }]);
  game._enter_handoff(); step(2);
  window.dispatchEvent(new MouseEvent('click', { clientX: 640, clientY: 400, button: 0, bubbles: true }));
  step(2);
  check('handoff click confirms', game.state === 'ready');

  // trivia: space is typeable and a background click continues
  app.startMatch('trivia', [{ name: 'T' }]); step(2);
  for (const ch of 'the ball') window.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
  check('space is typeable', game.answer_text === 'the ball');
  game.answer_text = 'momentum';
  game.submit_answer(); step(2);
  window.dispatchEvent(new MouseEvent('click', { clientX: 640, clientY: 700, button: 0, bubbles: true }));
  step(2);
  check('background click continues', game.state === 'ready');

  // results overlay: count-up reaches the final score and the menu button works
  app.startMatch('classic', [{ name: 'R' }]);
  game.score.rolls = Array(18).fill(0).concat([7, 2]);
  game._finish_match(); step(100);
  check('results count up', game.results_overlay.totalScore.textContent === '9');
  game.results_overlay.buttons[2].click(); step(2);
  check('results main menu works', app.screens.active.name === 'menu');

  // lab controls are hittable and BOWL starts a run
  app.goToLab(); step(2);
  const lab = app.screens.get('lab');
  const button = (label) => [...lab.root.querySelectorAll('.ui-button')].find(b => b.textContent === label);
  check('lab buttons hittable', ['BOWL', 'PAUSE', 'RESET'].every(l => hittable(button(l))));
  button('BOWL').click(); step(60);
  check('lab bowl starts', lab.state === 'rolling');
  button('RESET').click(); step(2);

  // the stage scales to fit instead of distorting
  const sr = app.stage.getBoundingClientRect();
  const scale = Math.min(innerWidth / 1280, innerHeight / 720);
  check('stage fits the window', Math.abs(sr.width - 1280 * scale) < 2 && Math.abs(sr.height - 720 * scale) < 2);

  // physics: a straight throw is recorded through the real loop
  app.startMatch('classic', [{ name: 'P' }]); step(2);
  game.launch({ lateral_position: 0, launch_angle: 0, speed: 7.5, spin_omega: 0, source: 'script' });
  until(() => game.state === 'ready', 8000);
  check('a roll is recorded', game.score.rolls.length === 1);

  check('no console errors', errors.length === 0);
  if (errors.length) console.error('console errors:', errors);
  console.table(results);
  return results;
}
```

## What was verified in the audit (Chromium, 2026-10-15)

| Area | Evidence |
| --- | --- |
| Boot / splash / click-to-start / auto-advance | DOM + screenshot |
| Menu, How to Play (4 tabs), Settings (9 rows, persistence), Quit | DOM clicks, keyboard |
| Mode picker: all six modes, player counts 1/2/2/2-4, bot level, duration | DOM clicks |
| Classic: complete 10-frame game through real pointer drags, scorecard, results, rematch | 20 rolls recorded, results screen |
| Trivia: correct/wrong marking, throw gate, 10 questions, results lines | state + DOM |
| Equations: challenge panel, miss → hints, solved → next, BOWL IT / SHOW SOLUTION / CONTINUE | DOM clicks + real deck |
| Player vs Bot: bot plans and bowls through the real simulation (Easy/Medium/Hard) | bot frame bowled |
| Local 2-4 players: rotation, handoff banner, ENTER and click confirm | state + DOM |
| BowlRush: countdown ticks only while eligible, in-flight roll finishes after time-out | state |
| Pause / resume / restart / settings-from-pause / quit-to-menu | DOM + keyboard |
| Physics Lab: BOWL, PAUSE, RESET, scrubbing, equation rows, load last throw, back | DOM + state |
| Mouse input: aim (frozen during drag), A/D lateral, drag→speed/yaw/hook, gates | real pointer events |
| Keyboard: R (rack), H (physics readout), P/ESC (pause), TAB/1/2 (input), C (arm), F12 (screenshot) | key events |
| Webcam fallback (no camera): reports unavailable and switches to mouse | state + message |
| Audio: 18 WAVs decode, cues fire on release/result | `audio.available`, `audio.played` |
| Reduce motion: no flash/shake/pulse, rolls still complete | state |
| Hand navigation: dwell cursor clicks the control under it | simulated landmarks |
| Console / network: no uncaught errors; all requests < 400 | DevTools APIs |

## Second exhaustive pass (Chromium, 2026-10-15, later the same day)

The first pass verified structure and behaviour but not the rendered layout.
This pass added `hellsAudit()` (geometry/overlap/hit-test) and
`hellsSnap()` (composited visual captures) and re-audited every screen at the
reference 1280×720 stage plus 800×600, 1024×768, 1920×1080 and 2560×1440
fits. Defects found and fixed (all in `src/`):

* the play HUD painted over the splash/menu screens from boot (the play UI
  root now starts hidden);
* the centred status line was translated another −50 % off-stage, clipping
  every in-game status (`Ready to throw`, `Paused`, `STRIKE!`, …);
* the scorecard computed a negative cell height from its `(left, right, top,
  bottom)` area, so the frame cells collapsed to a 14px strip;
* the Settings screen overflowed past the bottom of the stage and the BACK
  button overlapped its last two rows; it is now the original's two-panel
  layout (controls | audio) with CAMERA INDEX, real volume sliders, the
  "Changes are saved automatically" note and BACK at the bottom-left;
* the Equation Challenge panel placed text blocks from guessed increments and
  clipped its own brief; it now measures every block (like
  `ui/challenge_panel.py`), clamps the brief to 4 lines and the feedback to
  the room left, and its plate wraps the placed content;
* the Trivia panel pushed CONTINUE and the footer past the bottom of the
  stage on long feedback (and measured hidden feedback lines as 0 px high);
  the buttons are now pinned to the panel's own bottom edge and the prompt is
  clamped to two lines while marked;
* the mode-picker rule chips were a vertical stack with no selected-row check
  badge and no "No extra setup" note; the name fields overflowed the detail
  panel at 4 players (now two per row, like `_setup_rows`);
* "← → menu …" style hint bars were bare text (now the original's key caps on
  the 72 px fade strip);
* How to Play kept a static "HOW TO PLAY" title, a white active tab, a
  wrapping NEXT and no DONE/PREVIOUS-disabled states;
* the Lab's LIVE hint sat under the title instead of on the same line, the
  timeline had no TIMELINE caption with the scrub track wider than its bar,
  the panels were narrower than the original's and the result banner overlapped
  the title;
* the per-pin "+1 PIN!" pops shared one tween tag, so each new pop cancelled
  the previous pop's hide and left stale stamps on screen;
* the results overlay ignored its reserved block, so the table printed over
  the big final score;
* the SCORE chip (top-right while a question/challenge is up) was missing;
  the physics readout printed six lines instead of the original's three;
* the pin-rack triangle was four times too large and in the wrong corner.

Re-run after the fixes: `hellsAudit()` clean on every screen/state above (the
only remaining geometry note is the status line sitting over the player chips
in multiplayer, which is what `ui/hud.py` itself does), no console errors, no
failed requests, all 62 JS regression tests and both Python-fidelity diffs
still green.

## Third pass: rendering, scorecard, layout and deployment (Chromium, 2026-10-16)

This pass was a visual overhaul rather than a structural one. The evidence path
also changed: html2canvas was replaced by a `<foreignObject>` rasteriser in
`tools/snapshot.js` after two of its defects were traced to the capture itself
(it placed the scorecard panel at two-thirds of its real width, and dropped
spaces inside words, so neither layout nor text could be read from a snapshot).
`tools/browser_audit.js` (66 checks) was added, and every claim below was checked
with a snapshot, a DOM measurement, or an audit entry.

Root causes found and fixed:

* **No shadows existed at all.** The renderer never enabled the shadow map, no
  light cast one, and no surface sampled one, so the ball, the pins and the
  bowler were unlit cut-outs floating on the lane.
* **The contact-shadow decals were standing on edge.** `discGeometry` already
  lies flat in the XZ plane, and the ball, every pin and the bowler then applied
  `rotation.x = -Math.PI/2` to it, which tipped each decal vertical — the one
  thing that was supposed to ground the objects was invisible edge-on.
* **The lane markings were laid out wrongly.** `ARROW_WIDTH` (0.16 m) exceeded
  `ARROW_SPACING` (0.1524 m), so the seven targeting arrows overlapped into one
  black zig-zag band, and the approach dots were 7 cm wide.
* **The top of every frame was empty black.** `CEILING_COLOR` existed in the
  config but no ceiling was ever built, so the alley had no roof.
* **The scorecard was a strip of ten unmarked boxes**: one frame number per cell
  and no roll boxes at all, 50 px tall, sitting under a status line that
  overlapped it.
* **The scorecard could not be read at all in multiplayer**, because the HUD
  hid it whenever `match.player_count > 1`.
* **The HUD status overlapped the player chips** in every multiplayer mode.
* **Menus were unreadable over the lane**: the veil was 55 % and the lane wood
  is the brightest thing in the scene, so "INPUT" and the segmented control sat
  on top of it.
* **The results overlay printed "Match over" through its own panel**, because
  the play HUD stayed visible behind modal overlays.
* **The handoff banner duplicated its own heading** ("Next bowler" in both the
  HUD status and the banner) and clipped the third line of every player chip.
* **Two-player HUD chips stretched across 600 px** of empty plate.
* **The deployed site depended on a third-party CDN.** A jsDelivr `502` for
  `three.module.js` blanked the page during verification; three is now vendored
  in `vendor/three/`, and `index.html` shows a readable boot message instead of
  an empty stage if a module still fails.
* **The import map was invalid** in its first vendored form: Chromium requires
  import-map values to be absolute or `./`-relative, and silently drops a bare
  relative path ("Ignored an import map value … Bare specifier").

After the fixes: `hellsAuditRun()` reports **67/67 pass** on both the dev server
and `tools/vercel_sim.py 8130` (the deployed file set), `hellsAudit()` is clean
on every screen and play state, 72 Node regression tests pass, and both
Python-fidelity diffs still report 0 mismatches.

## Fourth pass: webcam-to-throw repair (Chromium/Electron, 2026-10-16)

The webcam pipeline had never been exercised with real landmark data. This pass
verified it with recorded MediaPipe traces, fixed the browser-runtime defects and
added regression coverage:

* `tools/export_landmarks.py` exports a recorded pose trace (the same model the
  browser uses) plus the Python reference detector's phase timeline from real
  footage; `tools/js_tests.mjs` replays it through the browser detector and
  asserts the identical phase sequence and release (see the
  `webcam real-landmark fixtures` section).
* `tools/webcam_fixture_check.js` drives the **real** `TrackingService`,
  `WebcamInput`, detector, game and physics in the page: the camera boundary is
  a canvas captureStream and the landmarker replays the recorded trace. All six
  checks pass on `tools/vercel_sim.py 8130 --with-tools`:
  recorded swing launches a ball (once, `source: webcam`, finite parameters),
  the phase machine arms/wings, and waving never throws.
* Live verification with the actual MediaPipe runtime (GPU delegate, jsDelivr
  wasm + the shipped model) on the burpees video through `getUserMedia` →
  service → game: phase timeline `waiting→ready→…→forward`, single ball launch
  at t≈10.8 s, 25–37 fps, no console errors.
* Lifecycle, verified in the page with a stubbed camera: entering webcam mode
  starts the tracker (live track, frames flowing); switching to mouse ends the
  track, freezes the loop and releases the camera; re-entering starts a fresh
  tracker; the real (denied) browser camera surfaces a permission message with
  recovery steps, falls back to mouse, and retrying re-attempts and re-reports.

Run in the page console (throwaway load):

```
(0, eval)(await (await fetch('/tools/webcam_fixture_check.js')).text())
await window.hellsWebcamFixtureRun()
```

## Fifth pass: fullscreen, accidental webcam throws, HUD diagnostics (Chromium, 2026-10-16)

Investigation of the reported accidental webcam throws found the root cause in
the fixture set itself: `tools/webcam_landmarks.json` was exported from
*Jumping jacks and burpees* footage and the phase machine released a ball on
it (the previous pass recorded that launch as a success). Python-parity alone
could never catch this, because the Python reference fires on the same motion.

What changed and what was verified:

* **Temporal movement classifier** (`src/input/classifier.js`, replacing the
  earlier `src/input/validate.js` gate): a throw requires the full
  tracking -> ready -> backswing -> forward -> release sequence with a settled
  wind-up, sustained expanding stroke, one-arm dominance, bounded body motion
  and dense tracking; the recorded exercise trace no longer even reaches a
  release (0 classifier releases, 0 launches). The legacy detector
  (`src/input/swing.js`) is unchanged and still parity-true (16 sequences,
  0 mismatches), and the classifier is evaluated separately against 57 labeled
  traces in both JavaScript and Python (`tools/webcam_eval.mjs` /
  `tools/webcam_eval.py`).
* **Input lifecycle guards**: repeated/rewound camera frames are never fed to
  the detector and a run of them cancels the swing; the tracking service
  numbers its camera sessions and `WebcamInput` resets the swing on a session
  change, an arm switch, `setGameReady`, or a stop/start, so no restart can
  inherit an incomplete swing.
* **HUD cleanup**: the webcam chip now shows only tracking/phase/arm/hint; the
  engine delegate, confidence, fps, frame time, inference time and detector
  telemetry moved behind **Settings → DEVELOPER DIAGNOSTICS** (off by default,
  cleared when turned off). Diagnostics cannot render on menus, results, the
  Lab, or mouse-input games (asserted by token sweeps over `#ui-root`).
* **Fullscreen**: `src/ui/fullscreen.js` (feature detection, bounded requests,
  change events) plus visible FULLSCREEN/EXIT FULLSCREEN controls on the
  splash, main menu and pause overlay and an Alt+Enter shortcut; the stage
  re-fits on `fullscreenchange`, resize, orientation change, browser zoom and
  `visualViewport` changes (the pointer mapping reads the stage rect, verified
  to map the stage centre to UI (0, 0) at 800×600…3440×1440).

Evidence on the dev server and on `tools/vercel_sim.py 8130 --with-tools`:

* `node tools/js_tests.mjs` → **117 passed, 0 failed** (26 new: the full
  negative movement matrix, both recorded fixtures through the input layer,
  stale frames, session restart, arm switch, mouse→webcam return, duplicate
  prevention, hooks/intensity, plus a tracking-session lifecycle test).
* `await window.hellsAuditRun()` → **87/87 checks pass** (fullscreen wiring
  with a stubbed browser API, viewport fit/centring/no-scroll, diagnostics
  on/off, every screen and play state).
* `await window.hellsWebcamFixtureRun()` → **8/8 pass** on the production file
  set: a scripted one-arm swing launches exactly one ball, the recorded
  jumping-jacks trace is *recognized by the detector but refused* (0 launches),
  recorded waving launches nothing.
* `python tools/webcam_parity_dump.py` + `webcam_parity_run.mjs` +
  `webcam_parity_compare.mjs` → 16 sequences, 0 mismatches.
* `python -m pytest tests/test_swing.py tests/test_swing_release.py
  tests/test_webcam_input.py tests/test_tracking.py tests/test_release_model.py
  -q` → 150 passed (Python reference unmodified).

Not verified here: a real fullscreen entry triggered by a physical click
(the harness browser receives no OS input events in this environment; the
request path is covered with a stubbed API and the graceful-failure path with
a real rejected request), and a live human bowling swing in front of a real
camera.


