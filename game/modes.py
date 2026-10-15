"""Game-mode definitions: the single place each mode's rules are described.

Every mode is the *same* bowling simulation plus a different rule set, so a
mode is data: how many players, whether throws are question-gated, whether the
match is timed, how the score is kept, and which ball motif represents it in
the selection screen.

Nothing here implements physics or scoring; it only names the configuration
that :mod:`game.session` and the play screen apply.
"""
from dataclasses import dataclass, field

# Scoring styles.
SCORE_FRAMES = 'frames'      # standard ten-frame bowling scoring
SCORE_TOTAL_PINS = 'pins'    # total pins knocked down (BowlRush)

# Extra stages a mode inserts into the roll loop.
GATE_NONE = 'none'
GATE_TRIVIA = 'trivia'
GATE_EQUATIONS = 'equations'


@dataclass(frozen=True)
class ModeDefinition:
    """One playable mode."""

    id: str
    title: str
    subtitle: str            # short line under the title on the mode card
    summary: str             # one-line explanation for the picker card
    description: str         # what the player is about to play
    motif: str               # glyph drawn on the selection ball
    ball_rgb: tuple          # (r, g, b) 0-255, the selection ball / accent colour
    score_style: str = SCORE_FRAMES
    gate: str = GATE_NONE
    min_players: int = 1
    max_players: int = 1
    fixed_players: int = 0   # non-zero = the mode always has exactly this many
    #                          players (Trivia / Equations: 1); 0 means the
    #                          min/max range is used
    allow_bot: bool = False
    timed: bool = False
    default_duration: float = 180.0
    duration_options: tuple = (60.0, 120.0, 180.0, 300.0)
    frames: int = 10
    questions: int = 0
    resolves_every_throw: bool = False   # fresh rack + total-pins per throw
    requires_input_choice: bool = True
    single_throw_per_player: bool = False   # alternate every throw (BowlRush)
    rules: tuple = field(default_factory=tuple)

    @property
    def player_range(self):
        if self.fixed_players:
            return (self.fixed_players, self.fixed_players)
        return (self.min_players, self.max_players)

    def default_player_count(self):
        if self.fixed_players:
            return self.fixed_players
        return self.min_players + (1 if self.allow_bot else 0)


CLASSIC = ModeDefinition(
    id='classic',
    title='CLASSIC BOWLING',
    subtitle='Ten frames, real scoring',
    summary='Play a complete ten-frame bowling game.',
    description=('A full ten-frame game with standard scoring: strikes, spares, '
                 'the tenth-frame bonus balls and a running total.'),
    motif='X',
    ball_rgb=(34, 78, 200),
    rules=('10 frames, up to 2 rolls each',
           'Strike = 10 + your next 2 rolls',
           'Spare = 10 + your next roll',
           'The tenth frame earns bonus balls'),
)

TRIVIA = ModeDefinition(
    id='trivia',
    title='PHYSICS TRIVIA',
    subtitle='Right answer, then throw',
    summary='Answer physics questions to earn bowling throws.',
    description=('Answer a physics question to earn a throw. A correct answer '
                 'unlocks the roll; a wrong one costs you that throw.'),
    motif='?',
    ball_rgb=(232, 72, 168),
    score_style=SCORE_TOTAL_PINS,
    gate=GATE_TRIVIA,
    fixed_players=1,
    questions=10,
    resolves_every_throw=True,
    rules=('10 physics questions',
           'Correct answer = one throw at a full rack',
           'Wrong answer = no throw, the answer is explained',
           'Score = total pins knocked down'),
)

EQUATIONS = ModeDefinition(
    id='equations',
    title='EQUATION CHALLENGE',
    subtitle='Set the physics, curve the ball',
    summary='Solve physics challenges that steer the ball.',
    description=('Work out the release the challenge asks for - hook spin, '
                 'speed, angle, torque - and bowl it: the simulation then '
                 'shows what that value really does to the ball. Tune the '
                 'value until the pin falls.'),
    motif='Δv/t',
    ball_rgb=(96, 226, 176),
    score_style=SCORE_TOTAL_PINS,
    gate=GATE_EQUATIONS,
    fixed_players=1,
    questions=10,
    resolves_every_throw=True,
    rules=('10 interactive physics challenges',
           'Work out the one release value each challenge needs',
           'Bowl it: the real simulation decides the outcome',
           'Unlimited attempts, equations and measurements shown',
           'Score = pins knocked down'),
)

PVBOT = ModeDefinition(
    id='pvbot',
    title='PLAYER VS BOT',
    subtitle='Beat the house bowler',
    summary='Challenge a bowling AI with adjustable difficulty.',
    description=('One player against an AI bowler that aims and throws with '
                 'the same physics you do. Three difficulties.'),
    motif='AI',
    ball_rgb=(150, 96, 232),
    min_players=1,
    max_players=1,
    allow_bot=True,
    rules=('You and the bot alternate frames',
           'The bot picks its own line, speed and hook, then simulates it',
           'Easy, Medium and Hard change how well it aims',
           'Standard ten-frame scoring'),
)

LOCAL = ModeDefinition(
    id='local',
    title='LOCAL MULTIPLAYER',
    subtitle='Two to four bowlers',
    summary='Compete with two to four local players.',
    description=('Two to four people share the computer, taking turns frame '
                 'by frame. Standard ten-frame scoring.'),
    motif='2-4',
    ball_rgb=(255, 190, 60),
    min_players=2,
    max_players=4,
    rules=('2 to 4 players, alternating frames',
           'Standard ten-frame scoring for everyone',
           'Highest total wins; ties are reported as a draw'),
)

RUSHRUSH = ModeDefinition(
    id='bowlrush',
    title='BOWLRUSH',
    subtitle='Timed pin rush',
    summary='Race against the clock to knock down the most pins.',
    description=('Three minutes, two players, fresh rack every throw. Knock '
                 'down more pins than your rival before the clock runs out.'),
    motif='3:00',
    ball_rgb=(120, 220, 255),
    score_style=SCORE_TOTAL_PINS,
    min_players=2,
    max_players=2,
    timed=True,
    default_duration=180.0,
    resolves_every_throw=True,
    single_throw_per_player=True,
    rules=('Timed match, 3 minutes by default',
           'Frames do not count: every throw faces a fresh rack',
           'Players alternate throws',
           'A throw that starts before time runs out is allowed to finish',
           'Most pins knocked down wins'),
)

ALL = (CLASSIC, TRIVIA, EQUATIONS, PVBOT, LOCAL, RUSHRUSH)
BY_ID = {mode.id: mode for mode in ALL}

# The order the mode picker shows them in.
PICKER_ORDER = ('classic', 'trivia', 'equations', 'pvbot', 'local', 'bowlrush')


def get(mode_id):
    """Look a mode up by id (``KeyError`` for an unknown id)."""
    return BY_ID[mode_id]


def picker_modes():
    """The modes in picker order."""
    return tuple(BY_ID[mode_id] for mode_id in PICKER_ORDER)


def bot_difficulties():
    """(label, key) pairs for the bot difficulty picker."""
    return (('Easy', 'easy'), ('Medium', 'medium'), ('Hard', 'hard'))
