"""Webcam body tracking (milestone 4 foundation).

Importing this package is cheap: OpenCV and MediaPipe are only imported when
a ``CameraSource`` is opened or a ``PoseTracker`` is created. Only the webcam
input adapter (``input.webcam_input``) uses this package, and the vision
stack is loaded lazily by the background tracking service, so mouse-mode
play runs exactly the same whether or not the tracking dependencies (or even
a camera) are present.

Typical use (see ``tracking/preview.py``)::

    service = TrackingService()
    service.start()
    while running:
        snapshot = service.snapshot()   # never blocks
        ...
    service.stop()
"""
from tracking.camera_source import CameraError, CameraSource
from tracking.pose import (KEY_LANDMARKS, LANDMARK_NAMES, Landmark,
                           PoseResult, make_pose_result)
from tracking.pose_tracker import (MissingDependencyError, ModelNotFoundError,
                                   PoseTracker, TrackerError,
                                   resolve_model_path)
from tracking.service import FpsMeter, TrackingService, TrackingSnapshot

__all__ = [
    'CameraError', 'CameraSource',
    'KEY_LANDMARKS', 'LANDMARK_NAMES', 'Landmark', 'PoseResult',
    'make_pose_result',
    'MissingDependencyError', 'ModelNotFoundError', 'PoseTracker',
    'TrackerError', 'resolve_model_path',
    'FpsMeter', 'TrackingService', 'TrackingSnapshot',
]
