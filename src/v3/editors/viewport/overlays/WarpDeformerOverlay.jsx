// @ts-check

/**
 * v3 Phase 2A — Warp Deformer Editor: lattice overlay.
 *
 * Renders the warp deformer control-point grids as an SVG overlay
 * above the canvas. Read-only — the user sees where every lattice
 * sits relative to the parts it deforms, animated under current
 * params. Useful for debugging the auto-rig output and confirming
 * which warps are responding to which parameter changes.
 *
 * Edit (drag a control point → mutate the rest-pose grid → store the
 * delta as a new keyform tuple) is Phase 2D's job; the keyform
 * editor needs scrubber-aware UI that's bigger than this single
 * substage.
 *
 * Coverage (PP2-010):
 *  - Every warp renders, regardless of authored localFrame. Nested
 *    warps (normalised-0to1 / pivot-relative) read their lifted
 *    canvas-px grid from `rigEvalStore.liftedGrids`, which CanvasViewport
 *    populates per frame via `evalRig({ out: { liftedGrids } })`.
 *  - Top-level canvas-px warps fall back to `keyforms[0].positions`
 *    when the lifted cache is empty (e.g. before the first eval).
 *  - The selected warp paints last (on top) at full opacity and the
 *    sky-blue accent. Other warps inherit the user-set opacity.
 *
 * @module v3/editors/viewport/overlays/WarpDeformerOverlay
 */

import { useEditorStore } from '../../../../store/editorStore.js';
import { useRigSpecStore } from '../../../../store/rigSpecStore.js';
import { useRigEvalStore } from '../../../../store/rigEvalStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';

export function WarpDeformerOverlay() {
  const rigSpec = useRigSpecStore((s) => s.rigSpec);
  // PP2-010 — chainEval's lifted grids: every warp's control points
  // composed through the parent chain at current params, in canvas-px.
  // Lets us render nested warps (hair/eye/clothing under FaceParallax /
  // body chain) that the Phase-1 overlay skipped because their
  // keyform positions were in normalised-0to1 of a parent.
  const liftedGrids = useRigEvalStore((s) => s.liftedGrids);
  // GAP-010 Phase B — deformer overlays only mount on the edit
  // Viewport (CanvasArea gates them on `!isPreview`), so always read
  // the viewport tab's view.
  const view = useEditorStore((s) => s.viewByMode.viewport);
  const warpGridsOn = useEditorStore((s) => s.viewLayers.warpGrids ?? true);
  const warpGridsOpacity = useEditorStore((s) => s.viewLayers.warpGridsOpacity ?? 0.25);
  // PP2-010(b) — per-warp visibility map (sparse: missing key = visible).
  const warpGridVisibility = useEditorStore((s) => s.viewLayers.warpGridVisibility ?? {});
  const activeDeformerId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'deformer') return items[i].id;
    }
    return null;
  });

  if (!rigSpec || !warpGridsOn) return null;

  // PP2-010 — render every warp using its lifted canvas-px grid (live,
  // animated under current params). Falls back to keyform[0] for warps
  // that are already canvas-px AND have no lifted entry (the lift cache
  // is empty until the first eval; covers the very first paint).
  const allWarps = rigSpec.warpDeformers ?? [];

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
    const lifted = liftedGrids?.get(warp.id);
    // Prefer the lifted (live, canvas-px) grid; fall back to keyform[0]
    // for canvas-px warps when no lift exists yet (first frame, or rig
    // without an active eval pass).
    let positions = null;
    if (lifted && lifted.length >= (cols + 1) * (rows + 1) * 2) {
      positions = lifted;
    } else if (warp.localFrame === 'canvas-px') {
      const kf = (warp.keyforms ?? [])[0];
      if (kf?.positions && kf.positions.length >= (cols + 1) * (rows + 1) * 2) {
        positions = kf.positions;
      }
    }
    if (!positions) return null;
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

  // PP2-010 — display every warp that has a buildable grid (lifted OR
  // canvas-px keyform fallback). The lifted-grid pass canvas-fies nested
  // warps too, so the user finally sees the full network.
  // PP2-010(b) — per-warp visibility map filters out warps the user
  // hid via the Outliner Rig-tab eye icon. Sparse: missing key = visible.
  const displayWarps = allWarps.filter((w) =>
    w?.gridSize?.cols
    && w?.gridSize?.rows
    && warpGridVisibility[w.id] !== false,
  );
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
