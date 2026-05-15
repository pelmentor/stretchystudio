// @ts-check

/**
 * v3 Phase 0A - Editor type → component map.
 *
 * Decouples `useUIV3Store.workspaces[].areas[].editorType` (a string
 * enum) from the actual React component rendered by an Area. Lets us
 * add new editor types in one place without touching the shell, and
 * gives the area-header dropdown a single source of truth.
 *
 * Each editor is `React.lazy` so its module graph (TimelineEditor's
 * recharts-adjacent code, NodeTreeArea's depgraph evaluator, the
 * keyform graph's curve fitter, etc.) ships in its own chunk and
 * downloads only when the user actually picks that tab. `label`
 * stays synchronous for AreaTabBar's dropdown.
 *
 * `viewport` and `livePreview` carry `component: null` — Area.jsx
 * routes both through the shared `<CanvasArea>` host so toggling
 * between edit and live mode does not unmount the canvas. The label
 * is still consumed by AreaTabBar; only the component slot is unused.
 *
 * @module v3/shell/editorRegistry
 */

import { lazy } from 'react';

const TimelineEditor = lazy(() =>
  import('../editors/timeline/TimelineEditor.jsx').then((m) => ({ default: m.TimelineEditor }))
);
const OutlinerEditor = lazy(() =>
  import('../editors/outliner/OutlinerEditor.jsx').then((m) => ({ default: m.OutlinerEditor }))
);
const PropertiesEditor = lazy(() =>
  import('../editors/properties/PropertiesEditor.jsx').then((m) => ({ default: m.PropertiesEditor }))
);
const ParametersEditor = lazy(() =>
  import('../editors/parameters/ParametersEditor.jsx').then((m) => ({ default: m.ParametersEditor }))
);
const ActionsEditor = lazy(() =>
  import('../editors/actions/ActionsEditor.jsx').then((m) => ({ default: m.ActionsEditor }))
);
const PerformanceEditor = lazy(() =>
  import('../editors/performance/PerformanceEditor.jsx').then((m) => ({ default: m.PerformanceEditor }))
);
const DopesheetEditor = lazy(() =>
  import('../editors/dopesheet/DopesheetEditor.jsx').then((m) => ({ default: m.DopesheetEditor }))
);
const FCurveEditor = lazy(() =>
  import('../editors/fcurve/FCurveEditor.jsx').then((m) => ({ default: m.FCurveEditor }))
);
const KeyformGraphEditor = lazy(() =>
  import('../editors/keyformGraph/KeyformGraphEditor.jsx').then((m) => ({ default: m.KeyformGraphEditor }))
);
const LogsEditor = lazy(() =>
  import('../editors/logs/LogsEditor.jsx').then((m) => ({ default: m.LogsEditor }))
);
const NodeTreeArea = lazy(() =>
  import('../editors/nodetree/NodeTreeArea.jsx').then((m) => ({ default: m.NodeTreeArea }))
);

// F-1 (2026-05-16 UI fidelity sweep) — per-area headers ABOVE the editor
// body. Mirrors Blender's `*_HT_header` pattern (one header per area
// type, e.g. `VIEW3D_HT_header` at `reference/blender/scripts/startup/
// bl_ui/space_view3d.py:702` or `OUTLINER_HT_header` at
// `space_outliner.py:22`). Header slot is optional — editors that
// don't ship one render with the existing AreaTabBar-only chrome.
const ViewportHeader = lazy(() =>
  import('../headers/ViewportHeader.jsx').then((m) => ({ default: m.ViewportHeader }))
);
const OutlinerHeader = lazy(() =>
  import('../headers/OutlinerHeader.jsx').then((m) => ({ default: m.OutlinerHeader }))
);

/**
 * @typedef {import('../../store/uiV3Store.js').EditorType} EditorType
 *
 * @typedef {Object} EditorEntry
 * @property {string} label                - shown in the header dropdown
 * @property {React.ComponentType | null} component - null for canvas tabs (viewport/livePreview)
 *                                                    routed via CanvasArea in Area.jsx
 * @property {React.ComponentType | null} [header]  - optional area-header chrome rendered ABOVE
 *                                                    the editor body. Mirrors Blender's
 *                                                    `*_HT_header` per-area pattern. When null
 *                                                    the area renders only the AreaTabBar.
 */

/** @type {Record<EditorType, EditorEntry>} */
export const EDITOR_REGISTRY = {
  viewport:    { label: 'Viewport',     component: null,             header: ViewportHeader },
  // LivePreview is the read-only runtime view; no editor chrome.
  livePreview: { label: 'Live Preview', component: null,             header: null },
  outliner:    { label: 'Outliner',     component: OutlinerEditor,   header: OutlinerHeader },
  properties:  { label: 'Properties',   component: PropertiesEditor, header: null },
  parameters:  { label: 'Parameters',   component: ParametersEditor, header: null },
  timeline:    { label: 'Timeline',     component: TimelineEditor,   header: null },
  // Stage 1.E: editor-type id is plural `actions` to match the panel's
  // user-facing label "Actions" (the noun for a list-of-actions view).
  // Blender's space-type enum uses singular `SPACE_ACTION`
  // (`reference/blender/source/blender/makesdna/DNA_space_enums.h:1161`)
  // since it identifies the editor space, not the panel content. SS's
  // ids are panel-scoped here, so the deviation is documented rather
  // than aligned (Audit-fix D-9 Stage 1.E).
  actions:     { label: 'Actions',      component: ActionsEditor,    header: null },
  performance: { label: 'Performance',  component: PerformanceEditor, header: null },
  dopesheet:   { label: 'Dopesheet',    component: DopesheetEditor,  header: null },
  fcurve:      { label: 'F-curve',      component: FCurveEditor,     header: null },
  keyformGraph:{ label: 'Keyform Graph', component: KeyformGraphEditor, header: null },
  logs:        { label: 'Logs',         component: LogsEditor,       header: null },
  nodeTree:    { label: 'Node Tree',    component: NodeTreeArea,     header: null },
};

/** Stable ordered list for header dropdowns. */
export const EDITOR_TYPES = /** @type {EditorType[]} */ (
  Object.keys(EDITOR_REGISTRY)
);
