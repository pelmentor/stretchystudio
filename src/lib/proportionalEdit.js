// @ts-check

/**
 * GAP-015 Phase A — Blender-style proportional editing helpers.
 *
 * Three concerns, all data-only (no React, no DOM):
 *
 *   1. **Falloff curves** — `applyFalloff(distNorm, kind)` returns the
 *      per-vertex weight in `[0, 1]` for a normalized distance
 *      `distNorm = dist / radius`. Curves match Blender's
 *      `WM_proportional_falloff` enum: Smooth (default cosine),
 *      Sphere, Root, Linear, Constant. Sharp / Random / InvSquare are
 *      stubbed for parity but not yet exposed in the picker.
 *
 *   2. **Adjacency** — `buildVertexAdjacency(indices, vertexCount)`
 *      returns `Array<Set<number>>` of neighbours for every vertex,
 *      derived from triangle indices. Cheap (one pass over indices)
 *      but heavy on memory for huge meshes — caller decides when to
 *      compute (drag start, not per move event).
 *
 *   3. **Weights** — `computeProportionalWeights(opts)` returns a
 *      `Float32Array` of length `vertexCount` where index `i` holds
 *      the per-vertex weight of vertex `i` under the proportional
 *      edit centered at `originIdx`. The dragged vertex always gets
 *      weight `1.0`; vertices outside the radius (or unreachable in
 *      connected-only mode) get `0.0`.
 *
 * Distance is mesh-local (sqrt(dx² + dy²) of the vertex `{x, y}` in
 * mesh-local coords), matching Blender — so zooming the canvas does
 * not change which vertices are influenced.
 *
 * Connected-only mode walks vertex adjacency BFS from the origin
 * vertex; vertices not reachable are weighted 0 even if they're
 * within Euclidean range. Useful when two flaps of mesh sit close in
 * space but logically belong to different parts of the silhouette.
 *
 * @module lib/proportionalEdit
 */

/** @typedef {'smooth'|'sphere'|'root'|'linear'|'constant'|'sharp'|'invSquare'|'random'} FalloffKind */

/**
 * Cycle order matching Blender's Shift+O hotkey. `random` is omitted
 * (non-determ deformation is rarely useful for character rigging).
 *
 * @type {FalloffKind[]}
 */
export const FALLOFF_CYCLE = ['smooth', 'sphere', 'root', 'linear', 'sharp', 'invSquare', 'constant'];

/**
 * Apply a falloff curve to a normalized distance. Returns the weight
 * in `[0, 1]` for that vertex. Distances at or beyond radius (`t >= 1`)
 * always return 0.
 *
 * @param {number} t   - distance / radius, expected in `[0, 1]`. Values
 *                        below 0 are clamped to 0 (treated as "at the
 *                        center").
 * @param {FalloffKind} kind
 * @returns {number}   - weight in `[0, 1]`
 */
export function applyFalloff(t, kind) {
  if (!(t < 1)) return 0;          // includes t === 1, NaN, +Inf
  const ct = t < 0 ? 0 : t;        // clamp <0
  switch (kind) {
    case 'smooth': {
      // Blender's "smooth" — 3·u² − 2·u³ where u = 1 − t (smoothstep
      // through (1,0) at the rim, (0,1) at the centre). Identical to
      // Blender's WM_propeditfalloff_smooth.
      const u = 1 - ct;
      return u * u * (3 - 2 * u);
    }
    case 'sphere':    return Math.sqrt(1 - ct * ct);
    case 'root':      return Math.sqrt(1 - ct);
    case 'linear':    return 1 - ct;
    case 'constant':  return 1;
    case 'sharp':     return (1 - ct) * (1 - ct);
    case 'invSquare': {
      // (1 - t²)²
      const k = 1 - ct * ct;
      return k * k;
    }
    case 'random':
      return Math.random() * (1 - ct);
    default:
      return 1 - ct;
  }
}

/**
 * GAP-015 Phase B — module-level adjacency cache.
 *
 * Keyed by the `indices` reference: immer (`produce`) replaces the
 * indices array only when topology actually changes (retriangulate,
 * vertex add/remove). Vertex-position drags mutate `vertices[i].x/y`
 * but leave `indices` untouched, so successive drags on the same
 * part hit the cache after the first build. WeakMap auto-clears
 * entries when no live reference holds the indices array — no
 * manual invalidation needed.
 *
 * @type {WeakMap<object, {vertexCount:number, adjacency:Array<Set<number>>}>}
 */
const _adjacencyByIndices = new WeakMap();

/**
 * Cached version of {@link buildVertexAdjacency}. First call for a
 * given `(indices, vertexCount)` builds + caches; subsequent calls
 * with the same `indices` reference return the cached adjacency.
 *
 * @param {object} indices       - triangle index buffer (must be an
 *                                 object — Array, Uint16Array, etc.)
 * @param {number} vertexCount
 * @returns {Array<Set<number>>}
 */
export function getOrBuildAdjacency(indices, vertexCount) {
  const cached = _adjacencyByIndices.get(indices);
  if (cached && cached.vertexCount === vertexCount) return cached.adjacency;
  const adjacency = buildVertexAdjacency(indices, vertexCount);
  _adjacencyByIndices.set(indices, { vertexCount, adjacency });
  return adjacency;
}

/**
 * Build per-vertex adjacency from triangle indices. Each entry is a
 * Set of neighbour vertex indices (undirected, no self-loops).
 *
 * @param {ArrayLike<number>} indices  - triangle index buffer (`length % 3 === 0`)
 * @param {number} vertexCount         - total vertex count
 * @returns {Array<Set<number>>}
 */
export function buildVertexAdjacency(indices, vertexCount) {
  /** @type {Array<Set<number>>} */
  const adj = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) adj[i] = new Set();
  const n = indices.length - (indices.length % 3);
  for (let t = 0; t < n; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (a !== b) { adj[a].add(b); adj[b].add(a); }
    if (b !== c) { adj[b].add(c); adj[c].add(b); }
    if (c !== a) { adj[c].add(a); adj[a].add(c); }
  }
  return adj;
}

/**
 * BFS from `originIdx` returning a Set of every vertex reachable
 * through `adj`. Used for connected-only mode.
 *
 * @param {Array<Set<number>>} adj
 * @param {number} originIdx
 * @returns {Set<number>}
 */
export function reachableFrom(adj, originIdx) {
  const visited = new Set();
  if (originIdx < 0 || originIdx >= adj.length) return visited;
  /** @type {number[]} */
  const queue = [originIdx];
  visited.add(originIdx);
  while (queue.length > 0) {
    const v = queue.shift();
    for (const n of adj[v]) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return visited;
}

/**
 * Compute per-vertex proportional-edit weights for a single-vertex
 * grab.
 *
 * Origin vertex always gets weight `1`. Other vertices get
 * `applyFalloff(dist / radius, falloff)` where dist is Euclidean
 * mesh-local distance. Connected-only mode zeros vertices not
 * reachable from origin via adjacency.
 *
 * @param {Object} opts
 * @param {ArrayLike<{x:number, y:number}>} opts.vertices
 * @param {number} opts.originIdx
 * @param {number} opts.radius                     - mesh-local
 * @param {FalloffKind} [opts.falloff='smooth']
 * @param {boolean} [opts.connectedOnly=false]
 * @param {Array<Set<number>>} [opts.adjacency]    - required when connectedOnly=true
 * @returns {Float32Array}
 */
export function computeProportionalWeights({
  vertices, originIdx, radius,
  falloff = 'smooth',
  connectedOnly = false,
  adjacency = null,
}) {
  const n = vertices.length;
  const out = new Float32Array(n);
  if (originIdx < 0 || originIdx >= n) return out;

  out[originIdx] = 1;
  if (!(radius > 0)) return out; // nothing else to weight

  const cx = vertices[originIdx].x;
  const cy = vertices[originIdx].y;

  /** @type {Set<number>|null} */
  let reachable = null;
  if (connectedOnly) {
    if (!adjacency) {
      // No adjacency available — fall back to "origin only" rather
      // than incorrectly weighting every vertex.
      return out;
    }
    reachable = reachableFrom(adjacency, originIdx);
  }

  for (let i = 0; i < n; i++) {
    if (i === originIdx) continue;
    if (reachable && !reachable.has(i)) continue;
    const dx = vertices[i].x - cx;
    const dy = vertices[i].y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= radius) continue;
    const t = d / radius;
    const w = applyFalloff(t, falloff);
    if (w > 0) out[i] = w;
  }
  return out;
}

/**
 * Cycle to the next falloff in `FALLOFF_CYCLE`. Defaults to
 * `'smooth'` for unknown values. Useful for the `Shift+O` keyboard
 * hotkey.
 *
 * @param {FalloffKind|string} current
 * @returns {FalloffKind}
 */
export function nextFalloff(current) {
  const i = FALLOFF_CYCLE.indexOf(/** @type {FalloffKind} */ (current));
  if (i < 0) return 'smooth';
  return FALLOFF_CYCLE[(i + 1) % FALLOFF_CYCLE.length];
}
