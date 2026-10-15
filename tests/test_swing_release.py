"""Scenario tests for the arm-based release detector (input.swing).

These tests target the milestone requirements that go beyond the basic phase
tests in ``tests/test_swing.py``: body movement must not read as an arm
swing, landmark jumps / low confidence / irregular timing must never fire a
release, hand landmarks must cover a hidden wrist, the preferred-arm setting
must fence off the non-throwing arm, and ordinary everyday motion must never
throw. Every valid-throw negative is paired with a positive control so
"reject everything" can never pass the suite.

The detector is fed synthetic PoseResults, so these tests need no camera and
no MediaPipe.

Run with:
    python -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from input.swing import (PHASE_BACKSWING, PHASE_FOLLOW, PHASE_FORWARD,
                         PHASE_READY, PHASE_WAITING, SwingDetector)
from tests.test_swing import (HIP_Y, SHOULDER_Y, SwingScript,
                              pose_result)

READY_Y = 0.62
DEEP_Y = 0.90
TOP_Y = 0.30


def lean_pose(offset, body_x=0.5):
    """A whole-body lean/step: torso and hands move together.

    The hand keeps the same offset from the shoulder, so arm-relative
    measurements must stay still.
    """
    return pose_result(
        shoulder_y=SHOULDER_Y + offset,
        hip_y=HIP_Y + offset,
        right_wrist_y=READY_Y + offset,
        left_wrist_y=READY_Y + offset,
        body_x=body_x)


class TestBodyMotionIsNotArmMotion(unittest.TestCase):
    """The player must be able to stand in place; leaning or stepping must
    not create a backswing or a release (the torso is a reference, never a
    throwing control)."""

    def test_leaning_down_and_up_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 13):                       # lean down
            script.feed(lean_pose(0.03 * i))
        for i in range(1, 13):                       # stand back up
            script.feed(lean_pose(0.03 * (12 - i)))
        self.assertEqual(script.events, [])
        self.assertNotEqual(script.detector.phase, PHASE_FOLLOW)

    def test_quick_lean_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed(lean_pose(0.06))
        script.feed(lean_pose(0.12))
        script.feed(lean_pose(0.0))
        script.feed(lean_pose(-0.03))
        for _ in range(20):
            script.feed_y(READY_Y)
        self.assertEqual(script.events, [])

    def test_stepping_sideways_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 16):                       # walk across the frame
            body_x = 0.5 + 0.02 * i
            script.feed(pose_result(body_x=body_x))
        for i in range(1, 16):
            body_x = 0.8 - 0.02 * i
            script.feed(pose_result(body_x=body_x))
        self.assertEqual(script.events, [])

    def test_torso_landmark_jump_is_treated_as_unreliable(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        before = script.detector.lost_count
        script.feed(pose_result(shoulder_y=SHOULDER_Y + 0.30))
        self.assertGreater(script.detector.lost_count, before)
        self.assertEqual(script.events, [])


class TestLandmarkJumps(unittest.TestCase):
    """A glitch that teleports a landmark must never look like a swing."""

    def test_wrist_teleport_in_ready_is_rejected(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        before = script.detector.rejected_count
        script.feed_y(0.10)                          # 0.52 units in one frame
        self.assertGreater(script.detector.rejected_count, before)
        self.assertEqual(script.events, [])
        self.assertIn(script.detector.phase, (PHASE_READY, PHASE_WAITING))

    def test_wrist_teleport_during_forward_swing_aborts(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):                        # backswing
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 4):                        # forward swing starts
            script.feed_y(DEEP_Y - 0.60 * i / 8)
        self.assertEqual(script.detector.phase, PHASE_FORWARD)
        script.feed_y(0.10)                          # teleport mid-swing
        self.assertEqual(script.events, [])
        self.assertEqual(script.detector.phase, PHASE_WAITING)
        self.assertIn('jumped', script.detector.hint.lower())

    def test_elbow_teleport_is_rejected(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        before = script.detector.rejected_count
        # The wrist stays put; only the elbow landmark teleports.
        script.feed(pose_result(right_elbow=(0.62, 0.95, 0.95)))
        self.assertGreater(script.detector.rejected_count, before)
        self.assertIn('elbow', script.detector.last_reject_reason)
        self.assertEqual(script.events, [])

    def test_no_spike_sequence_can_fake_a_release(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for y in (0.95, 0.20, 0.90, 0.25, 0.85):
            script.feed_y(y)                         # alternating teleports
        for _ in range(80):
            script.feed_y(READY_Y)
        self.assertEqual(script.events, [])


class TestLowConfidence(unittest.TestCase):
    """Tracking confidence below the configured minimum suspends the
    detector; it never fabricates a release."""

    def test_low_confidence_during_forward_aborts_without_release(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 4):
            script.feed_y(DEEP_Y - 0.60 * i / 8)
        self.assertEqual(script.detector.phase, PHASE_FORWARD)
        for _ in range(15):                          # keep moving, no confidence
            script.feed(pose_result(right_wrist_y=0.20, confidence=0.2))
        self.assertEqual(script.events, [])
        self.assertEqual(script.detector.phase, PHASE_WAITING)
        self.assertIn('Tracking lost', script.detector.hint)

    def test_low_confidence_ready_frames_never_arm_the_swing(self):
        script = SwingScript()
        for _ in range(60):
            script.feed(pose_result(right_wrist_y=READY_Y, confidence=0.1))
        self.assertEqual(script.detector.phase, PHASE_WAITING)
        self.assertEqual(script.events, [])

    def test_recovery_after_low_confidence_needs_a_new_ready_hold(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for _ in range(15):
            script.feed(pose_result(confidence=0.2))
        self.assertTrue(script.hold_ready(frames=40))
        script.swing(start=READY_Y, deep=DEEP_Y, top=TOP_Y)
        self.assertEqual(len(script.events), 1)


class TestIrregularFrames(unittest.TestCase):
    """Velocity comes from measured frame intervals; delayed, dropped or
    irregular frames must not fabricate speed."""

    def test_long_frame_gap_never_releases(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):                        # get into the backswing
            script.feed_y(READY_Y + 0.28 * i / 6)
        self.assertEqual(script.detector.phase, PHASE_BACKSWING)
        # The camera stalls; the arm moved a lot while the frame was lost.
        script.feed_y(0.20, dt=0.5)
        self.assertEqual(script.events, [])
        for _ in range(60):                          # finish: hold the top
            script.feed_y(0.20)
        self.assertEqual(script.events, [])
        self.assertIn(script.detector.phase, (PHASE_WAITING, PHASE_READY))

    def test_irregular_intervals_do_not_fabricate_a_throw(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        dts = (0.02, 0.08, 0.01, 0.05, 0.03, 0.1)
        for i in range(1, 41):                       # slow, casual raise
            script.feed_y(READY_Y - 0.15 * i / 40, dt=dts[i % len(dts)])
        for _ in range(40):
            script.feed_y(READY_Y - 0.15)
        self.assertEqual(script.events, [])

    def test_zero_and_huge_dt_are_safe(self):
        script = SwingScript()
        script.feed(pose_result(), dt=0.0)
        script.feed(pose_result(), dt=-5.0)
        script.feed(pose_result(), dt=10.0)
        script.feed(pose_result(), dt=float('nan'))
        self.assertEqual(script.events, [])


class TestHandFallback(unittest.TestCase):
    """The hand landmarks extend the wrist; a hidden wrist alone must not
    abort a clearly visible hand motion, and a fully hidden hand must never
    fabricate one."""

    def test_hand_landmarks_drive_the_swing_when_wrist_is_hidden(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        x = 0.68
        for i in range(1, 7):
            y = READY_Y + 0.28 * i / 6
            script.feed(pose_result(right_wrist_y=y, right_wrist_visibility=0.05,
                                    right_hand=(x, y, 0.95)))
        for i in range(1, 9):
            y = DEEP_Y - 0.60 * i / 8
            script.feed(pose_result(right_wrist_y=y, right_wrist_visibility=0.05,
                                    right_hand=(x, y, 0.95)))
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'right')
        self.assertEqual(script.events[0].hand_source, 'hand')

    def test_missing_wrist_and_hand_never_releases(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 4):
            script.feed_y(DEEP_Y - 0.60 * i / 8)
        self.assertEqual(script.detector.phase, PHASE_FORWARD)
        for _ in range(45):                          # wrist and hand invisible
            script.feed(pose_result(right_wrist_y=0.20,
                                    right_wrist_visibility=0.05))
        self.assertEqual(script.events, [])
        self.assertIn(script.detector.phase, (PHASE_WAITING, PHASE_READY))


class TestPreferredArm(unittest.TestCase):
    """With a throwing arm selected, the other arm cannot throw the ball."""

    def test_non_throwing_arm_never_releases(self):
        detector = SwingDetector(overrides={'SWING_PREFERRED_ARM': 'right'})
        script = SwingScript(detector)
        self.assertTrue(script.hold_ready())
        # The left arm performs a full bowling swing while the right hand stays.
        for i in range(1, 7):
            script.feed(pose_result(
                right_wrist_y=READY_Y, left_wrist_y=READY_Y + 0.28 * i / 6))
        for i in range(1, 9):
            script.feed(pose_result(
                right_wrist_y=READY_Y, left_wrist_y=DEEP_Y - 0.60 * i / 8))
        self.assertEqual(script.events, [])
        # The selected right arm still throws normally afterwards.
        self.assertTrue(script.hold_ready(frames=60))
        script.swing(start=READY_Y, deep=DEEP_Y, top=TOP_Y)
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'right')

    def test_preferred_left_arm_is_honored(self):
        detector = SwingDetector(overrides={'SWING_PREFERRED_ARM': 'left'})
        script = SwingScript(detector)
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed(pose_result(left_wrist_y=READY_Y + 0.28 * i / 6))
        for i in range(1, 9):
            script.feed(pose_result(left_wrist_y=DEEP_Y - 0.60 * i / 8))
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'left')

    def test_set_preferred_arm_validates_and_overrides(self):
        detector = SwingDetector()
        self.assertEqual(detector.preferred_arm, 'auto')
        detector.set_preferred_arm('left')
        self.assertEqual(detector.preferred_arm, 'left')
        with self.assertRaises(ValueError):
            detector.set_preferred_arm('elbow')


class TestCasualMotionNeverThrows(unittest.TestCase):
    """Everyday movement must not launch the ball."""

    def test_holding_ready_indefinitely_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(3000):
            jitter = 0.002 if i % 7 < 3 else -0.002
            script.feed_y(READY_Y + jitter)
        self.assertEqual(script.events, [])

    def test_slow_reach_forward_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 31):                       # slow raise to mid-chest
            script.feed_y(READY_Y - 0.15 * i / 30)
        for _ in range(60):
            script.feed_y(READY_Y - 0.15)
        self.assertEqual(script.events, [])

    def test_reaching_sideways_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 11):                       # hand out to the side
            script.feed(pose_result(right_wrist_x=0.68 + 0.032 * i))
        for i in range(1, 11):                       # and back
            script.feed(pose_result(right_wrist_x=1.0 - 0.032 * i))
        self.assertEqual(script.events, [])

    def test_continuous_waving_never_throws(self):
        # A smooth, vigorous continuous wave (10% of the image height, ~0.8 s
        # period). The instantaneous hand speed passes the individual swing
        # thresholds at the extremes, so this is the hard "casual motion"
        # case: the detector must not recognize it as a throw because the
        # ready pose never holds for long enough to arm.
        import math
        script = SwingScript()
        for i in range(600):
            y = READY_Y + 0.10 * math.sin(2.0 * math.pi * i / 24.0)
            script.feed_y(y)
        self.assertEqual(script.events, [])


class TestIncompleteGesture(unittest.TestCase):
    def test_forward_start_then_reverse_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.feed_y(0.66)
        script.feed_y(0.70)                          # short backswing
        script.feed_y(0.62)
        script.feed_y(0.56)                          # brief up stroke
        for _ in range(40):                          # then swing back down
            script.feed_y(DEEP_Y)
        self.assertEqual(script.events, [])

    def test_backswing_without_forward_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for _ in range(60):                          # hold the backswing
            script.feed_y(DEEP_Y)
        self.assertEqual(script.events, [])

    def test_weak_flick_after_backswing_never_throws(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 4):                        # small, slow lift
            script.feed_y(DEEP_Y - 0.02 * i)
        for _ in range(40):
            script.feed_y(DEEP_Y - 0.06)
        self.assertEqual(script.events, [])


class TestReleaseMeasurements(unittest.TestCase):
    """The valid-throw control: a proper swing must release, once, with the
    measured rise/depth/confidence carried on the event."""

    def test_valid_swing_releases_once_with_measured_values(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.swing(start=READY_Y, deep=DEEP_Y, top=TOP_Y)
        self.assertEqual(len(script.events), 1)
        event = script.events[0]
        self.assertEqual(event.arm, 'right')
        self.assertGreater(event.up_speed, 0.0)
        self.assertGreater(event.release_speed, 0.0)
        self.assertGreater(event.rise, config.SWING_RELEASE_MIN_RISE)
        self.assertGreater(event.depth, config.SWING_BACK_MIN_DEPTH)
        self.assertGreater(event.confidence, 0.5)
        self.assertEqual(event.hand_source, 'wrist')
        self.assertEqual(script.detector.phase, PHASE_FOLLOW)

    def test_follow_through_cannot_release_again(self):
        script = SwingScript()
        self.assertTrue(script.hold_ready())
        script.swing(start=READY_Y, deep=DEEP_Y, top=TOP_Y)
        self.assertEqual(len(script.events), 1)
        script.swing(start=TOP_Y, deep=DEEP_Y, top=TOP_Y)   # another swing
        self.assertEqual(len(script.events), 1)
        # Only a deliberate return to the ready pose re-arms the detector.
        self.assertTrue(script.hold_ready(frames=60))
        script.swing(start=READY_Y, deep=DEEP_Y, top=TOP_Y)
        self.assertEqual(len(script.events), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
