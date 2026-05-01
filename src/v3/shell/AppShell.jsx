// @ts-check

/**
 * v3 Phase 0A — Root shell. Mounted unconditionally by `App.jsx`
 * since v2 retirement (commit `15f75e3`, 2026-04-29).
 *
 * Owns:
 *   - Topbar (logo + file actions + 5-workspace pill + undo/redo +
 *     Hot Reload + gesture hint). The workspace pill carries both
 *     the panel layout preset AND the editor mode (Pose+Animation
 *     imply animation mode, others imply staging) — see Topbar.jsx
 *     for the rationale on collapsing those two axes.
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
import { Topbar } from './Topbar.jsx';
import { AreaTree } from './AreaTree.jsx';
import { SaveModal } from './SaveModal.jsx';
import { LoadModal } from './LoadModal.jsx';
import { ExportModal } from './ExportModal.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { HelpModal } from './HelpModal.jsx';
import { Cmo3InspectModal } from './Cmo3InspectModal.jsx';
import { ModalTransformOverlay } from './ModalTransformOverlay.jsx';
import { useLibraryDialogStore } from '../../store/libraryDialogStore.js';
import { mountOperatorDispatcher } from '../operators/dispatcher.js';

export function AppShell() {
  useEffect(() => mountOperatorDispatcher(), []);

  const mode  = useLibraryDialogStore((s) => s.mode);
  const close = useLibraryDialogStore((s) => s.close);

  return (
    <ErrorBoundary label="AppShell">
      <div className="flex flex-col h-screen w-screen bg-background text-foreground">
        <Topbar />
        <AreaTree />
        <SaveModal open={mode === 'save'} onOpenChange={(o) => { if (!o) close(); }} />
        <LoadModal open={mode === 'load'} onOpenChange={(o) => { if (!o) close(); }} />
        <ExportModal />
        <CommandPalette />
        <HelpModal />
        <Cmo3InspectModal />
        <ModalTransformOverlay />
      </div>
    </ErrorBoundary>
  );
}
