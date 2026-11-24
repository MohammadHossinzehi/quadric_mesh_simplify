// Binary min-heap keyed on a numeric cost, with a deterministic tie-break.
//
// The simplifier uses lazy deletion: instead of decrease-key it pushes a new
// entry and discards stale ones on pop (they carry vertex version stamps).
// That keeps the heap a plain array and is the standard trick for QEM.

export class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  static less(a, b) {
    if (a.cost !== b.cost) return a.cost < b.cost;
    // Tie-break on a monotone sequence number so runs are reproducible.
    return a.seq < b.seq;
  }

  push(item) {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!MinHeap.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  peek() {
    return this.items[0];
  }

  pop() {
    const h = this.items;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && MinHeap.less(h[l], h[m])) m = l;
        if (r < n && MinHeap.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}
