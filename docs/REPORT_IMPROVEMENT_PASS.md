# Hells Balls - gameplay, UI/UX and physics improvement pass

> **Historical note.** This document records an earlier pass. Its Equation
> Challenge (a marked quiz whose correct answer earned a *separate* throw) was
> replaced by the interactive challenge system in a later pass: see
> `docs/REPORT.md` Part 2 and `docs/MODES.md`. Everything else here still
> describes the current game.

This is the report for the improvement pass on the existing Hells Balls
project. It records what was actually changed, what was verified by running
the game, and what remains. Every claim below was checked against the running
code or the test suite; where something could not be verified, it says so.

## A. Summary

The pass fixed the reported problems in four areas:

1. **Nothing was clickable.** Two independent faults: (a) `ui_pointer()`   trusted Panda3D's "in-window" flag, and when a window has not received
   pointer events that returns `0` for **both** axes - the centre of the
   screen - so every click landed there and every drag recorded zero speed;
   (b) `SettingsScreen`, `ModeSelectScreen`, `HowToPlayScreen`, `LabScreen`
   and the play screen overrode `on_key` and never routed
   `'left mouse down'` to their widgets, so their buttons ignored the mouse
   entirely. Both are fixed at the root (`input/pointer.py` plus click routing
   in `ScreenManager`), and there are now tests that click through the real
   input path and assert the state change.
2. **The visual experience.** A real type/spacing scale replaced 20-odd ad-hoc
   font sizes, the main menu became a proper front door with the lane, the
   character and one primary action, the mode picker became a card grid with a
   detail panel and a mode-specific setup panel, the HUD lost its clutter, and
   the Physics Lab / Settings / How-to-play / overlays were rebuilt on the same
   system. The unsupported arrow glyphs (which rendered as boxes) are gone.
3. **Controls and physics.** Position (A/D), direction (pointer aim + the
   drag's own direction) and curvature (the drag's sideways speed -> hook) are
   now three separate, documented inputs that all reach the shared simulation.
   The hook is strong enough to be visible (up to ~0.5 m of curve) and the
   ball's real path is drawn as a fading trail, so the curve is unmistakable.
4. **Equation Challenge.** The bank is now bowling physics - the lateral
   velocity that reaches a pin, the launch angle that lines it up, the speed
   left at the head pin, hook slip, momentum/impulse - organised into five
   cases with progressive hints like the step-by-step calculator case studies
   it was modelled on, and every answer is recomputed from its own displayed
   numbers by an independent test.

A reported bug was reproduced and fixed as well: **a strike looked as if it
did not count** (see B1). The scoring was correct - a strike's score waits for
the bonus rolls - but nothing on screen moved, so the HUD now shows the pins
knocked down immediately (and names the bowler in multiplayer).

Two long-standing bugs were also found and fixed while verifying:
* **The avatar was never rendered.** `Bowler(parent=None)` passed an explicit
  `None` into ursina's `Entity`, which leaves the node detached from the render
  graph. The character was built, animated and reported "visible" for several
  milestones and never appeared on screen. It is now in the scene, and its
  geometry was rebuilt from tapered prisms and faceted spheres into a proper
  low-poly person with a face (it used to be a stack of cubes and spheres).
* **Player-vs-Player / Local Multiplayer / BowlRush thought they had one
  player.** `ModeDefinition.fixed_players` defaulted to `1`, so
  `player_range` returned `(1, 1)` for every non-mode that did not override it,
  which hid the player-count control and started those modes with a single
  bowler.

## A2. Note on concurrent work (read this first)

While this pass was being verified, **another writer was editing the same
project**: a new `motion/` package (`director.py`, `hud_fx.py`, `scene_fx.py`,
`score_fx.py`, `effects.py`, `tween.py`, `ease.py`) landed and rewrote parts of
`ui/hud.py`, `ui/overlays.py`, `ui/menu_screens.py`, `game/play.py`,
`scene/*` and `input/*` with an animation layer. That work is not mine, and I
have not reviewed it as a whole.

What I did about it:

* my work was left intact (verified file by file: the pointer module, the
  release model, the question bank, the mode/theme/lab changes and my tests are
  all present);
* I repaired the three faults that the concurrent edits left in the running
  game, each with the smallest intent-preserving change:
  1. `ui/overlays.py`: the new `ResultsOverlay.total_glow` used `color.rgba32`
     but `color` had been dropped from the ursina import - the class raised
     `NameError` and the whole app failed to build (added the import);
  2. `motion/scene_fx.py`: `RackResetFX.__init__` did `list(pins or [])` while
     the caller passes a `PinRack` (not iterable) - `bind()` now accepts a rack
     or an explicit list, which is what the class's own docstring describes;
  3. `motion/hud_fx.py`: `KeyChips._chip_width` called `len(chip.label)` on a
     `Text` entity (the class keeps the string in `label_text`).
* I adapted my strike readout to the new animated HUD: when the motion layer is
  present it renders the readout (`motion.set_knocked`) and the plain label
  steps aside, so the two layers cannot print the same line twice or collide
  with the pins row.

Everything reported in sections B-L below was verified against the code at the
time of writing; where a result predates the concurrent edits, the test table
in section G says so. The strike fix (B1) and the tests for it were re-run
*after* the motion layer landed.

## B. UI and interaction fixes


### B1. The strike-feedback fix (reported bug)

**The report:** "when there's a strike, it doesn't count anything... it says
strike, but doesn't update the score", specifically in Local Multiplayer.

**What was actually happening.** The scoring engine was right: in ten-pin
scoring a strike's frame score is `10 + the next two rolls`, so the official
running total legitimately does not move until those two rolls are bowled.
Reproduced with a scripted 3-player Local match (every roll a strike on a
fresh rack):

```
roll 0  ALICE  knocked 10  score 0 -> 0   rolls [10]
roll 3  ALICE  knocked 10  score 0 -> 0   rolls [10, 10]
roll 6  ALICE  knocked 10  score 0 -> 30  rolls [10, 10, 10]
```

So the first two strikes showed nothing at all: the top-right `SCORE` stayed
`0`, the player chips stayed `0`, and the scorecard's strike frame has no
number yet (that is what a real scorecard does). The player's strike *was*
recorded (`rolls [10]`, `total_pins 10`), but nothing on screen moved, which is
indistinguishable from "it did not count".

**The fix (feedback, not the rules).** The rules stay standard; the HUD now
shows the thing that does move immediately:

* the top-right block gained a pins line under the score - `10 pins knocked`
  in a single-player match, and `ALICE 10 pins` in a multiplayer match so it is
  clear *whose* pins it is (it follows whoever is up, like the rest of the
  block);
* the multiplayer player chips show each bowler's pins knocked down
  (`10 pins`) instead of the throw count, so a strike moves the striking
  player's chip the moment it lands;
* the strike banner, the scorecard marks (`X`) and the official score are
  unchanged: the official number still appears as soon as the bonus rolls
  resolve the frame, which the scorecard has always done.

Tests: `tests/test_ui_interactions.py::TestStrikeFeedback` (4 tests) asserts
that a strike moves the pins readout, that the chips show the pins, that the
readout names the bowler who is up in multiplayer, and that after three
strikes the official score is exactly 30 - so the fix cannot silently turn into
"score strikes immediately".


### B2. Why the buttons were failing

| Fault | Where | Effect |
| --- | --- | --- |
| The pointer was read from a source that can report "no mouse" | `input/mouse_input.ui_pointer` (used by the old UI) | `mouse.x` and `mouse.y` both return `0`, i.e. the centre of the screen: clicks land there (so a button anywhere else does nothing) and `mouse.velocity` is forced to zero (so no drag ever throws) |
| Screens overriding `on_key` never saw mouse clicks | `ui/screens.py` `ScreenManager.on_key` called only `active.on_key(key)`; `SettingsScreen`, `ModeSelectScreen`, `HowToPlayScreen`, `LabScreen` and `Game` all override `on_key` without calling `super()` | Settings, the mode picker, How to Play, the Lab, the pause/results overlays, the handoff confirmation and the trivia/equation controls were all mouse-dead |
| Hidden widgets consumed clicks | `ui/theme.py` widgets tested `self.enabled` but not `self.visible` | A hidden control stacked on a visible one swallowed the click (the mode picker's three setup steppers all sit at the same spot) |
| Two labels shared one anchor | the mode picker's info panel / the question panel heading | text over the panel edge and over the case label |

### What was changed

* **`input/pointer.py` (new).** One UI-space pointer from three layered
  sources: ursina's pointer when Panda3D reports a mouse, Panda3D's window
  pointer when it moves, and the OS cursor (Windows, via `GetCursorPos` mapped
  through the window rect) as the last resort - keeping the last known good
  position rather than jumping to the centre. The left button has the same
  fallback. There is an override seam for tests.
* **`ui/screens.py`.** `ScreenManager.on_key` now routes `'left mouse down'`
  through `active.on_click(x, y)` for *every* screen before falling through to
  `on_key`, so a screen that overrides `on_key` cannot lose its mouse.
* **`ui/theme.py`.** Every widget (MenuButton, ModeCard, Stepper, Toggle,
  Slider, TextEntry) answers to `widget_active()`: enabled **and** visible; a
  hidden control returns `False` from `click()`.
* **`ui/menu_screens.py`.** Mode cards only *select* (`START` launches); the
  Back/Next/Previous controls are real buttons; the steppers are laid out so
  the caption, value and arrows cannot collide.

### Controls manually verified (real clicks, real window)

| Control | Result |
| --- | --- |
| Main menu: PLAY / HOW TO PLAY / PHYSICS LAB / SETTINGS / QUIT | each opens the screen it names (verified by moving the real OS cursor and clicking through `ursina`'s input hook) |
| Settings: BACK, input/arm/camera steppers, three sliders, three toggles | all act; the values persist to `settings.json` |
| Mode picker: 7 cards, START, BACK, players/bot/duration steppers, name entries | cards select (never launch), START launches the selected mode with the selected configuration, BACK returns to the menu |
| How to Play: NEXT / PREVIOUS / BACK | pages turn both ways, BACK returns |
| Physics Lab: RUN BOTH THROWS, NEXT EQUATIONS, BACK TO MENU, 8 steppers | all act; the run does a real simulation |
| Pause overlay: RESUME / RESTART MATCH / SETTINGS / QUIT TO MENU | all act (this is newly clickable - it was mouse-dead before) |
| Results overlay: REMATCH / OPEN PHYSICS LAB / MAIN MENU | all act |
| Trivia / Equations: SUBMIT and CONTINUE buttons | newly added; clicking SUBMIT marks the typed answer exactly like ENTER |
| Splash: click anywhere / ENTER | goes to the menu (also auto-advances after 6 s) |
| Handoff confirmation click, `R`, `H`, `ESC`, `TAB`, `1` / `2` / `C` | act as documented |

**Remaining unverified:** the QUIT button was clicked in an automated run and
did close the application, but I did not sit in front of the window and click
it by hand; the same is true for every control in this table - they were
driven through the engine's real input hook with the real cursor moved by the
OS, not by a human hand on a mouse.

## C. Visual redesign

* **Design system (`ui/theme.py`).** `TYPE` (six sizes: hero 1.70, title 1.30,
  heading 0.95, body 0.76, small 0.62, tiny 0.52) and `SPACE` (five gaps)
  replace the twenty-odd ad-hoc font sizes; `theme.ModeCard`,
  `theme.screen_header` and `theme.widget_active` give the screens one look.
  `MenuButton` gained `text_scale` (the primary action is simply bigger) and
  the unsupported arrow glyphs were removed (they rendered as boxes).
* **Main menu.** The sign, one large PLAY bar, a row of the three secondary
  destinations, a small QUIT in the corner, and the lane + character visible
  behind it. The decorative lane-centre ball (which collided with the input
  control) is gone: the character holds a ball instead.
* **Mode selection.** Seven cards in a 4+3 grid, each with a colour chip, the
  mode's name and a one-line summary ("Play a complete ten-frame bowling
  game."), a SELECTED marker and a bright border for the current choice; below
  it, a detail panel (title, subtitle, description, up to three rules) and a
  setup panel that only shows the controls the selected mode actually uses
  (players for PvP/Local, bot level for PvBot, duration for BowlRush, names
  where editable, and a note otherwise). START and BACK are large and clear.
* **Setup screens.** The setup lives in that panel, so the player configures
  the mode they just picked instead of a row of unrelated controls.
* **Gameplay HUD.** A slim top bar (mode + player on the left, scorecard in
  the middle for frame modes, score/frame/ball/pins on the right), one status
  line, and a bottom bar with the input badge and the two control lines. The
  physics numbers moved into a compact three-line panel in the corner that `H`
  hides, and the frame-by-frame details belong to the Physics Lab.
* **Equation Challenge / Trivia.** The question now has room: case label,
  question number, wrapped problem statement, givens, the equation with the
  unknown, a framed answer field with a caret, and (newly) a SUBMIT button;
  after marking, the same space carries the progressive hint steps, the worked
  solution and a "why it matters" line, with a CONTINUE button.
* **Settings.** Two columns ("Controls and gameplay" / "Audio and display")
  with consistent spacing and a Back button; nothing is nested in a box in a
  box.
* **Physics Lab.** Header, then two equal columns (launch conditions with the
  trajectory plot under them / simulated results), then a full-width equation
  strip with NEXT EQUATIONS. The old build drew the equations over the run
  button and the plot; the panels are now measured from one width so they
  cannot overlap.
* **Pause and results.** Reworked onto wrapped body lines (the text no longer
  runs under the buttons) with a taller panel and the same button style as the
  menus.

## D. Input and physics changes

* **Position (A/D).** Unchanged in spirit: `A`/`D` (or the arrow keys) move the
  release position across the lane, clamped to `LATERAL_LIMIT`; the ball's
  entity and its physics body both follow it while waiting. The velocity is
  computed from the tracked pointer each frame instead of `ursina`'s
  `mouse.velocity`, so it works even when Panda3D's pointer is unavailable.
* **Aim (direction).** The pointer's position as a fraction of the half-screen
  picks the point the ball is sent through at the targeting arrows (4.572 m
  down the lane), so the whole screen sweeps the aim; the yaw is capped at
  `MAX_AIM_ANGLE` (2.0 deg). The aim marker and the intended line are drawn on
  the lane, and the aim is frozen while the button is held.
* **Release direction.** The *direction* of the fastest forward stroke adds a
  yaw: `atan(lateral_speed / forward_speed)` scaled by
  `RELEASE_DIRECTION_GAIN` (0.6) and capped at `MAX_RELEASE_YAW` (2.0 deg). A
  straight stroke adds nothing; a stroke that drifts left releases left.
* **Throw speed.** The fastest forward drag speed over the stroke times
  `THROW_SPEED_SCALE` (1.8 m/s per screen-height/s), clamped to 2-12 m/s, and
  only when the stroke covered `MIN_DRAG_DISTANCE` (0.04 screen heights) - a
  twitch or a slow drag cannot launch the ball.
* **Hook (curvature).** The peak sideways drag speed times `SPIN_SCALE` (now
  3.4) gives the release hook spin, clamped to `+/-5 rad/s`. This is the input
  side of the model documented in `docs/PHYSICS.md`: the release spin about the
  line of travel makes the contact point slip sideways by `R * omega`, and
  kinetic friction against that slip is what bends the path. Measured with the
  project's own simulator: 1 rad/s -> ~0.22 m, 3 rad/s -> ~0.33 m, 5 rad/s ->
  ~0.49 m of lateral drift, which is the realistic range for a house shot.
* **Webcam.** The same three concepts: body position -> the ball's starting
  position (`WEBCAM_AIM_SCALE`), the release hand's cross-body offset -> the
  aim yaw, the swing's sideways hand speed -> both a release-direction yaw
  (`SWING_RELEASE_DIR_SCALE`, new) and the hook spin (`SWING_SPIN_SCALE`), and
  the peak upward hand speed -> the release speed. All four are documented
  heuristics derived from *measured* landmarks, capped, and honest about what a
  frontal camera cannot see (the ball's line and spin axis). The release
  safeguards are untouched.
* **Lateral variation is input-driven.** Two different drags produce different
  release conditions, and identical drags produce identical conditions
  (`tests/test_release_model.py`). A bounded, seeded release-noise hook exists
  (`ReleaseNoise`) but is **disabled by default** (`config.RELEASE_NOISE_*` are
  0.0), so a repeatable input gives a repeatable throw; the tests set a seed
  and prove the noise stays inside its bounds when it is switched on.
* **The trajectory is the simulation's.** `Ball.launch` builds
  `v = (sin yaw, 0, cos yaw) * speed` plus the release spin, the fixed-substep
  `physics.Deck` integrates ball and pins together, and the rendered ball
  mirrors the physics pose (position and orientation). A new fading trail
  records the ball's real path while it rolls, so the intended line (shown
  before the throw) and the actual curved path (shown during and after it) are
  visibly different things. The aim line is not a prediction and does not
  pretend to be one.

## E. Equation Challenge changes

The bank (`game/questions.py`) is now thirteen bowling problems in five cases;
the mode plays the first ten, which spans every case:

| Case | Problems |
| --- | --- |
| 1 - the ball on its way | time to the pins (`t = d / v`), arrival speed (`v^2 = u^2 - 2 a d`) |
| 2 - sideways to the pin | lateral velocity to a pin (`v_x = (x_pin - x0) / (d / v)`), lateral velocity into the pocket |
| 3 - aim and angles | launch angle to a pin (`theta = atan(dx / d)`), lateral velocity from an angle (`v_x = v sin theta`), position at the pins (`x = x0 + d tan theta`), angle from a lateral velocity |
| 4 - spin and hook | hook slip speed (`v_slip = R omega`), rolling spin (`omega = v / R`) |
| 5 - the impact | momentum (`p = m v`), impulse (`J = F t`), pin speed after an elastic hit (`v_pin = 2 m1 u / (m1 + m2)`) |

* **Assumptions are stated per problem.** The lane-plane problems say they use
  a constant forward speed and a constant lateral velocity (no hook), which is
  the same straight-line approximation the aim line draws; the problems that
  use the simulator's own equations (rolling resistance, rolling spin, hook
  slip) say that too. Nothing claims the idealised result predicts the actual
  pinfall - the shared simulation still decides that.
* **Numbers cannot drift from their answers.** Every prompt, given and worked
  solution is generated from the same Python values, and
  `tests/test_questions.py` recomputes each answer from `given_values` with
  formulas written independently in the test file; it also checks that the
  values the formula needs are the ones displayed, that units and alternative
  unit spellings are accepted, that wrong values/units are rejected, and that
  the worked solution contains the answer.
* **Progressive hints.** Each problem carries three hint steps. A wrong answer
  unlocks the next one and keeps the question on screen for a retry; the
  *first* attempt is the one that earns the throw (a wrong first answer
  forfeits it, as specified), and once every step is unlocked the worked
  solution and the expected answer are shown. The panel footer always says
  what ENTER/CONTINUE will do.

An example, with the answers the game accepts:

> **Case 2 - sideways to the pin.** The ball starts on the lane centre,
> x0 = 0.00 m. A pin stands 0.45 m to the right at 17.0 m. The release gives
> 7.0 m/s forward. What lateral velocity reaches the pin?
> * model: constant forward speed, constant lateral velocity, no hook
> * t = 17.0 / 7.0 = 2.43 s; v_x = 0.45 / 2.43 = **0.185 m/s**
> * accepted as `0.185`, `0.19 m/s`, `1.85e-1 m/s`;
>   `0.185 N` is rejected as the wrong unit

## F. Files changed

**New**

| File | Role |
| --- | --- |
| `input/pointer.py` | the layered, fallback-capable UI pointer (the root fix for "the buttons do nothing") |
| `tests/test_release_model.py` | the release model: position / aim / release direction / speed / hook, caps, determinism, the off-by-default noise, and that the input layer cannot set a pin count |
| `tests/test_ui_interactions.py` | clicks through the real input path for every screen and overlay, the pointer fallbacks, the progressive question flow, and an end-to-end scripted drag throw |

**Modified (the important ones)**

| File | What changed |
| --- | --- |
| `ui/screens.py` | click routing for every screen (including screens that override `on_key`) |
| `ui/theme.py` | type/spacing scales, `ModeCard`, `screen_header`, `widget_active` (hidden widgets take no input), `text_scale`, stepper layout |
| `ui/menu_screens.py` | rebuilt splash, main menu, mode picker, How to Play, Settings |
| `ui/hud.py` | slimmer top bar, one status line, input badge in the bottom bar, compact collapsible physics panel, rebuilt question panel with SUBMIT/CONTINUE and progressive hints, `_set_text` (assign text only when it changed) |
| `ui/lab_screen.py` | two measured columns + equation strip (no overlaps), unit-labelled steppers |
| `ui/overlays.py` | wrapped body lines that cannot run under the buttons; taller pause panel |
| `ui/scorecard.py` | cell colours re-assigned only when the cell's state changes (per-frame text/colour churn) |
| `ui/app.py` | the menu character, showcase-ball handling, per-screen avatar visibility |
| `ui/layout.py` | `wrap_text` (wrap instead of shrink) |
| `input/mouse_input.py` | the new release model (self-tracked pointer, release direction, drag-distance floor, `ReleaseNoise`) |
| `input/webcam_input.py` | release-direction component from the measured swing |
| `game/play.py` | question controls wiring, progressive-hint state, `H` physics toggle, aim line + rolling trail, avatar placement, `attempts`/`throw_earned` |
| `game/questions.py` | the bowling equation bank, cases, hints, and the answer/solution generators |
| `game/modes.py` | one-line mode summaries; `fixed_players` default fixed to 0 (the multiplayer one-player bug) |
| `avatar/character.py` | scene parenting fix and a rebuilt low-poly body with a face |
| `scene/geometry.py` | `tapered_box`, `low_poly_sphere`, `cone` |
| `config.py` | aim/release/hook constants, release-noise constants, `POINTER_OS_FALLBACK`, `SPIN_SCALE` up to 3.4 for a visible hook |
| `README.md`, `docs/INPUT.md`, `docs/PHYSICS.md`, `docs/MODES.md`, `docs/TESTING.md`, `docs/VISUALS.md` | controls, calibration table, cases/hints, the new test files, the design system and the character |

Nothing was removed: the physics engine, scoring, session, modes, audio,
tracking, tools and every existing test are intact.

## G. Tests

Commands and results (measured on this machine, Python 3.14.7, ursina 8.3.0):

| Command | Result |
| --- | --- |
| `python -m pytest tests -q` | the full run is listed below |
| `python -m pytest tests/test_ui_interactions.py -q` | 37 passed |
| `python -m pytest tests/test_release_model.py tests/test_lateral_movement.py -q` | 37 passed |
| `python -m pytest tests/test_questions.py -q` | 35 passed |
| `python -m pytest tests/test_avatar.py -q` | 16 passed |
| `python -m pytest tests/test_screens.py tests/test_ui_interactions.py -q` | 54 passed |
| `python -m pytest tests/test_tracking.py tests/test_webcam_input.py -q` | 74 passed |
| `python -m pytest tests/test_scoring.py tests/test_session.py -q` | 51 passed |
| `python -m pytest tests/test_pin_state.py tests/test_audio.py tests/test_swing.py tests/test_swing_release.py -q` | 78 passed |
| `python -m pytest tests/test_gameplay.py -q` | 7 passed (4 m 50 s: real simulations) |

After the concurrent `motion/` layer landed, these were re-run on the current
code:

| Command | Result |
| --- | --- |
| `python -m pytest tests/test_screens.py tests/test_ui_interactions.py -q` | 58 passed |
| `python -m pytest tests/test_questions.py tests/test_release_model.py tests/test_avatar.py tests/test_scoring.py tests/test_session.py tests/test_game_modes.py tests/test_lateral_movement.py -q` | 166 passed |
| `python -m pytest tests/test_ui_interactions.py -k Strike -q` | 4 passed |
| `python -m pytest tests/test_play_modes.py -k "Local or PvP or Classic or BowlRush" -q` | 16 passed |
| `python -m pytest tests/test_play_modes.py -k "question or Trivia or Equations" -q` | 10 passed |

The last complete `python -m pytest tests -q` run before the concurrent edits
finished with **448 passed, 0 failed, 0 skipped** (1 h 13 m 45 s: the slowest
tests are the full-match mode integration tests, 3-16 minutes each). A fresh
complete run was started on the final code; its result is appended below when
it finishes.

The suite is slow because most files run full simulations (the README already
said so); a complete run takes roughly half an hour. The new files
(`test_ui_interactions.py`, `test_release_model.py`) are fast: they use an
offscreen window or no engine at all.

Two existing assertions were replaced because the specification changed, and
both were strengthened rather than weakened:

* `tests/test_questions.py::test_numbers_in_equation_questions_match_their_solutions`
  checked ten prompt fragments against hard-coded arithmetic from the old
  generic bank. It is replaced by `TestEquationProblems`, which recomputes
  *every* answer from the question's own published values with formulas written
  independently in the test file, and additionally checks the units, the
  alternative unit spellings, the worked solution and the prompt's numbers.
* `tests/test_ui_interactions.py`'s mode-picker test asserted the old
  "click the selected ball again to start it" behaviour. The spec now says the
  player must not have to guess whether a click selected or launched, so the
  test asserts that a click only ever selects and that START launches.

No test was deleted and no assertion was weakened to make the suite pass.

## H. Runtime verification

### Performance (measured, because this pass touched the HUD)

The brief says not to make the game slower, so the play loop was profiled
before and after the HUD work with `cProfile` (offscreen window, the same three
real 7.4 m/s rolls each time; both measurements were taken with the test suites
running alongside, so they are comparable to each other rather than absolute):

| State | Before | After |
| --- | --- | --- |
| Main menu | ~1.5 ms/frame | ~1.5 ms/frame |
| Play, waiting to throw | ~3 ms/frame | ~3 ms/frame |
| Ball rolling + settling | 8.8 / 16.1 / 17.4 ms per frame | 3.0 / 6.6 / 6.5 ms per frame |
| Physics integration alone | 0.26 ms/frame (151 frames) | unchanged |

The profile showed where the time went: `ursina.text.text_setter` ->
`TextNode.calcWidth`, i.e. **re-measuring text that had not changed**. The HUD
re-assigned about fifteen strings and twenty colours per frame (frame label,
pins label, score, status, instructions, controls, scorecard cells, player
chips). `ui/hud._set_text` and the scorecard's cell-state cache make those
assignments idempotent, and the rolling state became roughly 2.5x cheaper. The
physics, collision resolution and scoring are untouched.

* `python main.py` launches: the window opens, the splash and menu render, and
  the console shows only Panda3D's usual start-up notices
  (`SetForegroundWindow() failed!` on this VM, the `iCCP: known incorrect
  sRGB profile` PNG warning from the generated textures, and the offscreen
  window's frame-buffer notice) - no traceback, no missing asset, no shader
  error. The session was left running for ~25 s and then closed; the shutdown
  path (camera release, settings save) ran.
* `python tools/screenshot_tour.py --out docs/screens` ran to completion and
  wrote 24 screenshots, driving the real window through every screen and two
  real throws.
* The application was also driven by scripted input for the interaction tests
  (offscreen window) and by a real-window probe that moved the OS cursor and
  clicked through `ursina`'s input hook, which is how the pointer fault was
  found and confirmed fixed.

## I. Visual verification

The 24 screenshots in `docs/screens/` were rendered from the running game and
inspected (not just generated). What was checked and what came out of it:

| Screenshot | Finding |
| --- | --- |
| `01_splash`, `02_menu` | the character now stands beside the lane holding a ball; the glyph boxes are gone; PLAY is the focal point |
| `03_modes_classic`, `03_modes_trivia`, `03_modes_pvbot`, `03_modes_bowlrush` | the card grid reads at a glance; the selected card is unmistakable; the setup panel shows only the relevant controls; the detail panel fills correctly for every mode |
| `04_howto_1..4` | the manual is readable, four pages, no clipping (the first pages rendered blank in an earlier run because the panel was drawn before its content; that is fixed) |
| `05_settings` | two columns, no caption/value overlap after the stepper layout fix |
| `06_lab` | the equations no longer overlap the run button or the plot; the character steps out of the lab screen so the text stays clear |
| `07_classic_ready` | the character stands clear of the lane; the HUD shows mode/player, scorecard, score/frame/ball/pins and the aim line |
| `08_classic_rolling` | the hook is plainly visible: the ball has crossed to the right and the trail curves into the pins |
| `09_classic_result`, `16_results` | the result and the results overlay are readable and the buttons are large |
| `10_pause` | the body text wraps above the buttons (it used to run under them) |
| `11_trivia_question`, `12_trivia_feedback` | the question, the answer field and the feedback fit inside the panel |
| `13_equations_question`, `13b_equations_hint`, `13c_equations_hint2` | case label, question number, givens, equation and progressive hint steps all fit with room to spare |
| `14_pvp_handoff`, `15_bowlrush_ready` | the handoff banner and the BowlRush clock/labels read correctly |

Remaining visual nits (not fixed, judged cosmetic): the character's hands are
a little long, the pin silhouettes are small at 1280x720 (they are 0.381 m
tall on an 18.29 m lane, which is correct), and the scorecard boxes are empty
until a frame scores, which is how the real card works.

## J. Known issues

| Severity | Issue |
| --- | --- |
| Low | Webcam aim/hook/release direction are heuristics from tracked hand motion, and real-hardware swing timing has still not been verified end to end (nobody has stood in front of the camera for this pass). The safeguards and the mapping are tested with synthetic landmark streams. |
| Low | The lane has no oil pattern, no spin-axis migration and no air drag; the hook is produced by the release slip only. Documented in `docs/PHYSICS.md` 1.3/1.4 with the measured drift table. |
| Resolved | The browser Physics Lab uses one optional VALUES panel: any field can be blank (auto), explicit zero is real, typed values solve together and conflicts are named; the SOLVER window finds one missing variable and applies it without launching. The desktop lab keeps its lock-based calculator and equation solver. |
| Low | The trivia bank is unchanged (concept questions) and does not use the progressive-hint panel - a wrong answer still forfeits the throw and shows the explanation for a few seconds. |
| Cosmetic | The character's hands/ears are simplified, and the menu character is hidden on the Physics Lab screen. |
| Cosmetic | On a window whose pointer never reports "in window", clicks rely on the OS-cursor fallback; on a non-Windows platform that fallback does not exist, so the game would need Panda3D's pointer to work (the keyboard path always works). |
| Note | The physics-notes PDF mentioned in the brief was not present in this environment (only unrelated general-physics review material); the physics work used the project's own `docs/PHYSICS.md`, which was derived from those notes in an earlier milestone, plus the explicit requirements in the brief. |

## K. Manual test instructions

```
pip install -r requirements.txt
python main.py
```

1. **Settings.** On the main menu, click SETTINGS. The settings screen must
   open (it opens on click, not only with the keyboard). Change INPUT METHOD
   with the arrows, drag SFX VOLUME, click MUTE. Click BACK: the main menu
   returns. Re-open SETTINGS: the values you changed are still there.
2. **Main-menu navigation.** Click PLAY -> the mode picker. Click HOW TO PLAY
   -> the manual (NEXT/PREVIOUS/BACK all work). Click PHYSICS LAB -> the lab
   (RUN BOTH THROWS changes the numbers and the plot). Click QUIT -> the game
   closes. ESC on any secondary screen returns to the menu.
3. **Game-mode selection.** On the picker, click each card in turn: only the
   selection changes (no launch), the detail panel updates, and the setup panel
   shows only that mode's controls (bot level for Player vs Bot, players for
   Local/PvP, duration for BowlRush, "no extra setup" for Classic). Press
   START: the match begins with those settings (check the player count on a
   Local match and the bot difficulty on a Player vs Bot match).
4. **A/D positioning.** In a Classic game, hold D: the ball slides right and
   stops at the lane edge; hold A: it slides back through the centre to the
   left. The aim marker stays where the mouse is.
5. **Mouse throwing.** Hold the left button, drag down a little (backswing),
   then stroke up and release. A throw must happen: the ball leaves the foul
   line, the pins fall, and the trail shows the path it took. A tiny twitch
   must NOT throw (the ball stays put).
6. **Left-vs-right release variation.** Throw three balls: one with a straight
   forward stroke, one with the stroke drifting left, one drifting right. They
   must leave in visibly different directions.
7. **Webcam throwing.** Press 2 (or set INPUT METHOD = WEBCAM). Stand so your
   upper body is in frame and hold your arms down until the panel says READY,
   then swing your arm forward and up. The throw speed should follow your
   swing, and a swing that crosses your body should send the ball to that side
   and curve it. TAB/1 returns to the mouse. (This is the part that still
   needs a human in front of the camera.)
8. **Equation Challenge.** Play EQUATION CHALLENGE. The first question is Case
   1 ("How long does the ball take to reach the head pin?", answer 2.61 s).
   Type `2.61` and press ENTER (or click SUBMIT): it is marked correct and the
   throw is unlocked. On the next question, type a wrong number and press
   ENTER: "Step 1" appears with the first hint and "(2 more hint steps left)".
   Type another wrong number: "Step 2" appears. Continue: the worked solution
   and the expected answer appear. Press ENTER/CONTINUE to move on. Watch the
   footer: it always says what the next key does.
9. **Classic Bowling scoring.** Bowl a full game. A strike shows as X in the
   scorecard and the running total appears once the bonus rolls are bowled; a
   spare shows as "/"; the tenth frame gives bonus balls and re-racks when they
   are earned. The final results screen shows the same total as the scorecard.
   **Strike feedback:** when you bowl a strike, the pins line under the score
   moves immediately (`10 pins knocked`, or `ALICE 10 pins` in multiplayer) and
   the player chip shows the pins knocked, even though the official *score*
   correctly waits for the bonus rolls. Bowl three strikes in a row and the
   official score must read 30.
10. **Pause and rematch.** Press ESC during a game: the pause overlay appears
    (RESUME, RESTART MATCH, SETTINGS, QUIT TO MENU - all clickable). RESUME
    continues the same roll. Finish a match (or throw ten frames of gutter
    balls): the results overlay appears with REMATCH and MAIN MENU; REMATCH
    starts a fresh match with the same players and a full rack.

If something fails, note which of these steps and what the game showed.

## L. What I should report back

If a problem remains, please send:

1. **The console output** from the run (`python main.py` in a terminal), which
   includes any traceback and the Panda3D notices.
2. **The step number** from section K and what you did vs what happened (e.g.
   "step 5: I dragged up and nothing happened" or "step 3: START launched the
   wrong mode").
3. **For a pointing/clicking problem**: whether the keyboard path works
   (arrow keys + ENTER), and whether the window has focus when you click. That
   tells me whether the OS-cursor fallback is needed or whether the click never
   reached the app.
4. **For a physics/curve problem**: the numbers shown in the bottom-right
   readout after the throw (RELEASE speed, START x, hook, and the two-line
   p/KE block) - they are the actual launch conditions the simulation received.
5. **Optional diagnostics**: `STRIKE_LAB_SCENE_DEBUG=1 python main.py` prints
   the startup scene dump, and `python tools/screenshot_tour.py --out shots`
   writes a PNG of every screen you can send instead of describing them.
