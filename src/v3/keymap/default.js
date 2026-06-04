// @ts-check

/**
 * v3 Phase 0A - Default key bindings.
 *
 * Maps `KeyboardEvent.code` chords to operator ids. We use `.code`
 * (physical key) rather than `.key` (layout-dependent character) so
 * bindings survive layout switches - Working Note #3 in the V3 plan.
 *
 * Format: `chord` → `operatorId`
 *   chord syntax: `[Mod+][Mod+]Code`
 *   modifiers in canonical order: `Ctrl Shift Alt Meta`
 *   examples: `KeyA`, `Ctrl+KeyZ`, `Ctrl+Shift+KeyZ`, `F5`
 *
 * Phase 0A only binds workspace shortcuts so we can verify the
 * dispatcher round-trip. Editor-specific bindings arrive with each
 * editor in Phase 1+.
 *
 * @module v3/keymap/default
 */

/** @type {Record<string, string>} */
export const DEFAULT_KEYMAP = {
  // Workspace switches — Ctrl+1..6 mirrors Blender's per-workspace
  // numbered chord pattern (no canonical Blender default but a common
  // user-pref add-on). 6 workspaces shipped 2026-05-16 (audit F-2):
  // layout / modeling / rigging / weightPaint / sculpt / animation.
  'Ctrl+Digit1': 'workspace.set.layout',
  'Ctrl+Digit2': 'workspace.set.modeling',
  'Ctrl+Digit3': 'workspace.set.rigging',
  'Ctrl+Digit4': 'workspace.set.weightPaint',
  'Ctrl+Digit5': 'workspace.set.sculpt',
  'Ctrl+Digit6': 'workspace.set.animation',

  // Workspace cycle — Ctrl+PageUp / Ctrl+PageDown matches Blender's
  // `screen.workspace_cycle` (`blender_default.py:823-825`).
  'Ctrl+PageUp':   'workspace.cycle.prev',
  'Ctrl+PageDown': 'workspace.cycle.next',

  // Layout reset - uncommon enough that Ctrl+Shift+Backspace is fine.
  'Ctrl+Shift+Backspace': 'workspace.reset',

  // Undo / redo. Three chords because Ctrl+Y is muscle-memory for
  // Windows users and Ctrl+Shift+Z for everyone else; both fire the
  // same operator. Meta+ variants for macOS handled by the chord
  // builder reading metaKey alongside ctrlKey.
  'Ctrl+KeyZ': 'app.undo',
  'Meta+KeyZ': 'app.undo',
  'Ctrl+Shift+KeyZ': 'app.redo',
  'Meta+Shift+KeyZ': 'app.redo',
  'Ctrl+KeyY': 'app.redo',
  'Meta+KeyY': 'app.redo',

  // File save / load. Browser may pre-empt Ctrl+S as "save page" — the
  // dispatcher calls preventDefault before exec runs so we win.
  'Ctrl+KeyS': 'file.save',
  'Meta+KeyS': 'file.save',
  // Save As — Blender's `wm.save_as_mainfile` chord (`space_topbar.py:176`).
  // Opens the Save modal with `saveAs:true` so the typed name creates a
  // new library record instead of overwriting the linked one.
  'Ctrl+Shift+KeyS': 'file.saveAs',
  'Meta+Shift+KeyS': 'file.saveAs',
  'Ctrl+KeyO': 'file.load',
  'Meta+KeyO': 'file.load',

  'Ctrl+KeyN': 'file.new',
  'Meta+KeyN': 'file.new',

  'Ctrl+KeyE': 'file.export',
  'Meta+KeyE': 'file.export',

  // Timeline play / pause. Bare Space — Blender's `screen.animation_play`
  // default in the "Blender" keymap preset. Toggles transport from any
  // editor (the dispatcher skips editable targets).
  'Space': 'anim.play',

  // Selection: drop everything. Bare Esc — same as Blender.
  'Escape': 'selection.clear',

  // Bare `A` — Blender's "select all / deselect all" toggle. Cycles
  // between "everything visible selected" and "nothing selected"
  // depending on current state. Available globally (no editor scope)
  // so it works on the canvas without needing focus.
  'KeyA': 'selection.selectAllToggle',

  // Toolset Phase 0.C — Alt+A: Blender's "deselect all" companion to
  // KeyA's toggle. Mode-aware (handler scopes to vertex set in Edit
  // Mode + select tool, else falls through to object deselect).
  'Alt+KeyA': 'selection.deselectAll',

  // Delete selected project nodes. Both Delete and Backspace are
  // common muscle memory; bind both. (Backspace alone fires inside
  // editable inputs anyway, but the dispatcher's editable-target
  // check guards that case.)
  'Delete':    'selection.delete',
  'Backspace': 'selection.delete',

  // Toggle visibility on selection. Bare H — Blender muscle memory.
  'KeyH': 'selection.toggleVisibility',

  // Frame-to-selected. Period (NumpadDecimal too) — Blender's "view
  // selected" / "frame the selection" gesture.
  'Period':         'view.frameSelected',
  'NumpadDecimal':  'view.frameSelected',

  // F3 — operator search palette. Blender's standard "what was that
  // operator called again" shortcut. cmdk dialog handles its own
  // input focus + Esc-to-close, so we don't need a second binding
  // for the close path.
  'F3': 'app.commandPalette',

  // F1 — quick reference modal. Browser leaves F1 alone outside
  // dev-tools-bound contexts, and the dispatcher preventDefault's
  // before any browser default fires.
  'F1': 'app.help',

  // Phase 2H — modal G/R/S transforms. Bare letter chords on
  // selection. The modal overlay captures mouse + key from there.
  'KeyG': 'transform.translate',
  'KeyR': 'transform.rotate',
  'KeyS': 'transform.scale',

  // Toolset Phase 1.A — `B` chord opens the modal box-select. Mode-
  // aware: in Object Mode selects parts whose AABB intersects the
  // rect; in Edit Mode selects verts inside the rect for the active
  // part. The overlay (BoxSelectOverlay) owns mouse + key from there.
  'KeyB': 'selection.boxSelect',

  // Edit-mode refactor — Tab toggles into a contextual edit mode based
  // on the active selection's type (Blender pattern). Meshed part →
  // Edit Mode. Bone-role group → Pose Mode. Already in edit mode
  // → exit. BlendShape edit is entered from BlendShapeTab where the
  // user picks which shape to paint.
  'Tab': 'mode.editToggle',
  // Ctrl+Tab — Blender pattern: armature selection → toggle Pose Mode
  // directly (`OBJECT_OT_mode_set` mode='POSE'); other selections fall
  // back to the ModePill mode menu. NOTE: in a browser tab Ctrl+Tab is
  // reserved by the browser and may not be interceptable; works in the
  // desktop app.
  'Ctrl+Tab': 'mode.menu',

  // BVR-007 — N toggles the right-edge tool-settings panel. Blender's
  // canonical "show/hide N-panel" gesture. Bare N (no modifier) so it
  // doesn't collide with Ctrl+N (file.new).
  'KeyN': 'panel.toolSettingsToggle',

  // Toolset Phase 4 — topology operators. M opens the Merge popover
  // (6 variants — D-3 added At First); Ctrl+X dissolves selected
  // vertices in place. The operators' availability gates ensure they
  // no-op outside Edit Mode on a meshed part.
  //
  // Blender chord parity:
  //   - `KeyM` = `MESH_OT_merge` (matches us — opens the M-menu).
  //   - `Ctrl+KeyX` in Blender is `MESH_OT_dissolve_mode`, a context-
  //     sensitive dispatch that calls vert / edge / face dissolve
  //     based on `tool_settings->selectmode` (audit note D-8 from
  //     `editmesh_tools.cc:6281`, `blender_default.py:5605`). SS is
  //     vertex-only today so `Ctrl+X` fires `edit.dissolveVerts`
  //     directly. When edge / face select modes land (Phase 6+),
  //     this binding will need a dispatch wrapper that reads the
  //     active select mode and routes accordingly.
  'KeyM':       'edit.mergeMenu',
  'Ctrl+KeyX':  'edit.dissolveVerts',
  'Meta+KeyX':  'edit.dissolveVerts',

  // Bare `KeyX` — Blender's vertex/edge/face delete. SS is vertex-only
  // today so X always fires `edit.deleteVerts` (drops verts + incident
  // tris, leaves holes). `Delete` and `Backspace` go through
  // `selection.delete` which is polymorphic by mode (Edit Mode →
  // verts via `deleteVertices`, Object Mode → parts/groups). Keep `X`
  // as a fast dedicated chord even though the polymorphic Delete also
  // covers it — matches Blender muscle memory and lets a future
  // vertex / edge / face select-mode dispatch wrap THIS binding without
  // perturbing the polymorphic node-delete path.
  'KeyX':       'edit.deleteVerts',

  // Bare `KeyK` — Blender's `MESH_OT_knife_tool` chord. v1 cuts a
  // straight line between the two selected vertices (the operator's
  // `available()` gate requires exactly 2 verts selected). The
  // interactive click-A-then-click-B modal preview Blender ships with
  // is a follow-up — until then the user selects 2 verts and presses K.
  'KeyK':       'edit.knife',

  // Toolset Phase 5 — Extrude. `E` chord on selected boundary verts:
  // duplicates them, bridges with quad strips, hands off to Modal G in
  // vertex mode (drag the new strip, click to commit, Esc to roll back
  // the entire op including the topology change).
  //
  // Blender chord parity: `KeyE` = `MESH_OT_extrude_region` for vertex
  // select mode (`editmesh_extrude.cc:430-456` exec callback +
  // `editmesh_extrude.cc:358-427` dispatch logic). Audit D-9 corrected
  // a pre-existing wrong cite that pointed at `:507-585`. Blender's
  // keymap routes Alt+E to a "wave" pop-up menu of extrude variants
  // (`scripts/presets/keyconfig/keymap_data/blender_default.py:5571`);
  // SS direct dispatch ships only the region variant in v1 (Phase 6+
  // may add `MESH_OT_extrude_verts_indiv` for interior-vert extrusion
  // — bmop at `bmesh/operators/bmo_extrude.cc:236-284` — as a separate
  // operator, in which case the binding here may move to a dispatcher
  // that picks based on whether selection has any boundary verts).
  'KeyE': 'edit.extrude',

  // Toolset Phase 6.A — Select Linked. Bare `L` flood-fills from the
  // vertex under the cursor (Blender's `MESH_OT_select_linked_pick`,
  // `editmesh_select.cc:4503-4536` operator def + `:4467-4501` exec
  // + `:4383-4465` invoke / cursor hit-test path. Audit D-9 corrected
  // a pre-existing wrong cite at `:5070+` which is the unrelated
  // `bm_step_to_next_selected_vert_in_chain` deselect-walker helper).
  // `Shift+L` deselects the linked region under the cursor (audit fix
  // D-2 — `RNA_def_boolean(ot->srna, "deselect", false, …)` on the
  // same operator at `editmesh_select.cc:4520`; Blender keymap binding
  // at `blender_default.py:5557-5558`).
  // `Ctrl+L` expands the current selection to its full connected
  // components (Blender's `MESH_OT_select_linked`,
  // `editmesh_select.cc:4226-4253`). Edit-Mode only — operator
  // availability gate handles the no-op case.
  //
  // Audit D-12 (DOCUMENT-AS-DEVIATION): Object Mode `Ctrl+L` in Blender
  // opens `VIEW3D_MT_make_links` (`blender_default.py:4530`) — Link
  // Object Data / Materials / Animation Data / Collection / Modifiers
  // etc. SS does not implement Make Links; the chord silently no-ops
  // outside Edit Mode. A Blender muscle-memory user pressing Ctrl+L in
  // Object Mode will see no feedback. When the Make Links operator
  // ships (post-Phase 6+), bind it here as the Object-Mode branch of
  // `Ctrl+L`.
  'KeyL':         'select.linked.cursor',
  'Shift+KeyL':   'select.linked.cursor.deselect',
  'Ctrl+KeyL':    'select.linked.expand',
  'Meta+KeyL':    'select.linked.expand',

  // Toolset Phase 6.B — Duplicate. `Shift+D` is Blender's universal
  // "duplicate selection then translate" macro. Mode-aware dispatch
  // inside the operator: Edit Mode = topology dup + atomic modal G;
  // Object Mode = `duplicateNode` + non-atomic modal G (matches
  // Blender's `OBJECT_OT_duplicate_move` macro semantics).
  //
  // Blender source: `OBJECT_OT_duplicate_move` is defined in
  // `editors/object/object_add.cc:1968+`; the `MESH_OT_duplicate_move`
  // macro lives at `editors/mesh/editmesh_add.cc:780+`. Both compose
  // their respective duplicate ops with `TRANSFORM_OT_translate`.
  'Shift+KeyD': 'edit.duplicate',

  // Toolset Phase 6.C — Apply menu. `Ctrl+A` opens the Apply popover
  // (Blender's `OBJECT_MT_object_apply`). The menu shows applicable
  // items based on selection (Apply Pose As Rest in Pose Mode; Apply
  // Armature Modifier when a selected part has one).
  'Ctrl+KeyA':  'apply.menu',
  'Meta+KeyA':  'apply.menu',

  // Toolset Phase 6.D — Circle Select. `C` chord opens the modal
  // cursor-circle paint selection (Blender's `VIEW3D_OT_select_circle`,
  // audit D-10 cite fix: `view3d_select.cc:5706-5725` operator def +
  // `:5596-5704` exec + `wm_gesture_ops.cc:349-447`
  // `WM_gesture_circle_modal` for the modal lifecycle. Pre-fix cite at
  // `:3470+` was grease-pencil curves selection, unrelated). Wheel
  // adjusts radius (audit D-1 fix: wheel-up SHRINKS, wheel-down GROWS,
  // matching Blender's `WHEELUPMOUSE = SUBTRACT` /
  // `WHEELDOWNMOUSE = ADD` modal map at
  // `blender_default.py:6241-6243`). LMB-drag paints; Shift+LMB-drag
  // and MMB-drag both subtract (audit D-5 fix:
  // `MIDDLEMOUSE = DESELECT` at `blender_default.py:6239`). Mode-aware:
  // Edit Mode picks verts on the active part; Object Mode picks parts
  // under the circle.
  'KeyC': 'selection.circleSelect',

  // Toolset Phase 7.A.1 — Snap menu (`Shift+S`). Opens the SnapMenu
  // popover anchored at cursor. Mirrors Blender's `VIEW3D_MT_snap_pie`
  // (`scripts/startup/bl_ui/space_view3d.py:6181-6203`; audit fix D-6
  // corrected a pre-existing wrong cite at `:6377-6411`). Bound via
  // `blender_default.py:1833` in `km_view3d_generic` — applies to all
  // 3D View modes (audit fix D-5 corrected a pre-existing wrong cite at
  // `:4527` which is `object.delete`). No prior SS binding.
  //
  // G-4 (DOCUMENT-AS-DEVIATION) — Blender's `Shift+S` in Edit Mode opens
  // a separate `VIEW3D_MT_snap` for vertex/edge/face snapping. SS serves
  // the Object Mode menu in all modes (no Edit Mode vertex-snap shipped).
  // Phase 7.B (mesh/vertex snap) will gate `object.snap.menu` to non-Edit
  // modes and route Edit Mode `Shift+S` to the vertex snap menu when it
  // ships. Until then, snap ops in Edit Mode are data-safe (filter to
  // non-vertex selections) but show the wrong menu for Blender muscle
  // memory.
  'Shift+KeyS': 'object.snap.menu',

  // Toolset Phase 7.A.2 — Mirror selected (`Ctrl+M`). Opens the axis-
  // pick popover (X / Y / Z); X+Y commit a mirror through the selection
  // mean; Z is a 2D no-op with toast. Blender source:
  // `editors/transform/transform_ops.cc:1172` (`TRANSFORM_OT_mirror`;
  // audit fix D-9 corrected pre-existing `:1047+` which is `TRANSFORM_OT_bend`).
  // Keymap binding at `blender_default.py:4512` via
  // `_template_items_transform_actions` (audit fix D-5 corrected
  // pre-existing `:4544`).
  'Ctrl+KeyM': 'object.mirror.menu',
  'Meta+KeyM': 'object.mirror.menu',

  // Toolset Phase 7.A.3 — Set Parent (`Ctrl+P`). Active = LAST selected;
  // every other selected node is reparented to active (cycle + type
  // validation by `reparentNode`). Blender:
  // `editors/object/object_relations.cc:1100` (`OBJECT_OT_parent_set`;
  // audit fix D-8 corrected pre-existing `:475+` which is the
  // `parent_set()` data helper, not the operator def). Keymap binding at
  // `blender_default.py:4509` (audit fix D-5 corrected pre-existing `:4546`).
  'Ctrl+KeyP': 'object.parent.set',
  'Meta+KeyP': 'object.parent.set',

  // Toolset Phase 7.A.4 — Clear Parent (`Alt+P`). Opens the three-mode
  // popover. Blender: `editors/object/object_relations.cc:444`
  // (`OBJECT_OT_parent_clear`; enum at `:315`. Audit fix D-7 corrected
  // pre-existing `:294+` which is `OBJECT_OT_vertex_parent_set`).
  // Keymap binding at `blender_default.py:4510` (audit fix D-5 corrected
  // pre-existing `:4548`).
  'Alt+KeyP': 'object.parent.clearMenu',

  // Toolset Phase 7.B.1 — Sample Weight (`Shift+X`). Eyedropper that
  // picks the weight under the cursor in the active group → writes
  // `editorStore.brushWeight`. Blender source: `PAINT_OT_weight_sample`
  // (`reference/blender/source/blender/editors/sculpt_paint/mesh/paint_vertex_weight_ops.cc:278`,
  // invoke at `:172`). Keymap: `Shift+X` per `blender_default.py:5136`
  // (`("paint.weight_sample", {"type": 'X', "value": 'PRESS', "shift": True})`).
  // The operator's `available()` gates to weightPaint mode + a selected
  // meshed part (audit fix G-6) — pressing `Shift+X` outside weight
  // paint, or with no mesh, is a silent no-op.
  //
  // Plan §7.B.1 originally proposed `Ctrl+LMB` (browser-friendly
  // eyedropper) but the audit-fixed binding table bound `Shift+X` for
  // Blender muscle-memory parity.
  //
  // D-5 DOCUMENT-AS-DEVIATION: Blender's companion `Ctrl+Shift+X`
  // (`paint.weight_sample_group` per `blender_default.py:5137`) pops a
  // menu of weight groups present at the cursor and lets the user pick
  // one to make active. SS does NOT bind it — the N-panel Vertex
  // Groups dropdown serves the same active-group selection function
  // and is always one click away. No SS chord reserved; pressing
  // `Ctrl+Shift+X` is silently inert.
  'Shift+KeyX': 'weightPaint.sample',

  // ── Toolset Phase 7.C — Pose Mode tools ─────────────────────────────
  //
  // All chords below are mode-gated at the operator's `available` callback
  // (`editorStore.editMode === 'pose'`). Outside Pose Mode the chord
  // resolves but `available()` returns false and the dispatcher returns
  // WITHOUT preventDefault — the browser's native handling kicks in
  // (matters for Ctrl+C / Ctrl+V which fall through to text copy/paste
  // in non-Pose contexts). The dispatcher's `isEditableTarget` guard
  // already short-circuits before chord resolution when focus is in an
  // <input> / <textarea> / contentEditable node, so typing Ctrl+C in a
  // text field always works regardless of mode.
  //
  // Audit-fixed bindings (per plan §8 Phase 7 — Pose Mode table):
  //
  //   Alt+G/R/S        → clear SELECTED bones loc/rot/scale
  //                      (Blender: POSE_OT_loc_clear / rot_clear / scale_clear,
  //                       reference/blender/source/blender/editors/armature/
  //                       pose_transform.cc:1129/1138/1147)
  //
  //   Shift+Alt+G/R/S  → clear ALL bones loc/rot/scale (3 separate chords —
  //                      audit-CRITICAL fix: plan v1 had three different
  //                      answers in three places; per Blender each axis
  //                      ships per-axis with no combined chord. Audit-fix
  //                      G-1/D-1: keymap key order is `Shift+Alt+` not
  //                      `Alt+Shift+` because chordOf below builds
  //                      modifiers in `Ctrl+Shift+Alt+Meta+` order — the
  //                      lookup must match the canonical order)
  //
  //   Ctrl+Shift+M     → pose.selectMirror (Blender's POSE_OT_select_mirror,
  //                      pose_select.cc:1080-1132)
  //
  //   Ctrl+Shift+V     → pose.mirrorPose — paste-flipped (Blender's actual
  //                      mirror-pose chord; v1 misnamed Ctrl+Shift+M for this,
  //                      audit-HIGH fix renamed to V to match Blender muscle
  //                      memory; Blender: POSE_OT_paste(flipped=True),
  //                      pose_transform.cc:805-859 + flag at :899)
  //
  //   Ctrl+C / Ctrl+V  → pose.copy / pose.paste (Pose Mode only; in Object
  //                      Mode the chords fall through to browser default)
  'Alt+KeyG':         'pose.clearLocation',
  'Alt+KeyR':         'pose.clearRotation',
  'Alt+KeyS':         'pose.clearScale',
  'Shift+Alt+KeyG':   'pose.clearAllLocation',
  'Shift+Alt+KeyR':   'pose.clearAllRotation',
  'Shift+Alt+KeyS':   'pose.clearAllScale',
  'Ctrl+Shift+KeyM':  'pose.selectMirror',
  'Meta+Shift+KeyM':  'pose.selectMirror',
  'Ctrl+Shift+KeyV':  'pose.mirrorPose',
  'Meta+Shift+KeyV':  'pose.mirrorPose',
  'Ctrl+KeyC':        'pose.copy',
  'Meta+KeyC':        'pose.copy',
  'Ctrl+KeyV':        'pose.paste',
  'Meta+KeyV':        'pose.paste',

  // Animation Phase 7 Slice 7.C -- Insert Keyframe menu (`I`).
  //
  // Plan §7.C ships I as the always-menu hotkey (every press shows
  // the KeyingSetMenu popover with the default-picked set
  // highlighted). The legacy "K = insert all properties" handler at
  // `CanvasViewport.jsx:1457-1633` stays untouched in 7.C scope per
  // plan §7.E's K-key migration carve-out.
  //
  // Blender chord parity divergence (documented in
  // `src/v3/operators/insertKey.js`'s header): Blender binds I to
  // `anim.keyframe_insert` (uses active KS direct; menu only if
  // none) at `keymap_data/blender_default.py:4561`, and K to
  // `anim.keyframe_insert_menu` with `always_prompt=True` at `:4536`.
  // The SS plan inverts this because the legacy K-key already keys
  // every visible property -- migrating K to "menu only" without a
  // user-facing rebind UI would break muscle memory for the
  // animation workflow. Plan §7.E will surface the toast +
  // preference for the rebind.
  'KeyI': 'insertKey.menu',
};

/**
 * Build the chord string for a `KeyboardEvent`. Modifiers go in
 * canonical order; the key is `event.code` (physical) so e.g. AZERTY
 * + QWERTY users get the same binding.
 *
 * @param {KeyboardEvent} e
 * @returns {string}
 */
export function chordOf(e) {
  let chord = '';
  if (e.ctrlKey)  chord += 'Ctrl+';
  if (e.shiftKey) chord += 'Shift+';
  if (e.altKey)   chord += 'Alt+';
  if (e.metaKey)  chord += 'Meta+';
  return chord + e.code;
}
