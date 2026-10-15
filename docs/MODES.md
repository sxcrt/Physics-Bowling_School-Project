# Game modes

Every mode is the **same bowling simulation** with a different rule set. A
mode changes who throws, when they may throw, what counts as a score and what
is on screen - never how a pin falls. The physics, the pin rack, the scoring
engine and the input adapters are shared.

| Mode | id | Players | Scoring | Gate | Timed |
| --- | --- | --- | --- | --- | --- |
| Classic Bowling | `classic` | 1 | ten frames | - | - |
| Physics Trivia | `trivia` | 1 | total pins | question | - |
| Equation Challenge | `equations` | 1 | total pins | challenge | - |
| Player vs Bot | `pvbot` | 1 human + 1 bot | ten frames | - | - |
| Local Multiplayer | `local` | 2-4 humans | ten frames | - | - |
| BowlRush | `bowlrush` | 2 humans | total pins | - | 3 min default |

The registry lives in `game/modes.py` (one `ModeDefinition` per mode), the
turn/scoring layer in `game/session.py`, and the play screen that applies both
is `game/play.py`.

## The roll loop

Every throw, in every mode, runs the same state machine:

```
question  -> ready -> rolling -> settling -> result -> (next roll | handoff |
                                                        next question | over)
challenge -> rolling -> settling -> challenge result -> (retry | next | over)
```

* `question` - Physics Trivia only: a correct answer unlocks one throw.
* `challenge` - Equation Challenge only: the interactive problem is on screen
  with its leave already standing. Any number of attempts is allowed; each
  attempt launches the real simulation (no timer runs).
* `ready` - the ball waits at the foul line and the input adapter may produce
  a throw. This is also where the BowlRush clock runs.
* `rolling` - ball and pins are integrated together by `physics.Deck`.
* `settling` - the ball has stopped; the deck is still falling, and the count
  waits for it (or for `config.SETTLE_MAX_TIME`).
* `result` - the count is on screen. The pinsetter sweeps when the next roll
  is set up, so the fallen pins stay visible while the result is read.
* `handoff` - multi-player turns: the next bowler must take over explicitly.
* `game_over` - final scores, winner, rematch.

## Classic Bowling

Ten frames, up to two rolls per frame, standard scoring from
`scoring.BowlingGame`: a strike scores 10 + the next two rolls, a spare 10 +
the next roll, and the tenth frame earns bonus balls with the correct rack
resets. The scorecard only shows a cumulative total once the frame that
produced it has all its bonus rolls.

## Physics Trivia

A **knowledge** mode. Ten questions drawn from `game.questions.TRIVIA_QUESTIONS`
(speed, velocity, acceleration, displacement, force, impulse, momentum, kinetic
energy, angular motion and collisions). A correct answer unlocks one throw at a
full rack; a wrong answer forfeits that throw and the correct answer plus a
short explanation is shown. The throw itself is a normal bowling throw - the
player aims and releases exactly as in Classic Bowling. The final summary
reports both the answers and the pins knocked down, because they are two
different things.

## Equation Challenge

A **problem-solving** mode. Each of the ten challenges
(`game/challenges.py`) is a real leave on the deck with every variable stated
except one - the value the player must work out from the physics. The player
types that value, presses BOWL IT, and the game launches it into the *same*
simulation every other mode uses. Nothing decides the outcome in advance: if
the value was wrong the ball really does miss, and if it was right the pin
really does fall.

| Case | Challenges | What the player sets | Concept |
| --- | --- | --- | --- |
| 1 - line it up | point at the 10 pin; pick the release spot | launch angle (deg); release x0 (m) | straight-line geometry, `atan` |
| 2 - speed down the lane | arrive at 6.0 m/s; curve to the corner by speed alone | release speed (m/s) | rolling resistance `v^2 = u^2 - 2 a d`; the drift is `t = d/v` |
| 3 - spin and the hook | the 6 pin; the lone 10 pin (gutter risk); the 7 pin | signed hook spin (rad/s) | slip `s = R omega`, kinetic friction, the skid model |
| 4 - rotation dynamics | spin from a stated angular momentum; spin up by torque | spin (rad/s); torque (N m) | `L = I omega`, `I = (2/5) m R^2`, `omega = tau dt / I` |
| 5 - the impact | leave the pin at 2.5 m/s | release speed (m/s) | impulse `J = (1+e) v / (1/m + 2/m_p)`, `v_pin = J / m_p` |

Every challenge is marked by the simulation, not by comparing the typed number
to a stored answer:

* the leave is rebuilt from the regulation rack positions (a lone 10 pin, a
  single head pin, ...), so the target is a real pin at a real spot;
* the typed value becomes the launch conditions (`lateral_position`,
  `speed`, `launch_angle`, `spin_omega`; a torque is converted with
  `omega = tau dt / I` first);
* the panel reports the *measured* pass error, the drift, the arrival speed,
  the inferred pin speed and whether the target pins fell;
* the expected value from the model is shown in the worked solution, and
  `tests/test_challenges.py` verifies against the engine that it really does
  solve the challenge.

Unlimited time and unlimited attempts: after a miss the panel keeps the typed
value, the measurements, and unlocks the next progressive hint step. After two
misses a SHOW SOLUTION button offers the full worked solution. Once the target
pin falls (or the solution is revealed) CONTINUE moves to the next challenge.
The score is the pins knocked down across every attempt; the results screen
reports the pins, the attempts and how many challenges were solved.

The lane diagram in the panel is drawn from the deck's real geometry and
overlays the *recorded trajectory* of the last attempt, so the player can see
what the physics did before reading a single number. It is deliberately
foreshortened (19 m into 150 px) so the pin deck is visible at the same time
as the release point, but every coordinate in it is the real one.

### The model behind the answers

The challenges use the equations `physics.py` implements, and nothing else.
The curvature is not "spin -> a number of boards": the release spin makes the
contact point slip sideways at `s = R |omega|`, kinetic friction cancels that
slip in `t_s = 2 R |omega| / (7 mu_k g)` and gives the ball a sideways
velocity `(2/7) R omega` in the process, and the ball then rolls straight along
the direction it picked up:

```
D(omega) = (2/7) R omega (t - t_s/2),   t = d / v,   t_s = 2 R |omega| / (7 mu_k g)
```

so the drift depends on the speed and the distance as well as the spin (the
same spin curves about 80% further at 5 m/s than at 9 m/s). `docs/PHYSICS.md`
§1.5 derives the relation and lists the calibration table. The closed form
neglects rolling resistance *during the roll* and the engine's sub-step
discretisation; both are far inside the 0.17 m contact window, and the test
suite checks the model against the engine's own trajectory.

## Player vs Bot

One human against a bot that bowls through the same simulation. The bot builds
a list of candidate shots around the pocket (or the front-most standing pin),
runs each candidate through `physics.simulate_roll` and bowls the one that
scored best. It never decides a pin count directly.

Difficulty changes only how the bot *aims* and how many candidates it can
afford to evaluate:

| Difficulty | Candidates | Entry-point error | Speed error | Planning deadline |
| --- | --- | --- | --- | --- |
| Easy | 1 | 0.130 m | 1.10 m/s | 1.0 s |
| Medium | 3 | 0.075 m | 0.55 m/s | 3.0 s |
| Hard | 6 | 0.030 m | 0.22 m/s | 6.0 s |

Planning is incremental (a time slice per frame, with a "lining up the shot"
message), so the frame rate is never blocked. Typical measured pinfall on a
full rack: Easy 6.4, Medium 7.9, Hard 8.5 per throw.

## Local Multiplayer

Two to four human players, alternating frames, standard scoring, separate
scorecards. Names are typed on the setup panel and appear in the player strip
and the results. (Player vs Player was removed in the Equation Mode pass: its
two-human flow is exactly Local Multiplayer with two players, and the separate
mode only duplicated it on the picker.)

## BowlRush

A timed match (60 s, 120 s, 180 s default or 300 s) for two players sharing the
computer. Every throw faces a fresh rack and the score is the number of pins
knocked down; there are no frames. Rules that the implementation enforces:

* the clock runs while a player is eligible to throw (in `ready` and
  `handoff`), so stalling costs the stalling player time;
* the clock is frozen while the ball is rolling, settling or showing a result,
  and while the game is paused - a throw that starts in time always resolves
  in full;
* once the clock expires no new throw can start and the match is finalised
  after the current throw (if any) has finished;
* the winner is the higher total pin count; a tie is reported as a draw.
