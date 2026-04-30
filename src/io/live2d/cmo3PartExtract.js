// @ts-check
/**
 * .cmo3 part / group / texture / deformer extraction.
 *
 * Walks a parsed `main.xml` (see `cmo3XmlParser.js`) and pulls the data
 * a downstream importer needs to reconstruct an SS project skeleton +
 * rig graph: one record per `<CArtMeshSource>` (mesh), `<CPartSource>`
 * (group), `<GTexture2D>`, `<CWarpDeformerSource>` /
 * `<CRotationDeformerSource>`, `<KeyformBindingSource>`,
 * `<KeyformGridSource>`.
 *
 * What this module produces:
 *
 *   - ExtractedPart[]  — id, name, parent ref, base-mesh vertices in
 *                        canvas space, triangle indices, UVs, resolved
 *                        texture image-buffer index, clip mask refs,
 *                        deformer ref
 *   - ExtractedGroup[] — id, name, parent ref
 *   - ExtractedTexture[] — image-buffer index, file name, width/height
 *   - ExtractedDeformer[] — warp + rotation, with per-keyform positions
 *                            / angles / origins
 *   - ExtractedKeyformBinding[]/ExtractedKeyformGrid[] — the access-
 *                                                       keyed grid
 *                                                       cmo3 uses to
 *                                                       index keyforms
 *                                                       per parameter
 *                                                       tuple
 *
 * What it does NOT yet decode:
 *   - CPhysicsSettingsSource → physics rules
 *
 * @module io/live2d/cmo3PartExtract
 */

import { findAllByTag } from './cmo3PartExtract/xmlHelpers.js';
import {
  extractPart,
  extractGroup,
  extractTexture,
} from './cmo3PartExtract/drawableExtract.js';
import {
  extractDeformer,
  extractKeyformBinding,
  extractKeyformGrid,
} from './cmo3PartExtract/deformerExtract.js';

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
 * @property {string|null} ownDrawableGuidRef  this part's own CDrawableGuid xs.ref —
 *                                             clipMaskRefs from OTHER parts point here
 *                                             when this part acts as their mask. Joining
 *                                             clip refs back to parts requires this.
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
 * Extract every part / group / texture / deformer / binding / grid from
 * a parsed cmo3 main.xml.
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
