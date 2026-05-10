// @ts-check

/**
 * Toolset Plan Phase 4.C — Subdivide operator.
 *
 * Inserts midpoints on the edges of selected triangles and replaces
 * each subdivided triangle with four sub-triangles. Matches Blender's
 * `MESH_OT_subdivide` core (`editors/mesh/editmesh_subdivide.cc`):
 *
 *   For triangle (A, B, C) with edges (AB, BC, CA), insert midpoints
 *   M_AB, M_BC, M_CA and emit four triangles:
 *     (A,    M_AB, M_CA)
 *     (B,    M_BC, M_AB)
 *     (C,    M_CA, M_BC)
 *     (M_AB, M_BC, M_CA)   ← centre triangle
 *
 * **Selection scope.** A triangle is subdivided when ≥2 of its verts
 * are selected (matches Blender — at least one full edge must lie in
 * the selection for the cut to make sense). Unselected triangles
 * passthrough unchanged.
 *
 * **Number of Cuts (1..6).** Each cut subdivides the *current* mesh,
 * so cuts=2 → 4× density per selected triangle, cuts=3 → 16×, etc.
 * Implemented as repeated single-cut passes — each pass re-evaluates
 * which triangles contain ≥2 selected verts (post-op selection grows
 * via `vertexIndexRemap` so cuts compose naturally).
 *
 * **Smoothness (0..1).** New midpoint positions are pulled toward a
 * Catmull-Clark-style smoothed target by `lerp(midpoint, smoothed,
 * smoothness)`. The smoothed target for a midpoint on edge (A, B) is:
 *
 *   smoothed = midpoint + 0.25 * (avg(A's neighbours) - avg(C's
 *              neighbours when C is the opposite vertex on the other
 *              triangle sharing edge AB))   [3D Catmull-Clark]
 *
 * Our 2D variant simplifies to: `smoothed = avg(midpoint of every
 * edge incident to A or B)` — the natural Loop-subdivision-style
 * 2D analogue. Smoothness=0 → strict midpoint (Blender default);
 * smoothness=1 → fully Catmull-Clark-like smoothing.
 *
 * **Per-vertex data.** New midpoint verts get the average of their
 * two endpoint values via `vertexSources[newIdx] = [a_old, b_old]`.
 *
 * @module v3/operators/edit/subdivide
 */

import {
  edgeKey, removeDegenerateTriangles, identityVertexSources,
  identityVertexIndexRemap,
} from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/**
 * Run a single subdivision pass. Internal helper for `subdivide` (which
 * calls it `cuts` times).
 *
 * Returns a `TopologyOpResult` with `vertexSources` mapping new midpoint
 * indices to their `[a_old, b_old]` endpoint pair so the dispatcher
 * can interpolate per-vertex data.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Set<number>} selection
 * @param {number} smoothness
 * @returns {TopologyOpResult|null}
 */
function singleCut(mesh, selection, smoothness) {
  // Pre-pass: which triangles get subdivided this cut?
  /** @type {boolean[]} */
  const subdivideThis = new Array(mesh.triangles.length);
  let anySubdivided = false;
  for (let t = 0; t < mesh.triangles.length; t++) {
    const [a, b, c] = mesh.triangles[t];
    let n = 0;
    if (selection.has(a)) n++;
    if (selection.has(b)) n++;
    if (selection.has(c)) n++;
    subdivideThis[t] = n >= 2;
    if (subdivideThis[t]) anySubdivided = true;
  }
  if (!anySubdivided) return null;

  // First pass: enumerate every edge that needs a midpoint. An edge
  // shared by two subdivided triangles must yield exactly one midpoint
  // (no duplicate verts), so we cache by canonical edge key.
  /** @type {Map<string, {midIdx:number, a:number, b:number}>} */
  const midpoints = new Map();
  const newVertices = mesh.vertices.map((v) => ({ ...v }));
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexSources.set(i, [i]);

  function getOrCreateMidpoint(a, b) {
    const k = edgeKey(a, b);
    const existing = midpoints.get(k);
    if (existing) return existing.midIdx;
    const va = newVertices[a];
    const vb = newVertices[b];
    const mx = (va.x + vb.x) * 0.5;
    const my = (va.y + vb.y) * 0.5;
    const mrx = ((va.restX ?? va.x) + (vb.restX ?? vb.x)) * 0.5;
    const mry = ((va.restY ?? va.y) + (vb.restY ?? vb.y)) * 0.5;
    const midIdx = newVertices.length;
    newVertices.push({ x: mx, y: my, restX: mrx, restY: mry });
    vertexSources.set(midIdx, [a, b]);
    midpoints.set(k, { midIdx, a, b });
    return midIdx;
  }

  // Adjacent-edges per ENDPOINT vert — used for the smoothness pull.
  // Built lazily so unsubdivided edges don't pay the cost.
  /** @type {Map<number, number[]>|null} */
  let adjForSmooth = null;
  function buildAdjForSmooth() {
    /** @type {Map<number, Set<number>>} */
    const adj = new Map();
    for (const [a, b, c] of mesh.triangles) {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (!adj.has(u)) adj.set(u, new Set());
        if (!adj.has(v)) adj.set(v, new Set());
        /** @type {Set<number>} */ (adj.get(u)).add(v);
        /** @type {Set<number>} */ (adj.get(v)).add(u);
      }
    }
    /** @type {Map<number, number[]>} */
    const out = new Map();
    for (const [k, set] of adj) out.set(k, Array.from(set));
    return out;
  }

  // Build new triangle list.
  /** @type {Array<TriIndex>} */
  const newTris = [];
  for (let t = 0; t < mesh.triangles.length; t++) {
    const tri = mesh.triangles[t];
    if (!subdivideThis[t]) {
      newTris.push([tri[0], tri[1], tri[2]]);
      continue;
    }
    const [a, b, c] = tri;
    const mAB = getOrCreateMidpoint(a, b);
    const mBC = getOrCreateMidpoint(b, c);
    const mCA = getOrCreateMidpoint(c, a);
    newTris.push([a,   mAB, mCA]);
    newTris.push([b,   mBC, mAB]);
    newTris.push([c,   mCA, mBC]);
    newTris.push([mAB, mBC, mCA]);
  }

  // Smoothness pass: pull each midpoint toward the Loop-subdivision-
  // style smoothed position. avg-of-endpoint-neighbour-positions.
  if (smoothness > 0 && midpoints.size > 0) {
    if (!adjForSmooth) adjForSmooth = buildAdjForSmooth();
    for (const { midIdx, a, b } of midpoints.values()) {
      const neighA = adjForSmooth.get(a) ?? [];
      const neighB = adjForSmooth.get(b) ?? [];
      let sx = 0, sy = 0, n = 0;
      for (const nb of neighA) {
        if (nb === b) continue;
        const v = newVertices[nb];
        sx += v.x; sy += v.y; n += 1;
      }
      for (const nb of neighB) {
        if (nb === a) continue;
        const v = newVertices[nb];
        sx += v.x; sy += v.y; n += 1;
      }
      if (n === 0) continue;
      const sxAvg = sx / n;
      const syAvg = sy / n;
      const cur = newVertices[midIdx];
      cur.x = cur.x + (sxAvg - cur.x) * smoothness;
      cur.y = cur.y + (syAvg - cur.y) * smoothness;
      cur.restX = cur.x;
      cur.restY = cur.y;
    }
  }

  // UVs: midpoint UV = average of endpoint UVs.
  const uvs = new Float32Array(newVertices.length * 2);
  for (let i = 0; i < mesh.vertices.length; i++) {
    uvs[i * 2]     = mesh.uvs[i * 2]     ?? 0;
    uvs[i * 2 + 1] = mesh.uvs[i * 2 + 1] ?? 0;
  }
  for (const { midIdx, a, b } of midpoints.values()) {
    const ua = mesh.uvs[a * 2]     ?? 0;
    const va = mesh.uvs[a * 2 + 1] ?? 0;
    const ub = mesh.uvs[b * 2]     ?? 0;
    const vb = mesh.uvs[b * 2 + 1] ?? 0;
    uvs[midIdx * 2]     = (ua + ub) * 0.5;
    uvs[midIdx * 2 + 1] = (va + vb) * 0.5;
  }

  // Edge-indices: midpoints on a boundary edge inherit boundary status
  // (both endpoints in `edgeIndices`). Existing edge verts stay.
  /** @type {Set<number>} */
  const edgeIndices = new Set(mesh.edgeIndices ?? []);
  if (mesh.edgeIndices) {
    for (const { midIdx, a, b } of midpoints.values()) {
      if (mesh.edgeIndices.has(a) && mesh.edgeIndices.has(b)) {
        edgeIndices.add(midIdx);
      }
    }
  }

  // vertexIndexRemap is identity for surviving original verts; new
  // midpoints have no oldIdx → not in the remap (dispatcher treats
  // unmapped as "kept", which is wrong here — we need them in the
  // remap so the selection-grow step can include the new midpoints).
  /** @type {Map<number, number|null>} */
  const vertexIndexRemap = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexIndexRemap.set(i, i);
  // New midpoints are NOT in the old mesh, so they're not in the
  // remap by definition. The dispatcher's selection-grow step adds
  // them via vertexSources (any newIdx whose sources are all in the
  // pre-op selection joins the post-op selection — see applyTopologyOp).

  return {
    vertices: newVertices,
    uvs,
    triangles: removeDegenerateTriangles(newTris),
    edgeIndices,
    vertexIndexRemap,
    vertexSources,
    retriangulated: true,
  };
}

/**
 * Subdivide selected triangles `cuts` times (each cut subdivides the
 * mesh produced by the previous cut). Smoothness applies on every cut.
 *
 * Returns null when no triangle has ≥2 selected verts (no work to do).
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @param {Object} [opts]
 * @param {number} [opts.cuts=1]            - 1..6 (Blender clamps the
 *                                            UI to this range)
 * @param {number} [opts.smoothness=0]      - 0..1
 * @returns {TopologyOpResult|null}
 */
export function subdivide(mesh, selection, opts = {}) {
  const cuts = Math.max(1, Math.min(6, Math.floor(opts.cuts ?? 1)));
  const smoothness = Math.max(0, Math.min(1, opts.smoothness ?? 0));

  // Run cuts iteratively. Each cut grows selection (new midpoints whose
  // both endpoints were selected → become selected for the NEXT cut).
  let workMesh = mesh;
  let workSel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (workSel.size === 0) return null;

  /** @type {Map<number, number[]>|null} */
  let composedSources = null; // newIdx → ORIGINAL oldIdx[]
  /** @type {Map<number, number|null>|null} */
  let composedRemap = null;   // ORIGINAL oldIdx → final newIdx
  let lastResult = null;
  let didAnyCut = false;

  for (let c = 0; c < cuts; c++) {
    const cutResult = singleCut(workMesh, workSel, smoothness);
    if (!cutResult) break;
    didAnyCut = true;
    lastResult = cutResult;

    // Grow selection by adding new midpoints whose endpoints were
    // both in the prior selection. Endpoint indices in vertexSources
    // refer to the *prior* mesh's indices (workMesh), so we test
    // against `workSel` directly.
    const grown = new Set();
    for (let i = 0; i < cutResult.vertices.length; i++) {
      const sources = cutResult.vertexSources.get(i) ?? [i];
      if (sources.length === 1) {
        if (workSel.has(sources[0])) grown.add(i);
      } else {
        // Midpoint: include if BOTH endpoints were selected.
        const both = sources.every((s) => workSel.has(s));
        if (both) grown.add(i);
      }
    }

    // Compose remap + sources across passes so the FINAL result references
    // the ORIGINAL mesh's vert indices (the dispatcher needs to remap the
    // user's pre-op selection + per-vertex blendShape data).
    if (c === 0) {
      composedRemap = cutResult.vertexIndexRemap;
      composedSources = cutResult.vertexSources;
    } else {
      const newRemap = /** @type {Map<number, number|null>} */ (new Map());
      for (const [origIdx, prevNew] of /** @type {Map<number, number|null>} */ (composedRemap)) {
        if (prevNew == null) {
          newRemap.set(origIdx, null);
          continue;
        }
        const finalNew = cutResult.vertexIndexRemap.get(prevNew);
        newRemap.set(origIdx, finalNew == null ? null : finalNew);
      }
      composedRemap = newRemap;

      // Compose sources: for every newIdx in this pass, pull its prev-pass
      // sources and look them up in composedSources to get original sources.
      /** @type {Map<number, number[]>} */
      const newSources = new Map();
      for (let i = 0; i < cutResult.vertices.length; i++) {
        const prevSrcs = cutResult.vertexSources.get(i) ?? [i];
        const origSrcs = [];
        for (const ps of prevSrcs) {
          const srcs = /** @type {Map<number, number[]>} */ (composedSources).get(ps);
          if (!srcs) continue;
          for (const s of srcs) {
            if (!origSrcs.includes(s)) origSrcs.push(s);
          }
        }
        // Sort so the dispatcher can rely on a deterministic order
        // (deltas/weights averaging is order-independent, but
        // tests can compare arrays directly).
        origSrcs.sort((a, b) => a - b);
        newSources.set(i, origSrcs.length > 0 ? origSrcs : prevSrcs);
      }
      composedSources = newSources;
    }
    workMesh = {
      vertices:    cutResult.vertices,
      uvs:         cutResult.uvs,
      triangles:   cutResult.triangles,
      edgeIndices: cutResult.edgeIndices,
    };
    workSel = grown;
    if (workSel.size === 0) break;
  }

  if (!didAnyCut || !lastResult) return null;
  return {
    vertices:        lastResult.vertices,
    uvs:             lastResult.uvs,
    triangles:       lastResult.triangles,
    edgeIndices:     lastResult.edgeIndices,
    vertexIndexRemap: /** @type {Map<number, number|null>} */ (composedRemap),
    vertexSources:    /** @type {Map<number, number[]>} */ (composedSources),
    retriangulated:  true,
  };
}
