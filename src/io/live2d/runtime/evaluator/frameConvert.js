/**
 * v2 R3 — Local-frame conversions.
 *
 * Warp / rotation / art-mesh keyform positions are stored in one of
 * three coordinate spaces ("localFrames"), keyed off the parent
 * deformer's type:
 *
 *   - `'canvas-px'`        — raw canvas pixels. Parent is ROOT.
 *
 *   - `'normalized-0to1'`  — [0..1] within the parent warp deformer's
 *                            grid. Forward needs the parent grid's
 *                            canvas bounding box; inverse applies the
 *                            parent's bilinear FFD.
 *
 *   - `'pivot-relative'`   — canvas-px offsets from the parent rotation
 *                            deformer's pivot, BEFORE the rotation is
 *                            applied. Forward subtracts the pivot;
 *                            inverse rotates by the parent's current
 *                            angle and adds the pivot.
 *
 * Each conversion is a *pure function*: no module state, no class. The
 * `parentContext` argument carries the parent deformer's runtime state
 * (rest grid bbox for warp parents; pivot + angle for rotation parents).
 * `chainEval` (R6) walks the parent chain and threads the contexts.
 *
 * Forward (`canvasToLocal`) is what the rig builder needed at export
 * time (writers convert mesh canvas vertices to deformer-local for
 * keyform emission). Runtime evaluation only needs the inverse
 * (`localToCanvas`) — but we ship both sides so unit tests can verify
 * round-trip.
 *
 * @module io/live2d/runtime/evaluator/frameConvert
 */

/**
 * @typedef {Object} CanvasFrameContext
 *   No fields. Token to indicate ROOT parent.
 *
 * @typedef {Object} WarpFrameContext
 * @property {{minX:number, minY:number, W:number, H:number}} gridBox
 *   The parent warp's REST canvas bbox (top-left + size). Forward
 *   normalises by this; inverse expects the *deformed* parent grid
 *   to be applied separately via `bilinearFFD` after un-normalising
 *   back to gridBox bounds.
 *
 * @typedef {Object} RotationFrameContext
 * @property {number} pivotX           - canvas-px
 * @property {number} pivotY           - canvas-px
 * @property {number} angleDeg         - parent's current rotation angle (degrees)
 *
 * @typedef {('canvas-px'|'normalized-0to1'|'pivot-relative')} LocalFrame
 */

/**
 * Forward: canvas-px → local frame.
 *
 * @param {[number, number]} canvasPos
 * @param {LocalFrame} localFrame
 * @param {object} [ctx]                - Frame-specific parent context
 * @returns {[number, number]}
 */
export function canvasToLocal(canvasPos, localFrame, ctx) {
  const cx = canvasPos[0];
  const cy = canvasPos[1];
  switch (localFrame) {
    case 'canvas-px':
      return [cx, cy];
    case 'normalized-0to1': {
      if (!ctx?.gridBox) {
        throw new Error('canvasToLocal: normalized-0to1 requires ctx.gridBox');
      }
      const { minX, minY, W, H } = ctx.gridBox;
      const u = W > 0 ? (cx - minX) / W : 0;
      const v = H > 0 ? (cy - minY) / H : 0;
      return [u, v];
    }
    case 'pivot-relative': {
      if (!ctx) {
        throw new Error('canvasToLocal: pivot-relative requires ctx (pivotX, pivotY, angleDeg)');
      }
      // Forward direction: subtract pivot, then UNROTATE by the parent's
      // current angle so the stored offset is in the pivot-frame BEFORE
      // rotation. localToCanvas re-rotates and re-adds the pivot.
      const dx = cx - ctx.pivotX;
      const dy = cy - ctx.pivotY;
      const rad = -((ctx.angleDeg ?? 0) * Math.PI) / 180;
      const cs = Math.cos(rad);
      const sn = Math.sin(rad);
      return [dx * cs - dy * sn, dx * sn + dy * cs];
    }
    default:
      throw new Error(`canvasToLocal: unknown localFrame '${localFrame}'`);
  }
}

/**
 * Inverse: local frame → canvas-px.
 *
 * `'normalized-0to1'` inverse is the *rest-frame* un-normalisation
 * (multiply by gridBox + add minX). To then apply the parent's
 * deformation, the caller passes the un-normalised position back into
 * `bilinearFFD(deformedGrid, gridSize, u, v)` with the stored
 * `(u, v)` itself, NOT this output. That is: this inverse exists for
 * symmetry / unit tests; chain composition uses bilinear FFD directly.
 *
 * @param {[number, number]} localPos
 * @param {LocalFrame} localFrame
 * @param {object} [ctx]
 * @returns {[number, number]}
 */
export function localToCanvas(localPos, localFrame, ctx) {
  const lx = localPos[0];
  const ly = localPos[1];
  switch (localFrame) {
    case 'canvas-px':
      return [lx, ly];
    case 'normalized-0to1': {
      if (!ctx?.gridBox) {
        throw new Error('localToCanvas: normalized-0to1 requires ctx.gridBox');
      }
      const { minX, minY, W, H } = ctx.gridBox;
      return [minX + lx * W, minY + ly * H];
    }
    case 'pivot-relative': {
      if (!ctx) {
        throw new Error('localToCanvas: pivot-relative requires ctx (pivotX, pivotY, angleDeg)');
      }
      const rad = ((ctx.angleDeg ?? 0) * Math.PI) / 180;
      const cs = Math.cos(rad);
      const sn = Math.sin(rad);
      return [
        ctx.pivotX + lx * cs - ly * sn,
        ctx.pivotY + lx * sn + ly * cs,
      ];
    }
    default:
      throw new Error(`localToCanvas: unknown localFrame '${localFrame}'`);
  }
}
