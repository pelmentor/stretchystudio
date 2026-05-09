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

import { useRef } from 'react';
import { useEditorStore } from '../../../../store/editorStore.js';
import { useRigSpecStore } from '../../../../store/rigSpecStore.js';
import { useRigEvalStore } from '../../../../store/rigEvalStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useParamValuesStore } from '../../../../store/paramValuesStore.js';
import { canvasToLocal } from '../../../../io/live2d/runtime/evaluator/frameConvert.js';
import { cellSelect } from '../../../../io/live2d/runtime/evaluator/cellSelect.js';
import { evalRotation } from '../../../../io/live2d/runtime/evaluator/rotationEval.js';
import { inverseBilinearFFD } from '../../../../io/live2d/runtime/evaluator/inverseBilinearFFD.js';

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
  // `viewLayers.warpGridVisibility` is always populated as `{}` in the
  // editorStore initial state; the prior `?? {}` returned a fresh
  // empty object on every snapshot.
  const warpGridVisibility = useEditorStore((s) => s.viewLayers.warpGridVisibility);
  const activeDeformerId = useSelectionStore((s) => {
    const items = s.items;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'deformer') return items[i].id;
    }
    return null;
  });

  // V4 Phase 3b — keyform edit mode. When the active deformer matches
  // editorStore.keyformEdit.deformerId, control points become draggable.
  // Drag converts screen-px → the warp's `localFrame` and writes back
  // into `keyform.positions[i*2|i*2+1]`:
  //
  //   - canvas-px       → direct screen→canvas conversion (Phase 3b).
  //   - pivot-relative  → resolve parent rotation's state at the locked
  //                       keyTuple via cellSelect+evalRotation, then
  //                       canvasToLocal('pivot-relative', …). (Phase 3 polish)
  //   - normalized-0to1 → inverseBilinearFFD against parent warp's
  //                       lifted (= live, canvas-px) grid. (Phase 3 polish)
  const editMode = useEditorStore((s) => s.editMode);
  const keyformEdit = useEditorStore((s) => s.keyformEdit);
  const updateProject = useProjectStore((s) => s.updateProject);
  const paramValues = useParamValuesStore((s) => s.values);
  const dragRef = useRef(/** @type {null | {pointerId:number, vertexIndex:number}} */ (null));

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
        // Phase 3 polish — drag enabled for all three localFrames.
        // canvas-px / pivot-relative / normalized-0to1 each resolve the
        // local-frame coord via the helpers wired below.
        const isEditingThis =
          editMode === 'keyform'
          && keyformEdit?.deformerId === warp.id;
        // Default colour is the theme foreground (black on light, light
        // on dark) — user 2026-05-03 wanted neutral lattices instead of
        // the previous sky-blue-on-everything. Selected warp keeps the
        // sky-blue accent so it pops against neutral grids. Editing
        // mode flips to amber to telegraph "drag me".
        const groupClass = isEditingThis
          ? 'text-amber-400'
          : isSelected ? 'text-sky-400' : 'text-foreground';

        // Screen-px → canvas-px. Inverse of the `project()` above.
        function screenToCanvas(sx, sy) {
          return { x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
        }

        // Phase 3 polish — convert a canvas-px point into the warp's
        // own `localFrame` by resolving the parent's runtime state at
        // the locked keyTuple. Returns null if the parent's state is
        // unknowable (missing rotation deformer / missing parent
        // lifted grid / target outside grid).
        function localCoordForCanvasPoint(canvasX, canvasY) {
          if (warp.localFrame === 'canvas-px') return [canvasX, canvasY];
          const parentRef = warp.parent;
          if (!parentRef || parentRef.type === 'root') {
            // localFrame says non-root but spec disagrees — treat as canvas-px.
            return [canvasX, canvasY];
          }
          if (warp.localFrame === 'pivot-relative') {
            // Parent must be a rotation deformer; look it up + blend.
            const parentRot = (rigSpec?.rotationDeformers ?? [])
              .find((r) => r.id === parentRef.id);
            if (!parentRot) return null;
            const cell = cellSelect(parentRot.bindings ?? [], paramValues ?? {});
            const evald = evalRotation(parentRot, cell);
            if (!evald) return null;
            return canvasToLocal([canvasX, canvasY], 'pivot-relative', {
              pivotX: evald.originX ?? 0,
              pivotY: evald.originY ?? 0,
              angleDeg: evald.angleDeg ?? 0,
            });
          }
          if (warp.localFrame === 'normalized-0to1') {
            // Parent is a warp; need its lifted (= live, canvas-px) grid.
            const parentSpec = (rigSpec?.warpDeformers ?? [])
              .find((w) => w.id === parentRef.id);
            const parentLifted = liftedGrids?.get(parentRef.id);
            if (!parentSpec?.gridSize || !parentLifted) return null;
            return inverseBilinearFFD(parentLifted, parentSpec.gridSize, [canvasX, canvasY]);
          }
          return null;
        }

        function handlePointerDown(e, vertexIndex) {
          if (!isEditingThis) return;
          e.preventDefault();
          e.stopPropagation();
          /** @type {SVGCircleElement} */
          const target = e.currentTarget;
          target.setPointerCapture?.(e.pointerId);
          dragRef.current = { pointerId: e.pointerId, vertexIndex };
        }

        function handlePointerMove(e) {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
          if (!rect) return;
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const { x: cx, y: cy } = screenToCanvas(sx, sy);
          const local = localCoordForCanvasPoint(cx, cy);
          if (!local) return; // outside parent grid / parent state unresolved
          const kIdx = keyformEdit?.keyformIndex;
          if (typeof kIdx !== 'number') return;
          updateProject((proj) => {
            const n = proj.nodes.find(
              (nn) => nn?.id === warp.id && nn?.type === 'deformer',
            );
            if (!n || !Array.isArray(n.keyforms)) return;
            const kf = n.keyforms[kIdx];
            if (!kf || !Array.isArray(kf.positions)) return;
            const i2 = drag.vertexIndex * 2;
            if (i2 + 1 >= kf.positions.length) return;
            kf.positions[i2]     = local[0];
            kf.positions[i2 + 1] = local[1];
            kf._userAuthored = true;
          });
        }

        function handlePointerUp(e) {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          /** @type {SVGCircleElement} */
          const target = e.currentTarget;
          target.releasePointerCapture?.(e.pointerId);
          dragRef.current = null;
        }

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
                r={isEditingThis ? 5 : isSelected ? 3 : 2}
                fill="currentColor"
                fillOpacity={0.9}
                stroke={isEditingThis ? 'currentColor' : undefined}
                strokeOpacity={isEditingThis ? 0.4 : 0}
                strokeWidth={isEditingThis ? 6 : 0}
                style={isEditingThis
                  ? { pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }
                  : undefined}
                onPointerDown={isEditingThis ? (e) => handlePointerDown(e, i) : undefined}
                onPointerMove={isEditingThis ? handlePointerMove : undefined}
                onPointerUp={isEditingThis ? handlePointerUp : undefined}
                onPointerCancel={isEditingThis ? handlePointerUp : undefined}
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
