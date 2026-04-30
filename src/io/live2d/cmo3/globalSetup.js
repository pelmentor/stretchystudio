// @ts-check

import { uuid } from '../xmlbuilder.js';
import {
  FILTER_DEF_LAYER_SELECTOR,
  FILTER_DEF_LAYER_FILTER,
  DEFORMER_ROOT_UUID,
  PARAM_GROUP_ROOT_UUID,
} from './constants.js';
import { buildParameterSpec } from '../rig/paramSpec.js';

/**
 * Shared XML-object setup for the .cmo3 generator's Section 1.
 *
 * Lifted out of `cmo3writer.js` (Phase 6 god-class breakup, sweep #27);
 * pure XmlBuilder mutation + pid extraction, no rigSpec or coord-space
 * logic. The downstream sections (2…6) read the returned bundle via
 * destructuring instead of the original 30+ closure constants.
 *
 * Three logical groups bundled in one function — they all run as a
 * single setup pass before any per-mesh work:
 *
 *   1. **Core GUIDs** — root parameter group (well-known UUID), model
 *      GUID, root part GUID, blend mode, deformer ROOT + null sentinel,
 *      CoordType. Foundational refs that every mesh ends up touching.
 *
 *   2. **Param-derived state** — runs `buildParameterSpec` then
 *      materialises one `CParameterGuid` per spec. Returns the mutable
 *      `paramDefs` array (downstream pushes group-rotation params),
 *      ParamOpacity convenience handle, baked-angle bounds, and the
 *      `boneParamGuids` Map (jointBoneId → {pidParam, paramId}).
 *
 *   3. **Group→Part GUIDs** + **Filter graph pids** (StaticFilterDefGuid
 *      ×2, FilterValueId ×8, FilterValue ×9). Filter pids feed into
 *      every per-mesh CLayer + CTextureInputExtension graph in section 2.
 *
 * @module io/live2d/cmo3/globalSetup
 */

/**
 * @typedef {Object} ParamDef
 * @property {string|number} pid       Per-CParameterGuid pid.
 * @property {string} id               ParamX / ParamRotation_arm / ...
 * @property {string} name             Display name.
 * @property {number} min
 * @property {number} max
 * @property {number} defaultVal       Stored under legacy `defaultVal`
 *                                     name — downstream emission reads it.
 * @property {number} decimalPlaces
 * @property {string} role             'opacity' | 'standard' | 'bone' | …
 * @property {string} [category]       Filled by paramCategories pass.
 * @property {string|number} [pidId]   Filled by section 6 (CParameterId).
 */

/**
 * @typedef {Object} GroupLike
 * @property {string} id
 * @property {string} [name]
 * @property {string|null} [parent]
 */

/**
 * @typedef {Object} GlobalSharedSetup
 * @property {string|number} pidParamGroupGuid
 * @property {string|number} pidModelGuid
 * @property {string|number} pidPartGuid
 * @property {Object} blendNormal             XML element ref for CBlend_Normal.
 * @property {string|number} pidBlend
 * @property {string|number} pidDeformerRoot
 * @property {string|number} pidDeformerNull
 * @property {Object} coordType                XML element ref for CoordType.
 * @property {string|number} pidCoord
 * @property {ParamDef[]} paramDefs            Mutable.
 * @property {Object[]} paramSpecs             Read-only.
 * @property {string|number} pidParamOpacity
 * @property {number[]} bakedAngles
 * @property {number} bakedAngleMin
 * @property {number} bakedAngleMax
 * @property {Map<string, {pidParam: string|number, paramId: string}>} boneParamGuids
 * @property {Map<string, string|number>} groupPartGuids
 * @property {string|number} pidFdefSel
 * @property {string|number} pidFdefFlt
 * @property {Object} filterValueIds           ilfOutput / miLayer / ilfInput / miGuid / ilfGuid / miOutImg / miOutXfm / ilfInLayer.
 * @property {Object} filterValues             pidFvSel / pidFvImp / pidFvImpSel / pidFvCurGuid / pidFvSelGuid / pidFvOutImg / pidFvOutImgRes / pidFvOutXfm / pidFvOutXfm2.
 */

/**
 * Build all global shared XML objects.
 *
 * @param {Object} x                            XmlBuilder instance.
 * @param {Object} opts
 * @param {Array} opts.parameters
 * @param {Array} opts.meshes
 * @param {GroupLike[]} opts.groups
 * @param {boolean} opts.generateRig
 * @param {number[]} opts.bakedKeyformAngles
 * @param {Object} opts.rotationDeformerConfig
 * @returns {GlobalSharedSetup}
 */
export function setupGlobalSharedObjects(x, opts) {
  const { parameters, meshes, groups, generateRig, bakedKeyformAngles, rotationDeformerConfig } = opts;

  // ── Core GUIDs ────────────────────────────────────────────────────
  // Root parameter group uses a well-known UUID hardcoded in the Editor
  // Java (`CParameterGroupGuid.Companion.b()`); the Random Pose dialog
  // searches by value, so a random UUID renders the dialog empty.
  const [, pidParamGroupGuid] = x.shared('CParameterGroupGuid', {
    uuid: PARAM_GROUP_ROOT_UUID, note: 'Root Parameter Group',
  });
  const [, pidModelGuid] = x.shared('CModelGuid', { uuid: uuid(), note: 'model' });
  const [, pidPartGuid] = x.shared('CPartGuid', { uuid: uuid(), note: '__RootPart__' });

  // CBlend_Normal (shared blend mode used by every layer + every mesh)
  const [blendNormal, pidBlend] = x.shared('CBlend_Normal');
  const abl = x.sub(blendNormal, 'ACBlend', { 'xs.n': 'super' });
  x.sub(abl, 's', { 'xs.n': 'displayName' }).text = '通常'; // 通常 (Normal)

  // CDeformerGuid sentinels — ROOT (well-known UUID) + zero-UUID null
  // for parts' targetDeformerGuid (Hiyori pattern).
  const [, pidDeformerRoot] = x.shared('CDeformerGuid', {
    uuid: DEFORMER_ROOT_UUID, note: 'ROOT',
  });
  const [, pidDeformerNull] = x.shared('CDeformerGuid', {
    uuid: '00000000-0000-0000-0000-000000000000', note: 'NOT INITIALIZED',
  });

  // CoordType — labelled `DeformerLocal`. Despite the name it's just a
  // tag; the actual coord scale depends on the parent deformer kind
  // (root → canvas-px, warp → 0..1, rotation → pivot-relative px).
  const [coordType, pidCoord] = x.shared('CoordType');
  x.sub(coordType, 's', { 'xs.n': 'coordName' }).text = 'DeformerLocal';

  // ── Param-derived state ──────────────────────────────────────────
  const paramSpecs = buildParameterSpec({
    baseParameters: parameters,
    meshes,
    groups,
    generateRig,
    bakedKeyformAngles,
    rotationDeformerConfig,
  });

  // Materialise paramDefs by attaching the cmo3-specific XML pid to
  // each spec. Legacy `defaultVal` field name preserved (downstream
  // parameter-source emission reads it).
  /** @type {ParamDef[]} */
  const paramDefs = paramSpecs.map(spec => {
    const [, pid] = x.shared('CParameterGuid', { uuid: uuid(), note: spec.id });
    return {
      pid,
      id: spec.id,
      name: spec.name,
      min: spec.min,
      max: spec.max,
      defaultVal: spec.default,
      decimalPlaces: spec.decimalPlaces,
      role: spec.role,
    };
  });

  // ParamOpacity is always present at index 0 (paramSpec.js contract).
  const pidParamOpacity = paramDefs[0].pid;
  const bakedAngles = bakedKeyformAngles;
  const bakedAngleMin = bakedAngles[0];
  const bakedAngleMax = bakedAngles[bakedAngles.length - 1];

  // bone-role → pid map for keyform binding hookup downstream.
  const boneParamGuids = new Map();
  for (const pd of paramDefs) {
    if (pd.role !== 'bone') continue;
    const spec = paramSpecs.find(s => s.id === pd.id);
    if (spec?.boneId) {
      boneParamGuids.set(spec.boneId, { pidParam: pd.pid, paramId: pd.id });
    }
  }

  // ── Group → CPartGuid mapping ────────────────────────────────────
  const groupPartGuids = new Map();
  for (const g of groups) {
    const [, gpid] = x.shared('CPartGuid', { uuid: uuid(), note: g.name || g.id });
    groupPartGuids.set(g.id, gpid);
  }

  // ── Filter graph pids ────────────────────────────────────────────
  // Same 19 shared objects (2 def + 8 id + 9 value) on every cmo3 ever.
  const [, pidFdefSel] = x.shared('StaticFilterDefGuid', {
    uuid: FILTER_DEF_LAYER_SELECTOR, note: 'CLayerSelector',
  });
  const [, pidFdefFlt] = x.shared('StaticFilterDefGuid', {
    uuid: FILTER_DEF_LAYER_FILTER, note: 'CLayerFilter',
  });

  const [, pidFvidIlfOutput]  = x.shared('FilterValueId', { idstr: 'ilf_outputLayerData' });
  const [, pidFvidMiLayer]    = x.shared('FilterValueId', { idstr: 'mi_input_layerInputData' });
  const [, pidFvidIlfInput]   = x.shared('FilterValueId', { idstr: 'ilf_inputLayerData' });
  const [, pidFvidMiGuid]     = x.shared('FilterValueId', { idstr: 'mi_currentImageGuid' });
  const [, pidFvidIlfGuid]    = x.shared('FilterValueId', { idstr: 'ilf_currentImageGuid' });
  const [, pidFvidMiOutImg]   = x.shared('FilterValueId', { idstr: 'mi_output_image' });
  const [, pidFvidMiOutXfm]   = x.shared('FilterValueId', { idstr: 'mi_output_transform' });
  const [, pidFvidIlfInLayer] = x.shared('FilterValueId', { idstr: 'ilf_inputLayer' });

  const filterValueIds = {
    pidFvidIlfOutput, pidFvidMiLayer, pidFvidIlfInput, pidFvidMiGuid,
    pidFvidIlfGuid, pidFvidMiOutImg, pidFvidMiOutXfm, pidFvidIlfInLayer,
  };

  /** Helper: emit a FilterValue with a shared FilterValueId reference. */
  const fv = (name, valueIdPid) => {
    const [n, pid] = x.shared('FilterValue');
    x.sub(n, 's', { 'xs.n': 'name' }).text = name;
    x.subRef(n, 'FilterValueId', valueIdPid, { 'xs.n': 'id' });
    x.sub(n, 'null', { 'xs.n': 'defaultValueInitializer' });
    return pid;
  };
  /** Helper: emit a FilterValue with an INLINE FilterValueId (not a ref). */
  const fvInline = (name, idstr) => {
    const [n, pid] = x.shared('FilterValue');
    x.sub(n, 's', { 'xs.n': 'name' }).text = name;
    x.sub(n, 'FilterValueId', { 'xs.n': 'id', idstr });
    x.sub(n, 'null', { 'xs.n': 'defaultValueInitializer' });
    return pid;
  };

  const pidFvSel       = fv('Select Layer',                       pidFvidIlfOutput);
  const pidFvImp       = fv('Import Layer',                       pidFvidMiLayer);
  const pidFvImpSel    = fv('Import Layer selection',             pidFvidIlfInput);
  const pidFvCurGuid   = fv('Current GUID',                       pidFvidMiGuid);
  const pidFvSelGuid   = fv('GUID of Selected Source Image',      pidFvidIlfGuid);
  const pidFvOutImg    = fv('Output image',                       pidFvidMiOutImg);
  const pidFvOutImgRes = fvInline('Output Image (Resource Format)', 'ilf_outputImageRes');
  const pidFvOutXfm    = fv('LayerToCanvas変換',          pidFvidMiOutXfm); // 変換
  const pidFvOutXfm2   = fvInline('LayerToCanvas変換',     'ilf_outputTransform');

  const filterValues = {
    pidFvSel, pidFvImp, pidFvImpSel, pidFvCurGuid, pidFvSelGuid,
    pidFvOutImg, pidFvOutImgRes, pidFvOutXfm, pidFvOutXfm2,
  };

  return {
    pidParamGroupGuid, pidModelGuid, pidPartGuid,
    blendNormal, pidBlend,
    pidDeformerRoot, pidDeformerNull,
    coordType, pidCoord,
    paramDefs, paramSpecs,
    pidParamOpacity, bakedAngles, bakedAngleMin, bakedAngleMax, boneParamGuids,
    groupPartGuids,
    pidFdefSel, pidFdefFlt,
    filterValueIds, filterValues,
  };
}
