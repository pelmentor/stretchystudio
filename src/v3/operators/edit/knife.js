// @ts-check

/**
 * Edit Mode — Knife (vertex-to-vertex straight-line cut).
 *
 * Two-click cut between existing vertices A and B. The cut line passes
 * from A to B; every triangle the line crosses is subdivided. Where the
 * line crosses a triangle edge between V1 and V2 (neither A nor B), a
 * new vertex is created at the intersection (UVs interpolated linearly).
 *
 * # Scope (v1, 2026-06-04)
 *
 * Vertex-to-vertex only — both click points must snap to existing
 * vertices. No interactive preview overlay in this commit (the operator
 * + state machine ship here; the in-canvas line-drawing overlay is a
 * follow-up slice). No edge-midpoint snapping; no multi-segment paths
 * (each operator call = one straight cut).
 *
 * # Algorithm
 *
 * 1. **Classify triangles by signed-distance signs.** For each triangle
 *    (a, b, c) and the line A→B with normal `n = perp(B - A)`, compute
 *    `s(v) = dot(n, v - A)`. The sign tells which half-plane each vert
 *    sits in. Triangles whose three signs are all the same sign (with
 *    zero treated as either side) are not crossed — preserve verbatim.
 *
 *    Triangles incident to A or B may have one zero distance (the
 *    endpoint vertex) and two non-zero with the same or opposite signs.
 *    Only the "opposite signs across the line" case actually crosses
 *    the triangle interior — that's a SEGMENT that needs splitting at
 *    the far edge.
 *
 * 2. **For each crossed triangle, find the two edges with opposite-sign
 *    endpoints.** These are the edges the cut line actually crosses
 *    (the third edge has same-sign endpoints, so the line doesn't
 *    cross it). For each crossed edge:
 *
 *    a. Compute the intersection parameter `t ∈ [0,1]` along the edge
 *       via `t = s(v1) / (s(v1) - s(v2))`.
 *    b. Look up the edge in `intersectionByEdge` (keyed by sorted
 *       endpoint pair so two adjacent triangles sharing the edge get
 *       the SAME new vertex — no duplicates).
 *    c. If missing, allocate a new vertex at the intersection point;
 *       interpolate UV linearly between the two endpoint UVs.
 *
 * 3. **Subdivide the crossed triangle.** With two intersection points
 *    P, Q on edges (a,b) and (a,c) (WLOG — vertex `a` is on one side
 *    of the line, `b`/`c` on the other), emit three sub-triangles:
 *    `(a, P, Q)`, `(P, b, c)`, `(P, c, Q)`. Winding-preserving.
 *
 * 4. **Compact + remap.** Same as `dissolveVertices` / `deleteVertices`
 *    — no old verts dropped, just appended. The `vertexIndexRemap` is
 *    identity for surviving old verts; `vertexSources` for new verts
 *    points to the two endpoints of the bridged edge.
 *
 * # Edge cases
 *
 * - **A == B**: degenerate cut, no-op (return null).
 * - **Cut line passes through an existing third vert**: the
 *   signed-distance of that vert is exactly 0. The triangle has signs
 *   (+, 0, -) — the line passes through one vert and crosses one edge.
 *   We treat the 0 as "lies on the line"; only the (+, -) edge gets a
 *   new intersection vertex; the triangle subdivides into two
 *   sub-triangles by drawing a line from the 0-vert to the new
 *   intersection.
 * - **Cut line co-linear with a triangle edge**: two verts have
 *   signed-distance 0, one is non-zero. The line lies on an existing
 *   edge — no cut needed; the triangle stays.
 * - **No triangles crossed (e.g. A and B share an edge, or the line
 *   misses every interior triangle)**: return null.
 *
 * # What stays out of v1
 *
 * - Edge-midpoint snapping at click time (user must click an existing
 *   vert). The interactive overlay slice will add edge-snap.
 * - Multi-segment cut paths (click 3+ points). Blender's knife supports
 *   this; v1 is one segment.
 * - Cutting through interior of a triangle without crossing it (a
 *   "stab" — clicking inside a triangle to add a vert). Use existing
 *   add_vertex tool.
 *
 * Blender source: `editors/mesh/editmesh_knife.cc` — the full
 * interactive tool with BVH snapping, real-time preview, and
 * multi-segment paths is ~5000 LOC. SS v1 is ~150 LOC for the cut
 * algorithm because we restrict to vertex-to-vertex single segments.
 *
 * @module v3/operators/edit/knife
 */

import { removeDegenerateTriangles } from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/** Floating-point tolerance for "on the line" classification. */
const EPS = 1e-6;

/**
 * Canonical key for an undirected edge (sorted endpoint pair).
 * @param {number} a
 * @param {number} b
 * @returns {string}
 */
function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Linear interpolation between two scalar values.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Cut the mesh along the straight line from vertex A to vertex B.
 *
 * Returns `null` if the cut would not change the mesh (A==B, no
 * triangles crossed, or the cut produces no new vertices).
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {number} aIdx - vertex index of cut endpoint A
 * @param {number} bIdx - vertex index of cut endpoint B
 * @returns {TopologyOpResult|null}
 */
export function cutMeshAlongLine(mesh, aIdx, bIdx) {
  // Guards.
  if (!Number.isInteger(aIdx) || !Number.isInteger(bIdx)) return null;
  if (aIdx === bIdx) return null;
  if (aIdx < 0 || aIdx >= mesh.vertices.length) return null;
  if (bIdx < 0 || bIdx >= mesh.vertices.length) return null;

  const A = mesh.vertices[aIdx];
  const B = mesh.vertices[bIdx];

  // Line direction + perpendicular. For each vert v compute signed
  // distance as `cross(B-A, v-A)`: positive = left of A→B (CCW from
  // direction), negative = right. We don't need the magnitude
  // normalised — the sign + the ratio across an edge are sufficient.
  const dirX = B.x - A.x;
  const dirY = B.y - A.y;
  if (Math.abs(dirX) < EPS && Math.abs(dirY) < EPS) return null;

  /** @param {VertexLike} v */
  function signedDist(v) {
    return dirX * (v.y - A.y) - dirY * (v.x - A.x);
  }

  /** -1 / 0 / +1 — quantised side classification. */
  function sideOf(v) {
    const s = signedDist(v);
    if (s > EPS) return 1;
    if (s < -EPS) return -1;
    return 0;
  }

  // Pre-classify every existing vertex.
  /** @type {Int8Array} */
  const side = new Int8Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i++) side[i] = sideOf(mesh.vertices[i]);
  // Force A and B to side 0 (they ARE on the line by construction).
  side[aIdx] = 0;
  side[bIdx] = 0;

  // Output verts start as a copy of input; new intersection verts get
  // appended.
  /** @type {Array<VertexLike>} */
  const newVerts = mesh.vertices.map((v) => ({ ...v }));
  // UVs: copy input, then append for each new vert.
  /** @type {number[]} */
  const newUVList = [];
  for (let i = 0; i < mesh.vertices.length * 2; i++) {
    newUVList.push(mesh.uvs[i] ?? 0);
  }
  // vertexSources: identity for existing verts; populated for new.
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexSources.set(i, [i]);

  // Cache: edge → new vertex index. Two adjacent triangles sharing an
  // edge MUST reuse the same new vert (otherwise the mesh tears).
  /** @type {Map<string, number>} */
  const intersectionByEdge = new Map();

  /**
   * Allocate or look up the intersection vert on edge (v1, v2).
   * @param {number} v1
   * @param {number} v2
   * @returns {number} new vertex index
   */
  function getOrCreateIntersection(v1, v2) {
    const key = edgeKey(v1, v2);
    const cached = intersectionByEdge.get(key);
    if (cached !== undefined) return cached;
    const s1 = signedDist(mesh.vertices[v1]);
    const s2 = signedDist(mesh.vertices[v2]);
    const t = s1 / (s1 - s2); // s1 → 0 at this t along v1→v2
    const p1 = mesh.vertices[v1];
    const p2 = mesh.vertices[v2];
    /** @type {VertexLike} */
    const nv = {
      x: lerp(p1.x, p2.x, t),
      y: lerp(p1.y, p2.y, t),
    };
    if (typeof p1.restX === 'number' && typeof p2.restX === 'number') {
      nv.restX = lerp(p1.restX, p2.restX, t);
    }
    if (typeof p1.restY === 'number' && typeof p2.restY === 'number') {
      nv.restY = lerp(p1.restY, p2.restY, t);
    }
    const newIdx = newVerts.length;
    newVerts.push(nv);
    // Interpolate UV.
    const u1 = mesh.uvs[v1 * 2 + 0] ?? 0;
    const v1uv = mesh.uvs[v1 * 2 + 1] ?? 0;
    const u2 = mesh.uvs[v2 * 2 + 0] ?? 0;
    const v2uv = mesh.uvs[v2 * 2 + 1] ?? 0;
    newUVList.push(lerp(u1, u2, t));
    newUVList.push(lerp(v1uv, v2uv, t));
    vertexSources.set(newIdx, [v1, v2]);
    intersectionByEdge.set(key, newIdx);
    return newIdx;
  }

  /** @type {Array<TriIndex>} */
  const newTris = [];
  let anyCut = false;

  for (const tri of mesh.triangles) {
    const [t0, t1, t2] = tri;
    const s0 = side[t0];
    const s1 = side[t1];
    const s2 = side[t2];

    // All on one side (or on the line) — no cut, preserve.
    if (s0 >= 0 && s1 >= 0 && s2 >= 0) { newTris.push(tri); continue; }
    if (s0 <= 0 && s1 <= 0 && s2 <= 0) { newTris.push(tri); continue; }

    // Determined: one vert lies on one side, the other two on the
    // opposite (with possibly one on the line). Identify the "solo"
    // vert (the one whose sign differs from the other two when both
    // are strictly the same sign), or the on-line vert when present.
    //
    // Cases (after the all-same-sign branches above, this triangle
    // is strictly split):
    //
    // Case S1 — exactly one vert on the line (one s == 0), other
    //           two on opposite sides. Cut crosses the on-line vert
    //           and the edge between the other two.
    //
    // Case S2 — no verts on the line; one vert solo on one side,
    //           the other two on the opposite. Cut crosses the two
    //           edges incident to the solo vert.

    const onLineCount = (s0 === 0 ? 1 : 0) + (s1 === 0 ? 1 : 0) + (s2 === 0 ? 1 : 0);

    if (onLineCount === 1) {
      // Case S1: one on the line, the other two on opposite sides.
      // The triangle splits along the line from the on-line vert to
      // the new intersection vert on the opposite edge.
      let onLine, p, q;
      if (s0 === 0) { onLine = t0; p = t1; q = t2; }
      else if (s1 === 0) { onLine = t1; p = t2; q = t0; }
      else { onLine = t2; p = t0; q = t1; }
      const xPQ = getOrCreateIntersection(p, q);
      // Two sub-triangles preserving winding (onLine → p → xPQ),
      // (onLine → xPQ → q). Winding order matches the original
      // (onLine, p, q) traversal.
      newTris.push([onLine, p, xPQ]);
      newTris.push([onLine, xPQ, q]);
      anyCut = true;
      continue;
    }

    // Case S2: no verts on the line; one is solo on its side, two
    // share the other side. Find the solo.
    let solo, p, q;
    if (s0 !== s1 && s0 !== s2) { solo = t0; p = t1; q = t2; }
    else if (s1 !== s0 && s1 !== s2) { solo = t1; p = t2; q = t0; }
    else { solo = t2; p = t0; q = t1; }
    const xSP = getOrCreateIntersection(solo, p);
    const xSQ = getOrCreateIntersection(solo, q);
    // Subdivide into three sub-triangles, preserving (solo, p, q)
    // winding: (solo, xSP, xSQ), (xSP, p, q), (xSP, q, xSQ).
    newTris.push([solo, xSP, xSQ]);
    newTris.push([xSP, p, q]);
    newTris.push([xSP, q, xSQ]);
    anyCut = true;
  }

  // If no triangle was actually cut, no-op.
  if (!anyCut) return null;

  // No verts dropped — `vertexIndexRemap` is identity for inputs and
  // includes the new intersection verts mapped to themselves.
  /** @type {Map<number, number|null>} */
  const vertexIndexRemap = new Map();
  for (let i = 0; i < newVerts.length; i++) vertexIndexRemap.set(i, i);

  const triangles = removeDegenerateTriangles(newTris);
  if (triangles.length === 0) return null;

  // edgeIndices pass-through — knife doesn't reorder existing verts,
  // and new intersection verts inherit edge-ness from neither endpoint
  // unambiguously, so v1 leaves them out of `edgeIndices`. Boundary
  // verts on the original mesh stay in their slot.
  /** @type {Set<number>} */
  const edgeIndices = new Set();
  if (mesh.edgeIndices) {
    for (const ei of mesh.edgeIndices) edgeIndices.add(ei);
  }

  const uvs = new Float32Array(newUVList.length);
  for (let i = 0; i < newUVList.length; i++) uvs[i] = newUVList[i];

  return {
    vertices: newVerts,
    uvs,
    triangles,
    edgeIndices,
    vertexIndexRemap,
    vertexSources,
    retriangulated: true,
  };
}
