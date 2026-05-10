// @ts-check

/**
 * Toolset Plan Phase 6.A — Select Linked.
 *
 * Two pure functions implementing Blender's `MESH_OT_select_linked` /
 * `MESH_OT_select_linked_pick` semantics specialized for SS's
 * vertex-only mesh model:
 *
 *   - `selectLinkedFromVertex(mesh, originIdx)` — flood-fill from one
 *     vertex along edge-adjacency. Mirrors Blender's
 *     `MESH_OT_select_linked_pick` operator
 *     (`reference/blender/source/blender/editors/mesh/editmesh_select.cc:4503-4536`
 *     definition + `:4467-4501` exec callback `edbm_select_linked_pick_exec`
 *     + `:4383-4465` invoke `edbm_select_linked_pick_invoke` which holds
 *     the cursor hit-test path). Audit D-9 corrected a pre-existing
 *     wrong cite at `:5070+`, which is `bm_step_to_next_selected_vert_in_chain`
 *     (a deselect-nth walker helper, unrelated). The operator's
 *     `deselect` RNA bool (`editmesh_select.cc:4520`) flips the BMW walker's
 *     selection bit so the same flood-fill runs but inverted — that's
 *     the Shift+L "deselect linked" path; SS exposes it via the
 *     `select.linked.cursor.deselect` operator (audit fix D-2).
 *
 *   - `selectLinkedExpandSelection(mesh, currentSel)` — expand each
 *     vertex in the existing selection to its full connected component.
 *     Mirrors Blender's `MESH_OT_select_linked`
 *     (`editmesh_select.cc:4226-4253` operator def + `:4016+` exec) —
 *     the `Ctrl+L` chord, operates on the existing selection rather
 *     than the cursor.
 *
 * **Adjacency.** Re-uses `buildVertexAdjacency` from
 * [src/io/hitTest.js](../../../io/hitTest.js) which interprets each
 * triangle as three pairwise edges (i,j), (j,k), (k,i). The same
 * adjacency map is used by Phase 0.B's shortest-path picker and Phase
 * 4's `mergeCollapse` connected-component walker — keeping a single
 * source of truth for edge topology.
 *
 * **Connected component = BFS reachable set.** Standard graph BFS via
 * a Set-backed visited tracker + array-backed queue. O(V + E) per call.
 *
 * **No degenerate-tri filter.** Unlike Phase 5's `getBoundaryVerts`,
 * we do NOT skip degenerate triangles here. Even a zero-area triangle
 * still pins its three verts together topologically — Blender treats
 * them as connected (no area threshold in `select_linked_walk`). A
 * Live2D seam triangle linking two halves of a clip mask would, in
 * Blender, propagate the L-chord across the seam, and we mirror that.
 *
 * **Audit D-3 (DOCUMENT-AS-DEVIATION) — `delimit` enum unsupported.**
 * Blender's `MESH_OT_select_linked` exposes a `delimit` enum-flag RNA
 * property (`editmesh_select.cc:4242-4252`, defaulting to `BMO_DELIM_SEAM`)
 * that stops the BFS at edges marked SEAM / SHARP / NORMAL (above an
 * angle threshold) / MATERIAL boundary / UV island boundary. The walker
 * `select_linked_delimit_test` (`editmesh_select.cc:3903`) implements
 * the per-edge filter. Live2D meshes have NO per-edge marks (no SEAM /
 * SHARP / NORMAL / MATERIAL flags exist in the data model; UV islands
 * are present in `mesh.uvs` but the art-mesh model doesn't track per-
 * edge UV breaks), so the entire `delimit` mechanism has no analogue.
 * SS's "connected component = single BFS reachable set" is fundamentally
 * simpler because the data model is simpler. Once shape-key / UV-seam
 * concepts land (post-Phase 6+), revisit and add per-flag delimit.
 *
 * **Audit D-4 (DOCUMENT-AS-DEVIATION) — vert-only cursor hit-test.**
 * Blender's `edbm_select_linked_pick_invoke`
 * (`editmesh_select.cc:4383-4465`) calls `unified_findnearest`
 * (`:4427`) which returns the closest BMVert / BMEdge / BMFace under
 * the cursor based on the active `em->selectmode`, then
 * `EDBM_elem_from_selectmode` (`:4444`) picks the appropriate seed.
 * SS hit-tests verts only because there is no edge or face select mode
 * yet (vertex-only). When edge / face select mode lands (Phase 6+ in
 * the larger plan), the seed hit-test will need a multi-element
 * variant.
 *
 * **Triangle storage shape.** SS meshes store triangles as either a
 * flat `[i, j, k, i, j, k, …]` indices array or as nested
 * `[[i,j,k], [i,j,k]]`. `buildVertexAdjacency` accepts the flat shape;
 * `extractTriangleIndices` below normalizes both shapes to flat.
 *
 * @module v3/operators/select/linked
 */

import { buildVertexAdjacency } from '../../../io/hitTest.js';

/**
 * Flatten a mesh's `triangles` into a `[i, j, k, …]` index list,
 * accepting both nested-array and flat-array storage shapes.
 *
 * @param {any} triangles
 * @returns {number[]}
 */
function extractTriangleIndices(triangles) {
  if (!Array.isArray(triangles) && !(triangles instanceof Uint32Array || triangles instanceof Uint16Array)) {
    return [];
  }
  // Flat: first element is a number.
  if (typeof triangles[0] === 'number') {
    return /** @type {number[]} */ (Array.from(triangles));
  }
  // Nested: first element is an array-like.
  /** @type {number[]} */
  const out = [];
  for (let t = 0; t < triangles.length; t++) {
    const tri = triangles[t];
    if (!tri) continue;
    out.push(tri[0], tri[1], tri[2]);
  }
  return out;
}

/**
 * BFS from `originIdx` over the adjacency map. Returns the set of
 * reachable vertex indices including the origin.
 *
 * @param {Map<number, Set<number>>} adjacency
 * @param {number} originIdx
 * @returns {Set<number>}
 */
function bfsReachable(adjacency, originIdx) {
  /** @type {Set<number>} */
  const visited = new Set();
  if (!adjacency.has(originIdx)) {
    // Even if the origin has no incident edges (e.g. an isolated vert
    // on a clip-mask sentinel triangle), Blender still selects the
    // single vertex itself. Mirror that.
    visited.add(originIdx);
    return visited;
  }
  /** @type {number[]} */
  const queue = [originIdx];
  visited.add(originIdx);
  while (queue.length > 0) {
    const cur = /** @type {number} */ (queue.shift());
    const neighbours = adjacency.get(cur);
    if (!neighbours) continue;
    for (const n of neighbours) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push(n);
    }
  }
  return visited;
}

/**
 * Select Linked from a single seed vertex (Blender's `L` cursor chord).
 *
 * @param {{vertices?: any[], triangles?: any}} mesh
 * @param {number} originIdx
 * @returns {Set<number>|null} - flood-fill set, or null when origin is
 *   out of bounds.
 */
export function selectLinkedFromVertex(mesh, originIdx) {
  const verts = Array.isArray(mesh?.vertices) ? mesh.vertices : null;
  if (!verts) return null;
  if (originIdx < 0 || originIdx >= verts.length) return null;
  const flat = extractTriangleIndices(mesh.triangles);
  const adj = buildVertexAdjacency(flat, verts.length);
  return bfsReachable(adj, originIdx);
}

/**
 * Expand each vertex in `currentSel` to its full connected component
 * (Blender's `Ctrl+L` chord — `MESH_OT_select_linked` with no operator
 * popup). The returned set IS the union of every component touched by
 * the input selection plus the input selection itself; isolated verts
 * (no incident edges) survive as singletons.
 *
 * Adjacency is built once per call. Components are found by walking
 * BFS from each not-yet-visited seed in the input set — early-exiting
 * via the union visited set keeps complexity at O(V + E) regardless
 * of input selection size.
 *
 * @param {{vertices?: any[], triangles?: any}} mesh
 * @param {Iterable<number>} currentSel
 * @returns {Set<number>|null} - expanded selection, or null when mesh
 *   has no verts.
 */
export function selectLinkedExpandSelection(mesh, currentSel) {
  const verts = Array.isArray(mesh?.vertices) ? mesh.vertices : null;
  // Null when there are no verts at all — matches the documented
  // contract and aligns with `selectLinkedFromVertex`'s null-on-OOB
  // behaviour. Callers can distinguish "no mesh data" (null) from
  // "valid mesh but no expansion happened" (empty Set).
  if (!verts || verts.length === 0) return null;
  const flat = extractTriangleIndices(mesh.triangles);
  const adj = buildVertexAdjacency(flat, verts.length);

  /** @type {Set<number>} */
  const visited = new Set();
  for (const seed of currentSel) {
    if (typeof seed !== 'number') continue;
    if (seed < 0 || seed >= verts.length) continue;
    if (visited.has(seed)) continue;
    // BFS from this seed; merge the result into visited. Any component
    // already visited via a prior seed is short-circuited because the
    // shared `visited` Set is the BFS frontier check.
    if (!adj.has(seed)) {
      visited.add(seed);
      continue;
    }
    /** @type {number[]} */
    const queue = [seed];
    visited.add(seed);
    while (queue.length > 0) {
      const cur = /** @type {number} */ (queue.shift());
      const neighbours = adj.get(cur);
      if (!neighbours) continue;
      for (const n of neighbours) {
        if (visited.has(n)) continue;
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited;
}
