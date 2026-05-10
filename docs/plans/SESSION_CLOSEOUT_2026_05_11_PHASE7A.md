# Session Close-out — 2026-05-11 (Phase 7.A sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_10_PHASE6.md](./SESSION_CLOSEOUT_2026_05_10_PHASE6.md).
This sub-session shipped Toolset **Phase 7.A + Phase 7.A audit-fix sweep**
(seventh audit sweep over the toolset plan). Branch ahead of `origin/master`
by 24 commits at HEAD `c9c35c3`.

## What shipped this sub-session (3 commits)

### Toolset Blender-Parity Plan — Phase 7.A + audit-fix

| Commit  | What |
|---------|------|
| `cdd3c93` | Phase 7.A initial — Snap menu (Shift+S, 9 ops) + Mirror (Ctrl+M two-step) + Set Parent (Ctrl+P) + Clear Parent (Alt+P three-mode) + Set Origin (right-click 4-mode). Schema bump v33 (`project.cursor`). 145 spec assertions across 7 test suites. |
| `c9c35c3` | Phase 7.A audit-fix sweep — 5 HIGH (2 arch + 3 Blender) + 6 MED + 6 LOW gaps closed. 12 FIXes + 5 DOCUMENT-AS-DEVIATION (Rule №1). 50-assertion audit-pin test (197 total Phase 7.A). |

(Close-out doc commit follows separately.)

## Audit-fix sweep details (`c9c35c3`)

Full per-gap details in
[TOOLSET_PHASE_7A_PROGRESS.md](./TOOLSET_PHASE_7A_PROGRESS.md)
§"Audit-fix sweep details". Headlines:

### Architecture HIGH

- **G-1** — All 8 `beginBatch()` calls in Phase 7.A passed no `project`
  argument. `pushSnapshot(undefined)` pushed `{project: undefined}` as
  the pre-gesture snapshot; on Ctrl+Z `Object.assign(target, undefined)`
  is a spec no-op. **Every Phase 7.A multi-node mutation was permanently
  non-undoable.** Fix: pass `project` (already captured one line above)
  in all 8 sites.
- **G-2** — `applySetOrigin` mutates `mesh.vertices` in place to
  compensate for gizmo move; bumps `vc.geometryVersion++`. But
  `meshSignature` hashes count + UV hash, not positions →
  `signaturesEqual` returned true → no GPU re-upload → mesh rendered
  at pre-Set-Origin positions. Fix: per-part `lastUploadedGeomVersionRef`
  tracker; mesh-sync `useEffect` bypasses signature guard when the
  project's counter has advanced.

### Architecture MED

- **G-3** — Esc handler in SnapMenu / ClearParentMenu / SetOriginMenu
  called `preventDefault` but not `stopPropagation` → bubble-phase
  dispatcher fired `selection.clear` after every Esc-dismiss. Fix:
  `stopPropagation` added in all three. (MirrorAxisMenu was already
  immunized — same bug pattern caught by Phase 6 audit G-4/G-5.)

### Architecture LOW

- **G-4 (DOCUMENT-AS-DEVIATION)** — `Shift+S` no Edit Mode gate.
  Defer until Phase 7.B vertex-snap ships.

### Blender-fidelity HIGH

- **D-1 (FIX)** — `clearParent('inverse')` was unparenting the child;
  Blender's `CLEAR_PARENT_INVERSE` keeps `ob->parent` and only resets
  `parentinv` (per `object_relations.cc:411-420`). SS has no parentinv
  field → no-op + toast; parent stays.
- **D-2 (FIX)** — `medianOfOrigins` was per-axis statistical median;
  Blender's `view3d_snap.cc:910-1013` uses arithmetic mean. Renamed
  to `meanOfOrigins`; old name dropped per Rule №2.
- **D-3 (FIX)** — SnapMenu shipped 9 items; Blender's
  `VIEW3D_MT_snap_pie` per `space_view3d.py:6181-6203` has 8. Removed
  "Selection to World Origin" from menu (operator stays registered).

### Blender-fidelity MED

- **D-4..D-8 (FIX)** — Source citation drift. `view3d_snap.cc` is the
  correct file for snap operators (was wrongly `object_transform.cc:760+`).
  `OBJECT_OT_origin_set` is at `:1873`, `OBJECT_OT_parent_set` at
  `:1100`, `OBJECT_OT_parent_clear` at `:444`, `VIEW3D_MT_snap_pie` at
  `:6181-6203`. All 4 keymap line cites in `default.js` were also
  wrong; corrected throughout.

### Blender-fidelity LOW

- **D-9 (FIX)** — `TRANSFORM_OT_mirror` cited `:1047+` (inside
  `TRANSFORM_OT_bend`); actual is `:1172`.
- **D-10..D-13 (DOCUMENT-AS-DEVIATION)** — `meshMedian` ignores
  `transform_pivot_point`; `meshBBoxCenter` approximates "Surface";
  "Geometry to Origin" not shipped; cursor defaults to canvas centre.

Audit docs on disk:
- [AUDIT_2026_05_10_TOOLSET_PHASE7A_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE7A_ARCH.md) — 4 gaps (2 HIGH, 1 MED, 1 LOW)
- [AUDIT_2026_05_10_TOOLSET_PHASE7A_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE7A_BLENDER.md) — 13 gaps (3 HIGH, 5 MED, 5 LOW)

## Test scoreboard

All 8 Phase 7.A suites green; sister suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_objectMode_snapMenu`                                              | 40  |
| `test_objectMode_mirror`                                                | 24  |
| `test_objectMode_parent`                                                | 15  |
| `test_objectMode_clearParent` (audit-extended +2 for D-1)               | 17  |
| `test_objectMode_setOrigin`                                             | 24  |
| `test_objectMode_menu_store`                                            | 18  |
| `test_migrationV33`                                                     | 9   |
| **`test_audit_fixes_2026_05_10_phase7a` (NEW — pins 5 HIGH + 12 MED/LOW)** | **50** |
| **Phase 7.A total post-audit-fix**                                      | **197** |
| migrations                                                              | 135 |
| reparentNode                                                            | 9   |
| editorStore                                                             | 87  |
| undoHistory                                                             | 22  |
| applyMenuStore (sister popover)                                         | 28  |

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged. Depgraph coherent post Phase 0 audit-fix; Phase 0.D flag
flip is gated on user-side manual byte-fidelity sweep on Shelby +
test_image4 PSDs.

### B. Manual gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E + 6.F + 7.A.6

Eight manual gates queued (browser-side). Phase 7.A.6 highlights:
- Snap menu (Shift+S): 8 items, undoable via Ctrl+Z (audit G-1)
- Mirror (Ctrl+M): mean-pivot reflection (audit D-2 fix)
- Parent (Ctrl+P): visual position preserved
- Clear Parent (Alt+P): "Inverse" mode toasts (audit D-1)
- Set Origin: mesh re-uploads correctly to GPU (audit G-2)

### C. Toolset Phase 7.B — Weight Paint tools (4–5 days)

Next autonomous chunk per plan §7.B:
- 7.B.1 Sample Weight (`Shift+X`) — eyedropper
- 7.B.2 Blur brush — neighbor-averaging weight smoothing
- 7.B.3 Mirror Weights — by topology + by group name
- 7.B.4 X-Axis Mirror toggle — live mirror during paint stroke
- 7.B.5 Normalize All — menu-only (Ctrl+N collides with file.new)

Phase 7.B has 1 schema bump (`vTB+2` = `node.weightPaintSettings`)
plus a `Shift+X` keymap addition. No popover infrastructure needed
(brush-list extension + N-panel toggle).

### D. Toolset Phase 7.C — Pose Mode tools (3–4 days)

Per plan §7.C: Clear Pose Loc/Rot/Scale (Alt+G/R/S), Clear All Pose
(3 chords), Select Mirror (Ctrl+Shift+M) + Mirror Pose (Ctrl+Shift+V),
Copy/Paste Pose. Adds new `poseClipboardStore`. No schema bump.

## Hotkey reservations (Phase 7.A additions)

- `Shift+KeyS` = `object.snap.menu` ✅ shipped
- `Ctrl+KeyM` / `Meta+KeyM` = `object.mirror.menu` ✅ shipped
- `Ctrl+KeyP` / `Meta+KeyP` = `object.parent.set` ✅ shipped
- `Alt+KeyP` = `object.parent.clearMenu` ✅ shipped

(Set Origin has no chord — surfaced via context menu / command palette.
Matches Blender, which doesn't bind `OBJECT_OT_origin_set` to a chord.)

Forthcoming Phase 7 reservations (per plan, not yet bound):
- `Shift+X` = `weightPaint.sample` (Phase 7.B)
- `Alt+G` / `Alt+R` / `Alt+S` = `pose.clear{Loc,Rot,Scale}` (Phase 7.C)
- `Alt+Shift+G` / `Alt+Shift+R` / `Alt+Shift+S` = `pose.clearAll*` (Phase 7.C)
- `Ctrl+Shift+M` = `pose.selectMirror` (Phase 7.C)
- `Ctrl+Shift+V` = `pose.mirrorPose` (Phase 7.C)
- `Ctrl+N` NOT bound to Normalize All (collides with file.new); Phase 7.B
  ships menu-only

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (24 from 2026-05-10 close-out) | Phases 0/1/2/3/4/5/6 ship + audit-fixes + close-outs |
| 25    | `cdd3c93` | toolset Phase 7.A — Object Mode tools (Snap / Mirror / Parent / Clear Parent / Set Origin) |
| 26    | `c9c35c3` | audit-fix sweep #7 — Phase 7.A dual audit (5 HIGH + 12 MED/LOW) |
