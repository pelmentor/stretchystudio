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
   *      'select'         — default (Toolset Phase 0; Blender pattern):
   *                          LMB picks a vertex, Shift+LMB toggles,
   *                          Ctrl+LMB selects shortest topology path,
   *                          empty-canvas LMB deselects all
   *      'brush'          — multi-vertex deform brush (or UV adjust
   *                          when `meshSubMode === 'adjust'`)
   *      'add_vertex'     — click adds a vertex at the cursor
   *      'remove_vertex'  — click removes the nearest vertex
   *
   *    Edit Mode on armature data (editMode === 'edit', dataKind === 'armature'):
   *      'pivot_drag'     — default (drag joints to write
   *                          `node.transform.pivotX/Y` — rest bind edit)
   *
   *    Pose Mode (editMode === 'pose'):
   *      'joint_drag'     — default (drag joints in SkeletonOverlay)
   *
   *    Edit Mode + active blend shape (editMode === 'edit', activeBlendShapeId set):
   *      'brush'          — default (paint deltas into the active shape).
   *                          Folded into Edit Mode 2026-05-07 — Blender's
   *                          pattern (Mesh → Shape Keys panel + active-shape
   *                          pointer); SS no longer has a separate 'blendShape'
   *                          mode.
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
   *    - 'pose'         → Blender's `OB_MODE_POSE`. Joint drag writes
   *                       to `node.pose.*`; rotation arcs write to
   *                       `node.pose.rotation` or the driver param.
   *                       Apply Pose As Rest is the bake path. Renamed
   *                       from legacy `'skeleton'` 2026-05-07
   *                       (BLENDER_DEVIATION_AUDIT Fix 2). v27 schema
   *                       migration rewrites stored values.
   *
   *  Blend-shape painting lives INSIDE Edit Mode (Blender pattern):
   *  set `activeBlendShapeId` on the active part, then the Edit Mode
   *  brush writes shape deltas. Pre-2026-05-07 SS had a separate
   *  `editMode === 'blendShape'` slot — folded into Edit Mode +
   *  pointer 2026-05-07 (BLENDER_DEVIATION_AUDIT Fix 1).
   *  `enterEditMode('blendShape', { blendShapeId })` is preserved as
   *  a legacy alias that enters `'edit'` and sets the pointer
   *  atomically; v26 migration rewrites stored `'blendShape'` modes.
   *
   *  Selection drives entry: `enterEditMode('edit')` works for both
   *  meshed parts and bone groups; `enterEditMode('pose')` needs
   *  a bone-role group. The Tab keybind in `mode.editToggle` enforces
   *  this. */
  editMode: null,

  /** Sub-mode while in mesh edit mode: 'deform' moves vertices, 'adjust' moves UVs.
   *  Sticky across re-entries — re-entering mesh-edit remembers the
   *  user's last sub-mode (Blender-equivalent). */
  meshSubMode: 'deform',

  /** Brush settings for deform mode */
  brushSize:     50,  // screen-space radius in pixels
  brushHardness: 0.5, // 0 = smooth cosine falloff, 1 = uniform hard

  /** Toolset Plan Phase 7.B — Weight Paint brush settings.
   *
   *    weightPaintBrush — id from `WEIGHT_BRUSHES` registry
   *                   (`'draw' | 'blur'`). 'draw' lerps toward
   *                   `brushWeight` (or 0 with Shift held); 'blur'
   *                   averages each affected vertex's weight against
   *                   its neighbors' mean.
   *    brushWeight  — target weight value [0,1]; 'draw' brush lerps
   *                   each affected vertex toward this value (Shift
   *                   inverts toward 0). Updated by Sample Weight
   *                   (`Shift+X`, Phase 7.B.1) — eyedropper picks
   *                   the vertex's weight under the cursor.
   *    brushStrength — per-tick lerp factor [0,1] (default 0.5).
   *                   Same role as Blender's `brush.alpha *
   *                   pressure_alpha` per `paint_weight.cc:1238`
   *                   `final_alpha = factors[i] * brush_strength *
   *                    brush_alpha_pressure`. Wired to BOTH draw and
   *                   blur in WeightPaintOverlay's flushPaint. Audit-fix
   *                   G-1 + G-4 + D-6: pre-fix the value was hardcoded
   *                   `0.5` in the overlay; the N-panel surfaced a
   *                   Hardness slider that wrote to `brushHardness`
   *                   (deform-only — silent no-op for weight paint).
   *
   * Reads by WeightPaintOverlay's stroke dispatch + ToolSettingsPanel's
   * weightPaint section. Independent of `brushSize`/`brushHardness` so
   * the size knob is shared across deform/sculpt/weight (matches
   * Blender's unified brush size). Hardness is deform-mode only today. */
  weightPaintBrush: 'draw',
  brushWeight:      1.0,
  brushStrength:    0.5,

  /** Toolset Plan Phase 3 — Sculpt mode brush settings. Independent of
   *  the deform-mode `brushSize`/`brushHardness` so the user's Edit-Mode
   *  brush size is preserved when they Tab into Sculpt and back. Reads
   *  by `SculptSection` (N-panel) and by `CanvasViewport`'s sculpt stroke
   *  dispatch.
   *
   *    activeBrush     — id from `SCULPT_BRUSHES` registry
   *                      (`'grab' | 'smooth' | 'pinch'`)
   *    size            — screen-space radius in pixels (mesh-local
   *                      computed from view.zoom at stroke start)
   *    strength        — 0..1 stroke intensity per tick
   *    falloff         — falloff curve id (matches Blender's set —
   *                      `'smooth' | 'sphere' | 'root' | 'linear' |
   *                       'sharp' | 'invSquare' | 'constant'`)
   *    iterations      — Smooth brush only; Laplacian passes per tick
   *    connectedOnly   — if true, brush only affects verts reachable
   *                      via triangle adjacency from the vert under the
   *                      cursor at stroke start (Blender's "Use Connected
   *                      Only" sculpt option). */
  sculpt: {
    activeBrush:   'grab',
    size:          80,
    strength:      0.5,
    falloff:       'smooth',
    iterations:    1,
    connectedOnly: false,
  },

  // GAP-015 Phase B — proportional-edit settings live in
  // `preferencesStore.proportionalEdit` so they persist across
  // sessions. Don't duplicate them here.

  /** Set of group IDs that are expanded in the Groups tab UI */
  expandedGroups: new Set(),

  /** V4 Properties reform — collapse state per Properties section, by
   *  registry id. Persists across selections so the user's "I never
   *  want Rig Stages expanded" preference survives clicking around the
   *  Outliner. Sparse: missing entry = expanded (default).
   *
   *  Stage 1.E (Audit-fix D-3): `'animData'` ships in the initial set
   *  so the Animation section is collapsed by default, mirroring
   *  Blender's `bl_options = {'DEFAULT_CLOSED'}` on `PropertiesAnimationMixin`
   *  (`reference/blender/scripts/startup/bl_ui/space_properties.py:136`).
   *  Per-Object Action bindings are rarely changed (Cubism characters
   *  bind once at import, never again) and would clutter the panel
   *  expanded by default. */
  propertiesSectionsCollapsed: new Set(['animData']),

  /** Blender-port — active tab id in the Properties editor. Maps to
   *  Blender's `space_buttons.mainb` (`source/blender/editors/space_buttons/space_buttons.cc:76`,
   *  default `BCONTEXT_OBJECT`). Sticky across selections; if the user
   *  picks the Modifiers tab on one part it stays Modifiers when they
   *  click the next part — matches Blender. When the sticky tab isn't
   *  applicable to the new selection (e.g. a parameter selected after
   *  a part), `PropertiesEditor` falls forward to the first visible
   *  tab via a useEffect; it does NOT mutate this slot, so re-selecting
   *  the original kind brings the user's preferred tab back.
   *
   *  Default `'object'` mirrors Blender's default Object tab
   *  (BCONTEXT_OBJECT — `space_buttons.cc:218`). Pre-2026-05-16 the
   *  tab id was `'item'` (SS vocabulary); renamed during the UI
   *  Blender-fidelity sweep so the id matches the Blender enum name. */
  propertiesActiveTab: 'object',

  /** F-1 sweep (2026-05-16) — Outliner header state lifted out of the
   *  OutlinerEditor body so the header can render in the per-area
   *  Header slot (`*_HT_header` Blender pattern) while the body stays
   *  the tree. State stays UI-ephemeral (not persisted to the project
   *  file). Mirrors the slots Blender keeps on `SpaceOutliner`:
   *   - `outlinerMode` ↔ `space.display_mode`
   *   - `outlinerSearchQuery` ↔ `space.filter_text`
   *   - `outlinerShowSelectedOnly` ↔ `space.show_filter_state` (VIEW_LAYER mode)
   *   - `outlinerHideHidden` ↔ `space.use_filter_hidden` */
  outlinerMode: 'viewLayer',
  outlinerSearchQuery: '',
  outlinerShowSelectedOnly: false,
  outlinerHideHidden: false,

  /** F2-1 sweep (2026-05-16) — NodeTree mode + driver fallback id lifted
   *  out of `NodeTreeArea` local useState so the NodeTreeHeader can
   *  drive them from the per-area Header slot. Mirrors Blender's
   *  `SpaceNode.tree_type` (`source/blender/makesdna/DNA_space_types.h`
   *  `bNodeTree::tree_type`). SS-specific: `nodeTreeDriverFallbackId`
   *  holds the user's last picked driver when the global selection
   *  doesn't point at a driven parameter — Blender has no direct analog
   *  because its NodeEditor's id pointer IS the canonical fallback. */
  nodeTreeMode: /** @type {'rig'|'driver'|'animation'} */ ('rig'),
  nodeTreeDriverFallbackId: /** @type {string|null} */ (null),

  /** Animation Phase 5 Slice 5.T — F-Curve editor "show seconds" toggle.
   *  Mirrors Blender's `SpaceGraph.flag & SIPO_DRAWTIME` bit
   *  (`reference/blender/source/blender/makesdna/DNA_space_enums.h:293`,
   *  RNA-exposed as `show_seconds` at
   *  `reference/blender/source/blender/makesrna/intern/rna_space.cc:7218-7221`
   *  with label "Use Timecode" and tooltip "Show timing as a timecode
   *  instead of frames"). Surfaced in the View menu of the FCurve
   *  header (Blender's `GRAPH_MT_view` at
   *  `reference/blender/scripts/startup/bl_ui/space_graph.py:240`).
   *
   *  When `false`: X-axis ticks render as frame numbers; Time field
   *  rows in the N-panel are labeled "Frame" with integer frame values.
   *  When `true`: X-axis ticks render as seconds (e.g. "0.5s"); Time
   *  field rows are labeled "Time (s)" with float second values.
   *
   *  Default `false` (frames) matches Blender's default — SS's prior
   *  "Time (ms)" / "0.5s" axis labels were themselves a deviation
   *  documented as Slice 5.Q Dev 3; this slot closes that deviation.
   *  Underlying canonical storage stays ms regardless of toggle —
   *  only the display + input-parse layer is affected. */
  fcurveShowSeconds: false,

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

  /** The ID of the blend shape currently being painted. Meaningful
   *  only inside `editMode === 'edit'` on a meshed part — Blender's
   *  "active shape key" pointer (Mesh data → Shape Keys panel). When
   *  set, Edit Mode's brush tool writes to the shape's deltas instead
   *  of the rest vertex positions. Cleared on `exitEditMode` and on
   *  any selection-head change.
   *
   *  Pre-2026-05-07 SS surfaced this as a separate `editMode ===
   *  'blendShape'` slot, which had no Blender counterpart. Folded into
   *  Edit Mode + this pointer 2026-05-07 (BLENDER_DEVIATION_AUDIT
   *  Fix 1; v26 migration). */
  activeBlendShapeId: null,

  /** Toolset Phase 0 — Edit-Mode vertex selection set.
   *
   *  Per-part selection: each part owns its own selection (Blender's
   *  Edit Mode model: selection lives on the `Mesh` datablock, not
   *  globally). Switching active part doesn't merge sets across parts.
   *
   *  Persistence rules (Phase 0.F):
   *    - Survives mode-switch out and back (Tab → Pose → Tab → Edit
   *      keeps your selection).
   *    - Cleared on Object-Mode entry (per Blender semantics).
   *    - Cleared on switching to a DIFFERENT active part.
   *    - Cleared per-part on mesh topology change (vertex count differs;
   *      the `invalidateVertexSelectionForPart` hook handles the
   *      add_vertex / remove_vertex / retriangulate paths).
   *
   *  Map keys are part ids (`projectStore.project.nodes[i].id`) for
   *  meshed parts. Set values are 0-based vertex indices into the
   *  part's `mesh.vertices[]`. */
  selectedVertexIndices: /** @type {Map<string, Set<number>>} */ (new Map()),

  /** Toolset Phase 0 — last-clicked vertex (Blender's "active element").
   *  Renders with a white-bordered orange dot on top of the regular
   *  selected dot. Cleared with `clearAllVertexSelections` and on
   *  Edit Mode exit. Pair (partId, vertIndex) so the active element
   *  scopes to its part — when the user switches to another part, the
   *  active vertex naturally goes inactive. */
  activeVertex: /** @type {{ partId: string, vertIndex: number } | null} */ (null),

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
      // Toolset Phase 0.F — selection-head change drops Edit Mode →
      // dropping out of Edit Mode clears the vertex selection (matches
      // Blender: leaving Edit Mode discards the per-part selection set).
      selectedVertexIndices: new Map(),
      activeVertex: null,
    };
  }),

  /** Enter a contextual edit mode.
   *  kind ∈ {'edit','pose','keyform','weightPaint'}.
   *  Legacy alias `'mesh'` is accepted and normalised to `'edit'`.
   *  Legacy alias `'skeleton'` is accepted and normalised to `'pose'`.
   *  Legacy alias `'blendShape'` enters Edit Mode and sets
   *  `activeBlendShapeId` from `opts.blendShapeId` — Blender's pattern
   *  where shape-key painting is Edit Mode + an active-shape pointer.
   *  Without `opts.blendShapeId` the alias call is a no-op.
   *  For 'keyform', opts.deformerId + opts.keyformIndex + opts.keyTuple
   *  + opts.snapshot are required; on success populates `keyformEdit`.
   *  For 'weightPaint', no opts required (V4 Phase 4b — selection drives
   *  the active part).
   *  Returns nothing; read editMode after. */
  enterEditMode: (kind, opts = {}) => set((state) => {
    // Legacy alias normalisation: 'mesh' → 'edit' (Blender taxonomy).
    if (kind === 'mesh') kind = 'edit';
    // Legacy alias normalisation: 'skeleton' → 'pose' (Blender taxonomy).
    if (kind === 'skeleton') kind = 'pose';
    // Legacy alias normalisation: 'blendShape' → 'edit' + active shape
    // pointer (Blender folds shape-key painting into Edit Mode).
    let activeShapeOnEntry = null;
    if (kind === 'blendShape') {
      if (!opts.blendShapeId) return state;
      activeShapeOnEntry = opts.blendShapeId;
      kind = 'edit';
    }
    if (kind !== 'edit' && kind !== 'pose'
        && kind !== 'keyform' && kind !== 'weightPaint'
        && kind !== 'sculpt') return state;
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
      // Toolset Phase 0.E — Edit Mode now defaults to `'select'`
      // (Blender pattern: Edit Mode opens with the Select tool active,
      // not Brush). Brush remains available via the T-panel for soft
      // proportional-edit drag. Weight Paint stays on `'brush'`
      // because painting IS the primary action for that mode.
      if (kind === 'edit') toolMode = 'select';
      else if (kind === 'weightPaint') toolMode = 'brush';
      else if (kind === 'pose') toolMode = 'joint_drag';
      else if (kind === 'keyform') toolMode = 'select';
      else if (kind === 'sculpt') toolMode = 'brush';
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
      // Active shape pointer survives only inside Edit Mode on a mesh.
      // When entering a non-Edit mode, clear it.
      activeBlendShapeId: kind === 'edit' ? activeShapeOnEntry : null,
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

  /** Set or clear the active blend shape pointer while in Edit Mode.
   *  Blender's pattern: select a shape key → brush paints its deltas;
   *  deselect → brush paints rest vertex positions. Pass `null` to
   *  clear. No-op outside Edit Mode. */
  setActiveBlendShape: (shapeId) => set((state) => {
    if (state.editMode !== 'edit') return state;
    return { activeBlendShapeId: shapeId ?? null };
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
      // Toolset Phase 0.F — leaving Edit Mode for Object Mode drops the
      // vertex selection set (Blender semantics).
      selectedVertexIndices: new Map(),
      activeVertex: null,
    };
  }),

  setMeshSubMode:       (mode)     => set({ meshSubMode: mode, toolMode: 'brush' }),
  setBrush:             (partial)  => set((s) => ({ brushSize: s.brushSize, brushHardness: s.brushHardness, ...partial })),
  /** Toolset Plan Phase 7.B — partial-merge writers for the weight-paint
   *  brush state. `setWeightPaintBrush('blur')` flips the active brush
   *  type; `setBrushWeight(0.5)` updates the eyedropper-driven target
   *  weight (clamped to [0,1]). */
  setWeightPaintBrush:  (id)       => set((s) => {
    if (typeof id !== 'string' || id === s.weightPaintBrush) return s;
    return { weightPaintBrush: id };
  }),
  setBrushWeight:       (w)        => set((s) => {
    const n = Number(w);
    if (!Number.isFinite(n)) return s;
    const clamped = Math.max(0, Math.min(1, n));
    if (clamped === s.brushWeight) return s;
    return { brushWeight: clamped };
  }),
  setBrushStrength:     (str)      => set((s) => {
    const n = Number(str);
    if (!Number.isFinite(n)) return s;
    const clamped = Math.max(0, Math.min(1, n));
    if (clamped === s.brushStrength) return s;
    return { brushStrength: clamped };
  }),
  /** Toolset Plan Phase 3 — partial-merge writer for Sculpt brush
   *  settings. `setSculpt({ size: 120 })` updates only `sculpt.size`;
   *  every other field is preserved. */
  setSculpt:            (partial)  => set((s) => ({ sculpt: { ...s.sculpt, ...(partial ?? {}) } })),
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
    // Pose Mode requires the skeleton overlay visible — toggling it
    // off implicitly drops the user out of Pose Mode.
    // (`viewLayers.skeleton` is the overlay-visibility flag, NOT the
    // editMode value — kept under that name because it's a layer name.)
    if ('skeleton' in partial && !partial.skeleton
        && state.editMode === 'pose') {
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
  setPropertiesActiveTab: (id) => set((s) => {
    if (typeof id !== 'string' || id.length === 0) return s;
    if (s.propertiesActiveTab === id) return s;
    return { propertiesActiveTab: id };
  }),

  // ── Outliner header state (F-1 sweep) ──────────────────────────────
  setOutlinerMode: (mode) => set((s) => {
    if (typeof mode !== 'string' || mode.length === 0) return s;
    if (s.outlinerMode === mode) return s;
    return { outlinerMode: mode };
  }),
  setOutlinerSearchQuery: (q) => set((s) => {
    const next = typeof q === 'string' ? q : '';
    if (s.outlinerSearchQuery === next) return s;
    return { outlinerSearchQuery: next };
  }),
  setOutlinerShowSelectedOnly: (v) => set({ outlinerShowSelectedOnly: !!v }),
  setOutlinerHideHidden:       (v) => set({ outlinerHideHidden: !!v }),

  // ── NodeTree header state (F2-1 sweep) ─────────────────────────────
  setNodeTreeMode: (mode) => set((s) => {
    if (mode !== 'rig' && mode !== 'driver' && mode !== 'animation') return s;
    if (s.nodeTreeMode === mode) return s;
    return { nodeTreeMode: mode };
  }),
  setNodeTreeDriverFallbackId: (id) => set((s) => {
    const next = (typeof id === 'string' && id.length > 0) ? id : null;
    if (s.nodeTreeDriverFallbackId === next) return s;
    return { nodeTreeDriverFallbackId: next };
  }),

  // ── FCurveEditor show-seconds toggle (Slice 5.T) ───────────────────
  /** Set the F-Curve editor's "show seconds" flag. Booleanises the
   *  input. No-op when the value matches the current state. */
  setFCurveShowSeconds: (v) => set((s) => {
    const next = !!v;
    if (s.fcurveShowSeconds === next) return s;
    return { fcurveShowSeconds: next };
  }),
  toggleFCurveShowSeconds: () => set((s) => ({ fcurveShowSeconds: !s.fcurveShowSeconds })),

  // ── Toolset Phase 0 — vertex selection actions ──────────────────────
  //
  // Per Blender Edit Mode semantics: each part owns its own selection
  // set; the active vertex (last clicked) carries the white-bordered
  // active mark. Mutations all return a fresh top-level Map so React
  // subscribers re-render even though Set itself is mutable.

  /** Replace the part's selection with a single vertex. When `additive`
   *  is true, ADD the vertex to the existing set instead. Sets the
   *  active vertex to (partId, vertIndex). */
  selectVertex: (partId, vertIndex, additive = false) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    if (!Number.isInteger(vertIndex) || vertIndex < 0) return s;
    const next = new Map(s.selectedVertexIndices);
    if (additive) {
      const prior = next.get(partId);
      const merged = prior ? new Set(prior) : new Set();
      merged.add(vertIndex);
      next.set(partId, merged);
    } else {
      next.set(partId, new Set([vertIndex]));
    }
    return { selectedVertexIndices: next, activeVertex: { partId, vertIndex } };
  }),

  /** Remove a single vertex from the part's selection. No-op when the
   *  vertex isn't selected. Clears `activeVertex` when it pointed at
   *  the removed vertex. */
  deselectVertex: (partId, vertIndex) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    if (!Number.isInteger(vertIndex) || vertIndex < 0) return s;
    const cur = s.selectedVertexIndices.get(partId);
    if (!cur || !cur.has(vertIndex)) return s;
    const next = new Map(s.selectedVertexIndices);
    const fresh = new Set(cur);
    fresh.delete(vertIndex);
    if (fresh.size === 0) next.delete(partId);
    else next.set(partId, fresh);
    const av = s.activeVertex;
    const activeVertex = (av && av.partId === partId && av.vertIndex === vertIndex)
      ? null : av;
    return { selectedVertexIndices: next, activeVertex };
  }),

  /** Toggle one vertex's membership. Sets the active vertex to the
   *  toggled (partId, vertIndex) when adding; clears it when removing
   *  the active vertex. */
  toggleVertexSelection: (partId, vertIndex) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    if (!Number.isInteger(vertIndex) || vertIndex < 0) return s;
    const next = new Map(s.selectedVertexIndices);
    const cur = next.get(partId);
    if (cur && cur.has(vertIndex)) {
      const fresh = new Set(cur);
      fresh.delete(vertIndex);
      if (fresh.size === 0) next.delete(partId);
      else next.set(partId, fresh);
      const av = s.activeVertex;
      const activeVertex = (av && av.partId === partId && av.vertIndex === vertIndex)
        ? null : av;
      return { selectedVertexIndices: next, activeVertex };
    }
    const fresh = cur ? new Set(cur) : new Set();
    fresh.add(vertIndex);
    next.set(partId, fresh);
    return { selectedVertexIndices: next, activeVertex: { partId, vertIndex } };
  }),

  /** Replace the part's selection with the union of `vertIndices`.
   *  Used by box/lasso/shortest-path (Phase 1+). Active vertex stays
   *  put unless explicitly cleared. */
  setVertexSelectionForPart: (partId, vertIndices) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    const next = new Map(s.selectedVertexIndices);
    const set = new Set();
    if (vertIndices && typeof vertIndices[Symbol.iterator] === 'function') {
      for (const v of vertIndices) {
        if (Number.isInteger(v) && v >= 0) set.add(v);
      }
    }
    if (set.size === 0) next.delete(partId);
    else next.set(partId, set);
    return { selectedVertexIndices: next };
  }),

  /** Add every vertex of `partId` to the selection — caller passes the
   *  total count (kept dependency-free of project state). Active vertex
   *  unchanged. */
  selectAllVertices: (partId, vertCount) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    if (!Number.isInteger(vertCount) || vertCount <= 0) return s;
    const next = new Map(s.selectedVertexIndices);
    const fresh = new Set();
    for (let i = 0; i < vertCount; i++) fresh.add(i);
    next.set(partId, fresh);
    return { selectedVertexIndices: next };
  }),

  /** Drop the part's selection entirely. Clears the active vertex when
   *  it pointed at this part. */
  deselectAllVertices: (partId) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    if (!s.selectedVertexIndices.has(partId)) return s;
    const next = new Map(s.selectedVertexIndices);
    next.delete(partId);
    const av = s.activeVertex;
    const activeVertex = (av && av.partId === partId) ? null : av;
    return { selectedVertexIndices: next, activeVertex };
  }),

  /** Drop every selection across every part. Used on Object-Mode entry
   *  (per Blender) and Edit-Mode exit. */
  clearAllVertexSelections: () => set((s) => {
    if (s.selectedVertexIndices.size === 0 && s.activeVertex === null) return s;
    return { selectedVertexIndices: new Map(), activeVertex: null };
  }),

  /** Topology-change invalidation: drop the part's selection because
   *  vertex indices no longer refer to the same vertices. Called by
   *  add_vertex / remove_vertex / retriangulate paths in CanvasViewport.
   *  Pure re-export of `deselectAllVertices(partId)` semantics — kept
   *  as a separate name so call-sites read self-documenting. */
  invalidateVertexSelectionForPart: (partId) => set((s) => {
    if (typeof partId !== 'string' || partId.length === 0) return s;
    if (!s.selectedVertexIndices.has(partId) && (!s.activeVertex || s.activeVertex.partId !== partId)) return s;
    const next = new Map(s.selectedVertexIndices);
    next.delete(partId);
    const av = s.activeVertex;
    const activeVertex = (av && av.partId === partId) ? null : av;
    return { selectedVertexIndices: next, activeVertex };
  }),

  // ── Toolset Phase 0.A — read-only convenience helpers ───────────────
  // Sugar over `state.selectedVertexIndices.get(partId)?.has(idx)` etc.
  // Phase 4/5/6 consumers (merge / extrude / select linked) read these
  // many times per dispatch; the helpers keep call sites tidy and are
  // a single grep-target if the per-part Map shape ever changes.

  /** True iff `partId` has `vertIndex` selected. Defensive on bad input. */
  isVertexSelected: (partId, vertIndex) => {
    if (typeof partId !== 'string' || !Number.isInteger(vertIndex)) return false;
    const set = useEditorStore.getState().selectedVertexIndices.get(partId);
    return set ? set.has(vertIndex) : false;
  },

  /** Number of selected vertices on `partId`. 0 when none. */
  getSelectedVertexCount: (partId) => {
    if (typeof partId !== 'string') return 0;
    const set = useEditorStore.getState().selectedVertexIndices.get(partId);
    return set ? set.size : 0;
  },

  /** Snapshot of selected vertex indices for `partId` as a sorted array.
   *  Returns a fresh array each call — safe to mutate by the caller. */
  getAllSelectedVertices: (partId) => {
    if (typeof partId !== 'string') return [];
    const set = useEditorStore.getState().selectedVertexIndices.get(partId);
    if (!set || set.size === 0) return [];
    return [...set].sort((a, b) => a - b);
  },
}));
