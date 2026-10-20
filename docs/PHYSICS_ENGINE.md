# Physics Lab — General Solver Pass 3

This pass replaces the per-mode hard-coded solving with one shared relation
engine. The original bowling solver file (`lab_solver.js`) is untouched; the
bowling catalog reproduces its numbers and wraps them in the new engine.

## Engine

`src/ui/lab_engine.js`

1. Seed typed values and locked/implied values.
2. Propagate: repeatedly solve the first relation with exactly one unknown.
   Closed forms are used first; a bracketed/ bisection fallback enumerates
   every root in the declared range. The chosen root follows the per-variable
   rule (smallest positive time, lower launch angle, positive speed) and the
   other roots are recorded as `alsoValid`.
3. Activate soft defaults one at a time, in priority order, only when the
   typed/locked values leave that quantity undetermined. A default that would
   over-determine a typed value is dropped silently. A small number of defaults
   (gravity, launch height) are marked fatal so a genuine impossible case is
   reported instead of hidden.
4. A coupled Newton fallback exists for genuinely square systems. It rejects
   numerically singular systems so two copies of one constraint cannot invent
   an answer.
5. Consistency check on every fully known relation with a 1e-6 relative
   tolerance (0.005 when several typed values over-determine a relation).
   Disagreement returns a plain sentence and the blamed row.
6. Diagnosis tries one extra value, then pairs and triples, and returns only
   values that actually make the requested variable solvable.

Status words come from `guidance()`: neutral gray for guidance, pink for a
result, red only for a contradiction or impossible math. Notes are rendered on
a second line with an info icon.

## Bowling

Relations: `v_f = v_i + a t`, `Δx = v_i t + ½ a t²`,
`v_f² = v_i² + 2aΔx`, `Δx = ½(v_i + v_f)t`, `a = −μg`,
`v_x = v_i sin θ`, `p = m v_i`, `K = ½ m v_i²`.

Soft defaults: gravity 9.81, μ 0.02, mass 6 kg, hook constant 0.55, lane length
18.29 m, distance = lane length, final speed = 0 only when the ball stops before
the lane, start 0.2, hook −1.6, aim −0.4.

Locked: none.

Numbers stay identical: speed 7.5 → a = −0.1962, t = 2.5219, vx = −0.0524,
p = 45, K = 168.75.

Positive acceleration is accepted. The lane length is used only for the scene
note when typed values determine a longer travel:
`speed 2 + time 5 + accel 11 → v_f 57, Δx 147.5`, plus
“The lane is 18.29 m, so the ball reaches the pins at t = 1.6508 s going
20.1589 m/s.”

## Linear Motion

Relations: `v_f = v_i + a t`, `v_f² = v_i² + 2aΔx`,
`Δx = v_i t + ½ a t²`, `Δx = ½(v_i + v_f)t`, average speed and average
velocity.

Locked: Free Fall `a = −g`; Dropped `v_i = 0`; At highest point `v_f = 0`;
Straight Line Constant speed `a = 0`.

Soft defaults: none. Gravity is the Free Fall setting, and the Extra row `g`
overrides it and drives `a = −g`.

Every 3-known combination of `{v_i, v_f, Δx, t, a}` solves. Two knowns plus
Constant speed solve when they determine the motion.

## Projectile Motion

Relations: `v_x = v_0 cos θ`, `v_y = v_0 sin θ`, flight time
`h_0 + v_y T − ½gT² = 0`, `R = v_x T`, `H = h_0 + v_y²/(2g)`,
`v_L² = v_0² + 2gh_0`, `t_A = v_y/g`, landing angle, trajectory at the target,
`x_T = v_x t_T`, `y_T = h_0 + v_y t_T − ½g t_T²`, speed at the target,
range relation, height–range geometry, flight time/launch, and maximum
height/launch.

Locked: Ground launch `h_0 = 0`; Horizontal launch `θ = 0`.

Soft defaults: gravity 9.8; From a height `h_0 = 0`; target height
`y_T = h_0` when a target distance is known.

Default rows: Ground `v_0, θ, R`; Horizontal `v_0, h_0, R`; From a height
`v_0, θ, h_0, R` (plus the launch-type picker, five rows maximum).

The scene draws a target ring at `(x_T, y_T)` whenever the target distance is
known.

## Rotational Motion

Relations: the four constant-α kinematics, revolutions, rpm, `v_t = rω`,
`a_t = rα`, `a_c = ω²r`, `a_c = v_t²/r`, and `s = rθ`.

Locked: Constant speed `α = 0`.

Soft defaults: none. rpm and revolutions are real variables, so a value typed
in either chains into the kinematics in both directions.

## Torque

Relations: `τ = rF sin θ`, `F⊥ = F sin θ`, `F∥ = F cos θ`, `d = r sin θ`,
`τ_net = Iα`, and seesaw `m_1 g r_1 = m_2 g r_2`.

Locked: the first force's direction (CCW + / CW −) and, for a single force,
`τ_net = τ`. A force list locks each computed torque and the net.

Soft defaults: none.

Any one of `τ, F, r, θ, τ_net, I, α, m_1, r_1, m_2, r_2` solves from the
others. A list of several torques with CW/CCW still works.

## Moment of Inertia and Angular Momentum

Each shape has one definition object; its displayed formula and compute
relation come from the same coefficient. Covered shapes: disk `½MR²`, ring
`MR²`, sphere `⅖MR²`, shell `⅔MR²`, rod end `⅓ML²`, rod centre `1/12ML²`,
point mass `mr²`, custom `Σmr²`.

Relations: shape `I = c M R²` or `c M L²`, `L = Iω`,
conservation `I₁ω₁ = I₂ω₂`, and composite `I_total = I_platform + mr²`.

Soft defaults: none. Locked: a custom shape's `I = Σmr²` from its parts.

Any one of `I, M, R/L` solves from the other two; `L = Iω` solves in every
direction; conservation and collision solve any missing part.

## Changed files

All inside Physics Lab, plus its tests and documentation:

- `src/ui/lab_engine.js` (new)
- `src/ui/lab_bowling.js` (new)
- `src/ui/lab_linear.js` (new)
- `src/ui/lab_projectile.js` (rewritten on the engine)
- `src/ui/lab_rotational.js` (rewritten on the engine)
- `src/ui/lab_torque.js` (rewritten on the engine)
- `src/ui/lab_inertia.js` (rewritten on the engine)
- `src/ui/lab_modes.js` (variables, Extra groups, launch types, Constant speed)
- `src/ui/lab.js` (status line, chips, locked rows, launch picker, solver wiring)
- `src/ui/lab.css` (labels, lock icon, chips, status notes, mode chips)
- `src/ui/lab_scene.js` (projectile target marker)
- `tools/lab_engine_tests.mjs` (new round-trip suite)
- `docs/PHYSICS_ENGINE.md` (this report)
- `docs/PHYSICS_SOLVER.md` (pass-3 pointer to the engine)

No routing, save data, shared state, shared assets, global CSS or new libraries
were changed.

## Tests

| Suite | Before | After |
| --- | --- | --- |
| `tools/lab_modes_tests.mjs` | 45 tests / 393 assertions | 45 tests / 453 assertions |
| `tools/lab_engine_tests.mjs` | — | 35 tests / 4,433 assertions |
| `tools/js_tests.mjs` | 171 passed | 171 passed |

Relation directions covered by the catalog test:

| Lab | Relations | Directions |
| --- | --- | --- |
| Bowling | 8 | 28 |
| Linear | 4 | 16 |
| Projectile | 16 | 67 |
| Rotational | 11 | 35 |
| Torque | 6 | 20 |
| Inertia | 11 | 35 |

## Combinations that are not solvable, and why

- Bowling with only `distance` (or only `accel`) typed is genuinely
  underdetermined: distance and acceleration do not determine the initial speed
  and time together. The status line says how many more values are needed.
- Straight Line with `v_i = v_f` and Constant speed leaves `Δx` and `t` free
  (any duration at that speed). It stays underdetermined.
- Projectile with both `R` and `target distance` naming the same point, but no
  angle, is one constraint in disguise; the engine refuses to invent a pair and
  stays underdetermined.
- A target point at or below the launch line for the chosen angle is reported as
  “At this angle the ball can never reach that point. Try a steeper angle.”
- A negative solved time is reported as impossible with the nearest fix.

## Known limitation

The 3D bowling lane remains the real 18.29 m lane. The `Lane` setting stores
`Regulation` / `Extend to fit my values`, and the analytical values always use
the typed distance, but extending the 3D geometry itself is outside Physics Lab
(scene/asset code). The analytical Time row keeps the typed/solved value, and
the real run clamps at the pin deck or at the stopping point.
