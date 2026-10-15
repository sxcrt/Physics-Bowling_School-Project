// Webcam input: turns tracked body motion into throws (ported from
// input/webcam_input.py), with a MediaPipe Tasks Vision service in place of the
// OpenCV + MediaPipe Python stack.
import * as config from '../config.js';
import { makeThrowData } from './mouse.js';
import { SwingDetector } from './swing.js';

export const LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner',
  'right_eye', 'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left',
  'mouth_right', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky', 'left_index',
  'right_index', 'left_thumb', 'right_thumb', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel',
  'right_heel', 'left_foot_index', 'right_foot_index',
];

const KEY_LANDMARKS = [
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist',
  'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee',
];

const SKELETON = [
  ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'], ['left_wrist', 'left_index'], ['left_wrist', 'left_pinky'],
  ['left_wrist', 'left_thumb'], ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['right_wrist', 'right_index'], ['right_wrist', 'right_pinky'], ['right_wrist', 'right_thumb'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'], ['left_hip', 'left_knee'], ['right_hip', 'right_knee'],
  ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle'],
];

const BODY_POINTS = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'];

const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

function clamp(v, low, high) { return Math.max(low, Math.min(high, v)); }

export function makeWebcamStatus(data = {}) {
  return {
    running: false, tracked: false, confidence: 0.0, fps: 0.0, error: null,
    phase: 'waiting', phase_label: 'Waiting for ready position', hint: '',
    lost_seconds: null, telemetry: '', arm: 'auto', ...data,
  };
}

export function eventToThrow(event, mirror = null) {
  mirror = mirror === null ? config.WEBCAM_MIRROR : mirror;
  const bodyX = mirror ? 1.0 - event.body_x : event.body_x;
  const lateral = clamp((bodyX - 0.5) * 2.0 * config.LATERAL_LIMIT * config.WEBCAM_AIM_SCALE,
    -config.LATERAL_LIMIT, config.LATERAL_LIMIT);
  const speed = clamp(event.up_speed * config.SWING_SPEED_SCALE,
    config.MIN_THROW_SPEED, config.MAX_THROW_SPEED);
  const handOffset = mirror ? -event.hand_offset : event.hand_offset;
  const aimLimit = config.MAX_AIM_ANGLE * Math.PI / 180;
  const aim = clamp(config.SWING_AIM_SCALE * handOffset * Math.PI / 180, -aimLimit, aimLimit);
  const lateralSpeed = mirror ? -event.lateral_speed : event.lateral_speed;
  const release = clamp(config.SWING_RELEASE_DIR_SCALE * lateralSpeed * Math.PI / 180,
    -config.MAX_RELEASE_YAW * Math.PI / 180, config.MAX_RELEASE_YAW * Math.PI / 180);
  const launchLimit = config.MAX_LAUNCH_ANGLE * Math.PI / 180;
  const launchAngle = clamp(aim + release, -launchLimit, launchLimit);
  const spin = clamp(lateralSpeed * config.SWING_SPIN_SCALE * config.SPIN_SIGN,
    -config.MAX_SPIN, config.MAX_SPIN);
  return makeThrowData({
    lateral_position: lateral, launch_angle: launchAngle, speed: speed,
    spin_omega: spin, source: 'webcam', confidence: Number(event.confidence),
  });
}

export class TrackingService {
  constructor() {
    this._snapshot = makeWebcamStatus({ message: 'not started' });
    this._landmarker = null;
    this._video = null;
    this._stream = null;
    this._running = false;
    this._frameCount = 0;
    this._lastTrackedAt = null;
    this._lostFrames = 0;
    this._fpsTimes = [];
    this._preferredIndex = null;
  }

  get is_running() { return this._running; }

  snapshot() { return this._snapshot; }

  // CAMERA INDEX setting (game/settings.py): null = the browser default.
  setPreferredCamera(index) {
    const value = index === null || index === undefined ? null : Number(index);
    this._preferredIndex = Number.isFinite(value) ? value : null;
  }

  async _videoConstraints() {
    const index = this._preferredIndex;
    if (index !== null && navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((device) => device.kind === 'videoinput');
        const pick = cameras[index];
        if (pick && pick.deviceId) return { deviceId: { exact: pick.deviceId } };
      } catch (_e) { /* fall back to the default camera */ }
    }
    return { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };
  }

  async start() {
    if (this._running) return;
    // Clear any error from a previous attempt before opening the camera, or
    // the play screen would see the stale failure and switch back to mouse
    // before this attempt has a chance to succeed.
    this._publish({ running: true, error: null, message: 'starting camera...' });
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('camera not available in this browser');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: await this._videoConstraints(),
        audio: false,
      });
      this._stream = stream;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      this._video = video;
      this._publish({ message: 'camera open; loading pose model...' });
      await this._loadLandmarker();
      this._publish({ message: 'tracking' });
      this._running = true;
      this._loop();
    } catch (e) {
      this._publish({ running: false, error: String(e && e.message ? e.message : e), message: 'tracking unavailable' });
      this._cleanup();
    }
  }

  async _loadLandmarker() {
    const vision = await import(`${MEDIAPIPE_CDN}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
    this._landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: 'assets/models/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: config.TRACKING_MIN_DETECTION_CONFIDENCE,
      minPosePresenceConfidence: config.TRACKING_MIN_PRESENCE_CONFIDENCE,
      minTrackingConfidence: config.TRACKING_MIN_TRACKING_CONFIDENCE,
    });
  }

  _cleanup() {
    if (this._stream) {
      try { this._stream.getTracks().forEach((t) => t.stop()); } catch (_e) {}
      this._stream = null;
    }
    this._video = null;
    if (this._landmarker) { try { this._landmarker.close(); } catch (_e) {} this._landmarker = null; }
  }

  async stop() {
    this._running = false;
    this._cleanup();
    this._publish({ running: false, message: 'stopped', frame: null });
  }

  _publish(changes) { this._snapshot = { ...this._snapshot, ...changes }; }

  async _loop() {
    while (this._running) {
      const video = this._video;
      if (!video || video.readyState < 2) { await new Promise((r) => setTimeout(r, 16)); continue; }
      const now = performance.now();
      let result = null;
      try {
        result = this._landmarker.detectForVideo(video, now);
      } catch (e) {
        this._publish({ running: false, error: `pose detection failed: ${e}`, message: 'tracking unavailable' });
        this._running = false;
        this._cleanup();
        break;
      }
      this._frameCount += 1;
      this._fpsTimes.push(now);
      if (this._fpsTimes.length > 30) this._fpsTimes.shift();
      const fps = this._fpsTimes.length > 1
        ? (this._fpsTimes.length - 1) / ((this._fpsTimes[this._fpsTimes.length - 1] - this._fpsTimes[0]) / 1000)
        : 0.0;

      const landmarks = {};
      let tracked = false, confidence = 0.0;
      if (result.landmarks && result.landmarks.length) {
        const pose = result.landmarks[0];
        pose.forEach((lm, index) => {
          landmarks[LANDMARK_NAMES[index]] = { x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 0 };
        });
        let total = 0, visible = 0;
        for (const name of KEY_LANDMARKS) {
          const lm = landmarks[name];
          if (!lm) continue;
          total += lm.visibility;
          if (lm.visibility >= config.TRACKING_VISIBILITY_THRESHOLD) visible += 1;
        }
        confidence = total / KEY_LANDMARKS.length;
        tracked = visible >= config.TRACKING_MIN_KEY_LANDMARKS
          && confidence >= config.TRACKING_CONFIDENCE_THRESHOLD;
      }
      if (tracked) { this._lastTrackedAt = now / 1000; this._lostFrames = 0; }
      else this._lostFrames += 1;
      this._publish({
        tracked, confidence, landmarks: tracked ? landmarks : {},
        fps, frame_count: this._frameCount,
        lost_frames: this._lostFrames,
        last_tracked_at: this._lastTrackedAt,
        message: tracked ? 'tracking' : 'pose lost',
        frame: video,
      });
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
}

export class WebcamInput {
  constructor(service = null, detector = null) {
    this._service = service || new TrackingService();
    this._detector = detector || new SwingDetector();
    this._pending = null;
    this._game_ready = false;
    this._last_frame_count = -1;
    this._last_process_time = null;
    this._last_phase = null;
    this.lateral = 0.0;
    this._lateral_smoothed = 0.0;
  }

  update() {
    const snapshot = this._service.snapshot();
    if (!this._game_ready) return;
    if (snapshot.frame_count !== this._last_frame_count) {
      this._last_frame_count = snapshot.frame_count;
      this._processFrame(snapshot);
    }
    if (snapshot.tracked) this._updateLateral(snapshot);
  }

  get throw_data() {
    const data = this._pending;
    this._pending = null;
    return data;
  }

  discardPending() { this._pending = null; }

  setGameReady(ready) {
    ready = !!ready;
    if (ready === this._game_ready) return;
    this._game_ready = ready;
    this._detector.reset();
    this._pending = null;
    this._last_frame_count = -1;
    this._last_process_time = null;
  }

  async start() {
    this._detector.reset();
    this._pending = null;
    this._last_frame_count = -1;
    this._last_process_time = null;
    this._last_phase = null;
    await this._service.start();
  }

  async stop() {
    await this._service.stop();
    this._detector.reset();
    this._pending = null;
  }

  get is_running() { return this._service.is_running; }

  get preferred_arm() { return this._detector.preferred_arm; }
  setPreferredArm(arm) { this._detector.setPreferredArm(arm); this._detector.reset(); }
  setPreferredCamera(index) {
    if (this._service.setPreferredCamera) this._service.setPreferredCamera(index);
  }
  cyclePreferredArm() {
    const order = ['auto', 'right', 'left'];
    const current = this.preferred_arm;
    const index = order.indexOf(current) >= 0 ? order.indexOf(current) : 0;
    const arm = order[(index + 1) % order.length];
    this.setPreferredArm(arm);
    return arm;
  }

  status() {
    const snapshot = this._service.snapshot();
    let lostSeconds = null;
    if (!snapshot.tracked && snapshot.last_tracked_at !== null && snapshot.last_tracked_at !== undefined) {
      lostSeconds = Math.max(0.0, performance.now() / 1000 - snapshot.last_tracked_at);
    }
    let telemetry = '';
    if (config.WEBCAM_SHOW_TELEMETRY) {
      const data = this._detector.telemetry;
      if (data) {
        telemetry = `${data.arm[0].toUpperCase()} arm: ${data.direction} ${Math.abs(data.speed).toFixed(2)}/s   depth ${data.depth.toFixed(2)}   rise ${data.rise.toFixed(2)}`;
      }
    }
    return makeWebcamStatus({
      running: snapshot.running || this._service.is_running,
      tracked: snapshot.tracked, confidence: snapshot.confidence, fps: snapshot.fps,
      error: snapshot.error, phase: this._detector.phase,
      phase_label: this._detector.label, hint: this._detector.hint,
      lost_seconds: lostSeconds, telemetry, arm: this.preferred_arm,
    });
  }

  latestSnapshot() { return this._service.snapshot(); }

  get swing_pose() {
    const pose = this._detector.swing_pose;
    try { return Math.max(-1.0, Math.min(1.0, Number(pose))); } catch (_e) { return 0.0; }
  }

  get dragging() {
    const phase = this._detector.phase;
    return ['backswing', 'forward', 'release'].includes(phase);
  }

  get power() {
    let value = this._detector.telemetry.peak_up;
    value = Math.max(0.0, Math.min(1.0, Number(value || 0.0)));
    return value;
  }

  _processFrame(snapshot) {
    const now = performance.now() / 1000;
    const dt = this._last_process_time === null ? 1.0 / 30.0 : now - this._last_process_time;
    this._last_process_time = now;
    const result = {
      landmarks: snapshot.landmarks, confidence: snapshot.confidence,
      tracked: snapshot.tracked, timestamp: now,
    };
    const event = this._detector.update(result, dt);
    if (event !== null && this._pending === null) {
      this._pending = eventToThrow(event);
    }
  }

  _updateLateral(snapshot) {
    const xs = [];
    for (const name of BODY_POINTS) {
      const lm = snapshot.landmarks[name];
      if (lm && lm.visibility >= config.TRACKING_VISIBILITY_THRESHOLD) xs.push(lm.x);
    }
    if (!xs.length) return;
    const bodyX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const mirrored = config.WEBCAM_MIRROR ? 1.0 - bodyX : bodyX;
    const target = clamp((mirrored - 0.5) * 2.0 * config.LATERAL_LIMIT * config.WEBCAM_AIM_SCALE,
      -config.LATERAL_LIMIT, config.LATERAL_LIMIT);
    const alpha = config.WEBCAM_LATERAL_SMOOTHING;
    this._lateral_smoothed += alpha * (target - this._lateral_smoothed);
    this.lateral = this._lateral_smoothed;
  }
}
