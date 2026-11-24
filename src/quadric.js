// Symmetric 4x4 error quadrics (Garland and Heckbert, 1997).
//
// A plane n.x + d = 0 (|n| = 1) defines the squared distance of a point p to
// it as (n.p + d)^2 = p^T (n n^T) p + 2 d n.p + d^2. Summing those terms over
// many planes gives a quadric Q = (A, b, c) with A a symmetric 3x3 matrix, and
// the error of placing a vertex at p is E(p) = p^T A p + 2 b.p + c.
//
// Only the 10 distinct coefficients are stored, in this order:
//   [a00, a01, a02, a11, a12, a22, b0, b1, b2, c]

export class Quadric {
  constructor(coeffs) {
    this.q = coeffs ? Float64Array.from(coeffs) : new Float64Array(10);
  }

  /** Quadric of the plane n.x + d = 0 scaled by weight w. n need not be unit; it is normalised. */
  static fromPlane(n, d, w = 1) {
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l === 0) return new Quadric();
    const a = n[0] / l, b = n[1] / l, c = n[2] / l, dd = d / l;
    return new Quadric([
      w * a * a, w * a * b, w * a * c,
      w * b * b, w * b * c,
      w * c * c,
      w * a * dd, w * b * dd, w * c * dd,
      w * dd * dd,
    ]);
  }

  /** Plane through point p with normal n. */
  static fromPointNormal(p, n, w = 1) {
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l === 0) return new Quadric();
    const u = [n[0] / l, n[1] / l, n[2] / l];
    return Quadric.fromPlane(u, -(u[0] * p[0] + u[1] * p[1] + u[2] * p[2]), w);
  }

  clone() {
    return new Quadric(this.q);
  }

  addInPlace(o) {
    for (let i = 0; i < 10; i++) this.q[i] += o.q[i];
    return this;
  }

  /** out = a + b without allocating; returns out. */
  static sumInto(out, a, b) {
    for (let i = 0; i < 10; i++) out.q[i] = a.q[i] + b.q[i];
    return out;
  }

  plus(o) {
    return this.clone().addInPlace(o);
  }

  /** E(p) = p^T A p + 2 b.p + c. Clamped at zero to hide round-off. */
  evaluate(p) {
    const [a00, a01, a02, a11, a12, a22, b0, b1, b2, c] = this.q;
    const [x, y, z] = p;
    const e =
      a00 * x * x + 2 * a01 * x * y + 2 * a02 * x * z +
      a11 * y * y + 2 * a12 * y * z + a22 * z * z +
      2 * (b0 * x + b1 * y + b2 * z) + c;
    return e > 0 ? e : 0;
  }

  /**
   * Minimiser of E, i.e. the solution of A p = -b, or null when A is too
   * close to singular (flat or straight neighbourhoods have a whole line or
   * plane of minimisers, and the caller should then pick a candidate point).
   * Singularity is judged relative to the scale of A so the test does not
   * depend on the units of the model.
   */
  optimum(relEps = 1e-10) {
    const [a00, a01, a02, a11, a12, a22, b0, b1, b2] = this.q;
    const c00 = a11 * a22 - a12 * a12;
    const c01 = a02 * a12 - a01 * a22;
    const c02 = a01 * a12 - a02 * a11;
    const det = a00 * c00 + a01 * c01 + a02 * c02;
    const s = Math.abs(a00) + Math.abs(a11) + Math.abs(a22);
    if (s === 0 || Math.abs(det) <= relEps * s * s * s) return null;
    const c11 = a00 * a22 - a02 * a02;
    const c12 = a01 * a02 - a00 * a12;
    const c22 = a00 * a11 - a01 * a01;
    const inv = 1 / det;
    // p = -A^{-1} b, with A^{-1} = adj(A) / det and adj symmetric.
    return [
      -(c00 * b0 + c01 * b1 + c02 * b2) * inv,
      -(c01 * b0 + c11 * b1 + c12 * b2) * inv,
      -(c02 * b0 + c12 * b1 + c22 * b2) * inv,
    ];
  }

  /**
   * Minimiser of E restricted to the segment [p, q]. E along the segment is a
   * 1D quadratic in t, so this is exact and always defined; it is the robust
   * fallback when the 3x3 system is singular.
   */
  segmentOptimum(p, q) {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const [a00, a01, a02, a11, a12, a22, b0, b1, b2] = this.q;
    const Ad = [
      a00 * d[0] + a01 * d[1] + a02 * d[2],
      a01 * d[0] + a11 * d[1] + a12 * d[2],
      a02 * d[0] + a12 * d[1] + a22 * d[2],
    ];
    const Ap = [
      a00 * p[0] + a01 * p[1] + a02 * p[2],
      a01 * p[0] + a11 * p[1] + a12 * p[2],
      a02 * p[0] + a12 * p[1] + a22 * p[2],
    ];
    const qa = d[0] * Ad[0] + d[1] * Ad[1] + d[2] * Ad[2];
    const qb = d[0] * (Ap[0] + b0) + d[1] * (Ap[1] + b1) + d[2] * (Ap[2] + b2);
    let t = qa > 1e-300 ? -qb / qa : 0.5;
    if (!(t >= 0)) t = 0;
    if (t > 1) t = 1;
    return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
  }
}
