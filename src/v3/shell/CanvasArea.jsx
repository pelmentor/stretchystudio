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
import { WeightPaintOverlay } from '../editors/viewport/overlays/WeightPaintOverlay.jsx';
import { VertexSelectionOverlay } from '../editors/viewport/overlays/VertexSelectionOverlay.jsx';
import { BoxSelectOverlay } from '../editors/viewport/overlays/BoxSelectOverlay.jsx';
import { useCaptureStore } from '../../store/captureStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { CanvasToolbar } from './CanvasToolbar.jsx';
import { ToolSettingsPanel } from './ToolSettingsPanel.jsx';

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
  const hitContextRef = useRef(null);

  // Phase 5 — publish viewport ref-bridges (thumbnail capture, remesh)
  // into captureStore so editors mounted at the AppShell level
  // (SaveModal, Properties → MeshTab) can drive viewport-owned
  // imperatives without prop-drilling.
  useEffect(() => {
    useCaptureStore.getState().setCaptureThumbnail(() => thumbCaptureRef.current?.() ?? null);
    useCaptureStore.getState().setRemeshPart((partId, opts) => remeshRef.current?.(partId, opts));
    // 2026-05-05 — publish exportCaptureRef so the AppShell-level
    // ExportModal can drive frame capture without prop-drilling. Same
    // pattern as captureThumbnail. Only the edit Viewport's CanvasArea
    // wires this — the livePreview tab also mounts but its capture
    // would render the preview chrome state, not what the user wants
    // exported. Last-mounted wins; that's fine because the edit tab
    // and preview tab share project state and share a renderer.
    useCaptureStore.getState().setCaptureExportFrame((opts) => exportCaptureRef.current?.(opts) ?? null);
    // Toolset Phase 1.A — bridge canvas hit-context (latest chainEval
    // frames + composed verts) so AppShell-mounted box / lasso select
    // overlays can project their modal rect / polygon through what the
    // user sees rendered.
    useCaptureStore.getState().setGetCanvasHitContext(() => hitContextRef.current?.() ?? null);
    return () => {
      useCaptureStore.getState().setCaptureThumbnail(null);
      useCaptureStore.getState().setRemeshPart(null);
      useCaptureStore.getState().setCaptureExportFrame(null);
      useCaptureStore.getState().setGetCanvasHitContext(null);
    };
  }, []);

  const isPreview = mode === 'livePreview';
  const showWarpGrids = useEditorStore((s) => s.viewLayers.warpGrids);
  const showRotationPivots = useEditorStore((s) => s.viewLayers.rotationPivots);

  return (
    // `data-editor-type="viewport"` lets chord-fired operators
    // (selection.boxSelect / B) gate availability on what the cursor is
    // over. See `hoveredEditorType()` in `v3/operators/registry.js`.
    <div className="h-full w-full relative" data-editor-type="viewport">
      <CanvasViewport
        previewMode={isPreview}
        remeshRef={remeshRef}
        deleteMeshRef={deleteMeshRef}
        saveRef={saveRef}
        loadRef={loadRef}
        resetRef={resetRef}
        exportCaptureRef={exportCaptureRef}
        thumbCaptureRef={thumbCaptureRef}
        hitContextRef={hitContextRef}
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
      {/* V4 Phase 4b — weight paint overlay self-gates on
          `editorStore.editMode === 'weightPaint'` so it only mounts
          when the user is actively painting; no view-layer toggle. */}
      {!isPreview && <WeightPaintOverlay />}
      {/* Toolset Phase 0.D — vertex selection overlay self-gates on
          `editorStore.editMode === 'edit' && toolMode === 'select'`,
          so dots only appear when the user is in Edit Mode with the
          select tool active. Read-only — pointer events pass through
          (`pointerEvents: 'none'`) so CanvasViewport keeps single-
          source pointer dispatch. */}
      {!isPreview && <VertexSelectionOverlay />}
      {/* Toolset Phase 1 — modal box / lasso select overlay. Self-
          gates on `boxSelectStore.kind` so it only renders the in-
          progress shape during a B-drag or Ctrl+LMB-drag. Pointer
          events stay non-interactive (`pointer-events: none`) — the
          overlay's window listeners drive commit / cancel. */}
      {!isPreview && <BoxSelectOverlay />}
      {/* Mode selector relocated to the Viewport area HEADER (ViewportHeader)
          per UI Blender-parity Slice C — matches Blender's VIEW3D_HT_header
          mode picker. No longer a floating canvas overlay. */}
      {/* Left toolbar (Blender T-panel) — vertical icon strip below
          the Mode pill. Tool list driven by `editMode`. Edit Viewport
          only; Live Preview is read-only.

          ViewLayersPopover is NOT mounted here anymore — it's now a flex
          sibling of the Reset Pose cluster inside CanvasViewport so the
          two buttons can't overlap (3rd reported regression of that
          shape, fixed 2026-05-06 by collapsing the two absolute anchors
          into a single flex container). */}
      {!isPreview && <CanvasToolbar />}
      {/* BVR-007 — N-panel (Blender's right-edge tool settings panel).
          Mode-driven content (brush sliders for paint modes, Pose Mode
          hint, empty for Object Mode). Edit Viewport only. */}
      {!isPreview && <ToolSettingsPanel />}
      {isPreview && (
        <div className="absolute top-1.5 left-2 px-2 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-mono uppercase tracking-wider border border-primary/30 pointer-events-none select-none">
          live preview
        </div>
      )}
    </div>
  );
}
