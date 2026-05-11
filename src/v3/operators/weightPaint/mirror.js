// @ts-check

/**
 * Toolset Plan Phase 7.B.3 — Mirror Weights (audit-fixed).
 *
 * Mirrors the active weight group's weights along the X axis. Two
 * pairing strategies:
 *
 *   - 'position': pairs each vertex with the vertex at its mirrored
 *     X coordinate (within ε on the per-mesh mid-X axis). Audit fix
 *     D-3: pre-fix this mode was named 'topology' which was a NAMING
 *     INVERSION vs Blender — Blender's `use_topology=false` (default)
 *     IS the coordinate-position match path, while `use_topology=true`
 *     walks the mesh edge graph (per
 *     `reference/blender/source/blender/editors/object/object_vgroup.cc:3729-3733`
 *     `RNA_def_boolean(ot->srna, "use_topology", false, "Topology
 *     Mirror", ...)`). A Blender muscle-memory user reading "Topology"
 *     in SS would expect graph-walk behavior; renamed to 'position'
 *     for parity.
 *   - 'byName':   for each pair of `Group_L` / `Group_R` weight groups
 *     (see `flipSideName` for the full set of recognized patterns),
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
 * # G-5 DOCUMENT-AS-DEVIATION (sub-pixel pairing)
 *
 * `buildMirrorVertexMap` is calibrated for integer-grid mesh topology.
 * The bucket key quantises the non-mirror axis at `1/eps = 1000` units/
 * px while the pair-acceptance threshold is `eps * 10 = 0.01 px` — the
 * bucket grid is 10× finer than the acceptance threshold, so vertices
 * that differ by sub-pixel jitter on the non-mirror axis can fall into
 * separate buckets and miss pairing. Auto-rig output (integer canvas
 * px) is always safe; user-placed or FFD-dragged sub-pixel vertices
 * may not pair. Future tightening would replace `eps` with `eps * 10`
 * in `bucketKey` to align bucket resolution with acceptance.
 *
 * # byName mode group pairing — D-4 audit fix
 *
 * Pre-fix the SS recognizer hard-coded 4 suffix pairs:
 *   `[_L, _R], [.L, .R], [Left, Right], [left, right]`
 *
 * Blender's `BLI_string_flip_side_name`
 * (`reference/blender/source/blender/blenlib/intern/string_utils.cc:243-413`)
 * implements 3 pattern passes:
 *   1. Suffix single-char `[lLrR]` after a separator in `{., , -, _}`
 *   2. Prefix single-char `[lLrR]` before a separator
 *   3. Word `left`/`right` (case-aware: `Left`/`LEFT`/`left`) at start
 *      or end of name
 *
 * Audit fix D-4 ports those three passes. Now `arm.L`, `arm_L`, `arm-L`,
 * `arm L`, `L_arm`, `R.hand`, `LEFT_eye` all flip correctly.
 *
 * @module v3/operators/weightPaint/mirror
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useEditorStore } from '../../../store/editorStore.js';
import { getMesh } from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';

/** Separator chars allowed before/after the side-letter (matches
 *  Blender's `BLI_string_flip_side_name` separator set). */
const SIDE_SEPARATORS = new Set(['.', ' ', '-', '_']);

/**
 * Compute the L/R-flipped form of a name, port of Blender's
 * `BLI_string_flip_side_name`
 * (`reference/blender/source/blender/blenlib/intern/string_utils.cc:243-413`).
 * Returns null when the name has no recognized side marker.
 *
 * Three patterns, in priority order:
 *   1. Suffix single-char `l`/`L`/`r`/`R` after a separator (`{., , -, _}`)
 *   2. Prefix single-char `l`/`L`/`r`/`R` before a separator
 *   3. Word `left`/`right`/`Left`/`Right`/`LEFT`/`RIGHT` at start or end
 *
 * Case is preserved: `Left` → `Right` (initial-cap), `LEFT` → `RIGHT`,
 * `left` → `right`. Same for the single-char forms.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function flipSideName(name) {
  if (typeof name !== 'string' || name.length < 3) return null;

  // Pass 1: suffix single-char (e.g. arm_L, arm.R, arm-L, arm L)
  const lastIdx = name.length - 1;
  const last = name[lastIdx];
  const sep1 = name[lastIdx - 1];
  if (SIDE_SEPARATORS.has(sep1) && /[lrLR]/.test(last)) {
    const flipped = last === 'l' ? 'r'
                  : last === 'r' ? 'l'
                  : last === 'L' ? 'R'
                  : 'L';
    return name.slice(0, lastIdx) + flipped;
  }

  // Pass 2: prefix single-char (e.g. L_arm, R.hand, L-finger, L arm)
  const first = name[0];
  const sep2 = name[1];
  if (SIDE_SEPARATORS.has(sep2) && /[lrLR]/.test(first)) {
    const flipped = first === 'l' ? 'r'
                  : first === 'r' ? 'l'
                  : first === 'L' ? 'R'
                  : 'L';
    return flipped + name.slice(1);
  }

  // Pass 3: Left/Right word at start or end (case-aware via lookup table)
  /** @type {Array<[RegExp, (m: string) => string]>} */
  const wordPairs = [
    [/^(LEFT)/,  () => 'RIGHT'],
    [/^(RIGHT)/, () => 'LEFT'],
    [/^(Left)/,  () => 'Right'],
    [/^(Right)/, () => 'Left'],
    [/^(left)/,  () => 'right'],
    [/^(right)/, () => 'left'],
    [/(LEFT)$/,  () => 'RIGHT'],
    [/(RIGHT)$/, () => 'LEFT'],
    [/(Left)$/,  () => 'Right'],
    [/(Right)$/, () => 'Left'],
    [/(left)$/,  () => 'right'],
    [/(right)$/, () => 'left'],
  ];
  for (const [re, replacer] of wordPairs) {
    if (re.test(name)) return name.replace(re, replacer);
  }

  return null;
}

/**
 * Compute a mirror-vertex map for a flat or {x,y} vertex array, mirroring
 * across `axis` ('x' supported; 'y' supported; 'z' returns empty map).
 * Returns `Map<srcIndex, mirrorIndex>` for vertices that have a mirror
 * pair within ε. Vertices without a pair are absent from the map.
 *
 * G-5 DOCUMENT-AS-DEVIATION: integer-grid topology is the calibrated
 * safe zone; sub-pixel vertex pairing is not guaranteed.
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
 * Detect whether two group names are an L/R pair using `flipSideName`.
 * Returns the pair tuple ('left' name first, 'right' name second) so
 * callers can iterate group sources consistently, or null if not a
 * recognized pair.
 *
 * Convention: the "left" slot is whichever side `flipSideName` flips
 * INTO the other; we normalize by checking which form starts with /
 * contains `L`/`Left` token. For symmetric names where both sides are
 * recognized (`a` flips to `b` AND `b` flips to `a`), use lexical
 * ordering of the name marker so the result is deterministic.
 *
 * @param {string} a
 * @param {string} b
 * @returns {{ left: string, right: string } | null}
 */
export function pairGroupNames(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  if (a === b) return null;
  const flipA = flipSideName(a);
  if (flipA !== b) return null;
  // Pick which side is "left" by scanning the names for any L/l/Left
  // token (audit-fix D-4 deterministic ordering).
  const isLeft = (s) => /(^|[._\- ])[lL](?=$|[._\- ])|^[lL][._\- ]|[Ll]eft|LEFT/.test(s);
  const aIsLeft = isLeft(a);
  const bIsLeft = isLeft(b);
  if (aIsLeft && !bIsLeft) return { left: a, right: b };
  if (bIsLeft && !aIsLeft) return { left: b, right: a };
  // Both or neither matched the heuristic — fall back to lexical order.
  return a < b ? { left: a, right: b } : { left: b, right: a };
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
    const flipped = flipSideName(groupNames[i]);
    if (!flipped) continue;
    if (!groupNames.includes(flipped)) continue;
    if (seen.has(flipped)) continue;
    const pair = pairGroupNames(groupNames[i], flipped);
    if (pair) {
      pairs.push(pair);
      seen.add(pair.left);
      seen.add(pair.right);
    }
  }
  return pairs;
}

/**
 * Mirror weights on the active part.
 *
 * Audit fix D-3: mode `'topology'` renamed to `'position'` (matches
 * Blender's `use_topology=false` semantics). Pre-fix mode name accepted
 * for one release window via the `mode === 'topology'` alias below;
 * Rule №2 says we should drop legacy aliases, so the alias is omitted —
 * callers MUST pass `'position'`.
 *
 * @param {{ axis?: 'x'|'y'|'z', mode?: 'position'|'byName' }} [opts]
 * @returns {{ mirrored: number, skipped: boolean, axis: string, mode: string,
 *             vertexPairs?: number, groupPairs?: number }}
 */
export function mirrorWeights({ axis = 'x', mode = 'position' } = {}) {
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

  // Audit fix G-2 — guard active group BEFORE opening the batch so we
  // don't push a phantom undo snapshot when we're going to early-return
  // with no writes. Pre-fix the beginBatch fired before this check;
  // Ctrl+Z then "undid" to identical state, silently swallowing the
  // user's prior real undo entry.
  const setWeightGroup = useProjectStore.getState().setWeightGroup;
  let mirrored = 0;
  let groupPairs = 0;

  if (mode === 'byName') {
    const allNames = Object.keys(mesh.weightGroups);
    const pairs = findGroupPairs(allNames);
    groupPairs = pairs.length;
    if (pairs.length === 0) {
      return { mirrored: 0, skipped: true, axis, mode, vertexPairs, groupPairs: 0 };
    }
    beginBatch(project);
    try {
      for (const pair of pairs) {
        const left = mesh.weightGroups[pair.left];
        const right = mesh.weightGroups[pair.right];
        if (!Array.isArray(left) || !Array.isArray(right)) continue;
        if (left.length !== right.length) continue;
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
    } finally {
      endBatch();
    }
  } else {
    const activeName = mesh.activeWeightGroup;
    if (typeof activeName !== 'string' || !mesh.weightGroups[activeName]) {
      // Audit fix G-2 — early-return BEFORE beginBatch (no phantom snapshot).
      return { mirrored: 0, skipped: true, axis, mode, vertexPairs };
    }
    const w = mesh.weightGroups[activeName];
    const next = w.slice();
    for (const [src, dst] of vertexMap) {
      if (src >= w.length || dst >= w.length) continue;
      next[dst] = w[src];
    }
    beginBatch(project);
    try {
      setWeightGroup(partId, activeName, next);
      mirrored = 1;
    } finally {
      endBatch();
    }
  }
  return {
    mirrored, skipped: false, axis, mode,
    vertexPairs, ...(mode === 'byName' ? { groupPairs } : {}),
  };
}

/** Selection-side gate used by the operator-registry `available()` hook.
 *
 * Audit fix G-2 (companion to the `mirrorWeights` early-return fix):
 * for the 'position' (active-group) path, also require an
 * `activeWeightGroup` so the operator reports unavailable when there
 * is nothing to mirror. byName path is independent of activeGroup
 * (it pairs by name).
 *
 * @param {{ mode?: 'position'|'byName' }} [opts]
 */
export function eligibleForMirror({ mode = 'position' } = {}) {
  const editor = useEditorStore.getState();
  if (editor.editMode !== 'weightPaint') return false;
  const partId = editor.selection?.[0];
  if (typeof partId !== 'string') return false;
  const project = useProjectStore.getState().project;
  const node = project.nodes.find((n) => n?.id === partId);
  if (!node || node.type !== 'part') return false;
  const mesh = getMesh(node, project);
  if (!mesh || !mesh.weightGroups) return false;
  if (Object.keys(mesh.weightGroups).length === 0) return false;
  if (mode === 'position') {
    const activeName = mesh.activeWeightGroup;
    if (typeof activeName !== 'string') return false;
    if (!Array.isArray(mesh.weightGroups[activeName])) return false;
  }
  return true;
}
