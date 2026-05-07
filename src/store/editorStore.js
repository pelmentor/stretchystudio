import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore.js';
import { useProjectStore } from './projectStore.js';

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
   *    Edit Mode on mesh data (editMode === 'edit', dataKind === 'mesh'):
   *      'brush'          — default (multi-vertex deform brush; UV
   *                          adjust when `meshSubMode === 'adjust'`)
   *      'add_vertex'     — click adds a vertex at the cursor
   *      'remove_vertex'  — click removes the nearest vertex
   *
   *    Edit Mode on armature data (editMode === 'edit', dataKind === 'armature'):
   *      'pivot_drag'     — default (drag joints to write
   *                          `node.transform.pivotX/Y` — rest bind edit)
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

  // BLENDER_FIDELITY: removed 2026-05-03 — `dragState` and
  // `armedParameterId` lived here but had no readers anywhere in the
  // codebase. All drag state is owned by per-component refs
  // (CanvasViewport.dragRef, SkeletonOverlay.dragRef) where it belongs.
  // The setters are removed alongside the fields below.

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
    /** PP2-010(b) — per-warp visibility map: `warpId → boolean`.
     *  Surfaces in the Outliner Rig tab as an eye icon per warp row.
     *  Missing entry = visible (default true), so the map only carries
     *  user-hidden warps. The master `warpGrids` toggle still applies
     *  on top — when it's off, the per-warp map is irrelevant. */
    warpGridVisibility: /** @type {Record<string, boolean>} */ ({}),
    /** PP1-007 — opacity for warp grid overlays in the 0..1 range.
     *  Default 0.25 so all warps are visible-but-quiet by default; the
     *  selected warp paints at full opacity for accent.
     *  Pairs with the `warpGrids` boolean (master on/off). */
    warpGridsOpacity: 0.25,
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
   *    - null           → Object Mode (no edit interaction; selection only)
   *    - 'edit'         → Blender's universal `OB_MODE_EDIT`. Editor
   *                       behaviour dispatches by the active object's
   *                       dataKind:
   *                         · mesh dataKind     → vertex / UV editing
   *                                               (meshSubMode applies)
   *                         · armature dataKind → bone REST pivot drag
   *                                               (writes node.transform.pivotX/Y)
   *                       Renamed 2026-05-07 from legacy `'mesh'` to match
   *                       Blender's universal Edit Mode taxonomy (one
   *                       OB_MODE_EDIT slot, dispatch by data type). The
   *                       v25 schema migration rewrites stored `'mesh'`
   *                       editMode values to `'edit'`.
   *    - 'skeleton'     → POSE MODE. Joint drag writes to `node.pose.*`;
   *                       rotation arcs write to `node.pose.rotation`
   *                       or the driver param. Apply Pose As Rest is
   *                       the bake path.
   *    - 'blendShape'   → painting deltas onto `activeBlendShapeId`.
   *                       Same brush behaviour as Edit Mode on a mesh;
   *                       write target is the blendShape's deltas array.
   *
   *  Selection drives entry: `enterEditMode('edit')` works for both
   *  meshed parts and bone groups; `enterEditMode('blendShape')` needs
   *  a meshed part; `enterEditMode('skeleton')` needs a bone-role
   *  group. The Tab keybind in `mode.editToggle` enforces this. */
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

  /** V4 Properties reform — collapse state per Properties section, by
   *  registry id. Persists across selections so the user's "I never
   *  want Rig Stages expanded" preference survives clicking around the
   *  Outliner. Sparse: missing entry = expanded (default). */
  propertiesSectionsCollapsed: new Set(),

  /** BFA-002 — Auto-Keying. When true, property changes in animation mode
   *  automatically write keyframes at the playhead. Default `false` to
   *  match Blender (canonical "explicit `K` to insert" path; the red
   *  record-dot button in the timeline header opts the user into the
   *  Auto-Key shortcut on demand). */
  autoKeyframe: false,

  /** BVR-007 — N-panel (right-edge tool settings) visibility. Blender's
   *  `N` toggle. Default false matches Blender (panel collapsed until
   *  explicitly summoned with N). */
  toolPanelVisible: false,

  /** The ID of the blend shape currently being edited; only meaningful
   *  when editMode === 'blendShape'. Cleared on exitEditMode + on any
   *  selection-head change. */
  activeBlendShapeId: null,

  /** V4 Phase 3b — Keyform edit mode payload. Only meaningful when
   *  `editMode === 'keyform'`.
   *
   *  Shape:
   *    {
   *      deformerId:    string,        // node id under edit
   *      keyformIndex:  number,        // index into deformer.keyforms[]
   *      keyTuple:      number[],      // the active key tuple (locked while editing)
   *      snapshot:      object,        // deep copy of keyforms[keyformIndex]
   *                                    // before any drag — used for Cancel restore
   *      authoredOnEntry: boolean,     // whether the keyform already had
   *                                    // _userAuthored:true before edit (so we
   *                                    // don't strip it on Cancel of an existing
   *                                    // user-authored keyform)
   *    }
   *
   *  Cleared on exitEditMode / commitKeyformEdit / cancelKeyformEdit. */
  keyformEdit: null,

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
    //
    // Phase 2b storage flip — clear the prior active object's stored
    // mode so per-object record + global slot stay consistent (both
    // null after a selection-clearing transition). The new active
    // object gets a fresh start: editMode null in both stores until
    // the user Tab's into something.
    const priorActive = state.selection[0];
    if (priorActive && state.editMode) {
      useProjectStore.getState().setActiveObjectMode(priorActive, null);
    }
    const newActive = nodeIds[0];
    if (newActive && newActive !== priorActive) {
      // Defensive: if the new active object happens to carry a stale
      // `mode` field (from a prior session before this dual-write
      // shipped, or from a side-channel write), clear it so the global
      // null is the source of truth on entry.
      useProjectStore.getState().setActiveObjectMode(newActive, null);
    }
    return {
      selection: nodeIds,
      editMode: null,
      activeBlendShapeId: null,
      keyformEdit: null,
    };
  }),

  /** Enter a contextual edit mode.
   *  kind ∈ {'edit','skeleton','blendShape','keyform','weightPaint'}.
   *  Legacy alias `'mesh'` is accepted and normalised to `'edit'`.
   *  For 'blendShape', opts.blendShapeId is required — without it the
   *  call is a no-op (blendShape edit needs to know which shape).
   *  For 'keyform', opts.deformerId + opts.keyformIndex + opts.keyTuple
   *  + opts.snapshot are required; on success populates `keyformEdit`.
   *  For 'weightPaint', no opts required (V4 Phase 4b — selection drives
   *  the active part).
   *  Returns nothing; read editMode after. */
  enterEditMode: (kind, opts = {}) => set((state) => {
    // Legacy alias normalisation: 'mesh' → 'edit' (Blender taxonomy).
    if (kind === 'mesh') kind = 'edit';
    if (kind !== 'edit' && kind !== 'skeleton'
        && kind !== 'blendShape' && kind !== 'keyform'
        && kind !== 'weightPaint') return state;
    if (kind === 'blendShape' && !opts.blendShapeId) return state;
    if (kind === 'keyform') {
      if (!opts.deformerId || typeof opts.keyformIndex !== 'number') return state;
      if (!Array.isArray(opts.keyTuple) || !opts.snapshot) return state;
    }
    // Restore the user's last-used tool for this mode if persisted —
    // sticky choices (e.g. preferring `add_vertex` over the default
    // `brush`) survive Tab out / Tab in and page reloads. Falls back
    // to the canonical default when nothing has been recorded yet.
    const persisted = usePreferencesStore.getState().lastToolByMode ?? {};
    let toolMode = persisted[kind];
    if (typeof toolMode !== 'string' || toolMode.length === 0) {
      if (kind === 'edit' || kind === 'blendShape' || kind === 'weightPaint') toolMode = 'brush';
      else if (kind === 'skeleton') toolMode = 'joint_drag';
      else if (kind === 'keyform') toolMode = 'select';
      else toolMode = 'select';
    }
    // Phase 2b storage flip — mirror the new mode onto the active
    // object's `Object.mode` field. Project state is now the canonical
    // record; the editorStore.editMode slot remains the authoritative
    // read for now (subscribers across CanvasViewport / SkeletonOverlay
    // / GizmoOverlay / ModePill all subscribe here), but the per-object
    // record means future readers can switch over without a data
    // migration. No-op when nothing is selected.
    const activeId = state.selection[0];
    if (activeId) {
      useProjectStore.getState().setActiveObjectMode(activeId, kind);
    }
    return {
      editMode: kind,
      activeBlendShapeId: kind === 'blendShape' ? opts.blendShapeId : null,
      keyformEdit: kind === 'keyform' ? {
        deformerId:      opts.deformerId,
        keyformIndex:    opts.keyformIndex,
        keyTuple:        opts.keyTuple.slice(),
        snapshot:        opts.snapshot,
        authoredOnEntry: opts.authoredOnEntry === true,
      } : null,
      toolMode,
    };
  }),

  /** Exit any contextual edit mode back to object mode. Idempotent.
   *  Does NOT restore keyform from snapshot — that's `cancelKeyformEdit`'s
   *  job. Calling `exitEditMode` while in keyform mode commits whatever
   *  the user has dragged so far (Apply semantics). */
  exitEditMode: () => set((state) => {
    // Phase 2b storage flip — clear the active object's stored mode
    // so the per-object record matches "this object is in Object Mode".
    const activeId = state.selection[0];
    if (activeId) {
      useProjectStore.getState().setActiveObjectMode(activeId, null);
    }
    return {
      editMode: null,
      activeBlendShapeId: null,
      keyformEdit: null,
      toolMode: 'select',
    };
  }),

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
  setViewLayers:        (partial)  => set((state) => {
    const next = { ...state.viewLayers, ...partial };
    // Skeleton-edit requires a visible skeleton — toggling skeleton
    // off implicitly drops the user out of skeleton edit mode.
    if ('skeleton' in partial && !partial.skeleton
        && state.editMode === 'skeleton') {
      // Phase 2b — keep the per-object mode record in sync with the
      // global slot.
      const activeId = state.selection[0];
      if (activeId) {
        useProjectStore.getState().setActiveObjectMode(activeId, null);
      }
      return { viewLayers: next, editMode: null };
    }
    return { viewLayers: next };
  }),
  /** PP2-010(b) — toggle a single warp's visibility in the lattice
   *  overlay. Pass `visible` to set explicitly; omit to toggle from
   *  the current value (default true → false on first click). */
  toggleWarpGridVisibility: (warpId, visible) => set((state) => {
    if (!warpId) return state;
    const cur = state.viewLayers.warpGridVisibility ?? {};
    const next = { ...cur };
    const target = typeof visible === 'boolean'
      ? visible
      : !(cur[warpId] !== false);
    if (target) {
      // Visible is the default — drop the entry to keep the map sparse.
      delete next[warpId];
    } else {
      next[warpId] = false;
    }
    return { viewLayers: { ...state.viewLayers, warpGridVisibility: next } };
  }),
  setMeshDefaults:      (partial)  => set((state) => ({ meshDefaults: { ...state.meshDefaults, ...partial } })),
  setActiveLayerTab:    (tab)      => set({ activeLayerTab: tab }),
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
  toggleToolPanel:      ()         => set((s) => ({ toolPanelVisible: !s.toolPanelVisible })),
  setToolPanelVisible:  (v)        => set({ toolPanelVisible: !!v }),
  togglePropertiesSection: (id) => set((s) => {
    if (typeof id !== 'string' || id.length === 0) return s;
    const next = new Set(s.propertiesSectionsCollapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { propertiesSectionsCollapsed: next };
  }),
}));
