// The neon icon set, ported from the original's vector icon masks
// (scene/textures.py::_icon). Each icon is drawn as an SVG mask on a 96x96
// canvas with the same coordinates, so the browser and the Python UI show the
// same shapes: pin, question, sigma, people, robot, stopwatch, gear, check and
// the four arrows. They are inlined (no font dependency, no emoji) and tinted
// with `currentColor`, which keeps stroke weight, alignment and proportions
// identical everywhere they appear.
let uid = 0;

const MASKS = new Set(['robot', 'gear']);

function roundRect(x, y, w, h, r) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`;
}

function ellipse(x0, y0, x1, y1, attrs = 'fill="#fff"') {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${attrs}/>`;
}

function line(x0, y0, x1, y1, width) {
  return `<path d="M${x0} ${y0} L${x1} ${y1}" stroke="#fff" stroke-width="${width}" fill="none" stroke-linecap="round"/>`;
}

function polyline(points, width) {
  const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  return `<path d="${d}" stroke="#fff" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function polygon(points) {
  return `<polygon points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="#fff"/>`;
}

// The gear's tooth profile: 8 teeth, alternating outer/inner radius
// (scene/textures.py's `gear` branch).
function gearPoints(centre = 48, outer = 42, inner = 32, teeth = 8) {
  const points = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const base = tooth * (2 * Math.PI / teeth) - Math.PI / 2;
    for (const [radius, offset] of [[outer, -0.20], [outer, 0.20], [inner, 0.30], [inner, 0.70]]) {
      const angle = base + offset * (2 * Math.PI / teeth);
      points.push([
        Math.round((centre + radius * Math.cos(angle)) * 1000) / 1000,
        Math.round((centre + radius * Math.sin(angle)) * 1000) / 1000,
      ]);
    }
  }
  return points;
}

function shapeFor(name) {
  switch (name) {
    case 'pin':
      return ellipse(35, 6, 61, 36) + polygon([[42, 28], [54, 28], [63, 58], [33, 58]])
        + ellipse(25, 48, 71, 84) + ellipse(30, 78, 66, 92);
    case 'question':
      return `<path d="M32 20 A17 17 0 1 1 60 33" stroke="#fff" stroke-width="11" fill="none" stroke-linecap="round"/>`
        + line(60, 40, 48, 58, 11) + ellipse(42, 70, 54, 82);
    case 'sigma':
      return polyline([[66, 14], [30, 14], [52, 48], [30, 82], [66, 82]], 11);
    case 'people2':
      return ellipse(20, 10, 44, 34) + ellipse(52, 10, 76, 34)
        + roundRect(12, 40, 36, 42, 16) + roundRect(48, 40, 36, 42, 16);
    case 'people3':
      return ellipse(12, 22, 32, 42) + ellipse(38, 14, 58, 34) + ellipse(64, 22, 84, 42)
        + roundRect(4, 48, 36, 38, 16) + roundRect(32, 40, 32, 46, 16)
        + roundRect(56, 48, 36, 38, 16);
    case 'robot':
      return `<rect x="44" y="12" width="8" height="14" fill="#fff"/>`
        + ellipse(40, 2, 56, 18)
        + `<rect x="18" y="24" width="60" height="54" rx="14" ry="14" fill="#fff"/>`
        + `<rect x="10" y="44" width="10" height="16" fill="#fff"/>`
        + `<rect x="76" y="44" width="10" height="16" fill="#fff"/>`
        // the face is cut out of the mask
        + `<rect x="32" y="42" width="12" height="14" fill="#000"/>`
        + `<rect x="52" y="42" width="12" height="14" fill="#000"/>`
        + `<rect x="36" y="64" width="24" height="5" fill="#000"/>`;
    case 'stopwatch':
      return roundRect(40, 4, 16, 14, 5) + `<rect x="45" y="16" width="6" height="10" fill="#fff"/>`
        + line(48, 54, 48, 34, 8) + line(48, 54, 63, 61, 8)
        + ellipse(12, 22, 84, 92, 'fill="none" stroke="#fff" stroke-width="9"')
        + ellipse(42, 48, 54, 60);
    case 'gear':
      return polygon(gearPoints()) + ellipse(38, 38, 58, 58, 'fill="#000"');
    case 'check':
      return polyline([[26, 50], [42, 66], [70, 32]], 12);
    case 'lock':
      return `<path d="M30 46 V32 A18 18 0 0 1 66 32 V46" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/>`
        + `<rect x="20" y="44" width="56" height="44" rx="9" ry="9" fill="#fff"/>`
        + `<rect x="44" y="56" width="8" height="20" rx="4" ry="4" fill="#000"/>`;
    case 'unlock':
      return `<path d="M30 46 V30 A18 18 0 0 1 64 25" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/>`
        + `<rect x="20" y="44" width="56" height="44" rx="9" ry="9" fill="#fff"/>`
        + `<rect x="44" y="56" width="8" height="20" rx="4" ry="4" fill="#000"/>`;
    case 'arrow_left':
      return polygon([[58, 16], [24, 48], [58, 80]]) + `<rect x="44" y="42" width="34" height="12" fill="#fff"/>`;
    case 'arrow_right':
      return polygon([[38, 16], [72, 48], [38, 80]]) + `<rect x="18" y="42" width="34" height="12" fill="#fff"/>`;
    case 'arrow_up':
      return polygon([[16, 58], [48, 24], [80, 58]]) + `<rect x="42" y="44" width="12" height="34" fill="#fff"/>`;
    case 'arrow_down':
      return polygon([[16, 38], [48, 72], [80, 38]]) + `<rect x="42" y="18" width="12" height="34" fill="#fff"/>`;
    default:
      return ellipse(14, 14, 82, 82);
  }
}

export const ICON_NAMES = ['pin', 'question', 'sigma', 'people2', 'people3', 'robot',
  'stopwatch', 'gear', 'check', 'lock', 'unlock', 'arrow_left', 'arrow_right', 'arrow_up', 'arrow_down'];

// The markup for one icon; `currentColor` drives the tint. Pure string work,
// so it is testable without a DOM.
export function iconSvg(name, size = 96) {
  const shape = shapeFor(name);
  if (!MASKS.has(name)) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 96 96" aria-hidden="true" focusable="false">${shape}</svg>`;
  }
  uid += 1;
  const maskId = `hells-icon-${name}-${uid}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 96 96" aria-hidden="true" focusable="false">`
    + `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="96">`
    + `<rect x="0" y="0" width="96" height="96" fill="#000"/>${shape}</mask>`
    + `<rect x="0" y="0" width="96" height="96" fill="currentColor" mask="url(#${maskId})"/>`
    + '</svg>';
}

// A <span> wrapper the UI can place like any other element.
export function iconNode(name, { size = 20, color = null, className = 'ui-icon', title = null } = {}) {
  const node = document.createElement('span');
  node.className = className;
  node.style.display = 'inline-flex';
  node.style.alignItems = 'center';
  node.style.justifyContent = 'center';
  node.style.width = `${size}px`;
  node.style.height = `${size}px`;
  node.style.flex = 'none';
  if (color) node.style.color = color;
  if (title) { node.title = title; node.setAttribute('aria-label', title); }
  node.innerHTML = iconSvg(name, size);
  return node;
}
