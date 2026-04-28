/**
 * v3 Phase 0A — UI shell state.
 *
 * Mirrors Blender's "screen" + "area" + "workspace" structure. Each
 * workspace presents a different area-tree preset; switching workspaces
 * doesn't lose per-workspace state. (Plan §2 Layer 1-3 + §3.)
 *
 * For now the area tree is flat — four fixed areas tiled 2×2 — so the
 * type can be a simple `{[areaId]: editorType}` map. The recursive
 * split-tree representation lands when split / drag-tab gestures arrive
 * (Phase 1+); the API exposed here doesn't change at that point, which
 * is why callers should always go through `useUIV3Store` actions
 * rather than reading raw shape.
 *
 * @module store/uiV3Store
 */

import { create } from 'zustand';

/**
 * @typedef {('layout'|'modeling'|'rigging'|'animation'|'pose')} WorkspaceId
 *   The five top-level workspace presets. Plan §2 Layer 5 settled on
 *   Layout / Mesh / Rig / Pose / Animate; here we use the noun forms
 *   (Modeling = Mesh) to stay closer to Blender's vocabulary.
 *
 * @typedef {('outliner'|'properties'|'viewport'|'parameters'|'timeline')} EditorType
 *   Editor types registered for v3. Phase 1 expands the set.
 *
 * @typedef {Object} AreaSlot
 * @property {string} id              — stable across re-render
 * @property {EditorType} editorType  — what this area renders
 *
 * @typedef {Object} WorkspacePreset
 * @property {AreaSlot[]} areas       — current order is TL, TR, BL, BR
 *   (will become a split-tree in Phase 1; consumers should index by id)
 */

/** Initial 2×2 layout used as the default for every workspace. */
const DEFAULT_AREAS = () => [
  { id: 'tl', editorType: /** @type {const} */ ('viewport') },
  { id: 'tr', editorType: /** @type {const} */ ('outliner') },
  { id: 'bl', editorType: /** @type {const} */ ('parameters') },
  { id: 'br', editorType: /** @type {const} */ ('properties') },
];

/** Per-workspace area presets. Each workspace owns its own area state. */
const initialWorkspaces = () => ({
  layout:    { areas: DEFAULT_AREAS() },
  modeling:  { areas: DEFAULT_AREAS() },
  rigging:   { areas: DEFAULT_AREAS() },
  animation: { areas: [
    { id: 'tl', editorType: 'viewport' },
    { id: 'tr', editorType: 'outliner' },
    { id: 'bl', editorType: 'timeline' },
    { id: 'br', editorType: 'properties' },
  ] },
  pose:      { areas: DEFAULT_AREAS() },
});

export const useUIV3Store = create((set) => ({
  /** @type {WorkspaceId} */
  activeWorkspace: 'layout',

  /** @type {Record<WorkspaceId, WorkspacePreset>} */
  workspaces: initialWorkspaces(),

  /** Switch the active workspace. Per-workspace area state is preserved. */
  setWorkspace: (id) => set({ activeWorkspace: id }),

  /**
   * Replace the editor in a specific area for the active workspace.
   * @param {string} areaId
   * @param {EditorType} editorType
   */
  setAreaEditor: (areaId, editorType) =>
    set((state) => {
      const ws = state.workspaces[state.activeWorkspace];
      if (!ws) return state;
      const next = ws.areas.map((a) =>
        a.id === areaId ? { ...a, editorType } : a,
      );
      return {
        workspaces: {
          ...state.workspaces,
          [state.activeWorkspace]: { ...ws, areas: next },
        },
      };
    }),

  /** Reset the active workspace to its defaults. */
  resetWorkspace: () =>
    set((state) => ({
      workspaces: {
        ...state.workspaces,
        [state.activeWorkspace]: initialWorkspaces()[state.activeWorkspace],
      },
    })),
}));
