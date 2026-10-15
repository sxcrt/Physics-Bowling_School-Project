// Global keyboard state for the game's held-key checks (A/D movement, etc.).
export const heldKeys = new Set();

const NAME_MAP = {
  'ArrowLeft': 'left arrow', 'ArrowRight': 'right arrow', 'ArrowUp': 'up arrow',
  'ArrowDown': 'down arrow', ' ': 'space', 'Enter': 'enter', 'Escape': 'escape',
  'Tab': 'tab', 'Backspace': 'backspace', 'Shift': 'left shift', 'Control': 'left control',
  'F12': 'f12',
};

export function attachKeyboard() {
  window.addEventListener('keydown', (e) => {
    const name = NAME_MAP[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
    heldKeys.add(name);
  });
  window.addEventListener('keyup', (e) => {
    const name = NAME_MAP[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
    heldKeys.delete(name);
  });
  window.addEventListener('blur', () => { heldKeys.clear(); });
}
