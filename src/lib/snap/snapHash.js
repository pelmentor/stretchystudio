// @ts-check

/**
 * Toolset Plan Phase 2.C — vertex-identity spatial hash for snap-to-vertex.
 *
 * Wraps a generic-cell-grid pattern (mirrors `mesh/spatialHash.js`)
 * but stores `(x, y, partId, vertIndex)` per point so the modal can
 * return the snap target's identity, not just its position.
 *
 * Lifecycle:
 *
 *   1. Modal G enters → `getOrBuildSnapHash(project)` — returns the
 *      cached hash if `_version` matches; rebuilds otherwise.
 *   2. Modal G tick → `findNearestVertex(hash, x, y, threshold)` —
 *      O(k) where k is local density (typically <10).
 *   3. Topology change anywhere in the project (mesh-worker remesh,
 *      add_vertex, remove_vertex, dispatchMeshWorker) →
 *      `invalidateSnapHash()` bumps the version stamp; next get
 *      rebuilds.
 *
 * "Rest verts" means `node.mesh.vertices` (canvas-px), not the live
 * deformed verts. Per plan §2.C — snap-to-rest is the contract;
 * snap-to-deformed is a future follow-up if Pose Mode use cases
 * demand it.
 *
 * Threshold parameter is in canvas-px; cellSize matches threshold so
 * the 3×3 neighbour-cell scan covers the search radius.
 *
 * @module lib/snap/snapHash
 */

import { getMeshVertices } from '../../store/objectDataAccess.js';

/** Module-scoped singleton — one hash per build, keyed by version
 *  bump AND by project identity. Project identity catches whole-store
 *  swaps (PSD import, project load, undo to a prior snapshot) without
 *  any external invalidation hook. The version stamp catches
 *  in-place mutations to a project we've already cached. */
let _hash = null;
let _version = 0;
let _builtVersion = -1;
let _builtProjectRef = null;

/** Bump the version stamp. Next `getOrBuildSnapHash` call rebuilds. */
export function invalidateSnapHash() {
  _version += 1;
}

/** Test-only — drop the cached hash and reset version stamps. */
export function _resetSnapHashForTests() {
  _hash = null;
  _version = 0;
  _builtVersion = -1;
  _builtProjectRef = null;
}

/** Coerce mixed vertex shapes (`Array<{x,y}>` or flat `[x,y,...]`) to
 *  `Array<{x,y}>`. Returns null if the input isn't usable.
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

class VertexSnapHash {
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
   *  `dist` MUST be <= `cellSize` (caller responsibility). */
  findNearest(x, y, dist, opts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dist2 = dist * dist;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const excludePartId = opts?.excludePartId ?? null;
    const excludeVertSet = opts?.excludeVertSet ?? null;
    let best = null;
    let bestD2 = dist2;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this._cells.get(this._key(cx + dx, cy + dy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (excludePartId && v.partId === excludePartId) {
            if (!excludeVertSet || excludeVertSet.has(v.vertIndex)) continue;
          }
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

/** Rebuild from the current project. `cellSize` is the largest
 *  threshold the caller will query with; default 32 px gives plenty
 *  of headroom for the 8 px default + room for raised user values. */
export function buildSnapHash(project, cellSize = 32) {
  const hash = new VertexSnapHash(cellSize);
  if (!project || !Array.isArray(project.nodes)) return hash;
  for (const node of project.nodes) {
    if (!node || node.type !== 'part') continue;
    const verts = normaliseVerts(getMeshVertices(node, project));
    if (!verts) continue;
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (!v) continue;
      hash.add(v.x, v.y, node.id, i);
    }
  }
  return hash;
}

/** Cached build. Rebuilds if (a) `invalidateSnapHash` has been called
 *  since the last build, (b) the project identity has changed since
 *  the last build (whole-store swap), or (c) the requested cellSize
 *  exceeds the cached hash's cellSize. */
export function getOrBuildSnapHash(project, cellSize = 32) {
  if (_hash
      && _builtVersion === _version
      && _builtProjectRef === project
      && _hash.cellSize >= cellSize) {
    return _hash;
  }
  _hash = buildSnapHash(project, cellSize);
  _builtVersion = _version;
  _builtProjectRef = project;
  return _hash;
}

/** Convenience reader — returns the snap target identity + position
 *  if any rest vertex lies within `threshold` of (x, y), else null.
 *
 *  @param {object} project
 *  @param {number} x  canvas-px
 *  @param {number} y  canvas-px
 *  @param {number} threshold canvas-px
 *  @param {{ excludePartId?: string|null, excludeVertSet?: Set<number>|null }} [opts]
 */
export function findNearestVertex(project, x, y, threshold, opts) {
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  const cellSize = Math.max(threshold, 32);
  const hash = getOrBuildSnapHash(project, cellSize);
  if (hash.count === 0) return null;
  return hash.findNearest(x, y, threshold, opts);
}
