# Session close-out — 2026-05-16 (round 3)
# UI Blender-fidelity sweep ROUND 3 — Audit 4 #3 (File menu) + Audit 4 #4 (Modal G/R/S chords)

## Status

Continuation of the 2026-05-16 master session. Resumed from `7961086`
(`SESSION_CLOSEOUT_2026_05_16_FULL_UI_SWEEP.md`'s queued resume paths)
and shipped the top 2 picks from the cross-audit priority list. **2
commits**, 259 / 259 scripts green at HEAD, typecheck clean. Both
commits pushed to `origin/master`.

| # | Commit | Thread | What landed |
|---|--------|--------|-------------|
| 1 | `f43efa9` | UI sweep R3 | Audit 4 #3 — File menu dropdown mirroring `INFO_MT_file` |
| 2 | `86f2c2f` | UI sweep R3 | Audit 4 #4 — Modal G/R/S chord parity with Blender (4 sub-fixes) |
| 3 | this    | docs       | Round 3 close-out |

## Resume context

User typed `Go` after `/compact`. Per Rule №3 (question agents not user),
no clarification asked — picked the doc's explicit recommendation: "Path
B: UI sweep ROUND 3 — top picks Audit 4 #3 (file menu) + Audit 4 #4
(modal chord fixes) for immediate muscle-memory wins."

## Thread A — Audit 4 #3 (File menu dropdown)

Replaces the 6-icon strip (New / Save / Open / Export / Canvas Props /
Settings) with a structured `<FileMenu>` dropdown after Blender's
`INFO_MT_file` (`reference/blender/scripts/startup/bl_ui/space_topbar.py:
157-215`). Canvas Properties stays as a discrete icon — render-context,
not file-context.

### Menu structure

| Entry | Operator / Action | Shortcut | Source for the choice |
|-------|-------------------|----------|------------------------|
| New Project | `file.new` → open NewProjectDialog | Ctrl+N | INFO_MT_file:164 |
| Open… | `file.load` → open LoadModal | Ctrl+O | INFO_MT_file:165 |
| Open Recent ▶ | listSavedProjects()[:8], lazy on hover | — | INFO_MT_file:166 |
| ─── sep ─── | | | INFO_MT_file:170 |
| Save | `file.save` (overwrites linked record) | Ctrl+S | INFO_MT_file:173 |
| Save As… | `file.saveAs` (always new record) | Ctrl+Shift+S | INFO_MT_file:176 |
| ─── sep ─── | | | |
| Import PSD… | `file.importPsd` (transient input + dispatch) | — | INFO_MT_file:198 |
| Export Live2D… | `file.export` (open ExportModal) | Ctrl+E | INFO_MT_file:199 |
| ─── sep ─── | | | |
| Inspect .cmo3… | `file.inspectCmo3` | — | SS-specific |
| ─── sep ─── | | | |
| Preferences | open PreferencesModal | — | INFO_MT_file:211 (defaults sub) |

Deferred (no backing data layer yet, would violate Rule №1):
- Revert — needs reload-from-disk for linked records.
- Save Copy — needs a "don't update currentLibraryId after save" flag in PersistenceService.
- Quit — N/A for browser app.

### Wire-up details

- **`file.saveAs`** — new operator, `Ctrl+Shift+S` keymap (Blender's
  `wm.save_as_mainfile`). Opens SaveModal with `saveAs:true` flag on
  libraryDialogStore. Modal reads the flag non-reactively at open
  time, skips the linked-record name autofill, and passes `null` as
  the target id so the typed name always creates a new record.
- **`file.importPsd`** — new operator. Spawns a transient
  `<input type="file" accept=".psd">`, parses, then routes through
  `PsdImportService.start` (character PSDs) or directly to
  `finalizePsdImport` via `captureStore` (plain PSDs). Mirrors the
  empty-canvas drop-zone code path in CanvasViewport's
  `processPsdFile`. Available gate: `finalizePsdImport` published.
- **`file.new`** — refactored. Was silently calling `resetProject()`,
  bypassing the template picker + dirty warning that the topbar button
  showed. Now routes through new `newProjectDialogStore.openDialog()`,
  so menu + Ctrl+N + command palette all share the same UX. Fixes a
  pre-existing chord-vs-button asymmetry.
- **`libraryDialogStore.saveAs`** — new boolean flag with
  `openSaveAs()` action. Cleared on `close()` so the next openSave()
  defaults back to overwrite mode.
- **`newProjectDialogStore`** — new tiny store, lifts the New Project
  dialog open-state out of Topbar's local useState. Sister to
  libraryDialogStore / exportModalStore.

### Tests

+21 assertions in `test_v3Operators.mjs` covering:
- Save As keymap (Ctrl/Meta + Shift + S)
- new operator registrations (`file.saveAs`, `file.importPsd`)
- `libraryDialogStore.saveAs` flag delta (file.save → false, file.saveAs → true)
- `file.new` opens NewProjectDialog (no silent reset)

## Thread B — Audit 4 #4 (Modal G/R/S chord parity)

Four sub-fixes to `ModalTransformOverlay.jsx`, each ported byte-faithfully
from Blender's transform code:

### Sub-fix 1 — Shift+X / Shift+Y noop

The chord is Blender's `TFM_MODAL_PLANE_X` / `TFM_MODAL_PLANE_Y` (3D
plane lock-out), explicitly disabled for 2D editors at
`transform.cc:660-662` (`if (t->flag & T_2D_EDIT) return false`). SS is
2D, so the chord must be a noop instead of falling through to the
bare-axis toggle below. Implementation: explicit guard before the
`e.code === 'KeyX'`/`'KeyY'` branches that bails if `e.shiftKey`.

### Sub-fix 2 — Always-visible delta in HUD

Prior HUD only showed a numeric value when the user was typing. The
live magnitude (translate dx/dy, rotate degrees, scale multiplier) now
surfaces every frame so users can read the gesture before committing.

Implementation:
- New `liveDelta: {dx, dy, dRot, scale}` slot + `setLiveDelta(d)` action
  on modalTransformStore.
- `applyDelta` lifts the rotation/scale magnitudes out of the per-node
  update loop (they're gesture-level — same for every selected node)
  and calls `setLiveDelta` after snap + precision are folded in.
- New `formatLiveDelta(kind, axis, d)` helper renders the unit-suffixed
  value for the HUD.
- ZERO_DELTA = frozen object reused so selectors get stable refs when
  nothing's dragging.

### Sub-fix 3 — Leading `=` prefix → numeric input mode

Mirrors Blender's `NUM_EDIT_FULL` flag toggled by `=` in
`numinput.cc:367-380`. With `numericMode` on AND an empty buffer, the
transform is held at the typed value (defaults to 0 / scale 1) — mouse
delta is suppressed and the user types digits to drive the value
precisely.

Implementation:
- New `numericMode: bool` slot + `toggleNumericMode()` action on
  modalTransformStore.
- `=` keydown handler invokes toggleNumericMode + re-fires applyDelta.
- `applyDelta` checks numericMode; if buffer empty + numericMode true,
  typed = 0 (translate/rotate) or 1 (scale), useTyped flips true.
- Backspace on empty buffer with numericMode true ALSO exits
  numericMode (so users aren't stuck holding zero with no way out
  except cancel).
- HUD surfaces a "= " indicator + value placeholder.
- begin/commit/cancel/reset all clear the flag.

### Sub-fix 4 — `e.stopPropagation()` parity

Sister vertex modal got this in audit G-3 + G-4
(`ModalVertexTransformOverlay.jsx:304`). The G/R/S modal only did
`preventDefault()`. Without stopPropagation, other window listeners
(F3 command palette, AppShell global hotkeys) could see the
modal-consumed event mid-drag.

Implementation: every `preventDefault()` in `onKeyDown` + the
`onContextMenu` handler now also calls `stopPropagation()`.

### Tests

+13 assertions in `test_modalTransformTyped.mjs` covering:
- begin seeds numericMode false + liveDelta zeroed
- toggleNumericMode flips
- setLiveDelta records translate/rotate/scale values
- backspace on empty buffer with numericMode true exits the mode
- commit / cancel / reset all clear numericMode + liveDelta

## Test scoreboard

- TSC clean across both commits.
- Full suite via Node wrapper: 259 / 259 scripts green at HEAD.
- New / updated:
  - `test_v3Operators` — 112 → **124** passed (+12 from Audit 4 #3)
  - `test_modalTransformTyped` — 11 → **24** passed (+13 from Audit 4 #4)

## Resume paths post-compact

The cross-audit priority list (from the prior session's close-out
`SESSION_CLOSEOUT_2026_05_16_FULL_UI_SWEEP.md`) has 3 unfinished picks:

1. **Audit 2 F2-1** — Lift 4 animation-editor headers (Timeline /
   Dopesheet / FCurve / NodeTree) into per-area Header slot. Medium
   cost, mechanical work on the F-1 architecture this session shipped.
2. **Audit 4 #2** — Right-click context menu per editorMode. RMB
   currently silent `preventDefault`s on canvas. Small-medium; leverages
   existing operators (the 6 popover menus already exist).
3. **Audit 4 #1** — Status bar (Footer.jsx) mirroring
   `STATUSBAR_HT_header`. Surfaces selection count + modal echo +
   reports. Medium cost, high impact.

Also queued from the master session:
- **Animation Phase 2** — Slices 2.D (auto-handle calc) / 2.G + 2.G.1
  (motion3 bezier round-trip) / 2.H (6-Cubism-sample exit gate)
- **F-1 follow-on** — Properties / Actions / NodeTree / FCurve /
  Dopesheet headers, ModePill lift to shared subcomponent
- **F-8 (deferred)** — Constraint stack UI, needs Constraints
  datablock model in projectStore first

## Memory updates this session

None. All work in-scope of existing memories; no new rules surfaced.

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty fixes)
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no migration baggage)
- `feedback_question_agents_not_user.md` — Rule №3 (question agents, not user)
- `feedback_blender_reference_strict.md` — Blender source IS the source of truth
- `docs/plans/SESSION_CLOSEOUT_2026_05_16_FULL_UI_SWEEP.md` — predecessor close-out (master 2026-05-16 session)
- `docs/plans/SESSION_CLOSEOUT_2026_05_16_PHASE2_BEZTRIPLE_AND_UI_SWEEP.md` — Round 1 close-out
