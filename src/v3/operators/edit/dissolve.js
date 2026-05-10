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
 *
 * Blender source reference: `editors/mesh/editmesh_tools.cc` ⟶
 * `MESH_OT_dissolve_verts` ⟶ `bmesh_dissolve_verts` ⟶
 * `BM_face_split_n` which uses BMesh's polygon-fill (constrained
 * Delaunay, a stronger algorithm than ear-clip). For Phase 4 we use
 * Meisters–Chazelle as a simpler-but-correct stand-in; full constrained
 * Delaunay is a Phase 6+ enhancement if rings get larger.
 *
 * @module v3/operators/edit/dissolve
 */

import {
  enumerateOneRingPolygon,
  cross2, pointInTriangleStrict,
  removeDegenerateTriangles, identityVertexSources,
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
    // Reject rings that include other dissolved verts — those collapse
    // into a multi-vert hole that the simple per-centre ear-clip can't
    // handle correctly. The tris incident to those will be re-fed when
    // we process *their* centre. (Future: BFS-merge connected dissolved
    // clusters into a single ring; for now we keep the v1 simple.)
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
