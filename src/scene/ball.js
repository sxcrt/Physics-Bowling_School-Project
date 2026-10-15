import * as THREE from 'three';
// The visual bowling ball (ported from scene/ball.py).
import * as config from '../config.js';
import { BallPhysics } from '../physics.js';
import { scene } from './renderer.js';
import { unlitMaterial } from './shader.js';
import { discGeometry } from './geometry.js';
import { ballTexture, glowTexture } from './textures.js';

const SHADOW_TEXTURE_ALPHA = 0.55;
const SHADOW_RADIUS = config.BALL_RADIUS * 3.4;

export class Ball {
  constructor() {
    const geometry = new THREE.SphereGeometry(config.BALL_RADIUS, 48, 32);
    this.mesh = new THREE.Mesh(geometry, unlitMaterial(0xffffff, ballTexture()));
    this.mesh.position.set(0, config.BALL_RADIUS, config.FOUL_LINE_Z);
    scene.add(this.mesh);

    this.shadow = new THREE.Mesh(discGeometry(SHADOW_RADIUS, 24),
      unlitMaterial(0xffffff, glowTexture([6, 4, 10], 64, 1.6), { transparent: true, opacity: SHADOW_TEXTURE_ALPHA }));
    this.shadow.position.set(0, 0.0025, config.FOUL_LINE_Z);
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    this.physics = new BallPhysics();
    this.finished = false;
    this._sync();
  }

  get x() { return this.physics.x; }
  set x(v) { this.physics.x = v; }
  get z() { return this.physics.z; }

  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }

  reset(lateral = 0.0) {
    this.physics.reset();
    this.physics.x = lateral;
    this.mesh.position.set(lateral, config.BALL_RADIUS, config.FOUL_LINE_Z);
    this.mesh.quaternion.identity();
    this.finished = false;
    this.mesh.visible = true;
    this.shadow.visible = true;
    this._sync();
  }

  launch(throwData) {
    this.physics.launch(throwData.speed, throwData.lateral_position,
                        throwData.launch_angle, throwData.spin_omega);
    this.mesh.position.set(throwData.lateral_position, config.BALL_RADIUS, config.FOUL_LINE_Z);
    this.mesh.quaternion.identity();
    this.finished = false;
    this._sync();
  }

  _sync() {
    const physics = this.physics;
    this.mesh.position.set(physics.x, config.BALL_RADIUS, physics.z);
    // Orientation matrix -> quaternion (exact, no Euler ambiguity).
    const m = physics.orientation;
    const m4 = new THREE.Matrix4().set(
      m[0][0], m[0][1], m[0][2], 0,
      m[1][0], m[1][1], m[1][2], 0,
      m[2][0], m[2][1], m[2][2], 0,
      0, 0, 0, 1);
    this.mesh.quaternion.setFromRotationMatrix(m4);
    this.shadow.position.set(physics.x, 0.0025, physics.z);
  }

  update() {
    if (this.finished && !this.physics.rolling) return;
    this._sync();
  }
}
