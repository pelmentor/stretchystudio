// @ts-check
/**
 * Rig-graph extractors: deformers, keyform bindings, keyform grids.
 *
 *   - extractDeformer  walks `<CWarpDeformerSource>` /
 *     `<CRotationDeformerSource>` (both share the ACDeformerSource >
 *     ACParameterControl super-chain; only per-form decode differs).
 *   - extractKeyformBinding pulls the (parameter, keys[]) pairing each
 *     `<KeyformBindingSource>` represents.
 *   - extractKeyformGrid decodes the access-keyed cells of a
 *     `<KeyformGridSource>`.
 *
 * @module io/live2d/cmo3PartExtract/deformerExtract
 */

import { findField, elementText } from '../cmo3XmlParser.js';
import {
  readBoolField,
  readNumberField,
  readStringField,
  readSizedArray,
} from './xmlHelpers.js';

/**
 * @typedef {import('../cmo3XmlParser.js').XElement} XElement
 * @typedef {import('../cmo3PartExtract.js').DeformerKind} DeformerKind
 * @typedef {import('../cmo3PartExtract.js').ExtractedDeformer} ExtractedDeformer
 * @typedef {import('../cmo3PartExtract.js').ExtractedDeformerKeyform} ExtractedDeformerKeyform
 * @typedef {import('../cmo3PartExtract.js').ExtractedKeyformBinding} ExtractedKeyformBinding
 * @typedef {import('../cmo3PartExtract.js').ExtractedKeyformGrid} ExtractedKeyformGrid
 * @typedef {import('../cmo3PartExtract.js').ExtractedKeyformGridEntry} ExtractedKeyformGridEntry
 */

/**
 * @param {XElement} def
 * @param {DeformerKind} kind
 * @returns {ExtractedDeformer}
 */
export function extractDeformer(def, kind) {
  const xsId = def.attrs['xs.id'] ?? null;

  const acDeformer = findField(def, 'super');
  if (!acDeformer || acDeformer.tag !== 'ACDeformerSource') {
    throw new Error(`extractDeformer: ${xsId} missing ACDeformerSource super`);
  }
  const paramCtrl = findField(acDeformer, 'super');
  if (!paramCtrl) {
    throw new Error(`extractDeformer: ${xsId} missing ACParameterControllableSource super`);
  }

  const parentPart = findField(paramCtrl, 'parentGuid');
  const ownGuid = findField(acDeformer, 'guid');
  const idEl = findField(acDeformer, 'id');
  const targetDeformer = findField(acDeformer, 'targetDeformerGuid');
  const kfGrid = findField(paramCtrl, 'keyformGridSource');

  // Warp-specific fields (cols / rows / isQuadTransform / top-level positions)
  let cols = 0, rows = 0, isQuadTransform = false;
  let positions = null;
  let useBoneUi = false;
  if (kind === 'warp') {
    cols = readNumberField(def, 'col', 0);
    rows = readNumberField(def, 'row', 0);
    isQuadTransform = readBoolField(def, 'isQuadTransform', false);
    const posEl = findField(def, 'positions');
    if (posEl) positions = Float32Array.from(readSizedArray(posEl));
  } else {
    useBoneUi = readBoolField(def, 'useBoneUi_testImpl', false);
  }

  /** @type {ExtractedDeformerKeyform[]} */
  const keyforms = [];
  const kfList = findField(def, 'keyforms');
  if (kfList) {
    const formTag = kind === 'warp' ? 'CWarpDeformerForm' : 'CRotationDeformerForm';
    for (const c of kfList.children) {
      if (typeof c === 'string' || c.tag !== formTag) continue;
      if (kind === 'warp') {
        const posEl = findField(c, 'positions');
        keyforms.push({
          positions: posEl ? Float32Array.from(readSizedArray(posEl)) : null,
          angle: null, originX: null, originY: null, scale: null,
        });
      } else {
        keyforms.push({
          positions: null,
          angle: c.attrs.angle !== undefined ? Number(c.attrs.angle) : null,
          originX: c.attrs.originX !== undefined ? Number(c.attrs.originX) : null,
          originY: c.attrs.originY !== undefined ? Number(c.attrs.originY) : null,
          scale: c.attrs.scale !== undefined ? Number(c.attrs.scale) : null,
        });
      }
    }
  }

  return {
    kind,
    xsId,
    idStr: idEl?.attrs.idstr ?? '',
    name: readStringField(paramCtrl, 'localName') ?? '',
    ownGuidRef: ownGuid?.attrs['xs.ref'] ?? null,
    parentPartGuidRef: parentPart?.attrs['xs.ref'] ?? null,
    parentDeformerGuidRef: targetDeformer?.attrs['xs.ref'] ?? null,
    keyformGridSourceRef: kfGrid?.attrs['xs.ref'] ?? null,
    cols, rows, isQuadTransform, useBoneUi,
    positions,
    keyforms,
  };
}

/**
 * @param {XElement} bind
 * @returns {ExtractedKeyformBinding}
 */
export function extractKeyformBinding(bind) {
  const grid = findField(bind, '_gridSource');
  const param = findField(bind, 'parameterGuid');
  const keysEl = findField(bind, 'keys');
  /** @type {number[]} */
  const keys = [];
  if (keysEl) {
    for (const c of keysEl.children) {
      if (typeof c === 'string' || c.tag !== 'f') continue;
      const v = Number(elementText(c).trim());
      if (Number.isFinite(v)) keys.push(v);
    }
  }
  const interpEl = findField(bind, 'interpolationType');
  return {
    xsId: bind.attrs['xs.id'] ?? null,
    gridSourceRef: grid?.attrs['xs.ref'] ?? null,
    parameterGuidRef: param?.attrs['xs.ref'] ?? null,
    keys,
    description: readStringField(bind, 'description') ?? '',
    interpolationType: interpEl?.attrs.v ?? 'LINEAR',
  };
}

/**
 * @param {XElement} grid
 * @returns {ExtractedKeyformGrid}
 */
export function extractKeyformGrid(grid) {
  const list = findField(grid, 'keyformsOnGrid');
  /** @type {ExtractedKeyformGridEntry[]} */
  const entries = [];
  if (list) {
    for (const cell of list.children) {
      if (typeof cell === 'string' || cell.tag !== 'KeyformOnGrid') continue;
      const access = findField(cell, 'accessKey');
      /** @type {Array<{bindingRef: string|null, keyIndex: number}>} */
      const accessKey = [];
      if (access) {
        const paramList = findField(access, '_keyOnParameterList');
        if (paramList) {
          for (const kp of paramList.children) {
            if (typeof kp === 'string' || kp.tag !== 'KeyOnParameter') continue;
            const bindRef = findField(kp, 'binding');
            const ki = readNumberField(kp, 'keyIndex', 0);
            accessKey.push({
              bindingRef: bindRef?.attrs['xs.ref'] ?? null,
              keyIndex: ki,
            });
          }
        }
      }
      const kfGuid = findField(cell, 'keyformGuid');
      entries.push({
        keyformGuidRef: kfGuid?.attrs['xs.ref'] ?? null,
        accessKey,
      });
    }
  }
  return {
    xsId: grid.attrs['xs.id'] ?? null,
    entries,
  };
}
