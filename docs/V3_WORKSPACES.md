# v3 Workspaces

Living document. v3 has **three workspaces** — Edit, Pose, Animation — each tuned to a phase of the rigging pipeline. This document captures what each workspace IS and how the **Mode pill** + **edit modes** interact with them.

> History: 2026-05-02 collapsed 5 workspaces (Layout / Modeling / Rigging / Pose / Animation) into 3 (Edit / Pose / Animation). The first three were structurally identical (same panel layout, same `editorMode='staging'`) and only differed via a workspace-policy gate that has been deleted. False distinction removed.

## Workspaces × concerns

| Workspace   | editorMode | Timeline | Use case |
|-------------|-----------|----------|----------|
| **Edit**    | staging    | hidden   | Setup work: PSD import, meshes, bones, weights, rig. Edits target the rest pose. |
| **Pose**    | animation  | hidden   | Quick posing without keyframing. Edits become timeline keyframes. |
| **Animation** | animation | visible | Full keyframing on the timeline. Edits become timeline keyframes. |

**Workspaces are layout-only.** They DO NOT gate edit modes or visualizations — Blender pattern. The previous `workspaceViewportPolicy` module was deleted 2026-05-02; `editorStore.editMode` is independent of workspace.

**Workspace switch never touches ANY mode.** User 2026-05-02: "modes are in every window and don't change between windows". `setWorkspace` only updates `activeWorkspace`. Both `editMode` (Blender-style: mesh / skeleton / blendShape) AND `editorMode` (Spine-style: staging / animation) are preserved verbatim across workspace transitions, along with `selection` and `activeBlendShapeId`. Tab into Edit Mode in the Edit workspace, switch to Animation — you're still in Edit Mode. Locked by `test_uiV3Store` contract tests walking every editMode kind AND every editorMode value across every workspace pair.

### The three independent axes

| Axis | Where set | What it controls |
|------|-----------|------------------|
| **`activeWorkspace`** (uiV3Store) | Topbar workspace pills (Edit / Pose / Animation) | Which editor panels are visible + their layout |
| **`editorMode`** (editorStore) | Topbar Setup⇄Animate pill | Setup → edits modify rest pose; Animate → edits become timeline keyframes |
| **`editMode`** (editorStore) | Canvas top-left Mode pill + Tab keybind | Object Mode / Edit Mode (mesh) / Skeleton Edit / Blend Shape Paint |

All three change independently. Any combination is valid — Edit workspace + Animate + Mesh Edit Mode is fine (you're keyframing vertex positions while looking at edit-friendly panels). The user picks each axis explicitly; nothing implies anything else.

### EditorModeService

[`src/services/EditorModeService.js`](../src/services/EditorModeService.js) wraps `setEditorMode` so the `captureRestPose` snapshot fires on the `staging→animation` transition regardless of caller. Both the Topbar Setup⇄Animate pill and the AnimationsEditor "create animation" path go through this service. Programmatic callers should also use it; the bare `editorStore.setEditorMode` still exists for the service's own internal use but is not the public path.

**Live drivers** (physics + breath + cursor head-look) only run while the active center tab is `livePreview`. Every workspace ships the `center` area with two tabs `[viewport, livePreview]` (viewport active by default). Drivers gate on the `<CanvasViewport>` instance's `previewMode` prop — no global flag.

## Edit modes (the contextual `editMode` slot)

Code: [`src/store/editorStore.js`](../src/store/editorStore.js) → `editMode` / `enterEditMode` / `exitEditMode`.

`editorStore.editMode` is one of:

- **`null`** — Object Mode. Default. Selection is per-node; transforms move whole pieces.
- **`'mesh'`** — vertex / UV editing on the selected part. Wireframe + vertices auto-shown for the active part regardless of `viewLayers` toggles. `meshSubMode` (`'deform'` | `'adjust'`) sub-selects between vertex movement and UV painting; sticky across re-entries.
- **`'skeleton'`** — bone joint dragging. Requires the Skeleton overlay (`viewLayers.skeleton`) to be on; toggling it off auto-exits skeleton edit. The Mode pill auto-enables the skeleton overlay when entering this mode.
- **`'blendShape'`** — painting deltas onto `activeBlendShapeId`. Same brush as mesh edit; write target is the blendShape's `deltas` array.

### Mode pill (canvas top-left overlay)

Code: [`src/v3/shell/ModePill.jsx`](../src/v3/shell/ModePill.jsx).

The pill is the discoverable affordance for edit modes. Mounts only on the edit Viewport tab (not Live Preview — modes are meaningless there). Reads `editorStore.editMode` + active selection; renders a dropdown with the modes available for the current selection:

```
┌─ Object Mode ▼ ─┐
│ ◉ Object Mode   │  always available
│ ○ Edit Mode     │  meshed part selected
│ ○ Skeleton      │  bone-role group selected
│ ─────           │
│ Blend Shape Paint│
│ ○ Smile          │  per-shape rows when the part has blend shapes
│ ○ Angry          │
│ ─────            │
│ ☐ Lock object modes  ← preference
└──────────────────┘
```

Tab keybind (`mode.editToggle` operator) toggles between Object Mode and the contextual edit mode the active selection supports. With no valid selection, Tab pushes a toast explaining what to select.

### Selection auto-exit

`setSelection` clears `editMode` whenever the selection-head changes — the new selection's edit context is unrelated. Same-head re-set keeps the mode intact (the user just clicked the same thing again).

### Lock Object Modes (Blender preference)

[`preferencesStore.lockObjectModes`](../src/store/preferencesStore.js), default ON. While the user is in any edit mode, clicks on a *different* part are **rejected** by `setSelection` — must Tab out before switching pieces. Mirrors Blender's "Lock Object Modes" setting. Empty selection (deselect-all) is allowed even with the lock on, but exits edit mode because there's no part to edit anymore. Toggle: ModePill dropdown footer.

## Mesh-edit auto-shows the mesh

When `editMode === 'mesh'` and the active part is selected, `scenePass` forces wireframe + vertices on for that part regardless of `viewLayers.wireframe` / `vertices` toggles. Blender pattern: in Edit Mode you always see what you're editing. The toggles continue to govern visualization for unselected parts.

## Reset Pose semantics by mode

Code: [`src/services/PoseService.js`](../src/services/PoseService.js) — single source of truth, called from both [`Topbar.handleResetRestPose`](../src/v3/shell/Topbar.jsx) and [`RigService.initializeRig`](../src/services/RigService.js).

The Reset Pose button sits at the top-right of the Topbar in EVERY workspace. What it actually does depends on the `editorMode` because of how bone-controller drags persist:

| editorMode | PoseService function | What it does |
|-----------|----------------------|--------------|
| animation | `resetPoseDraft()`   | Clears `animationStore.draftPose` + zeros every parameter to its default. Committed timeline keyframes survive. |
| staging   | `resetToRestPose()`  | Same as animation, PLUS zeros `node.transform.{rotation,x,y,scaleX,scaleY}` for every group with a `boneRole` (preserving pivots). Per-part transforms (non-bone) are preserved. |

`RigService.initializeRig` calls `resetToRestPose()` BEFORE harvesting so the rig builder sees clean rest geometry — BUG-004 / BUG-008 / BUG-010 fix.

## Wizard cleanup contract

Code: [`PsdImportService.resetInteractionState`](../src/services/PsdImportService.js).

Both wizard exits clear:
- `editorStore.selection` (legacy node-id array)
- `useSelectionStore.items` (universal selection)
- `editorStore.editMode` + `activeBlendShapeId`

Without this cleanup, transient interaction state leaks into the post-import workspace (BUG-012).

## Adding a new workspace

1. Add the entry to `initialWorkspaces()` in [`uiV3Store.js`](../src/store/uiV3Store.js)
2. Add the workspace pill to `WORKSPACES` in [`Topbar.jsx`](../src/v3/shell/Topbar.jsx)
3. Bind a `Ctrl+Digit{N}` chord in [`default.js`](../src/v3/keymap/default.js)
4. Update the matrix at the top of this doc

There is no policy table to update — workspaces are layout-only.

## Area slots in the AreaTree

The [`AreaTree`](../src/v3/shell/AreaTree.jsx) maps workspace presets to a fixed set of named slots:

| Slot         | Position                                  | Used by                          |
|--------------|-------------------------------------------|----------------------------------|
| `leftTop`    | Top of left column                         | Outliner (default in every preset) |
| `leftBottom` | Bottom of left column (vertical split)     | Logs (default in every preset)   |
| `center`     | Center column                              | `[Viewport, Live Preview]` tabs (every preset) |
| `timeline`   | Bottom of center column (vertical split)   | Timeline / Dopesheet / F-Curve (Animation only) |
| `rightTop`   | Top of right column                        | Parameters (default in every preset) |
| `rightBottom`| Bottom of right column (vertical split)    | Properties (or Animations + Properties in Animation) |

The `center` area carries TWO tabs `[viewport, livePreview]` in every preset. [`Area.jsx`](../src/v3/shell/Area.jsx) detects canvas tabs and routes both through the shared [`<CanvasArea>`](../src/v3/shell/CanvasArea.jsx) host, so toggling between them does NOT remount the canvas.
