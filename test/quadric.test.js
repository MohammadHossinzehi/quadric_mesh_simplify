import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quadric } from '../src/quadric.js';
import { rng } from '../src/generators.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('plane quadric measures squared distance to the plane', () => {
  const q = Quadric.fromPlane([0, 0, 2], -2); // z = 1 after normalisation
  close(q.evaluate([5, -3, 1]), 0);
  close(q.evaluate([0, 0, 4]), 9);
  close(q.evaluate([1, 1, -1]), 4);
});

test('sum of quadrics equals sum of squared distances (random planes)', () => {
  const rand = rng(11);
  for (let trial = 0; trial < 50; trial++) {
    const planes = Array.from({ length: 5 }, () => ({
      n: [rand() - 0.5, rand() - 0.5, rand() - 0.5], d: rand() - 0.5, w: rand() * 3,
    }));
    const Q = new Quadric();
    for (const pl of planes) Q.addInPlace(Quadric.fromPlane(pl.n, pl.d, pl.w));
    const p = [rand() * 4 - 2, rand() * 4 - 2, rand() * 4 - 2];
    let expected = 0;
    for (const { n, d, w } of planes) {
      const l = Math.hypot(...n);
      const s = (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] + d) / l;
      expected += w * s * s;
    }
    close(Q.evaluate(p), expected, 1e-9);
  }
});

test('optimum recovers the intersection point of three planes with zero error', () => {
  const corner = [0.3, -1.2, 2.5];
  const q = Quadric.fromPointNormal(corner, [1, 0, 0])
    .plus(Quadric.fromPointNormal(corner, [0, 1, 1]))
    .plus(Quadric.fromPointNormal(corner, [1, -2, 0.5]));
  const p = q.optimum();
  for (let k = 0; k < 3; k++) close(p[k], corner[k], 1e-9);
  close(q.evaluate(p), 0, 1e-18);
});

test('optimum is a true minimiser: no random perturbation does better', () => {
  const rand = rng(5);
  const q = new Quadric();
  for (let i = 0; i < 8; i++) {
    q.addInPlace(Quadric.fromPlane([rand() - 0.5, rand() - 0.5, rand() - 0.5], rand() - 0.5, 1 + rand()));
  }
  const p = q.optimum();
  const e0 = q.evaluate(p);
  for (let i = 0; i < 200; i++) {
    const r = [p[0] + (rand() - 0.5) * 0.1, p[1] + (rand() - 0.5) * 0.1, p[2] + (rand() - 0.5) * 0.1];
    assert.ok(q.evaluate(r) >= e0 - 1e-12);
  }
});

test('singular systems are detected regardless of model scale', () => {
  // Two planes meet in a line: infinitely many minimisers.
  for (const s of [1e-6, 1, 1e6]) {
    const q = Quadric.fromPlane([1, 0, 0], -s).plus(Quadric.fromPlane([0, 1, 0], s));
    assert.equal(q.optimum(), null, `scale ${s}`);
  }
  assert.equal(new Quadric().optimum(), null);
});

test('segment optimum is exact and clamped to the segment', () => {
  const q = Quadric.fromPlane([1, 0, 0], -0.25); // x = 0.25
  const p = q.segmentOptimum([0, 0, 0], [1, 0, 0]);
  close(p[0], 0.25);
  const clamped = q.segmentOptimum([1, 0, 0], [2, 0, 0]);
  close(clamped[0], 1);
  // A segment parallel to the plane has constant error, so any point is fine but it must be finite.
  const par = q.segmentOptimum([0, 0, 0], [0, 1, 0]);
  assert.ok(par.every(Number.isFinite));
});
