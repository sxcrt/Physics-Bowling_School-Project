// Minimal DOM helpers for building the UI overlay.
import { cssA, mixRgb } from './theme.js';
// Only for the reduced-motion switch: buttons must not animate when the
// player has asked the whole game to stop moving.
import { MOTION } from '../motion/config.js';

export function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function div(className, parent) { return el('div', className, parent); }

// Set `text` on `node`, truncating to at most `maxLines` rendered lines
// (mirrors ui/theme.py TextSprite's ``max_lines``: the text is measured in the
// real layout and an ellipsis marks the cut). maxLines = 0 keeps the full text.
export function fitLines(node, text, maxLines = 0) {
  node.textContent = text;
  if (!maxLines) return;
  const cs = getComputedStyle(node);
  const parsed = parseFloat(cs.lineHeight);
  const lh = Number.isFinite(parsed) ? parsed : parseFloat(cs.fontSize) * 1.3;
  const maxH = Math.ceil(lh * maxLines + 2);
  if (node.offsetHeight <= maxH) return;
  const words = String(text).split(' ');
  let lo = 1;
  let hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    node.textContent = `${words.slice(0, mid).join(' ')}\u2026`;
    if (node.offsetHeight <= maxH) lo = mid; else hi = mid - 1;
  }
  node.textContent = `${words.slice(0, Math.max(1, lo)).join(' ')}\u2026`;
}

export function place(node, x, y) {
  node.style.position = 'absolute';
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  return node;
}

export function centerX(node, cx) { node.style.left = `${cx}px`; node.style.transform = 'translateX(-50%)'; }
export function centerBoth(node, cx, cy) {
  node.style.left = `${cx}px`; node.style.top = `${cy}px`;
  node.style.transform = 'translate(-50%, -50%)';
}

// A text label with neon glow.
export function glowLabel(parent, text, { x = 0, y = 0, px = 17, rgb = [255, 255, 255],
                                        glow = null, glowAlpha = 0.5, bold = true, tracking = 0,
                                        align = 'left', transform = null, classNames = '' } = {}) {
  const node = el('div', `ui-label ${classNames}`, parent, text);
  node.style.position = 'absolute';
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.fontSize = `${px}px`;
  node.style.fontWeight = bold ? 700 : 400;
  node.style.letterSpacing = `${tracking}px`;
  node.style.color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  if (align === 'center') node.style.transform = 'translateX(-50%)';
  else if (align === 'right') node.style.transform = 'translateX(-100%)';
  else if (transform) node.style.transform = transform;
  const g = glow || rgb;
  node.style.textShadow = `0 0 4px rgba(${g[0]},${g[1]},${g[2]},${glowAlpha}), 0 0 16px rgba(${g[0]},${g[1]},${g[2]},${glowAlpha * 0.6})`;
  node.style.whiteSpace = 'pre-wrap';
  node.style.lineHeight = '1.3';
  return node;
}

// A rounded button plate (real click handler via onclick).
//
// Feedback is deliberate and quick: a hover lift, a pressed scale, a brighten,
// and a focus ring for keyboard navigation. Reduced motion (the existing
// settings switch) turns the movement off and keeps the colour feedback.
export function button(parent, label, opts = {}) {
  const {
    x = 0, y = 0, w = 200, h = 56, radius = 12, accent = [62, 201, 232],
    variant = 'secondary', fontPx = 18, tracking = 1, keyHint = '', onClick = null,
  } = opts;
  const node = el('div', `ui-button ui-button-${variant}`, parent);
  node.style.position = 'absolute';
  node.style.left = `${x - w / 2}px`;
  node.style.top = `${y - h / 2}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
  node.style.borderRadius = `${radius}px`;
  node.style.display = 'flex';
  node.style.alignItems = 'center';
  node.style.justifyContent = 'center';
  node.style.cursor = 'pointer';
  node.style.userSelect = 'none';
  node.style.transition = 'transform 0.11s ease, filter 0.11s ease, box-shadow 0.16s ease';
  node.style.willChange = 'transform';
  // The play screen's UI root disables pointer events so the canvas below
  // keeps receiving pointer moves; every real control has to opt back in.
  node.style.pointerEvents = 'auto';
  node.style.fontSize = `${fontPx}px`;
  node.style.fontWeight = 700;
  node.style.letterSpacing = `${tracking}px`;
  const baseShadow = () => {
    if (variant === 'primary') return `0 6px 24px ${cssA(accent, 0.35)}`;
    if (variant === 'ghost') return `inset 0 0 0 1px ${cssA(accent, 0.4)}`;
    return `inset 0 0 0 2px ${cssA(accent, 1)}`;
  };
  if (variant === 'primary') {
    node.style.background = `linear-gradient(180deg, ${cssA(accent, 0.95)}, ${cssA(mixRgb(accent, [20, 10, 40], 0.45), 1)})`;
    node.style.color = '#fff';
    node.style.boxShadow = baseShadow();
    node.textContent = label;
  } else if (variant === 'ghost') {
    node.style.background = cssA([28, 23, 69], 0.85);
    node.style.color = `rgb(${accent[0]},${accent[1]},${accent[2]})`;
    node.style.boxShadow = baseShadow();
    node.textContent = label;
  } else {
    node.style.background = cssA([28, 23, 69], 1);
    node.style.color = '#fff';
    node.style.boxShadow = baseShadow();
    node.textContent = label;
    node.style.textShadow = `0 0 10px ${cssA(accent, 0.5)}`;
  }
  if (keyHint) {
    const cap = el('div', 'ui-keycap', node, keyHint);
    cap.style.marginLeft = '10px';
    cap.style.padding = '1px 7px';
    cap.style.borderRadius = '5px';
    cap.style.background = 'rgba(0,0,0,0.35)';
    cap.style.border = '1px solid rgba(255,255,255,0.3)';
    cap.style.fontSize = '13px';
  }
  const reduceMotion = () => {
    try {
      // Imported lazily so this module stays usable without the motion layer.
      return !!MOTION.reduce_motion;
    } catch (_e) { return false; }
  };
  const rest = () => {
    if (node._selected) return;               // the keyboard focus ring owns the look
    node.style.transform = reduceMotion() ? 'none' : 'translateY(0)';
    node.style.filter = 'none';
    node.style.boxShadow = baseShadow();
  };
  node.addEventListener('pointerenter', () => {
    if (node.enabled === false) return;
    node.style.transform = reduceMotion() ? 'none' : 'translateY(-2px)';
    node.style.filter = 'brightness(1.12)';
    if (!node._selected) node.style.boxShadow = `${baseShadow()}, 0 6px 18px ${cssA(accent, 0.25)}`;
  });
  node.addEventListener('pointerleave', rest);
  node.addEventListener('pointerdown', (e) => {
    if (node.enabled === false) return;
    // Visual only: the click handler below performs the action exactly once.
    node.style.transform = reduceMotion() ? 'none' : 'scale(0.97)';
    node.style.filter = 'brightness(1.2)';
    if (e.pointerId !== undefined && node.setPointerCapture) {
      try { node.setPointerCapture(e.pointerId); } catch (_err) { /* not capturable */ }
    }
  });
  const release = () => {
    if (node._selected) { node.style.transform = 'none'; node.style.filter = 'brightness(1.08)'; return; }
    node.style.transform = reduceMotion() ? 'none' : 'translateY(0)';
    node.style.filter = 'none';
  };
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('lostpointercapture', release);
  window.addEventListener('blur', release);
  if (onClick) node.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  node.onClick = onClick;
  node.enabled = true;
  node.setSelected = (selected) => {
    node._selected = !!selected;
    if (selected) {
      node.style.boxShadow = `0 0 0 2px ${cssA(accent, 0.9)}, 0 0 22px ${cssA(accent, 0.55)}`;
      node.style.filter = 'brightness(1.08)';
    } else {
      node.style.boxShadow = baseShadow();
      node.style.filter = 'none';
    }
  };
  return node;
}

// A rounded panel with a cyan->pink gradient border.
export function panel(parent, { x = 0, y = 0, w = 400, h = 300, radius = 16, alpha = 0.92 } = {}) {
  const node = el('div', 'ui-panel', parent);
  node.style.position = 'absolute';
  node.style.left = `${x - w / 2}px`;
  node.style.top = `${y - h / 2}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
  node.style.borderRadius = `${radius}px`;
  node.style.background = cssA([20, 16,46], alpha);
  node.style.border = '1px solid transparent';
  node.style.borderImage = 'linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1';
  return node;
}
