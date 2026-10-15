"""Players, turns and match state, shared by every mode.

A :class:`Match` owns the players, whose turn it is and how the score is kept;
it never touches physics, input or rendering. The play screen feeds it the pin
count of each finished roll and reacts to the events it returns, so the same
turn/scoring code drives Classic Bowling, Trivia, Equation Mode, Player vs
Bot, Local Multiplayer and BowlRush.

Scoring styles
--------------
* ``frames`` - :class:`scoring.BowlingGame` per player (standard ten-frame
  rules, including the tenth-frame bonus balls).
* ``pins``   - a running total of pins knocked down (BowlRush), with a fresh
  rack for every throw.
"""
from dataclasses import dataclass, field

from scoring import BowlingGame

PLAYER_COLORS = (
    (120, 220, 255),      # 1 - cyan
    (255, 122, 122),      # 2 - red
    (255, 214, 130),      # 3 - amber
    (150, 230, 150),      # 4 - green
)
MAX_NAME_LENGTH = 12
# Events Match.record_roll can return.
ROLL_RECORDED = 'recorded'
SAME_PLAYER = 'same_player'
TURN_CHANGED = 'turn_changed'
ROUND_CHANGED = 'round_changed'
MATCH_OVER = 'match_over'


def default_name(index):
    """Default label for player ``index`` (0-based)."""
    return f'PLAYER {index + 1}'


@dataclass
class Player:
    """One bowler: identity, colour, scores and session tallies."""

    index: int
    name: str = ''
    rgb: tuple = (255, 255, 255)
    is_bot: bool = False
    difficulty: str = 'medium'
    bowling: BowlingGame = field(default_factory=BowlingGame)
    total_pins: int = 0          # BowlRush (and long-run tallies)
    throws: int = 0
    answered: int = 0            # Trivia / Equations
    correct: int = 0
    last_knockdowns: int = 0

    def __post_init__(self):
        if not self.name:
            self.name = default_name(self.index)

    # ------------------------------------------------------------------ scores
    @property
    def frame_score(self):
        """Running standard score (what the scorecard header shows)."""
        return self.bowling.current_score

    @property
    def final_score(self):
        """Final score for the mode's scoring style, or None if unresolved."""
        if self.bowling.is_complete and self.bowling.total_score is not None:
            return self.bowling.total_score
        return None

    @property
    def score(self):
        """The number the HUD shows for this player right now."""
        final = self.final_score
        return final if final is not None else self.bowling.current_score

    @property
    def is_done(self):
        return self.bowling.is_complete

    def reset_scores(self):
        self.bowling.reset()
        self.total_pins = 0
        self.throws = 0
        self.answered = 0
        self.correct = 0
        self.last_knockdowns = 0


class Match:
    """Players, turn order and scoring for one play session."""

    def __init__(self, mode, players=None, duration=None):
        self.mode = mode
        self.players = list(players or [])
        if not self.players:
            self.players = [Player(0, rgb=PLAYER_COLORS[0])]
        self.turn_index = 0
        self.round_number = 1
        self.duration = (duration if duration is not None
                         else mode.default_duration)
        self.time_left = self.duration if mode.timed else None
        self.finished = False
        self.rolls_taken = 0

    # ------------------------------------------------------------------ setup
    @classmethod
    def create(cls, mode, player_specs=None, duration=None):
        """Build a match from ``player_specs`` (dicts or :class:`Player`)."""
        specs = list(player_specs or [])
        players = []
        for index, spec in enumerate(specs):
            if isinstance(spec, Player):
                spec.index = index
                players.append(spec)
                continue
            players.append(Player(
                index=index,
                name=spec.get('name', ''),
                rgb=spec.get('rgb', PLAYER_COLORS[index % len(PLAYER_COLORS)]),
                is_bot=bool(spec.get('is_bot', False)),
                difficulty=spec.get('difficulty', 'medium'),
            ))
        if not players:
            players = [Player(0, rgb=PLAYER_COLORS[0])]
        return cls(mode, players, duration=duration)

    def rebuild(self, player_specs=None, duration=None):
        """Reset for a rematch, keeping the mode and the player identities."""
        specs = player_specs
        if specs is None:
            specs = [{'name': p.name, 'rgb': p.rgb, 'is_bot': p.is_bot,
                      'difficulty': p.difficulty} for p in self.players]
        fresh = Match.create(self.mode, specs, duration=duration)
        self.players = fresh.players
        self.duration = fresh.duration
        self.time_left = fresh.time_left
        self.turn_index = 0
        self.round_number = 1
        self.finished = False
        self.rolls_taken = 0
        return self

    # ------------------------------------------------------------------ turns
    @property
    def current_player(self):
        return self.players[self.turn_index % len(self.players)]

    @property
    def player_count(self):
        return len(self.players)

    @property
    def uses_frames(self):
        return self.mode.score_style == 'frames'

    def set_turn(self, index):
        self.turn_index = index % len(self.players)
        self.round_number = self.turn_index + 1

    def next_turn(self):
        """Pass the turn to the next player still bowling, or finish."""
        for step in range(1, len(self.players) + 1):
            index = (self.turn_index + step) % len(self.players)
            if not self.players[index].is_done:
                self.set_turn(index)
                return True
        self.finished = True
        return False

    def advance(self):
        """Advance the turn or the round, once a player's turn is over."""
        if not self.uses_frames:
            if not self.next_turn():
                return 'match_over'
            return 'turn_changed'
        player = self.current_player
        if not player.is_done:
            return 'same_player'
        if not self.next_turn():
            return 'match_over'
        return 'turn_changed' if self.turn_index != 0 else 'round_changed'

    # ---------------------------------------------------------------- scoring
    def record_roll(self, pins, advance=True):
        """Record ``pins`` for the current player; return what changed.

        The returned event drives the play screen:

        * ``'recorded'`` - recorded without touching turns (``advance=False``,
          used by the question-gated modes and by BowlRush's own turn logic)
        * ``'same_player'`` - the frame is not finished, bowl again
        * ``'turn_changed'`` / ``'round_changed'`` - the next player is up
        * ``'match_over'`` - nobody has a throw left
        """
        if self.is_complete:
            return 'match_over'
        pins = int(pins)
        player = self.current_player
        player.throws += 1
        player.last_knockdowns = pins
        self.rolls_taken += 1
        if not self.uses_frames:
            # Total-pin scoring (BowlRush, Trivia, Equations): every throw is
            # scored on its own and a fresh rack faces the next one, so the
            # frame scorer is deliberately not involved.
            player.total_pins += max(0, pins)
            if not advance:
                return 'recorded'
            if not self.next_turn():
                return 'match_over'
            return 'turn_changed'
        # The scorer is authoritative about how many pins may fall; clamp so a
        # rack/scorer mismatch can never end the match with an exception.
        legal = player.bowling.standing_pins()
        if legal is not None:
            pins = max(0, min(pins, legal))
        frame_before = player.bowling.current_frame_number
        player.bowling.record_roll(pins)
        player.total_pins += pins
        if not advance:
            return 'recorded'
        if player.bowling.is_complete \
                or player.bowling.current_frame_number != frame_before:
            # The frame is finished: the next player is up (or the match ends).
            if not self.next_turn():
                return 'match_over'
            return 'turn_changed' if self.turn_index != 0 else 'round_changed'
        return 'same_player'

    def record_answer(self, correct):
        """Record a Trivia/Equations answer for the current player."""
        student = self.current_player
        student.answered += 1
        if correct:
            student.correct += 1

    def finish(self):
        """End the match now (time up, no throws left)."""
        self.finished = True
        for player in self.players:
            player.finished_pending = True

    # ------------------------------------------------------------------ timer
    def tick(self, dt):
        """Advance the BowlRush countdown; returns True while time remains."""
        if not self.mode.timed or self.time_left is None:
            return True
        self.time_left = max(0.0, self.time_left - dt)
        return self.time_left > 0.0

    @property
    def time_up(self):
        return self.mode.timed and (self.time_left is not None
                                    and self.time_left <= 0.0)

    # ---------------------------------------------------------------- results
    @property
    def is_complete(self):
        if self.mode.timed:
            return self.finished or self.time_up
        if self.finished:
            return True
        return all(player.is_done for player in self.players)

    def score_of(self, player):
        return player.total_pins if not self.uses_frames else player.score

    def scoreboard(self):
        """``[(player, score), ...]`` in turn order, for the results screen."""
        return [(player, self.score_of(player)) for player in self.players]

    def winners(self):
        """Players (usually one) with the best score; ties return several."""
        board = self.scoreboard()
        if not board:
            return []
        best = max(score for _player, score in board)
        return [player for player, score in board if score == best]

    def result_line(self):
        """One-line summary of the match outcome."""
        if not self.is_complete:
            return ''
        winners = self.winners()
        if len(winners) == 1:
            return f'{winners[0].name} WINS!'
        names = ' & '.join(player.name for player in winners)
        return f'DRAW: {names}'
