// @ts-check

/**
 * Auto-handle calculator for BezTriple keyforms — Slice 2.D of Animation Phase 2.
 *
 * Byte-faithful port of Blender's `calchandleNurb_intern`
 * (`reference/blender/source/blender/blenkernel/intern/curve.cc:3067-3305`)
 * wrapped by `BKE_nurb_handle_calc_ex` (`curve.cc:3952-3961`), which is in
 * turn driven by `BKE_fcurve_handles_recalc_ex`
 * (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:1149-1231`).
 * SS only ships the F-Curve flavour (`is_fcurve = true`); the Nurbs-curve
 * 3D branch and the `auto_smoothing != FCURVE_SMOOTH_NONE` second-pass
 * (`BKE_nurb_handle_smooth_fcurve`) are out of scope — Blender's default
 * smoothing for new FCurves is `FCURVE_SMOOTH_NONE` (`DNA_anim_types.h`
 * `eFCurve_Smoothing`), so SS matches that default.
 *
 * # Handle type map (Blender → SS)
 *
 *   HD_FREE              ↔  'free'
 *   HD_AUTO              ↔  'auto'
 *   HD_VECT              ↔  'vector'
 *   HD_ALIGN             ↔  'aligned'
 *   HD_AUTO_ANIM         ↔  'auto_clamped'    -- Blender's "auto-clamped"
 *
 *   HD_AUTOTYPE_NORMAL        ↔  bezt.autoHandleType === 'normal'
 *   HD_AUTOTYPE_LOCKED_FINAL  ↔  bezt.autoHandleType === 'locked_final'
 *
 * # Why eager (not lazy)
 *
 * Blender recalculates handles after every mutation — `keyframe_insert`,
 * the Graph Editor drag, the dopesheet's translate, etc. all flush
 * through `BKE_fcurve_handles_recalc` before redraw. SS mirrors that
 * eagerly so that:
 *   (a) the exporter (Slice 2.G) reads reified `handleLeft`/`handleRight`
 *       instead of having to redo the calc inline;
 *   (b) the Phase 5 Graph Editor (deferred UI) can render the handles
 *       without re-running the calc on every paint;
 *   (c) round-trip parity (import-Cubism → save → load → export-Cubism)
 *       doesn't require special-case "rehydrate handles on load" logic.
 *
 * Per-mutation cost is O(N) over keyforms; SS curves are 2-5 keys
 * typically (Hiyori's idle motion has 17 keys per curve max), so eager
 * recalc is well within budget. Blender uses `threading::parallel_for`
 * (fcurve.cc:1167) for >256 keys; SS skips the parallelism (Wasm threading
 * not lit) and stays single-threaded.
 *
 * @module anim/fcurveHandles
 */

/**
 * @typedef {Object} HandlePoint
 * @property {number} time
 * @property {number} value
 *
 * @typedef {Object} BezTriple
 * @property {number} time
 * @property {number} value
 * @property {HandlePoint} [handleLeft]
 * @property {HandlePoint} [handleRight]
 * @property {{left:string, right:string}} [handleType]
 * @property {string} [interpolation]
 * @property {('normal'|'locked_final')} [autoHandleType]
 */

/**
 * The "2.5614" magic in Blender (curve.cc:3145, 3154) is the auto-handle
 * length scaler that produces a visually-pleasing fit through three
 * collinear-ish keys. It's empirically chosen (see git blame on
 * 17a4894c5b: `bezier: matched anim curves with linear interpolation`)
 * and ported verbatim — changing it would diverge handle shapes from
 * Blender's auth tools.
 */
const HANDLE_AUTO_SCALE = 2.5614;

/**
 * Compute the auto/auto_clamped/vector/aligned handles for ONE keyform,
 * given its bracketing neighbours. Mutates `bezt.handleLeft`,
 * `bezt.handleRight`, and `bezt.autoHandleType` in place. `bezt.handleType`
 * controls which branch fires per side; `'free'` handles are left
 * untouched (user-authored). End keyforms pass `prev=null` or `next=null`
 * — the algorithm synthesises a mirror neighbour per curve.cc:3095-3114.
 *
 * Direct port of `calchandleNurb_intern` with the F-Curve specialisation
 * (`is_fcurve = true`, `skip_align = false`, `fcurve_smoothing = NONE`).
 *
 * @param {BezTriple} bezt   -- keyform to update
 * @param {BezTriple|null} prev
 * @param {BezTriple|null} next
 */
export function calcHandleForKeyform(bezt, prev, next) {
  if (!bezt) return;

  const h1Type = bezt.handleType?.left  ?? 'auto';
  const h2Type = bezt.handleType?.right ?? 'auto';

  // Default to NORMAL each pass (curve.cc:3087). Auto-clamp will upgrade
  // to LOCKED_FINAL when the keyform is detected to be an extremum.
  bezt.autoHandleType = 'normal';

  // curve.cc:3089 — both handles set to HD_FREE (==0 in Blender's enum)
  // returns early. SS uses string enum so the equivalent is both 'free'.
  if (h1Type === 'free' && h2Type === 'free') return;

  // p2 = current keyform's [time, value] (Blender's bezt->vec[1]).
  const p2t = bezt.time;
  const p2v = bezt.value;

  // p1 = prev->vec[1], synthesising a mirror if prev is null (curve.cc:3095-3104).
  let p1t, p1v;
  if (prev === null) {
    // We need p3 first to mirror. Compute next's coords first (or synthesise
    // from prev — but prev is null here so we use next).
    const p3tInit = next ? next.time  : p2t;
    const p3vInit = next ? next.value : p2v;
    p1t = 2 * p2t - p3tInit;
    p1v = 2 * p2v - p3vInit;
  } else {
    p1t = prev.time;
    p1v = prev.value;
  }

  // p3 = next->vec[1], synthesising a mirror if next is null (curve.cc:3106-3114).
  let p3t, p3v;
  if (next === null) {
    p3t = 2 * p2t - p1t;
    p3v = 2 * p2v - p1v;
  } else {
    p3t = next.time;
    p3v = next.value;
  }

  // dvec_a = p2 - p1, dvec_b = p3 - p2 (curve.cc:3116-3117).
  const dvec_a_t = p2t - p1t;
  const dvec_a_v = p2v - p1v;
  const dvec_b_t = p3t - p2t;
  const dvec_b_v = p3v - p2v;

  // is_fcurve branch (curve.cc:3119-3122): len = dx (X-axis only).
  let len_a = dvec_a_t;
  let len_b = dvec_b_t;
  if (len_a === 0) len_a = 1;
  if (len_b === 0) len_b = 1;

  const isAutoL = h1Type === 'auto' || h1Type === 'auto_clamped';
  const isAutoR = h2Type === 'auto' || h2Type === 'auto_clamped';

  // ── auto / auto_clamped branch (curve.cc:3135-3232) ────────────────────
  if (isAutoL || isAutoR) {
    // tvec = dvec_b / len_b + dvec_a / len_a (curve.cc:3137-3139).
    const tvec_t = dvec_b_t / len_b + dvec_a_t / len_a;
    const tvec_v = dvec_b_v / len_b + dvec_a_v / len_a;

    // is_fcurve + smoothing=NONE → len = tvec[0] * 2.5614 (curve.cc:3148, 3154).
    const len = tvec_t * HANDLE_AUTO_SCALE;

    if (len !== 0) {
      let leftviolate = false;
      let rightviolate = false;

      // No-smoothing ratio cap (curve.cc:3160-3163): keep one side from
      // being more than 5× the other.
      len_a = Math.min(len_a, 5 * len_b);
      len_b = Math.min(len_b, 5 * len_a);

      if (isAutoL) {
        const lenAdj = len_a / len;
        // p2_h1 = p2 + tvec * -lenAdj (curve.cc:3167).
        bezt.handleLeft = {
          time:  p2t - tvec_t * lenAdj,
          value: p2v - tvec_v * lenAdj,
        };

        if (h1Type === 'auto_clamped' && next && prev) {
          // Extremum detection (curve.cc:3169-3190).
          const ydiff1 = prev.value - bezt.value;
          const ydiff2 = next.value - bezt.value;
          if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
            // Both neighbours on same side → extremum, flatten the handle.
            bezt.handleLeft.value = bezt.value;
            bezt.autoHandleType = 'locked_final';
          } else if (ydiff1 <= 0) {
            if (prev.value > bezt.handleLeft.value) {
              bezt.handleLeft.value = prev.value;
              leftviolate = true;
            }
          } else {
            if (prev.value < bezt.handleLeft.value) {
              bezt.handleLeft.value = prev.value;
              leftviolate = true;
            }
          }
        }
      }

      if (isAutoR) {
        const lenAdj = len_b / len;
        // p2_h2 = p2 + tvec * lenAdj (curve.cc:3194).
        bezt.handleRight = {
          time:  p2t + tvec_t * lenAdj,
          value: p2v + tvec_v * lenAdj,
        };

        if (h2Type === 'auto_clamped' && next && prev) {
          const ydiff1 = prev.value - bezt.value;
          const ydiff2 = next.value - bezt.value;
          if ((ydiff1 <= 0 && ydiff2 <= 0) || (ydiff1 >= 0 && ydiff2 >= 0)) {
            bezt.handleRight.value = bezt.value;
            bezt.autoHandleType = 'locked_final';
          } else if (ydiff1 <= 0) {
            if (next.value < bezt.handleRight.value) {
              bezt.handleRight.value = next.value;
              rightviolate = true;
            }
          } else {
            if (next.value > bezt.handleRight.value) {
              bezt.handleRight.value = next.value;
              rightviolate = true;
            }
          }
        }
      }

      // Violation rebalance (curve.cc:3219-3231): when one side was
      // clamped, mirror the slope through the keyform onto the other side
      // so the curve stays C1-continuous at the key. Blender uses an
      // exclusive `if (leftviolate) { ... } else { ... }` so the
      // rightviolate branch fires only when leftviolate is false (matches
      // the C source). Audit-fix MED-B2 (2026-05-16): the prior
      // `else if (h2_x !== 0)` collapsed two predicates into one, silently
      // skipping the rightviolate rebalance if both flags were ever
      // simultaneously set (a latent edge case after auto_clamped
      // returns early on extrema, but still semantically divergent).
      if ((leftviolate || rightviolate) && bezt.handleLeft && bezt.handleRight) {
        const h1_x = bezt.handleLeft.time - bezt.time;
        const h2_x = bezt.time - bezt.handleRight.time;
        if (leftviolate) {
          // Avoid div-by-zero — if h1_x is ~0, the slope is degenerate; skip.
          if (h1_x !== 0) {
            bezt.handleRight.value =
              bezt.value + ((bezt.value - bezt.handleLeft.value) / h1_x) * h2_x;
          }
        } else {
          // rightviolate branch (mirrors Blender's exclusive else at
          // curve.cc:3228-3230). Guard div-by-zero on h2_x for symmetry.
          if (h2_x !== 0) {
            bezt.handleLeft.value =
              bezt.value + ((bezt.value - bezt.handleRight.value) / h2_x) * h1_x;
          }
        }
      }
    }
  }

  // ── vector branch (curve.cc:3235-3240) — straight-line handles ─────────
  if (h1Type === 'vector') {
    // p2_h1 = p2 + dvec_a * -1/3 = p2 - dvec_a/3.
    bezt.handleLeft = {
      time:  p2t - dvec_a_t / 3,
      value: p2v - dvec_a_v / 3,
    };
  }
  if (h2Type === 'vector') {
    bezt.handleRight = {
      time:  p2t + dvec_b_t / 3,
      value: p2v + dvec_b_v / 3,
    };
  }

  // ── aligned branch (curve.cc:3242-3301) ────────────────────────────────
  // `skip_align = false` in BKE_nurb_handle_calc_ex's signature
  // (curve.cc:3952-3961), so we run this pass when at least one side is
  // aligned and neither side is free.
  if (h1Type === 'free' || h2Type === 'free') return;
  if (h1Type !== 'aligned' && h2Type !== 'aligned') return;

  // After the auto/vector passes both handles must exist; if a side was
  // 'aligned' coming in but never got initialised (no auto/vector ran),
  // bail to avoid undefined reads — caller likely just inserted the kf.
  if (!bezt.handleLeft || !bezt.handleRight) return;

  const eps = 1e-5;
  const lenA0 = Math.hypot(bezt.handleLeft.time  - p2t, bezt.handleLeft.value  - p2v);
  const lenB0 = Math.hypot(bezt.handleRight.time - p2t, bezt.handleRight.value - p2v);
  const lenA1 = lenA0 === 0 ? 1 : lenA0;
  const lenB1 = lenB0 === 0 ? 1 : lenB0;
  const ratio = lenA1 / lenB1;

  // SS doesn't model per-handle selection (Blender's bezt.f1 & SELECT
  // branches at curve.cc:3266 + 3284). Without selection, the order of
  // align matters only when a handle was just user-edited; in batch
  // recalc we follow the `else` (non-selected) branch which aligns h1
  // first then h2 — symmetric in steady state.
  if (h1Type === 'aligned' && lenB1 > eps) {
    const k = ratio;
    bezt.handleLeft = {
      time:  p2t + k * (p2t - bezt.handleRight.time),
      value: p2v + k * (p2v - bezt.handleRight.value),
    };
  }
  if (h2Type === 'aligned' && lenA1 > eps) {
    const k = 1 / ratio;
    bezt.handleRight = {
      time:  p2t + k * (p2t - bezt.handleLeft.time),
      value: p2v + k * (p2v - bezt.handleLeft.value),
    };
  }
}

/**
 * Recalculate handles for every keyform in an array. Mutates each
 * keyform's `handleLeft`, `handleRight`, and `autoHandleType` per
 * `calcHandleForKeyform`. Port of `BKE_fcurve_handles_recalc_ex`.
 *
 * Caller's responsibility: keyforms must be sorted by `time` ascending.
 * `buildParamFCurve` / `buildNodeFCurve` / `upsertKeyframe` all maintain
 * that invariant; the v39 migration accepts whatever order the legacy
 * data had (which was already sorted).
 *
 * # Blender behaviours intentionally OMITTED (audit-fix HIGH-B1, 2026-05-16)
 *
 * Per `feedback_blender_reference_strict.md`, every Blender control
 * absent from a port must be cited + justified. The following branches
 * of `BKE_fcurve_handles_recalc_ex` are NOT ported:
 *
 *   - **`auto_smoothing` second pass** (`fcurve.cc:1228-1230` +
 *     `curve.cc:3897-3944` `BKE_nurb_handle_smooth_fcurve`). SS's default
 *     for new FCurves is `FCURVE_SMOOTH_NONE` (matches Blender's
 *     `DNA_anim_types.h` `eFCurve_Smoothing` default). When a future
 *     Phase 5 UI exposes a per-FCurve smoothing toggle, this branch
 *     needs porting.
 *
 *   - **Cyclic-cycle support** (`fcurve.cc:1130-1147` `cycle_offset_triple`
 *     + 1162-1166 + 1177-1184 + 1199-1230 cyclic re-symmetrise). Requires
 *     F-Modifier `Cycles` which is Phase 3 of this plan. Without cyclic
 *     support, an Action with `ACT_CYCLIC` flag set won't have its first
 *     and last handles cyclically blended.
 *
 *   - **Threshold X-clamp on handle.time** (`fcurve.cc:1191-1193`
 *     `CLAMP_MAX(bezt->vec[0][0], decrement_ulp(bezt->vec[1][0] - threshold))`).
 *     Blender clamps non-auto handles so their X-coord can't equal the
 *     keyform's X-coord (`threshold = 0.001`). Without this, a user-set
 *     `free` handle at `handleLeft.time === bezt.time` would produce a
 *     zero-divide in the segment evaluator's `correctBezpart`. SS gets
 *     away without this because `evaluateBezTripleSegment` already
 *     guards `correctBezpart` against degenerate spans (via the
 *     `findZero`-returns-0 fall-through to `prev.value`). When SS ships
 *     a Graph Editor handle drag (Phase 5), this clamp must be added.
 *
 *   - **`FCURVE_EXTRAPOLATE_CONSTANT` end-handle flatten**
 *     (`fcurve.cc:1199-1209`). When the FCurve's `extend` is
 *     `EXTRAPOLATE_CONSTANT` (the SS default), Blender flattens the
 *     first/last auto handle to be horizontal and marks it `LOCKED_FINAL`
 *     so eval extrapolation past the curve range holds the keyform value.
 *     SS's evaluator does this clamp INDEPENDENTLY (see `evaluateFCurve`
 *     in fcurve.js: `time <= keyforms[0].time` and `time >= keyforms[N-1].time`
 *     both fall through to constant extrapolation). The handle SHAPE
 *     therefore doesn't matter for extrapolation behaviour. If SS ever
 *     ships `EXTRAPOLATE_LINEAR` per Blender's other extrapolation
 *     option, this branch needs porting so the linear extrapolation
 *     reads the right slope from the end handles.
 *
 *   - **Duplicate-keyframe LOCKED_FINAL guard** (`fcurve.cc:1212-1214`).
 *     When `prev->vec[1][0] >= bezt->vec[1][0]` (two keyforms at the same
 *     time), Blender marks BOTH `LOCKED_FINAL`. SS's `upsertKeyframe`
 *     paths dedupe at insert time (`Math.abs(arr[i].time - time) < 1e-6`)
 *     so duplicates shouldn't reach the recalc; if they did, the
 *     `len_a === 0` / `len_b === 0` guards in `calcHandleForKeyform`
 *     fall back to `len = 1` which avoids div-by-zero but produces
 *     unspecified handles. A direct port would be more honest.
 *
 *   - **Per-handle selection** (`bezt.f1 & SELECT` branches at
 *     `curve.cc:3266 + 3284`). SS doesn't model interactive per-handle
 *     selection; the aligned-handle order-of-calculation branch is
 *     therefore moot. When Phase 5 ships handle drag, this needs porting
 *     so the unselected handle aligns to the user-selected one.
 *
 *   - **`BKE_fcurve_update_handle_flag_from_opposite`** (`fcurve.cc:1233-1267`).
 *     Helper for the Graph Editor's "set handle type" operator — it
 *     normalises the opposite-side handle type when the user toggles
 *     one side. Not in any code path SS exercises today.
 *
 * @param {BezTriple[]} keyforms
 */
export function recalcKeyformHandles(keyforms) {
  if (!Array.isArray(keyforms) || keyforms.length < 2) {
    // <2 keyforms → no segment, no handle calc. Blender returns early
    // at fcurve.cc:1156-1160 for the same reason.
    return;
  }
  // mesh_verts curves carry array-shaped values (per-vertex {x,y}); they
  // have no scalar value-axis and therefore no BezTriple handles to
  // compute. `calcHandleForKeyform` does scalar arithmetic on `.value`
  // (e.g. `prev.value - bezt.value`) which would yield NaN handles on an
  // array. Skip them here — this is the single chokepoint every handle-
  // recompute path funnels through (upsertKeyframe + the dopesheet /
  // graph-edit / fcurve-editor ops), so guarding here keeps array-valued
  // mesh keyforms safe everywhere. interpolateMeshVerts evaluates them
  // with a shared per-segment lerp factor and never reads handles.
  if (typeof keyforms[0]?.value !== 'number') return;
  for (let i = 0; i < keyforms.length; i++) {
    const prev = i > 0 ? keyforms[i - 1] : null;
    const next = i < keyforms.length - 1 ? keyforms[i + 1] : null;
    calcHandleForKeyform(keyforms[i], prev, next);
  }
}

/**
 * Convenience wrapper: recalcs every FCurve's keyforms in an Action.
 * Used by the post-migration handle reify pass + by anywhere that batch-
 * mutates an action's fcurves (rare today — most edits go through
 * upsertKeyframe which already recalcs).
 *
 * @param {{fcurves?: Array<{keyforms?: BezTriple[]}>}|null|undefined} action
 */
export function recalcActionHandles(action) {
  if (!action || !Array.isArray(action.fcurves)) return;
  for (const fc of action.fcurves) {
    if (fc && Array.isArray(fc.keyforms)) recalcKeyformHandles(fc.keyforms);
  }
}
