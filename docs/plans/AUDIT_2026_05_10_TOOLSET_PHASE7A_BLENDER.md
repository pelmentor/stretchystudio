# Phase 7.A Blender-Fidelity Audit (2026-05-10)

Reviewed commit `cdd3c93` — Phase 7.A Object Mode tools (Snap / Mirror /
Parent / Clear Parent / Set Origin). Verified against `reference/blender/`
source files. All cited line numbers were opened and checked.

## Summary

13 gaps found: **3 HIGH**, **5 MEDIUM**, **5 LOW**.

| ID   | Sev  | One-line | Action |
|------|------|----------|--------|
| D-1  | HIGH | `CLEAR_PARENT_INVERSE` removes the parent in SS; Blender keeps the object parented and only clears parentinv | FIX |
| D-2  | HIGH | `medianOfOrigins` uses statistical median (sorted-coordinate middle); Blender's "Cursor to Selected" and "Snap to Cursor Keep Offset" use arithmetic mean (sum/count) | FIX |
| D-3  | HIGH | SnapMenu has 9 items — "Selection to World Origin" is an extra not in Blender's `VIEW3D_MT_snap_pie` (8 items) | FIX |
| D-4  | MED  | snap.js + setOrigin.js cite `object_transform.cc:760+` for snap operators; snap operators live in `view3d_snap.cc`; line 760 of object_transform.cc is inside the Apply Transform exec | FIX (cite) |
| D-5  | MED  | Keymap cites `blender_default.py:4527/4544/4546/4548`; actual lines: Shift+S=1833, Ctrl+M=4512 (template), Ctrl+P=4509, Alt+P=4510 | FIX (cite) |
| D-6  | MED  | `space_view3d.py:6377-6411` cited for `VIEW3D_MT_snap_pie`; actual location is lines 6181-6203 | FIX (cite) |
| D-7  | MED  | `object_relations.cc:294+` cited for `OBJECT_OT_parent_clear`; line 294 is `OBJECT_OT_vertex_parent_set`; Clear Parent enum starts at 315, registration at 444 | FIX (cite) |
| D-8  | MED  | `object_relations.cc:475+` cited for `OBJECT_OT_parent_set`; line 475 is inside `parent_set()` helper; `OBJECT_OT_parent_set` registration is at line 1100 | FIX (cite) |
| D-9  | LOW  | `transform_ops.cc:1047+` cited for `TRANSFORM_OT_mirror`; line 1047 is inside `TRANSFORM_OT_bend`; `TRANSFORM_OT_mirror` is at line 1172 | FIX (cite) |
| D-10 | LOW  | "Origin to Geometry" mode uses plain arithmetic mean; Blender's `ORIGIN_GEOMETRY` pivots through `scene->toolsettings->transform_pivot_point` (median OR bounds) | DOCUMENT-AS-DEVIATION |
| D-11 | LOW  | "Origin to Center of Mass (Surface)" uses bbox center; Blender uses `BKE_mesh_center_of_surface` (area-weighted centroid) | DOCUMENT-AS-DEVIATION |
| D-12 | LOW  | "Geometry to Origin" not shipped; Blender's `GEOMETRY_TO_ORIGIN` (moves geometry to gizmo) is the first item in Blender's Set Origin menu | DOCUMENT-AS-DEVIATION |
| D-13 | LOW  | Cursor defaults to canvas center `(cw/2, ch/2)` in SS; Blender's `View3DCursor.location[3] = {}` initializes to (0,0,0) | DOCUMENT-AS-DEVIATION |

---

## HIGH

### D-1: `CLEAR_PARENT_INVERSE` unparents the child — Blender keeps it parented

**File**: `src/v3/operators/object/parent.js:137-178` (the `clearParent` function)

**Severity**: HIGH — the operator label "Clear Parent Inverse" tells the user the parent relationship is preserved, but the actual behavior removes the parent entirely.

**Blender ref**: `reference/blender/source/blender/editors/object/object_relations.cc:411-420`

```c
case CLEAR_PARENT_INVERSE: {
  /* object stays parented, but the parent inverse
   * (i.e. offset from parent to retain binding state)
   * is cleared. In other words: nothing to do here! */
  break;
}
/* Always clear parentinv matrix for sake of consistency, see #41950. */
unit_m4(ob->parentinv);
```

**Current SS behavior**: `clearParent('inverse')` falls through to `reparentNode(childId, null)` (line 158), which removes the parent. The comment at line 172 acknowledges this: `'inverse' falls through to plain clear`.

**Blender behavior**: `CLEAR_PARENT_INVERSE` keeps `ob->parent` intact. It only resets `ob->parentinv` to identity (the matrix that converts parent-space to world at bind time). The object remains parented; its visual position snaps because the binding offset is wiped, but the hierarchy is unchanged.

**Fix**: In `clearParent`, guard the `reparentNode(childId, null)` call so it is NOT reached when `mode === 'inverse'`. SS does not model parentInv as a separate field, so the correct minimal fix per Rule 1 is to emit a toast and exit without touching `node.parent`. Do NOT silently clear the parent.

**Why this matters**: A Blender user pressing Alt+P → "Clear Parent Inverse" expects to stay parented but lose the binding offset. SS gives them an unparented object with no warning. The hierarchy change is irreversible without Undo.

---

### D-2: `medianOfOrigins` uses statistical median; Blender uses arithmetic mean

**File**: `src/v3/operators/object/snap.js:127-143` (`medianOfOrigins`), called from `snapSelectionToWorldPointKeepOffset`, `snapCursorToSelected`

**Severity**: HIGH — produces numerically different pivot positions for any selection of 3+ objects in non-symmetric configurations.

**Blender ref**: `reference/blender/source/blender/editors/space_view3d/view3d_snap.cc:910-1013` (`snap_curs_to_sel_ex`)

```c
// non-bounds pivot path:
add_v3_v3(centroid, vec);   // accumulate sum
// ...
mul_v3_fl(centroid, 1.0f / float(count));  // divide by count → arithmetic mean
copy_v3_v3(r_cursor, centroid);
```

**Current SS behavior**: `medianOfOrigins` sorts the X coordinates independently, sorts the Y coordinates independently, then picks the middle elements. This is the statistical median, which treats X and Y as independent distributions and produces a point that may not correspond to any real object origin.

**Blender behavior**: Arithmetic mean — sum all world origins, divide by count. For 3 objects at (0,0), (100,0), (200,100): SS gives median X=100, median Y=0 → (100, 0). Blender gives mean (100, 33.3). The JSDoc at line 119 claims "Median (not centroid) matches Blender" — this is incorrect.

**Fix**: Replace `medianOfOrigins` with an arithmetic mean. The name should change to `meanOfOrigins` or `centroidOfOrigins`. All call sites need updating.

**Why this matters**: Mirror pivot, Keep-Offset snap anchor, and Cursor-to-Selected all use this function. A wrong pivot means objects appear to jump to unexpected positions.

---

### D-3: SnapMenu has extra "Selection to World Origin" item not in Blender's pie

**File**: `src/v3/shell/SnapMenu.jsx:27-32` (`COLUMN_LEFT`)

**Severity**: HIGH — the menu has 9 items (5 left + 4 right) but Blender's `VIEW3D_MT_snap_pie` has exactly 8.

**Blender ref**: `reference/blender/scripts/startup/bl_ui/space_view3d.py:6181-6203`

```python
pie.operator("view3d.snap_cursor_to_grid", text="Cursor to Grid", ...)
pie.operator("view3d.snap_selected_to_grid", text="Selection to Grid", ...)
pie.operator("view3d.snap_cursor_to_selected", text="Cursor to Selected", ...)
pie.operator("view3d.snap_selected_to_cursor", ...).use_offset = False
pie.operator("view3d.snap_selected_to_cursor", ...).use_offset = True
pie.operator("view3d.snap_selected_to_active", text="Selection to Active", ...)
pie.operator("view3d.snap_cursor_to_center", text="Cursor to World Origin", ...)
pie.operator("view3d.snap_cursor_to_active", text="Cursor to Active", ...)
```

**Current SS behavior**: SS left column contains `Cursor`, `Cursor (Keep Offset)`, `Grid`, `World Origin`, `Active` — 5 items. "World Origin" (`object.snap.selectionToWorldOrigin`) has no counterpart in Blender's snap pie.

**Blender behavior**: Blender ships no "Selection to World Origin" snap operator in its pie. The closest is "Cursor to World Origin" (moving the cursor, not objects). A user can achieve "Selection to World Origin" by combining "Cursor to World Origin" + "Selection to Cursor", but there's no direct operator for it.

**Fix**: Remove `{ id: 'object.snap.selectionToWorldOrigin', label: 'World Origin' }` from `COLUMN_LEFT`. The underlying operator can remain for command-palette access, but it should not appear in the snap menu popover.

**Why this matters**: The snap menu is the primary parity surface for this phase. A user cross-referencing the Blender docs will see a menu item that doesn't exist in Blender, and miss that SS matches the canonical 8-item layout.

---

## MEDIUM

### D-4: snap.js / setOrigin.js cite wrong source file for snap and origin operators

**File**: `src/v3/operators/object/snap.js:8-10`; `src/v3/operators/object/setOrigin.js:8-9`

**Severity**: MEDIUM — citation drift; future audit sweeps and "cite correction" passes will target the wrong lines.

**Blender ref**:
- Snap operators (`VIEW3D_OT_snap_selected_*`, `VIEW3D_OT_snap_cursor_*`): `reference/blender/source/blender/editors/space_view3d/view3d_snap.cc` (lines 271-1121).
- `OBJECT_OT_origin_set`: `reference/blender/source/blender/editors/object/object_transform.cc:1873`.

**Fix**: Update cites:
- `snap.js` module header: `view3d_snap.cc`
- `setOrigin.js` module header: `object_transform.cc:1873` for `OBJECT_OT_origin_set`.
- `registry.js` snap.menu comment: `space_view3d.py:6181` for `VIEW3D_MT_snap_pie`.

---

### D-5: All four keymap line-number cites in `default.js` are wrong

**File**: `src/v3/keymap/default.js:223-249`

**Severity**: MEDIUM — four separate keymap comments point to wrong lines in `blender_default.py`.

Cited vs actual:

| Chord | SS cite | Actual line | What's at the cited line |
|-------|---------|-------------|--------------------------|
| `Shift+S` snap pie | `:4527` | 1833 (in `km_view3d_generic`) | Line 4527: `object.delete` with `use_global=True, confirm=False` |
| `Ctrl+M` mirror | `:4544` | 4512 (via `_template_items_transform_actions`) | Line 4544: `collection.objects_add_active` |
| `Ctrl+P` parent set | `:4546` | 4509 | Line 4546: `_template_items_object_subdivision_set()` call |
| `Alt+P` parent clear | `:4548` | 4510 | Line 4548: `OBJECT_MT_link_to_collection` |

Additional nuance for Shift+S: the snap pie binding is in `km_view3d_generic`, NOT in the Object Mode keymap section.

**Fix**: Update the four cite comments in `default.js`. Change the Shift+S comment to "3D View Generic keymap (all modes)".

---

### D-6: `space_view3d.py:6377-6411` cited for `VIEW3D_MT_snap_pie` is ~200 lines off

**Files**: `src/v3/shell/SnapMenu.jsx:12`; `src/v3/operators/registry.js` snap.menu comment

**Severity**: MEDIUM — the cited range (6377-6411) is `VIEW3D_PT_view3d_properties`, entirely unrelated to the snap pie.

**Blender ref**: `reference/blender/scripts/startup/bl_ui/space_view3d.py:6181-6203`.

**Fix**: Update cites to `space_view3d.py:6181-6203` in both files.

---

### D-7: `object_relations.cc:294+` cited for `OBJECT_OT_parent_clear` is wrong

**Files**: `src/v3/operators/object/parent.js:122`; `src/v3/shell/ClearParentMenu.jsx:8`

**Severity**: MEDIUM — line 294 of `object_relations.cc` is `OBJECT_OT_vertex_parent_set` (vertex parenting, unrelated). The Clear Parent types enum starts at line 315; `OBJECT_OT_parent_clear` registration is at line 444.

**Fix**: Update cites to `object_relations.cc:444`.

---

### D-8: `object_relations.cc:475+` cited for `OBJECT_OT_parent_set` is wrong

**Files**: `src/v3/operators/object/parent.js:8`; `src/v3/keymap/default.js:241`

**Severity**: MEDIUM — line 475 of `object_relations.cc` is inside the `parent_set()` data helper. `OBJECT_OT_parent_set` operator registration is at line 1100.

**Fix**: Update cites to `object_relations.cc:1100`.

---

## LOW

### D-9: `transform_ops.cc:1047+` cited for `TRANSFORM_OT_mirror` is inside `TRANSFORM_OT_bend`

**Files**: `src/v3/operators/object/mirror.js:8`; `src/v3/shell/MirrorAxisMenu.jsx:13`; `src/v3/keymap/default.js:233`

**Severity**: LOW — line 1047 is inside `TRANSFORM_OT_bend`. `TRANSFORM_OT_mirror` definition starts at line 1172.

**Fix**: Update cites to `transform_ops.cc:1172`.

---

### D-10 (DOCUMENT-AS-DEVIATION): "Origin to Geometry" hardcodes median; Blender respects pivot point setting

**File**: `src/v3/operators/object/setOrigin.js:281`; `src/v3/shell/SetOriginMenu.jsx:40`

**Severity**: LOW — in practice, Blender users working on meshes in Object Mode almost always have pivot set to Median Point.

**Blender ref**: `reference/blender/source/blender/editors/object/object_transform.cc:1315-1330`

**Fix**: (DOCUMENT-AS-DEVIATION) SS has no concept of a persistent transform pivot point setting. The canvas-center fallback is intentional. Add a comment in `setOrigin.js` near `meshMedian` call.

---

### D-11 (DOCUMENT-AS-DEVIATION): "Origin to Center of Mass (Surface)" uses bbox center; Blender uses area-weighted centroid

**File**: `src/v3/operators/object/setOrigin.js:128-139`; `src/v3/shell/SetOriginMenu.jsx:42`

**Severity**: LOW — the label says "Surface" but `meshBBoxCenter` returns AABB midpoint.

**Blender ref**: `reference/blender/source/blender/editors/object/object_transform.cc:1463-1464`

**Fix**: (DOCUMENT-AS-DEVIATION) Implementing area-weighted centroid in 2D requires per-triangle area calculation. The bbox approximation is reasonable for 2D polygon shapes. Update the SetOriginMenu.jsx comment to clarify the approximation.

---

### D-12 (DOCUMENT-AS-DEVIATION): "Geometry to Origin" not shipped; it is the first item in Blender's Set Origin menu

**File**: `src/v3/shell/SetOriginMenu.jsx:15-18` (comment acknowledges this)

**Severity**: LOW — explicitly documented in `SetOriginMenu.jsx:15-18` as not shipped.

**Fix**: (DOCUMENT-AS-DEVIATION) Already documented. Consider adding a disabled/greyed menu item with label "Geometry to Origin (not in v1)".

---

### D-13 (DOCUMENT-AS-DEVIATION): Cursor defaults to canvas center; Blender defaults to world origin (0,0,0)

**File**: `src/v3/operators/object/snap.js:68-70` (`readCursor` fallback); `src/store/migrations/v33_project_cursor.js`

**Severity**: LOW — only affects users loading pre-v33 saves.

**Fix**: (DOCUMENT-AS-DEVIATION) In a canvas-space system, world origin (0,0) is the top-left corner — not a useful default for a rigging tool where all content is near the canvas center. The canvas-center fallback is intentional and user-friendly. Update the `readCursor` comment to note the deliberate deviation.

---

## Keymap collision scan (Phase 7.A)

No collision between Phase 7.A chords and any existing Phase 1–6 bindings was found.
`Shift+S` was unbound (confirmed); `Ctrl+M`, `Ctrl+P`, `Alt+P` are new in Object Mode context.

**Sister chord check (per D-2 lesson from Phase 6)**:

- Blender's `Ctrl+P` (parent set) has no `Shift+Ctrl+P` variant in `blender_default.py` (legacy mode has `object.parent_no_inverse_set` at `Shift+Ctrl+P` but it's legacy-only). No missing binding.
- Blender's `Ctrl+M` (mirror) has no `Alt+M` counter.
- Blender's `Alt+P` (clear parent) has no sister chord.

No sister-chord gaps to fix.
