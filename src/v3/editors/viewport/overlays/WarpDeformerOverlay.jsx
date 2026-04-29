// @ts-check

/**
 * v3 Phase 2A — Warp Deformer Editor: lattice overlay.
 *
 * Renders the active warp deformer's control-point grid as an SVG
 * overlay above the canvas. Read-only first cut — the user can see
 * where the warp's lattice sits relative to the parts it deforms,
 * which is enough to debug the auto-rig output and decide whether
 * a fit-to-children adjust is needed before exporting.
 *
 * Edit (drag a control point → mutate the rest-pose grid → store the
 * delta as a new keyform tuple) is Phase 2D's job; the keyform
 * editor needs scrubber-aware UI that's bigger than this single
 * substage.
 *
 * Coverage:
 *  - Only `localFrame === 'canvas-px'` warps render (Body / Face /
 *    Breath top-level chain). Nested warps (`normalized-0to1`)
 *    require parent-grid resolution that's deferred until the editor
 *    can drag them — read-only display of normalized coords would
 *    just confuse.
 *  - Multiple keyforms collapse to keyform[0] (the rest tuple). The
 *    Properties tab shows the full keyform list separately.
 *
 * @module v3/editors/viewport/overlays/WarpDeformerOverlay
 */

import { useEditorStore } from '../../../../store/editorStore.js';
import { useRigSpecStore } from '../../../../store/rigSpecStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';

export function WarpDeformerOverlay() {
  const rigSpec = useRigSpecStore((s) => s.rigSpec);
  const view = useEditorStore((s) => s.view);
  const activeDeformerId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'deformer') return items[i].id;
    }
    return null;
  });

  if (!rigSpec || !activeDeformerId) return null;

  const warp = (rigSpec.warpDeformers ?? []).find((w) => w?.id === activeDeformerId);
  if (!warp) return null;
  if (warp.localFrame !== 'canvas-px') {
    // Nested warps need parent-grid resolution to display in canvas
    // space. Surface a hint instead so the user understands why
    // there's no overlay and isn't left wondering if the editor is
    // broken.
    return <NestedWarpHint warp={warp} />;
  }

  const cols = warp.gridSize?.cols ?? 0;
  const rows = warp.gridSize?.rows ?? 0;
  if (cols < 1 || rows < 1) return null;

  // Use keyform[0] as the displayed lattice. Most rigs have a single
  // keyform per deformer (rest pose); compound 2D grids carry more,
  // and the Properties tab is the right place to inspect those —
  // here we keep the visual minimal.
  const kf = (warp.keyforms ?? [])[0];
  const positions = kf?.positions;
  if (!positions || positions.length < (cols + 1) * (rows + 1) * 2) return null;

  // Map canvas-px → screen-px. CanvasViewport applies the same
  // (zoom, panX, panY) so rendering in the same frame keeps the
  // overlay pinned to the GL output.
  function project(cx, cy) {
    return {
      x: cx * view.zoom + view.panX,
      y: cy * view.zoom + view.panY,
    };
  }

  const ptCount = (cols + 1) * (rows + 1);

  /** @type {Array<{x:number,y:number}>} */
  const projected = [];
  for (let i = 0; i < ptCount; i++) {
    projected.push(project(positions[i * 2], positions[i * 2 + 1]));
  }

  // Grid line segments (rows + cols).
  /** @type {Array<{x1:number,y1:number,x2:number,y2:number}>} */
  const lines = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = projected[r * (cols + 1) + c];
      const b = projected[r * (cols + 1) + c + 1];
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = projected[r * (cols + 1) + c];
      const b = projected[(r + 1) * (cols + 1) + c];
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      <g>
        {lines.map((l, i) => (
          <line
            key={i}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="rgb(56 189 248 / 0.6)"
            strokeWidth={1}
          />
        ))}
        {projected.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="rgb(56 189 248 / 0.9)"
            stroke="rgb(15 23 42 / 0.8)"
            strokeWidth={1}
          />
        ))}
      </g>
      <text
        x={projected[0].x + 6}
        y={projected[0].y - 6}
        fontSize={10}
        fill="rgb(56 189 248)"
        style={{ fontFamily: 'monospace' }}
      >
        {warp.name ?? warp.id} ({cols}×{rows})
      </text>
    </svg>
  );
}

function NestedWarpHint({ warp }) {
  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-1
                 rounded bg-card/80 border border-border text-[10px]
                 text-muted-foreground font-mono"
    >
      {warp.name ?? warp.id} — nested warp
      ({warp.localFrame}); lattice display Phase 2D.
    </div>
  );
}
