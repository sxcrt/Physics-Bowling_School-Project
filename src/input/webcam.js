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

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeWebcamStatus(data = {}) {
  return {
    running: false, tracked: false, confidence: 0.0, fps: 0.0, error: null,
    phase: 'waiting', phase_label: 'Waiting for ready position', hint: '',
    lost_seconds: null, telemetry: '', arm: 'auto',
    message: '', frame_count: 0, delegate: null, ...data,
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
  constructor(options = {}) {
    this._snapshot = makeWebcamStatus({ message: 'not started' });
    this._landmarker = null;
    this._video = null;
    this._stream = null;
    this._running = false;
    this._starting = false;
    // Every start/stop bumps the generation; a start that is still awaiting a
    // permission prompt or a model download when stop() (or a new start)
    // arrives must never leave a camera running behind the game's back.
    this._generation = 0;
    this._frameCount = 0;
    this._lastTrackedAt = null;
    this._lostFrames = 0;
    this._fpsTimes = [];
    this._preferredIndex = null;
    this._delegate = null;                 // 'GPU' or 'CPU' (diagnostics)
    this._lastVideoTime = -1;              // currentTime of the last processed frame
    this._watchdogVideoTime = -1;
    this._startedAt = 0;
    this._progressAt = 0;
    this._watchdog = null;
    this._frameTimeoutMs = numberOr(options.frame_timeout_ms,
      config.TRACKING_FRAME_TIMEOUT * 1000);
    this._stallTimeoutMs = numberOr(options.stall_timeout_ms,
      config.TRACKING_STALL_TIMEOUT * 1000);
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
    if (this._running || this._starting) return;
    const generation = ++this._generation;
    this._starting = true;
    // Clear any error from a previous attempt before opening the camera, or
    // the play screen would see the stale failure and switch back to mouse
    // before this attempt has a chance to succeed. The counters are reset the
    // same way tracking/service.py does in start().
    this._frameCount = 0;
    this._lostFrames = 0;
    this._fpsTimes = [];
    this._lastTrackedAt = null;
    this._publish({
      running: true, error: null, message: 'starting camera...',
      tracked: false, confidence: 0.0, landmarks: {}, fps: 0.0,
      frame_count: 0, lost_frames: 0, last_tracked_at: null, frame: null,
    });
    let stream = null;
    let video = null;
    const releaseLocal = () => {
      try { if (video) video.srcObject = null; } catch (_e) {}
      try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_e) {}
    };
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('camera access needs a secure context (HTTPS or localhost) and a browser with getUserMedia');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: await this._videoConstraints(),
        audio: false,
      });
      if (generation !== this._generation) { releaseLocal(); return; }
      this._stream = stream;
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await this._playVideo(video);
      if (generation !== this._generation) { releaseLocal(); return; }
      this._video = video;
      this._publish({ message: 'camera open; loading pose model...' });
      const landmarker = await this._loadLandmarker();
      if (generation !== this._generation) {
        try { landmarker.close(); } catch (_e) {}
        releaseLocal();
        return;
      }
      this._landmarker = landmarker;
      this._publish({ message: 'tracking', delegate: this._delegate });
      this._running = true;
      this._startedAt = performance.now();
      this._progressAt = this._startedAt;
      this._watchdogVideoTime = -1;
      this._lastVideoTime = -1;      // the first delivered frame is processed
      this._armWatchdog(generation);
      this._loop(generation);
    } catch (e) {
      if (generation !== this._generation) { releaseLocal(); return; }
      this._publish({
        running: false, error: this._friendlyError(e), message: 'tracking unavailable',
      });
      this._cleanup();
    } finally {
      if (generation === this._generation) this._starting = false;
    }
  }

  // ``video.play()`` can hang forever when a camera opens but never delivers a
  // frame (some virtual cameras, a device held by another app). Without a
  // deadline the whole webcam mode would sit at "starting camera..." with no
  // error and no way back to the mouse, so the wait is bounded.
  async _playVideo(video) {
    const timeoutMs = this._frameTimeoutMs;
    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(
        `camera opened but delivered no frames after ${Math.round(timeoutMs / 1000)}s - close other apps using the camera and retry`)), timeoutMs);
    });
    try {
      await Promise.race([video.play(), timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  _friendlyError(error) {
    const text = String((error && error.message) || error || 'unknown error');
    if (/notallowed|permission|denied/i.test(text)) {
      return 'camera permission denied - allow camera access for this site '
        + '(click the camera icon in the address bar), then retry';
    }
    if (/failed to fetch dynamically imported module|importing a module script failed|networkerror|load failed/i.test(text)) {
      return 'could not load the MediaPipe pose runtime (network/CDN) - check the connection and retry';
    }
    return text;
  }

  // Creates and returns a pose landmarker. The GPU delegate is preferred, but
  // many real machines fail to create it (no WebGL2, driver quirks); in that
  // case the CPU delegate runs the exact same model, just slower, instead of
  // disabling webcam mode outright.
  async _loadLandmarker(options = {}) {
    const vision = await import(`${MEDIAPIPE_CDN}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_CDN}/wasm`);
    const buildOptions = (delegate) => ({
      baseOptions: {
        modelAssetPath: 'assets/models/pose_landmarker_lite.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: config.TRACKING_MIN_DETECTION_CONFIDENCE,
      minPosePresenceConfidence: config.TRACKING_MIN_PRESENCE_CONFIDENCE,
      minTrackingConfidence: config.TRACKING_MIN_TRACKING_CONFIDENCE,
    });
    const preferred = options.delegate || 'GPU';
    try {
      const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, buildOptions(preferred));
      this._delegate = preferred;
      return landmarker;
    } catch (error) {
      if (preferred === 'CPU') throw error;
      const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, buildOptions('CPU'));
      this._delegate = 'CPU';
      return landmarker;
    }
  }

  _cleanup() {
    if (this._watchdog !== null) { clearInterval(this._watchdog); this._watchdog = null; }
    if (this._stream) {
      try { this._stream.getTracks().forEach((t) => t.stop()); } catch (_e) {}
      this._stream = null;
    }
    if (this._video) { try { this._video.srcObject = null; } catch (_e) {} }
    this._video = null;
    if (this._landmarker) { try { this._landmarker.close(); } catch (_e) {} this._landmarker = null; }
    this._delegate = null;
    this._lastVideoTime = -1;
    this._watchdogVideoTime = -1;
  }

  async stop() {
    this._generation += 1;      // a start still in flight must not resurrect
    this._starting = false;
    this._running = false;
    this._cleanup();
    this._publish({ running: false, message: 'stopped', frame: null });
  }

  // Reports a camera that never started delivering frames, or stopped doing
  // so mid-session, as a normal error so the play screen can explain it and
  // fall back to the mouse. Runs off its own timer: the processing loop is
  // paced by requestAnimationFrame and would itself be paused in a hidden tab.
  _armWatchdog(generation) {
    if (this._watchdog !== null) { clearInterval(this._watchdog); this._watchdog = null; }
    this._watchdogVideoTime = this._video ? this._video.currentTime : -1;
    const interval = Math.min(500, Math.max(50, Math.floor(this._stallTimeoutMs / 2)));
    this._watchdog = setInterval(() => {
      if (generation !== this._generation || !this._running) return;
      const video = this._video;
      if (!video) return;
      const now = performance.now();
      if (typeof document !== 'undefined' && document.hidden) {
        // A hidden tab pauses the rAF processing loop; that is the game's own
        // throttling, not a camera fault, so no timeout accrues while hidden.
        this._startedAt = now;
        this._progressAt = now;
        return;
      }
      if (video.currentTime !== this._watchdogVideoTime) {
        this._watchdogVideoTime = video.currentTime;
        this._progressAt = now;
      }
      if (this._frameCount === 0) {
        if (now - this._startedAt > this._frameTimeoutMs) {
          this._fail(`camera opened but delivered no frames after ${Math.round(this._frameTimeoutMs / 1000)}s - close other apps using the camera and retry`);
        }
      } else if (now - this._progressAt > this._stallTimeoutMs) {
        this._fail('camera stopped delivering frames - check the webcam and retry');
      }
    }, interval);
  }

  _fail(message) {
    this._running = false;
    this._publish({ running: false, error: message, message: 'tracking unavailable' });
    this._cleanup();
  }

  _publish(changes) { this._snapshot = { ...this._snapshot, ...changes }; }

  async _loop(generation) {
    let cpuRetried = false;
    while (this._running && generation === this._generation) {
      const video = this._video;
      const landmarker = this._landmarker;
      if (!video || !landmarker || video.readyState < 2) { await sleep(16); continue; }
      // One inference per delivered camera frame: this loop runs at the
      // display rate, and reprocessing an unchanged frame would double the
      // inference cost for no extra information.
      if (video.currentTime === this._lastVideoTime) {
        await new Promise((r) => requestAnimationFrame(r));
        continue;
      }
      this._lastVideoTime = video.currentTime;
      const now = performance.now();
      let result = null;
      try {
        result = landmarker.detectForVideo(video, now);
      } catch (e) {
        // A GPU delegate can also fail after creation on real machines
        // (driver reset, lost WebGL context). Rebuild once on the CPU
        // delegate before giving up on webcam mode.
        if (this._delegate === 'GPU' && !cpuRetried) {
          cpuRetried = true;
          try {
            const previous = this._landmarker;
            this._landmarker = null;
            if (previous) { try { previous.close(); } catch (_e2) {} }
            this._landmarker = await this._loadLandmarker({ delegate: 'CPU' });
            this._publish({ delegate: 'CPU' });
            continue;
          } catch (_e2) { /* fall through to the fatal path below */ }
        }
        if (generation !== this._generation) break;
        this._fail(`pose detection failed: ${e}`);
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
      message: snapshot.message || '', frame_count: snapshot.frame_count || 0,
      delegate: snapshot.delegate || null,
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
