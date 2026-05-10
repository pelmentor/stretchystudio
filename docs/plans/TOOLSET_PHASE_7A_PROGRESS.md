# Toolset Phase 7.A — Object Mode tools — PROGRESS

Status: **SHIPPED 2026-05-11** (initial `cdd3c93` + audit-fix `c9c35c3`).
Owner: pelmentor.
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md §7.A](./TOOLSET_BLENDER_PARITY_PLAN.md).

## What shipped

Five user-facing tool clusters per plan §7.A.1-5, each Blender-faithful
chord-bound + mounted in AppShell:

| # | Tool | Chord | Implementation |
|---|------|-------|----------------|
| 7.A.1 | Snap menu | `Shift+S` | 9 ops in `src/v3/operators/object/snap.js` + `SnapMenu.jsx` two-column popover |
| 7.A.2 | Mirror selected | `Ctrl+M` then `X`/`Y`/`Z` | `mirror.js` + `MirrorAxisMenu.jsx` two-step modal |
| 7.A.3 | Set Parent | `Ctrl+P` | `parent.js` `setParent()` reusing existing `reparentNode` |
| 7.A.4 | Clear Parent | `Alt+P` | `parent.js` `clearParent(mode)` + `ClearParentMenu.jsx` three-mode popover |
| 7.A.5 | Set Origin | (right-click submenu) | `setOrigin.js` four modes + `SetOriginMenu.jsx` |

## Schema bump v33

`project.cursor: { x, y }` — canvas-space 3D-cursor analog for Snap menu.
Default = canvas centre. Persisted per-project (Blender stores it on
`Scene.cursor.location`; SS does the same on `project.cursor`).
Migration in `src/store/migrations/v33_project_cursor.js`. New
`setProjectCursor(x, y)` mutator on `projectStore`.

## Audit-fix sweep details (`c9c35c3`)

Two parallel agents audited initial `cdd3c93`:
- [AUDIT_2026_05_10_TOOLSET_PHASE7A_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE7A_ARCH.md)
  — 4 gaps (2 HIGH, 1 MED, 1 LOW)
- [AUDIT_2026_05_10_TOOLSET_PHASE7A_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE7A_BLENDER.md)
  — 13 gaps (3 HIGH, 5 MED, 5 LOW)

17 total: 5 HIGH, 6 MED, 6 LOW. **All HIGH addressed.** MED+LOW: 10 FIX,
5 DOCUMENT-AS-DEVIATION.

### Architecture HIGH

- **G-1** — All 8 `beginBatch()` calls passed no `project` →
  `pushSnapshot(undefined)` → Ctrl+Z silent no-op for the entire 7.A
  surface. Fix: pass already-captured `project` in all sites.
- **G-2** — `applySetOrigin` shifts mesh.vertices in-place to compensate
  for gizmo move; bumps `vc.geometryVersion++`. But `meshSignature`
  hashes count + UV hash, not positions; `signaturesEqual` returned true
  → no GPU re-upload → mesh stayed at pre-Set-Origin positions. Fix:
  per-part `lastUploadedGeomVersionRef` tracker; mesh-sync useEffect
  bypasses signature guard when `versionControl.geometryVersion`
  advances. Dep array includes `geometryVersion` so the effect re-fires.

### Architecture MED

- **G-3** — Esc handler in SnapMenu / ClearParentMenu / SetOriginMenu
  called `preventDefault` but not `stopPropagation` → bubble-phase
  dispatcher fired `selection.clear` after every Esc-dismiss
  (MirrorAxisMenu was already immunized). Fix: `stopPropagation` in all
  three Esc branches.

### Architecture LOW

- **G-4 (DOCUMENT-AS-DEVIATION)** — `Shift+S` has no Edit Mode gate;
  serves Object Mode menu in all modes. Blender opens
  `VIEW3D_MT_snap` for vertex/edge/face in Edit Mode. Defer until Phase
  7.B vertex-snap ships.

### Blender-fidelity HIGH

- **D-1** — `clearParent('inverse')` previously fell through to plain
  clear, silently unparenting the child. Per
  `object_relations.cc:411-420` Blender's `CLEAR_PARENT_INVERSE` keeps
  `ob->parent` and only resets `parentinv`. SS has no parentinv field.
  Fix: no-op + toast; the parent stays.
- **D-2** — `medianOfOrigins` computed per-axis statistical median.
  Blender's `view3d_snap.cc:910-1013` uses arithmetic mean. For 3+
  asymmetric origins the two functions return different points (audit
  example: (0,0)/(100,0)/(200,100) → median (100,0) vs mean (100,33.3)).
  Renamed to `meanOfOrigins`; old name removed per Rule №2.
- **D-3** — SnapMenu shipped 9 items. Blender's `VIEW3D_MT_snap_pie`
  per `space_view3d.py:6181-6203` has exactly 8. "Selection to World
  Origin" had no counterpart. Removed from menu; underlying operator
  stays for command-palette.

### Blender-fidelity MED

- **D-4..D-8 (FIX)** — Source citation drift corrected throughout: snap
  ops cited wrong file (`object_transform.cc:760+` was Apply Transform
  exec), `OBJECT_OT_origin_set` wrong line (was `:760+`, actual `:1873`),
  `OBJECT_OT_parent_set` wrong line (was `:475+`, actual `:1100`),
  `OBJECT_OT_parent_clear` wrong line (was `:294+`, actual `:444`),
  `VIEW3D_MT_snap_pie` wrong line (was `:6377-6411`, actual
  `:6181-6203`).

### Blender-fidelity LOW

- **D-9 (FIX)** — `TRANSFORM_OT_mirror` cited `transform_ops.cc:1047+`
  (inside `TRANSFORM_OT_bend`); actual is `:1172`. Corrected throughout.
- **D-10 (DOCUMENT-AS-DEVIATION)** — `meshMedian` ignores
  `transform_pivot_point` (SS has no setting; Blender switches median↔bbox).
- **D-11 (DOCUMENT-AS-DEVIATION)** — `meshBBoxCenter` approximates
  "Surface" centroid (Blender uses area-weighted; bbox is reasonable
  for 2D polygons).
- **D-12 (DOCUMENT-AS-DEVIATION)** — "Geometry to Origin" not shipped;
  would require origin-stays-put plumbing (opposite of `applySetOrigin`).
- **D-13 (DOCUMENT-AS-DEVIATION)** — Cursor defaults to canvas centre;
  Blender's `View3DCursor.location` defaults to (0,0,0). Canvas-space
  origin (top-left) is unusable as a cursor default.

## Test scoreboard

All 8 Phase 7.A suites green; sister suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_objectMode_snapMenu`                         | 40 |
| `test_objectMode_mirror`                           | 24 |
| `test_objectMode_parent`                           | 15 |
| `test_objectMode_clearParent`                      | 17 (was 15; +2 for D-1) |
| `test_objectMode_setOrigin`                        | 24 |
| `test_objectMode_menu_store`                       | 18 |
| `test_migrationV33`                                | 9  |
| **`test_audit_fixes_2026_05_10_phase7a` (NEW)**    | **50** |
| **Phase 7.A total post-audit-fix**                 | **197** |
| undoHistory (regression-checked)                   | 22 |
| migrations                                         | 135 |
| reparentNode                                       | 9  |
| editorStore                                        | 87 |
| applyMenuStore                                     | 28 |

## Manual gate (Phase 7.A.6)

Browser-side. Suggested checks:

- **Snap menu**: Select 2 objects → `Shift+S` → menu opens with 8 items.
  "Selection to Cursor" → both objects move to cursor; Ctrl+Z reverses
  (audit fix G-1). "Selection to Cursor (Keep Offset)" → median moves to
  cursor; per-object offsets preserved.
- **Mirror**: Select 2-3 objects → `Ctrl+M` → axis menu opens. Press
  `X` → objects mirror through mean-X axis; rotation flips, scaleX flips
  sign. Esc dismisses without mirroring (audit fix G-3 — selection
  preserved).
- **Set Parent**: Select 2 objects → `Ctrl+P` → second selected becomes
  parent of first; visual position preserved. Cycle attempt rejected.
- **Clear Parent**: With parented selection → `Alt+P` → menu opens.
  "Clear and Keep Transform" → child unparents, visual stays. "Clear
  Parent Inverse" → toast appears, parent NOT cleared (audit fix D-1).
- **Set Origin**: Select a meshed top-level part → run via command
  palette `Set Origin Menu` → "Origin to Geometry" → gizmo jumps to
  mesh centroid, mesh visually unchanged (audit fix G-2 — mesh GPU
  re-uploads correctly now).
- **Schema persistence**: Move cursor via "Cursor to Selected" → save +
  reload `.stretch` → cursor stays at saved position.

## Hotkey additions (Phase 7.A)

- `Shift+KeyS` → `object.snap.menu`
- `Ctrl+KeyM` / `Meta+KeyM` → `object.mirror.menu`
- `Ctrl+KeyP` / `Meta+KeyP` → `object.parent.set`
- `Alt+KeyP` → `object.parent.clearMenu`

(Set Origin has no chord; surfaced via right-click context menu /
command palette per Blender — Blender doesn't bind `OBJECT_OT_origin_set`
to a chord either.)
