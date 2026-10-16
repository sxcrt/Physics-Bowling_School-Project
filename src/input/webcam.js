// Webcam input: turns tracked body motion into throws (ported from
// input/webcam_input.py), with a MediaPipe Tasks Vision service in place of the
// OpenCV + MediaPipe Python stack.
//
// Tracking pipeline (the browser equivalent of tracking/service.py):
//   * the camera is captured on the main thread (a <video> element is the only
//     portable capture source), one frame is grabbed per *new* camera frame;
//   * pose inference runs in a module worker (src/input/pose_worker.js) so it
//     can never stall the render loop - this is the browser counterpart of the
//     Python service's worker thread;
//   * if workers are unavailable (or the worker fails to start), the identical
//     model runs on the main thread, paced by requestVideoFrameCallback;
//   * every snapshot carries the *frame time* of the capture it came from, so
//     the swing detector differentiates real elapsed time instead of assuming
//     a constant frame rate.
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

const MEDIAPIPE_CDN = config.TRACKING_MEDIAPIPE_CDN;

function clamp(v, low, high) { return Math.max(low, Math.min(high, v)); }

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function modelUrl() {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI : 'http://localhost/';
  return new URL(`assets/models/${config.TRACKING_MODEL_FILENAME}`, base).href;
}

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
    this._delegate = null;                 // 'GPU'/'CPU' + '(worker)' (diagnostics)
    this._lastVideoTime = -1;              // currentTime of the last processed frame
    this._watchdogVideoTime = -1;
    this._startedAt = 0;
    this._progressAt = 0;
    this._watchdog = null;
    this._frameTimeoutMs = numberOr(options.frame_timeout_ms,
      config.TRACKING_FRAME_TIMEOUT * 1000);
    this._stallTimeoutMs = numberOr(options.stall_timeout_ms,
      config.TRACKING_STALL_TIMEOUT * 1000);
    this._engineTimeoutMs = numberOr(options.engine_timeout_ms,
      config.TRACKING_ENGINE_TIMEOUT * 1000);
    // Pose inference runs in a worker when possible (the browser counterpart
    // of tracking/service.py's worker thread); tests and hosts without worker
    // support run the same model on the main thread.
    this._useWorker = options.worker === undefined ? !!config.TRACKING_USE_WORKER : !!options.worker;
    // Module worker: the MediaPipe tasks-vision bundle is an ES module; the
    // worker itself installs the classic-script shim its wasm loader needs.
    this._workerFactory = options.worker_factory
      || ((url) => new Worker(url, { type: 'module' }));
    this._workerUrl = options.worker_url
      || new URL('./pose_worker.js', import.meta.url).href;
    this._worker = null;
    this._workerReady = false;
    this._workerFallbackReason = null;
    this._inflight = 0;
    this._inferTimes = [];
    this._lastGrabbed = -1;
    this._lastFrameAt = 0;
    this._canvas = null;
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
    return {
      facingMode: 'user',
      width: { ideal: config.TRACKING_CAMERA_WIDTH },
      height: { ideal: config.TRACKING_CAMERA_HEIGHT },
    };
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
    this._inferTimes = [];
    this._lastTrackedAt = null;
    this._lastVideoTime = -1;
    this._lastGrabbed = -1;
    this._inflight = 0;
    this._lastFrameAt = performance.now();
    this._workerFallbackReason = null;
    this._publish({
      running: true, error: null, message: 'starting camera...',
      tracked: false, confidence: 0.0, landmarks: {}, fps: 0.0,
      frame_count: 0, lost_frames: 0, last_tracked_at: null, frame: null,
      frame_time: null, infer_ms: 0.0, worker: false, delegate: null,
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
      const engine = await this._startEngine(generation, video);
      if (!engine || generation !== this._generation) {
        if (engine && engine.mode === 'worker' && this._worker) this._terminateWorker();
        if (engine && engine.mode === 'main' && engine.landmarker) {
          try { engine.landmarker.close(); } catch (_e) {}
        }
        releaseLocal();
        return;
      }
      this._publish({ message: 'tracking', delegate: this._delegate, worker: engine.mode === 'worker' });
      this._running = true;
      this._startedAt = performance.now();
      this._progressAt = this._startedAt;
      this._watchdogVideoTime = -1;
      this._lastVideoTime = -1;      // the first delivered frame is processed
      this._lastGrabbed = -1;
      this._armWatchdog(generation);
      // Keep the main-thread landmarker on the service so _cleanup() closes it.
      this._landmarker = engine.mode === 'main' ? engine.landmarker : null;
      if (engine.mode === 'worker') this._feedLoop(generation);
      else this._loopMain(generation, engine.landmarker);
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

  // ---------------------------------------------------------- pose engine
  // Prefers the worker engine; returns { mode, landmarker } for the engine
  // that ended up running, or null when the caller's generation is stale.
  async _startEngine(generation, video) {
    if (this._useWorker) {
      const worker = await this._startWorker(generation);
      if (worker) return { mode: 'worker' };
      if (generation !== this._generation) return null;
      // The worker could not start (no module workers, blocked CDN import, no
      // WebGL in the worker): fall back to the main-thread engine rather than
      // losing webcam mode.
      this._useWorker = false;
    }
    const landmarker = await this._loadLandmarker();
    if (generation !== this._generation) {
      try { landmarker.close(); } catch (_e) {}
      return null;
    }
    return { mode: 'main', landmarker };
  }

  async _startWorker(generation) {
    let worker = null;
    try {
      worker = this._workerFactory(this._workerUrl);
    } catch (error) {
      this._workerFallbackReason = `worker unavailable: ${error}`;
      return null;
    }
    const ready = new Promise((resolve, reject) => {
      let timer = null;
      const settle = (fn, value) => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        fn(value);
      };
      timer = setTimeout(() => settle(reject, new Error(
        `pose worker did not start within ${Math.round(this._engineTimeoutMs / 1000)}s`)), this._engineTimeoutMs);
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === 'ready') {
          this._delegate = `${message.delegate || 'CPU'} (worker)`;
          settle(resolve, true);
        } else if (message.type === 'error' && message.fatal) {
          settle(reject, new Error(message.message || 'pose worker failed'));
        }
        // Results are handled by _onWorkerMessage once the service is running.
      };
      worker.onerror = (event) => {
        const text = (event && (event.message || event.error)) || 'pose worker crashed';
        settle(reject, new Error(String(text)));
      };
    });
    try {
      worker.postMessage({
        type: 'init',
        cdn: MEDIAPIPE_CDN,
        modelUrl: modelUrl(),
        delegate: 'GPU',
        thresholds: {
          minDetection: config.TRACKING_MIN_DETECTION_CONFIDENCE,
          minPresence: config.TRACKING_MIN_PRESENCE_CONFIDENCE,
          minTracking: config.TRACKING_MIN_TRACKING_CONFIDENCE,
        },
      });
      await ready;
    } catch (error) {
      this._workerFallbackReason = `worker engine failed (${error})`;
      try { worker.terminate(); } catch (_e) {}
      return null;
    }
    if (generation !== this._generation) {
      try { worker.terminate(); } catch (_e) {}
      return null;
    }
    this._worker = worker;
    this._workerReady = true;
    worker.onmessage = (event) => this._onWorkerMessage(event, generation);
    worker.onerror = (event) => {
      const detail = event && (event.message || event.error);
      this._workerFailed(`pose worker crashed${detail ? `: ${detail}` : ''}`, generation);
    };
    return worker;
  }

  _terminateWorker() {
    const worker = this._worker;
    this._worker = null;
    this._workerReady = false;
    if (worker) {
      try { worker.postMessage({ type: 'close' }); } catch (_e) {}
      try { worker.terminate(); } catch (_e) {}
    }
  }

  _workerFailed(reason, generation) {
    if (generation !== this._generation) return;
    this._terminateWorker();
    if (!this._running) return;
    // A worker that dies mid-session: fall back to the main-thread engine
    // instead of dropping to mouse-only, exactly like a GPU-delegate failure.
    this._useWorker = false;
    this._workerFallbackReason = reason;
    this._inflight = 0;
    this._running = false;
    this._startMainAfterWorkerFailure(generation, reason);
  }

  async _startMainAfterWorkerFailure(generation, reason) {
    try {
      const landmarker = await this._loadLandmarker();
      if (generation !== this._generation) { try { landmarker.close(); } catch (_e) {} return; }
      this._landmarker = landmarker;
      this._running = true;
      this._publish({ delegate: this._delegate, worker: false, message: 'tracking (main thread fallback)' });
      this._loopMain(generation, landmarker);
    } catch (error) {
      if (generation !== this._generation) return;
      this._fail(`pose worker stopped and the main-thread fallback failed: ${reason}; ${error}`);
    }
  }

  _onWorkerMessage(event, generation) {
    if (generation !== this._generation) return;
    const message = event.data || {};
    if (message.type === 'result') {
      this._inflight = Math.max(0, this._inflight - 1);
      this._publishResult(message.landmarks, message.timestamp / 1000.0,
        this._video, message.inferMs || 0);
      return;
    }
    if (message.type === 'error' && !message.fatal) {
      // One failed frame must not kill the session; keep the last snapshot and
      // let the watchdog catch a camera that really stopped delivering.
      this._inflight = Math.max(0, this._inflight - 1);
      this._publish({ message: 'pose detection error; retrying' });
    }
  }

  // Creates and returns a pose landmarker on the main thread. The GPU delegate
  // is preferred, but many real machines fail to create it (no WebGL2, driver
  // quirks); in that case the CPU delegate runs the exact same model, just
  // slower, instead of disabling webcam mode outright.
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
    this._terminateWorker();
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
    this._lastGrabbed = -1;
    this._watchdogVideoTime = -1;
    this._inflight = 0;
    this._canvas = null;
  }

  async stop() {
    this._generation += 1;      // a start still in flight must not resurrect
    this._starting = false;
    this._running = false;
    this._cleanup();
    this._publish({ running: false, message: 'stopped', frame: null, frame_time: null });
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

  // ------------------------------------------------------------- frame feed
  // Waits for the next presented camera frame (or a timeout). A polling wait
  // is used on purpose: ``requestVideoFrameCallback`` only fires for videos the
  // compositor is presenting, and the service's capture element is deliberately
  // off-DOM, so a callback wait would never resume. The poll is a few timer
  // wake-ups per frame (250/s while the camera is live, backed off to ~80/s
  // when it stalls) which is negligible next to one pose inference per frame.
  _waitForFrame(timeoutMs) {
    const stale = performance.now() - this._lastFrameAt;
    const wait = stale > 250 ? 12 : 4;
    return sleep(Math.min(wait, timeoutMs || wait));
  }

  // One frame of the camera as a transferable bitmap, bounded to the capture
  // resolution the Python service used (640x480) so inference cost is stable
  // even when a camera ignores the requested size.
  async _grabFrame(video) {
    const maxWidth = config.TRACKING_CAMERA_WIDTH;
    const vw = video.videoWidth || maxWidth;
    const vh = video.videoHeight || config.TRACKING_CAMERA_HEIGHT;
    const options = vw > maxWidth
      ? { resizeWidth: maxWidth, resizeHeight: Math.max(1, Math.round(maxWidth * vh / vw)), resizeQuality: 'low' }
      : undefined;
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(video, options); } catch (_e) { /* canvas fallback below */ }
    }
    const canvas = this._grabCanvas(vw, vh);
    if (!canvas) return null;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    if (typeof canvas.transferToImageBitmap === 'function') return canvas.transferToImageBitmap();
    return canvas;
  }

  _grabCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
      if (!this._canvas || this._canvas.width !== width || this._canvas.height !== height) {
        this._canvas = new OffscreenCanvas(width, height);
      }
      return this._canvas;
    }
    if (typeof document === 'undefined') return null;
    if (!this._canvas || this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = width;
      this._canvas.height = height;
    }
    return this._canvas;
  }

  // Worker engine: capture and post one frame at a time. When inference is
  // slower than the camera, intermediate frames are dropped (the freshest
  // frame is what the detector differentiates), exactly like the Python
  // capture loop, which cannot read a new frame while the tracker is busy.
  async _feedLoop(generation) {
    const video = this._video;
    while (this._running && generation === this._generation && this._worker) {
      if (!video || video.readyState < 2) { await sleep(16); continue; }
      if (this._inflight > 0) { await this._waitForFrame(60); continue; }
      if (video.currentTime === this._lastGrabbed) { await this._waitForFrame(60); continue; }
      this._lastGrabbed = video.currentTime;
      this._lastFrameAt = performance.now();
      let bitmap = null;
      try { bitmap = await this._grabFrame(video); } catch (_e) { bitmap = null; }
      if (generation !== this._generation) {
        if (bitmap && typeof bitmap.close === 'function') { try { bitmap.close(); } catch (_e2) {} }
        break;
      }
      if (!bitmap) { await sleep(16); continue; }
      const captured = performance.now();
      try {
        this._inflight += 1;
        this._worker.postMessage({ type: 'frame', bitmap, timestamp: captured }, [bitmap]);
      } catch (error) {
        this._inflight = Math.max(0, this._inflight - 1);
        this._workerFailed(`pose worker stopped accepting frames (${error})`, generation);
        break;
      }
    }
  }

  // Main-thread engine (fallback): the same one-inference-per-frame pacing as
  // the worker path, but the model runs inline. Kept identical in behaviour so
  // the swing detector cannot tell which engine produced a frame.
  async _loopMain(generation, landmarker) {
    let cpuRetried = false;
    while (this._running && generation === this._generation) {
      const video = this._video;
      if (!video || !landmarker || video.readyState < 2) { await sleep(16); continue; }
      if (video.currentTime === this._lastVideoTime) { await this._waitForFrame(60); continue; }
      this._lastVideoTime = video.currentTime;
      this._lastFrameAt = performance.now();
      const captured = performance.now();
      const started = captured;
      let result = null;
      try {
        result = landmarker.detectForVideo(video, captured);
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
            landmarker = await this._loadLandmarker({ delegate: 'CPU' });
            this._landmarker = landmarker;
            this._publish({ delegate: 'CPU' });
            continue;
          } catch (_e2) { /* fall through to the fatal path below */ }
        }
        if (generation !== this._generation) break;
        this._fail(`pose detection failed: ${e}`);
        break;
      }
      const inferMs = performance.now() - started;
      let landmarks = null;
      if (result && result.landmarks && result.landmarks.length) {
        landmarks = result.landmarks[0];
      }
      this._publishResult(landmarks, captured / 1000.0, video, inferMs);
      await this._waitForFrame(60);
    }
  }

  // Shared snapshot assembly for both engines: identical confidence rules to
  // tracking/pose.py's evaluate_pose (the mean visibility of the ten key
  // joints; a missing joint counts as zero).
  _publishResult(landmarksArray, frameTimeSeconds, video, inferMs) {
    const landmarks = {};
    let tracked = false;
    let confidence = 0.0;
    if (landmarksArray && landmarksArray.length) {
      const count = Math.min(landmarksArray.length, LANDMARK_NAMES.length);
      for (let i = 0; i < count; i += 1) {
        const lm = landmarksArray[i];
        if (!lm) continue;
        landmarks[LANDMARK_NAMES[i]] = {
          x: lm.x, y: lm.y, z: lm.z,
          visibility: lm.visibility === undefined || lm.visibility === null ? 0 : lm.visibility,
        };
      }
      let total = 0;
      let visible = 0;
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
    this._frameCount += 1;
    this._fpsTimes.push(frameTimeSeconds);
    if (this._fpsTimes.length > 30) this._fpsTimes.shift();
    const span = this._fpsTimes.length > 1
      ? this._fpsTimes[this._fpsTimes.length - 1] - this._fpsTimes[0] : 0.0;
    const fps = span > 0 ? (this._fpsTimes.length - 1) / span : 0.0;
    this._inferTimes.push(inferMs);
    if (this._inferTimes.length > 30) this._inferTimes.shift();
    const averageInfer = this._inferTimes.length
      ? this._inferTimes.reduce((a, b) => a + b, 0) / this._inferTimes.length : 0.0;
    if (tracked) { this._lastTrackedAt = frameTimeSeconds; this._lostFrames = 0; }
    else this._lostFrames += 1;
    this._publish({
      tracked, confidence, landmarks: tracked ? landmarks : {},
      fps, frame_count: this._frameCount,
      lost_frames: this._lostFrames,
      last_tracked_at: this._lastTrackedAt,
      message: tracked ? 'tracking' : 'pose lost',
      frame: video || null,
      frame_time: frameTimeSeconds,
      infer_ms: averageInfer,
      worker: this._worker !== null,
      delegate: this._delegate,
      // Diagnostic: why the worker engine was not used (null when it was).
      engine_fallback: this._workerFallbackReason,
    });
  }
}

export class WebcamInput {
  constructor(service = null, detector = null) {
    this._service = service || new TrackingService();
    this._detector = detector || new SwingDetector();
    this._pending = null;
    this._game_ready = false;
    this._last_frame_count = -1;
    this._last_frame_time = null;
    this._last_phase = null;
    this.last_throw = null;
    this.lateral = 0.0;
    this._lateral_smoothed = 0.0;
    this._release_eligible = false;
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
    this._last_frame_time = null;
    this._release_eligible = false;
  }

  async start() {
    this._detector.reset();
    this._pending = null;
    this._last_frame_count = -1;
    this._last_frame_time = null;
    this._last_phase = null;
    this.last_throw = null;
    this._release_eligible = false;
    await this._service.start();
  }

  async stop() {
    await this._service.stop();
    this._detector.reset();
    this._pending = null;
    this._last_frame_time = null;
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
    const data = this._detector.telemetry;
    let telemetry = '';
    if (config.WEBCAM_SHOW_TELEMETRY && data) {
      telemetry = `${data.arm[0].toUpperCase()} arm: ${data.direction} ${Math.abs(data.speed).toFixed(2)}/s   depth ${data.depth.toFixed(2)}   rise ${data.rise.toFixed(2)}`;
    }
    // The swing position the avatar mirrors and the numbers the detector is
    // acting on: enough to tell a real swing from a stuck phase without
    // dumping per-frame data anywhere near normal gameplay.
    const engine = snapshot.delegate ? String(snapshot.delegate) : null;
    return makeWebcamStatus({
      running: snapshot.running || this._service.is_running,
      tracked: snapshot.tracked, confidence: snapshot.confidence, fps: snapshot.fps,
      error: snapshot.error, phase: this._detector.phase,
      phase_label: this._detector.label, hint: this._detector.hint,
      lost_seconds: lostSeconds, telemetry, arm: this.preferred_arm,
      message: snapshot.message || '', frame_count: snapshot.frame_count || 0,
      delegate: engine, worker: !!snapshot.worker,
      infer_ms: Number(snapshot.infer_ms) || 0.0,
      frame_time: snapshot.frame_time === undefined ? null : snapshot.frame_time,
      lost_frames: Number(snapshot.lost_frames) || 0,
      hand: data ? data.hand : 'wrist',
      speed: data ? Number(data.speed) || 0.0 : 0.0,
      direction: data ? data.direction : 'still',
      depth: data ? Number(data.depth) || 0.0 : 0.0,
      rise: data ? Number(data.rise) || 0.0 : 0.0,
      peak_up: data ? Number(data.peak_up) || 0.0 : 0.0,
      swing_pose: this.swing_pose,
      release_eligible: this.releaseEligible,
      reject_reason: this._detector.last_reject_reason || null,
      last_throw: this.last_throw,
      engine_fallback: snapshot.engine_fallback || null,
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

  // The swing's power so far, 0..1, exactly as input/webcam_input.py reports
  // it: the detector's own progress value when it has one, else the hand's
  // height above the shoulders (the mouse drag's equivalent).
  get power() {
    let value = this._detector.release_progress;
    if (value === undefined || value === null) value = Math.max(0.0, this.swing_pose);
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, 0.0, 1.0) : 0.0;
  }

  // True when the forward swing has met every gate a release still needs.
  get releaseEligible() {
    const phase = this._detector.phase;
    return phase === 'forward';
  }

  _processFrame(snapshot) {
    // The detector is stepped with the *camera frame* time delta, not the
    // render frame delta: a snapshot can be a couple of render frames old when
    // the game reads it, and a fallback engine can sample slower than the
    // display. Both would distort the hand's velocity if the render clock were
    // used. The first frame after arming has no interval yet (1/30, exactly
    // like input/webcam_input.py).
    const frameTime = Number(snapshot.frame_time);
    let dt = 1.0 / 30.0;
    if (Number.isFinite(frameTime) && frameTime > 0) {
      if (this._last_frame_time !== null) {
        dt = frameTime - this._last_frame_time;
        if (!Number.isFinite(dt) || dt <= 0.0) dt = 1.0 / 30.0;
      }
      this._last_frame_time = frameTime;
    } else {
      const now = performance.now() / 1000;
      dt = this._last_frame_time === null ? 1.0 / 30.0 : now - this._last_frame_time;
      if (!Number.isFinite(dt) || dt <= 0.0) dt = 1.0 / 30.0;
      this._last_frame_time = now;
    }
    const result = {
      landmarks: snapshot.landmarks, confidence: snapshot.confidence,
      tracked: snapshot.tracked, timestamp: frameTime || performance.now() / 1000,
    };
    const event = this._detector.update(result, dt);
    if (event !== null && this._pending === null) {
      const throwData = eventToThrow(event);
      this._pending = throwData;
      this.last_throw = {
        ...throwData,
        arm: event.arm,
        up_speed: event.up_speed,
        lateral_speed: event.lateral_speed,
        hand_offset: event.hand_offset,
        hand_source: event.hand_source,
        rise: event.rise,
        depth: event.depth,
      };
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
