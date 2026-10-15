"""Minimal OpenCV drawing for the tracking preview (development tool only).

This module is intentionally *not* imported by ``tracking/__init__``: it
needs OpenCV, and nothing on the game path should pay that import cost.
"""
import time

import cv2

from tracking.pose import KEY_LANDMARKS, SKELETON_CONNECTIONS, visible_key_landmarks

PANEL_COLOR = (25, 28, 38)        # BGR
INFO_COLOR = (215, 218, 225)
TRACKED_COLOR = (0, 220, 0)
LOST_COLOR = (60, 80, 255)
ERROR_COLOR = (80, 80, 255)
BONE_COLOR = (0, 190, 0)
KEY_JOINT_COLOR = (0, 165, 255)   # key bowling joints stand out (orange)
JOINT_COLOR = (205, 205, 205)
MIN_DRAW_VISIBILITY = 0.3         # draw threshold is looser than tracking gate

_KEY_LANDMARK_SET = frozenset(KEY_LANDMARKS)


def status_lines(snapshot, mirror=True, camera_index=0, resolution=None, now=None):
    """Return ``(text, BGR colour)`` pairs describing the tracking state."""
    now = time.monotonic() if now is None else now
    lines = [('Hells Balls - tracking preview (development tool)', INFO_COLOR)]
    camera = f'camera {camera_index}'
    if resolution is not None:
        camera += f' {resolution[0]}x{resolution[1]}'
    camera += f" | mirror {'on' if mirror else 'off'} | fps {snapshot.fps:5.1f}"
    lines.append((camera, INFO_COLOR))
    if snapshot.error:
        lines.append((f'ERROR: {snapshot.error}', ERROR_COLOR))
    elif snapshot.tracked:
        visible = visible_key_landmarks(snapshot.landmarks)
        lines.append((
            f'pose: TRACKED | confidence {snapshot.confidence:4.2f} | '
            f'key joints {len(visible)}/{len(KEY_LANDMARKS)}', TRACKED_COLOR))
    elif snapshot.last_tracked_at is not None:
        lost_for = max(0.0, now - snapshot.last_tracked_at)
        lines.append((
            f'pose: LOST ({snapshot.lost_frames} frames, {lost_for:4.1f} s) '
            '- unreliable detections ignored', LOST_COLOR))
    else:
        lines.append(('pose: no person detected - step into the camera view',
                      LOST_COLOR))
    lines.append(('[q] quit   [m] toggle mirror', INFO_COLOR))
    return lines


def draw_pose(image, landmarks, mirror=False, min_visibility=MIN_DRAW_VISIBILITY):
    """Draw the skeleton and joints in place; returns the same image."""
    height, width = image.shape[:2]

    def to_pixels(landmark):
        x = 1.0 - landmark.x if mirror else landmark.x
        return int(x * (width - 1)), int(landmark.y * (height - 1))

    for first_name, second_name in SKELETON_CONNECTIONS:
        first = landmarks.get(first_name)
        second = landmarks.get(second_name)
        if first is None or second is None:
            continue
        if first.visibility < min_visibility or second.visibility < min_visibility:
            continue
        cv2.line(image, to_pixels(first), to_pixels(second),
                 BONE_COLOR, 2, cv2.LINE_AA)
    for name, landmark in landmarks.items():
        if landmark.visibility < min_visibility:
            continue
        key = name in _KEY_LANDMARK_SET
        cv2.circle(image, to_pixels(landmark), 6 if key else 3,
                   KEY_JOINT_COLOR if key else JOINT_COLOR, -1, cv2.LINE_AA)
    return image


def draw_status_block(image, lines):
    """Draw the status text on a translucent panel in the top-left corner."""
    pad = 10
    line_height = 20
    height = min(image.shape[0], pad * 2 + line_height * len(lines))
    overlay = image.copy()
    cv2.rectangle(overlay, (0, 0), (image.shape[1], height), PANEL_COLOR, -1)
    cv2.addWeighted(overlay, 0.7, image, 0.3, 0.0, dst=image)
    for index, (text, colour) in enumerate(lines):
        cv2.putText(image, text, (pad, pad + line_height * index + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, colour, 1, cv2.LINE_AA)
    return image


def render(frame, snapshot, mirror=True, camera_index=0):
    """Compose one preview image: camera frame + pose + status panel."""
    display = frame.copy()
    if mirror:
        display = cv2.flip(display, 1)
    if snapshot.tracked and not snapshot.error and snapshot.landmarks:
        draw_pose(display, snapshot.landmarks, mirror=mirror)
    resolution = (frame.shape[1], frame.shape[0])
    return draw_status_block(
        display,
        status_lines(snapshot, mirror=mirror, camera_index=camera_index,
                     resolution=resolution),
    )
