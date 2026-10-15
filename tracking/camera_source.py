"""Webcam capture with graceful failure handling.

Wraps ``cv2.VideoCapture`` behind a small interface so the rest of the
tracking layer never touches OpenCV directly (and tests can inject a fake
capture). Failures raise ``CameraError`` with an actionable message instead
of leaking OpenCV's return codes.

OpenCV is imported lazily inside the default capture factory, so importing
this module is cheap and works even without OpenCV installed.
"""
import config


class CameraError(RuntimeError):
    """The webcam could not be opened or is not available."""


def _default_capture_factory(index, width, height):
    """Open a camera with OpenCV, trying platform-appropriate backends."""
    try:
        import cv2
    except ImportError as exc:
        raise CameraError(
            'OpenCV (cv2) is not installed; install the tracking '
            'dependencies with:  python -m pip install -r requirements.txt'
        ) from exc

    # DirectShow opens much faster on Windows and avoids Media Foundation
    # stalls; fall back to OpenCV's default backend if it fails.
    backends = [cv2.CAP_DSHOW, cv2.CAP_ANY]
    for backend in backends:
        capture = cv2.VideoCapture(index, backend)
        if capture.isOpened():
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            return capture
        capture.release()
    return None


class CameraSource:
    """A webcam stream: open, read frames, release.

    The capture factory can be replaced for tests; it receives
    ``(index, width, height)`` and returns an OpenCV-style capture object
    (``isOpened()``, ``read()``, ``release()``) or None.
    """

    def __init__(self, index=None, width=None, height=None,
                 capture_factory=None):
        self._index = config.TRACKING_CAMERA_INDEX if index is None else index
        self._width = config.TRACKING_CAMERA_WIDTH if width is None else width
        self._height = config.TRACKING_CAMERA_HEIGHT if height is None else height
        self._capture_factory = capture_factory or _default_capture_factory
        self._capture = None

    @property
    def is_open(self):
        return self._capture is not None

    def open(self):
        """Open the camera or raise ``CameraError``."""
        if self._capture is not None:
            return self
        try:
            capture = self._capture_factory(self._index, self._width, self._height)
        except CameraError:
            raise
        except Exception as exc:
            raise CameraError(
                f'could not open webcam at index {self._index}: {exc}'
            ) from exc
        if capture is None or not capture.isOpened():
            if capture is not None:
                capture.release()
            raise CameraError(
                f'no webcam could be opened at index {self._index}; check '
                'that a camera is connected, enabled and not in use by '
                'another application'
            )
        self._capture = capture
        return self

    def read(self):
        """Return the next BGR frame, or None if the camera is unavailable."""
        if self._capture is None:
            return None
        try:
            ok, frame = self._capture.read()
        except Exception:
            return None
        if not ok or frame is None:
            return None
        return frame

    def release(self):
        """Release the camera. Safe to call repeatedly and from any thread."""
        capture, self._capture = self._capture, None
        if capture is not None:
            try:
                capture.release()
            except Exception:
                pass

    def __enter__(self):
        return self.open()

    def __exit__(self, exc_type, exc_value, traceback):
        self.release()
        return False
