import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplify } from '../src/simplify.js';
import { analyze, faceNormals, boundingBox, edgeUses } from '../src/mesh.js';
import { icosphere, torus, grid, asteroid } from '../src/generators.js';
import { surfaceDeviation, signedVolume, surfaceArea } from '../src/metrics.js';

const closedFixtures = [
  ['icosphere', () => icosphere(4), 2],
  ['torus', () => torus(48, 24), 0],
  ['asteroid', () => asteroid(4), 2],
];

for (const [name, make, euler] of closedFixtures) {
  test(`${name}: topology survives every reduction level`, () => {
    const input = make();
    for (const ratio of [0.5, 0.2, 0.05, 0.01]) {
      const { mesh, stats } = simplify(input, { targetRatio: ratio });
      const a = analyze(mesh);
      assert.ok(a.valid, `${name} @ ${ratio} not a clean manifold: ${JSON.stringify(a)}`);
      assert.equal(a.euler, euler, `${name} @ ${ratio} changed genus`);
      assert.equal(a.boundaryEdges, 0, `${name} @ ${ratio} tore a hole`);
      assert.ok(a.faces <= Math.floor(input.faces.length * ratio) || stats.collapses === 0);
      assert.ok(signedVolume(mesh) > 0, `${name} @ ${ratio} turned inside out`);
    }
  });
}

test('hits the requested face count exactly or one below', () => {
  const input = icosphere(4);
  for (const target of [3000, 1000, 101, 50]) {
    const { mesh } = simplify(input, { targetFaces: target });
    // A closed-mesh collapse removes exactly 2 faces, so parity may leave us one short.
    assert.ok(mesh.faces.length === target || mesh.faces.length === target - 1, `${target} -> ${mesh.faces.length}`);
  }
});

test('reduces a sphere all the way to a tetrahedron and no further', () => {
  const { mesh } = simplify(icosphere(2), { targetFaces: 0 });
  const a = analyze(mesh);
  assert.equal(a.faces, 4);
  assert.equal(a.vertices, 4);
  assert.ok(a.valid);
});

test('surface deviation shrinks as more faces are kept', () => {
  const input = asteroid(4);
  let prev = Infinity;
  for (const ratio of [0.01, 0.03, 0.1, 0.3]) {
    const { mesh } = simplify(input, { targetRatio: ratio });
    const d = surfaceDeviation(input, mesh, 1).hausdorff;
    assert.ok(d < prev, `ratio ${ratio}: ${d} !< ${prev}`);
    prev = d;
  }
  assert.ok(prev < 0.01, `30% of faces should be visually lossless, got ${prev}`);
});

test('quadric metric beats the shortest-edge baseline at equal face budget', () => {
  const input = asteroid(4);
  for (const ratio of [0.1, 0.03]) {
    const qem = surfaceDeviation(input, simplify(input, { targetRatio: ratio }).mesh, 1);
    const naive = surfaceDeviation(input, simplify(input, { targetRatio: ratio, metric: 'edge-length' }).mesh, 1);
    assert.ok(qem.hausdorff < naive.hausdorff * 0.6, `qem ${qem.hausdorff} vs naive ${naive.hausdorff}`);
    assert.ok(qem.rms < naive.rms);
  }
});

test('flat grid collapses to two triangles with zero error and an exact outline', () => {
  const input = grid(16);
  const { mesh, stats } = simplify(input, { targetFaces: 0, maxError: 1e-12 });
  assert.equal(mesh.faces.length, 2);
  assert.ok(stats.maxError < 1e-12);
  const bb = boundingBox(mesh.positions);
  assert.deepEqual(bb.min.map((x) => Math.abs(x)), [0, 0, 0]);
  assert.deepEqual(bb.max.map((x) => Math.abs(x)), [1, 1, 0]);
  assert.ok(Math.abs(surfaceArea(mesh) - 1) < 1e-12);
  for (const n of faceNormals(mesh)) assert.ok(n[2] > 0.999999);
});

test('maxError alone stops simplification at the error budget', () => {
  const input = torus(48, 24);
  const loose = simplify(input, { targetFaces: 0, maxError: 1e-4 });
  const tight = simplify(input, { targetFaces: 0, maxError: 1e-6 });
  assert.ok(tight.mesh.faces.length > loose.mesh.faces.length);
  assert.ok(loose.stats.maxError <= 1e-4 && tight.stats.maxError <= 1e-6);
  assert.ok(analyze(loose.mesh).valid && analyze(tight.mesh).valid);
});

test('open terrain keeps one boundary loop and its outline', () => {
  const input = grid(32, (x, y) => 0.2 * Math.sin(6 * x) * Math.cos(5 * y));
  const { mesh } = simplify(input, { targetRatio: 0.08 });
  const a = analyze(mesh);
  assert.ok(a.valid);
  assert.equal(a.euler, 1);
  assert.equal(a.boundaryLoops, 1);
  // Boundary planes are soft (weighted) constraints, so corners may drift a
  // little, but only by a small fraction of the 1 x 1 domain. lockBoundary
  // (tested below) is the exact version.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const d = Math.min(...mesh.positions.map((p) => Math.hypot(p[0] - x, p[1] - y)));
    assert.ok(d < 5e-3, `corner ${x},${y} drifted ${d}`);
  }
});

test('lockBoundary leaves every border vertex exactly where it was', () => {
  const input = grid(20, (x, y) => 0.1 * Math.sin(9 * x + 4 * y));
  const borderBefore = new Set();
  for (const [, list] of edgeUses(input)) {
    if (list.length === 1) borderBefore.add(input.positions[list[0].from].join(','));
  }
  const { mesh } = simplify(input, { targetRatio: 0.1, lockBoundary: true });
  const borderAfter = [];
  for (const [, list] of edgeUses(mesh)) {
    if (list.length === 1) borderAfter.push(mesh.positions[list[0].from].join(','));
  }
  assert.equal(borderAfter.length, borderBefore.size);
  for (const k of borderAfter) assert.ok(borderBefore.has(k));
  assert.ok(analyze(mesh).valid);
});

test('no surviving face flips relative to the surface it approximates', () => {
  // On a sphere centred at the origin every outward normal must point away from the centre.
  const { mesh } = simplify(icosphere(4), { targetRatio: 0.02 });
  const P = mesh.positions;
  faceNormals(mesh).forEach((n, i) => {
    const f = mesh.faces[i];
    const c = [0, 1, 2].map((k) => (P[f[0]][k] + P[f[1]][k] + P[f[2]][k]) / 3);
    assert.ok(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0, `face ${i} faces inward`);
  });
});

test('runs are deterministic and do not mutate the input', () => {
  const input = asteroid(3);
  const snapshot = JSON.stringify(input);
  const a = simplify(input, { targetRatio: 0.1 });
  const b = simplify(input, { targetRatio: 0.1 });
  assert.equal(JSON.stringify(input), snapshot);
  assert.deepEqual(a.mesh, b.mesh);
});

test('onCollapse reports every collapse with non-decreasing face counts going down', () => {
  const records = [];
  const { stats } = simplify(icosphere(3), { targetRatio: 0.25, onCollapse: (r) => records.push(r) });
  assert.equal(records.length, stats.collapses);
  for (let i = 1; i < records.length; i++) assert.ok(records[i].faces < records[i - 1].faces);
});
