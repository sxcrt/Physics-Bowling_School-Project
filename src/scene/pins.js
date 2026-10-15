import * as THREE from 'three';
// Bowling pins: the ten-pin rack (ported from scene/pins.py).
import * as config from '../config.js';
import { Deck, PinPhysics, rackPositions } from '../physics.js';
import { scene } from './renderer.js';
import { softLightingMaterial } from './shader.js';
import { buildPinGeometry } from './geometry.js';
import { pinTexture } from './textures.js';

export function pinPositions() { return rackPositions(); }

let _sharedGeometry = null;
let _sharedTexture = null;

export class Pin {
  constructor(x, z) {
    if (!_sharedGeometry) _sharedGeometry = buildPinGeometry();
    if (!_sharedTexture) _sharedTexture = pinTexture();
    this.mesh = new THREE.Mesh(_sharedGeometry, softLightingMaterial(_sharedTexture));
    this.base_position = [x, 0.0, z];
    this.physics = new PinPhysics();
    this.physics.setBase(x, z);
    this.fx_offset = 0.0;
    this.fx_scale = 1.0;
    this.fx_visible = true;
    this.mesh.rotation.order = 'XYZ';
    this.mesh.position.set(x, config.PIN_HEIGHT / 2.0, z);
    scene.add(this.mesh);
  }

  reset() {
    this.physics.reset();
    this.physics.setBase(this.base_position[0], this.base_position[2]);
    this.mesh.position.set(this.base_position[0], config.PIN_HEIGHT / 2.0, this.base_position[2]);
    this.mesh.rotation.set(0, 0, 0);
    this.fx_offset = 0.0;
    this.fx_scale = 1.0;
    this.fx_visible = true;
    this.mesh.scale.set(1, 1, 1);
    this.mesh.visible = true;
  }

  update() {
    const physics = this.physics;
    if (physics.hit) {
      const [cx, cy, cz] = physics.center_position;
      this.mesh.position.set(cx, cy, cz);
      const [tipX, tipZ] = physics.tipComponents();
      this.mesh.rotation.set(tipX * 180 / Math.PI, physics.spin * 180 / Math.PI, tipZ * 180 / Math.PI);
    } else if (this.fx_offset || this.fx_scale !== 1.0) {
      this.mesh.position.set(this.base_position[0],
        config.PIN_HEIGHT / 2.0 + this.fx_offset, this.base_position[2]);
      this.mesh.rotation.set(0, 0, 0);
    }
    if (this.fx_scale !== 1.0) this.mesh.scale.set(this.fx_scale, this.fx_scale, this.fx_scale);
    this.mesh.visible = this.fx_visible && !physics.removed;
  }
}

export class PinRack {
  constructor() {
    this.pins = pinPositions().map(([x, z]) => new Pin(x, z));
    this.deck = new Deck(this.pins.map((p) => p.physics));
  }

  reset() {
    const positions = pinPositions();
    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];
      const [x, z] = positions[i];
      pin.base_position = [x, 0.0, z];
      pin.reset();
    }
    this.deck._accumulator = 0.0;
    this.beginRoll();
  }

  setLayout(positions) {
    positions = positions.map(([x, z]) => [Number(x), Number(z)]);
    for (let index = 0; index < this.pins.length; index++) {
      const pin = this.pins[index];
      if (index < positions.length) {
        const [x, z] = positions[index];
        pin.base_position = [x, 0.0, z];
        pin.reset();
      } else {
        pin.fx_offset = 0.0;
        pin.fx_scale = 1.0;
      }
    }
    this.deck.setRack(positions);
    for (let index = 0; index < this.pins.length; index++) {
      if (index >= positions.length) this.pins[index].mesh.visible = false;
    }
    this.deck._accumulator = 0.0;
    this.beginRoll();
  }

  beginRoll() { this.deck.beginRoll(); }

  sweep() {
    for (const pin of this.pins) {
      if (pin.physics.down) { pin.physics.removed = true; pin.mesh.visible = false; }
    }
  }

  restoreSurvivors() {
    for (const pin of this.pins) if (pin.physics.standing) pin.reset();
  }

  knockdownCount() { return this.deck.knockdownCount(); }
  standingCount() { return this.pins.reduce((n, p) => n + (p.physics.standing ? 1 : 0), 0); }
  deckQuiet() { return this.deck.quiet(); }

  // snake_case aliases kept so the ported call sites read like the original.
  restore_survivors() { this.restoreSurvivors(); }
  begin_roll() { this.beginRoll(); }
  set_layout(positions) { this.setLayout(positions); }
  knockdown_count() { return this.knockdownCount(); }
  standing_count() { return this.standingCount(); }
  deck_quiet() { return this.deckQuiet(); }

  advance(ball, dt) {
    this.deck.ball = ball.physics;
    this.deck.advance(dt);
    if (this.deck.ball_done) ball.finished = true;
  }

  settle(dt) { this.deck.settle(dt); }

  update() { for (const pin of this.pins) pin.update(); }
}
