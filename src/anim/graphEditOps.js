// @ts-check

/**
 * Animation Phase 5 — Graph Editor pure drag-mutation helpers.
 *
 * Extracted from `FCurveEditor.jsx` so the keyframe-drag and handle-drag
 * transforms are headless-testable and auditable for Blender fidelity
 * in isolation, instead of behind a React component + canvas event mesh.
 *
 * Both helpers MUTATE the passed-in keyform in place — matches the
 * immer-draft pattern the editor uses inside `updateProject((p) => …)`,
 * so the editor calls them directly on the draft slice.
 *
 * # Blender reference (audit-fix 2026-05-16 — corrects the initial
 * citations that pointed at `BKE_nurb_handle_calc_simple_auto`, which
 * is a recalc-safeguard utility, not the user-edit conversion path).
 *
 *   - **HD_FREE / HD_AUTO / HD_AUTO_ANIM / HD_VECT / HD_ALIGN /
 *     HD_ALIGN_DOUBLESIDE** enum constants:
 *     `reference/blender/source/blender/makesdna/DNA_curve_enums.h:180-225`.
 *
 *   - **Handle-type conversion on user-edit** —
 *     `BKE_nurb_bezt_handle_test` at
 *     `reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084`.
 *     Called per transform tick from `testhandles_fcurve` at
 *     `reference/blender/source/blender/editors/transform/transform_convert_graph.cc:580`.
 *     Behaviour: on PARTIAL selection (one handle moved without the
 *     keyform centre), `HD_AUTO`/`HD_AUTO_ANIM` → `HD_ALIGN` for the
 *     keyform's BOTH sides; `HD_VECT` → `HD_FREE` for the dragged side
 *     only. The AUTO conversion applies to both sides so the next
 *     `BKE_fcurve_handles_recalc` doesn't overwrite the user's drag (a
 *     single AUTO + ALIGN pair would have the AUTO compute via
 *     neighbour slope and the ALIGN mirror it, dropping the drag).
 *
 *   - **HD_ALIGN mirror math** —
 *     `reference/blender/source/blender/blenkernel/intern/curve.cc:3242-3301`
 *     (`calchandleNurb_intern` HD_ALIGN branch). The formula
 *     `p2_h1 = p2 + len_ratio * (p2 - p2_h2)` preserves the opposite
 *     handle's pre-edit absolute length while reflecting its direction
 *     through the keyform — same end-behaviour as the closed-form code
 *     in `applyHandleDrag` below (verified by `test_graphEditOps.mjs`'s
 *     length-equality assertions).
 *
 *   - **Keyform crossing + re-sort** — `sort_time_fcurve` at
 *     `reference/blender/source/blender/blenkernel/intern/fcurve.cc:1293-1339`,
 *     called from the Graph Editor's transform via `test_time_fcurve` /
 *     `BKE_fcurve_merge_duplicate_keys` at
 *     `reference/blender/source/blender/editors/transform/transform_convert_graph.cc:950-1014`.
 *     Blender does NOT clamp keyform time to its neighbours' bounds —
 *     it lets keyframes cross during the drag and re-sorts post-tick.
 *     Duplicate-time merging is a separate step
 *     (`BKE_fcurve_merge_duplicate_keys`) and is NOT performed here;
 *     SS's FCurveEditor handles the re-sort but leaves duplicate-time
 *     collapse to a future slice (Slice 5.C operator pass), matching
 *     Blender's split between transform-time sort and confirm-time
 *     merge.
 *
 * @module anim/graphEditOps
 */

/**
 * @typedef {{ time: number, value: number }} HandlePoint
 * @typedef {{
 *   time: number,
 *   value: number,
 *   handleLeft?: HandlePoint,
 *   handleRight?: HandlePoint,
 *   handleType?: { left: string, right: string },
 *   [k: string]: any
 * }} BezTripleLike
 */

/**
 * Apply a (dTime, dValue) drag to a keyform. The keyform's handles ride
 * along by the same Δ (Blender absolute-handle-coordinate convention).
 *
 * **No time clamping** — Blender allows keyframes to cross during a
 * transform and re-sorts post-tick (`sort_time_fcurve`,
 * `BKE_fcurve_merge_duplicate_keys`). The caller is responsible for
 * re-sorting the keyforms array after each call and tracking the
 * dragged keyform's index re-mapping (the editor's drag handler
 * captures the post-sort `indexOf(k)` and updates its `dragIdxRef`).
 *
 * @param {BezTripleLike} kf            keyform to mutate
 * @param {number} origTime              keyform's start-of-drag time
 * @param {number} origValue             keyform's start-of-drag value
 * @param {HandlePoint} origHandleLeft   start-of-drag handleLeft
 * @param {HandlePoint} origHandleRight  start-of-drag handleRight
 * @param {number} dTime                 Δtime in ms
 * @param {number} dValue                Δvalue
 */
export function applyKeyformDrag(
  kf,
  origTime,
  origValue,
  origHandleLeft,
  origHandleRight,
  dTime,
  dValue,
) {
  kf.time = origTime + dTime;
  kf.value = origValue + dValue;
  kf.handleLeft = {
    time: origHandleLeft.time + dTime,
    value: origHandleLeft.value + dValue,
  };
  kf.handleRight = {
    time: origHandleRight.time + dTime,
    value: origHandleRight.value + dValue,
  };
}

/**
 * Apply a new handle position to one side of a keyform, with the
 * Blender-faithful side effects from `BKE_nurb_bezt_handle_test`
 * (`reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084`):
 *
 *   1. **HD_AUTO / HD_AUTO_ANIM → HD_ALIGN on BOTH sides** if either
 *      side was AUTO. Both-side conversion is the key Blender detail
 *      that's easy to miss: if only the dragged side flipped, the
 *      opposite AUTO would compute via neighbour slope on next recalc
 *      and the dragged ALIGN side would mirror it, dropping the
 *      user-edit. With both sides ALIGN, the recalc's HD_ALIGN ↔
 *      HD_ALIGN branch is self-consistent and the drag persists.
 *
 *   2. **HD_VECT → HD_FREE on the dragged side ONLY** (the opposite
 *      VECT survives because the partial-selection guard in
 *      `BKE_nurb_bezt_handle_test` checks per-side flags). Matches
 *      `curve.cc:4073-4082`.
 *
 *   3. **Aligned mirror** of the opposite side through the keyform if
 *      the opposite is HD_ALIGN (either pre-existing or freshly
 *      converted in step 1). Opposite handle's pre-drag absolute length
 *      is preserved; only direction is updated. End-equivalent to
 *      Blender's `calchandleNurb_intern` `len_ratio` formula at
 *      `curve.cc:3266-3282`.
 *
 * Mutates `kf` in place.
 *
 * @param {BezTripleLike} kf
 * @param {'left'|'right'} side  which side to apply
 * @param {HandlePoint} newHandle  desired absolute handle position
 */
export function applyHandleDrag(kf, side, newHandle) {
  const ht = kf.handleType ?? { left: 'auto', right: 'auto' };
  const opp = side === 'left' ? 'right' : 'left';

  // (1) HD_AUTO / HD_AUTO_ANIM → HD_ALIGN on BOTH sides if EITHER was
  // auto. Match `BKE_nurb_bezt_handle_test` (curve.cc:4068-4072).
  const draggedAuto = ht[side] === 'auto' || ht[side] === 'auto_clamped';
  const oppAuto = ht[opp] === 'auto' || ht[opp] === 'auto_clamped';
  if (draggedAuto || oppAuto) {
    kf.handleType = {
      left:  (ht.left  === 'auto' || ht.left  === 'auto_clamped') ? 'aligned' : ht.left,
      right: (ht.right === 'auto' || ht.right === 'auto_clamped') ? 'aligned' : ht.right,
    };
  }

  // (2) HD_VECT → HD_FREE on the dragged side ONLY (matches the
  // per-side branch at curve.cc:4073-4082).
  if (kf.handleType?.[side] === 'vector') {
    kf.handleType = { ...kf.handleType, [side]: 'free' };
  }

  // Write the new handle position.
  if (side === 'left') {
    kf.handleLeft = { time: newHandle.time, value: newHandle.value };
  } else {
    kf.handleRight = { time: newHandle.time, value: newHandle.value };
  }

  // (3) Aligned mirror — only if opposite is HD_ALIGN (which it may be
  // either by pre-existing user choice OR by the AUTO conversion in
  // step 1).
  if (kf.handleType?.[opp] !== 'aligned') return;
  const oppHandle = opp === 'left' ? kf.handleLeft : kf.handleRight;
  if (!oppHandle) return;
  const oppLen = Math.hypot(oppHandle.time - kf.time, oppHandle.value - kf.value);
  const newLen = Math.hypot(newHandle.time - kf.time, newHandle.value - kf.value);
  if (newLen <= 1e-9 || oppLen <= 1e-9) return;
  const ux = (newHandle.time - kf.time) / newLen;
  const uy = (newHandle.value - kf.value) / newLen;
  const reflected = {
    time: kf.time - ux * oppLen,
    value: kf.value - uy * oppLen,
  };
  if (opp === 'left') kf.handleLeft = reflected;
  else kf.handleRight = reflected;
}
