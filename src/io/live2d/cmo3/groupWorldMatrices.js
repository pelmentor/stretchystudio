// @ts-check

import { makeLocalMatrix, mat3Mul } from '../../../renderer/transforms.js';

/**
 * Group world-matrix + deformer-origin computation, lifted out of
 * `cmo3writer.js` (Phase 6 god-class breakup).
 *
 * Two responsibilities, run together because the second consumes
 * the first:
 *
 *   1. **World matrix per group.** Walks the group parent chain and
 *      memoises the cumulative 3×3 transform matrix for every group.
 *      Recursive — each parent is resolved before its child gets
 *      composed. Groups whose `parent` doesn't resolve in `groupMap`
 *      are treated as root-level and use their local matrix verbatim.
 *
 *   2. **Deformer world origin per group.** The Cubism deformer is
 *      anchored at the group's pivot, transformed to canvas space
 *      via the world matrix. When the group's pivot is (0,0), no
 *      explicit anchor was authored — fall back to the bounding box
 *      centre of the group's descendant meshes (so the rotation/warp
 *      origin sits inside the visible body of the part). If the
 *      descendant set is empty, fall back to canvas centre.
 *
 * Pure: same inputs always produce the same outputs, no I/O. The
 * caller plugs the resulting maps into deformer emission below.
 *
 * @module io/live2d/cmo3/groupWorldMatrices
 */

/**
 * @typedef {{
 *   pivotX?: number,
 *   pivotY?: number,
 *   x?: number, y?: number,
 *   rotationDeg?: number,
 *   scaleX?: number, scaleY?: number,
 * }} GroupTransform
 */

/**
 * @typedef {{
 *   id: string,
 *   parent?: string|null,
 *   transform?: GroupTransform,
 * }} GroupLike
 */

/**
 * @typedef {{ parentGroupId?: string|null, vertices: number[] }} MeshLike
 */

/**
 * Compute world-space matrices and deformer origins for every group.
 *
 * @param {GroupLike[]} groups
 * @param {MeshLike[]} meshes
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {{
 *   groupWorldMatrices: Map<string, Float32Array>,
 *   deformerWorldOrigins: Map<string, { x: number, y: number }>,
 * }}
 */
export function computeGroupWorldMatrices(groups, meshes, canvasW, canvasH) {
  const groupWorldMatrices = new Map();
  const groupMap = new Map(groups.map(g => [g.id, g]));

  function resolveGroupWorld(groupId) {
    if (groupWorldMatrices.has(groupId)) return groupWorldMatrices.get(groupId);
    const g = groupMap.get(groupId);
    if (!g) return new Float32Array([1,0,0, 0,1,0, 0,0,1]);
    const local = makeLocalMatrix(g.transform);
    const world = (g.parent && groupMap.has(g.parent))
      ? mat3Mul(resolveGroupWorld(g.parent), local)
      : local;
    groupWorldMatrices.set(groupId, world);
    return world;
  }
  for (const g of groups) resolveGroupWorld(g.id);

  const deformerWorldOrigins = new Map();
  for (const g of groups) {
    const wm = groupWorldMatrices.get(g.id);
    const t = g.transform || {};
    const px = t.pivotX ?? 0, py = t.pivotY ?? 0;
    // Pivot in world space: worldMatrix × [pivotX, pivotY, 1]
    const worldPivotX = wm[0] * px + wm[3] * py + wm[6];
    const worldPivotY = wm[1] * px + wm[4] * py + wm[7];

    const hasPivot = px !== 0 || py !== 0;
    if (hasPivot) {
      deformerWorldOrigins.set(g.id, { x: worldPivotX, y: worldPivotY });
      continue;
    }

    // Fallback: BFS to all descendants, then bounding box of their meshes.
    const descendantIds = new Set([g.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const g2 of groups) {
        if (!descendantIds.has(g2.id) && g2.parent && descendantIds.has(g2.parent)) {
          descendantIds.add(g2.id);
          changed = true;
        }
      }
    }
    const descMeshes = meshes.filter(m => m.parentGroupId && descendantIds.has(m.parentGroupId));
    if (descMeshes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const gm of descMeshes) {
        for (let vi = 0; vi < gm.vertices.length; vi += 2) {
          const vx = gm.vertices[vi], vy = gm.vertices[vi + 1];
          if (vx < minX) minX = vx; if (vy < minY) minY = vy;
          if (vx > maxX) maxX = vx; if (vy > maxY) maxY = vy;
        }
      }
      deformerWorldOrigins.set(g.id, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    } else {
      deformerWorldOrigins.set(g.id, { x: canvasW / 2, y: canvasH / 2 });
    }
  }

  return { groupWorldMatrices, deformerWorldOrigins };
}
