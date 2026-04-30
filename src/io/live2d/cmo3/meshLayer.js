// @ts-check

/**
 * Per-mesh layer-graph helpers — extracted from cmo3writer.js Section 2
 * (Phase 6 god-class breakup, sweep #28).
 *
 * Two functions, both pure XmlBuilder mutation:
 *
 *   - `emitMeshFilterGraph` — emits the per-mesh
 *     ModelImageFilterSet + 2 FilterInstance (CLayerSelector +
 *     CLayerFilter) + FilterOutputValueConnector + filterMap +
 *     externalInputs/Outputs. ~80 LOC of identical-shape boilerplate
 *     for every mesh.
 *
 *   - `emitMeshTexture` — emits the per-mesh GTexture2D +
 *     CTextureInputExtension + CTextureInput_ModelImage triplet that
 *     the CArtMeshSource references at the bottom.
 *
 * The two used to be separate inline blocks per mesh inside the
 * meshes loop in section 2; both depend only on shared filter pids
 * (filterValueIds + filterValues + filterDefs from globalSetup) +
 * per-mesh ids. They never touch the keyform/closure logic that
 * follows in the same loop.
 *
 * @module io/live2d/cmo3/meshLayer
 */

/**
 * Emit ModelImageFilterSet + child FilterInstances for one mesh.
 *
 * @param {Object} x
 * @param {Object} opts
 * @param {number} opts.mi                       Mesh index (used in filter id strings).
 * @param {Object} opts.filterDefs               { pidFdefSel, pidFdefFlt }.
 * @param {Object} opts.filterValueIds           Eight pids (pidFvid*).
 * @param {Object} opts.filterValues             Nine pids (pidFv*).
 * @returns {{ pidFset: string|number }}
 */
export function emitMeshFilterGraph(x, opts) {
  const { mi, filterDefs, filterValueIds, filterValues } = opts;
  const { pidFdefSel, pidFdefFlt } = filterDefs;
  const {
    pidFvidIlfOutput, pidFvidMiLayer, pidFvidIlfInput, pidFvidMiGuid,
    pidFvidIlfGuid, pidFvidMiOutImg, pidFvidMiOutXfm, pidFvidIlfInLayer,
  } = filterValueIds;
  const {
    pidFvSel, pidFvImp, pidFvImpSel, pidFvCurGuid, pidFvSelGuid,
    pidFvOutImg, pidFvOutImgRes, pidFvOutXfm, pidFvOutXfm2,
  } = filterValues;

  const [filterSet, pidFset] = x.shared('ModelImageFilterSet');
  const [, pidFiid0] = x.shared('FilterInstanceId', { idstr: `filter0_${mi}` });
  const [fiSelector, pidFiSel] = x.shared('FilterInstance', { filterName: 'CLayerSelector' });
  const [foutConn, pidFout] = x.shared('FilterOutputValueConnector');
  const [, pidFiid1] = x.shared('FilterInstanceId', { idstr: `filter1_${mi}` });
  const [fiFilter, pidFiFlt] = x.shared('FilterInstance', { filterName: 'CLayerFilter' });

  // FilterOutputValueConnector
  x.sub(foutConn, 'AValueConnector', { 'xs.n': 'super' });
  x.subRef(foutConn, 'FilterInstance', pidFiSel, { 'xs.n': 'instance' });
  x.subRef(foutConn, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'id' });
  x.subRef(foutConn, 'FilterValue', pidFvSel, { 'xs.n': 'valueDef' });

  // FilterInstance: CLayerSelector
  x.subRef(fiSelector, 'StaticFilterDefGuid', pidFdefSel, { 'xs.n': 'filterDefGuid' });
  x.sub(fiSelector, 'null', { 'xs.n': 'filterDef' });
  x.subRef(fiSelector, 'FilterInstanceId', pidFiid0, { 'xs.n': 'filterId' });
  const icSel = x.sub(fiSelector, 'hash_map', { 'xs.n': 'inputConnectors', count: '2' });
  const e1 = x.sub(icSel, 'entry');
  x.subRef(e1, 'FilterValueId', pidFvidIlfInput, { 'xs.n': 'key' });
  const evc1 = x.sub(e1, 'EnvValueConnector', { 'xs.n': 'value' });
  x.sub(evc1, 'AValueConnector', { 'xs.n': 'super' });
  x.subRef(evc1, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'envValueId' });
  const e2 = x.sub(icSel, 'entry');
  x.subRef(e2, 'FilterValueId', pidFvidIlfGuid, { 'xs.n': 'key' });
  const evc2 = x.sub(e2, 'EnvValueConnector', { 'xs.n': 'value' });
  x.sub(evc2, 'AValueConnector', { 'xs.n': 'super' });
  x.subRef(evc2, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'envValueId' });
  const ocSel = x.sub(fiSelector, 'hash_map', { 'xs.n': 'outputConnectors', count: '1' });
  const e3 = x.sub(ocSel, 'entry');
  x.subRef(e3, 'FilterValueId', pidFvidIlfOutput, { 'xs.n': 'key' });
  x.subRef(e3, 'FilterOutputValueConnector', pidFout, { 'xs.n': 'value' });
  x.subRef(fiSelector, 'ModelImageFilterSet', pidFset, { 'xs.n': 'ownerFilterSet' });

  // FilterInstance: CLayerFilter
  x.subRef(fiFilter, 'StaticFilterDefGuid', pidFdefFlt, { 'xs.n': 'filterDefGuid' });
  x.sub(fiFilter, 'null', { 'xs.n': 'filterDef' });
  x.subRef(fiFilter, 'FilterInstanceId', pidFiid1, { 'xs.n': 'filterId' });
  const icFlt = x.sub(fiFilter, 'hash_map', { 'xs.n': 'inputConnectors', count: '1' });
  const e4 = x.sub(icFlt, 'entry');
  x.subRef(e4, 'FilterValueId', pidFvidIlfInLayer, { 'xs.n': 'key' });
  x.subRef(e4, 'FilterOutputValueConnector', pidFout, { 'xs.n': 'value' });
  x.sub(fiFilter, 'hash_map', { 'xs.n': 'outputConnectors', count: '0', keyType: 'string' });
  x.subRef(fiFilter, 'ModelImageFilterSet', pidFset, { 'xs.n': 'ownerFilterSet' });

  // Fill ModelImageFilterSet
  const fsSuper = x.sub(filterSet, 'FilterSet', { 'xs.n': 'super' });
  const fm = x.sub(fsSuper, 'linked_map', { 'xs.n': 'filterMap', count: '2' });
  const fmE1 = x.sub(fm, 'entry');
  x.subRef(fmE1, 'FilterInstanceId', pidFiid0, { 'xs.n': 'key' });
  x.subRef(fmE1, 'FilterInstance', pidFiSel, { 'xs.n': 'value' });
  const fmE2 = x.sub(fm, 'entry');
  x.subRef(fmE2, 'FilterInstanceId', pidFiid1, { 'xs.n': 'key' });
  x.subRef(fmE2, 'FilterInstance', pidFiFlt, { 'xs.n': 'value' });

  // _externalInputs
  const ei = x.sub(fsSuper, 'linked_map', { 'xs.n': '_externalInputs', count: '2' });
  const eiE1 = x.sub(ei, 'entry');
  x.subRef(eiE1, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'key' });
  const ec1 = x.sub(eiE1, 'EnvConnection', { 'xs.n': 'value' });
  x.subRef(ec1, 'FilterValue', pidFvImp, { 'xs.n': '_envValueDef' });
  x.subRef(ec1, 'FilterInstance', pidFiSel, { 'xs.n': 'filter' });
  x.subRef(ec1, 'FilterValue', pidFvImpSel, { 'xs.n': 'filterValueDef' });
  const eiE2 = x.sub(ei, 'entry');
  x.subRef(eiE2, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'key' });
  const ec2 = x.sub(eiE2, 'EnvConnection', { 'xs.n': 'value' });
  x.subRef(ec2, 'FilterValue', pidFvCurGuid, { 'xs.n': '_envValueDef' });
  x.subRef(ec2, 'FilterInstance', pidFiSel, { 'xs.n': 'filter' });
  x.subRef(ec2, 'FilterValue', pidFvSelGuid, { 'xs.n': 'filterValueDef' });

  // _externalOutputs
  const eo = x.sub(fsSuper, 'linked_map', { 'xs.n': '_externalOutputs', count: '2' });
  const eoE1 = x.sub(eo, 'entry');
  x.subRef(eoE1, 'FilterValueId', pidFvidMiOutImg, { 'xs.n': 'key' });
  const ec3 = x.sub(eoE1, 'EnvConnection', { 'xs.n': 'value' });
  x.subRef(ec3, 'FilterValue', pidFvOutImg, { 'xs.n': '_envValueDef' });
  x.subRef(ec3, 'FilterInstance', pidFiFlt, { 'xs.n': 'filter' });
  x.subRef(ec3, 'FilterValue', pidFvOutImgRes, { 'xs.n': 'filterValueDef' });
  const eoE2 = x.sub(eo, 'entry');
  x.subRef(eoE2, 'FilterValueId', pidFvidMiOutXfm, { 'xs.n': 'key' });
  const ec4 = x.sub(eoE2, 'EnvConnection', { 'xs.n': 'value' });
  x.subRef(ec4, 'FilterValue', pidFvOutXfm, { 'xs.n': '_envValueDef' });
  x.subRef(ec4, 'FilterInstance', pidFiFlt, { 'xs.n': 'filter' });
  x.subRef(ec4, 'FilterValue', pidFvOutXfm2, { 'xs.n': 'filterValueDef' });

  return { pidFset };
}

/**
 * Fill the shared CLayerGroup + CLayeredImage XML nodes after every
 * per-mesh CLayer has been emitted (Section 2b).
 *
 * Both nodes are created shared at the START of Section 2 (caller
 * passes the element refs in here); their child lists reference each
 * mesh's CLayer pid collected in `layerRefs` during the meshes loop.
 *
 * @param {Object} x
 * @param {Object} opts
 * @param {Object} opts.layerGroup           CLayerGroup element (already shared).
 * @param {Object} opts.layeredImg           CLayeredImage element (already shared).
 * @param {string|number} opts.pidLg
 * @param {string|number} opts.pidLi
 * @param {string|number} opts.pidLiGuid
 * @param {string|number} opts.pidBlend
 * @param {Function} opts.uuid               UUID generator (writer's `uuid` from xmlbuilder).
 * @param {Array<{pidLayer: string|number}>} opts.layerRefs
 * @param {number} opts.canvasW
 * @param {number} opts.canvasH
 */
export function fillLayerGroupAndImage(x, opts) {
  const {
    layerGroup, layeredImg, pidLg, pidLi, pidLiGuid, pidBlend,
    uuid, layerRefs, canvasW, canvasH,
  } = opts;
  const nLayers = layerRefs.length;

  // CLayerGroup (root containing all layers)
  const alg = x.sub(layerGroup, 'ACLayerGroup', { 'xs.n': 'super' });
  const ale2 = x.sub(alg, 'ACLayerEntry', { 'xs.n': 'super' });
  x.sub(ale2, 's', { 'xs.n': 'name' }).text = 'root';
  x.sub(ale2, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(ale2, 'b', { 'xs.n': 'isVisible' }).text = 'true';
  x.sub(ale2, 'b', { 'xs.n': 'isClipping' }).text = 'false';
  x.subRef(ale2, 'CBlend_Normal', pidBlend, { 'xs.n': 'blend' });
  x.sub(ale2, 'CLayerGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
  x.sub(ale2, 'null', { 'xs.n': 'group' });
  x.sub(ale2, 'i', { 'xs.n': 'opacity255' }).text = '255';
  x.sub(ale2, 'hash_map', { 'xs.n': '_optionOfIOption', count: '0', keyType: 'string' });
  x.subRef(ale2, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
  const childrenLg = x.sub(alg, 'carray_list', { 'xs.n': '_children', count: String(nLayers) });
  for (const lr of layerRefs) x.subRef(childrenLg, 'CLayer', lr.pidLayer);
  x.sub(layerGroup, 'null', { 'xs.n': 'layerIdentifier' });

  // CLayeredImage (single fake "PSD")
  x.sub(layeredImg, 's', { 'xs.n': 'name' }).text = 'fake_psd.psd';
  x.sub(layeredImg, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(layeredImg, 'i', { 'xs.n': 'width' }).text = String(canvasW);
  x.sub(layeredImg, 'i', { 'xs.n': 'height' }).text = String(canvasH);
  x.sub(layeredImg, 'file', { 'xs.n': 'psdFile' }).text = 'fake_psd.psd';
  x.sub(layeredImg, 's', { 'xs.n': 'description' }).text = '';
  x.subRef(layeredImg, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'guid' });
  x.sub(layeredImg, 'null', { 'xs.n': 'psdBytes' });
  x.sub(layeredImg, 'l', { 'xs.n': 'psdFileLastModified' }).text = '0';
  x.subRef(layeredImg, 'CLayerGroup', pidLg, { 'xs.n': '_rootLayer' });
  const layerSet = x.sub(layeredImg, 'LayerSet', { 'xs.n': 'layerSet' });
  x.subRef(layerSet, 'CLayeredImage', pidLi, { 'xs.n': '_layeredImage' });
  const lsList = x.sub(layerSet, 'carray_list', { 'xs.n': '_layerEntryList', count: String(nLayers + 1) });
  x.subRef(lsList, 'CLayerGroup', pidLg);
  for (const lr of layerRefs) x.subRef(lsList, 'CLayer', lr.pidLayer);
  x.sub(layeredImg, 'null', { 'xs.n': 'icon16' });
  x.sub(layeredImg, 'null', { 'xs.n': 'icon64' });
}

/**
 * Emit GTexture2D + CTextureInputExtension + CTextureInput_ModelImage
 * for one mesh. The triplet links the mesh's CImageResource +
 * CModelImageGuid through the texture-input plumbing the
 * CArtMeshSource references via its `tieSup` extension below.
 *
 * @param {Object} x
 * @param {Object} opts
 * @param {string} opts.meshName
 * @param {string|number} opts.pidImg          CImageResource pid.
 * @param {string|number} opts.pidTexGuid      GTextureGuid pid.
 * @param {string|number} opts.pidExtTex       CExtensionGuid pid for the extension.
 * @param {string|number} opts.pidMiGuid       CModelImageGuid pid.
 * @returns {{ pidTex2d: string|number, pidTie: string|number, pidTimi: string|number, tieSup: Object }}
 */
export function emitMeshTexture(x, opts) {
  const { meshName, pidImg, pidTexGuid, pidExtTex, pidMiGuid } = opts;

  // GTexture2D
  const [tex2d, pidTex2d] = x.shared('GTexture2D');
  const gtex = x.sub(tex2d, 'GTexture', { 'xs.n': 'super' });
  x.sub(gtex, 's', { 'xs.n': 'name' }).text = meshName;
  x.sub(gtex, 'WrapMode', { 'xs.n': 'wrapMode', v: 'CLAMP_TO_BORDER' });
  const fmTex = x.sub(gtex, 'FilterMode', { 'xs.n': 'filterMode' });
  x.subRef(fmTex, 'GTexture2D', pidTex2d, { 'xs.n': 'owner' });
  x.sub(fmTex, 'MinFilter', { 'xs.n': 'minFilter', v: 'LINEAR_MIPMAP_LINEAR' });
  x.sub(fmTex, 'MagFilter', { 'xs.n': 'magFilter', v: 'LINEAR' });
  x.subRef(gtex, 'GTextureGuid', pidTexGuid, { 'xs.n': 'guid' });
  x.sub(gtex, 'Anisotropy', { 'xs.n': 'anisotropy', v: 'ON' });
  x.subRef(tex2d, 'CImageResource', pidImg, { 'xs.n': 'srcImageResource' });
  x.sub(tex2d, 'CAffine', {
    'xs.n': 'transformImageResource01toLogical01',
    m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
  });
  x.sub(tex2d, 'i', { 'xs.n': 'mipmapLevel' }).text = '1';
  x.sub(tex2d, 'b', { 'xs.n': 'isPremultiplied' }).text = 'true';

  // CTextureInputExtension + CTextureInput_ModelImage
  const [texInputExt, pidTie] = x.shared('CTextureInputExtension');
  const [texInputMi, pidTimi] = x.shared('CTextureInput_ModelImage');

  const ati = x.sub(texInputMi, 'ACTextureInput', { 'xs.n': 'super' });
  x.sub(ati, 'CAffine', {
    'xs.n': 'optionalTransformOnCanvas',
    m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
  });
  x.subRef(ati, 'CTextureInputExtension', pidTie, { 'xs.n': '_owner' });
  x.subRef(texInputMi, 'CModelImageGuid', pidMiGuid, { 'xs.n': '_modelImageGuid' });

  const tieSup = x.sub(texInputExt, 'ACExtension', { 'xs.n': 'super' });
  x.subRef(tieSup, 'CExtensionGuid', pidExtTex, { 'xs.n': 'guid' });
  const tieInputs = x.sub(texInputExt, 'carray_list', { 'xs.n': '_textureInputs', count: '1' });
  x.subRef(tieInputs, 'CTextureInput_ModelImage', pidTimi);
  x.subRef(texInputExt, 'CTextureInput_ModelImage', pidTimi, { 'xs.n': 'currentTextureInputData' });

  return { pidTex2d, pidTie, pidTimi, tieSup };
}
