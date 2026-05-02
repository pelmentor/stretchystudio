// @ts-check

/**
 * v3 — shared host for the Viewport and Live Preview tabs.
 *
 * Both tabs back onto the SAME `<CanvasViewport>` instance. The `mode`
 * prop only flips `previewMode` and a couple of overlay/badge slots —
 * the canvas itself never unmounts when the user toggles between
 * `viewport` and `livePreview` in the center area's tab bar.
 *
 * Why one instance, not two: CanvasViewport owns the WebGL2 context,
 * texture uploads, ScenePass, scene buffers, and a pile of imperative
 * refs (`onnxSessionRef`, `preImportSnapshotRef`, `meshAllPartsRef`,
 * the wizard's local PSD payload, etc.). Mounting one component per
 * tab destroys all of that on every switch — visible in the logs as
 * back-to-back `WebGL2 context destroyed (cleanup)` / `WebGL2 context
 * initialised` pairs, and surfaced as the "wizard character vanishes
 * forever" bug. A shared instance keeps the canvas alive and fast.
 *
 * `Area.jsx` short-circuits the editor registry for canvas tabs and
 * renders this component directly. Tab labels still come from the
 * registry's `label` field; the registry's `component` for `viewport`
 * and `livePreview` is `null` because nothing else mounts them.
 *
 * @module v3/shell/CanvasArea
 */

import { useEffect, useRef } from 'react';
import CanvasViewport from '../../components/canvas/CanvasViewport.jsx';
import { WarpDeformerOverlay } from '../editors/viewport/overlays/WarpDeformerOverlay.jsx';
import { RotationDeformerOverlay } from '../editors/viewport/overlays/RotationDeformerOverlay.jsx';
import { useCaptureStore } from '../../store/captureStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { ViewLayersPopover } from './ViewLayersPopover.jsx';
import { ModePill } from './ModePill.jsx';

/**
 * @param {Object} props
 * @param {'viewport'|'livePreview'} props.mode - active center tab type
 */
export function CanvasArea({ mode }) {
  // Imperative-handle refs CanvasViewport populates so external code
  // (Inspector remesh button, Save/Load toolbar, export pipeline,
  // thumbnail capture) can drive viewport-owned actions. The refs are
  // declared once and survive `mode` toggles — the wires don't have to
  // re-publish into captureStore on every tab switch.
  const remeshRef = useRef(null);
  const deleteMeshRef = useRef(null);
  const saveRef = useRef(null);
  const loadRef = useRef(null);
  const resetRef = useRef(null);
  const exportCaptureRef = useRef(null);
  const thumbCaptureRef = useRef(null);

  // Phase 5 — publish viewport ref-bridges (thumbnail capture, remesh)
  // into captureStore so editors mounted at the AppShell level
  // (SaveModal, Properties → MeshTab) can drive viewport-owned
  // imperatives without prop-drilling.
  useEffect(() => {
    useCaptureStore.getState().setCaptureThumbnail(() => thumbCaptureRef.current?.() ?? null);
    useCaptureStore.getState().setRemeshPart((partId, opts) => remeshRef.current?.(partId, opts));
    return () => {
      useCaptureStore.getState().setCaptureThumbnail(null);
      useCaptureStore.getState().setRemeshPart(null);
    };
  }, []);

  const isPreview = mode === 'livePreview';
  const showWarpGrids = useEditorStore((s) => s.viewLayers.warpGrids);
  const showRotationPivots = useEditorStore((s) => s.viewLayers.rotationPivots);

  return (
    <div className="h-full w-full relative">
      <CanvasViewport
        previewMode={isPreview}
        remeshRef={remeshRef}
        deleteMeshRef={deleteMeshRef}
        saveRef={saveRef}
        loadRef={loadRef}
        resetRef={resetRef}
        exportCaptureRef={exportCaptureRef}
        thumbCaptureRef={thumbCaptureRef}
      />
      {/* Edit-only overlays. Hidden in preview mode (read-only surface).
          CoordSpaceOverlay (chains-bar + dump button) was removed 2026-05-02
          per user direction — chain diagnostics live in the Logs panel
          (`chainDiagnose` source); the in-viewport overlay redundantly
          duplicated that signal and stole the top-right canvas corner from
          the Reset Pose button.
          GAP-016 — both deformer overlays are now toggleable through the
          View Layers popover (`viewLayers.warpGrids` / `viewLayers.rotationPivots`). */}
      {!isPreview && showWarpGrids       && <WarpDeformerOverlay />}
      {!isPreview && showRotationPivots && <RotationDeformerOverlay />}
      {/* Mode pill (Blender-style) — top-left canvas overlay.
          Surfaces the contextual edit mode for the active selection.
          Edit Viewport only; Live Preview is read-only. */}
      {!isPreview && <ModePill />}
      {/* View Layers picker (GAP-016) — sits left of Reset Pose button in
          edit Viewport. Hidden in Live Preview (read-only surface). */}
      {!isPreview && <ViewLayersPopover />}
      {isPreview && (
        <div className="absolute top-1.5 left-2 px-2 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-mono uppercase tracking-wider border border-primary/30 pointer-events-none select-none">
          live preview
        </div>
      )}
    </div>
  );
}
