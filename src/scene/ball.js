import * as THREE from 'three';
// The visual bowling ball (ported from scene/ball.py).
import * as config from '../config.js';
import { BallPhysics } from '../physics.js';
import { scene } from './renderer.js';
import { contactMaterial, surfaceMaterial } from './shader.js';
import { discGeometry } from './geometry.js';
import { ballTexture, contactTexture } from './textures.js';
import { enableShadows } from './shadow.js';

// The tight AO blob that sits directly under the ball. It is separate from the
// cast shadow the shadow map produces: at a 45-ish degree key angle a sphere's
// mapped shadow starts a centimetre or two away from its contact point, and this
// is what closes that gap.
const CONTACT_RADIUS = config.BALL_RADIUS * 2.6;
const CONTACT_ALPHA = 0.62;

export class Ball {
  constructor() {
    const geometry = new THREE.SphereGeometry(config.BALL_RADIUS, 48, 32);
    this.mesh = new THREE.Mesh(geometry, surfaceMaterial({
      map: ballTexture(), color: 0xffffff, specular: 0.42, specularPower: 42.0,
      shadowStrength: 0.86,
    }));
    this.mesh.position.set(0, config.BALL_RADIUS, config.FOUL_LINE_Z);
    enableShadows(this.mesh, { cast: true, receive: true });
    scene.add(this.mesh);

    this.shadow = new THREE.Mesh(discGeometry(CONTACT_RADIUS, 28),
      contactMaterial(contactTexture(128, 0.46, 2.3), CONTACT_ALPHA));
    // discGeometry already lies flat in the XZ plane (normal +Y); rotating it
    // again would stand the decal on edge and make it invisible.
    this.shadow.position.set(0, 0.0032, config.FOUL_LINE_Z);
    this.shadow.renderOrder = 1;
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
    // The gutter floor sits 0.06 m below the lane surface; dropping the mesh
    // into it is what makes a gutter ball read as a gutter ball.
    const drop = physics.in_gutter ? 0.06 : 0.0;
    this.mesh.position.set(physics.x, config.BALL_RADIUS - drop, physics.z);
    // Orientation matrix -> quaternion (exact, no Euler ambiguity).
    const m = physics.orientation;
    const m4 = new THREE.Matrix4().set(
      m[0][0], m[0][1], m[0][2], 0,
      m[1][0], m[1][1], m[1][2], 0,
      m[2][0], m[2][1], m[2][2], 0,
      0, 0, 0, 1);
    this.mesh.quaternion.setFromRotationMatrix(m4);
    this.shadow.position.set(physics.x, 0.0032, physics.z);
    this.shadow.material.opacity = CONTACT_ALPHA * (physics.in_gutter ? 0.35 : 1.0);
  }

  update() {
    if (this.finished && !this.physics.rolling) return;
    this._sync();
  }
}
