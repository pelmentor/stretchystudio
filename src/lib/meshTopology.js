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
 * Slice a flat UV buffer down to the survivors of a vertex compaction.
 *
 * @param {Float32Array|number[]} oldUvs
 * @param {Map<number, number[]>} vertexSources    - newIdx → oldIdx[]
 * @param {number} newCount
 * @returns {Float32Array}
 */
export function remapUvs(oldUvs, vertexSources, newCount) {
  const out = new Float32Array(newCount * 2);
  for (let i = 0; i < newCount; i++) {
    const sources = vertexSources.get(i) ?? [i];
    if (sources.length === 1) {
      const s = sources[0];
      out[i * 2]     = oldUvs[s * 2]     ?? 0;
      out[i * 2 + 1] = oldUvs[s * 2 + 1] ?? 0;
    } else {
      let su = 0, sv = 0;
      for (const s of sources) {
        su += oldUvs[s * 2]     ?? 0;
        sv += oldUvs[s * 2 + 1] ?? 0;
      }
      out[i * 2]     = su / sources.length;
      out[i * 2 + 1] = sv / sources.length;
    }
  }
  return out;
}

/**
 * Generic per-vertex array remap. Each new vertex pulls from one or
 * more old indices (`vertexSources[newIdx]`), and the caller-supplied
 * `combine` function reduces multiple sources into a single value
 * (typically arithmetic mean). When sources.length === 1 the original
 * value is passed through unchanged (`combine` is bypassed).
 *
 * Used by:
 *   - blendShape deltas (combine = average of dx/dy)
 *   - weightGroup weights (combine = arithmetic mean)
 *
 * @template T
 * @param {ArrayLike<T>} oldArr
 * @param {Map<number, number[]>} vertexSources
 * @param {number} newCount
 * @param {(values: T[]) => T} combine
 * @returns {T[]}
 */
export function remapPerVertexArray(oldArr, vertexSources, newCount, combine) {
  const out = new Array(newCount);
  for (let i = 0; i < newCount; i++) {
    const sources = vertexSources.get(i) ?? [i];
    if (sources.length === 1) {
      out[i] = oldArr[sources[0]];
    } else {
      const values = [];
      for (const s of sources) {
        const v = oldArr[s];
        if (v !== undefined && v !== null) values.push(v);
      }
      out[i] = values.length === 0 ? oldArr[sources[0]] : combine(values);
    }
  }
  return out;
}

/**
 * Average reducer for `{dx, dy}` blendShape delta entries. Skips
 * `null` entries so a merged vert dragged by some shapes but not
 * others doesn't get its delta yanked toward zero by null neighbours.
 *
 * @param {Array<{dx:number, dy:number}|null>} values
 */
export function averageDeltas(values) {
  let dx = 0, dy = 0, n = 0;
  for (const v of values) {
    if (!v) continue;
    dx += v.dx ?? 0;
    dy += v.dy ?? 0;
    n += 1;
  }
  return n === 0 ? null : { dx: dx / n, dy: dy / n };
}

/**
 * Average reducer for numeric weight values.
 *
 * @param {number[]} values
 */
export function averageNumbers(values) {
  let s = 0, n = 0;
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    s += v;
    n += 1;
  }
  return n === 0 ? 0 : s / n;
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
 * Enumerate the one-ring of a vertex — all edges of incident triangles
 * not touching the centre vertex form an ordered polygon ring around
 * the vertex.
 *
 * Returns the ring as an ordered array of vertex indices (CCW or CW
 * depending on triangulation winding) plus a `closed` flag — true when
 * the ring forms a closed loop (interior vertex), false when it's an
 * open path (boundary vertex).
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
