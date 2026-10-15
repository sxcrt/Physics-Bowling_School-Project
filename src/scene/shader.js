import * as THREE from 'three';
// The project's surface shading (ported from scene/shaders.py): one warm key
// direction plus a cool fill, evaluated per pixel from the world normal. The
// browser build adds a real hardware-shadow-map term on top of exactly the same
// tone response, so the deck, ball and pins sit on the lane instead of floating
// above it.
import * as config from '../config.js';

// ---------------------------------------------------------------------------
// Surface shader: soft key/fill response + shadow-map occlusion.
//
// The lit response is split into an ambient (fill) term and a key term:
//
//     ambient = fill_color * shade_floor
//     key     = mix(fill, key, dot(n, L)) * (shade_floor + shade_gain * dot(n, L)) - ambient
//     lit     = ambient + key * shadow
//
// With `shadow == 1` this is algebraically identical to the original
// `mix(fill, key, d) * (floor + gain * d)`, so unshadowed surfaces look exactly
// as they did; a shadow simply removes the key term, which leaves the cool fill
// colour behind. That is what stops shadows reading as flat black holes.
// ---------------------------------------------------------------------------

const VERTEX_SHADER = `
#include <common>

varying vec2 vUv;
varying vec3 vSurfaceNormal;
varying vec3 vSurfacePosition;

#include <shadowmap_pars_vertex>

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vSurfacePosition = worldPosition.xyz;
  vSurfaceNormal = normalize(mat3(modelMatrix) * normal);
  vec3 transformedNormal = normalMatrix * normal;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D map;
uniform vec3 color;
uniform vec3 keyDirection;
uniform vec3 keyColor;
uniform vec3 fillColor;
uniform float shadeFloor;
uniform float shadeGain;
uniform float shadowStrength;
uniform float specularStrength;
uniform float specularPower;
uniform float emissiveMix;
uniform float opacity;
uniform float ambientBoost;
uniform bool receiveShadow;

varying vec2 vUv;
varying vec3 vSurfaceNormal;
varying vec3 vSurfacePosition;

#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

void main() {
  vec3 normal = normalize(vSurfaceNormal);
  vec3 keyDir = normalize(keyDirection);
  float direct = max(dot(normal, keyDir), 0.0);

  vec3 keyTint = mix(fillColor, keyColor, direct);
  float shade = shadeFloor + shadeGain * direct;
  vec3 ambient = fillColor * (shadeFloor + ambientBoost);
  vec3 keyTerm = max(keyTint * shade - ambient, vec3(0.0));

  vec4 texel = texture2D(map, vUv);
  vec3 base = texel.rgb * color;

  float occlusion = 1.0;
  occlusion = mix(1.0, getShadowMask(), shadowStrength);

  vec3 lit = base * (ambient + keyTerm * occlusion);

  if (emissiveMix > 0.0) {
    lit = mix(lit, base, emissiveMix);
  }

  if (specularStrength > 0.0) {
    vec3 viewDir = normalize(cameraPosition - vSurfacePosition);
    vec3 halfVector = normalize(keyDir + viewDir);
    float spec = pow(max(dot(normal, halfVector), 0.0), specularPower);
    lit += keyColor * (spec * specularStrength * occlusion);
  }

  gl_FragColor = vec4(lit, texel.a * opacity);
}
`;

const DEFAULT_KEY_DIRECTION = new THREE.Vector3(-0.25, 0.85, -0.50).normalize();

let _white = null;
function whiteTexture() {
  if (!_white) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 2, 2);
    _white = new THREE.CanvasTexture(c);
    _white.colorSpace = THREE.NoColorSpace;
  }
  return _white;
}

function lightUniforms() {
  // The renderer writes the light/shadow state into these slots for every
  // material with ``lights === true``; they have to exist before the first draw.
  return THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
}

export function rgbColor(rgb, alpha = 1.0) {
  return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

// A shaded surface: the soft key/fill response plus shadow-map occlusion.
export function surfaceMaterial({
  map = null, color = 0xffffff, receiveShadow = true, shadowStrength = 0.88,
  specular = 0.0, specularPower = 48.0, emissive = 0.0, opacity = 1.0,
  transparent = false, depthWrite = true, ambientBoost = 0.0, side = null,
} = {}) {
  const material = new THREE.ShaderMaterial({
    lights: true,
    transparent,
    opacity,
    depthWrite,
    side: side || THREE.DoubleSide,   // the view is horizontally mirrored
    uniforms: Object.assign(lightUniforms(), {
      map: { value: map || whiteTexture() },
      color: { value: color.isColor ? color : new THREE.Color(color) },
      keyDirection: { value: DEFAULT_KEY_DIRECTION.clone() },
      keyColor: { value: rgbColor(config.KEY_LIGHT_COLOR) },
      fillColor: { value: rgbColor(config.FILL_LIGHT_COLOR) },
      shadeFloor: { value: config.SHADE_FLOOR },
      shadeGain: { value: config.SHADE_GAIN },
      shadowStrength: { value: shadowStrength },
      specularStrength: { value: specular },
      specularPower: { value: specularPower },
      emissiveMix: { value: emissive },
      opacity: { value: opacity },
      ambientBoost: { value: ambientBoost },
      receiveShadow: { value: !!receiveShadow },
    }),
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  material.userData.surface = true;
  return material;
}

// Back-compat wrapper for the ported call sites (pins, avatar, ball).
export function softLightingMaterial(map, color = 0xffffff, opts = {}) {
  return surfaceMaterial(Object.assign({ map, color }, opts));
}

// An unlit material (flat colours: neon strips, glow quads, skyline art).
export function unlitMaterial(color, map = null, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color: color, map: map, transparent: opts.transparent !== undefined ? opts.transparent : !!map,
    opacity: opts.opacity !== undefined ? opts.opacity : 1.0,
    side: opts.side || THREE.DoubleSide,   // the view is horizontally mirrored
    depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
  });
}

// A soft contact/ambient-occlusion decal: a flat blob that hugs the lane. Real
// shadow maps get the cast shadow; this supplies the tight darkening directly
// under a resting object, which is what makes contact read at any distance.
export function contactMaterial(map, opacity = 1.0) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff, map, transparent: true, opacity,
    depthWrite: false, side: THREE.DoubleSide,
  });
}
