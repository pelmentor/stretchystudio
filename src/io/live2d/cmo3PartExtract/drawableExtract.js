// @ts-check
/**
 * Visual-scene extractors: parts, groups, textures.
 *
 * Walks `<CArtMeshSource>` / `<CPartSource>` / `<GTexture2D>` nodes in a
 * parsed cmo3 main.xml and synthesises ExtractedPart / ExtractedGroup /
 * ExtractedTexture records. Throws on structurally broken input
 * (missing required `super` chains or required arrays); pushes
 * non-fatal mismatches to `warnings[]` so a partial scene is still
 * useful to the inspector.
 *
 * @module io/live2d/cmo3PartExtract/drawableExtract
 */

import { findChild, findField } from '../cmo3XmlParser.js';
import {
  readBoolField,
  readNumberField,
  readStringField,
  readSizedArray,
} from './xmlHelpers.js';

/**
 * @typedef {import('../cmo3XmlParser.js').XElement} XElement
 * @typedef {import('../cmo3PartExtract.js').ExtractedPart} ExtractedPart
 * @typedef {import('../cmo3PartExtract.js').ExtractedGroup} ExtractedGroup
 * @typedef {import('../cmo3PartExtract.js').ExtractedTexture} ExtractedTexture
 */

/**
 * Walk a CArtMeshSource and synthesise an ExtractedPart. Throws on
 * structurally broken input (missing positions / indices) — these are
 * not partial-import recoverable.
 *
 * @param {XElement} mesh
 * @param {string[]} warnings
 * @returns {ExtractedPart}
 */
export function extractPart(mesh, warnings) {
  const xsId = mesh.attrs['xs.id'] ?? null;

  // Structure: CArtMeshSource > ACDrawableSource[xs.n=super] > ACParameter…[xs.n=super]
  const drawSrc = findField(mesh, 'super');
  if (!drawSrc || drawSrc.tag !== 'ACDrawableSource') {
    throw new Error(`cmo3PartExtract: ${xsId} missing ACDrawableSource super`);
  }
  const paramCtrl = findField(drawSrc, 'super');
  if (!paramCtrl) {
    throw new Error(`cmo3PartExtract: ${xsId} missing ACParameterControllableSource super`);
  }

  const drawableId = findField(drawSrc, 'id');
  const drawableIdStr = drawableId?.attrs.idstr ?? '';

  const parentGuid = findField(paramCtrl, 'parentGuid');
  const parentGuidRef = parentGuid?.attrs['xs.ref'] ?? null;

  const deformerGuid = findField(drawSrc, 'targetDeformerGuid');
  const deformerGuidRef = deformerGuid?.attrs['xs.ref'] ?? null;

  // Own CDrawableGuid (lives on ACDrawableSource as `<CDrawableGuid xs.n="guid"
  // xs.ref="#NN"/>`). Other parts' `clipGuidList` entries point at THIS xs.ref
  // when they want this part to mask them.
  const ownDrawableGuid = findField(drawSrc, 'guid');
  const ownDrawableGuidRef = ownDrawableGuid?.attrs['xs.ref'] ?? null;

  const clipList = findField(drawSrc, 'clipGuidList');
  /** @type {string[]} */
  const clipMaskRefs = [];
  if (clipList) {
    for (const c of clipList.children) {
      if (typeof c === 'string') continue;
      const ref = c.attrs['xs.ref'];
      if (ref) clipMaskRefs.push(ref);
    }
  }

  const invertClippingMask = readBoolField(drawSrc, 'invertClippingMask', false);
  const isVisible = readBoolField(paramCtrl, 'isVisible', true);
  const isLocked = readBoolField(paramCtrl, 'isLocked', false);

  const positionsEl = findField(mesh, 'positions');
  const uvsEl = findField(mesh, 'uvs');
  const indicesEl = findField(mesh, 'indices');
  if (!positionsEl) throw new Error(`cmo3PartExtract: ${xsId} missing positions`);
  if (!uvsEl) throw new Error(`cmo3PartExtract: ${xsId} missing uvs`);
  if (!indicesEl) throw new Error(`cmo3PartExtract: ${xsId} missing indices`);

  const positions = Float32Array.from(readSizedArray(positionsEl));
  const uvs = Float32Array.from(readSizedArray(uvsEl));
  const indicesArr = readSizedArray(indicesEl);
  const indices = Uint16Array.from(indicesArr);

  if (positions.length % 2 !== 0) {
    throw new Error(`cmo3PartExtract: ${xsId} positions length ${positions.length} not divisible by 2`);
  }
  if (uvs.length !== positions.length) {
    warnings.push(`${drawableIdStr} (${xsId}): uvs length ${uvs.length} doesn't match positions length ${positions.length}`);
  }
  if (indices.length % 3 !== 0) {
    warnings.push(`${drawableIdStr} (${xsId}): indices length ${indices.length} not divisible by 3 — broken triangulation`);
  }

  const textureEl = findField(mesh, 'texture');
  const textureRef = textureEl?.attrs['xs.ref'] ?? null;

  // Draw order from the first keyform if present (Cubism stores it per-form).
  let drawOrder = 0;
  const keyforms = findField(mesh, 'keyforms');
  if (keyforms) {
    const firstForm = findChild(keyforms, 'CArtMeshForm');
    if (firstForm) {
      const drawForm = findField(firstForm, 'super');
      if (drawForm) drawOrder = readNumberField(drawForm, 'drawOrder', 0);
    }
  }

  return {
    xsId,
    drawableIdStr,
    name: readStringField(paramCtrl, 'localName') ?? drawableIdStr,
    parentGuidRef,
    deformerGuidRef,
    ownDrawableGuidRef,
    clipMaskRefs,
    invertClippingMask,
    isVisible,
    isLocked,
    positions,
    uvs,
    indices,
    textureRef,
    drawOrder,
  };
}

/**
 * Walk a CPartSource and synthesise an ExtractedGroup.
 *
 * @param {XElement} group
 * @returns {ExtractedGroup}
 */
export function extractGroup(group) {
  const xsId = group.attrs['xs.id'] ?? null;
  const paramCtrl = findField(group, 'super');
  /** @type {XElement|null} */
  let inner = null;
  if (paramCtrl) {
    if (paramCtrl.tag === 'ACParameterControllableSource') {
      inner = paramCtrl;
    } else {
      // CPartSource > ACDrawableSource[super] > ACParameterControllableSource[super]
      inner = findField(paramCtrl, 'super');
    }
  }
  const probe = inner ?? paramCtrl ?? group;

  const parentGuid = findField(probe, 'parentGuid');
  // The group's own CPartGuid lives at the top of CPartSource (the
  // ACDrawableSource > id child for parts is replaced by a guid for
  // groups). Parts reference groups via this guid value, not via the
  // CPartSource's xs.id directly.
  const ownGuid = findField(group, 'guid')
    ?? (paramCtrl ? findField(paramCtrl, 'guid') : null)
    ?? (inner ? findField(inner, 'guid') : null);
  return {
    xsId,
    guidRef: ownGuid?.attrs['xs.ref'] ?? null,
    name: readStringField(probe, 'localName') ?? '',
    parentGuidRef: parentGuid?.attrs['xs.ref'] ?? null,
    isVisible: readBoolField(probe, 'isVisible', true),
    isLocked: readBoolField(probe, 'isLocked', false),
  };
}

/**
 * Walk a GTexture2D and resolve the texture file it points at.
 *
 * The chain is: GTexture2D → `<CImageResource xs.n="srcImageResource" xs.ref="#NNN"/>`
 * → CImageResource definition (carries width/height attrs and a
 * `<file xs.n="imageFileBuf" path="imageFileBuf_N.png"/>` child).
 *
 * @param {XElement} tex
 * @param {Map<string, XElement>} idPool
 * @returns {ExtractedTexture}
 */
export function extractTexture(tex, idPool) {
  const xsId = tex.attrs['xs.id'] ?? null;
  const gTex = findField(tex, 'super');
  const name = gTex ? (readStringField(gTex, 'name') ?? '') : '';

  const srcRef = findField(tex, 'srcImageResource');
  let filePath = null;
  let imageFileIndex = null;
  let width = 0;
  let height = 0;
  if (srcRef && srcRef.attrs['xs.ref']) {
    const imgRes = idPool.get(srcRef.attrs['xs.ref']) ?? null;
    if (imgRes) {
      width = Number(imgRes.attrs.width ?? '0');
      height = Number(imgRes.attrs.height ?? '0');
      const fileEl = findField(imgRes, 'imageFileBuf');
      if (fileEl) {
        filePath = fileEl.attrs.path ?? null;
        if (filePath) {
          const m = /imageFileBuf_(\d+)\.png/i.exec(filePath);
          if (m) imageFileIndex = Number(m[1]);
        }
      }
    }
  }

  return { xsId, name, filePath, imageFileIndex, width, height };
}
