import { Toaster } from '@/components/ui/toaster';
import { AppShell as V3AppShell } from '@/v3/shell/AppShell';

/**
 * Top-level app — v3 only.
 *
 * v2 (EditorLayout + LayerPanel + Inspector + TimelinePanel +
 * ParametersPanel + ExportModal + SaveModal + …) was removed
 * 2026-04-29 in the retirement pass. v3 covers the full Initialize
 * Rig → scrub → save → export round-trip; advanced flows (library,
 * advanced export options, paint mode) migrate per Plan §16.
 *
 * Toaster stays at the root so any operator / editor can `import { toast }`
 * and surface notifications without each tree branch wiring its own.
 */
function App() {
  return (
    <>
      <V3AppShell />
      <Toaster />
    </>
  );
}

export default App;
