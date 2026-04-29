// @ts-check
/**
 * .cmo3 part / group / texture extraction.
 *
 * Walks a parsed `main.xml` (see `cmo3XmlParser.js`) and pulls the data
 * a downstream importer needs to reconstruct an SS project skeleton:
 * one record per `<CArtMeshSource>` (mesh) and per `<CPartSource>`
 * (group). This is the second sweep of the round-trip work; the first
 * sweep stopped at metadata-only counts.
 *
 * What this module produces today:
 *
 *   - ExtractedPart[]  — id, name, parent ref, base-mesh vertices in
 *                        canvas space, triangle indices, UVs, resolved
 *                        texture image-buffer index, clip mask refs,
 *                        deformer ref
 *   - ExtractedGroup[] — id, name, parent ref
 *   - ExtractedTexture[] — image-buffer index, file name, transform
 *                          matrix (m00..m12), source CModelImage idx
 *
 * What it does NOT yet decode (each is its own follow-on sweep):
 *
 *   - CWarpDeformerSource / CRotationDeformerSource → deformer chain
 *   - CWarpDeformerForm / CArtMeshForm / CRotationDeformerForm →
 *     keyform grids per parameter combination
 *   - CParameterBindingSource → which params drive which deformers
 *   - Variants (encoded via conditional keyform bindings)
 *   - CPhysicsSettingsSource → physics rules
 *
 * @module io/live2d/cmo3PartExtract
 */

import {
  findChild,
  findChildren,
  findField,
  readNumberArray,
  elementText,
} from './cmo3XmlParser.js';

/**
 * @typedef {import('./cmo3XmlParser.js').XElement} XElement
 * @typedef {import('./cmo3XmlParser.js').ParsedXml} ParsedXml
 */

/**
 * @typedef {Object} ExtractedPart
 * @property {string|null} xsId           xs.id of this CArtMeshSource (e.g. "#770")
 * @property {string} drawableIdStr       e.g. "ArtMesh0"
 * @property {string} name                CParameterControllableSource.localName
 * @property {string|null} parentGuidRef  xs.ref pointing at the owning CPartSource's guid
 * @property {string|null} deformerGuidRef xs.ref pointing at the parent deformer
 * @property {string[]} clipMaskRefs      xs.ref of every entry in clipGuidList
 * @property {boolean} invertClippingMask
 * @property {boolean} isVisible
 * @property {boolean} isLocked
 * @property {Float32Array} positions     flat [x0,y0,x1,y1,…] in canvas px
 * @property {Float32Array} uvs           flat [u0,v0,u1,v1,…] in 0..1
 * @property {Uint16Array} indices        triangle indices (Cubism uses int-array, fits short)
 * @property {string|null} textureRef     xs.ref pointing at GTexture2D
 * @property {number} drawOrder           from first keyform, fallback 0
 */

/**
 * @typedef {Object} ExtractedGroup
 * @property {string|null} xsId
 * @property {string|null} guidRef       xs.ref of this group's own CPartGuid — the
 *                                       value parts use as `parentGuidRef` to point at
 *                                       this group. Without this, joining parts → groups
 *                                       across the part→guid→group chain is impossible.
 * @property {string} name
 * @property {string|null} parentGuidRef
 * @property {boolean} isVisible
 * @property {boolean} isLocked
 */

/**
 * @typedef {Object} ExtractedTexture
 * @property {string|null} xsId           xs.id of the GTexture2D node parts reference
 * @property {string} name                from GTexture super (e.g. "irides-l")
 * @property {string|null} filePath       e.g. "imageFileBuf_0.png" — from the linked CImageResource
 * @property {number|null} imageFileIndex parsed N from `imageFileBuf_N.png`
 * @property {number} width               from CImageResource width attr
 * @property {number} height              from CImageResource height attr
 */

/**
 * @typedef {Object} ExtractedScene
 * @property {ExtractedPart[]} parts
 * @property {ExtractedGroup[]} groups
 * @property {ExtractedTexture[]} textures
 * @property {string[]} warnings
 */

/**
 * @param {XElement} root
 * @returns {XElement[]}
 */
function findAllByTag(root, tag) {
  /** @type {XElement[]} */
  const out = [];
  /** @param {XElement} node */
  function walk(node) {
    if (node.tag === tag) out.push(node);
    for (const c of node.children) {
      if (typeof c !== 'string') walk(c);
    }
  }
  walk(root);
  return out;
}

/**
 * Read `<b xs.n="…">true|false</b>` with an explicit default if the field
 * isn't present. Cubism writes both lowercase booleans.
 *
 * @param {XElement} parent
 * @param {string} fieldName
 * @param {boolean} fallback
 */
function readBoolField(parent, fieldName, fallback) {
  const el = findField(parent, fieldName);
  if (!el) return fallback;
  return elementText(el).trim().toLowerCase() === 'true';
}

/**
 * Read `<i xs.n="…">N</i>` / `<f xs.n="…">N</f>` numerically, with an
 * explicit fallback if the field is missing or unparseable.
 *
 * @param {XElement} parent
 * @param {string} fieldName
 * @param {number} fallback
 */
function readNumberField(parent, fieldName, fallback) {
  const el = findField(parent, fieldName);
  if (!el) return fallback;
  const v = Number(elementText(el).trim());
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Pull the text of a `<s xs.n="…">…</s>` (or null if missing).
 *
 * @param {XElement} parent
 * @param {string} fieldName
 */
function readStringField(parent, fieldName) {
  const el = findField(parent, fieldName);
  if (!el) return null;
  return elementText(el);
}

/**
 * Extract the `count` attribute from a `<*-array count="N">` element and
 * verify it matches the actual entry count. Returns the parsed entries on
 * success; throws when the declared count is wrong (catches truncated /
 * mis-edited XML before downstream code starts misindexing).
 *
 * @param {XElement} el
 */
function readSizedArray(el) {
  const arr = readNumberArray(el);
  const declared = Number(el.attrs.count);
  if (Number.isFinite(declared) && declared !== arr.length) {
    throw new Error(
      `cmo3PartExtract: ${el.tag} xs.n="${el.attrs['xs.n']}" declares count=${declared} but contains ${arr.length} values`,
    );
  }
  return arr;
}

/**
 * Walk a CArtMeshSource and synthesise an ExtractedPart. Throws on
 * structurally broken input (missing positions / indices) — these are
 * not partial-import recoverable.
 *
 * @param {XElement} mesh
 * @param {string[]} warnings
 * @returns {ExtractedPart}
 */
function extractPart(mesh, warnings) {
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

  // Positions / UVs / indices — fields named directly on CArtMeshSource.
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
function extractGroup(group) {
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
function extractTexture(tex, idPool) {
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

/**
 * Extract every part / group / texture from a parsed cmo3 main.xml.
 *
 * Non-fatal issues are pushed to `warnings[]` instead of throwing, so a
 * partial scene is still useful to the inspector UI. The only throws are
 * structural (missing required arrays / `super` wrappers).
 *
 * @param {ParsedXml} parsed
 * @returns {ExtractedScene}
 */
export function extractScene(parsed) {
  const { root, idPool } = parsed;

  /** @type {string[]} */
  const warnings = [];

  /** @type {ExtractedPart[]} */
  const parts = [];
  for (const mesh of findAllByTag(root, 'CArtMeshSource')) {
    if (!mesh.attrs['xs.id']) continue;  // back-references, not definitions
    try {
      parts.push(extractPart(mesh, warnings));
    } catch (err) {
      warnings.push(`extractPart failed for ${mesh.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }

  /** @type {ExtractedGroup[]} */
  const groups = [];
  for (const group of findAllByTag(root, 'CPartSource')) {
    if (!group.attrs['xs.id']) continue;
    try {
      groups.push(extractGroup(group));
    } catch (err) {
      warnings.push(`extractGroup failed for ${group.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }

  /** @type {ExtractedTexture[]} */
  const textures = [];
  for (const tex of findAllByTag(root, 'GTexture2D')) {
    if (!tex.attrs['xs.id']) continue;
    try {
      textures.push(extractTexture(tex, idPool));
    } catch (err) {
      warnings.push(`extractTexture failed for ${tex.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }

  return { parts, groups, textures, warnings };
}
