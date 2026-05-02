// @ts-check

/**
 * GAP-010 — Live Preview editor.
 *
 * Mounts a `<CanvasViewport previewMode />` so the user can watch the rig
 * with all live drivers running (physics pendulum sway, breath cycle,
 * cursor head-look on LMB-drag) WITHOUT contaminating the editing
 * Viewport. As long as this editor is alive in any workspace area, its
 * drivers run; closing the tab unmounts the component and every driver
 * stops cleanly.
 *
 * Deliberately a thin wrapper rather than its own canvas:
 *   - CanvasViewport already implements the full WebGL2 + ScenePass +
 *     mesh/texture upload + rigSpec eval pipeline. Re-implementing that
 *     in v3-native shape would add a parallel rendering path with no
 *     deduplication mechanism for divergence.
 *   - The `previewMode` prop strips editing affordances (mesh edit,
 *     drag-to-pivot, gizmo, skeleton overlay, wizard, drop hint, brush)
 *     and gates live drivers ON. Two CanvasViewport instances mounted
 *     side-by-side share `paramValuesStore` + `rigSpecStore`, so the
 *     edit Viewport mirrors any cursor-look / breath / physics writes
 *     this surface produces — the user sees their rig in motion on the
 *     right while still scrubbing parameters on the left.
 *
 * Camera + zoom + pan are NOT independent yet — both surfaces read
 * `editorStore.view`. Independent cameras is a follow-up; the GAP-010
 * Phase A scope is "drivers run only here". When the user hits the
 * point where they want different framing per surface, we'll lift `view`
 * into per-surface scope.
 *
 * @module v3/editors/livePreview/LivePreviewEditor
 */

import CanvasViewport from '../../../components/canvas/CanvasViewport.jsx';

export function LivePreviewEditor() {
  return (
    <div className="h-full w-full relative">
      <CanvasViewport previewMode />
      <div className="absolute top-1.5 left-2 px-2 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-mono uppercase tracking-wider border border-primary/30 pointer-events-none select-none">
        live preview
      </div>
    </div>
  );
}
