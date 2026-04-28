// @ts-check

/**
 * v3 Phase 0A — Single area host.
 *
 * Renders the EditorHeader (editor-type selector) on top and the
 * editor body underneath. The editor body is wrapped in an
 * ErrorBoundary so a thrown render error in one area doesn't
 * cascade to the rest of the workspace (Pillar S).
 *
 * The boundary remounts on editorType change via React's `key`, so
 * a swap is a clean reset rather than carrying error state across
 * unrelated editors.
 *
 * @module v3/shell/Area
 */

import React from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { EditorHeader } from './EditorHeader.jsx';
import { EDITOR_REGISTRY } from './editorRegistry.js';

/**
 * @param {Object} props
 * @param {import('../../store/uiV3Store.js').AreaSlot} props.area
 */
export function Area({ area }) {
  const entry = EDITOR_REGISTRY[area.editorType];
  const Body = entry?.component;

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <EditorHeader areaId={area.id} editorType={area.editorType} />
      <div className="flex-1 min-h-0 min-w-0">
        <ErrorBoundary key={area.editorType} label={entry?.label ?? area.editorType}>
          {Body
            ? <Body />
            : <div className="p-2 text-xs text-destructive">unknown editor type: {area.editorType}</div>
          }
        </ErrorBoundary>
      </div>
    </div>
  );
}
