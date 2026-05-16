// @ts-check

/**
 * Animation Phase 5 — Graph Editor pure mutation helpers.
 *
 * Extracted from `FCurveEditor.jsx` so every keyframe / handle / modal
 * transform is headless-testable and auditable for Blender fidelity in
 * isolation, instead of behind a React component + canvas event mesh.
 *
 * # Slices shipped here
 *
 *   - **5.B (click-and-drag write-mode)** — `applyKeyformDrag`,
 *     `applyHandleDrag`. One keyform / one handle per call. Click-on-
 *     handle starts an immediate drag, so the handle-type conversions +
 *     aligned mirror are baked inline (no per-tick recalc loop).
 *
 *   - **5.C (operator pass)** — `applyGrab`, `applyScale`,
 *     `snapKeyformsToFrame`, `setHandleType`, `setInterpolation`,
 *     `setExtrapolation`, `deleteKeyforms`, `mergeDuplicateTimeKeys`,
 *     `testKeyformHandles`. Multi-keyform operators driven by the modal
 *     G/S / V menu / T menu / Shift+E menu / Ctrl+G / Delete pathways.
 *     These rely on a downstream `recalcKeyformHandles` pass to settle
 *     auto/aligned/vector handles after the mutation (matches Blender's
 *     `testhandles_fcurve` → `BKE_fcurve_handles_recalc_ex` chain at
 *     `transform_convert_graph.cc:580` / `fcurve.cc:1149-1231`).
 *
 * Both modules MUTATE the passed-in keyform/curve in place — matches the
 * immer-draft pattern the editor uses inside `updateProject((p) => …)`,
 * so the editor calls them directly on the draft slice.
 *
 * # Blender reference index
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
 *     Duplicate-time merging is a separate step (`BKE_fcurve_merge_duplicate_keys`,
 *     `fcurve.cc:1801-1910`) that SS exposes as `mergeDuplicateTimeKeys`
 *     and the editor calls on pointer-release / modal-confirm.
 *
 *   - **Per-vertex transform model** — the BezTriple selection flags
 *     `BEZT_SEL_F1` (left handle), `BEZT_SEL_F2` (knot/center),
 *     `BEZT_SEL_F3` (right handle) at
 *     `reference/blender/source/blender/makesdna/DNA_curve_types.h:90-95`
 *     gate which vertex sub-components a transform moves; SS encodes
 *     them as `{ left, center, right }` booleans per keyform.
 *     Transform iterates the verts independently
 *     (`transform_convert_graph.cc:830-955`) — handles ride along with
 *     the center when F2 is set, otherwise they move only when their
 *     own F1/F3 flag is set.
 *
 *   - **Per-FCurve extrapolation** —
 *     `reference/blender/source/blender/editors/space_graph/graph_edit.cc:1443-1496`
 *     (`setexpo_graph_keys`). Modes `FCURVE_EXTRAPOLATE_CONSTANT` /
 *     `FCURVE_EXTRAPOLATE_LINEAR` (`DNA_anim_types.h:303-307`). SS
 *     mirrors this as a per-FCurve `extrapolation` string field.
 *
 *   - **Set handle type** —
 *     `reference/blender/source/blender/editors/space_graph/graph_edit.cc:1704-1736`
 *     (`sethandles_graph_keys`). Loops selected keyframes, sets the
 *     handleType flag, then `BKE_fcurve_handles_recalc` re-positions
 *     auto/aligned handles to match the new type.
 *
 *   - **Snap to current frame** —
 *     `reference/blender/source/blender/editors/space_graph/graph_edit.cc:2326-2418`
 *     (`snap_graph_keys`). Mode `GRAPHKEYS_SNAP_NEAREST_FRAME`
 *     (enum at `graph_intern.hh:163-170`; the SS Ctrl+G) rounds each
 *     selected keyform's time to a whole frame, then
 *     `BKE_fcurve_handles_recalc` + `BKE_fcurve_merge_duplicate_keys`
 *     settle handles + collapse ties. Audit-fix HIGH-B2 (2026-05-16)
 *     corrected the prior citation `SNAP_KEYS_HORIZONTAL`, which in
 *     Blender is the "Flatten Handles" operator (sets handle Y to a
 *     zero-slope), NOT the round-to-nearest-frame operator.
 *
 *   - **Delete selected keyframes** —
 *     `reference/blender/source/blender/blenkernel/intern/fcurve.cc:1450-1490`
 *     (`BKE_fcurve_delete_keys`) loops the array tail-first and splices
 *     selected entries. Equivalent to the SS `deleteKeyforms` below.
 *
 * @module anim/graphEditOps
 */

/**
 * @typedef {{ time: number, value: number }} HandlePoint
 * @typedef {{ center: boolean, left: boolean, right: boolean }} SelectionParts
 * @typedef {{
 *   time: number,
 *   value: number,
 *   handleLeft?: HandlePoint,
 *   handleRight?: HandlePoint,
 *   handleType?: { left: string, right: string },
 *   interpolation?: string,
 *   [k: string]: any
 * }} BezTripleLike
 * @typedef {{ keyforms: BezTripleLike[], extrapolation?: string, [k:string]: any }} FCurveLike
 * @typedef {{
 *   time: number,
 *   value: number,
 *   handleLeft: HandlePoint,
 *   handleRight: HandlePoint,
 *   handleType?: { left: string, right: string },
 *   interpolation?: string
 * }} KeyformOrigin
 */

// ── Slice 5.B helpers (unchanged surface; existing tests still cover) ──

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

// ── Slice 5.C operator-pass helpers ──────────────────────────────────

/**
 * Snapshot one keyform's pre-transform state for use by modal G/S as
 * the absolute baseline (so successive ticks aren't relative-to-last).
 *
 * @param {BezTripleLike} kf
 * @returns {KeyformOrigin}
 */
export function snapshotKeyform(kf) {
  return {
    time: kf.time,
    value: kf.value,
    handleLeft: { time: kf.handleLeft?.time ?? kf.time, value: kf.handleLeft?.value ?? kf.value },
    handleRight: { time: kf.handleRight?.time ?? kf.time, value: kf.handleRight?.value ?? kf.value },
    handleType: kf.handleType ? { left: kf.handleType.left, right: kf.handleType.right } : undefined,
    interpolation: kf.interpolation,
  };
}

/**
 * Apply a per-keyform grab delta following Blender's per-vertex
 * transform model (`transform_convert_graph.cc:830-955`):
 *
 *   - `center` set → the knot moves by (dTime, dValue) and BOTH handles
 *     ride along by the same Δ (KNOT_ONLY semantic; Blender's
 *     `td->loc` for F2 verts is the keyform centre, and the handles'
 *     stored coords are absolute so they move with the centre's td).
 *
 *   - `center` unset → handles move INDEPENDENTLY per their own
 *     `left` / `right` flags (the F1 / F3 td slots). Each selected
 *     handle moves by the same (dTime, dValue) from its OWN origin.
 *
 * No handle-type conversion / aligned-mirror runs in this helper —
 * those are downstream side-effects of `testKeyformHandles` +
 * `recalcKeyformHandles`, which the caller invokes after applying
 * the grab across all selected keyforms.
 *
 * @param {BezTripleLike} kf
 * @param {SelectionParts} parts
 * @param {KeyformOrigin} orig
 * @param {number} dTime
 * @param {number} dValue
 */
export function applyGrabToKeyform(kf, parts, orig, dTime, dValue) {
  if (parts.center) {
    kf.time = orig.time + dTime;
    kf.value = orig.value + dValue;
    kf.handleLeft = {
      time: orig.handleLeft.time + dTime,
      value: orig.handleLeft.value + dValue,
    };
    kf.handleRight = {
      time: orig.handleRight.time + dTime,
      value: orig.handleRight.value + dValue,
    };
    return;
  }
  if (parts.left) {
    kf.handleLeft = {
      time: orig.handleLeft.time + dTime,
      value: orig.handleLeft.value + dValue,
    };
  }
  if (parts.right) {
    kf.handleRight = {
      time: orig.handleRight.time + dTime,
      value: orig.handleRight.value + dValue,
    };
  }
}

/**
 * Apply a per-keyform scale around a pivot following Blender's
 * `TFM_RESIZE` for graph keys (`transform_convert_graph.cc` resize
 * path). For each selected sub-component, the new (time, value) is
 *
 *   newPos = pivot + (sx, sy) * (origPos - pivot)
 *
 * As with `applyGrabToKeyform`, handle-type conversions + aligned
 * mirroring are downstream concerns the caller runs after the full
 * scale pass.
 *
 * @param {BezTripleLike} kf
 * @param {SelectionParts} parts
 * @param {KeyformOrigin} orig
 * @param {{ time:number, value:number }} pivot
 * @param {number} sX  time-axis scale factor
 * @param {number} sY  value-axis scale factor
 */
export function applyScaleToKeyform(kf, parts, orig, pivot, sX, sY) {
  const sc = (pos) => ({
    time: pivot.time + sX * (pos.time - pivot.time),
    value: pivot.value + sY * (pos.value - pivot.value),
  });
  if (parts.center) {
    const c = sc({ time: orig.time, value: orig.value });
    kf.time = c.time;
    kf.value = c.value;
    kf.handleLeft = sc(orig.handleLeft);
    kf.handleRight = sc(orig.handleRight);
    return;
  }
  if (parts.left) kf.handleLeft = sc(orig.handleLeft);
  if (parts.right) kf.handleRight = sc(orig.handleRight);
}

/**
 * Modal-G translate over a whole FCurve. Iterates the selection map,
 * applies the per-keyform grab, then runs `testKeyformHandles` (Blender's
 * `BKE_nurb_bezt_handle_test`) so handle-type conversions fire whenever
 * a side moved without its sibling (matches `transform_convert_graph.cc:580`'s
 * `testhandles_fcurve` per-tick call).
 *
 * The caller (editor / operator) is responsible for the downstream
 * sort + `recalcKeyformHandles` + (post-release) `mergeDuplicateTimeKeys`
 * pass. Those aren't folded in here so a future scale / snap operator
 * can share the same handle-test pass.
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @param {Map<number, KeyformOrigin>} origins
 * @param {number} dTime
 * @param {number} dValue
 */
export function applyGrab(fcurve, selection, origins, dTime, dValue) {
  for (const [idx, parts] of selection) {
    const kf = fcurve.keyforms[idx];
    const orig = origins.get(idx);
    if (!kf || !orig) continue;
    applyGrabToKeyform(kf, parts, orig, dTime, dValue);
    testKeyformHandles(kf, parts);
  }
}

/**
 * Modal-S resize over a whole FCurve. Sister of `applyGrab` for the
 * scale operator. Pivot + per-axis factors come from the editor's modal
 * harness (typically pivot = playhead-time × median-value, factors
 * derived from cursor-distance ratio).
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @param {Map<number, KeyformOrigin>} origins
 * @param {{ time:number, value:number }} pivot
 * @param {number} sX
 * @param {number} sY
 */
export function applyScale(fcurve, selection, origins, pivot, sX, sY) {
  for (const [idx, parts] of selection) {
    const kf = fcurve.keyforms[idx];
    const orig = origins.get(idx);
    if (!kf || !orig) continue;
    applyScaleToKeyform(kf, parts, orig, pivot, sX, sY);
    testKeyformHandles(kf, parts);
  }
}

/**
 * Run Blender's `BKE_nurb_bezt_handle_test` on one keyform given its
 * per-part selection flags
 * (`reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084`).
 *
 * The function maps directly to Blender's three BezTriple selection
 * bits — `parts.left ↔ SEL_F1`, `parts.center ↔ SEL_F2`,
 * `parts.right ↔ SEL_F3` — and runs the conversion ONLY when the
 * combined flag set is a "partial selection" (`curve.cc:4065` —
 * `!ELEM(flag, 0, SEL_F1|SEL_F2|SEL_F3)`). Nothing-selected and
 * everything-selected both skip; any subset of one-or-two flags fires
 * the conversions below.
 *
 *   - **HD_AUTO / HD_AUTO_ANIM → HD_ALIGN on BOTH sides** if EITHER was
 *     auto (`curve.cc:4066-4071`). Unconditional once the partial-
 *     selection guard passes.
 *
 *   - **HD_VECT → HD_FREE** when the handle's own selection flag
 *     DIFFERS from the centre flag — Blender's XOR check at
 *     `curve.cc:4074` (`!(flag & SEL_F1) != !(flag & SEL_F2)`) for h1,
 *     `curve.cc:4079` for h2. Audit-fix HIGH-B1 (2026-05-16) corrected
 *     the prior SS port which used a `flag1 !== flag2` (left-vs-right)
 *     guard; that missed the case where a handle moves "with" the
 *     centre (both selected) and over-converted in some cases /
 *     under-converted in others.
 *
 * Practical SS interpretation:
 *   - Click-on-centre selects all three parts → `(f1,f2,f3) = (1,1,1)`
 *     → no conversion (whole keyform transformed as a unit).
 *   - Click-on-handle selects only that handle → e.g. `(0,0,1)` →
 *     partial. AUTO→ALIGN both; right-VECT→FREE if VECT.
 *   - Box-select that catches only the centre dot → `(0,1,0)` →
 *     partial. AUTO→ALIGN both; left + right VECT→FREE if VECT.
 *     This is unusual but Blender-faithful — the user singled out the
 *     centre, so the handles get re-positioned as ALIGN/FREE rather
 *     than re-computed via AUTO neighbour slopes.
 *
 * @param {BezTripleLike} kf
 * @param {SelectionParts} parts
 */
export function testKeyformHandles(kf, parts) {
  const f1 = !!parts.left;
  const f2 = !!parts.center;
  const f3 = !!parts.right;
  // Partial-selection guard (curve.cc:4065).
  const noneSelected = !f1 && !f2 && !f3;
  const allSelected = f1 && f2 && f3;
  if (noneSelected || allSelected) return;
  const ht = kf.handleType ?? { left: 'auto', right: 'auto' };
  const next = { left: ht.left, right: ht.right };
  if (ht.left === 'auto' || ht.left === 'auto_clamped') next.left = 'aligned';
  if (ht.right === 'auto' || ht.right === 'auto_clamped') next.right = 'aligned';
  // VECT→FREE XOR-with-centre (curve.cc:4074, 4079).
  if (next.left === 'vector' && (f1 !== f2)) next.left = 'free';
  if (next.right === 'vector' && (f3 !== f2)) next.right = 'free';
  kf.handleType = next;
}

/**
 * Snap each selected keyform's centre to the nearest frame (rounded
 * by `msPerFrame`). Handles ride along by the snap delta so the curve
 * shape is preserved (Blender's `bezt_calc_average` /
 * `bezt_snap_translate` semantic — the snap is implemented as a
 * translate of the whole BezTriple, not a per-vert reposition).
 *
 * Selected handles without a selected centre snap independently to
 * the same frame grid (matches Blender's per-vert snap loop).
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @param {number} msPerFrame
 */
export function snapKeyformsToFrame(fcurve, selection, msPerFrame) {
  if (!(msPerFrame > 0)) return;
  for (const [idx, parts] of selection) {
    const kf = fcurve.keyforms[idx];
    if (!kf) continue;
    if (parts.center) {
      const snapped = Math.round(kf.time / msPerFrame) * msPerFrame;
      const dTime = snapped - kf.time;
      kf.time = snapped;
      if (kf.handleLeft) kf.handleLeft = { time: kf.handleLeft.time + dTime, value: kf.handleLeft.value };
      if (kf.handleRight) kf.handleRight = { time: kf.handleRight.time + dTime, value: kf.handleRight.value };
      continue;
    }
    if (parts.left && kf.handleLeft) {
      kf.handleLeft = { time: Math.round(kf.handleLeft.time / msPerFrame) * msPerFrame, value: kf.handleLeft.value };
    }
    if (parts.right && kf.handleRight) {
      kf.handleRight = { time: Math.round(kf.handleRight.time / msPerFrame) * msPerFrame, value: kf.handleRight.value };
    }
  }
}

/**
 * Set `handleType` for one side (or both) of every selected keyform.
 *
 * Matches `sethandles_graph_keys` at
 * `reference/blender/source/blender/editors/space_graph/graph_edit.cc:1704-1736`:
 * the operator loops selected keyforms, writes the new handle-type flag,
 * and a downstream `BKE_fcurve_handles_recalc` pass re-positions
 * auto/aligned/vector handles to satisfy the new type.
 *
 * **SS extension** (audit-fix HIGH-B4 disclosure, 2026-05-16): the
 * `applySide` parameter has no Blender counterpart. Blender's
 * `GRAPH_OT_handle_type` always writes BOTH `h1` and `h2` because the
 * V menu sets the whole-keyform type; per-side selective writes are
 * not exposed in Blender's operator surface. SS exposes the option so
 * a future "Set Just This Handle Type" affordance has a place to
 * land, but every call site in the editor currently passes `'both'`
 * (e.g. `FCurveEditor.jsx::operatorSetHandleType`), preserving 1:1
 * Blender parity for the V-menu user-flow.
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @param {'free'|'aligned'|'vector'|'auto'|'auto_clamped'} type
 * @param {'left'|'right'|'both'} applySide  -- SS-only; Blender always 'both'
 */
export function setHandleType(fcurve, selection, type, applySide = 'both') {
  for (const [idx] of selection) {
    const kf = fcurve.keyforms[idx];
    if (!kf) continue;
    const ht = kf.handleType ?? { left: 'auto', right: 'auto' };
    const next = { left: ht.left, right: ht.right };
    if (applySide === 'left' || applySide === 'both') next.left = type;
    if (applySide === 'right' || applySide === 'both') next.right = type;
    kf.handleType = next;
  }
}

/**
 * Set `interpolation` for every selected keyform.
 *
 * Blender's GRAPH_OT_interpolation_type sets the interpolation of the
 * SEGMENT starting at each selected keyform (the segment's interp lives
 * on the segment's left endpoint — `bezt.ipo` in Blender). SS already
 * encodes this on the keyform (the FCurve evaluator reads
 * `keyform[i].interpolation` for the segment `[i, i+1)`), so a per-
 * keyform write matches Blender's segment-start convention 1:1.
 *
 * Vector handles are reset to `auto` when interp flips to `bezier`
 * (Blender does this implicitly via `BKE_fcurve_handles_recalc` after
 * the interp change; SS exposes it explicitly because the recalc
 * doesn't auto-promote vector → auto).
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @param {string} interpolation
 */
export function setInterpolation(fcurve, selection, interpolation) {
  for (const [idx] of selection) {
    const kf = fcurve.keyforms[idx];
    if (!kf) continue;
    kf.interpolation = interpolation;
  }
}

/**
 * Set `extrapolation` on the FCurve. Matches Blender's
 * `setexpo_graph_keys` (`graph_edit.cc:1443-1496`) for the simple
 * constant/linear cases; the Make-Cyclic / Clear-Cyclic F-Modifier
 * shortcuts in Blender's menu are deferred to Phase 3 (F-Curve
 * modifiers per `ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 3).
 *
 * @param {FCurveLike} fcurve
 * @param {'constant'|'linear'} extrapolation
 */
export function setExtrapolation(fcurve, extrapolation) {
  fcurve.extrapolation = extrapolation;
}

/**
 * Delete every keyform whose entry in `selection` has `center` set.
 * Selected-handles-only entries (no center) are left intact: the
 * Delete operator in Blender's Graph Editor removes whole keyframes,
 * not handles (handles delete-back to AUTO via the V menu's clear-to-
 * default path).
 *
 * Returns the index re-map for the caller (useful to update React
 * selection state). Format: `Map<oldIdx, newIdx | -1>` where -1 means
 * the entry was deleted.
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @returns {Map<number, number>}
 */
export function deleteKeyforms(fcurve, selection) {
  /** @type {Set<number>} */
  const toDelete = new Set();
  for (const [idx, parts] of selection) {
    if (parts.center) toDelete.add(idx);
  }
  /** @type {Map<number, number>} */
  const remap = new Map();
  if (toDelete.size === 0) return remap;
  const old = fcurve.keyforms;
  /** @type {BezTripleLike[]} */
  const next = [];
  for (let i = 0; i < old.length; i++) {
    if (toDelete.has(i)) {
      remap.set(i, -1);
      continue;
    }
    remap.set(i, next.length);
    next.push(old[i]);
  }
  fcurve.keyforms = next;
  return remap;
}

/**
 * Collapse keyforms sharing the same time (within `epsMs`) into one.
 * Mirrors `BKE_fcurve_merge_duplicate_keys` at
 * `reference/blender/source/blender/blenkernel/intern/fcurve.cc:1801-1910`:
 *
 *   - For each cluster of keyforms at the same time:
 *     - Average the values of the SELECTED keyforms in the cluster;
 *       write that average to the FIRST selected keyform. Audit-fix
 *       HIGH-B3 (2026-05-16) corrected the prior SS port which kept
 *       the LAST-index entry; Blender's pass-2 loop walks
 *       `i = totvert-1` down to 0 (`fcurve.cc:1869`) and writes the
 *       average to the keyframe whose `del_count == tot_count - 1` —
 *       which in a reverse sweep is the LOWEST-index entry. Higher-
 *       index duplicates are deleted first; the survivor is at the
 *       cluster's start. SS now matches by keying off `[0]`.
 *     - Delete every other selected keyform in the cluster.
 *     - Delete EVERY unselected keyform in the cluster (Blender's
 *       `BKE_fcurve_delete_key(fcu, i)` at `fcurve.cc:1902` —
 *       unselected duplicates always lose).
 *
 *   - Clusters with no selected keyform are left untouched (Blender
 *     never invokes this op on unselected vertices; the caller's
 *     `selection` map decides who's selected).
 *
 *   - Handle vectors of the surviving entry are preserved as-is —
 *     Blender flags this as a TODO at `fcurve.cc:1886` and SS matches
 *     the existing TODO behaviour. The caller is expected to run
 *     `recalcKeyformHandles` afterwards to settle any auto/aligned
 *     handles that referenced now-deleted neighbours.
 *
 * Requires the keyforms array to be time-sorted on entry (the editor
 * sorts post-grab/scale before calling this).
 *
 * Returns the same index re-map shape as `deleteKeyforms`:
 *   `Map<oldIdx, newIdx | -1>` (deleted == -1).
 *
 * @param {FCurveLike} fcurve
 * @param {Map<number, SelectionParts>} selection
 * @param {number} [epsMs]  duplicate-time tolerance; default 0.5 ms
 *   matches Blender's `BEZT_BINARYSEARCH_THRESH = 0.00002 s` scaled
 *   to ms — but SS canonical animation time is ms, and Blender's
 *   threshold is far below typical keyform spacing; 0.5 ms (≈ a tenth
 *   of one 60 fps frame) is a UX-friendly tie-collapse window that
 *   matches typical drag-overshoot.
 * @returns {Map<number, number>}
 */
export function mergeDuplicateTimeKeys(fcurve, selection, epsMs = 0.5) {
  const kfs = fcurve.keyforms;
  /** @type {Map<number, number>} */
  const remap = new Map();
  if (kfs.length <= 1) {
    for (let i = 0; i < kfs.length; i++) remap.set(i, i);
    return remap;
  }
  // Walk clusters of consecutive same-time entries.
  /** @type {Set<number>} */
  const toDelete = new Set();
  let i = 0;
  while (i < kfs.length) {
    let j = i + 1;
    while (j < kfs.length && Math.abs(kfs[j].time - kfs[i].time) <= epsMs) {
      j++;
    }
    const clusterLen = j - i;
    if (clusterLen > 1) {
      // Find selected indices in this cluster.
      const selectedInCluster = [];
      for (let k = i; k < j; k++) {
        if (selection.has(k) && selection.get(k)?.center) selectedInCluster.push(k);
      }
      if (selectedInCluster.length === 0) {
        // Nothing selected here — leave the cluster alone.
        i = j;
        continue;
      }
      // Average the selected values; write to FIRST selected (matches
      // Blender's reverse-sweep "keep when del_count == tot_count - 1"
      // semantic, fcurve.cc:1869-1899; audit-fix HIGH-B3).
      let sum = 0;
      for (const k of selectedInCluster) sum += kfs[k].value;
      const avg = sum / selectedInCluster.length;
      const keepIdx = selectedInCluster[0];
      kfs[keepIdx].value = avg;
      // Delete every other selected entry in the cluster.
      for (const k of selectedInCluster) {
        if (k !== keepIdx) toDelete.add(k);
      }
      // Delete every UNSELECTED entry in the cluster (Blender's
      // unconditional delete branch at fcurve.cc:1902).
      for (let k = i; k < j; k++) {
        if (!selectedInCluster.includes(k) && k !== keepIdx) toDelete.add(k);
      }
    }
    i = j;
  }
  if (toDelete.size === 0) {
    for (let k = 0; k < kfs.length; k++) remap.set(k, k);
    return remap;
  }
  const next = [];
  for (let k = 0; k < kfs.length; k++) {
    if (toDelete.has(k)) {
      remap.set(k, -1);
      continue;
    }
    remap.set(k, next.length);
    next.push(kfs[k]);
  }
  fcurve.keyforms = next;
  return remap;
}

/**
 * Helper: remap a selection map through a `Map<oldIdx, newIdx | -1>`
 * returned by `deleteKeyforms` / `mergeDuplicateTimeKeys`. Drops
 * entries marked for deletion; keeps per-part flags intact for
 * survivors.
 *
 * @param {Map<number, SelectionParts>} selection
 * @param {Map<number, number>} remap
 * @returns {Map<number, SelectionParts>}
 */
export function remapSelection(selection, remap) {
  /** @type {Map<number, SelectionParts>} */
  const next = new Map();
  for (const [oldIdx, parts] of selection) {
    const newIdx = remap.get(oldIdx);
    if (typeof newIdx !== 'number' || newIdx < 0) continue;
    next.set(newIdx, parts);
  }
  return next;
}
