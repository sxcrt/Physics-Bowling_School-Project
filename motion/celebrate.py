"""The celebration rules: what to shout, how loud, and how much of it.

This module is the *brain* of the feedback pass, kept free of the engine (like
:mod:`motion.ease` and :mod:`motion.tween`) so the wording and the escalation
maths can be unit-tested in milliseconds:

* :func:`pins_popup_text` - the live "+1 PIN!" / "+3 PINS!" pop as pins drop;
* :func:`pins_result_text` - the roll summary ("8 PINS DOWN!");
* :func:`combo_label`     - the streak shout ("DOUBLE!", "TURKEY!", ...);
* :func:`streak_intensity` - 1.0 for a plain strike, growing with the streak;
* :func:`spare_label`     - the spare's sub-line;
* :func:`impact_intensity` / :func:`impact_shake_px` - how hard the ball hit;
* :func:`achievement`     - the end-of-match award (perfect game / best / win).

Everything reads :data:`motion.config.MOTION` live, so the escalation can be
tuned from one place (see ``docs/ANIMATION.md``).
"""
from motion.config import MOTION

# The end-of-match awards, best first: the director shows the first one whose
# flag is set. ``tier`` decides the size of the celebration (see the director).
ACHIEVEMENT_PERFECT = 'perfect'
ACHIEVEMENT_BEST = 'best'
ACHIEVEMENT_WIN = 'win'


def _clamp01(value):
    return 0.0 if value < 0.0 else (1.0 if value > 1.0 else value)


# ---------------------------------------------------------------------------
# Pin counts
# ---------------------------------------------------------------------------
def pins_popup_text(count):
    """The live pop-up as pins drop: ``+1 PIN!`` / ``+3 PINS!``.

    A single pin is the common case, and "PIN" is kept singular for it; a
    multi-pin frame (a pin taking two others with it) reads as a count.
    """
    count = max(1, int(count))
    if count == 1:
        return '+1 PIN!'
    return f'+{count} PINS!'


def pins_result_text(pins):
    """The roll summary the big card shows: ``4 PINS DOWN!`` / ``1 PIN DOWN!``."""
    pins = max(0, int(pins))
    if pins == 1:
        return '1 PIN DOWN!'
    return f'{pins} PINS DOWN!'


def pins_hold_scale(pins):
    """How long the summary is held, relative to the standard hold.

    A heavy count (8-9 pins) is a genuinely good ball and gets a little more
    screen time than a two-pin tap; a gutter keeps the shortest hold.
    """
    pins = max(0, min(10, int(pins)))
    if pins >= 8:
        return 1.25
    if pins >= 5:
        return 1.1
    if pins == 0:
        return 0.7
    return 1.0


# ---------------------------------------------------------------------------
# Strike / spare progressions
# ---------------------------------------------------------------------------
# The named streaks, exactly as the sport names them.
STREAK_LABELS = {
    2: 'DOUBLE!',
    3: 'TURKEY!',
    4: 'FOUR-BAGGER!',
    5: 'FIVE-BAGGER!',
    6: 'SIX-BAGGER!',
}


def combo_label(streak):
    """The sub-line under a strike card: '' for the first, then the shout.

    ``streak`` counts *consecutive* strikes including the current one, which is
    what the director already tracks. Beyond the named six it becomes a plain
    count ("7 IN A ROW!") so the escalation never runs out of words.
    """
    streak = int(streak)
    if streak <= 1:
        return ''
    if streak in STREAK_LABELS:
        return STREAK_LABELS[streak]
    return f'{streak} IN A ROW!'


def streak_tier(streak):
    """0 for one strike, 1 for two, 2 for three, 3 beyond: the FX tier."""
    streak = int(streak)
    if streak <= 2:
        return max(0, streak - 1)
    if streak == 3:
        return 2
    return 3


def streak_intensity(streak):
    """A media multiplier that grows with the streak (1.0 -> config cap)."""
    streak = max(1, int(streak))
    grown = 1.0 + MOTION.combo_intensity_step * (streak - 1)
    return min(MOTION.combo_intensity_max, grown)


def spare_label():
    """The spare's sub-line: it is a *conversion*, so it is named as one."""
    return MOTION.spare_sub_text


# ---------------------------------------------------------------------------
# Impact
# ---------------------------------------------------------------------------
def impact_intensity(speed, soft=None, reference=None):
    """0..1 from the ball's speed at the pins (``None`` -> 0).

    Below the soft threshold the deck only gets the light treatment; the
    reference speed is the one that earns the full shake / dust / ring.
    """
    if speed is None:
        return 0.0
    soft = MOTION.impact_soft_speed if soft is None else soft
    reference = MOTION.impact_reference_speed if reference is None else reference
    try:
        speed = float(speed)
    except (TypeError, ValueError):
        return 0.0
    span = max(1e-6, float(reference) - float(soft))
    return _clamp01((speed - float(soft)) / span)


def impact_shake_px(speed):
    """The camera shake for one ball-to-pin impact, in screen pixels."""
    intensity = impact_intensity(speed)
    if intensity <= 0.0:
        return 0.0
    low = MOTION.impact_shake_min
    return low + (MOTION.impact_shake_max - low) * intensity


def impact_dust_count(speed):
    """How many 3D sparks the impact earns."""
    intensity = impact_intensity(speed)
    return int(round(MOTION.dust_puff_impact
                     * (0.5 + 0.9 * intensity)))


def impact_flash_alpha(speed):
    """``0`` when the hit is not worth a screen flash, else the flash alpha."""
    intensity = impact_intensity(speed)
    if intensity < MOTION.impact_flash_min_intensity:
        return 0.0
    return MOTION.impact_flash_alpha * intensity


def pindrop_shake_px(delta):
    """The small thud when ``delta`` pins fall at once (capped)."""
    delta = max(0, int(delta))
    if delta <= 0:
        return 0.0
    return min(MOTION.pindrop_shake_max, MOTION.pindrop_shake_px * delta)


def pindrop_pop_scale(delta):
    """The pop text grows a little when several pins fall together."""
    delta = max(1, int(delta))
    return min(MOTION.pinpop_scale_max, MOTION.pinpop_scale + 0.12 * (delta - 1))


# ---------------------------------------------------------------------------
# End of match
# ---------------------------------------------------------------------------
def achievement(perfect=False, best=False, won=False, total=None,
                previous=None):
    """``(kind, title, subtitle, tier)`` for the end of a match, or ``None``.

    Only the *best* award that applies is returned, so the results screen can
    never stack three banners on top of each other.
    """
    if perfect:
        return (ACHIEVEMENT_PERFECT, MOTION.perfect_text,
                MOTION.perfect_sub_text, 3)
    if best:
        subtitle = MOTION.best_sub_text
        if total is not None:
            subtitle = (f'{int(total)} - your best yet.'
                        if previous is None
                        else f'{int(total)}, beating {int(previous)}.')
        return (ACHIEVEMENT_BEST, MOTION.best_text, subtitle, 2)
    if won:
        return (ACHIEVEMENT_WIN, MOTION.win_text, MOTION.win_sub_text, 1)
    return None


def achievement_event_count(tier):
    """How many celebration beats the results screen plays for an award."""
    return {3: 3, 2: 2}.get(int(tier), 1)


def achievement_confetti(tier):
    """The confetti shower size for an award tier (a particle count)."""
    tier = int(tier)
    if tier >= 3:
        return MOTION.perfect_confetti
    if tier == 2:
        return MOTION.best_confetti
    if tier == 1:
        return MOTION.win_confetti
    return MOTION.end_confetti


def achievement_flashes(tier):
    """How many edge flashes the award earns (0 = none)."""
    tier = int(tier)
    if tier >= 3:
        return MOTION.perfect_flashes
    if tier == 2:
        return MOTION.best_flashes
    if tier == 1:
        return MOTION.win_flashes
    return 0
