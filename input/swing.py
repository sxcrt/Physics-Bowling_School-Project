"""Bowling swing recognition from tracked body landmarks (pure Python).

LEGACY / LOW-LEVEL MOTION SENSOR. This module is a deliberately sensitive
phase machine and the Python-side parity reference for
``src/input/swing.js``. It recognizes *motion*, not intent: the recorded
jumping-jacks trace releases through it. The shipping decision layer in both
builds is ``input/classifier.py`` (ported from ``src/input/classifier.js``),
which requires the whole tracking -> ready -> backswing -> forward -> release
sequence. This detector remains exported, unit-tested and parity-checked as
the motion sensor it is (see docs/WEBCAM_SWING.md).

The detector turns a stream of ``tracking.pose.PoseResult`` frames into phase
transitions and, once per swing, a ``SwingEvent``. It is deliberately
heuristic and forgiving: a webcam estimates body motion, so the event carries
normalized measurements only - never claimed physical ball speed.
``input.webcam_input`` maps the event onto the game's existing ``ThrowData``
parameters, isolated in one place so it can be calibrated later.

How a throw is recognized (any of these paths):

1. Full swing:  ready -> the hand moves back/down relative to the shoulders
   (backswing) -> reverses upward (forward) -> release when the hand rises
   enough (crosses the release plane fast, or the upward stroke peaks).
2. Short swing:  ready -> the arm swings straight forward and up (no visible
   backswing - real backswings are often hidden behind the body) -> release.

Motion is measured relative to the mid-shoulder point and the displacements
are scaled by the player's own torso height, so leaning, stepping, camera
panning or walking on the spot do not read as arm motion. The hand position
prefers the wrist landmark and falls back to the hand landmarks
(index/pinky/thumb) when the wrist is occluded.

Guards against accidental throws: the player must first hold a still ready
pose; a release needs sustained upward motion on several frames, a minimum
hand rise and a minimum peak speed; implausible landmark jumps, low
confidence, irregular frame timing and tracking loss suspend the swing
instead of guessing. One-frame spikes, slow waving and small wiggles are
rejected. After a release, the phase moves to follow-through and the detector
only re-arms after a deliberate return to the ready pose, so one swing can
never fire twice.

The detector is pure: no engine, camera or MediaPipe imports, which keeps it
unit-testable.
"""
import math
from dataclasses import dataclass

import config

# Conceptual phases from the milestone spec:
#   waiting       -> State F: RESET (waiting for a valid starting position)
#   ready         -> State A: READY (may be held indefinitely, no timeout)
#   backswing     -> State B: BACKSWING (deliberate backwards arm movement)
#   forward       -> State C: FORWARD SWING (release is evaluated here)
#   follow_through-> State E: FOLLOW-THROUGH (no further throws until reset)
# The release itself (State D) is the ``SwingEvent`` returned by ``update``.
PHASE_WAITING = 'waiting'
PHASE_READY = 'ready'
PHASE_BACKSWING = 'backswing'
PHASE_FORWARD = 'forward'
PHASE_FOLLOW = 'follow_through'

PHASE_LABELS = {
    PHASE_WAITING: 'Waiting for ready position',
    PHASE_READY: 'Ready',
    PHASE_BACKSWING: 'Backswing',
    PHASE_FORWARD: 'Forward swing',
    PHASE_FOLLOW: 'Throw released',
}

PHASE_HINTS = {
    PHASE_WAITING: 'Stand still with your arms down and wait for READY.',
    PHASE_READY: 'Swing your arm forward and up to throw.',
    PHASE_BACKSWING: 'Now swing forward!',
    PHASE_FORWARD: 'Keep going - release!',
    PHASE_FOLLOW: 'Throw detected - return to the ready position.',
}

_WRISTS = {'left': 'left_wrist', 'right': 'right_wrist'}
_ELBOWS = {'left': 'left_elbow', 'right': 'right_elbow'}
_HANDS = {
    'left': ('left_index', 'left_pinky', 'left_thumb'),
    'right': ('right_index', 'right_pinky', 'right_thumb'),
}
_ARMS = ('right', 'left')
_PREFERRED_ARMS = ('auto', 'left', 'right')


@dataclass(frozen=True)
class SwingEvent:
    """One recognized bowling swing, in normalized image units.

    ``rise`` and ``depth`` are fractions of the player's torso height.
    ``lateral_speed`` is the sideways hand speed at release in image
    heights/s (positive = image right); it is mapped to hook spin by
    ``input.webcam_input``.
    ``hand_offset`` is the release hand's horizontal distance from the
    shoulder line, in torso heights (positive = image right); it is mapped to
    the aim yaw.
    """
    up_speed: float      # peak upward wrist speed (image heights / second)
    body_x: float        # body centre x at release (0..1, raw image coords)
    arm: str             # 'left' or 'right'
    duration: float      # seconds from swing start to release
    time: float          # detector time when the release fired
    release_speed: float = 0.0    # upward speed on the release frame (1/s)
    rise: float = 0.0             # hand rise since the lowest point (torso heights)
    depth: float = 0.0            # backswing depth (torso heights)
    confidence: float = 0.0       # tracking confidence at release
    hand_source: str = 'wrist'    # 'wrist' or 'hand' (landmark fallback)
    lateral_speed: float = 0.0    # sideways hand speed at release (1/s)
    hand_offset: float = 0.0      # release hand x - shoulder line (torso heights)


@dataclass(frozen=True)
class _Sample:
    """One hand measurement for a frame (wrist, or hand landmarks)."""
    x: float
    y: float
    visibility: float
    source: str


class SwingDetector:
    """Temporal phase machine for a bowling-style arm swing."""

    def __init__(self, overrides=None):
        self._overrides = dict(overrides or {})
        self.phase = PHASE_WAITING
        self._time = 0.0
        self._frames = 0
        self._ready_hold = 0.0
        self._ready_bad_time = 0.0
        self._swing_arm = None
        self._swing_start_rel = 0.0
        self._backswing_deepest_rel = 0.0
        self._phase_started = 0.0
        self._swing_started_at = None
        self._peak_up_speed = 0.0
        self._forward_low_rel = 0.0
        self._forward_rising_frames = 0
        self._rise = 0.0
        self._lost_frames = 0
        self._prev_shoulder_y = None
        self._notice = None
        self._notice_time = 0.0
        self._prev_raw = {arm: None for arm in _ARMS}
        self._smooth = {arm: None for arm in _ARMS}
        self._prev_source = {arm: None for arm in _ARMS}
        self._prev_elbow = {arm: None for arm in _ARMS}
        self._vel = {arm: 0.0 for arm in _ARMS}          # smoothed, + = downward
        self._raw_vel = {arm: 0.0 for arm in _ARMS}      # last frame, + = downward
        self._lateral_vel = {arm: 0.0 for arm in _ARMS}  # smoothed, + = image right
        self._hand_source = {arm: 'wrist' for arm in _ARMS}
        self._ready_rel = {arm: None for arm in _ARMS}   # last standing hand offset
        self._frame_confidence = 0.0
        self._torso_height = 0.0
        # Session diagnostics (deliberately not cleared by reset()).
        self.rejected_count = 0
        self.lost_count = 0
        self.release_count = 0
        self.abort_count = 0
        self.last_reject_reason = None

    # ------------------------------------------------------------- settings
    def _c(self, name):
        return self._overrides.get(name, getattr(config, name))

    @property
    def preferred_arm(self):
        """Configured throwing arm: 'auto', 'left' or 'right'."""
        value = str(self._c('SWING_PREFERRED_ARM')).lower()
        return value if value in _PREFERRED_ARMS else 'auto'

    def set_preferred_arm(self, arm):
        """Select the throwing arm at runtime ('auto' detects either arm)."""
        arm = str(arm).lower()
        if arm not in _PREFERRED_ARMS:
            raise ValueError(f'unknown throwing arm: {arm!r}')
        self._overrides['SWING_PREFERRED_ARM'] = arm

    # ------------------------------------------------------- public queries
    @property
    def label(self):
        """Human-readable name of the current phase."""
        return PHASE_LABELS.get(self.phase, self.phase)

    @property
    def hint(self):
        """What the player should do next (recent notices take priority)."""
        if (self._notice is not None
                and self._time - self._notice_time <= self._c('SWING_NOTICE_TIME')):
            return self._notice
        return PHASE_HINTS.get(self.phase, '')

    @property
    def telemetry(self):
        """Compact live numbers for the HUD and the swing log."""
        arm = self._swing_arm
        if arm is None:
            arm = ('right' if abs(self._vel['right']) >= abs(self._vel['left'])
                   else 'left')
        speed = self._vel[arm]
        if speed > 0.05:
            direction = 'down'
        elif speed < -0.05:
            direction = 'up'
        else:
            direction = 'still'
        depth = 0.0
        if self._swing_arm is not None:
            depth = max(0.0, self._backswing_deepest_rel - self._swing_start_rel)
        return {
            'arm': arm,
            'speed': speed,
            'direction': direction,
            'depth': depth,
            'rise': self._rise,
            'peak_up': self._peak_up_speed,
            'confidence': self._frame_confidence,
            'hand': self._hand_source.get(arm, 'wrist'),
            'jumps': self.rejected_count,
        }

    def telemetry_summary(self):
        """One-line telemetry string for the swing log."""
        t = self.telemetry
        return (f"arm={t['arm']} v={t['speed']:+.2f} ({t['direction']}) "
                f"depth={t['depth']:.2f} rise={t['rise']:.2f} "
                f"peak={t['peak_up']:.2f} hand={t['hand']}")

    @property
    def swing_pose(self):
        """Hand height relative to the shoulders, in torso heights.

        ``-1`` is a hand well below the shoulders (ready stance / backswing)
        and ``+1`` is a hand well above them (the release). Used only to drive
        the on-screen character; the throw itself is built from a recognized
        :class:`SwingEvent`.
        """
        if self._torso_height <= 0.0:
            return 0.0
        arm = self._swing_arm
        if arm is None:
            arm = ('right' if abs(self._vel['right']) >= abs(self._vel['left'])
                   else 'left')
        pos = self._smooth.get(arm)
        if pos is None:
            return 0.0
        # Image y grows downwards, so a *negative* offset is above the shoulder.
        value = -pos[1] / (0.35 * self._torso_height)
        return max(-1.0, min(1.0, value))

    # ---------------------------------------------------------------- state
    def reset(self):
        """Return to waiting for a ready position (no swing in flight)."""
        self.phase = PHASE_WAITING
        self._ready_hold = 0.0
        self._ready_bad_time = 0.0
        self._swing_arm = None
        self._swing_start_rel = 0.0
        self._backswing_deepest_rel = 0.0
        self._swing_started_at = None
        self._peak_up_speed = 0.0
        self._forward_low_rel = 0.0
        self._forward_rising_frames = 0
        self._rise = 0.0
        self._lost_frames = 0
        self._prev_shoulder_y = None
        self._notice = None
        self._prev_raw = {arm: None for arm in _ARMS}
        self._smooth = {arm: None for arm in _ARMS}
        self._prev_source = {arm: None for arm in _ARMS}
        self._prev_elbow = {arm: None for arm in _ARMS}
        self._vel = {arm: 0.0 for arm in _ARMS}
        self._raw_vel = {arm: 0.0 for arm in _ARMS}
        self._lateral_vel = {arm: 0.0 for arm in _ARMS}
        self._hand_source = {arm: 'wrist' for arm in _ARMS}
        self._ready_rel = {arm: None for arm in _ARMS}

    # --------------------------------------------------------- core update
    def update(self, result, dt=1.0 / 30.0):
        """Advance the detector by one processed camera frame.

        ``result`` is a ``tracking.pose.PoseResult``. Returns a ``SwingEvent``
        exactly once per recognized swing, otherwise None.
        """
        try:
            raw_dt = float(dt)
        except (TypeError, ValueError):
            raw_dt = 1.0 / 30.0
        if not math.isfinite(raw_dt) or raw_dt <= 0.0:
            raw_dt = 1.0 / 30.0
        step_dt = max(1.0 / 240.0, min(0.2, raw_dt))
        self._time += step_dt
        self._frames += 1
        self._frame_confidence = float(getattr(result, 'confidence', 0.0) or 0.0)

        if not result.tracked or not result.landmarks:
            return self._unreliable('no pose detected')
        if self._frame_confidence < self._c('SWING_MIN_CONFIDENCE'):
            return self._unreliable('low tracking confidence')
        if raw_dt > self._c('SWING_MAX_FRAME_GAP'):
            return self._unreliable('irregular frame timing')

        torso = self._torso(result.landmarks)
        if torso is None:
            return self._unreliable('torso not visible')
        shoulder_y, hip_y, body_x, shoulder_x = torso
        torso_h = hip_y - shoulder_y
        if torso_h < self._c('SWING_MIN_TORSO_HEIGHT'):
            return self._unreliable('torso too small')
        self._torso_height = torso_h
        if (self._prev_shoulder_y is not None
                and abs(shoulder_y - self._prev_shoulder_y)
                > self._c('SWING_MAX_TORSO_JUMP')):
            return self._unreliable('torso landmark jump')
        self._prev_shoulder_y = shoulder_y
        self._lost_frames = 0

        if self._track_samples(result.landmarks, shoulder_x, shoulder_y, step_dt):
            return None                 # a landmark jump was rejected this frame

        if self.phase == PHASE_WAITING:
            self._update_waiting(torso_h, step_dt)
        elif self.phase == PHASE_READY:
            self._update_ready(torso_h, step_dt)
        elif self.phase == PHASE_BACKSWING:
            self._update_backswing(torso_h)
        elif self.phase == PHASE_FORWARD:
            event = self._update_forward(torso_h, body_x)
            if event is not None:
                return event
        elif self.phase == PHASE_FOLLOW:
            if self._time - self._phase_started >= self._c('SWING_FOLLOW_TIME'):
                self._to_waiting()
        return None

    # ---------------------------------------------------------- phase logic
    def _update_waiting(self, torso_h, dt):
        self._remember_ready_positions(torso_h)
        if self._is_ready_pose(torso_h):
            self._ready_hold += dt
            if self._ready_hold >= self._c('SWING_READY_HOLD'):
                self.phase = PHASE_READY
                self._ready_bad_time = 0.0
        else:
            self._ready_hold = 0.0

    def _update_ready(self, torso_h, dt):
        # A visible backswing (hand moving down relative to the shoulders)
        # starts the full swing path.
        arm = self._backswing_candidate()
        if arm is not None:
            self._begin_backswing(arm)
            return
        # Otherwise a strong upward stroke swings straight from ready: real
        # backswings are often hidden behind the body, and the forward/up
        # motion is the part a frontal camera always sees.
        arm = self._direct_throw_candidate()
        if arm is not None:
            self._begin_forward(arm, baseline=self._ready_rel.get(arm))
            return
        self._remember_ready_positions(torso_h)
        if self._is_ready_pose(torso_h):
            self._ready_bad_time = 0.0
            return
        # Hysteresis: a brief wobble does not drop the armed state (which
        # stops tracking noise from oscillating between ready and waiting),
        # but a sustained loss of the ready pose resets the detector.
        self._ready_bad_time += dt
        if self._ready_bad_time >= self._c('SWING_READY_GRACE_TIME'):
            self.phase = PHASE_WAITING
            self._ready_hold = 0.0

    def _update_backswing(self, torso_h):
        arm = self._swing_arm
        pos = self._pos(arm)
        if pos is not None:
            self._backswing_deepest_rel = max(self._backswing_deepest_rel, pos[1])
        depth = (self._backswing_deepest_rel - self._swing_start_rel) / torso_h
        elapsed = self._time - self._phase_started
        up_speed = -self._vel[arm]
        if (depth >= self._c('SWING_BACK_MIN_DEPTH')
                and elapsed >= self._c('SWING_BACK_MIN_TIME')
                and up_speed >= self._c('SWING_FORWARD_UP_SPEED')):
            self._begin_forward(arm)
        elif elapsed >= self._c('SWING_BACK_TIMEOUT'):
            self._abort('No forward swing detected - swing your arm forward.')

    def _update_forward(self, torso_h, body_x):
        arm = self._swing_arm
        pos = self._pos(arm)
        elapsed = self._time - self._phase_started
        if pos is not None:
            up_smoothed = -self._vel[arm]
            up_raw = -self._raw_vel[arm]
            self._peak_up_speed = max(self._peak_up_speed, up_smoothed)
            self._rise = max(0.0, (self._forward_low_rel - pos[1]) / torso_h)
            if up_raw >= self._c('SWING_FORWARD_UP_SPEED'):
                self._forward_rising_frames += 1

            release_rel = self._c('SWING_RELEASE_FRACTION') * torso_h
            crossed = (pos[1] <= release_rel
                       and up_raw >= self._c('SWING_RELEASE_UP_SPEED'))
            min_speed = self._c('SWING_RELEASE_MIN_SPEED')
            peaked = (self._peak_up_speed >= min_speed
                      and up_smoothed < max(min_speed * 0.5,
                                            self._peak_up_speed * 0.5))
            release_ready = (
                elapsed >= self._c('SWING_FORWARD_MIN_TIME')
                and self._forward_rising_frames >= self._c('SWING_RELEASE_MIN_FRAMES')
                and self._rise >= self._c('SWING_RELEASE_MIN_RISE')
                and self._peak_up_speed >= min_speed)
            if release_ready and (crossed or peaked):
                return self._release(arm, body_x, torso_h)
        if elapsed >= self._c('SWING_FORWARD_TIMEOUT'):
            self._abort('No release detected - swing your arm forward and up.')
        return None

    # ------------------------------------------------------------- helpers
    def _pos(self, arm):
        """Smoothed hand offset relative to the shoulder, or None."""
        return self._smooth[arm]

    def _torso(self, landmarks):
        """Return (shoulder_y, hip_y, body_x, shoulder_x) or None."""
        points = []
        for name in ('left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'):
            landmark = landmarks.get(name)
            if landmark is None or landmark.visibility < self._c('SWING_WRIST_VISIBILITY'):
                return None
            points.append(landmark)
        shoulder_y = (points[0].y + points[1].y) / 2.0
        hip_y = (points[2].y + points[3].y) / 2.0
        body_x = sum(point.x for point in points) / 4.0
        shoulder_x = (points[0].x + points[1].x) / 2.0
        return shoulder_y, hip_y, body_x, shoulder_x

    def _sample(self, landmarks, arm):
        """Prefer the wrist, fall back to the hand landmarks when occluded."""
        min_visibility = self._c('SWING_WRIST_VISIBILITY')
        wrist = landmarks.get(_WRISTS[arm])
        if wrist is not None and wrist.visibility >= min_visibility:
            return _Sample(wrist.x, wrist.y, wrist.visibility, 'wrist')
        points = []
        for name in _HANDS[arm]:
            landmark = landmarks.get(name)
            if landmark is not None and landmark.visibility >= min_visibility:
                points.append(landmark)
        if not points:
            return None
        count = float(len(points))
        return _Sample(
            sum(point.x for point in points) / count,
            sum(point.y for point in points) / count,
            sum(point.visibility for point in points) / count,
            'hand')

    def _track_samples(self, landmarks, shoulder_x, shoulder_y, dt):
        """Smooth and differentiate both hands; returns True if a jump was
        rejected this frame (the frame must then be skipped entirely)."""
        rejected = False
        smoothing = self._c('SWING_LANDMARK_SMOOTHING')
        vel_smoothing = self._c('SWING_VELOCITY_SMOOTHING')
        max_jump = self._c('SWING_MAX_JUMP')
        max_speed = self._c('SWING_MAX_SPEED')
        min_visibility = self._c('SWING_WRIST_VISIBILITY')
        for arm in _ARMS:
            sample = self._sample(landmarks, arm)
            elbow = landmarks.get(_ELBOWS[arm])
            elbow_rel = None
            if elbow is not None and elbow.visibility >= min_visibility:
                elbow_rel = (elbow.x - shoulder_x, elbow.y - shoulder_y)
            if sample is None:
                self._hand_source[arm] = 'wrist'
                self._prev_raw[arm] = None
                self._smooth[arm] = None
                self._prev_source[arm] = None
                self._prev_elbow[arm] = None
                self._raw_vel[arm] = 0.0
                self._vel[arm] *= (1.0 - vel_smoothing)   # decay stale motion
                self._lateral_vel[arm] *= (1.0 - vel_smoothing)
                continue
            self._hand_source[arm] = sample.source
            rel = (sample.x - shoulder_x, sample.y - shoulder_y)
            previous_raw = self._prev_raw[arm]
            invalid = None
            if previous_raw is not None and sample.source == self._prev_source[arm]:
                jump = math.hypot(rel[0] - previous_raw[0],
                                  rel[1] - previous_raw[1])
                if jump > max_jump or jump / dt > max_speed:
                    invalid = (f'{arm} hand jumped {jump:.2f} units in one frame')
            previous_elbow = self._prev_elbow[arm]
            if invalid is None and elbow_rel is not None and previous_elbow is not None:
                jump = math.hypot(elbow_rel[0] - previous_elbow[0],
                                  elbow_rel[1] - previous_elbow[1])
                if jump > max_jump or jump / dt > max_speed:
                    invalid = (f'{arm} elbow jumped {jump:.2f} units in one frame')
            # A teleporting landmark or an impossibly fast sample is a
            # tracking glitch, never a throw: ignore the sample and abort any
            # swing it might otherwise have faked a release for.
            if invalid is not None:
                rejected = True
                self.rejected_count += 1
                self.last_reject_reason = invalid
                if (self._swing_arm == arm
                        and self.phase in (PHASE_BACKSWING, PHASE_FORWARD)):
                    self._abort('Hand tracking jumped mid-swing - try again.')
                self._prev_raw[arm] = rel
                self._prev_elbow[arm] = elbow_rel
                self._smooth[arm] = None
                self._raw_vel[arm] = 0.0
                self._vel[arm] = 0.0
                self._lateral_vel[arm] = 0.0
                continue
            self._prev_elbow[arm] = elbow_rel
            if sample.source != self._prev_source[arm]:
                # Wrist <-> hand fallback: restart the velocity baseline so the
                # source switch itself cannot create a spike.
                self._smooth[arm] = None
            self._prev_source[arm] = sample.source
            previous = self._smooth[arm]
            if previous is None:
                smoothed = rel
                raw_x = raw_y = 0.0
            else:
                smoothed = (smoothing * rel[0] + (1.0 - smoothing) * previous[0],
                            smoothing * rel[1] + (1.0 - smoothing) * previous[1])
                raw_x = (smoothed[0] - previous[0]) / dt
                raw_y = (smoothed[1] - previous[1]) / dt
            self._prev_raw[arm] = rel
            self._smooth[arm] = smoothed
            self._raw_vel[arm] = raw_y
            self._vel[arm] = (vel_smoothing * raw_y
                              + (1.0 - vel_smoothing) * self._vel[arm])
            self._lateral_vel[arm] = (vel_smoothing * raw_x
                                      + (1.0 - vel_smoothing) * self._lateral_vel[arm])
        return rejected

    def _is_ready_pose(self, torso_h):
        """A still pose with every *visible* hand at/below chest height.

        Stillness is judged on the raw per-frame speed (not the smoothed
        velocity) so a fast oscillation cannot look calm through the
        smoother. Hands that are out of frame (common when sitting close to a
        laptop camera) simply don't disqualify the ready pose; the throw
        itself still requires a visible, clearly moving hand.
        """
        top = self._c('SWING_READY_BELOW_SHOULDER') * torso_h
        max_speed = self._c('SWING_READY_MAX_SPEED')
        for arm in _ARMS:
            pos = self._pos(arm)
            if pos is None:
                continue
            if pos[1] < top:
                return False
            if abs(self._raw_vel[arm]) > max_speed:
                return False
        return True

    def _remember_ready_positions(self, torso_h):
        """Track the last standing hand offset per arm.

        Backswing depth and forward rise are measured from this offset, so a
        fast one-frame start cannot lose its reference point.
        """
        top = self._c('SWING_READY_BELOW_SHOULDER') * torso_h
        for arm in _ARMS:
            pos = self._pos(arm)
            if pos is not None and pos[1] >= top:
                self._ready_rel[arm] = pos[1]

    def _candidate_arms(self):
        preferred = self.preferred_arm
        return [preferred] if preferred in _WRISTS else ['right', 'left']

    def _backswing_candidate(self):
        threshold = self._c('SWING_BACK_DOWN_SPEED')
        best = None
        best_speed = 0.0
        for arm in self._candidate_arms():
            if self._pos(arm) is None:
                continue
            speed = self._vel[arm]
            if speed >= threshold and speed > best_speed:
                best = arm
                best_speed = speed
        return best

    def _direct_throw_candidate(self):
        threshold = self._c('SWING_DIRECT_THROW_SPEED')
        best = None
        best_speed = 0.0
        for arm in self._candidate_arms():
            if self._pos(arm) is None:
                continue
            speed = -self._vel[arm]        # upward positive
            if speed >= threshold and speed > best_speed:
                best = arm
                best_speed = speed
        return best

    def _begin_backswing(self, arm):
        pos = self._pos(arm)
        start = self._ready_rel.get(arm)
        if start is None:
            start = pos[1] if pos is not None else 0.0
        self.phase = PHASE_BACKSWING
        self._swing_arm = arm
        self._phase_started = self._time
        if self._swing_started_at is None:
            self._swing_started_at = self._time
        self._swing_start_rel = start
        self._backswing_deepest_rel = pos[1] if pos is not None else start
        self._peak_up_speed = 0.0

    def _begin_forward(self, arm, baseline=None):
        pos = self._pos(arm)
        self.phase = PHASE_FORWARD
        self._swing_arm = arm
        self._phase_started = self._time
        if self._swing_started_at is None:
            self._swing_started_at = self._time
        base = baseline if baseline is not None else self._backswing_deepest_rel
        if base is None:
            base = pos[1] if pos is not None else 0.0
        self._forward_low_rel = max(base, pos[1]) if pos is not None else base
        self._forward_rising_frames = (
            1 if -self._raw_vel[arm] >= self._c('SWING_FORWARD_UP_SPEED') else 0)
        self._peak_up_speed = max(0.0, -self._vel[arm])
        self._rise = 0.0

    def _release(self, arm, body_x, torso_h):
        depth = max(0.0, (self._backswing_deepest_rel
                          - self._swing_start_rel) / torso_h)
        pos = self._pos(arm)
        # ``pos`` is already measured relative to the shoulder line (see
        # :meth:`_track_samples`), so this is the release hand's cross-body
        # offset in torso heights.
        hand_offset = 0.0 if pos is None else pos[0] / torso_h
        event = SwingEvent(
            up_speed=max(self._peak_up_speed, 0.0),
            body_x=body_x,
            arm=arm,
            duration=(0.0 if self._swing_started_at is None
                      else self._time - self._swing_started_at),
            time=self._time,
            release_speed=max(0.0, -self._vel[arm]),
            rise=self._rise,
            depth=depth,
            confidence=self._frame_confidence,
            hand_source=self._hand_source[arm],
            lateral_speed=self._lateral_vel[arm],
            hand_offset=hand_offset,
        )
        self.release_count += 1
        self.phase = PHASE_FOLLOW
        self._phase_started = self._time
        self._notice = None
        return event

    def _unreliable(self, reason):
        """A frame that cannot be trusted: preserve state, count the loss."""
        self._lost_frames += 1
        self.lost_count += 1
        self.last_reject_reason = reason
        self._prev_shoulder_y = None
        self._prev_raw = {arm: None for arm in _ARMS}
        self._smooth = {arm: None for arm in _ARMS}
        self._prev_source = {arm: None for arm in _ARMS}
        self._prev_elbow = {arm: None for arm in _ARMS}
        self._raw_vel = {arm: 0.0 for arm in _ARMS}
        decay = 1.0 - self._c('SWING_VELOCITY_SMOOTHING')
        for arm in _ARMS:
            self._vel[arm] *= decay
            self._lateral_vel[arm] *= decay
        if self._lost_frames > self._c('SWING_LOST_GRACE_FRAMES'):
            if self.phase in (PHASE_BACKSWING, PHASE_FORWARD):
                self._abort(f'Tracking lost during the swing ({reason}) - try again.')
            elif self.phase in (PHASE_READY, PHASE_FOLLOW):
                self._to_waiting()
                self._set_notice('Tracking lost - step back into the camera view.')
        return None

    def _abort(self, message):
        self.abort_count += 1
        self._to_waiting()
        self._set_notice(message)

    def _set_notice(self, message):
        self._notice = message
        self._notice_time = self._time

    def _to_waiting(self):
        self.phase = PHASE_WAITING
        self._ready_hold = 0.0
        self._ready_bad_time = 0.0
        self._swing_arm = None
        self._swing_start_rel = 0.0
        self._backswing_deepest_rel = 0.0
        self._swing_started_at = None
        self._peak_up_speed = 0.0
        self._forward_low_rel = 0.0
        self._forward_rising_frames = 0
        self._rise = 0.0
