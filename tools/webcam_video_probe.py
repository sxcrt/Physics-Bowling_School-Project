"""Probe a video file with the project's real tracking + swing pipeline.

Usage: python tools/webcam_video_probe.py <video path> [out_prefix]

Runs Python MediaPipe (same model as the browser) over the video at ~30 fps and
then feeds the landmarks through the project's SwingDetector, printing the
phase transitions, the recognized swing event and per-frame telemetry. Also
saves a contact sheet of sample frames so the content can be eyeballed.
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


def landmark_from_raw(raw):
    return Landmark(x=float(raw.x), y=float(raw.y), z=float(raw.z),
                    visibility=float(getattr(raw, 'visibility', 0.0) or 0.0),
                    presence=float(getattr(raw, 'presence', 0.0) or 0.0))


def main():
    path = Path(sys.argv[1])
    prefix = sys.argv[2] if len(sys.argv) > 2 else str(PROJECT / 'tools' / 'testdata' / 'sheet')
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
    if fps <= 0 or fps > 120:
        fps = 30.0
    frame_dt = 1.0 / fps
    detector = SwingDetector()
    frames = []
    samples = []
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
        if index % 30 == 0:
            samples.append(frame.copy())
        index += 1
    cap.release()
    print(f'video: {index} frames, fps={fps:.1f}')

    events = []
    runs = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        last_ts = -1
        for i, frame in enumerate(frames):
            ts = int(i * 1000.0 / fps)
            ts = max(ts, last_ts + 1)
            last_ts = ts
            rgb = np.ascontiguousarray(frame[:, :, ::-1])
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect_for_video(image, ts)
            if not result.pose_landmarks:
                pose_result = make_pose_result({}, ts / 1000.0)
            else:
                landmarks = {name: landmark_from_raw(raw)
                             for name, raw in zip(LANDMARK_NAMES, result.pose_landmarks[0])}
                pose_result = make_pose_result(landmarks, ts / 1000.0)
            event = detector.update(pose_result, frame_dt)
            if not runs or runs[-1][0] != detector.phase:
                runs.append([detector.phase, i, i])
            else:
                runs[-1][2] = i
            if detector.phase in ('backswing', 'forward') and i % 3 == 0:
                t = detector.telemetry
                print(f'  frame {i:4d} phase={detector.phase:9s} arm={t["arm"]:5s} '
                      f'v={t["speed"]:+.2f} depth={t["depth"]:.2f} rise={t["rise"]:.2f} '
                      f'peak={t["peak_up"]:.2f} conf={pose_result.confidence:.2f}')
            if event is not None:
                events.append((i, event))
                print(f'RELEASE at frame {i}: arm={event.arm} up={event.up_speed:.2f}/s '
                      f'rise={event.rise:.2f} depth={event.depth:.2f} '
                      f'lateral={event.lateral_speed:+.2f} offset={event.hand_offset:+.2f} '
                      f'conf={event.confidence:.2f}')
    print('phase runs:')
    for phase, start, end in runs:
        print(f'  {phase:14s} frames {start}..{end}')
    print(f'events: {len(events)}  rejected={detector.rejected_count} '
          f'lost={detector.lost_count} aborts={detector.abort_count}')
    if detector.last_reject_reason:
        print(f'last reject: {detector.last_reject_reason}')

    # contact sheet, downscaled to 320 px wide
    if samples:
        thumbs = []
        for frame in samples:
            h, w = frame.shape[:2]
            scale = 320.0 / w
            thumbs.append(cv2.resize(frame, (320, max(1, int(h * scale)))))
        cols = min(5, len(thumbs))
        rows = (len(thumbs) + cols - 1) // cols
        th, tw = thumbs[0].shape[:2]
        sheet = np.zeros((rows * th, cols * tw, 3), dtype=np.uint8)
        for i, thumb in enumerate(thumbs):
            r, c = divmod(i, cols)
            sheet[r * th:r * th + th, c * tw:c * tw + tw] = thumb
        cv2.imwrite(prefix + '_sheet.jpg', sheet)
        print(f'contact sheet: {prefix}_sheet.jpg')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
