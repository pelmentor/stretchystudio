// @ts-check

/**
 * v3 1A.UX — Single area host with tab bar.
 *
 * Renders the AreaTabBar on top + the active tab's editor body
 * underneath. ErrorBoundary wraps each editor so a thrown render
 * error stays scoped to one tab; `key` keys the boundary on the
 * editor type so a tab swap is a clean reset.
 *
 * @module v3/shell/Area
 */

import { ErrorBoundary } from './ErrorBoundary.jsx';
import { AreaTabBar } from './AreaTabBar.jsx';
import { EDITOR_REGISTRY } from './editorRegistry.js';
import { getActiveTab } from '../../store/uiV3Store.js';

/**
 * @param {Object} props
 * @param {import('../../store/uiV3Store.js').AreaSlot} props.area
 */
export function Area({ area }) {
  const tab = getActiveTab(area);
  const entry = tab ? EDITOR_REGISTRY[tab.editorType] : null;
  const Body = entry?.component;

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <AreaTabBar area={area} />
      <div className="flex-1 min-h-0 min-w-0">
        <ErrorBoundary key={tab?.id ?? 'empty'} label={entry?.label ?? tab?.editorType ?? 'area'}>
          {Body
            ? <Body />
            : <div className="p-2 text-xs text-destructive">unknown editor type: {tab?.editorType ?? '?'}</div>
          }
        </ErrorBoundary>
      </div>
    </div>
  );
}
