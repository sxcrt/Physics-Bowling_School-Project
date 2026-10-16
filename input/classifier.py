"""Temporal movement classifier for webcam bowling (Python build).

This is the port of ``src/input/classifier.js`` - the shipping release
authority for the browser build and the desktop build's deliberate-swing
recognizer. The legacy ``input.swing.SwingDetector`` remains a sensitive
*motion* sensor (and the parity reference); it recognizes movement, not
intent, and the recorded jumping-jacks trace releases through it. This
classifier requires the whole movement sequence instead:

    tracking -> ready -> backswing -> forward -> release -> follow_through
             -> rearm -> ready -> ...

A throw is produced by a convincing sequence:

* the player is first reliably tracked, still, with both hands low (ready);
* one arm then either performs a down/back stroke (backswing) with a real
  reversal, or - the common real-world delivery - rises straight from the
  settled ready pose ("direct"); a hidden wrist can keep a stroke alive
  through the visible elbow chain, but never starts one from nothing;
* the forward stroke needs a sustained rise, a real peak speed and an
  acceleration that decays (release); a direct delivery must rise further and
  faster than one with a wind-up behind it;
* the other arm stays quiet throughout (a symmetric two-arm raise is exercise,
  not bowling);
* the body does not jump, collapse or turn away like an exercise movement;
* a single landmark glitch (a wrist flip) is absorbed by resyncing the hand
  position instead of aborting, and a brief tracking dropout is bridged; a
  sustained loss still aborts, so unrelated motion on either side of an
  interruption can never combine into a throw;
* one accepted swing disarms the machine until the ready pose is
  re-established.

Features are normalized against body proportions (torso height, or a
last-good torso height / shoulder-width estimate when the hips are out of
frame) and elapsed time, so camera distance, player size, swing speed and
moderate body translation do not change the decision. Every rejection carries
a player-readable reason.

Both implementations are checked against the same labeled evaluation traces
(``tools/webcam_eval.mjs`` exports them; ``tools/webcam_eval.py`` replays them
through this module), so agreement between the ports is never mistaken for
behavioural correctness. A one-arm upward stroke from the ready pose is
treated as a throw by design: real players deliver with and without a
wind-up, and the recorded human exercise traces (two-arm and high-hand
motions) are still rejected. See ``docs/WEBCAM_SWING.md``.
"""
import math

import config
from input.swing import SwingEvent

STATE_TRACKING = 'tracking'
STATE_READY = 'ready'
STATE_BACKSWING = 'backswing'
STATE_FORWARD = 'forward'
STATE_RELEASE = 'release'
STATE_FOLLOW = 'follow_through'
STATE_REARM = 'rearm'

STATE_LABELS = {
    STATE_TRACKING: 'Tracking',
    STATE_READY: 'Ready',
    STATE_BACKSWING: 'Backswing',
    STATE_FORWARD: 'Forward swing',
    STATE_RELEASE: 'Release',
    STATE_FOLLOW: 'Throw released',
    STATE_REARM: 'Re-arming',
}

STATE_HINTS = {
    STATE_TRACKING: 'Stand still where the camera can see your shoulders.',
    STATE_READY: 'Ready: swing your arm forward and up to throw - a wind-up is optional.',
    STATE_BACKSWING: 'Now swing forward and up!',
    STATE_FORWARD: 'Keep going - release!',
    STATE_RELEASE: 'Throw released.',
    STATE_FOLLOW: 'Lower your arms to get ready for the next throw.',
    STATE_REARM: 'Hold still with your arms down to be ready again.',
}

_ARMS = ('right', 'left')
_OTHER = {'right': 'left', 'left': 'right'}
_WRISTS = {'right': 'right_wrist', 'left': 'left_wrist'}
_ELBOWS = {'right': 'right_elbow', 'left': 'left_elbow'}
_HANDS = {
    'right': ('right_index', 'right_pinky', 'right_thumb'),
    'left': ('left_index', 'left_pinky', 'left_thumb'),
}
_PREFERRED_ARMS = ('auto', 'left', 'right')


def _clamp(value, low, high):
    return max(low, min(high, value))


def _arm_sample(landmarks, arm, min_visibility):
    """The wrist when visible, else the mean visible hand landmarks, else None."""
    wrist = landmarks.get(_WRISTS[arm])
    if wrist is not None and float(getattr(wrist, 'visibility', 0.0) or 0.0) >= min_visibility:
        x = float(wrist.x)
        y = float(wrist.y)
        if math.isfinite(x) and math.isfinite(y):
            return {'x': x, 'y': y, 'visibility': float(wrist.visibility), 'source': 'wrist'}
    total_x = 0.0
    total_y = 0.0
    total_v = 0.0
    count = 0
    for name in _HANDS[arm]:
        lm = landmarks.get(name)
        if lm is None or float(getattr(lm, 'visibility', 0.0) or 0.0) < min_visibility:
            continue
        total_x += float(lm.x)
        total_y += float(lm.y)
        total_v += float(lm.visibility)
        count += 1
    if count == 0:
        return None
    x = total_x / count
    y = total_y / count
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    return {'x': x, 'y': y, 'visibility': total_v / count, 'source': 'hand'}


def _point(landmarks, name):
    lm = landmarks.get(name)
    if lm is None:
        return None
    x = float(lm.x)
    y = float(lm.y)
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    return {'x': x, 'y': y, 'visibility': float(getattr(lm, 'visibility', 0.0) or 0.0)}


def _angle_at(a, b, c):
    v1x = a['x'] - b['x']
    v1y = a['y'] - b['y']
    v2x = c['x'] - b['x']
    v2y = c['y'] - b['y']
    n1 = math.hypot(v1x, v1y)
    n2 = math.hypot(v2x, v2y)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cosine = _clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1.0, 1.0)
    return math.degrees(math.acos(cosine))


class SwingClassifier:
    """Temporal phase machine for a deliberate bowling-style arm swing."""

    def __init__(self, overrides=None):
        self._overrides = dict(overrides or {})
        self.phase = STATE_TRACKING
        self._time = 0.0
        self._phase_started = 0.0
        self._notice = None
        self._notice_time = -float('inf')
        self._tracking_reason = 'waiting for the first frame'
        self._consecutive_valid = 0
        self._consecutive_invalid = 0
        self._total_frames = 0
        self._smooth = {'right': None, 'left': None}
        self._vel = {'right': {'x': 0.0, 'y': 0.0}, 'left': {'x': 0.0, 'y': 0.0}}
        self._prev_raw = {'right': None, 'left': None}
        self._prev_source = {'right': None, 'left': None}
        self._prev_elbow_raw = {'right': None, 'left': None}
        self._elbow_smooth = {'right': None, 'left': None}
        self._elbow_vel = {'right': {'x': 0.0, 'y': 0.0}, 'left': {'x': 0.0, 'y': 0.0}}
        self._prev_shoulder_mid = None
        self._shoulder_angle = None
        self._body_vel = {'x': 0.0, 'y': 0.0}
        self._torso_height = 0.0
        self._torso_ref = 0.0
        self._torso_ref_time = -float('inf')
        self._ready_hold = 0.0
        self._ready_bad = 0.0
        self._symmetric_frames = 0
        self._below_band_since = {'right': None, 'left': None}
        self._below_band_min = {'right': None, 'left': None}
        self._elbow_band_since = {'right': None, 'left': None}
        self._jump_reject = {'right': None, 'left': None}
        self._jump_reject_source = {'right': None, 'left': None}
        self._swing_arm = None
        self._direct = False
        self._stroke_jumps = 0
        self._stroke_started = 0.0
        self._stroke_origin_height = 0.0
        self._stroke_min_height = 0.0
        self._forward_started = 0.0
        self._peak_up = 0.0
        self._rising_frames = 0
        self._rising_run = 0
        self._max_rising_run = 0
        self._reversals = 0
        self._last_direction = 0
        self._stroke_body_min = 0.0
        self._stroke_body_max = 0.0
        self._stroke_torso_min = 0.0
        self._stroke_torso_max = 0.0
        self._stroke_angle_delta = 0.0
        self._stroke_angle_ref = 0.0
        self._activity = {'right': 0.0, 'left': 0.0}
        self._peak_speed = {'right': 0.0, 'left': 0.0}
        self._occluded_backswing = False
        self._hand_source = {'right': 'wrist', 'left': 'wrist'}
        self._history = []
        # Session statistics (not cleared by reset(), like the legacy detector).
        self.release_count = 0
        self.blocked_count = 0
        self.abort_count = 0
        self.rejected_count = 0
        self.lost_count = 0
        self.last_reject_reason = None
        self.last_release = None

    # ------------------------------------------------------------- settings
    def _c(self, name):
        return self._overrides.get(name, getattr(config, name))

    @property
    def preferred_arm(self):
        value = str(self._c('CLASSIFIER_PREFERRED_ARM') or '').lower()
        if value in _PREFERRED_ARMS:
            return value
        fallback = str(getattr(config, 'SWING_PREFERRED_ARM', 'auto')).lower()
        return fallback if fallback in _PREFERRED_ARMS else 'auto'

    def set_preferred_arm(self, arm):
        arm = str(arm).lower()
        if arm not in _PREFERRED_ARMS:
            raise ValueError(f'unknown throwing arm: {arm!r}')
        self._overrides['CLASSIFIER_PREFERRED_ARM'] = arm
        self.reset()

    # ------------------------------------------------------- public queries
    @property
    def label(self):
        return STATE_LABELS.get(self.phase, self.phase)

    @property
    def hint(self):
        if (self._notice is not None
                and self._time - self._notice_time <= self._c('CLASSIFIER_NOTICE_TIME')):
            return self._notice
        if self.phase == STATE_TRACKING and self._tracking_reason:
            return self._tracking_reason
        return STATE_HINTS.get(self.phase, '')

    @property
    def tracking_reason(self):
        return self._tracking_reason

    @property
    def telemetry(self):
        arm = self._swing_arm
        if arm is None:
            arm = ('right' if abs(self._vel['right']['y']) >= abs(self._vel['left']['y'])
                   else 'left')
        velocity = self._vel[arm]
        speed = -velocity['y']                 # + = rising
        if speed > 0.08:
            direction = 'up'
        elif speed < -0.08:
            direction = 'down'
        else:
            direction = 'still'
        last = self._history[-1] if self._history else None
        return {
            'state': self.phase,
            'arm': arm,
            'speed': speed,
            'lateral_speed': velocity['x'],
            'direction': direction,
            'depth': self._depth(),
            'rise': self._rise(),
            'peak_up': self._peak_up,
            'direct': self._direct,
            'confidence': 0.0 if last is None else last['confidence'],
            'hand': self._hand_source.get(arm, 'wrist'),
            'tracking': self._tracking_reason,
            'other_ratio': self._dominance_ratio(),
            'rejects': self.rejected_count,
            'blocked': self.blocked_count,
        }

    def telemetry_summary(self):
        t = self.telemetry
        return (f"state={t['state']} arm={t['arm']} "
                f"v={t['speed']:+.2f} ({t['direction']}) "
                f"depth={t['depth']:.2f} rise={t['rise']:.2f} "
                f"peak={t['peak_up']:.2f} hand={t['hand']} "
                f"other={t['other_ratio']:.2f}")

    @property
    def swing_pose(self):
        arm = self._swing_arm or self._dominant_arm()
        pos = self._smooth.get(arm)
        if pos is None:
            return 0.0
        return _clamp(-pos['y'] / 0.35, -1.0, 1.0)

    @property
    def release_progress(self):
        if self.phase in (STATE_RELEASE, STATE_FOLLOW):
            return 1.0
        if self.phase == STATE_BACKSWING:
            needed = max(self._c('CLASSIFIER_BACK_MIN_DEPTH'), 1e-6)
            return 0.35 * _clamp(self._depth() / needed, 0.0, 1.0)
        if self.phase == STATE_FORWARD:
            needed = max((self._c('CLASSIFIER_DIRECT_MIN_RISE') if self._direct
                          else self._c('CLASSIFIER_FORWARD_MIN_RISE')) * 0.9, 1e-6)
            return _clamp(0.35 + 0.65 * (self._rise() / needed), 0.0, 1.0)
        return 0.0

    # ---------------------------------------------------------------- state
    def reset(self):
        self.phase = STATE_TRACKING
        self._time = 0.0
        self._phase_started = 0.0
        self._notice = None
        self._notice_time = -float('inf')
        self._tracking_reason = 'waiting for the first frame'
        self._consecutive_valid = 0
        self._consecutive_invalid = 0
        self._total_frames = 0
        self._smooth = {'right': None, 'left': None}
        self._vel = {'right': {'x': 0.0, 'y': 0.0}, 'left': {'x': 0.0, 'y': 0.0}}
        self._prev_raw = {'right': None, 'left': None}
        self._prev_source = {'right': None, 'left': None}
        self._prev_elbow_raw = {'right': None, 'left': None}
        self._elbow_smooth = {'right': None, 'left': None}
        self._elbow_vel = {'right': {'x': 0.0, 'y': 0.0}, 'left': {'x': 0.0, 'y': 0.0}}
        self._prev_shoulder_mid = None
        self._shoulder_angle = None
        self._body_vel = {'x': 0.0, 'y': 0.0}
        self._torso_height = 0.0
        self._torso_ref = 0.0
        self._torso_ref_time = -float('inf')
        self._ready_hold = 0.0
        self._ready_bad = 0.0
        self._symmetric_frames = 0
        self._below_band_since = {'right': None, 'left': None}
        self._below_band_min = {'right': None, 'left': None}
        self._elbow_band_since = {'right': None, 'left': None}
        self._jump_reject = {'right': None, 'left': None}
        self._jump_reject_source = {'right': None, 'left': None}
        self._clear_stroke()
        self._hand_source = {'right': 'wrist', 'left': 'wrist'}
        self._history = []

    def _clear_stroke(self):
        self._swing_arm = None
        self._direct = False
        self._stroke_jumps = 0
        self._stroke_started = 0.0
        self._stroke_origin_height = 0.0
        self._stroke_min_height = 0.0
        self._forward_started = 0.0
        self._peak_up = 0.0
        self._rising_frames = 0
        self._rising_run = 0
        self._max_rising_run = 0
        self._reversals = 0
        self._last_direction = 0
        self._stroke_body_min = 0.0
        self._stroke_body_max = 0.0
        self._stroke_torso_min = 0.0
        self._stroke_torso_max = 0.0
        self._stroke_angle_delta = 0.0
        self._stroke_angle_ref = 0.0
        self._activity = {'right': 0.0, 'left': 0.0}
        self._peak_speed = {'right': 0.0, 'left': 0.0}
        self._occluded_backswing = False

    # --------------------------------------------------------- core update
    def update(self, result, dt=1.0 / 30.0):
        """Advance the classifier by one processed camera frame.

        ``result`` is a ``tracking.pose.PoseResult``. Returns a
        ``input.swing.SwingEvent`` exactly when a convincing bowling sequence
        completes, otherwise None.
        """
        try:
            raw_dt = float(dt)
        except (TypeError, ValueError):
            raw_dt = 1.0 / 30.0
        step_dt = raw_dt if math.isfinite(raw_dt) and raw_dt > 0.0 else 1.0 / 30.0
        self._time += step_dt
        self._total_frames += 1
        if step_dt > self._c('CLASSIFIER_MAX_FRAME_GAP'):
            self._lost_frame('irregular camera frames')
            return None
        frame = self._ingest(result, step_dt)
        if frame is None:
            return None
        self._consecutive_valid += 1
        self._consecutive_invalid = 0
        self._tracking_reason = self._describe_ready(frame)
        self._history.append(frame)
        keep = self._c('CLASSIFIER_HISTORY_TIME') + 0.5
        while self._history and self._history[0]['t'] < self._time - keep:
            self._history.pop(0)
        return self._machine(frame, step_dt)

    def _lost_frame(self, reason):
        """A frame that cannot be trusted: count, decay, abort a stroke."""
        self.lost_count += 1
        self.last_reject_reason = reason
        self._consecutive_valid = 0
        self._consecutive_invalid += 1
        self._decay_velocities()
        limit = (self._c('CLASSIFIER_STROKE_MAX_INVALID_RUN')
                 if self._phase_in_stroke() else self._c('CLASSIFIER_MAX_INVALID_RUN'))
        if self._consecutive_invalid > limit:
            if self._phase_in_stroke():
                self._abort(f'tracking was interrupted ({reason}) - try again')
            elif self.phase in (STATE_READY, STATE_FOLLOW, STATE_REARM):
                self._to_tracking('tracking lost - stand back into the camera view')

    def _decay_velocities(self):
        decay = 1.0 - self._c('CLASSIFIER_VELOCITY_SMOOTHING')
        for arm in _ARMS:
            self._vel[arm]['x'] *= decay
            self._vel[arm]['y'] *= decay
            self._elbow_vel[arm]['x'] *= decay
            self._elbow_vel[arm]['y'] *= decay

    def _ingest(self, result, dt):
        """Build the normalized feature record for one frame, or reject it."""
        if result is None or not getattr(result, 'tracked', False) or not result.landmarks:
            self._lost_frame('no pose detected')
            return None
        confidence = float(getattr(result, 'confidence', 0.0) or 0.0)
        if confidence < self._c('CLASSIFIER_MIN_CONFIDENCE'):
            self._lost_frame('low tracking confidence')
            return None
        landmarks = result.landmarks
        min_visibility = self._c('CLASSIFIER_TORSO_VISIBILITY')
        # The shoulders are the anchor; the hips are optional. When the hips
        # are out of frame (a close camera), the scale falls back to the last
        # hip-to-shoulder height or, failing that, to the shoulder width - so a
        # player who cannot fit their whole torso on screen can still bowl.
        ls = _point(landmarks, 'left_shoulder')
        rs = _point(landmarks, 'right_shoulder')
        if (ls is None or rs is None
                or ls['visibility'] < min_visibility or rs['visibility'] < min_visibility):
            self._lost_frame('torso landmark missing')
            return None
        lh = _point(landmarks, 'left_hip')
        rh = _point(landmarks, 'right_hip')
        hips_visible = (lh is not None and rh is not None
                        and lh['visibility'] >= min_visibility
                        and rh['visibility'] >= min_visibility)
        shoulder_mid = {'x': (ls['x'] + rs['x']) / 2.0, 'y': (ls['y'] + rs['y']) / 2.0}
        hip_mid = None
        torso_h = 0.0
        if hips_visible:
            hip_mid = {'x': (lh['x'] + rh['x']) / 2.0, 'y': (lh['y'] + rh['y']) / 2.0}
            torso_h = hip_mid['y'] - shoulder_mid['y']
            if torso_h >= self._c('CLASSIFIER_MIN_TORSO_HEIGHT'):
                self._torso_ref = torso_h
                self._torso_ref_time = self._time
            else:
                torso_h = 0.0
        if torso_h <= 0.0:
            if (self._torso_ref > 0.0
                    and self._time - self._torso_ref_time <= self._c('CLASSIFIER_TORSO_REF_HOLD')):
                torso_h = self._torso_ref
            else:
                torso_h = (math.hypot(rs['x'] - ls['x'], rs['y'] - ls['y'])
                           * self._c('CLASSIFIER_SHOULDER_TORSO_RATIO'))
        if not torso_h >= self._c('CLASSIFIER_MIN_TORSO_HEIGHT'):
            self._lost_frame('stand where the camera can see your shoulders')
            return None
        if (self._prev_shoulder_mid is not None
                and math.hypot(shoulder_mid['x'] - self._prev_shoulder_mid['x'],
                               shoulder_mid['y'] - self._prev_shoulder_mid['y'])
                > self._c('CLASSIFIER_MAX_TORSO_JUMP')):
            self._lost_frame('torso landmark jumped')
            return None
        body_x = ((ls['x'] + rs['x'] + lh['x'] + rh['x']) / 4.0
                  if hips_visible else (ls['x'] + rs['x']) / 2.0)
        frame = {
            't': self._time, 'dt': dt, 'confidence': confidence,
            'torsoH': torso_h, 'shoulderMid': shoulder_mid, 'hipMid': hip_mid,
            'bodyX': body_x,
            'shoulderAngle': math.atan2(rs['y'] - ls['y'], rs['x'] - ls['x']),
            'bodySpeedX': 0.0, 'bodySpeedY': 0.0,
            'arms': {'right': None, 'left': None},
        }
        if self._prev_shoulder_mid is not None:
            alpha = self._c('CLASSIFIER_VELOCITY_SMOOTHING')
            self._body_vel['x'] = (alpha * (shoulder_mid['x'] - self._prev_shoulder_mid['x']) / dt
                                   + (1 - alpha) * self._body_vel['x'])
            self._body_vel['y'] = (alpha * (shoulder_mid['y'] - self._prev_shoulder_mid['y']) / dt
                                   + (1 - alpha) * self._body_vel['y'])
        frame['bodySpeedX'] = self._body_vel['x']
        frame['bodySpeedY'] = self._body_vel['y']
        self._prev_shoulder_mid = dict(shoulder_mid)
        self._shoulder_angle = frame['shoulderAngle']
        self._torso_height = torso_h

        pos_smoothing = self._c('CLASSIFIER_POSITION_SMOOTHING')
        vel_smoothing = self._c('CLASSIFIER_VELOCITY_SMOOTHING')
        max_jump = self._c('CLASSIFIER_MAX_HAND_JUMP')
        max_speed = self._c('CLASSIFIER_MAX_HAND_SPEED')

        for arm in _ARMS:
            shoulder = rs if arm == 'right' else ls
            sample = _arm_sample(landmarks, arm, self._c('CLASSIFIER_WRIST_VISIBILITY'))
            elbow = _point(landmarks, _ELBOWS[arm])
            elbow_visible = elbow is not None and elbow['visibility'] >= self._c('CLASSIFIER_TORSO_VISIBILITY')
            # ---- elbow chain -------------------------------------------------
            elbow_rel = None
            if elbow_visible:
                elbow_rel = {'x': (elbow['x'] - shoulder['x']) / torso_h,
                             'y': (elbow['y'] - shoulder['y']) / torso_h}
                prev_raw = self._prev_elbow_raw[arm]
                accept = True
                if prev_raw is not None:
                    jump = math.hypot(elbow_rel['x'] - prev_raw['x'], elbow_rel['y'] - prev_raw['y'])
                    if jump > max_jump or jump / dt > max_speed:
                        accept = False
                        self._frame_reject(
                            f'{arm} elbow jumped {jump:.2f} torso units in one frame')
                if accept:
                    self._prev_elbow_raw[arm] = elbow_rel
                    prev = self._elbow_smooth[arm]
                    if prev is None:
                        self._elbow_smooth[arm] = dict(elbow_rel)
                    else:
                        sx = pos_smoothing * elbow_rel['x'] + (1 - pos_smoothing) * prev['x']
                        sy = pos_smoothing * elbow_rel['y'] + (1 - pos_smoothing) * prev['y']
                        raw_x = (sx - prev['x']) / dt
                        raw_y = (sy - prev['y']) / dt
                        self._elbow_smooth[arm] = {'x': sx, 'y': sy}
                        self._elbow_vel[arm]['x'] = (vel_smoothing * raw_x
                                                     + (1 - vel_smoothing) * self._elbow_vel[arm]['x'])
                        self._elbow_vel[arm]['y'] = (vel_smoothing * raw_y
                                                     + (1 - vel_smoothing) * self._elbow_vel[arm]['y'])
                else:
                    self._prev_elbow_raw[arm] = elbow_rel
                    self._elbow_smooth[arm] = None
                    elbow_rel = None
            else:
                self._elbow_smooth[arm] = None
            elbow_up = -self._elbow_vel[arm]['y']
            elbow_height = None if self._elbow_smooth[arm] is None else -self._elbow_smooth[arm]['y']

            # ---- hand sample -------------------------------------------------
            accepted = None
            if sample is not None:
                rel = {'x': (sample['x'] - shoulder['x']) / torso_h,
                       'y': (sample['y'] - shoulder['y']) / torso_h}
                prev_raw = self._prev_raw[arm]
                prev_source = self._prev_source[arm]
                reject = False
                resync = False                 # the hand genuinely moved there
                if prev_raw is not None and prev_source == sample['source']:
                    jump = math.hypot(rel['x'] - prev_raw['x'], rel['y'] - prev_raw['y'])
                    if jump > max_jump or jump / dt > max_speed:
                        # A single-frame landmark glitch (a wrist flip) must not
                        # kill the throw: keep the last accepted sample as the
                        # baseline and check this one against the rejected
                        # position too. A frame that continues *from* the
                        # rejected position is a real fast move; a frame that
                        # returns to the accepted baseline is the flip-back.
                        rejected = self._jump_reject[arm]
                        rejected_source = self._jump_reject_source[arm]
                        if (rejected is not None and rejected_source == sample['source']
                                and math.hypot(rel['x'] - rejected['x'],
                                               rel['y'] - rejected['y']) <= max_jump):
                            resync = True
                        else:
                            reject = True
                            self._jump_reject[arm] = rel
                            self._jump_reject_source[arm] = sample['source']
                            self._frame_reject(
                                f'{arm} hand jumped {jump:.2f} torso units in one frame')
                            self._stroke_jumps += 1
                            if (self._swing_arm == arm and self._phase_in_stroke()
                                    and self._stroke_jumps
                                    > self._c('CLASSIFIER_STROKE_MAX_JUMPS')):
                                self._abort('hand tracking jumped twice in one swing - try again')
                    else:
                        self._jump_reject[arm] = None
                        self._jump_reject_source[arm] = None
                if reject:
                    # Never let a rejected sample move the machine this frame;
                    # the next reliable sample decides whether the stroke
                    # continues.
                    self._smooth[arm] = None
                    self._vel[arm]['x'] = 0.0
                    self._vel[arm]['y'] = 0.0
                else:
                    if resync:
                        # Continue from the new position without inventing a
                        # velocity.
                        self._prev_raw[arm] = rel
                        self._prev_source[arm] = sample['source']
                        self._jump_reject[arm] = None
                        self._jump_reject_source[arm] = None
                        self._hand_source[arm] = sample['source']
                        self._smooth[arm] = dict(rel)
                        self._vel[arm]['x'] = 0.0
                        self._vel[arm]['y'] = 0.0
                    else:
                        self._prev_raw[arm] = rel
                        self._prev_source[arm] = sample['source']
                        self._hand_source[arm] = sample['source']
                    prev = None if resync else self._smooth[arm]
                    reset = resync or prev is None or prev_source != sample['source']
                    if reset:
                        smoothed = dict(rel)
                        raw_vel_x = 0.0
                        raw_vel_y = 0.0
                    else:
                        smoothed = {
                            'x': pos_smoothing * rel['x'] + (1 - pos_smoothing) * prev['x'],
                            'y': pos_smoothing * rel['y'] + (1 - pos_smoothing) * prev['y'],
                        }
                        raw_vel_x = (smoothed['x'] - prev['x']) / dt
                        raw_vel_y = (smoothed['y'] - prev['y']) / dt
                    self._smooth[arm] = smoothed
                    self._vel[arm]['x'] = (vel_smoothing * raw_vel_x
                                           + (1 - vel_smoothing) * self._vel[arm]['x'])
                    self._vel[arm]['y'] = (vel_smoothing * raw_vel_y
                                           + (1 - vel_smoothing) * self._vel[arm]['y'])
                    elbow_angle = None
                    if elbow is not None and elbow_visible:
                        elbow_angle = _angle_at(
                            {'x': shoulder['x'], 'y': shoulder['y']}, elbow,
                            {'x': sample['x'], 'y': sample['y']})
                    accepted = {
                        'present': True, 'source': sample['source'],
                        'x': smoothed['x'], 'y': smoothed['y'],
                        'height': -smoothed['y'],
                        'reach': math.hypot(smoothed['x'], smoothed['y']),
                        'elbowRel': elbow_rel, 'elbowAngle': elbow_angle,
                        'elbowHeight': elbow_height,
                        'up': -self._vel[arm]['y'],
                        'vx': self._vel[arm]['x'],
                    }
            else:
                self._prev_raw[arm] = None
                self._prev_source[arm] = None
                self._jump_reject[arm] = None
                self._jump_reject_source[arm] = None
                self._smooth[arm] = None
                self._vel[arm]['x'] *= (1 - vel_smoothing)
                self._vel[arm]['y'] *= (1 - vel_smoothing)
            if accepted is None:
                accepted = {
                    'present': False, 'source': None, 'x': None, 'y': None,
                    'height': None, 'reach': None, 'elbowRel': elbow_rel,
                    'elbowAngle': None, 'elbowHeight': elbow_height,
                    'up': -self._vel[arm]['y'], 'vx': self._vel[arm]['x'],
                }
            frame['arms'][arm] = accepted
            # Band membership: a backswing may only start after the hand has
            # been low (the ready pose) for a moment; the return stroke of an
            # arm raise or pump cannot start a stroke. The deepest point of the
            # low stretch is kept too, so a delivery that starts straight from
            # the ready pose measures its rise from the true bottom.
            if accepted['present'] and accepted['height'] <= self._c('CLASSIFIER_READY_HAND_BELOW'):
                if self._below_band_since[arm] is None:
                    self._below_band_since[arm] = self._time
                    self._below_band_min[arm] = accepted['height']
                else:
                    self._below_band_min[arm] = min(self._below_band_min[arm],
                                                    accepted['height'])
            elif accepted['present']:
                self._below_band_since[arm] = None
                self._below_band_min[arm] = None
            if (accepted['elbowHeight'] is not None
                    and accepted['elbowHeight'] <= self._c('CLASSIFIER_READY_HAND_BELOW')
                    + self._c('CLASSIFIER_ELBOW_BAND_MARGIN')):
                if self._elbow_band_since[arm] is None:
                    self._elbow_band_since[arm] = self._time
            elif accepted['elbowHeight'] is not None:
                self._elbow_band_since[arm] = None
            # Stroke activity accumulates for both arms while a swing is in
            # flight, so the dominance ratio compares like with like.
            if self._swing_arm is not None and self._phase_in_stroke():
                self._activity[arm] += abs(accepted['up']) * dt
                self._peak_speed[arm] = max(self._peak_speed[arm], accepted['up'])
            if self._swing_arm == arm:
                if accepted['present'] and accepted['height'] is not None:
                    self._stroke_min_height = min(self._stroke_min_height, accepted['height'])
                elif self._occluded_backswing and accepted['elbowHeight'] is not None:
                    # The wrist and hand are hidden: the elbow chain carries
                    # the stroke, measured in the same torso-height units.
                    self._stroke_min_height = min(self._stroke_min_height,
                                                  accepted['elbowHeight'])
        self._update_stroke_extents(frame)
        return frame

    def _frame_reject(self, reason):
        self.rejected_count += 1
        self.last_reject_reason = reason

    def _update_stroke_extents(self, frame):
        if self._swing_arm is None:
            return
        body_y = frame['shoulderMid']['y']
        torso = frame['torsoH']
        self._stroke_body_min = min(self._stroke_body_min, body_y)
        self._stroke_body_max = max(self._stroke_body_max, body_y)
        self._stroke_torso_min = min(self._stroke_torso_min, torso)
        self._stroke_torso_max = max(self._stroke_torso_max, torso)
        delta = frame['shoulderAngle'] - self._stroke_angle_ref
        while delta > math.pi:
            delta -= 2 * math.pi
        while delta < -math.pi:
            delta += 2 * math.pi
        self._stroke_angle_delta = max(self._stroke_angle_delta, abs(delta))

    def _phase_in_stroke(self):
        return self.phase in (STATE_BACKSWING, STATE_FORWARD, STATE_RELEASE)

    # ------------------------------------------------------------- reporting
    def _dominant_arm(self):
        preferred = self.preferred_arm
        if preferred in ('left', 'right'):
            return preferred
        left = self._smooth['left']
        right = self._smooth['right']
        if left is None:
            return 'right'
        if right is None:
            return 'left'
        right_speed = abs(self._vel['right']['y']) + abs(self._vel['right']['x'])
        left_speed = abs(self._vel['left']['y']) + abs(self._vel['left']['x'])
        return 'right' if right_speed >= left_speed else 'left'

    def _depth(self):
        if self._swing_arm is None:
            return 0.0
        return max(0.0, self._stroke_origin_height - self._stroke_min_height)

    def _rise(self):
        if self._swing_arm is None:
            return 0.0
        pos = self._smooth[self._swing_arm]
        if pos is None:
            return 0.0
        return max(0.0, -pos['y'] - self._stroke_min_height)

    def _dominance_ratio(self):
        if self._swing_arm is None:
            return 0.0
        own = self._activity[self._swing_arm]
        return self._activity[_OTHER[self._swing_arm]] / max(own, 1e-6)

    def _describe_ready(self, frame):
        hands_seen = 0
        for arm in _ARMS:
            a = frame['arms'][arm]
            if not a['present']:
                continue
            hands_seen += 1
            if a['height'] > self._c('CLASSIFIER_READY_HAND_BELOW'):
                return 'lower your arms to your sides to get ready'
            if abs(a['up']) > self._c('CLASSIFIER_READY_MAX_HAND_SPEED'):
                return 'hold still with your arms down to get ready'
        if hands_seen == 0:
            return 'keep your hands visible to the camera'
        if abs(frame['bodySpeedY']) / frame['torsoH'] > self._c('CLASSIFIER_READY_MAX_BODY_SPEED'):
            return 'hold still to get ready'
        return ''

    # ---------------------------------------------------------- state machine
    def _machine(self, frame, dt):
        if self.phase == STATE_TRACKING:
            return self._state_tracking(frame, dt)
        if self.phase == STATE_READY:
            return self._state_ready(frame, dt)
        if self.phase == STATE_BACKSWING:
            return self._state_backswing(frame, dt)
        if self.phase == STATE_FORWARD:
            return self._state_forward(frame, dt)
        if self.phase == STATE_RELEASE:
            return self._state_release(frame)
        if self.phase == STATE_FOLLOW:
            return self._state_follow(frame)
        return self._state_rearm(frame, dt)

    def _state_tracking(self, frame, dt):
        if not self._ready_pose(frame):
            self._ready_hold = 0.0
            return None
        self._ready_hold += dt
        if (self._ready_hold >= self._c('CLASSIFIER_READY_HOLD')
                and self._consecutive_valid >= self._c('CLASSIFIER_TRACK_MIN_FRAMES')):
            self._set_phase(STATE_READY)
        return None

    def _state_ready(self, frame, dt):
        if not self._ready_pose(frame):
            self._ready_bad += dt
            if self._ready_bad >= self._c('CLASSIFIER_READY_GRACE'):
                self._to_tracking('hold still with your arms down to be ready')
        else:
            self._ready_bad = 0.0
        start = self._backswing_start(frame)
        if start is not None:
            self._begin_backswing(start)
            return None
        direct = self._direct_throw_start(frame)
        if direct is not None:
            self._begin_direct(direct)
        return None

    def _backswing_start(self, frame):
        """Which arm is deliberately swinging down/back from the ready pose?"""
        settle = self._c('CLASSIFIER_BACK_SETTLE_TIME')
        candidates = []
        for arm in self._candidate_arms():
            a = frame['arms'][arm]
            if a['present']:
                down_speed = -a['up']
            elif a['elbowRel'] is not None:
                down_speed = (self._elbow_vel[arm]['y']
                              * self._c('CLASSIFIER_ELBOW_SPEED_SCALE'))
            else:
                down_speed = None
            if down_speed is None or down_speed < self._c('CLASSIFIER_BACK_START_SPEED'):
                continue
            height = a['height'] if a['present'] else a['elbowHeight']
            if height is None:
                continue
            band = (self._c('CLASSIFIER_READY_HAND_BELOW')
                    + self._c('CLASSIFIER_BACK_BAND_MARGIN'))
            if height > band:
                continue
            low_since = (self._below_band_since[arm] if a['present']
                         else self._elbow_band_since[arm])
            if low_since is None or frame['t'] - low_since < settle:
                continue
            candidates.append({'arm': arm, 'height': height,
                               'occluded': not a['present'], 'speed': down_speed})
        if not candidates:
            return None
        if len(candidates) == 2:
            slower = min(candidates[0]['speed'], candidates[1]['speed'])
            faster = max(candidates[0]['speed'], candidates[1]['speed'])
            if faster > 1e-6 and slower / faster > self._c('CLASSIFIER_SYMMETRY_START_RATIO'):
                self._symmetric_frames += 1
                if self._symmetric_frames == self._c('CLASSIFIER_SYMMETRY_FRAMES') + 1:
                    self._set_notice('both arms are moving together - throw with one arm')
                return None
        self._symmetric_frames = 0
        candidates.sort(key=lambda c: c['speed'], reverse=True)
        return candidates[0]

    def _direct_throw_start(self, frame):
        """A delivery that starts straight from the ready pose, no wind-up.

        Real players bowl this way often - arm hanging, one continuous
        forward/up swing - and the previous "wind-up or nothing" requirement
        missed exactly those throws. The bar for the rise itself is higher
        than for a wind-up delivery (a longer rise and a faster peak), and
        everything else - one arm, still body, no crouch, no turn - still
        applies.
        """
        settle = self._c('CLASSIFIER_BACK_SETTLE_TIME')
        candidates = []
        for arm in self._candidate_arms():
            a = frame['arms'][arm]
            if not a['present'] or a['height'] is None:
                continue
            if a['up'] < self._c('CLASSIFIER_DIRECT_START_SPEED'):
                continue
            band = (self._c('CLASSIFIER_READY_HAND_BELOW')
                    + self._c('CLASSIFIER_BACK_BAND_MARGIN'))
            if a['height'] > band:
                continue
            low_since = self._below_band_since[arm]
            if low_since is None or frame['t'] - low_since < settle:
                continue
            low = (a['height'] if self._below_band_min[arm] is None
                   else self._below_band_min[arm])
            candidates.append({'arm': arm, 'height': a['height'],
                               'low': low, 'speed': a['up']})
        if not candidates:
            return None
        if len(candidates) == 2:
            slower = min(candidates[0]['speed'], candidates[1]['speed'])
            faster = max(candidates[0]['speed'], candidates[1]['speed'])
            if faster > 1e-6 and slower / faster > self._c('CLASSIFIER_SYMMETRY_START_RATIO'):
                self._symmetric_frames += 1
                if self._symmetric_frames == self._c('CLASSIFIER_SYMMETRY_FRAMES') + 1:
                    self._set_notice('both arms are moving together - throw with one arm')
                return None
        self._symmetric_frames = 0
        candidates.sort(key=lambda c: c['speed'], reverse=True)
        return candidates[0]

    def _begin_backswing(self, start):
        self._clear_stroke()
        self.phase = STATE_BACKSWING
        self._phase_started = self._time
        self._stroke_started = self._time
        self._swing_arm = start['arm']
        self._occluded_backswing = bool(start['occluded'])
        self._stroke_origin_height = start['height']
        self._stroke_min_height = start['height']
        if self._prev_shoulder_mid is not None:
            self._stroke_body_min = self._prev_shoulder_mid['y']
            self._stroke_body_max = self._prev_shoulder_mid['y']
        self._stroke_torso_min = self._torso_height
        self._stroke_torso_max = self._torso_height
        self._stroke_angle_ref = self._shoulder_angle or 0.0
        self._stroke_angle_delta = 0.0

    def _begin_direct(self, start):
        self._clear_stroke()
        self.phase = STATE_FORWARD
        self._phase_started = self._time
        self._stroke_started = self._time
        self._forward_started = self._time
        self._swing_arm = start['arm']
        self._direct = True
        self._occluded_backswing = False
        # The rise is measured from the deepest point of the settled low pose,
        # not from the frame the detector happened to notice it moving.
        self._stroke_origin_height = start['low']
        self._stroke_min_height = min(start['low'], start['height'])
        if self._prev_shoulder_mid is not None:
            self._stroke_body_min = self._prev_shoulder_mid['y']
            self._stroke_body_max = self._prev_shoulder_mid['y']
        self._stroke_torso_min = self._torso_height
        self._stroke_torso_max = self._torso_height
        self._stroke_angle_ref = self._shoulder_angle or 0.0
        self._stroke_angle_delta = 0.0
        self._peak_up = 0.0
        self._rising_frames = 0
        self._rising_run = 0
        self._max_rising_run = 0
        self._reversals = 0
        self._last_direction = 0

    def _state_backswing(self, frame, dt):
        arm = self._swing_arm
        a = frame['arms'][arm]
        depth = self._depth()
        elapsed = self._time - self._phase_started
        if a['present']:
            up_speed = a['up']
        elif a['elbowRel'] is not None:
            up_speed = (-self._elbow_vel[arm]['y'] * self._c('CLASSIFIER_ELBOW_SPEED_SCALE'))
        else:
            up_speed = 0.0
        if (depth >= self._c('CLASSIFIER_BACK_MIN_DEPTH')
                and elapsed >= self._c('CLASSIFIER_BACK_MIN_TIME')
                and up_speed >= self._c('CLASSIFIER_BACK_REVERSAL_SPEED')
                and (a['present'] or self._occluded_backswing)):
            self._begin_forward()
            return None
        # The stroke reversed before it ever deepened (a shallow wind-up, or a
        # delivery started while the hand happened to be drifting down). Hand
        # the rise back to the ready state, which picks it up as a direct
        # delivery with the correct low origin.
        if (elapsed >= self._c('CLASSIFIER_BACK_MIN_TIME')
                and depth < self._c('CLASSIFIER_BACK_MIN_DEPTH')
                and up_speed >= self._c('CLASSIFIER_BACK_REVERSAL_SPEED')
                and a['present']):
            self._to_ready(None)
            return None
        # The hand returned to the ready band without a real stroke.
        if (a['present'] and elapsed > self._c('CLASSIFIER_BACK_MIN_TIME')
                and depth < self._c('CLASSIFIER_BACK_MIN_DEPTH')
                and abs(a['up']) <= self._c('CLASSIFIER_READY_MAX_HAND_SPEED')):
            self._to_ready('the swing stopped - try a full backswing')
            return None
        if elapsed >= self._c('CLASSIFIER_BACK_TIMEOUT'):
            self._abort('no forward swing detected - swing your arm forward')
        return None

    def _begin_forward(self):
        self.phase = STATE_FORWARD
        self._phase_started = self._time
        self._forward_started = self._time
        self._peak_up = 0.0
        self._rising_frames = 0
        self._rising_run = 0
        self._max_rising_run = 0
        self._reversals = 0
        self._last_direction = 0

    def _state_forward(self, frame, dt):
        arm = self._swing_arm
        a = frame['arms'][arm]
        elapsed = self._time - self._forward_started
        if a['present'] and a['height'] is not None:
            self._stroke_min_height = min(self._stroke_min_height, a['height'])
            up = a['up']
            self._peak_up = max(self._peak_up, up)
            up_threshold = self._c('CLASSIFIER_FORWARD_UP_SPEED')
            if up >= up_threshold:
                self._rising_frames += 1
                self._rising_run += 1
                self._max_rising_run = max(self._max_rising_run, self._rising_run)
                if self._last_direction == -1:
                    self._reversals += 1
                self._last_direction = 1
            elif up <= -up_threshold * 0.5:
                self._rising_run = 0
                if self._last_direction == 1:
                    self._reversals += 1
                self._last_direction = -1
            else:
                self._rising_run = 0
        elif (not self._occluded_backswing and a['elbowRel'] is None
              and elapsed > self._c('CLASSIFIER_HAND_LOSS_GRACE')):
            # The whole throwing arm vanished mid-delivery (no wrist, no elbow).
            self._blocked('the throwing hand disappeared mid-swing - try again')
            return None
        ready = self._release_ready(frame, elapsed)
        if ready.get('ok'):
            return self._release(ready)
        if 'block' in ready:
            self._blocked(ready['block'])
            return None
        if elapsed >= self._c('CLASSIFIER_FORWARD_TIMEOUT'):
            self._abort('no release detected - swing your arm forward and up')
        return None

    def _release_ready(self, frame, elapsed):
        """Evaluate every release gate; the first failure is the reason."""
        arm = self._swing_arm
        a = frame['arms'][arm]
        if not a['present'] or a['height'] is None:
            return {}
        up = a['up']
        rise = self._rise()
        depth = self._depth()
        peak = self._peak_up
        # A delivery started straight from the ready pose ("direct") must rise
        # further and faster than one that had a real wind-up behind it; that
        # is what keeps a casual arm raise from bowling while a genuine
        # forward throw - the common real-world case - still releases.
        min_rise = (self._c('CLASSIFIER_DIRECT_MIN_RISE') if self._direct
                    else self._c('CLASSIFIER_FORWARD_MIN_RISE'))
        min_peak = (self._c('CLASSIFIER_DIRECT_MIN_PEAK') if self._direct
                    else self._c('CLASSIFIER_FORWARD_MIN_PEAK'))
        if elapsed < self._c('CLASSIFIER_FORWARD_MIN_TIME'):
            return {}
        if self._max_rising_run < self._c('CLASSIFIER_FORWARD_MIN_RISING_RUN'):
            return {}
        if rise < min_rise:
            return {}
        if peak < min_peak:
            return {}
        crossed = (a['height'] >= self._c('CLASSIFIER_RELEASE_HAND_HEIGHT')
                   and up >= self._c('CLASSIFIER_RELEASE_UP_SPEED'))
        peaked = up < max(min_peak * 0.5, peak * 0.5)
        if not crossed and not peaked:
            return {}

        # ---- definitive gate region: every failure now blocks the throw.
        if (not self._direct and depth < self._c('CLASSIFIER_BACK_MIN_DEPTH')
                and not self._occluded_backswing):
            return {'block': 'no backswing - swing your arm back, then forward'}
        other = _OTHER[arm]
        other_peak = self._peak_speed[other]
        own_activity = self._activity[arm]
        other_activity = self._activity[other]
        other_moved = frame['arms'][other]['present'] or other_peak > 0.0
        if other_moved and other_peak > self._c('CLASSIFIER_OTHER_ARM_ABS'):
            if other_activity > own_activity * self._c('CLASSIFIER_DOMINANCE_RATIO'):
                return {'block': 'both arms moved together - throw with one arm'}
            if other_activity > own_activity * self._c('CLASSIFIER_DOMINANCE_MAX_RATIO'):
                return {'block': 'the other arm moved more than the throwing arm'}
        body_lift = abs(self._stroke_body_max - self._stroke_body_min)
        if body_lift > self._c('CLASSIFIER_MAX_BODY_LIFT') * frame['torsoH']:
            return {'block': 'your body jumped during the swing - keep your feet settled'}
        if (self._stroke_torso_min > 0
                and (self._stroke_torso_max - self._stroke_torso_min) / self._stroke_torso_min
                > self._c('CLASSIFIER_MAX_TORSO_CHANGE')):
            return {'block': 'you crouched too far mid-swing - stay upright'}
        if self._stroke_angle_delta > math.radians(self._c('CLASSIFIER_MAX_TORSO_TURN')):
            return {'block': 'you turned away from the camera mid-swing'}
        if self._reversals > self._c('CLASSIFIER_MAX_REVERSALS'):
            return {'block': 'the swing stuttered - use one smooth forward swing'}

        event = SwingEvent(
            up_speed=max(peak, 0.0),
            body_x=frame['bodyX'],
            arm=arm,
            duration=(self._time - self._stroke_started if self._stroke_started > 0.0
                      else elapsed),
            time=self._time,
            release_speed=max(0.0, up),
            rise=rise,
            depth=depth,
            confidence=frame['confidence'],
            hand_source=self._hand_source.get(arm, 'wrist'),
            lateral_speed=a['vx'],
            hand_offset=a['x'],
        )
        return {'ok': True, 'event': event, 'arm': arm}

    def _release(self, ready):
        event = ready['event']
        self.release_count += 1
        self.last_release = {
            't': self._time, 'arm': ready['arm'], 'up_speed': event.up_speed,
            'rise': event.rise, 'depth': event.depth,
        }
        self.phase = STATE_RELEASE
        self._phase_started = self._time
        self._notice = None
        return event

    def _state_release(self, frame):
        if self._time - self._phase_started >= self._c('CLASSIFIER_RELEASE_FLASH'):
            self.phase = STATE_FOLLOW
            self._phase_started = self._time
            self._set_notice('throw released - lower your arms to get ready again')
        return None

    def _state_follow(self, frame):
        if self._time - self._phase_started >= self._c('CLASSIFIER_FOLLOW_TIME'):
            self.phase = STATE_REARM
            self._phase_started = self._time
        return None

    def _state_rearm(self, frame, dt):
        if not self._ready_pose(frame):
            self._ready_hold = 0.0
            return None
        self._ready_hold += dt
        if self._ready_hold >= self._c('CLASSIFIER_READY_HOLD'):
            self._set_phase(STATE_READY)
        return None

    # ------------------------------------------------------------- helpers
    def _candidate_arms(self):
        preferred = self.preferred_arm
        return (preferred,) if preferred in ('left', 'right') else ('right', 'left')

    def _set_phase(self, phase):
        self.phase = phase
        self._phase_started = self._time
        self._ready_hold = 0.0
        self._ready_bad = 0.0

    def _to_tracking(self, reason):
        self.phase = STATE_TRACKING
        self._phase_started = self._time
        self._ready_hold = 0.0
        self._ready_bad = 0.0
        self._clear_stroke()
        if reason:
            self._set_notice(reason)

    def _to_ready(self, reason):
        self._clear_stroke()
        self.phase = STATE_READY
        self._phase_started = self._time
        self._ready_bad = 0.0
        if reason:
            self._set_notice(reason)

    def _blocked(self, reason):
        self.blocked_count += 1
        self.last_reject_reason = reason
        self._abort(reason)
        return None

    def _abort(self, reason):
        self.abort_count += 1
        self.last_reject_reason = reason or self.last_reject_reason
        self._clear_stroke()
        self.phase = STATE_REARM
        self._phase_started = self._time
        self._ready_hold = 0.0
        self._ready_bad = 0.0
        self._set_notice(reason or 'swing not accepted - return to the ready position')

    def _set_notice(self, reason):
        self._notice = reason
        self._notice_time = self._time

    def _ready_pose(self, frame):
        top = self._c('CLASSIFIER_READY_HAND_BELOW')
        max_speed = self._c('CLASSIFIER_READY_MAX_HAND_SPEED')
        visible = 0
        for arm in _ARMS:
            a = frame['arms'][arm]
            if not a['present']:
                continue
            visible += 1
            if a['height'] > top:
                return False
            if abs(a['up']) > max_speed:
                return False
        if visible == 0:
            return False
        return (abs(frame['bodySpeedY']) / frame['torsoH']
                <= self._c('CLASSIFIER_READY_MAX_BODY_SPEED'))
