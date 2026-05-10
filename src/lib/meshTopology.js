// @ts-check

/**
 * Toolset Plan Phase 4 — Shared mesh-topology helpers.
 *
 * Pure utilities used by Merge / Dissolve / Subdivide. No store access,
 * no DOM — every helper takes plain mesh arrays in and returns plain
 * data out so the unit tests can drive them directly.
 *
 * The Phase 4 operator contract returns `TopologyOpResult`:
 *
 *   {
 *     vertices, uvs, triangles, edgeIndices,        // new mesh
 *     vertexIndexRemap: Map<oldIdx, newIdx|null>,   // selection remap
 *     vertexSources:    Map<newIdx, oldIdx[]>,      // per-vertex data
 *                                                     // averaging hint
 *     retriangulated: boolean,                      // true when tris
 *                                                     // were rebuilt
 *   }
 *
 * Per-vertex data (blendShape deltas, weightGroup weights) is rebuilt
 * by `remapPerVertexArray(old, vertexSources, newCount, ...)` — the
 * oldIdx[] is the list of source vertices to average, length-1 means a
 * straight copy, multi-element means arithmetic mean of components.
 *
 * @module lib/meshTopology
 */

/**
 * @typedef {Object} VertexLike
 * @property {number} x
 * @property {number} y
 * @property {number} [restX]
 * @property {number} [restY]
 *
 * @typedef {[number, number, number]} TriIndex
 *
 * @typedef {Object} TopologyOpResult
 * @property {Array<VertexLike>}              vertices
 * @property {Float32Array}                   uvs
 * @property {Array<TriIndex>}                triangles
 * @property {Set<number>}                    edgeIndices
 * @property {Map<number, number|null>}       vertexIndexRemap
 * @property {Map<number, number[]>}          vertexSources
 *   newIdx → array of OLD vertex indices that contributed. Length 1 = straight
 *   copy. Length N = average (or weighted average if `vertexWeights` is set).
 * @property {Map<number, number[]>}          [vertexWeights]
 *   Optional. Parallel to vertexSources — `vertexWeights[i][k]` is the weight
 *   for `vertexSources[i][k]`. When absent, all sources weighted equally
 *   (arithmetic mean). Used by Subdivide to carry barycentric weights for
 *   interior verts and lerp-parameter weights for edge midpoints, so per-
 *   vertex data interpolates linearly along the source-vert positions
 *   instead of snapping to the unweighted mean.
 * @property {Set<number>}                    [selectionOverride]
 *   Optional. When set, the dispatcher uses this Set as the post-op vertex
 *   selection verbatim (instead of the survivor + growth remap). Phase 5
 *   Extrude uses this — Blender's E selects the freshly-duplicated verts
 *   only; the originals stay UNselected so the user immediately drags the
 *   new strip. The growth pass would otherwise leave the source verts
 *   selected (they were selected pre-op + their `vertexSources` entry is
 *   length-1).
 * @property {boolean}                        retriangulated
 */

/** Smaller than any meaningful merge distance — squared. */
const EPS_SQ = 1e-12;

/**
 * Build canonical edge key (min,max,sep) so each undirected edge has a
 * single string id regardless of triangle winding.
 *
 * @param {number} a
 * @param {number} b
 */
export function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * True iff the triangle has zero (or near-zero) area — used to skip
 * degenerate seam triangles when enumerating boundary edges.
 *
 * @param {TriIndex} tri
 * @param {Array<VertexLike>} verts
 * @param {number} [epsArea=1e-9]
 */
export function isDegenerateTri(tri, verts, epsArea = 1e-9) {
  const [a, b, c] = tri;
  if (a === b || b === c || c === a) return true;
  const va = verts[a], vb = verts[b], vc = verts[c];
  if (!va || !vb || !vc) return true;
  const ax = va.x, ay = va.y;
  const bx = vb.x, by = vb.y;
  const cx = vc.x, cy = vc.y;
  // 2× signed area = (b-a) × (c-a)
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return Math.abs(cross) < epsArea;
}

/**
 * Drop triangles with repeated indices (a==b, b==c, c==a). Returns a
 * new array — the input is not mutated.
 *
 * @param {Array<TriIndex>} triangles
 * @returns {Array<TriIndex>}
 */
export function removeDegenerateTriangles(triangles) {
  const out = [];
  for (const t of triangles) {
    const [a, b, c] = t;
    if (a === b || b === c || c === a) continue;
    out.push(t);
  }
  return out;
}

/**
 * Slice a flat UV buffer down to the survivors of a vertex compaction,
 * using `vertexSources` (and optional `vertexWeights` for weighted lerp).
 *
 * @param {Float32Array|number[]} oldUvs
 * @param {Map<number, number[]>} vertexSources    - newIdx → oldIdx[]
 * @param {number} newCount
 * @param {Map<number, number[]>} [vertexWeights]  - optional parallel weights
 * @returns {Float32Array}
 */
export function remapUvs(oldUvs, vertexSources, newCount, vertexWeights = null) {
  const out = new Float32Array(newCount * 2);
  for (let i = 0; i < newCount; i++) {
    const sources = vertexSources.get(i) ?? [i];
    if (sources.length === 1) {
      const s = sources[0];
      out[i * 2]     = oldUvs[s * 2]     ?? 0;
      out[i * 2 + 1] = oldUvs[s * 2 + 1] ?? 0;
    } else {
      const weights = vertexWeights ? vertexWeights.get(i) : null;
      let su = 0, sv = 0, totW = 0;
      for (let k = 0; k < sources.length; k++) {
        const s = sources[k];
        const w = weights ? (weights[k] ?? 1) : 1;
        su += (oldUvs[s * 2]     ?? 0) * w;
        sv += (oldUvs[s * 2 + 1] ?? 0) * w;
        totW += w;
      }
      out[i * 2]     = totW > 0 ? su / totW : 0;
      out[i * 2 + 1] = totW > 0 ? sv / totW : 0;
    }
  }
  return out;
}

/**
 * Generic per-vertex array remap. Each new vertex pulls from one or
 * more old indices (`vertexSources[newIdx]`), and the caller-supplied
 * `combine` function reduces multiple sources into a single value.
 * When sources.length === 1 the original value is passed through
 * unchanged (`combine` is bypassed).
 *
 * Combine is invoked as `combine(values, weights)` — `weights` is null
 * when no `vertexWeights` is provided (callers should treat as
 * arithmetic mean), or a parallel number[] when weights are present
 * (callers should treat as weighted mean — Subdivide uses this for
 * barycentric / lerp interpolation).
 *
 * Note: `values` and `weights` arrays exclude null/undefined source
 * entries (so a sparse blendShape delta map doesn't drag the average
 * toward zero); a caller's combine function must NOT assume the
 * arrays match `sources` length.
 *
 * Used by:
 *   - blendShape deltas (combine = weighted average of dx/dy)
 *   - weightGroup weights (combine = weighted arithmetic mean)
 *
 * @template T
 * @param {ArrayLike<T>} oldArr
 * @param {Map<number, number[]>} vertexSources
 * @param {number} newCount
 * @param {(values: T[], weights: number[]|null) => T} combine
 * @param {Map<number, number[]>} [vertexWeights]
 * @returns {T[]}
 */
export function remapPerVertexArray(oldArr, vertexSources, newCount, combine, vertexWeights = null) {
  const out = new Array(newCount);
  for (let i = 0; i < newCount; i++) {
    const sources = vertexSources.get(i) ?? [i];
    if (sources.length === 1) {
      out[i] = oldArr[sources[0]];
    } else {
      const weightsRaw = vertexWeights ? vertexWeights.get(i) : null;
      /** @type {T[]} */
      const values = [];
      /** @type {number[]} */
      const weights = [];
      for (let k = 0; k < sources.length; k++) {
        const v = oldArr[sources[k]];
        if (v === undefined || v === null) continue;
        values.push(v);
        weights.push(weightsRaw ? (weightsRaw[k] ?? 1) : 1);
      }
      out[i] = values.length === 0 ? oldArr[sources[0]] : combine(values, weightsRaw ? weights : null);
    }
  }
  return out;
}

/**
 * Average reducer for `{dx, dy}` blendShape delta entries. Skips
 * `null` entries so a merged vert dragged by some shapes but not
 * others doesn't get its delta yanked toward zero by null neighbours.
 * When `weights` is non-null, computes a weighted mean (used by
 * Subdivide's barycentric / lerp data interpolation).
 *
 * @param {Array<{dx:number, dy:number}|null>} values
 * @param {number[]|null} [weights]
 */
export function averageDeltas(values, weights = null) {
  let dx = 0, dy = 0, totW = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!v) continue;
    const w = weights ? (weights[i] ?? 1) : 1;
    dx += (v.dx ?? 0) * w;
    dy += (v.dy ?? 0) * w;
    totW += w;
  }
  return totW === 0 ? null : { dx: dx / totW, dy: dy / totW };
}

/**
 * Average reducer for numeric weight values.
 *
 * @param {number[]} values
 * @param {number[]|null} [weights]
 */
export function averageNumbers(values, weights = null) {
  let s = 0, totW = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    const w = weights ? (weights[i] ?? 1) : 1;
    s += v * w;
    totW += w;
  }
  return totW === 0 ? 0 : s / totW;
}

/**
 * Compaction primitive — given a `mergeMap[oldIdx] → groupId`,
 * produces:
 *   - `oldToNew[oldIdx] → newIdx | null`  (null only for explicitly
 *                                           dropped indices, currently
 *                                           unused by merge — dissolve
 *                                           uses a different path)
 *   - `vertexSources[newIdx] → oldIdx[]`   (sorted ascending, stable)
 *   - `newCount`
 *
 * Vertices in the same `groupId` collapse into one new index; the new
 * indices are assigned in the order their first appearance is seen,
 * keeping unmerged verts in their original order at the front of the
 * range when the input has groups [0,1,2,1,3,3] → newIdx [0,1,2,1,3,3]
 * → newCount 4.
 *
 * @param {ArrayLike<number>} mergeMap   - groupId per oldIdx
 * @param {number} oldCount
 * @returns {{oldToNew: Map<number, number>, vertexSources: Map<number, number[]>, newCount: number}}
 */
export function compactByGroups(mergeMap, oldCount) {
  /** @type {Map<number, number>} */
  const groupToNew = new Map();
  /** @type {Map<number, number>} */
  const oldToNew = new Map();
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  let next = 0;
  for (let i = 0; i < oldCount; i++) {
    const g = mergeMap[i];
    let newIdx = groupToNew.get(g);
    if (newIdx === undefined) {
      newIdx = next++;
      groupToNew.set(g, newIdx);
      vertexSources.set(newIdx, []);
    }
    oldToNew.set(i, newIdx);
    /** @type {number[]} */
    (vertexSources.get(newIdx)).push(i);
  }
  return { oldToNew, vertexSources, newCount: next };
}

/**
 * Apply an `oldToNew` index mapping to a triangle list, dropping
 * triangles that collapse to a degenerate after the rewrite.
 *
 * @param {Array<TriIndex>} triangles
 * @param {Map<number, number|null>} oldToNew
 * @returns {Array<TriIndex>}
 */
export function remapTriangles(triangles, oldToNew) {
  /** @type {Array<TriIndex>} */
  const out = [];
  for (const [a, b, c] of triangles) {
    const na = oldToNew.get(a);
    const nb = oldToNew.get(b);
    const nc = oldToNew.get(c);
    if (na == null || nb == null || nc == null) continue;
    if (na === nb || nb === nc || nc === na) continue;
    out.push(/** @type {TriIndex} */ ([na, nb, nc]));
  }
  return out;
}

/**
 * Apply an `oldToNew` index mapping to a Set of edge indices, dropping
 * deleted indices (`oldToNew.get(i) === null`).
 *
 * @param {Set<number>|undefined|null} oldEdgeIndices
 * @param {Map<number, number|null>} oldToNew
 * @returns {Set<number>}
 */
export function remapEdgeIndices(oldEdgeIndices, oldToNew) {
  const out = new Set();
  if (!oldEdgeIndices) return out;
  for (const ei of oldEdgeIndices) {
    const ne = oldToNew.get(ei);
    if (ne != null) out.add(ne);
  }
  return out;
}

/**
 * Build identity vertexSources for a passthrough mesh (no merging).
 * Used by operators that don't merge anything — the dispatcher always
 * runs the per-vertex remap, so even passthroughs need the map.
 *
 * @param {number} count
 */
export function identityVertexSources(count) {
  const out = new Map();
  for (let i = 0; i < count; i++) out.set(i, [i]);
  return out;
}

/**
 * Build identity vertexIndexRemap (oldIdx → oldIdx). Used by passthrough
 * operators.
 *
 * @param {number} count
 */
export function identityVertexIndexRemap(count) {
  const out = new Map();
  for (let i = 0; i < count; i++) out.set(i, i);
  return out;
}

/**
 * Squared 2D distance between two points.
 *
 * @param {VertexLike} a
 * @param {VertexLike} b
 */
export function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * 2D cross product `(b-a) × (c-a)` — sign indicates winding.
 */
export function cross2(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Strict inside-triangle test (excludes the boundary). Used by the
 *  Meisters–Chazelle ear-clip in dissolve.js to verify no other ring
 *  vertex lies inside the candidate ear.
 *
 * @param {VertexLike} p
 * @param {VertexLike} a
 * @param {VertexLike} b
 * @param {VertexLike} c
 */
export function pointInTriangleStrict(p, a, b, c) {
  const d1 = cross2(p.x, p.y, a.x, a.y, b.x, b.y);
  const d2 = cross2(p.x, p.y, b.x, b.y, c.x, c.y);
  const d3 = cross2(p.x, p.y, c.x, c.y, a.x, a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Toolset Plan Phase 5.A — boundary-vertex detection.
 *
 * A boundary edge is one referenced by exactly one *non-degenerate*
 * triangle. A boundary vertex is incident on at least one boundary edge.
 *
 * The non-degenerate filter is load-bearing: Live2D meshes commonly
 * include zero-area "seam" triangles (UV / clip-mask separators) whose
 * collinear edges are referenced by only the seam tri + one neighbour.
 * The naive `count === 1` test would misclassify those edges as
 * boundary, producing a phantom interior boundary that the Extrude op
 * would then duplicate from. Filtering degenerate tris before counting
 * matches the "real geometric perimeter" the user sees in the viewport.
 *
 * Caching: boundary detection is O(triangles) per call. Phase 5's
 * extrude operator reads the boundary set ONCE per click (not per
 * mousemove), so we don't bother caching here — the dispatcher's call
 * site only fires on the operator entry point. Callers that need to
 * walk the boundary repeatedly within the same gesture should cache
 * the Set themselves.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Object} [opts]
 * @param {number} [opts.epsArea=1e-9]   - degenerate-tri area threshold
 * @returns {Set<number>}                 - boundary vertex indices
 */
export function getBoundaryVerts(mesh, opts = {}) {
  const eps = opts.epsArea ?? 1e-9;
  /** @type {Map<string, number>} */
  const edgeUseCount = new Map();
  for (const tri of mesh.triangles) {
    if (isDegenerateTri(tri, mesh.vertices, eps)) continue;
    const [a, b, c] = tri;
    edgeUseCount.set(edgeKey(a, b), (edgeUseCount.get(edgeKey(a, b)) ?? 0) + 1);
    edgeUseCount.set(edgeKey(b, c), (edgeUseCount.get(edgeKey(b, c)) ?? 0) + 1);
    edgeUseCount.set(edgeKey(c, a), (edgeUseCount.get(edgeKey(c, a)) ?? 0) + 1);
  }
  /** @type {Set<number>} */
  const boundary = new Set();
  for (const [key, count] of edgeUseCount) {
    if (count !== 1) continue;
    const [u, v] = key.split(',').map(Number);
    boundary.add(u);
    boundary.add(v);
  }
  return boundary;
}

/**
 * Toolset Plan Phase 5.A — boundary-edge enumeration.
 *
 * Returns the set of boundary edges as `[u, v]` pairs (with u < v),
 * filtered the same way as `getBoundaryVerts`. Phase 5's Extrude needs
 * the actual edges (not just vertex membership) to decide where to
 * link new triangles between the duplicate strip and the original
 * boundary.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Object} [opts]
 * @param {number} [opts.epsArea=1e-9]
 * @returns {Array<[number, number]>}    - sorted (u, v) pairs, u < v
 */
export function getBoundaryEdges(mesh, opts = {}) {
  const eps = opts.epsArea ?? 1e-9;
  /** @type {Map<string, number>} */
  const edgeUseCount = new Map();
  for (const tri of mesh.triangles) {
    if (isDegenerateTri(tri, mesh.vertices, eps)) continue;
    const [a, b, c] = tri;
    edgeUseCount.set(edgeKey(a, b), (edgeUseCount.get(edgeKey(a, b)) ?? 0) + 1);
    edgeUseCount.set(edgeKey(b, c), (edgeUseCount.get(edgeKey(b, c)) ?? 0) + 1);
    edgeUseCount.set(edgeKey(c, a), (edgeUseCount.get(edgeKey(c, a)) ?? 0) + 1);
  }
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const [key, count] of edgeUseCount) {
    if (count !== 1) continue;
    const [u, v] = key.split(',').map(Number);
    out.push([u, v]);
  }
  return out;
}

/**
 * Enumerate the one-ring of a vertex — all edges of incident triangles
 * not touching the centre vertex form an ordered polygon ring around
 * the vertex.
 *
 * Returns the ring as an ordered array of vertex indices (CCW or CW
 * depending on triangulation winding) plus a `closed` flag — true when
 * the ring forms a closed loop (interior vertex), false when it's an
 * open path (boundary vertex). Returns null when the centre has no
 * incident non-degenerate triangle, OR when the local topology is
 * non-manifold (two separate fans connected only at the centre — a
 * "butterfly"). Audit fix G-6: pre-fix the duplicate `next.set(u, v)`
 * silently overwrote, producing a corrupted ring; now we detect and
 * bail so the caller can fall back to dropping the incident triangles
 * without refill.
 *
 * Algorithm: for each triangle (a, b, c) where `centerIdx` ∈ {a,b,c},
 * record the directed edge between the OTHER two verts using the
 * triangle winding (so neighbouring triangles' edges chain). Then walk
 * the chain.
 *
 * @param {Array<TriIndex>} triangles
 * @param {number} centerIdx
 * @returns {{ring: number[], closed: boolean}|null}  null when centre
 *                                                     has no incident
 *                                                     non-degenerate tri
 *                                                     OR topology is
 *                                                     non-manifold
 */
export function enumerateOneRingPolygon(triangles, centerIdx) {
  /** @type {Map<number, number>} */
  const next = new Map();   // u → v   (directed edge u→v, opposite-side
                            // of one incident triangle)
  /** @type {Map<number, number>} */
  const prev = new Map();   // v → u   (inverse, for boundary-walk start)
  for (const [a, b, c] of triangles) {
    if (a === b || b === c || c === a) continue;
    let u, v;
    if      (a === centerIdx) { u = b; v = c; }
    else if (b === centerIdx) { u = c; v = a; }
    else if (c === centerIdx) { u = a; v = b; }
    else continue;
    // Audit fix G-6 — if two triangles around the centre produce the
    // same outgoing edge u→? with different `v`, the local topology
    // is non-manifold (two separate fans joined only at centre). The
    // prior `next.set(u, v)` silently overwrote, corrupting the ring
    // walk. Bail here so the caller treats it as "no refill possible".
    if (next.has(u) || prev.has(v)) return null;
    next.set(u, v);
    prev.set(v, u);
  }
  if (next.size === 0) return null;

  // Find a start vertex: prefer one with no inbound edge (boundary
  // start); otherwise pick any (closed ring).
  let start = null;
  for (const u of next.keys()) {
    if (!prev.has(u)) { start = u; break; }
  }
  let closed = false;
  if (start === null) {
    closed = true;
    start = next.keys().next().value;
  }

  const ring = [start];
  const seen = new Set([start]);
  let cur = start;
  while (true) {
    const nxt = next.get(cur);
    if (nxt === undefined) break;
    if (seen.has(nxt)) {
      // Hit the start = closed loop.
      closed = closed || nxt === start;
      break;
    }
    ring.push(nxt);
    seen.add(nxt);
    cur = nxt;
  }
  return { ring, closed };
}
