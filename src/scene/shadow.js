import * as THREE from 'three';
// The real-time shadow rig.
//
// One directional light exists purely to own a shadow map: its colour output is
// never consumed (the game's surfaces are lit by the analytic key/fill pair in
// scene/shader.js), but three.js renders the scene through its shadow camera and
// every surface shader samples the result. That keeps the original look and adds
// genuine cast shadows for the ball, the pins and the bowler.
//
// The shadow camera follows a focus point so a 2048x2048 map covers the part of
// the lane that is actually being looked at (about 4 mm per texel over the pin
// deck) instead of smearing over the whole 23 m alley.
import * as config from '../config.js';
import { scene } from './renderer.js';

// The shadow direction is the same direction the surface shader shades from, so
// the cast shadow always falls away from the analytic key light.
export const SHADOW_DIRECTION = new THREE.Vector3(-0.25, 0.85, -0.50).normalize();

const MAP_SIZE = 2048;
const LIGHT_DISTANCE = 18.0;

export const DEFAULT_RADIUS = 4.6;
export const DECK_RADIUS = 3.6;
export const MAX_RADIUS = 11.0;

let light = null;
let target = null;
let radius = DEFAULT_RADIUS;

export function installShadowRig() {
  if (light) return light;
  light = new THREE.DirectionalLight(0xffffff, 0.0);
  light.name = 'shadow-light';
  light.castShadow = true;
  light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
  light.shadow.bias = -0.00045;
  light.shadow.normalBias = 0.022;
  light.shadow.radius = 2.4;

  const camera = light.shadow.camera;
  camera.near = 1.0;
  camera.far = LIGHT_DISTANCE * 2.0;
  setRadius(radius);

  target = new THREE.Object3D();
  target.name = 'shadow-target';
  scene.add(target);
  light.target = target;
  scene.add(light);

  setShadowFocus(0.0, config.HEAD_PIN_Z);
  return light;
}

export function setRadius(value) {
  radius = Math.max(1.0, Number(value) || DEFAULT_RADIUS);
  if (!light) return;
  const camera = light.shadow.camera;
  camera.left = -radius;
  camera.right = radius;
  camera.top = radius;
  camera.bottom = -radius;
  camera.updateProjectionMatrix();
}

export function getRadius() { return radius; }

// Move the shadow frustum so it is centred on (x, z) on the lane.
export function setShadowFocus(x, z, focusRadius = null) {
  if (focusRadius !== null && Math.abs(focusRadius - radius) > 1e-3) setRadius(focusRadius);
  if (!light) return;
  const fx = Number(x) || 0.0;
  const fz = Number(z) || 0.0;
  target.position.set(fx, 0.0, fz);
  target.updateMatrixWorld();
  light.position.set(
    fx + SHADOW_DIRECTION.x * LIGHT_DISTANCE,
    SHADOW_DIRECTION.y * LIGHT_DISTANCE,
    fz + SHADOW_DIRECTION.z * LIGHT_DISTANCE,
  );
  light.updateMatrixWorld();
}

// Which objects participate. Anything that should visibly rest on the lane
// casts; the lane and its decals receive.
export function enableShadows(mesh, { cast = false, receive = false } = {}) {
  if (!mesh) return mesh;
  mesh.castShadow = !!cast;
  mesh.receiveShadow = !!receive;
  return mesh;
}

export function shadowsInstalled() { return !!light; }
