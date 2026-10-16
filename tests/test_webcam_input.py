"""Unit tests for input.webcam_input (tracking snapshots -> ThrowData).

The tracking service is faked and time is injected, so these tests run
without a camera, MediaPipe or real elapsed time. They verify the ThrowSource
contract, single-throw behaviour, ready-gating, lateral aiming, status
reporting and the isolated swing -> ThrowData mapping.

Run with:
    python -m unittest discover -s tests -v
"""
import math
import os
import sys
import tempfile
import unittest
from dataclasses import replace
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from input.base import ThrowSource
from input.mouse_input import ThrowData
from input.classifier import STATE_READY, SwingClassifier
from input.swing import SwingEvent
from input.webcam_input import WebcamInput, event_to_throw
from tests.test_swing import DT, pose_result
from tracking.service import TrackingSnapshot


# ---------------------------------------------------------------------------
# fakes
# ---------------------------------------------------------------------------
class FakeService:
    """Duck-typed stand-in for tracking.service.TrackingService."""

    def __init__(self):
        self._snapshot = TrackingSnapshot()
        self.start_count = 0
        self.stop_count = 0
        self._running = False
        self._frame_count = 0

    def start(self):
        self.start_count += 1
        self._running = True

    def stop(self):
        self.stop_count += 1
        self._running = False

    @property
    def is_running(self):
        return self._running

    def snapshot(self):
        return self._snapshot

    def feed(self, result):
        """Publish a processed pose frame (increments the frame counter)."""
        self._frame_count += 1
        self._snapshot = replace(
            self._snapshot,
            frame_count=self._frame_count,
            tracked=result.tracked,
            confidence=result.confidence,
            landmarks=dict(result.landmarks) if result.tracked else {},
        )

    def publish_raw(self, **changes):
        """Change snapshot fields without counting a new camera frame."""
        self._snapshot = replace(self._snapshot, **changes)


class FakeClock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, dt):
        self.now += dt


class StubDetector:
    """Detector that returns pre-queued events and counts calls/resets."""

    phase = 'ready'
    label = 'Ready'
    hint = 'stub hint'
    telemetry = {'arm': 'right', 'speed': 0.0, 'direction': 'still',
                 'depth': 0.0, 'rise': 0.0, 'peak_up': 0.0}

    def telemetry_summary(self):
        return 'stub telemetry'

    def __init__(self):
        self.events = []
        self.calls = 0
        self.reset_count = 0

    def reset(self):
        self.reset_count += 1
        self.phase = 'waiting'

    def update(self, result, dt):
        self.calls += 1
        if self.events:
            return self.events.pop(0)
        return None


def make_event(up_speed=2.0, body_x=0.5, arm='right'):
    return SwingEvent(up_speed=up_speed, body_x=body_x, arm=arm,
                      duration=0.4, time=1.0)


def quiet_log_path():
    """A throwaway swing-log path: tests never touch the game's real log."""
    return os.path.join(tempfile.mkdtemp(prefix='strike_swing_'), 'swing.log')


class InputRig:
    """WebcamInput + fake service + fake clock + real swing classifier."""

    def __init__(self):
        self.service = FakeService()
        self.clock = FakeClock()
        self.classifier = SwingClassifier()
        # Keep test phase-lines out of the game's real webcam_swing.log.
        self.log_dir = tempfile.mkdtemp(prefix='strike_lab_rig_')
        self.input = WebcamInput(service=self.service, classifier=self.classifier,
                                 clock=self.clock,
                                 log_path=os.path.join(self.log_dir, 'swing.log'))

    def feed_pose(self, result, dt=DT):
        self.clock.advance(dt)
        self.service.feed(result)
        self.input.update()

    def feed_y(self, y, dt=DT, **kwargs):
        self.feed_pose(pose_result(right_wrist_y=y, **kwargs), dt)

    def hold_ready(self, max_frames=40):
        for _ in range(max_frames):
            self.feed_y(0.62)
            if self.classifier.phase == STATE_READY:
                return True
        return False

    def swing(self, start=0.62, deep=0.90, top=0.30, down=6, up=8, **kwargs):
        for i in range(1, down + 1):
            self.feed_y(start + (deep - start) * i / down, **kwargs)
        for i in range(1, up + 1):
            self.feed_y(deep + (top - deep) * i / up, **kwargs)


class TestThrowSourceContract(unittest.TestCase):
    def test_webcam_input_is_a_throw_source(self):
        rig = InputRig()
        self.assertIsInstance(rig.input, ThrowSource)

    def test_start_and_stop_delegate_to_service(self):
        rig = InputRig()
        rig.input.start()
        rig.input.stop()
        rig.input.stop()
        self.assertEqual(rig.service.start_count, 1)
        self.assertEqual(rig.service.stop_count, 2)


class TestThrowGeneration(unittest.TestCase):
    def test_no_throw_until_game_reports_ready(self):
        rig = InputRig()
        rig.hold_ready()
        rig.swing()
        self.assertIsNone(rig.input.throw_data)

    def test_full_swing_produces_exactly_one_throw(self):
        rig = InputRig()
        rig.input.set_game_ready(True)
        rig.hold_ready()
        rig.swing()
        throw = rig.input.throw_data
        self.assertIsInstance(throw, ThrowData)
        self.assertGreaterEqual(throw.speed, config.MIN_THROW_SPEED)
        self.assertLessEqual(throw.speed, config.MAX_THROW_SPEED)
        self.assertLessEqual(abs(throw.lateral_position), config.LATERAL_LIMIT)
        self.assertIsNone(rig.input.throw_data)          # consumed once
        for _ in range(10):                              # follow-through motion
            rig.feed_y(0.25)
        self.assertIsNone(rig.input.throw_data)          # still only one throw

    def test_pending_throw_is_not_overwritten_by_second_event(self):
        service = FakeService()
        clock = FakeClock()
        detector = StubDetector()
        detector.events = [make_event(up_speed=2.0), make_event(up_speed=0.5)]
        webcam = WebcamInput(service=service, classifier=detector,
                             clock=clock, log_path=quiet_log_path())
        webcam.set_game_ready(True)
        clock.advance(DT)
        service.feed(pose_result())
        webcam.update()
        clock.advance(DT)
        service.feed(pose_result())
        webcam.update()
        throw = webcam.throw_data
        self.assertIsNotNone(throw)
        self.assertAlmostEqual(throw.speed, 2.0 * config.SWING_SPEED_SCALE,
                               places=6)
        self.assertIsNone(webcam.throw_data)             # second event dropped

    def test_discard_pending_clears_the_throw(self):
        service = FakeService()
        detector = StubDetector()
        detector.events = [make_event()]
        webcam = WebcamInput(service=service, classifier=detector,
                             clock=FakeClock(), log_path=quiet_log_path())
        webcam.set_game_ready(True)
        service.feed(pose_result())
        webcam.update()
        webcam.discard_pending()
        self.assertIsNone(webcam.throw_data)

    def test_swing_while_game_not_ready_is_never_queued(self):
        rig = InputRig()
        rig.input.set_game_ready(True)
        rig.hold_ready()
        rig.input.set_game_ready(False)                  # ball is rolling
        rig.swing()
        self.assertIsNone(rig.input.throw_data)

    def test_rearm_requires_a_new_ready_position(self):
        rig = InputRig()
        rig.input.set_game_ready(True)
        rig.hold_ready()
        rig.swing()
        self.assertIsNotNone(rig.input.throw_data)
        # Next roll: the game goes busy, then ready again.
        rig.input.set_game_ready(False)
        rig.input.set_game_ready(True)
        rig.swing()                                      # no ready hold first
        self.assertIsNone(rig.input.throw_data)
        rig.hold_ready()
        rig.swing()
        self.assertIsNotNone(rig.input.throw_data)

    def test_each_camera_frame_is_processed_once(self):
        service = FakeService()
        detector = StubDetector()
        webcam = WebcamInput(service=service, classifier=detector,
                             clock=FakeClock(), log_path=quiet_log_path())
        webcam.set_game_ready(True)
        service.feed(pose_result())
        webcam.update()
        webcam.update()                                  # same frame count
        self.assertEqual(detector.calls, 1)

    def test_tracking_loss_is_forwarded_to_the_detector(self):
        service = FakeService()
        detector = StubDetector()
        webcam = WebcamInput(service=service, classifier=detector,
                             clock=FakeClock(), log_path=quiet_log_path())
        webcam.set_game_ready(True)
        service.feed(pose_result(tracked=False))
        webcam.update()
        self.assertEqual(detector.calls, 1)

    def test_swing_log_records_phases_and_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = os.path.join(tmp, 'swing.log')
            service = FakeService()
            clock = FakeClock()
            webcam = WebcamInput(service=service, classifier=SwingClassifier(),
                                 clock=clock, log_path=log_path)
            webcam.set_game_ready(True)
            webcam.start()                     # opens the log session

            def feed(y):
                clock.advance(DT)
                service.feed(pose_result(right_wrist_y=y))
                webcam.update()

            for _ in range(12):
                feed(0.62)
            for i in range(1, 7):                     # visible backswing
                feed(0.62 + 0.28 * i / 6)
            for i in range(1, 9):                     # forward delivery
                feed(0.90 - 0.60 * i / 8)
            self.assertIsNotNone(webcam.throw_data)

            with open(log_path, encoding='utf-8') as handle:
                text = handle.read()
        self.assertIn('session start', text)
        self.assertIn('phase -> ready', text)
        self.assertIn('phase -> backswing', text)
        self.assertIn('RELEASE', text)
        self.assertIn('speed=', text)

    def test_rejected_frames_are_logged_with_the_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = os.path.join(tmp, 'swing.log')
            service = FakeService()
            clock = FakeClock()
            webcam = WebcamInput(service=service, classifier=SwingClassifier(),
                                 clock=clock, log_path=log_path)
            webcam.set_game_ready(True)
            webcam.start()

            def feed(y):
                clock.advance(DT)
                service.feed(pose_result(right_wrist_y=y))
                webcam.update()

            for _ in range(12):
                feed(0.62)
            feed(0.10)                        # teleporting landmark
            with open(log_path, encoding='utf-8') as handle:
                text = handle.read()
        self.assertIn('frame rejected', text)
        self.assertIn('jumped', text)

    def test_verbose_mode_logs_per_frame_telemetry(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = os.path.join(tmp, 'swing.log')
            service = FakeService()
            clock = FakeClock()
            webcam = WebcamInput(service=service, classifier=SwingClassifier(),
                                 clock=clock, log_path=log_path)
            webcam.set_game_ready(True)
            with mock.patch.object(config, 'SWING_LOG_VERBOSE', True), \
                    mock.patch.object(config, 'SWING_LOG_EVERY_FRAMES', 1):
                webcam.start()
                for _ in range(3):
                    clock.advance(DT)
                    service.feed(pose_result(right_wrist_y=0.62))
                    webcam.update()
            with open(log_path, encoding='utf-8') as handle:
                text = handle.read()
        self.assertIn('frame 1:', text)
        self.assertIn('conf=', text)


class TestLateralAiming(unittest.TestCase):
    def _settled_lateral(self, body_x, mirror=True, frames=60, ready=True):
        with mock.patch.object(config, 'WEBCAM_MIRROR', mirror):
            rig = InputRig()
            rig.input.set_game_ready(ready)
            for _ in range(frames):
                rig.feed_pose(pose_result(body_x=body_x))
            return rig.input.lateral

    def test_body_offset_moves_the_target_mirrored(self):
        # Raw image x 0.75 appears on the left in the mirrored feed.
        lateral = self._settled_lateral(0.75)
        self.assertLess(lateral, 0.0)
        self.assertAlmostEqual(lateral, -0.5 * config.LATERAL_LIMIT, places=2)

    def test_mirror_off_reverses_the_aim_direction(self):
        lateral = self._settled_lateral(0.75, mirror=False)
        self.assertGreater(lateral, 0.0)

    def test_lateral_is_clamped_to_the_lane(self):
        lateral = self._settled_lateral(1.0)
        self.assertAlmostEqual(lateral, -config.LATERAL_LIMIT, places=3)

    def test_lateral_only_updates_while_game_ready(self):
        rig = InputRig()
        for _ in range(20):
            rig.feed_pose(pose_result(body_x=0.9))
        self.assertEqual(rig.input.lateral, 0.0)

    def test_lateral_ignored_when_not_tracked(self):
        rig = InputRig()
        rig.input.set_game_ready(True)
        for _ in range(20):
            rig.feed_pose(pose_result(tracked=False))
        self.assertEqual(rig.input.lateral, 0.0)


class TestThrowingArm(unittest.TestCase):
    def test_cycle_rotates_auto_right_left(self):
        rig = InputRig()
        self.assertEqual(rig.input.preferred_arm, 'auto')
        self.assertEqual(rig.input.cycle_preferred_arm(), 'right')
        self.assertEqual(rig.input.preferred_arm, 'right')
        self.assertEqual(rig.input.cycle_preferred_arm(), 'left')
        self.assertEqual(rig.input.cycle_preferred_arm(), 'auto')

    def test_set_preferred_arm_updates_the_detector(self):
        rig = InputRig()
        rig.input.set_preferred_arm('left')
        self.assertEqual(rig.classifier.preferred_arm, 'left')
        with self.assertRaises(ValueError):
            rig.input.set_preferred_arm('foot')


class TestStatusReporting(unittest.TestCase):
    def test_status_reflects_snapshot_and_detector(self):
        rig = InputRig()
        rig.service.publish_raw(running=True, tracked=True, confidence=0.81,
                                fps=24.5)
        status = rig.input.status()
        self.assertTrue(status.running)
        self.assertTrue(status.tracked)
        self.assertAlmostEqual(status.confidence, 0.81)
        self.assertAlmostEqual(status.fps, 24.5)
        self.assertIsNone(status.error)
        self.assertEqual(status.phase, rig.classifier.phase)
        self.assertTrue(status.phase_label)
        self.assertTrue(status.hint)
        self.assertTrue(status.telemetry)          # live detector readout
        self.assertEqual(status.arm, 'auto')

    def test_status_reports_the_selected_arm(self):
        rig = InputRig()
        rig.input.set_preferred_arm('right')
        self.assertEqual(rig.input.status().arm, 'right')

    def test_error_is_surfaced(self):
        rig = InputRig()
        rig.service.publish_raw(error='no webcam could be opened')
        self.assertIn('no webcam', rig.input.status().error)

    def test_lost_seconds_present_after_previous_tracking(self):
        rig = InputRig()
        rig.service.publish_raw(tracked=False, last_tracked_at=0.0)
        status = rig.input.status()
        self.assertIsNotNone(status.lost_seconds)
        self.assertGreaterEqual(status.lost_seconds, 0.0)

    def test_lost_seconds_absent_when_never_tracked(self):
        rig = InputRig()
        rig.service.publish_raw(tracked=False, last_tracked_at=None)
        self.assertIsNone(rig.input.status().lost_seconds)


class TestEventMapping(unittest.TestCase):
    def test_speed_is_scaled_and_clamped(self):
        event = make_event(up_speed=2.0)
        self.assertAlmostEqual(event_to_throw(event).speed,
                               2.0 * config.SWING_SPEED_SCALE, places=6)
        self.assertEqual(event_to_throw(make_event(up_speed=100.0)).speed,
                         config.MAX_THROW_SPEED)
        self.assertEqual(event_to_throw(make_event(up_speed=0.01)).speed,
                         config.MIN_THROW_SPEED)

    def test_lateral_uses_body_position_with_mirror(self):
        centered = event_to_throw(make_event(body_x=0.5))
        self.assertAlmostEqual(centered.lateral_position, 0.0, places=6)
        # Raw right side + mirrored view -> ball to the left of the lane.
        left = event_to_throw(make_event(body_x=0.75), mirror=True)
        self.assertLess(left.lateral_position, 0.0)
        right = event_to_throw(make_event(body_x=0.75), mirror=False)
        self.assertGreater(right.lateral_position, 0.0)

    def test_lateral_is_clamped(self):
        extreme = event_to_throw(make_event(body_x=1.0), mirror=True)
        self.assertAlmostEqual(extreme.lateral_position,
                               -config.LATERAL_LIMIT, places=6)

    def test_aim_and_hook_are_derived_from_measured_offsets(self):
        """A frontal camera cannot measure the ball's line or spin, so the
        release hand's measured offsets are mapped to them by documented
        scales: a hand still on the shoulder line aims straight and a hand
        that does not sweep sideways adds no hook."""
        throw = event_to_throw(make_event())
        self.assertEqual(throw.launch_angle, 0.0)
        self.assertEqual(throw.spin_omega, 0.0)

    def test_spin_maps_from_measured_lateral_hand_speed(self):
        event = replace(make_event(up_speed=2.0), lateral_speed=2.0)
        with mock.patch.object(config, 'SWING_SPIN_SCALE', 10.0):
            throw = event_to_throw(event, mirror=False)
            mirrored = event_to_throw(event, mirror=True)
        # Clamped to the same MAX_SPIN the mouse throws use, and mirrored.
        self.assertAlmostEqual(throw.spin_omega, -config.MAX_SPIN)
        self.assertAlmostEqual(mirrored.spin_omega, config.MAX_SPIN)

    def test_spin_is_clamped(self):
        event = replace(make_event(), lateral_speed=100.0)
        with mock.patch.object(config, 'SWING_SPIN_SCALE', 10.0):
            throw = event_to_throw(event, mirror=False)
        self.assertEqual(abs(throw.spin_omega), config.MAX_SPIN)

    def test_aim_maps_from_the_release_hand_offset(self):
        event = replace(make_event(), hand_offset=0.5)
        straight_on = replace(make_event(), hand_offset=0.0)
        aimed = event_to_throw(event, mirror=False)
        self.assertGreater(aimed.launch_angle, 0.0)
        self.assertLessEqual(abs(aimed.launch_angle),
                             math.radians(config.MAX_AIM_ANGLE) + 1e-9)
        # Mirroring flips the aim, and a centred hand aims dead straight.
        self.assertLess(event_to_throw(event, mirror=True).launch_angle, 0.0)
        self.assertEqual(event_to_throw(straight_on, mirror=True).launch_angle,
                         0.0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
