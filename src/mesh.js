// Indexed triangle meshes: { positions: [[x,y,z], ...], faces: [[a,b,c], ...] }
// plus topology analysis used both by the tests and by the CLI report.

import { triArea, triCross, normalize } from './vec.js';

export const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Map undirected edge key -> list of { face, from, to } directed uses. */
export function edgeUses(mesh) {
  const uses = new Map();
  mesh.faces.forEach((f, fi) => {
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const key = edgeKey(a, b);
      let list = uses.get(key);
      if (!list) uses.set(key, (list = []));
      list.push({ face: fi, from: a, to: b });
    }
  });
  return uses;
}

/**
 * Full topology report. A mesh is a valid oriented 2-manifold (with boundary)
 * when every edge has one or two faces, two-face edges are used in opposite
 * directions, each vertex's faces form a single fan, and no face is
 * degenerate or duplicated.
 */
export function analyze(mesh) {
  const { positions, faces } = mesh;
  const uses = edgeUses(mesh);
  let boundaryEdges = 0, nonManifoldEdges = 0, misoriented = 0;
  for (const list of uses.values()) {
    if (list.length === 1) boundaryEdges++;
    else if (list.length === 2) {
      if (list[0].from === list[1].from) misoriented++;
    } else nonManifoldEdges++;
  }

  let degenerate = 0, duplicate = 0, area = 0;
  const seen = new Set();
  for (const f of faces) {
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) degenerate++;
    else {
      const a = triArea(positions[f[0]], positions[f[1]], positions[f[2]]);
      if (!(a > 0)) degenerate++;
      area += a;
    }
    const key = [...f].sort((x, y) => x - y).join(',');
    if (seen.has(key)) duplicate++;
    seen.add(key);
  }

  // Vertex fans: faces around v must be connected through edges incident to v.
  const vf = vertexFaces(mesh);
  let nonManifoldVertices = 0;
  const used = new Set();
  vf.forEach((list, v) => {
    if (list.length === 0) return;
    used.add(v);
    if (fanComponents(faces, list, v) !== 1) nonManifoldVertices++;
  });

  const V = used.size, E = uses.size, F = faces.length;
  const valid =
    nonManifoldEdges === 0 && misoriented === 0 && degenerate === 0 &&
    duplicate === 0 && nonManifoldVertices === 0;
  return {
    vertices: V, edges: E, faces: F, euler: V - E + F,
    boundaryEdges, boundaryLoops: countBoundaryLoops(uses),
    nonManifoldEdges, nonManifoldVertices, misoriented, degenerate, duplicate,
    area, valid,
  };
}

export function vertexFaces(mesh) {
  const vf = mesh.positions.map(() => []);
  mesh.faces.forEach((f, fi) => f.forEach((v) => vf[v].push(fi)));
  return vf;
}

function fanComponents(faces, list, v) {
  // Union faces sharing an edge (v, w).
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byOther = new Map();
  list.forEach((fi, i) => {
    for (const w of faces[fi]) {
      if (w === v) continue;
      if (byOther.has(w)) parent[find(i)] = find(byOther.get(w));
      else byOther.set(w, i);
    }
  });
  let n = 0;
  parent.forEach((_, i) => { if (find(i) === i) n++; });
  return n;
}

function countBoundaryLoops(uses) {
  const next = new Map();
  for (const list of uses.values()) {
    if (list.length === 1) next.set(list[0].from, list[0].to);
  }
  const visited = new Set();
  let loops = 0;
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    loops++;
    let v = start;
    while (v !== undefined && !visited.has(v)) {
      visited.add(v);
      v = next.get(v);
    }
  }
  return loops;
}

export function faceNormals(mesh) {
  const p = mesh.positions;
  return mesh.faces.map((f) => normalize(triCross(p[f[0]], p[f[1]], p[f[2]])));
}

export function boundingBox(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const q of positions) {
    for (let k = 0; k < 3; k++) {
      if (q[k] < min[k]) min[k] = q[k];
      if (q[k] > max[k]) max[k] = q[k];
    }
  }
  return { min, max, diagonal: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) };
}

/** Drop unreferenced vertices and renumber; returns a new mesh. */
export function compact(positions, faces) {
  const remap = new Map();
  const outP = [], outF = [];
  for (const f of faces) {
    outF.push(f.map((v) => {
      if (!remap.has(v)) {
        remap.set(v, outP.length);
        outP.push([...positions[v]]);
      }
      return remap.get(v);
    }));
  }
  return { positions: outP, faces: outF };
}

/** Merge vertices that sit at identical coordinates (common in STL-like OBJ exports). */
export function weld(mesh, tolerance = 0) {
  const key = (p) => tolerance > 0
    ? p.map((x) => Math.round(x / tolerance)).join(',')
    : p.join(',');
  const map = new Map();
  const remap = mesh.positions.map((p, i) => {
    const k = key(p);
    if (!map.has(k)) map.set(k, i);
    return map.get(k);
  });
  const faces = mesh.faces
    .map((f) => f.map((v) => remap[v]))
    .filter((f) => f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]);
  return compact(mesh.positions, faces);
}
