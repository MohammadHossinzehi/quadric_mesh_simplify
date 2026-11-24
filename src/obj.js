// Wavefront OBJ reader and writer for triangle and polygon meshes.
// Supports v / f records with v, v/vt, v//vn and v/vt/vn index forms,
// negative (relative) indices, and fan triangulation of polygons.
// Texture coordinates and normals are ignored: simplification only needs geometry.

export function parseOBJ(text) {
  const positions = [];
  const faces = [];
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln].trim();
    if (line === '' || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      const p = parts.slice(1, 4).map(Number);
      if (p.length < 3 || p.some((x) => !Number.isFinite(x))) {
        throw new Error(`OBJ line ${ln + 1}: bad vertex "${line}"`);
      }
      positions.push(p);
    } else if (parts[0] === 'f') {
      const idx = parts.slice(1).map((tok) => {
        const raw = parseInt(tok.split('/')[0], 10);
        if (!Number.isInteger(raw) || raw === 0) throw new Error(`OBJ line ${ln + 1}: bad index "${tok}"`);
        const i = raw > 0 ? raw - 1 : positions.length + raw;
        if (i < 0 || i >= positions.length) throw new Error(`OBJ line ${ln + 1}: index ${raw} out of range`);
        return i;
      });
      if (idx.length < 3) throw new Error(`OBJ line ${ln + 1}: face needs at least 3 vertices`);
      for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0], idx[k], idx[k + 1]]);
    }
  }
  return { positions, faces };
}

export function toOBJ(mesh, { comment, precision = 6 } = {}) {
  const out = [];
  if (comment) for (const c of String(comment).split('\n')) out.push(`# ${c}`);
  for (const p of mesh.positions) out.push(`v ${p.map((x) => +x.toFixed(precision)).join(' ')}`);
  for (const f of mesh.faces) out.push(`f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}`);
  return out.join('\n') + '\n';
}
