// @ts-check

/**
 * CModelImageGroup emission for the .cmo3 generator's Section 5.
 *
 * One CModelImageGroup contains every per-mesh CModelImage (the
 * filter-graph instance for that mesh's layer). The group itself is
 * shared; each CModelImage references the shared CLayeredImage's GUID
 * and wires its filter set + layer to the texture pipeline.
 *
 * Lifted out of `cmo3writer.js` (Phase 6 god-class breakup, sweep #27);
 * pure XmlBuilder mutation.
 *
 * @module io/live2d/cmo3/modelImageGroup
 */

/**
 * @typedef {Object} ModelImageMeshEntry
 * @property {string|number} pidMiGuid    CModelImageGuid pid for this mesh.
 * @property {string} meshName            Display name (also goes into LayerInputData).
 * @property {string|number} pidFset      ModelImageFilterSet pid.
 * @property {string|number} pidLayer     CLayer pid.
 * @property {string|number} pidImg       CImageResource pid.
 */

/**
 * Emit a single CModelImageGroup whose `_modelImages` carries one
 * CModelImage per mesh. Returns the group's pid for downstream
 * CTextureManager wiring.
 *
 * @param {Object} x                          XmlBuilder.
 * @param {Object} opts
 * @param {ModelImageMeshEntry[]} opts.perMesh
 * @param {string|number} opts.pidLiGuid       Shared CLayeredImageGuid.
 * @param {string|number} opts.pidFvidMiGuid   Filter-value-id "mi_currentImageGuid".
 * @param {string|number} opts.pidFvidMiLayer  Filter-value-id "mi_input_layerInputData".
 * @param {number} opts.canvasW
 * @param {number} opts.canvasH
 * @param {string} [opts.groupName='stretchy_export']
 * @returns {{ pidImgGrp: string|number }}
 */
export function emitModelImageGroup(x, opts) {
  const {
    perMesh, pidLiGuid, pidFvidMiGuid, pidFvidMiLayer,
    canvasW, canvasH, groupName = 'stretchy_export',
  } = opts;

  const [imgGroup, pidImgGrp] = x.shared('CModelImageGroup');
  x.sub(imgGroup, 's', { 'xs.n': 'memo' }).text = '';
  x.sub(imgGroup, 's', { 'xs.n': 'groupName' }).text = groupName;
  const liGuids = x.sub(imgGroup, 'carray_list', {
    'xs.n': '_linkedRawImageGuids', count: '1',
  });
  x.subRef(liGuids, 'CLayeredImageGuid', pidLiGuid);

  const miList = x.sub(imgGroup, 'carray_list', {
    'xs.n': '_modelImages', count: String(perMesh.length),
  });

  for (const pm of perMesh) {
    const mi = x.sub(miList, 'CModelImage', { modelImageVersion: '0' });
    x.subRef(mi, 'CModelImageGuid', pm.pidMiGuid, { 'xs.n': 'guid' });
    x.sub(mi, 's', { 'xs.n': 'name' }).text = pm.meshName;
    x.subRef(mi, 'ModelImageFilterSet', pm.pidFset, { 'xs.n': 'inputFilter' });

    // inputFilterEnv — wires filter inputs to the layered image + this mesh's layer.
    const mife = x.sub(mi, 'ModelImageFilterEnv', { 'xs.n': 'inputFilterEnv' });
    const fe = x.sub(mife, 'FilterEnv', { 'xs.n': 'super' });
    x.sub(fe, 'null', { 'xs.n': 'parentEnv' });
    const envMap = x.sub(fe, 'hash_map', { 'xs.n': 'envValues', count: '2' });

    // mi_currentImageGuid → CLayeredImageGuid
    const envE1 = x.sub(envMap, 'entry');
    x.subRef(envE1, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'key' });
    const evs1 = x.sub(envE1, 'EnvValueSet', { 'xs.n': 'value' });
    x.subRef(evs1, 'FilterValueId', pidFvidMiGuid, { 'xs.n': 'id' });
    x.subRef(evs1, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'value' });
    x.sub(evs1, 'l', { 'xs.n': 'updateTimeMs' }).text = '0';

    // mi_input_layerInputData → CLayerSelectorMap pointing at this mesh's CLayer
    const envE2 = x.sub(envMap, 'entry');
    x.subRef(envE2, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'key' });
    const evs2 = x.sub(envE2, 'EnvValueSet', { 'xs.n': 'value' });
    x.subRef(evs2, 'FilterValueId', pidFvidMiLayer, { 'xs.n': 'id' });
    const lsm = x.sub(evs2, 'CLayerSelectorMap', { 'xs.n': 'value' });
    const itli = x.sub(lsm, 'linked_map', { 'xs.n': '_imageToLayerInput', count: '1' });
    const itliE = x.sub(itli, 'entry');
    x.subRef(itliE, 'CLayeredImageGuid', pidLiGuid, { 'xs.n': 'key' });
    const itliV = x.sub(itliE, 'array_list', { 'xs.n': 'value', count: '1' });
    const lidData = x.sub(itliV, 'CLayerInputData');
    x.subRef(lidData, 'CLayer', pm.pidLayer, { 'xs.n': 'layer' });
    x.sub(lidData, 'CAffine', {
      'xs.n': 'affine',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.sub(lidData, 'null', { 'xs.n': 'clippingOnTexturePx' });
    x.sub(evs2, 'l', { 'xs.n': 'updateTimeMs' }).text = '0';

    // _filteredImage + back-refs.
    x.subRef(mi, 'CImageResource', pm.pidImg, { 'xs.n': '_filteredImage' });
    x.sub(mi, 'null', { 'xs.n': 'icon16' });
    x.sub(mi, 'CAffine', {
      'xs.n': '_materialLocalToCanvasTransform',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.subRef(mi, 'CModelImageGroup', pidImgGrp, { 'xs.n': '_group' });
    const miLrig = x.sub(mi, 'carray_list', { 'xs.n': 'linkedRawImageGuids', count: '1' });
    x.subRef(miLrig, 'CLayeredImageGuid', pidLiGuid);

    // CCachedImageManager (single cached image per mesh, no mipmap).
    const cim = x.sub(mi, 'CCachedImageManager', { 'xs.n': 'cachedImageManager' });
    x.sub(cim, 'CachedImageType', { 'xs.n': 'defaultCacheType', v: 'SCALE_1' });
    x.subRef(cim, 'CImageResource', pm.pidImg, { 'xs.n': 'rawImage' });
    const ciList = x.sub(cim, 'array_list', { 'xs.n': 'cachedImages', count: '1' });
    const ci = x.sub(ciList, 'CCachedImage');
    x.subRef(ci, 'CImageResource', pm.pidImg, { 'xs.n': '_cachedImageResource' });
    x.sub(ci, 'b', { 'xs.n': 'isSharedImage' }).text = 'true';
    x.sub(ci, 'CSize', { 'xs.n': 'rawImageSize', width: String(canvasW), height: String(canvasH) });
    x.sub(ci, 'i', { 'xs.n': 'reductionRatio' }).text = '1';
    x.sub(ci, 'i', { 'xs.n': 'mipmapLevel' }).text = '1';
    x.sub(ci, 'b', { 'xs.n': 'hasMargin' }).text = 'false';
    x.sub(ci, 'b', { 'xs.n': 'isCleaned' }).text = 'false';
    x.sub(ci, 'CAffine', {
      'xs.n': 'transformRawImageToCachedImage',
      m00: '1.0', m01: '0.0', m02: '0.0', m10: '0.0', m11: '1.0', m12: '0.0',
    });
    x.sub(cim, 'i', { 'xs.n': 'requiredMipmapLevel' }).text = '1';

    x.sub(mi, 's', { 'xs.n': 'memo' }).text = '';
  }

  return { pidImgGrp };
}
