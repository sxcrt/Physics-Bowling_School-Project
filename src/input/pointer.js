// Pointer tracking for the mouse throw controls (ported from input/pointer.py).
// The browser reports reliable mouse events, so the layered Windows fallback is
// unnecessary; this keeps the same UI-space convention (x in [-aspect/2, aspect/2],
// y in [-0.5, 0.5], y up) the game's input layer expects.
export const REFERENCE_WIDTH = 1280;
export const REFERENCE_HEIGHT = 720;
export const ASPECT = REFERENCE_WIDTH / REFERENCE_HEIGHT;

class Pointer {
  constructor() {
    this.position = [0.0, 0.0];
    this.delta = [0.0, 0.0];
    this.velocity = [0.0, 0.0];
    this.source = 'browser';
    this.available = false;
    this.left = false;
    this._prev = null;
    this._lastTime = null;
    this._override = null;
  }

  setOverride(provider) { this._override = provider; }

  // Map a CSS pixel position (top-left origin, 1280x720 stage) into UI space.
  static fromStage(cssX, cssY) {
    return [(cssX - REFERENCE_WIDTH / 2) / REFERENCE_HEIGHT,
            (REFERENCE_HEIGHT / 2 - cssY) / REFERENCE_HEIGHT];
  }

  sample() {
    const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;
    const dt = this._lastTime !== null ? now - this._lastTime : 0.0;
    this._lastTime = now;

    let position = null;
    if (this._override) {
      try { position = this._override(); } catch (_e) { position = null; }
    }
    if (position !== null) {
      this.available = true;
      this.position = [position[0], position[1]];
    }

    if (this._prev !== null && dt > 1e-6) {
      this.delta = [this.position[0] - this._prev[0], this.position[1] - this._prev[1]];
      this.velocity = [this.delta[0] / dt, this.delta[1] / dt];
    } else {
      this.delta = [0.0, 0.0];
      this.velocity = [0.0, 0.0];
    }
    this._prev = this.position.slice();
    return this.position.slice();
  }

  reset() { this._prev = null; this.velocity = [0, 0]; this.delta = [0, 0]; }
}

export const _INSTANCE = new Pointer();

export function uiPointer() { return _INSTANCE.sample(); }
export function pointerState() { return _INSTANCE; }

// Wire the shared pointer to the stage element.
export function uiFromClient(clientX, clientY, stage) {
  const rect = stage.getBoundingClientRect();
  const scaleX = REFERENCE_WIDTH / rect.width;
  const scaleY = REFERENCE_HEIGHT / rect.height;
  const cssX = (clientX - rect.left) * scaleX;
  const cssY = (clientY - rect.top) * scaleY;
  return Pointer.fromStage(cssX, cssY);
}

// Text selection must stay possible exactly where the player types (name
// fields, the trivia / challenge answer fields); everywhere else a mouse drag
// belongs to the game. Dragging to aim or throw used to sweep across HUD
// labels and select them as if this were a document, so the stage's default
// selection behaviour is switched off at the event level (the CSS in
// index.html is the belt to this pair of braces).
const SELECTABLE = 'input, textarea, select, [contenteditable="true"], .allow-select';

export function isSelectableTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(SELECTABLE);
}

export function attachPointer(stage) {
  const set = (e) => {
    const [x, y] = uiFromClient(e.clientX, e.clientY, stage);
    _INSTANCE.position = [x, y];
    _INSTANCE.available = true;
  };
  const release = () => { _INSTANCE.left = false; };
  window.addEventListener('pointermove', set, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    set(e);
    if (e.button === 0) _INSTANCE.left = true;
  });
  window.addEventListener('pointerup', (e) => { set(e); if (e.button === 0) release(); });
  // A pointer released outside the window, a touch cancelled by the browser,
  // or the window losing focus must all end the drag: otherwise the ball stays
  // "in hand" and the next click throws with a stale speed.
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  // No text selection starts outside a real text field: mousedown is where the
  // browser arms its selection, and selectstart/dragstart cover the paths that
  // do not go through a mousedown the page sees (middle-drag, native drag).
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isSelectableTarget(e.target)) return;
    e.preventDefault();
  });
  window.addEventListener('selectstart', (e) => {
    if (isSelectableTarget(e.target)) return;
    e.preventDefault();
  });
  window.addEventListener('dragstart', (e) => {
    if (isSelectableTarget(e.target)) return;
    e.preventDefault();
  });
}
