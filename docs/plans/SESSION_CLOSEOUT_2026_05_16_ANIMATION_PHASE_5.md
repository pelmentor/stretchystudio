# Session Close-out — Animation Phase 5 Slices 5.A+5.B SHIPPED
**Date:** 2026-05-16
**Branch:** `master`
**Commits:**
- `bd1e68b` — feat(anim): Animation Phase 5 Slices 5.A+5.B — Graph Editor canvas-2D + handle drag
- `feb4bde` — fix(audit): Animation Phase 5 Slices 5.A+5.B dual-audit sweep — 5 HIGH + 3 MED findings
- *(this doc)* — close-out documentation

Sister to the Animation Phase 2 ship earlier today (`bb3b392` + `82f5f98` + `c19c3c8`) — Phase 5 lifts the user-facing payoff for the Slice 2.D auto-handle calculator that just shipped.

---

## What shipped

The F-Curve Graph Editor is now interactive. Users can:

- **LMB-click** a keyframe diamond → select (Shift toggles into a Set).
- **LMB-drag** a keyframe diamond → move in (time, value).
- **LMB-drag** a handle dot → reshape the bezier interp; handle-type conversions fire per Blender semantics.
- **Click empty area** → seek the playhead.

Replaces the read-only 220-line SVG-only scaffold at [src/v3/editors/fcurve/FCurveEditor.jsx](../../src/v3/editors/fcurve/FCurveEditor.jsx) with a 550-line two-layer composition.

### Slice 5.A — Editor architecture (plan §5.A)

Two-layer composition per the audit-driven decision (v1's SVG-only path breaks past ~200 keyframes; real characters ship 1200+):

- **SVG background** (`pointer-events: none`): axes + value/time labels + curve `<path>` + zero-line + playhead. Scales with sample count (constant 240), not keyform count.
- **Canvas-2D foreground**: keyframe diamonds + handle dots + handle lines drawn imperatively, DPR-aware (drawing buffer scaled by `window.devicePixelRatio`). Handles draw only for SELECTED keyforms — this is Blender's `SIPO_SELVHANDLESONLY` mode, not the default mode (per [reference/blender/source/blender/editors/space_graph/graph_draw.cc:469-476](../../reference/blender/source/blender/editors/space_graph/graph_draw.cc)).

Both layers share a single `view` (px-space PAD + plotW/plotH + tMin/tMax + vMin/vMax) derived from container dims via ResizeObserver and the active FCurve's auto-fit value range.

### Slice 5.B — Drag write-mode (plan §5.B, first cut)

**Keyframe drag** (`applyKeyformDrag` in [src/anim/graphEditOps.js](../../src/anim/graphEditOps.js)):
- Pure (time, value) translation. Handles ride along by the same Δ per Blender's absolute-handle-coordinate convention.
- **No time-clamp.** Keyforms may cross; the editor re-sorts post-tick and tracks the dragged keyform's new index via `dragIdxRef`. Matches Blender's split between transform-time `sort_time_fcurve` ([fcurve.cc:1293-1339](../../reference/blender/source/blender/blenkernel/intern/fcurve.cc)) and confirm-time `BKE_fcurve_merge_duplicate_keys` ([transform_convert_graph.cc:1014](../../reference/blender/source/blender/editors/transform/transform_convert_graph.cc)). Duplicate-time merging is not yet implemented; lands with Slice 5.C operator pass.

**Handle drag** (`applyHandleDrag` in `graphEditOps.js`):
- **HD_AUTO / HD_AUTO_ANIM → HD_ALIGN on BOTH sides** if either side was AUTO. Matches `BKE_nurb_bezt_handle_test` at [curve.cc:4054-4084](../../reference/blender/source/blender/blenkernel/intern/curve.cc), called per transform tick from `testhandles_fcurve` at [transform_convert_graph.cc:580](../../reference/blender/source/blender/editors/transform/transform_convert_graph.cc). The **both-sides** rule is the key Blender detail: with one AUTO + one ALIGN, the next `BKE_fcurve_handles_recalc` would have the AUTO compute via neighbour slope and the ALIGN mirror it, silently overwriting the user's drag. With both ALIGN the recalc is self-consistent and the drag survives.
- **HD_VECT → HD_FREE on the dragged side only** (matches per-side flag check at [curve.cc:4073-4082](../../reference/blender/source/blender/blenkernel/intern/curve.cc)).
- **Aligned mirror** of the opposite handle through the keyform (whether pre-existing aligned or freshly converted in step 1). Opposite's pre-drag absolute length is preserved; only direction is reflected. End-equivalent to Blender's `len_ratio` formula at [curve.cc:3266-3282](../../reference/blender/source/blender/blenkernel/intern/curve.cc) (verified by `test_graphEditOps.mjs`'s length-invariance assertion across large drags).

**Undo wrapping**: each pointer-down opens `beginBatch(project)`; drag-moves use `update(p => ..., { skipHistory: true })`; pointer-up calls `endBatch()`. One drag = one undo entry. Audit-fix HIGH-A1 added a `dragCleanupRef` + unmount `useEffect` so a tab/workspace switch mid-drag releases listeners + closes the batch (without it, `_batchDepth` corrupts and undo silently stops growing app-wide).

### Tests

**NEW:** [scripts/test/test_graphEditOps.mjs](../../scripts/test/test_graphEditOps.mjs) — 45 checks covering:

- `applyKeyformDrag` translation + handle ride-along
- Negative and positive Δ allow-cross (no clamp; Blender re-sort behaviour)
- Replay semantics (orig snapshot, not relative)
- `applyHandleDrag` HD_AUTO/AUTO_CLAMPED → HD_ALIGN both-sides combinations:
  - auto + auto, auto_clamped + auto_clamped, free + auto, auto + free, missing handleType
- `applyHandleDrag` HD_VECT → HD_FREE on dragged side; opposite VECT preserved
- HD_VECT + HD_AUTO combined (both rules fire independently)
- Aligned mirror with pre-existing aligned opposite (length-preservation)
- Aligned mirror via auto-converted-to-aligned
- Length-invariance across large drags (verifies SS end-equivalence to Blender's `len_ratio` formula)
- No-mirror when opposite is not aligned
- Zero-length new / opposite handles skip mirror
- Re-edit cycle: drag → release → drag again preserves end-state
- Re-edit of HD_VECT-flipped-to-HD_FREE stays free

---

## Dual-audit pass (per `feedback_dual_audit_after_phase_ship`)

Spawned 2 parallel agents (architecture + Blender-fidelity) on feature commit `bd1e68b`. **8 findings**, all addressed in audit-fix `feb4bde`:

| # | Severity | File:line | Finding |
|---|---|---|---|
| HIGH-A1 | HIGH | FCurveEditor.jsx (drag handlers) | Window-level pointer listeners not cleaned up on component unmount; mid-drag tab switch leaves `endBatch()` un-called → `_batchDepth` corrupts → undo silently stops growing app-wide |
| HIGH-B1 | HIGH | graphEditOps.js + 2 JSDocs | Wrong conversion target (HD_AUTO → HD_FREE) AND wrong cited function (`BKE_nurb_handle_calc_simple_auto` is a recalc-safeguard utility, not the user-edit path). Verified via Blender source: HD_AUTO → HD_ALIGN on BOTH sides via `BKE_nurb_bezt_handle_test` |
| HIGH-B2 | (NOT A FINDING) | graphEditOps.js mirror math | Audit B claimed length-ratio drift, but verification showed my `|opp - kf| = oppLen` end-state is identical to Blender's `len_ratio * new_len_b` formula. Added test asserting length-invariance across large drags |
| HIGH-B3 | HIGH | graphEditOps.js + FCurveEditor.jsx drag handlers | Silent-invented time-clamp (Rule №1 violation). Blender allows cross + re-sorts. Removed clamp; editor re-sorts post-tick + tracks dragged kf's new index via `dragIdxRef` |
| HIGH-B4 | HIGH | graphEditOps.js | HD_VECT → HD_FREE on independent drag was missing entirely. Added as step (2) of applyHandleDrag |
| MED-B5 | MED | JSDocs throughout | `BKE_nurb_handle_calc_simple_auto` citation was wrong in function AND line; replaced with 4 verified citations covering BOTH transform-side rules (`BKE_nurb_bezt_handle_test`, `testhandles_fcurve`, `sort_time_fcurve`, `BKE_fcurve_merge_duplicate_keys`) |
| MED-B6 | MED | FCurveEditor.jsx JSDoc | "Handles only for selected" was claimed as Blender default; actually it's `SIPO_SELVHANDLESONLY` mode. Documented with citation; full-handles toggle planned for Slice 5.C |
| MED-B7 | MED | test_graphEditOps.mjs | No re-edit cycle test + no length-preservation verification. Added both |

**HIGH-B1 verification was a separate Explore round** because the architecture agent and the Blender-fidelity agent disagreed on the conversion target. The Explore confirmed Blender does HD_AUTO → HD_ALIGN with the both-sides rule; my initial HD_FREE choice would have produced UX-broken results in any future eager-recalc context.

**HIGH-B2 was downgraded after verification** — the audit agent flagged length-ratio drift but the actual formulas are end-equivalent (Blender's `len = len_a/len_b; new_h1 = ratio * len_b = len_a` preserves `len_a`, same as SS's `new_opp = -unit_new * oppLen`).

---

## Owed manual verification

Cannot be assertion-tested headlessly — needs the user to:
1. **Visual handle drag**: select a keyform with `interpolation = 'bezier'` and `handleType = 'auto'`; drag a handle dot in the FCurveEditor. Confirm:
   - The handle dot follows the cursor.
   - The OPPOSITE handle mirrors the drag (aligned behaviour).
   - The handle type indicator (when V menu lands in 5.C) shows `'aligned'` post-drag.
2. **Cross + re-sort**: drag a keyform's time past a neighbour. Confirm:
   - The diamond physically passes the neighbour during the drag.
   - On release, the keyforms are re-sorted (visual order matches time order).
   - The dragged keyform stays selected.
3. **Undo across tab switch**: start a drag, switch workspaces mid-drag (Ctrl+Tab or similar), then do another drag. Confirm undo (Ctrl+Z) still works and unwinds the latest drag. Without HIGH-A1's fix this regression would have been silent.
4. **Vector → free**: select a keyform with `interpolation = 'linear'` (which uses HD_VECT); drag one of its handle dots. Confirm:
   - That side's handle becomes draggable (auto-converts to free).
   - The OPPOSITE vector handle stays at its 1/3-back position.

---

## Tests passing (final state at `feb4bde`)

| Test | Pass/Fail |
|------|-----------|
| test:graphEditOps | 45/45 |
| test:fcurveHandles | 35/35 |
| test:fcurveEval | 35/35 |
| test:animationEngine | 61/61 |
| test:animFCurveBridge | 52/52 |
| test:motion3jsonRoundtrip | 42/42 |
| `tsc --noEmit` | clean |

---

## Resume paths (priority order, post this session)

1. **Slice 5.C — Operator pass** (the rest of plan §5.B). Box-select (B), modal G/S (with snap), V handle-type menu, T interpolation menu, Shift+E extrapolation menu, Delete, Home (fit-view), Ctrl+G (snap-to-frame), per-handle selection state, lock-view-during-drag polish that closes the "auto-fit rescales mid-drag" UX wart from 5.A. Also lands the duplicate-time merge (`BKE_fcurve_merge_duplicate_keys` parity) deferred from HIGH-B3.

2. **Slice 5.C+ — Multi-curve display** (plan §5.C). Per-FCurve color, curve-list sidebar, active vs context curves. This is where the per-handle selection store gets useful.

3. **Slice 5.D — Driver banner** (plan §5.D). "(D)" badge + clear-driver button + edit-disabled state.

4. **Phase 2 owed-manual verification** — from the prior close-out, the user still owes browser-based confirmation of: live recording bezier handle export, full Hiyori round-trip in Cubism Editor, visual smoothness of auto-handles in the Graph Editor (now possible with 5.A+5.B shipped!), named-easing bake reload.

5. **Phase 3 — F-Curve modifiers** (1 week per plan). Cycles / Noise / Generator / Envelope. The cyclic-cycle support in `recalcKeyformHandles` (cited omission #2 from Slice 2.D close-out) lights up here.

6. **Round 8 UI sweep — F-1 follow-on** — ModePill lift to shared subcomponent (carried over from Round 7).

7. **B2-B8 playback_controls gaps** — easiest first: `PLAY_REVERSE` (one new animationStore action); hardest: `use_preview_range` (needs new SS concept). Carried over from Round 7.

---

## Cross-references

- Plan: [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 5](./ANIMATION_BLENDER_PARITY_PLAN.md) (lines 1280-1358)
- Prior close-out (same day): [SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md](./SESSION_CLOSEOUT_2026_05_16_ANIMATION_PHASE_2.md) — Phase 2 Slices 2.D/2.G/2.G.1/2.H ship that this slice builds atop
- Memory: `feedback_no_crutches_rule_one`, `feedback_no_migration_baggage_rule_two`, `feedback_blender_reference_strict`, `feedback_dual_audit_after_phase_ship`, `feedback_question_agents_not_user`, `feedback_filter_in_selector`, `feedback_hooks_before_early_return`, `feedback_two_views_one_host`, `project_blender_parity_plans_in_flight`
