// @ts-check

/**
 * v3 Phase 0A / 1A.UX — UI shell state with tabs-per-area.
 *
 * Mirrors Blender's "screen" + "area" + "workspace" structure plus
 * Blender-style "tabs inside an area" so multiple editors can share
 * one panel with a tab strip on top (OPNsense-style; the user
 * specifically asked for Outliner + Parameters as tabs in a left
 * sidebar). Plan §2 Layer 1-3 + §3.
 *
 * Data shape:
 *
 *   workspaces[wsId].areas: AreaSlot[]
 *   AreaSlot      = { id, tabs: EditorTab[], activeTabId }
 *   EditorTab     = { id, editorType }
 *
 * Why tabs (vs swap-in-place dropdown that 0A shipped): the dropdown
 * paradigm makes sense when one area shows one editor and the user
 * occasionally swaps; once you stack two editors that you switch
 * between minute-to-minute (Outliner ↔ Parameters during rig setup),
 * tabs cost zero clicks and one extra row of chrome.
 *
 * @module store/uiV3Store
 */

import { create } from 'zustand';

/**
 * @typedef {('layout'|'modeling'|'rigging'|'animation'|'pose')} WorkspaceId
 *
 * @typedef {('outliner'|'properties'|'viewport'|'parameters'|'timeline'|'animations')} EditorType
 *
 * @typedef {Object} EditorTab
 * @property {string}     id          - stable across re-render
 * @property {EditorType} editorType
 *
 * @typedef {Object} AreaSlot
 * @property {string}      id          - stable across re-render
 * @property {EditorTab[]} tabs
 * @property {string}      activeTabId - id of the currently visible tab; falls back to tabs[0].id
 *
 * @typedef {Object} WorkspacePreset
 * @property {AreaSlot[]} areas
 */

/** Narrow a literal to EditorType for JSDoc inference. */
const e = (/** @type {EditorType} */ t) => t;

let _nextId = 1;
const tid = () => `t${_nextId++}`;

/** Build an area with a single-tab default. */
function singleTabArea(/** @type {string} */ id, /** @type {EditorType} */ editorType) {
  return /** @type {AreaSlot} */ ({
    id,
    tabs: [{ id: tid(), editorType }],
    activeTabId: '_synthesized', // overwritten below; kept distinct so empty-area never wins lookups
  });
}

/** Build an area with several stacked tabs; first tab is active. */
function multiTabArea(/** @type {string} */ id, /** @type {EditorType[]} */ editorTypes) {
  const tabs = editorTypes.map((et) => ({ id: tid(), editorType: et }));
  return /** @type {AreaSlot} */ ({
    id,
    tabs,
    activeTabId: tabs[0]?.id ?? '_synthesized',
  });
}

// Patch the activeTabId on single-tab helper now that we have the real id.
function buildArea(/** @type {string} */ id, /** @type {EditorType[]} */ editorTypes) {
  if (!Array.isArray(editorTypes) || editorTypes.length === 0) {
    throw new Error(`buildArea(${id}): at least one editor type required`);
  }
  const a = multiTabArea(id, editorTypes);
  return a;
}

/**
 * Default layout (2026-04-29 — user feedback "no right column"):
 *
 *   Left column (vertical split)        Center column
 *   ────────────────────────             ──────────────
 *   leftTop:    Outliner + Parameters    center:   Viewport
 *   leftBottom: Properties
 *
 * Properties moved out of the right column and into the bottom of
 * the left column; right column is gone, viewport gets the full
 * remaining width. AreaTree.jsx renders the left column as a
 * vertical PanelGroup with the two halves.
 *
 * @returns {AreaSlot[]}
 */
const DEFAULT_AREAS = () => [
  buildArea('leftTop',    [e('outliner'), e('parameters')]),
  buildArea('leftBottom', [e('properties')]),
  buildArea('center',     [e('viewport')]),
];

/**
 * Animation workspace adds a Timeline area below the center and an
 * Animations list tab next to Properties so the user can browse /
 * create / switch animations without leaving the workspace.
 *
 * @returns {AreaSlot[]}
 */
const ANIMATION_AREAS = () => [
  buildArea('leftTop',    [e('outliner'), e('parameters')]),
  buildArea('leftBottom', [e('animations'), e('properties')]),
  buildArea('center',     [e('viewport')]),
  buildArea('timeline',   [e('timeline')]),
];

/**
 * Per-workspace presets.
 * @returns {Record<WorkspaceId, WorkspacePreset>}
 */
const initialWorkspaces = () => ({
  layout:    { areas: DEFAULT_AREAS() },
  modeling:  { areas: DEFAULT_AREAS() },
  rigging:   { areas: DEFAULT_AREAS() },
  animation: { areas: ANIMATION_AREAS() },
  pose:      { areas: DEFAULT_AREAS() },
});

export const useUIV3Store = create((set) => ({
  /** @type {WorkspaceId} */
  activeWorkspace: 'layout',

  /** @type {Record<WorkspaceId, WorkspacePreset>} */
  workspaces: initialWorkspaces(),

  /** Switch active workspace; per-workspace area state is preserved. */
  setWorkspace: (id) => set({ activeWorkspace: id }),

  /**
   * Set which tab is active inside an area.
   * @param {string} areaId
   * @param {string} tabId
   */
  setAreaActiveTab: (areaId, tabId) =>
    set((state) => updateActiveWorkspace(state, (ws) => ({
      ...ws,
      areas: ws.areas.map((a) => {
        if (a.id !== areaId) return a;
        if (!a.tabs.some((t) => t.id === tabId)) return a;
        return { ...a, activeTabId: tabId };
      }),
    }))),

  /**
   * Swap the active tab's editor type. Compatibility shim so the
   * existing area-header dropdown (and any Phase 0A test code) keeps
   * working — semantically "change what this area shows" still maps
   * to "change the foreground tab's type".
   *
   * @param {string} areaId
   * @param {EditorType} editorType
   */
  setAreaEditor: (areaId, editorType) =>
    set((state) => updateActiveWorkspace(state, (ws) => ({
      ...ws,
      areas: ws.areas.map((a) => {
        if (a.id !== areaId) return a;
        return {
          ...a,
          tabs: a.tabs.map((t) =>
            t.id === a.activeTabId ? { ...t, editorType } : t,
          ),
        };
      }),
    }))),

  /**
   * Add a new tab to an area; new tab becomes active.
   * @param {string} areaId
   * @param {EditorType} editorType
   */
  addTab: (areaId, editorType) =>
    set((state) => updateActiveWorkspace(state, (ws) => ({
      ...ws,
      areas: ws.areas.map((a) => {
        if (a.id !== areaId) return a;
        const newTab = { id: tid(), editorType };
        return { ...a, tabs: [...a.tabs, newTab], activeTabId: newTab.id };
      }),
    }))),

  /**
   * Remove a tab. If the active one is removed, activate its left
   * neighbour (or the new first tab). No-op when removing the last
   * remaining tab — areas don't go empty.
   * @param {string} areaId
   * @param {string} tabId
   */
  removeTab: (areaId, tabId) =>
    set((state) => updateActiveWorkspace(state, (ws) => ({
      ...ws,
      areas: ws.areas.map((a) => {
        if (a.id !== areaId) return a;
        if (a.tabs.length <= 1) return a;
        const idx = a.tabs.findIndex((t) => t.id === tabId);
        if (idx < 0) return a;
        const tabs = a.tabs.filter((_, i) => i !== idx);
        let activeTabId = a.activeTabId;
        if (a.activeTabId === tabId) {
          const fallback = tabs[Math.max(0, idx - 1)] ?? tabs[0];
          activeTabId = fallback.id;
        }
        return { ...a, tabs, activeTabId };
      }),
    }))),

  /** Reset the active workspace's area state to its default preset. */
  resetWorkspace: () =>
    set((state) => ({
      workspaces: {
        ...state.workspaces,
        [state.activeWorkspace]: initialWorkspaces()[state.activeWorkspace],
      },
    })),
}));

/** Internal helper — produce a new state with the active workspace mutated. */
function updateActiveWorkspace(state, fn) {
  const ws = state.workspaces[state.activeWorkspace];
  if (!ws) return state;
  return {
    workspaces: { ...state.workspaces, [state.activeWorkspace]: fn(ws) },
  };
}

/**
 * Convenience selector — find the current active tab in an area.
 *
 * @param {AreaSlot} area
 * @returns {EditorTab|null}
 */
export function getActiveTab(area) {
  if (!area || !Array.isArray(area.tabs) || area.tabs.length === 0) return null;
  return area.tabs.find((t) => t.id === area.activeTabId) ?? area.tabs[0];
}
