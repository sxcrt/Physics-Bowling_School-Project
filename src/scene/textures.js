import * as THREE from 'three';
// Procedurally generated textures for the environment (ported from
// scene/textures.py; Pillow drawing becomes Canvas 2D).
import * as config from '../config.js';

const CACHE = new Map();

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return canvas;
}

function shade(rgb, factor) { return rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * factor)))); }
function mix(a, b, t) { return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)); }
function css(rgb, alpha = 1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`; }

function toTexture(canvas, repeat = false) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;   // raw values, matching the original pipeline
  if (repeat) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function woodTexture({ boards = 39, width = 512, height = 2048, base = null,
                              grain = 0.10, sheen = 0.55, seed = 7 } = {}) {
  const key = `wood-${boards}-${width}-${height}-${base}-${grain}-${sheen}-${seed}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const baseRgb = base || config.LANE_COLOR;
  const darkRgb = config.LANE_PLANK_DARK;
  const rng = makeRng(seed);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css(baseRgb);
  ctx.fillRect(0, 0, width, height);
  for (let board = 0; board < boards; board++) {
    const x0 = Math.round(board * width / boards);
    const x1 = Math.round((board + 1) * width / boards);
    let tone = rng() * (0.12 + 0.15) - 0.15;
    const edge = Math.min(board, boards - 1 - board);
    if (edge < 2) tone -= 0.10;
    ctx.fillStyle = css(shade(baseRgb, 1.0 + tone));
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0 - 1), height);
    // grain
    const strokes = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < strokes; s++) {
      const u = x0 + rng() * Math.max(0, (x1 - 1) - x0);
      const drift = rng() * 1.2 - 0.6;
      ctx.strokeStyle = css(shade(baseRgb, 1.0 + tone + (rng() * 2 * grain - grain)));
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let step = 0; step <= height; step += Math.max(1, height / 26)) {
        const x = u + Math.sin(step / height * Math.PI * 3) * 1.2 + drift * step / height;
        const y = step;
        if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // seams
    ctx.strokeStyle = css(mix(baseRgb, darkRgb, 0.6));
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, height); ctx.stroke();
    ctx.strokeStyle = css(mix(baseRgb, darkRgb, 0.28));
    ctx.beginPath(); ctx.moveTo(x0 + 1, 0); ctx.lineTo(x0 + 1, height); ctx.stroke();
  }
  // knots
  for (let k = 0; k < Math.max(0, Math.floor(boards / 12)); k++) {
    const cx = rng() * width, cy = rng() * height, r = 2 + rng() * 3;
    ctx.fillStyle = css(shade(baseRgb, 0.72));
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  // sheen
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let x = 0; x < width; x++) {
    const across = (x + 0.5) / width;
    const middle = Math.exp(-((across - 0.5) ** 2) / (2 * 0.22 ** 2));
    const brightness = 1.0 + sheen * middle;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      data[i] = Math.min(255, data[i] * brightness);
      data[i + 1] = Math.min(255, data[i + 1] * brightness);
      data[i + 2] = Math.min(255, data[i + 2] * brightness);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

export function approachTexture() {
  return woodTexture({ boards: 39, width: 256, height: 1024, base: config.APPROACH_COLOR, grain: 0.12, sheen: 0.18, seed: 11 });
}

export function gradientTexture(topRgb, bottomRgb, width = 8, height = 256) {
  const key = `grad-${topRgb}-${bottomRgb}-${width}-${height}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  for (let row = 0; row < height; row++) {
    const t = row / (height - 1);
    ctx.fillStyle = css(mix(bottomRgb, topRgb, t));
    ctx.fillRect(0, height - 1 - row, width, 1);
  }
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

export function glowTexture(rgb, size = 128, power = 1.8) {
  const key = `glow-${rgb}-${size}-${power}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const steps = Math.floor(size / 2);
  for (let step = steps; step > 0; step--) {
    const alpha = Math.round(255 * (1.0 - step / steps) ** power);
    ctx.fillStyle = css(rgb, alpha / 255);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, step, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

export function ballTexture() {
  const key = 'ball';
  if (CACHE.has(key)) return CACHE.get(key);
  const size = 512;
  const rng = makeRng(3);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css(config.BALL_COLOR);
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < size; row++) {
    const t = row / (size - 1);
    const factor = 0.62 + 1.05 * (1.0 - t) ** 1.7;
    ctx.fillStyle = css(shade(config.BALL_COLOR, factor));
    ctx.fillRect(0, row, size, 1);
  }
  const accent = config.BALL_ACCENT_COLOR;
  for (let i = 0; i < 34; i++) {
    let x = rng() * size, y = rng() * size;
    let angle = rng() * Math.PI * 2;
    const points = [[x, y]];
    for (let j = 0; j < 4 + Math.floor(rng() * 6); j++) {
      angle += rng() * 1.4 - 0.7;
      const len = 30 + rng() * 40;
      x += Math.cos(angle) * len; y += Math.sin(angle) * len;
      points.push([x, y]);
      if (!(x >= -60 && x <= size + 60 && y >= -60 && y <= size + 60)) break;
    }
    if (points.length < 2) continue;
    ctx.strokeStyle = css(shade(accent, 0.75 + rng() * 0.25)); ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
    ctx.stroke();
    ctx.strokeStyle = css(shade(accent, 1.15)); ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = css([238, 252, 255]); ctx.lineWidth = 1;
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    let x = rng() * size, y = rng() * size;
    let angle = rng() * Math.PI * 2;
    const points = [[x, y]];
    for (let j = 0; j < 2 + Math.floor(rng() * 3); j++) {
      angle += rng() * 1.2 - 0.6;
      x += Math.cos(angle) * (14 + rng() * 16);
      y += Math.sin(angle) * (14 + rng() * 16);
      points.push([x, y]);
    }
    ctx.strokeStyle = css([226, 250, 255]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
    for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
    ctx.stroke();
  }
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

export function citySkylineTexture(width = 1024, height = 256, seed = 17) {
  const key = `city-${width}-${height}-${seed}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const rng = makeRng(seed);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // sky
  for (let y = 0; y < height; y++) {
    const t = Math.min(1.0, y / (height - 1) * 1.7);
    ctx.fillStyle = css(mix([10, 12, 44], [72, 46, 124], t));
    ctx.fillRect(0, y, width, 1);
  }
  // stars
  for (let i = 0; i < 120; i++) {
    const x = rng() * width, y = rng() * height * 0.72;
    const side = rng() < 0.75 ? 1 : 2;
    const tone = 170 + Math.floor(rng() * 85);
    ctx.fillStyle = css([tone, tone, 255]);
    ctx.fillRect(x, y, side, side);
  }
  function windows(x0, y0, x1, y1, rgb, chance, cell = 15, gap = 14, pull = 0.5) {
    for (let wy = Math.floor(y0); wy < Math.floor(y1) - cell; wy += cell + gap) {
      for (let wx = Math.floor(x0); wx < Math.floor(x1) - cell; wx += cell + gap) {
        if (rng() < chance) {
          ctx.fillStyle = css(mix(rgb, [14, 12, 36], 0.10 + rng() * (pull - 0.10)));
          ctx.fillRect(wx, wy, cell, cell);
        }
      }
    }
  }
  function tower(x0, x1, top, rgb, winRgb, chance, neon = null) {
    ctx.fillStyle = css(rgb);
    ctx.fillRect(x0, top, x1 - x0, height - top);
    windows(x0 + 9, top + 14, x1 - 7, height - 10, winRgb, chance);
    if (neon) { ctx.fillStyle = css(neon); ctx.fillRect(x0, top, x1 - x0, 3); }
  }
  let x = -40;
  while (x < width) {
    const w = 70 + rng() * 80;
    const top = rng() * (height * 0.30) + height * 0.30;
    tower(x, x + w, top, [32, 27, 74], [118, 94, 182], 0.02);
    x += w + 8 + rng() * 22;
  }
  x = -60;
  while (x < width) {
    const w = 90 + rng() * 90;
    const top = rng() * (height * 0.34) + height * 0.36;
    const neon = rng() < 0.5 ? null : (rng() < 0.5 ? [255, 96, 160] : [96, 226, 255]);
    tower(x, x + w, top, [23, 20, 58], [240, 112, 170], 0.045, neon);
    if (rng() < 0.35) {
      const ax = (2 * x + w) / 2;
      ctx.fillStyle = css([30, 26, 64]); ctx.fillRect(ax - 1, top - 30 - rng() * 46, 2, 30 + rng() * 46);
      ctx.fillStyle = css([255, 70, 96]); ctx.fillRect(ax - 3, top - 9, 6, 7);
    }
    x += w + 14 + rng() * 30;
  }
  // moon
  const mx = width * 0.33, my = height * 0.28, mr = height * 0.125;
  ctx.fillStyle = css([44, 40, 90]);
  ctx.beginPath(); ctx.arc(mx, my, mr * 1.45, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css([218, 220, 252]);
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css([200, 200, 242]);
  ctx.beginPath(); ctx.ellipse(mx - mr * 0.35, my - mr * 0.24, mr * 0.27, mr * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = css([204, 204, 244]);
  ctx.beginPath(); ctx.ellipse(mx + mr * 0.36, my + mr * 0.4, mr * 0.22, mr * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  // skybridge
  const bx0 = width * 0.55, bx1 = width * 0.70, by = height * 0.54;
  ctx.fillStyle = css([30, 26, 72]); ctx.fillRect(bx0, by, bx1 - bx0, 11);
  ctx.fillStyle = css([96, 226, 255]); ctx.fillRect(bx0, by, bx1 - bx0, 2);
  for (let step = 1; step < 14; step++) {
    const t = step / 14;
    const cx = bx0 + (bx1 - bx0) * t;
    const cy = by + 24 + 30 * Math.sin(Math.PI * t);
    ctx.fillStyle = css([118, 106, 188]); ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }
  // front layer
  x = -80;
  while (x < width) {
    const w = 130 + rng() * 130;
    const top = rng() * (height * 0.32) + height * 0.46;
    const neon = rng() < 0.5 ? null : (rng() < 0.5 ? [255, 84, 130] : [96, 226, 255]);
    tower(x, x + w, top, [14, 12, 40], [240, 104, 168], 0.07, neon);
    if (rng() < 0.12) {
      const bw = w * (0.24 + rng() * 0.12);
      const bh = height * (0.12 + rng() * 0.08);
      const bxp = x + rng() * (w * 0.12);
      const byp = top + rng() * (height * 0.10);
      ctx.fillStyle = css(rng() < 0.5 ? [206, 84, 138] : [76, 176, 200]);
      ctx.fillRect(bxp, byp, bw, bh);
    }
    x += w + 24 + rng() * 56;
  }
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

// A neon-lit building facade: dark curtain wall, faint floor bands, and sparse
// glowing windows. The window grid is deliberately calm - this texture tiles
// along the whole alley, so every extra lit rectangle is multiplied by two walls
// and twelve panels and competes with the lane for attention.
export function facadeTexture() {
  const key = 'facade';
  if (CACHE.has(key)) return CACHE.get(key);
  const width = 192, height = 512;
  const baseRgb = [20, 18, 52];
  const litRgbs = [[255, 110, 176], [96, 226, 255]];
  const rng = makeRng(99);   // chosen so the window grid matches the original's density
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = css(baseRgb);
  ctx.fillRect(0, 0, width, height);

  // Floor bands: a two-pixel mullion line every storey reads as architecture
  // rather than noise.
  const storeys = 8;
  const cellH = height / storeys;
  ctx.fillStyle = css([26, 23, 62]);
  for (let row = 1; row < storeys; row++) ctx.fillRect(0, row * cellH, width, 2);

  const cols = 4;
  const cellW = width / cols;
  for (let col = 0; col < cols; col++) {
    if (rng() < 0.32) continue;
    for (let row = 1; row < storeys - 2; row++) {
      if (rng() < 0.62) continue;
      const rgb = litRgbs[Math.floor(rng() * 2)];
      const padX = cellW * 0.28, padY = cellH * 0.30;
      ctx.fillStyle = css(mix(rgb, baseRgb, 0.46 + rng() * 0.34));
      ctx.fillRect(col * cellW + padX, row * cellH + padY, cellW - 2 * padX, cellH - 2 * padY);
    }
  }
  ctx.fillStyle = css([255, 84, 130]);
  ctx.fillRect(0, 0, width - 1, 3);
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

// The vertical pin skin (white body + red neck bands), mapped by the pin's v UV.
export function pinTexture() {
  const key = 'pin';
  if (CACHE.has(key)) return CACHE.get(key);
  const width = 4, rows = 256;
  const canvas = makeCanvas(width, rows);
  const ctx = canvas.getContext('2d');
  const BODY = config.PIN_COLOR;
  const BAND = config.PIN_STRIPE_COLOR;
  const BASE = [206, 205, 210];
  const BANDS = [[0.652, 0.734], [0.760, 0.788]];
  function bandColour(v, edge = 0.006) {
    if (v < 0.012) return BASE;
    for (const [v0, v1] of BANDS) {
      if (v0 <= v && v <= v1) {
        let t = 1.0;
        if (v < v0 + edge) t = (v - v0) / edge;
        else if (v > v1 - edge) t = (v1 - v) / edge;
        return mix(BODY, BAND, Math.max(0, Math.min(1, t)));
      }
    }
    if (v > 0.985) return mix([250, 250, 253], [255, 255, 255], (v - 0.985) / 0.015);
    return BODY;
  }
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);      // v = 1 is the crest
    ctx.fillStyle = css(bandColour(v));
    ctx.fillRect(0, rows - 1 - row, width, 1);
  }
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

// A soft contact/ambient-occlusion blob: a flat dark core that falls off to
// nothing at the rim. Used under the ball, the pins and the bowler so their
// contact with the lane is never a hard edge.
export function contactTexture(size = 128, core = 0.40, power = 2.2) {
  const key = `contact-${size}-${core}-${power}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  const centre = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
      const t = d <= core ? 1.0 : Math.max(0.0, 1.0 - (d - core) / (1.0 - core));
      const i = (y * size + x) * 4;
      data[i] = 5; data[i + 1] = 4; data[i + 2] = 12;
      data[i + 3] = Math.round(Math.pow(t, power) * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}

export function ringTexture(size = 128, inner = 0.11, power = 1.4) {
  const key = `ring-${size}-${inner}-${power}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      const ring = Math.exp(-((d - inner) ** 2) / 0.008) + 0.5 * Math.exp(-((d - inner * 1.4) ** 2) / 0.02);
      const a = Math.max(0, Math.min(1, ring * power));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const tex = toTexture(canvas);
  CACHE.set(key, tex);
  return tex;
}
