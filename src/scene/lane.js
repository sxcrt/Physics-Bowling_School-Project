import * as THREE from 'three';
// Build the bowling environment (ported from scene/lane.py): deck, markings,
// gutters, the neon city.
import * as config from '../config.js';
import { scene } from './renderer.js';
import { surfaceMaterial, unlitMaterial } from './shader.js';
import { quadGeometry, triangleGeometry, discGeometry } from './geometry.js';
import { enableShadows, installShadowRig } from './shadow.js';
import {
  approachTexture, citySkylineTexture, facadeTexture, glowTexture,
  gradientTexture, woodTexture,
} from './textures.js';

const ARROW_SPACING = 0.1524;
const ARROW_Z = 4.572;
// The seven chevrons are set one board (0.1524 m) apart, so they have to be
// narrower than that to read as seven arrows rather than one zig-zag band.
const ARROW_LENGTH = 0.30;
const ARROW_WIDTH = 0.085;
const DOT_RADIUS = 0.014;
const DOT_Z = -0.95;
// Dark wood inlay, not printer black: the markings are lit surfaces now.
export const MARKING_COLOR = [74, 44, 30];
const WALL_X = 2.7;
const WALL_HEIGHT = 3.4;

export const NEON_STRIPS = [];
export const LANE_ARROWS = [];
export let PIN_GLOW = null;

function col(rgb) { return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); }
function rgba(rgb, alpha = 1.0) { return { color: col(rgb), alpha: Math.max(0, Math.min(1, alpha)) }; }
function rgbCss(rgb, alpha = 1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`; }

function add(mesh, { cast = false, receive = true } = {}) {
  enableShadows(mesh, { cast, receive });
  scene.add(mesh);
  return mesh;
}

function box(w, h, d, x, y, z, material, opts = null) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return add(mesh, opts || {});
}

// A shaded surface (wood, painted deck, gutter channel).
function lit(color, map = null, opts = {}) {
  return surfaceMaterial(Object.assign({
    map, color: col(color), receiveShadow: true, shadowStrength: 0.88,
  }, opts));
}

// An unlit neon/glow/decal surface. Neon emits, so it neither receives nor
// casts shadows.
function unlit(color, alpha = 1.0, map = null) {
  return unlitMaterial(col(color), map, { transparent: alpha < 1.0 || !!map, opacity: alpha });
}

function _unlit({ geometry, position, material, receive = true }) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  return add(mesh, { receive });
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------
function _buildDecks() {
  // floor
  _unlit({ geometry: new THREE.PlaneGeometry(24, config.LANE_LENGTH * 2 + 2 * config.APPROACH_LENGTH).rotateX(-Math.PI / 2),
           position: [0, -config.LANE_THICKNESS - 0.02, (config.LANE_LENGTH - config.APPROACH_LENGTH) / 2],
           material: unlit(config.FLOOR_COLOR) });
  // approach
  box(config.TOTAL_WIDTH, config.LANE_THICKNESS, config.APPROACH_LENGTH,
      0, -config.LANE_THICKNESS / 2, -config.APPROACH_LENGTH / 2, lit(config.APPROACH_COLOR));
  _unlit({ geometry: quadGeometry(config.TOTAL_WIDTH, config.APPROACH_LENGTH),
           position: [0, 0.0015, -config.APPROACH_LENGTH / 2],
           material: lit([255, 255, 255], approachTexture(), { specular: 0.06, specularPower: 18.0 }) });
  // lane
  box(config.LANE_WIDTH, config.LANE_THICKNESS, config.LANE_LENGTH,
      0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH / 2, lit(config.LANE_COLOR));
  _unlit({ geometry: quadGeometry(config.LANE_WIDTH, config.LANE_LENGTH),
           position: [0, 0.0015, config.LANE_LENGTH / 2],
           material: lit([255, 255, 255], woodTexture(), { specular: 0.14, specularPower: 22.0 }) });
  // pin deck
  box(config.LANE_WIDTH, config.LANE_THICKNESS, config.PIN_DECK_LENGTH,
      0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH + config.PIN_DECK_LENGTH / 2, lit(config.PIN_DECK_COLOR));
  _unlit({ geometry: quadGeometry(config.LANE_WIDTH, config.PIN_DECK_LENGTH),
           position: [0, 0.0015, config.LANE_LENGTH + config.PIN_DECK_LENGTH / 2],
           material: lit([255, 255, 255], woodTexture({ boards: 39, width: 256, height: 384, base: config.PIN_DECK_COLOR, grain: 0.10, sheen: 0.30, seed: 23 }), { specular: 0.14, specularPower: 22.0 }) });
  // pit apron
  box(config.LANE_WIDTH, config.LANE_THICKNESS, 1.8,
      0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH + config.PIN_DECK_LENGTH + 0.9, lit(config.GUTTER_COLOR));
  // foul line
  box(config.LANE_WIDTH, 0.02, 0.06, 0, 0.01, config.FOUL_LINE_Z, unlit(config.FOUL_LINE_COLOR));
}

// ---------------------------------------------------------------------------
// Markings
// ---------------------------------------------------------------------------
function _buildMarkings() {
  LANE_ARROWS.length = 0;
  for (let index = -3; index <= 3; index++) {
    const x = index * ARROW_SPACING;
    const arrow = _unlit({ geometry: triangleGeometry(ARROW_WIDTH, ARROW_LENGTH),
                           position: [x, 0.0035, ARROW_Z],
                           material: lit(MARKING_COLOR, null, { shadowStrength: 0.8 }) });
    LANE_ARROWS.push(arrow);
    _unlit({ geometry: discGeometry(DOT_RADIUS, 14), position: [x, 0.0035, DOT_Z],
             material: lit(MARKING_COLOR, null, { shadowStrength: 0.8 }) });
  }
  let z = 1.1;
  const end = config.LANE_LENGTH + config.PIN_DECK_LENGTH - 1.2;
  while (z < end) {
    box(0.03, 0.004, 0.34, 0, 0.0035, z, unlit([96, 226, 255], 0.40));
    z += 1.55;
  }
}

// ---------------------------------------------------------------------------
// Gutters
// ---------------------------------------------------------------------------
function _buildGutters() {
  const railTexture = gradientTexture(config.GUTTER_LIP_COLOR, [52, 14, 32], 4, 64);
  for (const side of [-1, 1]) {
    box(config.GUTTER_WIDTH, config.LANE_THICKNESS, config.LANE_LENGTH,
        side * (config.LANE_WIDTH / 2 + config.GUTTER_WIDTH / 2),
        -config.LANE_THICKNESS / 2 - 0.06, config.LANE_LENGTH / 2, lit(config.GUTTER_COLOR));
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

// ---------------------------------------------------------------------------
// The neon city
// ---------------------------------------------------------------------------
function _buildCity() {
  const lengthCenter = (config.LANE_LENGTH - config.APPROACH_LENGTH) / 2;
  const lengthSpan = config.LANE_LENGTH + config.APPROACH_LENGTH + 2.0;
  const facade = facadeTexture();
  for (const side of [-1, 1]) {
    // The wall body stays unlit and dark: it is a backdrop, and the lane has to
    // remain the brightest thing in the frame.
    box(0.16, WALL_HEIGHT, lengthSpan, side * (WALL_X + 0.08), WALL_HEIGHT / 2, lengthCenter, unlit(config.WALL_COLOR));
    let z = -config.APPROACH_LENGTH + 0.6;
    let index = 0;
    while (z < config.LANE_LENGTH + 1.2) {
      const panelWidth = [2.6, 3.4, 2.1][index % 3];
      const panelHeight = [2.4, 3.2, 2.0][index % 3];
      const panel = _unlit({ geometry: new THREE.PlaneGeometry(panelWidth, panelHeight).rotateY(-side * Math.PI / 2),
                             position: [side * (WALL_X - 0.06), panelHeight / 2, z + panelWidth / 2],
                             material: unlit(paletteForPanel(index), 1.0, facade) });
      panel.renderOrder = 0;
      z += panelWidth + 0.34;
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
    for (const [idx, zBar] of [-3.2, 1.2, 5.8, 10.6, 15.4].entries()) {
      box(0.05, 1.1, 0.05, side * (WALL_X - 0.11), 1.15, zBar,
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
  _buildCeiling();
}

// The alley had no roof, so the top of every frame was empty black. A ceiling at
// the wall head closes the space with two runs of light and a few cross beams.
function _buildCeiling() {
  const top = WALL_HEIGHT;
  const zStart = -config.APPROACH_LENGTH - 0.4;
  const zEnd = config.LANE_LENGTH + config.PIN_DECK_LENGTH + 1.6;
  const span = zEnd - zStart;
  const centre = (zStart + zEnd) / 2;
  const shade = gradientTexture([38, 33, 80], [24, 21, 52], 4, 64);
  _unlit({
    geometry: quadGeometry(2 * WALL_X + 0.4, span),
    position: [0, top, centre],
    material: unlit([255, 255, 255], 1.0, shade),
  });
  for (const x of [-1.45, 1.45]) {
    NEON_STRIPS.push({
      mesh: box(0.14, 0.035, span - 1.0, x, top - 0.07, centre, unlit([198, 230, 255], 0.92)),
      baseRgb: [198, 230, 255], baseAlpha: 0.92,
    });
  }
  // Cross beams break the length up and give the roof a sense of scale.
  for (const z of [-2.6, 3.4, 9.4, 15.0, 19.6]) {
    box(2 * WALL_X, 0.18, 0.24, 0, top - 0.11, z, unlit([44, 38, 88]));
    box(1.2, 0.06, 0.10, 0, top - 0.22, z, unlit([255, 236, 200], 0.85));
  }
}

// A slightly different tint per facade panel breaks up the repeat and gives the
// wall a sense of depth without adding new art.
const PANEL_TINTS = [[255, 255, 255], [206, 214, 255], [255, 226, 236]];
function paletteForPanel(index) { return PANEL_TINTS[index % PANEL_TINTS.length]; }

export function buildLane() {
  installShadowRig();
  NEON_STRIPS.length = 0;
  LANE_ARROWS.length = 0;
  _buildDecks();
  _buildMarkings();
  _buildGutters();
  _buildCity();
}
