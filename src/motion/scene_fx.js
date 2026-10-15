import * as THREE from 'three';
// 3D presentation layer (ported from motion/scene_fx.py): neon, ball trail,
// dust, impact rings, aim guide, rack reset.
import * as config from '../config.js';
import * as ease from './ease.js';
import { MOTION } from './config.js';
import { scene } from '../scene/renderer.js';
import { discGeometry } from '../scene/geometry.js';
import { ringTexture } from '../scene/textures.js';
import * as lane from '../scene/lane.js';

function col(rgb) { return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); }
function scaled(rgb, gain) { return rgb.map((c) => Math.min(255, Math.round(c * gain))); }

export class NeonStrips {
  constructor() {
    this.strips = lane.NEON_STRIPS.map((s) => ({ ...s }));
    this.arrows = lane.LANE_ARROWS.map((m) => ({ mesh: m, base: m.material.color.getHex() }));
    this.clock = 0.0;
    this.spike_level = 0.0;
    this.sequence = [];
    this.sequence_time = 0.0;
  }
  spike(amount = 1.0) {
    if (!MOTION.allowFlash()) return;
    this.spike_level = Math.max(this.spike_level, MOTION.strip_spike * Math.max(0.0, Number(amount)));
  }
  laneFlash(duration = 1.2) {
    if (!MOTION.allowFlash()) return;
    this.sequence_time = 0.0;
    this.sequence = this.strips.slice().sort((a, b) => a.mesh.position.z - b.mesh.position.z);
  }
  update(dt) {
    this.clock += dt;
    if (this.spike_level > 0.0) this.spike_level = Math.max(0.0, this.spike_level - MOTION.strip_spike_decay * dt * MOTION.strip_spike);
    if (this.sequence.length) {
      this.sequence_time += dt;
      if (this.sequence_time > 1.6) this.sequence = [];
    }
    const sequenceIndex = this.sequence.length ? Math.floor(this.sequence_time / 0.10) : -1;
    this.strips.forEach((strip, index) => {
      const mesh = strip.mesh;
      if (!mesh || !mesh.visible) return;
      const phase = index * 0.7;
      let breath;
      if (MOTION.allowPulse()) {
        breath = ease.breathe(this.clock, MOTION.strip_period_min + (index % 3) * 0.5,
          MOTION.strip_floor, MOTION.strip_ceiling, phase);
      } else breath = MOTION.strip_ceiling;
      let gain = breath + this.spike_level;
      if (this.sequence.length && index === Math.min(sequenceIndex, this.strips.length - 1)) gain += 1.6;
      const rgb = scaled(strip.baseRgb, gain);
      mesh.material.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
      mesh.material.opacity = strip.baseAlpha;
    });
    if (MOTION.allowPulse() && this.arrows.length) {
      const pulse = ease.breathe(this.clock, MOTION.guide_arrow_period, 0.0, 1.0);
      for (const arrow of this.arrows) {
        arrow.mesh.material.opacity = (0.65 + MOTION.guide_arrow_pulse * pulse) * 0.96;
      }
    }
  }
}

export class PinGlow {
  constructor() { this.entity = lane.PIN_GLOW; this.clock = 0.0; this.surge = 0.0; this.base = [255, 255, 255]; }
  hit(amount = 1.0) {
    if (!MOTION.allowFlash()) return MOTION.scaledCount(0);
    this.surge = Math.max(this.surge, MOTION.glow_surge * Number(amount));
    return MOTION.scaledCount(MOTION.dust_puff_impact);
  }
  update(dt) {
    if (!this.entity) return;
    this.clock += dt;
    if (this.surge > 0.0) this.surge = Math.max(0.0, this.surge - MOTION.glow_surge_decay * dt * MOTION.glow_surge);
    const depth = MOTION.glow_breathe_depth;
    const breathe = MOTION.allowPulse() ? ease.breathe(this.clock, MOTION.glow_breathe_period, 0.0, 1.0) : 0.5;
    const alpha = 0.55 + depth * (0.5 + 0.5 * breathe) + this.surge;
    this.entity.material.opacity = Math.min(1.0, alpha);
  }
}

export class BallTrail {
  constructor(ball) {
    this.ball = ball;
    this.markers = [];
    for (let i = 0; i < 52; i++) {
      const m = new THREE.Mesh(discGeometry(0.032, 8),
        new THREE.MeshBasicMaterial({ color: 0x96e8ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.markers.push(m);
    }
    this.points = [];
  }
  clear() {
    this.points = [];
    for (const m of this.markers) m.visible = false;
  }
  update(dt, windowVisible) {
    if (!windowVisible) { this.clear(); return; }
    const pos = this.ball.physics.position;
    if (!this.points.length || Math.hypot(pos[0] - this.points[this.points.length - 1][0],
      pos[2] - this.points[this.points.length - 1][1]) >= 0.30) {
      this.points.push([pos[0], pos[2]]);
      if (this.points.length > 52) this.points.shift();
    }
    const count = this.points.length;
    this.markers.forEach((marker, index) => {
      if (index < count) {
        const [x, z] = this.points[index];
        const age = (count - index) / Math.max(1, count);
        const alpha = ease.lerp(MOTION.trail_alpha_min, MOTION.trail_alpha_max, 1.0 - age);
        const scale = MOTION.trail_scale * (0.55 + 0.45 * (1.0 - age));
        marker.position.set(x, 0.006, z);
        marker.scale.setScalar(scale);
        marker.material.opacity = alpha;
        marker.visible = true;
      } else marker.visible = false;
    });
  }
}

export class DustPuffs {
  constructor(capacity = 64) {
    this.pool = [];
    this.active = [];
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.Mesh(discGeometry(0.05, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }
  burst(position, count = null, rgb = [150, 232, 255], speed = 1.1) {
    count = MOTION.scaledCount(count === null ? 6 : count);
    for (let i = 0; i < count; i++) {
      if (!this.pool.length) return;
      const m = this.pool.pop();
      m.visible = true;
      m.position.set(position[0], Math.max(0.02, position[1]), position[2]);
      const angle = Math.random() * Math.PI * 2;
      const magnitude = speed * (0.4 + Math.random() * 0.9);
      m.scale.setScalar(0.5 + Math.random() * 0.9);
      this.active.push([m, Math.cos(angle) * magnitude, (0.3 + Math.random() * 0.6) * magnitude,
        Math.sin(angle) * magnitude, 0.0, MOTION.dust_life * (0.6 + Math.random() * 0.7), rgb.slice()]);
    }
  }
  clear() { for (const p of this.active) { p[0].visible = false; this.pool.push(p[0]); } this.active = []; }
  update(dt) {
    if (!this.active.length) return;
    const alive = [];
    for (const p of this.active) {
      const [m, vx, vy, vz, life, maxLife, rgb] = p;
      let l = life + dt;
      if (l >= maxLife) { m.visible = false; this.pool.push(m); continue; }
      p[4] = l;
      p[2] += -3.4 * dt;
      m.position.x += p[1] * dt;
      m.position.y = Math.max(0.01, m.position.y + p[2] * dt);
      m.position.z += p[3] * dt;
      const f = l / maxLife;
      m.material.opacity = 0.8 * (1.0 - f);
      m.scale.setScalar(0.05 * (0.5 + 0.8 * (1.0 - f)));
      alive.push(p);
    }
    this.active = alive;
  }
}

export class ImpactRings {
  constructor(capacity = 4) {
    this.texture = ringTexture(128, 0.11, 1.4);
    this.pool = [];
    this.active = [];
    for (let i = 0; i < capacity; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }
  burst(position, rgb = [255, 226, 150], size = null, time = null) {
    if (!MOTION.allowFlash()) return;
    if (!this.pool.length) return;
    const m = this.pool.pop();
    m.visible = true;
    m.position.set(position[0], Math.max(0.02, position[1]), position[2]);
    m.scale.set(0.2, 0.2, 0.2);
    m.material.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    this.active.push([m, 0.0, time === null ? MOTION.impact_ring_time : time,
      size === null ? MOTION.impact_ring_size : size, rgb.slice()]);
  }
  clear() { for (const item of this.active) { item[0].visible = false; this.pool.push(item[0]); } this.active = []; }
  update(dt) {
    if (!this.active.length) return;
    const alive = [];
    for (const item of this.active) {
      const [m, life, duration, size, rgb] = item;
      let l = life + dt;
      if (l >= duration) { m.visible = false; this.pool.push(m); continue; }
      item[1] = l;
      const fraction = l / Math.max(1e-5, duration);
      const grown = 1.0 - (1.0 - fraction) ** 2.4;
      const scale = size * (0.22 + 0.95 * grown);
      m.scale.set(scale, scale, scale);
      m.material.opacity = 0.75 * (1.0 - fraction) ** 1.3;
      alive.push(item);
    }
    this.active = alive;
  }
}

export class RackResetFX {
  constructor(motion, pins = null) {
    this.motion = motion;
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(config.TOTAL_WIDTH * 0.98, 0.06, 0.10),
      new THREE.MeshBasicMaterial({ color: 0xe23a28, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.bar.position.set(0, 2.4, config.HEAD_PIN_Z);
    this.bar.visible = false;
    scene.add(this.bar);
    this.pins = [];
    this.bind(pins);
    this._tag = 'sweeper';
  }
  bind(rack) {
    if (!rack) { this.pins = []; return; }
    this.pins = rack.pins || rack;
  }
  play(standingOnly = true) {
    let pins = this.pins.filter((p) => standingOnly ? p.physics.standing : true);
    pins = pins.slice().sort((a, b) => b.mesh.position.z - a.mesh.position.z);
    this.motion.cancel('pin_drop');
    this.bar.visible = false;
    for (const pin of pins) {
      pin.fx_offset = MOTION.drop_height;
      pin.fx_scale = 0.85;
      pin.fx_visible = true;
    }
    this._animateSweeper();
    pins.forEach((pin, index) => {
      const delay = MOTION.sweeper_time * 0.55 + MOTION.drop_stagger * index;
      this.motion.tween(MOTION.drop_time, (progress) => {
        pin.fx_offset = MOTION.drop_height * (1.0 - progress);
        pin.fx_scale = ease.lerp(0.85, 1.0, progress);
      }, ease.OVERSHOOT, delay, null, false, false, 'pin_drop', this);
    });
  }
  _animateSweeper() {
    if (MOTION.reduce_motion) return;
    this.bar.visible = true;
    const half = MOTION.sweeper_time * 0.5;
    this.motion.cancel(this._tag);
    this.motion.tween(half, (p) => { this.bar.position.y = ease.lerp(2.4, 0.16, p); this.bar.material.opacity = 0.85 * p; }, ease.STANDARD, 0, null, false, false, this._tag);
    this.motion.tween(half, (p) => { this.bar.position.y = ease.lerp(0.16, 2.4, p); this.bar.material.opacity = 0.85 * (1 - p); }, ease.STANDARD, half, () => { this.bar.visible = false; }, false, false, this._tag);
  }
}

export class AimGuide {
  constructor() {
    this.dashes = [];
    for (let i = 0; i < Math.max(4, MOTION.guide_dash_count); i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 1.0),
        new THREE.MeshBasicMaterial({ color: 0x78e2ff, transparent: true, opacity: MOTION.guide_alpha, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.dashes.push(m);
    }
    this.mark = new THREE.Mesh(discGeometry(0.05, 16),
      new THREE.MeshBasicMaterial({ color: 0x78e2ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.visible = false;
    scene.add(this.mark);
    this.visible = false;
    this.flow = 0.0;
    this.fade = 1.0;
  }
  placeMark(x, z) { this.mark.position.set(x, 0.005, z); }
  _hide() {
    this.visible = false; this.fade = 0.0;
    for (const d of this.dashes) d.visible = false;
    this.mark.visible = false;
  }
  update(dt, active, startX, aimAngle, startZ, endZ) {
    if (active && !this.visible) { this.visible = true; this.fade = 1.0; this.flow = 0.0; }
    if (active) this.fade = 1.0;
    else if (this.visible) {
      this.fade = Math.max(0.0, this.fade - dt / Math.max(1e-4, MOTION.guide_fade_out));
      if (this.fade <= 0.0) { this._hide(); return; }
    }
    if (!this.visible) return;
    this.flow += MOTION.guide_flow_speed * dt;
    const length = Math.max(0.2, endZ - startZ);
    const dashLength = Math.max(0.05, MOTION.guide_dash_length);
    const spacing = dashLength + Math.max(0.02, MOTION.guide_dash_gap);
    const offset = this.flow % spacing;
    const sinA = Math.sin(aimAngle), cosA = Math.cos(aimAngle);
    this.dashes.forEach((dash, index) => {
      const along = index * spacing + offset;
      if (along > length) { dash.visible = false; return; }
      const centre = along + dashLength / 2.0;
      const x = startX + centre * sinA;
      const z = startZ + centre * cosA;
      const fade = (1.0 - (along / length) * 0.35) * this.fade;
      dash.visible = true;
      dash.position.set(x, 0.004, z);
      dash.rotation.set(-Math.PI / 2, 0, aimAngle);
      // The plane's long axis (local +y) maps to world -z once it is laid
      // flat, so the dash length is scaled on local y (scaling z would only
      // touch its zero-thickness normal and leave a 1 m stripe).
      dash.scale.set(1.0, dashLength * (1.0 - (along / length) * 0.2), 1.0);
      dash.material.opacity = MOTION.guide_alpha * fade;
    });
    this.mark.visible = true;
    this.mark.material.opacity = 0.8 * this.fade;
  }
}
