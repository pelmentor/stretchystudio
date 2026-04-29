// @ts-check

/**
 * v3 Phase 1B — Properties tab registry.
 *
 * Plan §4.2 specifies up to 10 tabs on the Properties editor; which
 * ones apply depends on the active selection's type and on the
 * selected node's data (e.g. BlendShape tab only when the part has
 * blendShapes attached). The registry captures that gating in one
 * place so PropertiesEditor stays a thin renderer.
 *
 * Each entry has:
 *   - id        — stable key
 *   - label     — shown in the tab strip
 *   - applies   — pure predicate: does this tab show up for the
 *                 current selection + project state?
 *   - render    — () => JSX
 *
 * Order in the array = order in the tab strip. Object goes first
 * (always-present fallback), then per-type tabs, then more
 * specific tabs that gate on data presence.
 *
 * @module v3/editors/properties/tabRegistry
 */

import { ObjectTab } from './tabs/ObjectTab.jsx';
import { DeformerTab } from './tabs/DeformerTab.jsx';
import { ParameterTab } from './tabs/ParameterTab.jsx';
import { BlendShapeTab } from './tabs/BlendShapeTab.jsx';

/**
 * @typedef {Object} TabContext
 * @property {{type:string, id:string}} active
 * @property {object} project   - projectStore.project snapshot
 *
 * @typedef {Object} TabDef
 * @property {string} id
 * @property {string} label
 * @property {(ctx: TabContext) => boolean} applies
 * @property {(ctx: TabContext) => JSX.Element} render
 */

/** @type {TabDef[]} */
export const PROPERTIES_TABS = [
  {
    id: 'object',
    label: 'Object',
    applies: ({ active }) => active.type === 'part' || active.type === 'group',
    render: ({ active }) => <ObjectTab nodeId={active.id} />,
  },
  {
    id: 'blendShapes',
    label: 'Blend Shapes',
    applies: ({ active, project }) => {
      if (active.type !== 'part') return false;
      const node = (project?.nodes ?? []).find((n) => n?.id === active.id);
      return !!node?.mesh; // tab is available for any meshed part — even with 0 shapes the user adds via the tab
    },
    render: ({ active }) => <BlendShapeTab nodeId={active.id} />,
  },
  {
    id: 'deformer',
    label: 'Deformer',
    applies: ({ active }) => active.type === 'deformer',
    render: ({ active }) => <DeformerTab deformerId={active.id} />,
  },
  {
    id: 'parameter',
    label: 'Parameter',
    applies: ({ active }) => active.type === 'parameter',
    render: ({ active }) => <ParameterTab parameterId={active.id} />,
  },
];

/**
 * Compute the tab list for a given selection + project snapshot.
 *
 * @param {TabContext} ctx
 * @returns {TabDef[]}
 */
export function tabsFor(ctx) {
  return PROPERTIES_TABS.filter((t) => {
    try { return t.applies(ctx); } catch { return false; }
  });
}
