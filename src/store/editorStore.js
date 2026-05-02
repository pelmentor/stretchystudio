import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore.js';

// Editor state (UI state, selection, view transform, drag state)
export const useEditorStore = create((set) => ({
  selection: [], // array of node IDs

  /** Active tool. Scoped to the current `editMode` — the canvas
   *  toolbar surfaces a different list per mode and resets to the
   *  mode's default on enter/exit.
   *
   *    Object Mode (editMode === null):
   *      'select'         — default (click-to-select; topmost wins)
   *
   *    Mesh Edit (editMode === 'mesh'):
   *      'brush'          — default (multi-vertex deform brush; UV
   *                          adjust when `meshSubMode === 'adjust'`)
   *      'add_vertex'     — click adds a vertex at the cursor
   *      'remove_vertex'  — click removes the nearest vertex
   *
   *    Skeleton (editMode === 'skeleton'):
   *      'joint_drag'     — default (drag joints in SkeletonOverlay)
   *
   *    BlendShape (editMode === 'blendShape'):
   *      'brush'          — default (paint deltas into the active
   *                          blendShape)
   */
  toolMode: 'select',

  /** GAP-010 Phase B — independent view (zoom + pan) per canvas mode.
   *  The viewport tab and the livePreview tab are two views of the
   *  same character, but the user typically wants different framing
   *  for each (zoomed-in to a face for editing vs framed full-body
   *  for live preview). Keying view state by mode keeps each tab's
   *  framing intact when toggling between them.
   *
   *  CanvasViewport derives `currentModeKey` from its `previewMode`
   *  prop and reads `viewByMode[currentModeKey]`. Overlays mounted
   *  only in edit mode (Gizmo / Warp / Rotation deformer) always
   *  read `viewByMode.viewport`. */
  viewByMode: {
    viewport:    { zoom: 1, panX: 0, panY: 0 },
    livePreview: { zoom: 1, panX: 0, panY: 0 },
  },

  dragState: {
    isDragging: false,
    partId: null,
    vertexIndex: null,
  },

  armedParameterId: null,

  /** GAP-016 — Single map of every visualization toggle, surfaced in
   *  ViewLayersPopover. Replaces the prior split between
   *  `editorStore.overlays.*` (display flags) and the standalone
   *  `editorStore.showSkeleton` boolean.
   *
   *  Workspace policy module was deleted 2026-05-02 — workspaces no
   *  longer gate visualizations or edit modes. `viewLayers` is read
   *  directly by scenePass and the renderer. */
  viewLayers: {
    image:          true,
    wireframe:      false,
    vertices:       false,
    edgeOutline:    false,
    skeleton:       true,
    irisClipping:   true,
    warpGrids:      true,
    rotationPivots: true,
  },

  /** Default mesh generation parameters (used when no per-part override) */
  meshDefaults: {
    alphaThreshold: 5,
    smoothPasses:   0,
    gridSpacing:    30,
    edgePadding:    8,
    numEdgePoints:  80,
  },

  /** Active tab in the Layers panel: 'depth' (draw order) or 'groups' (hierarchy) */
  activeLayerTab: 'depth',

  /** Editor mode: 'staging' = M3 workflow, 'animation' = timeline/keyframing active.
   *  Distinct axis from `editMode` below — editorMode is Spine-style
   *  Setup/Animate (timeline on/off), editMode is Blender-style
   *  contextual edit (mesh / skeleton / blendShape). */
  editorMode: 'staging',

  /** Single contextual edit mode. Replaces the prior triple of
   *  `meshEditMode` / `skeletonEditMode` / `blendShapeEditMode` flags
   *  that pretended to be orthogonal but were actually nested
   *  (blend-shape edit forced meshEditMode:true).
   *
   *  Industry pattern: Blender's Tab toggles into a contextual edit
   *  mode based on the active object's type. Spine and Cubism Editor
   *  follow the same shape via tool buttons. With one slot,
   *  enter/exit becomes a single transition the workspace policy can
   *  gate cleanly.
   *
   *  Values:
   *    - null         → object mode (no edit interaction)
   *    - 'mesh'       → part vertex/UV editing. meshSubMode applies.
   *    - 'skeleton'   → bone joint dragging. Requires
   *                     `viewLayers.skeleton` (overlay must show
   *                     joints to drag them).
   *    - 'blendShape' → painting deltas onto `activeBlendShapeId`.
   *                     Same brush behaviour as mesh edit; write
   *                     target is the blendShape's deltas array.
   *
   *  Selection drives entry: enterEditMode('mesh' | 'blendShape')
   *  needs a meshed part selection; enterEditMode('skeleton') needs
   *  a bone-role group. The Tab keybind in `mode.editToggle`
   *  enforces this; direct callers (BlendShapeTab arm button,
   *  PsdImportService finalize) take responsibility for the gate. */
  editMode: null,

  /** Sub-mode while in mesh edit mode: 'deform' moves vertices, 'adjust' moves UVs.
   *  Sticky across re-entries — re-entering mesh-edit remembers the
   *  user's last sub-mode (Blender-equivalent). */
  meshSubMode: 'deform',

  /** Brush settings for deform mode */
  brushSize:     50,  // screen-space radius in pixels
  brushHardness: 0.5, // 0 = smooth cosine falloff, 1 = uniform hard

  // GAP-015 Phase B — proportional-edit settings live in
  // `preferencesStore.proportionalEdit` so they persist across
  // sessions. Don't duplicate them here.

  /** Set of group IDs that are expanded in the Groups tab UI */
  expandedGroups: new Set(),

  /** When true, property changes in animation mode automatically create/update keyframes */
  autoKeyframe: true,

  /** The ID of the blend shape currently being edited; only meaningful
   *  when editMode === 'blendShape'. Cleared on exitEditMode + on any
   *  selection-head change. */
  activeBlendShapeId: null,

  // GAP-001 — PSD import wizard state (step + pendingPsd + snapshot)
  // moved to `wizardStore`. Actions live in `services/PsdImportService`.

  setSelection: (nodeIds) => set((state) => {
    const sameHead = nodeIds.length > 0 && nodeIds[0] === state.selection[0];
    if (sameHead) return { selection: nodeIds };

    // Blender's "Lock Object Modes" (preferencesStore.lockObjectModes,
    // default true): while in edit mode, selection-head changes to a
    // DIFFERENT node are rejected. The user stays focused on the
    // currently-edited node until they Tab out. Empty selections
    // (clicking empty canvas) are allowed through — that's deselect-
    // all, not switch-to-another-piece — but they don't bring an edit
    // context to switch to, so editMode stays put (Blender's pattern:
    // empty selection in edit mode keeps you in edit mode).
    if (state.editMode && nodeIds.length > 0) {
      const lockObjectModes = usePreferencesStore.getState().lockObjectModes;
      if (lockObjectModes) {
        // Reject the selection change entirely.
        return state;
      }
    }

    // No lock (or no editMode active): selection-head change drops
    // any active edit mode — the new selection's edit context is
    // unrelated.
    return {
      selection: nodeIds,
      editMode: null,
      activeBlendShapeId: null,
    };
  }),

  /** Enter a contextual edit mode. kind ∈ {'mesh','skeleton','blendShape'}.
   *  For 'blendShape', opts.blendShapeId is required — without it the
   *  call is a no-op (blendShape edit needs to know which shape).
   *  Returns nothing; read editMode after. */
  enterEditMode: (kind, opts = {}) => set((state) => {
    if (kind !== 'mesh' && kind !== 'skeleton' && kind !== 'blendShape') return state;
    if (kind === 'blendShape' && !opts.blendShapeId) return state;
    // Restore the user's last-used tool for this mode if persisted —
    // sticky choices (e.g. preferring `add_vertex` over the default
    // `brush`) survive Tab out / Tab in and page reloads. Falls back
    // to the canonical default when nothing has been recorded yet.
    const persisted = usePreferencesStore.getState().lastToolByMode ?? {};
    let toolMode = persisted[kind];
    if (typeof toolMode !== 'string' || toolMode.length === 0) {
      if (kind === 'mesh' || kind === 'blendShape') toolMode = 'brush';
      else if (kind === 'skeleton') toolMode = 'joint_drag';
      else toolMode = 'select';
    }
    return {
      editMode: kind,
      activeBlendShapeId: kind === 'blendShape' ? opts.blendShapeId : null,
      toolMode,
    };
  }),

  /** Exit any contextual edit mode back to object mode. Idempotent. */
  exitEditMode: () => set({ editMode: null, activeBlendShapeId: null, toolMode: 'select' }),

  setMeshSubMode:       (mode)     => set({ meshSubMode: mode, toolMode: 'brush' }),
  setBrush:             (partial)  => set((s) => ({ brushSize: s.brushSize, brushHardness: s.brushHardness, ...partial })),
  /** GAP-010 Phase B — first arg is the mode key, second is the
   *  partial view update. `setView('viewport', { zoom: 2 })` updates
   *  just the viewport tab's view and leaves livePreview's untouched. */
  setView: (modeKey, partial) => set((state) => {
    if (modeKey !== 'viewport' && modeKey !== 'livePreview') return state;
    return {
      viewByMode: {
        ...state.viewByMode,
        [modeKey]: { ...state.viewByMode[modeKey], ...partial },
      },
    };
  }),
  setToolMode: (mode) => set((state) => {
    if (typeof mode !== 'string' || mode === state.toolMode) return state;
    // Persist the new tool against the current edit mode so the next
    // entry into this mode (Tab out → Tab in, or next session)
    // restores the user's choice rather than the canonical default.
    // Object Mode uses the `'object'` key.
    const modeKey = state.editMode ?? 'object';
    usePreferencesStore.getState().setLastToolForMode(modeKey, mode);
    return { toolMode: mode };
  }),
  setDragState:         (ds)       => set((state) => ({ dragState: { ...state.dragState, ...ds } })),
  setArmedParameterId:  (id)       => set({ armedParameterId: id }),
  setViewLayers:        (partial)  => set((state) => {
    const next = { ...state.viewLayers, ...partial };
    // Skeleton-edit requires a visible skeleton — toggling skeleton
    // off implicitly drops the user out of skeleton edit mode.
    if ('skeleton' in partial && !partial.skeleton && state.editMode === 'skeleton') {
      return { viewLayers: next, editMode: null };
    }
    return { viewLayers: next };
  }),
  setMeshDefaults:      (partial)  => set((state) => ({ meshDefaults: { ...state.meshDefaults, ...partial } })),
  setActiveLayerTab:    (tab)      => set({ activeLayerTab: tab }),
  setEditorMode:        (mode)     => set({ editorMode: mode }),
  toggleGroupExpand:    (id)       => set((s) => {
    const next = new Set(s.expandedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { expandedGroups: next };
  }),
  expandGroup:          (id)       => set((s) => {
    if (s.expandedGroups.has(id)) return s;
    return { expandedGroups: new Set([...s.expandedGroups, id]) };
  }),
  setExpandedGroups:    (ids)      => set({ expandedGroups: new Set(ids) }),
  setAutoKeyframe:      (on)       => set({ autoKeyframe: on }),
}));
