# v3 Workspaces

Living document. v3 has five workspace presets — Layout, Modeling, Rigging, Pose, Animation — each tuned to a phase of the rigging pipeline. This document captures what each workspace IS, what visualizations + behaviours are appropriate there, and how the per-workspace **viewport policy** keeps state from bleeding across workspaces.

> Memory anchor: workspace switching used to remount every editor + destroy the WebGL context (BUG-001, fixed 2026-05-02). Now editor identity is stable across workspaces; this doc is about what each workspace LOOKS LIKE, not how it's mounted.

## Workspace × concern matrix

| Workspace   | Editor mode | Mesh wireframe / vertices | Mesh edit dimming | Skeleton overlay | Bone-controller drag target |
|-------------|-------------|---------------------------|-------------------|------------------|------------------------------|
| Layout      | staging     | ❌ never                   | ❌ never           | user-toggle      | `node.transform` (persistent) |
| Modeling    | staging     | ✅ user-toggle             | ✅ user-toggle     | user-toggle      | `node.transform` (persistent) |
| Rigging     | staging     | ✅ user-toggle             | ✅ user-toggle     | user-toggle      | `node.transform` (persistent) |
| Pose        | animation   | ❌ never                   | ❌ never           | user-toggle      | `animationStore.draftPose`    |
| Animation   | animation   | ❌ never                   | ❌ never           | user-toggle      | `animationStore.draftPose`    |

Three concerns are workspace-scoped:

1. **Mesh-level visualizations** (wireframe + vertex points) are only meaningful when the user is editing meshes. Object-level workspaces (Layout/Animation/Pose) suppress them so the viewport stays clean — selection feedback uses only the edge outline (Blender's "Object Mode" outline).

2. **Mesh edit mode** (the `meshEditMode` flag dimming non-selected parts + engaging the brush) only fires in Modeling/Rigging. Setting the flag in Modeling and switching to Layout doesn't drag the dimming into Layout — the policy gate forces it off at render time. Switching back to Modeling restores the flag automatically because we don't mutate the user's stored values.

3. **Editor mode** (`staging` vs `animation`) couples to workspace via the Topbar's workspace pill. Layout/Modeling/Rigging all use `staging` (edits target the rest pose / project structure). Pose/Animation use `animation` (edits become timeline keyframes; rest pose is preserved via `captureRestPose`).

## The viewport policy

Code: [`src/v3/shell/workspaceViewportPolicy.js`](../src/v3/shell/workspaceViewportPolicy.js).

The policy is a **pure function**, not a separate store. The user's preferences live in `editorStore.overlays` and `editorStore.meshEditMode`; the policy filters them at consumption time:

```js
applyWorkspacePolicy(overlays, meshEditMode, workspaceId)
  → { overlays, meshEditMode }   // effective values
```

**Why pure (vs a per-workspace stored override):**

- Switching workspaces back and forth doesn't lose the user's prior toggles
- `scenePass.draw` and `CanvasViewport`'s drag handlers can both call the same function — render and behaviour stay gated identically
- Adding a new workspace is one entry in the `WORKSPACE_POLICY` table; no migration

**Edge outline (`overlays.showEdgeOutline`) is allowed in every workspace** because it's the universal "this is selected" cue. Wireframe + vertices are mesh-edit-specific.

## Reset Pose semantics by mode

Code: [`src/services/PoseService.js`](../src/services/PoseService.js) — single source of truth, called from both [`Topbar.handleResetRestPose`](../src/v3/shell/Topbar.jsx) (button click) and [`RigService.initializeRig`](../src/services/RigService.js) (pre-Init reset, BUG-004/008/010 fix).

The Reset Pose button sits at the top-right of the Topbar in EVERY workspace. What it actually does depends on the editor mode because of how bone-controller drags persist:

| Mode      | PoseService function | What it does                                                                           |
|-----------|----------------------|----------------------------------------------------------------------------------------|
| animation | `resetPoseDraft()`   | Clears `animationStore.draftPose` + zeros every parameter to its default. Committed timeline keyframes survive. |
| staging   | `resetToRestPose()`  | Same as animation, PLUS zeros `node.transform.{rotation,x,y,scaleX,scaleY}` for every group with a `boneRole` (preserving pivots). Per-part transforms (non-bone) are preserved. |

The split exists because in staging mode `SkeletonOverlay`'s rotation drag writes straight to `node.transform.rotation` (persistent project state, undoable). There's no transient layer to clear — we have to walk the bone groups and reset them. Per-part transforms (e.g. positioning a hat sticker in the Outliner) are NOT reset because those are intentional layout, not pose; for those the user has [Properties → Reset Transform](../src/v3/editors/properties/tabs/ObjectTab.jsx) (GAP-014).

`RigService.initializeRig` calls `resetToRestPose()` BEFORE harvesting so the rig builder sees a clean rest geometry — this is the BUG-004/008/010 fix (Init Rig used to leave armature posed while mesh reset, leave bone-moved layers frozen, and break Iris Offset; all three traced back to harvesting against a non-rest pose).

## Wizard cleanup contract

Code: [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) → `handleWizardComplete` + `handleWizardSkip`.

Both wizard exits clear:

- `editorStore.selection` (legacy node-id array)
- `useSelectionStore.items` (universal selection)
- `meshEditMode`, `blendShapeEditMode`, `activeBlendShapeId`
- `skeletonEditMode`

Why: during the wizard the user can interact with parts via the Outliner, the canvas, or the wizard's own UI. Any of those interactions might write selection / mesh-edit flags into the editor store. Without this cleanup those flags survive into the post-import workspace and produce sticky selection outlines (BUG-012).

## Adding a new workspace

1. Add the entry to `WORKSPACE_POLICY` in [`workspaceViewportPolicy.js`](../src/v3/shell/workspaceViewportPolicy.js)
2. Add the preset (areas + tabs) in [`uiV3Store.js`](../src/store/uiV3Store.js)
3. Add the workspace pill to `WORKSPACES` in [`Topbar.jsx`](../src/v3/shell/Topbar.jsx)
4. Add a row to the matrix at the top of this doc

Default policy fallback for unknown workspace names is **Modeling-permissive** — i.e., wireframe and meshEditMode honoured. That way a typo or forgotten table entry fails open (everything visible) rather than closed (a confusing blank viewport).
