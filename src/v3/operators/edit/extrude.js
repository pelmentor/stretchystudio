// @ts-check

/**
 * Toolset Plan Phase 5.B — Extrude operator (Blender-faithful where
 * the data model permits).
 *
 * Duplicates the selected boundary verts of a mesh and (where two
 * selected boundary verts share a boundary edge) bridges the original
 * and the duplicate with a quad-strip of two triangles. The freshly-
 * duplicated verts replace the editor selection, ready for the modal-G
 * vertex-translate hand-off (the user drags them to their final
 * position).
 *
 * Sources (audit D-9: prior cite `editmesh_extrude.cc:507-585` was
 * wrong — that range is `edbm_split_exec` / unrelated code; the actual
 * extrude regions are below):
 *   - `editors/mesh/editmesh_extrude.cc:430-456` — `edbm_extrude_region_exec`
 *     (the operator-side exec callback).
 *   - `editors/mesh/editmesh_extrude.cc:358-427` — `edbm_extrude_mesh`
 *     (the dispatch logic that picks `extrude_face_region` vs
 *     `extrude_verts_indiv` based on `totedgesel`/`totvertsel`).
 *   - `editors/mesh/editmesh_extrude.cc:212-257` — `edbm_extrude_ex`
 *     (the face-region wrapper).
 *   - `bmesh/operators/bmo_extrude.cc:319+` —
 *     `bmo_extrude_face_region_exec` (the BMOP that does the actual
 *     quad emission). SS lifts only the vertex-only boundary subset.
 *
 * Blender's algorithm is face-flag-driven; SS is vertex-only so we
 * lift the boundary-vert / boundary-edge subset directly via
 * `getBoundaryVerts` / `getBoundaryEdges`.
 *
 * **Boundary semantics.** A boundary vertex is incident on at least one
 * boundary edge (an edge referenced by exactly one *non-degenerate*
 * triangle — degenerate seam triangles are filtered out so phantom
 * "interior boundary" pseudo-edges from UV / clip-mask separators don't
 * extrude). The non-degenerate filter is an SS extension over Blender's
 * `BM_edge_is_boundary` (`bmesh/intern/bmesh_query_inline.hh:111-115`),
 * which counts loop-radial only without an area check (audit D-7) —
 * Live2D content depends on the filter; native Blender content
 * doesn't.
 *
 * Verts off the boundary contribute nothing in v1 — Blender's
 * `MESH_OT_extrude_verts_indiv` (`editmesh_extrude.cc:169-186`) handles
 * those by creating a wire-edge to a new duplicate vert (audit D-2), but
 * Live2D meshes are triangle-only so wire-edges are unusable
 * downstream. Phase 6+ may add `extrude.vertsIndiv` once a mesh model
 * supporting wire-edges lands.
 *
 * **Edge cases (per plan §5.C):**
 *
 *   - Selection ∩ boundary = ∅ → returns null. Caller surfaces a toast
 *     ("Interior-vert extrude not supported (Live2D meshes need
 *     triangles)…") and bails.
 *   - Single selected boundary vert → duplicates the vert with no quad
 *     bridges (degenerate "single-vert extrude").
 *   - Closed boundary loop fully selected → duplicates every vert + a
 *     ring of quads around the entire loop.
 *   - Open boundary path fully selected → quads only along the
 *     selected sub-path; endpoints duplicate without a closing quad.
 *   - Multi-vert selection where NO endpoints share a boundary edge
 *     (e.g. opposite corners) → duplicates emit but ZERO quad bridges.
 *     Blender's `edbm_extrude_mesh:373-378` would dispatch to
 *     `extrude_verts_indiv` here (per-vert wire-edge); SS silently
 *     produces isolated dups (audit D-4 — DOCUMENT-AS-DEVIATION).
 *
 * **Selection hand-off.** The extrude operator returns a
 * TopologyOpResult with `selectionOverride` = the set of new vertex
 * indices. The dispatcher (`applyTopologyOp`) honours the override and
 * replaces the editor selection wholesale — Blender's pattern: post-
 * extrude, ONLY the new verts are selected so the modal G drags the
 * duplicates without dragging the source ring. Active vert post-
 * extrude prefers the duplicate of the prior active vert when the
 * dispatcher can identify it (audit D-8).
 *
 * **Quad winding.** New triangles emit as `(u, v, v', u')` =
 * `(u, v, v')` + `(u, v', u')` where u < v in canonical edge order.
 * Blender's `bmo_extrude_face_region_exec` (`bmo_extrude.cc:517-541`)
 * orients each new face via `edge_normal_flip` so the new normal
 * matches the adjacent face's normal — irrelevant for Live2D / SS
 * because the renderer is alpha-blend (no backface cull) and 2D meshes
 * don't carry per-face normals. The handedness flips when the user
 * drags the new verts to the opposite side of the boundary edge;
 * that's normal Blender behaviour too (E + drag direction determines
 * the geometric "side").
 *
 * @module v3/operators/edit/extrude
 */

import {
  getBoundaryVerts, getBoundaryEdges,
} from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/**
 * Extrude selected boundary verts into duplicates + bridging quads.
 *
 * Returns null when the selection contains zero boundary verts (caller
 * shows a toast and no-ops).
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|Array<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @returns {TopologyOpResult|null}
 */
export function extrude(mesh, selection) {
  const sel = new Set(Array.from(selection)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size === 0) return null;

  const boundary = getBoundaryVerts(mesh);
  /** @type {Set<number>} */
  const selectedBoundary = new Set();
  for (const i of sel) {
    if (boundary.has(i)) selectedBoundary.add(i);
  }
  if (selectedBoundary.size === 0) return null;

  // Step 1 — duplicate every selected boundary vert. Map each oldIdx
  // → newIdx so the quad-emission step can look up duplicates by their
  // source vertex without recomputing.
  const newVertices = mesh.vertices.map((v) => ({ ...v }));
  /** @type {Map<number, number>} */
  const dupOf = new Map();
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexSources.set(i, [i]);
  for (const oldIdx of selectedBoundary) {
    const src = mesh.vertices[oldIdx];
    const newIdx = newVertices.length;
    newVertices.push({ ...src });
    dupOf.set(oldIdx, newIdx);
    vertexSources.set(newIdx, [oldIdx]);
  }

  // Step 2 — emit bridging quads for boundary edges whose BOTH
  // endpoints lie in selectedBoundary. Pre-existing triangles are
  // preserved verbatim; new tris append at the end.
  const newTris = mesh.triangles.map((t) => /** @type {TriIndex} */ ([t[0], t[1], t[2]]));
  const boundaryEdges = getBoundaryEdges(mesh);
  for (const [u, v] of boundaryEdges) {
    if (!selectedBoundary.has(u) || !selectedBoundary.has(v)) continue;
    const uPrime = dupOf.get(u);
    const vPrime = dupOf.get(v);
    if (uPrime === undefined || vPrime === undefined) continue; // defensive
    // (u, v, v') + (u, v', u') — two triangles, consistent winding.
    newTris.push(/** @type {TriIndex} */ ([u, v, vPrime]));
    newTris.push(/** @type {TriIndex} */ ([u, vPrime, uPrime]));
  }

  // Step 3 — UVs. Originals copy verbatim; duplicates inherit their
  // source vertex's UV. Live2D meshes have UVs per-vertex (not per-
  // corner), so there's no UV seam handling needed — the duplicate
  // simply re-references the same texel as the source. When the user
  // drags via modal G, the texture coords stay locked to the source
  // UV (matches Blender's default extrude behaviour: new geometry
  // inherits source UVs; user re-unwraps if they want different UVs).
  const uvs = new Float32Array(newVertices.length * 2);
  for (let i = 0; i < mesh.vertices.length; i++) {
    uvs[i * 2]     = mesh.uvs[i * 2]     ?? 0;
    uvs[i * 2 + 1] = mesh.uvs[i * 2 + 1] ?? 0;
  }
  for (const [oldIdx, newIdx] of dupOf) {
    uvs[newIdx * 2]     = mesh.uvs[oldIdx * 2]     ?? 0;
    uvs[newIdx * 2 + 1] = mesh.uvs[oldIdx * 2 + 1] ?? 0;
  }

  // Step 4 — edgeIndices. The source-vert boundary status carries to
  // the duplicate (the duplicate IS still on the new perimeter — it's
  // the freshly-extruded "outer ring"). Survivors keep their original
  // boundary flag.
  /** @type {Set<number>} */
  const edgeIndices = new Set(mesh.edgeIndices ?? []);
  for (const [oldIdx, newIdx] of dupOf) {
    if (edgeIndices.has(oldIdx)) edgeIndices.add(newIdx);
  }

  // Step 5 — vertexIndexRemap. Identity for all originals (none
  // dropped by extrude). New verts are NOT in the remap by definition
  // (no oldIdx maps to them); the dispatcher's selectionOverride path
  // bypasses the survivor + growth remap entirely.
  /** @type {Map<number, number|null>} */
  const vertexIndexRemap = new Map();
  for (let i = 0; i < mesh.vertices.length; i++) vertexIndexRemap.set(i, i);

  // Step 6 — selection override. Blender's E selects ONLY the new
  // verts so the modal-G drags the duplicates, leaving the source ring
  // unselected.
  /** @type {Set<number>} */
  const selectionOverride = new Set(dupOf.values());

  return {
    vertices: newVertices,
    uvs,
    triangles: newTris,
    edgeIndices,
    vertexIndexRemap,
    vertexSources,
    selectionOverride,
    retriangulated: true,
  };
}

/**
 * Helper for Phase 5.C — single-vert "extrude individual" diagnosis.
 * Returns the count of selected boundary verts (without computing the
 * full operator result). Used by the operator registry to surface the
 * "no boundary verts" toast vs. proceed with the real op.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Iterable<number>} selection
 * @returns {number}
 */
export function countSelectedBoundary(mesh, selection) {
  const sel = new Set(Array.from(selection)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size === 0) return 0;
  const boundary = getBoundaryVerts(mesh);
  let count = 0;
  for (const i of sel) {
    if (boundary.has(i)) count++;
  }
  return count;
}
