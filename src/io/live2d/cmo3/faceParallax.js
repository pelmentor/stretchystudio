/**
 * FaceParallax warp XML emit helper.
 *
 * Stage 4 split this module into:
 *   - `rig/faceParallaxBuilder.js` — `buildFaceParallaxSpec(...)`
 *     produces the WarpDeformerSpec (rest grid + 9 keyforms + bindings).
 *     Pure compute, no XML / PIDs / UUIDs.
 *   - This file — `emitFaceParallax(x, ctx)` consumes a spec (either
 *     `ctx.preComputedSpec` from `project.faceParallax`, or a fresh one
 *     built inline) and emits the cmo3 XML for it.
 *
 * The legacy compute logic was extracted to `faceParallaxBuilder.js` so
 * that:
 *   1. A future "Initialize Face Parallax" action can call the builder
 *      and store the result in `project.faceParallax` (Stage 4
 *      seeder), and
 *   2. Subsequent exports can serialize the stored spec directly into
 *      cmo3 XML, skipping the heuristic.
 *
 * @module io/live2d/cmo3/faceParallax
 */

import { uuid } from '../xmlbuilder.js';
import { emitKfBinding } from './deformerEmit.js';
import { buildFaceParallaxSpec } from '../rig/faceParallaxBuilder.js';

/**
 * Emit the FaceParallax warp. Returns `pidFpGuid` (so face rig warps can
 * reparent to it), or `null` if `pidParamAngleX` / `pidParamAngleY` aren't
 * defined.
 *
 * @param {XmlBuilder} x
 * @param {Object} ctx
 * @param {string} ctx.pidParamAngleX
 * @param {string} ctx.pidParamAngleY
 * @param {string} ctx.pidFaceRotGuid
 * @param {{minX:number, minY:number, maxX:number, maxY:number, W:number, H:number}} ctx.faceUnionBbox
 * @param {number} ctx.facePivotCx
 * @param {number} ctx.facePivotCy
 * @param {{minX:number, minY:number, maxX:number, maxY:number}|null} ctx.faceMeshBbox
 * @param {Array} ctx.meshes
 * @param {Array} ctx.allDeformerSources
 * @param {Object} ctx.rootPart
 * @param {string} ctx.pidPartGuid
 * @param {string} ctx.pidCoord
 * @param {Object|null} ctx.rigDebugLog
 * @param {Object} [ctx.rigCollector]   When present, the resulting WarpDeformerSpec
 *   gets pushed into `rigCollector.warpDeformers` so the moc3 binary
 *   writer can re-emit it without regenerating from mesh state.
 * @param {import('../rig/autoRigConfig.js').AutoRigFaceParallax} [ctx.autoRigFaceParallax]
 *   Tunable defaults from `project.autoRigConfig.faceParallax`. Falls back
 *   to `DEFAULT_AUTO_RIG_CONFIG.faceParallax` when omitted.
 * @param {import('../rig/rigSpec.js').WarpDeformerSpec} [ctx.preComputedSpec]
 *   When provided (e.g. from `resolveFaceParallax(project)`), the heuristic
 *   build is skipped and this spec's `baseGrid` + `keyforms[i].positions`
 *   are emitted directly. Otherwise `buildFaceParallaxSpec(...)` runs to
 *   produce a fresh spec from `meshes` + `faceUnionBbox` + `facePivot*` +
 *   `faceMeshBbox` + `autoRigFaceParallax`.
 * @returns {string|null} pidFpGuid
 */
export function emitFaceParallax(x, ctx) {
  const {
    pidParamAngleX, pidParamAngleY,
    pidFaceRotGuid,
    faceUnionBbox, facePivotCx, facePivotCy, faceMeshBbox,
    meshes,
    allDeformerSources, rootPart,
    pidPartGuid, pidCoord,
    rigDebugLog,
    autoRigFaceParallax,
    preComputedSpec,
  } = ctx;

  if (!(pidParamAngleX && pidParamAngleY)) return null;

  // ── Build (or reuse) the spec ──
  // When `preComputedSpec` is provided (project.faceParallax populated),
  // use its baseGrid + keyform positions verbatim — Stage 4 serialization
  // path. Otherwise run the builder against current mesh/bbox state.
  let spec, debug;
  if (preComputedSpec) {
    spec = preComputedSpec;
    debug = { algorithm: 'served-from-project.faceParallax (Stage 4)' };
  } else {
    const built = buildFaceParallaxSpec({
      meshes, faceUnionBbox, facePivotCx, facePivotCy, faceMeshBbox,
      autoRigFaceParallax,
    });
    spec = built.spec;
    debug = built.debug;
  }
  if (rigDebugLog) rigDebugLog.faceParallax = debug;

  // Re-derive the keyform layout constants from the spec for the XML
  // emission below. These match what `buildFaceParallaxSpec` produces;
  // hardcoded grid size matches Hiyori convention.
  const fpRow = spec.gridSize.rows;
  const fpCol = spec.gridSize.cols;
  const fpGW = fpCol + 1, fpGH = fpRow + 1;
  const fpGridPts = fpGW * fpGH;
  const fpRestLocal = spec.baseGrid;
  const fpAngleKeys = spec.bindings[0].keys.slice(); // both bindings share the same key set
  // fpKeyCombos: [angleX, angleY] storage order (X outer, Y inner).
  // Spec stores keyTuple as [ay, ax] (binding order). Reverse to legacy
  // shape for the XML emission below which expects [ax, ay].
  const fpKeyCombos = spec.keyforms.map(k => [k.keyTuple[1], k.keyTuple[0]]);
  const fpGridPositions = spec.keyforms.map(k => k.positions);

  // ────────────────────────────────────────────────────────────────────
  // Below: PIDs + XML emission, consuming spec.baseGrid (= fpRestLocal)
  // and spec.keyforms[i].positions (= fpGridPositions[i]).
  // ────────────────────────────────────────────────────────────────────

  // Allocate one CFormGuid per keyform — these are the references the
  // KeyformGridSource binds to.
  const fpFormGuids = [];
  for (const [ax, ay] of fpKeyCombos) {
    const [, pidForm] = x.shared('CFormGuid', {
      uuid: uuid(), note: `FaceParallax_ax${ax}_ay${ay}`,
    });
    fpFormGuids.push(pidForm);
  }

  // Mirror the face parallax data into rigCollector for the moc3 binary
  // translator (whether the spec came from project state or a fresh
  // build, it goes into rigSpec the same way).
  if (ctx.rigCollector) {
    ctx.rigCollector.warpDeformers.push(spec);
  }


  // Emit the single FaceParallax deformer (CWarpDeformerSource) targeting Body X.
  const [, pidFpGuid] = x.shared('CDeformerGuid', {
    uuid: uuid(), note: 'FaceParallax',
  });

  // KeyformBindings — AngleY first, AngleX second (Hiyori convention).
  const [fpKfbY, pidFpKfbY] = x.shared('KeyformBindingSource');
  const [fpKfbX, pidFpKfbX] = x.shared('KeyformBindingSource');
  const [fpKfg, pidFpKfg]   = x.shared('KeyformGridSource');
  const fpKfogList = x.sub(fpKfg, 'array_list', {
    'xs.n': 'keyformsOnGrid', count: String(fpKeyCombos.length),
  });
  for (let ki = 0; ki < fpKeyCombos.length; ki++) {
    const ax = fpKeyCombos[ki][0], ay = fpKeyCombos[ki][1];
    const xi = fpAngleKeys.indexOf(ax);
    const yi = fpAngleKeys.indexOf(ay);
    const kog = x.sub(fpKfogList, 'KeyformOnGrid');
    const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '2' });
    const konY = x.sub(kop, 'KeyOnParameter');
    x.subRef(konY, 'KeyformBindingSource', pidFpKfbY, { 'xs.n': 'binding' });
    x.sub(konY, 'i', { 'xs.n': 'keyIndex' }).text = String(yi);
    const konX = x.sub(kop, 'KeyOnParameter');
    x.subRef(konX, 'KeyformBindingSource', pidFpKfbX, { 'xs.n': 'binding' });
    x.sub(konX, 'i', { 'xs.n': 'keyIndex' }).text = String(xi);
    x.subRef(kog, 'CFormGuid', fpFormGuids[ki], { 'xs.n': 'keyformGuid' });
  }
  const fpKfbList = x.sub(fpKfg, 'array_list', { 'xs.n': 'keyformBindings', count: '2' });
  x.subRef(fpKfbList, 'KeyformBindingSource', pidFpKfbY);
  x.subRef(fpKfbList, 'KeyformBindingSource', pidFpKfbX);
  emitKfBinding(x, fpKfbY, pidFpKfg, pidParamAngleY,
    fpAngleKeys.map(k => k + '.0'), 'ParamAngleY');
  emitKfBinding(x, fpKfbX, pidFpKfg, pidParamAngleX,
    fpAngleKeys.map(k => k + '.0'), 'ParamAngleX');

  // Emit the CWarpDeformerSource
  const [fpDf, pidFpDf] = x.shared('CWarpDeformerSource');
  allDeformerSources.push({ pid: pidFpDf, tag: 'CWarpDeformerSource' });
  const fpAcdfs = x.sub(fpDf, 'ACDeformerSource', { 'xs.n': 'super' });
  const fpAcpcs = x.sub(fpAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
  x.sub(fpAcpcs, 's', { 'xs.n': 'localName' }).text = 'FaceParallax';
  x.sub(fpAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(fpAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
  x.subRef(fpAcpcs, 'CPartGuid', pidPartGuid, { 'xs.n': 'parentGuid' });
  x.subRef(fpAcpcs, 'KeyformGridSource', pidFpKfg, { 'xs.n': 'keyformGridSource' });
  const fpMft = x.sub(fpAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
  x.sub(fpMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
  const fpBwc = x.sub(fpMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
  x.sub(fpBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
  x.sub(fpAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
  x.sub(fpAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
  x.sub(fpAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
  x.subRef(fpAcdfs, 'CDeformerGuid', pidFpGuid, { 'xs.n': 'guid' });
  x.sub(fpAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: 'FaceParallax' });
  // FaceParallax targets Face Rotation → Body X.  Coord scales:
  //   - Face Rotation pivot:  in Body X 0..1  (its parent is a warp)
  //   - FaceParallax grid:    in canvas-pixel OFFSETS from Face Rotation's pivot
  //                           (its parent is a rotation deformer — see WARP_DEFORMERS.md
  //                           "Rotation Deformer Local Frame" for the evidence).
  // At rest (ParamAngleZ=0) Face Rotation is identity, so the chain is transparent.
  // At ±30 (mapped to ±10° rotation) Face Rotation rotates FaceParallax's grid
  // around the face pivot, producing head tilt for all face rig warp descendants.
  x.subRef(fpAcdfs, 'CDeformerGuid', pidFaceRotGuid, { 'xs.n': 'targetDeformerGuid' });
  x.sub(fpDf, 'i', { 'xs.n': 'col' }).text = String(fpCol);
  x.sub(fpDf, 'i', { 'xs.n': 'row' }).text = String(fpRow);
  x.sub(fpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';
  const fpKfsList = x.sub(fpDf, 'carray_list', {
    'xs.n': 'keyforms', count: String(fpKeyCombos.length),
  });
  for (let ki = 0; ki < fpKeyCombos.length; ki++) {
    const wdf = x.sub(fpKfsList, 'CWarpDeformerForm');
    const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
    const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
    x.subRef(wdfAcf, 'CFormGuid', fpFormGuids[ki], { 'xs.n': 'guid' });
    x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
    x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
    x.subRef(wdfAcf, 'CWarpDeformerSource', pidFpDf, { 'xs.n': '_source' });
    x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
    x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
    x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
    x.sub(wdfAdf, 'CFloatColor', {
      'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
    });
    x.sub(wdfAdf, 'CFloatColor', {
      'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
    });
    x.subRef(wdfAdf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
    x.sub(wdf, 'float-array', {
      'xs.n': 'positions', count: String(fpGridPts * 2),
    }).text = Array.from(fpGridPositions[ki]).map(v => v.toFixed(6)).join(' ');
  }
  rootPart.childGuidsNode.children.push(x.ref('CDeformerGuid', pidFpGuid));
  rootPart.childGuidsNode.attrs.count = String(rootPart.childGuidsNode.children.length);

  return pidFpGuid;
}
