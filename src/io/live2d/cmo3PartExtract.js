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
 * @typedef {Object} ExtractedKeyformBinding
 *
 * One parameter's contribution to a deformer's keyform grid: the values
 * (`keys`) at which keyforms are defined for this parameter, plus the
 * GUID that links this binding back to its owning grid.
 *
 * @property {string|null} xsId
 * @property {string|null} gridSourceRef       xs.ref → ExtractedKeyformGrid.xsId
 * @property {string|null} parameterGuidRef    xs.ref to a CParameterGuid (resolves to CParameterId.idstr)
 * @property {number[]} keys                   parameter values at each keyform index
 * @property {string} description              ParamID string the writer stamped on the binding
 * @property {string} interpolationType        e.g. "LINEAR"
 */

/**
 * @typedef {Object} ExtractedKeyformGridEntry
 *
 * One cell of a deformer's keyform grid: which CFormGuid carries the
 * keyform data, plus the (binding, keyIndex) tuples that locate this
 * cell along each parameter axis.
 *
 * @property {string|null} keyformGuidRef      xs.ref → CFormGuid (matches CWarpDeformerForm/CArtMeshForm guid)
 * @property {Array<{bindingRef:string|null, keyIndex:number}>} accessKey
 */

/**
 * @typedef {Object} ExtractedKeyformGrid
 *
 * A deformer's complete keyform grid: list of access-keyed cells. The
 * size is the cartesian product of binding lengths (e.g. ParamEyeBallX
 * 3 keys × ParamEyeBallY 3 keys = 9 cells).
 *
 * @property {string|null} xsId
 * @property {ExtractedKeyformGridEntry[]} entries
 */

/**
 * @typedef {'warp'|'rotation'} DeformerKind
 *
 * @typedef {Object} ExtractedDeformerKeyform
 * @property {Float32Array|null} positions  warp grid positions for this keyform; null on rotation deformers
 * @property {number|null} angle            rotation deformers only
 * @property {number|null} originX          rotation deformers only — in canvas-normalised 0..1
 * @property {number|null} originY          rotation deformers only — in canvas-normalised 0..1
 * @property {number|null} scale            rotation deformers only
 *
 * @typedef {Object} ExtractedDeformer
 * @property {DeformerKind} kind
 * @property {string|null} xsId
 * @property {string} idStr                CDeformerId.idstr (e.g. "RigWarp_irides_l", "Rotation_root")
 * @property {string} name                 ACParameterControllableSource.localName
 * @property {string|null} ownGuidRef      this deformer's own CDeformerGuid xs.ref
 * @property {string|null} parentPartGuidRef CPartGuid xs.ref — visual hierarchy parent (a group)
 * @property {string|null} parentDeformerGuidRef CDeformerGuid xs.ref — rig-chain parent deformer
 * @property {string|null} keyformGridSourceRef
 * @property {number} cols                 grid column count (warps only; 0 for rotation)
 * @property {number} rows                 grid row count (warps only; 0 for rotation)
 * @property {boolean} isQuadTransform     warps only
 * @property {boolean} useBoneUi           rotation deformers only
 * @property {Float32Array|null} positions warp deformers' top-level base grid (canvas-normalised 0..1)
 * @property {ExtractedDeformerKeyform[]} keyforms
 */

/**
 * @typedef {Object} ExtractedScene
 * @property {ExtractedPart[]} parts
 * @property {ExtractedGroup[]} groups
 * @property {ExtractedTexture[]} textures
 * @property {ExtractedDeformer[]} deformers
 * @property {ExtractedKeyformBinding[]} keyformBindings
 * @property {ExtractedKeyformGrid[]} keyformGrids
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
 * Walk a CWarpDeformerSource or CRotationDeformerSource and synthesise an
 * ExtractedDeformer. Both share the ACDeformerSource > ACParameterControl…
 * super-chain, so the wrapper-walking code is common; only the per-form
 * decode differs.
 *
 * @param {XElement} def
 * @param {DeformerKind} kind
 * @returns {ExtractedDeformer}
 */
function extractDeformer(def, kind) {
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

  // Per-keyform decode
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
 * Walk a `<KeyformBindingSource xs.id="…">` and pull the
 * (parameter, keys[]) pairing it represents.
 *
 * @param {XElement} bind
 * @returns {ExtractedKeyformBinding}
 */
function extractKeyformBinding(bind) {
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
 * Walk a `<KeyformGridSource xs.id="…">` and decode its access-keyed cells.
 *
 * @param {XElement} grid
 * @returns {ExtractedKeyformGrid}
 */
function extractKeyformGrid(grid) {
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

  /** @type {ExtractedDeformer[]} */
  const deformers = [];
  for (const def of findAllByTag(root, 'CWarpDeformerSource')) {
    if (!def.attrs['xs.id']) continue;
    try {
      deformers.push(extractDeformer(def, 'warp'));
    } catch (err) {
      warnings.push(`extractDeformer(warp) failed for ${def.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }
  for (const def of findAllByTag(root, 'CRotationDeformerSource')) {
    if (!def.attrs['xs.id']) continue;
    try {
      deformers.push(extractDeformer(def, 'rotation'));
    } catch (err) {
      warnings.push(`extractDeformer(rotation) failed for ${def.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }

  /** @type {ExtractedKeyformBinding[]} */
  const keyformBindings = [];
  for (const bind of findAllByTag(root, 'KeyformBindingSource')) {
    if (!bind.attrs['xs.id']) continue;
    try {
      keyformBindings.push(extractKeyformBinding(bind));
    } catch (err) {
      warnings.push(`extractKeyformBinding failed for ${bind.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }

  /** @type {ExtractedKeyformGrid[]} */
  const keyformGrids = [];
  for (const grid of findAllByTag(root, 'KeyformGridSource')) {
    if (!grid.attrs['xs.id']) continue;
    try {
      keyformGrids.push(extractKeyformGrid(grid));
    } catch (err) {
      warnings.push(`extractKeyformGrid failed for ${grid.attrs['xs.id']}: ${(err instanceof Error) ? err.message : String(err)}`);
    }
  }

  return { parts, groups, textures, deformers, keyformBindings, keyformGrids, warnings };
}
