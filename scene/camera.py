"""Camera rig: a bowler's-eye view down the lane, plus a push-in on the deck.

The reference art is a one-point perspective: the camera sits a little above
the bowler's shoulder behind the foul line, the lane runs to a vanishing point
where the pins stand, and the surroundings frame the lane on both sides.

Shots
-----
* **ready** - a fixed wide shot from behind the foul line. The pins sit in the
  upper third of the frame, the ball in the lower third.
* **rolling** - the camera dollies down the lane at a fraction of the ball's
  speed (``config.CAMERA_DOLLY``). Slower than the ball, so the ball runs away
  from the camera towards the pins and both stay in frame.
* **deck** - once the ball reaches the pins the camera eases in on the pin
  deck and holds there so the fall and the count are clearly visible.
* **menu**, **modes**, **lab** - fixed framings for the non-gameplay screens,
  so the city, the lane and the pin deck stay visible behind the menus.

Every shot is defined by a target position and a target aim point; both are
smoothed with an exponential lerp, so transitions are continuous and no shot
change is a hard cut.
"""
from ursina import Vec3, camera, lerp, time

import config
from motion import ease
from motion.config import MOTION

_LOOK = None            # the smoothed aim point (world space)
_POS = None             # the smoothed *unshaken* camera position
_VIEW = 'game'          # 'game' follows the roll, anything else is fixed
_SHAKE = None           # callable -> (dx, dy, dz) metres, from the director
_FOV_TARGET = None      # target field of view (the pin-deck push-in)
_FOV_START = None
_FOV_TIME = None


def set_shake_provider(provider):
    """Register the camera shake (``callable() -> (x, y, z)`` in metres).

    The shake is applied on top of the smoothed position and never fed back
    into the smoothing, so the camera cannot drift while it shakes.
    """
    global _SHAKE
    _SHAKE = provider


def set_fov_target(fov):
    """Ask the camera to ease its field of view to ``fov`` over 600 ms."""
    global _FOV_TARGET, _FOV_START, _FOV_TIME
    if fov is None or abs(camera.fov - fov) < 0.01:
        _FOV_TARGET = None
        return
    _FOV_TARGET = float(fov)
    _FOV_START = float(camera.fov)
    _FOV_TIME = 0.0


def fov_push_in():
    """The pin-deck shot pulls the field of view in (60 -> 54)."""
    set_fov_target(MOTION.deck_fov)


def fov_reset():
    """Back to the wide ready view."""
    set_fov_target(config.CAMERA_FOV)


def _update_fov(dt):
    global _FOV_TARGET, _FOV_TIME
    if _FOV_TARGET is None:
        return
    duration = max(1e-3, MOTION.deck_fov_time)
    _FOV_TIME = min(1.0, (_FOV_TIME or 0.0) + dt / duration)
    camera.fov = ease.lerp(_FOV_START, _FOV_TARGET,
                           ease.STANDARD(_FOV_TIME))
    if _FOV_TIME >= 1.0:
        camera.fov = _FOV_TARGET
        _FOV_TARGET = None


def _ready_shot():
    position = Vec3(0.0, config.CAMERA_HEIGHT,
                    config.FOUL_LINE_Z - config.CAMERA_BEHIND)
    look = Vec3(0.0, config.CAMERA_LOOK_HEIGHT,
                config.FOUL_LINE_Z + config.CAMERA_LOOK_AHEAD)
    return position, look


def _rolling_shot(ball):
    """Follow the ball down the lane, keeping the pin deck in frame."""
    travelled = max(0.0, ball.physics.z - config.FOUL_LINE_Z)
    position = Vec3(
        ball.x * config.CAMERA_DOLLY * 0.5,
        config.CAMERA_HEIGHT + travelled * config.CAMERA_DOLLY_HEIGHT,
        config.FOUL_LINE_Z - config.CAMERA_BEHIND
        + travelled * config.CAMERA_DOLLY,
    )
    look = Vec3(
        ball.x * config.CAMERA_LOOK_SIDE,
        config.CAMERA_LOOK_HEIGHT,
        config.FOUL_LINE_Z + config.CAMERA_LOOK_AHEAD,
    )
    return position, look


def _deck_shot():
    """The pin-deck view held while the pins fall and the roll is counted."""
    position = Vec3(0.0, config.CAMERA_DECK_HEIGHT,
                    config.HEAD_PIN_Z - config.CAMERA_DECK_DISTANCE)
    look = Vec3(0.0, config.CAMERA_DECK_LOOK_HEIGHT, config.HEAD_PIN_Z + 0.5)
    return position, look


# Fixed shots for the menu screens (position, look).
FIXED_SHOTS = {
    # Wide shot down the lane towards the city: the lane, the pins and the
    # skyline read as a poster.
    'menu': (Vec3(0.0, 2.45, config.FOUL_LINE_Z - 7.4),
             Vec3(0.0, 1.45, config.FOUL_LINE_Z + 10.0)),
    # Close approach shot: where the mode balls are laid out.
    'modes': (Vec3(0.0, 1.30, config.FOUL_LINE_Z - 3.9),
              Vec3(0.0, 0.62, config.FOUL_LINE_Z + 3.2)),
    # Slightly higher three-quarter shot for the splash screen.
    'splash': (Vec3(-0.8, 2.30, config.FOUL_LINE_Z - 6.2),
               Vec3(0.10, 1.45, config.FOUL_LINE_Z + 9.5)),
    # Over the lane, for the Physics Lab's trajectory plots.
    'lab': (Vec3(0.0, 3.1, config.FOUL_LINE_Z - 5.2),
            Vec3(0.0, 0.30, config.FOUL_LINE_Z + 6.0)),
    # The pin deck, framed for a results table.
    'deck': (Vec3(0.0, 1.55, config.HEAD_PIN_Z - 8.2),
             Vec3(0.0, 0.45, config.HEAD_PIN_Z)),
}


def set_view(name):
    """Select the shot family: ``'game'`` (follows the roll) or a fixed shot."""
    global _VIEW
    _VIEW = name


def current_view():
    return _VIEW


def _shot(ball, state):
    """Return ``((position, look), smoothing)`` for the current game state."""
    if _VIEW != 'game' and _VIEW in FIXED_SHOTS:
        position, look = FIXED_SHOTS[_VIEW]
        return (position, look), config.CAMERA_DECK_SPEED
    if state == 'ready':
        return _ready_shot(), config.CAMERA_FOLLOW_SPEED
    if state == 'rolling' and ball.physics.z < config.PIN_CAMERA_TRIGGER_Z:
        return _rolling_shot(ball), config.CAMERA_FOLLOW_SPEED
    return _deck_shot(), config.CAMERA_DECK_SPEED


def setup_camera():
    global _LOOK, _POS, _FOV_TARGET
    camera.fov = config.CAMERA_FOV
    _FOV_TARGET = None
    position, look = _ready_shot()
    camera.position = position
    camera.look_at(look)
    _LOOK = Vec3(look)
    _POS = Vec3(position)


def update_camera(ball, state):
    """Move the camera towards the shot the current game state calls for."""
    global _LOOK, _POS
    (target_position, target_look), speed = _shot(ball, state)
    alpha = min(1.0, time.dt * speed)
    if _LOOK is None:
        _LOOK = Vec3(target_look)
    if _POS is None:
        _POS = Vec3(camera.position)
    _POS = lerp(_POS, target_position, alpha)
    _LOOK = lerp(_LOOK, target_look, alpha)
    camera.position = _POS + _shake_vector()
    camera.look_at(_LOOK)
    _update_fov(time.dt)


def _shake_vector():
    """The current shake offset in world units (zero when none is running)."""
    if _SHAKE is None:
        return Vec3(0, 0, 0)
    try:
        x, y, z = _SHAKE()
    except Exception:                        # pragma: no cover - animation only
        return Vec3(0, 0, 0)
    return Vec3(x, y, z)


def update_camera_fixed(view=None):
    """Move the camera towards a fixed shot (used by the menu screens)."""
    global _LOOK, _POS
    name = view if view is not None else _VIEW
    if name not in FIXED_SHOTS:
        return
    target_position, target_look = FIXED_SHOTS[name]
    alpha = min(1.0, time.dt * config.CAMERA_DECK_SPEED)
    if _LOOK is None:
        _LOOK = Vec3(target_look)
    if _POS is None:
        _POS = Vec3(camera.position)
    _POS = lerp(_POS, target_position, alpha)
    _LOOK = lerp(_LOOK, target_look, alpha)
    camera.position = _POS + _shake_vector()
    camera.look_at(_LOOK)
    _update_fov(time.dt)


# Kept for callers that only want the deck framing (tools, tests).
def focus_pin_deck():
    global _LOOK
    position, look = _deck_shot()
    camera.position = lerp(camera.position, position,
                           min(1.0, time.dt * config.CAMERA_DECK_SPEED))
    _LOOK = lerp(Vec3(look) if _LOOK is None else _LOOK, look,
                 min(1.0, time.dt * config.CAMERA_DECK_SPEED))
    camera.look_at(_LOOK)
