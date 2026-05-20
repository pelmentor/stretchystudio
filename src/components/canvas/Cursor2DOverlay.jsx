// @ts-check

/**
 * Cursor2DOverlay — the Blender-style 2D scene cursor (red/white dashed
 * circle + crosshair) drawn on top of the canvas at `project.cursor`.
 *
 * The cursor POSITION + the snap operators that move it (`Shift+S`) have
 * existed since schema v33, but nothing ever drew it — so the user had no
 * visual feedback that a cursor existed or where it was. This overlay
 * closes that gap.
 *
 * Positioning mirrors the modal overlays' `SnapTargetDot`: canvas
 * `getBoundingClientRect()` + the active viewport pan/zoom map the
 * canvas-space cursor to screen px. Re-renders on cursor change (project
 * store) and pan/zoom (editor store). When `project.cursor` is unset
 * (pre-v33 saves), falls back to canvas centre — matching
 * `object/snap.js readCursor`.
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
  const canvas = document.querySelector('canvas');
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return null;

  const screenX = rect.left + (cursor.x * zoom + (view.panX ?? 0));
  const screenY = rect.top + (cursor.y * zoom + (view.panY ?? 0));

  const R = 11;       // circle radius
  const ARM = 4;      // crosshair arm length past the circle
  const PAD = ARM + 3;
  const size = (R + PAD) * 2;
  const c = R + PAD;  // svg-local centre

  // Crosshair arms: [x1,y1,x2,y2] from just outside the circle outward.
  const arms = [
    [0, -R - ARM, 0, -R + 2],
    [0, R + ARM, 0, R - 2],
    [-R - ARM, 0, -R + 2, 0],
    [R + ARM, 0, R - 2, 0],
  ];

  return (
    <svg
      className="fixed z-[150] pointer-events-none"
      width={size}
      height={size}
      style={{ left: screenX - c, top: screenY - c }}
    >
      <g transform={`translate(${c},${c})`}>
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
