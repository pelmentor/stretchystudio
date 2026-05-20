# UI Mode/Pill/Tool Blender-Parity Plan

Status: **AUDITED 2026-05-20** — implementation slices queued.
Owner: pelmentor. Working rules: **Rule №1** (no crutch / no mislabel),
**Rule №2** (no baggage), **Rule №3** (resolve forks via agents).

User directive: *"audit ss ui to match blender ui — green light to move
pills, change how entering modes behaves, what tool autoselects, match
Blender."* All forks answered *"you decide per Rule 1."*

This plan covers ONLY the mode-selector ("pill"), mode-entry behavior,
and tool auto-selection. It is not a full UI parity sweep.

---

## Audit — SS vs Blender (verified against `reference/blender/`)

| Area | SS today | Blender | Verdict |
|---|---|---|---|
| Mode selector | Floating canvas overlay pill, `top-2 left-2` (`ModePill.jsx`) + popover | Viewport **header dropdown** `operator_menu_enum("object.mode_set","mode")` (`space_view3d.py:847`), modes filtered by object type | **Diverges (visual)** — relocate to header-style dropdown |
| Tab | mesh→Edit, armature→Edit, toggle-off; weight-bound-**no-mesh**→Weight Paint fallback (`registry.js:701-783`) | `object.mode_set mode='EDIT' toggle=True` (`blender_default.py:4624`) — Object↔Edit | **Already faithful** (agent over-stated this). Keep; the WP fallback only fires when Edit is impossible |
| Ctrl+Tab | nothing | mode pie menu `view3d.object_mode_pie_or_toggle` (`:4626`) | **Diverges** — add Ctrl+Tab → open mode menu |
| Default tool on entry | edit→`select` ✓, pose→`joint_drag`, weightPaint/sculpt→`brush` ✓, object→`select` ✓ (`editorStore.js:474-486`) | Object/Edit/Pose/Edit-Armature→`builtin.select_box`; paint/sculpt→`builtin.brush` (`wm_toolsystem.cc:1109-1152`) | **Edit/object/paint faithful.** Pose: see below |
| `LTM_DEFAULT` const | `edit:'brush'` (stale — actual default is `'select'`) (`preferencesStore.js:190-194`) | — | **Inconsistency to fix** |
| Tool memory | per-mode `lastToolByMode` ✓ | per (workspace, space, mode) | Faithful enough (SS workspaces are layout-only) |
| Workspace↔mode | layout-only, no coupling | workspace can carry `object_mode` | Diverges — but SS deliberately made workspaces layout-only (2026-05-02); deferred |

### The pose-tool subtlety (why pose default stays `joint_drag`)

`joint_drag` is referenced **only** in `editorStore.js` (default assign +
comment) and `preferencesStore.js` (`LTM_DEFAULT`). **No interaction code
reads `toolMode` in pose** — `SkeletonOverlay` enables bone dragging on
`editMode === 'pose'` alone (`SkeletonOverlay.jsx:220`). So in SS pose
mode, **dragging always moves bones regardless of the active tool.**

Blender's pose default is `select_box` (drag = box-select; move = G / Move
tool). Defaulting SS pose to `'select'` while drag still *moves* bones
would ship a tool labeled "Select" that actually moves — a mislabel
(Rule №1 violation). The faithful fix requires a **tool-aware
`SkeletonOverlay`** (select ⇒ box-select on drag; move/joint_drag ⇒ move).
That is a real interaction refactor needing browser verification →
**deferred to its own slice (Slice D).** Until then pose keeps
`joint_drag` (honest: the active tool matches the always-drag behavior).

---

## Slices

- **Slice A — tool-default consistency (done in this commit).** Fix the
  stale `LTM_DEFAULT` `edit:'brush'` → `'select'` so the documented seed
  matches `editorStore`'s actual default. No behavior change.
- **Slice B — Ctrl+Tab → mode menu. ✅ SHIPPED.** `uiV3Store.modeMenuOpen`
  + `setModeMenuOpen`; `ModePill` `<Popover>` is now controlled by it (so a
  keybind can open it; click-toggle + Esc/outside-close preserved). New
  `mode.menu` operator (registry) flips the flag; keymap `'Ctrl+Tab':
  'mode.menu'`. Picking a mode row now closes the menu (`pick()` wrapper) —
  matters for the keyboard flow. Tests: uiV3Store flag (+4), v3Operators
  exec + the keymap-resolves-all-chords loop already covers the binding
  (+2). **Caveat:** Ctrl+Tab is browser-reserved in a web tab (may not be
  interceptable); works in the desktop app. Pill *visual* unchanged here.
- **Slice C — pill → Blender-style header dropdown. ✅ SHIPPED (needs
  browser verification).** Discovery: SS already renders a real
  `ViewportHeader` (Blender `VIEW3D_HT_header` analog: View/Select/Object
  menus) that was showing a *read-only* mode label, with a code comment
  documenting the intent to lift the interactive selector into it. So the
  faithful move was a mount relocation, not a rewrite: de-floated
  `ModePill` (dropped `absolute top-2 left-2 z-10`) and mounted it inside
  `ViewportHeader` (replacing the read-only label); removed the canvas
  overlay mount in `CanvasArea`. Single instance ⇒ the Slice-B Ctrl+Tab
  flag still drives it cleanly; the proportional-edit toggle + shape
  picker + lock-modes came along untouched. The left-edge `CanvasToolbar`
  (Blender T-panel) stays on canvas. **NOT browser-verified** — visual
  placement/sizing of the header pill + the proportional toggle in the
  header row need the user's eyes; single revertible commit if off.
  Polish candidate: the trigger's heavy `bg-card/85 backdrop-blur shadow`
  styling may want lightening for the flat header row.
- **Slice D — tool-aware pose interaction. ✅ SHIPPED (opt-in, NOT
  browser-verified).** Built blind per user direction ("build anyways,
  fix later"). Scope collapsed once verified that G/R/S modal transform
  already works on pose bones (`ModalTransformOverlay.jsx:400`) and B
  opens box-select — so the Select tool needs no new box-select code.
  - Pose toolbar (`tools.js` skeleton) now: **Select** (first) + Joint
    Drag + Move/Rotate/Scale (G/R/S operators, reusing the working
    transform ops).
  - `SkeletonOverlay` joint pointer-down is tool-aware: `toolMode ===
    'select'` ⇒ release capture + `selectBoneInBothStores(nodeId)` +
    return (no move drag); transform via G/R/S, box-select via B,
    select-all via A. **Joint Drag stays the auto-armed default**, so
    existing drag-to-pose is UNCHANGED — Select is purely opt-in (zero
    regression).
  - **Default flipped to Select ✅ (user-verified 2026-05-20).** After the
    user confirmed the Select-tool feel in-browser ("all good i tested"),
    flipped the pose default: `editorStore.enterEditMode` pose →
    `'select'` + `LTM_DEFAULT.pose` → `'select'`. Pose Mode now opens with
    Select like Blender + Edit Mode; Joint Drag stays opt-in in the
    toolbar; persisted per-mode tool still overrides. Tests updated
    (editorStore/preferencesStore/canvasToolbar).
- **Slice E — workspace→mode coupling. ⏸ RESOLVED-BY-ANALYSIS (not built;
  pending user product decision).** Blender workspaces carry `object_mode`
  (Sculpting→Sculpt, etc.). SS deliberately decoupled this (2026-05-02 —
  deleted the workspace-policy module) so **mode follows SELECTION, not
  workspace** — a principled, arguably-cleaner model (Blender stores mode
  redundantly on both object AND workspace). Re-coupling would: (a)
  re-introduce the deliberately-removed "switching workspace yanks you into
  another mode" surprise; (b) entangle `setWorkspace` with selection-gated
  mode-entry; (c) need object-type guards (Sculpt workspace + bone selected
  = can't sculpt). Same shape as the animation close-out's CO-C/CO-D:
  literal Blender-matching would undo a deliberate SS choice. So this is a
  **product decision for the user**, not a blind autonomous build — flagged
  rather than shipped. If the user wants Blender's coupling, it's a
  contained follow-up (map modeling→edit / sculpt→sculpt / weightPaint→
  weightPaint / layout+animation→object, selection-gated, in `setWorkspace`).

### Polish (shipped with Slice E close-out)

- **Header-pill styling** — the ModePill trigger + proportional-edit toggle
  kept their floating-over-canvas styling (`bg-card/85 backdrop-blur shadow`,
  `h-8`); flattened to header-appropriate (`h-6`, `bg-background/40`, no blur/
  heavy shadow) to match the View/Select/Object menu buttons in the header
  row. Visual — still wants a glance, but matches proven sibling styling.

Each code slice: implement → dual-audit → same-day fix sweep. Visual
slices (C) + interaction slices (D) explicitly flag that I cannot
browser-test them.
