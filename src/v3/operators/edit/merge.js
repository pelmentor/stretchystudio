// @ts-check

/**
 * Toolset Plan Phase 4.A — Merge operator.
 *
 * Five Blender-faithful merge modes (`mesh.merge` enum,
 * `MESH_OT_merge` in `editors/mesh/editmesh_tools.cc`):
 *
 *   - `mergeAtCenter`     — average of selected verts → all collapse there
 *   - `mergeAtCursor`     — all selected verts → cursor canvas-px
 *   - `mergeAtLast`       — all selected verts → activeVertIdx
 *   - `mergeByDistance`   — pairs within `threshold` collapse
 *   - `mergeCollapse`     — each connected component of selection
 *                            collapses to its centroid
 *
 * All mode functions share the same signature and return a
 * `TopologyOpResult` (see `lib/meshTopology.js`). They:
 *
 *   1. Compute the per-old-vert `mergeMap[i] → groupId`.
 *   2. Compact via `compactByGroups` → `oldToNew` + `vertexSources` +
 *      `newCount`.
 *   3. Build new vertex array by averaging positions across each
 *      group's sources (matches Blender semantics — merged vert sits
 *      at centroid of its sources, NOT at any one survivor's pos).
 *   4. Override the output position when the mode demands it
 *      (`atCursor` → cursor coords; `atCenter` → centroid of ALL
 *      selected; `atLast` → active vert's pre-merge position).
 *   5. Remap UVs / triangles / edgeIndices via the helpers.
 *   6. Drop degenerate triangles (a==b/b==c/c==a after rewrite).
 *
 * The five modes intentionally do NOT retriangulate — every triangle
 * that doesn't collapse is preserved (Blender's behaviour is to
 * merge in place; only the dissolve op rebuilds topology). Setting
 * `retriangulated: false` lets the dispatcher skip the GPU index
 * upload when nothing changed below the merge threshold.
 *
 * @module v3/operators/edit/merge
 */

import {
  compactByGroups, remapTriangles, remapEdgeIndices, remapUvs,
  removeDegenerateTriangles, dist2,
} from '../../../lib/meshTopology.js';

/** @typedef {import('../../../lib/meshTopology.js').TopologyOpResult} TopologyOpResult */
/** @typedef {import('../../../lib/meshTopology.js').VertexLike} VertexLike */

/**
 * Build the canonical TopologyOpResult once a mergeMap is computed.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {ArrayLike<number>} mergeMap
 * @param {{x:number, y:number}|null} [overridePos]    - used by atCursor / atLast
 * @param {Set<number>|null} [selectedSet]             - used by atCenter (overrideAvg)
 * @returns {TopologyOpResult}
 */
function buildResult(mesh, mergeMap, overridePos = null, selectedSet = null) {
  const oldCount = mesh.vertices.length;
  const { oldToNew, vertexSources, newCount } = compactByGroups(mergeMap, oldCount);

  // Build new vertices: position = centroid of sources, restX/Y same.
  /** @type {Array<VertexLike>} */
  const vertices = new Array(newCount);
  for (const [newIdx, sources] of vertexSources) {
    let sx = 0, sy = 0, srx = 0, sry = 0;
    for (const s of sources) {
      const v = mesh.vertices[s];
      sx  += v.x;
      sy  += v.y;
      srx += v.restX ?? v.x;
      sry += v.restY ?? v.y;
    }
    const n = sources.length;
    vertices[newIdx] = {
      x:     sx / n,
      y:     sy / n,
      restX: srx / n,
      restY: sry / n,
    };
  }

  // Apply position override (atCursor / atLast / atCenter): for every
  // *merged* group (length > 1), or all groups containing any selected
  // vert, snap the position to `overridePos`. atCenter passes
  // `selectedSet` so even unmerged-but-selected isolated verts move
  // to the centre (matches Blender — every selected vert collapses to
  // the average even when no one's a duplicate).
  if (overridePos) {
    for (const [newIdx, sources] of vertexSources) {
      const isMerged = sources.length > 1;
      const touchesSelection = selectedSet
        ? sources.some((s) => selectedSet.has(s))
        : isMerged;
      if (touchesSelection) {
        vertices[newIdx].x     = overridePos.x;
        vertices[newIdx].y     = overridePos.y;
        vertices[newIdx].restX = overridePos.x;
        vertices[newIdx].restY = overridePos.y;
      }
    }
  }

  // Remap topology + edges via shared helpers.
  /** @type {Map<number, number|null>} */
  const oldToNewN = new Map();
  for (const [k, v] of oldToNew) oldToNewN.set(k, v);
  let triangles = remapTriangles(mesh.triangles, oldToNewN);
  triangles = removeDegenerateTriangles(triangles);
  const edgeIndices = remapEdgeIndices(mesh.edgeIndices, oldToNewN);
  const uvs = remapUvs(mesh.uvs, vertexSources, newCount);

  return {
    vertices,
    uvs,
    triangles,
    edgeIndices,
    vertexIndexRemap: oldToNewN,
    vertexSources,
    retriangulated: false,
  };
}

/**
 * Centroid of the selected verts (their `x`/`y` average). Returns null
 * if selection is empty.
 *
 * @param {Array<VertexLike>} vertices
 * @param {Iterable<number>} selection
 * @returns {{x:number, y:number}|null}
 */
function centroidOf(vertices, selection) {
  let sx = 0, sy = 0, n = 0;
  for (const i of selection) {
    const v = vertices[i];
    if (!v) continue;
    sx += v.x;
    sy += v.y;
    n += 1;
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n };
}

/**
 * Build a mergeMap that collapses every selected index → group 0,
 * leaves unselected verts in their own singleton groups (1..N).
 *
 * @param {number} count
 * @param {Set<number>} selection
 */
function singleGroupForSelection(count, selection) {
  const map = new Array(count);
  let next = 1;
  for (let i = 0; i < count; i++) {
    if (selection.has(i)) map[i] = 0;
    else map[i] = next++;
  }
  return map;
}

/**
 * Merge → average of selected verts. Centroid is the only group; every
 * selected vert collapses there.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @returns {TopologyOpResult|null}
 */
export function mergeAtCenter(mesh, selection) {
  const sel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size < 2) return null;
  const centre = centroidOf(mesh.vertices, sel);
  if (!centre) return null;
  const mergeMap = singleGroupForSelection(mesh.vertices.length, sel);
  return buildResult(mesh, mergeMap, centre, sel);
}

/**
 * Merge → cursor (canvas-px). Every selected vert collapses to the
 * cursor position.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @param {{x:number, y:number}} cursor
 * @returns {TopologyOpResult|null}
 */
export function mergeAtCursor(mesh, selection, cursor) {
  const sel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size < 1) return null;
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  // sel.size === 1 — translate the single vert to cursor (Blender does
  // this; users rely on it as a snap-to-cursor shortcut).
  const mergeMap = singleGroupForSelection(mesh.vertices.length, sel);
  return buildResult(mesh, mergeMap, cursor, sel);
}

/**
 * Merge → active vertex's position. All selected verts collapse to
 * the active vertex.
 *
 * **Active vertex semantics.** Blender's `MESH_OT_merge` `MERGE_LAST`
 * mode reads `em->bm->selected.last` — the most recently added selection
 * entry, in selection-history order. Our `editorStore.activeVertex`
 * tracks the same thing (writes to `activeVertex` happen on every
 * `selectVertex` / `toggleVertexSelection` add path). Callers should
 * pass `editorStore.activeVertex.vertIndex` here so the operator
 * matches Blender's "merge to most-recently-picked vert" semantic; an
 * arbitrary selection-membership index would silently diverge (audit
 * fix D-4).
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @param {number} activeVertIdx
 * @returns {TopologyOpResult|null}
 */
export function mergeAtLast(mesh, selection, activeVertIdx) {
  const sel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size < 2) return null;
  if (!Number.isInteger(activeVertIdx) || activeVertIdx < 0 || activeVertIdx >= mesh.vertices.length) return null;
  if (!sel.has(activeVertIdx)) return null;
  const target = mesh.vertices[activeVertIdx];
  const overridePos = { x: target.x, y: target.y };
  const mergeMap = singleGroupForSelection(mesh.vertices.length, sel);
  return buildResult(mesh, mergeMap, overridePos, sel);
}

/**
 * Merge → first-picked vertex's position. Blender's `MESH_OT_merge`
 * `MERGE_FIRST` reads `em->bm->selected.first` (the OLDEST selection
 * entry in history order). All selected verts collapse to its
 * position. Audit fix D-3 — pre-fix only `MERGE_LAST` was exposed;
 * Blender's M-menu shows both First and Last and a power user can
 * reach for either depending on which end of the lasso they want
 * preserved.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @param {number} firstVertIdx
 * @returns {TopologyOpResult|null}
 */
export function mergeAtFirst(mesh, selection, firstVertIdx) {
  const sel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size < 2) return null;
  if (!Number.isInteger(firstVertIdx) || firstVertIdx < 0 || firstVertIdx >= mesh.vertices.length) return null;
  if (!sel.has(firstVertIdx)) return null;
  const target = mesh.vertices[firstVertIdx];
  const overridePos = { x: target.x, y: target.y };
  const mergeMap = singleGroupForSelection(mesh.vertices.length, sel);
  return buildResult(mesh, mergeMap, overridePos, sel);
}

/**
 * Merge → by distance (Blender's "Remove Doubles"). Verts within
 * `threshold` collapse pairwise. Threshold is in mesh-local units
 * (canvas px for our 2D meshes). Operates on the SELECTED verts only
 * — the canonical Blender semantic ("Merge by Distance" needs you to
 * Select All first).
 *
 * **Taxonomy deviation (audit D-5).** Blender exposes this as a separate
 * operator (`MESH_OT_remove_doubles`, `editmesh_tools.cc:3647-3783`),
 * not a sub-item of `MESH_OT_merge`. SS keeps it under the M-menu for
 * muscle-memory locality (one menu instead of two operator searches).
 *
 * **Missing Blender features (v1 simplifications):**
 *   - `use_unselected` — Blender lets you merge selected verts against
 *     unselected ones (snap selected to nearest unselected within
 *     threshold). SS only merges selected↔selected.
 *   - `use_centroid=false` — Blender lets you collapse pairs to one
 *     specific endpoint (lowest-index wins). SS always uses the
 *     centroid of the merged group.
 *
 * Algorithm: union-find with O(N²) candidate scan inside the selection.
 * For typical Phase 4 selections (a few dozen verts) this is fine; if
 * we ever drag-select a whole 5000-vert mesh we'll need a spatial hash.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @param {number} threshold
 * @returns {TopologyOpResult|null}
 */
export function mergeByDistance(mesh, selection, threshold) {
  const sel = Array.from(selection)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length);
  if (sel.length < 2) return null;
  if (!(threshold > 0)) return null;
  const tSq = threshold * threshold;

  // Union-find over selected vertex indices (DSU keyed by oldIdx).
  /** @type {Map<number, number>} */
  const parent = new Map();
  for (const i of sel) parent.set(i, i);
  function find(i) {
    let root = i;
    while (parent.get(root) !== root) root = /** @type {number} */ (parent.get(root));
    while (parent.get(i) !== root) {
      const p = /** @type {number} */ (parent.get(i));
      parent.set(i, root);
      i = p;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    // Always attach the larger oldIdx to the smaller — keeps the
    // representative oldIdx stable (lower index "wins"). The compactor
    // assigns newIdx by first-appearance order in the mergeMap, so this
    // also gives users a predictable "earliest survivor wins" feel.
    if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb);
  }

  // O(N²) scan inside the selection.
  for (let i = 0; i < sel.length; i++) {
    const va = mesh.vertices[sel[i]];
    for (let j = i + 1; j < sel.length; j++) {
      const vb = mesh.vertices[sel[j]];
      if (dist2(va, vb) <= tSq) union(sel[i], sel[j]);
    }
  }

  // Build mergeMap: selected verts → group = find(oldIdx); unselected
  // verts → unique singleton group (offset past max selected group id).
  const mergeMap = new Array(mesh.vertices.length);
  // Find a safe singleton offset. Group ids are oldIdx for selected
  // representatives — adding mesh.vertices.length keeps them disjoint.
  const SINGLETON_BASE = mesh.vertices.length;
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (parent.has(i)) mergeMap[i] = find(i);
    else               mergeMap[i] = SINGLETON_BASE + i;
  }
  // No threshold pair found → nothing to merge.
  let anyMerged = false;
  for (const i of sel) {
    if (find(i) !== i) { anyMerged = true; break; }
  }
  if (!anyMerged) return null;

  return buildResult(mesh, mergeMap, /* overridePos */ null);
}

/**
 * Merge → collapse: each connected component of the selection (on
 * `adjacency`) collapses to its own centroid. Useful for cleaning up
 * cluttered detail areas where the user lassoed multiple separate
 * regions.
 *
 * Differs from `mergeByDistance` in that it doesn't care about
 * Euclidean distance — only graph connectivity.
 *
 * @param {Object} mesh
 * @param {Array<VertexLike>} mesh.vertices
 * @param {Float32Array|number[]} mesh.uvs
 * @param {Array<[number,number,number]>} mesh.triangles
 * @param {Set<number>|undefined|null} [mesh.edgeIndices]
 * @param {Iterable<number>} selection
 * @param {Array<Set<number>>} adjacency       - vertex adjacency list
 * @returns {TopologyOpResult|null}
 */
export function mergeCollapse(mesh, selection, adjacency) {
  const sel = new Set(Array.from(selection).filter((i) => Number.isInteger(i) && i >= 0 && i < mesh.vertices.length));
  if (sel.size < 2) return null;
  if (!Array.isArray(adjacency)) return null;

  // BFS each connected component INSIDE the selection. Component reps
  // collapse together via the same union-find pattern as mergeByDistance.
  /** @type {Map<number, number>} */
  const parent = new Map();
  for (const i of sel) parent.set(i, i);
  function find(i) {
    let root = i;
    while (parent.get(root) !== root) root = /** @type {number} */ (parent.get(root));
    while (parent.get(i) !== root) {
      const p = /** @type {number} */ (parent.get(i));
      parent.set(i, root);
      i = p;
    }
    return root;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb);
  }
  for (const v of sel) {
    const neighbours = adjacency[v];
    if (!neighbours) continue;
    for (const n of neighbours) {
      if (sel.has(n)) union(v, n);
    }
  }
  // Need at least one edge between selected verts to merge anything.
  let anyMerged = false;
  for (const i of sel) {
    if (find(i) !== i) { anyMerged = true; break; }
  }
  if (!anyMerged) return null;

  const mergeMap = new Array(mesh.vertices.length);
  const SINGLETON_BASE = mesh.vertices.length;
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (parent.has(i)) mergeMap[i] = find(i);
    else               mergeMap[i] = SINGLETON_BASE + i;
  }
  return buildResult(mesh, mergeMap, /* overridePos */ null);
}
