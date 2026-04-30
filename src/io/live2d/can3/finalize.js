// @ts-nocheck
/**
 * .can3 finalize: CResourceManager + shared CAnimation + main.xml + CAFF.
 *
 * Runs after all scenes have been emitted. Three responsibilities:
 *   1. Build CResourceManager linking the .cmo3 model file (CResourceData
 *      + CResourceGroup + CResource_Linked_Model + GUID maps).
 *   2. Build the shared CAnimation owning every scene + scene-blending
 *      playlist, and patch each scene's `_animation` null-placeholder to
 *      reference it.
 *   3. Assemble main.xml (shared block + main reference to CAnimation),
 *      serialize via XmlBuilder, and pack into the CAFF archive.
 *
 * @module io/live2d/can3/finalize
 */

import { uuid } from '../xmlbuilder.js';
import { packCaff, COMPRESS_FAST } from '../caffPacker.js';
import { VERSION_PIS, IMPORT_PIS } from './constants.js';

/**
 * @param {object} x XmlBuilder
 * @param {object} args
 * @param {string|number} args.pidResourceGuid
 * @param {string} args.cmo3FileName
 * @param {string} args.modelName
 * @param {Array<string|number>} args.sceneRefs
 * @param {Array<string|number>} args.sceneGuids
 * @param {Array<{scene:object, placeholder:object}>} args.sceneAnimPlaceholders
 * @returns {Promise<Uint8Array>} .can3 CAFF archive
 */
export function finalizeCan3(x, args) {
  const {
    pidResourceGuid, cmo3FileName, modelName,
    sceneRefs, sceneGuids, sceneAnimPlaceholders,
  } = args;

  // ---- CResourceManager ----
  const [resMgr, pidResMgr] = x.shared('CResourceManager');
  const [, pidResGroupGuid] = x.shared('CResourceGroupGuid', { uuid: uuid(), note: 'Root Resource Group' });
  const resGroup = x.sub(resMgr, 'CResourceGroup', { 'xs.n': 'rootGroup' });
  const resGroupSup = x.sub(resGroup, 'ACResourceEntry', { 'xs.n': 'super' });
  x.sub(resGroupSup, 'null', { 'xs.n': 'parentGuid' });
  x.subRef(resGroupSup, 'CResourceManager', pidResMgr, { 'xs.n': '_resourceManager' });
  x.subRef(resGroup, 'CResourceGroupGuid', pidResGroupGuid, { 'xs.n': 'guid' });
  const resChildren = x.sub(resGroup, 'carray_list', { 'xs.n': '_childGuids', count: '1' });
  x.subRef(resChildren, 'CResourceGuid', pidResourceGuid);
  x.sub(resGroup, 's', { 'xs.n': 'name' }).text = 'Resources';

  const resRefList = x.sub(resMgr, 'carray_list', { 'xs.n': '_resourceRefList', count: '1' });
  const [resData, pidResData] = x.shared('CResourceData');
  x.subRef(resRefList, 'CResourceData', pidResData);
  const resDataSup = x.sub(resData, 'ACResourceEntry', { 'xs.n': 'super' });
  x.subRef(resDataSup, 'CResourceGroupGuid', pidResGroupGuid, { 'xs.n': 'parentGuid' });
  x.subRef(resDataSup, 'CResourceManager', pidResMgr, { 'xs.n': '_resourceManager' });
  x.sub(resData, 'null', { 'xs.n': 'customName' });
  const resRef = x.sub(resData, 'CResource_Linked_Model', { 'xs.n': 'resourceRef' });
  const resFile = x.sub(resRef, 'ACResource_File', { 'xs.n': 'super' });
  x.sub(resFile, 'file', { 'xs.n': 'srcFile' }).text = cmo3FileName;
  x.subRef(resFile, 'CResourceGuid', pidResourceGuid, { 'xs.n': 'guid' });
  x.sub(resFile, 's', { 'xs.n': 'name' }).text = cmo3FileName;

  const resGuidMap = x.sub(resMgr, 'hash_map', { 'xs.n': 'resourceGuidMap', count: '1' });
  const rgmEntry = x.sub(resGuidMap, 'entry');
  x.subRef(rgmEntry, 'CResourceGuid', pidResourceGuid, { 'xs.n': 'key' });
  x.subRef(rgmEntry, 'CResourceData', pidResData, { 'xs.n': 'value' });
  x.sub(resMgr, 'carray_list', { 'xs.n': '_resourceGroupList', count: '0' });
  x.sub(resMgr, 'hash_map', { 'xs.n': 'resourceGroupGuidMap', count: '0', keyType: 'string' });
  if (sceneRefs.length > 0) {
    x.subRef(resMgr, 'CSceneSource', sceneRefs[sceneRefs.length - 1], { 'xs.n': '_sceneSource' });
  }

  // ---- CAnimation (shared; main section references it) ----
  const [animation, pidAnimation] = x.shared('CAnimation');
  x.sub(animation, 's', { 'xs.n': 'name' }).text = modelName;
  x.sub(animation, 'file', { 'xs.n': 'file' }).text = `${modelName}.can3`;
  const scenesArr = x.sub(animation, 'carray_list', {
    'xs.n': '_scenes', count: String(sceneRefs.length),
  });
  for (const pid of sceneRefs) {
    x.subRef(scenesArr, 'CSceneSource', pid);
  }
  if (sceneRefs.length > 0) {
    x.subRef(animation, 'CSceneSource', sceneRefs[0], { 'xs.n': 'currentScene' });
  }
  x.subRef(animation, 'CResourceManager', pidResMgr, { 'xs.n': 'resourceManager' });
  const edEdition = x.sub(animation, 'EditorEdition', { 'xs.n': 'editorEdition' });
  x.sub(edEdition, 'i', { 'xs.n': 'edition' }).text = '15';

  const sbs = x.sub(animation, 'CSceneBlendingSettingsSource', { 'xs.n': 'sceneBlendingSettings' });
  x.sub(sbs, 'CSceneBlendingSettingsGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
  const playlists = x.sub(sbs, 'carray_list', { 'xs.n': 'playlists', count: '1' });
  const playlist = x.sub(playlists, 'PlaylistData');
  x.sub(playlist, 'CPlaylistGuid', { 'xs.n': 'guid', uuid: uuid(), note: '(no debug info)' });
  x.sub(playlist, 's', { 'xs.n': 'name' }).text = 'default';
  const plItems = x.sub(playlist, 'carray_list', { 'xs.n': 'list', count: String(sceneGuids.length) });
  for (const gid of sceneGuids) {
    const item = x.sub(plItems, 'PlaylistItemData');
    x.sub(item, 'ASceneBlendingData', { 'xs.n': 'super' });
    x.subRef(item, 'CSceneGuid', gid, { 'xs.n': 'guid' });
  }
  x.sub(sbs, 'carray_list', { 'xs.n': 'sceneGroups', count: '0' });

  x.sub(animation, 'b', { 'xs.n': 'hideAbsolutePathIfLinkError' }).text = 'false';
  x.sub(animation, 'Animation', { 'xs.n': 'targetVersion', v: 'FOR_SDK' });
  x.sub(animation, 'b', { 'xs.n': 'isSmoothCurveLegacyMode' }).text = 'true';

  for (const { scene, placeholder } of sceneAnimPlaceholders) {
    const idx = scene.children.indexOf(placeholder);
    if (idx >= 0) {
      scene.children[idx] = x.ref('CAnimation', pidAnimation, { 'xs.n': '_animation' });
    }
  }

  // ---- main.xml + CAFF pack ----
  const root = x.el('root', { fileFormatVersion: '402030000' });

  const sharedElem = x.sub(root, 'shared');
  for (const obj of x._shared) {
    sharedElem.children.push(obj);
  }

  const mainElem = x.sub(root, 'main');
  x.subRef(mainElem, 'CAnimation', pidAnimation);

  const xmlStr = x.serialize(root, VERSION_PIS, IMPORT_PIS);
  const xmlBytes = new TextEncoder().encode(xmlStr);

  const caffFiles = [{
    path: 'main.xml',
    content: xmlBytes,
    tag: 'main_xml',
    obfuscated: true,
    compress: COMPRESS_FAST,
  }];

  return packCaff(caffFiles, 42);
}
