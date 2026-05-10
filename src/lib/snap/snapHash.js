// @ts-check

/**
 * Toolset Plan Phase 2.C — vertex-identity spatial hash for snap-to-vertex.
 *
 * Wraps a generic-cell-grid pattern (mirrors `mesh/spatialHash.js`)
 * but stores `(x, y, partId, vertIndex)` per point so the modal can
 * return the snap target's identity, not just its position.
 *
 * Lifecycle (audit-revised 2026-05-10):
 *
 *   - **No module-level cache.** Each Modal G entry builds a fresh
 *     hash (~1 ms per ~5000 verts; negligible for SS-scale projects).
 *     This sidesteps the invalidation-hook maintenance burden that the
 *     prior cache imposed (3 sites in CanvasViewport + 2 missing-MED
 *     gaps the audit found in `applyPoseAsRest` / `resetToRestPose`)
 *     in exchange for the build cost.
 *   - **Pose Mode override.** Pass `opts.frames` (the live `chainEval` /
 *     depgraph result map keyed by partId) to build over post-skinning
 *     deformed verts instead of `node.mesh.vertices` rest data. Modal
 *     callsite consults `editorStore.editMode === 'pose'` to decide.
 *
 * Threshold parameter is in canvas-px; cellSize matches threshold so
 * the 3×3 neighbour-cell scan covers the search radius.
 *
 * @module lib/snap/snapHash
 */

import { getMeshVertices } from '../../store/objectDataAccess.js';

/** Coerce mixed vertex shapes (`Array<{x,y}>` or flat `[x,y,...]` /
 *  `Float32Array`) to `Array<{x,y}>`. Returns null if the input
 *  isn't usable.
 *
 *  @param {any} verts
 *  @returns {Array<{x:number,y:number}>|null}
 */
function normaliseVerts(verts) {
  if (verts == null) return null;
  const isArr = Array.isArray(verts);
  const isTyped = ArrayBuffer.isView(verts) && typeof (/** @type {any} */ (verts)).length === 'number';
  if (!isArr && !isTyped) return null;
  const len = /** @type {any} */ (verts).length;
  if (len === 0) return [];
  const head = /** @type {any} */ (verts)[0];
  // Object-shape: leave as-is.
  if (typeof head === 'object' && head != null && 'x' in head && 'y' in head) {
    return /** @type {Array<{x:number,y:number}>} */ (verts);
  }
  // Flat numeric: pair up.
  if (typeof head === 'number') {
    const out = new Array(Math.floor(len / 2));
    for (let i = 0; i < out.length; i++) {
      out[i] = { x: /** @type {any} */ (verts)[i * 2], y: /** @type {any} */ (verts)[i * 2 + 1] };
    }
    return out;
  }
  return null;
}

export class VertexSnapHash {
  /** @param {number} cellSize */
  constructor(cellSize) {
    if (!(cellSize > 0)) throw new Error(`VertexSnapHash: cellSize must be > 0, got ${cellSize}`);
    this.cellSize = cellSize;
    /** @type {Map<string, Array<{x:number,y:number,partId:string,vertIndex:number}>>} */
    this._cells = new Map();
    this.count = 0;
  }

  _key(cx, cy) { return `${cx},${cy}`; }

  add(x, y, partId, vertIndex) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const key = this._key(cx, cy);
    let arr = this._cells.get(key);
    if (!arr) { arr = []; this._cells.set(key, arr); }
    arr.push({ x, y, partId, vertIndex });
    this.count += 1;
  }

  /** Returns the nearest vertex within `dist` of (x, y), or null.
   *  `dist` MUST be <= `cellSize` (caller responsibility).
   *
   *  `opts.excludePartId` — skip every vertex of this part. */
  findNearest(x, y, dist, opts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dist2 = dist * dist;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const excludePartId = opts?.excludePartId ?? null;
    let best = null;
    let bestD2 = dist2;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this._cells.get(this._key(cx + dx, cy + dy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (excludePartId && v.partId === excludePartId) continue;
          const ex = v.x - x;
          const ey = v.y - y;
          const d2 = ex * ex + ey * ey;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = v;
          }
        }
      }
    }
    return best;
  }
}

/** Resolve the vertex source for a given part. Pose-Mode override
 *  (`opts.frames[partId].finalVerts`) wins when present so the snap
 *  target tracks the deformed visible mesh. Falls back to rest verts
 *  otherwise. */
function getSnapVerts(node, project, frames) {
  if (frames) {
    const frame = frames.get?.(node.id) ?? frames[node.id];
    if (frame?.finalVerts) {
      const norm = normaliseVerts(frame.finalVerts);
      if (norm) return norm;
    }
  }
  return normaliseVerts(getMeshVertices(node, project));
}

/** Build a fresh snap hash from the current project state.
 *
 *  @param {object} project
 *  @param {object} [opts]
 *  @param {number} [opts.cellSize]  Default 32; must be >= the largest
 *    threshold the caller will query with.
 *  @param {Map<string, {finalVerts?: any}>|object} [opts.frames]
 *    When provided, uses `frames[partId].finalVerts` (deformed verts
 *    in canvas-px) per part instead of rest verts. For Pose Mode.
 *  @param {string|null} [opts.excludePartId]  Skip every vertex of
 *    this part during the build (Object Mode: don't snap the dragged
 *    part to its own verts). Sister to `findNearest({excludePartId})`
 *    but here it's a build-time filter so excluded verts never enter
 *    the hash, which is faster than per-query filtering.
 */
export function buildSnapHash(project, opts = {}) {
  const cellSize = opts.cellSize ?? 32;
  const hash = new VertexSnapHash(cellSize);
  if (!project || !Array.isArray(project.nodes)) return hash;
  const frames = opts.frames ?? null;
  const exclude = opts.excludePartId ?? null;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    if (exclude && node.id === exclude) continue;
    const verts = getSnapVerts(node, project, frames);
    if (!verts) continue;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (!v) continue;
      hash.add(v.x, v.y, node.id, i);
    }
  }
  return hash;
}

/** One-shot convenience reader. Builds a fresh hash, queries, returns
 *  the hit (or null). Use this for occasional / test queries; for the
 *  modal G inner loop, build the hash once (`buildSnapHash`) at modal
 *  mount, hold the reference, and call `hash.findNearest` directly.
 *
 *  @param {object} project
 *  @param {number} x  canvas-px
 *  @param {number} y  canvas-px
 *  @param {number} threshold canvas-px
 *  @param {{ excludePartId?: string|null, frames?: any }} [opts]
 */
export function findNearestVertex(project, x, y, threshold, opts) {
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  const hash = buildSnapHash(project, {
    cellSize: Math.max(threshold, 32),
    frames: opts?.frames,
    excludePartId: opts?.excludePartId,
  });
  if (hash.count === 0) return null;
  return hash.findNearest(x, y, threshold);
}
