# Phase 6 Blender-Fidelity Audit — 2026-05-10

Independent code review of commit `f44a1b0` (Toolset Phase 6 — Select
Linked + Edit-Mode Duplicate + Apply menu + Circle Select) through a
Blender-fidelity lens. Verified against `reference/blender/source/` and
`reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py`.

## Summary

12 gaps total — **3 HIGH** (silent wrong-behaviour vs Blender), **5 MED**
(missing Blender features / semantic divergences), **4 LOW** (citations +
naming drift).

| ID   | Sev  | One-line | Action |
|------|------|----------|--------|
| D-1  | HIGH | Circle Select wheel direction is INVERTED — wheel-up = larger in SS, but wheel-up = SUBTRACT (smaller) in Blender's `View3D Gesture Circle` modal map | FIX |
| D-2  | HIGH | `L` Select-Linked-Pick has no deselect variant; Blender binds `Shift+L` to the same operator with `deselect=True` (the canonical "remove linked under cursor" gesture) | FIX |
| D-3  | HIGH | `MESH_OT_select_linked` operator panel exposes `delimit` (UV / SEAM / SHARP / NORMAL / MATERIAL); SS uses pure edge connectivity with no delimiter property | DOCUMENT-AS-DEVIATION |
| D-4  | MED  | Cursor-mode `L` hit-tests verts only; Blender's `unified_findnearest` returns vert/edge/face per the active selectmode (face-pick is the most-used in practice) | DOCUMENT-AS-DEVIATION |
| D-5  | MED  | Circle Select MMB-down-to-subtract not bound; Blender's modal map binds `MIDDLEMOUSE` to `DESELECT` alongside `Shift+LMB` | FIX |
| D-6  | MED  | Edit-Mode Duplicate uses `rollbackOnCancel=true` (atomic with Modal G); Object-Mode Duplicate is non-atomic. Blender macro's `wm_macro_end` makes BOTH non-atomic — the cross-mode UX inconsistency (Esc in Edit Mode wipes the dups; Esc in Object Mode keeps them) will surprise Blender users | DOCUMENT-AS-DEVIATION |
| D-7  | MED  | Apply menu lists only Pose-as-Rest + Armature Modifier; Blender's `VIEW3D_MT_object_apply` has 13 items (Location/Rotation/Scale/All/Visual Geometry to Mesh/Make Instances Real/etc.); Pose Mode opens an entirely separate `VIEW3D_MT_pose_apply` (3 items) — SS uses one menu for both modes | DOCUMENT-AS-DEVIATION |
| D-8  | MED  | Circle Select intra-modal `C` re-toggles OFF in SS; Blender's `View3D Gesture Circle` modal map has no `C` binding (only `ESC`/`RIGHTMOUSE`=`CANCEL`, `RET`=`CONFIRM`). SS adds an extra exit affordance Blender doesn't offer | DOCUMENT-AS-DEVIATION |
| D-9  | LOW  | `linked.js:12` cites `editmesh_select.cc:5070+` for `select_linked_pick`; actual operator `MESH_OT_select_linked_pick` is at `:4503-4536`, exec at `:4467-4501`, invoke at `:4383-4465`. `:5070+` is `bm_step_to_next_selected_vert_in_chain` (a deselect_nth helper, unrelated) | FIX (cite update) |
| D-10 | LOW  | `CircleSelectOverlay.jsx:11` + `default.js:188-189` cite `view3d_select.cc:3470+`; actual `VIEW3D_OT_select_circle` is at `:5706-5725`, modal at `:5579-5588`. `:3470+` is grease-pencil curves selection (unrelated) | FIX (cite update) |
| D-11 | LOW  | `ApplyMenu.jsx:22` + `registry.js:1189` cite `space_view3d.py:6280+`; actual `VIEW3D_MT_object_apply` class is at `:3193-3258` and `VIEW3D_MT_pose_apply` at `:4393-4406`. The keymap binding `op_menu("VIEW3D_MT_object_apply"…)` is at `blender_default.py:4529`. Also: SS labels the menu class `OBJECT_MT_object_apply` in JSDoc (`ApplyMenu.jsx:21`, `registry.js:1188`), but Blender names it `VIEW3D_MT_object_apply` — naming drift | FIX (cite + name) |
| D-12 | LOW  | `Ctrl+L` is bound globally to `select.linked.expand` with topology-available gate — silently no-ops in Object Mode where Blender's `Ctrl+L` opens `VIEW3D_MT_make_links` (line 4530 of `blender_default.py`). Out-of-scope today (Make Links isn't a Phase 6 feature), but the missing menu surprises Blender users who muscle-memory the chord | DOCUMENT-AS-DEVIATION |

Phase 7 chord scan: no Phase 7 reservation collides with any Phase 6
chord. Phase 7's `Ctrl+N` (Normalize All, plan §7.B.5) collides with
the existing `Ctrl+N` = `file.new` from Phase 0 — flagged for the
Phase 7 audit, out of scope here.

---

## HIGH-severity gaps

### D-1 — Circle Select wheel direction inverted (HIGH: FIX)

**What Blender does.** `blender_default.py:6241-6243` (`km_view3d_gesture_circle`)
binds `WHEELUPMOUSE` to the modal action `SUBTRACT` (wheel-up = circle
SHRINKS) and `WHEELDOWNMOUSE` to `ADD` (wheel-down = circle GROWS). The
modal handler `WM_gesture_circle_modal`
(`wm_gesture_ops.cc:383-390`) decreases `rect->xmax` on `CIRCLE_SUB`
and increases it on `CIRCLE_ADD`.

**What SS does.** `CircleSelectOverlay.jsx:130-137` (`onWheel`) does the
opposite — `e.deltaY < 0` (wheel-up) → `dir = +1` → `radius + step`. The
JSDoc on line 133-135 even claims this matches Blender ("Blender
convention: wheel up = larger radius"), which is wrong.

**Why divergent / What to do.** This is an honest mistake — the comment
asserts Blender parity but the implementation is the opposite. Flip the
sign: wheel-up should SHRINK (`dir = -1` when `deltaY < 0`), wheel-down
should GROW. Update the JSDoc to cite `blender_default.py:6241-6243` +
`wm_gesture_ops.cc:383-390`. This is a 1-line fix with a real
muscle-memory impact on Blender users.

---

### D-2 — Shift+L deselect variant missing (HIGH: FIX)

**What Blender does.** `blender_default.py:5555-5558` binds `L` to
`mesh.select_linked_pick` with `deselect=False` (select linked under
cursor) AND `Shift+L` to the SAME operator with `deselect=True`
(deselect linked under cursor). The operator's `deselect` RNA bool
(`editmesh_select.cc:4520`) flips `sel` in `edbm_select_linked_pick_ex`
so the same flood-fill runs — but inverted. This is the canonical
"remove this linked region from my selection" gesture.

**What SS does.** `default.js:164` binds only `KeyL` →
`select.linked.cursor`. There is no `Shift+L` binding and
`selectLinkedFromVertex` has no deselect mode — the operator
unconditionally REPLACES the selection with the flood-fill set
(`registry.js:1024-1027` calls `setVertexSelectionForPart` then
`selectVertex(…, additive=true)`).

**Why divergent / What to do.** No data-model reason to skip this.
Two-line fix: (1) extend `selectLinkedFromVertex` (or the operator's
`exec`) to accept a `deselect` option that subtracts the linked set
from the current selection instead of replacing it; (2) add a sibling
operator `select.linked.cursor.deselect` and bind `Shift+KeyL` to it
in `default.js`. Mirror Blender's "same operator, RNA prop" pattern by
keeping it as a single operator with an arg if the registry tooling
supports it; otherwise a thin sibling is fine.

(Note: the audit prompt incorrectly described Blender's behaviour as
"re-pressing L on the same component DESELECTS it" — Blender does NOT
toggle on re-press; it requires `Shift+L`. Either way SS doesn't
implement the deselect path.)

---

### D-3 — `MESH_OT_select_linked` `delimit` property unsupported (HIGH: DOCUMENT-AS-DEVIATION)

**What Blender does.** `MESH_OT_select_linked` (`editmesh_select.cc:4226-4253`)
exposes a `delimit` enum-flag RNA property
(`editmesh_select.cc:4242-4252`) defaulting to `BMO_DELIM_SEAM`. The
flood-fill in `select_linked_delimit_test` (`editmesh_select.cc:3903`)
stops at edges marked SEAM / SHARP / NORMAL (>angle threshold) /
MATERIAL boundary / UV boundary. The `select_linked_pick` operator
exposes the same property
(`editmesh_select.cc:4521-4526`) and the operator-redo panel lets the
user toggle delimiters and re-flood.

**What SS does.** `selectLinkedFromVertex` / `selectLinkedExpandSelection`
in `linked.js` use pure edge-connectivity BFS via
`buildVertexAdjacency` — no delimiter awareness at all. The JSDoc
comments the BFS as "edge-connectivity" without flagging the missing
delimit modes.

**Why divergent / What to do.** Live2D meshes have no SEAM / SHARP /
NORMAL / MATERIAL flags (they're 2D triangulated alpha-blend meshes
without per-edge marks); UV islands EXIST in `mesh.uvs` but the
art-mesh model doesn't track per-edge UV breaks. The `delimit` enum
genuinely has no analogue in the data model. Document the deviation
in `linked.js`'s module banner — explicitly cite Blender's
`select_linked_delimit_test` and the five missing flag modes, and
note that SS's "connected component = single BFS reachable set" is
fundamentally simpler because the data model is simpler. Once a
shape-key / UV-seam concept lands (post Phase 6+), revisit and add
delimit support per-mode.

---

## MED-severity gaps

### D-4 — Cursor-mode `L` hit-tests verts only (MED: DOCUMENT-AS-DEVIATION)

**What Blender does.** `edbm_select_linked_pick_invoke`
(`editmesh_select.cc:4383-4465`) calls `unified_findnearest`
(`editmesh_select.cc:4427`) which returns the closest BMVert, BMEdge,
OR BMFace under the cursor based on the active `em->selectmode`. The
hit-test is multi-element. `EDBM_elem_from_selectmode`
(`editmesh_select.cc:4444`) then picks the appropriate elem. So the L
chord works equally well in vertex / edge / face select modes.

**What SS does.** `registry.js:1016` calls `hitTestVertices` against
`node.mesh.vertices` only. Edges and triangles aren't pickable as seed
elements — the user MUST hover near a vertex.

**Why divergent / What to do.** SS has no edge or face select mode
today (vertex-only), so `unified_findnearest`'s edge / face branches
don't have a target. The vertex-only restriction is a legitimate
data-model constraint. Document in `linked.js` module banner: cite
`unified_findnearest` and call out that when edge / face select mode
lands (Phase 6+ in the larger plan), the seed hit-test will need a
multi-element variant. Toast the user when the hit returns -1 with a
message that points at the hover requirement (already done at
`registry.js:1018-1022`).

---

### D-5 — MMB-subtract not bound on Circle Select (MED: FIX)

**What Blender does.** `blender_default.py:6239` binds `MIDDLEMOUSE`
press inside the `View3D Gesture Circle` modal map to `DESELECT`
(subtract) — the same modal action as `Shift+LEFTMOUSE` (line 6237).
Both gestures invoke `gesture_circle_apply` with `mode=SUB`. MMB-drag
is the pen-tablet-friendly subtract because Shift is awkward with a
stylus.

**What SS does.** `CircleSelectOverlay.jsx:104-121` (`onMouseDown`) only
handles `e.button !== 0` as no-op (early return) — MMB (`e.button === 1`)
is ignored entirely. Subtract requires Shift+LMB-down only.

**Why divergent / What to do.** No data-model reason to skip MMB. Add
an MMB-down branch in `onMouseDown`: if `e.button === 1`, call
`startPaint('subtract')` directly without checking shiftKey. Mirror in
`onMouseUp` (release MMB ends paint stroke). Update the JSDoc on the
overlay (`CircleSelectOverlay.jsx:14-21`) to cite
`blender_default.py:6239`. Five-line fix.

---

### D-6 — Cross-mode atomic-vs-non-atomic Duplicate divergence (MED: DOCUMENT-AS-DEVIATION)

**What Blender does.** Both `MESH_OT_duplicate_move`
(`mesh_ops.cc:235-242`) and `OBJECT_OT_duplicate_move`
(`object_ops.cc:306-314`) are macros composing
`{MESH/OBJECT}_OT_duplicate` then `TRANSFORM_OT_translate`. Per the
Phase 5 D-1 finding (verified again here against
`wm_operator_type.cc:308-328` `wm_macro_end` + `:475-483`
`wm_macro_cancel`): `Esc` mid-translate cancels ONLY the translate
sub-op, leaving the duplicates in place at source positions. This is
identical for both edit-mode and object-mode duplicate.

**What SS does.** `registry.js:1086-1127` (Edit Mode branch) opens a
batch + applies the topology op + begins Modal G with
`rollbackOnCancel: true`. Esc → `discardBatch` rolls back BOTH the dup
AND the drag. `registry.js:1130-1181` (Object Mode branch) calls
`duplicateNode` per target (each its own undo entry), THEN begins
Modal G translate WITHOUT `rollbackOnCancel` — Esc during translate
keeps the dups, drops only the drag (matches Blender for Object Mode).

**Why divergent / What to do.** Edit Mode atomic was a deliberate
Phase 5 D-1 deviation rationale ("aborting a single intentional
gesture") and the JSDoc at `registry.js:1052-1060` calls out the
Object Mode parity. The cross-mode INCONSISTENCY is the gap: the same
`Shift+D` chord behaves differently on Esc depending on which mode
the user is in. A Blender user who hits Esc-mid-translate in Edit
Mode loses the dup; in Object Mode they keep it. Bolster the JSDoc
on `edit.duplicate` with an explicit cross-mode table summarising the
behaviour (Edit = atomic, Object = non-atomic, both deliberate per
the data-model + UX trade-off) and add the same memo to
`docs/plans/AUDIT_2026_05_10_TOOLSET_PHASE5_BLENDER.md` D-1's
followup list. No code change — keep both behaviours, but make the
asymmetry visible in the docs.

---

### D-7 — Apply menu coverage + Pose Mode menu (MED: DOCUMENT-AS-DEVIATION)

**What Blender does.** `VIEW3D_MT_object_apply` (`space_view3d.py:3193-3258`)
has 13 items: Location / Rotation / Scale / All Transforms / Rotation &
Scale / Location to Deltas / Rotation to Deltas / Scale to Deltas /
All to Deltas / Animated Transforms to Deltas / Visual Transform /
Visual Geometry to Mesh / Visual Geometry to Objects / Duplicates Make
Real / Parent Inverse + asset menu items. Pose Mode opens an entirely
SEPARATE menu `VIEW3D_MT_pose_apply` (`space_view3d.py:4393-4406`)
with 3 items: Apply Pose As Rest / Apply Selected as Rest Pose / Apply
Visual Transform to Pose. The keybindings are
`blender_default.py:4529` (Object Mode `Ctrl+A` → object_apply) and
`:4648` (Pose Mode `Ctrl+A` → pose_apply).

**What SS does.** `ApplyMenu.jsx:31-34` ships 2 items: Pose As Rest +
Armature Modifier. Both are shown in BOTH modes, gated only by per-op
`available()`. `Apply.menu` operator at `registry.js:1192-1211` opens
the SAME menu regardless of mode; mode-awareness is in `available()`
(returns true for pose-mode OR object-mode-with-armature-modifier).

**Why divergent / What to do.** Most of the missing items are
out-of-scope for SS today: there's no Object-mode transform-to-rest
operator (the Live2D model authors transforms inside cmo3 deformers,
not on Object axes); no Visual Geometry to Mesh (Live2D meshes are
art-meshes not derived geometry); no Make Instances Real (no instance
collection model). Apply Pose As Rest covers the canonical Pose Mode
use; Apply Armature Modifier covers the canonical Object Mode use.
Document in the `ApplyMenu.jsx` module banner: explicit list of
deferred items + the data-model reason each is out-of-scope. Note
the Blender split into two menu classes — when Apply Selected as Rest
Pose (a Pose Mode bone-subset variant) lands as a Phase 7+ feature,
either split SS into two menus per Blender or keep one menu and
filter visible items by `editor.editMode`. Right now both items show
in Pose Mode but Apply Armature Modifier is greyed (no part selected
with armature modifier in Pose Mode) — that's already mode-aware via
`available()`, so the gap is cosmetic.

---

### D-8 — Intra-modal `C` re-toggle is SS-specific (MED: DOCUMENT-AS-DEVIATION)

**What Blender does.** The `View3D Gesture Circle` modal map
(`blender_default.py:6232-6246`) only binds `ESC` / `RIGHTMOUSE` =
`CANCEL`, `RET` / `NUMPAD_ENTER` = `CONFIRM`, plus
`LMB`/`Shift+LMB`/`MMB` actions and wheel/numpad-+/- size adjusts.
There is NO bare `C` binding — pressing `C` mid-modal does nothing
(or, depending on event passthrough, may insert a literal `C` keypress
into a focused widget, but the modal doesn't see it).

**What SS does.** `CircleSelectOverlay.jsx:151-157` (`onKeyDown`)
explicitly handles `e.code === 'KeyC'` with no modifiers as `cancel()`
— the user can press C to exit. The SS keymap binds `KeyC` to
`selection.circleSelect` to OPEN the modal; SS adds an off-toggle that
Blender doesn't expose.

**Why divergent / What to do.** This is an SS UX addition, not a
Blender behaviour to port. The intent is clear (matches the
"toggle-style" feel of the activation chord). Document in
`CircleSelectOverlay.jsx`'s module banner: explicit deviation note
that bare `C` mid-modal is an SS-only off-toggle; Blender requires
ESC / RIGHTMOUSE / RET. (No code change — keep the affordance, just
flag it as deliberate.)

The audit prompt also asked about `B`-mid-circle switching to Box
Select — Blender's modal map has no such binding either. Box / Circle
mode-swaps must exit the current modal before opening the next.
Default behaviour matches SS; document this too.

---

## LOW-severity gaps

### D-9 — `linked.js` source citation wrong (LOW: FIX)

**What Blender does.** `MESH_OT_select_linked_pick` operator definition
is at `editmesh_select.cc:4503-4536`. The exec callback
`edbm_select_linked_pick_exec` is at `:4467-4501`. The invoke
`edbm_select_linked_pick_invoke` is at `:4383-4465`.
`MESH_OT_select_linked` is at `:4226-4253` with exec
`edbm_select_linked_exec` at `:4016+`.

**What SS does.** `linked.js:12` cites
`editmesh_select.cc:5070+`. That range is inside
`bm_step_to_next_selected_vert_in_chain` — a deselect-nth-walker
helper unrelated to the linked-pick operator. The keymap doc-comment
at `default.js:160-163` repeats the same wrong cite.

**Why divergent / What to do.** Pure citation drift. Update the cite
in `linked.js` module docstring to point at:
- `editors/mesh/editmesh_select.cc:4503-4536` (`MESH_OT_select_linked_pick` definition)
- `editors/mesh/editmesh_select.cc:4467-4501` (exec)
- `editors/mesh/editmesh_select.cc:4383-4465` (invoke — the cursor hit-test path)
- `editors/mesh/editmesh_select.cc:4226-4253` (`MESH_OT_select_linked` definition)

Mirror the fix in `default.js:158-166`.

---

### D-10 — `CircleSelectOverlay` source citation wrong (LOW: FIX)

**What Blender does.** `VIEW3D_OT_select_circle` is at
`view3d_select.cc:5706-5725`. The modal handler
`view3d_circle_select_modal` is at `:5579-5588` and exec
`view3d_circle_select_exec` at `:5596-5704`. The actual gesture-circle
modal lifecycle (mouse handling, radius adjust) lives in
`windowmanager/intern/wm_gesture_ops.cc:349-447`
(`WM_gesture_circle_modal`).

**What SS does.** `CircleSelectOverlay.jsx:11` cites
`view3d_select.cc:3470+`. That range is grease-pencil curve selection,
unrelated. `default.js:188-189` and `registry.js:1277` repeat the
wrong cite.

**Why divergent / What to do.** Pure citation drift. Update the cites
to point at `view3d_select.cc:5706-5725` (operator def) +
`:5596-5704` (exec) + `wm_gesture_ops.cc:349-447` (modal lifecycle).

---

### D-11 — Apply menu citation + class-name drift (LOW: FIX)

**What Blender does.** The class is `VIEW3D_MT_object_apply` (defined
at `space_view3d.py:3193-3258`) and `VIEW3D_MT_pose_apply` at
`:4393-4406`. The Object Mode `Ctrl+A` keymap binding is at
`blender_default.py:4529`; Pose Mode at `:4648`. There is NO
`OBJECT_MT_object_apply` class anywhere in the Blender tree.

**What SS does.** `ApplyMenu.jsx:21-22` says "Mirrors Blender's
`OBJECT_MT_object_apply` / `VIEW3D_MT_object_apply` popups
(`reference/blender/scripts/startup/bl_ui/space_view3d.py:6280+`)" —
the `OBJECT_MT_object_apply` name is invented, the line range is
wrong (the file has 9300+ lines and `VIEW3D_MT_object_apply` is at
3193). `registry.js:1188-1189` repeats the same wrong name + cite.

**Why divergent / What to do.** Drop the `OBJECT_MT_object_apply`
mention (it doesn't exist). Update the Python cite to
`space_view3d.py:3193-3258` (object_apply class) and
`:4393-4406` (pose_apply class). Add the keymap cites
`blender_default.py:4529` (Object Mode) + `:4648` (Pose Mode).

---

### D-12 — `Ctrl+L` Object Mode silently no-ops (LOW: DOCUMENT-AS-DEVIATION)

**What Blender does.** `blender_default.py:4530` (Object Mode keymap)
binds `Ctrl+L` to `op_menu("VIEW3D_MT_make_links")` — an entirely
different operator from mesh-mode `mesh.select_linked`. The Make
Links menu offers Link Object Data / Materials / Animation Data /
Collection / Instance Collection / Modifiers / etc.

**What SS does.** `default.js:165-166` binds `Ctrl+L` (and `Meta+L`) to
`select.linked.expand` globally. The operator's `available()` returns
false outside Edit Mode, so in Object Mode the chord silently does
nothing (no toast, no menu).

**Why divergent / What to do.** Make Links isn't a Phase 6 feature
(no Link Object Data semantic in Live2D's data model), so silent
no-op is defensible. The deviation note belongs in `default.js`'s
`Ctrl+KeyL` doc-comment: "Object Mode Ctrl+L in Blender opens
VIEW3D_MT_make_links; SS no-ops there until the Make Links operator
ships (post-Phase 6+)." A Blender muscle-memory user pressing the
chord in Object Mode will get no feedback today; consider toasting
"Make Links not implemented" if the no-op confuses users (cheap
follow-up, ~3 lines).

---

## Notes for the architecture auditor

`registry.js`'s `clientToCanvas` helper at `:980-992` does
`document.querySelector('canvas')` — assumes a single canvas in the
DOM. Out of scope for Blender-fidelity but flagging for the arch sweep
(the new `CanvasArea` host backing both viewport tabs may have multiple
canvases in flight depending on the rendering plan).

`CircleSelectOverlay.runPaintTick` (`:217-266`) re-computes
`computeWorldMatrices(project.nodes)` on every mousemove tick. For a
project with N parts that's O(N) matrix ops per pixel of cursor motion.
Caching the matrices for the duration of a paint stroke would be a
straightforward perf win; the current design re-builds them every tick.
Out of scope for Blender-fidelity.

`circleSelectStore.begin()` does NOT reset `radiusPx` (intentional, to
preserve the user's last radius across activations) but the JSDoc on
the `begin` action at `:81-90` says "Preserve the user's last radius…
matches Blender's behavior." Verified — Blender persists `radius` via
`RNA_int_set(op->ptr, "radius", rect->xmax)` in
`wm_gesture_ops.cc:426`. Match is correct, no gap.
