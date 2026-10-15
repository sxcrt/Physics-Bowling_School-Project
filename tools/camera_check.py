"""Diagnostic: exercise the real camera and pose pipeline (no game needed).

    python tools/camera_check.py [--seconds 8]

Reports what the tracking service sees frame by frame: camera state, frames
captured, pose inference results and confidence. Point the camera at yourself
(or another person) to check that landmarks arrive; with an empty room the
service should stay in "no person detected", which is itself a valid result.

This is the honest check for the parts of webcam mode that cannot be verified
with synthetic landmark streams.
"""
import argparse
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from tracking.service import TrackingService      # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=float, default=8.0)
    parser.add_argument('--camera', type=int, default=None)
    parser.add_argument('--swing', action='store_true',
                        help='also feed the live landmarks into the real '
                             'swing detector and report the phases it reaches')
    args = parser.parse_args()

    service = TrackingService(camera_index=args.camera)
    print(f'camera index: {service._camera_index}  '
          f'{service._camera_width}x{service._camera_height}')
    detector = None
    if args.swing:
        from input.swing import SwingDetector
        from tracking.pose import PoseResult

        detector = SwingDetector()
    service.start()
    started = time.time()
    frames = 0
    tracked_frames = 0
    best_confidence = 0.0
    last_error = None
    last_phase = None
    last_process = None
    try:
        while time.time() - started < args.seconds:
            snapshot = service.snapshot()
            if snapshot.error:
                last_error = snapshot.error
                print('error:', snapshot.error)
                break
            if snapshot.frame_count != frames:
                frames = snapshot.frame_count
                if snapshot.tracked:
                    tracked_frames += 1
                    best_confidence = max(best_confidence, snapshot.confidence)
                    if tracked_frames == 1:
                        print('first tracked frame at frame', frames)
                print(f'frame {frames:4d}  tracked={snapshot.tracked}  '
                      f'confidence={snapshot.confidence:.2f}  '
                      f'fps={snapshot.fps:.1f}  landmarks='
                      f'{len(snapshot.landmarks)}', flush=True)
                if detector is not None:
                    now = time.monotonic()
                    dt = 1 / 30.0 if last_process is None \
                        else max(1e-3, now - last_process)
                    last_process = now
                    event = detector.update(PoseResult(
                        landmarks=snapshot.landmarks,
                        confidence=snapshot.confidence,
                        tracked=snapshot.tracked,
                        timestamp=now), dt)
                    if detector.phase != last_phase:
                        last_phase = detector.phase
                        print(f'    swing phase -> {detector.phase} '
                              f'({detector.label})  {detector.hint}',
                              flush=True)
                    if event is not None:
                        print(f'    RELEASE: up_speed={event.up_speed:.2f}/s '
                              f'arm={event.arm} rise={event.rise:.2f} '
                              f'depth={event.depth:.2f} '
                              f'hand_offset={event.hand_offset:+.2f} '
                              f'lateral={event.lateral_speed:+.2f}', flush=True)
            time.sleep(0.1)
    finally:
        service.stop()
    print('---')
    print(f'frames captured: {frames}  tracked frames: {tracked_frames}  '
          f'best confidence: {best_confidence:.2f}')
    if detector is not None:
        print(f'swing detector: final phase={detector.phase} '
              f'releases={detector.release_count} aborts={detector.abort_count} '
              f'rejected frames={detector.rejected_count} '
              f'lost frames={detector.lost_count}')
    if last_error:
        print('last error:', last_error)
    if frames == 0:
        print('RESULT: no frames - the camera did not deliver images')
    elif tracked_frames == 0:
        print('RESULT: camera and model ran, but no pose was detected '
              '(no person in view, or the model found no landmarks)')
    else:
        print('RESULT: pose tracking works on this machine '
              f'({tracked_frames}/{frames} frames tracked, best confidence '
              f'{best_confidence:.2f})')


if __name__ == '__main__':
    main()
