# Session Close-out — 2026-05-10 (Phase 6 sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_10_PHASE5.md](./SESSION_CLOSEOUT_2026_05_10_PHASE5.md).
Earlier sub-sessions today: Animation Phase 0 (5/6 + armature port),
Toolset Phases 0/1/2/3/4/5, five audit-fix sweeps. This sub-session
shipped Toolset **Phase 6 + Phase 6 audit-fix sweep** (sixth audit
sweep of the day). Branch ahead of `origin/master` by 20 commits at
HEAD `930700a`.

## What shipped this sub-session (2 commits)

### Toolset Blender-Parity Plan — Phase 6 + audit-fix

Cluster of small Blender-parity wins per
[TOOLSET_BLENDER_PARITY_PLAN.md §Phase 6](./TOOLSET_BLENDER_PARITY_PLAN.md):

| Commit  | What |
|---------|------|
| `f44a1b0` | Phase 6 initial — Select Linked (`L` cursor + `Ctrl+L` expand), Edit-Mode + Object-Mode Duplicate (`Shift+D`), Apply menu popover (`Ctrl+A` → Pose As Rest + Armature Modifier), Circle Select (`C` cursor-circle paint + Shift+LMB subtract). 5 new operators in `select/linked.js` + `edit/duplicate.js`; new `circleSelectStore` + `CircleSelectOverlay`; new `ApplyMenu` sister to `MergeMenu`; `editMenuStore` extended for `kind: 'apply'`; `verticesInCircle` + `partsInCircle` added to `hitTest.js`. 5 test suites, 130 assertions. |
| `930700a` | Phase 6 audit-fix sweep — 4 HIGH (G-1 async exec, D-1 wheel direction, D-2 Shift+L deselect, D-3 delimit doc) + 9 MED + 7 LOW gaps closed. 7 DOCUMENT-AS-DEVIATION (Rule №1). 1 new test suite pinning all 12 FIXes + 7 banners (64 assertions). |

## Audit-fix sweep details (`930700a`)

Full per-gap details in
[TOOLSET_PHASE_6_PROGRESS.md](./TOOLSET_PHASE_6_PROGRESS.md)
§"Audit-fix sweep details". Headlines:

### Architecture HIGH

- **G-1** — `apply.armatureModifier` exec was `async` because the
  service was lazy-imported via `await import(...)`. The dispatcher
  fires `op.exec(...)` without `await`, so any error after the await
  was an unhandled rejection invisible to the user. Fix: eager-import
  the service so exec is synchronous. Bundle weight cost is null —
  `CanvasViewport` already pulls in the service's transitive deps.

### Architecture MED

- **G-2** — `apply.poseAsRest.available()` now refuses op when
  `editor.editMode === 'animation'`. Pre-fix `Ctrl+A` at non-zero
  scrubber position baked motion3.json offsets into rest. Combined
  with G-6 (no undo), this was a silent permanent-corruption path
  reachable from the default keymap.
- **G-3** — `CircleSelectOverlay` caches `worldMatrices` across paint
  ticks via useRef. Pre-fix per-mousemove `computeWorldMatrices()`
  burned ~30 ms / sec on 200-node projects.
- **G-4** + **G-5** — Catch-all `stopPropagation()` in `onKeyDown` +
  added `stopPropagation()` to `onContextMenu`. Pre-fix operator
  chords + bubble-phase context-menu listeners leaked through.

### Architecture LOW

- **G-6** — `apply.poseAsRest` wrapped in `beginBatch`/`endBatch` so
  Ctrl+Z reverses the bake.
- **G-7** — `apply.armatureModifier` per-part loop wrapped in batch
  so N-part bake = ONE undo entry.
- **G-8** — `clientToCanvas` extracted to
  `src/v3/editors/viewport/viewportMath.js` — three identical
  implementations collapsed to one shared helper.

### Blender-fidelity HIGH

- **D-1 (FIX)** — Circle Select wheel direction was inverted. Pre-fix
  wheel-up grew the circle; Blender's `View3D Gesture Circle` modal
  binds `WHEELUPMOUSE = SUBTRACT` (shrink). Both the JSDoc claim
  ("Blender convention: wheel up = larger radius") AND the
  implementation were wrong. Flipped.
- **D-2 (FIX)** — `Shift+L` deselect-linked-cursor variant added.
  Pre-fix only `L` (select) was bound; Blender binds the same operator
  to both chords with an RNA `deselect=False/True` arg.
- **D-3 (DOCUMENT-AS-DEVIATION)** — `MESH_OT_select_linked` `delimit`
  enum (UV/SEAM/SHARP/NORMAL/MATERIAL) has no analogue in Live2D's
  data model.

### Blender-fidelity MED

- **D-4 (DOC)** — Cursor hit-test is vert-only (no edge/face select).
- **D-5 (FIX)** — MMB-down on Circle Select starts subtract paint.
- **D-6 (DOC)** — Cross-mode atomic-vs-non-atomic Duplicate divergence
  (Edit atomic per Phase 5 D-1; Object non-atomic per Blender macro).
- **D-7 (DOC)** — Apply menu coverage gap (2 items vs Blender's 13+3);
  most missing items out-of-scope for Live2D data model.
- **D-8 (DOC)** — bare `C` mid-modal off-toggle is SS-only.

### Blender-fidelity LOW

- **D-9 / D-10 / D-11 (FIX)** — Source citation drift corrected
  throughout: `linked.js` (was `:5070+` unrelated; now `:4503-4536` +
  `:4467-4501` + `:4383-4465` + `:4226-4253`),
  `CircleSelectOverlay.jsx` (was `:3470+` grease-pencil; now
  `view3d_select.cc:5706-5725` + `wm_gesture_ops.cc:349-447`),
  `ApplyMenu.jsx` (was invented `OBJECT_MT_object_apply` + wrong
  `:6280+`; now `VIEW3D_MT_object_apply` + `:3193-3258` and
  `VIEW3D_MT_pose_apply` + `:4393-4406`).
- **D-12 (DOC)** — `Ctrl+L` Object Mode no-op vs Blender's Make Links
  menu — documented; defer until Make Links operator ships.

Audit docs on disk:
- [AUDIT_2026_05_10_TOOLSET_PHASE6_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE6_ARCH.md) — 8 gaps (1 HIGH, 4 MED, 3 LOW)
- [AUDIT_2026_05_10_TOOLSET_PHASE6_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE6_BLENDER.md) — 12 gaps (3 HIGH, 5 MED, 4 LOW)

## Test scoreboard

All 6 Phase 6 suites green; all adjacent suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_selectLinked_cursor`                                          | 22  |
| `test_selectLinked_fromSelection`                                   | 17  |
| `test_duplicate_edit`                                               | 38  |
| `test_circle_select_helpers`                                        | 25  |
| `test_apply_menu_store`                                             | 28  |
| **`test_audit_fixes_2026_05_10_phase6` (NEW — pins 4 HIGH + 16 MED/LOW)** | **64** |
| **Phase 6 total post-audit-fix**                                    | **194** |
| undoHistory (regression-checked across batched ApplyOps)            | 22  |
| topology_op_selection_remap (sister)                                | 19  |
| audit_fixes_2026_05_10_phase5                                       | 26  |
| audit_fixes_2026_05_10_phase4                                       | 18  |
| hitTest (verticesInCircle / partsInCircle additions)                | 35  |
| editorStore                                                         | 87  |
| boxSelect_objectMode (sister overlay pattern)                       | 13  |
| proportionalEdit (sister buildVertexAdjacency consumer)             | 52  |

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged from previous close-outs. The depgraph is coherent; the Phase
0.D flag flip is gated only on the user-side manual byte-fidelity
sweep on Shelby + test_image4 PSDs.

### B. Toolset Phase 2.G + 3.J + 4.J + 5.E + 6.F manual gates

Phases 2 + 3 + 4 + 5 + 6 are fully shipped + audit-fixed. Browser-side
smoke tests remain.

**Phase 6.F highlights** (full checklist in
[TOOLSET_PHASE_6_PROGRESS.md](./TOOLSET_PHASE_6_PROGRESS.md)
§"Manual gate"):

- Select Linked: hover Hiyori's eye in Edit Mode, press L → eye verts
  light up. Ctrl+L expands current selection to full components.
  Shift+L deselects the linked region under the cursor (audit fix D-2).
- Duplicate Object Mode: Shift+D → new copy + Modal G; Esc keeps dup,
  Ctrl+Z removes it (Blender macro semantics).
- Duplicate Edit Mode: select 3 boundary verts forming a tri, Shift+D
  → 3 dups + 1 cloned tri + Modal G; Esc rolls back BOTH (atomic per
  Phase 5 D-1 deviation pattern).
- Apply menu: Ctrl+A in Pose Mode → menu lists "Pose As Rest"; click
  → bone pose zeroed, rest absorbs. (Audit fix G-2: refuses in
  animation mode now.) Ctrl+Z reverses the bake (audit fix G-6).
- Circle Select: C → cursor circle. Mouse-wheel: SHRINKS on wheel-up,
  GROWS on wheel-down (audit fix D-1 — was inverted). LMB-paint adds;
  Shift+LMB AND MMB-paint both subtract (audit fix D-5).

### C. Toolset Phase 7 — Per-mode tool completion (1.5–2 weeks)

Next autonomous chunk per plan. Three mode-scoped clusters:

- 7.A — Object Mode tools: Snap menu (Shift+S), Mirror selected
  (Ctrl+M then X/Y/Z), Parent (Ctrl+P), Clear Parent (Alt+P), Set
  Origin.
- 7.B — Weight Paint tools: Sample Weight (Ctrl+LMB), Blur brush,
  Mirror Weights, X-Axis Mirror toggle, Normalize All.
- 7.C — Pose Mode tools: Clear Pose Location (Alt+G), Clear Pose
  Rotation (Alt+R), Clear Pose Scale (Alt+S), Clear All Pose
  (Alt+Shift+R), Select Mirror (Ctrl+Shift+M), Mirror Pose
  (Ctrl+Shift+V), Copy/Paste Pose (Ctrl+C/V).

⚠️ **Hotkey collision flagged for Phase 7**: `Shift+S` (Snap menu) +
`Ctrl+N` (Normalize All) both have prior bindings in SS — the
collisions are documented in plan §8 but need re-examination before
Phase 7 ships.

### D. Manual browser gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E + 6.F (still pending user)

Seven manual gates queued. Should be verified before further phases ship.

## Hotkey reservations across both plans

Phase 6 added `KeyL`, `Shift+KeyL`, `Ctrl+KeyL`/`Meta+KeyL`,
`Shift+KeyD`, `Ctrl+KeyA`/`Meta+KeyA`, `KeyC`. No new collisions.

- `I` = Insert Keyframe (animation Phase 6)
- `B` = Box Select (toolset Phase 1) ✅ shipped
- `C` = Circle Select (toolset Phase 6) ✅ shipped
- `M` = Merge menu (toolset Phase 4) ✅ shipped
- `Ctrl+X` = Dissolve Vertices (toolset Phase 4) ✅ shipped
- `E` = Extrude (toolset Phase 5) ✅ shipped
- `L` = Select Linked (cursor) (toolset Phase 6) ✅ shipped
- `Shift+L` = Deselect Linked (cursor) (toolset Phase 6 audit-fix D-2) ✅ shipped
- `Ctrl+L` / `Meta+L` = Select Linked (expand selection) (toolset Phase 6) ✅ shipped
  - Object Mode: silently no-ops; Blender opens VIEW3D_MT_make_links there. (D-12 deferred)
- `Shift+D` = Duplicate (toolset Phase 6) ✅ shipped
- `Ctrl+A` / `Meta+A` = Apply menu (toolset Phase 6) ✅ shipped
- `Shift+X` = Sample Weight (toolset Phase 7.B)
- `Ctrl+Shift+M` = Pose select-mirror (Blender-faithful)
- `Ctrl+Shift+V` = Mirror Pose (paste-flipped, Blender-faithful)
- `Ctrl+N` NOT bound to Normalize All — collides with Blender File New;
  Phase 7 will need to revisit
- `Alt+Shift+G/R/S` = Clear All Pose per-axis (3 separate chords)
- ⚠️ `Shift+S` reserved for Phase 7.A toolbox — collides with
  Blender's `VIEW3D_MT_snap_pie`; revisit binding before Phase 7 ships

## Day-end commit chain (24 commits across six sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| 1     | `ec5d7d3` | anim 0.A — gridLift / depgraph build-relation fix |
| 2     | `ad7f26a` | anim 0.B — driver pass wired into CanvasViewport tick |
| 3     | `0386a6a` | anim 0.C — TRANSFORM_COMPOSE op |
| 4     | `c8f86f3` | anim 0.D.0 — depgraph wired into CanvasViewport rAF |
| 5     | `bc8a875` | anim 0.D armature port — bone post-chain inside ART_MESH_EVAL |
| 6     | `10ecaa8` | docs(plan) — Phase 0 close-out |
| 7     | `4a59d62` | toolset Phase 0 — vertex selection model in Edit Mode |
| 8     | `f7fba11` | toolset Phase 1 — box / lasso select |
| 9     | `ee2b1c5` | audit-fix sweep #1 — 6 HIGH + 2 MED + doc-drift |
| 10    | `6a8b5d3` | session close-out (mid-day) |
| 11    | `5b81205` | toolset Phase 2 — snap during transform (initial) |
| 12    | `980da3e` | audit-fix sweep #2 — Phase 2 dual audit (5 HIGH + 4 MED) |
| 13    | `9c3a906` | docs(plan) — Phase 2 sub-session close-out |
| 14    | `fa17a46` | toolset Phase 3 — Sculpt Mode + 3 brushes |
| 15    | `22a128b` | audit-fix sweep #3 — Phase 3 dual audit (7 HIGH + 12 MED/LOW) |
| 16    | `fa95979` | docs(plan) — Phase 3 sub-session close-out |
| 17    | `438f58e` | sister fix — matchTag local import after armatureMeta split |
| 18    | `428bcdf` | toolset Phase 4 — Merge / Dissolve / Subdivide |
| 19    | `4347926` | audit-fix sweep #4 — Phase 4 dual audit (5 HIGH + 9 MED + 5 LOW) |
| 20    | `b0596ac` | docs(plan) — Phase 4 sub-session close-out |
| 21    | `ea590ac` | toolset Phase 5 — Extrude operator + vertex-mode modal G |
| 22    | `6063b2c` | audit-fix sweep #5 — Phase 5 dual audit (2 HIGH + 8 MED/LOW) |
| 23    | `a49ee78` | docs(plan) — Phase 5 sub-session close-out |
| 24    | `f44a1b0` | toolset Phase 6 — Select Linked / Duplicate / Apply / Circle |
| 25    | `930700a` | audit-fix sweep #6 — Phase 6 dual audit (4 HIGH + 9 MED + 7 LOW) |
