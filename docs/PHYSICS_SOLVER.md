# Physics Solver

> Pass 3 note: the browser Physics Lab now runs on one shared relation engine
> (`src/ui/lab_engine.js`). The engine solves any sufficient combination of
> known values, uses locked/implied values and soft defaults, and reports
> guidance or contradictions. See `docs/PHYSICS_ENGINE.md` for the relation
> catalog and the current behavior. The historical notes below still describe
> the original desktop solver and the earlier browser layout.

The Physics Lab has two connected tools:

* the **VALUES panel**: every lab quantity is an optional input. Type the
  values you know; blank fields use the auto/default plan. Typed values are
  solved together and conflicts are named. This is the browser layout.
* the **SOLVER** window: asks for the one missing variable and explains the
  relation that produced it.

The browser build uses the unified VALUES panel
(`src/ui/lab_model.js`, `src/ui/lab.js`). The desktop build still uses the
two-panel layout and the 13-equation GIVEN/FIND solver
(`ui/physics_equations.py`, `ui/lab_screen.py`); the equation table below
describes that desktop solver.

## Browser: unified VALUES panel

The panel contains:

`START X`, `AIM`, `HOOK`, `SPEED`, `TIME t`, `ACCEL a`, `SIDEWAYS vx`,
`MOMENTUM p`, `ENERGY K`, plus the read-only `PINS` outcome.

* A blank field shows a dim value placeholder; the header says `blank = auto`.
* An explicit `0` is a real value, not a blank.
* Typing a value turns it white and re-solves the other fields; clearing it
  releases the constraint.
* Typed values are constraints solved together:
  * `SPEED`, `MOMENTUM` and `ENERGY` are checked for consistency;
  * `AIM` and `SIDEWAYS` determine speed when speed is blank;
  * `SPEED` + `TIME` solve acceleration;
  * `TIME` + `ACCEL` solve speed.
* A contradiction is named in the timeline status, the conflicting row's
  underline turns amber, the header says `CONFLICT - see timeline`, and `BOWL`
  is disabled until the field is cleared or corrected.
* `CLEAR` removes every typed constraint and returns to the default plan.
* Editing never launches the ball and never resets a replay. During a run the
  panel switches to `LIVE` and the inputs are read-only; `RESET` returns to
  the editable plan with the same typed constraints.

The browser **SOLVER** opens a missing-variable window:

`TIME`, `SPEED`, `ACCEL`, `SIDEWAYS`, `MOMENTUM`, `ENERGY`.

It shows the panel inputs (`GIVEN` and `AUTO`), then the relation, substitution,
calculation, answer and assumptions. `APPLY TO VALUES` writes the answer into
the panel; it never bowls. `START X` and `HOOK` are direct inputs and are shown
as disabled options.

## Desktop: GIVEN/FIND equation solver

The desktop build keeps the equation picker and GIVEN rows. Choose an equation,
enter the variables you know, choose `FIND`, and press `SOLVE`. The result
shows formula, rearrangement, substitution, calculation, answer and
assumptions. Apply speed, friction or aim to the shot without launching it.

### Desktop workflow

1. Choose an equation.
2. Enter the values you know. Every variable of the selected equation is shown
   except the one being found; blank means unknown.
3. Choose **FIND**: the single variable to calculate.
4. Press **SOLVE**. Nothing is launched.
5. Read the formula, rearrangement, substitution, calculation, answer and
   assumptions.
6. If the result is a launch parameter, press **APPLY TO SHOT**. The throw
   values are updated and the overlay closes; press **BOWL** when ready.

If the selected equation is missing a value, the result names the missing
variable and why it is required. It never invents a mass, friction value or
spin. If another supported equation can use the same known values, the engine
uses it and explains the substitution.

The given fields accept common units (`1830 cm`, `27 km/h`, `1 min`,
`6000 g`, `0.16875 kJ`, `0.0667 rad`, ...); the engine always receives SI.

## Supported equations

| Equation | Formula | Variables | Assumptions |
| --- | --- | --- | --- |
| Uniform motion | `d = v t` | d, v, t | constant speed, no acceleration/friction |
| Velocity and time | `v = u + a t` | u, v, a, t | constant acceleration, signed values |
| Displacement and time | `d = u t + 0.5 a t^2` | d, u, a, t | constant acceleration, signed values |
| Velocity and distance | `v^2 = u^2 + 2 a d` | u, v, a, d | constant acceleration, non-negative speed root |
| Force | `F = m a` | F, m, a | net force, constant mass |
| Work | `W = F d` | W, F, d | force along displacement, constant force |
| Kinetic energy | `K = 0.5 m v^2` | K, m, v | translational energy, non-negative speed root |
| Torque | `tau = F r` | tau, F, r | perpendicular force, lever arm from the pivot |
| Angular velocity | `v = omega r` | v, omega, r | rolling without slipping |
| Friction deceleration | `a = mu g` | a, mu, g | kinetic friction, level surface; `a` is a magnitude |
| Stopping distance | `d = v^2 / (2 mu g)` | d, v, mu, g | constant kinetic friction, level lane |
| Stopping time | `t = v / (mu g)` | t, v, mu, g | constant kinetic friction, level lane |
| Sideways velocity | `vx = v sin(theta)` | vx, v, theta | aim measured from the lane axis |

`g` defaults to 9.81 m/s2 and is reported in the assumptions. All results are
**analytical**: exact under the listed assumptions, not a measurement from the
full bowling simulation. The LIVE panel and timeline remain the real
simulation.

## Applying a result to the shot

This table describes the desktop equation solver. In the browser's unified
panel, `APPLY TO VALUES` writes the missing-variable answer into the
corresponding VALUES field and re-solves the panel; it does not bowl.

| Result | Applied to |
| --- | --- |
| initial speed `u` (motion equations), speed `v` in uniform motion / kinetic energy / friction stopping | lab speed |
| deceleration `a` (negative motion acceleration, friction magnitude) | lab lane deceleration (friction scale) |
| friction coefficient `mu` | lab lane deceleration = `-mu g` |
| aim `theta` (sideways velocity) | lab aim |

Results for distance, time, final speed, mass, force, work, torque and angular
velocity are shown but not applied: the lane distance is fixed, and the
simulation does not take force/torque/mass as launch parameters. The result
card says so instead of silently guessing.

Applying never launches the ball. It updates the THROW fields and closes the
solver; the existing **BOWL** button starts the shot.

## Edge cases

* A zero value is a real value (unlike a blank field).
* Division by zero, a negative square root and a negative stopping distance
  are reported as errors.
* A time that cannot be reached because friction stops the ball first is
  reported as "never reaches" rather than an infinite answer.
* A displacement/time equation can have two positive times; the first arrival
  is shown and the other is listed.
* Values outside the lane's operating range still calculate, but the apply
  step explains when a result is not a lane parameter (for example positive
  acceleration, which the lane cannot supply).

### Browser (unified VALUES + missing-variable solver)

1. Open PHYSICS LAB with every field blank. The dim placeholders show the
   default plan (`7.5`, `2.5219`, ...); `BOWL` runs the default throw.
2. Type `TIME t = 3` with `SPEED` blank. The speed auto-solves to `6.391 m/s`;
   nothing launches.
3. Type `SPEED = 7.5` and `TIME t = 3`. `ACCEL a` auto-solves to `-0.9356 m/s2`.
4. Add `ACCEL a = -0.4`. It conflicts with the speed/time pair; the row
   underlines amber, the timeline names the conflict, and `BOWL` is disabled.
   Clear the acceleration and the plan recovers.
5. Type `MOMENTUM p = 0`. Speed becomes `0`; `TIME t` shows `never`.
6. Press `CLEAR`; every field returns to its default placeholder.
7. Type `START X = 0.3`. Only the start position changes.
8. Press **SOLVER**, choose `TIME`, and press **SOLVE**. Read the relation,
   substitution, calculation and answer; **APPLY TO VALUES** fills `TIME t`
   without bowling.
9. Press **BOWL**. The panel switches to `LIVE` and becomes read-only; `RESET`
   returns to the editable plan with the same typed values.

### Desktop (two-panel equation solver)

1. Uniform motion, GIVEN `d = 18.3`, `v = 7.5`, FIND `t` -> `t = 2.44 s`,
   formula `t = d / v`.
2. Force, GIVEN `F = 12`, FIND `a` -> asks for mass; add `m = 4` -> `a = 3`.
3. Kinetic energy, GIVEN `K = 168.75`, `m = 6`, FIND `v` -> `v = 7.5 m/s`;
   **APPLY TO SHOT** sets speed and does not bowl.
4. Displacement and time, GIVEN `d = 18.29`, `u = 7.5`, `t = 3`, FIND `a` ->
   `a = -0.936 m/s2`; apply sets the lane deceleration.
5. Sideways velocity, GIVEN `vx = 0.5`, `v = 7.5`, FIND `theta` -> `3.823 deg`;
   apply sets the aim.
6. Type `1830cm` and `27km/h` into the uniform-motion fields -> still
   `t = 2.44 s`.

## Tests

* `node tools/js_tests.mjs` - the unified optional model (`solveLab`,
  `findField`), the browser calculator, the 13-equation engine, physics and
  port parity.
* `python -m unittest tests.test_physics_equations tests.test_lab_model` -
  desktop every equation in every direction, missing information, fallback,
  apply hints, undefined/impossible results and agreement with the lab plan.
* `python -m unittest tests.test_ui_interactions tests.test_lab_timeline` -
  the desktop solver overlay, apply-without-launch, calculator locks, timeline.
* Browser manual checks: `tools/browser_checks.md`.

## Known limitations

* The browser unified panel and the desktop two-panel lab currently differ:
  the browser uses the optional VALUES + missing-variable solver; the desktop
  keeps the equation picker. The user chose browser-only for this redesign.
* The browser missing-variable solver exposes `TIME`, `SPEED`, `ACCEL`,
  `SIDEWAYS`, `MOMENTUM`, `ENERGY`; `START X` and `HOOK` are direct inputs only.
* The analytical relations do not model air drag, oil patterns, spin-axis
  migration, pin collisions or the ball's slip phase. Those remain
  simulation-only.
* The desktop equation list is intentionally small; impulse, projectile motion
  and spin/trajectory equations are not included.
* Unit conversion covers the common units listed in the code; it is not a
  full dimensional-analysis system.
* The desktop solver selects equations and the FIND variable by cycling with
  the stepper arrows (there is no native dropdown in the Ursina UI).
