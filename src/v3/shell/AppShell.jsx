// @ts-check

/**
 * v3 Phase 0A — Root shell. Mounted unconditionally by `App.jsx`
 * since v2 retirement (commit `15f75e3`, 2026-04-29).
 *
 * Owns:
 *   - WorkspaceTabs along the top
 *   - AreaTree in the rest of the viewport
 *   - Top-level ErrorBoundary as a last-resort net (the per-area
 *     boundaries inside Area.jsx catch the common case)
 *   - Mounting the operator dispatcher's global event listeners
 *     (Phase 0A.4)
 *
 * Deliberately small — most of the UX lives in subcomponents and
 * stores.  The shell's job is to compose them.
 *
 * @module v3/shell/AppShell
 */

import { useEffect } from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { WorkspaceTabs } from './WorkspaceTabs.jsx';
import { AreaTree } from './AreaTree.jsx';
import { LibraryDialog } from './LibraryDialog.jsx';
import { mountOperatorDispatcher } from '../operators/dispatcher.js';

export function AppShell() {
  useEffect(() => mountOperatorDispatcher(), []);

  return (
    <ErrorBoundary label="AppShell">
      <div className="flex flex-col h-screen w-screen bg-background text-foreground">
        <WorkspaceTabs />
        <AreaTree />
        <LibraryDialog />
      </div>
    </ErrorBoundary>
  );
}
