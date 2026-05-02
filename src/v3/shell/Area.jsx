// @ts-check

/**
 * v3 1A.UX — Single area host with tab bar.
 *
 * Renders the AreaTabBar on top + the active tab's editor body
 * underneath. ErrorBoundary wraps each editor so a thrown render
 * error stays scoped to one tab; `key` keys the boundary on the
 * editor type so a tab swap is a clean reset.
 *
 * Special case for `viewport` and `livePreview` tabs: both back onto
 * the same `<CanvasArea>` instance so toggling between edit and live
 * mode does NOT unmount the canvas (preserves WebGL2 context, texture
 * uploads, wizard PSD payload, ONNX session, snapshot refs). The two
 * tabs share the ErrorBoundary key `${area.id}:canvas`, so the
 * registry's `component` slot for `viewport`/`livePreview` is never
 * invoked — see editorRegistry.js for the null-component contract.
 *
 * @module v3/shell/Area
 */

import { useEffect, useRef } from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { AreaTabBar } from './AreaTabBar.jsx';
import { EDITOR_REGISTRY } from './editorRegistry.js';
import { CanvasArea } from './CanvasArea.jsx';
import { getActiveTab } from '../../store/uiV3Store.js';
import { logger } from '../../lib/logger.js';

const CANVAS_TAB_TYPES = new Set(['viewport', 'livePreview']);

/**
 * @param {Object} props
 * @param {import('../../store/uiV3Store.js').AreaSlot} props.area
 */
export function Area({ area }) {
  const tab = getActiveTab(area);
  const entry = tab ? EDITOR_REGISTRY[tab.editorType] : null;
  const Body = entry?.component;
  const isCanvasTab = !!tab && CANVAS_TAB_TYPES.has(tab.editorType);

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

  // Canvas tabs (viewport + livePreview) share one ErrorBoundary key
  // (`${area.id}:canvas`) so toggling between them does NOT remount —
  // CanvasArea owns a single CanvasViewport instance whose previewMode
  // prop flips with the active tab. Non-canvas tabs key on editorType,
  // matching the BUG-001 stability fix (cross-workspace switches that
  // keep the same editorType in the same area do not remount).
  const boundaryKey = !tab
    ? 'empty'
    : isCanvasTab
      ? `${area.id}:canvas`
      : `${area.id}:${tab.editorType}`;

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <AreaTabBar area={area} />
      <div className="flex-1 min-h-0 min-w-0">
        <ErrorBoundary
          key={boundaryKey}
          label={entry?.label ?? tab?.editorType ?? 'area'}
        >
          {isCanvasTab ? (
            <CanvasArea mode={/** @type {'viewport'|'livePreview'} */ (tab.editorType)} />
          ) : Body ? (
            <Body />
          ) : (
            <div className="p-2 text-xs text-destructive">unknown editor type: {tab?.editorType ?? '?'}</div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}
