// @ts-check

/**
 * v3 Phase 0A - Editor type → component map.
 *
 * Decouples `useUIV3Store.workspaces[].areas[].editorType` (a string
 * enum) from the actual React component rendered by an Area. Lets us
 * add new editor types in one place without touching the shell, and
 * gives the area-header dropdown a single source of truth.
 *
 * Intentionally small at this stage - Phase 1+ replaces the stub
 * components with real implementations and adds new entries here
 * (Sequencer, Driver Editor, Mask Editor, …).
 *
 * @module v3/shell/editorRegistry
 */

import { TimelineEditor } from '../editors/timeline/TimelineEditor.jsx';
import { OutlinerEditor } from '../editors/outliner/OutlinerEditor.jsx';
import { ViewportEditor } from '../editors/viewport/ViewportEditor.jsx';
import { PropertiesEditor } from '../editors/properties/PropertiesEditor.jsx';
import { ParametersEditor } from '../editors/parameters/ParametersEditor.jsx';
import { AnimationsEditor } from '../editors/animations/AnimationsEditor.jsx';
import { PerformanceEditor } from '../editors/performance/PerformanceEditor.jsx';
import { DopesheetEditor } from '../editors/dopesheet/DopesheetEditor.jsx';
import { FCurveEditor } from '../editors/fcurve/FCurveEditor.jsx';
import { KeyformGraphEditor } from '../editors/keyformGraph/KeyformGraphEditor.jsx';
import { LogsEditor } from '../editors/logs/LogsEditor.jsx';
import { LivePreviewEditor } from '../editors/livePreview/LivePreviewEditor.jsx';

/**
 * @typedef {import('../../store/uiV3Store.js').EditorType} EditorType
 *
 * @typedef {Object} EditorEntry
 * @property {string} label                - shown in the header dropdown
 * @property {React.ComponentType} component
 */

/** @type {Record<EditorType, EditorEntry>} */
export const EDITOR_REGISTRY = {
  viewport:   { label: 'Viewport',   component: ViewportEditor },
  outliner:   { label: 'Outliner',   component: OutlinerEditor },
  properties: { label: 'Properties', component: PropertiesEditor },
  parameters: { label: 'Parameters', component: ParametersEditor },
  timeline:   { label: 'Timeline',   component: TimelineEditor },
  animations: { label: 'Animations', component: AnimationsEditor },
  performance: { label: 'Performance', component: PerformanceEditor },
  dopesheet:   { label: 'Dopesheet', component: DopesheetEditor },
  fcurve:      { label: 'F-curve', component: FCurveEditor },
  keyformGraph: { label: 'Keyform Graph', component: KeyformGraphEditor },
  logs:        { label: 'Logs',      component: LogsEditor },
  livePreview: { label: 'Live Preview', component: LivePreviewEditor },
};

/** Stable ordered list for header dropdowns. */
export const EDITOR_TYPES = /** @type {EditorType[]} */ (
  Object.keys(EDITOR_REGISTRY)
);
