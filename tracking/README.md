# Webcam tracking

Body tracking for Hells Balls. Since milestone 5 the webcam is integrated
directly into the main game: run `python main.py`, press `TAB` (or `2`) to
select **WEBCAM** mode, and the camera feed, tracking status and swing phase
appear inside the game window. The game releases the camera whenever webcam
mode is left or the game exits.

The modules here are engine-agnostic and are consumed by `input/webcam_input.py`
(`TrackingService` + `SwingDetector` produce the game's existing `ThrowData`).
Nothing in this package is imported by the gameplay/physics/scoring code.

## Optional developer preview

`python -m tracking.preview` is a standalone diagnostic window (not needed
for gameplay; useful when tuning the tracker itself).

## Install dependencies

    python -m pip install -r requirements.txt

## Run the tracking preview

Run from the project root:

    python -m tracking.preview

Keys: `q` / `ESC` quit, `m` toggle mirror.
Useful options: `--camera 1`, `--no-mirror`, `--seconds 10`, `--timeout 30`.

The preview opens its own window with the camera feed, the detected skeleton
(key bowling joints drawn larger), tracking status, confidence, FPS and the
number of visible key joints. It does not load Ursina.

## Architecture

| Module             | Responsibility                                                  |
|--------------------|-----------------------------------------------------------------|
| `pose.py`          | Pure data types (`Landmark`, `PoseResult`) + reliability gate. No cv2/mediapipe imports. |
| `camera_source.py` | OpenCV capture wrapper; raises `CameraError` with actionable hints. |
| `pose_tracker.py`  | MediaPipe Tasks `PoseLandmarker` (VIDEO mode) wrapper; resolves/downloads the `.task` model. |
| `service.py`       | Owns camera + tracker on a daemon thread; publishes an immutable `TrackingSnapshot` per frame. |
| `overlay.py`       | Minimal OpenCV drawing used by the preview only. |
| `preview.py`       | The diagnostic window (`python -m tracking.preview`).           |

A detection is only marked `tracked` when at least
`TRACKING_MIN_KEY_LANDMARKS` (6) of the 10 key joints
(shoulders, elbows, wrists, hips, knees) have visibility ≥ 0.5 **and** their
mean visibility is ≥ 0.5. Unreliable or missing detections are published with
empty landmarks so they can never be mistaken for valid movement.

## Model file

`assets/models/pose_landmarker_lite.task` (~5.8 MB). It is downloaded
automatically on first use. To fetch it manually:

    python -c "from tracking.pose_tracker import resolve_model_path; print(resolve_model_path())"

or download
<https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task>
and save it as `assets/models/pose_landmarker_lite.task`.

## Next milestone

The webcam input is wired into the game (milestone 5): `input/webcam_input.py`
implements `input.base.ThrowSource`, and `input/swing.py` recognizes the swing
phases. Further work can calibrate `SWING_SPEED_SCALE` / `WEBCAM_AIM_SCALE`
in `config.py` against real throws without touching the physics, scoring or
game-flow layers.
