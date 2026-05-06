"""Generate a minimal .cmo3 file with full texture pipeline.

Creates main.xml + PNG textures, packs into CAFF archive.
Target: Cubism Editor 5.0 (also works with 4.2+).

The texture pipeline replicates the exact structure from Cubism Editor 5.0's
own output (reference: untitled_with_mesh/main.xml):
  CLayeredImage → CLayer → CModelImage (with filter env) → CImageResource
  → CTextureInputExtension → CArtMeshSource (TextureState=MODEL_IMAGE)

Usage:
  python cmo3_generate.py [output.cmo3]
"""

import sys
import os
import uuid
import struct as st
import zlib
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
from caff_packer import pack_caff, COMPRESS_RAW, COMPRESS_FAST

# Processing instructions — version PIs from Cubism Editor 5.0 reference
VERSION_PIS = [
    ("CArtMeshSource", "4"),
    ("KeyformGridSource", "1"),
    ("CParameterGroup", "4"),
    ("SerializeFormatVersion", "2"),
    ("CModelSource", "4"),  # v4 avoids requiring rootParameterGroup, modelOptions, gameMotionSet
    ("CFloatColor", "1"),
    ("CLabelColor", "0"),
    ("CModelImage", "3"),
]

# Import PIs — full set from Cubism Editor 5.0 reference (untitled_with_mesh)
IMPORT_PIS = [
    "com.live2d.cubism.doc.model.ACForm",
    "com.live2d.cubism.doc.model.ACParameterControllableSource",
    "com.live2d.cubism.doc.model.CModelInfo",
    "com.live2d.cubism.doc.model.CModelSource",
    "com.live2d.cubism.doc.model.affecter.CAffecterSourceSet",
    "com.live2d.cubism.doc.model.deformer.CDeformerSourceSet",
    "com.live2d.cubism.doc.model.drawable.ACDrawableForm",
    "com.live2d.cubism.doc.model.drawable.ACDrawableSource",
    "com.live2d.cubism.doc.model.drawable.CDrawableSourceSet",
    "com.live2d.cubism.doc.model.drawable.ColorComposition",
    "com.live2d.cubism.doc.model.drawable.TextureState",
    "com.live2d.cubism.doc.model.drawable.artMesh.CArtMeshForm",
    "com.live2d.cubism.doc.model.drawable.artMesh.CArtMeshSource",
    "com.live2d.cubism.doc.model.extension.ACExtension",
    "com.live2d.cubism.doc.model.extension.editableMesh.CEditableMeshExtension",
    "com.live2d.cubism.doc.model.extension.meshGenerator.CMeshGeneratorExtension",
    "com.live2d.cubism.doc.model.extension.meshGenerator.MeshGenerateSetting",
    "com.live2d.cubism.doc.model.extension.textureInput.ACTextureInput",
    "com.live2d.cubism.doc.model.extension.textureInput.CTextureInputExtension",
    "com.live2d.cubism.doc.model.extension.textureInput.CTextureInput_ModelImage",
    "com.live2d.cubism.doc.model.extension.textureInput.inputFilter.CLayerInputData",
    "com.live2d.cubism.doc.model.extension.textureInput.inputFilter.CLayerSelectorMap",
    "com.live2d.cubism.doc.model.extension.textureInput.inputFilter.ModelImageFilterEnv",
    "com.live2d.cubism.doc.model.extension.textureInput.inputFilter.ModelImageFilterSet",
    "com.live2d.cubism.doc.model.id.CDrawableId",
    "com.live2d.cubism.doc.model.id.CParameterId",
    "com.live2d.cubism.doc.model.id.CPartId",
    "com.live2d.cubism.doc.model.interpolator.InterpolationType",
    "com.live2d.cubism.doc.model.interpolator.KeyOnParameter",
    "com.live2d.cubism.doc.model.interpolator.KeyformBindingSource",
    "com.live2d.cubism.doc.model.interpolator.KeyformGridAccessKey",
    "com.live2d.cubism.doc.model.interpolator.KeyformGridSource",
    "com.live2d.cubism.doc.model.interpolator.KeyformOnGrid",
    "com.live2d.cubism.doc.model.interpolator.extendedInterpolation.ExtendedInterpolationType",
    "com.live2d.cubism.doc.model.morphTarget.KeyFormMorphTargetSet",
    "com.live2d.cubism.doc.model.morphTarget.MorphTargetBlendWeightConstraintSet",
    "com.live2d.cubism.doc.model.options.edition.EditorEdition",
    "com.live2d.cubism.doc.model.param.CParameterSource",
    "com.live2d.cubism.doc.model.param.CParameterSource$Type",
    "com.live2d.cubism.doc.model.param.CParameterSourceSet",
    "com.live2d.cubism.doc.model.param.group.CParameterGroup",
    "com.live2d.cubism.doc.model.param.group.CParameterGroupSet",
    "com.live2d.cubism.doc.model.parts.CPartForm",
    "com.live2d.cubism.doc.model.parts.CPartSource",
    "com.live2d.cubism.doc.model.parts.CPartSourceSet",
    "com.live2d.cubism.doc.model.texture.CTextureManager",
    "com.live2d.cubism.doc.model.texture.LayeredImageWrapper",
    "com.live2d.cubism.doc.model.texture.TextureImageGroup",
    "com.live2d.cubism.doc.model.texture.modelImage.CModelImage",
    "com.live2d.cubism.doc.model.texture.modelImage.CModelImageGroup",
    "com.live2d.cubism.doc.resources.ACImageLayer",
    "com.live2d.cubism.doc.resources.ACLayerEntry",
    "com.live2d.cubism.doc.resources.ACLayerGroup",
    "com.live2d.cubism.doc.resources.CLayer",
    "com.live2d.cubism.doc.resources.CLayerGroup",
    "com.live2d.cubism.doc.resources.CLayerIdentifier",
    "com.live2d.cubism.doc.resources.CLayeredImage",
    "com.live2d.cubism.doc.resources.LayerSet",
    "com.live2d.doc.CoordType",
    "com.live2d.graphics.CImageCanvas",
    "com.live2d.graphics.CImageResource",
    "com.live2d.graphics.CWritableImage",
    "com.live2d.graphics.cachedImage.CCachedImage",
    "com.live2d.graphics.cachedImage.CCachedImageManager",
    "com.live2d.graphics.cachedImage.CachedImageType",
    "com.live2d.graphics.filter.AValueConnector",
    "com.live2d.graphics.filter.FilterEnv",
    "com.live2d.graphics.filter.FilterEnv$EnvValueSet",
    "com.live2d.graphics.filter.FilterSet",
    "com.live2d.graphics.filter.FilterSet$EnvConnection",
    "com.live2d.graphics.filter.FilterValue",
    "com.live2d.graphics.filter.concreteConnector.EnvValueConnector",
    "com.live2d.graphics.filter.concreteConnector.FilterOutputValueConnector",
    "com.live2d.graphics.filter.filterInstance.FilterInstance",
    "com.live2d.graphics.filter.id.FilterInstanceId",
    "com.live2d.graphics.filter.id.FilterValueId",
    "com.live2d.graphics.psd.blend.ACBlend",
    "com.live2d.graphics.psd.blend.CBlend_Normal",
    "com.live2d.graphics3d.editableMesh.GEditableMesh2",
    "com.live2d.graphics3d.texture.Anisotropy",
    "com.live2d.graphics3d.texture.GTexture",
    "com.live2d.graphics3d.texture.GTexture$FilterMode",
    "com.live2d.graphics3d.texture.GTexture2D",
    "com.live2d.graphics3d.texture.MagFilter",
    "com.live2d.graphics3d.texture.MinFilter",
    "com.live2d.graphics3d.texture.WrapMode",
    "com.live2d.graphics3d.type.GVector2",
    "com.live2d.type.CAffine",
    "com.live2d.type.CColor",
    "com.live2d.type.CDeformerGuid",
    "com.live2d.type.CDrawableGuid",
    "com.live2d.type.CExtensionGuid",
    "com.live2d.type.CFloatColor",
    "com.live2d.type.CFormGuid",
    "com.live2d.type.CImageIcon",
    "com.live2d.type.CLayerGuid",
    "com.live2d.type.CLayeredImageGuid",
    "com.live2d.type.CModelGuid",
    "com.live2d.type.CModelImageGuid",
    "com.live2d.type.CParameterGroupGuid",
    "com.live2d.type.CParameterGuid",
    "com.live2d.type.CPartGuid",
    "com.live2d.type.CPoint",
    "com.live2d.type.CRect",
    "com.live2d.type.CSize",
    "com.live2d.type.GEditableMeshGuid",
    "com.live2d.type.GTextureGuid",
    "com.live2d.type.StaticFilterDefGuid",
]

# Well-known UUIDs for built-in filter types (extracted from Cubism Editor 5.0)
FILTER_DEF_LAYER_SELECTOR = "5e9fe1ea-0ec3-4d68-a5fa-018fc7abe301"
FILTER_DEF_LAYER_FILTER = "4083cd1f-40ba-4eda-8400-379019d55ed8"


class IdAllocator:
    """Sequential xs.id allocator."""
    def __init__(self):
        self._next = 0

    def alloc(self):
        n = self._next
        self._next += 1
        return f"#{n}"


def _uuid():
    return str(uuid.uuid4())


def _e(tag, **attrs):
    """Create XML element with attributes."""
    elem = ET.Element(tag)
    for k, v in attrs.items():
        elem.set(k.replace('__', '.'), str(v))
    return elem


def _sub(parent, tag, **attrs):
    """Create and append sub-element."""
    elem = _e(tag, **attrs)
    parent.append(elem)
    return elem


def make_minimal_png(w, h, r=255, g=255, b=255, a=255):
    """Create a minimal RGBA PNG with solid color."""
    def chunk(ctype, data):
        c = ctype + data
        crc = st.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
        return st.pack('>I', len(data)) + c + crc

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', st.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    pixel = bytes([r, g, b, a])
    raw = b''
    for _ in range(h):
        raw += b'\x00' + pixel * w
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def generate_cmo3(output_path, canvas_w=512, canvas_h=512, mesh_name='ArtMesh0'):
    """Generate a .cmo3 with 1 quad mesh and full texture pipeline.

    The texture pipeline exactly replicates Cubism Editor 5.0's own format:
      CLayeredImage/CLayer → CModelImage (filter env) → CImageResource
      → CTextureInputExtension → CArtMeshSource (MODEL_IMAGE mode)
    """
    ids = IdAllocator()
    shared_objects = []

    def shared(tag, **attrs):
        xid = ids.alloc()
        elem = _e(tag, **{**attrs, 'xs__id': xid, 'xs__idx': str(len(shared_objects))})
        shared_objects.append(elem)
        return elem, xid

    # ==================================================================
    # 1. GLOBAL SHARED OBJECTS (used by all meshes)
    # ==================================================================

    # --- Model-level GUIDs ---
    param_group_guid, pid_param_group = shared('CParameterGroupGuid', uuid=_uuid(), note='root_group')
    param_guid, pid_param = shared('CParameterGuid', uuid=_uuid(), note='ParamOpacity')
    part_guid, pid_part = shared('CPartGuid', uuid=_uuid(), note='PartRoot')
    model_guid, pid_model = shared('CModelGuid', uuid=_uuid(), note='model')

    # --- CBlend_Normal (shared blend mode for all layers) ---
    blend_normal, pid_blend = shared('CBlend_Normal')
    abl = _sub(blend_normal, 'ACBlend', xs__n='super')
    _sub(abl, 's', xs__n='displayName').text = u'\u901a\u5e38'  # "通常" (Normal)

    # --- CLayeredImageGuid (PSD document GUID) ---
    layered_img_guid, pid_li_guid = shared('CLayeredImageGuid', uuid=_uuid(), note='fakepsd')

    # --- CDeformerGuid (ROOT — well-known constant UUID from Cubism Editor) ---
    # This MUST be this exact UUID — Editor compares by UUID equality
    _, pid_deformer_root = shared('CDeformerGuid',
                                   uuid='71fae776-e218-4aee-873e-78e8ac0cb48a', note='ROOT')

    # --- CoordType ---
    coord_type, pid_coord = shared('CoordType')
    _sub(coord_type, 's', xs__n='coordName').text = 'DeformerLocal'

    # --- StaticFilterDefGuids (constant UUIDs for built-in filter types) ---
    filter_def_sel, pid_fdef_sel = shared('StaticFilterDefGuid',
                                          uuid=FILTER_DEF_LAYER_SELECTOR, note='CLayerSelector')
    filter_def_flt, pid_fdef_flt = shared('StaticFilterDefGuid',
                                          uuid=FILTER_DEF_LAYER_FILTER, note='CLayerFilter')

    # --- FilterValueIds (shared across all filter graphs) ---
    # These are like "type identifiers" for filter ports
    _, pid_fvid_ilf_output = shared('FilterValueId', idstr='ilf_outputLayerData')
    _, pid_fvid_mi_layer = shared('FilterValueId', idstr='mi_input_layerInputData')
    _, pid_fvid_ilf_input = shared('FilterValueId', idstr='ilf_inputLayerData')
    _, pid_fvid_mi_guid = shared('FilterValueId', idstr='mi_currentImageGuid')
    _, pid_fvid_ilf_guid = shared('FilterValueId', idstr='ilf_currentImageGuid')
    _, pid_fvid_mi_out_img = shared('FilterValueId', idstr='mi_output_image')
    _, pid_fvid_mi_out_xfm = shared('FilterValueId', idstr='mi_output_transform')
    _, pid_fvid_ilf_in_layer = shared('FilterValueId', idstr='ilf_inputLayer')

    # --- FilterValues (definitions — metadata for filter ports) ---
    fv_sel_layer, pid_fv_sel = shared('FilterValue')
    _sub(fv_sel_layer, 's', xs__n='name').text = 'Select Layer'
    _sub(fv_sel_layer, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_ilf_output)
    _sub(fv_sel_layer, 'null', xs__n='defaultValueInitializer')

    fv_imp_layer, pid_fv_imp = shared('FilterValue')
    _sub(fv_imp_layer, 's', xs__n='name').text = 'Import Layer'
    _sub(fv_imp_layer, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_layer)
    _sub(fv_imp_layer, 'null', xs__n='defaultValueInitializer')

    fv_imp_sel, pid_fv_imp_sel = shared('FilterValue')
    _sub(fv_imp_sel, 's', xs__n='name').text = 'Import Layer selection'
    _sub(fv_imp_sel, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_ilf_input)
    _sub(fv_imp_sel, 'null', xs__n='defaultValueInitializer')

    fv_cur_guid, pid_fv_cur_guid = shared('FilterValue')
    _sub(fv_cur_guid, 's', xs__n='name').text = 'Current GUID'
    _sub(fv_cur_guid, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_guid)
    _sub(fv_cur_guid, 'null', xs__n='defaultValueInitializer')

    fv_sel_guid, pid_fv_sel_guid = shared('FilterValue')
    _sub(fv_sel_guid, 's', xs__n='name').text = 'GUID of Selected Source Image'
    _sub(fv_sel_guid, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_ilf_guid)
    _sub(fv_sel_guid, 'null', xs__n='defaultValueInitializer')

    fv_out_img, pid_fv_out_img = shared('FilterValue')
    _sub(fv_out_img, 's', xs__n='name').text = 'Output image'
    _sub(fv_out_img, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_out_img)
    _sub(fv_out_img, 'null', xs__n='defaultValueInitializer')

    # These two FilterValues have INLINE FilterValueIds (not shared refs)
    fv_out_img_res, pid_fv_out_img_res = shared('FilterValue')
    _sub(fv_out_img_res, 's', xs__n='name').text = 'Output Image (Resource Format)'
    _sub(fv_out_img_res, 'FilterValueId', xs__n='id', idstr='ilf_outputImageRes')
    _sub(fv_out_img_res, 'null', xs__n='defaultValueInitializer')

    fv_out_xfm, pid_fv_out_xfm = shared('FilterValue')
    _sub(fv_out_xfm, 's', xs__n='name').text = u'LayerToCanvas\u5909\u63db'
    _sub(fv_out_xfm, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_out_xfm)
    _sub(fv_out_xfm, 'null', xs__n='defaultValueInitializer')

    fv_out_xfm2, pid_fv_out_xfm2 = shared('FilterValue')
    _sub(fv_out_xfm2, 's', xs__n='name').text = u'LayerToCanvas\u5909\u63db'
    _sub(fv_out_xfm2, 'FilterValueId', xs__n='id', idstr='ilf_outputTransform')
    _sub(fv_out_xfm2, 'null', xs__n='defaultValueInitializer')

    # ==================================================================
    # 2. PER-MESH SHARED OBJECTS
    # ==================================================================

    # --- Mesh GUIDs ---
    _, pid_drawable = shared('CDrawableGuid', uuid=_uuid(), note=mesh_name)
    _, pid_form_mesh = shared('CFormGuid', uuid=_uuid(), note=f'{mesh_name}_form')
    _, pid_form_part = shared('CFormGuid', uuid=_uuid(), note='PartRoot_form')
    _, pid_mi_guid = shared('CModelImageGuid', uuid=_uuid(), note='modelimg0')
    _, pid_tex_guid = shared('GTextureGuid', uuid=_uuid(), note='tex0')
    _, pid_ext_mesh = shared('CExtensionGuid', uuid=_uuid(), note='mesh_ext')
    _, pid_ext_tex = shared('CExtensionGuid', uuid=_uuid(), note='tex_ext')
    _, pid_emesh = shared('GEditableMeshGuid', uuid=_uuid(), note='editmesh0')

    layer_guid_uuid = _uuid()

    # --- CImageResource (the mesh's texture PNG) ---
    img_res, pid_img = shared('CImageResource',
                               width=str(canvas_w), height=str(canvas_h),
                               type='INT_ARGB',
                               imageFileBuf_size='__PATCH_PNG_SIZE__',
                               previewFileBuf_size='0')
    _sub(img_res, 'file', xs__n='imageFileBuf', path='imageFileBuf.png')

    # --- CLayeredImage (fake PSD document) ---
    layered_img, pid_li = shared('CLayeredImage')
    # (filled after CLayerGroup and CLayer are created)

    # --- CLayerGroup (root group) ---
    layer_group, pid_lg = shared('CLayerGroup')
    # (filled after CLayer is created)

    # --- CLayer (the mesh's texture layer) ---
    layer, pid_layer = shared('CLayer')
    # (filled below)

    # Now fill CLayer
    acil = _sub(layer, 'ACImageLayer', xs__n='super')
    ale = _sub(acil, 'ACLayerEntry', xs__n='super')
    _sub(ale, 's', xs__n='name').text = mesh_name
    _sub(ale, 's', xs__n='memo').text = ''
    _sub(ale, 'b', xs__n='isVisible').text = 'true'
    _sub(ale, 'b', xs__n='isClipping').text = 'false'
    _sub(ale, 'CBlend_Normal', xs__n='blend', xs__ref=pid_blend)
    _sub(ale, 'CLayerGuid', xs__n='guid', uuid=layer_guid_uuid, note='(no debug info)')
    _sub(ale, 'CLayerGroup', xs__n='group', xs__ref=pid_lg)
    _sub(ale, 'i', xs__n='opacity255').text = '255'
    _sub(ale, 'hash_map', xs__n='_optionOfIOption', count='0', keyType='string')
    _sub(ale, 'CLayeredImage', xs__n='_layeredImage', xs__ref=pid_li)
    _sub(layer, 'CImageResource', xs__n='imageResource', xs__ref=pid_img)
    bounds = _sub(layer, 'CRect', xs__n='boundsOnImageDoc')
    _sub(bounds, 'i', xs__n='x').text = '0'
    _sub(bounds, 'i', xs__n='y').text = '0'
    _sub(bounds, 'i', xs__n='width').text = str(canvas_w)
    _sub(bounds, 'i', xs__n='height').text = str(canvas_h)
    lid = _sub(layer, 'CLayerIdentifier', xs__n='layerIdentifier')
    _sub(lid, 's', xs__n='layerName').text = mesh_name
    _sub(lid, 's', xs__n='layerId').text = '00-00-00-01'
    _sub(lid, 'i', xs__n='layerIdValue_testImpl').text = '1'
    _sub(layer, 'null', xs__n='icon16')
    _sub(layer, 'null', xs__n='icon64')
    _sub(layer, 'linked_map', xs__n='layerInfo', count='0', keyType='string')
    _sub(layer, 'hash_map', xs__n='_optionOfIOption', count='0', keyType='string')

    # Fill CLayerGroup (root)
    alg = _sub(layer_group, 'ACLayerGroup', xs__n='super')
    ale2 = _sub(alg, 'ACLayerEntry', xs__n='super')
    _sub(ale2, 's', xs__n='name').text = 'root'
    _sub(ale2, 's', xs__n='memo').text = ''
    _sub(ale2, 'b', xs__n='isVisible').text = 'true'
    _sub(ale2, 'b', xs__n='isClipping').text = 'false'
    _sub(ale2, 'CBlend_Normal', xs__n='blend', xs__ref=pid_blend)
    _sub(ale2, 'CLayerGuid', xs__n='guid', uuid=_uuid(), note='(no debug info)')
    _sub(ale2, 'null', xs__n='group')
    _sub(ale2, 'i', xs__n='opacity255').text = '255'
    _sub(ale2, 'hash_map', xs__n='_optionOfIOption', count='0', keyType='string')
    _sub(ale2, 'CLayeredImage', xs__n='_layeredImage', xs__ref=pid_li)
    children = _sub(alg, 'carray_list', xs__n='_children', count='1')
    _sub(children, 'CLayer', xs__ref=pid_layer)
    _sub(layer_group, 'null', xs__n='layerIdentifier')

    # Fill CLayeredImage
    _sub(layered_img, 's', xs__n='name').text = 'fake_psd.psd'
    _sub(layered_img, 's', xs__n='memo').text = ''
    _sub(layered_img, 'i', xs__n='width').text = str(canvas_w)
    _sub(layered_img, 'i', xs__n='height').text = str(canvas_h)
    _sub(layered_img, 'file', xs__n='psdFile').text = 'fake_psd.psd'
    _sub(layered_img, 's', xs__n='description').text = ''
    _sub(layered_img, 'CLayeredImageGuid', xs__n='guid', xs__ref=pid_li_guid)
    _sub(layered_img, 'null', xs__n='psdBytes')
    _sub(layered_img, 'l', xs__n='psdFileLastModified').text = '0'
    _sub(layered_img, 'CLayerGroup', xs__n='_rootLayer', xs__ref=pid_lg)
    layer_set = _sub(layered_img, 'LayerSet', xs__n='layerSet')
    _sub(layer_set, 'CLayeredImage', xs__n='_layeredImage', xs__ref=pid_li)
    ls_list = _sub(layer_set, 'carray_list', xs__n='_layerEntryList', count='2')
    _sub(ls_list, 'CLayerGroup', xs__ref=pid_lg)
    _sub(ls_list, 'CLayer', xs__ref=pid_layer)
    _sub(layered_img, 'null', xs__n='icon16')
    _sub(layered_img, 'null', xs__n='icon64')

    # ==================================================================
    # 3. FILTER GRAPH (per-mesh: ModelImageFilterSet + FilterInstances)
    # ==================================================================
    # Each mesh gets its own ModelImageFilterSet with 2 FilterInstances:
    #   filter0: CLayerSelector (selects which PSD layer to render)
    #   filter1: CLayerFilter (renders the selected layer)
    # Shared FilterValueIds and FilterValues are referenced via xs.ref.

    filter_set, pid_fset = shared('ModelImageFilterSet')

    _, pid_fiid0 = shared('FilterInstanceId', idstr='filter0')
    fi_selector, pid_fi_sel = shared('FilterInstance', filterName='CLayerSelector')

    fout_conn, pid_fout = shared('FilterOutputValueConnector')

    _, pid_fiid1 = shared('FilterInstanceId', idstr='filter1')
    fi_filter, pid_fi_flt = shared('FilterInstance', filterName='CLayerFilter')

    # Fill FilterOutputValueConnector
    _sub(fout_conn, 'AValueConnector', xs__n='super')
    _sub(fout_conn, 'FilterInstance', xs__n='instance', xs__ref=pid_fi_sel)
    _sub(fout_conn, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_ilf_output)
    _sub(fout_conn, 'FilterValue', xs__n='valueDef', xs__ref=pid_fv_sel)

    # Fill FilterInstance: CLayerSelector
    _sub(fi_selector, 'StaticFilterDefGuid', xs__n='filterDefGuid', xs__ref=pid_fdef_sel)
    _sub(fi_selector, 'null', xs__n='filterDef')
    _sub(fi_selector, 'FilterInstanceId', xs__n='filterId', xs__ref=pid_fiid0)
    # Input connectors: map internal filter inputs → external env values
    ic_sel = _sub(fi_selector, 'hash_map', xs__n='inputConnectors', count='2')
    # ilf_inputLayerData → mi_input_layerInputData
    e1 = _sub(ic_sel, 'entry')
    _sub(e1, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_input)
    evc1 = _sub(e1, 'EnvValueConnector', xs__n='value')
    _sub(evc1, 'AValueConnector', xs__n='super')
    _sub(evc1, 'FilterValueId', xs__n='envValueId', xs__ref=pid_fvid_mi_layer)
    # ilf_currentImageGuid → mi_currentImageGuid
    e2 = _sub(ic_sel, 'entry')
    _sub(e2, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_guid)
    evc2 = _sub(e2, 'EnvValueConnector', xs__n='value')
    _sub(evc2, 'AValueConnector', xs__n='super')
    _sub(evc2, 'FilterValueId', xs__n='envValueId', xs__ref=pid_fvid_mi_guid)
    # Output connectors: 1 output (ilf_outputLayerData → FilterOutputValueConnector)
    oc_sel = _sub(fi_selector, 'hash_map', xs__n='outputConnectors', count='1')
    e3 = _sub(oc_sel, 'entry')
    _sub(e3, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_output)
    _sub(e3, 'FilterOutputValueConnector', xs__n='value', xs__ref=pid_fout)
    _sub(fi_selector, 'ModelImageFilterSet', xs__n='ownerFilterSet', xs__ref=pid_fset)

    # Fill FilterInstance: CLayerFilter
    _sub(fi_filter, 'StaticFilterDefGuid', xs__n='filterDefGuid', xs__ref=pid_fdef_flt)
    _sub(fi_filter, 'null', xs__n='filterDef')
    _sub(fi_filter, 'FilterInstanceId', xs__n='filterId', xs__ref=pid_fiid1)
    # Input: ilf_inputLayer → FilterOutputValueConnector from CLayerSelector
    ic_flt = _sub(fi_filter, 'hash_map', xs__n='inputConnectors', count='1')
    e4 = _sub(ic_flt, 'entry')
    _sub(e4, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_in_layer)
    _sub(e4, 'FilterOutputValueConnector', xs__n='value', xs__ref=pid_fout)
    # No output connectors (outputs go through _externalOutputs)
    _sub(fi_filter, 'hash_map', xs__n='outputConnectors', count='0', keyType='string')
    _sub(fi_filter, 'ModelImageFilterSet', xs__n='ownerFilterSet', xs__ref=pid_fset)

    # Fill ModelImageFilterSet
    fs_super = _sub(filter_set, 'FilterSet', xs__n='super')
    # filterMap: maps FilterInstanceId → FilterInstance
    fm = _sub(fs_super, 'linked_map', xs__n='filterMap', count='2')
    fm_e1 = _sub(fm, 'entry')
    _sub(fm_e1, 'FilterInstanceId', xs__n='key', xs__ref=pid_fiid0)
    _sub(fm_e1, 'FilterInstance', xs__n='value', xs__ref=pid_fi_sel)
    fm_e2 = _sub(fm, 'entry')
    _sub(fm_e2, 'FilterInstanceId', xs__n='key', xs__ref=pid_fiid1)
    _sub(fm_e2, 'FilterInstance', xs__n='value', xs__ref=pid_fi_flt)
    # _externalInputs: external env → filter input mapping
    ei = _sub(fs_super, 'linked_map', xs__n='_externalInputs', count='2')
    ei_e1 = _sub(ei, 'entry')
    _sub(ei_e1, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_layer)
    ec1 = _sub(ei_e1, 'EnvConnection', xs__n='value')
    _sub(ec1, 'FilterValue', xs__n='_envValueDef', xs__ref=pid_fv_imp)
    _sub(ec1, 'FilterInstance', xs__n='filter', xs__ref=pid_fi_sel)
    _sub(ec1, 'FilterValue', xs__n='filterValueDef', xs__ref=pid_fv_imp_sel)
    ei_e2 = _sub(ei, 'entry')
    _sub(ei_e2, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_guid)
    ec2 = _sub(ei_e2, 'EnvConnection', xs__n='value')
    _sub(ec2, 'FilterValue', xs__n='_envValueDef', xs__ref=pid_fv_cur_guid)
    _sub(ec2, 'FilterInstance', xs__n='filter', xs__ref=pid_fi_sel)
    _sub(ec2, 'FilterValue', xs__n='filterValueDef', xs__ref=pid_fv_sel_guid)
    # _externalOutputs: filter output → external env mapping
    eo = _sub(fs_super, 'linked_map', xs__n='_externalOutputs', count='2')
    eo_e1 = _sub(eo, 'entry')
    _sub(eo_e1, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_out_img)
    ec3 = _sub(eo_e1, 'EnvConnection', xs__n='value')
    _sub(ec3, 'FilterValue', xs__n='_envValueDef', xs__ref=pid_fv_out_img)
    _sub(ec3, 'FilterInstance', xs__n='filter', xs__ref=pid_fi_flt)
    _sub(ec3, 'FilterValue', xs__n='filterValueDef', xs__ref=pid_fv_out_img_res)
    eo_e2 = _sub(eo, 'entry')
    _sub(eo_e2, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_out_xfm)
    ec4 = _sub(eo_e2, 'EnvConnection', xs__n='value')
    _sub(ec4, 'FilterValue', xs__n='_envValueDef', xs__ref=pid_fv_out_xfm)
    _sub(ec4, 'FilterInstance', xs__n='filter', xs__ref=pid_fi_flt)
    _sub(ec4, 'FilterValue', xs__n='filterValueDef', xs__ref=pid_fv_out_xfm2)

    # ==================================================================
    # 4. GTexture2D (GPU texture for the mesh)
    # ==================================================================
    tex2d, pid_tex2d = shared('GTexture2D')
    gtex = _sub(tex2d, 'GTexture', xs__n='super')
    _sub(gtex, 's', xs__n='name').text = mesh_name
    _sub(gtex, 'WrapMode', xs__n='wrapMode', v='CLAMP_TO_BORDER')
    fm_tex = _sub(gtex, 'FilterMode', xs__n='filterMode')
    _sub(fm_tex, 'GTexture2D', xs__n='owner', xs__ref=pid_tex2d)
    _sub(fm_tex, 'MinFilter', xs__n='minFilter', v='LINEAR_MIPMAP_LINEAR')
    _sub(fm_tex, 'MagFilter', xs__n='magFilter', v='LINEAR')
    _sub(gtex, 'GTextureGuid', xs__n='guid', xs__ref=pid_tex_guid)
    _sub(gtex, 'Anisotropy', xs__n='anisotropy', v='ON')
    _sub(tex2d, 'CImageResource', xs__n='srcImageResource', xs__ref=pid_img)
    _sub(tex2d, 'CAffine', xs__n='transformImageResource01toLogical01',
         m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
    _sub(tex2d, 'i', xs__n='mipmapLevel').text = '1'
    _sub(tex2d, 'b', xs__n='isPremultiplied').text = 'true'

    # ==================================================================
    # 5. CTextureInputExtension + CTextureInput_ModelImage
    # ==================================================================
    tex_input_ext, pid_tie = shared('CTextureInputExtension')
    tex_input_mi, pid_timi = shared('CTextureInput_ModelImage')

    # Fill CTextureInput_ModelImage
    ati = _sub(tex_input_mi, 'ACTextureInput', xs__n='super')
    _sub(ati, 'CAffine', xs__n='optionalTransformOnCanvas',
         m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
    _sub(ati, 'CTextureInputExtension', xs__n='_owner', xs__ref=pid_tie)
    _sub(tex_input_mi, 'CModelImageGuid', xs__n='_modelImageGuid', xs__ref=pid_mi_guid)

    # Fill CTextureInputExtension (partially — _owner set after mesh is created)
    tie_sup = _sub(tex_input_ext, 'ACExtension', xs__n='super')
    _sub(tie_sup, 'CExtensionGuid', xs__n='guid', xs__ref=pid_ext_tex)
    # _owner placeholder — set after CArtMeshSource
    tie_inputs = _sub(tex_input_ext, 'carray_list', xs__n='_textureInputs', count='1')
    _sub(tie_inputs, 'CTextureInput_ModelImage', xs__ref=pid_timi)
    _sub(tex_input_ext, 'CTextureInput_ModelImage', xs__n='currentTextureInputData', xs__ref=pid_timi)

    # ==================================================================
    # 6. KEYFORM SYSTEM
    # ==================================================================

    # KeyformBindingSource + KeyformGridSource (for mesh)
    kf_binding, pid_kfb = shared('KeyformBindingSource')
    kf_grid_mesh, pid_kfg_mesh = shared('KeyformGridSource')

    kfog = _sub(kf_grid_mesh, 'array_list', xs__n='keyformsOnGrid', count='1')
    kog = _sub(kfog, 'KeyformOnGrid')
    ak = _sub(kog, 'KeyformGridAccessKey', xs__n='accessKey')
    kop_list = _sub(ak, 'array_list', xs__n='_keyOnParameterList', count='1')
    kop = _sub(kop_list, 'KeyOnParameter')
    _sub(kop, 'KeyformBindingSource', xs__n='binding', xs__ref=pid_kfb)
    _sub(kop, 'i', xs__n='keyIndex').text = '0'
    _sub(kog, 'CFormGuid', xs__n='keyformGuid', xs__ref=pid_form_mesh)
    kb = _sub(kf_grid_mesh, 'array_list', xs__n='keyformBindings', count='1')
    _sub(kb, 'KeyformBindingSource', xs__ref=pid_kfb)

    # Fill KeyformBindingSource
    _sub(kf_binding, 'KeyformGridSource', xs__n='_gridSource', xs__ref=pid_kfg_mesh)
    _sub(kf_binding, 'CParameterGuid', xs__n='parameterGuid', xs__ref=pid_param)
    keys = _sub(kf_binding, 'array_list', xs__n='keys', count='1')
    _sub(keys, 'f').text = '1.0'
    _sub(kf_binding, 'InterpolationType', xs__n='interpolationType', v='LINEAR')
    _sub(kf_binding, 'ExtendedInterpolationType', xs__n='extendedInterpolationType', v='LINEAR')
    _sub(kf_binding, 'i', xs__n='insertPointCount').text = '1'
    _sub(kf_binding, 'f', xs__n='extendedInterpolationScale').text = '1.0'
    _sub(kf_binding, 's', xs__n='description').text = 'ParamOpacity'

    # KeyformGridSource (for part — empty bindings)
    kf_grid_part, pid_kfg_part = shared('KeyformGridSource')
    kfog2 = _sub(kf_grid_part, 'array_list', xs__n='keyformsOnGrid', count='1')
    kog2 = _sub(kfog2, 'KeyformOnGrid')
    ak2 = _sub(kog2, 'KeyformGridAccessKey', xs__n='accessKey')
    _sub(ak2, 'array_list', xs__n='_keyOnParameterList', count='0')
    _sub(kog2, 'CFormGuid', xs__n='keyformGuid', xs__ref=pid_form_part)
    _sub(kf_grid_part, 'array_list', xs__n='keyformBindings', count='0')

    # ==================================================================
    # 6b. CPartSource (shared — needs self-reference for rootPart + _source)
    # ==================================================================
    part_src, pid_part_src = shared('CPartSource')
    part_ctrl = _sub(part_src, 'ACParameterControllableSource', xs__n='super')
    _sub(part_ctrl, 's', xs__n='localName').text = 'Root Part'
    _sub(part_ctrl, 'b', xs__n='isVisible').text = 'true'
    _sub(part_ctrl, 'b', xs__n='isLocked').text = 'false'
    _sub(part_ctrl, 'null', xs__n='parentGuid')
    _sub(part_ctrl, 'KeyformGridSource', xs__n='keyformGridSource', xs__ref=pid_kfg_part)
    morph2 = _sub(part_ctrl, 'KeyFormMorphTargetSet', xs__n='keyformMorphTargetSet')
    _sub(morph2, 'carray_list', xs__n='_morphTargets', count='0')
    mbw2 = _sub(morph2, 'MorphTargetBlendWeightConstraintSet', xs__n='blendWeightConstraintSet')
    _sub(mbw2, 'carray_list', xs__n='_constraints', count='0')
    _sub(part_ctrl, 'carray_list', xs__n='_extensions', count='0')
    _sub(part_ctrl, 'null', xs__n='internalColor_direct_argb')
    _sub(part_src, 'CPartGuid', xs__n='guid', xs__ref=pid_part)
    _sub(part_src, 'CPartId', xs__n='id', idstr='PartRoot')
    _sub(part_src, 'b', xs__n='enableDrawOrderGroup').text = 'false'
    _sub(part_src, 'i', xs__n='defaultOrder_forEditor').text = '500'
    _sub(part_src, 'b', xs__n='isSketch').text = 'false'
    _sub(part_src, 'CColor', xs__n='partsEditColor')
    child_guids = _sub(part_src, 'carray_list', xs__n='_childGuids', count='1')
    _sub(child_guids, 'CDrawableGuid', xs__ref=pid_drawable)
    _sub(part_src, 'CDeformerGuid', xs__n='targetDeformerGuid', xs__ref=pid_deformer_root)
    kf_part_list = _sub(part_src, 'carray_list', xs__n='keyforms', count='1')
    part_form = _sub(kf_part_list, 'CPartForm')
    part_acf = _sub(part_form, 'ACForm', xs__n='super')
    _sub(part_acf, 'CFormGuid', xs__n='guid', xs__ref=pid_form_part)
    _sub(part_acf, 'b', xs__n='isAnimatedForm').text = 'false'
    _sub(part_acf, 'b', xs__n='isLocalAnimatedForm').text = 'false'
    _sub(part_acf, 'CPartSource', xs__n='_source', xs__ref=pid_part_src)  # self-reference!
    _sub(part_acf, 'null', xs__n='name')
    _sub(part_acf, 's', xs__n='notes').text = ''
    _sub(part_form, 'i', xs__n='drawOrder').text = '500'

    # ==================================================================
    # 7. CArtMeshSource (the actual mesh)
    # ==================================================================
    mesh_src, pid_mesh = shared('CArtMeshSource')

    # Set _owner on CTextureInputExtension now that mesh exists
    _sub(tie_sup, 'CArtMeshSource', xs__n='_owner', xs__ref=pid_mesh)

    # Mesh geometry: centered quad
    hw = canvas_w / 4
    hh = canvas_h / 4
    cx, cy = canvas_w / 2, canvas_h / 2
    points = [cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh]

    ds = _sub(mesh_src, 'ACDrawableSource', xs__n='super')
    pc = _sub(ds, 'ACParameterControllableSource', xs__n='super')
    _sub(pc, 's', xs__n='localName').text = mesh_name
    _sub(pc, 'b', xs__n='isVisible').text = 'true'
    _sub(pc, 'b', xs__n='isLocked').text = 'false'
    _sub(pc, 'CPartGuid', xs__n='parentGuid', xs__ref=pid_part)
    _sub(pc, 'KeyformGridSource', xs__n='keyformGridSource', xs__ref=pid_kfg_mesh)
    morph = _sub(pc, 'KeyFormMorphTargetSet', xs__n='keyformMorphTargetSet')
    _sub(morph, 'carray_list', xs__n='_morphTargets', count='0')
    mbw = _sub(morph, 'MorphTargetBlendWeightConstraintSet', xs__n='blendWeightConstraintSet')
    _sub(mbw, 'carray_list', xs__n='_constraints', count='0')

    # Extensions: editable mesh + texture input + mesh generator
    ext_list = _sub(pc, 'carray_list', xs__n='_extensions', count='3')

    # Editable mesh extension
    eme = _sub(ext_list, 'CEditableMeshExtension')
    eme_sup = _sub(eme, 'ACExtension', xs__n='super')
    _sub(eme_sup, 'CExtensionGuid', xs__n='guid', xs__ref=pid_ext_mesh)
    _sub(eme_sup, 'CArtMeshSource', xs__n='_owner', xs__ref=pid_mesh)
    em = _sub(eme, 'GEditableMesh2', xs__n='editableMesh',
              nextPointUid='4', useDelaunayTriangulation='true')
    _sub(em, 'float-array', xs__n='point', count='8').text = ' '.join(f'{v:.1f}' for v in points)
    _sub(em, 'byte-array', xs__n='pointPriority', count='4').text = '20 20 20 20'
    _sub(em, 'short-array', xs__n='edge', count='10').text = '0 1 1 2 2 3 3 0 0 2'
    _sub(em, 'byte-array', xs__n='edgePriority', count='5').text = '30 30 30 30 30'
    _sub(em, 'int-array', xs__n='pointUid', count='4').text = '0 1 2 3'
    _sub(em, 'GEditableMeshGuid', xs__n='meshGuid', xs__ref=pid_emesh)
    _sub(em, 'CoordType', xs__n='coordType', xs__ref=pid_coord)
    _sub(eme, 'b', xs__n='isLocked').text = 'false'

    # Texture input extension ref
    _sub(ext_list, 'CTextureInputExtension', xs__ref=pid_tie)

    # CMeshGeneratorExtension (required — without it, Editor marks mesh as "recovered")
    mge = _sub(ext_list, 'CMeshGeneratorExtension')
    mge_sup = _sub(mge, 'ACExtension', xs__n='super')
    _sub(mge_sup, 'CExtensionGuid', xs__n='guid', uuid=_uuid(), note='(no debug info)')
    _sub(mge_sup, 'CArtMeshSource', xs__n='_owner', xs__ref=pid_mesh)
    mgs = _sub(mge, 'MeshGenerateSetting', xs__n='meshGenerateSetting')
    _sub(mgs, 'i', xs__n='polygonOuterDensity').text = '100'
    _sub(mgs, 'i', xs__n='polygonInnerDensity').text = '100'
    _sub(mgs, 'i', xs__n='polygonMargin').text = '20'
    _sub(mgs, 'i', xs__n='polygonInnerMargin').text = '20'
    _sub(mgs, 'i', xs__n='polygonMinMargin').text = '5'
    _sub(mgs, 'i', xs__n='polygonMinBoundsPt').text = '5'
    _sub(mgs, 'i', xs__n='thresholdAlpha').text = '0'

    _sub(pc, 'null', xs__n='internalColor_direct_argb')

    _sub(ds, 'CDrawableId', xs__n='id', idstr=mesh_name)
    _sub(ds, 'CDrawableGuid', xs__n='guid', xs__ref=pid_drawable)
    _sub(ds, 'CDeformerGuid', xs__n='targetDeformerGuid', xs__ref=pid_deformer_root)
    _sub(ds, 'carray_list', xs__n='clipGuidList', count='0')
    _sub(ds, 'b', xs__n='invertClippingMask').text = 'false'

    # Triangle indices
    _sub(mesh_src, 'int-array', xs__n='indices', count='6').text = '0 1 2 0 2 3'

    # Keyforms
    kf_list = _sub(mesh_src, 'carray_list', xs__n='keyforms', count='1')
    art_form = _sub(kf_list, 'CArtMeshForm')
    adf = _sub(art_form, 'ACDrawableForm', xs__n='super')
    acf = _sub(adf, 'ACForm', xs__n='super')
    _sub(acf, 'CFormGuid', xs__n='guid', xs__ref=pid_form_mesh)
    _sub(acf, 'b', xs__n='isAnimatedForm').text = 'false'
    _sub(acf, 'b', xs__n='isLocalAnimatedForm').text = 'false'
    _sub(acf, 'CArtMeshSource', xs__n='_source', xs__ref=pid_mesh)
    _sub(acf, 'null', xs__n='name')
    _sub(acf, 's', xs__n='notes').text = ''
    _sub(adf, 'i', xs__n='drawOrder').text = '500'
    _sub(adf, 'f', xs__n='opacity').text = '1.0'
    _sub(adf, 'CFloatColor', xs__n='multiplyColor', red='1.0', green='1.0', blue='1.0', alpha='1.0')
    _sub(adf, 'CFloatColor', xs__n='screenColor', red='0.0', green='0.0', blue='0.0', alpha='1.0')
    _sub(adf, 'CoordType', xs__n='coordType', xs__ref=pid_coord)
    _sub(art_form, 'float-array', xs__n='positions', count='8').text = ' '.join(f'{v:.1f}' for v in points)

    # Pixel-space positions
    _sub(mesh_src, 'float-array', xs__n='positions', count='8').text = ' '.join(f'{v:.1f}' for v in points)

    # UVs (0-1 range)
    uvs = [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]
    _sub(mesh_src, 'float-array', xs__n='uvs', count='8').text = ' '.join(f'{v:.1f}' for v in uvs)
    _sub(mesh_src, 'GTexture2D', xs__n='texture', xs__ref=pid_tex2d)
    _sub(mesh_src, 'ColorComposition', xs__n='colorComposition', v='NORMAL')
    _sub(mesh_src, 'b', xs__n='culling').text = 'false'
    # KEY CHANGE: MODEL_IMAGE instead of TEXTURE_ATLAS
    _sub(mesh_src, 'TextureState', xs__n='textureState', v='MODEL_IMAGE')
    _sub(mesh_src, 's', xs__n='userData').text = ''

    # ==================================================================
    # 8. CModelImageGroup (with inline CModelImage)
    # ==================================================================
    img_group, pid_img_grp = shared('CModelImageGroup')
    _sub(img_group, 's', xs__n='memo').text = ''
    _sub(img_group, 's', xs__n='groupName').text = 'stretchy_export'
    li_guids = _sub(img_group, 'carray_list', xs__n='_linkedRawImageGuids', count='1')
    _sub(li_guids, 'CLayeredImageGuid', xs__ref=pid_li_guid)

    # Inline CModelImage (NOT a shared object — embedded in group)
    mi_list = _sub(img_group, 'carray_list', xs__n='_modelImages', count='1')
    mi = _sub(mi_list, 'CModelImage', modelImageVersion='0')
    _sub(mi, 'CModelImageGuid', xs__n='guid', xs__ref=pid_mi_guid)
    _sub(mi, 's', xs__n='name').text = mesh_name

    # inputFilter → our ModelImageFilterSet
    _sub(mi, 'ModelImageFilterSet', xs__n='inputFilter', xs__ref=pid_fset)

    # inputFilterEnv — the per-mesh environment values
    mife = _sub(mi, 'ModelImageFilterEnv', xs__n='inputFilterEnv')
    fe = _sub(mife, 'FilterEnv', xs__n='super')
    _sub(fe, 'null', xs__n='parentEnv')
    env_map = _sub(fe, 'hash_map', xs__n='envValues', count='2')
    # Entry 1: mi_currentImageGuid → CLayeredImageGuid
    env_e1 = _sub(env_map, 'entry')
    _sub(env_e1, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_guid)
    evs1 = _sub(env_e1, 'EnvValueSet', xs__n='value')
    _sub(evs1, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_guid)
    _sub(evs1, 'CLayeredImageGuid', xs__n='value', xs__ref=pid_li_guid)
    _sub(evs1, 'l', xs__n='updateTimeMs').text = '0'
    # Entry 2: mi_input_layerInputData → CLayerSelectorMap
    env_e2 = _sub(env_map, 'entry')
    _sub(env_e2, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_layer)
    evs2 = _sub(env_e2, 'EnvValueSet', xs__n='value')
    _sub(evs2, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_layer)
    lsm = _sub(evs2, 'CLayerSelectorMap', xs__n='value')
    itli = _sub(lsm, 'linked_map', xs__n='_imageToLayerInput', count='1')
    itli_e = _sub(itli, 'entry')
    _sub(itli_e, 'CLayeredImageGuid', xs__n='key', xs__ref=pid_li_guid)
    itli_v = _sub(itli_e, 'array_list', xs__n='value', count='1')
    lid_data = _sub(itli_v, 'CLayerInputData')
    _sub(lid_data, 'CLayer', xs__n='layer', xs__ref=pid_layer)
    _sub(lid_data, 'CAffine', xs__n='affine',
         m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
    _sub(lid_data, 'null', xs__n='clippingOnTexturePx')
    _sub(evs2, 'l', xs__n='updateTimeMs').text = '0'

    # _filteredImage → the final baked CImageResource
    _sub(mi, 'CImageResource', xs__n='_filteredImage', xs__ref=pid_img)
    _sub(mi, 'null', xs__n='icon16')
    # _materialLocalToCanvasTransform (identity — layer covers whole canvas)
    _sub(mi, 'CAffine', xs__n='_materialLocalToCanvasTransform',
         m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
    _sub(mi, 'CModelImageGroup', xs__n='_group', xs__ref=pid_img_grp)
    mi_lrig = _sub(mi, 'carray_list', xs__n='linkedRawImageGuids', count='1')
    _sub(mi_lrig, 'CLayeredImageGuid', xs__ref=pid_li_guid)

    # CCachedImageManager
    cim = _sub(mi, 'CCachedImageManager', xs__n='cachedImageManager')
    _sub(cim, 'CachedImageType', xs__n='defaultCacheType', v='SCALE_1')
    _sub(cim, 'CImageResource', xs__n='rawImage', xs__ref=pid_img)
    ci_list = _sub(cim, 'array_list', xs__n='cachedImages', count='1')
    ci = _sub(ci_list, 'CCachedImage')
    _sub(ci, 'CImageResource', xs__n='_cachedImageResource', xs__ref=pid_img)
    _sub(ci, 'b', xs__n='isSharedImage').text = 'true'
    _sub(ci, 'CSize', xs__n='rawImageSize', width=str(canvas_w), height=str(canvas_h))
    _sub(ci, 'i', xs__n='reductionRatio').text = '1'
    _sub(ci, 'i', xs__n='mipmapLevel').text = '1'
    _sub(ci, 'b', xs__n='hasMargin').text = 'false'
    _sub(ci, 'b', xs__n='isCleaned').text = 'false'
    _sub(ci, 'CAffine', xs__n='transformRawImageToCachedImage',
         m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
    _sub(cim, 'i', xs__n='requiredMipmapLevel').text = '1'

    _sub(mi, 's', xs__n='memo').text = ''

    # ==================================================================
    # 9. BUILD main.xml
    # ==================================================================
    pi_lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    for name, ver in VERSION_PIS:
        pi_lines.append(f'<?version {name}:{ver}?>')
    for imp in IMPORT_PIS:
        pi_lines.append(f'<?import {imp}?>')

    root = _e('root', fileFormatVersion='402030000')

    # Shared section
    shared_elem = _sub(root, 'shared')
    for obj in shared_objects:
        shared_elem.append(obj)

    # Main section
    main_elem = _sub(root, 'main')
    model = _sub(main_elem, 'CModelSource', isDefaultKeyformLocked='true')
    _sub(model, 'CModelGuid', xs__n='guid', xs__ref=pid_model)
    _sub(model, 's', xs__n='name').text = 'StretchyStudio Export'
    edition = _sub(model, 'EditorEdition', xs__n='editorEdition')
    _sub(edition, 'i', xs__n='edition').text = '15'

    # Canvas
    canvas = _sub(model, 'CImageCanvas', xs__n='canvas')
    _sub(canvas, 'i', xs__n='pixelWidth').text = str(canvas_w)
    _sub(canvas, 'i', xs__n='pixelHeight').text = str(canvas_h)
    _sub(canvas, 'CColor', xs__n='background')

    # Parameters
    param_set = _sub(model, 'CParameterSourceSet', xs__n='parameterSourceSet')
    param_sources = _sub(param_set, 'carray_list', xs__n='_sources', count='1')
    ps = _sub(param_sources, 'CParameterSource')
    _sub(ps, 'i', xs__n='decimalPlaces').text = '1'
    _sub(ps, 'CParameterGuid', xs__n='guid', xs__ref=pid_param)
    _sub(ps, 'f', xs__n='snapEpsilon').text = '0.1'
    _sub(ps, 'f', xs__n='minValue').text = '0.0'
    _sub(ps, 'f', xs__n='maxValue').text = '1.0'
    _sub(ps, 'f', xs__n='defaultValue').text = '1.0'
    _sub(ps, 'b', xs__n='isRepeat').text = 'false'
    _sub(ps, 'CParameterId', xs__n='id', idstr='ParamOpacity')
    _sub(ps, 'Type', xs__n='paramType', v='NORMAL')
    _sub(ps, 's', xs__n='name').text = 'Opacity'
    _sub(ps, 's', xs__n='description').text = ''
    _sub(ps, 'b', xs__n='combined').text = 'false'
    _sub(ps, 'CParameterGroupGuid', xs__n='parentGroupGuid', xs__ref=pid_param_group)

    # Texture manager — FULL PIPELINE
    tex_mgr = _sub(model, 'CTextureManager', xs__n='textureManager')
    tex_list = _sub(tex_mgr, 'TextureImageGroup', xs__n='textureList')
    _sub(tex_list, 'carray_list', xs__n='children', count='0')
    # _rawImages: LayeredImageWrapper wrapping CLayeredImage (NOT raw CLayeredImage!)
    ri = _sub(tex_mgr, 'carray_list', xs__n='_rawImages', count='1')
    liw = _sub(ri, 'LayeredImageWrapper')
    _sub(liw, 'CLayeredImage', xs__n='image', xs__ref=pid_li)
    _sub(liw, 'l', xs__n='importedTimeMSec').text = '0'
    _sub(liw, 'l', xs__n='lastModifiedTimeMSec').text = '0'
    _sub(liw, 'b', xs__n='isReplaced').text = 'false'
    # _modelImageGroups: references to CModelImageGroup
    mig = _sub(tex_mgr, 'carray_list', xs__n='_modelImageGroups', count='1')
    _sub(mig, 'CModelImageGroup', xs__ref=pid_img_grp)
    _sub(tex_mgr, 'carray_list', xs__n='_textureAtlases', count='0')
    # KEY FLAG: enable ModelImage mode
    _sub(tex_mgr, 'b', xs__n='isTextureInputModelImageMode').text = 'true'
    _sub(tex_mgr, 'i', xs__n='previewReductionRatio').text = '1'
    _sub(tex_mgr, 'carray_list', xs__n='artPathBrushUsingLayeredImageIds', count='0')

    # Drawable source set
    _sub(model, 'b', xs__n='useLegacyDrawOrder__testImpl').text = 'false'
    draw_set = _sub(model, 'CDrawableSourceSet', xs__n='drawableSourceSet')
    draw_sources = _sub(draw_set, 'carray_list', xs__n='_sources', count='1')
    _sub(draw_sources, 'CArtMeshSource', xs__ref=pid_mesh)

    # Deformer source set (empty)
    deformer_set = _sub(model, 'CDeformerSourceSet', xs__n='deformerSourceSet')
    _sub(deformer_set, 'carray_list', xs__n='_sources', count='0')

    # Affecter source set (empty — required by CModelSource.deserialize)
    affecter_set = _sub(model, 'CAffecterSourceSet', xs__n='affecterSourceSet')
    _sub(affecter_set, 'carray_list', xs__n='_sources', count='0')

    # Part source set — CPartSource is a SHARED object (needs self-reference)
    part_set = _sub(model, 'CPartSourceSet', xs__n='partSourceSet')
    part_sources = _sub(part_set, 'carray_list', xs__n='_sources', count='1')
    _sub(part_sources, 'CPartSource', xs__ref=pid_part_src)

    # Root part ref — must reference CPartSource, NOT CPartGuid!
    _sub(model, 'CPartSource', xs__n='rootPart', xs__ref=pid_part_src)

    # Parameter group set
    pg_set = _sub(model, 'CParameterGroupSet', xs__n='parameterGroupSet')
    _sub(pg_set, 'carray_list', xs__n='_groups', count='0')

    # Model info
    mi_info = _sub(model, 'CModelInfo', xs__n='modelInfo')
    _sub(mi_info, 'f', xs__n='pixelsPerUnit').text = '1.0'
    origin = _sub(mi_info, 'CPoint', xs__n='originInPixels')
    _sub(origin, 'i', xs__n='x').text = '0'
    _sub(origin, 'i', xs__n='y').text = '0'

    _sub(model, 'i', xs__n='targetVersionNo').text = '3000'
    _sub(model, 'i', xs__n='latestVersionOfLastModelerNo').text = '5000000'

    # ==================================================================
    # 10. CREATE TEXTURE PNG + SERIALIZE + PACK
    # ==================================================================
    tex_png = make_minimal_png(canvas_w, canvas_h, r=255, g=0, b=0, a=255)  # RED

    xml_str = ET.tostring(root, encoding='unicode')
    xml_str = xml_str.replace('__PATCH_PNG_SIZE__', str(len(tex_png)))
    full_xml = '\n'.join(pi_lines) + '\n' + xml_str
    xml_bytes = full_xml.encode('utf-8')

    caff_data = pack_caff([
        {
            'path': 'imageFileBuf.png',
            'content': tex_png,
            'tag': '',
            'obfuscated': True,
            'compress': COMPRESS_RAW,
        },
        {
            'path': 'main.xml',
            'content': xml_bytes,
            'tag': 'main_xml',
            'obfuscated': True,
            'compress': COMPRESS_FAST,
        },
    ], obfuscate_key=42)

    with open(output_path, 'wb') as f:
        f.write(caff_data)

    print(f"Generated: {output_path} ({len(caff_data):,} bytes)")
    print(f"  main.xml: {len(xml_bytes):,} bytes")
    print(f"  texture: {len(tex_png):,} bytes ({canvas_w}x{canvas_h})")
    print(f"  shared objects: {len(shared_objects)}")
    print(f"  TextureState: MODEL_IMAGE")
    print(f"  isTextureInputModelImageMode: true")
    return output_path


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'D:/Projects/Programming/stretchystudio/reference/live2d-sample/test_minimal.cmo3'
    generate_cmo3(out)
