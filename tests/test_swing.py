"""Unit tests for the bowling swing phase detector (input.swing).

The detector is fed synthetic PoseResults, so these tests need no camera and
no MediaPipe. They verify phase transitions, threshold gating, tracking-loss
handling and single-throw behaviour.

Run with:
    python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from input.swing import (PHASE_BACKSWING, PHASE_FOLLOW, PHASE_FORWARD,
                         PHASE_READY, PHASE_WAITING, SwingDetector)
from tracking.pose import Landmark, PoseResult, make_pose_result

DT = 1.0 / 30.0

# Synthetic torso used by every frame: shoulders at y=0.40, hips at y=0.65.
SHOULDER_Y = 0.40
HIP_Y = 0.65


def pose_result(right_wrist_y=0.62, left_wrist_y=0.62,
                shoulder_y=SHOULDER_Y, hip_y=HIP_Y, body_x=0.5,
                right_wrist_visibility=0.95, left_wrist_visibility=0.95,
                tracked=True, right_wrist_x=None, left_wrist_x=None,
                confidence=None, right_hand=None, left_hand=None,
                right_elbow=None, left_elbow=None):
    """Build one synthetic pose frame with configurable wrist positions.

    ``right_wrist_x`` / ``left_wrist_x`` default to the wrists hanging beside
    the torso. ``right_hand`` / ``left_hand`` are optional ``(x, y,
    visibility)`` tuples that also place the index/pinky/thumb landmarks (used
    to test the hand fallback when the wrist is occluded). ``confidence``
    overrides the evaluated mean confidence (used to test the detector's own
    confidence gate).
    """
    landmarks = {}

    def put(name, x, y, visibility=0.95):
        landmarks[name] = Landmark(x=x, y=y, z=0.0,
                                   visibility=visibility, presence=1.0)

    if right_wrist_x is None:
        right_wrist_x = body_x + 0.18
    if left_wrist_x is None:
        left_wrist_x = body_x - 0.18
    put('left_shoulder', body_x - 0.12, shoulder_y)
    put('right_shoulder', body_x + 0.12, shoulder_y)
    put('left_hip', body_x - 0.10, hip_y)
    put('right_hip', body_x + 0.10, hip_y)
    put('left_knee', body_x - 0.10, hip_y + 0.25)
    put('right_knee', body_x + 0.10, hip_y + 0.25)
    if left_elbow is None:
        left_elbow = ((left_wrist_x + body_x - 0.12) / 2.0,
                      (shoulder_y + left_wrist_y) / 2.0, 0.95)
    if right_elbow is None:
        right_elbow = ((right_wrist_x + body_x + 0.12) / 2.0,
                       (shoulder_y + right_wrist_y) / 2.0, 0.95)
    put('left_elbow', left_elbow[0], left_elbow[1], left_elbow[2])
    put('right_elbow', right_elbow[0], right_elbow[1], right_elbow[2])
    put('left_wrist', left_wrist_x, left_wrist_y, left_wrist_visibility)
    put('right_wrist', right_wrist_x, right_wrist_y, right_wrist_visibility)
    for arm, hand in (('left', left_hand), ('right', right_hand)):
        if hand is None:
            continue
        hand_x, hand_y, hand_visibility = hand
        put(f'{arm}_index', hand_x, hand_y, hand_visibility)
        put(f'{arm}_pinky', hand_x, hand_y + 0.01, hand_visibility)
        put(f'{arm}_thumb', hand_x - 0.01, hand_y - 0.01, hand_visibility)
    if not tracked:
        return PoseResult.missing(0.0)
    if confidence is not None:
        return PoseResult(landmarks=landmarks, confidence=confidence,
                          tracked=True, timestamp=0.0)
    return make_pose_result(landmarks, 0.0)


class SwingScript:
    """Feed helper that records every emitted SwingEvent."""

    def __init__(self, detector=None):
        self.detector = detector or SwingDetector()
        self.events = []

    def feed(self, result, dt=DT):
        event = self.detector.update(result, dt)
        if event is not None:
            self.events.append(event)
        return event

    def feed_y(self, y, dt=DT, **kwargs):
        return self.feed(pose_result(right_wrist_y=y, **kwargs), dt)

    def hold_ready(self, y=0.62, frames=12, **kwargs):
        for _ in range(frames):
            self.feed_y(y, **kwargs)
        return self.detector.phase == PHASE_READY

    def swing(self, start=0.62, deep=0.90, top=0.30,
              down_frames=6, up_frames=8, **kwargs):
        """Perform a full down-then-up arm motion."""
        for i in range(1, down_frames + 1):
            self.feed_y(start + (deep - start) * i / down_frames, **kwargs)
        for i in range(1, up_frames + 1):
            self.feed_y(deep + (top - deep) * i / up_frames, **kwargs)


class TestReadyPosition(unittest.TestCase):
    def test_hold_ready_switches_to_ready_phase(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        self.assertEqual(script.detector.phase, PHASE_READY)
        self.assertIn('Swing', script.detector.hint)

    def test_short_hold_is_not_enough(self):
        script = SwingScript()
        for _ in range(6):                 # 0.2 s < SWING_READY_HOLD (0.3 s)
            script.feed_y(0.62)
        self.assertEqual(script.detector.phase, PHASE_WAITING)

    def test_hands_high_is_not_ready(self):
        script = SwingScript()
        for _ in range(30):
            script.feed_y(0.45)            # above the ready band (chest height)
        self.assertEqual(script.detector.phase, PHASE_WAITING)

    def test_unsteady_hands_are_not_ready(self):
        script = SwingScript()
        for i in range(30):
            script.feed_y(0.55 if i % 2 == 0 else 0.70)
        self.assertEqual(script.detector.phase, PHASE_WAITING)

    def test_jitter_resets_the_hold(self):
        script = SwingScript()
        for _ in range(6):
            script.feed_y(0.62)
        script.feed_y(0.80)                # drop out of the ready band
        for _ in range(7):                 # even if all counted: 0.23 s < 0.3 s
            script.feed_y(0.62)
        self.assertEqual(script.detector.phase, PHASE_WAITING)
        for _ in range(5):                 # now over the hold threshold
            script.feed_y(0.62)
        self.assertEqual(script.detector.phase, PHASE_READY)

    def test_invisible_wrist_does_not_start_a_swing(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        # A fast downward move while the wrist is not visible must not arm a
        # swing (the left wrist stays visible and still, so ready is kept).
        for y in (0.70, 0.78, 0.86, 0.94):
            script.feed_y(y, right_wrist_visibility=0.2)
        self.assertEqual(script.detector.phase, PHASE_READY)
        self.assertEqual(script.events, [])
        # The same motion with a visible wrist does start the backswing.
        script.feed_y(0.90)
        script.feed_y(0.98)
        self.assertEqual(script.detector.phase, PHASE_BACKSWING)


class TestSuccessfulSwing(unittest.TestCase):
    def test_full_swing_emits_exactly_one_event(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        self.assertEqual(len(script.events), 1)
        event = script.events[0]
        self.assertEqual(event.arm, 'right')
        self.assertGreater(event.up_speed, 0.0)
        self.assertGreater(event.duration, 0.0)
        self.assertAlmostEqual(event.body_x, 0.5, places=6)
        self.assertEqual(script.detector.phase, PHASE_FOLLOW)

    def test_extra_arm_motion_after_release_does_not_emit_again(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        for _ in range(10):                # follow-through keeps moving
            script.feed_y(0.25)
        self.assertEqual(len(script.events), 1)

    def test_requires_ready_position_again_before_next_swing(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        self.assertEqual(len(script.events), 1)
        # Still in follow-through / not re-armed: another swing is ignored.
        script.swing()
        self.assertEqual(len(script.events), 1)
        # Return to ready and hold long enough to re-arm.
        self.assertTrue(script.hold_ready(frames=40))
        script.swing()
        self.assertEqual(len(script.events), 2)

    def test_left_arm_swing_is_detected(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed(pose_result(left_wrist_y=0.90, right_wrist_y=0.62),
                    dt=DT)
        for y in (0.90, 0.83, 0.76, 0.69, 0.62, 0.55, 0.48, 0.41, 0.34, 0.30):
            script.feed(pose_result(left_wrist_y=y, right_wrist_y=0.62))
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'left')


class TestRejectionOfAccidentalMotion(unittest.TestCase):
    def test_upward_motion_without_backswing_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 11):
            script.feed_y(0.62 - 0.008 * i)    # very slow small raise: not a throw
        self.assertEqual(script.events, [])
        self.assertNotEqual(script.detector.phase, PHASE_FOLLOW)

    def test_direct_forward_throw_without_visible_backswing(self):
        """A fast forward/up stroke straight from ready throws the ball.

        Real backswings are often hidden behind the body, so the forward
        stroke alone must be recognizable.
        """
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for y in (0.58, 0.52, 0.45, 0.38, 0.32, 0.28):
            script.feed_y(y)
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'right')
        self.assertEqual(script.detector.phase, PHASE_FOLLOW)

    def test_soft_release_when_forward_stroke_peaks_below_plane(self):
        """A forward stroke that stops below the release plane still throws."""
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 6):                      # backswing down
            script.feed_y(0.62 + 0.05 * i)
        for i in range(1, 6):                      # forward, stops at y=0.57
            script.feed_y(0.87 - 0.06 * i)
        for _ in range(10):
            script.feed_y(0.57)
        self.assertEqual(len(script.events), 1)

    def test_single_downward_spike_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed_y(0.95)                # one noisy frame
        for _ in range(60):
            script.feed_y(0.62)
        self.assertEqual(script.events, [])

    def test_instant_spike_through_release_plane_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed_y(0.95)                # spike down
        script.feed_y(0.30)                # spike up through the release plane
        for _ in range(60):
            script.feed_y(0.30)
        self.assertEqual(script.events, [])

    def test_slow_gentle_wobble_never_throws(self):
        script = SwingScript()
        for i in range(300):
            y = 0.62 + 0.03 * (1 if (i // 15) % 2 == 0 else -1)
            script.feed_y(y)
        self.assertEqual(script.events, [])

    def test_backswing_without_forward_swing_aborts(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 5):
            script.feed_y(0.62 + 0.028 * i)    # quick downward start
        for _ in range(60):                    # hold still in backswing
            script.feed_y(0.75)
        self.assertEqual(script.events, [])
        # The aborted swing never throws; the player may already be ready again.
        self.assertIn(script.detector.phase, (PHASE_WAITING, PHASE_READY))


class TestTrackingLoss(unittest.TestCase):
    def test_loss_during_backswing_aborts_without_throw(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed_y(0.75)
        script.feed_y(0.85)
        self.assertEqual(script.detector.phase, PHASE_BACKSWING)
        for _ in range(15):                # beyond the loss grace period
            script.feed(pose_result(tracked=False))
        self.assertEqual(script.events, [])
        self.assertEqual(script.detector.phase, PHASE_WAITING)
        self.assertIn('Tracking lost', script.detector.hint)

    def test_short_loss_does_not_abort_immediately(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed_y(0.75)
        script.feed_y(0.85)
        for _ in range(3):                 # within the grace period
            script.feed(pose_result(tracked=False))
        self.assertEqual(script.detector.phase, PHASE_BACKSWING)

    def test_untracked_frames_never_produce_a_throw(self):
        script = SwingScript()
        for _ in range(120):
            script.feed(pose_result(tracked=False))
        self.assertEqual(script.events, [])
        self.assertEqual(script.detector.phase, PHASE_WAITING)

    def test_recovery_after_loss_requires_new_ready_position(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        self.assertEqual(len(script.events), 1)
        for _ in range(15):                # beyond the loss grace period
            script.feed(pose_result(tracked=False))
        self.assertEqual(script.detector.phase, PHASE_WAITING)
        self.assertTrue(script.hold_ready(frames=40))
        script.swing()
        self.assertEqual(len(script.events), 2)


class TestStateHelpers(unittest.TestCase):
    def test_reset_returns_to_waiting(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.detector.reset()
        self.assertEqual(script.detector.phase, PHASE_WAITING)

    def test_phase_labels_and_hints_exist(self):
        script = SwingScript()
        for phase in (PHASE_WAITING, PHASE_READY, PHASE_BACKSWING,
                      PHASE_FORWARD, PHASE_FOLLOW):
            script.detector.phase = phase
            self.assertTrue(script.detector.label)
            self.assertTrue(script.detector.hint)

    def test_dt_is_clamped(self):
        script = SwingScript()
        # Absurd dt values must not raise or break phase tracking.
        script.feed(pose_result(), dt=0.0)
        script.feed(pose_result(), dt=10.0)
        self.assertEqual(script.events, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
