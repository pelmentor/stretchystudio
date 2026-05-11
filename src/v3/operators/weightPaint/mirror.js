// @ts-check

/**
 * Toolset Plan Phase 7.B.3 — Mirror Weights.
 *
 * Mirrors the active weight group's weights along the X axis. Two
 * pairing strategies:
 *
 *   - 'topology': pairs each vertex with the vertex at its mirrored
 *     X coordinate (within ε on the per-mesh mid-X axis). Useful when
 *     vertices are placed symmetrically (auto-rig output usually is).
 *   - 'byName':   for each pair of `Group_L` / `Group_R` weight groups,
 *     copies one side's weights to the other through the same
 *     position-pair mapping. Useful when the user wants to mirror
 *     left-arm weights onto a right-arm group in one shot.
 *
 * Mirrors Blender's `OBJECT_OT_vertex_group_mirror`
 * (`reference/blender/source/blender/editors/object/object_vgroup.cc:3707`
 * — operator registration; exec at `vertex_group_mirror_exec` invoked
 * via `vgroup_mirror`. Blender exposes `mirror_weights`, `flip_group_names`,
 * `all_groups`, `use_topology` properties — SS v1 ships the X-axis case
 * with two explicit pairing modes; the other axes / `all_groups` are
 * documented deviations).
 *
 * # 2D scope
 *
 * Y-axis mirror is mathematically defined (reflect through mid-Y) but
 * rarely useful in 2D character rigging — most characters are bilaterally
 * symmetric horizontally only. Z-axis is a no-op in 2D (no Z coordinate).
 * `mirrorWeights({ axis: 'y' })` and `'z'` return `{ skipped: true }`.
 *
 * # Mirror plane choice
 *
 * Pivots through the mesh's bounding box centre on the chosen axis. The
 * Object's `transform.x` is intentionally NOT used — Blender's vertex
 * group mirror operates in *mesh local space* (Object transform is
 * applied by the modifier stack downstream). Same here: the operator
 * sees the mesh's vertex positions as authoritative and mirrors through
 * their bbox centre.
 *
 * # Pairing tolerance ε
 *
 * Two vertices are considered a mirror pair if `|abs(v1.x - mid) -
 * abs(v2.x - mid)| <= ε` AND `|v1.y - v2.y| <= ε`. ε defaults to 1e-3
 * px. Ungated tolerance would create false pairs for asymmetric mesh;
 * the threshold is small enough that auto-rig output (which places
 * vertices on integer grid positions) always pairs.
 *
 * # byName mode group pairing
 *
 * Groups paired by suffix (case-sensitive):
 *   - `_L` / `_R`
 *   - `.L` / `.R`
 *   - `Left` / `Right`
 *   - `left` / `right`
 *
 * For each (groupL, groupR) pair, copies `groupL`'s weight at vertex `v`
 * to `groupR`'s weight at vertex `mirror(v)`. If the user has selected
 * "Mirror groupX → groupY" explicitly, only that pair runs (single-pair
 * mode used by the popover button).
 *
 * @module v3/operators/weightPaint/mirror
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { getMesh } from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';

/** Recognized name-pair suffixes for `mode: 'byName'`. */
const NAME_PAIRS = [
  ['_L', '_R'],
  ['.L', '.R'],
  ['Left', 'Right'],
  ['left', 'right'],
];

/**
 * Compute a mirror-vertex map for a flat or {x,y} vertex array, mirroring
 * across `axis` ('x' supported; 'y' supported; 'z' returns empty map).
 * Returns `Map<srcIndex, mirrorIndex>` for vertices that have a mirror
 * pair within ε. Vertices without a pair are absent from the map.
 *
 * @param {Array<{x:number,y:number}>|number[]} verts
 * @param {'x'|'y'|'z'} axis
 * @param {number} [eps=1e-3]
 * @returns {Map<number, number>}
 */
export function buildMirrorVertexMap(verts, axis, eps = 1e-3) {
  /** @type {Map<number, number>} */
  const out = new Map();
  if (!verts) return out;
  if (axis !== 'x' && axis !== 'y') return out;

  const n = Array.isArray(verts) && verts.length > 0 && typeof verts[0] === 'object'
    ? verts.length
    : (verts.length / 2) | 0;
  if (n === 0) return out;

  const get = (i) => {
    const v = /** @type {any} */ (verts[i]);
    if (v && typeof v === 'object' && typeof v.x === 'number') {
      return { x: v.x, y: v.y };
    }
    if (Array.isArray(v) && typeof v[0] === 'number') {
      return { x: v[0], y: v[1] };
    }
    return { x: /** @type {number[]} */ (verts)[i * 2],
             y: /** @type {number[]} */ (verts)[i * 2 + 1] };
  };

  let minA = Infinity, maxA = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = get(i);
    const a = axis === 'x' ? v.x : v.y;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
  }
  const mid = (minA + maxA) / 2;

  // Bucket vertices by their non-mirror axis with sub-ε rounding so the
  // pair search is O(N) average rather than O(N²).
  /** @type {Map<string, number[]>} */
  const buckets = new Map();
  const bucketKey = (v) => {
    const other = axis === 'x' ? v.y : v.x;
    return Math.round(other / eps).toString();
  };
  for (let i = 0; i < n; i++) {
    const v = get(i);
    const k = bucketKey(v);
    let bucket = buckets.get(k);
    if (!bucket) { bucket = []; buckets.set(k, bucket); }
    bucket.push(i);
  }

  for (let i = 0; i < n; i++) {
    if (out.has(i)) continue;
    const v = get(i);
    const a = axis === 'x' ? v.x : v.y;
    if (Math.abs(a - mid) <= eps) {
      // Vertex sits on the mirror axis — pairs with itself.
      out.set(i, i);
      continue;
    }
    const bucket = buckets.get(bucketKey(v));
    if (!bucket) continue;
    const targetA = mid + (mid - a);  // reflect through mid
    let bestJ = -1;
    let bestDA = Infinity;
    for (const j of bucket) {
      if (j === i) continue;
      const w = get(j);
      const wa = axis === 'x' ? w.x : w.y;
      const da = Math.abs(wa - targetA);
      if (da < bestDA) {
        bestDA = da;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && bestDA <= eps * 10) {
      out.set(i, bestJ);
      out.set(bestJ, i);
    }
  }
  return out;
}

/**
 * Detect whether a group-name pair (a, b) is a recognized L/R pairing.
 * Returns the pair tuple ('left' name first, 'right' name second) so
 * callers can iterate group sources consistently, or null if not a pair.
 *
 * @param {string} a
 * @param {string} b
 * @returns {{ left: string, right: string } | null}
 */
export function pairGroupNames(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  for (const [lSuf, rSuf] of NAME_PAIRS) {
    if (a.endsWith(lSuf) && b.endsWith(rSuf)) {
      const aBase = a.slice(0, -lSuf.length);
      const bBase = b.slice(0, -rSuf.length);
      if (aBase === bBase && aBase.length > 0) return { left: a, right: b };
    }
    if (a.endsWith(rSuf) && b.endsWith(lSuf)) {
      const aBase = a.slice(0, -rSuf.length);
      const bBase = b.slice(0, -lSuf.length);
      if (aBase === bBase && aBase.length > 0) return { left: b, right: a };
    }
  }
  return null;
}

/**
 * Find every L/R pair among a part's weight group names. Returns an
 * array of `{left, right}` records. Groups without a recognised L/R
 * suffix are silently skipped.
 *
 * @param {string[]} groupNames
 * @returns {Array<{left:string, right:string}>}
 */
export function findGroupPairs(groupNames) {
  if (!Array.isArray(groupNames)) return [];
  const seen = new Set();
  const pairs = [];
  for (let i = 0; i < groupNames.length; i++) {
    if (seen.has(groupNames[i])) continue;
    for (let j = 0; j < groupNames.length; j++) {
      if (i === j) continue;
      if (seen.has(groupNames[j])) continue;
      const pair = pairGroupNames(groupNames[i], groupNames[j]);
      if (pair) {
        pairs.push(pair);
        seen.add(pair.left);
        seen.add(pair.right);
        break;
      }
    }
  }
  return pairs;
}

/**
 * Mirror weights on the active part.
 *
 * @param {{ axis?: 'x'|'y'|'z', mode?: 'topology'|'byName' }} [opts]
 * @returns {{ mirrored: number, skipped: boolean, axis: string, mode: string,
 *             vertexPairs?: number, groupPairs?: number }}
 */
export function mirrorWeights({ axis = 'x', mode = 'topology' } = {}) {
  if (axis !== 'x' && axis !== 'y') {
    return { mirrored: 0, skipped: true, axis, mode };
  }
  const editor = useEditorStore.getState();
  const partId = editor.selection?.[0];
  if (typeof partId !== 'string') {
    return { mirrored: 0, skipped: true, axis, mode };
  }
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n?.id === partId);
  if (!node || node.type !== 'part') {
    return { mirrored: 0, skipped: true, axis, mode };
  }
  const mesh = getMesh(node, project);
  if (!mesh || !Array.isArray(mesh.vertices) || mesh.vertices.length === 0) {
    return { mirrored: 0, skipped: true, axis, mode };
  }
  if (!mesh.weightGroups) {
    return { mirrored: 0, skipped: true, axis, mode };
  }

  const vertexMap = buildMirrorVertexMap(mesh.vertices, axis);
  const vertexPairs = vertexMap.size;
  if (vertexPairs === 0) {
    return { mirrored: 0, skipped: true, axis, mode, vertexPairs: 0 };
  }

  const setWeightGroup = useProjectStore.getState().setWeightGroup;
  let mirrored = 0;
  let groupPairs = 0;

  beginBatch(project);
  try {
    if (mode === 'byName') {
      const allNames = Object.keys(mesh.weightGroups);
      const pairs = findGroupPairs(allNames);
      groupPairs = pairs.length;
      for (const pair of pairs) {
        const left = mesh.weightGroups[pair.left];
        const right = mesh.weightGroups[pair.right];
        if (!Array.isArray(left) || !Array.isArray(right)) continue;
        if (left.length !== right.length) continue;
        // Copy left weights to right at mirrored indices, and vice versa.
        const nextLeft = left.slice();
        const nextRight = right.slice();
        for (const [src, dst] of vertexMap) {
          if (src >= left.length || dst >= right.length) continue;
          nextRight[dst] = left[src];
          nextLeft[dst] = right[src];
        }
        setWeightGroup(partId, pair.left, nextLeft);
        setWeightGroup(partId, pair.right, nextRight);
        mirrored++;
      }
    } else {
      const activeName = mesh.activeWeightGroup;
      if (typeof activeName !== 'string' || !mesh.weightGroups[activeName]) {
        return { mirrored: 0, skipped: true, axis, mode, vertexPairs };
      }
      const w = mesh.weightGroups[activeName];
      const next = w.slice();
      for (const [src, dst] of vertexMap) {
        if (src >= w.length || dst >= w.length) continue;
        next[dst] = w[src];
      }
      setWeightGroup(partId, activeName, next);
      mirrored = 1;
    }
  } finally {
    endBatch();
  }
  return {
    mirrored, skipped: false, axis, mode,
    vertexPairs, ...(mode === 'byName' ? { groupPairs } : {}),
  };
}

/** Selection-side gate used by the operator-registry `available()` hook. */
export function eligibleForMirror() {
  const editor = useEditorStore.getState();
  if (editor.editMode !== 'weightPaint') return false;
  const partId = editor.selection?.[0];
  if (typeof partId !== 'string') return false;
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n?.id === partId);
  if (!node || node.type !== 'part') return false;
  const mesh = getMesh(node, project);
  if (!mesh || !mesh.weightGroups) return false;
  return Object.keys(mesh.weightGroups).length > 0;
}

