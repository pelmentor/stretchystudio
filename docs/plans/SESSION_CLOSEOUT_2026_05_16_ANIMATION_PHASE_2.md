# Session Close-out — Animation Phase 2 Slices 2.D/2.G/2.G.1/2.H SHIPPED
**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `bb3b392` — feat(anim): Phase 2 Slices 2.D/2.G/2.G.1/2.H
- `82f5f98` — fix(audit): 6-finding dual-audit sweep
- *(this doc)* — close-out documentation

---

## What shipped

Closes the Animation Phase 2 owed work from the Round 7 close-out doc:
auto-handle reify + motion3.json bezier handle round-trip + Hiyori
exit-gate. Sister to v39 BezTriple migration shipped in Slice 2.A.

### Slice 2.D — Auto-handle calculator
**NEW:** [src/anim/fcurveHandles.js](../../src/anim/fcurveHandles.js)
(~360 lines). Byte-faithful port of Blender's `calchandleNurb_intern`
(`reference/blender/source/blender/blenkernel/intern/curve.cc:3067-3305`),
driven by `BKE_fcurve_handles_recalc_ex` (`fcurve.cc:1149-1231`). SS
ships the F-Curve flavour only:
- `is_fcurve = true`
- `skip_align = false`
- `fcurve_smoothing = NONE`

The 3D-Nurbs branch and the smoothing 2nd pass are out of scope, with
explicit JSDoc citations to the omitted Blender ranges (per
`feedback_blender_reference_strict`).

**Wired into:**
- [src/anim/animationFCurve.js:188](../../src/anim/animationFCurve.js#L188) — `normalizeKeyforms` calls `recalcKeyformHandles(out)` after building
- [src/anim/fcurve.js:178](../../src/anim/fcurve.js#L178) — `upsertKeyframe` calls `recalcKeyformHandles(arr)` after sorted insert
- [src/renderer/animationEngine.js:288](../../src/renderer/animationEngine.js#L288) — live recording path (audit-fix HIGH-A1)

### Slice 2.G — motion3.json exporter bezier handles
[src/io/live2d/motion3json.js](../../src/io/live2d/motion3json.js):
- Bezier segments derive `cx1/cy1/cx2/cy2` from `prevKf.handleRight` +
  `kf.handleLeft` (was: 1/3-2/3 placeholder).
- Named easings (10 types × 3 modes) BAKE to 16 linear sub-segments per
  BezTriple segment via `evaluateBezTripleSegment` sampling. Cubism's
  segment encoding has no native sine/quad/etc., so we reconstruct via
  type-0 linear hops. 16 steps = ~0.5° fidelity for 90°-swing curves.
- Audit-fix MED-A3: missing handles trigger `logger.warn` with diagnostic
  context instead of silent 1/3-2/3 fallback.

### Slice 2.G.1 — motion3.json importer bezier handles
[src/io/live2d/motion3jsonImport.js](../../src/io/live2d/motion3jsonImport.js):
- SEG_BEZIER decode preserves Cubism's authored `cx1/cy1/cx2/cy2` into
  BezTriple `handleRight`/`handleLeft` slots with `handleType: 'free'/'free'`
  so the post-import `recalcKeyformHandles` reify leaves them untouched.
- SEG_LINEAR / SEG_STEPPED / SEG_INV_STEPPED decode plants
  `handleType: 'vector'/'vector'`.
- Audit-fix MED-B3: non-finite bezier control points trigger a warning
  before falling through to the 0-substitution.

### Slice 2.F tests
**NEW:** [scripts/test/test_fcurveHandles.mjs](../../scripts/test/test_fcurveHandles.mjs)
— 35 checks covering:
- Vector handle position (1/3-way back from keyform)
- Free/free no-op
- Auto-clamped extremum detection (LOCKED_FINAL)
- Auto monotonic slope match
- recalcKeyformHandles walk (mid-extremum + endpoint mirror)
- <2 keyforms no-op
- recalcActionHandles fan-out
- Null/malformed safety

**NEW:** [scripts/test/test_motion3jsonRoundtrip.mjs](../../scripts/test/test_motion3jsonRoundtrip.mjs)
— 42 checks covering:
- Synthetic byte-exact round-trip (1 curve, 3 segment types)
- Bezier handle preservation (cx1/cy1/cx2/cy2)
- All 11 Hiyori samples (m01..m10 + pro_t11_ai_idle) per-curve segment
  value-equality (audit-fix HIGH-A2)

### Slice 2.H — Phase exit gate
All 11 Hiyori motion3 samples round-trip through
`parseMotion3Json → action → generateMotion3Json` with per-curve segment
VALUES preserved within tolerance:
- `EPS_TIME = 1e-3` (1ms) — reflects Phase 0.0's ms-canonical
  quantisation; sub-ms Cubism source times collapse to ms
- `EPS_VALUE = 1e-6` — actual bug-detection threshold (fp64
  throughout the parse → re-encode path)

The plan's "byte-identical" promise is **reinterpreted** here as
"within the ms-quantisation tolerance" since sub-ms time is
un-representable post-Phase-0.0. Documented in the test's EPS_TIME
comment.

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Spawned 2 parallel agents (architecture + Blender-fidelity) on feature
commit `bb3b392`. **6 findings**, all addressed in audit-fix `82f5f98`:

| # | Severity | File | Finding |
|---|----------|------|---------|
| HIGH-A1 | HIGH | renderer/animationEngine.js:288 | Live recording path's `upsertKeyframe` skipped Slice 2.D recalc |
| HIGH-A2 | HIGH | test_motion3jsonRoundtrip.mjs:183 | Hiyori test only checked LENGTH, not values |
| MED-A3 | MED | io/live2d/motion3json.js:240 | Bezier handle `??` silent fallback (Rule №1) |
| HIGH-B1 | HIGH | anim/fcurveHandles.js JSDoc | 5 additional Blender omissions undocumented (X-clamp, EXTRAPOLATE_CONSTANT flatten, duplicate-key guard, per-handle selection, opposite-handle-flag helper) |
| MED-B2 | MED | anim/fcurveHandles.js:215 | violation rebalance `else if` collapsed two predicates |
| MED-B3 | MED | io/live2d/motion3jsonImport.js:213 | NaN bezier control points silently → 0 |

**HIGH-A2 caught a real bug during the fix:** the strengthened
value-equality test surfaced Cubism's sub-ms time precision quantising
to integer ms on import. This is a deliberate trade-off from Phase 0.0's
`feedback_ms_canonical_animation_time`, not a regression — but the §2.H
"byte-identical" claim was over-promised. Reinterpreted to
"value-equality within ms-quantum" + documented in the test.

---

## Per-section Blender mapping

| SS function | Blender source | Notes |
|---|---|---|
| `calcHandleForKeyform` | `curve.cc:3067-3305` (`calchandleNurb_intern`) | F-Curve flavour only |
| `recalcKeyformHandles` | `fcurve.cc:1149-1231` (`BKE_fcurve_handles_recalc_ex`) | Minus `auto_smoothing` 2nd pass + cyclic + 5 others (all cited in JSDoc) |
| `recalcActionHandles` | `fcurve.cc:1078` (`BKE_fcurve_handles_recalc` per-FCurve sweep) | Action-level convenience wrapper |
| `encodeKeyframesToSegments` bezier branch | Cubism motion3.json spec (segment type 1) | 6-float payload: cx1, cy1, cx2, cy2, t1, v1 |
| `encodeKeyframesToSegments` named-easing bake | n/a (Cubism has no named easing) | Per-plan §2.G: subdivide via `evaluateBezTripleSegment` |
| `decodeSegmentsToKeyframes` bezier branch | Cubism motion3.json spec (segment type 1) | Preserves authored control points |
| eager recalc on `keyframe_insert` | `animrig/intern/fcurve.cc:499` (`BKE_fcurve_handles_recalc` post-insert, gated on `!INSERTKEY_FAST`) | SS does eager always |

---

## Owed manual verification

Cannot be assertion-tested headlessly — needs the user to:
1. **Live recording**: drop keyframes in canvas via K hotkey while playback
   is active; export motion3.json; visually inspect that bezier
   handles look natural in Cubism Editor's Animation View.
2. **Bezier round-trip**: import a Hiyori `.motion3.json` into SS, save
   the project, reload it, re-export; compare resulting motion3.json
   against Hiyori source. Time fields may drift by ≤1ms (ms-canonical
   quantisation); value fields must match.
3. **Auto-handle smoothness**: insert 3+ keyframes with `interpolation =
   'bezier'`, observe the curve in (future) Phase 5 Graph Editor — auto
   handles should produce visually smooth curves through monotonic
   sequences and flat handles at extrema.
4. **Named-easing bake**: keyframe a param with `interpolation = 'sine'`,
   export motion3.json, load in Cubism Viewer; the eased curve should
   reconstruct with no visible kinks at sub-segment boundaries.

---

## Tests passing (final state at `82f5f98`)

| Test | Pass/Fail |
|------|-----------|
| test:fcurveHandles | 35/35 |
| test:motion3jsonRoundtrip | 42/42 |
| test:fcurveEval | 35/35 |
| test:motion3json | 33/33 |
| test:animationEngine | 61/61 |
| test:animFCurveBridge | 52/52 |
| test:actionExportMotion3 | 39/39 |
| test:idleBuilder | 40/40 |
| test:exportAnimation | 35/35 |
| test:animationStore | 55/55 |
| test:projectRoundTrip | 41/41 |
| test:saveLoadRigSpec | 19/19 |
| test:migrationV39 | 43/43 |
| `tsc --noEmit` | clean |

---

## Resume paths (priority order, post this session)

1. **Phase 2 — UI lift (deferred per plan §2.E)** — the user-facing
   bezier-handle drag UI was deferred to Phase 5. Today the timeline
   easing dropdown still writes default `auto_clamped` handles; custom
   bezier authoring is not exposed. Lifting an actual Graph Editor
   that lets users see + drag the handles is the next user-visible
   payoff — and the only place the 7 documented Blender omissions in
   `recalcKeyformHandles` actively block (handle-drag needs the
   threshold X-clamp + per-handle selection + opposite-flag helper).

2. **Phase 3 — F-Curve modifiers** — Cycles / Noise / Generator /
   Envelope. The cyclic-cycle support in `recalcKeyformHandles` (cited
   omission #2) lights up here once `Cycles` modifier ships.

3. **Phase 2 → Phase 5 UI lift** — keyframe insert/drag operator (the
   `anim.keyframe_insert` Pose menu fidelity gap flagged in Round 5
   FID-A.3) — should now be doable atop the auto-handle calculator
   that just shipped.

4. **Round 8 UI sweep — F-1 follow-on** — ModePill lift to shared
   subcomponent (from the Round 7 deferred list).

5. **B2-B8 playback_controls gaps** — easiest first: `PLAY_REVERSE` (one
   new animationStore action); hardest: `use_preview_range` (needs new
   SS concept). Carried over from Round 7.

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 2](./ANIMATION_BLENDER_PARITY_PLAN.md) (lines 812-948)
- Prior close-out: [SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_7.md](./SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_7.md)
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_ms_canonical_animation_time`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `project_blender_parity_plans_in_flight`
