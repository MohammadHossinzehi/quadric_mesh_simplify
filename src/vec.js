// Tiny 3-vector helpers. Vectors are plain [x, y, z] arrays so meshes stay
// trivially serialisable and nothing here allocates more than it must.

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.sqrt(dot(a, a));
export const dist = (a, b) => length(sub(a, b));
export const lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export function normalize(a) {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Unnormalised triangle normal; its length is twice the triangle area. */
export const triCross = (a, b, c) => cross(sub(b, a), sub(c, a));
export const triArea = (a, b, c) => 0.5 * length(triCross(a, b, c));
