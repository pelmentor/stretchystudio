// @ts-check

/**
 * Toolset Plan Phase 3 — Sculpt mode brush registry + shared helpers.
 *
 * Three brushes, all cursor-centered (vs proportional-edit which is
 * vertex-centered): falloff is computed from each affected vertex's
 * distance to the brush cursor in mesh-local space, scaled by
 * `applyFalloff(t, falloff)` from `proportionalEdit.js` so the curves
 * match Blender 1:1.
 *
 * Brush API (all three brushes follow the same shape):
 *
 *   `tick(opts) → Map<vertIndex, { x: number, y: number }>`
 *
 * The map's keys are vertex indices into `opts.verts`; the values are
 * the NEW absolute positions to write back. Callers translate the map
 * into a `m.vertices[i].x / .y` mutation; brushes don't know about
 * stores or React.
 *
 * Brushes are stateless — the calling layer holds the per-stroke state
 * (prev cursor, accumulated delta, etc.). This keeps brushes pure +
 * trivially testable.
 *
 * @module lib/sculpt
 */

import { applyFalloff, reachableFrom } from '../proportionalEdit.js';
import { grabTick }   from './grab.js';
import { smoothTick } from './smooth.js';
import { pinchTick }  from './pinch.js';

/** @typedef {'smooth'|'sphere'|'root'|'linear'|'constant'|'sharp'|'invSquare'} FalloffKind */

/**
 * Per-tick brush call options. All brushes accept this superset; brush
 * impls ignore the fields they don't use (e.g. Grab ignores
 * `iterations`; Smooth uses it).
 *
 * @typedef {Object} BrushTickOpts
 * @property {ArrayLike<{x:number, y:number}>} verts  - CURRENT vertex
 *   positions in mesh-local coords (the brush mutates from here)
 * @property {{x:number, y:number}}            cursor      - cursor in mesh-local
 * @property {{x:number, y:number}|null}       prevCursor  - cursor at previous
 *   tick (null on first tick); Grab needs this for delta
 * @property {number}                          size        - mesh-local radius
 * @property {number}                          strength    - 0..1
 * @property {FalloffKind}                     falloff
 * @property {boolean}                         [ctrl]      - modal toggle
 *   (Pinch flips to Magnify when held)
 * @property {Array<Set<number>>}              [adjacency] - required for
 *   Smooth (Laplacian neighbours) AND for connectedOnly mode on any
 *   brush
 * @property {boolean}                         [connectedOnly]
 * @property {number|null}                     [originIdx] - vertex index
 *   under the cursor at stroke start; required for connectedOnly BFS
 * @property {number}                          [iterations] - Smooth
 *   only; default 1
 */

/**
 * Brush registry. Each entry pairs a stable id with a per-tick impl.
 * The id is what `editorStore.sculpt.activeBrush` stores; the impl is
 * what `CanvasViewport.onPointerMove` dispatches into for sculpt
 * strokes.
 *
 * @type {Array<{id:string, label:string, hint:string, tick:(opts:BrushTickOpts)=>Map<number,{x:number,y:number}>}>}
 */
export const SCULPT_BRUSHES = [
  {
    id:    'grab',
    label: 'Grab',
    hint:  'Drag mesh — verts within radius follow the cursor with falloff',
    tick:  grabTick,
  },
  {
    id:    'smooth',
    label: 'Smooth',
    hint:  'Laplacian smoothing — each vertex moves toward its neighbours\' average',
    tick:  smoothTick,
  },
  {
    id:    'pinch',
    label: 'Pinch',
    hint:  'Pull verts toward cursor (Ctrl: Magnify — push away from cursor)',
    tick:  pinchTick,
  },
];

/**
 * Lookup brush by id; returns the Grab brush as a safe default for an
 * unknown id (matches Blender's "default brush" fallback behaviour
 * when the active brush datablock disappears).
 *
 * @param {string} id
 */
export function getBrushById(id) {
  return SCULPT_BRUSHES.find((b) => b.id === id) ?? SCULPT_BRUSHES[0];
}

/**
 * Cursor-centered falloff weights — Sculpt's per-vertex weighting
 * primitive. Returns a Float32Array of length `verts.length` where
 * index `i` is the falloff weight for vertex `i` under a brush of
 * `size` (mesh-local radius) centered at `cursor` (mesh-local).
 *
 * Vertices outside the radius get 0. When `connectedOnly` is true,
 * vertices unreachable from `originIdx` via `adjacency` BFS also get
 * 0 even if within Euclidean range.
 *
 * Distinct from `computeProportionalWeights` (which centers on a
 * vertex, not a cursor): sculpt strokes always anchor at the cursor,
 * so the weighting helper has to as well.
 *
 * @param {Object} opts
 * @param {ArrayLike<{x:number, y:number}>} opts.verts
 * @param {{x:number, y:number}}            opts.cursor
 * @param {number}                           opts.size
 * @param {FalloffKind}                      [opts.falloff='smooth']
 * @param {Array<Set<number>>|null}          [opts.adjacency=null]
 * @param {boolean}                          [opts.connectedOnly=false]
 * @param {number|null}                      [opts.originIdx=null]
 * @returns {Float32Array}
 */
export function brushFalloffWeights({
  verts, cursor, size,
  falloff = 'smooth',
  adjacency = null,
  connectedOnly = false,
  originIdx = null,
}) {
  const n = verts.length;
  const out = new Float32Array(n);
  if (!(size > 0)) return out;

  /** @type {Set<number>|null} */
  let reachable = null;
  if (connectedOnly) {
    if (!adjacency || originIdx == null) {
      // No adjacency or no anchor → fall back to "no vertices"
      // rather than treating every vertex as reachable. Matches
      // proportionalEdit's safe-default convention.
      return out;
    }
    reachable = reachableFrom(adjacency, originIdx);
  }

  const cx = cursor.x, cy = cursor.y;
  for (let i = 0; i < n; i++) {
    if (reachable && !reachable.has(i)) continue;
    const dx = verts[i].x - cx;
    const dy = verts[i].y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= size) continue;
    const w = applyFalloff(d / size, falloff);
    if (w > 0) out[i] = w;
  }
  return out;
}

export { grabTick, smoothTick, pinchTick };
