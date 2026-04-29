// @ts-check

/**
 * v3 Phase 1C.0 — Basic Viewport editor.
 *
 * First cut wraps the existing v2 `CanvasViewport` so the v3 shell
 * shows the actual project (background, parts, overlays) instead of
 * the placeholder stub. The CanvasViewport receives stable refs so
 * imperative actions (remesh, save, load) keep working when wired
 * up by future operators / Properties tabs.
 *
 * Phase 1C proper adds: ViewportHeader, shading modes, the
 * Coord-Space Debugger overlay (which unblocks the Phase 1E coord-
 * space bug fix), DeformerLatticeOverlay, RotationGizmoOverlay,
 * PhysicsChainOverlay, HUD. Each lands as its own substage.
 *
 * Why a thin wrapper rather than copy-paste: CanvasViewport is the
 * 1953-LOC carrier of the working rig pipeline (chain eval, physics
 * tick, mask stencils, mesh upload, GPU pump). Reimplementing in
 * v3-native shape would freeze the whole viewport for weeks. The
 * Plan §1.C explicitly chose "wraps existing CanvasViewport" — we
 * extract the v2 carrier into v3-native modules incrementally as
 * Phase 1C overlays land.
 *
 * @module v3/editors/viewport/ViewportEditor
 */

import { useEffect, useRef } from 'react';
import CanvasViewport from '../../../components/canvas/CanvasViewport.jsx';
import { CoordSpaceOverlay } from './overlays/CoordSpaceOverlay.jsx';
import { useCaptureStore } from '../../../store/captureStore.js';

export function ViewportEditor() {
  // Imperative-handle refs CanvasViewport populates so external code
  // (Inspector remesh button, Save/Load toolbar, export pipeline) can
  // call into it. In v3 first cut nothing reads them — they exist so
  // CanvasViewport's `*Ref.current = fn` assignments don't throw.
  // Phase 1B Properties' MeshTab will wire `remeshRef` once it lands.
  const remeshRef = useRef(null);
  const deleteMeshRef = useRef(null);
  const saveRef = useRef(null);
  const loadRef = useRef(null);
  const resetRef = useRef(null);
  const exportCaptureRef = useRef(null);
  const thumbCaptureRef = useRef(null);

  // Phase 5 — publish viewport ref-bridges (thumbnail capture, remesh)
  // into a small store so editors mounted at the AppShell level
  // (SaveModal, Properties → MeshTab) can drive viewport-owned
  // imperatives without prop-drilling. Re-publishing each render is
  // cheap (zustand bails on identity equality) and the cleanup clears
  // the closures when this editor unmounts so a stale GL context is
  // never reused.
  useEffect(() => {
    useCaptureStore.getState().setCaptureThumbnail(() => thumbCaptureRef.current?.() ?? null);
    useCaptureStore.getState().setRemeshPart((partId, opts) => remeshRef.current?.(partId, opts));
    return () => {
      useCaptureStore.getState().setCaptureThumbnail(null);
      useCaptureStore.getState().setRemeshPart(null);
    };
  }, []);

  return (
    <div className="h-full w-full relative">
      <CanvasViewport
        remeshRef={remeshRef}
        deleteMeshRef={deleteMeshRef}
        saveRef={saveRef}
        loadRef={loadRef}
        resetRef={resetRef}
        exportCaptureRef={exportCaptureRef}
        thumbCaptureRef={thumbCaptureRef}
      />
      <CoordSpaceOverlay />
    </div>
  );
}
