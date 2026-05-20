// @ts-check

/**
 * Cursor2DOverlay — the Blender-style 2D scene cursor (red/white dashed
 * circle + crosshair) drawn on top of the canvas at `project.cursor`.
 *
 * Placement: Shift+Right-Mouse in the viewport (CanvasViewport's
 * onPointerDown), matching Blender's default `cursor_set_event`
 * (`reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:172`
 * — `view3d.cursor3d` on RIGHTMOUSE+shift in the LMB-select preset). The
 * snap menu (`Shift+S`) also moves it.
 *
 * Rendering mirrors `GizmoOverlay`: an `absolute inset-0` SVG that fills
 * the CanvasViewport container, drawing at container-relative
 * `world*zoom + pan` coords. This keeps the cursor INSIDE the viewport
 * stacking context — clipped by the container's `overflow-hidden` and
 * BELOW AppShell modals / the import wizard (an earlier `position:fixed`
 * version floated over those popups). Re-renders on cursor change
 * (project store) and pan/zoom (editor store). Falls back to canvas
 * centre when `project.cursor` is unset — matching `object/snap.js
 * readCursor`.
 *
 * @module components/canvas/Cursor2DOverlay
 */

import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';

export function Cursor2DOverlay() {
  const cursorRaw = useProjectStore((s) => s.project?.cursor);
  const canvasDim = useProjectStore((s) => s.project?.canvas);
  const view = useEditorStore((s) => s.viewByMode?.viewport);

  const cursor = (cursorRaw && typeof cursorRaw.x === 'number' && typeof cursorRaw.y === 'number')
    ? cursorRaw
    : { x: (canvasDim?.width ?? 800) / 2, y: (canvasDim?.height ?? 600) / 2 };

  if (!view) return null;
  const zoom = view.zoom || 1;
  // Container-relative px (SVG fills the viewport via `absolute inset-0`,
  // same convention as GizmoOverlay's pivotScreen math).
  const x = cursor.x * zoom + (view.panX ?? 0);
  const y = cursor.y * zoom + (view.panY ?? 0);

  const R = 11;       // circle radius
  const ARM = 4;      // crosshair arm length past the circle
  // Crosshair arms: [x1,y1,x2,y2] from just outside the circle inward.
  const arms = [
    [0, -R - ARM, 0, -R + 2],
    [0, R + ARM, 0, R - 2],
    [-R - ARM, 0, -R + 2, 0],
    [R + ARM, 0, R - 2, 0],
  ];

  return (
    <svg
      className="absolute inset-0 w-full h-full overflow-visible"
      style={{ pointerEvents: 'none' }}
    >
      <g transform={`translate(${x},${y})`}>
        {/* White halo under the red so the cursor reads on any background. */}
        <circle r={R} fill="none" stroke="white" strokeWidth="3" />
        <circle r={R} fill="none" stroke="#e8312a" strokeWidth="1.5" strokeDasharray="3 3" />
        {arms.map((l, i) => (
          <g key={i}>
            <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="white" strokeWidth="3" strokeLinecap="round" />
            <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="#e8312a" strokeWidth="1" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </svg>
  );
}
