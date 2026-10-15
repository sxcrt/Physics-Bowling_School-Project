import * as THREE from 'three';
// An original, procedurally built bowling character (ported from avatar/character.py).
import * as config from '../config.js';
import { scene } from './renderer.js';
import { contactMaterial, softLightingMaterial, unlitMaterial } from './shader.js';
import { discGeometry, lowPolySphereGeometry, taperedBoxGeometry } from './geometry.js';
import { ballTexture, contactTexture } from './textures.js';
import { enableShadows } from './shadow.js';

export const IDLE = 'idle';
export const READY = 'ready';
export const BACKSWING = 'backswing';
export const FORWARD = 'forward';
export const RELEASE = 'release';
export const FOLLOW = 'follow';
export const WAIT = 'wait';
export const CELEBRATE = 'celebrate';
export const DISAPPOINTED = 'disappointed';
export const VICTORY = 'victory';
export const DEFEAT = 'defeat';
export const ALL_STATES = [IDLE, READY, BACKSWING, FORWARD, RELEASE, FOLLOW, WAIT, CELEBRATE, DISAPPOINTED, VICTORY, DEFEAT];

const EASE = 9.0;
const MAX_BLEND_STEP = 0.05;
const SHADOW_ALPHA = 0.45;

function col(rgb) { return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); }
function mix(a, b, t) { return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t); }

const REST = {
  hips_y: 0.0, hips_rx: 0.0, torso_rx: 0.0, torso_rz: 0.0, head_rx: 0.0, head_y: 0.0,
  l_arm_rx: 0.14, l_arm_rz: -0.06, r_arm_rx: 0.14, r_arm_rz: 0.06,
  l_elbow_rx: 0.18, r_elbow_rx: 0.18, l_leg_rx: 0.0, r_leg_rx: 0.0,
  ball_x: 0.30, ball_y: 0.24, ball_z: 0.26,
};

const POSES = {
  [IDLE]: { l_arm_rx: 0.10, r_arm_rx: 0.10 },
  [WAIT]: { torso_rx: 0.05, l_arm_rx: 0.20, r_arm_rx: 0.20, ball_x: 0.30, ball_y: 0.20 },
  [READY]: { hips_y: -0.02, torso_rx: 0.10, r_arm_rx: 0.55, r_elbow_rx: 0.35, l_arm_rx: 0.12, ball_x: 0.30, ball_y: 0.22 },
  [BACKSWING]: { hips_y: -0.03, hips_rx: 0.12, torso_rx: 0.22, head_rx: 0.10, r_arm_rx: 1.95, r_arm_rz: 0.16, r_elbow_rx: 0.06, l_arm_rx: -0.16, ball_x: 0.26, ball_y: 0.05, ball_z: -0.10 },
  [FORWARD]: { hips_y: -0.01, hips_rx: -0.10, torso_rx: -0.16, head_rx: -0.06, r_arm_rx: -0.55, r_arm_rz: -0.05, r_elbow_rx: -0.22, l_arm_rx: 0.26, ball_x: 0.24, ball_y: 0.26, ball_z: 0.34 },
  [RELEASE]: { hips_y: -0.02, hips_rx: -0.18, torso_rx: -0.26, head_rx: -0.10, r_arm_rx: -1.15, r_arm_rz: -0.10, r_elbow_rx: -0.30, l_arm_rx: 0.40, ball_x: 0.22, ball_y: 0.30, ball_z: 0.46 },
  [FOLLOW]: { hips_y: -0.05, hips_rx: -0.30, torso_rx: -0.42, head_rx: -0.16, r_arm_rx: -1.85, r_arm_rz: -0.16, r_elbow_rx: -0.20, l_arm_rx: 0.62, l_arm_rz: 0.10, l_leg_rx: 0.20, ball_x: 0.10, ball_y: 0.05, ball_z: 0.20 },
  [CELEBRATE]: { hips_y: 0.02, torso_rx: -0.14, l_arm_rx: -2.60, r_arm_rx: -2.60, l_arm_rz: -0.30, r_arm_rz: 0.30, l_elbow_rx: -0.30, r_elbow_rx: -0.30 },
  [VICTORY]: { hips_y: 0.04, torso_rx: -0.20, head_rx: -0.10, l_arm_rx: -2.80, r_arm_rx: -2.80, l_arm_rz: -0.45, r_arm_rz: 0.45, l_elbow_rx: -0.20, r_elbow_rx: -0.20 },
  [DISAPPOINTED]: { hips_y: -0.04, torso_rx: 0.34, head_rx: 0.42, l_arm_rx: 0.34, r_arm_rx: 0.34, l_elbow_rx: 0.30, r_elbow_rx: 0.30 },
  [DEFEAT]: { hips_y: -0.07, torso_rx: 0.52, head_rx: 0.55, l_arm_rx: 0.30, l_arm_rz: 0.20, r_arm_rx: 0.30, r_arm_rz: -0.20 },
};

export function poseFor(state, swing = 0.0, arm = 'right') {
  const values = { ...REST };
  Object.assign(values, POSES[state] || POSES[IDLE]);
  if ([READY, BACKSWING, FORWARD, RELEASE].includes(state) && swing) {
    const key = arm === 'right' ? 'r_arm_rx' : 'l_arm_rx';
    values[key] = values[key] + swing * 2.1;
    values.ball_x = 0.30 + swing * 0.10;
    values.ball_y = values.ball_y - swing * 0.14;
    values.ball_z = values.ball_z + swing * 0.30;
  }
  return values;
}

export class Bowler {
  constructor(rgb = null, position = [0, 0, 0], scale = 1.0, name = 'bowler') {
    this.root = new THREE.Group();
    this.root.position.set(...position);
    this.root.scale.setScalar(scale);
    scene.add(this.root);
    this.name = name;
    this.accent = rgb ? rgb.slice() : [120, 220, 255];
    this.state = IDLE;
    this.swing = 0.0;
    this.throw_arm = 'right';
    this._pose = poseFor(IDLE);
    this._bounce_time = 0.0;
    this._breath_time = 0.0;

    const skin = [238, 196, 168];
    const skinShadow = [206, 162, 134];
    const hair = [44, 34, 52];
    const trouser = [46, 52, 84];
    const trouserDark = [34, 38, 62];
    const shoe = [232, 236, 244];
    const shoeSole = [150, 156, 176];
    const shirtLight = mix(this.accent, [255, 255, 255], 0.30);
    const shirtDark = mix(this.accent, [18, 20, 40], 0.35);
    this.shirt_parts = [];

    const part = (parent, geometry, rgb, pos = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(geometry, softLightingMaterial(null, col(rgb), { shadowStrength: 0.82, ambientBoost: 0.16 }));
      mesh.position.set(...pos);
      enableShadows(mesh, { cast: true, receive: true });
      parent.add(mesh);
      return mesh;
    };

    // legs
    this.hips = new THREE.Group();
    this.hips.position.set(0, 0.66, 0);
    this.root.add(this.hips);
    this.left_leg = part(this.hips, taperedBoxGeometry([0.155, 0.165], [0.135, 0.150], 0.30, 0.022, true), trouser, [-0.115, -0.02, 0]);
    this.right_leg = part(this.hips, taperedBoxGeometry([0.135, 0.150], [0.150, 0.160], 0.30, 0.022, true), trouser, [0.115, -0.02, 0]);
    for (const [side, x] of [['left', -0.115], ['right', 0.115]]) {
      part(this.hips, lowPolySphereGeometry(0.070, 4, 8, [1.0, 0.95, 1.0]), trouser, [x, -0.325, 0]);
    }
    this.left_shin = part(this.hips, taperedBoxGeometry([0.105, 0.115], [0.130, 0.140], 0.30, 0.018, true), trouserDark, [-0.115, -0.325, 0]);
    this.right_shin = part(this.hips, taperedBoxGeometry([0.105, 0.115], [0.130, 0.140], 0.30, 0.018, true), trouserDark, [0.115, -0.325, 0]);
    for (const x of [-0.115, 0.115]) {
      part(this.hips, taperedBoxGeometry([0.150, 0.300], [0.120, 0.230], 0.070, 0.030), shoe, [x, -0.660, 0.030]);
      part(this.hips, taperedBoxGeometry([0.155, 0.305], [0.140, 0.290], 0.022, 0.030), shoeSole, [x, -0.682, 0.030]);
      part(this.hips, taperedBoxGeometry([0.115, 0.075], [0.100, 0.060], 0.075, 0.022), shoeSole, [x, -0.640, -0.070]);
    }

    // pelvis, torso
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.10, 0);
    this.hips.add(this.torso);
    part(this.hips, taperedBoxGeometry([0.300, 0.230], [0.330, 0.245], 0.140, 0.045), trouser, [0, -0.045, 0]);
    part(this.hips, taperedBoxGeometry([0.335, 0.250], [0.335, 0.250], 0.036, 0.045), [58, 44, 40], [0, 0.088, 0]);
    const chest = part(this.torso, taperedBoxGeometry([0.320, 0.225], [0.470, 0.260], 0.440, 0.055), this.accent, [0, 0.000, 0]);
    this.shirt_parts.push(chest);
    for (const x of [-0.200, 0.200]) {
      const cap = part(this.torso, lowPolySphereGeometry(0.072, 4, 8, [1.0, 0.80, 0.95]), this.accent, [x, 0.418, 0]);
      this.shirt_parts.push(cap);
    }
    const placket = part(this.torso, taperedBoxGeometry([0.050, 0.012], [0.060, 0.012], 0.330, 0.008), shirtLight, [0, 0.040, 0.128]);
    this.shirt_parts.push(placket);
    const collar = part(this.torso, taperedBoxGeometry([0.165, 0.150], [0.130, 0.135], 0.055, 0.025), shirtDark, [0, 0.432, 0.006]);
    this.shirt_parts.push(collar);
    const belly = part(this.torso, lowPolySphereGeometry(0.150, 4, 8, [1.15, 0.95, 0.85]), this.accent, [0, 0.050, 0.010]);
    this.shirt_parts.push(belly);
    this.collar = collar;
    this.placket = placket;

    // head
    this.head = new THREE.Group();
    this.head.position.set(0, 0.500, 0);
    this.torso.add(this.head);
    part(this.torso, lowPolySphereGeometry(0.062, 3, 8, [0.9, 1.6, 0.9]), skinShadow, [0, 0.448, 0]);
    part(this.head, lowPolySphereGeometry(0.150, 6, 10, [1.0, 1.10, 1.02]), skin, [0, 0.0, 0]);
    part(this.head, taperedBoxGeometry([0.128, 0.155], [0.250, 0.250], 0.098, 0.035), skin, [0, -0.146, 0.004]);
    part(this.head, lowPolySphereGeometry(0.157, 5, 10, [1.0, 0.96, 1.0]), hair, [0, 0.026, -0.016]);
    part(this.head, taperedBoxGeometry([0.275, 0.060], [0.250, 0.046], 0.058, 0.018), hair, [0, 0.062, 0.098]);
    for (const x of [-0.150, 0.150]) {
      part(this.head, lowPolySphereGeometry(0.036, 3, 6, [0.7, 1.30, 0.9]), skinShadow, [x, -0.018, 0.008]);
    }
    this.eyes = [];
    for (const x of [-0.058, 0.058]) {
      const eye = part(this.head, lowPolySphereGeometry(0.026, 3, 6, [1.0, 1.15, 0.55]), [248, 250, 255], [x, 0.016, 0.130]);
      part(eye, lowPolySphereGeometry(0.014, 3, 6, [1.0, 1.0, 0.6]), [26, 24, 38], [0, 0, 0.019]);
      part(this.head, taperedBoxGeometry([0.062, 0.020], [0.062, 0.020], 0.016, 0.005), hair, [x, 0.070, 0.126]);
      this.eyes.push(eye);
    }
    part(this.head, lowPolySphereGeometry(0.026, 3, 6, [0.75, 1.05, 1.25]), skinShadow, [0, -0.026, 0.148]);
    part(this.head, taperedBoxGeometry([0.076, 0.018], [0.058, 0.018], 0.016, 0.005), [168, 92, 96], [0, -0.096, 0.130]);

    // arms
    this.left_shoulder = new THREE.Group();
    this.left_shoulder.position.set(-0.245, 0.400, 0);
    this.torso.add(this.left_shoulder);
    this.right_shoulder = new THREE.Group();
    this.right_shoulder.position.set(0.245, 0.400, 0);
    this.torso.add(this.right_shoulder);
    for (const shoulder of [this.left_shoulder, this.right_shoulder]) {
      const sleeve = part(shoulder, taperedBoxGeometry([0.118, 0.122], [0.140, 0.145], 0.205, 0.026, true), this.accent, [0, 0.010, 0]);
      this.shirt_parts.push(sleeve);
      part(shoulder, lowPolySphereGeometry(0.056, 3, 8, [1.0, 0.95, 1.0]), skin, [0, -0.200, 0]);
    }
    this.left_elbow = new THREE.Group();
    this.left_elbow.position.set(0, -0.32, 0);
    this.left_shoulder.add(this.left_elbow);
    this.right_elbow = new THREE.Group();
    this.right_elbow.position.set(0, -0.32, 0);
    this.right_shoulder.add(this.right_elbow);
    for (const [side, elbow] of [['left', this.left_elbow], ['right', this.right_elbow]]) {
      // The forearm has to reach back up past the elbow ball into the sleeve:
      // a 0.20 m forearm left a visible gap where the arm appeared to float.
      part(elbow, taperedBoxGeometry([0.082, 0.086], [0.098, 0.102], 0.30, 0.018, true), skin, [0, 0.012, 0]);
      const hand = part(elbow, lowPolySphereGeometry(0.058, 4, 8, [0.85, 1.15, 0.95]), skin, [0, -0.300, 0.004]);
      part(hand, taperedBoxGeometry([0.032, 0.046], [0.026, 0.040], 0.050, 0.010, true), skin,
        [side === 'right' ? 0.042 : -0.042, 0.018, 0.008]);
    }

    // ball
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(config.BALL_DIAMETER / 2, 32, 24),
      softLightingMaterial(ballTexture(), 0xffffff, { specular: 0.34, specularPower: 42.0 }));
    enableShadows(this.ball, { cast: true, receive: true });
    this.ball.position.set(0.30, 0.24, 0.26);
    this.ball.visible = false;
    this.root.add(this.ball);

    // shadow
    this.shadow = new THREE.Mesh(discGeometry(0.42, 24),
      contactMaterial(contactTexture(128, 0.30, 2.0), SHADOW_ALPHA));
    // discGeometry already lies flat in the XZ plane (normal +Y); rotating it
    // again would stand the decal on edge and make it invisible.
    this.shadow.position.set(0, 0.004, 0);
    this.shadow.scale.set(1.9, 1.0, 1.35);
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);

    this._applyPose(this._pose);
  }

  get visible() { return this.root.visible; }
  set visible(v) { this.root.visible = v; }
  get enabled() { return this.root.visible; }
  set enabled(v) { this.root.visible = v; }
  set rotation_y(v) { this.root.rotation.y = v * Math.PI / 180; }
  get rotation_y() { return this.root.rotation.y * 180 / Math.PI; }
  set position(v) { this.root.position.set(...v); }

  setState(state) { if (state !== this.state) this.state = state; }
  setSwing(value) { this.swing = Math.max(-1.0, Math.min(1.0, Number(value))); }
  setThrowArm(arm) { if (arm === 'left' || arm === 'right') this.throw_arm = arm; }
  setBallVisible(visible) { this.ball.visible = !!visible; }

  setColors(rgb) {
    this.accent = rgb.slice();
    for (const part of this.shirt_parts) part.material.uniforms.color.value = col(this.accent);
    if (this.collar) this.collar.material.uniforms.color.value = col(mix(this.accent, [18, 20, 40], 0.35));
    if (this.placket) this.placket.material.uniforms.color.value = col(mix(this.accent, [255, 255, 255], 0.30));
  }

  update(dt) {
    dt = Math.min(MAX_BLEND_STEP, Math.max(0.0, dt || 1 / 60));
    if ([CELEBRATE, VICTORY].includes(this.state)) this._bounce_time += dt * 3.2;
    let breath;
    if ([IDLE, READY, WAIT].includes(this.state)) {
      this._breath_time += dt * 1.15;
      breath = Math.sin(this._breath_time);
    } else { this._breath_time += dt * 1.15; breath = 0.0; }
    const target = poseFor(this.state, this.swing, this.throw_arm);
    const blend = Math.min(1.0, EASE * dt);
    for (const key of Object.keys(target)) {
      const current = this._pose[key] !== undefined ? this._pose[key] : target[key];
      this._pose[key] = current + (target[key] - current) * blend;
    }
    if ([CELEBRATE, VICTORY].includes(this.state)) {
      this._pose.hips_y = (this._pose.hips_y || 0.0) + 0.035 * Math.abs(Math.sin(this._bounce_time));
    }
    if (breath) {
      this._pose.hips_y = (this._pose.hips_y || 0.0) + 0.006 * breath;
      this._pose.torso_rx = (this._pose.torso_rx || 0.0) + 0.012 * breath;
      this._pose.head_rx = (this._pose.head_rx || 0.0) - 0.008 * breath;
    }
    this._applyPose(this._pose);
  }

  _applyPose(pose) {
    this.hips.position.set(0.0, 0.66 + pose.hips_y, 0.0);
    this.hips.rotation.x = pose.hips_rx;
    this.torso.rotation.x = pose.torso_rx;
    this.torso.rotation.z = pose.torso_rz;
    this.head.rotation.x = pose.head_rx;
    this.head.position.set(0.0, 0.50 + pose.head_y, 0.0);
    this.left_shoulder.rotation.x = pose.l_arm_rx;
    this.left_shoulder.rotation.z = pose.l_arm_rz;
    this.right_shoulder.rotation.x = pose.r_arm_rx;
    this.right_shoulder.rotation.z = pose.r_arm_rz;
    this.left_elbow.rotation.x = pose.l_elbow_rx;
    this.right_elbow.rotation.x = pose.r_elbow_rx;
    this.left_leg.rotation.x = pose.l_leg_rx;
    this.right_leg.rotation.x = pose.r_leg_rx;
    this.ball.position.set(pose.ball_x, pose.ball_y, pose.ball_z);
  }

  place(x, z, rotationY = 0.0) {
    this.root.position.set(x, 0.0, z);
    this.root.rotation.y = rotationY * Math.PI / 180;
  }
}
