# Session Aggregate — 2026-05-20 — Phase 7 polish + mesh-keyform fix + UI Blender-parity

**Branch:** master. **Final state:** 0 commits ahead of origin (all pushed),
working tree clean. **Schema:** v42 (unchanged — no schema bumps).
**Commits:** 18 (`1f89d01` → `91873d0`).

Two distinct bodies of work this session:
1. **Closed all Phase 7 (Insert-Keyframe) polish slices** + fixed a latent
   mesh-keyform bug surfaced by the work.
2. **UI mode/pill/tool Blender-parity initiative** (new, user-directed) —
   Slices A–E shipped.

---

## Part 1 — Phase 7 polish slices (all RESOLVED)

### Slice 7.H — param-row auto-key parity (`1f89d01` + `9a2ba45`)
Param-slider auto-key created an fcurve unconditionally. **Premise
correction (Rule №1):** the plan said route through `runAutoKey`/
`autoKeyMode`, but Blender routes single-property UI edits through a
SEPARATE path — `button_anim_autokey` → `autokeyframe_property(...,
only_if_property_keyed=true)` (`interface_anim.cc:320` /
`keyframing_auto.cc:284`). So a slider drag only MAINTAINS an existing
fcurve, never creates one. `setParamKeyframeAt` → `autoKeyParamProperty`
(only-if-keyed); call site pre-checks `findParamFCurve` to skip the
undo-snapshotting `updateProject` when unkeyed. Dual-audit clean (cites
verified byte-for-byte).

### Stale-test fix (`01b21e6`)
`test_stage1e_actions_editor §6` grepped TimelineEditor for picker code that
moved to `PlaybackControls` in the Round-7 FID-A.2 refactor — repointed.

### Slice 7.I — active keying set UI (`dcb7c37` + `df42525`)
The I-menu's per-row indicator is now an interactive ●/○ toggle dispatching
`execSetActiveKeyingSet` (mirrors Blender `ANIM_OT_keying_set_active_set`,
`keyingsets.cc:443-454`; SS deviation = toggle-to-clear). Audit-fix: decide
the toggle direction against the immer draft, not the pre-recipe snapshot.

### Slice 7.G — K-rebind preference + fan-out extraction (`4b42d4e` + `165c8f0`)
Extracted the ~150-line legacy K-key "insert all properties" fan-out from a
CanvasViewport effect into pure, unit-tested `renderer/insertAllProperties.js`
(was 0 coverage). Added `preferencesStore.kKeyOpensMenu`: a manual K opens
the I-menu instead of the fan-out (Blender K = `anim.keyframe_insert_menu`
always_prompt=True, `keymap_data/blender_default.py:4536`); synthetic
auto-key K (`__ssAutoKey`) is exempt. Toggle surfaced in PreferencesModal
(en/ru). Dual-audit: extraction faithful 7/7; 3/3 cites verified.

---

## Part 2 — mesh_verts keyform storage bug (FIXED) (`001a7b6` + `9525b99` + `7eb8e68`)

The 7.G extraction surfaced a latent bug: **mesh_verts keyframes were never
stored** — `upsertKeyframe` → `makeBezTripleKeyform` (`animationFCurve.js:144`)
rejects non-numeric values, and a mesh keyform value is a per-vertex array.
The eval (`interpolateMeshVerts`) + export (motion3/cmo3 `meshVertsWarp`)
ends were already array-ready; only the write link was missing.

- `upsertMeshKeyframe` (animationEngine) stores `{time, value:[{x,y}…],
  interpolation, …}` — the shape the evaluator + both exporters consume.
- `recalcKeyformHandles` chokepoint guard skips array values (protects every
  dopesheet/graph/fcurve-editor handle-recompute caller).
- Graph Editor excludes mesh_verts (no scalar value-axis).
- **Audit caught 2 blast-radius gaps (`9525b99`):** NLA
  `blendStripIntoAccumulator` was feeding mesh arrays into scalar blend math
  → NaN (now skips `.mesh_verts`); dopesheet clone/duplicate shallow-shared
  the value array → deep-copy. Export-path audit: 3/3 consumers compatible.
- **NOT Cubism-verified:** visual mesh-deform playback + the actual
  .cmo3/.motion3 OUTPUT for newly-animated mesh_verts.

**All Phase 7 (Insert-Keyframe) polish is now closed.**

---

## Part 3 — UI mode/pill/tool Blender-parity initiative

User directive: "audit ss ui to match blender — green light to move pills,
change mode-entry, tool-autoselect." Plan + audit:
`docs/plans/UI_MODE_BLENDER_PARITY_PLAN.md`. All slices shipped.

- **Slice A** (`8712e63`) — Edit Mode opens with **Select** not Brush. Real
  fresh-install bug: `LTM_DEFAULT.edit` seeded `'brush'` (the seed for
  `lastToolByMode`, read in `enterEditMode` BEFORE its inline `'select'`
  default).
- **Slice B** (`0b871f2` + `90586e8`) — **Ctrl+Tab opens the mode menu**.
  `uiV3Store.modeMenuOpen` controls the ModePill `<Popover>`; `mode.menu`
  operator; keymap `Ctrl+Tab`. Audit-fix: reset the flag on ModePill
  mount/unmount (stuck-open edge). Caveat: Ctrl+Tab browser-reserved in a
  web tab; works desktop.
- **Slice C** (`69e061f`) — **mode selector MOVED into the Viewport header**
  (`ViewportHeader`, Blender `VIEW3D_HT_header` position), replacing its
  read-only label; floating canvas overlay removed. Header-pill styling
  later flattened (`ac4e944`).
- **Slice D** (`57a192d`) + default-flip (`d4913eb`) — **Select tool for Pose
  Mode**: click-select + G/R/S + B box-select (all already worked).
  `SkeletonOverlay` joint pointer-down is tool-aware. Default flipped to
  Select after the user verified the feel; Joint Drag stays opt-in.
- **Slice E** (`91873d0`) — **workspace→mode coupling**. `workspaceModeEntry.js`
  `applyWorkspaceMode(id)` from `setWorkspace`: modeling→edit / rigging→pose
  / weightPaint→weightPaint / sculpt→sculpt; layout/animation UNCOUPLED;
  selection-gated.

**Key architecture findings:** SS already had a real `ViewportHeader`
(VIEW3D_HT_header analog) with a documented intent to lift the mode
selector into it (made C a mount-relocation, not a rewrite). `joint_drag`
is unread by interaction code — pose drag is gated on `editMode==='pose'`
alone (so the Select-tool branch + default-flip are clean).

---

## Verification debt (user-side)

- **Phase 7 manual checklists** (6 + 7) still outstanding.
- **mesh_verts**: visual playback + Cubism export output unverified.
- **UI Slice E**: workspace-switch-into-mode flow wants a browser glance
  (A–D were confirmed by the user mid-session: "all good i tested").

Each unverified UI/feature change is a single revertible commit.

## Rule alignment
- **Rule №1** — premise corrections on 7.H + the pose-tool decision (no
  mislabeled "Select" while drag moved bones until D made it a real tool);
  no crutch shipped.
- **Rule №3** — design forks resolved via the two research agents (SS map +
  Blender reference) rather than bounced; the user was asked only the
  genuine product decision (build Slice E or not).
- **Dual-audit** — ran after 7.H / 7.I / 7.G / mesh-fix / UI Slice B.
- Memory: `project_ui_mode_blender_parity.md` + `project_blender_parity_plans_in_flight.md` updated.

## State at compact
- **Branch:** master, **0 ahead of origin** (18 commits pushed). Tree clean.
- **Schema:** v42 (unchanged).
- **Phase 7 (Insert-Keyframe):** SHIP-COMPLETE incl. all polish (7.G/H/I) +
  the mesh_verts keyform fix.
- **UI Blender-parity initiative:** COMPLETE (Slices A–E + pose flip + polish).
- **Open:** user-side verification (above). No queued code work.
