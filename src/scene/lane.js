import * as THREE from 'three';
// Build the bowling environment (ported from scene/lane.py): deck, markings,
// gutters, the neon city.
import * as config from '../config.js';
import { scene } from './renderer.js';
import { unlitMaterial } from './shader.js';
import { quadGeometry, triangleGeometry, discGeometry } from './geometry.js';
import {
  approachTexture, citySkylineTexture, facadeTexture, glowTexture,
  gradientTexture, woodTexture,
} from './textures.js';

const ARROW_SPACING = 0.1524;
const ARROW_Z = 4.572;
const ARROW_LENGTH = 0.30;
const ARROW_WIDTH = 0.16;
const DOT_RADIUS = 0.035;
const DOT_Z = -0.95;
const MARKING_COLOR = [34, 22, 20];
const WALL_X = 2.7;

export const NEON_STRIPS = [];
export const LANE_ARROWS = [];
export let PIN_GLOW = null;

function col(rgb) { return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); }
function rgba(rgb, alpha = 1.0) { return { color: col(rgb), alpha: Math.max(0, Math.min(1, alpha)) }; }

function box(w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function unlit(color, alpha = 1.0, map = null) {
  return unlitMaterial(col(color), map, { transparent: alpha < 1.0 || !!map, opacity: alpha });
}

// An unlit neon/glow/decal surface.
function _unlit({ geometry, position, material }) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
}

function _buildDecks() {
  // floor
  _unlit({ geometry: new THREE.PlaneGeometry(24, config.LANE_LENGTH * 2 + 2 * config.APPROACH_LENGTH).rotateX(-Math.PI / 2),
           position: [0, -config.LANE_THICKNESS - 0.02, (config.LANE_LENGTH - config.APPROACH_LENGTH) / 2],
           material: unlit(config.FLOOR_COLOR) });
  // approach
  box(config.TOTAL_WIDTH, config.LANE_THICKNESS, config.APPROACH_LENGTH,
      0, -config.LANE_THICKNESS / 2, -config.APPROACH_LENGTH / 2, unlit(config.APPROACH_COLOR));
  _unlit({ geometry: quadGeometry(config.TOTAL_WIDTH, config.APPROACH_LENGTH),
           position: [0, 0.0015, -config.APPROACH_LENGTH / 2],
           material: unlit([255, 255, 255], 1.0, approachTexture()) });
  // lane
  box(config.LANE_WIDTH, config.LANE_THICKNESS, config.LANE_LENGTH,
      0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH / 2, unlit(config.LANE_COLOR));
  _unlit({ geometry: quadGeometry(config.LANE_WIDTH, config.LANE_LENGTH),
           position: [0, 0.0015, config.LANE_LENGTH / 2],
           material: unlit([255, 255, 255], 1.0, woodTexture()) });
  // pin deck
  box(config.LANE_WIDTH, config.LANE_THICKNESS, config.PIN_DECK_LENGTH,
      0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH + config.PIN_DECK_LENGTH / 2, unlit(config.PIN_DECK_COLOR));
  _unlit({ geometry: quadGeometry(config.LANE_WIDTH, config.PIN_DECK_LENGTH),
           position: [0, 0.0015, config.LANE_LENGTH + config.PIN_DECK_LENGTH / 2],
           material: unlit([255, 255, 255], 1.0, woodTexture({ boards: 39, width: 256, height: 384, base: config.PIN_DECK_COLOR, grain: 0.10, sheen: 0.30, seed: 23 })) });
  // pit apron
  box(config.LANE_WIDTH, config.LANE_THICKNESS, 1.8,
      0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH + config.PIN_DECK_LENGTH + 0.9, unlit(config.GUTTER_COLOR));
  // foul line
  box(config.LANE_WIDTH, 0.02, 0.06, 0, 0.01, config.FOUL_LINE_Z, unlit(config.FOUL_LINE_COLOR));
}

function _buildMarkings() {
  LANE_ARROWS.length = 0;
  for (let index = -3; index <= 3; index++) {
    const x = index * ARROW_SPACING;
    const arrow = _unlit({ geometry: triangleGeometry(ARROW_WIDTH, ARROW_LENGTH),
                           position: [x, 0.004, ARROW_Z],
                           material: unlit(MARKING_COLOR, 0.96) });
    LANE_ARROWS.push(arrow);
    _unlit({ geometry: discGeometry(DOT_RADIUS, 14), position: [x, 0.004, DOT_Z],
             material: unlit(MARKING_COLOR, 0.90) });
  }
  let z = 1.1;
  const end = config.LANE_LENGTH + config.PIN_DECK_LENGTH - 1.2;
  while (z < end) {
    box(0.03, 0.004, 0.34, 0, 0.004, z, unlit([96, 226, 255], 0.40));
    z += 1.55;
  }
}

function _buildGutters() {
  const railTexture = gradientTexture(config.GUTTER_LIP_COLOR, [52, 14, 32], 4, 64);
  for (const side of [-1, 1]) {
    box(config.GUTTER_WIDTH, config.LANE_THICKNESS, config.LANE_LENGTH,
        side * (config.LANE_WIDTH / 2 + config.GUTTER_WIDTH / 2),
        -config.LANE_THICKNESS / 2 - 0.06, config.LANE_LENGTH / 2, unlit(config.GUTTER_COLOR));
    const railX = side * (config.LANE_WIDTH / 2 + config.GUTTER_WIDTH + 0.07);
    box(0.14, 0.16, config.LANE_LENGTH, railX, 0.02, config.LANE_LENGTH / 2,
        unlit([255, 255, 255], 1.0, railTexture));
    NEON_STRIPS.push({
      mesh: box(0.04, 0.012, config.LANE_LENGTH, railX, 0.095, config.LANE_LENGTH / 2,
                unlit(config.GUTTER_LIP_COLOR, 1.0)),
      baseRgb: config.GUTTER_LIP_COLOR, baseAlpha: 1.0,
    });
    NEON_STRIPS.push({
      mesh: box(0.035, 0.018, config.LANE_LENGTH - 1.2,
                side * (config.LANE_WIDTH / 2 + config.GUTTER_WIDTH + 0.24), 0.012,
                config.LANE_LENGTH / 2, unlit([96, 226, 255], 0.9)),
      baseRgb: [96, 226, 255], baseAlpha: 0.9,
    });
    box(0.03, 0.012, config.LANE_LENGTH, side * (config.LANE_WIDTH / 2 + 0.02), -0.05,
        config.LANE_LENGTH / 2, unlit([150, 26, 72], 1.0));
  }
}

function _buildCity() {
  const lengthCenter = (config.LANE_LENGTH - config.APPROACH_LENGTH) / 2;
  const lengthSpan = config.LANE_LENGTH + config.APPROACH_LENGTH + 2.0;
  const facade = facadeTexture();
  for (const side of [-1, 1]) {
    box(0.16, 3.4, lengthSpan, side * (WALL_X + 0.08), 1.7, lengthCenter, unlit(config.WALL_COLOR));
    let z = -config.APPROACH_LENGTH + 0.6;
    let index = 0;
    while (z < config.LANE_LENGTH + 1.2) {
      const panelWidth = [1.5, 1.9, 1.25][index % 3];
      const panelHeight = [2.4, 3.2, 2.0][index % 3];
      box(0.08, panelHeight, panelWidth, side * (WALL_X - 0.06), panelHeight / 2,
          z + panelWidth / 2, unlit([255, 255, 255], 1.0, facade));
      z += panelWidth + 0.30;
      index += 1;
    }
    NEON_STRIPS.push({
      mesh: box(0.05, 0.035, lengthSpan - 0.6, side * (WALL_X - 0.11), 0.40, lengthCenter,
                unlit(config.WALL_TRIM_COLOR, 1.0)),
      baseRgb: config.WALL_TRIM_COLOR, baseAlpha: 1.0,
    });
    NEON_STRIPS.push({
      mesh: box(0.05, 0.025, lengthSpan - 1.4, side * (WALL_X - 0.11), 2.15, lengthCenter,
                unlit([96, 226, 255], 1.0)),
      baseRgb: [96, 226, 255], baseAlpha: 1.0,
    });
    for (const [idx, zBar] of [-3.2, 1.2, 5.8, 10.6, 15.4, 19.0].entries()) {
      box(0.05, 1.3, 0.05, side * (WALL_X - 0.11), 1.20, zBar,
          unlit(idx % 2 === 0 ? [255, 110, 176] : [96, 226, 255], 0.85));
    }
  }
  const wallZ = config.LANE_LENGTH + config.PIN_DECK_LENGTH + 2.0;
  box(2 * WALL_X + 0.2, 1.8, 0.2, 0, 0.80, wallZ, unlit(config.BACKDROP_COLOR));
  NEON_STRIPS.push({
    mesh: box(2.7, 0.05, 0.06, 0, 1.76, wallZ - 0.12, unlit([255, 84, 130], 1.0)),
    baseRgb: [255, 84, 130], baseAlpha: 1.0,
  });
  PIN_GLOW = _unlit({
    geometry: quadGeometry(4.6, 1.5),
    position: [0, 0.45, wallZ - 0.12],
    material: unlit([255, 255, 255], 1.0, glowTexture(config.BACKDROP_GLOW_COLOR, 96, 2.4)),
  });
  _unlit({
    geometry: quadGeometry(40.0, 9.5),
    position: [0, 1.6 + 4.75, wallZ + 0.6],
    material: unlit([255, 255, 255], 1.0, citySkylineTexture()),
  });
}

export function buildLane() {
  NEON_STRIPS.length = 0;
  LANE_ARROWS.length = 0;
  _buildDecks();
  _buildMarkings();
  _buildGutters();
  _buildCity();
}
