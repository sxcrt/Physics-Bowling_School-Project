"""One-shot webcam probe: capture a frame, run MediaPipe pose, report landmarks.

Usage: python tools/webcam_probe.py [camera_index] [output_image]
"""
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

import cv2  # noqa: E402


def main():
    index = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else PROJECT / 'tools' / 'probe_frame.jpg'
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        print(f'camera {index}: NOT opened')
        return 1
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    frame = None
    for _ in range(10):
        ok, frame = cap.read()
        if not ok:
            frame = None
            break
    cap.release()
    if frame is None:
        print(f'camera {index}: no frame')
        return 1
    cv2.imwrite(str(out), frame)
    print(f'camera {index}: frame {frame.shape} saved to {out}')

    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    model = PROJECT / 'assets' / 'models' / 'pose_landmarker_lite.task'
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
    )
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(image)
        if not result.pose_landmarks:
            print('pose: no person detected')
            return 0
        names = (
            'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
            'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear',
            'right_ear', 'mouth_left', 'mouth_right', 'left_shoulder',
            'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist',
            'right_wrist', 'left_pinky', 'right_pinky', 'left_index',
            'right_index', 'left_thumb', 'right_thumb', 'left_hip', 'right_hip',
            'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel',
            'right_heel', 'left_foot_index', 'right_foot_index',
        )
        pose = result.pose_landmarks[0]
        print('pose: person detected; key landmarks:')
        for name in ('left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
                     'left_wrist', 'right_wrist'):
            raw = pose[names.index(name)]
            print(f'  {name}: x={raw.x:.3f} y={raw.y:.3f} vis={getattr(raw, "visibility", 0):.2f}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
