import EditorLayout from '@/app/layout/EditorLayout';
import { Toaster } from '@/components/ui/toaster';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import { AppShell as V3AppShell } from '@/v3/shell/AppShell';

/**
 * Read the active UI version from the URL.
 *   default / ?ui=v3 → Blender-style shell (current).
 *   ?ui=v2          → legacy escape hatch for the v2-only flows that
 *                     haven't migrated yet (advanced ExportModal,
 *                     SaveModal/library, mesh paint, v2 TimelinePanel).
 *                     See V3 plan §16 "v2 retirement roadmap".
 *
 * Default flipped 2026-04-29 once v3 covered the full Initialize Rig →
 * scrub → save → export round-trip in shelby smoke testing.
 */
function readUiVersion() {
  if (typeof window === 'undefined') return 'v3';
  try {
    const v = new URLSearchParams(window.location.search).get('ui');
    return v === 'v2' ? 'v2' : 'v3';
  } catch {
    return 'v3';
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
