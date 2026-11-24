import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, weld } from '../src/mesh.js';
import { parseOBJ, toOBJ } from '../src/obj.js';
import { icosphere, torus, grid, asteroid } from '../src/generators.js';
import { signedVolume, surfaceArea, closestPointOnTriangle, pointTriangleDistance } from '../src/metrics.js';

test('generators produce clean oriented manifolds with the right topology', () => {
  const s = analyze(icosphere(3));
  assert.equal(s.faces, 20 * 64);
  assert.equal(s.euler, 2);
  assert.ok(s.valid);
  const t = analyze(torus(20, 10));
  assert.equal(t.euler, 0);
  assert.ok(t.valid);
  const g = analyze(grid(8));
  assert.equal(g.euler, 1);
  assert.equal(g.boundaryLoops, 1);
  assert.equal(g.boundaryEdges, 32);
  assert.ok(g.valid);
  assert.ok(analyze(asteroid(3)).valid);
});

test('closed generators are outward oriented (positive volume)', () => {
  assert.ok(signedVolume(icosphere(4)) > 4.1); // approaches 4/3 pi = 4.18879
  assert.ok(signedVolume(torus(64, 32)) > 0);
  assert.ok(Math.abs(surfaceArea(grid(10)) - 1) < 1e-12);
});

test('analyze flags each kind of defect', () => {
  const base = icosphere(1);
  const flipped = { positions: base.positions, faces: base.faces.map((f, i) => (i === 0 ? [f[0], f[2], f[1]] : f)) };
  assert.ok(analyze(flipped).misoriented > 0);

  const dup = { positions: base.positions, faces: [...base.faces, base.faces[3]] };
  const d = analyze(dup);
  assert.ok(d.duplicate === 1 && d.nonManifoldEdges > 0 && !d.valid);

  // Two tetrahedra sharing only a vertex: a non-manifold "bowtie" vertex.
  // Vertex 1 is the only one the two tetrahedra have in common.
  const tet = (o) => [[o, 0, 0], [o + 1, 0, 0], [o, 1, 0], [o, 0, 1]];
  const faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2], [1, 5, 4], [1, 4, 6], [4, 5, 6], [1, 6, 5]];
  const bow = analyze({ positions: [...tet(0), [2, 0, 0], [1, 1, 0], [1, 0, 1]], faces });
  assert.equal(bow.nonManifoldVertices, 1);
  assert.equal(bow.valid, false);

  const degenerate = { positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], faces: [[0, 1, 2]] };
  assert.equal(analyze(degenerate).degenerate, 1);
});

test('OBJ round trip preserves geometry and topology', () => {
  const m = torus(16, 8);
  const back = parseOBJ(toOBJ(m, { comment: 'fixture', precision: 12 }));
  assert.equal(back.faces.length, m.faces.length);
  assert.deepEqual(back.faces, m.faces);
  back.positions.forEach((p, i) => p.forEach((x, k) => assert.ok(Math.abs(x - m.positions[i][k]) < 1e-10)));
});

test('OBJ parser handles slashes, negative indices, polygons and comments', () => {
  const text = `# a unit square as one quad
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vn 0 0 1
f 1/1/1 2/1/1 3//1 -1
`;
  const m = parseOBJ(text);
  assert.deepEqual(m.faces, [[0, 1, 2], [0, 2, 3]]);
  assert.throws(() => parseOBJ('v 0 0 0\nf 1 2 3\n'), /out of range/);
  assert.throws(() => parseOBJ('v 0 0 x\n'), /bad vertex/);
});

test('weld merges an unindexed triangle soup back into a manifold', () => {
  const m = icosphere(2);
  const soup = { positions: [], faces: [] };
  for (const f of m.faces) {
    const base = soup.positions.length;
    for (const v of f) soup.positions.push([...m.positions[v]]);
    soup.faces.push([base, base + 1, base + 2]);
  }
  assert.equal(analyze(soup).boundaryEdges, m.faces.length * 3);
  const w = analyze(weld(soup));
  assert.ok(w.valid);
  assert.equal(w.euler, 2);
  assert.equal(w.vertices, m.positions.length);
});

test('closest point on triangle covers all Voronoi regions', () => {
  const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0];
  assert.deepEqual(closestPointOnTriangle([-1, -1, 0], a, b, c), a);
  assert.deepEqual(closestPointOnTriangle([2, -0.5, 0], a, b, c), b);
  assert.deepEqual(closestPointOnTriangle([-0.2, 3, 0], a, b, c), c);
  assert.deepEqual(closestPointOnTriangle([0.5, -1, 0], a, b, c), [0.5, 0, 0]);
  assert.deepEqual(closestPointOnTriangle([-1, 0.25, 0], a, b, c), [0, 0.25, 0]);
  const hyp = closestPointOnTriangle([1, 1, 0], a, b, c);
  assert.ok(Math.abs(hyp[0] - 0.5) < 1e-12 && Math.abs(hyp[1] - 0.5) < 1e-12);
  assert.ok(Math.abs(pointTriangleDistance([0.2, 0.2, 3], a, b, c) - 3) < 1e-12);
});
