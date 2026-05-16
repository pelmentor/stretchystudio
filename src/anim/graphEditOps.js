// @ts-check

/**
 * Animation Phase 5 — Graph Editor pure drag-mutation helpers.
 *
 * Extracted from `FCurveEditor.jsx` so the keyframe-drag and handle-drag
 * transforms are headless-testable and auditable for Blender fidelity in
 * isolation, instead of behind a React component + canvas event mesh.
 *
 * Both helpers MUTATE the passed-in keyform in place — matches the
 * immer-draft pattern the editor uses inside `updateProject((p) => …)`,
 * so the editor calls them directly on the draft slice.
 *
 * # Blender reference
 *
 *   - HD_AUTO/HD_FREE/HD_VECT/HD_ALIGN handle-type constants live in
 *     `reference/blender/source/blender/makesdna/DNA_curve_enums.h:180-225`.
 *   - HD_ALIGN mirroring through the keyform: see
 *     `reference/blender/source/blender/blenkernel/intern/curve.cc:3194-3247`
 *     (the violation rebalance branch of `calchandleNurb_intern` enforces
 *     collinearity between aligned siblings; SS's editor mirrors at
 *     edit-time instead of relying on the recalc to fix it up
 *     post-hoc).
 *   - HD_AUTO → HD_FREE on user-edit: see
 *     `reference/blender/source/blender/blenkernel/intern/curve.cc:3952-3961`
 *     (`BKE_nurb_handle_calc_simple_auto`) — anchors HD_AUTO into
 *     HD_FREE the first time a user touches the handle so the next
 *     recalc can't undo the edit.
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
 * Apply a (dTime, dValue) drag to a keyform. Time is clamped so the
 * keyform can never collide with or cross its neighbours — the BezTriple
 * evaluator divides by `next.time - prev.time`, so a collision would
 * NaN the sampled curve.
 *
 * The keyform's handles ride along with the keyform: they're translated
 * by the SAME delta as the keyform centre. Matches Blender's
 * absolute-handle-coordinate convention (handles are not relative to
 * the keyform, so a keyform move drags them by Δ).
 *
 * @param {BezTripleLike} kf            keyform to mutate
 * @param {BezTripleLike | null | undefined} prev  previous keyform (null if first)
 * @param {BezTripleLike | null | undefined} next  next keyform (null if last)
 * @param {number} origTime              keyform's start-of-drag time
 * @param {number} origValue             keyform's start-of-drag value
 * @param {HandlePoint} origHandleLeft   start-of-drag handleLeft
 * @param {HandlePoint} origHandleRight  start-of-drag handleRight
 * @param {number} dTime                 desired Δtime in ms
 * @param {number} dValue                desired Δvalue
 * @param {number} [maxTimeBound]        upper bound for time if no next keyform (defaults to +Infinity)
 * @returns {number} the applied Δtime (after clamping) so the caller can chain
 */
export function applyKeyformDrag(
  kf,
  prev,
  next,
  origTime,
  origValue,
  origHandleLeft,
  origHandleRight,
  dTime,
  dValue,
  maxTimeBound = Number.POSITIVE_INFINITY,
) {
  const tMinClamp = prev ? prev.time + 1 : 0;
  const tMaxClamp = next ? next.time - 1 : maxTimeBound;
  const desired = origTime + dTime;
  const newTime = desired < tMinClamp ? tMinClamp : desired > tMaxClamp ? tMaxClamp : desired;
  const appliedDt = newTime - origTime;
  kf.time = newTime;
  kf.value = origValue + dValue;
  kf.handleLeft = {
    time: origHandleLeft.time + appliedDt,
    value: origHandleLeft.value + dValue,
  };
  kf.handleRight = {
    time: origHandleRight.time + appliedDt,
    value: origHandleRight.value + dValue,
  };
  return appliedDt;
}

/**
 * Apply a new handle position to one side of a keyform, with two
 * Blender-faithful side effects:
 *
 *   1. **Auto → free conversion** on user-edit (Blender
 *      `BKE_nurb_handle_calc_simple_auto`, curve.cc:3952-3961). If the
 *      dragged side was `'auto'` or `'auto_clamped'`, it flips to
 *      `'free'` so the next `recalcKeyformHandles` sweep can't undo the
 *      user's edit.
 *
 *   2. **Aligned mirror** (Blender HD_ALIGN). If the OPPOSITE side is
 *      `'aligned'`, the dragged handle's direction is reflected through
 *      the keyform; the opposite handle's LENGTH is preserved (only its
 *      direction is updated).
 *
 * Mutates `kf` in place.
 *
 * @param {BezTripleLike} kf
 * @param {'left'|'right'} side  which side to apply
 * @param {HandlePoint} newHandle  desired absolute handle position
 */
export function applyHandleDrag(kf, side, newHandle) {
  const ht = kf.handleType ?? { left: 'auto', right: 'auto' };
  if (ht[side] === 'auto' || ht[side] === 'auto_clamped') {
    kf.handleType = { ...ht, [side]: 'free' };
  }
  if (side === 'left') {
    kf.handleLeft = { time: newHandle.time, value: newHandle.value };
  } else {
    kf.handleRight = { time: newHandle.time, value: newHandle.value };
  }

  const opp = side === 'left' ? 'right' : 'left';
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
