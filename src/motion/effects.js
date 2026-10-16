// DOM presentation effects (ported from motion/effects.py): flash, vignette,
// sweep, particles/confetti, pop text, result cards, and the camera shake buffer.
import { MOTION } from './config.js';
import * as ease from './ease.js';

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

export class ShakeBuffer {
  constructor() { this._x = 0; this._y = 0; this._decay = MOTION.camera_shake_decay; }
  trigger(pixels) {
    const m = MOTION.shake_metres_per_px;
    this._x = Math.max(Math.abs(this._x), Math.abs(pixels) * m);
    this._y = this._x;
  }
  update(dt) {
    const f = Math.max(0.0, 1.0 - this._decay * dt);
    this._x *= f; this._y *= f;
    if (Math.abs(this._x) < 1e-5) { this._x = 0; this._y = 0; }
  }
  offset() {
    const t = MOTION.time !== undefined ? MOTION.time : performance.now() / 1000;
    return [
      (Math.sin(t * 47.3) + Math.sin(t * 23.7)) * 0.5 * this._x,
      (Math.cos(t * 41.1) + Math.sin(t * 31.3)) * 0.5 * this._y,
      0.0,
    ];
  }
}

export class FlashFX {
  constructor(parent, motion) {
    this.parent = parent;
    this.motion = motion;
    this._node = null;
    this._active = [];
    this._count = 0;
    this._each = 0.12;
    this._elapsed = 0;
    this._alpha = 0.3;
    this._colors = [[255, 255, 255]];
  }
  _ensure() {
    if (this._node) return;
    this._node = document.createElement('div');
    this._node.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;';
    this.parent.appendChild(this._node);
  }
  trigger(colors = [[255, 255, 255]], count = 2, each = 0.12, alpha = 0.3) {
    if (!MOTION.allowFlash()) return;
    this._ensure();
    this._count = Math.max(1, count);
    this._each = each;
    this._alpha = alpha;
    this._colors = colors;
    this._elapsed = 0;
  }
  reset() { if (this._node) this._node.style.opacity = '0'; this._count = 0; }
  update(dt) {
    if (!this._node || this._count <= 0) return;
    this._elapsed += dt;
    if (this._elapsed >= this._each * this._count) { this._node.style.opacity = '0'; this._count = 0; return; }
    const i = Math.floor(this._elapsed / this._each);
    const t = (this._elapsed - i * this._each) / this._each;
    const rgb = this._colors[i % this._colors.length];
    const env = Math.sin(Math.PI * clamp01(t));
    this._node.style.background = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`;
    this._node.style.opacity = String(this._alpha * env);
  }
}

export class VignetteFX {
  constructor(parent) {
    this._node = document.createElement('div');
    this._node.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;'
      + 'background:radial-gradient(circle at 50% 50%, transparent 40%, rgba(11,8,32,0.7) 100%);';
    parent.appendChild(this._node);
    this._held = 0;
    this._pulse = 0;
  }
  trigger() {
    if (!MOTION.allowFlash()) return;
    this._pulse = 1.0;
  }
  hold(alpha) { this._held = Math.max(this._held, alpha); }
  clear() { this._held = 0; this._pulse = 0; this._node.style.opacity = '0'; }
  update(dt) {
    if (this._pulse > 0) {
      this._pulse = Math.max(0, this._pulse - dt / MOTION.gutter_vignette_time);
      this._node.style.opacity = String(Math.min(1, Math.max(this._held, this._pulse * MOTION.gutter_vignette)));
    } else {
      this._node.style.opacity = String(this._held);
    }
  }
}

export class SweepFX {
  constructor(parent) {
    this._node = document.createElement('div');
    this._node.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;overflow:hidden;';
    parent.appendChild(this._node);
    this._elapsed = 0; this._time = 0.35; this._rgb = [255, 255, 255]; this._alpha = 0.3;
  }
  trigger({ rgb = [190, 240, 255], width = null, height = 0.075, y = 0, time = MOTION.sweep_time, alpha = 0.30 } = {}) {
    if (width === null) width = 0.30 * 1280;
    this._elapsed = 0; this._time = time; this._rgb = rgb;
    this._node.style.opacity = String(alpha);
    this._node.innerHTML = '';
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;left:0;top:${(y * 720 + 360) - height * 360}px;width:${width}px;height:${height * 720}px;`
      + `background:linear-gradient(90deg, transparent, rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9), transparent);`;
    this._node.appendChild(bar);
    this._bar = bar;
  }
  reset() { this._node.style.opacity = '0'; this._node.innerHTML = ''; }
  update(dt) {
    if (!this._bar) return;
    this._elapsed += dt;
    const t = clamp01(this._elapsed / this._time);
    const x = -1280 * 0.3 + (1280 * 1.6) * t;
    this._bar.style.transform = `translateX(${x}px)`;
    if (t >= 1) { this.reset(); }
  }
}

export class ParticlesFX {
  constructor(parent, capacity = 220) {
    this.parent = parent;
    this.particles = [];
    this.capacity = capacity;
  }
  burst(xPx, yPx, count = 20, colors = [[255, 255, 255]], speed = 0.6, angle = Math.PI / 2, gravity = -1.6, life = 0.8) {
    count = MOTION.scaledCount(count);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.capacity) this.particles.shift().node.remove();
      const node = document.createElement('div');
      node.className = 'motion-particle';
      node.style.cssText = 'position:absolute;width:6px;height:6px;border-radius:3px;pointer-events:none;';
      const c = colors[i % colors.length];
      node.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
      const a = angle + (Math.random() - 0.5) * 1.2;
      const sp = speed * (0.4 + Math.random() * 1.2);
      this.parent.appendChild(node);
      this.particles.push({ node, x: xPx, y: yPx, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: life * (0.6 + Math.random() * 0.8), g: gravity });
    }
  }
  clear() { for (const p of this.particles) p.node.remove(); this.particles = []; }
  update(dt) {
    const alive = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) { p.node.remove(); continue; }
      p.vy += p.g * 180 * dt;
      p.x += p.vx * 180 * dt;
      p.y += p.vy * 180 * dt;
      const f = p.life / p.max;
      p.node.style.left = `${p.x}px`;
      p.node.style.top = `${p.y}px`;
      p.node.style.opacity = String(1 - f);
      alive.push(p);
    }
    this.particles = alive;
  }
}

export class PopTextPool {
  constructor(parent, capacity = 5) {
    this.parent = parent;
    this.pool = [];
    for (let i = 0; i < capacity; i++) {
      const node = document.createElement('div');
      node.style.cssText = 'position:absolute;pointer-events:none;font-weight:800;white-space:nowrap;display:none;';
      parent.appendChild(node);
      this.pool.push({ node, text: '', rgb: [255, 214, 130], glow: [96, 226, 255], scale: 1.8, dx: 0, dy: 0, alpha: 1, rotation: 0 });
    }
  }
  acquire() { const p = this.pool.find((x) => x.node.style.display === 'none'); return p || this.pool[0]; }
  hideAll() { for (const p of this.pool) p.node.style.display = 'none'; }
  configure(pop, text, rgb, glow, scale, position) {
    pop.text = text; pop.rgb = rgb; pop.glow = glow; pop.scale = scale;
    pop.baseX = position[0]; pop.baseY = position[1];
  }
  setState(pop, { scale = 1.8, alpha = 1, dx = 0, dy = 0, rotation = 0 }) {
    pop.scale = scale; pop.alpha = alpha; pop.dx = dx; pop.dy = dy; pop.rotation = rotation;
    pop.node.style.display = 'block';
    pop.node.textContent = pop.text;
    pop.node.style.color = `rgb(${pop.rgb[0]},${pop.rgb[1]},${pop.rgb[2]})`;
    pop.node.style.textShadow = `0 0 12px rgba(${pop.glow[0]},${pop.glow[1]},${pop.glow[2]},0.8)`;
    // position: baseX/baseY are UI-space (center-origin); convert to px.
    const xPx = 640 + pop.baseX * 720 + pop.dx * 720;
    const yPx = 360 - pop.baseY * 720 - pop.dy * 720;
    pop.node.style.left = `${xPx}px`;
    pop.node.style.top = `${yPx}px`;
    pop.node.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${rotation}deg)`;
    pop.node.style.opacity = String(Math.max(0, Math.min(1, alpha)));
  }
  hide(pop) { pop.node.style.display = 'none'; }
}

export class ResultCardPool {
  constructor(parent, capacity = 2) {
    this.parent = parent;
    this.pool = [];
    for (let i = 0; i < capacity; i++) {
      const node = document.createElement('div');
      node.style.cssText = 'position:absolute;pointer-events:none;text-align:center;display:none;';
      parent.appendChild(node);
      const main = document.createElement('div');
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:22px;color:#fff;opacity:0.9;';
      node.appendChild(main);
      node.appendChild(sub);
      this.pool.push({ node, main, sub, text: '', rgb: [255, 255, 255], glow: [96, 226, 255], scale: 3, subText: '', dx: 0, dy: 0, alpha: 1, rotation: 0, subAlpha: 0, subDy: 0, ring: 0 });
    }
  }
  acquire() { return this.pool.find((x) => x.node.style.display === 'none') || this.pool[0]; }
  hideAll() { for (const p of this.pool) p.node.style.display = 'none'; }
  hideOthers(card) { for (const p of this.pool) if (p !== card) p.node.style.display = 'none'; }
  hide(card) { card.node.style.display = 'none'; }
  configure(card, text, rgb, glow, scale, position, sub = '') {
    card.text = text; card.rgb = rgb; card.glow = glow; card.scale = scale;
    card.baseX = position[0]; card.baseY = position[1]; card.subText = sub;
  }
  setState(card, { scale = 3, alpha = 1, dx = 0, dy = 0, rotation = 0, ring = 0, subAlpha = 0, subDy = 0 }) {
    card.node.style.display = 'block';
    const xPx = 640 + card.baseX * 720 + dx * 720;
    const yPx = 360 - card.baseY * 720 - dy * 720;
    card.node.style.left = `${xPx}px`;
    card.node.style.top = `${yPx}px`;
    card.node.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${rotation}deg)`;
    card.node.style.opacity = String(Math.max(0, Math.min(1, alpha)));
    card.main.textContent = card.text;
    card.main.style.cssText = `font-size:${Math.round(64 * scale * 0.6)}px;font-weight:900;letter-spacing:1px;`
      + `color:rgb(${card.rgb[0]},${card.rgb[1]},${card.rgb[2]});`
      + `text-shadow:0 0 18px rgba(${card.glow[0]},${card.glow[1]},${card.glow[2]},0.9),0 0 48px rgba(${card.glow[0]},${card.glow[1]},${card.glow[2]},0.5);`;
    if (card.subText) {
      card.sub.textContent = card.subText;
      card.sub.style.display = 'block';
      card.sub.style.transform = `translateY(${subDy * 720}px)`;
      card.sub.style.opacity = String(Math.max(0, Math.min(1, subAlpha)));
    } else card.sub.style.display = 'none';
    if (ring > 0.01) {
      card.node.style.boxShadow = `0 0 ${ring * 60}px rgba(${card.glow[0]},${card.glow[1]},${card.glow[2]},${ring})`;
    } else card.node.style.boxShadow = 'none';
  }
}
