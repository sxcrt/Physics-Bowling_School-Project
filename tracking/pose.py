"""Pure pose data types and reliability evaluation for the tracking layer.

No OpenCV, MediaPipe, engine or I/O imports live here, so this module can be
imported and unit-tested with nothing but the Python standard library. The
game itself never imports it -- only the tracking service and preview do.
"""
from dataclasses import dataclass, field
from typing import Mapping

import config

# MediaPipe's 33 pose landmarks, in index order.
LANDMARK_NAMES = (
    'nose',
    'left_eye_inner', 'left_eye', 'left_eye_outer',
    'right_eye_inner', 'right_eye', 'right_eye_outer',
    'left_ear', 'right_ear',
    'mouth_left', 'mouth_right',
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_pinky', 'right_pinky',
    'left_index', 'right_index',
    'left_thumb', 'right_thumb',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
    'left_heel', 'right_heel',
    'left_foot_index', 'right_foot_index',
)

LANDMARK_INDEX = {name: index for index, name in enumerate(LANDMARK_NAMES)}

# The joints a bowling swing cares about: both shoulders, elbows, wrists,
# hips and knees. "tracked" requires at least TRACKING_MIN_KEY_LANDMARKS of
# these to be clearly visible.
KEY_LANDMARKS = (
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
)

# Standard MediaPipe pose skeleton, expressed as landmark-name pairs so the
# drawing code never deals with raw indices.
SKELETON_CONNECTIONS = (
    ('nose', 'left_eye_inner'),
    ('left_eye_inner', 'left_eye'),
    ('left_eye', 'left_eye_outer'),
    ('left_eye_outer', 'left_ear'),
    ('nose', 'right_eye_inner'),
    ('right_eye_inner', 'right_eye'),
    ('right_eye', 'right_eye_outer'),
    ('right_eye_outer', 'right_ear'),
    ('mouth_left', 'mouth_right'),
    ('left_shoulder', 'right_shoulder'),
    ('left_shoulder', 'left_elbow'),
    ('left_elbow', 'left_wrist'),
    ('left_wrist', 'left_pinky'),
    ('left_wrist', 'left_index'),
    ('left_wrist', 'left_thumb'),
    ('left_pinky', 'left_index'),
    ('right_shoulder', 'right_elbow'),
    ('right_elbow', 'right_wrist'),
    ('right_wrist', 'right_pinky'),
    ('right_wrist', 'right_index'),
    ('right_wrist', 'right_thumb'),
    ('right_pinky', 'right_index'),
    ('left_shoulder', 'left_hip'),
    ('right_shoulder', 'right_hip'),
    ('left_hip', 'right_hip'),
    ('left_hip', 'left_knee'),
    ('right_hip', 'right_knee'),
    ('left_knee', 'left_ankle'),
    ('right_knee', 'right_ankle'),
    ('left_ankle', 'left_heel'),
    ('right_ankle', 'right_heel'),
    ('left_heel', 'left_foot_index'),
    ('right_heel', 'right_foot_index'),
    ('left_ankle', 'left_foot_index'),
    ('right_ankle', 'right_foot_index'),
)


@dataclass(frozen=True)
class Landmark:
    """One detected body joint in normalised image coordinates (0..1)."""
    x: float
    y: float
    z: float
    visibility: float = 0.0   # 0..1, how much of the joint is visible
    presence: float = 0.0     # 0..1, confidence the joint is in frame


@dataclass(frozen=True)
class PoseResult:
    """Outcome of one pose-detection pass.

    ``tracked`` is False whenever the detection is missing or too unreliable;
    callers must ignore ``landmarks`` in that case (we also publish an empty
    mapping, so unreliable joint positions cannot leak into motion logic).
    """
    landmarks: Mapping[str, Landmark] = field(default_factory=dict)
    confidence: float = 0.0
    tracked: bool = False
    timestamp: float = 0.0       # monotonic seconds

    @classmethod
    def missing(cls, timestamp=0.0):
        """A detection in which no reliable pose was found."""
        return cls(landmarks={}, confidence=0.0, tracked=False, timestamp=timestamp)


def visible_key_landmarks(landmarks, min_visibility=None):
    """Return the key joints whose visibility is at least ``min_visibility``."""
    if min_visibility is None:
        min_visibility = config.TRACKING_VISIBILITY_THRESHOLD
    return {
        name: landmark
        for name, landmark in landmarks.items()
        if name in KEY_LANDMARKS and landmark.visibility >= min_visibility
    }


def evaluate_pose(landmarks, visibility_threshold=None,
                  confidence_threshold=None, min_key_landmarks=None):
    """Decide whether ``landmarks`` are reliable enough to track.

    Returns ``(tracked, confidence)`` where confidence is the mean visibility
    of all ten key joints (a missing joint counts as visibility 0). A pose is
    tracked only when at least ``min_key_landmarks`` joints are clearly
    visible *and* the mean confidence clears ``confidence_threshold``. This
    is what stops a blurry or half-occluded detection from being treated as
    a valid movement.
    """
    visibility_threshold = (config.TRACKING_VISIBILITY_THRESHOLD
                            if visibility_threshold is None else visibility_threshold)
    confidence_threshold = (config.TRACKING_CONFIDENCE_THRESHOLD
                            if confidence_threshold is None else confidence_threshold)
    min_key_landmarks = (config.TRACKING_MIN_KEY_LANDMARKS
                         if min_key_landmarks is None else min_key_landmarks)
    if not landmarks:
        return False, 0.0
    total = 0.0
    visible = 0
    for name in KEY_LANDMARKS:
        landmark = landmarks.get(name)
        if landmark is None:
            continue
        total += landmark.visibility
        if landmark.visibility >= visibility_threshold:
            visible += 1
    confidence = total / len(KEY_LANDMARKS)
    tracked = (visible >= min_key_landmarks
               and confidence >= confidence_threshold)
    return tracked, confidence


def make_pose_result(landmarks, timestamp=0.0, **thresholds):
    """Build a POSE result and evaluate its reliability in one step."""
    if not landmarks:
        return PoseResult.missing(timestamp)
    tracked, confidence = evaluate_pose(landmarks, **thresholds)
    return PoseResult(
        landmarks=dict(landmarks),
        confidence=confidence,
        tracked=tracked,
        timestamp=timestamp,
    )
