"""Mouse + keyboard input.

Produces a ``ThrowData`` object: the same launch data the webcam input and the
bot produce, so the physics layer never sees which device made the throw.

Controls
--------
* ``A`` / ``D`` (or the arrow keys) move the ball's release position across the
  lane: where the bowler stands on the approach.  **Position**.
* The mouse's horizontal position aims the shot: it picks the point the ball is
  sent through at the targeting arrows (4.572 m past the foul line, where the
  real arrows sit), sweeping the full lane width as the pointer crosses the
  screen.  The aim is shown on the lane and is *frozen* while the drag is held.
  **Direction**.
* Hold the left button, drag **back** (down the screen) and then **forward**
  (up the screen), and release to throw.  The fastest forward stroke of the drag
  sets the release speed; the forward distance the drag covered is a floor, so a
  tiny twitch cannot launch the ball.
* The *direction* of that forward stroke adds a release-direction yaw on top of
  the aim (a stroke that drifts left releases left).  **Launch direction**.
* The sideways speed of the drag adds **hook spin**: the ball slips sideways at
  release and friction curves it, exactly as the physics layer models it
  (see docs/PHYSICS.md).  Dragging right curves the ball right.
  **Curvature**.

Position, direction and curvature are separate quantities with separate
controls, and nothing here decides how many pins fall.  A release is only
generated when the ball may be thrown; the play screen owns that gate.

Release noise
-------------
A human release is never perfectly repeatable, so the release model supports a
small bounded perturbation of the *launch conditions* (yaw, speed, spin) from a
seeded generator.  It is off by default (``config.RELEASE_NOISE_*`` are 0.0):
variation comes from the player's own drag, and a test can set a seed to make a
noisy release reproducible.  It never touches the pin count.
"""
import math
import random
from dataclasses import dataclass

from ursina import held_keys, time, window

import config
from input.pointer import pointer_state, ui_pointer


@dataclass
class ThrowData:
    """Everything the game needs to know about a single throw."""
    lateral_position: float = 0.0   # metres, offset from lane centre at the foul line
    launch_angle: float = 0.0       # radians, yaw away from straight ahead
    speed: float = 0.0              # m/s initial linear speed
    spin_omega: float = 0.0         # rad/s hook spin about the line of travel
    source: str = 'mouse'           # 'mouse' | 'webcam' | 'bot' | 'script'
    confidence: float = 1.0         # 1.0 = a direct input, < 1.0 = estimated


def _clamp(value, low, high):
    return max(low, min(high, value))


def aim_angle(aim_offset, lateral_position, distance=None):
    """Yaw that sends the ball from ``lateral_position`` through the aim point.

    ``aim_offset`` is the x of the point the player is aiming at, measured
    beside the lane centre at ``distance`` (default ``config.AIM_ARROW_Z``,
    where the targeting arrows sit); the return value is clamped to
    ``config.MAX_AIM_ANGLE``. This is the same geometry a bowler uses to line
    up: the wider the angle to the aim point, the more the ball crosses the
    lane on the way to the pins.
    """
    distance = config.AIM_ARROW_Z if distance is None else distance
    if distance <= 1e-6:
        return 0.0
    limit = math.radians(config.MAX_AIM_ANGLE)
    yaw = math.atan2(aim_offset - lateral_position, distance)
    return _clamp(yaw, -limit, limit)


class ReleaseNoise:
    """Bounded, seeded perturbation of the launch conditions (see module doc).

    Every bound is a config value; with the shipped defaults all three are 0.0,
    so a throw is exactly the one the player's drag describes.
    """

    def __init__(self, seed=None):
        if seed is None:
            seed = config.RELEASE_NOISE_SEED
        self.seed = seed
        self._random = random.Random(seed)

    def apply(self, launch_angle, speed, spin):
        yaw = config.RELEASE_NOISE_YAW
        speed_noise = config.RELEASE_NOISE_SPEED
        spin_noise = config.RELEASE_NOISE_SPIN
        if yaw <= 0.0 and speed_noise <= 0.0 and spin_noise <= 0.0:
            return launch_angle, speed, spin
        if yaw > 0.0:
            launch_angle += math.radians(self._random.uniform(-yaw, yaw))
        if speed_noise > 0.0:
            speed += self._random.uniform(-speed_noise, speed_noise)
        if spin_noise > 0.0:
            spin += self._random.uniform(-spin_noise, spin_noise)
        return launch_angle, speed, spin


class MouseInput:
    """A mouse + keyboard control scheme (see the module docstring)."""

    def __init__(self, pointer=None, button=None, noise=None):
        self.lateral = 0.0          # release position (m)
        self.aim_offset = 0.0       # aim point beside centre at the arrows (m)
        self.aim_angle = 0.0        # yaw the pending throw will use (rad)
        self._pointer = pointer if pointer is not None else ui_pointer
        self._button = button       # callable -> bool, or None for the shared state
        self._noise = noise if noise is not None else ReleaseNoise()
        self._prev_pointer = None
        self._velocity = (0.0, 0.0)  # (lateral, forward) screen heights / s
        self._holding = False       # left button held (a swing is in progress)
        self._press = None          # pointer position where the drag started
        self._peak_forward = 0.0    # fastest forward drag speed seen this swing
        self._peak_lateral = 0.0    # fastest sideways drag speed seen this swing
        self._stroke_forward = 0.0  # forward speed at the fastest stroke sample
        self._stroke_lateral = 0.0  # lateral speed at the fastest stroke sample
        self._travel = 0.0          # forward distance the drag covered
        self._pending = None        # ThrowData produced on release
        self._aim_locked = None     # aim captured when the swing started
        self.last_release = None    # diagnostics: the last released conditions

    # ------------------------------------------------------------ ThrowSource
    def update(self):
        x, y, dt = self._sample_pointer()
        self._update_lateral()
        self._update_aim()
        self._update_throw(x, y, dt)

    @property
    def pointer_available(self):
        """True when the pointer comes from a real device (not a placeholder)."""
        provider = self._pointer
        if provider is not ui_pointer:
            return True
        return pointer_state().available

    def _sample_pointer(self):
        """Read the pointer and derive its velocity in screen heights / second."""
        x, y = self._pointer()
        dt = _clamp(float(time.dt), 1e-4, 0.1)
        if self._prev_pointer is not None and dt > 1e-3:
            dx = x - self._prev_pointer[0]
            dy = y - self._prev_pointer[1]
            aspect = max(1e-6, float(window.aspect_ratio))
            self._velocity = (dx / aspect / dt, dy / dt)
        else:
            self._velocity = (0.0, 0.0)
        self._prev_pointer = (x, y)
        return x, y, dt

    def _button_down(self):
        if self._button is not None:
            try:
                return bool(self._button())
            except Exception:                    # pragma: no cover - test seam
                return False
        try:
            from ursina import mouse
            if mouse.left:
                return True
        except Exception:                        # pragma: no cover - engine quirk
            pass
        return bool(pointer_state().left)

    def _update_lateral(self):
        direction = 0.0
        if held_keys['a'] or held_keys['left arrow']:
            direction -= 1.0
        if held_keys['d'] or held_keys['right arrow']:
            direction += 1.0
        # x = x0 + v * t
        self.lateral += direction * config.LATERAL_SPEED * time.dt
        self.lateral = _clamp(self.lateral, -config.LATERAL_LIMIT,
                              config.LATERAL_LIMIT)

    def _update_aim(self):
        """Aim with the mouse's horizontal position while no swing is held.

        The whole screen width sweeps the aim across the lane: the pointer's
        position as a fraction of the half-screen picks the point at the
        targeting arrows, so the player sees the aim marker travel with the
        mouse instead of sticking at the edges after a few pixels.
        """
        if self._aim_locked is not None:
            self.aim_offset = self._aim_locked
        else:
            cursor_x, _cursor_y = self._pointer()
            half = max(1e-6, float(window.aspect_ratio) / 2.0)
            fraction = _clamp(cursor_x / half, -1.0, 1.0)
            self.aim_offset = fraction * config.MOUSE_AIM_RANGE
        self.aim_angle = aim_angle(self.aim_offset, self.lateral)

    def _update_throw(self, x, y, dt):
        held = self._button_down()
        if held and not self._holding:
            # Start a new swing: the aim the player has lined up is frozen.
            self._holding = True
            self._press = (x, y)
            self._aim_locked = self.aim_offset
            self._peak_forward = 0.0
            self._peak_lateral = 0.0
            self._stroke_forward = 0.0
            self._stroke_lateral = 0.0
            self._travel = 0.0
            self._velocity = (0.0, 0.0)
            return
        if held:
            # Direction convention (matches a real bowling swing):
            #   dragging DOWN the screen (toward the player) = BACKSWING
            #   dragging UP the screen (away, toward the pins) = FORWARD swing
            lateral, forward = self._velocity
            self._travel += max(0.0, forward * dt)
            if forward > self._peak_forward:
                self._peak_forward = forward
                self._stroke_forward = forward
                self._stroke_lateral = lateral
            if abs(lateral) > abs(self._peak_lateral):
                self._peak_lateral = lateral
            return
        if not self._holding:
            return
        # Released: build a throw from the drag the player just made.
        self._holding = False
        self._release()
        self._aim_locked = None
        self._press = None

    def _release(self):
        speed = self._peak_forward * config.THROW_SPEED_SCALE
        if speed < config.MIN_THROW_SPEED or self._travel < config.MIN_DRAG_DISTANCE:
            return
        speed = _clamp(speed, config.MIN_THROW_SPEED, config.MAX_THROW_SPEED)
        direction = self._release_direction()
        launch_angle = _clamp(self.aim_angle + direction,
                              -config.MAX_LAUNCH_ANGLE, config.MAX_LAUNCH_ANGLE)
        spin = _clamp(self._peak_lateral * config.SPIN_SCALE * config.SPIN_SIGN,
                      -config.MAX_SPIN, config.MAX_SPIN)
        launch_angle, speed, spin = self._noise.apply(launch_angle, speed, spin)
        speed = _clamp(speed, config.MIN_THROW_SPEED, config.MAX_THROW_SPEED)
        spin = _clamp(spin, -config.MAX_SPIN, config.MAX_SPIN)
        throw = ThrowData(lateral_position=self.lateral,
                          launch_angle=launch_angle, speed=speed,
                          spin_omega=spin, source='mouse')
        self._pending = throw
        self.last_release = throw

    def _release_direction(self):
        """Yaw added by the *direction* of the forward stroke (radians).

        The stroke's sideways-to-forward speed ratio is the tangent of the
        angle the player dragged through, scaled by RELEASE_DIRECTION_GAIN and
        capped at MAX_RELEASE_YAW: a straight drag adds nothing, a drag that
        drifts right releases right, exactly as the hand's path would.
        """
        if self._stroke_forward <= 1e-3:
            return 0.0
        ratio = self._stroke_lateral / self._stroke_forward
        yaw = math.degrees(math.atan(ratio)) * config.RELEASE_DIRECTION_GAIN
        return math.radians(_clamp(yaw, -config.MAX_RELEASE_YAW,
                                   config.MAX_RELEASE_YAW))

    @property
    def throw_data(self):
        """Return the pending ThrowData once, or None if none is waiting."""
        data = self._pending
        self._pending = None
        return data

    def discard_pending(self):
        """Drop any queued throw.

        Called when a new roll is set up so a swing that finished during the
        previous roll's result delay cannot fire an unintended throw.
        """
        self._pending = None

    @property
    def swing_pose(self):
        """Continuously measured swing position for the avatar: -1 back .. +1 up.

        This is presentation only. It is the drag's vertical offset in screen
        heights (from where the button went down), so the character's arm
        follows the drag exactly.
        """
        if not self._holding or self._press is None:
            return 0.0
        _x, y = self._pointer()
        return _clamp((y - self._press[1]) / 0.30, -1.0, 1.0)

    @property
    def dragging(self):
        """True while the left button is held (the ball is 'in hand')."""
        return bool(self._holding)

    @property
    def power(self):
        """The drag's power so far, 0..1 (drives the on-screen power meter).

        The fill follows the fastest forward stroke of the drag, relative to
        the fastest throw the game allows, so the meter fills exactly as the
        release speed would climb - a smooth, monotonic readout of the swing
        the player is making.
        """
        fastest = config.MAX_THROW_SPEED / max(1e-6, config.THROW_SPEED_SCALE)
        return _clamp(self._peak_forward / fastest, 0.0, 1.0)

    def reset(self):
        """Return to the pre-throw state (used between players and matches)."""
        self._holding = False
        self._peak_forward = 0.0
        self._peak_lateral = 0.0
        self._stroke_forward = 0.0
        self._stroke_lateral = 0.0
        self._travel = 0.0
        self._aim_locked = None
        self._pending = None
        self._press = None
        self._velocity = (0.0, 0.0)
        self._prev_pointer = None
