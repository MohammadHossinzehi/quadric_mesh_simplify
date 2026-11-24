// Quadric error metric mesh simplification by iterative edge collapse.
//
// Pipeline (Garland and Heckbert 1997, plus the safety checks a production
// decimator needs):
//   1. Every vertex gets the area weighted sum of the plane quadrics of its
//      incident faces. Boundary edges add a heavily weighted plane that is
//      perpendicular to the face and contains the edge, which pins open
//      borders in place.
//   2. Every edge (u, v) is a collapse candidate with cost min E_{Qu+Qv}(p).
//      The minimiser p is the solution of the 3x3 system when it is well
//      conditioned and close to the edge, else the exact minimiser on the
//      segment [u, v].
//   3. Candidates pop from a min-heap. A collapse is applied only if it keeps
//      the mesh an oriented 2-manifold (link condition, no pinched borders,
//      no duplicate faces) and does not flip or crush any surviving face.
//      Entries are invalidated lazily with per-vertex version stamps.
//   4. After a collapse, the edges of the surviving vertex are re-queued, and
//      edges that were rejected near it get another chance, since a changed
//      neighbourhood can turn a rejected collapse into a legal one.

import { Quadric } from './quadric.js';
import { MinHeap } from './heap.js';
import { sub, cross, dot, length, dist, triCross } from './vec.js';
import { compact } from './mesh.js';

const DEFAULTS = {
  targetFaces: undefined,    // stop at or below this many faces
  targetRatio: undefined,    // or at this fraction of the input face count
  maxError: Infinity,        // never perform a collapse costing more than this
  boundaryWeight: 1000,      // multiplier on boundary constraint planes
  lockBoundary: false,       // forbid moving or removing boundary vertices at all
  minNormalDot: 0.2,         // reject collapses that turn a face by more than ~78 deg
  maxMoveFactor: 4,          // optimum may sit at most this many edge lengths from the edge midpoint
  areaWeighted: true,        // weight face quadrics by triangle area
  metric: 'qem',             // 'qem', or 'edge-length' (shortest edge to its midpoint: a naive baseline)
  onCollapse: undefined,     // optional callback(record) for progressive meshes / animation
};

export function simplify(mesh, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const P = mesh.positions.map((p) => [...p]);
  const F = mesh.faces.map((f) => [...f]);
  const nV = P.length;
  // Numeric undirected edge keys are far cheaper than strings in the hot loop.
  const edgeKey = (a, b) => (a < b ? a * nV + b : b * nV + a);
  const edgeEnds = (k) => [Math.floor(k / nV), k % nV];

  let target = 0;
  if (opt.targetFaces !== undefined) target = opt.targetFaces;
  else if (opt.targetRatio !== undefined) target = Math.floor(F.length * opt.targetRatio);
  else if (opt.maxError === Infinity) target = Math.floor(F.length / 2);
  target = Math.max(0, target);

  const faceAlive = new Uint8Array(F.length).fill(1);
  const vertAlive = new Uint8Array(nV);
  const version = new Uint32Array(nV);
  const vf = Array.from({ length: nV }, () => new Set());
  F.forEach((f, fi) => f.forEach((v) => { vf[v].add(fi); vertAlive[v] = 1; }));

  // Edge -> faces multiplicity, used to recognise boundary edges and vertices.
  const edgeFaces = new Map();
  const bumpEdge = (a, b, fi, delta) => {
    const k = edgeKey(a, b);
    let s = edgeFaces.get(k);
    if (!s) edgeFaces.set(k, (s = new Set()));
    if (delta > 0) s.add(fi); else { s.delete(fi); if (s.size === 0) edgeFaces.delete(k); }
  };
  F.forEach((f, fi) => { for (let k = 0; k < 3; k++) bumpEdge(f[k], f[(k + 1) % 3], fi, 1); });

  const boundaryVertex = new Uint8Array(nV);
  for (const [k, s] of edgeFaces) {
    if (s.size === 1) { const [a, b] = edgeEnds(k); boundaryVertex[a] = boundaryVertex[b] = 1; }
  }

  // 1. Quadrics.
  const Q = Array.from({ length: nV }, () => new Quadric());
  F.forEach((f) => {
    const n = triCross(P[f[0]], P[f[1]], P[f[2]]);
    const area = 0.5 * length(n);
    if (area === 0) return;
    const q = Quadric.fromPointNormal(P[f[0]], n, opt.areaWeighted ? area : 1);
    f.forEach((v) => Q[v].addInPlace(q));
  });
  for (const [k, s] of edgeFaces) {
    if (s.size !== 1) continue;
    const fi = [...s][0];
    const f = F[fi];
    // Orient the edge as it is used in its face.
    let a, b;
    for (let i = 0; i < 3; i++) {
      const x = f[i], y = f[(i + 1) % 3];
      if (edgeKey(x, y) === k) { a = x; b = y; }
    }
    const e = sub(P[b], P[a]);
    const fn = triCross(P[f[0]], P[f[1]], P[f[2]]);
    const n = cross(e, fn);
    if (length(n) === 0) continue;
    const q = Quadric.fromPointNormal(P[a], n, opt.boundaryWeight * dot(e, e));
    Q[a].addInPlace(q);
    Q[b].addInPlace(q);
  }

  // 2. Candidate evaluation.
  let seq = 0;
  const heap = new MinHeap();
  const scratch = new Quadric();
  const placement = (u, v) => {
    const q = Quadric.sumInto(scratch, Q[u], Q[v]);
    if (opt.lockBoundary) {
      if (boundaryVertex[u] && boundaryVertex[v]) return null;
      if (boundaryVertex[u]) return { p: [...P[u]], cost: q.evaluate(P[u]), keep: u, drop: v };
      if (boundaryVertex[v]) return { p: [...P[v]], cost: q.evaluate(P[v]), keep: v, drop: u };
    }
    if (opt.metric === 'edge-length') {
      const m = [(P[u][0] + P[v][0]) / 2, (P[u][1] + P[v][1]) / 2, (P[u][2] + P[v][2]) / 2];
      return { p: m, cost: dist(P[u], P[v]), keep: u, drop: v };
    }
    let p = q.optimum();
    const mid = [(P[u][0] + P[v][0]) / 2, (P[u][1] + P[v][1]) / 2, (P[u][2] + P[v][2]) / 2];
    const len = dist(P[u], P[v]);
    if (!p || dist(p, mid) > opt.maxMoveFactor * len) p = q.segmentOptimum(P[u], P[v]);
    return { p, cost: q.evaluate(p), keep: u, drop: v };
  };
  const pushEdge = (u, v) => {
    if (u === v) return;
    const c = placement(u, v);
    if (!c) return;
    heap.push({ cost: c.cost, seq: seq++, u, v, vu: version[u], vv: version[v], c });
  };
  const neighbours = (v) => {
    const out = new Set();
    for (const fi of vf[v]) for (const w of F[fi]) if (w !== v) out.add(w);
    return out;
  };
  for (const k of edgeFaces.keys()) {
    const [a, b] = edgeEnds(k);
    pushEdge(a, b);
  }

  // 3. Collapse loop.
  let faceCount = F.length;
  const deferred = new Map(); // vertex -> Set of rejected edge keys awaiting a retry
  const stats = { collapses: 0, rejected: { link: 0, boundary: 0, flip: 0, duplicate: 0 }, maxError: 0 };

  const check = (keep, drop, p) => {
    // Faces shared by both endpoints disappear.
    const shared = [];
    const sharedSet = new Set();
    for (const fi of vf[keep]) if (vf[drop].has(fi)) { shared.push(fi); sharedSet.add(fi); }
    const nk = neighbours(keep), nd = neighbours(drop);
    // Link condition: common neighbours must be exactly the apexes of shared faces.
    const apex = new Set();
    for (const fi of shared) for (const w of F[fi]) if (w !== keep && w !== drop) apex.add(w);
    let common = 0;
    for (const w of nk) if (nd.has(w)) { common++; if (!apex.has(w)) return 'link'; }
    if (common !== apex.size) return 'link';
    // An interior edge between two boundary vertices would pinch the border shut.
    const ef = edgeFaces.get(edgeKey(keep, drop));
    const isBoundaryEdge = ef && ef.size === 1;
    if (!isBoundaryEdge && boundaryVertex[keep] && boundaryVertex[drop]) return 'boundary';
    // Never shrink a closed component below a tetrahedron. (The duplicate-face
    // test below also catches this; the early exit just saves work.)
    if (!isBoundaryEdge && faceCount - shared.length < 4) return 'link';
    // Surviving faces must not flip, collapse to zero area, or duplicate another face.
    const existing = new Set();
    for (const v of [keep, drop]) {
      for (const fi of vf[v]) {
        if (sharedSet.has(fi)) continue;
        const f = F[fi];
        const before = triCross(P[f[0]], P[f[1]], P[f[2]]);
        const g = f.map((w) => (w === drop ? keep : w));
        const pos = g.map((w) => (w === keep ? p : P[w]));
        const after = triCross(pos[0], pos[1], pos[2]);
        const lb = length(before), la = length(after);
        if (la <= 1e-12 * (lb + 1e-300) || la === 0) return 'flip';
        if (dot(before, after) < opt.minNormalDot * lb * la) return 'flip';
        const key = [...g].sort((x, y) => x - y).join(',');
        if (existing.has(key)) return 'duplicate';
        existing.add(key);
      }
    }
    return { shared };
  };

  while (heap.size > 0 && faceCount > target) {
    const e = heap.pop();
    const { u, v } = e;
    if (!vertAlive[u] || !vertAlive[v] || version[u] !== e.vu || version[v] !== e.vv) continue;
    if (!edgeFaces.has(edgeKey(u, v))) continue;
    if (e.cost > opt.maxError) break;
    const { keep, drop, p } = e.c;
    const res = check(keep, drop, p);
    if (typeof res === 'string') {
      stats.rejected[res]++;
      const k = edgeKey(u, v);
      for (const w of [u, v]) {
        let parked = deferred.get(w);
        if (!parked) deferred.set(w, (parked = new Set()));
        parked.add(k);
      }
      continue;
    }

    // Apply the collapse.
    for (const fi of res.shared) {
      const f = F[fi];
      for (let k = 0; k < 3; k++) bumpEdge(f[k], f[(k + 1) % 3], fi, -1);
      for (const w of f) vf[w].delete(fi);
      faceAlive[fi] = 0;
      faceCount--;
    }
    for (const fi of vf[drop]) {
      const f = F[fi];
      for (let k = 0; k < 3; k++) bumpEdge(f[k], f[(k + 1) % 3], fi, -1);
      for (let k = 0; k < 3; k++) if (f[k] === drop) f[k] = keep;
      for (let k = 0; k < 3; k++) bumpEdge(f[k], f[(k + 1) % 3], fi, 1);
      vf[keep].add(fi);
    }
    vf[drop].clear();
    vertAlive[drop] = 0;
    P[keep] = p;
    Q[keep].addInPlace(Q[drop]);
    if (boundaryVertex[drop]) boundaryVertex[keep] = 1;
    stats.collapses++;
    if (e.cost > stats.maxError) stats.maxError = e.cost;
    if (opt.onCollapse) opt.onCollapse({ keep, drop, position: p, cost: e.cost, faces: faceCount });

    // 4. Re-queue. Only edges touching `keep` change cost (no other quadric or
    // position moved), so only they get fresh entries. Edges rejected earlier
    // are parked on their endpoints and retried once their 1-ring changes,
    // which is exactly when a flip or link verdict can flip.
    version[keep]++;
    const ring = neighbours(keep);
    for (const w of ring) pushEdge(keep, w);
    for (const w of [keep, ...ring]) {
      const parked = deferred.get(w);
      if (!parked) continue;
      deferred.delete(w);
      for (const k of parked) {
        const [a, b] = edgeEnds(k);
        if (vertAlive[a] && vertAlive[b] && edgeFaces.has(k)) pushEdge(a, b);
      }
    }
  }

  const faces = [];
  F.forEach((f, fi) => { if (faceAlive[fi]) faces.push(f); });
  const out = compact(P, faces);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  stats.inputFaces = mesh.faces.length;
  stats.outputFaces = out.faces.length;
  stats.milliseconds = t1 - t0;
  return { mesh: out, stats };
}
