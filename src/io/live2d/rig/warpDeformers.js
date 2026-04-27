/**
 * Warp deformer rig builders. Pure data — produces `WarpDeformerSpec`
 * entries from project-state inputs; no XML / no binary emission.
 *
 * Each builder is the spec-side of what used to be an `emit*` helper in
 * `cmo3/`. The cmo3 path consumes the spec via a thin XML translator that
 * preserves the existing emission shape; the moc3 path consumes the same
 * spec and translates to binary.
 *
 * See `docs/live2d-export/RUNTIME_PARITY_PLAN.md` for the full migration
 * map and `rig/rigSpec.js` for the data types.
 *
 * @module io/live2d/rig/warpDeformers
 */

import { DEFAULT_AUTO_RIG_CONFIG } from './autoRigConfig.js';

/**
 * Build the Neck Warp spec — bends the neck area in sync with head tilt
 * (ParamAngleZ). Bottom row pins at shoulders, top row shifts horizontally
 * at ±30° to follow the head.
 *
 * Chain integration: when the neck group has its own rotation deformer
 * (via the deferred `ParamRotation_<groupName>` pass), this warp parents
 * to that rotation deformer and works in pivot-relative coordinates.
 * Otherwise it parents to Body X Warp and uses normalized 0..1.
 *
 * @param {Object} input
 * @param {{minX:number, minY:number, W:number, H:number}} input.neckUnionBbox
 *   Bounding box of all meshes tagged 'neck' / 'neck-l' / 'neck-r' in
 *   canvas px. Caller computes via `bodyAnalyzer` or NECK_WARP_TAGS scan.
 * @param {('rotation'|'warp')} input.parentType
 *   `'rotation'` if the neck group has a rotation deformer (parent =
 *   GroupRotation_neck). `'warp'` if parenting under Body X Warp.
 * @param {string} input.parentDeformerId
 *   RigSpec id of the parent deformer.
 * @param {{x:number, y:number}|null} input.parentPivotCanvas
 *   Required when `parentType === 'rotation'`: the parent's pivot point
 *   in canvas coordinates. Used to convert grid points to pivot-relative.
 * @param {(cx:number)=>number} input.canvasToBodyXX
 *   Canvas → Body X Warp local-X normaliser. Required when
 *   `parentType === 'warp'`.
 * @param {(cy:number)=>number} input.canvasToBodyXY
 *   Canvas → Body X Warp local-Y normaliser. Required when
 *   `parentType === 'warp'`.
 * @param {import('./autoRigConfig.js').AutoRigNeckWarp} [input.autoRigNeckWarp]
 *   Tunable defaults from `project.autoRigConfig.neckWarp`. Falls back
 *   to `DEFAULT_AUTO_RIG_CONFIG.neckWarp` when omitted.
 * @returns {{
 *   spec: import('./rigSpec.js').WarpDeformerSpec,
 *   debug: {
 *     NECK_TILT_FRAC:number, gridCols:number, gridRows:number,
 *     spanX:number, maxShiftX:number,
 *     parentDeformer:string, note:string,
 *   }
 * }}
 */
export function buildNeckWarpSpec(input) {
  const {
    neckUnionBbox, parentType, parentDeformerId,
    parentPivotCanvas = null,
    canvasToBodyXX, canvasToBodyXY,
    autoRigNeckWarp = DEFAULT_AUTO_RIG_CONFIG.neckWarp,
  } = input;

  // 5×5 cells = 6×6 control points. Matches Hiyori's neck warp grid size.
  const cols = 5;
  const rows = 5;
  const gW = cols + 1;
  const gH = rows + 1;
  const gridPts = gW * gH;

  const isUnderRotation = parentType === 'rotation';

  // Rest grid: pixel offsets from rotation pivot if under a rotation
  // deformer; normalised 0..1 if under a structural warp (Body X).
  const baseGrid = new Float64Array(gridPts * 2);
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      const idx = (r * gW + c) * 2;
      const cx = neckUnionBbox.minX + c * neckUnionBbox.W / cols;
      const cy = neckUnionBbox.minY + r * neckUnionBbox.H / rows;
      if (isUnderRotation) {
        if (!parentPivotCanvas) {
          throw new Error(
            "[buildNeckWarpSpec] parentType='rotation' requires parentPivotCanvas",
          );
        }
        baseGrid[idx]     = cx - parentPivotCanvas.x;
        baseGrid[idx + 1] = cy - parentPivotCanvas.y;
      } else {
        baseGrid[idx]     = canvasToBodyXX(cx);
        baseGrid[idx + 1] = canvasToBodyXY(cy);
      }
    }
  }

  // Span used to scale the keyform shift. Pixel-span when under rotation
  // (pivot-relative positions are in pixels); width-of-grid when under a
  // warp (positions are 0..1).
  const spanX = isUnderRotation
    ? neckUnionBbox.W
    : baseGrid[(gW - 1) * 2] - baseGrid[0];

  // 3 keyforms on ParamAngleZ at -30/0/+30. At ±30 the top row shifts in X
  // by NECK_TILT_FRAC * spanX. Row gradient sin(π·(1 - rf) / 2) is 1 at
  // top row and 0 at bottom row, so shoulders stay pinned.
  const NECK_TILT_FRAC = autoRigNeckWarp.tiltFrac;
  const keys = [-30, 0, 30];
  const keyformPositions = keys.map(k => {
    const pos = new Float64Array(baseGrid);
    if (k === 0) return pos;
    const sign = k / 30;
    for (let r = 0; r < gH; r++) {
      const rf = r / (gH - 1);
      const gradient = Math.sin(Math.PI * (1 - rf) / 2);
      if (gradient === 0) continue;
      for (let c = 0; c < gW; c++) {
        const idx = (r * gW + c) * 2;
        pos[idx] += sign * NECK_TILT_FRAC * gradient * spanX;
      }
    }
    return pos;
  });

  /** @type {import('./rigSpec.js').WarpDeformerSpec} */
  const spec = {
    id: 'NeckWarp',
    name: 'Neck Warp',
    parent: {
      type: parentType, // 'rotation' | 'warp'
      id: parentDeformerId,
    },
    gridSize: { rows, cols },
    baseGrid,
    localFrame: isUnderRotation ? 'pivot-relative' : 'normalized-0to1',
    bindings: [{
      parameterId: 'ParamAngleZ',
      keys,
      interpolation: 'LINEAR',
    }],
    keyforms: keys.map((k, i) => ({
      keyTuple: [k],
      positions: keyformPositions[i],
      opacity: 1,
    })),
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };

  const debug = {
    NECK_TILT_FRAC,
    gridCols: gW,
    gridRows: gH,
    spanX,
    maxShiftX: NECK_TILT_FRAC * spanX,
    parentDeformer: isUnderRotation ? 'GroupRotation_neck' : 'Body X Warp',
    note: `top row shift at ParamAngleZ = +30 in ${isUnderRotation ? 'pixel' : '0..1'} space`,
  };

  return { spec, debug };
}
