// @ts-check

/**
 * CanvasContextMenu data — Audit 4 #2 (2026-05-16).
 *
 * Per-`editMode` item descriptors for the canvas RMB context menu.
 * Extracted from `CanvasContextMenu.jsx` so the integrity test
 * (`scripts/test/test_canvasContextMenu_dispatch.mjs`) can import
 * the dispatch function without a JSX transpiler — Node's ESM loader
 * rejects `.jsx` directly.
 *
 * Each item descriptor is either:
 *   { id: 'operator.id', label?: 'Override label' }
 *   { separator: true }
 *
 * Item sets cite Blender's source so future audit can confirm parity
 * without re-walking the .py file. See `CanvasContextMenu.jsx` JSDoc
 * for the menu-class mapping.
 *
 * Cross-list SS deviation flagged once here (Audit 4 #2 post-ship
 * fidelity sweep): every list ends with `view.frameSelected`. Blender's
 * VIEW3D_MT_*_context_menu classes do NOT carry "Frame Selected" — it
 * lives on `numpad-.` only (and in the View menu of each editor's
 * header). SS surfaces it in every list because (a) SS's command set
 * is smaller than Blender's and the menu would otherwise be sparse,
 * and (b) discovering "." as the keybind is harder for users coming
 * from non-Blender 2D tools. Marked as a deliberate
 * `feedback_blender_reference_strict.md` deviation, not an oversight.
 *
 * @module v3/shell/canvasContextMenuItems
 */

/** @typedef {{id: string, label?: string} | {separator: true}} ContextMenuItem */

/** Object (editMode === null) → `VIEW3D_MT_object_context_menu`
 *  (`reference/blender/scripts/startup/bl_ui/space_view3d.py:2943`). */
/** @type {ContextMenuItem[]} */
export const OBJECT_ITEMS = [
  { id: 'object.snap.menu',         label: 'Snap…' },
  { id: 'object.mirror.menu',       label: 'Mirror…' },
  { separator: true },
  { id: 'object.parent.set',        label: 'Parent…' },
  { id: 'object.parent.clearMenu',  label: 'Clear Parent…' },
  { id: 'object.setOrigin.menu',    label: 'Set Origin…' },
  { separator: true },
  { id: 'edit.duplicate',           label: 'Duplicate' },
  { id: 'selection.delete',         label: 'Delete' },
  { separator: true },
  { id: 'view.frameSelected',       label: 'Frame Selected' },
];

/** Edit Mode on mesh → `VIEW3D_MT_edit_mesh_context_menu` (`:4565`).
 *  Blender's menu is per-element (vert / edge / face); SS has only
 *  vertex topology today, so we surface the vert-mode subset. */
/** @type {ContextMenuItem[]} */
export const EDIT_MESH_ITEMS = [
  { id: 'edit.subdivide',                  label: 'Subdivide' },
  { id: 'edit.extrude',                    label: 'Extrude Vertices' },
  { id: 'edit.mergeMenu',                  label: 'Merge…' },
  { id: 'edit.dissolveVerts',              label: 'Dissolve Vertices' },
  { separator: true },
  { id: 'select.linked.cursor',            label: 'Select Linked under Cursor' },
  { id: 'select.linked.expand',            label: 'Select Linked' },
  { separator: true },
  { id: 'edit.duplicate',                  label: 'Duplicate' },
  { id: 'selection.delete',                label: 'Delete' },
  { separator: true },
  { id: 'view.frameSelected',              label: 'Frame Selected' },
];

/** Edit Mode on armature → `VIEW3D_MT_armature_context_menu` (`:5671`).
 *
 *  Blender's menu opens with `armature.subdivide` → `armature.duplicate_move`
 *  → `armature.extrude_move` → (optional `armature.extrude_forked` when
 *  `arm.use_mirror_x`) → `armature.fill` → modify cluster (`VIEW3D_MT_mirror`,
 *  `VIEW3D_MT_snap`, `armature.symmetrize`, `armature.switch_direction`) →
 *  parent cluster → delete.
 *
 *  SS's bone rest-edit doesn't expose armature-specific operators
 *  (`armature.fill`, `armature.symmetrize`, `armature.switch_direction`,
 *  `armature.extrude_forked` — none registered today). SS DOES have
 *  data-kind-agnostic `edit.duplicate` + `selection.delete` that route
 *  through Blender's `armature.duplicate_move` / `armature.delete`
 *  equivalents (the registry helpers operate on the editor's active
 *  selection regardless of dataKind), so we surface those parallel to
 *  the mesh list. `view.frameSelected` per the cross-list deviation
 *  documented in the module header. */
/** @type {ContextMenuItem[]} */
export const EDIT_ARMATURE_ITEMS = [
  { id: 'edit.duplicate',     label: 'Duplicate' },
  { id: 'selection.delete',   label: 'Delete' },
  { separator: true },
  { id: 'view.frameSelected', label: 'Frame Selected' },
];

/** Pose Mode → `VIEW3D_MT_pose_context_menu` (`:4409`).
 *
 *  Blender's full list: `anim.keyframe_insert` → `anim.keyframe_insert_menu`
 *  → `pose.copy` → `pose.paste`(flipped=false) → `pose.paste`(flipped=true)
 *  → `wm.call_panel(TOPBAR_PT_name)` (Rename Active Bone) → `pose.push`
 *  → `pose.relax` → `pose.breakdown` → `pose.blend_to_neighbor` →
 *  `pose.paths_calculate` / `pose.paths_clear` / `pose.paths_update` /
 *  `object.paths_update_visible` → `pose.hide` / `pose.reveal` →
 *  `pose.user_transforms_clear`.
 *
 *  SS registry currently exposes only the copy / paste / paste-flipped
 *  / clear-loc-rot-scale family. Omissions per Rule №1 (no stubs):
 *
 *    - `anim.keyframe_insert` / `_menu` — animation Phase 2 owes these.
 *    - `pose.push` / `pose.relax` / `pose.breakdown` /
 *      `pose.blend_to_neighbor` — pose-blending ops; not implemented.
 *    - `wm.call_panel(TOPBAR_PT_name)` — inline-rename popover; SS uses
 *      the Outliner double-click instead.
 *    - `pose.paths_*` — motion-path visualisation; not implemented.
 *    - `pose.hide` / `pose.reveal` — bone visibility (Blender's local
 *      hide); SS routes visibility through the Outliner H/Alt-H today.
 *    - `pose.user_transforms_clear` — SS's `pose.clearLocation/Rotation/
 *      Scale` cover the same ground per-channel.
 *
 *  SS surfaces `apply.menu` (Apply Pose As Rest) which Blender does NOT
 *  put in `VIEW3D_MT_pose_context_menu` (it lives in the header Pose
 *  menu). Deliberate deviation: SS's bake-rest flow is the most-asked
 *  operator in Pose Mode after copy/paste, and surfacing it from RMB
 *  cuts the click distance. */
/** @type {ContextMenuItem[]} */
export const POSE_ITEMS = [
  { id: 'pose.copy',              label: 'Copy Pose' },
  { id: 'pose.paste',             label: 'Paste Pose' },
  { id: 'pose.mirrorPose',        label: 'Paste X-Flipped Pose' },
  { separator: true },
  { id: 'pose.selectMirror',      label: 'Select Mirror' },
  { separator: true },
  { id: 'pose.clearLocation',     label: 'Clear Location' },
  { id: 'pose.clearRotation',     label: 'Clear Rotation' },
  { id: 'pose.clearScale',        label: 'Clear Scale' },
  { separator: true },
  { id: 'apply.menu',             label: 'Apply…' },
  { separator: true },
  { id: 'view.frameSelected',     label: 'Frame Selected' },
];

/** Weight Paint → analogue of `VIEW3D_PT_paint_weight_context_menu` (`:8836`).
 *
 *  Note `VIEW3D_PT_paint_weight_context_menu` is a **Panel** class
 *  (popover), not a `Menu` like the other four. Blender's paint modes
 *  use Panel-popovers because brush settings are sliders/checkboxes,
 *  not single-action menu rows. SS reaches for "spirit" parity here
 *  (per-mode contextual actions on RMB) rather than a literal port —
 *  brush sliders already live in SS's N-panel, so duplicating them in
 *  the RMB menu would just clutter without adding affordance. */
/** @type {ContextMenuItem[]} */
export const WEIGHT_PAINT_ITEMS = [
  { id: 'weightPaint.sample',              label: 'Sample Weight' },
  { separator: true },
  { id: 'weightPaint.mirror.byPosition',   label: 'Mirror Weights (by Position)' },
  { id: 'weightPaint.mirror.byName',       label: 'Mirror Weights (by Bone Name)' },
  { id: 'weightPaint.normalizeAll',        label: 'Normalize All' },
  { separator: true },
  { id: 'view.frameSelected',              label: 'Frame Selected' },
];

/**
 * Dispatch the item set + heading for the current `editMode`/`dataKind`
 * pair. `dataKind` is the active head's data kind via
 * `objectDataAccess.getDataKind` ('mesh' | 'armature' | 'empty' |
 * 'deformer' | null when no selection). Only Edit Mode discriminates
 * on it (Blender's pattern: one OB_MODE_EDIT slot, per-data menu).
 *
 * @param {string|null|undefined} editMode
 * @param {string|null|undefined} dataKind
 * @returns {{ items: ContextMenuItem[], heading: string }}
 */
export function pickItemSet(editMode, dataKind) {
  if (editMode === 'pose')        return { items: POSE_ITEMS,         heading: 'Pose' };
  if (editMode === 'weightPaint') return { items: WEIGHT_PAINT_ITEMS, heading: 'Weight Paint' };
  if (editMode === 'edit') {
    if (dataKind === 'armature')  return { items: EDIT_ARMATURE_ITEMS, heading: 'Armature' };
    return { items: EDIT_MESH_ITEMS, heading: 'Mesh' };
  }
  return { items: OBJECT_ITEMS, heading: 'Object' };
}
