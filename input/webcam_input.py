"""Webcam input: turns tracked body motion into the game's existing throws.

``WebcamInput`` satisfies the ``input.base.ThrowSource`` protocol exactly like
``MouseInput`` does, so the game loop, ball launch, physics and scoring never
learn which device produced a throw. It owns exactly one ``TrackingService``
(camera capture + pose inference on a background thread) and one
``SwingClassifier`` (the temporal movement classifier that recognizes the
tracking -> ready -> backswing -> forward -> release sequence).

The mapping from a recognized ``SwingEvent`` to the game's ``ThrowData`` is
kept in ``event_to_throw`` and sized by SWING_SPEED_SCALE / WEBCAM_AIM_SCALE:
a webcam estimates body motion, so these are configurable heuristics, not
physical measurements, and they are the single place to calibrate later.
"""
import math
import time
from dataclasses import dataclass
from pathlib import Path

import config
from input.classifier import SwingClassifier
from input.mouse_input import ThrowData
from tracking.pose import PoseResult
from tracking.service import TrackingService

_BODY_POINTS = ('left_shoulder', 'right_shoulder', 'left_hip', 'right_hip')
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _clamp(value, low, high):
    return max(low, min(high, value))


@dataclass(frozen=True)
class WebcamStatus:
    """Snapshot of everything the HUD needs to describe webcam tracking."""
    running: bool = False
    tracked: bool = False
    confidence: float = 0.0
    fps: float = 0.0
    error: str | None = None
    phase: str = 'waiting'
    phase_label: str = 'Waiting for ready position'
    hint: str = ''
    lost_seconds: float | None = None
    telemetry: str = ''
    arm: str = 'auto'          # selected throwing arm ('auto' | 'left' | 'right')


def event_to_throw(event, mirror=None):
    """Map a recognized swing onto the game's existing ThrowData parameters.

    The swing model is the same position / direction / curvature split the
    mouse uses, so both inputs describe a throw in the same physical terms:

    * **Position** - the player's body position at release (mirrored to match
      the on-screen selfie view), scaled by WEBCAM_AIM_SCALE and clamped to the
      lane. Standing left starts the ball left; this is a measured lateral
      position, not a guess.
    * **Direction (aim)** - the release hand's cross-body offset (in torso
      heights) maps to a small yaw by SWING_AIM_SCALE and is clamped to
      MAX_AIM_ANGLE. A frontal camera cannot measure where the ball is pointed,
      so this is a documented heuristic derived from a *measured* landmark
      offset.
    * **Direction (release)** - the sideways hand speed of the swing adds a
      release-direction yaw, the same idea as the mouse drag's drifted stroke:
      a swing that crosses the body releases towards that side. Also a
      heuristic, capped at MAX_RELEASE_YAW.
    * **Curvature (hook)** - the same sideways hand speed is mapped to hook
      spin by SWING_SPIN_SCALE. A webcam cannot see the ball's spin axis, so
      this is an estimate; it is the only place that conversion happens, and
      the simulation decides what the spin does to the path.

    * Speed: detected peak upward hand speed (image heights/s) scaled by
      SWING_SPEED_SCALE, clamped to the same MIN/MAX as mouse throws.
    """
    mirror = config.WEBCAM_MIRROR if mirror is None else mirror
    body_x = 1.0 - event.body_x if mirror else event.body_x
    lateral = _clamp(
        (body_x - 0.5) * 2.0 * config.LATERAL_LIMIT * config.WEBCAM_AIM_SCALE,
        -config.LATERAL_LIMIT, config.LATERAL_LIMIT)
    speed = _clamp(event.up_speed * config.SWING_SPEED_SCALE,
                   config.MIN_THROW_SPEED, config.MAX_THROW_SPEED)
    hand_offset = -event.hand_offset if mirror else event.hand_offset
    aim_limit = math.radians(config.MAX_AIM_ANGLE)
    aim = _clamp(math.radians(config.SWING_AIM_SCALE * hand_offset),
                 -aim_limit, aim_limit)
    lateral_speed = -event.lateral_speed if mirror else event.lateral_speed
    release = _clamp(math.radians(config.SWING_RELEASE_DIR_SCALE * lateral_speed),
                     -math.radians(config.MAX_RELEASE_YAW),
                     math.radians(config.MAX_RELEASE_YAW))
    launch_limit = math.radians(config.MAX_LAUNCH_ANGLE)
    launch_angle = _clamp(aim + release, -launch_limit, launch_limit)
    spin = _clamp(lateral_speed * config.SWING_SPIN_SCALE * config.SPIN_SIGN,
                  -config.MAX_SPIN, config.MAX_SPIN)
    return ThrowData(lateral_position=lateral, launch_angle=launch_angle,
                     speed=speed, spin_omega=spin, source='webcam',
                     confidence=float(event.confidence))


class WebcamInput:
    """A ThrowSource backed by webcam body tracking.

    ``update()`` is called every rendered frame; it only advances the swing
    classifier when the tracking service has published a *new* camera frame, so
    inference is never duplicated. Throws are only generated while the game
    reports itself ready (``set_game_ready``), which also forces the player to
    re-establish the ready pose after every roll.
    """

    def __init__(self, service=None, classifier=None, clock=None, log_path=None):
        self._service = service if service is not None else TrackingService()
        self._classifier = classifier if classifier is not None else SwingClassifier()
        self._clock = clock if clock is not None else time.monotonic
        self._log_path = log_path
        self._last_phase = None
        self._last_rejected = 0
        self._frames_processed = 0
        self._pending = None
        self._game_ready = False
        self._last_frame_count = -1
        self._last_process_time = None
        self.lateral = 0.0
        self._lateral_smoothed = 0.0

    # ---------------------------------------------------- ThrowSource API
    def update(self):
        """Advance the detector by at most one camera frame per rendered frame."""
        snapshot = self._service.snapshot()
        if not self._game_ready:
            return
        if snapshot.frame_count != self._last_frame_count:
            self._last_frame_count = snapshot.frame_count
            self._process_frame(snapshot)
        if snapshot.tracked:
            self._update_lateral(snapshot)

    @property
    def throw_data(self):
        """Return the pending ThrowData once, or None if none is waiting."""
        data = self._pending
        self._pending = None
        return data

    def discard_pending(self):
        """Drop any queued throw (called between rolls)."""
        self._pending = None

    # ------------------------------------------------------- game wiring
    def set_game_ready(self, ready):
        """Tell the input whether a throw may be generated right now.

        Every transition resets the detector, so a swing that started while
        the ball was rolling can never leak into the next roll, and the
        player must return to the ready position before swings are armed.
        """
        ready = bool(ready)
        if ready == self._game_ready:
            return
        self._game_ready = ready
        self._classifier.reset()
        self._pending = None
        self._last_frame_count = -1
        self._last_process_time = None
        self._last_rejected = getattr(self._classifier, 'rejected_count', 0)

    # ---------------------------------------------------------- lifecycle
    def start(self):
        """Start camera capture and pose inference (background thread)."""
        self._classifier.reset()
        self._pending = None
        self._last_frame_count = -1
        self._last_process_time = None
        self._last_phase = None
        self._last_rejected = getattr(self._classifier, 'rejected_count', 0)
        self._frames_processed = 0
        self._open_log_session()
        self._service.start()

    def stop(self):
        """Stop tracking and release the camera. Safe to call repeatedly."""
        self._service.stop()
        self._classifier.reset()
        self._pending = None
        self._log('--- session stop ---')

    @property
    def is_running(self):
        return self._service.is_running

    # -------------------------------------------------------- throwing arm
    @property
    def preferred_arm(self):
        """Configured throwing arm: 'auto', 'left' or 'right'."""
        return getattr(self._classifier, 'preferred_arm', 'auto')

    def set_preferred_arm(self, arm):
        """Select the throwing arm and restart the gesture detector."""
        setter = getattr(self._classifier, 'set_preferred_arm', None)
        if callable(setter):
            setter(arm)
        self._classifier.reset()

    def cycle_preferred_arm(self):
        """Rotate auto -> right -> left -> auto; returns the new selection."""
        order = ('auto', 'right', 'left')
        current = self.preferred_arm
        index = order.index(current) if current in order else 0
        arm = order[(index + 1) % len(order)]
        self.set_preferred_arm(arm)
        return arm

    # ------------------------------------------------------------- status
    def status(self):
        """Build the immutable status record the HUD renders."""
        snapshot = self._service.snapshot()
        lost_seconds = None
        if not snapshot.tracked and snapshot.last_tracked_at is not None:
            lost_seconds = max(0.0, time.monotonic() - snapshot.last_tracked_at)
        telemetry = ''
        if config.WEBCAM_SHOW_TELEMETRY:
            data = getattr(self._classifier, 'telemetry', None)
            if data:
                telemetry = (f"{data['arm'][0].upper()} arm: {data['direction']} "
                             f"{abs(data['speed']):.2f}/s   depth {data['depth']:.2f}   "
                             f"rise {data['rise']:.2f}")
        return WebcamStatus(
            running=snapshot.running or self._service.is_running,
            tracked=snapshot.tracked,
            confidence=snapshot.confidence,
            fps=snapshot.fps,
            error=snapshot.error,
            phase=self._classifier.phase,
            phase_label=self._classifier.label,
            hint=self._classifier.hint,
            lost_seconds=lost_seconds,
            telemetry=telemetry,
            arm=self.preferred_arm,
        )

    def latest_snapshot(self):
        """Latest tracking snapshot (used by the in-game feed panel)."""
        return self._service.snapshot()

    @property
    def swing_pose(self):
        """Continuously measured swing position for the avatar: -1 back .. +1 up.

        Presentation only: it reports where the tracked throwing hand is
        relative to the shoulders, so the character mirrors the player's real
        arm between the backswing and the release.
        """
        pose = getattr(self._classifier, 'swing_pose', 0.0)
        try:
            return max(-1.0, min(1.0, float(pose)))
        except (TypeError, ValueError):          # pragma: no cover
            return 0.0

    @property
    def dragging(self):
        """True while a swing is armed (the ball is 'in hand')."""
        phase = getattr(self._classifier, 'phase', 'tracking')
        return phase in ('backswing', 'forward', 'release')

    @property
    def power(self):
        """The swing's power so far, 0..1 (drives the on-screen power bar).

        The detector reports the hand's upward speed as a fraction of the
        threshold a release needs, which maps onto the meter exactly as the
        mouse drag's stroke speed does.
        """
        value = getattr(self._classifier, 'release_progress', None)
        if value is None:
            pose = self.swing_pose
            value = max(0.0, pose)
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):          # pragma: no cover
            return 0.0

    # -------------------------------------------------------------- logging
    def _log(self, message):
        """Append one line to the swing log; never raise into the game loop."""
        try:
            path = (Path(self._log_path) if self._log_path
                    else PROJECT_ROOT / config.SWING_LOG_FILENAME)
            if not config.SWING_LOG_ENABLED and self._log_path is None:
                return
            with open(path, 'a', encoding='utf-8') as handle:
                handle.write(f'{time.strftime("%H:%M:%S")}  {message}\n')
        except OSError:
            pass

    def _open_log_session(self):
        if not config.SWING_LOG_ENABLED and self._log_path is None:
            return
        try:
            path = (Path(self._log_path) if self._log_path
                    else PROJECT_ROOT / config.SWING_LOG_FILENAME)
            if path.exists() and path.stat().st_size > 400_000:
                path.unlink()
        except OSError:
            pass
        self._log('--- session start ---')

    # ------------------------------------------------------------ internals
    def _process_frame(self, snapshot):
        now = self._clock()
        if self._last_process_time is None:
            dt = 1.0 / 30.0        # first frame after arming: no interval yet
        else:
            dt = now - self._last_process_time
        self._last_process_time = now
        result = PoseResult(
            landmarks=snapshot.landmarks,
            confidence=snapshot.confidence,
            tracked=snapshot.tracked,
            timestamp=now,
        )
        event = self._classifier.update(result, dt)
        summary = getattr(self._classifier, 'telemetry_summary', None)
        summary = summary() if callable(summary) else ''
        if self._classifier.phase != self._last_phase:
            self._log(f'phase -> {self._classifier.phase}  [{summary}]  '
                      f'({self._classifier.hint})')
            self._last_phase = self._classifier.phase
        # Log frames the detector refused to trust (jumps, loss, bad timing).
        rejected = getattr(self._classifier, 'rejected_count', 0)
        if rejected != self._last_rejected:
            self._last_rejected = rejected
            reason = getattr(self._classifier, 'last_reject_reason', 'unknown')
            self._log(f'frame rejected: {reason}  [{summary}]')
        self._frames_processed += 1
        if config.SWING_LOG_VERBOSE and config.SWING_LOG_EVERY_FRAMES > 0:
            if self._frames_processed % config.SWING_LOG_EVERY_FRAMES == 0:
                self._log(f'frame {self._frames_processed}: [{summary}] '
                          f'conf={result.confidence:.2f} '
                          f'phase={self._classifier.phase}')
        if event is not None and self._pending is None:
            throw = event_to_throw(event)
            self._pending = throw
            self._log(f'RELEASE arm={event.arm} up={event.up_speed:.2f}/s '
                      f'-> speed={throw.speed:.1f} m/s '
                      f'lateral={throw.lateral_position:+.2f} m')

    def _update_lateral(self, snapshot):
        xs = []
        for name in _BODY_POINTS:
            landmark = snapshot.landmarks.get(name)
            if (landmark is not None
                    and landmark.visibility >= config.TRACKING_VISIBILITY_THRESHOLD):
                xs.append(landmark.x)
        if not xs:
            return
        body_x = sum(xs) / len(xs)
        mirrored = 1.0 - body_x if config.WEBCAM_MIRROR else body_x
        target = _clamp(
            (mirrored - 0.5) * 2.0 * config.LATERAL_LIMIT * config.WEBCAM_AIM_SCALE,
            -config.LATERAL_LIMIT, config.LATERAL_LIMIT)
        alpha = config.WEBCAM_LATERAL_SMOOTHING
        self._lateral_smoothed += alpha * (target - self._lateral_smoothed)
        self.lateral = self._lateral_smoothed
