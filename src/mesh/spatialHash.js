/**
 * 2D spatial hash for "is any point within distance r of (x,y)?" queries.
 *
 * Used by mesh dedup paths that previously ran O(N²) inner loops over
 * the growing accumulator. With `cellSize = r` the 3×3 cells around a
 * query position cover every point within r distance, so each query
 * is O(k) where k is the local density (typically <10).
 *
 * @module mesh/spatialHash
 */

export class SpatialHash {
  /**
   * @param {number} cellSize - must be >= the query radius used with
   *   `hasWithin`. Smaller cells → fewer candidates per query but more
   *   bucketing overhead; equal-to-radius is the sweet spot.
   */
  constructor(cellSize) {
    if (!(cellSize > 0)) throw new Error(`SpatialHash: cellSize must be > 0, got ${cellSize}`);
    this.cellSize = cellSize;
    /** @type {Map<string, Array<[number, number]>>} */
    this._cells = new Map();
  }

  _key(cx, cy) { return `${cx},${cy}`; }

  /**
   * Insert a point.
   * @param {number} x
   * @param {number} y
   */
  add(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const key = this._key(cx, cy);
    let arr = this._cells.get(key);
    if (!arr) { arr = []; this._cells.set(key, arr); }
    arr.push([x, y]);
  }

  /**
   * Bulk insert.
   * @param {Iterable<[number, number]>} points
   */
  addAll(points) {
    for (const [x, y] of points) this.add(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} dist - must be <= `cellSize`. Returns true if any
   *   inserted point is within `dist` (Euclidean) of (x, y).
   */
  hasWithin(x, y, dist) {
    const dist2 = dist * dist;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this._cells.get(this._key(cx + dx, cy + dy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const ex = arr[i][0] - x;
          const ey = arr[i][1] - y;
          if (ex * ex + ey * ey < dist2) return true;
        }
      }
    }
    return false;
  }
}
