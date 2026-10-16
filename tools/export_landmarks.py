"""Export a MediaPipe landmark trace from a video as a deterministic test fixture.

Usage:
    python tools/export_landmarks.py <video> <start_frame> <end_frame> <out.json>

Runs the same pose model the browser uses over the video frames, records the
landmarks the swing pipeline consumes, and also runs the project's Python
SwingDetector over that trace to store the reference phase timeline and
release events. ``tools/js_tests.mjs`` replays the identical trace through the
browser SwingDetector and asserts the same behaviour, so a regression in the
ported detector or in its landmark interpretation fails without a camera.
"""
import json
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import config  # noqa: E402
from input.swing import SwingDetector  # noqa: E402
from tracking.pose import LANDMARK_NAMES, Landmark, make_pose_result  # noqa: E402

# The landmarks the swing pipeline actually reads (torso, both arms, hands and
# knees for the key-landmark confidence), in a fixed order.
KEEP = (
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_index', 'left_pinky', 'left_thumb',
    'right_index', 'right_pinky', 'right_thumb',
    'left_hip', 'right_hip', 'left_knee', 'right_knee',
)


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        return 2
    video_path = Path(sys.argv[1])
    start = int(sys.argv[2])
    end = int(sys.argv[3])
    out_path = Path(sys.argv[4])
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    model = PROJECT / 'assets' / 'models' / 'pose_landmarker_lite.task'
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=config.TRACKING_MIN_DETECTION_CONFIDENCE,
        min_pose_presence_confidence=config.TRACKING_MIN_PRESENCE_CONFIDENCE,
        min_tracking_confidence=config.TRACKING_MIN_TRACKING_CONFIDENCE,
    )
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    detector = SwingDetector()
    phase_runs = []
    releases = []
    index = -1
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        last_ts = -1
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            index += 1
            if index > end:
                break
            ts = int(index * 1000.0 / fps)
            ts = max(ts, last_ts + 1)
            last_ts = ts
            rgb = np.ascontiguousarray(frame[:, :, ::-1])
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(image, ts)
            if not result.pose_landmarks:
                pose_result = make_pose_result({}, ts / 1000.0)
                entry = {'t': False, 'c': 0.0, 'l': None}
            else:
                raw = {name: Landmark(x=float(r.x), y=float(r.y), z=float(r.z),
                                      visibility=float(getattr(r, 'visibility', 0.0) or 0.0))
                       for name, r in zip(LANDMARK_NAMES, result.pose_landmarks[0])}
                pose_result = make_pose_result(raw, ts / 1000.0)
                entry = {
                    't': bool(pose_result.tracked),
                    'c': round(float(pose_result.confidence), 4),
                    'l': [round(raw[name].x, 5) if name in raw else None for name in KEEP]
                    + [round(raw[name].y, 5) if name in raw else None for name in KEEP]
                    + [round(raw[name].visibility, 4) if name in raw else None for name in KEEP],
                }
            if index < start:
                # keep the detector state in step but do not export these frames
                detector.update(pose_result, 1.0 / fps)
                continue
            frames.append(entry)
            event = detector.update(pose_result, 1.0 / fps)
            if not phase_runs or phase_runs[-1][0] != detector.phase:
                phase_runs.append([detector.phase, len(frames) - 1, len(frames) - 1])
            else:
                phase_runs[-1][2] = len(frames) - 1
            if event is not None:
                releases.append({
                    'frame': len(frames) - 1, 'arm': event.arm,
                    'up_speed': round(event.up_speed, 3), 'rise': round(event.rise, 3),
                    'depth': round(event.depth, 3), 'lateral_speed': round(event.lateral_speed, 3),
                    'hand_offset': round(event.hand_offset, 3),
                })
    cap.release()
    payload = {
        'source': video_path.name, 'fps': fps, 'start': start,
        'landmarks': list(KEEP),
        'frames': frames,
        'reference': {'phase_runs': phase_runs, 'releases': releases},
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(f'{out_path}: {len(frames)} frames, reference releases: {len(releases)}')
    for run in phase_runs:
        print('  ', run)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
