/**
 * Body-rig deformer emit helpers.
 *
 * Extracts two self-contained deformer-emission blocks out of
 * `generateCmo3`: the Neck Warp (bends the neck area in sync with head
 * tilt) and the Face Rotation rotation-deformer (ParamAngleZ pivot-at-chin
 * rotation that parents the FaceParallax warp).
 *
 * Both helpers write into the caller's shared XmlBuilder / collections
 * via a `ctx` bag — no state is captured across calls.
 *
 * @module io/live2d/cmo3/bodyRig
 */

import { uuid } from '../xmlbuilder.js';
import { emitSingleParamKfGrid, emitStructuralWarp } from './deformerEmit.js';
import { buildNeckWarpSpec } from '../rig/warpDeformers.js';
import { buildFaceRotationSpec } from '../rig/rotationDeformers.js';

/**
 * Emit the Neck Warp (CWarpDeformerSource, 6×6 grid, 3 keyforms on
 * ParamAngleZ). Bottom row pins at shoulders, top row shifts to follow the
 * head-tilt parameter. Chain: Body X → NeckWarp → neck rig warps.
 *
 * Returns `pidNeckWarpGuid` (to be used as a reparenting target for per-part
 * neck rig warps), or `null` if preconditions fail.
 *
 * @param {XmlBuilder} x
 * @param {Object} ctx
 * @param {string} ctx.pidParamAngleZ
 * @param {Object|null} ctx.neckUnionBbox - { minX, minY, W, H }
 * @param {string} ctx.pidBodyXGuid
 * @param {string|null} ctx.neckGroupId
 * @param {Map} ctx.groupDeformerGuids
 * @param {Map} ctx.deformerWorldOrigins
 * @param {(cx:number)=>number} ctx.canvasToBodyXX
 * @param {(cy:number)=>number} ctx.canvasToBodyXY
 * @param {string} ctx.pidCoord
 * @param {Object|null} ctx.rigDebugLog
 * @param {Object} ctx.emitCtx - shared ctx for emitStructuralWarp
 *   ({ allDeformerSources, pidPartGuid, rootPart })
 * @returns {string|null} pidNeckWarpGuid
 */
export function emitNeckWarp(x, ctx) {
  const {
    pidParamAngleZ, neckUnionBbox, pidBodyXGuid,
    neckGroupId, groupDeformerGuids, deformerWorldOrigins,
    canvasToBodyXX, canvasToBodyXY,
    pidCoord, rigDebugLog, emitCtx,
  } = ctx;

  if (!(pidParamAngleZ && neckUnionBbox && pidBodyXGuid)) return null;

  // ── Structural chain integration ──
  // When the neck group has its own rotation deformer (pre-emitted in the
  // group-rotation pass), the warp parents to it and works in pivot-relative
  // pixels. Otherwise it parents to the Body X Warp in normalised 0..1 space.
  const neckGroupRotPid = neckGroupId && groupDeformerGuids.get(neckGroupId);
  const neckGroupPivot = neckGroupId && deformerWorldOrigins.get(neckGroupId);

  // Build the data spec via the shared rig builder. moc3writer will consume
  // the same builder once the binary translator lands.
  const { spec, debug } = buildNeckWarpSpec({
    neckUnionBbox,
    parentType: neckGroupRotPid ? 'rotation' : 'warp',
    // The id is unused on the cmo3 side (we use the XML pid). Pass a stable
    // string so the spec is internally consistent for future moc3 lookup.
    parentDeformerId: neckGroupRotPid ? `GroupRotation_${neckGroupId}` : 'BodyXWarp',
    parentPivotCanvas: neckGroupRotPid ? neckGroupPivot : null,
    canvasToBodyXX, canvasToBodyXY,
  });

  if (rigDebugLog) rigDebugLog.neckWarp = debug;

  // ── XML emission from the spec ──
  const [, pidNwGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'NeckWarp' });
  const angleZBinding = spec.bindings[0];
  const { pidKfg: pidNwKfg, formGuids: nwFormGuids } = emitSingleParamKfGrid(
    x, pidParamAngleZ, angleZBinding.keys, 'ParamAngleZ_Neck',
  );
  const gridPositions = spec.keyforms.map(kf => kf.positions);
  const nwTarget = neckGroupRotPid || pidBodyXGuid;
  emitStructuralWarp(
    x, emitCtx,
    spec.name, spec.id, spec.gridSize.cols, spec.gridSize.rows,
    pidNwGuid, nwTarget, pidNwKfg, pidCoord, nwFormGuids, gridPositions,
  );

  return pidNwGuid;
}

/**
 * Emit the Face Rotation CRotationDeformerSource (3 keyforms on ParamAngleZ,
 * pivot at chin, -10°..+10°).
 *
 * Returns `pidFaceRotGuid` so the FaceParallax emitter can parent to it.
 * Caller should check preconditions (`pidParamAngleZ && facePivotCx !== null
 * && faceUnionBbox && pidBodyXGuid`) before invoking.
 *
 * @param {XmlBuilder} x
 * @param {Object} ctx
 * @param {string} ctx.pidParamAngleZ
 * @param {number} ctx.facePivotCx
 * @param {number} ctx.facePivotCy
 * @param {string} ctx.pidBodyXGuid
 * @param {string|null} ctx.headGroupId
 * @param {Map} ctx.groupDeformerGuids
 * @param {Map} ctx.deformerWorldOrigins
 * @param {(cx:number)=>number} ctx.canvasToBodyXX
 * @param {(cy:number)=>number} ctx.canvasToBodyXY
 * @param {Array} ctx.allDeformerSources
 * @param {string} ctx.pidPartGuid
 * @param {string} ctx.pidCoord
 * @param {Object} ctx.rootPart
 * @returns {string} pidFaceRotGuid
 */
export function emitFaceRotation(x, ctx) {
  const {
    pidParamAngleZ, facePivotCx, facePivotCy, pidBodyXGuid,
    headGroupId, groupDeformerGuids, deformerWorldOrigins,
    canvasToBodyXX, canvasToBodyXY,
    allDeformerSources, pidPartGuid, pidCoord, rootPart,
  } = ctx;

  // ── Face Rotation (CRotationDeformerSource) ──
  // Build the spec via shared rig builder; XML emission uses the spec data.
  const headGroupRotPid = headGroupId && groupDeformerGuids.get(headGroupId);
  const headGroupPivot = headGroupId && deformerWorldOrigins.get(headGroupId);
  const { spec: faceRotSpec } = buildFaceRotationSpec({
    facePivotCanvasX: facePivotCx,
    facePivotCanvasY: facePivotCy,
    parentType: headGroupRotPid ? 'rotation' : 'warp',
    parentDeformerId: headGroupRotPid ? `GroupRotation_${headGroupId}` : 'BodyXWarp',
    parentPivotCanvas: headGroupRotPid ? headGroupPivot : null,
    canvasToBodyXX, canvasToBodyXY,
  });
  const faceRotParamKeys = faceRotSpec.bindings[0].keys;
  const faceRotAngles    = faceRotSpec.keyforms.map(k => k.angle);

  const [, pidFaceRotGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: 'FaceRotation' });
  const { pidKfg: pidFaceRotKfg, formGuids: faceRotFormGuids } =
    emitSingleParamKfGrid(x, pidParamAngleZ, faceRotParamKeys, 'ParamAngleZ');

  const pivotX = faceRotSpec.keyforms[0].originX;
  const pivotY = faceRotSpec.keyforms[0].originY;

  const [faceRotDf, pidFaceRotDf] = x.shared('CRotationDeformerSource');
  allDeformerSources.push({ pid: pidFaceRotDf, tag: 'CRotationDeformerSource' });
  const frAcdfs = x.sub(faceRotDf, 'ACDeformerSource', { 'xs.n': 'super' });
  const frAcpcs = x.sub(frAcdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
  x.sub(frAcpcs, 's', { 'xs.n': 'localName' }).text = 'Face Rotation';
  x.sub(frAcpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(frAcpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
  x.subRef(frAcpcs, 'CPartGuid', pidPartGuid, { 'xs.n': 'parentGuid' });
  x.subRef(frAcpcs, 'KeyformGridSource', pidFaceRotKfg, { 'xs.n': 'keyformGridSource' });
  const frMft = x.sub(frAcpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
  x.sub(frMft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
  const frBwc = x.sub(frMft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
  x.sub(frBwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
  x.sub(frAcpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
  x.sub(frAcpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
  x.sub(frAcpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
  x.subRef(frAcdfs, 'CDeformerGuid', pidFaceRotGuid, { 'xs.n': 'guid' });
  x.sub(frAcdfs, 'CDeformerId', { 'xs.n': 'id', idstr: 'FaceRotation' });
  const frTarget = headGroupRotPid || pidBodyXGuid;
  x.subRef(frAcdfs, 'CDeformerGuid', frTarget, { 'xs.n': 'targetDeformerGuid' });
  x.sub(faceRotDf, 'b', { 'xs.n': 'useBoneUi_testImpl' }).text = 'true';

  const frKfsList = x.sub(faceRotDf, 'carray_list', {
    'xs.n': 'keyforms', count: String(faceRotParamKeys.length),
  });
  for (let i = 0; i < faceRotParamKeys.length; i++) {
    const rdf = x.sub(frKfsList, 'CRotationDeformerForm', {
      angle: faceRotAngles[i].toFixed(1),
      originX: pivotX.toFixed(6),
      originY: pivotY.toFixed(6),
      scale: '1.0',
      isReflectX: 'false',
      isReflectY: 'false',
    });
    const rdfAdf = x.sub(rdf, 'ACDeformerForm', { 'xs.n': 'super' });
    const rdfAcf = x.sub(rdfAdf, 'ACForm', { 'xs.n': 'super' });
    x.subRef(rdfAcf, 'CFormGuid', faceRotFormGuids[i], { 'xs.n': 'guid' });
    x.sub(rdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
    x.sub(rdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
    x.subRef(rdfAcf, 'CRotationDeformerSource', pidFaceRotDf, { 'xs.n': '_source' });
    x.sub(rdfAcf, 'null', { 'xs.n': 'name' });
    x.sub(rdfAcf, 's', { 'xs.n': 'notes' }).text = '';
    x.sub(rdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
    x.sub(rdfAdf, 'CFloatColor', {
      'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
    });
    x.sub(rdfAdf, 'CFloatColor', {
      'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
    });
    x.subRef(rdfAdf, 'CoordType', pidCoord, { 'xs.n': 'coordType' });
  }
  // Match existing rotation-deformer field order (UI metadata).
  x.sub(faceRotDf, 'f', { 'xs.n': 'handleLengthOnCanvas' }).text = '200.0';
  x.sub(faceRotDf, 'f', { 'xs.n': 'circleRadiusOnCanvas' }).text = '100.0';
  x.sub(faceRotDf, 'f', { 'xs.n': 'baseAngle' }).text = '0.0';
  rootPart.childGuidsNode.children.push(x.ref('CDeformerGuid', pidFaceRotGuid));
  rootPart.childGuidsNode.attrs.count = String(rootPart.childGuidsNode.children.length);

  return pidFaceRotGuid;
}
