/**
 * Face parallax spec builder — Stage 4 of the native rig refactor.
 *
 * Extracted from `cmo3/faceParallax.js` `emitFaceParallax`. This module
 * contains the **pure compute** half of the FaceParallax pipeline —
 * everything from rest-grid construction through 3D rotation math,
 * protected-region build (A.3 pairing, A.6b expansion), per-keyform
 * computation, and ax=0 horizontal symmetrisation.
 *
 * Inputs are pre-derived by the caller (face union bbox, face mesh bbox,
 * face pivot, mesh list with vertices+tags, autoRigConfig.faceParallax).
 *
 * Output is a `WarpDeformerSpec` ready to push into a rigSpec collector
 * **and** ready to serialize to disk via `faceParallaxStore.js`. There
 * are no PIDs, UUIDs, or XML in the output — those are generated at
 * emit time.
 *
 * Stage 4 architectural anchor: by separating compute from emit, the
 * project can store the spec on disk and replay it on subsequent
 * exports without re-running the heuristic. See
 * `docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md` → Stage 4.
 *
 * @module io/live2d/rig/faceParallaxBuilder
 */

import { DEFAULT_AUTO_RIG_CONFIG } from './autoRigConfig.js';

/**
 * @typedef {Object} FaceParallaxBuildInput
 * @property {Array<{tag?:string, vertices?:number[]|Float32Array}>} meshes
 *   All visible meshes. The builder filters by tag for protected-region
 *   construction (eye super-groups + per-mesh entries from
 *   `autoRigFaceParallax.protectionPerTag`).
 * @property {{minX:number, minY:number, maxX:number, maxY:number, W:number, H:number}} faceUnionBbox
 *   Padded canvas bbox of all face-parallax-tagged meshes.
 * @property {number} facePivotCx
 * @property {number} facePivotCy
 * @property {{minX:number, minY:number, maxX:number, maxY:number}|null} faceMeshBbox
 *   Bbox of just the `face` tag mesh; used for symmetric half-width
 *   normalization.
 * @property {import('./autoRigConfig.js').AutoRigFaceParallax} [autoRigFaceParallax]
 *   Tunables; falls back to `DEFAULT_AUTO_RIG_CONFIG.faceParallax`.
 */

/**
 * @typedef {Object} FaceParallaxBuildResult
 * @property {import('./rigSpec.js').WarpDeformerSpec} spec
 *   The full FaceParallax warp deformer spec — id 'FaceParallaxWarp',
 *   parent rotation 'FaceRotation', 6×6 grid, 9 keyforms on AngleY×AngleX.
 * @property {Object} debug
 *   Diagnostic data captured for `rigDebugLog.faceParallax`. Includes
 *   the depth model constants, fpRadius, faceMeshCenter, computed
 *   peakShifts, and a flattened protectedRegions[] summary.
 */

/**
 * Build the FaceParallax warp deformer spec from project state. Pure —
 * no XML, no PIDs, no UUIDs. The output spec is suitable for either
 *   1. Direct consumption by the cmo3 emit phase (replaces today's
 *      inline compute), or
 *   2. Serialization into `project.faceParallax` for later playback.
 *
 * @param {FaceParallaxBuildInput} input
 * @returns {FaceParallaxBuildResult}
 */
export function buildFaceParallaxSpec(input) {
  const {
    meshes, faceUnionBbox, facePivotCx, facePivotCy, faceMeshBbox,
    autoRigFaceParallax = DEFAULT_AUTO_RIG_CONFIG.faceParallax,
  } = input;

  // ── Grid / keyform layout (matches Hiyori convention) ──
  const fpCol = 5, fpRow = 5; // 6×6 control points
  const fpGW = fpCol + 1, fpGH = fpRow + 1;
  const fpGridPts = fpGW * fpGH;
  // Hiyori keyform order: AngleY varies fastest (inner), AngleX outer.
  // Storage order matches that of `fpKeyCombos` below.
  const fpAngleKeys = [-30, 0, 30];
  const fpKeyCombos = [];
  for (let xi = 0; xi < 3; xi++) {
    for (let yi = 0; yi < 3; yi++) {
      fpKeyCombos.push([fpAngleKeys[xi], fpAngleKeys[yi]]);
    }
  }

  // ── Rest grid in canvas-pixel offsets from face rotation pivot ──
  // `CoordType DeformerLocal` for a rotation-deformer parent means
  // canvas-pixel offsets from the parent's own pivot.
  const fpRestLocal = new Float64Array(fpGridPts * 2);
  for (let r = 0; r < fpGH; r++) {
    for (let c = 0; c < fpGW; c++) {
      const idx = (r * fpGW + c) * 2;
      fpRestLocal[idx]     = (faceUnionBbox.minX + c * faceUnionBbox.W / fpCol) - facePivotCx;
      fpRestLocal[idx + 1] = (faceUnionBbox.minY + r * faceUnionBbox.H / fpRow) - facePivotCy;
    }
  }
  const fpSpanX_bx = faceUnionBbox.W;
  const fpSpanY_bx = faceUnionBbox.H;

  // ── Depth-weighted ellipsoidal face parallax (P8 Apr 2026) ──
  // Phase A.1: force-symmetric face bbox so mirror grid points see
  // identical geometry under pure pitch.
  const faceMeshCxLocal = faceMeshBbox
    ? (faceMeshBbox.minX + faceMeshBbox.maxX) / 2
    : facePivotCx;
  const faceMeshCyLocal = faceMeshBbox
    ? (faceMeshBbox.minY + faceMeshBbox.maxY) / 2
    : (faceUnionBbox.minY + faceUnionBbox.maxY) / 2;
  let fpRadiusX, fpRadiusY;
  if (faceMeshBbox) {
    const halfLeft  = faceMeshCxLocal - faceMeshBbox.minX;
    const halfRight = faceMeshBbox.maxX - faceMeshCxLocal;
    fpRadiusX = Math.max(halfLeft, halfRight);
    fpRadiusY = (faceMeshBbox.maxY - faceMeshBbox.minY) / 2;
  } else {
    fpRadiusX = fpSpanX_bx / 2;
    fpRadiusY = fpSpanY_bx / 2;
  }

  const FP_DEPTH_K               = autoRigFaceParallax.depthK;
  const FP_EDGE_DEPTH_K          = autoRigFaceParallax.edgeDepthK;
  const FP_MAX_ANGLE_X_DEG       = autoRigFaceParallax.maxAngleXDeg;
  const FP_MAX_ANGLE_Y_DEG       = autoRigFaceParallax.maxAngleYDeg;
  const FP_DEPTH_AMP             = autoRigFaceParallax.depthAmp;
  const FP_PROTECTION_STRENGTH   = autoRigFaceParallax.protectionStrength;
  const PROTECTION_PER_TAG       = autoRigFaceParallax.protectionPerTag;
  const FP_PROTECTION_FALLOFF_BUFFER = autoRigFaceParallax.protectionFalloffBuffer;
  const SUPER_GROUPS             = autoRigFaceParallax.superGroups;
  const EYE_PARALLAX_AMP_X       = autoRigFaceParallax.eyeParallaxAmpX;
  const FAR_EYE_SQUASH_AMP       = autoRigFaceParallax.farEyeSquashAmp;

  const fpZAt = (_canvasGx, _canvasGy, u) => {
    const uu = u * u;
    const dome = uu < 1 ? Math.sqrt(1 - uu) : 0;
    return FP_EDGE_DEPTH_K + (FP_DEPTH_K - FP_EDGE_DEPTH_K) * dome;
  };

  // ── Protected-region build (super-groups + per-mesh) ──
  const meshByTag = new Map();
  for (const m of meshes) {
    if (m.tag) meshByTag.set(m.tag, m);
  }
  const meshesInSuperGroups = new Set();
  for (const tags of Object.values(SUPER_GROUPS)) {
    for (const t of tags) {
      if (meshByTag.has(t)) meshesInSuperGroups.add(t);
    }
  }

  const unionVertexBbox = (meshList) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;
    for (const mm of meshList) {
      const vv = mm.vertices;
      if (!vv || vv.length < 2) continue;
      for (let i = 0; i < vv.length; i += 2) {
        if (vv[i]     < minX) minX = vv[i];
        if (vv[i]     > maxX) maxX = vv[i];
        if (vv[i + 1] < minY) minY = vv[i + 1];
        if (vv[i + 1] > maxY) maxY = vv[i + 1];
      }
      count++;
    }
    if (count === 0 || maxX <= minX || maxY <= minY) return null;
    return { minX, minY, maxX, maxY };
  };

  const protectedRegions = [];
  for (const [groupTag, memberTags] of Object.entries(SUPER_GROUPS)) {
    const memberMeshes = memberTags.map(t => meshByTag.get(t)).filter(Boolean);
    if (!memberMeshes.length) continue;
    const bbox = unionVertexBbox(memberMeshes);
    if (!bbox) continue;
    const rcx = (bbox.minX + bbox.maxX) / 2;
    const rcy = (bbox.minY + bbox.maxY) / 2;
    const ru = fpRadiusX > 0 ? (rcx - faceMeshCxLocal) / fpRadiusX : 0;
    const rv = fpRadiusY > 0 ? (rcy - faceMeshCyLocal) / fpRadiusY : 0;
    const rz = fpZAt(rcx, rcy, ru);
    const halfU = fpRadiusX > 0 ? (bbox.maxX - bbox.minX) / (2 * fpRadiusX) : 0.05;
    const halfV = fpRadiusY > 0 ? (bbox.maxY - bbox.minY) / (2 * fpRadiusY) : 0.05;
    protectedRegions.push({
      tag: groupTag,
      protection: 1.00 * FP_PROTECTION_STRENGTH,
      u: ru, v: rv, z: rz,
      halfU, halfV,
      falloffU: halfU + FP_PROTECTION_FALLOFF_BUFFER,
      falloffV: halfV + FP_PROTECTION_FALLOFF_BUFFER,
    });
  }
  for (const m of meshes) {
    if (meshesInSuperGroups.has(m.tag)) continue;
    const basePro = PROTECTION_PER_TAG[m.tag];
    if (basePro == null) continue;
    const v = m.vertices;
    if (!v || v.length < 2) continue;
    let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
    for (let i = 0; i < v.length; i += 2) {
      if (v[i]     < rMinX) rMinX = v[i];
      if (v[i]     > rMaxX) rMaxX = v[i];
      if (v[i + 1] < rMinY) rMinY = v[i + 1];
      if (v[i + 1] > rMaxY) rMaxY = v[i + 1];
    }
    if (rMaxX <= rMinX || rMaxY <= rMinY) continue;
    const rcx = (rMinX + rMaxX) / 2;
    const rcy = (rMinY + rMaxY) / 2;
    const ru = fpRadiusX > 0 ? (rcx - faceMeshCxLocal) / fpRadiusX : 0;
    const rv = fpRadiusY > 0 ? (rcy - faceMeshCyLocal) / fpRadiusY : 0;
    const rz = fpZAt(rcx, rcy, ru);
    const halfU = fpRadiusX > 0 ? (rMaxX - rMinX) / (2 * fpRadiusX) : 0.05;
    const halfV = fpRadiusY > 0 ? (rMaxY - rMinY) / (2 * fpRadiusY) : 0.05;
    protectedRegions.push({
      tag: m.tag,
      protection: basePro * FP_PROTECTION_STRENGTH,
      u: ru, v: rv, z: rz,
      halfU, halfV,
      falloffU: halfU + FP_PROTECTION_FALLOFF_BUFFER,
      falloffV: halfV + FP_PROTECTION_FALLOFF_BUFFER,
    });
  }

  // ── Phase A.3: pair L/R protected regions as exact mirrors ──
  {
    const pairKeyFor = (tag) => {
      if (tag.endsWith('-l')) return tag.slice(0, -2);
      if (tag.endsWith('-r')) return tag.slice(0, -2);
      return null;
    };
    const pairs = new Map();
    for (let i = 0; i < protectedRegions.length; i++) {
      const r = protectedRegions[i];
      const base = pairKeyFor(r.tag);
      if (!base) continue;
      const slot = r.tag.endsWith('-l') ? 'L' : 'R';
      if (!pairs.has(base)) pairs.set(base, {});
      pairs.get(base)[slot] = i;
    }
    for (const [, slots] of pairs) {
      if (slots.L == null || slots.R == null) continue;
      const rL = protectedRegions[slots.L];
      const rR = protectedRegions[slots.R];
      const uAbs = (Math.abs(rL.u) + Math.abs(rR.u)) / 2;
      rL.u = rL.u < 0 ? -uAbs : uAbs;
      rR.u = rR.u < 0 ? -uAbs : uAbs;
      const vAvg      = (rL.v + rR.v) / 2;
      const zAvg      = (rL.z + rR.z) / 2;
      const halfUAvg  = (rL.halfU + rR.halfU) / 2;
      const halfVAvg  = (rL.halfV + rR.halfV) / 2;
      const falloffUAvg = halfUAvg + FP_PROTECTION_FALLOFF_BUFFER;
      const falloffVAvg = halfVAvg + FP_PROTECTION_FALLOFF_BUFFER;
      rL.v = vAvg; rR.v = vAvg;
      rL.z = zAvg; rR.z = zAvg;
      rL.halfU = halfUAvg; rR.halfU = halfUAvg;
      rL.halfV = halfVAvg; rR.halfV = halfVAvg;
      rL.falloffU = falloffUAvg; rR.falloffU = falloffUAvg;
      rL.falloffV = falloffVAvg; rR.falloffV = falloffVAvg;
    }
  }

  // ── Phase A.6: grid-sized rigid-zone expansion ──
  {
    const cellU = fpRadiusX > 0 ? (faceUnionBbox.W / fpCol) / fpRadiusX : 0;
    const cellV = fpRadiusY > 0 ? (faceUnionBbox.H / fpRow) / fpRadiusY : 0;
    for (const r of protectedRegions) {
      r.meshHalfU = r.halfU;
      r.meshHalfV = r.halfV;
      r.halfU += cellU;
      r.halfV += cellV;
      r.falloffU = r.halfU + FP_PROTECTION_FALLOFF_BUFFER;
      r.falloffV = r.halfV + FP_PROTECTION_FALLOFF_BUFFER;
    }
  }

  // ── Per-grid (u, v, z) precompute ──
  const fpUVZ = new Float64Array(fpGridPts * 3);
  for (let r = 0; r < fpGH; r++) {
    for (let c = 0; c < fpGW; c++) {
      const gi = r * fpGW + c;
      const canvasGx = faceUnionBbox.minX + c * faceUnionBbox.W / fpCol;
      const canvasGy = faceUnionBbox.minY + r * faceUnionBbox.H / fpRow;
      const u = fpRadiusX > 0 ? (canvasGx - faceMeshCxLocal) / fpRadiusX : 0;
      const v = fpRadiusY > 0 ? (canvasGy - faceMeshCyLocal) / fpRadiusY : 0;
      const z = fpZAt(canvasGx, canvasGy, u);
      fpUVZ[gi * 3]     = u;
      fpUVZ[gi * 3 + 1] = v;
      fpUVZ[gi * 3 + 2] = z;
    }
  }

  // ── Per-keyform compute (3D rotation + protection blend +
  //     eye amp + far-eye squash) ──
  const computeFpKeyform = (ax, ay) => {
    const thetaX = (ax / 30) * FP_MAX_ANGLE_X_DEG * Math.PI / 180;
    const thetaY = (ay / 30) * FP_MAX_ANGLE_Y_DEG * Math.PI / 180;
    const cosX = Math.cos(thetaX), sinX = Math.sin(thetaX);
    const cosY = Math.cos(thetaY), sinY = Math.sin(thetaY);
    const pos = new Float64Array(fpRestLocal);
    if (ax === 0 && ay === 0) return pos;
    const regionShifts = protectedRegions.map(r => {
      const rUy = r.u * cosX + r.z * sinX;
      const rZy = -r.u * sinX + r.z * cosX;
      const rVp = r.v * cosY - rZy * sinY;
      return { shiftU: rUy - r.u, shiftV: rVp - r.v };
    });
    for (let ri = 0; ri < protectedRegions.length; ri++) {
      const t = protectedRegions[ri].tag;
      if (t === 'eye-l' || t === 'eye-r') {
        regionShifts[ri].shiftU *= EYE_PARALLAX_AMP_X;
      }
    }
    for (let gi = 0; gi < fpGridPts; gi++) {
      const u = fpUVZ[gi * 3];
      const v = fpUVZ[gi * 3 + 1];
      const z = fpUVZ[gi * 3 + 2];
      const uY = u * cosX + z * sinX;
      const zY = -u * sinX + z * cosX;
      const vP = v * cosY - zY * sinY;
      const natShiftU = uY - u;
      const natShiftV = vP - v;
      let totalWeight = 0;
      let rigidShiftU = 0;
      let rigidShiftV = 0;
      for (let ri = 0; ri < protectedRegions.length; ri++) {
        const r = protectedRegions[ri];
        const duInner = (u - r.u) / r.halfU;
        const dvInner = (v - r.v) / r.halfV;
        let proximity;
        if (Math.abs(duInner) <= 1 && Math.abs(dvInner) <= 1) {
          proximity = 1;
        } else {
          const duOuter = (u - r.u) / r.falloffU;
          const dvOuter = (v - r.v) / r.falloffV;
          const distSqOuter = duOuter * duOuter + dvOuter * dvOuter;
          if (distSqOuter >= 1) continue;
          proximity = Math.max(0, 1 - distSqOuter);
        }
        const w = r.protection * proximity;
        totalWeight += w;
        rigidShiftU += w * regionShifts[ri].shiftU;
        rigidShiftV += w * regionShifts[ri].shiftV;
      }
      const effP = Math.min(1, totalWeight);
      let finalShiftU, finalShiftV;
      if (totalWeight > 0) {
        finalShiftU = natShiftU * (1 - effP) + (rigidShiftU / totalWeight) * effP;
        finalShiftV = natShiftV * (1 - effP) + (rigidShiftV / totalWeight) * effP;
      } else {
        finalShiftU = natShiftU;
        finalShiftV = natShiftV;
      }
      pos[gi * 2]     += finalShiftU * fpRadiusX;
      pos[gi * 2 + 1] += finalShiftV * fpRadiusY;
    }
    if (Math.abs(sinX) > 1e-6) {
      for (let ri = 0; ri < protectedRegions.length; ri++) {
        const r = protectedRegions[ri];
        if (r.tag !== 'eye-l' && r.tag !== 'eye-r') continue;
        if ((r.u * sinX) >= 0) continue;
        const squash = Math.abs(sinX) * FAR_EYE_SQUASH_AMP;
        const signU = r.u > 0 ? 1 : -1;
        for (let row = 0; row < fpGH; row++) {
          for (let c = 0; c < fpGW; c++) {
            const gi = row * fpGW + c;
            const u = fpUVZ[gi * 3];
            const v = fpUVZ[gi * 3 + 1];
            const duFromEye = u - r.u;
            const dvFromEye = v - r.v;
            if (duFromEye * r.u <= 0) continue;
            if (Math.abs(duFromEye) > r.meshHalfU) continue;
            if (Math.abs(dvFromEye) > r.meshHalfV) continue;
            const uStr = Math.abs(duFromEye) / r.meshHalfU;
            const vStr = 1 - Math.abs(dvFromEye) / r.meshHalfV;
            pos[gi * 2] += -signU * squash * uStr * vStr * fpRadiusX;
          }
        }
      }
    }
    return pos;
  };

  // ── ax=0 horizontal symmetrisation ──
  // Eliminates depth-field asymmetry noise that shows as "one eye sinks
  // while the other rises" under pure pitch.
  const symmetrizeKeyform = (pos) => {
    for (let r = 0; r < fpGH; r++) {
      const halfCols = Math.floor(fpGW / 2);
      for (let c = 0; c < halfCols; c++) {
        const mc = fpGW - 1 - c;
        const giL = r * fpGW + c;
        const giR = r * fpGW + mc;
        const restXL = fpRestLocal[giL * 2];
        const restXR = fpRestLocal[giR * 2];
        const restY  = fpRestLocal[giL * 2 + 1];
        const sxL = pos[giL * 2]     - restXL;
        const syL = pos[giL * 2 + 1] - restY;
        const sxR = pos[giR * 2]     - restXR;
        const syR = pos[giR * 2 + 1] - restY;
        const avgAsymSx = (sxL - sxR) / 2;
        const avgSymSy  = (syL + syR) / 2;
        pos[giL * 2]     = restXL + avgAsymSx;
        pos[giL * 2 + 1] = restY  + avgSymSy;
        pos[giR * 2]     = restXR - avgAsymSx;
        pos[giR * 2 + 1] = restY  + avgSymSy;
      }
    }
    return pos;
  };

  const fpGridPositions = [];
  for (const [ax, ay] of fpKeyCombos) {
    let pos = computeFpKeyform(ax, ay);
    if (ax === 0) pos = symmetrizeKeyform(pos);
    fpGridPositions.push(pos);
  }

  /** @type {import('./rigSpec.js').WarpDeformerSpec} */
  const spec = {
    id: 'FaceParallaxWarp',
    name: 'Face Parallax',
    parent: { type: 'rotation', id: 'FaceRotation' },
    gridSize: { rows: fpRow, cols: fpCol },
    baseGrid: new Float64Array(fpRestLocal),
    localFrame: 'pivot-relative',
    bindings: [
      { parameterId: 'ParamAngleY', keys: fpAngleKeys.slice(), interpolation: 'LINEAR' },
      { parameterId: 'ParamAngleX', keys: fpAngleKeys.slice(), interpolation: 'LINEAR' },
    ],
    keyforms: fpKeyCombos.map(([ax, ay], i) => ({
      keyTuple: [ay, ax],
      positions: new Float64Array(fpGridPositions[i]),
      opacity: 1,
    })),
    isVisible: true,
    isLocked: false,
    isQuadTransform: false,
  };

  // Debug payload for rigDebugLog.faceParallax — same shape as before
  // refactor so existing log consumers don't need updating.
  const peakThetaX = FP_MAX_ANGLE_X_DEG * Math.PI / 180;
  const peakThetaY = FP_MAX_ANGLE_Y_DEG * Math.PI / 180;
  const peakX = FP_DEPTH_K * Math.sin(peakThetaX) * fpRadiusX;
  const peakY = FP_DEPTH_K * Math.sin(peakThetaY) * fpRadiusY;
  const debug = {
    algorithm: 'depth-weighted-cylindrical + protected-regions',
    depthAmpScalar: FP_DEPTH_AMP,
    gridCols: fpGW, gridRows: fpGH,
    spanX_canvasPx: fpSpanX_bx, spanY_canvasPx: fpSpanY_bx,
    faceMeshCenter: { cx: faceMeshCxLocal, cy: faceMeshCyLocal },
    fpRadius: { x: fpRadiusX, y: fpRadiusY },
    constants: {
      FP_DEPTH_K, FP_EDGE_DEPTH_K,
      FP_MAX_ANGLE_X_DEG, FP_MAX_ANGLE_Y_DEG,
      FP_PROTECTION_STRENGTH, FP_PROTECTION_FALLOFF_BUFFER,
    },
    peakShifts_canvasPx: {
      angleX_plus30_center: peakX,
      angleY_plus30_center: peakY,
    },
    protectedRegions: protectedRegions.map(r => ({
      tag: r.tag,
      protection: r.protection,
      centerUVZ: { u: r.u, v: r.v, z: r.z },
      falloff: { u: r.falloffU, v: r.falloffV },
    })),
    note: 'Grid point Z from ellipsoidal falloff + per-region protection blend. Protected regions (eyes, brows, mouth, nose) rigidly translate via their center-shift; skin/hair/ears get full depth parallax. FaceParallax grid in canvas-px offsets from facePivot.',
  };

  return { spec, debug };
}
