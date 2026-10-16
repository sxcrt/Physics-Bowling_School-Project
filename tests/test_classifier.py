"""Labeled behaviour tests for the temporal swing classifier (input.classifier).

These are the Python-side counterparts of the browser tests in
``tools/js_tests.mjs``: synthetic labeled movement sequences, with a positive
control beside every negative so "reject everything" can never pass. The
recorded real-human traces are evaluated by ``tools/webcam_eval.py`` against
the shared trace export (``tools/webcam_eval_sequences.json``), which is the
same dataset the JavaScript classifier is measured on.

The legacy ``input.swing.SwingDetector`` is a *motion* sensor and has its own
tests; it is not the shipping decision layer, so its tendency to release on
exercise footage is not repeated here.

Run with:
    python -m pytest tests/test_classifier.py -q
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from input.classifier import (STATE_BACKSWING, STATE_READY, STATE_TRACKING,
                              SwingClassifier)
from tracking.pose import PoseResult
from tests.test_swing import DT, pose_result

READY_Y = 0.62
DEEP_Y = 0.90
TOP_Y = 0.30


class ClassifierScript:
    """Feed helper that records every emitted SwingEvent."""

    def __init__(self, classifier=None):
        self.classifier = classifier or SwingClassifier()
        self.events = []

    def feed(self, result, dt=DT):
        event = self.classifier.update(result, dt)
        if event is not None:
            self.events.append(event)
        return event

    def feed_y(self, y, dt=DT, **kwargs):
        return self.feed(pose_result(right_wrist_y=y, **kwargs), dt)

    def hold_ready(self, frames=20):
        for _ in range(frames):
            self.feed_y(READY_Y)
        return self.classifier.phase == STATE_READY

    def swing(self, start=READY_Y, deep=DEEP_Y, top=TOP_Y, down=6, up=9):
        for i in range(1, down + 1):
            self.feed_y(start + (deep - start) * i / down)
        for i in range(1, up + 1):
            self.feed_y(deep + (top - deep) * i / up)


class TestGenuineSwings(unittest.TestCase):
    """The positive controls: real deliveries must release, exactly once."""

    def test_a_deliberate_swing_releases_exactly_once(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'right')
        self.assertGreater(script.events[0].rise, 0.5)
        self.assertGreater(script.events[0].depth, 0.1)
        self.assertEqual(script.classifier.release_count, 1)

    def test_a_swing_after_a_long_ready_hold_still_releases(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready(frames=90))
        script.swing()
        self.assertEqual(len(script.events), 1)

    def test_the_left_arm_can_throw(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed(pose_result(left_wrist_y=READY_Y + 0.28 * i / 6))
        for i in range(1, 10):
            script.feed(pose_result(left_wrist_y=DEEP_Y - 0.60 * i / 9))
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'left')

    def test_a_slow_delivery_releases(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        script.swing(top=0.45, up=18)
        for _ in range(6):                      # ease to a stop at the top
            script.feed_y(0.45)
        self.assertEqual(len(script.events), 1)

    def test_a_single_lost_frame_mid_swing_still_releases(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 10):
            if i == 3:
                script.feed(PoseResult.missing(0.0))
            script.feed_y(DEEP_Y - 0.60 * i / 9)
        self.assertEqual(len(script.events), 1)

    def test_rearming_allows_a_second_throw(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        self.assertEqual(len(script.events), 1)
        self.assertTrue(script.hold_ready(frames=30))
        script.swing()
        self.assertEqual(len(script.events), 2)
        self.assertEqual(script.classifier.release_count, 2)

    def test_no_second_throw_without_rearming(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        script.swing()
        self.assertEqual(len(script.events), 1)
        # Repeat the same motion without returning to the ready pose.
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 10):
            script.feed_y(DEEP_Y - 0.60 * i / 9)
        self.assertEqual(len(script.events), 1)


class TestEverydayMotion(unittest.TestCase):
    """Ordinary movement must never release, with a positive control above."""

    def test_standing_still_never_throws(self):
        script = ClassifierScript()
        for i in range(150):
            script.feed_y(READY_Y + (0.003 if i % 7 < 3 else -0.003))
        self.assertEqual(script.events, [])

    def test_idle_sway_never_throws(self):
        script = ClassifierScript()
        for i in range(150):
            drift = 0.02 * math.sin(i / 7)
            script.feed(pose_result(body_x=0.5 + drift,
                                    right_wrist_y=READY_Y + drift,
                                    left_wrist_y=READY_Y + drift))
        self.assertEqual(script.events, [])

    def test_jumping_jacks_never_throw(self):
        script = ClassifierScript()
        script.hold_ready()
        for _ in range(3):
            for i in range(1, 9):               # arms up together
                h = -0.88 + 1.98 * i / 8
                script.feed(pose_result(right_wrist_y=0.40 - h * 0.25,
                                        left_wrist_y=0.40 - h * 0.25))
            for i in range(1, 9):               # and back down together
                h = 1.10 - 1.98 * i / 8
                script.feed(pose_result(right_wrist_y=0.40 - h * 0.25,
                                        left_wrist_y=0.40 - h * 0.25))
        self.assertEqual(script.events, [])
        self.assertEqual(script.classifier.release_count, 0)

    def test_waving_never_throws(self):
        script = ClassifierScript()
        for i in range(120):
            y = 0.44 + 0.04 * math.sin(i / 5)
            x = 0.62 + 0.10 * math.sin(i / 2.6)
            script.feed(pose_result(right_wrist_y=y, right_wrist_x=x,
                                    left_wrist_y=y))
        self.assertEqual(script.events, [])

    def test_raising_one_arm_never_throws(self):
        script = ClassifierScript()
        script.hold_ready()
        for i in range(1, 10):                  # straight up, no backswing
            script.feed_y(READY_Y - 0.34 * i / 9)
        for _ in range(20):
            script.feed_y(0.28)
        for i in range(1, 10):
            script.feed_y(0.28 + 0.34 * i / 9)
        self.assertEqual(script.events, [])
        self.assertEqual(script.classifier.release_count, 0)

    def test_one_arm_pump_rhythm_never_throws(self):
        script = ClassifierScript()
        script.hold_ready(frames=30)
        for _ in range(5):
            for i in range(1, 8):               # up
                script.feed_y(READY_Y - 0.40 * i / 7)
            for i in range(1, 8):               # straight back down
                script.feed_y(0.22 + 0.40 * i / 7)
        self.assertEqual(script.events, [])

    def test_weak_lift_after_backswing_never_throws(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 9):
            script.feed_y(DEEP_Y - 0.02 * i)
        for _ in range(40):
            script.feed_y(DEEP_Y - 0.08 - 0.04)
        self.assertEqual(script.events, [])


class TestTrackingQuality(unittest.TestCase):
    def test_tracking_loss_mid_swing_aborts(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 10):
            if i == 3:
                for _ in range(6):
                    script.feed(PoseResult.missing(0.0))
            script.feed_y(DEEP_Y - 0.60 * i / 9)
        self.assertEqual(script.events, [])
        self.assertGreaterEqual(script.classifier.abort_count, 1)

    def test_low_confidence_mid_swing_never_releases(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 7):
            script.feed_y(READY_Y + 0.28 * i / 6)
        for i in range(1, 10):
            low = 3 <= i <= 8
            script.feed(pose_result(right_wrist_y=DEEP_Y - 0.60 * i / 9,
                                    confidence=0.2 if low else None))
        self.assertEqual(script.events, [])

    def test_a_startled_hand_teleport_aborts_the_swing(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for i in range(1, 5):
            script.feed_y(READY_Y + 0.28 * i / 6)
        script.feed_y(0.10)                     # teleporting wrist
        for i in range(1, 9):
            script.feed_y(DEEP_Y - 0.60 * i / 9)
        self.assertEqual(script.events, [])
        self.assertGreaterEqual(script.classifier.rejected_count, 1)

    def test_recovery_after_loss_allows_a_fresh_swing(self):
        script = ClassifierScript()
        self.assertTrue(script.hold_ready())
        for _ in range(20):
            script.feed(PoseResult.missing(0.0))
        self.assertTrue(script.hold_ready(frames=40))
        script.swing()
        self.assertEqual(len(script.events), 1)


class TestStateMachine(unittest.TestCase):
    def test_phases_and_labels_exist(self):
        classifier = SwingClassifier()
        for phase in (STATE_TRACKING, STATE_READY, STATE_BACKSWING):
            classifier.phase = phase
            self.assertTrue(classifier.label)
            self.assertTrue(classifier.hint)

    def test_backswing_requires_a_settled_ready_pose(self):
        classifier = SwingClassifier()
        script = ClassifierScript(classifier)
        # A hand that descends immediately after a raise must not start a
        # wind-up: the raise cleared the ready band moments ago.
        for i in range(1, 10):
            script.feed_y(READY_Y - 0.34 * i / 9)
        for i in range(1, 10):
            script.feed_y(0.28 + 0.50 * i / 9)
        self.assertNotEqual(classifier.phase, STATE_BACKSWING)
        self.assertEqual(script.events, [])

    def test_the_occluded_backswing_elbow_chain_can_throw(self):
        # Regression: the elbow-chain start once used the wrong velocity sign
        # and could never begin a stroke. With the wrist and hand landmarks
        # hidden through the ready pose and backswing, the visible elbow must
        # carry the stroke until the hand reappears.
        script = ClassifierScript()
        for _ in range(24):
            script.feed(pose_result(right_wrist_y=READY_Y, right_wrist_visibility=0.05,
                                    right_hand=(0.68, READY_Y, 0.05)))
        for i in range(1, 7):
            y = READY_Y + 0.28 * i / 6
            script.feed(pose_result(right_wrist_y=y, right_wrist_visibility=0.05,
                                    right_hand=(0.68, y, 0.05)))
        for i in range(1, 10):
            y = DEEP_Y - 0.60 * i / 9
            if i >= 4:
                script.feed(pose_result(right_wrist_y=y))
            else:
                script.feed(pose_result(right_wrist_y=y, right_wrist_visibility=0.05,
                                        right_hand=(0.68, y, 0.05)))
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'right')

    def test_preferred_arm_rejects_the_other_arm(self):
        classifier = SwingClassifier(overrides={'CLASSIFIER_PREFERRED_ARM': 'right'})
        script = ClassifierScript(classifier)
        self.assertTrue(script.hold_ready())
        # The left arm performs a full swing; the selected right arm must not
        # let it through.
        for i in range(1, 7):
            script.feed(pose_result(left_wrist_y=READY_Y + 0.28 * i / 6))
        for i in range(1, 10):
            script.feed(pose_result(left_wrist_y=DEEP_Y - 0.60 * i / 9))
        self.assertEqual(script.events, [])
        # The selected right arm still throws normally afterwards.
        self.assertTrue(script.hold_ready(frames=40))
        script.swing()
        self.assertEqual(len(script.events), 1)
        self.assertEqual(script.events[0].arm, 'right')


if __name__ == '__main__':
    unittest.main(verbosity=2)
