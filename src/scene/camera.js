import * as THREE from 'three';
// Camera rig (ported from scene/camera.py): bowler's-eye view plus deck push-in.
import * as config from '../config.js';
import * as ease from '../motion/ease.js';
import { MOTION } from '../motion/config.js';
import { camera, ASPECT, applyViewMirror } from './renderer.js';

let LOOK = null;
let POS = null;
let VIEW = 'game';
let SHAKE = null;
let FOV_TARGET = null;
let FOV_START = null;
let FOV_TIME = null;

function horizontalToVertical(horizontalDeg) {
  const h = horizontalDeg * Math.PI / 180;
  return 2 * Math.atan(Math.tan(h / 2) / ASPECT) * 180 / Math.PI;
}

export function setShakeProvider(provider) { SHAKE = provider; }

export function setFovTarget(fov) {
  const current = camera.fovHorizontal;
  if (fov === null || Math.abs(current - fov) < 0.01) { FOV_TARGET = null; return; }
  FOV_TARGET = Number(fov);
  FOV_START = Number(current);
  FOV_TIME = 0.0;
}

export function fovPushIn() { setFovTarget(MOTION.deck_fov); }
export function fovReset() { setFovTarget(config.CAMERA_FOV); }

function updateFov(dt) {
  if (FOV_TARGET === null) return;
  const duration = Math.max(1e-3, MOTION.deck_fov_time);
  FOV_TIME = Math.min(1.0, (FOV_TIME || 0.0) + dt / duration);
  const fov = ease.lerp(FOV_START, FOV_TARGET, ease.STANDARD(FOV_TIME));
  camera.fovHorizontal = fov;
  camera.fov = horizontalToVertical(fov);
  applyViewMirror();
  if (FOV_TIME >= 1.0) { camera.fovHorizontal = FOV_TARGET; camera.fov = horizontalToVertical(FOV_TARGET); applyViewMirror(); FOV_TARGET = null; }
}

function V3(x, y, z) { return new THREE.Vector3(x, y, z); }

function readyShot() {
  return [V3(0.0, config.CAMERA_HEIGHT, config.FOUL_LINE_Z - config.CAMERA_BEHIND),
          V3(0.0, config.CAMERA_LOOK_HEIGHT, config.FOUL_LINE_Z + config.CAMERA_LOOK_AHEAD)];
}
function rollingShot(ball) {
  const travelled = Math.max(0.0, ball.physics.z - config.FOUL_LINE_Z);
  return [V3(ball.x * config.CAMERA_DOLLY * 0.5,
             config.CAMERA_HEIGHT + travelled * config.CAMERA_DOLLY_HEIGHT,
             config.FOUL_LINE_Z - config.CAMERA_BEHIND + travelled * config.CAMERA_DOLLY),
          V3(ball.x * config.CAMERA_LOOK_SIDE, config.CAMERA_LOOK_HEIGHT,
             config.FOUL_LINE_Z + config.CAMERA_LOOK_AHEAD)];
}
function deckShot() {
  return [V3(0.0, config.CAMERA_DECK_HEIGHT, config.HEAD_PIN_Z - config.CAMERA_DECK_DISTANCE),
          V3(0.0, config.CAMERA_DECK_LOOK_HEIGHT, config.HEAD_PIN_Z + 0.5)];
}

export const FIXED_SHOTS = {
  menu: [V3(0.0, 2.45, config.FOUL_LINE_Z - 7.4), V3(0.0, 1.45, config.FOUL_LINE_Z + 10.0)],
  modes: [V3(0.0, 1.30, config.FOUL_LINE_Z - 3.9), V3(0.0, 0.62, config.FOUL_LINE_Z + 3.2)],
  splash: [V3(-0.8, 2.30, config.FOUL_LINE_Z - 6.2), V3(0.10, 1.45, config.FOUL_LINE_Z + 9.5)],
  lab: [V3(0.0, 3.1, config.FOUL_LINE_Z - 5.2), V3(0.0, 0.30, config.FOUL_LINE_Z + 6.0)],
  deck: [V3(0.0, 1.55, config.HEAD_PIN_Z - 8.2), V3(0.0, 0.45, config.HEAD_PIN_Z)],
};

export function setView(name) { VIEW = name; }
export function currentView() { return VIEW; }

function shot(ball, state) {
  if (VIEW !== 'game' && FIXED_SHOTS[VIEW]) return [FIXED_SHOTS[VIEW], config.CAMERA_DECK_SPEED];
  if (state === 'ready') return [readyShot(), config.CAMERA_FOLLOW_SPEED];
  if (state === 'rolling' && ball.physics.z < config.PIN_CAMERA_TRIGGER_Z) return [rollingShot(ball), config.CAMERA_FOLLOW_SPEED];
  return [deckShot(), config.CAMERA_DECK_SPEED];
}

export function setupCamera() {
  camera.fovHorizontal = config.CAMERA_FOV;
  camera.fov = horizontalToVertical(config.CAMERA_FOV);
  applyViewMirror();
  FOV_TARGET = null;
  const [position, look] = readyShot();
  camera.position.copy(position);
  camera.lookAt(look);
  LOOK = look.clone();
  POS = position.clone();
}

function shakeVector() {
  if (SHAKE === null) return V3(0, 0, 0);
  try { const [x, y, z] = SHAKE(); return V3(x, y, z); }
  catch (_e) { return V3(0, 0, 0); }
}

export function updateCamera(ball, state, dt) {
  const [[targetPosition, targetLook], speed] = shot(ball, state);
  const alpha = Math.min(1.0, dt * speed);
  if (LOOK === null) LOOK = targetLook.clone();
  if (POS === null) POS = camera.position.clone();
  POS.lerp(targetPosition, alpha);
  LOOK.lerp(targetLook, alpha);
  camera.position.copy(POS).add(shakeVector());
  camera.lookAt(LOOK);
  updateFov(dt);
}

export function updateCameraFixed(dt, view = null) {
  const name = view !== null ? view : VIEW;
  if (!FIXED_SHOTS[name]) return;
  const [targetPosition, targetLook] = FIXED_SHOTS[name];
  const alpha = Math.min(1.0, dt * config.CAMERA_DECK_SPEED);
  if (LOOK === null) LOOK = targetLook.clone();
  if (POS === null) POS = camera.position.clone();
  POS.lerp(targetPosition, alpha);
  LOOK.lerp(targetLook, alpha);
  camera.position.copy(POS).add(shakeVector());
  camera.lookAt(LOOK);
  updateFov(dt);
}

export function focusPinDeck(dt) {
  const [position, look] = deckShot();
  const alpha = Math.min(1.0, dt * config.CAMERA_DECK_SPEED);
  camera.position.lerp(position, alpha);
  if (LOOK === null) LOOK = look.clone();
  LOOK.lerp(look, alpha);
  camera.lookAt(LOOK);
}
