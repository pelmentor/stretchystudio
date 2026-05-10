// @ts-check

/**
 * Toolset Plan Phase 6.B — Edit-Mode Duplicate (Shift+D).
 *
 * Mirrors Blender's `MESH_OT_duplicate_move`
 * (`reference/blender/source/blender/editors/mesh/editmesh_add.cc:780+`)
 * → BMOP `duplicate`
 * (`reference/blender/source/blender/bmesh/operators/bmo_dupe.cc:240+`).
 * SS specialisation: vertex-mode only (no edge / face select today),
 * triangles instead of n-gons.
 *
 * **Algorithm.**
 *   1. Duplicate every selected vertex (positions copied, vertexSources
 *      length-1 entries pointing at the source vert).
 *   2. For every triangle whose ALL THREE vertices are in the selection,
 *      clone the triangle pointing at the new vertex indices. Triangles
 *      with 0/1/2 selected verts are NOT cloned — Blender's BMOP
 *      `duplicate` semantics: a face is duplicated iff every incident
 *      vert is in the input geometry set.
 *   3. Return a `TopologyOpResult` with `selectionOverride = {new vert
 *      indices}` so the dispatcher selects the duplicates wholesale
 *      (Blender's `duplicate` post-op selection: source ring deselected,
 *      duplicate ring selected — same pattern as Phase 5 extrude).
 *
 * **Differences from Phase 5 extrude.**
 *   - Extrude duplicates BOUNDARY verts only; Duplicate accepts ANY
 *     selected verts (interior or boundary).
 *   - Extrude bridges source ↔ dup with quad strips; Duplicate does NOT
 *     bridge — duplicated verts are floating until Modal G translates
 *     them away. (Triangles in the selection get duplicated as a unit
 *     so the new ring still has internal topology, but the source and
 *     duplicate are not topologically connected.)
 *   - Extrude requires ≥1 boundary vert in selection; Duplicate
 *     requires ≥1 vert (any kind).
 *
 * **Why duplicate-only-fully-enclosed triangles.**
 *   Cloning a triangle that has only 1 or 2 selected verts would either
 *   (a) leave a dangling triangle with verts shared between source and
 *   duplicate (causing a non-manifold seam after Modal G), or
 *   (b) require synthesising bridging triangles (which is what Extrude
 *   does). Both are wrong for Duplicate's "make a free copy" intent.
 *   This matches Blender's `bmo_dupe.cc:240+` `BMO_op_exec` path which
 *   only re-emits faces whose every incident vert is in the input
 *   geometry table.
 *
 * @module v3/operators/edit/duplicate
 */

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */
/** @typedef {import('../../../lib/meshTopology.js').TriIndex} TriIndex */

/**
 * Duplicate the selected vertices + the fully-enclosed triangles
 * connecting them.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<TriIndex>} mesh.triangles
 * @param {Set<number>|Array<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @returns {TopologyOpResult|null}
 */
export function duplicate(mesh, selection) {
  const verts = Array.isArray(mesh?.vertices) ? mesh.vertices : null;
  const tris = Array.isArray(mesh?.triangles) ? mesh.triangles : null;
  if (!verts || verts.length === 0 || !tris) return null;

  // Normalize the selection to a Set of valid in-bounds indices, kept
  // in ascending order so the new index ←→ source mapping is stable
  // across runs (matches Phase 5 extrude pattern).
  /** @type {Set<number>} */
  const sel = new Set();
  for (const i of selection) {
    if (Number.isInteger(i) && i >= 0 && i < verts.length) sel.add(i);
  }
  if (sel.size === 0) return null;
  const orderedSel = [...sel].sort((a, b) => a - b);

  // Step 1 — vertex pass. Survivors copy verbatim, then duplicates
  // append. dupOf maps source → duplicate index for the triangle pass.
  const newVertices = verts.map((v) => ({ ...v }));
  /** @type {Map<number, number>} */
  const dupOf = new Map();
  /** @type {Map<number, number[]>} */
  const vertexSources = new Map();
  for (let i = 0; i < verts.length; i++) vertexSources.set(i, [i]);
  for (const oldIdx of orderedSel) {
    const newIdx = newVertices.length;
    newVertices.push({ ...verts[oldIdx] });
    dupOf.set(oldIdx, newIdx);
    vertexSources.set(newIdx, [oldIdx]);
  }

  // Step 2 — triangle pass. Source triangles preserved verbatim; new
  // triangles append for every fully-selected source triangle.
  const newTris = tris.map((t) => /** @type {TriIndex} */ ([t[0], t[1], t[2]]));
  for (const t of tris) {
    const i = t[0], j = t[1], k = t[2];
    if (!sel.has(i) || !sel.has(j) || !sel.has(k)) continue;
    const di = dupOf.get(i);
    const dj = dupOf.get(j);
    const dk = dupOf.get(k);
    if (di === undefined || dj === undefined || dk === undefined) continue;
    newTris.push(/** @type {TriIndex} */ ([di, dj, dk]));
  }

  // Step 3 — UVs. Originals copy verbatim; duplicates inherit their
  // source vertex's UV. (Same rationale as Phase 5 extrude: per-vertex
  // UV with no seam handling — the duplicate re-references the same
  // texel as its source.)
  const srcUvs = mesh.uvs ?? new Float32Array(verts.length * 2);
  const uvs = new Float32Array(newVertices.length * 2);
  for (let i = 0; i < verts.length; i++) {
    uvs[i * 2]     = srcUvs[i * 2]     ?? 0;
    uvs[i * 2 + 1] = srcUvs[i * 2 + 1] ?? 0;
  }
  for (const [oldIdx, newIdx] of dupOf) {
    uvs[newIdx * 2]     = srcUvs[oldIdx * 2]     ?? 0;
    uvs[newIdx * 2 + 1] = srcUvs[oldIdx * 2 + 1] ?? 0;
  }

  // Step 4 — edgeIndices. Boundary status carries to the duplicate
  // (the duplicate, prior to Modal G drag, sits on the same boundary).
  // Survivors keep their original boundary flag.
  /** @type {Set<number>} */
  const edgeIndices = new Set(mesh.edgeIndices ?? []);
  for (const [oldIdx, newIdx] of dupOf) {
    if (edgeIndices.has(oldIdx)) edgeIndices.add(newIdx);
  }

  // Step 5 — vertexIndexRemap. Identity for all originals (none
  // dropped). New verts are not in the remap; the dispatcher's
  // selectionOverride path bypasses the survivor + growth remap.
  /** @type {Map<number, number|null>} */
  const vertexIndexRemap = new Map();
  for (let i = 0; i < verts.length; i++) vertexIndexRemap.set(i, i);

  // Step 6 — selection override = the duplicates wholesale.
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
