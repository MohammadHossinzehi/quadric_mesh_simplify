# quadric_mesh_simplify

Mesh simplification with quadric error metrics (Garland and Heckbert, SIGGRAPH 1997) in plain JavaScript with zero dependencies. Give it a triangle mesh with 20,000 faces and ask for 1,000; it returns a mesh that still looks like the original, still has the same topology, and comes with a measured answer to "how far did the surface move?".

![demo](https://img.shields.io/badge/demo-open%20demo%2Findex.html-6aa7ff) ![tests](https://img.shields.io/badge/tests-29%20passing-3fb950) ![deps](https://img.shields.io/badge/dependencies-0-lightgrey)

## Why this exists

Every 3D pipeline eventually needs fewer triangles: levels of detail for a game, a preview for a web viewer, a scan that came off a photogrammetry rig with ten million faces. Decimation is easy to get *almost* right and surprisingly hard to get right. A naive edge collapser will happily

* fold a triangle over so it faces inward,
* glue two sheets of the surface together and make the mesh non manifold,
* close a hole in an open surface or chew away its border,
* or shrink a closed object below a tetrahedron into garbage.

This library implements the classic QEM algorithm and then puts every collapse through the checks that production decimators rely on, so the output is always a clean, consistently oriented 2 manifold with the same Euler characteristic as the input. The test suite verifies that property on spheres, tori and open terrain at every reduction level.

## Quick start

Requires Node 18 or newer. Nothing to install.

```bash
git clone https://github.com/MohammadHossinzehi/quadric_mesh_simplify
cd quadric_mesh_simplify
npm test                                   # 29 tests, node:test, about 6 s

node bin/qem.js @asteroid --ratio 0.05 --out asteroid_5pct.obj
node bin/qem.js my_scan.obj --faces 2000 --weld --out my_scan_small.obj
node bin/qem.js @terrain --ratio 0.05 --lock-boundary
node bin/qem.js @torus --max-error 1e-5     # stop at an error budget instead of a face count
```

Sample output:

```
input     10242 vertices, 20480 faces, euler 2, 0 boundary loops
output    514 vertices, 1024 faces, euler 2, 0 boundary loops, manifold true
collapses 9728 in 505.0 ms; rejected {"link":0,"boundary":0,"flip":0,"duplicate":0}
max quadric error 1.013e-6
hausdorff 0.00738 (0.19325% of bbox diagonal), rms 0.00218
wrote asteroid_5pct.obj
```

Inputs starting with `@` are generated procedurally (`@sphere`, `@torus`, `@asteroid`, `@terrain`), so you can try it without hunting for a model.

### Interactive demo

```bash
npm run demo        # or any static file server in the repo root
# open http://localhost:8000/demo/index.html
```

Drag the slider and the mesh is resimplified live. You can switch between the QEM cost and a shortest edge baseline to see the difference, toggle border locking, or drop in your own OBJ. The panel shows face count, Euler characteristic, manifold status, rejected collapses and the sampled Hausdorff distance. The renderer is a tiny painter's algorithm on a 2D canvas, so the page has no dependencies either.

### As a library

```js
import { simplify, parseOBJ, toOBJ, analyze, surfaceDeviation } from './src/index.js';

const mesh = parseOBJ(fs.readFileSync('bunny.obj', 'utf8'));
const { mesh: small, stats } = simplify(mesh, { targetRatio: 0.1 });

analyze(small);                     // { valid: true, euler: 2, boundaryLoops: 0, ... }
surfaceDeviation(mesh, small);      // { hausdorff, forward, backward, rms }
fs.writeFileSync('bunny_10pct.obj', toOBJ(small));
```

| option | default | meaning |
|---|---|---|
| `targetFaces` | | stop once the face count is at or below this |
| `targetRatio` | | same, as a fraction of the input |
| `maxError` | `Infinity` | never perform a collapse whose quadric error exceeds this |
| `boundaryWeight` | `1000` | strength of the constraint planes on open borders |
| `lockBoundary` | `false` | border vertices never move and are never removed |
| `minNormalDot` | `0.2` | reject a collapse that rotates any face by more than acos(0.2), about 78 degrees |
| `maxMoveFactor` | `4` | the optimal point may sit at most this many edge lengths from the edge |
| `areaWeighted` | `true` | weight each face plane by its area |
| `metric` | `'qem'` | `'edge-length'` gives the naive baseline used in the benchmarks |
| `onCollapse` | | callback per collapse, handy for progressive meshes or animation |

With no target at all it halves the face count.

## How it works

**Quadrics.** A plane `n·x + d = 0` measures the squared distance of a point as `(n·p + d)²`, which expands to a quadratic form `pᵀAp + 2bᵀp + c` with `A = nnᵀ`, `b = dn`, `c = d²`. Quadratic forms add, so each vertex stores the sum over its incident faces (ten floats, area weighted) and the sum answers "how far is a point from all of these planes at once". When an edge collapses, the new vertex simply inherits `Q₁ + Q₂`, so error accumulates over the whole history of the region without ever looking at the original mesh again. That is what makes QEM fast and good.

**Where to put the new vertex.** The error is minimised by solving the 3×3 system `Ap = −b` (`src/quadric.js`). On flat or straight regions `A` is singular because a whole plane or line of points is optimal; the singularity test is relative to the scale of `A` so it behaves the same for a model in millimetres or kilometres. When the system is singular, or the solution lands implausibly far from the edge (ill conditioned but technically solvable), the code minimises the quadric exactly along the segment instead, which is a one dimensional quadratic and always well defined.

**Borders.** An open border has no faces on one side, so nothing in the face quadrics stops a border vertex from sliding inward. For every border edge the code adds a heavily weighted plane that contains the edge and is perpendicular to its face. These are soft constraints: corners can drift by a tiny fraction of the model size. If you need borders exactly where they were (tiles that must stitch together, for example), set `lockBoundary`, and then border vertices are pinned and only interior vertices collapse onto them.

**Validity checks before every collapse** (`check` in `src/simplify.js`):

1. *Link condition.* The vertices adjacent to both endpoints must be exactly the apexes of the one or two triangles on the edge. If a third common neighbour exists, collapsing would create a non manifold edge (think of pinching a thin neck). This is the condition from Dey et al. for edge contractions that preserve topology.
2. *No pinched borders.* An interior edge whose two endpoints both lie on a border would weld the border to itself.
3. *No flips or slivers.* Every surviving triangle around the edge is checked before and after; if its normal turns more than the threshold or its area collapses to zero, the move is refused.
4. *No duplicate faces,* which is also what stops a closed mesh at a tetrahedron.

**Priority queue with lazy invalidation.** Candidates live in a binary min heap (`src/heap.js`) keyed by cost with a sequence number tie break, which makes runs fully deterministic. Rather than implementing decrease key, each entry carries version stamps of its two endpoints; when a vertex changes, its version bumps and old entries are dropped as they surface. Edges refused by a check are parked on their endpoints and requeued when their neighbourhood changes, because a collapse that would flip a face now can become perfectly legal after a neighbour moves.

**Measuring the result.** Quadric error is a proxy. `surfaceDeviation` reports what you would actually see: a symmetric Hausdorff distance and RMS deviation, computed by sampling barycentric points on both meshes and finding the exact closest point on the other surface (Ericson's closest point on triangle with all seven Voronoi regions), with a bounding sphere cull so it stays usable on meshes with a few thousand faces.

## Benchmarks

Asteroid fixture, 20,480 faces, deviation as a percentage of the bounding box diagonal, Node 22 on one core:

| kept | QEM Hausdorff | QEM RMS | shortest edge Hausdorff | shortest edge RMS |
|---|---|---|---|---|
| 20% (4,096 faces) | 0.040% | 0.017% | 0.171% | 0.044% |
| 5% (1,024 faces) | 0.193% | 0.057% | 0.726% | 0.200% |
| 1% (204 faces) | 0.870% | 0.269% | 2.692% | 0.968% |

At every budget QEM keeps the surface three to four times closer. A full run on the 20k face model takes about half a second; an 82k face icosphere reduced to 1% takes about two seconds.

## Testing

`npm test` runs 29 tests with the built in `node:test` runner. The emphasis is on invariants, not on snapshot outputs:

* **Quadric math** against brute force: summed quadrics equal summed squared plane distances on random planes, the optimum of three planes is their intersection, no random perturbation beats the optimum, singularity detection is scale invariant, and the segment fallback is exact.
* **Heap order** matches a stable sort under heavy ties.
* **Topology** on sphere, torus and asteroid at 50%, 20%, 5% and 1%: valid oriented manifold, unchanged Euler characteristic, no holes, positive volume.
* **Geometry:** Hausdorff error decreases monotonically as more faces are kept; QEM beats the shortest edge baseline by a wide margin; a flat grid collapses to exactly two triangles at zero error with an exact outline; no face on a simplified sphere points inward.
* **Borders:** terrain keeps a single boundary loop and its corners; `lockBoundary` keeps every border vertex bit for bit.
* **Plumbing:** exact face targets, error budgets, determinism, no mutation of the input, OBJ round trips (including `v/vt/vn`, negative indices and polygon fans), welding of triangle soup, and a topology analyser that catches each kind of defect it claims to.

## Layout

```
src/quadric.js     symmetric 4x4 quadrics, optimum and segment fallback
src/simplify.js    the collapse loop and validity checks
src/heap.js        deterministic binary min heap
src/mesh.js        topology analysis (manifold, orientation, Euler, boundary loops), weld, compact
src/metrics.js     closest point on triangle, sampled Hausdorff, area, signed volume
src/obj.js         OBJ reader and writer
src/generators.js  icosphere, torus, terrain grid, seeded asteroid
bin/qem.js         command line tool
demo/index.html    live browser demo
test/              node:test suites
```

## Limitations and next steps

* Geometry only. UVs, normals and colours are dropped on import; the generalised quadrics of Garland and Heckbert 1998 would carry them through.
* Meshes that are not manifold to begin with are simplified as best as possible (the CLI warns), but the guarantees only hold for clean input. Use `--weld` for exports that store every triangle separately.
* The Hausdorff measurement is brute force with culling. For million face scans you would want a BVH, which is the obvious next addition.

## References

* M. Garland and P. Heckbert, *Surface Simplification Using Quadric Error Metrics*, SIGGRAPH 1997.
* T. Dey, H. Edelsbrunner, S. Guha, D. Nekhayev, *Topology Preserving Edge Contraction*, 1999.
* C. Ericson, *Real Time Collision Detection*, section 5.1.5.

MIT licensed.
