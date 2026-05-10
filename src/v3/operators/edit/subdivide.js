// @ts-check

/**
 * Toolset Plan Phase 4.C — Subdivide operator (Blender-faithful).
 *
 * Inserts midpoints on the edges of selected triangles and replaces
 * each subdivided triangle with `(cuts+1)^2` sub-triangles. Matches
 * Blender's `MESH_OT_subdivide` semantic where "Number of Cuts: N"
 * means N midpoints per edge (so each edge is split into N+1 segments
 * and each parent triangle becomes (N+1)^2 sub-triangles in a single
 * pass).
 *
 *   cuts=1 → 1 midpoint/edge → 4 sub-tris (3 corner + 1 centre)
 *   cuts=2 → 2 midpoints/edge → 9 sub-tris (3 corners + 6 mids + 1 interior)
 *   cuts=3 → 3 midpoints/edge → 16 sub-tris
 *   cuts=N → (N+1)^2 sub-tris per parent
 *
 * Source: `bmesh/operators/bmo_subdivide.cc:440-468` (`bm_subdivide_multicut`).
 *
 * **Selection scope.** A triangle is subdivided when ≥2 of its verts
 * are selected (matches Blender — at least one full edge must lie in
 * the selection for the cut to make sense). Unselected triangles
 * passthrough unchanged.
 *
 * **vertex sources + weights.** Every NEW vertex (edge midpoint or
 * interior) records its source vert(s) AND barycentric/lerp weights:
 *
 *   - Edge midpoint at param t along (a, b): sources=[a,b], weights=[1-t, t]
 *   - Interior vert at barycentric (α, β, γ): sources=[a,b,c], weights=[α,β,γ]
 *
 * The dispatcher (`applyTopologyOp.js`) reads `vertexWeights` and
 * forwards it to `remapPerVertexArray` so blendShape deltas /
 * weightGroups / boneWeights interpolate linearly along the source
 * verts — NOT snapping to the unweighted mean.
 *
 * **Smoothness (0..1).** New midpoints (and interior verts) are
 * pulled toward a neighbour-averaged target by `lerp(midpoint,
 * smoothed, smoothness)`. This is a **deliberate SS deviation** from
 * Blender:
 *
 *   - Blender's `bmo_subdivide.cc:237-368` (`alter_co`) applies a
 *     normal-guided sphere-dual-blend slerp. On flat 2D meshes (every
 *     normal = (0,0,1) by default), Blender's slerp collapses to the
 *     raw linear midpoint, so smoothness>0 has NO visible effect on
 *     2D character art.
 *   - SS uses a Loop-subdivision-style 2D pull: `target = avg of
 *     edge-endpoint neighbour positions`. Smoothness>0 produces
 *     visible smoothing on 2D meshes — useful for character rigging
 *     (eyelid bevels, hair tip curls).
 *
 * `restX`/`restY` are NOT mutated by the smoothness pull — only the
 * pose-space `x`/`y` is. The geometric midpoint stays in `restX`/
 * `restY` so Apply Pose As Rest, rig evaluation, and export read
 * the true rest-mesh midpoint (audit fix G-5).
 *
 * @module v3/operators/edit/subdivide
 */

import {
  edgeKey, removeDegenerateTriangles,
} from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/**
 * Subdivide selected triangles. Single-pass `(cuts+1)^2` density per
 * parent, matching Blender's `MESH_OT_subdivide` semantic.
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
  const sel = new Set(Array.from(selection)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size === 0) return null;

  // Pre-pass: which triangles get subdivided this op?
  /** @type {boolean[]} */
  const subdivideThis = new Array(mesh.triangles.length);
  let anySubdivided = false;
  for (let t = 0; t < mesh.triangles.length; t++) {
    const [a, b, c] = mesh.triangles[t];
    let n = 0;
    if (sel.has(a)) n++;
    if (sel.has(b)) n++;
    if (sel.has(c)) n++;
    subdivideThis[t] = n >= 2;
    if (subdivideThis[t]) anySubdivided = true;
  }
  if (!anySubdivided) return null;

  // Build the new vertex array, sources, and weights. Original verts
  // pass through at the same indices. Edge midpoints are cached by
  // canonical edge key so adjacent triangles share them. Interior
  // verts are NOT shared (they're per-parent-triangle).
  const newVertices = mesh.vertices.map((v) => ({ ...v }));
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  /** @type {Map<number, number[]>} */
  const vertexWeights = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexSources.set(i, [i]);

  // Edge midpoint cache: edgeKey(u, v) → array of `cuts` midpoint
  // indices ordered from min(u,v) → max(u,v). Caller flips the order
  // when querying from the other end.
  /** @type {Map<string, {midIdxs: number[], lo: number, hi: number}>} */
  const edgeMidCache = new Map();

  /**
   * Get or create the `cuts` midpoints along edge (u, v). Returns the
   * midpoint indices in the direction the caller asked (u → v).
   *
   * @param {number} u
   * @param {number} v
   * @returns {number[]}
   */
  function getEdgeMidpoints(u, v) {
    const k = edgeKey(u, v);
    let entry = edgeMidCache.get(k);
    if (!entry) {
      const lo = u < v ? u : v;
      const hi = u < v ? v : u;
      const va = newVertices[lo];
      const vb = newVertices[hi];
      const midIdxs = [];
      for (let i = 0; i < cuts; i++) {
        const t = (i + 1) / (cuts + 1);
        const omt = 1 - t;
        const newIdx = newVertices.length;
        newVertices.push({
          x:     omt * va.x + t * vb.x,
          y:     omt * va.y + t * vb.y,
          restX: omt * (va.restX ?? va.x) + t * (vb.restX ?? vb.x),
          restY: omt * (va.restY ?? va.y) + t * (vb.restY ?? vb.y),
        });
        vertexSources.set(newIdx, [lo, hi]);
        vertexWeights.set(newIdx, [omt, t]);
        midIdxs.push(newIdx);
      }
      entry = { midIdxs, lo, hi };
      edgeMidCache.set(k, entry);
    }
    return u === entry.lo ? entry.midIdxs : entry.midIdxs.slice().reverse();
  }

  /**
   * Build the triangular grid for parent triangle (a, b, c) and emit
   * sub-triangles. Returns the array of new TriIndex triplets.
   *
   * Grid layout — row k (k = 0..S, S = cuts+1) has k+1 points spanning
   * from edge AB midpoint (j=0) to edge AC midpoint (j=k). Row 0 is
   * just A; row S is the base from B to C.
   *
   * Barycentric coords for grid point (k, j), 0 ≤ j ≤ k ≤ S:
   *   alpha = (S - k) / S    (A's weight)
   *   beta  = (k - j) / S    (B's weight)
   *   gamma = j / S          (C's weight)
   *
   * @param {number} a
   * @param {number} b
   * @param {number} c
   */
  function emitParent(a, b, c) {
    const S = cuts + 1; // segments per edge
    const edgeAB = getEdgeMidpoints(a, b); // length = cuts
    const edgeBC = getEdgeMidpoints(b, c);
    const edgeCA = getEdgeMidpoints(c, a); // direction c → a

    // grid[k] = array of (k+1) vertex indices for row k.
    /** @type {number[][]} */
    const grid = new Array(S + 1);
    grid[0] = [a];
    grid[S] = [b, ...edgeBC, c];
    for (let k = 1; k < S; k++) {
      const row = new Array(k + 1);
      // Left endpoint (j=0) is on edge AB at midpoint index k-1.
      row[0] = edgeAB[k - 1];
      // Right endpoint (j=k) is on edge AC at midpoint index k-1.
      // edgeCA goes c → a, so edgeAC[k-1] = edgeCA[(cuts-1) - (k-1)]
      // = edgeCA[cuts - k]. (When traversed a → c, the i-th midpoint
      // counted from A is at index cuts-1-i in the c→a list.)
      row[k] = edgeCA[cuts - k];
      // Interior verts (j=1..k-1) — barycentric weights:
      for (let j = 1; j < k; j++) {
        const alpha = (S - k) / S;
        const beta  = (k - j) / S;
        const gamma = j / S;
        const newIdx = newVertices.length;
        const va = newVertices[a];
        const vb = newVertices[b];
        const vc = newVertices[c];
        newVertices.push({
          x:     alpha * va.x + beta * vb.x + gamma * vc.x,
          y:     alpha * va.y + beta * vb.y + gamma * vc.y,
          restX: alpha * (va.restX ?? va.x) + beta * (vb.restX ?? vb.x) + gamma * (vc.restX ?? vc.x),
          restY: alpha * (va.restY ?? va.y) + beta * (vb.restY ?? vb.y) + gamma * (vc.restY ?? vc.y),
        });
        vertexSources.set(newIdx, [a, b, c]);
        vertexWeights.set(newIdx, [alpha, beta, gamma]);
        row[j] = newIdx;
      }
      grid[k] = row;
    }

    // Emit sub-triangles for each row strip (k → k+1).
    /** @type {Array<TriIndex>} */
    const tris = [];
    for (let k = 0; k < S; k++) {
      const top = grid[k];
      const bot = grid[k + 1];
      for (let j = 0; j < top.length; j++) {
        // Up-pointing tri: (top[j], bot[j], bot[j+1])
        tris.push([top[j], bot[j], bot[j + 1]]);
        // Down-pointing tri (skip last column): (top[j], bot[j+1], top[j+1])
        if (j < top.length - 1) {
          tris.push([top[j], bot[j + 1], top[j + 1]]);
        }
      }
    }
    return tris;
  }

  /** @type {Array<TriIndex>} */
  const newTris = [];
  for (let t = 0; t < mesh.triangles.length; t++) {
    const tri = mesh.triangles[t];
    if (!subdivideThis[t]) {
      newTris.push([tri[0], tri[1], tri[2]]);
      continue;
    }
    const sub = emitParent(tri[0], tri[1], tri[2]);
    for (const s of sub) newTris.push(s);
  }

  // UVs: positionally interpolate per `vertexSources` + `vertexWeights`.
  // For original verts: copy. For edge midpoints: lerp(uv_a, uv_b, t).
  // For interior: barycentric mix of (uv_a, uv_b, uv_c).
  const uvs = new Float32Array(newVertices.length * 2);
  for (let i = 0; i < mesh.vertices.length; i++) {
    uvs[i * 2]     = mesh.uvs[i * 2]     ?? 0;
    uvs[i * 2 + 1] = mesh.uvs[i * 2 + 1] ?? 0;
  }
  for (let i = mesh.vertices.length; i < newVertices.length; i++) {
    const sources = vertexSources.get(i);
    const weights = vertexWeights.get(i);
    if (!sources || !weights) continue;
    let su = 0, sv = 0, totW = 0;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      const w = weights[k] ?? 1;
      su += (mesh.uvs[s * 2]     ?? 0) * w;
      sv += (mesh.uvs[s * 2 + 1] ?? 0) * w;
      totW += w;
    }
    uvs[i * 2]     = totW > 0 ? su / totW : 0;
    uvs[i * 2 + 1] = totW > 0 ? sv / totW : 0;
  }

  // Edge-indices: midpoints on a boundary edge inherit boundary status.
  // Audit fix G-2: query the local Set (mesh.edgeIndices may be a plain
  // Array after save+load — `Array.has` is undefined).
  /** @type {Set<number>} */
  const edgeIndices = new Set(mesh.edgeIndices ?? []);
  for (const entry of edgeMidCache.values()) {
    if (edgeIndices.has(entry.lo) && edgeIndices.has(entry.hi)) {
      for (const midIdx of entry.midIdxs) edgeIndices.add(midIdx);
    }
  }

  // Smoothness pass — Loop-subdivision-style 2D pull. Audit fix G-5
  // preserves restX/restY (the geometric midpoint stays as the rest
  // value; only the pose-space x/y is pulled).
  if (smoothness > 0 && newVertices.length > mesh.vertices.length) {
    // Build adjacency over the OLD mesh (cheap, runs once per op).
    /** @type {Map<number, Set<number>>} */
    const oldAdj = new Map();
    for (const [a, b, c] of mesh.triangles) {
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        if (!oldAdj.has(u)) oldAdj.set(u, new Set());
        if (!oldAdj.has(v)) oldAdj.set(v, new Set());
        /** @type {Set<number>} */ (oldAdj.get(u)).add(v);
        /** @type {Set<number>} */ (oldAdj.get(v)).add(u);
      }
    }
    for (let i = mesh.vertices.length; i < newVertices.length; i++) {
      const sources = vertexSources.get(i);
      if (!sources || sources.length < 2) continue;
      // Smooth target = avg of source endpoints' OLD neighbours
      // (excluding the OTHER source endpoints themselves).
      let sx = 0, sy = 0, n = 0;
      for (const s of sources) {
        const neigh = oldAdj.get(s);
        if (!neigh) continue;
        for (const nb of neigh) {
          if (sources.includes(nb)) continue;
          const v = mesh.vertices[nb];
          sx += v.x; sy += v.y; n += 1;
        }
      }
      if (n === 0) continue;
      const tx = sx / n;
      const ty = sy / n;
      const cur = newVertices[i];
      cur.x = cur.x + (tx - cur.x) * smoothness;
      cur.y = cur.y + (ty - cur.y) * smoothness;
      // restX/restY left untouched (audit fix G-5).
    }
  }

  // vertexIndexRemap is identity for surviving original verts (none
  // deleted by Subdivide). Newly-created verts (midpoints + interior)
  // are NOT in the remap by definition — the dispatcher's "growth"
  // step adds them via vertexSources when both/all sources were in the
  // pre-op selection.
  /** @type {Map<number, number|null>} */
  const vertexIndexRemap = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexIndexRemap.set(i, i);

  return {
    vertices: newVertices,
    uvs,
    triangles: removeDegenerateTriangles(newTris),
    edgeIndices,
    vertexIndexRemap,
    vertexSources,
    vertexWeights,
    retriangulated: true,
  };
}
