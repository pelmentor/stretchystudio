# Toolset Plan — Phase 6 Progress (Select Linked / Duplicate / Apply / Circle)

- Initial Phase 6 commit: `f44a1b0`
- Audit-fix sweep: `930700a`

Status: BASE + AUDIT-FIX SHIPPED. Manual gate (Phase 6.F) is browser-side.

## What landed

Per [TOOLSET_BLENDER_PARITY_PLAN.md §Phase 6](./TOOLSET_BLENDER_PARITY_PLAN.md):

### 6.A — Select Linked (`src/v3/operators/select/linked.js`)

Two pure functions. Both BFS over the existing
`buildVertexAdjacency` from `src/io/hitTest.js` (each triangle contributes
three pairwise edges):

- `selectLinkedFromVertex(mesh, originIdx)` → `Set<vertIdx>` — flood-fill
  from one seed. Mirrors Blender's `MESH_OT_select_linked_pick`
  (`editmesh_select.cc:5070+`). Operator binding uses
  `hitTestVertices` to find the nearest vert under the cursor at
  16-px screen-radius (zoom-adjusted), then runs the flood-fill.
- `selectLinkedExpandSelection(mesh, currentSel)` → `Set<vertIdx>` —
  expand each seed to its connected component. Mirrors Blender's
  `MESH_OT_select_linked` (`editmesh_select.cc:5188+`). Single shared
  visited set keeps complexity at O(V + E) regardless of input size.

Tri-storage shape handled via `extractTriangleIndices` helper (accepts
both flat `[i,j,k,i,j,k,…]` and nested `[[i,j,k],[i,j,k]]`). No
degenerate-tri filter — Blender's `select_linked_walk` doesn't filter
by area either, and a zero-area seam triangle still pins its three
verts together topologically.

### 6.B — Duplicate (`src/v3/operators/edit/duplicate.js` + registry dispatch)

Mode-aware via `editor.editMode`:

**Edit Mode** — pure topology op `duplicate(mesh, sel)` that returns a
`TopologyOpResult`:
1. Duplicate every selected vertex (positions + rest + UV copied).
2. Clone every triangle whose ALL THREE verts are in selection (matches
   Blender's BMOP `bmo_dupe.cc:240+` — partial triangles NOT cloned to
   avoid manifold seams).
3. Return `selectionOverride = {dup verts}` so the dispatcher selects
   the new ring wholesale.
4. Hand off to Modal G with `rollbackOnCancel: true` (atomic — Esc
   rolls back BOTH the topology change AND the drag, same pattern as
   Phase 5 extrude D-1 deviation).

**Object Mode** — recursive `duplicateNode(id) × N` (existing
projectStore action), then snapshot post-dup node ids by diff, filter
to "root" duplicates (those whose parent isn't itself a fresh dup), set
selection, hand off to `beginModalTransform('translate')`. **Non-atomic**
per Blender's `OBJECT_OT_duplicate_move` macro: Esc-mid-translate keeps
the dups, drops just the drag (user Ctrl+Z to remove the dup).

Inconsistency between Edit Mode (atomic) and Object Mode (non-atomic) is
deliberate: Edit Mode inherits Phase 5's atomic pattern; Object Mode
matches Blender's macro semantics. Audit will surface whether to align.

### 6.C — Apply menu (`src/v3/shell/ApplyMenu.jsx` + 3 operators)

Sister popover to `MergeMenu`. `editMenuStore` extended with
`kind: 'apply'` + `openApply(...)` action; same `cursor` anchor + same
Esc / outside-click close pattern.

Menu items (registered as `apply.*` operators):
- **Apply Pose As Rest** — wraps existing
  `useProjectStore.getState().applyPoseAsRest()`. Available iff project
  has any bone-role group.
- **Apply Armature Modifier** — async (lazy-imports
  `services/ArmatureModifierService.js`). Iterates selected parts with
  armature modifiers, calls the existing `applyArmatureModifier(partId)`
  per. Toasts a count summary.

Items deferred per plan §6.C: Apply Visual Transform (no separate
visual / local transform stack in SS — `node.transform` IS the visual
transform). Other Blender Apply items (Location / Rotation / Scale /
All Transforms / Make Instances Real / Visual Geometry to Mesh) are
also deferred — to be added once the use-cases land.

### 6.D — Circle Select (`circleSelectStore` + `CircleSelectOverlay`)

New modal store + overlay following the `boxSelectStore` /
`BoxSelectOverlay` pattern.

Modal behaviour:
- LMB-down → start paint stroke (default `add`; Shift+LMB-down →
  `subtract` — stroke mode captured at down-time)
- Mousemove while painting → call `runPaintTick` to pick verts
  (Edit Mode) or parts (Object Mode) under the circle, apply per stroke
  mode
- LMB-up → end stroke; modal stays active for further strokes
- Mousewheel → adjust radius (4-px steps; clamped [4, 512] in store)
- Esc / RMB / Enter / bare `C` → exit modal (per Blender's "press C
  again to toggle off")

Hit-test helpers added to `src/io/hitTest.js`:
- `verticesInCircle(verts, cx, cy, r)` → `number[]` ascending order;
  flat OR object-shape verts; boundary-inclusive
- `partsInCircle(project, frames, cx, cy, r, opts)` → `string[]` part
  ids whose AABB intersects the circle. Closest-point-on-AABB-to-center
  trick. Honours `node.visible !== false`.

Edit Mode hit-test projects the cursor circle through the part's inverse
world matrix to mesh-local space (so the radius scales with the part's
transform, matching click hit-test). Local radius approximated by
geometric mean of inverse-world-matrix column lengths (handles non-
uniform scale).

### Hotkey

- `KeyL` — Select Linked (cursor)
- `Ctrl+KeyL` / `Meta+KeyL` — Select Linked (expand selection)
- `Shift+KeyD` — Duplicate (mode-aware)
- `Ctrl+KeyA` / `Meta+KeyA` — Apply popover
- `KeyC` — Circle Select

All NEW in this phase. No collisions with prior phases.

### Tests (6 suites post-audit-fix, 194 assertions)

| Test | Assertions |
|------|------------|
| `test_selectLinked_cursor.mjs`                    | 22  |
| `test_selectLinked_fromSelection.mjs`             | 17  |
| `test_duplicate_edit.mjs`                         | 38  |
| `test_circle_select_helpers.mjs`                  | 25  |
| `test_apply_menu_store.mjs`                       | 28  |
| **`test_audit_fixes_2026_05_10_phase6.mjs` (NEW — pins all 12 FIXes + 7 banners)** | **64** |
| **Phase 6 total post-audit-fix**                  | **194** |

Sister suites verified green: `undoHistory` (22), `topologyOpSelectionRemap` (19),
`hitTest` (35), `editorStore` (87), `proportionalEdit` (52), `boxSelect`
object/edit modes (13+13), Phase 4 + Phase 5 audit-fix suites. Typecheck
clean.

## Audit-fix sweep details (`930700a`)

Two independent agents (architecture + Blender-fidelity) audited
`f44a1b0`. 20 gaps total (4 HIGH, 9 MED, 7 LOW). 13 FIX, 7
DOCUMENT-AS-DEVIATION per Rule №1.

### Architecture HIGH (FIX)

- **G-1** — `apply.armatureModifier` exec was declared `async`. The
  dispatcher fires `op.exec(...)` without `await`; any throw after
  `await import('../../services/ArmatureModifierService.js')` was an
  unhandled rejection invisible to the user. Fix: eager-import the
  service so exec is sync. Bundle-weight cost is null (the service's
  transitive imports are already pulled in by `CanvasViewport`).

### Architecture MED (FIX)

- **G-2** — `apply.poseAsRest.available()` now refuses op when
  `editor.editMode === 'animation'`. Pre-fix `Ctrl+A` at a non-zero
  scrubber position baked motion3.json offsets into rest, silently
  corrupting rest geometry. Combined with G-6 (no undo), this was a
  data-loss path reachable from the default keymap. Legacy UI button
  had this guard at [CanvasViewport.jsx:3531-3534](../../src/components/canvas/CanvasViewport.jsx#L3531-L3534).
- **G-3** — `CircleSelectOverlay.runPaintTick` caches `worldMatrices`
  + cached project ref across paint ticks. Pre-fix `computeWorldMatrices`
  ran every mousemove (~60 Hz × 200-node project = ~30 ms jank/sec).
  Refs populated at `startPaint`, cleared at `endPaint`. Same
  closest-point-on-AABB hit-test path otherwise.
- **G-4** — `CircleSelectOverlay.onKeyDown` catch-all
  `e.stopPropagation()` at the bottom. Pre-fix G/E/R/S/B/M leaked
  through the capture-phase listener to the dispatcher's bubble-phase
  listener and mounted nested modals on top of the active circle
  select. Same pattern as Phase 5 G-3/G-4.
- **G-5** — `onContextMenu` now calls `e.stopPropagation()`. Pre-fix
  every sibling handler (`onMouseDown`/`onMouseUp`/`onWheel`) had it;
  this one was missed. Bubble-phase right-click listeners would fire
  after `cancel()` had closed the modal, seeing stale state.

### Architecture LOW (FIX)

- **G-6** — `apply.poseAsRest` exec wraps the call in
  `beginBatch`/`endBatch` so Ctrl+Z reverses the bake. Pre-fix the
  underlying `applyPoseAsRest()` action bypassed `pushSnapshot`
  entirely — Ctrl+Z post-Apply was a no-op. Pre-existing on the legacy
  UI button but Phase 6 made it reachable from a keymap chord.
- **G-7** — `apply.armatureModifier` per-part loop wrapped in batch so
  N-part bake = ONE undo entry. Pre-fix N-part bake was N undo entries.
  Matches Edit Mode duplicate's atomic batch pattern.
- **G-8** — `clientToCanvas` extracted to
  [src/v3/editors/viewport/viewportMath.js](../../src/v3/editors/viewport/viewportMath.js).
  Pre-fix three identical implementations (BoxSelectOverlay,
  CircleSelectOverlay, registry inner fn). All three now import from
  the shared helper; registry's wrapper still owns the DOM/store query.

### Blender-fidelity HIGH

- **D-1 (FIX)** — Circle Select wheel direction was INVERTED. Pre-fix
  `dir = e.deltaY < 0 ? +1 : -1` (wheel-up grew the circle). Blender's
  `View3D Gesture Circle` modal map binds `WHEELUPMOUSE = SUBTRACT`
  (shrink) and `WHEELDOWNMOUSE = ADD` (grow) per
  `blender_default.py:6241-6243` + `wm_gesture_ops.cc:383-390`. Both
  the JSDoc claim AND the implementation were wrong. Now wheel-up
  shrinks; wheel-down grows.
- **D-2 (FIX)** — `Shift+L` deselect-linked-cursor variant added.
  Pre-fix only `L` (select) was bound. New operator
  `select.linked.cursor.deselect` + `Shift+KeyL` chord; mirrors
  Blender's `RNA_def_boolean(ot->srna, "deselect", false, …)` on
  `MESH_OT_select_linked_pick` (`editmesh_select.cc:4520`). Subtracts
  the linked region from the current selection.
- **D-3 (DOCUMENT-AS-DEVIATION per Rule №1)** —
  `MESH_OT_select_linked` `delimit` enum-flag (UV/SEAM/SHARP/NORMAL/
  MATERIAL) has no analogue in Live2D's data model — no per-edge marks
  exist. Documented in `linked.js` banner with explicit cite of
  `select_linked_delimit_test`. Once a UV-seam concept lands
  (post-Phase 6+), revisit per-flag delimit support.

### Blender-fidelity MED

- **D-4 (DOCUMENT-AS-DEVIATION)** — Cursor hit-test is vert-only
  because SS has no edge / face select mode. `unified_findnearest`
  citation added to `linked.js`.
- **D-5 (FIX)** — MMB-down on Circle Select starts subtract paint
  stroke. Pen-tablet-friendly path that mirrors `MIDDLEMOUSE = DESELECT`
  at `blender_default.py:6239`.
- **D-6 (DOCUMENT-AS-DEVIATION)** — Edit Mode Duplicate is atomic
  (`rollbackOnCancel`); Object Mode Duplicate is non-atomic per Blender
  macro semantics. Cross-mode UX inconsistency documented as a
  deliberate trade-off (Phase 5 D-1 atomic deviation × Blender macro
  parity). Bringing Object Mode into the atomic camp would need
  `rollbackOnCancel` on `modalTransformStore`; deferred.
- **D-7 (DOCUMENT-AS-DEVIATION)** — Apply menu ships 2 items vs
  Blender's 13 (Object Mode) + 3 (Pose Mode). Most missing items are
  out-of-scope for Live2D data model (no Object axes; no derived
  geometry stack; no instance collections; no parent-transform stack
  for non-bones). Documented in `ApplyMenu.jsx` banner.
- **D-8 (DOCUMENT-AS-DEVIATION)** — bare `C` mid-modal off-toggle is
  SS-only (Blender's modal map has no `C` binding; user must Esc /
  RMB / Ret). Documented as deliberate UX addition.

### Blender-fidelity LOW (FIX)

- **D-9** — `linked.js` cites updated. Pre-fix cited
  `editmesh_select.cc:5070+` which is `bm_step_to_next_selected_vert_in_chain`
  (deselect-walker helper, unrelated). Now cites `:4503-4536`
  (`MESH_OT_select_linked_pick` def) + `:4467-4501` (exec) + `:4383-4465`
  (invoke, the cursor hit-test path) + `:4226-4253`
  (`MESH_OT_select_linked` def).
- **D-10** — `CircleSelectOverlay.jsx` cite updated. Pre-fix cited
  `view3d_select.cc:3470+` which is grease-pencil curves selection.
  Now cites `:5706-5725` (`VIEW3D_OT_select_circle` def) + `:5596-5704`
  (exec) + `wm_gesture_ops.cc:349-447` (modal lifecycle).
- **D-11** — `ApplyMenu.jsx` cite + class name corrected. Pre-fix
  cited `space_view3d.py:6280+` and an invented class name
  `OBJECT_MT_object_apply` (no such class in Blender — it's
  `VIEW3D_MT_object_apply`). Now cites `:3193-3258` (object_apply) +
  `:4393-4406` (pose_apply) + `blender_default.py:4529, :4648` for
  the keymap bindings.

### Blender-fidelity LOW (DOCUMENT-AS-DEVIATION)

- **D-12** — `Ctrl+L` Object Mode silently no-ops in SS; Blender's
  `Ctrl+L` opens `VIEW3D_MT_make_links` (Link Object Data / Materials /
  Animation / Collection / Modifiers etc.). Make Links isn't a Phase 6
  feature; documented in keymap doc-comment. When Make Links lands
  (post-Phase 6+), bind it as the Object-Mode branch of `Ctrl+L`.

Audit docs on disk:
- [AUDIT_2026_05_10_TOOLSET_PHASE6_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE6_ARCH.md) (8 gaps, 1 HIGH FIXED, 4 MED, 3 LOW)
- [AUDIT_2026_05_10_TOOLSET_PHASE6_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE6_BLENDER.md) (12 gaps, 3 HIGH (2 FIX + 1 DOC), 5 MED, 4 LOW)

## Manual gate (Phase 6.F) — browser-side

- **Select Linked**: hover over Hiyori's eye in Edit Mode. Press L.
  → Eye verts (one connected component) highlight.
  - With multi-vert selection across 2 components, press Ctrl+L.
  → Both components fully expand.
- **Duplicate (Object Mode)**: select Hiyori's hair part, Shift+D.
  → New "Hair Copy" appears, Modal G enters. Drag, click → commits.
  - Press Esc-mid-drag → drag rolled back, dup remains (per Blender
    macro). Ctrl+Z → dup removed.
- **Duplicate (Edit Mode)**: select 3 boundary verts forming a tri
  in Hiyori's hair. Shift+D.
  → 3 dups + 1 cloned tri appear; Modal G enters with override
  selection = the dups.
  - Drag, click → commits. Ctrl+Z → entire dup undone (one entry).
  - Press Esc-mid-drag → topology + drag both rolled back (atomic per
    rollbackOnCancel).
- **Apply menu**: with bone selected in Pose Mode, press Ctrl+A.
  → Apply popover at cursor; click "Pose As Rest" → bone pose zeroed,
  rest absorbs the pose, toast confirms.
  - With armature-modifier'd part selected in Object Mode, Ctrl+A →
  popover lists "Armature Modifier"; click → bake + remove modifier.
- **Circle Select**: in Edit Mode on Hiyori, press C.
  → Cursor becomes a circle.
  - Mouse-wheel → radius grows / shrinks.
  - LMB-drag → verts under circle highlight (paint).
  - Shift+LMB-drag → verts under circle deselect.
  - Press C again or Esc → exit modal.
  - In Object Mode, C → parts under circle highlight per LMB-paint.
- **Byte-fidelity**: dup edit, commit, re-export `.cmo3` → loads in
  Cubism Viewer.

## Open follow-ons (deferred per Rule №1 / spec)

- Apply menu items: Location / Rotation / Scale / All Transforms /
  Make Instances Real / Visual Geometry to Mesh (need use-case to drive).
- Pose Mode-specific Apply menu (`VIEW3D_MT_pose_apply` — Apply Selected
  As Rest Pose, Apply Visual Transform to Pose).
- Circle Select: MMB-drag subtract; mid-modal `B` to switch to Box Select;
  `F`-drag to set radius (Blender brush-style chord).
- Select Linked delimiter (Blender's `delimit` operator panel — UV / SEAM
  / SHARP / NORMAL / MATERIAL). Live2D meshes don't have these features
  today; comes online when the data model gains them.
- `MESH_OT_select_linked` cursor-mode toggle (Blender's `L` re-presses
  on the same component DESELECT it; SS replaces selection wholesale).
