// Browser Fullscreen API plumbing for the game stage.
//
// The game is a fixed 1280x720 composition scaled as a whole to the viewport
// (see App._fitStage). This module only owns the *fullscreen* part: feature
// detection (including the WebKit-prefixed contract older Safari uses),
// entering/exiting, and change notification. It never requests fullscreen on
// its own - browsers require a user gesture and a game must not re-enter
// fullscreen after the player leaves it - and every failure (denied request,
// unsupported browser, embedded frame without allowfullscreen) is reported to
// the caller as `false` instead of throwing into the game loop.
const element = () => (typeof document !== 'undefined' ? document.documentElement : null);

// Browsers normally settle request/exit promises quickly, but a blocked or
// ignored request can also stay pending forever (no gesture, an embedded
// frame, a permission UI that cannot be shown). Race them with a short
// deadline so the UI always gets an answer; a late fullscreenchange still
// updates the interface.
const SETTLE_TIMEOUT_MS = 1500;
function settled(promise) {
  if (!promise || typeof promise.then !== 'function') return Promise.resolve();
  return Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS)),
  ]);
}

function requestMethod(node) {
  if (!node) return null;
  return node.requestFullscreen || node.webkitRequestFullscreen || null;
}

function exitMethod() {
  if (typeof document === 'undefined') return null;
  return document.exitFullscreen || document.webkitExitFullscreen || null;
}

export function fullscreenElement() {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isFullscreen() { return fullscreenElement() !== null; }

// True only when the browser exposes a usable Fullscreen API *and* the
// document is allowed to use it (false inside some iframes and on old
// browsers). Controls built on this can hide themselves when unsupported.
export function fullscreenAvailable() {
  if (typeof document === 'undefined') return false;
  const enabled = document.fullscreenEnabled === undefined
    ? document.webkitFullscreenEnabled
    : document.fullscreenEnabled;
  return !!enabled && !!requestMethod(element());
}

export async function enterFullscreen() {
  if (isFullscreen()) return true;
  if (!fullscreenAvailable()) return false;
  const request = requestMethod(element());
  if (!request) return false;
  try {
    await settled(request.call(element()));
  } catch (_error) {
    // Fall through: the state check below is the authoritative answer.
  }
  return isFullscreen();
}

export async function exitFullscreen() {
  const leave = exitMethod();
  if (!leave) return false;
  try {
    await settled(leave.call(document));
  } catch (_error) {
    // Fall through: the state check below is the authoritative answer.
  }
  return !isFullscreen();
}

// Enter fullscreen, leave it, or do nothing when unsupported. Resolves to the
// resulting state: true when the document is (or was already) fullscreen.
export async function toggleFullscreen() {
  if (isFullscreen()) {
    await exitFullscreen();
    return isFullscreen();
  }
  await enterFullscreen();
  return isFullscreen();
}

// Subscribe to fullscreen transitions from any source (the browser's Escape
// key, F11, the OS, our own buttons). Returns an unsubscribe function.
export function onFullscreenChange(handler) {
  if (typeof document === 'undefined') return () => {};
  const listener = () => handler(isFullscreen());
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
  return () => {
    document.removeEventListener('fullscreenchange', listener);
    document.removeEventListener('webkitfullscreenchange', listener);
  };
}

// The CSS-pixel size the stage must fit inside. visualViewport is the correct
// box under browser zoom and on mobile (the layout viewport can be larger than
// what the player actually sees); innerWidth/innerHeight is the fallback.
export function viewportSize() {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  const visual = window.visualViewport;
  const width = visual && visual.width ? visual.width : window.innerWidth;
  const height = visual && visual.height ? visual.height : window.innerHeight;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}
