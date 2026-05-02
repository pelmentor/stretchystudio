// @ts-check

/**
 * v3 — Workspace viewport visualization policy.
 *
 * In Blender's mental model, the active workspace dictates which mesh-
 * level visualizations make sense:
 *
 *   - **Layout / Animation / Pose**: object-level interaction. Selection
 *     feedback is the edge outline only ("you have something selected"),
 *     never wireframe or vertex points. Mesh edit mode is meaningless
 *     here (the user isn't editing meshes), so any prior toggle is
 *     ignored at render time.
 *
 *   - **Modeling**: full mesh-edit toolkit. Wireframe / vertices / edge
 *     outline overlays all honour the user's toggles. Mesh edit mode
 *     dimming + brush behaviour are active.
 *
 *   - **Rigging**: bone- and deformer-focused. Mesh visualizations
 *     allowed (user often needs to see mesh edges while painting
 *     weights), but it's not the primary mode of work.
 *
 * The user's overlay toggles in `editorStore.overlays` and the
 * `editorStore.meshEditMode` flag are PRESERVED across workspace
 * switches — they're the user's preference. The policy below GATES
 * whether those flags have visible effect for the active workspace,
 * so flipping back to Modeling restores the user's prior setup.
 *
 * **Why centralized:** scenePass.draw and CanvasViewport's drag
 * handlers both need the same "is mesh edit mode actually active?"
 * answer. A single pure function keeps render and behaviour
 * gated identically — no chance of e.g. dimming engaging while
 * brush events stay dead.
 *
 * @module v3/shell/workspaceViewportPolicy
 */

/**
 * @typedef {('layout'|'modeling'|'rigging'|'animation'|'pose')} WorkspaceId
 *
 * @typedef {Object} OverlayFlags
 * @property {boolean} [showImage]
 * @property {boolean} [showWireframe]
 * @property {boolean} [showVertices]
 * @property {boolean} [showEdgeOutline]
 * @property {boolean} [irisClipping]
 *
 * @typedef {Object} ViewportPolicy
 * @property {boolean} allowMeshEdit       - if false, meshEditMode is
 *                                            forced off at render + drag.
 *                                            Edge-outline-on-selection
 *                                            still works (it's the
 *                                            cross-mode "selected" cue).
 * @property {boolean} allowWireframeViz   - if false, wireframe + vertex
 *                                            overlays are forced off
 *                                            regardless of toggle.
 *
 * @typedef {Object} EffectiveViewport
 * @property {OverlayFlags} overlays
 * @property {boolean} meshEditMode
 */

/**
 * Per-workspace policy table. The TWO knobs are intentional:
 *
 *  - allowMeshEdit governs the meshEditMode flag (dimming + brush)
 *  - allowWireframeViz governs the wireframe + vertices overlays
 *
 * Edge outline is allowed in EVERY workspace because it's the
 * universal "this object is selected" feedback (Blender shows the
 * outline in Object Mode too).
 *
 * @type {Record<WorkspaceId, ViewportPolicy>}
 */
export const WORKSPACE_POLICY = Object.freeze({
  layout:    { allowMeshEdit: false, allowWireframeViz: false },
  modeling:  { allowMeshEdit: true,  allowWireframeViz: true  },
  rigging:   { allowMeshEdit: true,  allowWireframeViz: true  },
  animation: { allowMeshEdit: false, allowWireframeViz: false },
  pose:      { allowMeshEdit: false, allowWireframeViz: false },
});

/**
 * Apply the active workspace's policy to the user's overlay + meshEdit
 * flags. Returns the EFFECTIVE values that scenePass + drag handlers
 * should consume.
 *
 * The user's stored values are NOT mutated — pass them in fresh from
 * editorStore each call. Switching back to a permissive workspace
 * restores their prior toggles automatically because they were never
 * changed.
 *
 * @param {OverlayFlags} overlays
 * @param {boolean} meshEditMode
 * @param {WorkspaceId|string|null|undefined} workspaceId
 * @returns {EffectiveViewport}
 */
export function applyWorkspacePolicy(overlays, meshEditMode, workspaceId) {
  const policy = WORKSPACE_POLICY[/** @type {WorkspaceId} */ (workspaceId)]
    ?? WORKSPACE_POLICY.modeling; // permissive fallback for unknown workspaces

  const effOverlays = { ...(overlays ?? {}) };
  if (!policy.allowWireframeViz) {
    effOverlays.showWireframe = false;
    effOverlays.showVertices = false;
  }
  // showEdgeOutline + showImage + irisClipping are always honoured —
  // they're either selection feedback (edge) or non-mesh-edit concerns
  // (image visibility, clip mask).

  return {
    overlays: effOverlays,
    meshEditMode: policy.allowMeshEdit ? !!meshEditMode : false,
  };
}

/**
 * Convenience: just the meshEditMode side of the policy. CanvasViewport
 * drag handlers call this on every event to decide whether to engage
 * brush behaviour.
 *
 * @param {boolean} meshEditMode
 * @param {WorkspaceId|string|null|undefined} workspaceId
 * @returns {boolean}
 */
export function isMeshEditAllowed(meshEditMode, workspaceId) {
  if (!meshEditMode) return false;
  const policy = WORKSPACE_POLICY[/** @type {WorkspaceId} */ (workspaceId)]
    ?? WORKSPACE_POLICY.modeling;
  return policy.allowMeshEdit;
}
