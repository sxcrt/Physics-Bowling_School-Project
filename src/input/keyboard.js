// Global keyboard state for the game's held-key checks (A/D movement, the
// held RIGHT SHIFT scorecard, ...).
export const heldKeys = new Set();

const NAME_MAP = {
  'ArrowLeft': 'left arrow', 'ArrowRight': 'right arrow', 'ArrowUp': 'up arrow',
  'ArrowDown': 'down arrow', ' ': 'space', 'Enter': 'enter', 'Escape': 'escape',
  'Tab': 'tab', 'Backspace': 'backspace', 'Shift': 'left shift', 'Control': 'left control',
  'F12': 'f12',
};

// ``KeyboardEvent.key`` reports plain "Shift" for both shift keys, so the side
// has to come from ``code``. Without this the held-scorecard key could never be
// distinguished from the left shift used while typing.
const CODE_MAP = {
  ShiftRight: 'right shift',
  ShiftLeft: 'left shift',
  ControlRight: 'right control',
  ControlLeft: 'left control',
  AltRight: 'right alt',
  AltLeft: 'left alt',
};

export function keyName(event) {
  if (CODE_MAP[event.code]) return CODE_MAP[event.code];
  if (NAME_MAP[event.key]) return NAME_MAP[event.key];
  return event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
}

export function clearHeldKeys() { heldKeys.clear(); }

export function attachKeyboard() {
  window.addEventListener('keydown', (event) => { heldKeys.add(keyName(event)); });
  window.addEventListener('keyup', (event) => { heldKeys.delete(keyName(event)); });
  // A key held when the window loses focus never reports its keyup, which would
  // leave a held-key overlay (the RIGHT SHIFT scorecard) stuck on screen.
  window.addEventListener('blur', clearHeldKeys);
  window.addEventListener('visibilitychange', () => { if (document.hidden) clearHeldKeys(); });
}
