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
const AnimationsEditor = lazy(() =>
  import('../editors/animations/AnimationsEditor.jsx').then((m) => ({ default: m.AnimationsEditor }))
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

/**
 * @typedef {import('../../store/uiV3Store.js').EditorType} EditorType
 *
 * @typedef {Object} EditorEntry
 * @property {string} label                - shown in the header dropdown
 * @property {React.ComponentType | null} component - null for canvas tabs (viewport/livePreview)
 *                                                    routed via CanvasArea in Area.jsx
 */

/** @type {Record<EditorType, EditorEntry>} */
export const EDITOR_REGISTRY = {
  viewport:    { label: 'Viewport',     component: null },
  livePreview: { label: 'Live Preview', component: null },
  outliner:    { label: 'Outliner',     component: OutlinerEditor },
  properties:  { label: 'Properties',   component: PropertiesEditor },
  parameters:  { label: 'Parameters',   component: ParametersEditor },
  timeline:    { label: 'Timeline',     component: TimelineEditor },
  animations:  { label: 'Animations',   component: AnimationsEditor },
  performance: { label: 'Performance',  component: PerformanceEditor },
  dopesheet:   { label: 'Dopesheet',    component: DopesheetEditor },
  fcurve:      { label: 'F-curve',      component: FCurveEditor },
  keyformGraph:{ label: 'Keyform Graph', component: KeyformGraphEditor },
  logs:        { label: 'Logs',         component: LogsEditor },
  nodeTree:    { label: 'Node Tree',    component: NodeTreeArea },
};

/** Stable ordered list for header dropdowns. */
export const EDITOR_TYPES = /** @type {EditorType[]} */ (
  Object.keys(EDITOR_REGISTRY)
);
