"""Unit tests for the webcam tracking foundation (milestone 4).

Everything here runs with fake cameras and fake pose detectors, so the suite
needs neither a physical webcam nor a MediaPipe model file. Real camera
behaviour is verified manually with ``python -m tracking.preview`` (see
tracking/README.md); that distinction is intentional and documented.

Run with:
    python -m unittest discover -s tests -v
"""
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tracking.camera_source import CameraError, CameraSource
from tracking.pose import (KEY_LANDMARKS, LANDMARK_INDEX, LANDMARK_NAMES,
                           SKELETON_CONNECTIONS, Landmark, PoseResult,
                           evaluate_pose, make_pose_result,
                           visible_key_landmarks)
from tracking.pose_tracker import (ModelNotFoundError, download_model,
                                   resolve_model_path)
from tracking.service import FpsMeter, TrackingService, TrackingSnapshot

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CV2_AVAILABLE = importlib.util.find_spec('cv2') is not None

if CV2_AVAILABLE:
    from tracking import overlay


# ---------------------------------------------------------------------------
# helpers and fakes
# ---------------------------------------------------------------------------
def landmarks_with(visibility, names=None):
    """Build a landmark mapping where every joint has the same visibility."""
    names = LANDMARK_NAMES if names is None else names
    return {
        name: Landmark(x=0.5, y=0.5, z=0.0, visibility=visibility, presence=1.0)
        for name in names
    }


def full_pose(visibility=0.9, timestamp=0.0):
    return make_pose_result(landmarks_with(visibility), timestamp)


class FakeCapture:
    """OpenCV-capture stand-in for CameraSource tests."""

    def __init__(self, opened=True):
        self._opened = opened
        self.release_count = 0

    def isOpened(self):
        return self._opened

    def read(self):
        if not self._opened:
            return False, None
        return True, 'frame'

    def release(self):
        self.release_count += 1


def capture_factory_returning(capture):
    return lambda index, width, height: capture


class FakeCamera:
    """Duck-typed stand-in for tracking.camera_source.CameraSource."""

    def __init__(self, open_error=None, read_failures=0, frame=None,
                 read_delay=0.002):
        self.open_error = open_error
        self.read_failures = read_failures
        self.frame = frame if frame is not None else object()
        self.read_delay = read_delay
        self.opened = False
        self.release_count = 0
        self.read_count = 0

    @property
    def is_open(self):
        return self.opened

    def open(self):
        if self.open_error is not None:
            raise self.open_error
        self.opened = True

    def read(self):
        time.sleep(self.read_delay)
        self.read_count += 1
        if self.read_failures > 0:
            self.read_failures -= 1
            return None
        return self.frame

    def release(self):
        self.release_count += 1


class FakeTracker:
    """Duck-typed stand-in for tracking.pose_tracker.PoseTracker.

    Scripted results are returned in order; once the script is exhausted the
    last result repeats forever. Tests can therefore drive a deterministic
    loss/recovery sequence through ``push``.
    """

    def __init__(self, results=()):
        self._results = list(results)
        self._last = None
        self.calls = 0
        self.close_count = 0

    def push(self, result):
        self._results.append(result)

    def detect(self, frame, timestamp_ms=None):
        self.calls += 1
        if self._results:
            item = self._results.pop(0)
        else:
            item = self._last
        self._last = item
        if isinstance(item, Exception):
            raise item
        if item is None:
            return PoseResult.missing()
        return item

    def close(self):
        self.close_count += 1


class _FakeResponse:
    """Minimal context-manager stand-in for urllib's response object."""

    def __init__(self, data):
        self._buffer = io.BytesIO(data)

    def __enter__(self):
        return self._buffer

    def __exit__(self, *exc_info):
        return False


class ServiceTestCase(unittest.TestCase):
    """Base class that guarantees every service thread is stopped."""

    def make_service(self, **kwargs):
        service = TrackingService(**kwargs)
        self.addCleanup(service.stop)
        return service


# ---------------------------------------------------------------------------
# pure pose data
# ---------------------------------------------------------------------------
class TestLandmarkConstants(unittest.TestCase):
    def test_names_and_indices(self):
        self.assertEqual(len(LANDMARK_NAMES), 33)
        self.assertEqual(len(set(LANDMARK_NAMES)), 33)
        self.assertEqual(LANDMARK_INDEX['left_shoulder'], 11)
        self.assertEqual(LANDMARK_INDEX['right_shoulder'], 12)
        self.assertEqual(LANDMARK_INDEX['left_wrist'], 15)
        self.assertEqual(LANDMARK_INDEX['right_knee'], 26)
        self.assertEqual(len(KEY_LANDMARKS), 10)

    def test_skeleton_connections_reference_known_names(self):
        for first, second in SKELETON_CONNECTIONS:
            self.assertIn(first, LANDMARK_INDEX)
            self.assertIn(second, LANDMARK_INDEX)


class TestPoseEvaluation(unittest.TestCase):
    def test_confident_pose_is_tracked(self):
        tracked, confidence = evaluate_pose(landmarks_with(0.9))
        self.assertTrue(tracked)
        self.assertAlmostEqual(confidence, 0.9, places=6)

    def test_low_visibility_pose_is_not_tracked(self):
        tracked, confidence = evaluate_pose(landmarks_with(0.2))
        self.assertFalse(tracked)
        self.assertAlmostEqual(confidence, 0.2, places=6)

    def test_confidence_gate_rejects_mediocre_detection(self):
        tracked, confidence = evaluate_pose(landmarks_with(0.4))
        self.assertFalse(tracked)                      # 0.4 < 0.5 threshold
        self.assertAlmostEqual(confidence, 0.4, places=6)

    def test_too_few_key_landmarks_is_not_tracked(self):
        landmarks = landmarks_with(1.0, names=KEY_LANDMARKS[:5])
        tracked, confidence = evaluate_pose(landmarks)
        self.assertFalse(tracked)                      # only 5 of 10 joints
        self.assertAlmostEqual(confidence, 0.5, places=6)

    def test_missing_pose_result_is_empty_and_untracked(self):
        result = PoseResult.missing(timestamp=5.0)
        self.assertFalse(result.tracked)
        self.assertEqual(result.confidence, 0.0)
        self.assertEqual(result.landmarks, {})
        self.assertEqual(result.timestamp, 5.0)

    def test_make_pose_result_sets_fields(self):
        result = make_pose_result(landmarks_with(0.9), 12.5)
        self.assertTrue(result.tracked)
        self.assertEqual(result.timestamp, 12.5)
        self.assertIn('left_wrist', result.landmarks)

    def test_visible_key_landmarks_filters_by_visibility(self):
        landmarks = landmarks_with(0.9)
        landmarks['left_wrist'] = Landmark(0.5, 0.5, 0.0, 0.1, 1.0)
        visible = visible_key_landmarks(landmarks)
        self.assertNotIn('left_wrist', visible)
        self.assertIn('right_wrist', visible)
        self.assertEqual(len(visible), 9)


# ---------------------------------------------------------------------------
# camera source failure handling
# ---------------------------------------------------------------------------
class TestCameraSource(unittest.TestCase):
    def test_open_read_release(self):
        capture = FakeCapture()
        camera = CameraSource(capture_factory=capture_factory_returning(capture))
        camera.open()
        self.assertTrue(camera.is_open)
        self.assertEqual(camera.read(), 'frame')
        camera.release()
        self.assertFalse(camera.is_open)
        self.assertEqual(capture.release_count, 1)
        camera.release()                               # idempotent
        self.assertEqual(capture.release_count, 1)

    def test_missing_camera_raises_camera_error(self):
        capture = FakeCapture(opened=False)
        camera = CameraSource(index=3,
                              capture_factory=capture_factory_returning(capture))
        with self.assertRaises(CameraError) as context:
            camera.open()
        message = str(context.exception)
        self.assertIn('index 3', message)
        self.assertIn('another application', message)
        self.assertEqual(capture.release_count, 1)     # failed handle released

    def test_factory_exception_is_wrapped(self):
        def broken(index, width, height):
            raise RuntimeError('driver exploded')
        camera = CameraSource(capture_factory=broken)
        with self.assertRaises(CameraError) as context:
            camera.open()
        self.assertIn('driver exploded', str(context.exception))

    def test_read_before_open_returns_none(self):
        camera = CameraSource(capture_factory=capture_factory_returning(FakeCapture()))
        self.assertIsNone(camera.read())

    def test_context_manager_releases(self):
        capture = FakeCapture()
        with CameraSource(capture_factory=capture_factory_returning(capture)) as camera:
            self.assertTrue(camera.is_open)
        self.assertEqual(capture.release_count, 1)


# ---------------------------------------------------------------------------
# model resolution / download
# ---------------------------------------------------------------------------
class TestModelResolution(unittest.TestCase):
    def test_explicit_path_used_when_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / 'pose.task'
            model.write_bytes(b'fake model')
            self.assertEqual(resolve_model_path(str(model)), model)

    def test_explicit_missing_path_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / 'missing.task'
            with self.assertRaises(ModelNotFoundError):
                resolve_model_path(str(missing))

    def test_default_path_present_is_returned(self):
        with tempfile.TemporaryDirectory() as tmp:
            model = Path(tmp) / 'pose.task'
            model.write_bytes(b'fake model')
            with mock.patch('tracking.pose_tracker.DEFAULT_MODEL_PATH', model):
                self.assertEqual(resolve_model_path(None), model)

    def test_default_missing_path_attempts_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / 'missing.task'
            with mock.patch('tracking.pose_tracker.DEFAULT_MODEL_PATH', missing), \
                    mock.patch('tracking.pose_tracker.download_model',
                               side_effect=ModelNotFoundError('offline')) as download:
                with self.assertRaises(ModelNotFoundError):
                    resolve_model_path(None)
                download.assert_called_once()

    def test_download_writes_model_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'nested' / 'pose.task'
            with mock.patch('urllib.request.urlopen',
                            return_value=_FakeResponse(b'model bytes')):
                result = download_model(destination,
                                        url='https://example.invalid/model.task',
                                        timeout=1)
            self.assertEqual(result, destination)
            self.assertEqual(destination.read_bytes(), b'model bytes')
            self.assertFalse((Path(tmp) / 'nested' / 'pose.task.part').exists())

    def test_download_failure_raises_with_url_and_hint(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'pose.task'
            with mock.patch('urllib.request.urlopen',
                            side_effect=OSError('offline')):
                with self.assertRaises(ModelNotFoundError) as context:
                    download_model(destination,
                                   url='https://example.invalid/model.task',
                                   timeout=1)
            message = str(context.exception)
            self.assertIn('https://example.invalid/model.task', message)
            self.assertIn('manually', message)


# ---------------------------------------------------------------------------
# fps meter
# ---------------------------------------------------------------------------
class TestFpsMeter(unittest.TestCase):
    def test_empty_and_single_tick(self):
        meter = FpsMeter()
        self.assertEqual(meter.fps, 0.0)
        meter.tick(100.0)
        self.assertEqual(meter.fps, 0.0)

    def test_rolling_average(self):
        meter = FpsMeter(window=10)
        for i in range(11):
            meter.tick(100.0 + i * 0.1)     # exactly 10 fps
        self.assertAlmostEqual(meter.fps, 10.0, places=6)

    def test_reset(self):
        meter = FpsMeter()
        meter.tick(1.0)
        meter.tick(1.1)
        meter.reset()
        self.assertEqual(meter.fps, 0.0)


# ---------------------------------------------------------------------------
# background service: lifecycle and failure handling
# ---------------------------------------------------------------------------
class TestTrackingService(ServiceTestCase):
    def test_camera_open_failure_is_graceful(self):
        tracker_calls = []

        def make_tracker():
            tracker_calls.append(1)
            return FakeTracker()

        camera = FakeCamera(open_error=CameraError(
            'no webcam could be opened at index 0; check [test]'))
        service = self.make_service(camera_factory=lambda: camera,
                                    tracker_factory=make_tracker)
        service.start()
        snapshot = service.wait_for_frame(timeout=5.0)
        self.assertIsNotNone(snapshot.error)
        self.assertIn('no webcam', snapshot.error)
        self.assertTrue(service.wait_until(lambda s: not service.is_running,
                                           timeout=5.0))
        self.assertEqual(tracker_calls, [])            # tracker never created
        service.stop()                                 # safe after failure

    def test_tracker_failure_is_graceful(self):
        def broken_tracker():
            from tracking.pose_tracker import TrackerError
            raise TrackerError('mediapipe is not installed [test]')

        camera = FakeCamera()
        service = self.make_service(camera_factory=lambda: camera,
                                    tracker_factory=broken_tracker)
        service.start()
        snapshot = service.wait_for_frame(timeout=5.0)
        self.assertIsNotNone(snapshot.error)
        self.assertIn('mediapipe', snapshot.error)
        self.assertTrue(service.wait_until(lambda s: not service.is_running,
                                           timeout=5.0))
        self.assertGreaterEqual(camera.release_count, 1)

    def test_unexpected_factory_error_is_wrapped(self):
        def broken_camera():
            raise RuntimeError('boom')

        service = self.make_service(camera_factory=broken_camera)
        service.start()
        snapshot = service.wait_for_frame(timeout=5.0)
        self.assertIn('unexpected tracking error', snapshot.error or '')
        self.assertIn('boom', snapshot.error or '')

    def test_tracking_then_loss_then_recovery(self):
        tracker = FakeTracker([full_pose(), PoseResult.missing(0.0)])
        camera = FakeCamera(read_delay=0.005)
        service = self.make_service(camera_factory=lambda: camera,
                                    tracker_factory=lambda: tracker,
                                    max_read_failures=5)
        service.start()
        # Frame 1 tracked, frames 2+ are lost and repeat until we recover.
        self.assertTrue(service.wait_until(lambda s: s.frame_count >= 3,
                                           timeout=5.0),
                        msg=f'snapshot={service.snapshot()!r}')
        snapshot = service.snapshot()
        self.assertFalse(snapshot.tracked)
        self.assertEqual(snapshot.landmarks, {})
        self.assertGreaterEqual(snapshot.lost_frames, 1)
        self.assertAlmostEqual(snapshot.confidence, 0.0)
        self.assertTrue(snapshot.running)
        tracker.push(full_pose())
        self.assertTrue(service.wait_until(lambda s: s.tracked, timeout=5.0))
        snapshot = service.snapshot()
        self.assertEqual(snapshot.lost_frames, 0)
        self.assertEqual(len(snapshot.landmarks), len(LANDMARK_NAMES))
        self.assertIsNotNone(snapshot.last_tracked_at)

    def test_transient_read_failures_recover(self):
        camera = FakeCamera(read_failures=3)
        tracker = FakeTracker([full_pose()])
        service = self.make_service(camera_factory=lambda: camera,
                                    tracker_factory=lambda: tracker,
                                    max_read_failures=10)
        service.start()
        self.assertTrue(service.wait_until(lambda s: s.frame_count >= 2,
                                           timeout=5.0))
        snapshot = service.snapshot()
        self.assertIsNone(snapshot.error)
        self.assertTrue(snapshot.tracked)
        self.assertTrue(service.is_running)

    def test_persistent_read_failures_are_reported(self):
        camera = FakeCamera(read_failures=10 ** 9, read_delay=0.0)
        service = self.make_service(camera_factory=lambda: camera,
                                    tracker_factory=lambda: FakeTracker(),
                                    max_read_failures=3)
        service.start()
        snapshot = service.wait_for_frame(timeout=5.0)
        self.assertIn('frames', snapshot.error or '')
        self.assertTrue(service.wait_until(lambda s: not service.is_running,
                                           timeout=5.0))
        self.assertGreaterEqual(camera.release_count, 1)

    def test_stop_releases_camera_and_tracker(self):
        camera = FakeCamera()
        tracker = FakeTracker([full_pose()])
        service = self.make_service(camera_factory=lambda: camera,
                                    tracker_factory=lambda: tracker)
        service.start()
        self.assertTrue(service.wait_until(lambda s: s.frame_count >= 1,
                                           timeout=5.0))
        service.stop()
        self.assertFalse(service.is_running)
        self.assertEqual(camera.release_count, 1)
        self.assertEqual(tracker.close_count, 1)
        service.stop()                                 # idempotent
        self.assertEqual(camera.release_count, 1)
        self.assertEqual(tracker.close_count, 1)

    def test_stop_without_start_is_safe(self):
        service = TrackingService()
        service.stop()
        self.assertFalse(service.is_running)
        self.assertFalse(service.snapshot().running)

    def test_wait_until_times_out(self):
        service = TrackingService()
        started = time.monotonic()
        self.assertFalse(service.wait_until(lambda s: False,
                                            timeout=0.05, poll=0.01))
        self.assertGreaterEqual(time.monotonic() - started, 0.05)


# ---------------------------------------------------------------------------
# throw-source interface
# ---------------------------------------------------------------------------
class TestThrowSourceInterface(unittest.TestCase):
    def test_mouse_input_satisfies_throw_source(self):
        from input.base import ThrowSource
        from input.mouse_input import MouseInput
        source = MouseInput()
        self.assertIsInstance(source, ThrowSource)
        self.assertIsNone(source.throw_data)

    def test_plain_object_is_not_a_throw_source(self):
        from input.base import ThrowSource

        class NotASource:
            pass

        self.assertNotIsInstance(NotASource(), ThrowSource)


# ---------------------------------------------------------------------------
# import hygiene: the tracking package must stay cheap to import
# ---------------------------------------------------------------------------
class TestImportWeight(unittest.TestCase):
    def test_importing_tracking_does_not_import_vision_stack(self):
        code = (
            'import sys\n'
            'import tracking\n'
            'assert "cv2" not in sys.modules, "cv2 was imported eagerly"\n'
            'assert "mediapipe" not in sys.modules, "mediapipe was imported eagerly"\n'
            'assert "numpy" not in sys.modules, "numpy was imported eagerly"\n'
            'print("light-import-ok")\n'
        )
        result = subprocess.run(
            [sys.executable, '-c', code], cwd=str(PROJECT_ROOT),
            capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('light-import-ok', result.stdout)


# ---------------------------------------------------------------------------
# preview overlay (skipped without OpenCV)
# ---------------------------------------------------------------------------
@unittest.skipUnless(CV2_AVAILABLE, 'OpenCV (cv2) is not available')
class TestStatusLines(unittest.TestCase):
    def _text(self, snapshot, **kwargs):
        return '\n'.join(text for text, _ in overlay.status_lines(snapshot, **kwargs))

    def test_tracked(self):
        snapshot = TrackingSnapshot(
            tracked=True, confidence=0.92, fps=29.5,
            landmarks=landmarks_with(0.9), frame_count=10,
            last_tracked_at=1.0)
        text = self._text(snapshot, mirror=True, camera_index=0,
                          resolution=(640, 480), now=2.0)
        self.assertIn('TRACKED', text)
        self.assertIn('0.92', text)
        self.assertIn('key joints 10/10', text)
        self.assertIn('640x480', text)
        self.assertIn('mirror on', text)

    def test_lost(self):
        snapshot = TrackingSnapshot(last_tracked_at=100.0, lost_frames=12)
        text = self._text(snapshot, now=100.4)
        self.assertIn('LOST', text)
        self.assertIn('12 frames', text)
        self.assertIn('0.4 s', text)

    def test_no_person(self):
        text = self._text(TrackingSnapshot())
        self.assertIn('no person detected', text)

    def test_error_takes_precedence_over_pose(self):
        snapshot = TrackingSnapshot(
            tracked=True, landmarks=landmarks_with(0.9), last_tracked_at=1.0,
            error='camera stopped delivering frames')
        text = self._text(snapshot)
        self.assertIn('ERROR', text)
        self.assertIn('camera stopped delivering frames', text)
        self.assertNotIn('TRACKED', text)


@unittest.skipUnless(CV2_AVAILABLE, 'OpenCV (cv2) is not available')
class TestOverlayRender(unittest.TestCase):
    def _frame(self):
        import numpy as np
        return np.zeros((240, 320, 3), dtype='uint8')

    def test_render_draws_skeleton_and_status_without_touching_frame(self):
        import numpy as np
        frame = self._frame()
        snapshot = TrackingSnapshot(
            tracked=True, confidence=0.9, landmarks=landmarks_with(0.9),
            last_tracked_at=1.0)
        rendered = overlay.render(frame, snapshot, mirror=False)
        self.assertEqual(rendered.shape, frame.shape)
        self.assertTrue(np.any(rendered != 0))
        self.assertFalse(np.any(frame != 0))          # input frame untouched

    def test_render_mirror_changes_skeleton(self):
        tracked = TrackingSnapshot(
            tracked=True, confidence=0.9, landmarks=landmarks_with(0.9),
            last_tracked_at=1.0)
        frame = self._frame()
        mirrored = overlay.render(frame, tracked, mirror=True)
        plain = overlay.render(frame, tracked, mirror=False)
        self.assertFalse((mirrored == plain).all())

    def test_render_with_partial_landmarks_does_not_crash(self):
        frame = self._frame()
        snapshot = TrackingSnapshot(
            tracked=True, confidence=0.6,
            landmarks=landmarks_with(0.9, names=list(KEY_LANDMARKS[:4])),
            last_tracked_at=time.monotonic())
        rendered = overlay.render(frame, snapshot)
        self.assertEqual(rendered.shape, frame.shape)


if __name__ == '__main__':
    unittest.main(verbosity=2)
