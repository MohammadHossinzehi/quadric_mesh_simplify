// Procedural test meshes. All are consistently oriented (outward normals for
// closed surfaces) so they double as fixtures for the topology tests.

import { normalize } from './vec.js';

/** Subdivided icosahedron on the unit sphere: 20 * 4^level faces, Euler characteristic 2. */
export function icosphere(level = 3, radius = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let positions = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!cache.has(k)) {
        const p = positions[a], q = positions[b];
        cache.set(k, positions.length);
        positions.push(normalize([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]));
      }
      return cache.get(k);
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  positions = positions.map((p) => p.map((x) => x * radius));
  return { positions, faces };
}

/** Torus with major radius R and minor radius r: Euler characteristic 0. */
export function torus(segments = 48, rings = 24, R = 1, r = 0.35) {
  const positions = [], faces = [];
  for (let i = 0; i < segments; i++) {
    const u = (i / segments) * 2 * Math.PI;
    for (let j = 0; j < rings; j++) {
      const v = (j / rings) * 2 * Math.PI;
      positions.push([(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]);
    }
  }
  const id = (i, j) => ((i % segments) * rings) + (j % rings);
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rings; j++) {
      const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
      faces.push([a, b, c], [a, c, d]);
    }
  }
  return { positions, faces };
}

/**
 * n x n grid over [0,1]^2 with height z = height(x, y). A flat grid is the
 * classic sanity check: QEM should reduce its interior to almost nothing at
 * zero error while the boundary planes keep the square outline exact.
 */
export function grid(n = 16, height = () => 0) {
  const positions = [], faces = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = i / n, y = j / n;
      positions.push([x, y, height(x, y)]);
    }
  }
  const id = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  }
  return { positions, faces };
}

/** Deterministic pseudo random generator (mulberry32) for reproducible noise. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lumpy "asteroid": an icosphere displaced radially by a sum of random lobes. */
export function asteroid(level = 4, seed = 7) {
  const m = icosphere(level);
  const rand = rng(seed);
  const lobes = Array.from({ length: 9 }, () => ({
    dir: normalize([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]),
    amp: 0.08 + rand() * 0.22,
    sharp: 2 + rand() * 6,
  }));
  m.positions = m.positions.map((p) => {
    let r = 1;
    for (const l of lobes) {
      const d = p[0] * l.dir[0] + p[1] * l.dir[1] + p[2] * l.dir[2];
      r += l.amp * Math.pow(Math.max(0, d), l.sharp) - 0.03 * l.amp;
    }
    return p.map((x) => x * r);
  });
  return m;
}
