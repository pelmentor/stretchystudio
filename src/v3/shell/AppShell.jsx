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
 *   - StaleRigBanner just below — surfaces GAP-012 detection
 *     (PSD reimport / mesh re-mesh invalidates seeded rig data).
 *     Hidden by default; renders only when divergence is real.
 *   - AreaTree in the rest of the viewport
 *   - Footer status bar at the bottom — Audit 4 #1 (2026-05-16),
 *     mirrors Blender's `STATUSBAR_HT_header`. Surfaces input
 *     status (modal echo or mode label), reports count, and
 *     selection stats.
 *   - Top-level ErrorBoundary as a last-resort net (the per-area
 *     boundaries inside Area.jsx catch the common case)
 *   - Mounting the operator dispatcher's global event listeners
 *     (Phase 0A.4)
 *
 * Modals are `React.lazy` and only mount when their gate-store flag
 * is open. That keeps the export/import/inspect/help/cmdk module
 * graphs out of the boot bundle entirely; the chunk is fetched on
 * first open and cached for the rest of the session.
 *
 * @module v3/shell/AppShell
 */

import { useEffect, lazy, Suspense } from 'react';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { Topbar } from './Topbar.jsx';
import { StaleRigBanner } from './StaleRigBanner.jsx';
import { AreaTree } from './AreaTree.jsx';
import { Footer } from './Footer.jsx';
import { useLibraryDialogStore } from '../../store/libraryDialogStore.js';
import { useExportModalStore } from '../../store/exportModalStore.js';
import { useCommandPaletteStore } from '../../store/commandPaletteStore.js';
import { useHelpModalStore } from '../../store/helpModalStore.js';
import { useCmo3InspectStore } from '../../store/cmo3InspectStore.js';
import { useModalTransformStore } from '../../store/modalTransformStore.js';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { useEditMenuStore } from '../../store/editMenuStore.js';
import { useCircleSelectStore } from '../../store/circleSelectStore.js';
import { useRadiusAdjustStore } from '../../store/radiusAdjustStore.js';
import { useBrushRadiusAdjustStore } from '../../store/brushRadiusAdjustStore.js';
import { useBrushStrengthAdjustStore } from '../../store/brushStrengthAdjustStore.js';
import { useSculptRadiusAdjustStore } from '../../store/sculptRadiusAdjustStore.js';
import { useSculptStrengthAdjustStore } from '../../store/sculptStrengthAdjustStore.js';
import { useWizardStore } from '../../store/wizardStore.js';
import { mountOperatorDispatcher } from '../operators/dispatcher.js';
import { ModalToolInputDispatcher } from '../modalTool/index.js';

const SaveModal = lazy(() =>
  import('./SaveModal.jsx').then((m) => ({ default: m.SaveModal }))
);
const LoadModal = lazy(() =>
  import('./LoadModal.jsx').then((m) => ({ default: m.LoadModal }))
);
const ExportModal = lazy(() =>
  import('./ExportModal.jsx').then((m) => ({ default: m.ExportModal }))
);
const CommandPalette = lazy(() =>
  import('./CommandPalette.jsx').then((m) => ({ default: m.CommandPalette }))
);
const HelpModal = lazy(() =>
  import('./HelpModal.jsx').then((m) => ({ default: m.HelpModal }))
);
const Cmo3InspectModal = lazy(() =>
  import('./Cmo3InspectModal.jsx').then((m) => ({ default: m.Cmo3InspectModal }))
);
const ModalTransformOverlay = lazy(() =>
  import('./ModalTransformOverlay.jsx').then((m) => ({ default: m.ModalTransformOverlay }))
);
const ModalVertexTransformOverlay = lazy(() =>
  import('./ModalVertexTransformOverlay.jsx').then((m) => ({ default: m.ModalVertexTransformOverlay }))
);
const RadiusAdjustOverlay = lazy(() =>
  import('./RadiusAdjustOverlay.jsx').then((m) => ({ default: m.RadiusAdjustOverlay }))
);
const BrushRadiusAdjustOverlay = lazy(() =>
  import('./BrushRadiusAdjustOverlay.jsx').then((m) => ({ default: m.BrushRadiusAdjustOverlay }))
);
const BrushStrengthAdjustOverlay = lazy(() =>
  import('./BrushStrengthAdjustOverlay.jsx').then((m) => ({ default: m.BrushStrengthAdjustOverlay }))
);
const SculptRadiusAdjustOverlay = lazy(() =>
  import('./SculptRadiusAdjustOverlay.jsx').then((m) => ({ default: m.SculptRadiusAdjustOverlay }))
);
const SculptStrengthAdjustOverlay = lazy(() =>
  import('./SculptStrengthAdjustOverlay.jsx').then((m) => ({ default: m.SculptStrengthAdjustOverlay }))
);
const MergeMenu = lazy(() =>
  import('./MergeMenu.jsx').then((m) => ({ default: m.MergeMenu }))
);
const ApplyMenu = lazy(() =>
  import('./ApplyMenu.jsx').then((m) => ({ default: m.ApplyMenu }))
);
const SnapMenu = lazy(() =>
  import('./SnapMenu.jsx').then((m) => ({ default: m.SnapMenu }))
);
const MirrorAxisMenu = lazy(() =>
  import('./MirrorAxisMenu.jsx').then((m) => ({ default: m.MirrorAxisMenu }))
);
const ClearParentMenu = lazy(() =>
  import('./ClearParentMenu.jsx').then((m) => ({ default: m.ClearParentMenu }))
);
const SetOriginMenu = lazy(() =>
  import('./SetOriginMenu.jsx').then((m) => ({ default: m.SetOriginMenu }))
);
const CanvasContextMenu = lazy(() =>
  import('./CanvasContextMenu.jsx').then((m) => ({ default: m.CanvasContextMenu }))
);
const KeyingSetMenu = lazy(() =>
  import('./KeyingSetMenu.jsx').then((m) => ({ default: m.KeyingSetMenu }))
);
const CircleSelectOverlay = lazy(() =>
  import('../editors/viewport/overlays/CircleSelectOverlay.jsx').then(
    (m) => ({ default: m.CircleSelectOverlay }),
  )
);
const PsdImportWizard = lazy(() =>
  import('./PsdImportWizard.jsx').then((m) => ({ default: m.PsdImportWizard }))
);
// Phase A2 PWA — service-worker registrar with an opt-in update toast.
// Lazy so the SW glue stays out of the boot bundle (gets pulled in only
// when an update is detected on a return visit).
const ServiceWorkerUpdater = lazy(() =>
  import('../../lib/swRegister.jsx').then((m) => ({ default: m.ServiceWorkerUpdater }))
);

export function AppShell() {
  useEffect(() => mountOperatorDispatcher(), []);

  const libraryMode = useLibraryDialogStore((s) => s.mode);
  const closeLibrary = useLibraryDialogStore((s) => s.close);
  const exportOpen = useExportModalStore((s) => s.open);
  const cmdkOpen = useCommandPaletteStore((s) => s.open);
  const helpOpen = useHelpModalStore((s) => s.open);
  const inspectOpen = useCmo3InspectStore((s) => s.open);
  const modalKind = useModalTransformStore((s) => s.kind);
  const vertexModalKind = useModalVertexTransformStore((s) => s.kind);
  const editMenuKind = useEditMenuStore((s) => s.kind);
  const circleSelectActive = useCircleSelectStore((s) => s.active);
  const radiusAdjustActive = useRadiusAdjustStore((s) => s.active);
  const brushRadiusAdjustActive = useBrushRadiusAdjustStore((s) => s.active);
  const brushStrengthAdjustActive = useBrushStrengthAdjustStore((s) => s.active);
  const sculptRadiusAdjustActive = useSculptRadiusAdjustStore((s) => s.active);
  const sculptStrengthAdjustActive = useSculptStrengthAdjustStore((s) => s.active);
  const wizardStep = useWizardStore((s) => s.step);

  return (
    <ErrorBoundary label="AppShell">
      {/* Modal-tool framework — single window-level event dispatcher.
          Owns capture-phase input routing for every modal tool registered
          via `useModalTool`. Mounts once at AppShell. See
          `src/v3/modalTool/InputDispatcher.jsx` for the dispatch loop. */}
      <ModalToolInputDispatcher />
      <div className="flex flex-col h-screen w-screen bg-background text-foreground relative">
        <Topbar />
        <StaleRigBanner />
        <AreaTree />
        <Footer />
        <Suspense fallback={null}>
          {libraryMode === 'save' && (
            <SaveModal open onOpenChange={(o) => { if (!o) closeLibrary(); }} />
          )}
          {libraryMode === 'load' && (
            <LoadModal open onOpenChange={(o) => { if (!o) closeLibrary(); }} />
          )}
          {exportOpen && <ExportModal />}
          {cmdkOpen && <CommandPalette />}
          {helpOpen && <HelpModal />}
          {inspectOpen && <Cmo3InspectModal />}
          {modalKind && <ModalTransformOverlay />}
          {vertexModalKind && <ModalVertexTransformOverlay />}
          {editMenuKind === 'merge' && <MergeMenu />}
          {editMenuKind === 'apply' && <ApplyMenu />}
          {editMenuKind === 'snap' && <SnapMenu />}
          {editMenuKind === 'mirrorAxis' && <MirrorAxisMenu />}
          {editMenuKind === 'clearParent' && <ClearParentMenu />}
          {editMenuKind === 'setOrigin' && <SetOriginMenu />}
          {editMenuKind === 'canvasContextMenu' && <CanvasContextMenu />}
          {editMenuKind === 'keyingSet' && <KeyingSetMenu />}
          {circleSelectActive && <CircleSelectOverlay />}
          {radiusAdjustActive && <RadiusAdjustOverlay />}
          {brushRadiusAdjustActive && <BrushRadiusAdjustOverlay />}
          {brushStrengthAdjustActive && <BrushStrengthAdjustOverlay />}
          {sculptRadiusAdjustActive && <SculptRadiusAdjustOverlay />}
          {sculptStrengthAdjustActive && <SculptStrengthAdjustOverlay />}
          {/* GAP-001 — PSD wizard mounts at AppShell level. Reads
              wizardStore for current step + pending PSD; renders nothing
              when no wizard run is in flight. The reorder/adjust banners
              attach `top-0 inset-x-0` so they sit at the top of the
              shell (above the AreaTree); the review/dwpose modals use
              `fixed inset-0` to take over the viewport. */}
          {wizardStep && <PsdImportWizard />}
        </Suspense>
        <Suspense fallback={null}>
          <ServiceWorkerUpdater />
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
