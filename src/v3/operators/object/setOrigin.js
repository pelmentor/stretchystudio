// @ts-check

/**
 * Toolset Plan Phase 7.A.5 — Set Origin (right-click → Set Origin
 * submenu).
 *
 * Implements the relevant subset of Blender's `OBJECT_OT_origin_set`
 * (`reference/blender/source/blender/editors/object/object_transform.cc:1873`
 * — operator registration; audit fix D-4 corrected a pre-existing wrong
 * cite at `:760+` which is inside the unrelated Apply Transform exec).
 * Four modes (Blender RNA `type` enum values):
 *
 *   - 'median'      = ORIGIN_TO_GEOMETRY (centroid)
 *   - 'cursor'      = ORIGIN_TO_CURSOR
 *   - 'bboxCenter'  = ORIGIN_TO_GEOMETRY with bounds=True (Blender's
 *                     "Origin to Center of Mass (Bounds)" picks BBox
 *                     centre via `bounding_box_center`)
 *   - 'weightedGeom'= "Origin to Center of Mass (Volume)" — Blender uses
 *                     volume-weighted centroid; SS uses bone-weight
 *                     weighted centroid which approximates the same
 *                     "what the mesh leans toward" intuition for 2D
 *                     skinned meshes.
 *
 * # Math
 *
 * Goal: move the part's "origin" (= world position of mesh-local (0,0))
 * to a target world point WITHOUT moving any mesh vertex visually.
 *
 * Per `makeLocalMatrix` (`renderer/transforms.js:90+`), the local matrix
 * for a node maps mesh-local point `p` to local-space point:
 *
 *   p_localframe = M × p + trans
 *
 * where `M` is the 2D rotation/scale block (`m0, m1, m3, m4`) and
 * `trans = (x + pivot) - M × pivot = (I - M) × pivot + (x, y)`. The
 * world position of the origin gizmo (point `p = (0,0)`) is therefore
 * just `trans`.
 *
 * To shift the gizmo by `(dx, dy)` in world while preserving every
 * vertex's world position:
 *
 *   transform.{x, y} += (dx, dy)            // gizmo moves
 *   for each vertex v: v -= inv(M) × (dx, dy)  // mesh stays put
 *   transform.pivot{X,Y} = 0                // canonical post-Set-Origin
 *                                           // pivot at the new origin
 *
 * Resetting pivot to (0, 0) matches Blender's post-Set-Origin convention
 * (the new origin IS the rotation/scale pivot). Without the reset, the
 * old pivot would persist as a stale offset when the user later rotates.
 *
 * # Top-level only (v1)
 *
 * For child nodes (parent != null) the world delta needs to be mapped
 * through the parent's world inverse before being applied to local
 * `transform.{x,y}`, which doubles the math complexity for limited user
 * value (most setOrigin invocations are on top-level body parts). v1
 * restricts to top-level nodes; child nodes get a toast asking the user
 * to clear-parent first.
 *
 * @module v3/operators/object/setOrigin
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { makeLocalMatrix } from '../../../renderer/transforms.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';
import { readCursor } from './snap.js';
import { getMesh } from '../../../store/objectDataAccess.js';

/**
 * Shape-agnostic vertex iterator. Mesh.vertices in SS is one of:
 *   - flat [x0, y0, x1, y1, ...]
 *   - nested [{x, y}, ...]
 *   - nested [[x, y], ...]
 *
 * Returns an `{count, get(i): {x,y}, set(i, x, y)}` object.
 *
 * @param {any} verts
 */
function vertexAccessor(verts) {
  if (!Array.isArray(verts) || verts.length === 0) return null;
  const probe = verts[0];
  if (typeof probe === 'number') {
    return {
      count: Math.floor(verts.length / 2),
      get: (i) => ({ x: verts[i * 2], y: verts[i * 2 + 1] }),
      set: (i, x, y) => { verts[i * 2] = x; verts[i * 2 + 1] = y; },
    };
  }
  if (probe && typeof probe.x === 'number') {
    return {
      count: verts.length,
      get: (i) => ({ x: verts[i].x, y: verts[i].y }),
      set: (i, x, y) => { verts[i].x = x; verts[i].y = y; },
    };
  }
  if (Array.isArray(probe)) {
    return {
      count: verts.length,
      get: (i) => ({ x: verts[i][0], y: verts[i][1] }),
      set: (i, x, y) => { verts[i][0] = x; verts[i][1] = y; },
    };
  }
  return null;
}

/**
 * Median (centroid) of mesh vertices in mesh-local coords. Used by the
 * "Origin to Geometry" mode.
 *
 * Audit D-10 (DOCUMENT-AS-DEVIATION): Blender's `ORIGIN_GEOMETRY` reads
 * `scene->toolsettings->transform_pivot_point`
 * (`object_transform.cc:1315-1330`) and switches between median + bbox
 * center based on the user's pivot setting. SS has no persistent
 * transform-pivot setting, so we hardcode arithmetic mean (== Blender's
 * default Median Point). Fix would require a new pivot-mode setting
 * across the whole modal G/R/S surface — out of scope for this phase.
 *
 * @param {any} verts
 * @returns {{x:number, y:number} | null}
 */
export function meshMedian(verts) {
  const acc = vertexAccessor(verts);
  if (!acc || acc.count === 0) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < acc.count; i++) {
    const v = acc.get(i);
    sx += v.x;
    sy += v.y;
  }
  return { x: sx / acc.count, y: sy / acc.count };
}

/**
 * AABB centre of mesh vertices in mesh-local coords. Used by the
 * "Origin to Center of Mass (Surface)" mode.
 *
 * Audit D-11 (DOCUMENT-AS-DEVIATION): Blender's `ORIGIN_CENTER_OF_MASS_SURFACE`
 * uses `BKE_mesh_center_of_surface` (`object_transform.cc:1463-1464`)
 * which iterates triangulated faces and weights each face centroid by
 * its area. SS approximates with the AABB midpoint. Implementing
 * area-weighted centroid in 2D requires per-triangle area calculation
 * across the whole mesh; the bbox approximation is reasonable for the
 * 2D polygon shapes used in Live2D rigging. Label retained as
 * "Surface" for muscle memory; menu comment clarifies the approximation.
 *
 * @param {any} verts
 * @returns {{x:number, y:number} | null}
 */
export function meshBBoxCenter(verts) {
  const acc = vertexAccessor(verts);
  if (!acc || acc.count === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < acc.count; i++) {
    const v = acc.get(i);
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Weighted centroid using `mesh.boneWeights`. Falls back to plain
 * median when no weights are present (the reasonable default — the
 * "weighted" mode without weights is just unweighted).
 *
 * @param {any} mesh
 * @returns {{x:number, y:number} | null}
 */
export function meshWeightedCenter(mesh) {
  const verts = mesh?.vertices;
  const acc = vertexAccessor(verts);
  if (!acc || acc.count === 0) return null;
  const weights = mesh.boneWeights;
  if (!Array.isArray(weights) || weights.length !== acc.count) {
    return meshMedian(verts);
  }
  let sx = 0, sy = 0, wsum = 0;
  for (let i = 0; i < acc.count; i++) {
    const w = typeof weights[i] === 'number' ? weights[i] : 0;
    if (w <= 0) continue;
    const v = acc.get(i);
    sx += v.x * w;
    sy += v.y * w;
    wsum += w;
  }
  if (wsum <= 0) return meshMedian(verts);
  return { x: sx / wsum, y: sy / wsum };
}

/**
 * Map a mesh-local point through the node's local matrix to get its
 * world position (= local-frame of parent; for top-level == canvas).
 *
 * @param {any} transform
 * @param {{x:number, y:number}} pLocal
 * @returns {{x:number, y:number}}
 */
function meshLocalToParentLocal(transform, pLocal) {
  const M = makeLocalMatrix(transform);
  return {
    x: M[0] * pLocal.x + M[3] * pLocal.y + M[6],
    y: M[1] * pLocal.x + M[4] * pLocal.y + M[7],
  };
}

/**
 * Apply the Set-Origin shift to a node in place (mutates the projectStore).
 *
 * Caller must have wrapped this in `beginBatch`/`endBatch` if grouping
 * with other ops. We don't beginBatch here because the caller (e.g.,
 * a "for each selected") may want everything in one undo entry.
 *
 * @param {string} nodeId
 * @param {{x:number, y:number}} newGizmoParentSpace
 *   target gizmo position in the node's PARENT-LOCAL frame (== world for
 *   top-level nodes; computed by caller for child nodes)
 * @returns {{ ok: boolean, reason?: string }}
 */
export function applySetOrigin(nodeId, newGizmoParentSpace) {
  const project = useProjectStore.getState().project;
  const node = project?.nodes?.find((n) => n?.id === nodeId);
  if (!node) return { ok: false, reason: 'node missing' };
  if (node.type !== 'part') return { ok: false, reason: 'not a part' };
  if (!node.transform) return { ok: false, reason: 'no transform' };
  if (node.parent) return { ok: false, reason: 'has parent' };
  // v18: route through getMesh so post-split parts (geometry on a
  // sibling meshData node via node.dataId) resolve. Pre-fix this read
  // returned undefined for every post-v18 part — Set Origin reported
  // `reason:'no mesh'` for working geometry on any loaded project.
  const partMesh = getMesh(node, project);
  const verts = partMesh?.vertices;
  if (!Array.isArray(verts) || verts.length === 0) {
    return { ok: false, reason: 'no mesh' };
  }
  const M = makeLocalMatrix(node.transform);
  const dx = newGizmoParentSpace.x - M[6];
  const dy = newGizmoParentSpace.y - M[7];
  if (dx === 0 && dy === 0) return { ok: true }; // already at target
  // 2x2 inverse of the rotation/scale block.
  const m0 = M[0], m1 = M[1], m3 = M[3], m4 = M[4];
  const det = m0 * m4 - m1 * m3;
  if (Math.abs(det) < 1e-9) return { ok: false, reason: 'degenerate matrix' };
  const inv00 =  m4 / det;
  const inv01 = -m3 / det;
  const inv10 = -m1 / det;
  const inv11 =  m0 / det;
  // Local shift to apply to each vertex (mesh-local coords).
  const lsx = -(inv00 * dx + inv01 * dy);
  const lsy = -(inv10 * dx + inv11 * dy);

  useProjectStore.getState().updateProject((proj, vc) => {
    const target = proj.nodes.find((n) => n?.id === nodeId);
    if (!target?.transform) return;
    const targetMesh = getMesh(target, proj);
    if (!Array.isArray(targetMesh?.vertices)) return;
    // Shift mesh vertices to compensate for the gizmo move.
    const acc = vertexAccessor(targetMesh.vertices);
    if (acc) {
      for (let i = 0; i < acc.count; i++) {
        const v = acc.get(i);
        acc.set(i, v.x + lsx, v.y + lsy);
      }
    }
    // Move gizmo (= transform.x/y by the world delta).
    target.transform.x += dx;
    target.transform.y += dy;
    // Reset pivot to (0,0) — Blender's post-Set-Origin convention.
    target.transform.pivotX = 0;
    target.transform.pivotY = 0;
    if (vc) {
      vc.transformVersion++;
      if (vc.geometryVersion !== undefined) vc.geometryVersion++;
    }
  });
  return { ok: true };
}

/**
 * Run a Set-Origin mode against every selected meshed top-level part.
 * Bones, groups, child parts, and parts without a mesh are silently
 * skipped (caller surfaces the count in a toast).
 *
 * @param {'median' | 'cursor' | 'bboxCenter' | 'weightedGeom'} mode
 * @returns {{ moved: number, skipped: number, mode: string }}
 */
export function setOriginForSelection(mode) {
  const items = useSelectionStore.getState().items ?? [];
  const project = useProjectStore.getState().project;
  const cursor = readCursor(project);
  let moved = 0;
  let skipped = 0;
  // Audit fix G-1 — beginBatch needs `project` for a real snapshot.
  beginBatch(project);
  try {
    for (const it of items) {
      if (it?.type !== 'part') { skipped++; continue; }
      const node = project.nodes.find((n) => n?.id === it.id);
      if (!node || node.type !== 'part') { skipped++; continue; }
      if (node.parent) { skipped++; continue; }
      const mesh = getMesh(node, project);
      if (!mesh) { skipped++; continue; }

      let target;
      if (mode === 'cursor') {
        target = { x: cursor.x, y: cursor.y };
      } else {
        let pLocal = null;
        if (mode === 'median')           pLocal = meshMedian(mesh.vertices);
        else if (mode === 'bboxCenter')  pLocal = meshBBoxCenter(mesh.vertices);
        else if (mode === 'weightedGeom') pLocal = meshWeightedCenter(mesh);
        if (!pLocal) { skipped++; continue; }
        target = meshLocalToParentLocal(node.transform, pLocal);
      }
      const r = applySetOrigin(it.id, target);
      if (r.ok) moved++;
      else skipped++;
    }
  } finally {
    endBatch();
  }
  return { moved, skipped, mode };
}
