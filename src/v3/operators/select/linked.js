// @ts-check

/**
 * Toolset Plan Phase 6.A — Select Linked.
 *
 * Two pure functions implementing Blender's `MESH_OT_select_linked` /
 * `MESH_OT_select_linked_pick` semantics specialized for SS's
 * vertex-only mesh model:
 *
 *   - `selectLinkedFromVertex(mesh, originIdx)` — flood-fill from one
 *     vertex along edge-adjacency. Mirrors Blender's `select_linked_pick`
 *     (`reference/blender/source/blender/editors/mesh/editmesh_select.cc:5070+`)
 *     called via the `L` cursor chord. Pre-fix the user clicks on a
 *     mesh under the cursor; we hit-test for the nearest vertex first.
 *
 *   - `selectLinkedExpandSelection(mesh, currentSel)` — expand each
 *     vertex in the existing selection to its full connected component.
 *     Mirrors Blender's `MESH_OT_select_linked` (the `Ctrl+L` chord)
 *     which operates on the existing selection rather than the cursor.
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
