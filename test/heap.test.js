import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MinHeap } from '../src/heap.js';
import { rng } from '../src/generators.js';

test('pops in the same order as a stable sort by (cost, seq)', () => {
  const rand = rng(3);
  const heap = new MinHeap();
  const items = [];
  for (let i = 0; i < 2000; i++) {
    // Few distinct costs so the tie-break is exercised heavily.
    const it = { cost: Math.floor(rand() * 20), seq: i };
    items.push(it);
    heap.push(it);
  }
  const expected = [...items].sort((a, b) => a.cost - b.cost || a.seq - b.seq);
  const got = [];
  while (heap.size) got.push(heap.pop());
  assert.deepEqual(got.map((x) => x.seq), expected.map((x) => x.seq));
});

test('interleaved push and pop keep the heap property', () => {
  const rand = rng(9);
  const heap = new MinHeap();
  let seq = 0;
  let lastPopped = -Infinity;
  for (let round = 0; round < 3000; round++) {
    if (rand() < 0.6 || heap.size === 0) {
      // Only push costs >= the last popped one, as the simplifier's lazy queue effectively does.
      heap.push({ cost: lastPopped + rand(), seq: seq++ });
    } else {
      const top = heap.pop();
      assert.ok(top.cost >= lastPopped);
      lastPopped = top.cost;
    }
  }
  assert.equal(new MinHeap().pop(), undefined);
});
