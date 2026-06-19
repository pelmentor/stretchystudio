// @ts-check

/**
 * Shared bake-reprojection helpers for "fold the posed viewport into the rest
 * geometry" operations — Apply Armature (per-part) and Apply Pose as Rest
 * (whole armature). Pure functions, no store/IO, so both callers and tests
 * import them without an import cycle.
 *
 * Core problem they solve: a baked part keeps its deformer chain, and the eval
 * reads the runtime keyform in the LEAF modifier's LOCAL frame (warp →
 * normalized-0to1, rotation → pivot-relative, root → canvas-px). Writing the
 * baked CANVAS-px verts verbatim makes the eval re-interpret e.g. x=787 as a
 * normalized coord and denormalize it by the warp rest bbox → far off-canvas
 * ("the arm disappears"). We reproject the baked canvas verts into the leaf's
 * local frame via the affine map recovered from the part's OWN rest
 * correspondence (mesh.vertices canvas ↔ rest keyform local) — exact because
 * SS rest grids are uniform (affine lift), so it round-trips even for posed
 * verts outside the rest bbox.
 *
 * @module io/live2d/rig/leafFrameReproject
 */

/**
 * Least-squares fit of a 2D affine map  out = A·in + t  (6 params) from
 * corresponding flat point arrays. Returns the map plus its max residual on the
 * input pairs so callers can reject a NON-affine correspondence (a non-uniform
 * cage) instead of silently reprojecting through a bad map.
 *
 * @param {number[]|Float32Array} src  flat [x0,y0,x1,y1,...] (input space)
 * @param {number[]|Float32Array} dst  flat, same length (output space)
 * @returns {{ map: (x:number,y:number)=>[number,number], residual: number }|null}
 */
export function fitAffine2D(src, dst) {
  const n = src.length >> 1;
  if (n < 3 || dst.length !== src.length) return null;
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0;
  let Ux = 0, Uy = 0, U1 = 0, Vx = 0, Vy = 0, V1 = 0;
  for (let i = 0; i < n; i++) {
    const x = src[2 * i], y = src[2 * i + 1];
    const u = dst[2 * i], v = dst[2 * i + 1];
    Sxx += x * x; Sxy += x * y; Sx += x; Syy += y * y; Sy += y;
    Ux += u * x; Uy += u * y; U1 += u;
    Vx += v * x; Vy += v * y; V1 += v;
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const solve = (b) => {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c];
      for (let k = c; k < 4; k++) M[c][k] /= d;
      for (let r = 0; r < 3; r++) if (r !== c) {
        const f = M[r][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3], M[1][3], M[2][3]];
  };
  const ax = solve([Ux, Uy, U1]);
  const ay = solve([Vx, Vy, V1]);
  if (!ax || !ay) return null;
  const map = /** @type {(x:number,y:number)=>[number,number]} */ (
    (x, y) => [ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]]
  );
  let residual = 0;
  for (let i = 0; i < n; i++) {
    const [u, v] = map(src[2 * i], src[2 * i + 1]);
    residual = Math.max(residual, Math.hypot(u - dst[2 * i], v - dst[2 * i + 1]));
  }
  return { map, residual };
}

/** Flatten an `{x,y}[]` vertex array to `[x0,y0,x1,y1,...]`. */
export function flattenObjVerts(verts) {
  const out = new Array(verts.length * 2);
  for (let i = 0; i < verts.length; i++) { out[2 * i] = verts[i].x; out[2 * i + 1] = verts[i].y; }
  return out;
}

/**
 * Reproject baked CANVAS-px verts into the part's surviving leaf-modifier local
 * frame so the kept deformer chain re-applies correctly. For a ROOT leaf (no
 * warp/rotation modifier) the keyform IS canvas-px → verbatim. Otherwise fit
 * the affine canvas→local map from the part's CURRENT rest correspondence
 * (mesh.vertices ↔ rest keyform) and apply it to the baked verts.
 *
 * Call BEFORE overwriting mesh.vertices / mesh.runtime — it reads the old rest
 * correspondence to recover the map.
 *
 * @param {object} part  the part node (carries `modifiers`)
 * @param {object} mesh  resolved mesh datablock (vertices + runtime.keyforms)
 * @param {Array<{x:number,y:number}>} baseVerts  baked posed canvas verts
 * @returns {{ ok: boolean, keyformVerts: number[]|null, reason: string|null }}
 */
export function reprojectBakeToLeafFrame(part, mesh, baseVerts) {
  const stack = Array.isArray(part?.modifiers) ? part.modifiers : [];
  const leafMod = stack.find((m) => m && m.type !== 'armature' && m.enabled !== false
    && (m.type === 'lattice' || m.type === 'warp' || m.type === 'rotation'));
  if (!leafMod) {
    // Root leaf — keyform is canvas-px verbatim.
    const flat = new Array(baseVerts.length * 2);
    for (let i = 0; i < baseVerts.length; i++) { flat[2 * i] = baseVerts[i].x; flat[2 * i + 1] = baseVerts[i].y; }
    return { ok: true, keyformVerts: flat, reason: null };
  }
  const kfs = Array.isArray(mesh?.runtime?.keyforms) ? mesh.runtime.keyforms : null;
  const restKf = kfs
    ? (kfs.find((k) => !Array.isArray(k.keyTuple) || k.keyTuple.length === 0 || k.keyTuple.every((v) => v === 0)) ?? kfs[0])
    : null;
  const restLocal = restKf && (ArrayBuffer.isView(restKf.vertexPositions) || Array.isArray(restKf.vertexPositions))
    ? restKf.vertexPositions : null;
  const restVerts = Array.isArray(mesh?.vertices) ? mesh.vertices : null;
  if (!restLocal || !restVerts || restLocal.length !== restVerts.length * 2) {
    return { ok: false, keyformVerts: null, reason: 'reproject-no-rest-keyform' };
  }
  const fit = fitAffine2D(flattenObjVerts(restVerts), restLocal);
  if (!fit || fit.residual > 1e-2) {
    return { ok: false, keyformVerts: null, reason: 'reproject-non-affine' };
  }
  const keyformVerts = new Array(baseVerts.length * 2);
  for (let i = 0; i < baseVerts.length; i++) {
    const [u, v] = fit.map(baseVerts[i].x, baseVerts[i].y);
    keyformVerts[2 * i] = u;
    keyformVerts[2 * i + 1] = v;
  }
  return { ok: true, keyformVerts, reason: null };
}
