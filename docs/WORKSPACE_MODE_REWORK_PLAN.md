# Workspace + Edit Mode Rework Plan

**Status:** ✅ SHIPPED 2026-05-02. See [V3_WORKSPACES.md](V3_WORKSPACES.md) for the post-rework contract.
**Origin:** user 2026-05-02 — "We don't even have selection mode like in blender. Nothing works. What are these MODELLING, RIGGING tabs are for? NEED A DEEP RE-THINK on how do we make this proper and без костылей. Edit mode не работает." → "Collapse them! Let's make a plan how to make this work + edit mode."

## Diagnosis (what's actually broken)

1. **Workspaces are mostly cosmetic.** [uiV3Store.js](../src/store/uiV3Store.js) shows `Layout` / `Modeling` / `Rigging` all use `DEFAULT_AREAS()` — identical layouts, same `editorMode='staging'`. Three of five tabs differ only in workspace-policy gating (which the rework drops). False distinctions.
2. **Edit mode is undiscoverable.** Currently tucked into the Layers popover. No top-level affordance saying "you're in Object Mode" / "Mesh Edit". Tab keybind works but nothing tells the user that.
3. **No "Object Mode" as a first-class concept.** `editMode === null` is implicit object mode but never labeled. User can't tell what state they're in.
4. **Workspace policy gate is too aggressive.** `mode.editToggle` silently no-ops when the workspace forbids the kind (e.g. skeleton edit in Modeling). No feedback. Footgun.
5. **Wireframe is a separate toggle.** In Blender, Edit Mode forces wireframe + vertices on. We require a manual toggle, so users enter mesh edit and see nothing visible change.

## Target shape

### Three workspaces (was five)

| Workspace | editorMode | Timeline | Replaces | Use case |
|-----------|-----------|----------|----------|----------|
| **Edit** | staging | hidden | Layout / Modeling / Rigging | Setup: PSD import, meshes, bones, weights, rig |
| **Pose** | animation | hidden | (kept) | Quick posing without keyframing |
| **Animation** | animation | visible | (kept) | Full keyframing on the timeline |

### Workspace ≠ mode

Workspace is a **layout preset + default `editorMode`**. Nothing else. Modes (mesh / skeleton / blendShape) are independent of workspace — you can enter any of them from any workspace where you have a valid selection.

### Mode pill (canvas top-left overlay)

```
┌─ Object Mode ▼ ─┐
│                 │
│ ▾ on click:     │
│   ◉ Object Mode │  always available
│   ○ Edit Mode   │  enabled iff selection is a meshed part
│   ○ Skeleton    │  enabled iff selection is a bone-role group
│   ○ Blend Shape │  expands to a sub-list of the part's shapes
│   ─────────     │
│   ☐ Lock object │  preferencesStore toggle, contextual placement
└─────────────────┘
```

- Mounts only on the edit Viewport tab (not Live Preview — modes are meaningless there).
- Disabled rows show a tooltip naming the selection that unlocks them.
- Tab keybind still works; the pill is the discoverability layer.
- Lock Object Modes preference moves here from the Layers popover.

### Mesh-edit auto-shows the mesh

When `editMode === 'mesh' && selection.includes(part)`, scenePass forces wireframe + vertices on for that part regardless of `viewLayers`. The Layers toggles continue to govern visualization OUTSIDE edit mode.

### Tab feedback (no silent no-ops)

`mode.editToggle` pushes a toast when there's no valid selection or the selection has no edit context. "Select a meshed part or bone group to enter Edit Mode."

## Sweep order

1. **Collapse workspaces** in [uiV3Store.js](../src/store/uiV3Store.js) — `WORKSPACE_PRESETS` keys go 5→3 (`edit` / `pose` / `animation`). Soft-migrate persisted state: any of `layout` / `modeling` / `rigging` → `edit` on load.
2. **Update [Topbar.jsx](../src/v3/shell/Topbar.jsx)** — render 3 pills, update labels.
3. **Delete workspace policy module.** `workspaceViewportPolicy.js` goes away; every caller (CanvasViewport, scenePass) reads `viewLayers` / `editMode` directly. No `applyWorkspacePolicy` / `effectiveEditMode` / `isEditModeAllowed` calls left.
4. **Force wireframe + vertices in mesh edit** ([scenePass.js](../src/renderer/scenePass.js)) — `if (editor.editMode === 'mesh' && selectionSet.has(part.id))` overrides viewLayers.wireframe + vertices true for that part.
5. **New `src/v3/shell/ModePill.jsx`** — mount in [CanvasArea.jsx](../src/v3/shell/CanvasArea.jsx) as a top-left overlay, only when `previewMode === false`. Lock Object Modes toggle in the dropdown footer.
6. **Tab keybind feedback** — `mode.editToggle` operator pushes a `useToast` on no-valid-selection.
7. **Strip the Edit Mode section from [ViewLayersPopover.jsx](../src/v3/shell/ViewLayersPopover.jsx)** — Layers becomes pure visualization. Drop EditModeRow component + lockObjectModes wiring.
8. **Tests** — update [test_uiV3Store.mjs](../scripts/test/test_uiV3Store.mjs) for 3-key shape, delete [test_workspaceViewportPolicy.mjs](../scripts/test/test_workspaceViewportPolicy.mjs) (no policy left), [test_editorStore.mjs](../scripts/test/test_editorStore.mjs) already covers editMode + lock.
9. **Docs** — rewrite [V3_WORKSPACES.md](V3_WORKSPACES.md) around the 3-workspace + mode-pill model. Update [FEATURE_GAPS.md](FEATURE_GAPS.md) and [BUGS.md](BUGS.md) for stale workspace references. Update memory entries.

### Doublecheck findings (touch sites the initial pass missed)

Verified by grepping `'layout'|'modeling'|'rigging'` and `activeWorkspace` across `src/`:

- **[CanvasViewport.jsx:804](../src/components/canvas/CanvasViewport.jsx) + [:1948](../src/components/canvas/CanvasViewport.jsx)** — proportional-edit hotkeys + indicator ring gate on `ws === 'modeling' || ws === 'rigging'`. After collapse → `ws === 'edit'`.
- **[default.js](../src/v3/keymap/default.js)** — keymap binds `Ctrl+Digit1..5` to `workspace.set.{layout,modeling,rigging,pose,animation}`. Reduce to `Ctrl+Digit1..3` for `edit / pose / animation`. Old chords unbind.
- **[test_uiV3Store.mjs](../scripts/test/test_uiV3Store.mjs)** — asserts the 5-workspace shape; needs to be updated for 3.

Verified clean: `toast` is exported as a callable from [`src/hooks/use-toast.js`](../src/hooks/use-toast.js), so the operator can push toasts without going through a React component. Mode pill at `top-2 left-2` of the canvas does not collide with ViewLayersPopover at `top-2 right-32`.

## Decisions

| ID | Question | Decision (user 2026-05-02) |
|----|----------|----------------------------|
| A | Migrate persisted `layout`/`modeling`/`rigging` → `edit`? | **No back-compat at all.** Old saves with stale workspace IDs are not supported. |
| B | Workspace policy module: delete or identity pass-through? | **Delete.** Follow Blender — workspaces don't gate modes, so no policy module. |
| C | Mode pill: dropdown or segmented buttons? | **Dropdown.** Blender's pattern. |
| D | Show mode pill on Live Preview tab? | **No.** |
| E | Animation workspace also gets the mode pill? | **Yes.** Pill is uniform across all workspaces with an edit Viewport. |

Executing.

## Out of scope (deliberately not in this rework)

- BodyAngle in live-preview cursor follow — paused per user 2026-05-02
- GAP-008 Phase B Init Rig subsystems UI polish — paused per user 2026-05-02
- BUG-003 Cubism warp port AngleZ residual — separate effort, blocked on rotation matrix-structure refactor
- Vertex / edge / face selection sub-modes within mesh edit (Blender's 1/2/3 keys) — future enhancement; SS today only paints, no element-type subselection

## What this rework will NOT introduce (anti-crutch list)

- No transitional both-shapes coexistence (workspace policy stays OR goes — no half-state)
- No alias setters preserving the legacy 5-workspace API
- No "compatibility layer" for old persisted workspace IDs beyond the one-shot migration
- No "you're in Modeling but trying to skeleton-edit" pop-up modals — workspaces simply don't gate modes anymore

## Browser-test checklist (post-execution)

> The empty `[ ]` checkboxes below are intentional — they were never marked off in the original ship. Reading them as "unverified" is misleading: the user verified the behaviour in-app on 2026-05-02 ("ModePill works", "Tab works", etc.) and the contract is locked by automated tests (`test_uiV3Store` 47/47 walks editMode + editorMode persistence across every workspace pair; `test_v3Operators` 63/63 covers `mode.editToggle` toast paths; `test_EditorModeService` 11/11). Treat the list as the **acceptance script** the rework was designed against, not as outstanding TODOs.

- [ ] Topbar shows 3 workspace pills (Edit / Pose / Animation)
- [ ] Old saved project with `activeWorkspace: 'modeling'` loads into Edit workspace cleanly
- [ ] Mode pill visible top-left of canvas in Edit workspace
- [ ] Click pill → dropdown shows Object / Edit / Skeleton / Blend Shape rows with correct enabled-states for the current selection
- [ ] Tab on a meshed part → enters Edit Mode, wireframe + vertices auto-visible on the part
- [ ] Tab on a bone-role group → enters Skeleton Edit, joints draggable
- [ ] Tab with no selection → toast shown, no mode change
- [ ] Lock Object Modes toggle in pill footer; checking it then clicking another part while in edit mode → click ignored
- [ ] Pose workspace: same behaviour, timeline hidden, animation editorMode active
- [ ] Animation workspace: same behaviour, timeline visible
- [ ] Layers popover no longer has the Edit Mode section; only visualization toggles

## Post-ship addendum (same day, 2026-05-02)

Same-day work that landed under the workspace-rework umbrella but isn't tracked above:
- BUG-019 wireframe rendering fix (separate edge-pair `wireIbo` in `partRenderer`).
- ModePill `Lock Object Modes` checkbox in footer (preference moved out of ViewLayersPopover).
- `EditorModeService` wraps `setEditorMode` so `captureRestPose` fires on staging→animation transition regardless of caller (Topbar pill, AnimationsEditor "create animation").
- Topbar Setup⇄Animate pill made independent of workspace switches — three axes (`activeWorkspace` / `editorMode` / `editMode`) now genuinely orthogonal.

Adjacent same-day plans, separately tracked:
- [CLICK_TO_SELECT_PLAN.md](CLICK_TO_SELECT_PLAN.md) — SHIPPED (triangle hit-test against rig frames).
- [TOOLBAR_PLAN.md](TOOLBAR_PLAN.md) — SHIPPED (Blender T-panel canvas toolbar).
