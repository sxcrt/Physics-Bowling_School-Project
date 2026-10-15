"""Standalone webcam tracking preview -- a development diagnostic tool.

This does NOT load Ursina and does NOT touch the game. Run it from the
project root:

    python -m tracking.preview
    python -m tracking.preview --camera 1 --no-mirror
    python -m tracking.preview --seconds 10      # auto-close, handy for checks

Keys: q / ESC quit, m toggle mirror.
"""
import argparse
import sys
import time

import config
from tracking.service import TrackingService


def _build_parser():
    parser = argparse.ArgumentParser(
        description='Hells Balls webcam tracking preview (development tool)')
    parser.add_argument('--camera', type=int,
                        default=config.TRACKING_CAMERA_INDEX,
                        help='camera device index')
    parser.add_argument('--model', default=None,
                        help='path to a pose_landmarker .task file '
                             '(default: assets/models/)')
    parser.add_argument('--width', type=int,
                        default=config.TRACKING_CAMERA_WIDTH,
                        help='requested capture width')
    parser.add_argument('--height', type=int,
                        default=config.TRACKING_CAMERA_HEIGHT,
                        help='requested capture height')
    parser.add_argument('--seconds', type=float, default=0.0,
                        help='close automatically after N seconds '
                             '(0 = run until quit)')
    parser.add_argument('--timeout', type=float, default=20.0,
                        help='seconds to wait for the first camera frame')
    parser.add_argument('--no-mirror', action='store_true',
                        help='show the raw camera image instead of a mirror')
    return parser


def suggest_fix(message):
    """Map a tracking error message to a short, actionable hint."""
    lowered = (message or '').lower()
    if 'mediapipe' in lowered:
        return ('Install the tracking dependencies:  '
                'python -m pip install -r requirements.txt')
    if 'model' in lowered:
        return ('The pose model is missing or could not be downloaded. '
                'Check the internet connection or fetch the model manually '
                '(see tracking/README.md).')
    if 'webcam' in lowered or 'camera' in lowered:
        return ('Check that the camera is connected, allowed in Windows '
                'privacy settings and not used by another app. A different '
                'index may help, e.g. --camera 1.')
    return None


def main(argv=None):
    args = _build_parser().parse_args(argv)
    try:
        import cv2
    except ImportError:
        print('OpenCV (cv2) is required for the tracking preview.')
        print('Install the tracking dependencies:  '
              'python -m pip install -r requirements.txt')
        return 1
    from tracking import overlay

    service = TrackingService(camera_index=args.camera, model_path=args.model,
                              camera_width=args.width, camera_height=args.height)
    service.start()
    print('[tracking] opening the camera and loading the pose model...')
    snapshot = service.wait_for_frame(timeout=args.timeout)
    if snapshot.error is not None:
        print(f'[tracking] tracking is unavailable: {snapshot.error}')
        hint = suggest_fix(snapshot.error)
        if hint:
            print(f'[tracking] {hint}')
        service.stop()
        return 1
    if snapshot.frame is None:
        print(f'[tracking] no camera frame arrived within {args.timeout:.0f} s')
        service.stop()
        return 1

    window = 'Hells Balls - Tracking Preview'
    cv2.namedWindow(window, cv2.WINDOW_AUTOSIZE)
    mirror = not args.no_mirror
    started = time.monotonic()
    error_since = None
    exit_code = 0
    try:
        while True:
            snapshot = service.snapshot()
            if snapshot.frame is not None:
                cv2.imshow(window, overlay.render(
                    snapshot.frame, snapshot,
                    mirror=mirror, camera_index=args.camera))
            if snapshot.error is not None:
                if error_since is None:
                    error_since = time.monotonic()
                    print(f'[tracking] tracking stopped: {snapshot.error}')
                elif time.monotonic() - error_since >= 2.0:
                    exit_code = 1
                    break
            if cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1:
                break
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord('q')):
                break
            if key == ord('m'):
                mirror = not mirror
            if args.seconds and time.monotonic() - started >= args.seconds:
                break
    except KeyboardInterrupt:
        pass
    finally:
        service.stop()
        cv2.destroyAllWindows()
    print('[tracking] preview closed')
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
