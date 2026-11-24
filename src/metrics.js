// Geometric error between two meshes: sampled symmetric Hausdorff distance and
// RMS surface deviation. The simplifier optimises quadric error, which is a
// proxy; these metrics measure what a user actually sees.

import { sub, add, scale, dot, triArea } from './vec.js';

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection, 5.1.5). */
export function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

export function pointTriangleDistance(p, a, b, c) {
  const q = closestPointOnTriangle(p, a, b, c);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Barycentric sample points on each face: vertices, edge midpoints, centroid and k^2 interior points. */
export function samplePoints(mesh, k = 2) {
  const out = [];
  const P = mesh.positions;
  for (const f of mesh.faces) {
    const a = P[f[0]], b = P[f[1]], c = P[f[2]];
    for (let i = 0; i <= k; i++) {
      for (let j = 0; i + j <= k; j++) {
        const u = i / k, v = j / k, w = 1 - u - v;
        out.push([a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v]);
      }
    }
  }
  return out;
}

/** Distance from each point to the nearest triangle of mesh (brute force with a bounding sphere cull). */
export function distancesToMesh(points, mesh) {
  const P = mesh.positions;
  const tris = mesh.faces.map((f) => {
    const a = P[f[0]], b = P[f[1]], c = P[f[2]];
    const ctr = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const rad = Math.max(...[a, b, c].map((q) => Math.hypot(q[0] - ctr[0], q[1] - ctr[1], q[2] - ctr[2])));
    return { a, b, c, ctr, rad };
  });
  return points.map((p) => {
    let best = Infinity;
    for (const t of tris) {
      const lower = Math.hypot(p[0] - t.ctr[0], p[1] - t.ctr[1], p[2] - t.ctr[2]) - t.rad;
      if (lower >= best) continue;
      const d = pointTriangleDistance(p, t.a, t.b, t.c);
      if (d < best) best = d;
    }
    return best;
  });
}

/**
 * Symmetric sampled Hausdorff distance and RMS deviation between two meshes.
 * Exact Hausdorff needs a much heavier algorithm; dense barycentric sampling
 * converges to it from below and is what tools like Metro report.
 */
export function surfaceDeviation(original, simplified, k = 2) {
  const forward = distancesToMesh(samplePoints(original, k), simplified);
  const backward = distancesToMesh(samplePoints(simplified, k), original);
  const all = forward.concat(backward);
  const max = Math.max(...forward, ...backward);
  const rms = Math.sqrt(all.reduce((s, d) => s + d * d, 0) / all.length);
  return { hausdorff: max, forward: Math.max(...forward), backward: Math.max(...backward), rms };
}

export function surfaceArea(mesh) {
  const P = mesh.positions;
  return mesh.faces.reduce((s, f) => s + triArea(P[f[0]], P[f[1]], P[f[2]]), 0);
}

/** Signed volume via the divergence theorem; positive for closed outward-oriented meshes. */
export function signedVolume(mesh) {
  const P = mesh.positions;
  let v = 0;
  for (const [i, j, k] of mesh.faces) {
    const a = P[i], b = P[j], c = P[k];
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}
