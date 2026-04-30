// @ts-check
/**
 * .can3 main.xml processing instructions.
 *
 * Reverse-engineered from Hiyori reference. The version PIs declare the
 * field-schema version Cubism Editor expects for each class; the import
 * PIs list every class the deserializer needs to resolve before walking
 * the shared object pool. Missing import PIs trigger the silent
 * "blank-load" failure documented in the project memory.
 *
 * @module io/live2d/can3/constants
 */

export const VERSION_PIS = [
  ['CSceneSource', '3'],
  ['CAnimation', '4'],
  ['CMvParameter_Group', '1'],
  ['SerializeFormatVersion', '2'],
  ['CMvEffect_VisualDefault', '1'],
  ['CMvMovieInfo', '3'],
  ['CBezierCtrlPt', '2'],
];

export const IMPORT_PIS = [
  'com.live2d.cubism.CETargetVersion$Animation',
  'com.live2d.cubism.doc.animation.CAnimation',
  'com.live2d.cubism.doc.animation.CSceneSource',
  'com.live2d.cubism.doc.animation.formAnimation.FormAnimationSet',
  'com.live2d.cubism.doc.animation.movie.core.CMvMovieInfo',
  'com.live2d.cubism.doc.animation.movie.effect.CMvEffect_EyeBlink',
  'com.live2d.cubism.doc.animation.movie.effect.CMvEffect_LipSync',
  'com.live2d.cubism.doc.animation.movie.effect.CMvEffect_Live2DParameter',
  'com.live2d.cubism.doc.animation.movie.effect.CMvEffect_Live2DPartsVisible',
  'com.live2d.cubism.doc.animation.movie.effect.CMvEffect_VisualDefault',
  'com.live2d.cubism.doc.animation.movie.effect.CMvParameter_Group',
  'com.live2d.cubism.doc.animation.movie.effect.CSoundHandler',
  'com.live2d.cubism.doc.animation.movie.effect.CVisualHandler',
  'com.live2d.cubism.doc.animation.movie.effect.ICMvEffect',
  'com.live2d.cubism.doc.animation.movie.effect.attr.CMvAttrF',
  'com.live2d.cubism.doc.animation.movie.effect.attr.CMvAttrI',
  'com.live2d.cubism.doc.animation.movie.effect.attr.CMvAttrPt',
  'com.live2d.cubism.doc.animation.movie.effect.attr.ICMvAttr',
  'com.live2d.cubism.doc.animation.movie.effect.attr.ICMvAttr$AdaptType',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.ACValueSequence',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CBezierCtrlPt',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CBezierPt',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CCurveType',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CFixedSequence',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CFrameIndexType',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CIntSequence',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CMutableSequence',
  'com.live2d.cubism.doc.animation.movie.effect.attr.value.CSeqPt',
  'com.live2d.cubism.doc.animation.movie.effect.attr.xy.CPtTNS',
  'com.live2d.cubism.doc.animation.movie.effect.attr.xy.CXY_TNSSequence',
  'com.live2d.cubism.doc.animation.movie.res.ACResourceEntry',
  'com.live2d.cubism.doc.animation.movie.res.CResourceData',
  'com.live2d.cubism.doc.animation.movie.res.CResourceGroup',
  'com.live2d.cubism.doc.animation.movie.res.CResourceManager',
  'com.live2d.cubism.doc.animation.movie.track.CMvEffectManager',
  'com.live2d.cubism.doc.animation.movie.track.CMvTrack_Group_Source',
  'com.live2d.cubism.doc.animation.movie.track.CMvTrack_Live2DModel_Source',
  'com.live2d.cubism.doc.animation.movie.track.ICMvTrack_Linked',
  'com.live2d.cubism.doc.animation.movie.track.ICMvTrack_Source',
  'com.live2d.cubism.doc.animation.movie.track.resource.ACResource_File',
  'com.live2d.cubism.doc.animation.movie.track.resource.CResource_Linked_Model',
  'com.live2d.cubism.doc.model.deformer.CTrackSourceSet',
  'com.live2d.cubism.doc.model.id.CAttrId',
  'com.live2d.cubism.doc.model.id.CEffectId',
  'com.live2d.cubism.doc.model.id.CMvParameterGroupId',
  'com.live2d.cubism.doc.model.id.CParameterId',
  'com.live2d.cubism.doc.model.id.CPartId',
  'com.live2d.cubism.doc.model.options.edition.EditorEdition',
  'com.live2d.cubism.doc.modeling.ui.viewer.sceneBlending.viewerData_SceneBlending.ASceneBlendingData',
  'com.live2d.cubism.doc.modeling.ui.viewer.sceneBlending.viewerData_SceneBlending.CSceneBlendingSettingsSource',
  'com.live2d.cubism.doc.modeling.ui.viewer.sceneBlending.viewerData_SceneBlending.PlaylistData',
  'com.live2d.cubism.doc.modeling.ui.viewer.sceneBlending.viewerData_SceneBlending.PlaylistItemData',
  'com.live2d.cubism.view.palette.scene.parameterBookmark.ParameterBookmarkLabelCarrierTrackSet',
  'com.live2d.cubism.view.palette.scene.parameterBookmark.ParameterBookmarkLabelSet',
  'com.live2d.graphics.CImageCanvas',
  'com.live2d.graphics3d.type.GRectF',
  'com.live2d.graphics3d.type.GVector2',
  'com.live2d.type.CColor',
  'com.live2d.type.CParameterGroupGuid',
  'com.live2d.type.CParameterGuid',
  'com.live2d.type.CPartGuid',
  'com.live2d.type.CPlaylistGuid',
  'com.live2d.type.CResourceGroupGuid',
  'com.live2d.type.CResourceGuid',
  'com.live2d.type.CSceneBlendingSettingsGuid',
  'com.live2d.type.CSceneGuid',
  'com.live2d.type.CTrackGuid',
];
