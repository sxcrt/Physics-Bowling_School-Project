import * as THREE from 'three';
// Procedural meshes (ported from scene/geometry.py and scene/pin_mesh.py).
import * as config from '../config.js';

// ---------------------------------------------------------------------------
// Pin lathe mesh (regulation silhouette, revolved about the long axis)
// ---------------------------------------------------------------------------
export const SEGMENTS = 32;
export const PROFILE_SAMPLES = 40;

export const PIN_PROFILE = [
  [0.0000, 0.0255], [0.0060, 0.0290], [0.0180, 0.0380], [0.0350, 0.0470],
  [0.0550, 0.0540], [0.0800, 0.0588], [0.1050, 0.0605], [0.1300, 0.0600],
  [0.1550, 0.0575], [0.1800, 0.0530], [0.2050, 0.0455], [0.2250, 0.0370],
  [0.2420, 0.0300], [0.2550, 0.0240], [0.2680, 0.0228], [0.2820, 0.0232],
  [0.2960, 0.0250], [0.3100, 0.0275], [0.3220, 0.0296], [0.3350, 0.0300],
  [0.3480, 0.0286], [0.3600, 0.0250], [0.3700, 0.0190], [0.3770, 0.0110],
  [0.3810, 0.0000],
];

function monotoneCubic(points, count) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const n = points.length;
  if (n < 2 || count < 2) return points.slice();
  const slopes = [];
  for (let i = 0; i < n - 1; i++) slopes.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const tangents = new Array(n).fill(0);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[slopes.length - 1];   // Python's slopes[-1]
  for (let i = 1; i < n - 1; i++) {
    const left = slopes[i - 1], right = slopes[i];
    if (left * right <= 0.0) tangents[i] = 0.0;
    else {
      const hLeft = xs[i] - xs[i - 1], hRight = xs[i + 1] - xs[i];
      const w1 = 2.0 * hRight + hLeft, w2 = hRight + 2.0 * hLeft;
      tangents[i] = (w1 + w2) / (w1 / left + w2 / right);
    }
  }
  const samples = [];
  const span = xs[n - 1] - xs[0];
  for (let k = 0; k < count; k++) {
    const x = xs[0] + span * k / (count - 1);
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = h <= 0.0 ? 0.0 : (x - xs[i]) / h;
    const t2 = t * t, t3 = t * t * t;
    let y = (2.0 * t3 - 3.0 * t2 + 1.0) * ys[i]
      + (t3 - 2.0 * t2 + t) * h * tangents[i]
      + (-2.0 * t3 + 3.0 * t2) * ys[i + 1]
      + (t3 - t2) * h * tangents[i + 1];
    const low = Math.min(ys[i], ys[i + 1]), high = Math.max(ys[i], ys[i + 1]);
    samples.push([x, Math.max(low, Math.min(high, y))]);
  }
  return samples;
}

export function buildPinGeometry() {
  const height = config.PIN_HEIGHT;
  const profile = monotoneCubic(PIN_PROFILE, PROFILE_SAMPLES);
  const half = height / 2.0;
  const vertices = [], uvs = [], normals = [], indices = [];
  for (let index = 0; index < profile.length; index++) {
    const [h, radius] = profile[index];
    let dr, dh;
    if (index === 0) { dr = profile[1][1] - radius; dh = profile[1][0] - h; }
    else if (index === profile.length - 1) { dr = radius - profile[index - 1][1]; dh = h - profile[index - 1][0]; }
    else { dr = profile[index + 1][1] - profile[index - 1][1]; dh = profile[index + 1][0] - profile[index - 1][0]; }
    const len = Math.hypot(dr, dh) || 1.0;
    const normalR = dh / len, normalH = -dr / len;
    const y = h - half;
    for (let j = 0; j <= SEGMENTS; j++) {
      const angle = 2.0 * Math.PI * j / SEGMENTS;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      vertices.push(radius * cosA, y, radius * sinA);
      uvs.push(j / SEGMENTS, h / height);
      normals.push(normalR * cosA, normalH, normalR * sinA);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * (SEGMENTS + 1) + j;
      const b = (i + 1) * (SEGMENTS + 1) + j;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const centre = vertices.length / 3;
  vertices.push(0.0, -half, 0.0);
  uvs.push(0.5, 0.0);
  normals.push(0.0, -1.0, 0.0);
  for (let j = 0; j < SEGMENTS; j++) indices.push(centre, j, j + 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

// ---------------------------------------------------------------------------
// Low-poly body parts (the avatar)
// ---------------------------------------------------------------------------
function meshFrom(vertices, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function taperedBoxGeometry(bottom = [0.2, 0.2], top = [0.16, 0.16], height = 0.5,
                                   bevel = 0.0, down = false) {
  let [bw, bd] = bottom, [tw, td] = top;
  let ringBottom, ringTop;
  const ring = (w, d, y) => {
    if (bevel <= 0.0) {
      return [[-w / 2, y, -d / 2], [w / 2, y, -d / 2], [w / 2, y, d / 2], [-w / 2, y, d / 2]];
    }
    return [
      [-w / 2 + bevel, y, -d / 2], [w / 2 - bevel, y, -d / 2], [w / 2, y, -d / 2 + bevel],
      [w / 2, y, d / 2 - bevel], [w / 2 - bevel, y, d / 2], [-w / 2 + bevel, y, d / 2],
      [-w / 2, y, d / 2 - bevel], [-w / 2, y, -d / 2 + bevel],
    ];
  };
  ringBottom = ring(bw, bd, 0.0);
  ringTop = ring(tw, td, height);
  const count = ringBottom.length;
  let vertices = ringBottom.concat(ringTop).flatMap((v) => v);
  const indices = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    indices.push(i, j, count + j, i, count + j, count + i);
  }
  for (let i = 1; i < count - 1; i++) {
    indices.push(0, i + 1, i);
    indices.push(count, count + i, count + i + 1);
  }
  if (down) {
    // Build from y=0 down to y=-height, with the winding flipped so faces stay outward.
    const flat = [];
    for (let i = 0; i < vertices.length; i += 3) flat.push([vertices[i], -vertices[i + 1], vertices[i + 2]]);
    vertices = flat.flat();
    const flipped = [];
    for (let i = 0; i < indices.length; i += 3) {
      flipped.push(indices[i], indices[i + 2], indices[i + 1]);
    }
    return meshFrom(vertices, flipped);
  }
  return meshFrom(vertices, indices);
}

export function lowPolySphereGeometry(radius = 0.5, rings = 5, segments = 8, squash = [1, 1, 1]) {
  const [sx, sy, sz] = squash;
  const vertices = [0.0, radius * sy, 0.0];
  for (let ring = 1; ring < rings; ring++) {
    const phi = Math.PI * ring / rings;
    const y = radius * Math.cos(phi) * sy;
    const ringRadius = radius * Math.sin(phi);
    for (let segment = 0; segment < segments; segment++) {
      const theta = 2.0 * Math.PI * segment / segments;
      vertices.push(ringRadius * Math.sin(theta) * sx, y, ringRadius * Math.cos(theta) * sz);
    }
  }
  const bottom = vertices.length / 3;
  vertices.push(0.0, -radius * sy, 0.0);
  const indices = [];
  for (let segment = 0; segment < segments; segment++) {
    const a = 1 + segment, b = 1 + (segment + 1) % segments;
    indices.push(0, b, a);
  }
  for (let ring = 0; ring < rings - 2; ring++) {
    const base = 1 + ring * segments, nxt = base + segments;
    for (let segment = 0; segment < segments; segment++) {
      const a = base + segment, b = base + (segment + 1) % segments;
      const c = nxt + segment, d = nxt + (segment + 1) % segments;
      indices.push(a, d, c, a, b, d);
    }
  }
  const base = 1 + (rings - 2) * segments;
  for (let segment = 0; segment < segments; segment++) {
    const a = base + segment, b = base + (segment + 1) % segments;
    indices.push(bottom, a, b);
  }
  return meshFrom(vertices, indices);
}

export function coneGeometry(radius = 0.1, height = 0.3, segments = 8) {
  const vertices = [0.0, 0.0, 0.0];
  for (let segment = 0; segment < segments; segment++) {
    const theta = 2.0 * Math.PI * segment / segments;
    vertices.push(radius * Math.sin(theta), 0.0, radius * Math.cos(theta));
  }
  vertices.push(0.0, height, 0.0);
  const apex = vertices.length / 3 - 1;
  const indices = [];
  for (let segment = 0; segment < segments; segment++) {
    const a = 1 + segment, b = 1 + (segment + 1) % segments;
    indices.push(0, b, a);
    indices.push(a, b, apex);
  }
  return meshFrom(vertices, indices);
}

export function discGeometry(radius, segments = 20) {
  const vertices = [0.0, 0.0, 0.0];
  const normals = [0.0, 1.0, 0.0];
  const uvs = [0.5, 0.5];
  for (let i = 0; i <= segments; i++) {
    const angle = 2.0 * Math.PI * i / segments;
    const sinA = Math.sin(angle), cosA = Math.cos(angle);
    vertices.push(radius * sinA, 0.0, radius * cosA);
    normals.push(0.0, 1.0, 0.0);
    uvs.push(0.5 * (1.0 + sinA), 0.5 * (1.0 + cosA));
  }
  const indices = [];
  for (let i = 0; i < segments; i++) indices.push(0, i + 2, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

export function quadGeometry(width, depth, uRepeat = 1, vRepeat = 1) {
  const hw = width / 2, hd = depth / 2;
  const g = new THREE.PlaneGeometry(width, depth);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) { uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat); }
  return g;
}

export function triangleGeometry(width, depth) {
  const hw = width / 2, hd = depth / 2;
  const vertices = [-hw, 0, -hd, hw, 0, -hd, 0, 0, hd];
  const uvs = [0, 0, 1, 0, 0.5, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2]);
  g.computeVertexNormals();
  return g;
}
