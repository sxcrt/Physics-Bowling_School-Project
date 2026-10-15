"""MediaPipe Pose Landmarker wrapper (Tasks API).

MediaPipe 1.1.0 removed the legacy ``mediapipe.solutions`` API, so this module
wraps ``mediapipe.tasks.python.vision.PoseLandmarker`` in VIDEO mode: the
tracking service feeds it timestamped frames from its worker thread.

MediaPipe and numpy are imported lazily, so importing the tracking package
never pays the vision-stack import cost. The model file is looked up in
``assets/models`` and downloaded once on first use if it is missing.
"""
import os
import shutil
import urllib.request
from pathlib import Path

import config
from tracking.pose import LANDMARK_NAMES, Landmark, PoseResult, make_pose_result

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_PATH = (PROJECT_ROOT / 'assets' / 'models'
                      / config.TRACKING_MODEL_FILENAME)


class TrackerError(RuntimeError):
    """Base class for pose tracker problems (missing model, backend crash)."""


class MissingDependencyError(TrackerError):
    """MediaPipe or one of its runtime pieces is not installed."""


class ModelNotFoundError(TrackerError):
    """The pose model file is missing and could not be downloaded."""


def download_model(destination, url=None, timeout=None):
    """Download the pose model to ``destination`` (first-run convenience)."""
    url = config.TRACKING_MODEL_URL if url is None else url
    timeout = config.TRACKING_MODEL_DOWNLOAD_TIMEOUT if timeout is None else timeout
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name + '.part')
    print(f'[tracking] downloading pose model (about 6 MB) from {url} ...')
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response, \
                open(partial, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        if partial.stat().st_size == 0:
            raise OSError('downloaded model file is empty')
        os.replace(partial, destination)
    except Exception as exc:
        partial.unlink(missing_ok=True)
        raise ModelNotFoundError(
            f'could not download the pose model from {url}: {exc}\n'
            f'download it manually and save it as: {destination}'
        ) from exc
    print(f'[tracking] pose model saved to {destination}')
    return destination


def resolve_model_path(model_path=None):
    """Return a usable .task file, downloading the default model if needed.

    An explicitly given path is never replaced by a download: if it does not
    exist, ``ModelNotFoundError`` is raised so typos surface immediately.
    """
    path = Path(model_path) if model_path else DEFAULT_MODEL_PATH
    if path.is_file():
        return path
    if model_path:
        raise ModelNotFoundError(f'pose model not found: {path}')
    return download_model(path)


class PoseTracker:
    """Thin wrapper around MediaPipe's PoseLandmarker in VIDEO mode.

    Not thread-safe by itself: the tracking service owns one tracker and
    calls it from a single worker thread.
    """

    def __init__(self, model_path=None, num_poses=1,
                 min_detection_confidence=None, min_presence_confidence=None,
                 min_tracking_confidence=None, confidence_threshold=None,
                 visibility_threshold=None, min_key_landmarks=None):
        self.model_path = resolve_model_path(model_path)
        self._num_poses = num_poses
        self._min_detection_confidence = (
            config.TRACKING_MIN_DETECTION_CONFIDENCE
            if min_detection_confidence is None else min_detection_confidence)
        self._min_presence_confidence = (
            config.TRACKING_MIN_PRESENCE_CONFIDENCE
            if min_presence_confidence is None else min_presence_confidence)
        self._min_tracking_confidence = (
            config.TRACKING_MIN_TRACKING_CONFIDENCE
            if min_tracking_confidence is None else min_tracking_confidence)
        self._confidence_threshold = confidence_threshold
        self._visibility_threshold = visibility_threshold
        self._min_key_landmarks = min_key_landmarks
        self._mp = None
        self._landmarker = None
        self._last_timestamp_ms = -1
        self._create_landmarker()

    # --------------------------------------------------------------- backend
    def _create_landmarker(self):
        try:
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except ImportError as exc:
            raise MissingDependencyError(
                'mediapipe is not installed; install the tracking '
                'dependencies with:  python -m pip install -r requirements.txt'
            ) from exc
        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(
                model_asset_path=str(self.model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=self._num_poses,
            min_pose_detection_confidence=self._min_detection_confidence,
            min_pose_presence_confidence=self._min_presence_confidence,
            min_tracking_confidence=self._min_tracking_confidence,
        )
        try:
            self._landmarker = vision.PoseLandmarker.create_from_options(options)
        except Exception as exc:
            raise TrackerError(
                f'could not load pose model {self.model_path}: {exc}'
            ) from exc
        self._mp = mp

    # -------------------------------------------------------------- detection
    def detect(self, frame_bgr, timestamp_ms=None):
        """Run the landmarker on one BGR frame.

        Always returns a ``PoseResult``: an empty, untracked result when no
        person is found, and reliability evaluation on the joints otherwise.
        Raises ``TrackerError`` only when the backend itself fails.
        """
        if self._landmarker is None:
            raise TrackerError('pose tracker is closed')
        import time

        import numpy as np

        if timestamp_ms is None:
            timestamp_ms = int(time.monotonic() * 1000)
        # MediaPipe rejects non-increasing timestamps outright; guard against
        # two frames landing in the same millisecond.
        timestamp_ms = max(int(timestamp_ms), self._last_timestamp_ms + 1)
        self._last_timestamp_ms = timestamp_ms

        # BGR -> RGB as a contiguous array (MediaPipe rejects views).
        rgb = np.ascontiguousarray(frame_bgr[:, :, ::-1])
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        try:
            result = self._landmarker.detect_for_video(image, timestamp_ms)
        except Exception as exc:
            raise TrackerError(f'pose detection failed: {exc}') from exc

        timestamp = timestamp_ms / 1000.0
        if not result.pose_landmarks:
            return PoseResult.missing(timestamp)
        landmarks = {
            name: Landmark(
                x=float(raw.x),
                y=float(raw.y),
                z=float(raw.z),
                visibility=float(getattr(raw, 'visibility', 0.0) or 0.0),
                presence=float(getattr(raw, 'presence', 0.0) or 0.0),
            )
            for name, raw in zip(LANDMARK_NAMES, result.pose_landmarks[0])
        }
        return make_pose_result(
            landmarks, timestamp,
            visibility_threshold=self._visibility_threshold,
            confidence_threshold=self._confidence_threshold,
            min_key_landmarks=self._min_key_landmarks,
        )

    def close(self):
        """Release the MediaPipe graph. Safe to call more than once."""
        landmarker, self._landmarker = self._landmarker, None
        if landmarker is not None:
            try:
                landmarker.close()
            except Exception:
                pass
