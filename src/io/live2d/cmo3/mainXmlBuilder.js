// @ts-check

import { uuid } from '../xmlbuilder.js';
import { CATEGORY_DEFS, categorizeParam } from './paramCategories.js';
import { emitPhysicsSettings } from './physics.js';

/**
 * Section 6 — assemble main.xml's `<root>` element.
 *
 * Lifted out of `cmo3writer.js` (Phase 6 god-class breakup, sweep #27).
 * Pure XmlBuilder mutation; returns the root element ready for the
 * serializer in Section 7.
 *
 * Three logical phases, all inlined here because they share `model`
 * + paramDefs state and order matters (CParameterId pids must be
 * assigned before the parameter source emission reads them):
 *
 *   1. **Param-id + sub-group setup**. Allocates a `CParameterId`
 *      pid per paramDef (must run AFTER all `paramDefs.push` sites in
 *      sections 3b/3c/3d). Bins paramDefs into categories
 *      (`paramCategories.js`) and emits one `CParameterGroup` per
 *      non-empty category. The root `CParameterGroup` entity (with
 *      visibilityColor RGBA = 1) wraps them.
 *
 *   2. **Top-level CModelSource emission**. Canvas, parameters,
 *      texture manager, drawable/deformer/affecter/part source sets,
 *      optional physics settings, root part ref, parameter group set,
 *      modelInfo, modelOptions, three preview icons, gameMotionSet,
 *      modelViewerSetting, guides, version stamps, brushes,
 *      randomPoseSettingManager.
 *
 *   3. Returns `<root>` with `fileFormatVersion="402030000"` plus
 *      `<shared>` (filled from `x._shared`) and `<main>` (the model).
 *
 * @module io/live2d/cmo3/mainXmlBuilder
 */

/**
 * @param {Object} x
 * @param {Object} opts
 * @returns {Object} root element ready for `x.serialize`.
 */
export function buildMainXml(x, opts) {
  const {
    paramDefs, pidParamGroupGuid, pidModelGuid, modelName,
    canvasW, canvasH, pidLi, pidImgGrp,
    meshes, meshSrcIds,
    allDeformerSources,
    allPartSources, rootPart,
    generatePhysics, physicsRules, physicsDisabledCategories, rigDebugLog,
  } = opts;

  // ── Param-id pids — MUST run AFTER late paramDefs.push sites
  // (sections 3b/3c/3d). If we assign too early, any param pushed
  // later has `pd.pidId = undefined`, which the ref-emit turns into
  // `xs.ref="undefined"` — at load Cubism reports `CParameterId / ref
  // id [undefined] : object not found` and fabricates
  // `__NotInitialized__` placeholders per source.
  for (const pd of paramDefs) {
    const [, pidId] = x.shared('CParameterId', { idstr: pd.id });
    pd.pidId = pidId;
  }

  // ── Parameter sub-groups — Random Pose dialog folders.
  for (const pd of paramDefs) pd.category = categorizeParam(pd.id);
  const paramsByCategory = new Map();
  for (const cd of CATEGORY_DEFS) paramsByCategory.set(cd.key, []);
  for (const pd of paramDefs) paramsByCategory.get(pd.category).push(pd);
  /** @type {Array<{ key: string, name: string, idstr: string, pidGuid?: string|number, pidId?: string|number }>} */
  const activeCategories = CATEGORY_DEFS
    .filter(cd => paramsByCategory.get(cd.key).length > 0)
    .map(cd => ({ key: cd.key, name: cd.name, idstr: cd.idstr }));
  for (const cd of activeCategories) {
    const [, pidGuid] = x.shared('CParameterGroupGuid', { uuid: uuid(), note: cd.key });
    const [, pidId] = x.shared('CParameterGroupId', { idstr: cd.idstr });
    cd.pidGuid = pidGuid;
    cd.pidId = pidId;
  }
  const categoryByKey = new Map(activeCategories.map(cd => [cd.key, cd]));

  // Root Parameter Group entity (v14). visibilityColor RGBA = 1.0
  // Random Pose dialog requires the root to exist + reference all
  // sub-groups via _childGuids.
  const [, pidRootPgId] = x.shared('CParameterGroupId', { idstr: 'ParamGroupRoot' });
  const [rootPgNode, pidRootPgEntity] = x.shared('CParameterGroup');
  x.sub(rootPgNode, 's', { 'xs.n': 'name' }).text = 'Root Parameter Group';
  x.sub(rootPgNode, 's', { 'xs.n': 'description' });
  x.sub(rootPgNode, 'b', { 'xs.n': 'folderIsOpened' }).text = 'false';
  x.subRef(rootPgNode, 'CParameterGroupGuid', pidParamGroupGuid, { 'xs.n': 'guid' });
  x.sub(rootPgNode, 'null', { 'xs.n': 'parentGroupGuid' });
  const pgChildList = x.sub(rootPgNode, 'carray_list', {
    'xs.n': '_childGuids', count: String(activeCategories.length),
  });
  for (const cd of activeCategories) {
    x.subRef(pgChildList, 'CParameterGroupGuid', cd.pidGuid);
  }
  x.subRef(rootPgNode, 'CParameterGroupId', pidRootPgId, { 'xs.n': 'id' });
  x.sub(rootPgNode, 'f', { 'xs.n': 'visibilityColorRed' }).text = '1.0';
  x.sub(rootPgNode, 'f', { 'xs.n': 'visibilityColorGreen' }).text = '1.0';
  x.sub(rootPgNode, 'f', { 'xs.n': 'visibilityColorBlue' }).text = '1.0';
  x.sub(rootPgNode, 'f', { 'xs.n': 'visibilityColorAlpha' }).text = '1.0';

  // ── <root> + <shared> + <main> ──
  const root = x.el('root', { fileFormatVersion: '402030000' });
  const sharedElem = x.sub(root, 'shared');
  for (const obj of x._shared) sharedElem.children.push(obj);

  const mainElem = x.sub(root, 'main');
  const model = x.sub(mainElem, 'CModelSource', { isDefaultKeyformLocked: 'true' });
  x.subRef(model, 'CModelGuid', pidModelGuid, { 'xs.n': 'guid' });
  x.sub(model, 's', { 'xs.n': 'name' }).text = modelName;
  const edition = x.sub(model, 'EditorEdition', { 'xs.n': 'editorEdition' });
  x.sub(edition, 'i', { 'xs.n': 'edition' }).text = '15';

  const canvas = x.sub(model, 'CImageCanvas', { 'xs.n': 'canvas' });
  x.sub(canvas, 'i', { 'xs.n': 'pixelWidth' }).text = String(canvasW);
  x.sub(canvas, 'i', { 'xs.n': 'pixelHeight' }).text = String(canvasH);
  x.sub(canvas, 'CColor', { 'xs.n': 'background' });

  // Parameters
  const paramSet = x.sub(model, 'CParameterSourceSet', { 'xs.n': 'parameterSourceSet' });
  const paramSources = x.sub(paramSet, 'carray_list', {
    'xs.n': '_sources', count: String(paramDefs.length),
  });
  for (const pd of paramDefs) {
    const ps = x.sub(paramSources, 'CParameterSource');
    x.sub(ps, 'i', { 'xs.n': 'decimalPlaces' }).text = String(pd.decimalPlaces);
    x.subRef(ps, 'CParameterGuid', pd.pid, { 'xs.n': 'guid' });
    x.sub(ps, 'f', { 'xs.n': 'snapEpsilon' }).text = '0.001';
    x.sub(ps, 'f', { 'xs.n': 'minValue' }).text = String(pd.min);
    x.sub(ps, 'f', { 'xs.n': 'maxValue' }).text = String(pd.max);
    x.sub(ps, 'f', { 'xs.n': 'defaultValue' }).text = String(pd.defaultVal);
    x.sub(ps, 'b', { 'xs.n': 'isRepeat' }).text = 'false';
    x.subRef(ps, 'CParameterId', pd.pidId, { 'xs.n': 'id' });
    x.sub(ps, 'Type', { 'xs.n': 'paramType', v: 'NORMAL' });
    x.sub(ps, 's', { 'xs.n': 'name' }).text = pd.name;
    x.sub(ps, 's', { 'xs.n': 'description' }).text = '';
    x.sub(ps, 'b', { 'xs.n': 'combined' }).text = 'false';
    const subCat = categoryByKey.get(pd.category);
    x.subRef(ps, 'CParameterGroupGuid', subCat.pidGuid, { 'xs.n': 'parentGroupGuid' });
  }

  // Texture manager
  const texMgr = x.sub(model, 'CTextureManager', { 'xs.n': 'textureManager' });
  const texList = x.sub(texMgr, 'TextureImageGroup', { 'xs.n': 'textureList' });
  x.sub(texList, 'carray_list', { 'xs.n': 'children', count: '0' });
  const ri = x.sub(texMgr, 'carray_list', { 'xs.n': '_rawImages', count: '1' });
  const liw = x.sub(ri, 'LayeredImageWrapper');
  x.subRef(liw, 'CLayeredImage', pidLi, { 'xs.n': 'image' });
  x.sub(liw, 'l', { 'xs.n': 'importedTimeMSec' }).text = '0';
  x.sub(liw, 'l', { 'xs.n': 'lastModifiedTimeMSec' }).text = '0';
  x.sub(liw, 'b', { 'xs.n': 'isReplaced' }).text = 'false';
  const mig = x.sub(texMgr, 'carray_list', { 'xs.n': '_modelImageGroups', count: '1' });
  x.subRef(mig, 'CModelImageGroup', pidImgGrp);
  x.sub(texMgr, 'carray_list', { 'xs.n': '_textureAtlases', count: '0' });
  x.sub(texMgr, 'b', { 'xs.n': 'isTextureInputModelImageMode' }).text = 'true';
  x.sub(texMgr, 'i', { 'xs.n': 'previewReductionRatio' }).text = '1';
  x.sub(texMgr, 'carray_list', { 'xs.n': 'artPathBrushUsingLayeredImageIds', count: '0' });

  // Drawable source set
  x.sub(model, 'b', { 'xs.n': 'useLegacyDrawOrder__testImpl' }).text = 'false';
  const drawSet = x.sub(model, 'CDrawableSourceSet', { 'xs.n': 'drawableSourceSet' });
  const drawSources = x.sub(drawSet, 'carray_list', {
    'xs.n': '_sources', count: String(meshes.length),
  });
  for (const pid of meshSrcIds) x.subRef(drawSources, 'CArtMeshSource', pid);

  // Deformer source set
  const deformerSet = x.sub(model, 'CDeformerSourceSet', { 'xs.n': 'deformerSourceSet' });
  const deformerSources = x.sub(deformerSet, 'carray_list', {
    'xs.n': '_sources', count: String(allDeformerSources.length),
  });
  for (const ds of allDeformerSources) x.subRef(deformerSources, ds.tag, ds.pid);

  // Affecter source set (empty — required)
  const affecterSet = x.sub(model, 'CAffecterSourceSet', { 'xs.n': 'affecterSourceSet' });
  x.sub(affecterSet, 'carray_list', { 'xs.n': '_sources', count: '0' });

  // Part source set — root + all group parts
  const partSet = x.sub(model, 'CPartSourceSet', { 'xs.n': 'partSourceSet' });
  const partSources = x.sub(partSet, 'carray_list', {
    'xs.n': '_sources', count: String(allPartSources.length),
  });
  for (const ps of allPartSources) x.subRef(partSources, 'CPartSource', ps.pid);

  // Physics settings (between CPartSourceSet and rootPart ref to match
  // Hiyori). Rules self-skip when output param/required tag is absent.
  if (generatePhysics) {
    const disabledSet = physicsDisabledCategories
      ? (physicsDisabledCategories instanceof Set
          ? physicsDisabledCategories
          : new Set(physicsDisabledCategories))
      : null;
    emitPhysicsSettings(x, {
      parent: model, paramDefs, meshes, rules: physicsRules ?? [], rigDebugLog,
      disabledCategories: disabledSet,
    });
  }

  // Root part ref
  x.subRef(model, 'CPartSource', rootPart.pid, { 'xs.n': 'rootPart' });

  // Parameter group set — root entity + one sub-group per active category.
  const pgSet = x.sub(model, 'CParameterGroupSet', { 'xs.n': 'parameterGroupSet' });
  const pgGroups = x.sub(pgSet, 'carray_list', {
    'xs.n': '_groups', count: String(1 + activeCategories.length),
  });
  x.subRef(pgGroups, 'CParameterGroup', pidRootPgEntity);
  for (const cd of activeCategories) {
    const subGroup = x.sub(pgGroups, 'CParameterGroup');
    x.sub(subGroup, 's', { 'xs.n': 'name' }).text = cd.name;
    x.sub(subGroup, 's', { 'xs.n': 'description' });
    x.sub(subGroup, 'b', { 'xs.n': 'folderIsOpened' }).text = 'false';
    x.subRef(subGroup, 'CParameterGroupGuid', cd.pidGuid, { 'xs.n': 'guid' });
    x.subRef(subGroup, 'CParameterGroupGuid', pidParamGroupGuid, { 'xs.n': 'parentGroupGuid' });
    const members = paramsByCategory.get(cd.key);
    const subChildList = x.sub(subGroup, 'carray_list', {
      'xs.n': '_childGuids', count: String(members.length),
    });
    for (const pd of members) x.subRef(subChildList, 'CParameterGuid', pd.pid);
    x.subRef(subGroup, 'CParameterGroupId', cd.pidId, { 'xs.n': 'id' });
    x.sub(subGroup, 'f', { 'xs.n': 'visibilityColorRed' }).text = '1.0';
    x.sub(subGroup, 'f', { 'xs.n': 'visibilityColorGreen' }).text = '0.95686275';
    x.sub(subGroup, 'f', { 'xs.n': 'visibilityColorBlue' }).text = '0.76862746';
    x.sub(subGroup, 'f', { 'xs.n': 'visibilityColorAlpha' }).text = '1.0';
  }

  // v14 required: rootParameterGroup pointer (entity ref, not guid ref)
  x.subRef(model, 'CParameterGroup', pidRootPgEntity, { 'xs.n': 'rootParameterGroup' });

  // Model info (with inner _effectParameterGroups required in v14)
  const miInfo = x.sub(model, 'CModelInfo', { 'xs.n': 'modelInfo' });
  x.sub(miInfo, 'f', { 'xs.n': 'pixelsPerUnit' }).text = '1.0';
  const origin = x.sub(miInfo, 'CPoint', { 'xs.n': 'originInPixels' });
  x.sub(origin, 'i', { 'xs.n': 'x' }).text = '0';
  x.sub(origin, 'i', { 'xs.n': 'y' }).text = '0';
  const epg = x.sub(miInfo, 'CEffectParameterGroups', { 'xs.n': '_effectParameterGroups' });
  x.sub(epg, 'hash_map', { 'xs.n': '_parameterGroups', count: '0', keyType: 'string' });

  // modelOptions (empty hash_map — no legacy Cubism 2→3 mappings).
  x.sub(model, 'hash_map', { 'xs.n': 'modelOptions', count: '0', keyType: 'string' });

  // Preview icons (required by v14). Blank PNG bytes packaged into the
  // CAFF archive by `caffPack.js`.
  for (const ic of [
    { field: '_icon64', size: 64, path: 'cmo3_icon_64.png' },
    { field: '_icon32', size: 32, path: 'cmo3_icon_32.png' },
    { field: '_icon16', size: 16, path: 'cmo3_icon_16.png' },
  ]) {
    const iconNode = x.sub(model, 'CImageIcon', { 'xs.n': ic.field });
    const img = x.sub(iconNode, 'CWritableImage', {
      'xs.n': 'image', width: String(ic.size), height: String(ic.size), type: 'INT_ARGB',
    });
    x.sub(img, 'file', { 'xs.n': 'image', path: ic.path });
  }

  // gameMotionSet / ModelViewerSetting / CGuidesSetting (empty stubs).
  const gms = x.sub(model, 'CGameMotionSet', { 'xs.n': 'gameMotionSet' });
  x.sub(gms, 'carray_list', { 'xs.n': 'gameMotions', count: '0' });
  x.sub(gms, 'carray_list', { 'xs.n': 'gameMotionGroups', count: '0' });

  const mvs = x.sub(model, 'ModelViewerSetting', { 'xs.n': 'modelViewerSetting' });
  x.sub(mvs, 'array_list', { 'xs.n': 'trackCursorSettings', count: '0' });

  const guides = x.sub(model, 'CGuidesSetting', { 'xs.n': 'guides' });
  x.sub(guides, 'carray_list', { 'xs.n': 'guidesModeling', count: '0' });

  x.sub(model, 'i', { 'xs.n': 'targetVersionNo' }).text = '3000';
  x.sub(model, 'i', { 'xs.n': 'latestVersionOfLastModelerNo' }).text = '5000000';

  const brushSet = x.sub(model, 'CArtPathBrushSetting', { 'xs.n': 'artPathBrushesSetting' });
  x.sub(brushSet, 'carray_list', { 'xs.n': 'brushes', count: '0' });

  // CRandomPoseSettingManager — flat parameter list + folder tree so
  // the Animation→Playlist Setting dialog has data to render.
  const randomPose = x.sub(model, 'CRandomPoseSettingManager', { 'xs.n': 'randomPoseSetting' });
  const rpSettings = x.sub(randomPose, 'array_list', { 'xs.n': '_settings', count: '1' });
  const rpSetting = x.sub(rpSettings, 'CRandomPoseSetting');
  const rpKeys = x.sub(rpSetting, 'array_list', {
    'xs.n': 'parameters.keys', count: String(paramDefs.length),
  });
  // Hiyori pattern: parameters.keys uses INLINE CParameterId with idstr,
  // not xs.ref. (groups.keys further down DOES use xs.ref — different
  // dialog code paths.)
  for (const pd of paramDefs) x.sub(rpKeys, 'CParameterId', { idstr: pd.id });

  const rpVals = x.sub(rpSetting, 'array_list', {
    'xs.n': 'parameters.values', count: String(paramDefs.length),
  });
  for (let i = 0; i < paramDefs.length; i++) {
    const entry = x.sub(rpVals, 'CRandomPoseParamData');
    x.sub(entry, 'b', { 'xs.n': 'isEnable' }).text = 'true';
  }

  // Groups: root + every active sub-group.
  const rpGroupCount = 1 + activeCategories.length;
  const rpGroupKeys = x.sub(rpSetting, 'array_list', {
    'xs.n': 'groups.keys', count: String(rpGroupCount),
  });
  x.subRef(rpGroupKeys, 'CParameterGroupId', pidRootPgId);
  for (const cd of activeCategories) x.subRef(rpGroupKeys, 'CParameterGroupId', cd.pidId);

  const rpGroupVals = x.sub(rpSetting, 'array_list', {
    'xs.n': 'groups.values', count: String(rpGroupCount),
  });
  for (let i = 0; i < rpGroupCount; i++) {
    const rpGroupData = x.sub(rpGroupVals, 'CRandomPoseGroupData');
    x.sub(rpGroupData, 'b', { 'xs.n': 'isExpand' }).text = 'true';
  }
  x.sub(randomPose, 'i', { 'xs.n': 'currentIndex' }).text = '0';

  return root;
}
