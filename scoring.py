"""Standard ten-pin bowling scoring (USBC rules).

Pure Python + stdlib, no engine imports, so it can be unit-tested without
launching the game. The game records a pin count for each roll and this
module derives frames, marks (strike / spare / open), per-frame scores and
the running total.

The model is a flat, ordered list of rolls (each an ``int`` from 0..10).
Frames are derived from that list using the standard rules, so the class has
no knowledge of physics, input or rendering.
"""


class BowlingGame:
    """A complete ten-pin bowling scoring engine."""

    NUM_FRAMES = 10
    MAX_PINS = 10

    def __init__(self):
        self.rolls = []          # pin count for every roll, in order

    # ------------------------------------------------------------------ state
    def reset(self):
        """Clear all rolls and start a fresh game."""
        self.rolls = []

    def record_roll(self, pins):
        """Record the number of pins knocked down by the next roll.

        Raises ``TypeError`` for non-int input and ``ValueError`` for any
        roll that is not legal (out of range, more pins than are standing,
        or a roll attempted after the game is complete).
        """
        if isinstance(pins, bool) or not isinstance(pins, int):
            raise TypeError(f"pins must be an int, got {type(pins).__name__}")
        if self.is_complete:
            raise ValueError("cannot record a roll: game is already complete")
        if not 0 <= pins <= self.MAX_PINS:
            raise ValueError(
                f"pins must be between 0 and {self.MAX_PINS}, got {pins}")
        standing = self.standing_pins()
        if standing is None:
            raise ValueError("cannot record a roll: no pins are standing")
        if pins > standing:
            raise ValueError(
                f"cannot knock down {pins} pin(s): only {standing} standing")
        self.rolls.append(pins)

    # ------------------------------------------------------ frame derivation
    def _frame_bounds(self):
        """Return ``(start, end)`` flat indices for each of the ten frames."""
        bounds = []
        i = 0
        for frame in range(self.NUM_FRAMES):
            if frame == self.NUM_FRAMES - 1:
                # The final frame owns whatever rolls remain.
                bounds.append((i, len(self.rolls)))
                break
            if i >= len(self.rolls):
                bounds.append((i, i))
                continue
            first = self.rolls[i]
            if first == self.MAX_PINS:
                bounds.append((i, i + 1))       # strike: one roll
                i += 1
            else:
                end = min(i + 2, len(self.rolls))
                bounds.append((i, end))
                i = end
        return bounds

    def frame_rolls(self, frame_number):
        """Return the rolls belonging to ``frame_number`` (1-based)."""
        start, end = self._frame_bounds()[frame_number - 1]
        return list(self.rolls[start:end])

    def _is_frame_complete(self, index, rolls):
        """Whether frame ``index`` (0-based) is finished."""
        if index < self.NUM_FRAMES - 1:
            if not rolls:
                return False
            if rolls[0] == self.MAX_PINS:
                return True                    # strike ends the frame
            return len(rolls) >= 2
        # Final frame.
        if not rolls:
            return False
        if rolls[0] == self.MAX_PINS:
            return len(rolls) >= 3             # strike + two bonus rolls
        if len(rolls) >= 2 and rolls[0] + rolls[1] == self.MAX_PINS:
            return len(rolls) >= 3             # spare + one bonus roll
        return len(rolls) >= 2                 # open frame

    # -------------------------------------------------------------- queries
    @property
    def is_complete(self):
        frames = [self.frame_rolls(f) for f in range(1, self.NUM_FRAMES + 1)]
        return self._is_frame_complete(self.NUM_FRAMES - 1, frames[-1])

    @property
    def current_frame_number(self):
        """The 1-based number of the frame receiving the next roll."""
        for frame in range(1, self.NUM_FRAMES + 1):
            rolls = self.frame_rolls(frame)
            if not self._is_frame_complete(frame - 1, rolls):
                return frame
        return self.NUM_FRAMES

    @property
    def roll_in_frame(self):
        """0-based index of the next roll within its frame (0/1/2)."""
        if self.is_complete:
            return None
        return len(self.frame_rolls(self.current_frame_number))

    def standing_pins(self):
        """Pins available to knock down on the next roll, or None if done."""
        if self.is_complete:
            return None
        current = self.current_frame_number
        rolls = self.frame_rolls(current)
        if current < self.NUM_FRAMES:
            if not rolls:
                return self.MAX_PINS
            return self.MAX_PINS - rolls[0]
        # Final frame: racks reset after a strike or a spare.
        if not rolls:
            return self.MAX_PINS
        if rolls[0] == self.MAX_PINS:
            if len(rolls) == 1:
                return self.MAX_PINS
            if rolls[1] == self.MAX_PINS:
                return self.MAX_PINS
            return self.MAX_PINS - rolls[1]
        if len(rolls) == 1:
            return self.MAX_PINS - rolls[0]
        if rolls[0] + rolls[1] == self.MAX_PINS:
            return self.MAX_PINS
        return None

    # ---------------------------------------------------------------- marks
    def frame_marks(self, frame_number):
        """Return display marks for each roll: ``X``, ``/`` or a digit."""
        rolls = self.frame_rolls(frame_number)
        if frame_number < self.NUM_FRAMES:
            return _regular_marks(rolls, self.MAX_PINS)
        return _final_marks(rolls, self.MAX_PINS)

    # --------------------------------------------------------------- scoring
    def frame_score(self, frame_number):
        """Score for ``frame_number`` (1-based), or None if not yet resolved."""
        bounds = self._frame_bounds()
        start, end = bounds[frame_number - 1]
        rolls = self.rolls[start:end]
        if not rolls:
            return None

        if frame_number < self.NUM_FRAMES:
            if rolls[0] == self.MAX_PINS:
                # Strike: 10 + the next two rolls.
                bonus = self.rolls[end:end + 2]
                if len(bonus) < 2:
                    return None
                return self.MAX_PINS + sum(bonus)
            if len(rolls) < 2:
                return None
            if rolls[0] + rolls[1] == self.MAX_PINS:
                # Spare: 10 + the next one roll.
                if end >= len(self.rolls):
                    return None
                return self.MAX_PINS + self.rolls[end]
            return rolls[0] + rolls[1]

        # Final frame: sum of all its rolls, once complete.
        if not self._is_frame_complete(self.NUM_FRAMES - 1, rolls):
            return None
        return sum(rolls)

    def cumulative_scores(self):
        """Running total after each frame; None for unresolved frames."""
        result = []
        running = 0
        for frame in range(1, self.NUM_FRAMES + 1):
            score = self.frame_score(frame)
            if score is None:
                result.append(None)
            else:
                running += score
                result.append(running)
        return result

    @property
    def current_score(self):
        """The most recent resolved running total (0 before any rolls)."""
        for score in reversed(self.cumulative_scores()):
            if score is not None:
                return score
        return 0

    @property
    def total_score(self):
        """Final score once the game is complete, otherwise None."""
        if not self.is_complete:
            return None
        return self.cumulative_scores()[-1]


def _regular_marks(rolls, max_pins):
    """Marks for frames 1-9: strike only on the first roll."""
    marks = []
    for i, pins in enumerate(rolls):
        if i == 0 and pins == max_pins:
            marks.append("X")
        elif i == 1 and rolls[0] + pins == max_pins:
            marks.append("/")
        else:
            marks.append(str(pins))
    return marks


def _final_marks(rolls, max_pins):
    """Marks for the 10th frame, tracking fresh-rack resets."""
    marks = []
    fresh_rack = True            # the first ball always faces a full rack
    for i, pins in enumerate(rolls):
        if pins == max_pins and fresh_rack:
            marks.append("X")
            fresh_rack = True    # a strike resets the rack for the next ball
        elif i > 0 and not fresh_rack and rolls[i - 1] + pins == max_pins:
            marks.append("/")
            fresh_rack = True    # a spare resets the rack for the bonus ball
        else:
            marks.append(str(pins))
            fresh_rack = False
    return marks
