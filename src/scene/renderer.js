import * as THREE from 'three';
// The Three.js scene manager: renderer, scene, camera, and the render loop.
import * as config from '../config.js';

export const REFERENCE_WIDTH = 1280;
export const REFERENCE_HEIGHT = 720;
export const ASPECT = REFERENCE_WIDTH / REFERENCE_HEIGHT;

class SceneManager {
  constructor() {
    // The original (Panda3D/Ursina) writes colours straight to the framebuffer
    // with no gamma conversion. Disabling Three.js colour management reproduces
    // that pipeline exactly, so a colour set from the game's 0-255 config
    // renders as those literal bytes.
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(REFERENCE_WIDTH, REFERENCE_HEIGHT, false);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(new THREE.Color(
      config.WINDOW_BACKGROUND[0] / 255, config.WINDOW_BACKGROUND[1] / 255, config.WINDOW_BACKGROUND[2] / 255));

    this.scene = new THREE.Scene();
    // Camera (horizontal FOV of 60 degrees converted to the vertical FOV Three.js uses).
    const horizontalFov = config.CAMERA_FOV * Math.PI / 180;
    const verticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) / ASPECT);
    this.camera = new THREE.PerspectiveCamera(verticalFov * 180 / Math.PI, ASPECT, 0.05, 200);
    this.camera.fovHorizontal = config.CAMERA_FOV;

    this.clock = new THREE.Clock();
    this._onFrame = null;
    this._running = false;
    this._canvas = this.renderer.domElement;
  }

  setFrameCallback(cb) { this._onFrame = cb; }

  start() {
    if (this._running) return;
    this._running = true;
    let last = performance.now();
    const tick = () => {
      if (!this._running) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this._onFrame) this._onFrame(dt);
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    // Fallback for throttled/hidden tabs, where rAF pauses: a timer keeps the
    // simulation and the UI alive. A visible tab runs on rAF alone.
    this._timer = setInterval(() => {
      if (!this._running || !document.hidden) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      if (dt < 1 / 120) return;
      last = now;
      if (this._onFrame) this._onFrame(dt);
      try { this.renderer.render(this.scene, this.camera); } catch (_e) {}
    }, 1000 / 60);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._timer) clearInterval(this._timer);
  }
}

export const manager = new SceneManager();
export const scene = manager.scene;
export const camera = manager.camera;
export const renderer = manager.renderer;

// The game's world is right-handed with +z down-lane and +x to the bowler's
// right, and the camera looks towards +z. Three.js then shows world +x on the
// left, which mirrors the original Panda3D view; negating the projection's
// x-scale restores it. Every material is double-sided so the mirrored winding
// still renders.
export function applyViewMirror() {
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[0] *= -1;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
applyViewMirror();
