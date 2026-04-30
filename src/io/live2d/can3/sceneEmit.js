// @ts-nocheck
/**
 * Per-scene CSceneSource emission for .can3.
 *
 * Each animation in the input becomes one CSceneSource holding a Root
 * CMvTrack_Group_Source + a child CMvTrack_Live2DModel_Source. The model
 * track aggregates five effects in Hiyori's order:
 *   1. CMvEffect_EyeBlink (empty stub)
 *   2. CMvEffect_LipSync (empty stub)
 *   3. CMvEffect_Live2DParameter (CMvAttrF[] — one per paramInfo)
 *   4. CMvEffect_Live2DPartsVisible (empty stub)
 *   5. CMvEffect_VisualDefault (9 transform attrs via track-attr factories)
 *
 * Untracked params for a given scene still emit a single-keyframe
 * CMutableSequence pinned at `info.rest`, since CFixedSequence crashes
 * Cubism Editor 5.0's motion-file export.
 *
 * The `_animation` field on each CSceneSource references the SHARED
 * CAnimation that finalize.js builds afterwards; we leave a `null`
 * placeholder here and the caller patches it back via
 * `sceneAnimPlaceholders`.
 *
 * @module io/live2d/can3/sceneEmit
 */

import { uuid } from '../xmlbuilder.js';
import { emitMutableSequence } from './keyframeSequence.js';
import { buildTrackAttrFactories } from './trackAttrs.js';

/**
 * @param {object} x XmlBuilder
 * @param {object[]} animations Array of SS animations [{name, duration, fps, tracks}]
 * @param {object} deps Shared pids + paramInfoList
 * @param {string|number} deps.pidAdaptRel
 * @param {string|number} deps.pidEffIdParam
 * @param {string|number} deps.pidEffIdParts
 * @param {string|number} deps.pidEffIdVisual
 * @param {string|number} deps.pidRootTrackGuid
 * @param {string|number} deps.pidResourceGuid
 * @param {Array<{paramId:string, min:number, max:number, rest:number, sourceGroupId?:string}>} deps.paramInfoList
 * @param {Map<string, string|number>} deps.paramGuids
 * @param {Map<string, {paramId, min, max, rest?}>} deps.deformerParamMap
 * @param {number} deps.canvasW
 * @param {number} deps.canvasH
 * @param {string} deps.modelName
 * @returns {{
 *   sceneRefs: Array<string|number>,
 *   sceneGuids: Array<string|number>,
 *   sceneAnimPlaceholders: Array<{scene:object, placeholder:object}>,
 * }}
 */
export function emitAllScenes(x, animations, deps) {
  const {
    pidAdaptRel, pidEffIdParam, pidEffIdParts, pidEffIdVisual,
    pidRootTrackGuid, pidResourceGuid,
    paramInfoList, paramGuids, deformerParamMap,
    canvasW, canvasH, modelName,
  } = deps;

  const sceneRefs = [];
  const sceneGuids = [];
  const sceneAnimPlaceholders = [];

  for (let si = 0; si < animations.length; si++) {
    const anim = animations[si];
    const fps = anim.fps ?? 30;
    const durationMs = anim.duration ?? 2000;
    const durationFrames = Math.round(durationMs * fps / 1000);
    const sceneName = (anim.name ?? `anim_${si}`).replace(/[^a-zA-Z0-9_-]/g, '_');

    const [, pidSceneGuid] = x.shared('CSceneGuid', { uuid: uuid(), note: sceneName });
    sceneGuids.push(pidSceneGuid);

    const [, pidModelTrackGuid] = x.shared('CTrackGuid', { uuid: uuid(), note: `${sceneName}_model` });
    const [modelTrack, pidModelTrack] = x.shared('CMvTrack_Live2DModel_Source');

    const paramAttrPids = [];

    const rotationTracksByNodeId = new Map();
    const paramTracksByParamId = new Map();
    for (const track of (anim.tracks ?? [])) {
      if (track.paramId) {
        if (!paramTracksByParamId.has(track.paramId)) {
          paramTracksByParamId.set(track.paramId, track);
        }
      } else if (track.property === 'rotation' && deformerParamMap.has(track.nodeId)) {
        rotationTracksByNodeId.set(track.nodeId, track);
      }
    }

    for (const info of paramInfoList) {
      const track = info.sourceGroupId
        ? (rotationTracksByNodeId.get(info.sourceGroupId) ?? paramTracksByParamId.get(info.paramId) ?? null)
        : (paramTracksByParamId.get(info.paramId) ?? null);

      const [attrF, pidAttrF] = x.shared('CMvAttrF');
      paramAttrPids.push(pidAttrF);

      const attrSup = x.sub(attrF, 'ICMvAttr', { 'xs.n': 'super' });
      x.sub(attrSup, 'b', { 'xs.n': 'isShyMode' }).text = 'false';
      x.sub(attrSup, 'b', { 'xs.n': 'isFreezeMode' }).text = 'false';
      x.sub(attrSup, 'CAttrId', { 'xs.n': 'id', idstr: `live2dParam_${info.paramId}` });
      x.sub(attrSup, 's', { 'xs.n': 'name' }).text = info.paramId;
      x.subRef(attrSup, 'CParameterGuid', paramGuids.get(info.paramId), { 'xs.n': 'guid' });
      x.sub(attrSup, 'b', { 'xs.n': 'isActive' }).text = 'true';
      x.subRef(attrSup, 'AdaptType', pidAdaptRel, { 'xs.n': 'adaptType' });
      const optParams = x.sub(attrSup, 'hash_map', { 'xs.n': 'optionParam', count: '3', keyType: 'string' });
      x.sub(optParams, 'i', { 'xs.n': 'KEY_ATTR_FADE_OUT' }).text = '-1';
      x.sub(optParams, 'i', { 'xs.n': 'KEY_ATTR_FADE_IN' }).text = '-1';
      x.sub(optParams, 's', { 'xs.n': 'KEY_PARAM_ID' }).text = `live2dParam:${info.paramId}`;
      x.subRef(attrSup, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });

      if (track && track.keyframes?.length > 0) {
        const kfs = [...track.keyframes].sort((a, b) => a.time - b.time);
        emitMutableSequence(x, attrF, pidAttrF, kfs, fps, info.min, info.max);
      } else {
        emitMutableSequence(
          x, attrF, pidAttrF,
          [{ time: 0, value: info.rest, easing: 'linear' }],
          fps, info.min, info.max,
        );
      }

      x.sub(attrF, 'd', { 'xs.n': 'rangeMin' }).text = String(info.min);
      x.sub(attrF, 'd', { 'xs.n': 'rangeMax' }).text = String(info.max);
      x.sub(attrF, 'b', { 'xs.n': 'isRepeat' }).text = 'false';
      x.sub(attrF, 'd', { 'xs.n': 'repeatMin' }).text = '-1.7976931348623157E308';
      x.sub(attrF, 'd', { 'xs.n': 'repeatMax' }).text = '1.7976931348623157E308';
      x.sub(attrF, 'null', { 'xs.n': 'linked_keyFormsForObject' });
    }

    const [paramEffect, pidParamEffect] = x.shared('CMvEffect_Live2DParameter');
    const peSuper = x.sub(paramEffect, 'ICMvEffect', { 'xs.n': 'super' });
    x.subRef(peSuper, 'CEffectId', pidEffIdParam, { 'xs.n': 'id' });
    x.sub(peSuper, 'b', { 'xs.n': 'isActive' }).text = 'true';
    x.sub(peSuper, 'b', { 'xs.n': 'canDelete' }).text = 'false';
    const peAttrList = x.sub(peSuper, 'array', {
      'xs.n': 'attrList', count: String(paramAttrPids.length), type: 'ICMvAttr',
    });
    for (const pid of paramAttrPids) {
      x.subRef(peAttrList, 'CMvAttrF', pid);
    }
    const peAttrMap = x.sub(peSuper, 'hash_map', {
      'xs.n': 'attrMap', count: String(paramAttrPids.length),
    });
    for (let i = 0; i < paramInfoList.length; i++) {
      const info = paramInfoList[i];
      const entry = x.sub(peAttrMap, 'entry');
      x.sub(entry, 'CAttrId', { 'xs.n': 'key', idstr: `live2dParam_${info.paramId}` });
      x.subRef(entry, 'CMvAttrF', paramAttrPids[i], { 'xs.n': 'value' });
    }
    x.subRef(peSuper, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    x.sub(paramEffect, 'carray_list', { 'xs.n': 'parameterGroupList', count: '0' });

    const [partsEffect, pidPartsEffect] = x.shared('CMvEffect_Live2DPartsVisible');
    const pveSuper = x.sub(partsEffect, 'ICMvEffect', { 'xs.n': 'super' });
    x.subRef(pveSuper, 'CEffectId', pidEffIdParts, { 'xs.n': 'id' });
    x.sub(pveSuper, 'b', { 'xs.n': 'isActive' }).text = 'true';
    x.sub(pveSuper, 'b', { 'xs.n': 'canDelete' }).text = 'false';
    x.sub(pveSuper, 'array', { 'xs.n': 'attrList', count: '0', type: 'ICMvAttr' });
    x.sub(pveSuper, 'hash_map', { 'xs.n': 'attrMap', count: '0' });
    x.subRef(pveSuper, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });

    const { makeTrackAttrF, makeTrackAttrPt, makeTrackAttrI } =
      buildTrackAttrFactories(x, pidAdaptRel, pidModelTrack);

    const pidXyAttr = makeTrackAttrPt('xy', 'Position', canvasW / 2, canvasH / 2);
    const pidScaleX = makeTrackAttrF('scalex', 'Scale X', 100.0, -Infinity, Infinity);
    const pidScaleY = makeTrackAttrF('scaley', 'Scale Y', 100.0, -Infinity, Infinity);
    const pidRotate = makeTrackAttrF('rotate', 'Rotation', 0.0, -Infinity, Infinity);
    const pidShear = makeTrackAttrF('shear', 'Shear', 0.0, -Infinity, Infinity);
    const pidAnchorAttr = makeTrackAttrPt('anchor', 'Anchor', canvasW / 2, canvasH / 2);
    const pidOpacity = makeTrackAttrF('opacity', 'Opacity', 100.0, 0.0, 100.0);
    const pidFrameStep = makeTrackAttrI('frameStep', 'Frame Step', 1.0, 0, 100);
    const pidArtPathWidth = makeTrackAttrF('artPathWidth', 'Art Path Width', 100.0,
      -1.7976931348623157E308, 1.7976931348623157E308);

    const veAttrPids = [
      { pid: pidXyAttr, idstr: 'xy', type: 'CMvAttrPt' },
      { pid: pidScaleX, idstr: 'scalex', type: 'CMvAttrF' },
      { pid: pidScaleY, idstr: 'scaley', type: 'CMvAttrF' },
      { pid: pidRotate, idstr: 'rotate', type: 'CMvAttrF' },
      { pid: pidShear, idstr: 'shear', type: 'CMvAttrF' },
      { pid: pidAnchorAttr, idstr: 'anchor', type: 'CMvAttrPt' },
      { pid: pidOpacity, idstr: 'opacity', type: 'CMvAttrF' },
      { pid: pidFrameStep, idstr: 'frameStep', type: 'CMvAttrI' },
      { pid: pidArtPathWidth, idstr: 'artPathWidth', type: 'CMvAttrF' },
    ];

    const [visualEffect, pidVisualEffect] = x.shared('CMvEffect_VisualDefault');
    const veSuper = x.sub(visualEffect, 'ICMvEffect', { 'xs.n': 'super' });
    x.subRef(veSuper, 'CEffectId', pidEffIdVisual, { 'xs.n': 'id' });
    x.sub(veSuper, 'b', { 'xs.n': 'isActive' }).text = 'true';
    x.sub(veSuper, 'b', { 'xs.n': 'canDelete' }).text = 'false';
    const veAttrList = x.sub(veSuper, 'array', {
      'xs.n': 'attrList', count: '9', type: 'ICMvAttr',
    });
    for (const a of veAttrPids) x.subRef(veAttrList, a.type, a.pid);
    const veAttrMap = x.sub(veSuper, 'hash_map', { 'xs.n': 'attrMap', count: '9' });
    for (const a of veAttrPids) {
      const e = x.sub(veAttrMap, 'entry');
      x.sub(e, 'CAttrId', { 'xs.n': 'key', idstr: a.idstr });
      x.subRef(e, a.type, a.pid, { 'xs.n': 'value' });
    }
    x.subRef(veSuper, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    x.subRef(visualEffect, 'CMvAttrPt', pidXyAttr, { 'xs.n': 'attrXY' });
    x.subRef(visualEffect, 'CMvAttrF', pidScaleX, { 'xs.n': 'attrScaleX' });
    x.subRef(visualEffect, 'CMvAttrF', pidScaleY, { 'xs.n': 'attrScaleY' });
    x.subRef(visualEffect, 'CMvAttrF', pidRotate, { 'xs.n': 'attrRotate' });
    x.subRef(visualEffect, 'CMvAttrPt', pidAnchorAttr, { 'xs.n': 'attrAnchorXY' });
    x.subRef(visualEffect, 'CMvAttrF', pidShear, { 'xs.n': 'attrShear' });
    x.subRef(visualEffect, 'CMvAttrF', pidOpacity, { 'xs.n': 'attrOpacity' });
    x.subRef(visualEffect, 'CMvAttrI', pidFrameStep, { 'xs.n': 'attrFrameStep' });
    x.subRef(visualEffect, 'CMvAttrF', pidArtPathWidth, { 'xs.n': 'attrArtPathWidth' });

    const [eyeBlinkEffect, pidEyeBlink] = x.shared('CMvEffect_EyeBlink');
    const ebSuper = x.sub(eyeBlinkEffect, 'ICMvEffect', { 'xs.n': 'super' });
    x.sub(ebSuper, 'CEffectId', { 'xs.n': 'id', idstr: 'eyeBlink' });
    x.sub(ebSuper, 'b', { 'xs.n': 'isActive' }).text = 'false';
    x.sub(ebSuper, 'b', { 'xs.n': 'canDelete' }).text = 'true';
    x.sub(ebSuper, 'array', { 'xs.n': 'attrList', count: '0', type: 'ICMvAttr' });
    x.sub(ebSuper, 'hash_map', { 'xs.n': 'attrMap', count: '0' });
    x.subRef(ebSuper, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    x.sub(eyeBlinkEffect, 'carray_list', { 'xs.n': 'effectParameterAttrIds', count: '0' });
    x.sub(eyeBlinkEffect, 'b', { 'xs.n': 'invert' }).text = 'false';
    x.sub(eyeBlinkEffect, 'b', { 'xs.n': 'relative' }).text = 'true';

    const [lipSyncEffect, pidLipSync] = x.shared('CMvEffect_LipSync');
    const lsSuper = x.sub(lipSyncEffect, 'ICMvEffect', { 'xs.n': 'super' });
    x.sub(lsSuper, 'CEffectId', { 'xs.n': 'id', idstr: 'lipSync' });
    x.sub(lsSuper, 'b', { 'xs.n': 'isActive' }).text = 'false';
    x.sub(lsSuper, 'b', { 'xs.n': 'canDelete' }).text = 'true';
    x.sub(lsSuper, 'array', { 'xs.n': 'attrList', count: '0', type: 'ICMvAttr' });
    x.sub(lsSuper, 'hash_map', { 'xs.n': 'attrMap', count: '0' });
    x.subRef(lsSuper, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    x.sub(lipSyncEffect, 'carray_list', { 'xs.n': 'effectParameterAttrIds', count: '0' });
    x.sub(lipSyncEffect, 'null', { 'xs.n': 'syncTrackGuid' });
    x.sub(lipSyncEffect, 'b', { 'xs.n': 'isInvert' }).text = 'false';
    x.sub(lipSyncEffect, 'b', { 'xs.n': 'isRelative' }).text = 'true';

    const [rootTrack, pidRootTrack] = x.shared('CMvTrack_Group_Source');
    const rtSup = x.sub(rootTrack, 'ICMvTrack_Source', { 'xs.n': 'super' });
    x.sub(rtSup, 's', { 'xs.n': 'name' }).text = 'Root';
    x.sub(rtSup, 'b', { 'xs.n': 'isUserRenamed' }).text = 'false';
    x.subRef(rtSup, 'CTrackGuid', pidRootTrackGuid, { 'xs.n': 'guid' });
    x.sub(rtSup, 'i', { 'xs.n': 'start' }).text = '0';
    x.sub(rtSup, 'i', { 'xs.n': 'internalOffset' }).text = '0';
    x.sub(rtSup, 'i', { 'xs.n': 'duration' }).text = String(durationFrames);
    x.sub(rtSup, 'b', { 'xs.n': 'editable' }).text = 'true';
    x.sub(rtSup, 'b', { 'xs.n': 'visible' }).text = 'true';
    x.sub(rtSup, 'b', { 'xs.n': 'mute' }).text = 'false';
    x.sub(rtSup, 'b', { 'xs.n': 'isGuide' }).text = 'false';
    x.sub(rtSup, 'b', { 'xs.n': 'isRepeat' }).text = 'false';
    x.sub(rtSup, 'b', { 'xs.n': 'soloSwitch' }).text = 'false';
    const rtVis = x.sub(rtSup, 'CVisualHandler', { 'xs.n': 'visualHandler' });
    x.subRef(rtVis, 'CMvTrack_Group_Source', pidRootTrack, { 'xs.n': 'track' });
    const rtSnd = x.sub(rtSup, 'CSoundHandler', { 'xs.n': 'soundHandler' });
    x.subRef(rtSnd, 'CMvTrack_Group_Source', pidRootTrack, { 'xs.n': 'track' });
    x.sub(rtSup, 'null', { 'xs.n': 'soundEffect' });
    x.sub(rtSup, 'null', { 'xs.n': 'visualEffect' });
    const rtEffMgr = x.sub(rtSup, 'CMvEffectManager', { 'xs.n': 'effectManager' });
    x.sub(rtEffMgr, 'array', { 'xs.n': 'effectList', count: '0', type: 'ICMvEffect' });
    x.sub(rtSup, 'null', { 'xs.n': 'parentGuid' });
    x.sub(rtSup, 'hash_map', { 'xs.n': 'userData', count: '0', keyType: 'string' });
    x.sub(rtSup, 'null', { 'xs.n': 'keys' });
    const rtChildren = x.sub(rootTrack, 'carray_list', { 'xs.n': '_childTrackGuids', count: '1' });
    x.subRef(rtChildren, 'CTrackGuid', pidModelTrackGuid);
    const rtBounds = x.sub(rootTrack, 'GRectF', { 'xs.n': 'bounds' });
    x.sub(rtBounds, 'f', { 'xs.n': 'x' }).text = '0.0';
    x.sub(rtBounds, 'f', { 'xs.n': 'y' }).text = '0.0';
    x.sub(rtBounds, 'f', { 'xs.n': 'width' }).text = '640.0';
    x.sub(rtBounds, 'f', { 'xs.n': 'height' }).text = '480.0';

    const mtLinked = x.sub(modelTrack, 'ICMvTrack_Linked', { 'xs.n': 'super' });
    const mtSup = x.sub(mtLinked, 'ICMvTrack_Source', { 'xs.n': 'super' });
    x.sub(mtSup, 's', { 'xs.n': 'name' }).text = modelName;
    x.sub(mtSup, 'b', { 'xs.n': 'isUserRenamed' }).text = 'true';
    x.subRef(mtSup, 'CTrackGuid', pidModelTrackGuid, { 'xs.n': 'guid' });
    x.sub(mtSup, 'i', { 'xs.n': 'start' }).text = '0';
    x.sub(mtSup, 'i', { 'xs.n': 'internalOffset' }).text = '0';
    x.sub(mtSup, 'i', { 'xs.n': 'duration' }).text = String(durationFrames);
    x.sub(mtSup, 'b', { 'xs.n': 'editable' }).text = 'true';
    x.sub(mtSup, 'b', { 'xs.n': 'visible' }).text = 'true';
    x.sub(mtSup, 'b', { 'xs.n': 'mute' }).text = 'false';
    x.sub(mtSup, 'b', { 'xs.n': 'isGuide' }).text = 'false';
    x.sub(mtSup, 'b', { 'xs.n': 'isRepeat' }).text = 'false';
    x.sub(mtSup, 'b', { 'xs.n': 'soloSwitch' }).text = 'false';
    const mtVis = x.sub(mtSup, 'CVisualHandler', { 'xs.n': 'visualHandler' });
    x.subRef(mtVis, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    const mtSnd = x.sub(mtSup, 'CSoundHandler', { 'xs.n': 'soundHandler' });
    x.subRef(mtSnd, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'track' });
    x.sub(mtSup, 'null', { 'xs.n': 'soundEffect' });
    x.subRef(mtSup, 'CMvEffect_VisualDefault', pidVisualEffect, { 'xs.n': 'visualEffect' });
    const mtEffMgr = x.sub(mtSup, 'CMvEffectManager', { 'xs.n': 'effectManager' });
    const mtEffList = x.sub(mtEffMgr, 'array', {
      'xs.n': 'effectList', count: '5', type: 'ICMvEffect',
    });
    x.subRef(mtEffList, 'CMvEffect_EyeBlink', pidEyeBlink);
    x.subRef(mtEffList, 'CMvEffect_LipSync', pidLipSync);
    x.subRef(mtEffList, 'CMvEffect_Live2DParameter', pidParamEffect);
    x.subRef(mtEffList, 'CMvEffect_Live2DPartsVisible', pidPartsEffect);
    x.subRef(mtEffList, 'CMvEffect_VisualDefault', pidVisualEffect);
    x.subRef(mtSup, 'CTrackGuid', pidRootTrackGuid, { 'xs.n': 'parentGuid' });
    x.sub(mtSup, 'hash_map', { 'xs.n': 'userData', count: '0', keyType: 'string' });
    x.sub(mtSup, 'null', { 'xs.n': 'keys' });
    x.subRef(mtLinked, 'CResourceGuid', pidResourceGuid, { 'xs.n': '_resourceGuid' });
    x.subRef(modelTrack, 'CMvEffect_Live2DParameter', pidParamEffect, { 'xs.n': 'keyParamEffect' });
    x.subRef(modelTrack, 'CMvEffect_Live2DPartsVisible', pidPartsEffect, { 'xs.n': 'partsVisibleEffect' });
    x.subRef(modelTrack, 'CMvEffect_LipSync', pidLipSync, { 'xs.n': 'lipSyncEffect' });
    x.subRef(modelTrack, 'CMvEffect_EyeBlink', pidEyeBlink, { 'xs.n': 'eyeBlinkEffect' });
    x.sub(modelTrack, 'null', { 'xs.n': 'formEditEffect' });
    const fAnimSet = x.sub(modelTrack, 'FormAnimationSet', { 'xs.n': 'formAnimationSet' });
    x.sub(fAnimSet, 'hash_map', { 'xs.n': 'formMapOnGlobal', count: '0', keyType: 'string' });
    x.sub(fAnimSet, 'hash_map', { 'xs.n': 'formMapOnLocal', count: '0', keyType: 'string' });
    x.subRef(fAnimSet, 'CMvTrack_Live2DModel_Source', pidModelTrack, { 'xs.n': 'trackSource' });
    const mtBounds = x.sub(modelTrack, 'GRectF', { 'xs.n': 'bounds' });
    x.sub(mtBounds, 'f', { 'xs.n': 'x' }).text = '0.0';
    x.sub(mtBounds, 'f', { 'xs.n': 'y' }).text = '0.0';
    x.sub(mtBounds, 'f', { 'xs.n': 'width' }).text = String(canvasW) + '.0';
    x.sub(mtBounds, 'f', { 'xs.n': 'height' }).text = String(canvasH) + '.0';
    const pbSet = x.sub(modelTrack, 'ParameterBookmarkLabelSet', { 'xs.n': 'parameterBookmarkLabelSet' });
    x.sub(pbSet, 'carray_list', { 'xs.n': 'labels', count: '0' });

    const [scene, pidScene] = x.shared('CSceneSource', { exportMotionFile: 'true' });
    sceneRefs.push(pidScene);

    x.sub(scene, 's', { 'xs.n': 'sceneName' }).text = sceneName;
    const scCanvas = x.sub(scene, 'CImageCanvas', { 'xs.n': 'canvas' });
    x.sub(scCanvas, 'i', { 'xs.n': 'pixelWidth' }).text = String(canvasW);
    x.sub(scCanvas, 'i', { 'xs.n': 'pixelHeight' }).text = String(canvasH);
    x.sub(scCanvas, 'CColor', { 'xs.n': 'background' });
    x.subRef(scene, 'CSceneGuid', pidSceneGuid, { 'xs.n': 'guid' });
    x.sub(scene, 's', { 'xs.n': 'tag' }).text = '';
    const trackSourceSet = x.sub(scene, 'CTrackSourceSet', { 'xs.n': 'trackSourceSet' });
    const tsSources = x.sub(trackSourceSet, 'carray_list', { 'xs.n': '_sources', count: '2' });
    x.subRef(tsSources, 'CMvTrack_Group_Source', pidRootTrack);
    x.subRef(tsSources, 'CMvTrack_Live2DModel_Source', pidModelTrack);
    x.subRef(scene, 'CMvTrack_Group_Source', pidRootTrack, { 'xs.n': 'rootTrack' });

    const movieInfo = x.sub(scene, 'CMvMovieInfo', { 'xs.n': 'movieInfo' });
    x.sub(movieInfo, 'i', { 'xs.n': 'width' }).text = '320';
    x.sub(movieInfo, 'i', { 'xs.n': 'height' }).text = '240';
    x.sub(movieInfo, 'i', { 'xs.n': 'duration' }).text = String(durationFrames);
    x.sub(movieInfo, 'd', { 'xs.n': 'fps' }).text = String(fps) + '.0';
    x.sub(movieInfo, 'i', { 'xs.n': 'workspaceStart' }).text = '0';
    // workspaceEnd = durationFrames (not -1) so loop-closure keyframes
    // at exact `duration` time fall INSIDE the workspace.
    x.sub(movieInfo, 'i', { 'xs.n': 'workspaceEnd' }).text = String(durationFrames);
    x.sub(movieInfo, 'CColor', { 'xs.n': 'background' });
    x.sub(movieInfo, 'i', { 'xs.n': 'fadeInMSec' }).text = '-1';
    x.sub(movieInfo, 'i', { 'xs.n': 'fadeOutMSec' }).text = '-1';
    x.sub(movieInfo, 'b', { 'xs.n': 'isBezierRestricted' }).text = 'false';
    x.sub(movieInfo, 'b', { 'xs.n': 'isLoopMotion' }).text = 'false';
    x.sub(movieInfo, 'i', { 'xs.n': 'startFrame' }).text = '0';
    x.sub(movieInfo, 'CFrameIndexType', { 'xs.n': 'frameIndexType', v: 'ZERO_INDEX' });

    const animPlaceholder = x.sub(scene, 'null', { 'xs.n': '_animation' });
    sceneAnimPlaceholders.push({ scene, placeholder: animPlaceholder });
    x.sub(scene, 'hash_map', { 'xs.n': 'marker', count: '0', keyType: 'string' });
    x.sub(scene, 'CCurveType', { 'xs.n': 'defaultParameterCurveType', v: 'SMOOTH' });
    x.sub(scene, 'CCurveType', { 'xs.n': 'defaultPartCurveType', v: 'STEP' });
    x.sub(scene, 'b', { 'xs.n': 'fixAspect' }).text = 'true';
    x.sub(scene, 'Animation', { 'xs.n': 'targetVersion', v: 'FOR_SDK' });
    x.sub(scene, 'b', { 'xs.n': 'lockMarker' }).text = 'false';
    x.sub(scene, 'array_list', { 'xs.n': 'onionSkinMarker', count: '0' });
    x.sub(scene, 'b', { 'xs.n': 'lockOnionSkinMarker' }).text = 'false';
    const pbcTrackSet = x.sub(scene, 'ParameterBookmarkLabelCarrierTrackSet', { 'xs.n': 'parameterBookmarkCarrierTrackSet' });
    x.subRef(pbcTrackSet, 'CSceneSource', pidScene, { 'xs.n': '_owner' });
    x.sub(pbcTrackSet, 'carray_list', { 'xs.n': '_trackSortInfo', count: '0' });

    x.subRef(rtSup, 'CSceneSource', pidScene, { 'xs.n': '_sceneSource' });
    x.subRef(mtSup, 'CSceneSource', pidScene, { 'xs.n': '_sceneSource' });
  }

  return { sceneRefs, sceneGuids, sceneAnimPlaceholders };
}
