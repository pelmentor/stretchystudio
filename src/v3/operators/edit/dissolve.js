// @ts-check

/**
 * Toolset Plan Phase 4.B — Dissolve Vertices operator.
 *
 * Removes selected verts from the mesh and re-triangulates the
 * resulting holes via the **Meisters–Chazelle ear-clip** — a polygon
 * triangulation that handles concave (non-convex) rings, which
 * standard ear-clip silently mistriangulates. Live2D character meshes
 * are routinely concave (eyelid bevels, hair tip curls), so the
 * stricter algorithm is mandatory, not a nicety.
 *
 * Algorithm (per polygon ring around the dissolved vert):
 *
 *   1. Build the ring as an ordered list of vertex indices via
 *      `enumerateOneRingPolygon` (uses incident-triangle directed
 *      edges).
 *   2. While the ring has > 3 vertices:
 *      a. For each candidate ear vertex `e_i`:
 *         - Convex test: `cross(prev, e_i, next) > 0` for the chosen
 *           winding (CCW positive).
 *         - Containment test (Meisters–Chazelle): no other ring vertex
 *           lies STRICTLY inside the triangle (`prev, e_i, next`).
 *         - Both pass → cut the ear: emit triangle, remove `e_i` from
 *           ring.
 *      b. If no ear passes, the ring is broken (self-intersecting) —
 *         fall back to a fan triangulation around `ring[0]` so the
 *         hole still seals (rare on mesh-generator output).
 *   3. The final 3-vert ring is a single triangle.
 *
 * Open rings (boundary vertex was dissolved) are NOT closed — we just
 * drop the incident triangles and don't synthesize a fill polygon.
 * Audit note D-6: Blender's `MESH_OT_dissolve_verts` exposes
 * `use_boundary_tear` (pre-splits incident faces so a boundary
 * dissolve closes cleanly) + `use_face_split` (prevents post-dissolve
 * degenerate faces, `bmo_dissolve.cc:695-801`). Neither is implemented
 * in v1; the documented behaviour is "boundary dissolve drops the
 * incident triangles + leaves a hole; a subsequent Remesh closes it".
 *
 * Blender source reference: `editors/mesh/editmesh_tools.cc` ⟶
 * `MESH_OT_dissolve_verts` ⟶ `bmo_dissolve.cc` ⟶ `BM_face_split_n`
 * which uses `BLI_polyfill_calc_arena` from `blenlib/intern/polyfill_2d.cc`.
 * That file's banner explicitly calls itself "An ear clipping algorithm"
 * with a KD-tree for performance — NOT constrained Delaunay (a prior
 * version of this comment claimed Delaunay; audit fix D-7 corrected
 * the attribution). The KD-tree variant is faster on large rings; for
 * SS's typically-small one-rings (4-8 verts) Meisters–Chazelle's O(n²)
 * containment test is equivalent in correctness and simpler to audit.
 *
 * **Connected dissolved clusters (v1 simplification).** When two
 * adjacent selected verts share a triangle, the per-centre ring
 * detection sees the OTHER dissolved vert in its ring and silently
 * declines to refill (line ~190). The triangles incident to BOTH
 * dissolved verts are still removed; nothing fills the resulting hole.
 * Audit fix G-4 corrected the misleading "will be re-fed when we
 * process their centre" comment — the bucketing puts each shared
 * triangle in just ONE centre's bucket, so the second centre's ring
 * is incomplete and would need BFS-merging across the cluster to
 * recover. That cluster-fix is queued for Phase 6+ (Blender does it
 * via `BM_faces_join_pair` in `bmo_dissolve.cc:762-778`); for v1, the
 * documented behaviour is "boundary verts and adjacent-pair clusters
 * leave holes — exit Edit Mode and reuse the existing remesh path
 * if you need a closed mesh".
 *
 * @module v3/operators/edit/dissolve
 */

import {
  enumerateOneRingPolygon,
  cross2, pointInTriangleStrict,
  removeDegenerateTriangles,
} from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/**
 * Triangulate a polygon ring via Meisters–Chazelle ear-clip. Returns
 * triangles in terms of the ring's vertex indices (NOT positions in
 * the ring array — the ring already holds vertex indices).
 *
 * Winding-aware: detects the ring's signed area sign and re-orients
 * to CCW if the input is CW (so the convex-ear test stays consistent).
 *
 * Open rings (closed=false) skip retriangulation and return [] —
 * boundary dissolves leave a hole.
 *
 * @param {number[]} ring                                       - vertex indices, in order
 * @param {Array<VertexLike>} vertices
 * @param {boolean} closed
 * @returns {Array<TriIndex>}
 */
export function earClipTriangulate(ring, vertices, closed) {
  if (!closed) return [];
  if (ring.length < 3) return [];
  if (ring.length === 3) return [[ring[0], ring[1], ring[2]]];

  // Detect winding via shoelace; flip if CW so convex test
  // (cross > 0) is consistent.
  let signedArea2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = vertices[ring[i]];
    const b = vertices[ring[(i + 1) % ring.length]];
    signedArea2 += a.x * b.y - b.x * a.y;
  }
  const work = signedArea2 > 0 ? ring.slice() : ring.slice().reverse();

  /** @type {Array<TriIndex>} */
  const out = [];
  let guard = work.length * work.length; // safety bound
  while (work.length > 3 && guard-- > 0) {
    let foundEar = false;
    for (let i = 0; i < work.length; i++) {
      const ai = work[(i - 1 + work.length) % work.length];
      const bi = work[i];
      const ci = work[(i + 1) % work.length];
      const a = vertices[ai];
      const b = vertices[bi];
      const c = vertices[ci];
      // Convex test (CCW after orientation pass).
      if (cross2(a.x, a.y, b.x, b.y, c.x, c.y) <= 0) continue;
      // Containment test — no other ring vertex inside (a, b, c).
      let contains = false;
      for (let j = 0; j < work.length; j++) {
        if (j === i || work[j] === ai || work[j] === bi || work[j] === ci) continue;
        const p = vertices[work[j]];
        if (pointInTriangleStrict(p, a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      // Cut the ear.
      out.push([ai, bi, ci]);
      work.splice(i, 1);
      foundEar = true;
      break;
    }
    if (!foundEar) {
      // Broken ring (self-intersect / collinear cluster). Fan fallback
      // around work[0] so the hole at least seals — degenerates get
      // dropped by the caller's removeDegenerateTriangles pass.
      const a = work[0];
      for (let i = 1; i < work.length - 1; i++) {
        out.push([a, work[i], work[i + 1]]);
      }
      return out;
    }
  }
  if (work.length === 3) out.push([work[0], work[1], work[2]]);
  return out;
}

/**
 * Dissolve selected vertices and re-triangulate the holes left
 * behind. Each dissolved vert's one-ring polygon is fed to ear-clip;
 * the resulting triangles patch the hole.
 *
 * Returns null when the operation would empty the mesh, leave fewer
 * than 3 verts, or leave no triangles after retriangulation.
 *
 * Per-vertex data (UVs, blendShape deltas, weight weights): survivors
 * keep their original values via `vertexSources[newIdx] = [oldIdx]`.
 * Dissolved verts do not contribute to any new vert (the polygon hole
 * is sealed using existing ring verts only — no new mesh verts are
 * created).
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @returns {TopologyOpResult|null}
 */
export function dissolveVertices(mesh, selection) {
  const sel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size === 0) return null;
  // Refuse to leave the mesh below the 3-vert delaunay floor.
  if (mesh.vertices.length - sel.size < 3) return null;

  // Bucket triangles by which dissolved verts (if any) they touch.
  // Triangles that touch ≥1 dissolved vert are removed; those that
  // touch zero are preserved.
  /** @type {Array<TriIndex>} */
  const preserved = [];
  /** @type {Map<number, Array<TriIndex>>} */
  const incidentByCenter = new Map(); // dissolvedIdx → tris touching it
  for (const tri of mesh.triangles) {
    const [a, b, c] = tri;
    const aDiss = sel.has(a);
    const bDiss = sel.has(b);
    const cDiss = sel.has(c);
    if (!aDiss && !bDiss && !cDiss) {
      preserved.push(tri);
      continue;
    }
    // Triangle touches ≥1 dissolved vert. Bucket by the FIRST dissolved
    // vert (each dissolved vert gets its own ring; tris touching two
    // dissolved verts in adjacent positions are collected by both
    // centres but ear-clip dedup picks them up via the closed-ring
    // walk).
    for (const idx of [a, b, c]) {
      if (sel.has(idx)) {
        if (!incidentByCenter.has(idx)) incidentByCenter.set(idx, []);
        /** @type {Array<TriIndex>} */
        (incidentByCenter.get(idx)).push(tri);
        break;
      }
    }
  }

  // Build new triangle list: preserved + ear-clip refill of each ring.
  const newTris = preserved.slice();
  for (const [centre, incident] of incidentByCenter) {
    const ringInfo = enumerateOneRingPolygon(incident, centre);
    if (!ringInfo) continue;
    // Audit fix G-4 — when adjacent verts are both dissolved, the
    // triangle bucketing above puts the shared triangle in just ONE
    // centre's bucket (`for ... break` hits the first dissolved vert
    // it sees). When we hit the OTHER centre, its ring will be
    // incomplete (missing the shared triangle) AND will contain the
    // first dissolved vert — both reasons to skip refill. The prior
    // "will be re-fed" comment was wrong: the shared tri is NOT
    // re-fed because it's already in the first bucket.
    //
    // For v1, both centres skip → triangles incident to both
    // dissolved verts are removed but no refill occurs (hole left).
    // Phase 6+ will BFS-merge connected dissolved clusters into a
    // single combined ring before ear-clip (mirroring Blender's
    // `BM_faces_join_pair` per edge, `bmo_dissolve.cc:762-778`).
    const ringHasOtherDissolved = ringInfo.ring.some((v) => sel.has(v));
    if (ringHasOtherDissolved) continue;
    const refill = earClipTriangulate(ringInfo.ring, mesh.vertices, ringInfo.closed);
    for (const t of refill) newTris.push(t);
  }

  // Compact: build oldToNew that drops dissolved verts.
  /** @type {Map<number, number|null>} */
  const oldToNew = new Map();
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  /** @type {Array<VertexLike>} */
  const vertices = [];
  /** @type {number[]} */
  const survivingOldIndices = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (sel.has(i)) { oldToNew.set(i, null); continue; }
    const newIdx = vertices.length;
    oldToNew.set(i, newIdx);
    vertices.push({ ...mesh.vertices[i] });
    vertexSources.set(newIdx, [i]);
    survivingOldIndices.push(i);
  }
  if (vertices.length < 3) return null;

  // Remap triangle indices + drop degenerates.
  /** @type {Array<TriIndex>} */
  const remappedTris = [];
  for (const [a, b, c] of newTris) {
    const na = oldToNew.get(a);
    const nb = oldToNew.get(b);
    const nc = oldToNew.get(c);
    if (na == null || nb == null || nc == null) continue;
    if (na === nb || nb === nc || nc === na) continue;
    remappedTris.push([na, nb, nc]);
  }
  const triangles = removeDegenerateTriangles(remappedTris);
  if (triangles.length === 0) return null;

  // Remap UVs + edgeIndices via dropping dissolved entries.
  const uvs = new Float32Array(vertices.length * 2);
  for (let i = 0; i < survivingOldIndices.length; i++) {
    const old = survivingOldIndices[i];
    uvs[i * 2]     = mesh.uvs[old * 2]     ?? 0;
    uvs[i * 2 + 1] = mesh.uvs[old * 2 + 1] ?? 0;
  }
  /** @type {Set<number>} */
  const edgeIndices = new Set();
  if (mesh.edgeIndices) {
    for (const ei of mesh.edgeIndices) {
      const ne = oldToNew.get(ei);
      if (ne != null) edgeIndices.add(ne);
    }
  }

  return {
    vertices,
    uvs,
    triangles,
    edgeIndices,
    vertexIndexRemap: oldToNew,
    vertexSources,
    retriangulated: true,
  };
}
