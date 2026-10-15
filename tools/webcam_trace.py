"""Dump per-frame detector internals for a video, to find usable segments.

Usage: python tools/webcam_trace.py <video> [start] [end]
"""
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import config  # noqa: E402
from input.swing import SwingDetector  # noqa: E402
from tracking.pose import LANDMARK_NAMES, Landmark, make_pose_result  # noqa: E402


def main():
    path = Path(sys.argv[1])
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    end = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
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
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    detector = SwingDetector()
    print(f'{"f":>4} {"phase":>9} {"trk":>3} {"conf":>4} {"torsoH":>6} '
          f'{"R_dy":>6} {"R_v":>6} {"L_dy":>6} {"L_v":>6} {"hold":>5}')
    i = -1
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        last_ts = -1
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            i += 1
            ts = int(i * 1000.0 / fps)
            ts = max(ts, last_ts + 1)
            last_ts = ts
            rgb = np.ascontiguousarray(frame[:, :, ::-1])
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(image, ts)
            if not result.pose_landmarks:
                pose_result = make_pose_result({}, ts / 1000.0)
            else:
                landmarks = {name: Landmark(x=float(raw.x), y=float(raw.y), z=float(raw.z),
                                            visibility=float(getattr(raw, 'visibility', 0.0) or 0.0))
                             for name, raw in zip(LANDMARK_NAMES, result.pose_landmarks[0])}
                pose_result = make_pose_result(landmarks, ts / 1000.0)
            event = detector.update(pose_result, 1.0 / fps)
            if start <= i <= end:
                R = detector._smooth.get('right')
                L = detector._smooth.get('left')
                fmt = lambda d: f'{d:6.3f}' if d is not None else '  None'
                print(f'{i:4d} {detector.phase:>9} {str(pose_result.tracked):>3} '
                      f'{pose_result.confidence:4.2f} {detector._torso_height:6.3f} '
                      f'{fmt(R[1] if R else None)} {detector._vel["right"]:+6.2f} '
                      f'{fmt(L[1] if L else None)} {detector._vel["left"]:+6.2f} '
                      f'{detector._ready_hold:5.2f}')
            if event is not None:
                print(f'*** RELEASE frame {i} arm={event.arm} up={event.up_speed:.2f} rise={event.rise:.2f}')
    cap.release()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
