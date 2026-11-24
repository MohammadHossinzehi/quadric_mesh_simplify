#!/usr/bin/env node
// Command line front end: simplify an OBJ file and print a quality report.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  simplify, parseOBJ, toOBJ, analyze, weld, surfaceDeviation, boundingBox,
  icosphere, torus, asteroid, grid,
} from '../src/index.js';

const HELP = `qem: quadric error metric mesh simplification

usage:
  node bin/qem.js <input.obj | @sphere | @torus | @asteroid | @terrain> [options]

options:
  -o, --out <file>       write the simplified mesh as OBJ (default: stdout summary only)
  -r, --ratio <0..1>     keep this fraction of faces (default 0.1)
  -f, --faces <n>        keep at most n faces (overrides --ratio)
  -e, --max-error <x>    stop before any collapse whose quadric error exceeds x
  --lock-boundary        never move or remove vertices on open borders
  --min-normal-dot <d>   flip guard: cosine bound on face rotation (default 0.2)
  --weld                 merge coincident vertices first (for unindexed exports)
  --no-report            skip the Hausdorff measurement (faster on big meshes)
  -h, --help             show this message

built-in inputs start with @ and are generated procedurally.`;

function parseArgs(argv) {
  const a = { ratio: 0.1, report: true };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${t} needs a value`);
      return argv[++i];
    };
    if (t === '-h' || t === '--help') a.help = true;
    else if (t === '-o' || t === '--out') a.out = next();
    else if (t === '-r' || t === '--ratio') a.ratio = Number(next());
    else if (t === '-f' || t === '--faces') a.faces = Number(next());
    else if (t === '-e' || t === '--max-error') a.maxError = Number(next());
    else if (t === '--lock-boundary') a.lockBoundary = true;
    else if (t === '--min-normal-dot') a.minNormalDot = Number(next());
    else if (t === '--weld') a.weld = true;
    else if (t === '--no-report') a.report = false;
    else if (t.startsWith('-')) throw new Error(`unknown option ${t}`);
    else a.input = t;
  }
  return a;
}

function load(input) {
  switch (input) {
    case '@sphere': return icosphere(5);
    case '@torus': return torus(96, 48);
    case '@asteroid': return asteroid(5);
    case '@terrain': return grid(64, (x, y) => 0.15 * Math.sin(7 * x) * Math.cos(5 * y) + 0.05 * Math.sin(23 * x * y));
    default: return parseOBJ(readFileSync(input, 'utf8'));
  }
}

const fmt = (x) => (Math.abs(x) >= 1e-3 || x === 0 ? x.toFixed(5) : x.toExponential(3));

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (args.help || !args.input) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }

  let mesh = load(args.input);
  if (args.weld) mesh = weld(mesh);
  const before = analyze(mesh);
  if (!before.valid) {
    console.error('warning: input is not a clean oriented manifold:', JSON.stringify({
      nonManifoldEdges: before.nonManifoldEdges, nonManifoldVertices: before.nonManifoldVertices,
      misoriented: before.misoriented, degenerate: before.degenerate, duplicate: before.duplicate,
    }));
  }

  const opts = { lockBoundary: args.lockBoundary };
  if (args.faces !== undefined) opts.targetFaces = args.faces;
  else if (args.maxError !== undefined) { opts.maxError = args.maxError; opts.targetFaces = 0; }
  else opts.targetRatio = args.ratio;
  if (args.maxError !== undefined) opts.maxError = args.maxError;
  if (args.minNormalDot !== undefined) opts.minNormalDot = args.minNormalDot;

  const { mesh: out, stats } = simplify(mesh, opts);
  const after = analyze(out);
  const diag = boundingBox(mesh.positions).diagonal;

  console.log(`input     ${before.vertices} vertices, ${before.faces} faces, euler ${before.euler}, ${before.boundaryLoops} boundary loops`);
  console.log(`output    ${after.vertices} vertices, ${after.faces} faces, euler ${after.euler}, ${after.boundaryLoops} boundary loops, manifold ${after.valid}`);
  console.log(`collapses ${stats.collapses} in ${stats.milliseconds.toFixed(1)} ms; rejected ${JSON.stringify(stats.rejected)}`);
  console.log(`max quadric error ${fmt(stats.maxError)}`);
  if (args.report) {
    const d = surfaceDeviation(mesh, out, 1);
    console.log(`hausdorff ${fmt(d.hausdorff)} (${fmt((100 * d.hausdorff) / diag)}% of bbox diagonal), rms ${fmt(d.rms)}`);
  }
  if (args.out) {
    writeFileSync(args.out, toOBJ(out, { comment: `simplified by quadric_mesh_simplify: ${before.faces} -> ${after.faces} faces` }));
    console.log(`wrote ${args.out}`);
  }
}

main();
