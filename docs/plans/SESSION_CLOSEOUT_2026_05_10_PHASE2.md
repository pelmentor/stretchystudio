# Session Close-out — 2026-05-10 (Phase 2 sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_10.md](./SESSION_CLOSEOUT_2026_05_10.md).
Earlier-day work: Animation Phase 0 (5/6 + armature port), Toolset
Phase 0 + Phase 1, first audit-fix sweep. This sub-session shipped
Toolset **Phase 2 + Phase 2 audit-fix sweep**. Branch clean at
`980da3e`.

## What shipped this sub-session (2 commits)

### Toolset Blender-Parity Plan — Phase 2 + audit-fix

Snap during transform — Blender-faithful gesture vocabulary:

| Commit  | What |
|---------|------|
| `5b81205` | Phase 2 initial — `preferencesStore.snap`, `lib/snap/{snapMath,snapHash,index}.js`, ModalTransformOverlay wiring (G/R/S), N-panel SnapSection, 4 test files (80 assertions). |
| `980da3e` | Phase 2 audit-fix sweep — 5 HIGH + 4 MED gaps closed across architecture + Blender-fidelity audits. Gesture model redesigned. 5th test suite (gesture-model integration), 133 total assertions. |

## Audit-fix sweep details (`980da3e`)

Two independent agents (architecture + Blender-fidelity) audited
`5b81205` and surfaced 11+9 = 20 gaps. All HIGH addressed.

### Architecture HIGH

- **G-1 (CRASH)** — Modal G/R/S crashed on first mousemove with
  `TypeError: cannot read 'zoom' of undefined`. The `view` slot was
  renamed to `viewByMode.viewport` in commit `86b2e43` (year-old
  rework); modal G/R/S have been silently broken since BVR-005, Phase
  2 just expanded the surface (also reading `view.panX/Y`). Fixed all
  2 callsites at [ModalTransformOverlay.jsx:106, 401](../../src/v3/shell/ModalTransformOverlay.jsx).
- **G-2** — Object Mode snap-to-vertex didn't exclude the dragged
  part's own verts → modal "stuck" at start. Fixed by passing
  `excludePartId` to `buildSnapHash` when single-node Object Mode
  selection.

### Blender-fidelity HIGH

- **D-1+D-2+D-7** — Gesture vocab redesigned to match Blender. Master
  `enabled` is the magnet (ON = snap auto-engages). Shift =
  `MOD_PRECISION` (per-mode `precision` slot when snap on; ×0.1 free
  transform when off). Ctrl = `MOD_SNAP_INV` (XOR'd against master so
  user can flip mid-drag; `onKeyDown`/`onKeyUp` re-fire applyDelta on
  Ctrl/Shift change). SS pre-Phase-2 "Shift = engage 10px snap"
  hardcode removed (it was an SS reinvention, not a Blender port).
- **D-3** — `Closest` target was implemented backwards. SS treated it
  as "the cursor IS the anchor"; Blender's `SCE_SNAP_SOURCE_CLOSEST`
  (`transform_snap.cc:1481-1588`) finds the selection vertex / bbox
  corner geometrically NEAREST the snap target. Fixed via new
  `pickSelectionAnchor` + `enumerateSelectionAnchorVerts` helpers.
- **D-4** — Snap-to-vertex hash was built over rest verts; in Pose
  Mode the user sees the deformed mesh, so the magenta dot appeared
  50+ px from the visible vertex. Fixed by routing the hash through
  `getCanvasHitContext().frames.finalVerts` when `editMode === 'pose'`.
- **D-5** — Default rotation increment 15° → 5° + precision 1°
  (matches Blender 1:1 per `DNA_scene_types.h:2430`).

### MED

- **G-3+G-4** — **Mooted** by no-cache redesign. Module-level
  snap-hash cache dropped in favour of per-modal-mount build (~1ms;
  eliminates 5+ invalidation hook callsites that the audit flagged at
  `applyPoseAsRest` + `resetToRestPose`).
- **G-6** — Modal cleanup return now clears the snap target.
- **G-8** — N-panel Increment row labels both rotation step and
  derived scale step (`°R · ×0.05S`) so editing the value doesn't
  silently change scale behaviour.
- **D-6 + plan doc claims** — Fabricated "Blender's default" claims
  scrubbed from `preferencesStore.js` jsdoc, plan §2.A/D, and progress
  doc. Honest SS-choice notes (e.g. 16-px grid is a SS pick).

### Deliberately deferred (LOW, per Rule №1 — proper or nothing)

- **G-9** — `excludeVertSet` rename (no live callers after redesign;
  passes through unused).
- **G-10** — N-panel master-off should disable per-row checkboxes via
  `pointer-events-none` not just opacity. Cosmetic.
- **G-11** — Per-tick `clearSnapTarget` guard. Already harmless via
  Object.is on Zustand selector.
- **D-8** — Phase 7.A `Shift+S` reservation collides with Blender's
  Snap Pie Menu. Phase 7 problem to fix when Phase 7 ships.
- **D-9** — Snap visualization polish (single magenta dot is
  minimal-viable; Blender shows source dot + target circle + line +
  per-type color). Defer.

## Audit docs on disk

- [AUDIT_2026_05_10_TOOLSET_PHASE2_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE2_ARCH.md) — 11 gaps, 2 HIGH addressed
- [AUDIT_2026_05_10_TOOLSET_PHASE2_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE2_BLENDER.md) — 9 divergences, 5 HIGH addressed

## Test scoreboard

All 5 snap suites green; all adjacent suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| snap_grid_translate | 16 |
| snap_rotation_increment (incl. 3 precision helpers) | 44 |
| snap_target_modes (incl. enumerateSelectionAnchorVerts) | 32 |
| snap_vertex_threshold (incl. frames + excludePartId) | 23 |
| **snap_gesture_model (NEW)** — full master×Shift×Ctrl matrix | 18 |
| **Phase 2 total** | **133** |
| editorStore | 87 |
| preferencesStore | 49 |
| hitTest | 35 |
| selectionStore | 23 |
| modalTransformTyped | 11 |
| applyPoseAsRest | 25 |
| audit_fixes_2026_05_10 | 23 |
| proportionalEdit | 52 |
| vertexSelection_basic | 28 |
| vertexSelection_invalidation | 9 |
| boxSelect_objectMode | 13 |
| lassoSelect_modifiers | 19 |

Pre-existing `test_armatureOrganizer.mjs` ReferenceError (`matchTag is
not defined` at line 640) is still unrelated to today's work —
reproduces on clean master.

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged from previous close-out. The depgraph is coherent
post-audit-fix #1; the Phase 0.D flag flip is gated only on the
user-side manual byte-fidelity sweep on Shelby + test_image4 PSDs.

1. Toggle `preferencesStore.evalEngine = 'depgraph'` in app.
2. Load `shelby_neutral_ok.psd` + `test_image4.psd`.
3. Verify visually + export `.cmo3` and byte-diff against `'classic'`
   baseline.
4. Flip [preferencesStore.js:163](../../src/store/preferencesStore.js#L163)
   default `'classic'` → `'depgraph'`. Keep classic opt-out one
   release.

### B. Toolset Phase 2.G manual gate (user-blocking)

Phase 2 is fully shipped + audit-fixed. The browser-side smoke test
remains:

- N-panel Snap section visible all 3 modes; master toggle persists
  across reload.
- Modal G with master OFF → free transform; Shift = 10× finer
  (precision).
- Modal G with master ON → snap fires when cursor near vertex;
  magenta dot lands on vertex; selection's nearest anchor (per
  `target` mode) lands on dot.
- Ctrl held mid-drag → snap toggles immediately (master ON↔OFF).
- Modal R + Shift with snap on + increment.enabled → 1° step
  (precision).
- Modal G in Pose Mode with master ON → magenta dot tracks visible
  deformed mesh, NOT rest geometry.

Full checklist in [TOOLSET_PHASE_2_PROGRESS.md](./TOOLSET_PHASE_2_PROGRESS.md)
§"Manual gate (Phase 2.G)".

### C. Toolset Phase 3 — Sculpt mode + brushes (~1 week)

Next autonomous chunk. New `editorStore.editMode = 'sculpt'` (already
legal in `modeCompat.js`) wired to T-panel brush list + N-panel brush
settings + 3 brushes (Grab / Smooth / Pinch). Reuses GAP-015's
`computeFalloffWeight` + `buildVertexAdjacency` from
`lib/proportionalEdit.js`. See [TOOLSET_BLENDER_PARITY_PLAN.md](./TOOLSET_BLENDER_PARITY_PLAN.md)
§Phase 3.

### D. Manual browser gates 0.H + 1.F (still pending user)

Should be verified before further phases ship. See
[TOOLSET_PHASE_0_PROGRESS.md](./TOOLSET_PHASE_0_PROGRESS.md) §Manual
gate (8 items) and [TOOLSET_PHASE_1_PROGRESS.md](./TOOLSET_PHASE_1_PROGRESS.md)
§Audit-driven follow-up.

## Hotkey reservations across both plans

Unchanged. Confirmed `Shift+S` collision for Phase 7.A flagged in
Blender audit (D-8) — to be re-bound when Phase 7 lands.

- `I` = Insert Keyframe (animation Phase 6)
- `B` = Box Select (toolset Phase 1) ✅ shipped
- `C` = Circle Select (toolset Phase 6)
- `Shift+X` = Sample Weight (toolset Phase 7.B)
- `Ctrl+Shift+M` = Pose select-mirror (Blender-faithful)
- `Ctrl+Shift+V` = Mirror Pose (paste-flipped, Blender-faithful)
- `Ctrl+N` NOT bound (collides with Blender File New)
- `Alt+Shift+G/R/S` = Clear All Pose per-axis (3 separate chords,
  Blender-faithful)
- ⚠️ `Shift+S` reserved for Phase 7.A toolbox — collides with
  Blender's `VIEW3D_MT_snap_pie`; revisit binding before Phase 7
  ships

## Day-end commit chain (12 commits across two sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| 1 | `ec5d7d3` | anim 0.A — gridLift / depgraph build-relation fix |
| 2 | `ad7f26a` | anim 0.B — driver pass wired into CanvasViewport tick |
| 3 | `0386a6a` | anim 0.C — TRANSFORM_COMPOSE op |
| 4 | `c8f86f3` | anim 0.D.0 — depgraph wired into CanvasViewport rAF |
| 5 | `bc8a875` | anim 0.D armature port — bone post-chain inside ART_MESH_EVAL |
| 6 | `10ecaa8` | docs(plan) — Phase 0 close-out |
| 7 | `4a59d62` | toolset Phase 0 — vertex selection model in Edit Mode |
| 8 | `f7fba11` | toolset Phase 1 — box / lasso select |
| 9 | `ee2b1c5` | audit-fix sweep #1 — 6 HIGH + 2 MED + doc-drift |
| 10 | `6a8b5d3` | session close-out (mid-day) |
| 11 | `5b81205` | toolset Phase 2 — snap during transform (initial) |
| 12 | `980da3e` | audit-fix sweep #2 — Phase 2 dual audit (5 HIGH + 4 MED) |
