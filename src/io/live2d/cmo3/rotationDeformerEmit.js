// @ts-check

import { uuid } from '../xmlbuilder.js';
import { sanitisePartName } from '../../../lib/partId.js';
import { computeGroupWorldMatrices } from './groupWorldMatrices.js';
import { buildGroupRotationSpec } from '../rig/rotationDeformers.js';

/**
 * Section 3b — CRotationDeformerSource emission per group.
 *
 * Lifted out of cmo3writer.js (Phase 6 god-class breakup, sweep #32).
 *
 * For every non-bone non-skipped group, emit a `CRotationDeformerSource`
 * driven by `ParamRotation_<sanitisedGroupName>` over the configured
 * angle range. Each deformer's chain initially targets the parent
 * group's deformer (or ROOT); section 3c re-parents the chain into
 * the body warp chain after structural warps emit.
 *
 * Why "non-bone non-skipped":
 *   - Bones (`boneParamGuids.has(g.id)`) get baked mesh keyforms on
 *     `ParamRotation_<bone>` instead of a rotation deformer. Skipping
 *     keeps the deformer chain free of duplicated bone params.
 *   - `SKIP_ROTATION_ROLES` (torso/eyes/neck per Hiyori) are handled
 *     via warps + parallax. Creating a rotation deformer at a
 *     bbox-center fallback origin makes the neck "tear off" when
 *     Body X bows.
 *
 * Coordinate-space contract:
 *   - Deformer origins are emitted in the PARENT deformer's local
 *     space (Hiyori pattern). For a parent that's another rotation
 *     deformer, that's pivot-relative pixels. For a warp parent,
 *     it's 0..1; for ROOT it's canvas px. Section 3c does the final
 *     pivot conversion when re-parenting the chain.
 *
 * Returns the mutable maps + lookups downstream sections need:
 * `groupWorldMatrices`, `deformerWorldOrigins`, `groupDeformerGuids`,
 * `rotDeformerTargetNodes` (XML nodes for re-parenting),
 * `rotDeformerOriginNodes` (per-keyform CRotationDeformerForm refs +
 * world coords for origin conversion), `headGroupId`/`neckGroupId`
 * for structural chain integration.
 *
 * @module io/live2d/cmo3/rotationDeformerEmit
 */

/**
 * @param {Object} x
 * @param {Object} opts
 * @returns {{
 *   groupMap: Map<string, Object>,
 *   headGroupId: string|undefined,
 *   neckGroupId: string|undefined,
 *   groupWorldMatrices: Map<string, Float32Array>,
 *   deformerWorldOrigins: Map<string, {x:number,y:number}>,
 *   groupDeformerGuids: Map<string, string|number>,
 *   rotDeformerTargetNodes: Map<string, Object>,
 *   rotDeformerOriginNodes: Map<string, Object>,
 *   allDeformerSources: Array<{pid:string|number, tag:string}>,
 *   deformerParamMap: Map<string, Object>,
 * }}
 */
export function emitRotationDeformers(x, opts) {
  const {
    groups, meshes, canvasW, canvasH,
    paramDefs, boneParamGuids, rigCollector,
    pidPartGuid, groupPartGuids, pidDeformerRoot,
    groupParts, rootPart,
    bakedAngleMin, bakedAngleMax,
    rotParamRangeMin, rotParamRangeMax,
    rotGroupParamKeys, rotGroupAngles,
    skipRoles,
  } = opts;

  // ── World-space pivots ──
  const groupMap = new Map(groups.map(g => [g.id, g]));

  // Head + neck for structural chain integration
  const headGroupId = groups.find(g =>
    g.boneRole === 'head' || g.boneRole === 'face' ||
    (g.name && (g.name.toLowerCase() === 'head' || g.name.toLowerCase() === 'face'))
  )?.id;
  const neckGroupId = groups.find(g =>
    g.boneRole === 'neck' ||
    (g.name && g.name.toLowerCase() === 'neck')
  )?.id;

  const { groupWorldMatrices, deformerWorldOrigins } =
    computeGroupWorldMatrices(groups, meshes, canvasW, canvasH);

  // ── Allocations ──
  /** @type {Map<string, string|number>} */
  const groupDeformerGuids = new Map();
  /** @type {Map<string, Object>} */
  const rotDeformerTargetNodes = new Map();
  /** @type {Map<string, Object>} */
  const rotDeformerOriginNodes = new Map();
  /** @type {Array<{pid:string|number, tag:string}>} */
  const allDeformerSources = [];
  /** @type {Map<string, Object>} */
  const deformerParamMap = new Map();

  const DEFORMER_ANGLE_MIN = rotParamRangeMin;
  const DEFORMER_ANGLE_MAX = rotParamRangeMax;

  // Bones use baked mesh keyforms — record their param in the map
  // for animation export, no deformer emission.
  for (const [boneId, bp] of boneParamGuids) {
    deformerParamMap.set(boneId, {
      paramId: bp.paramId, min: bakedAngleMin, max: bakedAngleMax,
    });
  }

  const SKIP_ROTATION_ROLES = new Set(skipRoles);

  for (const g of groups) {
    if (boneParamGuids.has(g.id)) continue;
    if (SKIP_ROTATION_ROLES.has(g.boneRole)) continue;

    const [, pidDfGuid] = x.shared('CDeformerGuid', { uuid: uuid(), note: `Rot_${g.name || g.id}` });
    groupDeformerGuids.set(g.id, pidDfGuid);

    const _GROUP_KF_COUNT = rotGroupParamKeys.length;
    const groupFormGuidPids = [];
    for (let kfi = 0; kfi < _GROUP_KF_COUNT; kfi++) {
      const [, pidForm] = x.shared('CFormGuid', {
        uuid: uuid(),
        note: `RotForm_${g.name}_${rotGroupParamKeys[kfi]}`,
      });
      groupFormGuidPids.push(pidForm);
    }

    // ParamRotation_<sanitisedGroupName>. Reuse pre-existing bone-param pid
    // when the id collides (some bone-named groups overlap on chibi rigs).
    const sanitizedName = sanitisePartName(g.name || g.id);
    const rotParamId = `ParamRotation_${sanitizedName}`;
    const existingParam = paramDefs.find(p => p.id === rotParamId);
    const pidRotParam = existingParam
      ? existingParam.pid
      : (() => { const [, pid] = x.shared('CParameterGuid', { uuid: uuid(), note: rotParamId }); return pid; })();
    if (!existingParam) {
      paramDefs.push({
        pid: pidRotParam, id: rotParamId, name: `Rotation ${g.name || g.id}`,
        min: DEFORMER_ANGLE_MIN, max: DEFORMER_ANGLE_MAX, defaultVal: 0,
        decimalPlaces: 1,
      });
    }
    deformerParamMap.set(g.id, {
      paramId: rotParamId, min: DEFORMER_ANGLE_MIN, max: DEFORMER_ANGLE_MAX,
    });

    // rigCollector spec — initial parent ROOT (section 3c re-parents).
    const _gWorldOrigin = deformerWorldOrigins.get(g.id) ?? { x: 0, y: 0 };
    const { spec: _grpRotSpec } = buildGroupRotationSpec({
      id: `GroupRotation_${g.id}`,
      name: g.name || g.id,
      paramId: rotParamId,
      pivotCanvas: { x: _gWorldOrigin.x, y: _gWorldOrigin.y },
      paramKeys: rotGroupParamKeys,
      angles: rotGroupAngles,
    });
    if (g.parent && groupDeformerGuids.has(g.parent)) {
      _grpRotSpec.parent = { type: 'rotation', id: `GroupRotation_${g.parent}` };
    }
    rigCollector.rotationDeformers.push(_grpRotSpec);

    // CoordType — Canvas (origins are canvas-px until section 3c rebases)
    const [coordDf, pidCoordDf] = x.shared('CoordType');
    x.sub(coordDf, 's', { 'xs.n': 'coordName' }).text = 'Canvas';

    // KeyformBindingSource + KeyformGridSource (1 binding × N keyforms)
    const [kfBinding, pidKfBinding] = x.shared('KeyformBindingSource');
    const [kfgDf, pidKfgDf] = x.shared('KeyformGridSource');
    const kfogDf = x.sub(kfgDf, 'array_list', {
      'xs.n': 'keyformsOnGrid', count: String(_GROUP_KF_COUNT),
    });
    for (let kfi = 0; kfi < _GROUP_KF_COUNT; kfi++) {
      const kog = x.sub(kfogDf, 'KeyformOnGrid');
      const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
      const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
      const kon = x.sub(kop, 'KeyOnParameter');
      x.subRef(kon, 'KeyformBindingSource', pidKfBinding, { 'xs.n': 'binding' });
      x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(kfi);
      x.subRef(kog, 'CFormGuid', groupFormGuidPids[kfi], { 'xs.n': 'keyformGuid' });
    }
    const kfbList = x.sub(kfgDf, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
    x.subRef(kfbList, 'KeyformBindingSource', pidKfBinding);

    // Fill KeyformBindingSource (circular ref with grid — matches Hiyori)
    x.subRef(kfBinding, 'KeyformGridSource', pidKfgDf, { 'xs.n': '_gridSource' });
    x.subRef(kfBinding, 'CParameterGuid', pidRotParam, { 'xs.n': 'parameterGuid' });
    const keysArr = x.sub(kfBinding, 'array_list', {
      'xs.n': 'keys', count: String(_GROUP_KF_COUNT),
    });
    for (const k of rotGroupParamKeys) x.sub(keysArr, 'f').text = `${k}.0`;
    x.sub(kfBinding, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
    x.sub(kfBinding, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
    x.sub(kfBinding, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
    x.sub(kfBinding, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
    x.sub(kfBinding, 's', { 'xs.n': 'description' }).text = rotParamId;

    // Parent deformer + part. Section 3c re-parents target nodes for
    // non-leg groups; section 3b leaves them at the inherited chain.
    const parentDfGuid = g.parent && groupDeformerGuids.has(g.parent)
      ? groupDeformerGuids.get(g.parent) : pidDeformerRoot;
    const parentPartGuid = groupPartGuids.has(g.id)
      ? groupPartGuids.get(g.id) : pidPartGuid;

    // CRotationDeformerSource node
    const [rotDf, pidRotDf] = x.shared('CRotationDeformerSource');
    allDeformerSources.push({ pid: pidRotDf, tag: 'CRotationDeformerSource' });

    const acdfs = x.sub(rotDf, 'ACDeformerSource', { 'xs.n': 'super' });
    const acpcs = x.sub(acdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
    x.sub(acpcs, 's', { 'xs.n': 'localName' }).text = `${g.name || g.id}`;
    x.sub(acpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
    x.sub(acpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
    x.subRef(acpcs, 'CPartGuid', parentPartGuid, { 'xs.n': 'parentGuid' });
    x.subRef(acpcs, 'KeyformGridSource', pidKfgDf, { 'xs.n': 'keyformGridSource' });
    const mftDf = x.sub(acpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
    x.sub(mftDf, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
    const bwcDf = x.sub(mftDf, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
    x.sub(bwcDf, 'carray_list', { 'xs.n': '_constraints', count: '0' });
    x.sub(acpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
    x.sub(acpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
    x.subRef(acdfs, 'CDeformerGuid', pidDfGuid, { 'xs.n': 'guid' });
    x.sub(acdfs, 'CDeformerId', { 'xs.n': 'id', idstr: `Rotation_${sanitizedName}` });
    const rotDfTargetNode = x.subRef(acdfs, 'CDeformerGuid', parentDfGuid, { 'xs.n': 'targetDeformerGuid' });
    rotDeformerTargetNodes.set(g.id, rotDfTargetNode);

    x.sub(rotDf, 'b', { 'xs.n': 'useBoneUi_testImpl' }).text = 'true';

    // Origin in parent deformer's local space.
    // Hiyori Rotation22: originX=-0.44, originY=-718.2 (relative to parent Rotation21).
    // Canvas-space origins put controllers far from the character.
    const worldOrigin = deformerWorldOrigins.get(g.id);
    const parentWorldOrigin = g.parent && deformerWorldOrigins.has(g.parent)
      ? deformerWorldOrigins.get(g.parent)
      : { x: 0, y: 0 };
    const originX = worldOrigin.x - parentWorldOrigin.x;
    const originY = worldOrigin.y - parentWorldOrigin.y;

    // N keyforms — same origin across keys (Hiyori convention for generic groups).
    const kfsDf = x.sub(rotDf, 'carray_list', {
      'xs.n': 'keyforms', count: String(_GROUP_KF_COUNT),
    });
    const rotFormNodes = [];
    const emitRotForm = (formGuidPid, angle) => {
      const rdf = x.sub(kfsDf, 'CRotationDeformerForm', {
        angle: angle.toFixed(1),
        originX: originX.toFixed(1),
        originY: originY.toFixed(1),
        scale: '1.0',
        isReflectX: 'false',
        isReflectY: 'false',
      });
      rotFormNodes.push(rdf);
      const adfSuper = x.sub(rdf, 'ACDeformerForm', { 'xs.n': 'super' });
      const acfDf = x.sub(adfSuper, 'ACForm', { 'xs.n': 'super' });
      x.subRef(acfDf, 'CFormGuid', formGuidPid, { 'xs.n': 'guid' });
      x.sub(acfDf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
      x.sub(acfDf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
      x.subRef(acfDf, 'CRotationDeformerSource', pidRotDf, { 'xs.n': '_source' });
      x.sub(acfDf, 'null', { 'xs.n': 'name' });
      x.sub(acfDf, 's', { 'xs.n': 'notes' }).text = '';
      x.sub(adfSuper, 'f', { 'xs.n': 'opacity' }).text = '1.0';
      x.sub(adfSuper, 'CFloatColor', {
        'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
      });
      x.sub(adfSuper, 'CFloatColor', {
        'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
      });
      x.subRef(adfSuper, 'CoordType', pidCoordDf, { 'xs.n': 'coordType' });
    };

    for (let kfi = 0; kfi < _GROUP_KF_COUNT; kfi++) {
      emitRotForm(groupFormGuidPids[kfi], rotGroupAngles[kfi]);
    }
    rotDeformerOriginNodes.set(g.id, {
      forms: rotFormNodes,
      ox: originX, oy: originY,
      wx: worldOrigin.x, wy: worldOrigin.y,
      coordNode: coordDf,
    });

    x.sub(rotDf, 'f', { 'xs.n': 'handleLengthOnCanvas' }).text = '200.0';
    x.sub(rotDf, 'f', { 'xs.n': 'circleRadiusOnCanvas' }).text = '100.0';
    x.sub(rotDf, 'f', { 'xs.n': 'baseAngle' }).text = '0.0';
  }

  // Hook each deformer guid into its parent part's _childGuids
  for (const g of groups) {
    const dfGuid = groupDeformerGuids.get(g.id);
    if (!dfGuid) continue;
    const partSource = groupParts.has(g.id) ? groupParts.get(g.id) : rootPart;
    partSource.childGuidsNode.children.push(x.ref('CDeformerGuid', dfGuid));
    partSource.childGuidsNode.attrs.count = String(partSource.childGuidsNode.children.length);
  }

  return {
    groupMap,
    headGroupId, neckGroupId,
    groupWorldMatrices, deformerWorldOrigins,
    groupDeformerGuids,
    rotDeformerTargetNodes, rotDeformerOriginNodes,
    allDeformerSources, deformerParamMap,
  };
}
