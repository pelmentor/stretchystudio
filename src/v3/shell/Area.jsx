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

import { useEffect, useRef } from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { AreaTabBar } from './AreaTabBar.jsx';
import { EDITOR_REGISTRY } from './editorRegistry.js';
import { getActiveTab } from '../../store/uiV3Store.js';
import { logger } from '../../lib/logger.js';

/**
 * @param {Object} props
 * @param {import('../../store/uiV3Store.js').AreaSlot} props.area
 */
export function Area({ area }) {
  const tab = getActiveTab(area);
  const entry = tab ? EDITOR_REGISTRY[tab.editorType] : null;
  const Body = entry?.component;

  // BUG-001 instrumentation — log transitions so the Logs panel can
  // confirm the keying fix. After 2026-05-02 fix the ErrorBoundary
  // keys on (area.id, editorType), so cross-workspace switches whose
  // editorType matches do NOT remount; only intra-area tab swaps that
  // change editorType cause remount. `remount` reflects the new key.
  const prevTabIdRef = useRef(/** @type {string|null} */(null));
  const prevEditorTypeRef = useRef(/** @type {string|null} */(null));
  useEffect(() => {
    const nextTabId = tab?.id ?? null;
    const nextEditorType = tab?.editorType ?? null;
    const prevTabId = prevTabIdRef.current;
    const prevEditorType = prevEditorTypeRef.current;
    if (prevTabId !== nextTabId || prevEditorType !== nextEditorType) {
      logger.debug('areaTab',
        `${area.id}: ${prevTabId ?? '(none)'} → ${nextTabId ?? '(none)'}`,
        {
          areaId: area.id,
          previousTabId: prevTabId,
          nextTabId: nextTabId,
          previousEditorType: prevEditorType,
          editorType: nextEditorType,
          remount: prevEditorType !== null && nextEditorType !== null
                   && prevEditorType !== nextEditorType,
        },
      );
      prevTabIdRef.current = nextTabId;
      prevEditorTypeRef.current = nextEditorType;
    }
  }, [area.id, tab?.id, tab?.editorType]);

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <AreaTabBar area={area} />
      <div className="flex-1 min-h-0 min-w-0">
        {/* BUG-001 fix: key by `area.id:editorType` not tab.id. Tab IDs are
            workspace-scoped (uiV3Store's global `_nextId` counter assigns
            t1..t5 to layout, t6..t10 to modeling, etc.), so a `tab.id` key
            unmounts and remounts the editor on every workspace switch even
            when the same editor type sits in the same area. For Viewport
            that destroys the WebGL context and all texture uploads → the
            "character disappears on tab switch" symptom. Keying by
            (area.id, editorType) keeps mount stability across workspace
            switches; switching tabs WITHIN one area (e.g. animation's
            timeline ↔ dopesheet) still flips editorType, which still
            triggers the intended remount. */}
        <ErrorBoundary
          key={tab ? `${area.id}:${tab.editorType}` : 'empty'}
          label={entry?.label ?? tab?.editorType ?? 'area'}
        >
          {Body
            ? <Body />
            : <div className="p-2 text-xs text-destructive">unknown editor type: {tab?.editorType ?? '?'}</div>
          }
        </ErrorBoundary>
      </div>
    </div>
  );
}
