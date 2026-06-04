/**
 * Warp deformer rig builders. Pure data — produces `WarpDeformerSpec`
 * entries from project-state inputs; no XML / no binary emission.
 *
 * Each builder is the spec-side of what used to be an `emit*` helper in
 * `cmo3/`. The cmo3 path consumes the spec via a thin XML translator that
 * preserves the existing emission shape; the moc3 path consumes the same
 * spec and translates to binary.
 *
 * See `docs/archive/plans-shipped/RUNTIME_PARITY.md` for the full migration
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
 * Chain integration: NeckWarp parents at BodyXWarp universally and works
 * in BodyXWarp-local 0..1 coordinates.
 *
 * # Why the rotation-parent branch is gone (2026-06-04, bug-04 sibling)
 *
 * Pre-fix this builder accepted `parentType: 'rotation'` and produced
 * `parent.id = GroupRotation_<neckGroupId>` for callers whose neck group
 * had a rotation deformer. But per the 2026-05-23 RotationDeformer→bone
 * refactor + RULE-№4 meta (SS IS Blender; Cubism = addon),
 * `GroupRotation_*` no longer reifies as a node in `project.nodes` — same
 * latent dangling-ref bug that wrecked FaceRotation in bug-04 (`0ed9f5c`).
 * Mirror bug-04's universal-BodyXWarp fix per RULE-№2 (no migration
 * baggage on dead code paths).
 *
 * @param {Object} input
 * @param {{minX:number, minY:number, W:number, H:number}} input.neckUnionBbox
 *   Bounding box of all meshes tagged 'neck' / 'neck-l' / 'neck-r' in
 *   canvas px. Caller computes via `bodyAnalyzer` or NECK_WARP_TAGS scan.
 * @param {(cx:number)=>number} input.canvasToBodyXX
 *   Canvas → Body X Warp local-X normaliser.
 * @param {(cy:number)=>number} input.canvasToBodyXY
 *   Canvas → Body X Warp local-Y normaliser.
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
    neckUnionBbox,
    canvasToBodyXX, canvasToBodyXY,
    autoRigNeckWarp = DEFAULT_AUTO_RIG_CONFIG.neckWarp,
  } = input;

  // 5×5 cells = 6×6 control points. Matches Hiyori's neck warp grid size.
  const cols = 5;
  const rows = 5;
  const gW = cols + 1;
  const gH = rows + 1;
  const gridPts = gW * gH;

  // Rest grid: normalised 0..1 in BodyXWarp-local space.
  const baseGrid = new Float64Array(gridPts * 2);
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      const idx = (r * gW + c) * 2;
      const cx = neckUnionBbox.minX + c * neckUnionBbox.W / cols;
      const cy = neckUnionBbox.minY + r * neckUnionBbox.H / rows;
      baseGrid[idx]     = canvasToBodyXX(cx);
      baseGrid[idx + 1] = canvasToBodyXY(cy);
    }
  }

  // Span used to scale the keyform shift — width-of-grid in 0..1 space.
  const spanX = baseGrid[(gW - 1) * 2] - baseGrid[0];

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
    parent: { type: 'warp', id: 'BodyXWarp' },
    gridSize: { rows, cols },
    baseGrid,
    localFrame: 'normalized-0to1',
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
    parentDeformer: 'Body X Warp',
    note: 'top row shift at ParamAngleZ = +30 in 0..1 space',
  };

  return { spec, debug };
}
