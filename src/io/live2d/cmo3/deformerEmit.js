/**
 * Deformer emit helpers for the .cmo3 generator.
 *
 * Pure helpers that take an `XmlBuilder` instance and optionally a small
 * number of collection/pid dependencies from the caller. Keeps the main
 * generator free of the verbose CWarpDeformerSource / KeyformGrid boilerplate.
 *
 * @module io/live2d/cmo3/deformerEmit
 */

import { uuid } from '../xmlbuilder.js';

/** Generate a uniform grid of 2D positions in [minVal, maxVal] × [minVal, maxVal]. */
export function makeUniformGrid(col, row, minVal, maxVal) {
  const gW = col + 1, gH = row + 1;
  const grid = new Float64Array(gW * gH * 2);
  for (let r = 0; r < gH; r++) {
    for (let c = 0; c < gW; c++) {
      grid[(r * gW + c) * 2]     = minVal + c * (maxVal - minVal) / col;
      grid[(r * gW + c) * 2 + 1] = minVal + r * (maxVal - minVal) / row;
    }
  }
  return grid;
}

/** Emit one KeyformBindingSource with LINEAR interpolation. */
export function emitKfBinding(x, kfbNode, pidKfg, pidParam, keys, description) {
  x.subRef(kfbNode, 'KeyformGridSource', pidKfg, { 'xs.n': '_gridSource' });
  x.subRef(kfbNode, 'CParameterGuid', pidParam, { 'xs.n': 'parameterGuid' });
  const keysArr = x.sub(kfbNode, 'array_list', { 'xs.n': 'keys', count: String(keys.length) });
  for (const k of keys) x.sub(keysArr, 'f').text = String(k);
  x.sub(kfbNode, 'InterpolationType', { 'xs.n': 'interpolationType', v: 'LINEAR' });
  x.sub(kfbNode, 'ExtendedInterpolationType', { 'xs.n': 'extendedInterpolationType', v: 'LINEAR' });
  x.sub(kfbNode, 'i', { 'xs.n': 'insertPointCount' }).text = '1';
  x.sub(kfbNode, 'f', { 'xs.n': 'extendedInterpolationScale' }).text = '1.0';
  x.sub(kfbNode, 's', { 'xs.n': 'description' }).text = description;
}

/**
 * Emit single-param keyform binding + grid.
 * Typical use: 3 keyforms for -10/0/+10, or 2 for 0/1.
 */
export function emitSingleParamKfGrid(x, pidParam, keys, description) {
  const [kfb, pidKfb] = x.shared('KeyformBindingSource');
  const [kfg, pidKfg] = x.shared('KeyformGridSource');
  const formGuids = [];

  const kfogList = x.sub(kfg, 'array_list', { 'xs.n': 'keyformsOnGrid', count: String(keys.length) });
  for (let i = 0; i < keys.length; i++) {
    const [, pidForm] = x.shared('CFormGuid', { uuid: uuid(), note: `${description}_k${keys[i]}` });
    formGuids.push(pidForm);
    const kog = x.sub(kfogList, 'KeyformOnGrid');
    const ak = x.sub(kog, 'KeyformGridAccessKey', { 'xs.n': 'accessKey' });
    const kop = x.sub(ak, 'array_list', { 'xs.n': '_keyOnParameterList', count: '1' });
    const kon = x.sub(kop, 'KeyOnParameter');
    x.subRef(kon, 'KeyformBindingSource', pidKfb, { 'xs.n': 'binding' });
    x.sub(kon, 'i', { 'xs.n': 'keyIndex' }).text = String(i);
    x.subRef(kog, 'CFormGuid', pidForm, { 'xs.n': 'keyformGuid' });
  }
  const kfbList = x.sub(kfg, 'array_list', { 'xs.n': 'keyformBindings', count: '1' });
  x.subRef(kfbList, 'KeyformBindingSource', pidKfb);
  emitKfBinding(x, kfb, pidKfg, pidParam, keys.map(k => k + '.0'), description);

  return { pidKfg, formGuids };
}

/**
 * Emit a complete CWarpDeformerSource with keyforms.
 *
 * @param {XmlBuilder} x
 * @param {Object} ctx - Generator-owned state the helper writes into.
 * @param {Array} ctx.allDeformerSources - collected {pid, tag} for CDeformerSourceSet
 * @param {string} ctx.pidPartGuid - parent CPartGuid reference pid
 * @param {Object} ctx.rootPart - root part object with childGuidsNode
 * @param {string} name
 * @param {string} idstr
 * @param {number} col
 * @param {number} row
 * @param {string} pidWarpGuid
 * @param {string} pidTargetGuid
 * @param {string} pidKfg
 * @param {string} pidWarpCoordType
 * @param {string[]} formGuids
 * @param {Float64Array[]} gridPositions
 * @returns {string} pidWarpDf
 */
export function emitStructuralWarp(
  x, ctx,
  name, idstr, col, row, pidWarpGuid, pidTargetGuid,
  pidKfg, pidWarpCoordType, formGuids, gridPositions,
) {
  const { allDeformerSources, pidPartGuid, rootPart } = ctx;
  const [warpDf, pidWarpDf] = x.shared('CWarpDeformerSource');
  allDeformerSources.push({ pid: pidWarpDf, tag: 'CWarpDeformerSource' });

  const acdfs = x.sub(warpDf, 'ACDeformerSource', { 'xs.n': 'super' });
  const acpcs = x.sub(acdfs, 'ACParameterControllableSource', { 'xs.n': 'super' });
  x.sub(acpcs, 's', { 'xs.n': 'localName' }).text = name;
  x.sub(acpcs, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(acpcs, 'b', { 'xs.n': 'isLocked' }).text = 'false';
  x.subRef(acpcs, 'CPartGuid', pidPartGuid, { 'xs.n': 'parentGuid' });
  x.subRef(acpcs, 'KeyformGridSource', pidKfg, { 'xs.n': 'keyformGridSource' });
  const mft = x.sub(acpcs, 'KeyFormMorphTargetSet', { 'xs.n': 'keyformMorphTargetSet' });
  x.sub(mft, 'carray_list', { 'xs.n': '_morphTargets', count: '0' });
  const bwc = x.sub(mft, 'MorphTargetBlendWeightConstraintSet', { 'xs.n': 'blendWeightConstraintSet' });
  x.sub(bwc, 'carray_list', { 'xs.n': '_constraints', count: '0' });
  x.sub(acpcs, 'carray_list', { 'xs.n': '_extensions', count: '0' });
  x.sub(acpcs, 'null', { 'xs.n': 'internalColor_direct_argb' });
  x.sub(acpcs, 'null', { 'xs.n': 'internalColor_indirect_argb' });
  x.subRef(acdfs, 'CDeformerGuid', pidWarpGuid, { 'xs.n': 'guid' });
  x.sub(acdfs, 'CDeformerId', { 'xs.n': 'id', idstr });
  x.subRef(acdfs, 'CDeformerGuid', pidTargetGuid, { 'xs.n': 'targetDeformerGuid' });

  x.sub(warpDf, 'i', { 'xs.n': 'col' }).text = String(col);
  x.sub(warpDf, 'i', { 'xs.n': 'row' }).text = String(row);
  x.sub(warpDf, 'b', { 'xs.n': 'isQuadTransform' }).text = 'false';

  const numKf = formGuids.length;
  const gridPts = (col + 1) * (row + 1);
  const kfsList = x.sub(warpDf, 'carray_list', { 'xs.n': 'keyforms', count: String(numKf) });
  for (let i = 0; i < numKf; i++) {
    const wdf = x.sub(kfsList, 'CWarpDeformerForm');
    const wdfAdf = x.sub(wdf, 'ACDeformerForm', { 'xs.n': 'super' });
    const wdfAcf = x.sub(wdfAdf, 'ACForm', { 'xs.n': 'super' });
    x.subRef(wdfAcf, 'CFormGuid', formGuids[i], { 'xs.n': 'guid' });
    x.sub(wdfAcf, 'b', { 'xs.n': 'isAnimatedForm' }).text = 'false';
    x.sub(wdfAcf, 'b', { 'xs.n': 'isLocalAnimatedForm' }).text = 'false';
    x.subRef(wdfAcf, 'CWarpDeformerSource', pidWarpDf, { 'xs.n': '_source' });
    x.sub(wdfAcf, 'null', { 'xs.n': 'name' });
    x.sub(wdfAcf, 's', { 'xs.n': 'notes' }).text = '';
    x.sub(wdfAdf, 'f', { 'xs.n': 'opacity' }).text = '1.0';
    x.sub(wdfAdf, 'CFloatColor', {
      'xs.n': 'multiplyColor', red: '1.0', green: '1.0', blue: '1.0', alpha: '1.0',
    });
    x.sub(wdfAdf, 'CFloatColor', {
      'xs.n': 'screenColor', red: '0.0', green: '0.0', blue: '0.0', alpha: '1.0',
    });
    x.subRef(wdfAdf, 'CoordType', pidWarpCoordType, { 'xs.n': 'coordType' });
    x.sub(wdf, 'float-array', {
      'xs.n': 'positions', count: String(gridPts * 2),
    }).text = Array.from(gridPositions[i]).map(v => v.toFixed(6)).join(' ');
  }

  // Register in root part's _childGuids
  rootPart.childGuidsNode.children.push(x.ref('CDeformerGuid', pidWarpGuid));
  rootPart.childGuidsNode.attrs.count = String(rootPart.childGuidsNode.children.length);

  return pidWarpDf;
}
