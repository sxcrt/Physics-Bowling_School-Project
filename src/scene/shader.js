import * as THREE from 'three';
// The project's surface shading (ported from scene/shaders.py): one warm key
// direction plus a cool fill, evaluated per pixel from the world normal.
import * as config from '../config.js';

function makeSoftLightingShader() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null },
      color: { value: new THREE.Color(1, 1, 1) },
      key_direction: { value: new THREE.Vector3(-0.25, 0.85, -0.50).normalize() },
      key_color: { value: new THREE.Color().setRGB(...config.KEY_LIGHT_COLOR.map((c) => c / 255)) },
      fill_color: { value: new THREE.Color().setRGB(...config.FILL_LIGHT_COLOR.map((c) => c / 255)) },
      shade_floor: { value: config.SHADE_FLOOR },
      shade_gain: { value: config.SHADE_GAIN },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 color;
      uniform vec3 key_direction;
      uniform vec3 key_color;
      uniform vec3 fill_color;
      uniform float shade_floor;
      uniform float shade_gain;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      void main() {
        vec3 normal = normalize(vWorldNormal);
        float direct = max(dot(normal, normalize(key_direction)), 0.0);
        vec3 tint = mix(fill_color, key_color, direct);
        float shade = shade_floor + shade_gain * direct;
        vec4 base = texture2D(map, vUv) * vec4(color, 1.0);
        gl_FragColor = vec4(base.rgb * tint * shade, base.a);
      }
    `,
  });
}

let _soft = null;
let _white = null;
export function softLightingMaterial(map, color = 0xffffff) {
  if (!_soft) _soft = makeSoftLightingShader();
  if (map === null) {
    if (!_white) {
      const c = document.createElement('canvas'); c.width = c.height = 2;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2, 2);
      _white = new THREE.CanvasTexture(c); _white.colorSpace = THREE.NoColorSpace;
    }
    map = _white;
  }
  const material = _soft.clone();
  material.side = THREE.DoubleSide;      // the view is horizontally mirrored
  material.uniforms.map.value = map;
  material.uniforms.color.value = new THREE.Color(color);
  return material;
}

// An unlit material (flat colours, the environment surfaces).
export function unlitMaterial(color, map = null, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color: color, map: map, transparent: opts.transparent !== undefined ? opts.transparent : !!map,
    opacity: opts.opacity !== undefined ? opts.opacity : 1.0,
    side: opts.side || THREE.DoubleSide,   // the view is horizontally mirrored
    depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
  });
}
