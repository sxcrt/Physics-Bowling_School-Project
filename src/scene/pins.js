import * as THREE from 'three';
// Bowling pins: the ten-pin rack (ported from scene/pins.py).
import * as config from '../config.js';
import { Deck, PinPhysics, rackPositions } from '../physics.js';
import { scene } from './renderer.js';
import { contactMaterial, softLightingMaterial } from './shader.js';
import { buildPinGeometry, discGeometry } from './geometry.js';
import { contactTexture, pinTexture } from './textures.js';
import { enableShadows } from './shadow.js';

export function pinPositions() { return rackPositions(); }

let _sharedGeometry = null;
let _sharedTexture = null;
let _contactGeometry = null;
let _contactMap = null;

const CONTACT_RADIUS = 0.105;
const CONTACT_ALPHA = 0.58;

export class Pin {
  constructor(x, z) {
    if (!_sharedGeometry) _sharedGeometry = buildPinGeometry();
    if (!_sharedTexture) _sharedTexture = pinTexture();
    if (!_contactMap) _contactMap = contactTexture(64, 0.34, 2.0);
    this.mesh = new THREE.Mesh(_sharedGeometry, softLightingMaterial(_sharedTexture, 0xffffff, {
      shadowStrength: 0.86, ambientBoost: 0.22,
    }));
    enableShadows(this.mesh, { cast: true, receive: true });
    this.base_position = [x, 0.0, z];
    this.physics = new PinPhysics();
    this.physics.setBase(x, z);
    this.fx_offset = 0.0;
    this.fx_scale = 1.0;
    this.fx_visible = true;
    this.mesh.rotation.order = 'XYZ';
    this.mesh.position.set(x, config.PIN_HEIGHT / 2.0, z);
    scene.add(this.mesh);

    if (!_contactGeometry) _contactGeometry = discGeometry(CONTACT_RADIUS, 20);
    this.contact = new THREE.Mesh(_contactGeometry, contactMaterial(_contactMap, CONTACT_ALPHA));
    // discGeometry already lies flat in the XZ plane (normal +Y).
    this.contact.position.set(x, 0.0030, z);
    this.contact.renderOrder = 1;
    scene.add(this.contact);
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
    this.contact.position.set(this.base_position[0], 0.0030, this.base_position[2]);
    this.contact.visible = true;
    this.contact.material.opacity = CONTACT_ALPHA;
  }

  _syncContact() {
    const physics = this.physics;
    const [bx, bz] = physics.base;
    const contact = this.contact;
    contact.position.set(bx, 0.0030, bz);
    // The blob is the pin's footprint while it stands; it fades out as the pin
    // tips over (the shadow map carries the fallen pin from then on).
    const tilt = Math.min(1.0, Math.abs(physics.angle) / (Math.PI / 4));
    const gone = physics.removed || !this.mesh.visible;
    const alpha = CONTACT_ALPHA * (1.0 - tilt) * this.fx_scale;
    contact.visible = !gone && alpha > 0.01;
    contact.material.opacity = Math.max(0.0, alpha);
    contact.scale.setScalar(Math.max(0.4, 1.0 + 0.35 * tilt));
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
    this._syncContact();
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
      if (index >= positions.length) { this.pins[index].mesh.visible = false; this.pins[index].contact.visible = false; }
    }
    this.deck._accumulator = 0.0;
    this.beginRoll();
  }

  beginRoll() { this.deck.beginRoll(); }

  sweep() {
    for (const pin of this.pins) {
      if (pin.physics.down) { pin.physics.removed = true; pin.mesh.visible = false; pin.contact.visible = false; }
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
