/**
 * v3 Phase 0A — Root shell rendered when `?ui=v3` is set.
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

import React, { useEffect } from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { WorkspaceTabs } from './WorkspaceTabs.jsx';
import { AreaTree } from './AreaTree.jsx';
import { mountOperatorDispatcher } from '../operators/dispatcher.js';

export function AppShell() {
  useEffect(() => mountOperatorDispatcher(), []);

  return (
    <ErrorBoundary label="AppShell">
      <div className="flex flex-col h-screen w-screen bg-background text-foreground">
        <WorkspaceTabs />
        <AreaTree />
      </div>
    </ErrorBoundary>
  );
}
