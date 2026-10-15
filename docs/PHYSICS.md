# Hells Balls physics

This document records the equations the simulation implements, the
assumptions behind them, the parameter values and units, and - importantly -
the ways in which the simulation is *not* physically accurate. Real accuracy
would require comparison against instrumented measurements; nothing here
claims that.

Everything is SI: metres, kilograms, seconds, radians. The lane frame has
`+z` down the lane (foul line -> pins), `+x` lateral, `+y` up.

## 1. The ball

The ball is a homogeneous sphere of radius `R` and mass `m`.

| Quantity | Symbol | Value | Source |
| --- | --- | --- | --- |
| Radius | `R` | 0.109 m (8.5 in) | USBC-specified diameter |
| Mass | `m` | 6.0 kg | within the 6.35-7.26 kg regulation; 6 kg is the light end |
| Moment of inertia | `I` | `(2/5) m R^2` = 0.02852 kg m^2 | solid sphere |
| Rolling resistance | `mu_r` | 0.02 | approximate, upper end of measured loss |
| Sliding friction | `mu_k` | 0.12 | approximate (oiled lane between 0.05 and 0.2) |
| Gutter friction | `mu_g` | 0.15 | approximate |

### 1.1 Skidding, rolling and the hook

The ball never rolls perfectly from release. Its release spin is

```
omega0 = (y_hat x v) / R   +   omega_hook * v_hat
         ^^^^^^^^^^^^^^^^^       ^^^^^^^^^^^^^^^^
         the no-slip roll        the axis rotation
```

The first term is the spin the ball needs to roll without slipping along its
release direction. The second is the *axis rotation* of a real release: the
spin axis is tilted from the pure-roll axis towards the line of travel by the
bowler's hand position. It makes the contact point slip sideways by

```
v_slip = R * omega_hook
```

which is what bends the path - friction acts against that slip, so the ball
travels forward *and* sideways through the skid, and then rolls straight along
the direction it has acquired. That is the classic skid-hook-roll shape, and
it only needs the contact model below; there is no separate "hook force".

A pure spin about `+y` (the vertical axis) would instead produce *no* lateral
motion at all, because a vertical spin contributes nothing to `v_contact`.
The hook is therefore modelled on the travel axis, and `ThrowData.spin_omega`
is that axis-rotation component, in rad/s.

The contact point velocity is

```
v_contact = v + omega x r,      r = -R * y_hat
```

and while `|v_contact| > SLIP_TOLERANCE` the friction force is kinetic:

```
F = -mu_k m g * v_contact_hat
a = F / m = -mu_k g * v_contact_hat
tau = r x F
alpha = tau / I
```

(For a solid sphere struck without spin the friction torque gives
`alpha = 5 a / (2 R)`, and the contact point stops slipping when the speed has
fallen to `5/7` of its initial value - a classic result that this code
reproduces.)

Once the contact point is at rest the no-slip constraint holds:

```
omega = (y_hat x v) / R
```

and afterwards the only force is rolling resistance:

```
a = -mu_r g * v_hat
```

The angular velocity is then advanced from the constraint itself,
`alpha = (y_hat x a) / R`, rather than through a separate torque. That keeps
the contact velocity exactly zero at any timestep; computing it separately
through `tau / I` disagrees with the linear update by `O(dt)` and can make a
large frame jump the ball into a spurious slide.

**Calibration of the hook.** Measured with this simulation over a full 18.29 m
lane from the centre line:

| `omega_hook` | lateral drift at the pins | pins hit straight ahead |
| --- | --- | --- |
| 0 rad/s | 0.00 m | 7 |
| 1 rad/s | -0.22 m | 7 |
| 2 rad/s | -0.20 m | 7 |
| 3 rad/s | -0.32 m | 6 |
| 5 rad/s | -0.49 m | 3 (into the gutter) |

so 1 rad/s of axis rotation moves the ball about two boards and 5 rad/s
(maximum, `config.MAX_SPIN`) crosses the lane and can find the gutter. Real
hook distances are of this order; the shape is right, the exact value depends
on the lane's oil, which this game does not model.

### 1.2 Orientation

The orientation is carried as a rotation matrix and advanced through the
axis-angle exponential of the angular velocity,

```
R_new = exp([omega dt]_x) R_old
```

built from a quaternion, so it stays a proper rotation with no matrix drift.
The game converts it to Euler degrees only for display.

### 1.3 Calibration of the hook (measured in this build)

The hook is what makes a throw curve, so its magnitude was measured with the
project's own simulator (`physics.simulate_roll`, 7.0 m/s from the lane
centre, trajectory recorded):

| Release hook spin | Lateral drift over the lane |
| --- | --- |
| 0.0 rad/s | ~0.01 m (straight) |
| 1.0 rad/s | ~0.22 m |
| 2.0 rad/s | ~0.21 m (after the pin contact) |
| 3.0 rad/s | ~0.33 m |
| 5.0 rad/s (maximum) | ~0.49 m |

Real bowlers see roughly 0.3-0.7 m of hook on a house shot, so the maximum is
at the realistic end and the mid-range values are conservative. The input
scales were set so a *deliberate* hook drag reaches the middle of that range:
`SPIN_SCALE = 3.4` maps a sideways drag of 1.0 screen-widths/s to 3.4 rad/s
(~0.35 m of curve), while `MAX_SPIN = 5.0` caps it. A straight drag produces
no spin at all, which is why a straight throw goes straight.

The values in the table drift slightly non-monotonically at 2 rad/s because
the recorded drift is the *final* ball position: once the ball contacts the
pins its own position is deflected by the collision as well as by the hook.

### 1.4 Assumptions and limitations

* The lane is a perfect plane: no crown, no oil pattern, no transition from
  skid to hook to roll beyond what the contact model produces.
* Air drag is ignored. At 7 m/s a 0.11 m sphere has a drag deceleration
  below 0.05 m/s^2, under the rolling-resistance term, so it is omitted
  rather than modelled with an uncertain `C_d`.
* `mu_r = 0.02` is the conservative (high) end of the measured 1-2 m/s of
  loss over 60 ft; a dry lane would be far higher.
* The hook is friction-driven, but there is no spin decay, no precession of
  the spin axis and no oil pattern, so the curve is produced by the release
  slip only. A real ball keeps hooking as its axis migrates; here it rolls
  straight once the slip is gone. `docs/PHYSICS.md` §1.1 calibrates what that
  means in metres.

### 1.5 The closed-form skid (the model Equation Mode uses)

Equation Mode (`game/challenges.py`) has to give the player an *answer*, so it
uses the closed form of exactly the skid above. Every term is the engine's own
physics; nothing extra is added.

While the ball slips, its contact point moves sideways at `s = R |omega|`. The
friction force `F = mu_k m g` acts opposite that slip and does two things:
it removes the slip, and it gives the ball sideways speed. For a solid sphere
the contact slip decays at `3.5 mu_k g` (the linear deceleration `mu_k g` plus
the `2.5 mu_k g` the spin-up of the ball contributes), so the slip lasts

```
t_s = R |omega| / (3.5 mu_k g) = 2 R |omega| / (7 mu_k g)
```

and the sideways velocity picked up in that time is

```
delta_v_side = mu_k g * t_s = (2/7) R omega.
```

The ball then rolls straight (rolling resistance only) along that acquired
direction. The lateral drift when it reaches a pin `d` away, over which it
takes `t = d/v`, is the skid's own displacement plus the rest of the roll:

```
D(omega) = -(2/7) R omega (t - t_s / 2)
```

The sign convention is the engine's: `omega > 0` (spin about the travel
direction) drifts to `-x`, i.e. the bowler's left.

Two consequences worth teaching, and the reason Equation Mode can ask for the
*spin* and not just a number of boards:

* the drift is **linear in omega for a fixed shot** but not for a fixed
  release: at 5 m/s the same spin curves about 80% further than at 9 m/s
  (the ball has longer to travel sideways);
* it depends on `mu_k`, `R`, `v` and `d` as well as `omega` - spin alone never
  determines curvature, which is why every challenge states all of them.

**Calibration.** Model against the engine's own recorded trajectory, on the
challenge racks (`tests/test_challenges.py` runs the same comparison):

| Challenge (release) | `D(omega)` model | engine drift | difference |
| --- | --- | --- | --- |
| spin to the 6 pin (-3.711 rad/s, 7 m/s) | 0.3050 m | 0.2956 m | -0.009 m |
| spin to the 10 pin (-4.711 rad/s, 6 m/s) | 0.4575 m | 0.4614 m | +0.004 m |
| speed-to-curve (6.352 m/s, -5 rad/s) | 0.4575 m | 0.4647 m | +0.007 m |
| the same 10-pin shot at 7 m/s | 0.4142 m | 0.4069 m | -0.007 m |
| the same 10-pin shot at 9 m/s | 0.3199 m | 0.3116 m | -0.008 m |

Across 6-9 m/s the closed form is within 2 cm of the simulation - well inside
the 0.169 m contact window (`R + R_p`), so the expected answer in every
challenge really does hit its pin. At a softer 5.5 m/s the ball gutters before
the pins, which the model also predicts (it asks for more than 0.53 m of
drift).

The neglected terms, stated precisely: (a) rolling resistance during the roll
decays the acquired sideways velocity at `mu_r g (v_side/v)`, worth ~1 cm over
a full lane at 7 m/s and ~2 cm at 6 m/s; (b) the engine's 1/240 s sub-steps and
its `SLIP_TOLERANCE` hand-off; (c) collisions. None of them changes a challenge
outcome within the contact window, and none of them is claimed to make the
model a real-lane predictor.

### 1.6 Rotation quantities used by the challenges

The challenges also quote the rigid-body relations the engine's own solver is
based on (they are not new physics):

```
I          = (2/5) m R^2          moment of inertia, solid ball (config.BALL_INERTIA_TYPE)
L          = I omega              angular momentum about the spin axis
omega      = tau dt / I           idealised frictionless spin-up over dt
J          = (1 + e) v / (1/m + 2/m_p)   ball/pin impulse (engine's resolver, e = 0.6)
v_pin      = J / m_p              pin's exit speed (its mobility is 2/m_p)
```

`v_pin` is the pin's centre-of-mass speed just after the contact; it is what
the pin-speed challenge targets, and `tests/test_challenges.py` checks the
formula against the velocity the engine actually gives the pin (within
0.25 m/s, measured at the sub-step rate).

## 2. The pin

Each pin is a rod of length `L` and mass `m_p`. The rod model below is the
**collision** model and is unchanged by the visual overhaul: the drawn surface
is a separate single lathe mesh (`scene/pin_mesh.py`, generated from the USBC
silhouette) that shares the same base, axis and belly radius, so the mesh and
the body cannot disagree. See `docs/VISUALS.md` for the mesh.

| Quantity | Symbol | Value | Source |
| --- | --- | --- | --- |
| Height | `L` | 0.381 m (15 in) | USBC specification |
| Mass | `m_p` | 1.5 kg | USBC pins are 1.53-1.64 kg; 1.5 is the light end |
| Belly radius | `R_p` | 0.0605 m (4.766 in) | USBC specification |
| Rack spacing | - | 0.305 m (12 in) | equilateral triangle |
| Moment of inertia (base) | `I_base` | `(1/3) m_p L^2` = 0.0726 kg m^2 | rod about one end |
| Moment of inertia (centre) | `I_cm` | `(1/12) m_p L^2` = 0.0181 kg m^2 | rod about its centre |
| Tip-rate cap | - | 40 rad/s | numerical guard |
| Deck friction | - | 0.12 | approximate |
| Kickback restitution | - | 0.45 | approximate; the deck's side plate
  throws a sliding pin back into the rack |
| Pin/pin clearance | - | 0.125 m | approximate average contact distance |
| Ball/pin restitution | `e` | 0.6 | approximate; USBC instrumented ball/pin
  tests report 0.6-0.77 for phenolic pins at ~6 mph |
| Pin/pin restitution | `e` | 0.5 | approximate |

### 2.1 Tipping

A struck pin is a free rod: it translates at its centre of mass and rotates
about it,

```
tau = (L/2) m_p g sin(theta)
alpha = tau / I_cm = 6 g sin(theta) / L
```

integrated with semi-implicit Euler (explicit Euler gains energy on this
equation; the semi-implicit form is stable). Only the magnitude of the tip
rate is integrated: a pin standing on the lane cannot back-spin off its base,
so it always topples forwards along the direction it was struck. The tip rate
is capped at 40 rad/s, a numerical guard that can only *remove* energy.

### 2.2 Sliding, kickbacks and the pit

The pin's planar position is its contact patch, and gravity's torque is taken
about the rod's centre (`I_cm = (1/12) m_p L^2`), so the base is a material
point of the body rather than a weld. Each step:

```
base += v dt,     v decays at a = mu_k g  while the pin touches the deck
com_y = max(R_p, (L/2) cos(theta))        (the pin lies *on* the deck)
```

Sliding is what carries a struck pin into its neighbours: a pin struck at
7 m/s leaves the contact with about 5 m/s of translation and takes roughly
0.3 s to fall, travelling ~0.5 m before deck friction has bled its speed off,
which is the same order as real pin action.

Two boundaries close the deck:

* **Kickbacks** at the lane edges (`x = +/-LANE_WIDTH/2`): a pin that slides
  into one is reflected with `e = 0.45` and thrown back towards the rack. Real
  pin carry depends heavily on this - without it a corner pin simply slides
  off the deck.
* **The pit** behind the deck: a pin that reaches it is out of play (it has
  already been counted as down).

### 2.3 Assumptions and limitations

* The pin is straight, homogeneous and rigid. Real pins are tapered, their
  mass is concentrated in the belly, and they deform. A real pin's moment of
  inertia is therefore lower than the rod value used here, so this model
  under-rotates slightly.
* The single scalar tip rate cannot represent a tumble about two axes. A pin
  that is struck diagonally topples in one plane.
* The base is not a rigid weld: the deck holds it only through friction. The
  model lets a struck pin both translate and rotate, which is what real pin
  action looks like, but it cannot represent the pin rolling over its base
  edge or bouncing off the deck.
* The tip rate is capped at 40 rad/s. The cap only ever removes energy and
  exists because a rigid rod struck at its belly would otherwise end up
  spinning at hundreds of radians per second, which is neither resolvable at
  60 fps nor realistic for a deforming pin.

### 2.4 Pin state, counting and the rack

The rack keeps three explicit states per pin, and the roll's score is derived
from *transitions* between them (not from a snapshot of the deck):

| State | Meaning |
| --- | --- |
| in play | standing, part of the current rack; can be hit and counted |
| down | knocked over during the current roll; counted once |
| swept (`removed`) | cleared from the deck; invisible, not a target, never counted again until a full rack reset |

* `PinRack.begin_roll()` freezes the rack state at the start of a roll and
  records the pins that are already down or swept. Those can never be counted
  by the roll that follows, so a pin cannot be counted twice even if a sweep
  was missed or its body is still moving.
* While the ball rolls, the deck is integrated in fixed sub-steps and each
  newly downed pin joins the roll's `set` of knockdowns; the count is the
  *size of that set*, so extra motion cannot add to it.
* When the ball finishes, the deck does **not** stop: `PinRack.settle()` keeps
  integrating the pins (ball held still) until the deck is quiet, capped by
  `SETTLE_MAX_TIME`. A pin that is still toppling is therefore counted from
  its final pose. Freezing the deck on the ball's last sub-step - the earlier
  behaviour - left pins leaning below the knockdown angle that were then
  re-stood for the next ball, which is how a frame could record more pins than
  the rack held.
* The sweep happens when the next roll is set up: down pins are marked swept
  and hidden, the survivors are re-stood. The sweep is driven by the scorer's
  standing count (`BowlingGame.standing_pins()`), which stays the source of
  truth: a full rack is rebuilt for a new frame or after a tenth-frame strike
  or spare, and only the survivors otherwise. `Game._check_rack()` and
  `Game._count_roll()` guard the two against drifting apart and report (rather
  than crash on) a disagreement.

No equation above changed; the counting and sweep are state management on top
of the same simulation.

## 3. Collisions

All collisions are impulsive. For two bodies with effective inverse masses
`1/M_1` and `1/M_2` and closing speed `v_closing` along the contact normal,

```
J = (1 + e) v_closing / (1/M_1 + 1/M_2)
```

with each body receiving `+/- J n` and each body responding through its own
`apply_impulse` (which may split `J` into translation and rotation, as the
pin does). Momentum is conserved exactly, and because the response and the
sizing share the same mobility, the energy never increases. For a pin whose
response is `J/m` plus a rotation carrying equal energy, the effective
inverse mass is `2/m`, and the whole collision loses

```
dKE = -((1 + e) J^2) / (2 (1/M_1 + 1/M_2)) * (1 - e)
```

which is negative for every `0 <= e < 1`. The test suite verifies the
`e <= 1` no-energy-creation property directly for the ball/pin and pin/pin
resolvers (including a whole roll at 30/60/240 fps).

### 3.1 Ball/pin

* The contact is resolved in the lane plane: the ball centre is projected
  horizontally onto the pin's base-to-head line, and contact happens within
  `R + R_p`. The normal is horizontal. A full 3D offset would tilt the
  normal whenever the ball's centre height differs from the contact height,
  and a tilted normal silently kills the collision.
* The pin's mobility is `2 / m_p`. The impulse is split into a linear part
  (`J / m_p`) and rotation about the base (`J (L/2) / I_base`); with
  `I_base = (1/3) m_p L^2` those two carry equal energy, which is why the
  contact's effective inverse mass is exactly `2 / m_p`. Using the pin's
  plain mass (or an inertia-only mobility) either hands the pin energy the
  ball never paid for or makes the pin unrealistically stiff.
* Each pin can be struck at most once per roll by the ball. A real ball does
  not bounce off the same pin repeatedly, and without the guard a slow ball
  would re-fire the contact every frame as it drifts past.

### 3.2 Pin/pin

* Each pin is its base-to-head line in the lane plane, and contact happens
  when the closest points of two such lines come within
  `PIN_PIN_CLEARANCE`. That is a tuned average contact distance: a rack
  seats neighbours one belly diameter apart, while a tipping pin presents
  its narrow head.
* Standing pins and released pins are resolved by the same `apply_impulse`
  response, which is what makes the equal-and-opposite impulses conserve
  energy (verified numerically in `tests/test_physics.py`).
* Overlap is removed geometrically (a position-only correction).

### 3.3 Fast-ball detection

A ball is integrated at `PHYSICS_SUBSTEP = 1/240 s`; at 12 m/s it advances
5 cm per sub-step, well under the 17 cm contact radius, so a plain overlap
test cannot miss a pin. `swept_circle_time` (the exact quadratic
segment/circle intersection) is provided and tested for the case where the
ball would cross a pin's whole contact zone within one step.

## 4. What is and is not accurate

Implemented from standard equations:

* the rolling/skidding friction model and the no-slip constraint;
* the rigid-body impulse formula with restitution;
* gravity torque and the pendulum equation for a tipping pin;
* Coulomb friction on the deck.

Approximations that a real lane would not obey:

* constant rolling resistance; no oil pattern, crown or lane transition;
* rigid bodies, no deformation, no friction in the contacts themselves;
* a single tip axis per pin; no two-axis tumble or base roll-over;
* no kickbacks, gutters are a far simpler friction channel, and the pit is
  not modelled at all;
* tuned constants: `mu_r`, `mu_k`, `PIN_PIN_CLEARANCE`, both restitution
  values and the tip-rate cap.

## 5. Units summary

| Symbol | Unit | Meaning |
| --- | --- | --- |
| length | m | metres |
| mass | kg | kilograms |
| time | s | seconds |
| angle | rad | radians (degrees only in `config` thresholds) |
| `v` | m/s | linear velocity |
| `omega` | rad/s | angular velocity |
| `a` | m/s^2 | linear acceleration |
| `alpha` | rad/s^2 | angular acceleration |
| `J` | kg m/s | impulse |
| `I` | kg m^2 | moment of inertia |
| `mu` | - | dimensionless friction coefficient |
| `e` | - | dimensionless coefficient of restitution |

## 6. Verification

`tests/test_physics.py` checks the model against the equations above:

* the rolling deceleration equals `mu_r g` and the speed over the lane
  matches `v^2 = v0^2 - 2 a s`;
* the same throw produces the same speed at 30/60/120/240 fps;
* every collision never increases total energy;
* a larger restitution leaves more energy in the system;
* a struck pin topples past the knockdown angle and settles;
* pin/pin contacts transfer momentum and never create energy;
* a fast ball cannot tunnel through a pin;
* a whole roll at 30, 60 and 240 fps produces the same pins-down set.

`tests/test_pin_state.py` covers the rack state machine: the eight-then-two
frame, a pin that keeps falling after the ball stops, a swept pin that can
never be counted again, rack/scorer agreement after every roll, and the
strike / spare / tenth-frame resets.

Real-lane accuracy (measured ball speed loss, pin scatter distances, strike
percentage) has **not** been validated against instrumented data; the test
suite only verifies that the code implements the documented equations and
conserves energy.
