import EditorLayout from '@/app/layout/EditorLayout';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { AppShell as V3AppShell } from '@/v3/shell/AppShell';

/**
 * Read the active UI version from the URL.
 *   ?ui=v3 → new Blender-style shell (Phase 0A WIP)
 *   default / ?ui=v2 → existing v2 shell
 *
 * Killswitch lives at the top of the app rather than in a router so
 * v3 work stays a single conditional rather than threading a new prop
 * through dozens of components.
 */
function readUiVersion() {
  if (typeof window === 'undefined') return 'v2';
  try {
    const v = new URLSearchParams(window.location.search).get('ui');
    return v === 'v3' ? 'v3' : 'v2';
  } catch {
    return 'v2';
  }
}

function App() {
  const ui = readUiVersion();

  // Mount global undo/redo keyboard handler — v2 only. v3 uses its
  // own operator dispatcher (see AppShell).
  useUndoRedo({ enabled: ui !== 'v3' });

  if (ui === 'v3') {
    return (
      <>
        <V3AppShell />
        <Toaster />
      </>
    );
  }

  // v2 shell — top-level ErrorBoundary (Pillar K) catches render
  // errors that previously took the whole app down. v3 has its own
  // boundary inside AppShell.
  return (
    <>
      <ErrorBoundary label="Stretchy Studio">
        <EditorLayout />
      </ErrorBoundary>
      <Toaster />
    </>
  );
}

export default App;
