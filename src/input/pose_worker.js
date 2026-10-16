// Pose inference worker: the browser equivalent of the Python tracking
// service's background thread (tracking/service.py runs camera capture + pose
// inference off the render thread).
//
// The main thread captures a camera frame as an ImageBitmap and transfers it
// here; this worker owns the MediaPipe PoseLandmarker and runs one inference
// per delivered frame, so pose detection can never stall the game's render
// loop. Results are posted back as a compact 33-landmark array; the service
// (src/input/webcam.js) turns them into the same snapshot shape the Python
// service publishes.
//
// Why this is a *module* worker with an ``importScripts`` shim: the published
// tasks-vision package only ships ES-module/CJS bundles (no classic IIFE), but
// its wasm loader is a classic script that it loads with ``importScripts`` -
// which module workers do not provide. The shim below fetches that classic
// script and evaluates it in the worker's global scope (workers may still use
// synchronous XHR for exactly this purpose), so the same runtime the main
// thread would use loads unchanged here, off the render thread.
//
// Message protocol (main -> worker):
//   { type: 'init', cdn, modelUrl, delegate, thresholds: {...} }
//   { type: 'frame', bitmap, timestamp }        // bitmap is transferred
//   { type: 'close' }
// (worker -> main):
//   { type: 'ready', delegate }
//   { type: 'error', message, fatal }
//   { type: 'result', timestamp, inferMs, landmarks }
//     landmarks: 33 x { x, y, z, visibility } or null when no pose was found.

/* eslint-env worker */
'use strict';

let landmarker = null;
let delegate = 'GPU';
let vision = null;

function installImportScriptsShim() {
  // Always install: a module worker still *defines* importScripts (calling it
  // throws "Module scripts don't support importScripts()"), so the presence
  // check would skip the shim exactly where it is needed.
  self.importScripts = function importScripts(...urls) {
    for (const url of urls) {
      const request = new XMLHttpRequest();
      request.open('GET', url, false);        // sync XHR is allowed in workers
      request.send(null);
      if (request.status !== 200 && request.status !== 0) {
        throw new Error(`importScripts failed for ${url} (HTTP ${request.status})`);
      }
      // Indirect eval runs the classic script in the worker's global scope,
      // exactly where importScripts would have put its declarations.
      (0, eval)(`${request.responseText}\n//# sourceURL=${url}`);
    }
  };
}

function post(message) { self.postMessage(message); }

function buildOptions(modelUrl, thresholds, chosenDelegate) {
  return {
    baseOptions: { modelAssetPath: modelUrl, delegate: chosenDelegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: thresholds.minDetection,
    minPosePresenceConfidence: thresholds.minPresence,
    minTrackingConfidence: thresholds.minTracking,
  };
}

async function init(message) {
  installImportScriptsShim();
  if (vision === null) {
    vision = await import(`${message.cdn}/vision_bundle.mjs`);
  }
  const fileset = await vision.FilesetResolver.forVisionTasks(`${message.cdn}/wasm`);
  const thresholds = message.thresholds || {};
  const preferred = message.delegate || 'GPU';
  try {
    landmarker = await vision.PoseLandmarker.createFromOptions(
      fileset, buildOptions(message.modelUrl, thresholds, preferred));
    delegate = preferred;
  } catch (error) {
    if (preferred === 'CPU') throw error;
    // Same graceful step the main-thread path takes: many machines cannot
    // create the GPU delegate; the CPU delegate runs the identical model.
    landmarker = await vision.PoseLandmarker.createFromOptions(
      fileset, buildOptions(message.modelUrl, thresholds, 'CPU'));
    delegate = 'CPU';
  }
  post({ type: 'ready', delegate });
}

function runFrame(message) {
  const started = Date.now();
  let result = null;
  try {
    result = landmarker.detectForVideo(message.bitmap, message.timestamp);
  } finally {
    if (message.bitmap && typeof message.bitmap.close === 'function') {
      try { message.bitmap.close(); } catch (_e) { /* already closed */ }
    }
  }
  const inferMs = Date.now() - started;
  let landmarks = null;
  if (result && result.landmarks && result.landmarks.length) {
    const pose = result.landmarks[0];
    landmarks = new Array(pose.length);
    for (let i = 0; i < pose.length; i += 1) {
      const lm = pose[i];
      landmarks[i] = {
        x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 0,
      };
    }
  }
  post({ type: 'result', timestamp: message.timestamp, inferMs, landmarks });
}

self.onmessage = async (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'init') {
    try {
      await init(message);
    } catch (error) {
      post({ type: 'error', fatal: true, message: String((error && error.message) || error) });
    }
    return;
  }
  if (message.type === 'frame') {
    if (landmarker === null) return;
    try {
      runFrame(message);
    } catch (error) {
      post({ type: 'error', fatal: false, message: String((error && error.message) || error) });
    }
    return;
  }
  if (message.type === 'close') {
    try { if (landmarker) landmarker.close(); } catch (_e) { /* already closed */ }
    landmarker = null;
    self.close();
  }
};
