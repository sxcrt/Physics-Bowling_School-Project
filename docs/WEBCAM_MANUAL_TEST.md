# Manual webcam validation procedure

The automated suites use labeled synthetic sequences and the two recorded
real-human negative traces (jumping jacks/burpees and waving) that exist in
`tools/testdata/`. **Neither the maintainers' automated environment nor the
repository contains a recorded genuine bowling swing**, so nothing in this
repository proves real-world positive recognition. Use this procedure to test
with a real person and a real camera, and report what you observe (see the
"what to report" list at the end).

## Preparation

1. Serve the game from the repository root:

   ```
   python tools/serve.py 8124
   ```

   Open `http://127.0.0.1:8124/` in a desktop browser (Chrome/Edge/Firefox
   with a webcam). A secure context (`localhost`) is required for camera
   access.

2. In **Settings**, leave **Developer diagnostics** off for the first pass so
   the HUD matches what players see; turn it on for pass 4.

3. Start a solo Classic game, press `TAB` (or `2`) for webcam mode, and allow
   camera access. The feed panel appears bottom-left; the chip above it shows
   tracking state and the classifier phase.

## Pass 1 - tracking and ready

* Stand ~1.5-2.5 m from the camera so your shoulders, hips and both arms are
  visible.
* Hold still with your arms down. The chip should move from
  `Phase: Tracking` to `Phase: Ready` within about half a second, and the
  status line should read "Ready to throw".
* Walk out of frame: the chip must say tracking is lost and recover when you
  return. Leaning, stepping sideways and shifting weight must **not** change
  the phase away from Ready.

## Pass 2 - a genuine swing

* From `Ready`, swing your throwing arm back and down (a normal bowling
  wind-up), then forward and up in one continuous stroke - the same gesture
  the mouse drag simulates. The chip shows `Backswing` then `Forward swing`,
  and exactly one ball launches. The power meter fills during the stroke.
* Repeat ten times with deliberate variation:
  * fast and slow deliveries;
  * shallow and deep backswings;
  * standing closer and farther from the camera;
  * left arm (press `C` to select it) as well as right;
  * let the non-throwing arm drift a little - it must not block the throw;
  * a visible pause at the top of the backswing.
* After each throw, lower your arms to your sides and hold still: the chip
  returns to `Ready` and a second swing must launch exactly one new ball.
  Between-throw motion must never launch a second ball for one swing.

## Pass 3 - ordinary movement must not bowl

While in `Ready`, perform each of these for 15-30 seconds and confirm zero
balls launch:

* jumping jacks and burpees;
* waving with one hand at chest/head height;
* scratching your head; raising one arm straight up;
* a two-arm overhead stretch;
* walking across the frame; stepping side to side; leaning; twisting your
  torso;
* random arm fidgeting; rapid small flicks;
* repeated one-arm pumps (raise/lower without settling);
* raising, lowering and raising an arm again quickly.

Occasionally the HUD may show a rejection notice (for example "both arms moved
together - throw with one arm"). That is the expected feedback, not a throw.

## Pass 4 - diagnostics

Turn **Developer diagnostics** on and press `H`. During each pass, note:

* `WEBCAM ...` line: delegate (GPU/CPU), fps, frame number, lost frames;
* `phase ...` line: classifier state, arm, hand source (wrist/hand), pose;
* `swing ...` line: direction/speed, peak, release armed/not armed, blocked
  count, last blocked/last reject reason;
* `last throw` line after a throw.

## What to report if recognition fails

Please include:

1. browser and OS, camera model if known;
2. whether the failure is a missed genuine swing, a false throw during an
   ordinary movement, or a stuck/wrong phase;
3. the exact movement you performed and the distance from the camera;
4. the developer diagnostics lines (copy the text or screenshot the readout);
5. the console output (blocked-release lines are logged as
   `[hells-balls] webcam release blocked: ...`);
6. on the desktop build, `webcam_swing.log` (set `SWING_LOG_VERBOSE = True`
   for per-frame telemetry).

A short screen recording of the feed panel together with the diagnostics
readout is the single most useful artifact for tuning the thresholds.
