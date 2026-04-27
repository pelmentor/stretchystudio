/**
 * Body warp chain rig builder. Produces the four `WarpDeformerSpec`s that
 * sit at the top of the deformer hierarchy:
 *
 *     ROOT
 *       └─ Body Warp Z       ParamBodyAngleZ ±10  (canvas-px coords)
 *           └─ Body Warp Y   ParamBodyAngleY ±10  (normalised 0..1 in BZ)
 *               └─ Breath    ParamBreath 0..1     (normalised 0..1 in BY)
 *                   └─ Body X Warp  ParamBodyAngleX ±10  (normalised 0..1 in Breath)
 *                       └─ everything else (face rotation, group rotations, rig warps, meshes)
 *
 * Math is anatomy-aware: hip / feet / shoulder anchors come from the body
 * silhouette analyzer, and per-row spine drift adjusts the bow peak for
 * off-center characters. Without this, the lower body of asymmetric
 * characters drifts when the upper body leans.
 *
 * @module io/live2d/rig/bodyWarp
 */

import { makeUniformGrid } from '../cmo3/deformerEmit.js';
import { DEFAULT_AUTO_RIG_CONFIG } from './autoRigConfig.js';

const SC = 5;          // 5×5 cells = 6×6 control points

/**
 * @typedef {Object} BodyWarpChainInput
 * @property {Array<{vertices:number[]|Float32Array}>} perMesh
 *   All visible meshes (with vertices in canvas px). Used to compute the BZ
 *   canvas bbox.
 * @property {number} canvasW
 * @property {number} canvasH
 * @property {Object|null} bodyAnalysis   // bodyAnalyzer.js output
 * @property {boolean} [generateRig=true]
 * @property {boolean} [hasParamBodyAngleX=true]
 *   When false, BX is omitted from the chain (it's the only one gated by a
 *   conditional param presence in the legacy code).
 * @property {import('./autoRigConfig.js').AutoRigBodyWarp} [autoRigBodyWarp]
 *   Tunable defaults from `project.autoRigConfig.bodyWarp`. Falls back to
 *   `DEFAULT_AUTO_RIG_CONFIG.bodyWarp` when omitted (preserves identical
 *   behaviour for legacy callers).
 */

/**
 * @typedef {Object} BodyWarpChainResult
 * @property {import('./rigSpec.js').WarpDeformerSpec[]} specs
 *   In emission order: BZ, BY, Breath, [BX].
 * @property {{
 *   BZ_MIN_X:number, BZ_MIN_Y:number, BZ_W:number, BZ_H:number,
 *   BY_MIN:number, BY_MAX:number,
 *   BR_MIN:number, BR_MAX:number,
 *   BX_MIN:number, BX_MAX:number,
 * }} layout
 * @property {(cx:number)=>number} canvasToBodyXX
 * @property {(cy:number)=>number} canvasToBodyXY
 * @property {{
 *   HIP_FRAC:number, FEET_FRAC:number,
 *   bodyFracSource:string,
 *   spineCfShifts:number[],
 * }} debug
 */

/**
 * @param {BodyWarpChainInput} input
 * @returns {BodyWarpChainResult}
 */
export function buildBodyWarpChain(input) {
  const {
    perMesh, canvasW, canvasH, bodyAnalysis, hasParamBodyAngleX = true,
    autoRigBodyWarp = DEFAULT_AUTO_RIG_CONFIG.bodyWarp,
  } = input;

  const BX_MIN = autoRigBodyWarp.bxRange.min;
  const BX_MAX = autoRigBodyWarp.bxRange.max;
  const BY_MARGIN = autoRigBodyWarp.byMargin;
  const BR_MARGIN = autoRigBodyWarp.breathMargin;

  // ── Canvas bbox for the BZ grid (~10% pad beyond character extent) ──
  let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
  for (const pm of perMesh) {
    const v = pm.vertices;
    if (!v) continue;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i] < allMinX) allMinX = v[i];
      if (v[i] > allMaxX) allMaxX = v[i];
      if (v[i + 1] < allMinY) allMinY = v[i + 1];
      if (v[i + 1] > allMaxY) allMaxY = v[i + 1];
    }
  }
  const charW = (allMaxX - allMinX) || canvasW;
  const charH = (allMaxY - allMinY) || canvasH;
  const padFrac = autoRigBodyWarp.canvasPadFrac;
  const BZ_MIN_X = allMinX - charW * padFrac;
  const BZ_MAX_X = allMaxX + charW * padFrac;
  const BZ_MIN_Y = allMinY - charH * padFrac;
  const BZ_MAX_Y = allMaxY + charH * padFrac;
  const BZ_W = BZ_MAX_X - BZ_MIN_X;
  const BZ_H = BZ_MAX_Y - BZ_MIN_Y;
  const BY_MIN = BY_MARGIN;
  const BY_MAX = 1 - BY_MARGIN;
  const BR_MIN = BR_MARGIN;
  const BR_MAX = 1 - BR_MARGIN;

  // 4-step normaliser: canvas → BZ → BY → Breath → BX
  const canvasToBodyXX = (cx) => {
    const bzL = (cx - BZ_MIN_X) / BZ_W;
    const byL = (bzL - BY_MIN) / (BY_MAX - BY_MIN);
    const brL = (byL - BR_MIN) / (BR_MAX - BR_MIN);
    return (brL - BX_MIN) / (BX_MAX - BX_MIN);
  };
  const canvasToBodyXY = (cy) => {
    const bzL = (cy - BZ_MIN_Y) / BZ_H;
    const byL = (bzL - BY_MIN) / (BY_MAX - BY_MIN);
    const brL = (byL - BR_MIN) / (BR_MAX - BR_MIN);
    return (brL - BX_MIN) / (BX_MAX - BX_MIN);
  };

  const scGW = SC + 1, scGH = SC + 1;
  const scGridPts = scGW * scGH;

  // ── Hip / feet anchors derived from anatomy where available ──
  const HIP_FRAC_DEFAULT  = autoRigBodyWarp.hipFracDefault;
  const FEET_FRAC_DEFAULT = autoRigBodyWarp.feetFracDefault;
  const FEET_MARGIN_RF    = autoRigBodyWarp.feetMarginRf;
  let HIP_FRAC = HIP_FRAC_DEFAULT;
  let FEET_FRAC = FEET_FRAC_DEFAULT;
  let bodyFracSource = 'defaults';

  if (bodyAnalysis && bodyAnalysis.anchors && BZ_H > 0) {
    const { hipY, feetY, shoulderY } = bodyAnalysis.anchors;
    const hipRf = (hipY != null) ? (hipY - BZ_MIN_Y) / BZ_H : null;
    const feetRf = (feetY != null) ? (feetY - BZ_MIN_Y) / BZ_H : null;
    const shoulderRf = (shoulderY != null) ? (shoulderY - BZ_MIN_Y) / BZ_H : null;
    if (feetRf != null && feetRf > 0.6 && feetRf <= 1.05) {
      const measuredFeet = Math.max(HIP_FRAC + 0.05, Math.min(1.0, feetRf - FEET_MARGIN_RF));
      FEET_FRAC = Math.min(FEET_FRAC_DEFAULT, measuredFeet);
      bodyFracSource = 'measured-feet';
    }
    if (hipRf != null && hipRf >= 0.35 && hipRf <= 0.65 &&
        feetRf != null && feetRf > hipRf + 0.1) {
      HIP_FRAC = hipRf;
      FEET_FRAC = Math.max(HIP_FRAC + 0.05, FEET_FRAC);
      bodyFracSource = bodyFracSource === 'measured-feet' ? 'measured-both' : 'measured-hip';
    } else if (shoulderRf != null && feetRf != null && shoulderRf < feetRf - 0.15) {
      const midBodyRf = (shoulderRf + feetRf) / 2;
      if (midBodyRf >= 0.4 && midBodyRf <= 0.7) {
        HIP_FRAC = midBodyRf;
        FEET_FRAC = Math.max(HIP_FRAC + 0.05, FEET_FRAC);
        bodyFracSource = bodyFracSource === 'measured-feet'
          ? 'measured-feet-plus-shoulder-feet-midbody'
          : 'shoulder-feet-midbody';
      }
    }
  }

  // ── Per-row spine cf shift (bow peak alignment) ──
  const SPINE_MIN_WIDTH_FRAC = 0.30;
  const robustSpineSamples = (() => {
    const a = bodyAnalysis;
    if (!a || !a.widthProfile || !a.widthStats) return [];
    const minW = a.widthStats.maxCoreWidth * SPINE_MIN_WIDTH_FRAC;
    return a.widthProfile.filter(p => p.coreWidth >= minW && p.spineX != null);
  })();
  const spineCfShift = (r) => {
    if (BZ_W <= 0 || robustSpineSamples.length < 2) return 0;
    const canvasY = BZ_MIN_Y + r * BZ_H / SC;
    const bboxCenterX = BZ_MIN_X + BZ_W / 2;
    const first = robustSpineSamples[0];
    const last = robustSpineSamples[robustSpineSamples.length - 1];
    if (canvasY <= first.y) return 0;
    if (canvasY >= last.y) return (last.spineX - bboxCenterX) / BZ_W;
    for (let i = 0; i < robustSpineSamples.length - 1; i++) {
      const p0 = robustSpineSamples[i];
      const p1 = robustSpineSamples[i + 1];
      if (p0.y <= canvasY && canvasY <= p1.y) {
        const f = (canvasY - p0.y) / (p1.y - p0.y);
        const spineX = p0.spineX * (1 - f) + p1.spineX * f;
        return (spineX - bboxCenterX) / BZ_W;
      }
    }
    return 0;
  };
  const spineCfShifts = new Float64Array(scGH);
  for (let r = 0; r < scGH; r++) spineCfShifts[r] = spineCfShift(r);

  // ── Body movement factor (legs static below feet) ──
  const bodyMoveFactor = (rf) => {
    if (rf <= HIP_FRAC) return 1.0;
    if (rf >= FEET_FRAC) return 0.0;
    const legT = (rf - HIP_FRAC) / (FEET_FRAC - HIP_FRAC);
    return (1 - legT) * 0.3;
  };

  // ── BZ — Body Warp Z (canvas-px) ──
  const bzBaseGrid = new Float64Array(scGridPts * 2);
  for (let r = 0; r < scGH; r++) {
    for (let c = 0; c < scGW; c++) {
      bzBaseGrid[(r * scGW + c) * 2]     = BZ_MIN_X + c * BZ_W / SC;
      bzBaseGrid[(r * scGW + c) * 2 + 1] = BZ_MIN_Y + r * BZ_H / SC;
    }
  }
  const bzKeys = [-10, 0, 10];
  const bzPositions = bzKeys.map(k => {
    const pos = new Float64Array(bzBaseGrid);
    if (k === 0) return pos;
    const sign = k / 10;
    for (let r = 0; r < scGH; r++) {
      for (let c = 0; c < scGW; c++) {
        const idx = (r * scGW + c) * 2;
        const rf = r / (scGH - 1);
        const cf = c / (scGW - 1);
        const distAboveHip = Math.max(0, HIP_FRAC - rf) / HIP_FRAC;
        const legFade = bodyMoveFactor(rf);
        const UPPER_BODY_T_CAP = autoRigBodyWarp.upperBodyTCap;
        const UPPER_BODY_SLOPE = autoRigBodyWarp.upperBodySlope;
        const t = rf <= HIP_FRAC
          ? Math.min(UPPER_BODY_T_CAP, 0.08 + UPPER_BODY_SLOPE * distAboveHip)
          : legFade * 0.25;
        const cfS = cf - spineCfShifts[r];
        const bowFactor = 1.5 * Math.sin(Math.PI * cfS) - 0.5;
        pos[idx] += sign * 0.035 * t * bowFactor * BZ_W;
        const perspCf = sign < 0 ? cf : (1 - cf);
        pos[idx] += sign * (0.015 + 0.01 * perspCf) * t * BZ_W;
        const yShift = -sign * 0.025 * (0.5 - cfS) * t;
        pos[idx + 1] += yShift * BZ_H;
      }
    }
    return pos;
  });

  /** @type {import('./rigSpec.js').WarpDeformerSpec} */
  const bzSpec = {
    id: 'BodyWarpZ',
    name: 'Body Warp Z',
    parent: { type: 'root', id: null },
    gridSize: { rows: SC, cols: SC },
    baseGrid: bzBaseGrid,
    localFrame: 'canvas-px',
    bindings: [{ parameterId: 'ParamBodyAngleZ', keys: bzKeys, interpolation: 'LINEAR' }],
    keyforms: bzKeys.map((k, i) => ({ keyTuple: [k], positions: bzPositions[i], opacity: 1 })),
    isVisible: true, isLocked: false, isQuadTransform: false,
  };

  // ── BY — Body Warp Y (normalised in BZ) ──
  const byBaseGrid = makeUniformGrid(SC, SC, BY_MIN, BY_MAX);
  const byKeys = [-10, 0, 10];
  const byPositions = byKeys.map(k => {
    const pos = new Float64Array(byBaseGrid);
    if (k === 0) return pos;
    const sign = k / 10;
    for (let r = 0; r < scGH; r++) {
      for (let c = 0; c < scGW; c++) {
        const idx = (r * scGW + c) * 2;
        if (c === 0 || c === scGW - 1) continue;
        if (r === 0) continue;
        const cf = c / (scGW - 1);
        const rf = r / (scGH - 1);
        const cfS = cf - spineCfShifts[r];
        const colBell = Math.sin(Math.PI * cfS);
        const rowPeak = Math.sin(Math.PI * rf * 0.7);
        const legFade = bodyMoveFactor(rf);
        const rowFactor = rowPeak * legFade;
        const yMag = sign < 0 ? 0.013 : 0.008;
        pos[idx + 1] += -sign * yMag * colBell * rowFactor;
        pos[idx]     += sign * 0.003 * colBell * rowFactor;
      }
    }
    return pos;
  });

  /** @type {import('./rigSpec.js').WarpDeformerSpec} */
  const bySpec = {
    id: 'BodyWarpY',
    name: 'Body Warp Y',
    parent: { type: 'warp', id: 'BodyWarpZ' },
    gridSize: { rows: SC, cols: SC },
    baseGrid: byBaseGrid,
    localFrame: 'normalized-0to1',
    bindings: [{ parameterId: 'ParamBodyAngleY', keys: byKeys, interpolation: 'LINEAR' }],
    keyforms: byKeys.map((k, i) => ({ keyTuple: [k], positions: byPositions[i], opacity: 1 })),
    isVisible: true, isLocked: false, isQuadTransform: false,
  };

  // ── Breath Warp (normalised in BY) ──
  const brBaseGrid = makeUniformGrid(SC, SC, BR_MIN, BR_MAX);
  const brKeys = [0, 1];
  const brPositions = brKeys.map(k => {
    const pos = new Float64Array(brBaseGrid);
    if (k !== 1) return pos;
    for (let r = 0; r < scGH; r++) {
      for (let c = 0; c < scGW; c++) {
        const idx = (r * scGW + c) * 2;
        if (c === 0 || c === scGW - 1) continue;
        if (r === 0 || r >= scGH - 2) continue;
        let dy = 0;
        if (r === 1) dy = -0.012;
        else if (r === 2) dy = -0.015;
        else if (r === 3) dy = -0.005;
        const cx = (c - scGW / 2 + 0.5) / (scGW / 2);
        const dx = -cx * 0.008;
        pos[idx]     += dx;
        pos[idx + 1] += dy;
      }
    }
    return pos;
  });

  /** @type {import('./rigSpec.js').WarpDeformerSpec} */
  const brSpec = {
    id: 'BreathWarp',
    name: 'Breath',
    parent: { type: 'warp', id: 'BodyWarpY' },
    gridSize: { rows: SC, cols: SC },
    baseGrid: brBaseGrid,
    localFrame: 'normalized-0to1',
    bindings: [{ parameterId: 'ParamBreath', keys: brKeys, interpolation: 'LINEAR' }],
    keyforms: brKeys.map((k, i) => ({ keyTuple: [k], positions: brPositions[i], opacity: 1 })),
    isVisible: true, isLocked: false, isQuadTransform: false,
  };

  const specs = [bzSpec, bySpec, brSpec];

  // ── Body X Warp (normalised in Breath) — gated on ParamBodyAngleX presence ──
  if (hasParamBodyAngleX) {
    const bxCol = SC, bxRow = SC;
    const bxGW = bxCol + 1, bxGH = bxRow + 1;
    const bxBaseGrid = makeUniformGrid(bxCol, bxRow, BX_MIN, BX_MAX);
    const bxKeys = [-10, 0, 10];
    const bxPositions = bxKeys.map(k => {
      const pos = new Float64Array(bxBaseGrid);
      if (k === 0) return pos;
      const sign = k / 10;
      for (let r = 0; r < bxGH; r++) {
        for (let c = 0; c < bxGW; c++) {
          const idx = (r * bxGW + c) * 2;
          const cf = c / (bxGW - 1);
          const rf = r / (bxGH - 1);
          const bxCfFactor = 1 / (BX_MAX - BX_MIN);
          const cfS = cf - spineCfShifts[r] * bxCfFactor;
          const bowFactor = 1.5 * Math.sin(Math.PI * cfS) - 0.5;
          const torsoPeak = Math.sin(Math.PI * rf * 0.7);
          const legFade = bodyMoveFactor(rf);
          const rowAmp = (0.02 + 0.03 * torsoPeak) * legFade;
          pos[idx] += sign * rowAmp * bowFactor;
        }
      }
      return pos;
    });

    /** @type {import('./rigSpec.js').WarpDeformerSpec} */
    const bxSpec = {
      id: 'BodyXWarp',
      name: 'Body X Warp',
      parent: { type: 'warp', id: 'BreathWarp' },
      gridSize: { rows: bxRow, cols: bxCol },
      baseGrid: bxBaseGrid,
      localFrame: 'normalized-0to1',
      bindings: [{ parameterId: 'ParamBodyAngleX', keys: bxKeys, interpolation: 'LINEAR' }],
      keyforms: bxKeys.map((k, i) => ({ keyTuple: [k], positions: bxPositions[i], opacity: 1 })),
      isVisible: true, isLocked: false, isQuadTransform: false,
    };
    specs.push(bxSpec);
  }

  return {
    specs,
    layout: { BZ_MIN_X, BZ_MIN_Y, BZ_W, BZ_H, BY_MIN, BY_MAX, BR_MIN, BR_MAX, BX_MIN, BX_MAX },
    canvasToBodyXX,
    canvasToBodyXY,
    debug: {
      HIP_FRAC, FEET_FRAC, bodyFracSource,
      spineCfShifts: Array.from(spineCfShifts).map(v => +v.toFixed(4)),
    },
  };
}
