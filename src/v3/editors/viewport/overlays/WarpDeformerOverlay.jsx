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
  // GAP-010 Phase B — deformer overlays only mount on the edit
  // Viewport (CanvasArea gates them on `!isPreview`), so always read
  // the viewport tab's view.
  const view = useEditorStore((s) => s.viewByMode.viewport);
  const warpGridsOn = useEditorStore((s) => s.viewLayers.warpGrids ?? true);
  const warpGridsOpacity = useEditorStore((s) => s.viewLayers.warpGridsOpacity ?? 0.25);
  const activeDeformerId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'deformer') return items[i].id;
    }
    return null;
  });

  if (!rigSpec || !warpGridsOn) return null;

  // PP1-007 — render every canvas-px warp at the user-set opacity, with the
  // selected one pinned to full opacity for accent. Pre-PP1-007 the overlay
  // only showed the selected warp; users had no way to see the full lattice
  // network without clicking each warp in turn.
  const allWarps = rigSpec.warpDeformers ?? [];
  const selectedWarp = activeDeformerId
    ? allWarps.find((w) => w?.id === activeDeformerId)
    : null;
  if (selectedWarp && selectedWarp.localFrame !== 'canvas-px') {
    // Nested warps need parent-grid resolution to display in canvas
    // space. Surface a hint instead so the user understands why
    // there's no overlay and isn't left wondering if the editor is
    // broken.
    return <NestedWarpHint warp={selectedWarp} />;
  }

  // Map canvas-px → screen-px. CanvasViewport applies the same
  // (zoom, panX, panY) so rendering in the same frame keeps the
  // overlay pinned to the GL output.
  function project(cx, cy) {
    return {
      x: cx * view.zoom + view.panX,
      y: cy * view.zoom + view.panY,
    };
  }

  /** @returns {{cols:number,rows:number,projected:Array<{x:number,y:number}>,lines:Array<{x1:number,y1:number,x2:number,y2:number}>}|null} */
  function buildGrid(warp) {
    const cols = warp?.gridSize?.cols ?? 0;
    const rows = warp?.gridSize?.rows ?? 0;
    if (cols < 1 || rows < 1) return null;
    const kf = (warp.keyforms ?? [])[0];
    const positions = kf?.positions;
    if (!positions || positions.length < (cols + 1) * (rows + 1) * 2) return null;
    const ptCount = (cols + 1) * (rows + 1);
    const projected = new Array(ptCount);
    for (let i = 0; i < ptCount; i++) {
      projected[i] = project(positions[i * 2], positions[i * 2 + 1]);
    }
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
    return { cols, rows, projected, lines };
  }

  // Draw every canvas-px warp; the selected one renders last (on top) at
  // full opacity for accent. Nested warps (normalized-0to1 / pivot-relative)
  // are filtered out — those need parent-grid resolution to project into
  // canvas space, surfaced separately via NestedWarpHint when the user
  // explicitly selects one.
  const displayWarps = allWarps.filter((w) => w?.localFrame === 'canvas-px');
  if (displayWarps.length === 0) return null;

  // Render the selected warp last so it paints on top of the others.
  const ordered = displayWarps.slice().sort((a, b) => {
    if (a.id === activeDeformerId) return 1;
    if (b.id === activeDeformerId) return -1;
    return 0;
  });

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    >
      {ordered.map((warp) => {
        const grid = buildGrid(warp);
        if (!grid) return null;
        const isSelected = warp.id === activeDeformerId;
        const groupOpacity = isSelected ? 1 : Math.max(0, Math.min(1, warpGridsOpacity));
        // Default colour is the theme foreground (black on light, light
        // on dark) — user 2026-05-03 wanted neutral lattices instead of
        // the previous sky-blue-on-everything. Selected warp keeps the
        // sky-blue accent so it pops against neutral grids.
        const groupClass = isSelected ? 'text-sky-400' : 'text-foreground';
        return (
          <g key={warp.id} className={groupClass} opacity={groupOpacity}>
            {grid.lines.map((l, i) => (
              <line
                key={i}
                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                stroke="currentColor"
                strokeOpacity={0.6}
                strokeWidth={1}
              />
            ))}
            {grid.projected.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={isSelected ? 3 : 2}
                fill="currentColor"
                fillOpacity={0.9}
                strokeWidth={0}
              />
            ))}
            {isSelected && grid.projected[0] && (
              <text
                x={grid.projected[0].x + 6}
                y={grid.projected[0].y - 6}
                fontSize={10}
                className="fill-sky-400"
                style={{ fontFamily: 'monospace' }}
              >
                {warp.name ?? warp.id} ({grid.cols}×{grid.rows})
              </text>
            )}
          </g>
        );
      })}
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
