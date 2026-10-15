"""Background webcam tracking service.

Owns the camera and the pose tracker on a daemon worker thread and publishes
an immutable ``TrackingSnapshot`` after every processed frame. Callers (the
preview today; the game's future webcam input) read snapshots without ever
blocking on camera I/O or pose inference.

The service never raises from ``start()``/``stop()``: a missing camera, a
missing model or a MediaPipe crash is reported through ``snapshot().error``,
which keeps callers (including the Ursina game loop) safe.
"""
import threading
import time
from collections import deque
from dataclasses import dataclass, field, replace
from typing import Any, Mapping

import config
from tracking.camera_source import CameraError, CameraSource
from tracking.pose import Landmark
from tracking.pose_tracker import PoseTracker, TrackerError

DEFAULT_POLL = 0.02


@dataclass(frozen=True)
class TrackingSnapshot:
    """Immutable view of the latest tracking state (safe to share between
    threads: the service replaces it atomically instead of mutating it)."""

    running: bool = False
    tracked: bool = False
    confidence: float = 0.0
    landmarks: Mapping[str, Landmark] = field(default_factory=dict)
    fps: float = 0.0
    frame_count: int = 0
    lost_frames: int = 0                  # consecutive frames without a pose
    last_tracked_at: float | None = None  # monotonic seconds
    message: str = 'not started'
    error: str | None = None
    frame: Any = None                     # latest BGR camera frame (numpy)


class FpsMeter:
    """Rolling frames-per-second average over a fixed-size time window."""

    def __init__(self, window=30):
        self._times = deque(maxlen=max(2, window))

    def tick(self, now=None):
        self._times.append(time.monotonic() if now is None else now)

    def reset(self):
        self._times.clear()

    @property
    def fps(self):
        if len(self._times) < 2:
            return 0.0
        span = self._times[-1] - self._times[0]
        if span <= 0.0:
            return 0.0
        return (len(self._times) - 1) / span


class TrackingService:
    """Camera capture + pose inference on a background thread.

    Any failure is converted into an error snapshot; ``start()`` and
    ``stop()`` are safe to call in any order and more than once. The camera
    and the tracker are always released when the worker thread exits, and
    ``stop()`` releases the camera itself if a blocked read outlives the
    join timeout.
    """

    def __init__(self, camera_index=None, camera_width=None, camera_height=None,
                 model_path=None, camera_factory=None, tracker_factory=None,
                 confidence_threshold=None, visibility_threshold=None,
                 min_key_landmarks=None, max_read_failures=None, fps_window=30):
        self._camera_index = (config.TRACKING_CAMERA_INDEX
                              if camera_index is None else camera_index)
        self._camera_width = (config.TRACKING_CAMERA_WIDTH
                              if camera_width is None else camera_width)
        self._camera_height = (config.TRACKING_CAMERA_HEIGHT
                               if camera_height is None else camera_height)
        self._model_path = model_path
        self._confidence_threshold = confidence_threshold
        self._visibility_threshold = visibility_threshold
        self._min_key_landmarks = min_key_landmarks
        self._max_read_failures = (
            config.TRACKING_MAX_READ_FAILURES
            if max_read_failures is None else max_read_failures)
        self._camera_factory = camera_factory or self._default_camera_factory
        self._tracker_factory = tracker_factory or self._default_tracker_factory

        self._lock = threading.Lock()
        self._snapshot = TrackingSnapshot()
        self._stop_event = threading.Event()
        self._thread = None
        self._camera = None
        self._tracker = None
        self._fps = FpsMeter(window=fps_window)

    # ---------------------------------------------------- default factories
    def _default_camera_factory(self):
        return CameraSource(index=self._camera_index,
                            width=self._camera_width,
                            height=self._camera_height)

    def _default_tracker_factory(self):
        return PoseTracker(
            model_path=self._model_path,
            confidence_threshold=self._confidence_threshold,
            visibility_threshold=self._visibility_threshold,
            min_key_landmarks=self._min_key_landmarks,
        )

    # ----------------------------------------------------------- lifecycle
    @property
    def is_running(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        """Start the worker thread (no-op if it is already running)."""
        if self.is_running:
            return
        self._stop_event.clear()
        self._fps.reset()
        self._publish(running=True, tracked=False, confidence=0.0,
                      landmarks={}, frame_count=0, lost_frames=0,
                      last_tracked_at=None, message='starting camera...',
                      error=None, frame=None)
        self._thread = threading.Thread(
            target=self._run, name='strike-lab-tracking', daemon=True)
        self._thread.start()

    def stop(self, timeout=2.0):
        """Stop the worker and release the camera and model. Idempotent."""
        self._stop_event.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
            if thread.is_alive():
                # A camera read blocked in OpenCV can outlive the timeout;
                # releasing the capture from here unblocks it.
                camera = self._camera
                if camera is not None:
                    camera.release()
                thread.join(0.5)
        self._thread = None
        self._camera = None
        self._tracker = None
        self._publish(running=False, message='stopped')

    # ------------------------------------------------------------ queries
    def snapshot(self):
        """Return the current immutable snapshot."""
        with self._lock:
            return self._snapshot

    def wait_until(self, predicate, timeout=10.0, poll=DEFAULT_POLL):
        """Block until ``predicate(snapshot)`` is true, or the timeout hits.

        Returns True if the predicate matched, False on timeout. Only for
        setup/shutdown helpers (tests, preview startup): the game loop must
        never call this.
        """
        deadline = time.monotonic() + timeout
        while True:
            if predicate(self.snapshot()):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(poll)

    def wait_for_frame(self, timeout=15.0, poll=0.05):
        """Wait for the first camera frame (or a failure) and return it."""
        self.wait_until(
            lambda snapshot: snapshot.frame is not None or snapshot.error is not None,
            timeout=timeout, poll=poll)
        return self.snapshot()

    # -------------------------------------------------------------- worker
    def _publish(self, **changes):
        with self._lock:
            self._snapshot = replace(self._snapshot, **changes)

    def _run(self):
        camera = None
        tracker = None
        try:
            camera = self._camera_factory()
            self._camera = camera
            camera.open()
            self._publish(message='camera open; loading pose model...')
            tracker = self._tracker_factory()
            self._tracker = tracker
            self._publish(message='tracking')
            self._capture_loop(camera, tracker)
        except (CameraError, TrackerError) as exc:
            self._publish(running=False, error=str(exc),
                          message='tracking unavailable')
        except Exception as exc:  # defensive: a bug must not kill the thread
            self._publish(running=False,
                          error=f'unexpected tracking error: {exc!r}',
                          message='tracking unavailable')
        finally:
            if tracker is not None:
                tracker.close()
            if camera is not None:
                camera.release()

    def _capture_loop(self, camera, tracker):
        read_failures = 0
        while not self._stop_event.is_set():
            frame = camera.read()
            if frame is None:
                read_failures += 1
                if read_failures >= self._max_read_failures:
                    self._publish(running=False,
                                  error='camera stopped delivering frames',
                                  message='tracking unavailable')
                    return
                self._stop_event.wait(0.01)
                continue
            read_failures = 0
            now = time.monotonic()
            try:
                result = tracker.detect(frame, timestamp_ms=int(now * 1000))
            except TrackerError as exc:
                self._publish(running=False, error=str(exc),
                              message='tracking unavailable')
                return
            except Exception as exc:
                self._publish(running=False,
                              error=f'pose detection failed: {exc!r}',
                              message='tracking unavailable')
                return
            self._fps.tick(now)
            current = self.snapshot()
            self._publish(
                tracked=result.tracked,
                confidence=result.confidence,
                landmarks=dict(result.landmarks) if result.tracked else {},
                fps=self._fps.fps,
                frame_count=current.frame_count + 1,
                lost_frames=0 if result.tracked else current.lost_frames + 1,
                last_tracked_at=(now if result.tracked
                                 else current.last_tracked_at),
                message='tracking' if result.tracked else 'pose lost',
                frame=frame,
            )
        self._publish(running=False, message='stopped')
