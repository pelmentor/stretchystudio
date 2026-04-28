/**
 * v3 Phase 0A — Empty editor stubs.
 *
 * Each editor type is a real React component but renders only its
 * label so we can verify the shell — area swap, ErrorBoundary,
 * keymap dispatch — without waiting for the Phase 1 content layer.
 * Phase 1 replaces each stub with the real implementation.
 *
 * One file with a small factory because the bodies are nearly
 * identical at this stage; once real content arrives each editor
 * gets its own file under `src/v3/editors/<Name>Editor.jsx`.
 *
 * @module v3/editors/stubs
 */

import React from 'react';

function makeStub(label) {
  function Stub() {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground select-none">
        <span className="px-2 py-1 rounded border border-dashed border-border">
          {label} (stub)
        </span>
      </div>
    );
  }
  Stub.displayName = `${label}EditorStub`;
  return Stub;
}

export const OutlinerEditor   = makeStub('Outliner');
export const PropertiesEditor = makeStub('Properties');
export const ParametersEditor = makeStub('Parameters');
export const TimelineEditor   = makeStub('Timeline');

/**
 * Viewport stub. Phase 1 wraps existing CanvasViewport here — for now
 * it's just a placeholder so the shell renders something visible.
 */
export const ViewportEditor = makeStub('Viewport');
