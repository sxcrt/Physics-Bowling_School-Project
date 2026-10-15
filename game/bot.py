"""The bot bowler: it picks its own line, speed and hook, then bowls.

The bot never decides how many pins fall. It chooses *launch conditions* and
hands them to the same simulation the player uses; whatever that simulation
does is the bot's result.

How it picks them
-----------------
1. It reads the pins still standing on the deck.
2. It builds a short list of candidate shots (a target line, a speed and a
   hook) whose spread depends on the difficulty.
3. It runs each candidate through :func:`physics.simulate_roll` - the exact
   deck simulation the game itself uses - and keeps the candidate that
   knocked down the most pins.

That evaluation is a *plan*, not a peek at the future: it is the bot running
the same deterministic model the player's throw will run, which is what a real
bowler's practised line is worth. Difficulty changes how many candidates it
can afford and how wide their spread is, so Easy bot throws are genuinely
inaccurate rather than secretly sabotaged.

The evaluation is incremental: :meth:`BotPlanner.step` runs for a small slice
of time per frame and reports progress, so planning never stalls the frame
loop and the player can see the bot preparing.
"""
import math
import random

import config
from input.mouse_input import ThrowData
from physics import simulate_roll

# Difficulty: how wide the candidate spread is, how many candidates the bot
# evaluates, and how long it is willing to spend on the decision.
DIFFICULTIES = {
    'easy': {
        'label': 'Easy',
        'candidates': 1,
        'line_sigma': 0.130,      # m of entry-point error at the pins
        'speed_sigma': 1.10,      # m/s
        'spin_sigma': 1.30,       # rad/s
        'deadline': 1.0,          # s of planning
    },
    'medium': {
        'label': 'Medium',
        'candidates': 3,
        'line_sigma': 0.075,
        'speed_sigma': 0.55,
        'spin_sigma': 0.80,
        'deadline': 3.0,
    },
    'hard': {
        'label': 'Hard',
        'candidates': 6,
        'line_sigma': 0.030,
        'speed_sigma': 0.22,
        'spin_sigma': 0.35,
        'deadline': 6.0,
    },
}

# Where a straight shot has to arrive to strike for a right-handed hook:
# the 1-3 pocket, a board and a half beside the head pin.
POCKET_OFFSET = 0.076                  # m
# How far the hook moves the ball sideways per rad/s of release spin. Measured
# from the simulation (about 0.07 m per rad/s over a full lane); it is only
# used to place the *candidate*, never to decide the result.
HOOK_DRIFT_PER_RAD = -0.075            # m per rad/s (+spin hooks towards -x)
BASE_SPEED = 7.6                       # m/s, a comfortable stock speed
DEFAULT_SPIN = -1.6                    # rad/s, a right-hander's hook


class BotPlanner:
    """Builds candidate throws for the current rack and picks the best."""

    def __init__(self, difficulty='medium', rng=None):
        self.difficulty = difficulty if difficulty in DIFFICULTIES else 'medium'
        self._rng = rng if rng is not None else random.Random()
        self._candidates = []
        self._index = 0
        self._best = None
        self._best_score = -1
        self._elapsed = 0.0
        self._active = False

    # ------------------------------------------------------------------ setup
    @property
    def settings(self):
        return DIFFICULTIES[self.difficulty]

    @property
    def label(self):
        return self.settings['label']

    @property
    def is_planning(self):
        return self._active

    @property
    def progress(self):
        """0..1 of the candidate list evaluated so far."""
        total = len(self._candidates)
        return 1.0 if total == 0 else min(1.0, self._index / float(total))

    def start(self, standing):
        """Begin planning a throw at ``standing`` (list of (x, z) pins)."""
        self._standing = list(standing)
        self._candidates = self._build_candidates(self._standing)
        self._index = 0
        self._best = None
        self._best_score = -1
        self._elapsed = 0.0
        self._active = True

    def cancel(self):
        self._active = False
        self._candidates = []
        self._index = 0

    # ------------------------------------------------------------------ plan
    def step(self, budget_seconds=0.02):
        """Evaluate candidates for ``budget_seconds``; returns a throw or None.

        Returns a :class:`ThrowData` once a decision has been made (either
        every candidate has been simulated or the planning deadline passed).
        """
        if not self._active:
            return None
        import time as _time
        started = _time.perf_counter()
        while self._index < len(self._candidates) and self._active:
            candidate = self._candidates[self._index]
            result = simulate_roll(
                speed=candidate.speed,
                lateral_position=candidate.lateral_position,
                launch_angle=candidate.launch_angle,
                spin_omega=candidate.spin_omega,
                standing=self._standing,
            )
            self._index += 1
            score = result.knockdowns
            self._note(candidate, score)
            if score > self._best_score:
                self._best_score = score
                self._best = candidate
            self._elapsed += _time.perf_counter() - started
            if (self._elapsed > self.settings['deadline']
                    or _time.perf_counter() - started > budget_seconds):
                break
        if self._index >= len(self._candidates) or self._elapsed > \
                self.settings['deadline']:
            self._active = False
            if self._best is None and self._candidates:
                self._best = self._candidates[0]
            return self._best
        return None

    def plan_now(self, standing, seed=None):
        """Synchronous convenience used by tests and tools."""
        rng = self._rng if seed is None else random.Random(seed)
        previous = self._rng
        self._rng = rng
        try:
            self.start(standing)
            result = None
            while result is None:
                result = self.step(budget_seconds=1.0)
            return result
        finally:
            self._rng = previous

    @property
    def last_best_score(self):
        """Predicted pinfall of the chosen candidate (a prediction, not a result)."""
        return self._best_score

    # -------------------------------------------------------------- internals
    def _note(self, candidate, score):
        candidate.predicted = score

    def _build_candidates(self, standing):
        settings = self.settings
        count = max(1, settings['candidates'])
        front = self._front_pin(standing)
        candidates = []
        for _ in range(count):
            # Target the pocket while the head pin stands, otherwise the
            # front-most pin that is still up: the same target selection a
            # bowler uses.
            if front is None:
                target_x = 0.0
            elif abs(front[0]) < 1e-6:
                target_x = POCKET_OFFSET
            else:
                target_x = front[0]
            entry = target_x + self._rng.gauss(0.0, settings['line_sigma'])
            speed = BASE_SPEED + self._rng.gauss(0.0, settings['speed_sigma'])
            speed = max(config.MIN_THROW_SPEED + 0.5,
                        min(config.MAX_THROW_SPEED, speed))
            spin = DEFAULT_SPIN + self._rng.gauss(0.0, settings['spin_sigma'])
            spin = max(-config.MAX_SPIN, min(config.MAX_SPIN, spin))
            candidates.append(self._throw_for_entry(entry, speed, spin))
        return candidates

    def _throw_for_entry(self, entry_x, speed, spin):
        """Launch conditions that send the ball through ``entry_x`` at the pins.

        The hook moves the ball by about ``HOOK_DRIFT_PER_RAD * spin`` over the
        lane, so the release line is offset by that much; the yaw that remains
        is clamped to ``config.MAX_AIM_ANGLE``, exactly like a player's aim.
        """
        drift = HOOK_DRIFT_PER_RAD * spin
        line_x = entry_x - drift
        # Stand so that the shot is a modest cross: half the difference is
        # taken out with the feet, half with the arm.
        lateral = max(-config.LATERAL_LIMIT,
                      min(config.LATERAL_LIMIT, line_x * 0.5))
        yaw = math.atan2(line_x - lateral, config.LANE_LENGTH)
        limit = math.radians(config.MAX_AIM_ANGLE)
        yaw = max(-limit, min(limit, yaw))
        return ThrowData(lateral_position=lateral, launch_angle=yaw,
                         speed=speed, spin_omega=spin, source='bot',
                         confidence=1.0)

    @staticmethod
    def _front_pin(standing):
        """The standing pin closest to the foul line, or None."""
        if not standing:
            return None
        return min(standing, key=lambda position: position[1])
