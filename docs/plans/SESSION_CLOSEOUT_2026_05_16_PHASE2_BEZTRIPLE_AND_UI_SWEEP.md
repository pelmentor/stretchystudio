# Session close-out — 2026-05-16
# Phase 2 BezTriple substrate (Slices 2.A + 2.C) + UI Blender-fidelity sweep (F-3 / F-4 / F-1 / F-10)

## Status

Two work threads shipped this session, in parallel after the Phase 1.G dual-PSD acceptance gate closed (`9f957b8` from the prior session).

| Thread | Commit | What landed |
|--------|--------|-------------|
| **Animation Phase 2.A** | `24764d1` | Schema v39 — BezTriple keyform shape (field rename only) |
| **Animation Phase 2.C** | `f8be651` | Full BezTriple evaluator + 30 named easings (Blender byte-faithful) |
| **UI sweep F-3 + F-10** | `6a1b468` | Properties tab order + IDs (BCONTEXT_OBJECT) + stale 'Skeleton Edit' copy |
| **UI sweep F-4** | `4ec9349` | Outliner Blender labels + OUTLINER_PT_filter popover (starter filter set) |
| **UI sweep F-1 (architecture)** | `b05e343` | Per-area Header registry + OutlinerHeader (lifted) + ViewportHeader scaffold |

All 5 commits pushed to `origin/master`. Test scoreboard: 261/261 scripts green at every commit, typecheck clean.

## Thread A — Animation Phase 2 BezTriple substrate

**Goal.** Replace pre-v39 keyform shape `{time, value, type?, easing?}` with Blender's full BezTriple-shape record so the animation evaluator + editor can do per-keyframe bezier handles + 10 named easings.

### Slice 2.A — Schema v39 (`24764d1`, +846/-273)

- New module [src/store/migrations/v39_beztriple_keyforms.js](../../src/store/migrations/v39_beztriple_keyforms.js) — converts every `project.actions[i].fcurves[j].keyforms[k]` to the new shape per the legacy-easing → interpolation+handleType table from `ANIMATION_BLENDER_PARITY_PLAN.md` §2.B. Drops `type` + `easing` outright (Rule №2 — no migration baggage, no dual-read).
- New canonical write factory [src/anim/animationFCurve.js](../../src/anim/animationFCurve.js):`makeBezTripleKeyform(input)` — accepts either v39 input (idempotent pass-through) or legacy `{easing, type}` input (mapped via the same legacy → BezTriple table).
- Both evaluators (`evaluateFCurve` depgraph + `interpolateTrack` animationEngine) converge on `kf.interpolation` as the segment-shape discriminator.
- `motion3json` exporter swaps to read `kf.interpolation`; segment-type discriminator now lives on the segment-START keyform per Blender + Cubism convention (was segment-END pre-v39).
- `motion3jsonImport` emits the new shape; bezier control-point preservation deferred to Slice 2.G.1.
- 14 production write/read sites updated (TimelineEditor, exportSpine, can3 stub, etc.).
- 4 test fixtures updated; new `test_migration_v39.mjs` (43 assertions).

### Slice 2.C — Full evaluator (`f8be651`, +899/-69)

- New module [src/anim/fcurveEval.js](../../src/anim/fcurveEval.js) — single shared eval primitive used by BOTH `evaluateFCurve` (depgraph path) and `interpolateTrack` (animationEngine path) so they can't drift again.
- Cubic-bezier inversion: ported byte-faithfully from Blender's `solve_cubic` + `findzero` + `berekeny` + `BKE_fcurve_correct_bezpart` (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:1377-1559`). Cardano's roots over [SMALL=-1e-10, 1.000001]; handle-overshoot clamp.
- 30 named easings: back/bounce/circ/cubic/elastic/expo/quad/quart/quint/sine × {in/out/inout} from `easing.cc`. All constants match Blender exactly (BACK overshoot 1.70158, EXPO pow_min 2^-10, ELASTIC blend, etc.).
- DEFAULT_EASE_MODE per type matches Blender's switch dispatch in `fcurve_eval_keyframes_interpolate` (BACK/BOUNCE/ELASTIC → out; CIRC/CUBIC/EXPO/QUAD/QUART/QUINT/SINE → in).
- New `test_fcurveEval.mjs` (35 assertions): each interpolation type at known sample points, easeMode override behavior, all-equal-y shortcut, overshoot clamp, boundary values.

### What's left for Phase 2

| Slice | Status | Scope |
|-------|--------|-------|
| 2.D — Auto-handle calculator | pending | `fcurveHandles.js` helper for `auto` / `auto_clamped` per Blender's `BKE_fcurve_handles_recalc` |
| 2.G + 2.G.1 — motion3 import/export bezier round-trip | pending | Preserve cx1/cy1/cx2/cy2 control points into `handleLeft`/`handleRight`; make exporter use them instead of the 1/3-2/3 placeholder |
| 2.F + 2.H — Exit gate | pending | Round-trip 6 Cubism samples (Hiyori, Mark, Mao, Natori, Wanko, Mocchin) byte-identical |

## Thread B — UI Blender-fidelity sweep

User-requested after Slice 2.A landed: "stretchy studio needs a strong UI blender fidelity audit. And sweep after."

The audit (background-launched, 10 findings) lives in the agent transcript; this section captures the sweep.

### F-3 + F-10 — Properties tab order + stale copy (`6a1b468`, +92/-49)

- Properties tab id `'item'` → `'object'` (matches BCONTEXT_OBJECT enum at `space_buttons.cc:218`).
- Tab order reshuffled to Blender's BCONTEXT order: Object · Modifiers · Physics · Object Data · Bone (Physics moved BEFORE Data per the enum).
- New `BCONTEXT_SEPARATOR`-style divider before SS-specific tabs (Variant · Deformer · Parameter · Rig).
- PropertiesTabBar renders the divider only when a preceding tab is visible (no ghost dividers).
- `editorStore.propertiesActiveTab` default: `'item'` → `'object'`.
- "Skeleton Edit" stale copy fixed in 6 user-facing strings/comments: ModePill empty-state hint, ModePill docstring, SkeletonOverlay joint-drag comment, OutlinerEditor 'skeleton' branch comment, keymap.default.js Tab keybind comment, operators.registry.js mode.editToggle comment, ViewLayersPopover docstring.
- Frozen v17/v27 migration comments containing "Skeleton Edit" left intact (they describe pre-migration vocabulary — Rule №2 says don't rewrite migration history).

### F-4 — Outliner Blender labels + filter popover (`4ec9349`, +147/-28)

- Display-mode labels relabeled per Blender vocabulary: `Armature Data` → `Armature`, `Rig Data` → `Deformer Graph`. Documented as SS-specific extensions to Blender's `SO_VIEW_LAYER` / `SO_LIBRARIES` / `SO_DATA_API` enum.
- New filter popover (Funnel icon) mirrors `OUTLINER_PT_filter` (`space_outliner.py:403`). Starter filter set:
  - **Show Selected Only** — restricts tree to selection + ancestors
  - **Hide Hidden** — filters rows where `node.visible === false`
- New `filterOutlinerTreeByPredicate` helper — same ancestor-chain-preserving pattern as the existing search filter, parameterized on a predicate.
- Active filter tints the funnel icon (`text-primary`) so the user sees the tree is narrowed.

### F-1 (architecture + 2 headers) — Per-area Header registry (`b05e343`, +498/-170)

- `EDITOR_REGISTRY` entries gain optional `header: React.ComponentType | null` slot. When present, `Area.jsx` renders it between the `AreaTabBar` and the editor body. Mirrors Blender's `*_HT_header` per-area pattern.
- **OutlinerHeader** ([src/v3/headers/OutlinerHeader.jsx](../../src/v3/headers/OutlinerHeader.jsx)) — lifted from in-body. State source-of-truth promoted to editorStore (`outlinerMode`, `outlinerSearchQuery`, `outlinerShowSelectedOnly`, `outlinerHideHidden`); both header and OutlinerEditor body subscribe independently. OutlinerEditor body simplified — no longer owns header chrome.
- **ViewportHeader** ([src/v3/headers/ViewportHeader.jsx](../../src/v3/headers/ViewportHeader.jsx)) — new starter scaffold. Mode label (read-only mirror of `editorStore.editMode`) + 3 menus:
  - **View** menu — Frame Selected (Period) [VIEW3D_MT_view analog]
  - **Select** menu — All / None / Box / Circle / Toggle Visibility [VIEW3D_MT_select_<mode>]
  - **Object** menu — Snap… / Mirror… / Parent Set / Parent Clear / Set Origin / Delete [VIEW3D_MT_object]
- All menu items dispatch through the existing operator registry — same code path as the keymap dispatcher, so menu + hotkey can never drift in semantics. Items dim via `op.available()`.

### F-7 deferred — `/` local-view keybind

The audit's `<1hr` estimate assumed an existing `view.localView` operator + a canvas rendering filter. Neither exists; per Rule №1 no stub operators that no-op. Deferred until the local-view rendering filter ships as a separate work thread.

## What's still open from the audit (not in this sweep)

| ID | Finding | Why deferred |
|----|---------|--------------|
| F-2 | Workspace count too aggressive (2 workspaces, no Modeling/Rigging differentiation) | UX direction call — needs user input on whether to expand to Modeling/Rigging/Weight Paint/Sculpt/Animation OR commit to the 2-workspace collapse + add Ctrl+PageUp/Down |
| F-5 | Editor type `'fcurve'` should be `'graph'` (Graph Editor) | Trivial rename; rolled in with the next UI commit |
| F-6 | Theme uses shadcn neutral palette, not Blender's `bTheme` (no Blender blue `#4772b3` for selection) | Visual identity call — design preference; do you want SS to LOOK like Blender or just BEHAVE like Blender? |
| F-7 | `/` local-view keybind | Needs canvas rendering filter (separate work thread) |
| F-8 | Constraint stack UI absent | Needs backing data layer first (Constraints datablock model in projectStore) |
| F-9 | Modal G/R/S numeric input + axis-lock chord verification | Audit-only finding — needs deep-dive on `ModalTransformOverlay.jsx` to confirm whether the chord set is already complete |

Follow-on F-1 work (next UI sweep):
- Lift ModePill into a shared ModeSelector subcomponent so it can mount BOTH in the canvas overlay AND ViewportHeader's left chunk
- Add transform-orientation + snap pills to ViewportHeader's middle section
- Ship Properties / Timeline / Actions / NodeTree / FCurve / Dopesheet headers using the same registry slot

## Memory updates this session

- **UPDATED** `feedback_question_agents_not_user.md` (Rule №3) — added priority/scheduling forks to the "go through agents" rubric (clarified after the user invoked it on a 3-way resume-path question).

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty fixes)
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no migration baggage)
- `feedback_question_agents_not_user.md` — Rule №3 (question agents, not user)
- `feedback_test_character_is_shelby.md` — dual-PSD policy
- `project_blender_parity_plans_in_flight.md` — anchor memory
- `project_loading_times_instrumentation.md` — Stage 0 + 0.B baselines from prior session
- `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` — Phase 2 substrate plan (Slices 2.A–2.H)
- `docs/plans/SESSION_CLOSEOUT_2026_05_12_PHASE_1G_GATE_CLOSED.md` — predecessor (Phase 1.G dual-PSD gate close)

## Test scoreboard

- TSC clean across all 5 commits.
- Full suite via Node wrapper (Windows command-line length workaround): 261/261 scripts green at HEAD.
- Notable script results:
  - `test:fcurveEval` (NEW): 35 passed — Slice 2.C bezier inversion + 30 easings against closed-form expected values.
  - `test:migrationV39` (NEW): 43 passed — Slice 2.A round-trip migration coverage.
  - `test:animationEngine`: 61 passed (Slice 2.A + 2.C field-rename + named-easing assertions).
  - `test:animFCurveBridge`: 52 passed (Slice 2.A factory + buildParam/Node FCurve coverage).
  - `test:editorStore`: 87 passed (F-1 lifted outliner state + F-3 propertiesActiveTab default).
  - `test:auditFixes20260512Phase1Stage1eD1Reresolution`: 62 passed (updated `'item'` → `'object'` literal assertion).

## Resume paths

After this session's two-thread ship, three threads are queued:

### A. Animation Phase 2 BezTriple — Slices 2.D / 2.G / 2.H

The natural continuation of this session's Phase 2 work. Slice 2.D (`fcurveHandles.js` auto-handle calculator) is the next prerequisite for the Phase 5 editor UI; Slice 2.G + 2.G.1 unblock Cubism `.motion3.json` round-trip fidelity; Slice 2.H is the 6-sample byte-diff exit gate.

### B. UI sweep F-1 follow-on commits

- Lift ModePill into shared ModeSelector
- Properties / Timeline / Actions / NodeTree / FCurve / Dopesheet headers
- Add menu (needs node-creation operators per audit F-8)

### C. Audit deferred items needing user input

- F-2 (workspace direction)
- F-6 (theme — Blender visual identity vs just structure?)
- F-8 (constraint stack — start the data-layer build?)
