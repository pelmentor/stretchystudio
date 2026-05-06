"""Test multi-mesh .cmo3 generation.

Creates a .cmo3 with 3 meshes (red, green, blue) at different positions.
Based on cmo3_generate.py single-mesh generator, extended to N meshes.
"""

import sys
import os
import uuid
import struct as st
import zlib
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
from caff_packer import pack_caff, COMPRESS_RAW, COMPRESS_FAST
from cmo3_generate import VERSION_PIS, IMPORT_PIS, FILTER_DEF_LAYER_SELECTOR, FILTER_DEF_LAYER_FILTER


class IdAllocator:
    def __init__(self):
        self._next = 0
    def alloc(self):
        n = self._next
        self._next += 1
        return f"#{n}"


def _uuid():
    return str(uuid.uuid4())

def _e(tag, **attrs):
    elem = ET.Element(tag)
    for k, v in attrs.items():
        elem.set(k.replace('__', '.'), str(v))
    return elem

def _sub(parent, tag, **attrs):
    elem = _e(tag, **attrs)
    parent.append(elem)
    return elem

def make_png(w, h, r=255, g=255, b=255, a=255):
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


def generate_multi_mesh_cmo3(output_path, canvas_w=1024, canvas_h=1024):
    """Generate a .cmo3 with multiple meshes, each with its own colored texture."""

    # Define meshes: name, color (RGBA), position offset, size
    mesh_defs = [
        {'name': 'RedMesh',   'color': (255, 0, 0, 255),   'cx': 256, 'cy': 256, 'tw': 200, 'th': 200},
        {'name': 'GreenMesh', 'color': (0, 255, 0, 255),   'cx': 512, 'cy': 512, 'tw': 300, 'th': 200},
        {'name': 'BlueMesh',  'color': (0, 0, 255, 255),   'cx': 768, 'cy': 768, 'tw': 200, 'th': 300},
    ]

    ids = IdAllocator()
    shared_objects = []

    def shared(tag, **attrs):
        xid = ids.alloc()
        elem = _e(tag, **{**attrs, 'xs__id': xid, 'xs__idx': str(len(shared_objects))})
        shared_objects.append(elem)
        return elem, xid

    # ==================================================================
    # 1. GLOBAL SHARED OBJECTS
    # ==================================================================

    param_group_guid, pid_param_group = shared('CParameterGroupGuid', uuid=_uuid(), note='root_group')
    param_guid, pid_param = shared('CParameterGuid', uuid=_uuid(), note='ParamOpacity')
    part_guid, pid_part = shared('CPartGuid', uuid=_uuid(), note='PartRoot')
    model_guid, pid_model = shared('CModelGuid', uuid=_uuid(), note='model')

    blend_normal, pid_blend = shared('CBlend_Normal')
    abl = _sub(blend_normal, 'ACBlend', xs__n='super')
    _sub(abl, 's', xs__n='displayName').text = u'\u901a\u5e38'

    _, pid_deformer_root = shared('CDeformerGuid',
                                   uuid='71fae776-e218-4aee-873e-78e8ac0cb48a', note='ROOT')

    coord_type, pid_coord = shared('CoordType')
    _sub(coord_type, 's', xs__n='coordName').text = 'DeformerLocal'

    filter_def_sel, pid_fdef_sel = shared('StaticFilterDefGuid',
                                          uuid=FILTER_DEF_LAYER_SELECTOR, note='CLayerSelector')
    filter_def_flt, pid_fdef_flt = shared('StaticFilterDefGuid',
                                          uuid=FILTER_DEF_LAYER_FILTER, note='CLayerFilter')

    # FilterValueIds
    _, pid_fvid_ilf_output = shared('FilterValueId', idstr='ilf_outputLayerData')
    _, pid_fvid_mi_layer = shared('FilterValueId', idstr='mi_input_layerInputData')
    _, pid_fvid_ilf_input = shared('FilterValueId', idstr='ilf_inputLayerData')
    _, pid_fvid_mi_guid = shared('FilterValueId', idstr='mi_currentImageGuid')
    _, pid_fvid_ilf_guid = shared('FilterValueId', idstr='ilf_currentImageGuid')
    _, pid_fvid_mi_out_img = shared('FilterValueId', idstr='mi_output_image')
    _, pid_fvid_mi_out_xfm = shared('FilterValueId', idstr='mi_output_transform')
    _, pid_fvid_ilf_in_layer = shared('FilterValueId', idstr='ilf_inputLayer')

    # FilterValues
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
    # 2. SHARED PSD (one CLayeredImage with N layers)
    # ==================================================================
    # Reference pattern: 1 CLayeredImage ("PSD"), 1 CLayerGroup, N CLayers.
    # Each CLayer has its own CImageResource (PNG texture).

    _, pid_li_guid = shared('CLayeredImageGuid', uuid=_uuid(), note='fakepsd')
    layered_img, pid_li = shared('CLayeredImage')
    layer_group, pid_lg = shared('CLayerGroup')

    per_mesh = []
    png_files = []
    layer_refs = []  # collect (pid_layer, pid_img) for each mesh

    for mi, mdef in enumerate(mesh_defs):
        mesh_name = mdef['name']
        tw = mdef['tw']
        th = mdef['th']
        cx = mdef['cx']
        cy = mdef['cy']
        color = mdef['color']

        # Per-mesh GUIDs
        _, pid_drawable = shared('CDrawableGuid', uuid=_uuid(), note=mesh_name)
        _, pid_form_mesh = shared('CFormGuid', uuid=_uuid(), note=f'{mesh_name}_form')
        _, pid_mi_guid = shared('CModelImageGuid', uuid=_uuid(), note=f'modelimg{mi}')
        _, pid_tex_guid = shared('GTextureGuid', uuid=_uuid(), note=f'tex{mi}')
        _, pid_ext_mesh = shared('CExtensionGuid', uuid=_uuid(), note=f'mesh_ext{mi}')
        _, pid_ext_tex = shared('CExtensionGuid', uuid=_uuid(), note=f'tex_ext{mi}')
        _, pid_emesh = shared('GEditableMeshGuid', uuid=_uuid(), note=f'editmesh{mi}')

        png_path = f'imageFileBuf_{mi}.png'

        # Generate texture PNG — use canvas_w x canvas_h (same as PSD dimensions)
        tex_png = make_png(canvas_w, canvas_h, *color)
        png_files.append({'path': png_path, 'content': tex_png})

        # CImageResource (per-mesh, canvas-sized)
        img_res, pid_img = shared('CImageResource',
                                   width=str(canvas_w), height=str(canvas_h), type='INT_ARGB',
                                   imageFileBuf_size=str(len(tex_png)),
                                   previewFileBuf_size='0')
        _sub(img_res, 'file', xs__n='imageFileBuf', path=png_path)

        # CLayer (per-mesh, inside shared CLayerGroup)
        layer, pid_layer = shared('CLayer')
        layer_refs.append((pid_layer, pid_img))

        acil = _sub(layer, 'ACImageLayer', xs__n='super')
        ale = _sub(acil, 'ACLayerEntry', xs__n='super')
        _sub(ale, 's', xs__n='name').text = mesh_name
        _sub(ale, 's', xs__n='memo').text = ''
        _sub(ale, 'b', xs__n='isVisible').text = 'true'
        _sub(ale, 'b', xs__n='isClipping').text = 'false'
        _sub(ale, 'CBlend_Normal', xs__n='blend', xs__ref=pid_blend)
        _sub(ale, 'CLayerGuid', xs__n='guid', uuid=_uuid(), note='(no debug info)')
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
        _sub(lid, 's', xs__n='layerId').text = f'00-00-00-{mi+1:02d}'
        _sub(lid, 'i', xs__n='layerIdValue_testImpl').text = str(mi + 1)
        _sub(layer, 'null', xs__n='icon16')
        _sub(layer, 'null', xs__n='icon64')
        _sub(layer, 'linked_map', xs__n='layerInfo', count='0', keyType='string')
        _sub(layer, 'hash_map', xs__n='_optionOfIOption', count='0', keyType='string')

        # --- FILTER GRAPH (per-mesh) ---
        filter_set, pid_fset = shared('ModelImageFilterSet')
        _, pid_fiid0 = shared('FilterInstanceId', idstr=f'filter0_{mi}')
        fi_selector, pid_fi_sel = shared('FilterInstance', filterName='CLayerSelector')
        fout_conn, pid_fout = shared('FilterOutputValueConnector')
        _, pid_fiid1 = shared('FilterInstanceId', idstr=f'filter1_{mi}')
        fi_filter, pid_fi_flt = shared('FilterInstance', filterName='CLayerFilter')

        # FilterOutputValueConnector
        _sub(fout_conn, 'AValueConnector', xs__n='super')
        _sub(fout_conn, 'FilterInstance', xs__n='instance', xs__ref=pid_fi_sel)
        _sub(fout_conn, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_ilf_output)
        _sub(fout_conn, 'FilterValue', xs__n='valueDef', xs__ref=pid_fv_sel)

        # CLayerSelector
        _sub(fi_selector, 'StaticFilterDefGuid', xs__n='filterDefGuid', xs__ref=pid_fdef_sel)
        _sub(fi_selector, 'null', xs__n='filterDef')
        _sub(fi_selector, 'FilterInstanceId', xs__n='filterId', xs__ref=pid_fiid0)
        ic_sel = _sub(fi_selector, 'hash_map', xs__n='inputConnectors', count='2')
        e1 = _sub(ic_sel, 'entry')
        _sub(e1, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_input)
        evc1 = _sub(e1, 'EnvValueConnector', xs__n='value')
        _sub(evc1, 'AValueConnector', xs__n='super')
        _sub(evc1, 'FilterValueId', xs__n='envValueId', xs__ref=pid_fvid_mi_layer)
        e2 = _sub(ic_sel, 'entry')
        _sub(e2, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_guid)
        evc2 = _sub(e2, 'EnvValueConnector', xs__n='value')
        _sub(evc2, 'AValueConnector', xs__n='super')
        _sub(evc2, 'FilterValueId', xs__n='envValueId', xs__ref=pid_fvid_mi_guid)
        oc_sel = _sub(fi_selector, 'hash_map', xs__n='outputConnectors', count='1')
        e3 = _sub(oc_sel, 'entry')
        _sub(e3, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_output)
        _sub(e3, 'FilterOutputValueConnector', xs__n='value', xs__ref=pid_fout)
        _sub(fi_selector, 'ModelImageFilterSet', xs__n='ownerFilterSet', xs__ref=pid_fset)

        # CLayerFilter
        _sub(fi_filter, 'StaticFilterDefGuid', xs__n='filterDefGuid', xs__ref=pid_fdef_flt)
        _sub(fi_filter, 'null', xs__n='filterDef')
        _sub(fi_filter, 'FilterInstanceId', xs__n='filterId', xs__ref=pid_fiid1)
        ic_flt = _sub(fi_filter, 'hash_map', xs__n='inputConnectors', count='1')
        e4 = _sub(ic_flt, 'entry')
        _sub(e4, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_ilf_in_layer)
        _sub(e4, 'FilterOutputValueConnector', xs__n='value', xs__ref=pid_fout)
        _sub(fi_filter, 'hash_map', xs__n='outputConnectors', count='0', keyType='string')
        _sub(fi_filter, 'ModelImageFilterSet', xs__n='ownerFilterSet', xs__ref=pid_fset)

        # Fill ModelImageFilterSet
        fs_super = _sub(filter_set, 'FilterSet', xs__n='super')
        fm = _sub(fs_super, 'linked_map', xs__n='filterMap', count='2')
        fm_e1 = _sub(fm, 'entry')
        _sub(fm_e1, 'FilterInstanceId', xs__n='key', xs__ref=pid_fiid0)
        _sub(fm_e1, 'FilterInstance', xs__n='value', xs__ref=pid_fi_sel)
        fm_e2 = _sub(fm, 'entry')
        _sub(fm_e2, 'FilterInstanceId', xs__n='key', xs__ref=pid_fiid1)
        _sub(fm_e2, 'FilterInstance', xs__n='value', xs__ref=pid_fi_flt)
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

        # GTexture2D
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

        # CTextureInputExtension + CTextureInput_ModelImage
        tex_input_ext, pid_tie = shared('CTextureInputExtension')
        tex_input_mi, pid_timi = shared('CTextureInput_ModelImage')

        ati = _sub(tex_input_mi, 'ACTextureInput', xs__n='super')
        _sub(ati, 'CAffine', xs__n='optionalTransformOnCanvas',
             m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
        _sub(ati, 'CTextureInputExtension', xs__n='_owner', xs__ref=pid_tie)
        _sub(tex_input_mi, 'CModelImageGuid', xs__n='_modelImageGuid', xs__ref=pid_mi_guid)

        tie_sup = _sub(tex_input_ext, 'ACExtension', xs__n='super')
        _sub(tie_sup, 'CExtensionGuid', xs__n='guid', xs__ref=pid_ext_tex)
        # _owner set after mesh is created
        tie_inputs = _sub(tex_input_ext, 'carray_list', xs__n='_textureInputs', count='1')
        _sub(tie_inputs, 'CTextureInput_ModelImage', xs__ref=pid_timi)
        _sub(tex_input_ext, 'CTextureInput_ModelImage', xs__n='currentTextureInputData', xs__ref=pid_timi)

        # Keyform system
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

        _sub(kf_binding, 'KeyformGridSource', xs__n='_gridSource', xs__ref=pid_kfg_mesh)
        _sub(kf_binding, 'CParameterGuid', xs__n='parameterGuid', xs__ref=pid_param)
        keys = _sub(kf_binding, 'array_list', xs__n='keys', count='1')
        _sub(keys, 'f').text = '1.0'
        _sub(kf_binding, 'InterpolationType', xs__n='interpolationType', v='LINEAR')
        _sub(kf_binding, 'ExtendedInterpolationType', xs__n='extendedInterpolationType', v='LINEAR')
        _sub(kf_binding, 'i', xs__n='insertPointCount').text = '1'
        _sub(kf_binding, 'f', xs__n='extendedInterpolationScale').text = '1.0'
        _sub(kf_binding, 's', xs__n='description').text = 'ParamOpacity'

        per_mesh.append({
            'mi': mi, 'name': mesh_name, 'tw': tw, 'th': th, 'cx': cx, 'cy': cy,
            'pid_drawable': pid_drawable, 'pid_form_mesh': pid_form_mesh,
            'pid_mi_guid': pid_mi_guid, 'pid_tex_guid': pid_tex_guid,
            'pid_ext_mesh': pid_ext_mesh, 'pid_ext_tex': pid_ext_tex,
            'pid_emesh': pid_emesh, 'pid_li_guid': pid_li_guid,
            'pid_img': pid_img, 'pid_li': pid_li, 'pid_lg': pid_lg, 'pid_layer': pid_layer,
            'pid_fset': pid_fset, 'pid_tex2d': pid_tex2d,
            'pid_tie': pid_tie, 'pid_timi': pid_timi,
            'pid_kfb': pid_kfb, 'pid_kfg_mesh': pid_kfg_mesh,
            'tie_sup': tie_sup,
        })

    # ==================================================================
    # 2b. FILL SHARED CLayerGroup + CLayeredImage (after all layers created)
    # ==================================================================

    n_layers = len(layer_refs)

    # CLayerGroup (root group containing all layers)
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
    children = _sub(alg, 'carray_list', xs__n='_children', count=str(n_layers))
    for pid_layer, _ in layer_refs:
        _sub(children, 'CLayer', xs__ref=pid_layer)
    _sub(layer_group, 'null', xs__n='layerIdentifier')

    # CLayeredImage (single "PSD" wrapping all layers)
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
    ls_list = _sub(layer_set, 'carray_list', xs__n='_layerEntryList', count=str(n_layers + 1))
    _sub(ls_list, 'CLayerGroup', xs__ref=pid_lg)
    for pid_layer, _ in layer_refs:
        _sub(ls_list, 'CLayer', xs__ref=pid_layer)
    _sub(layered_img, 'null', xs__n='icon16')
    _sub(layered_img, 'null', xs__n='icon64')

    # ==================================================================
    # 3. PART SOURCE (shared, self-referencing)
    # ==================================================================

    _, pid_form_part = shared('CFormGuid', uuid=_uuid(), note='PartRoot_form')

    kf_grid_part, pid_kfg_part = shared('KeyformGridSource')
    kfog2 = _sub(kf_grid_part, 'array_list', xs__n='keyformsOnGrid', count='1')
    kog2 = _sub(kfog2, 'KeyformOnGrid')
    ak2 = _sub(kog2, 'KeyformGridAccessKey', xs__n='accessKey')
    _sub(ak2, 'array_list', xs__n='_keyOnParameterList', count='0')
    _sub(kog2, 'CFormGuid', xs__n='keyformGuid', xs__ref=pid_form_part)
    _sub(kf_grid_part, 'array_list', xs__n='keyformBindings', count='0')

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
    # _childGuids must include ALL drawable GUIDs
    child_guids = _sub(part_src, 'carray_list', xs__n='_childGuids', count=str(len(per_mesh)))
    for pm in per_mesh:
        _sub(child_guids, 'CDrawableGuid', xs__ref=pm['pid_drawable'])
    _sub(part_src, 'CDeformerGuid', xs__n='targetDeformerGuid', xs__ref=pid_deformer_root)
    kf_part_list = _sub(part_src, 'carray_list', xs__n='keyforms', count='1')
    part_form = _sub(kf_part_list, 'CPartForm')
    part_acf = _sub(part_form, 'ACForm', xs__n='super')
    _sub(part_acf, 'CFormGuid', xs__n='guid', xs__ref=pid_form_part)
    _sub(part_acf, 'b', xs__n='isAnimatedForm').text = 'false'
    _sub(part_acf, 'b', xs__n='isLocalAnimatedForm').text = 'false'
    _sub(part_acf, 'CPartSource', xs__n='_source', xs__ref=pid_part_src)
    _sub(part_acf, 'null', xs__n='name')
    _sub(part_acf, 's', xs__n='notes').text = ''
    _sub(part_form, 'i', xs__n='drawOrder').text = '500'

    # ==================================================================
    # 4. CArtMeshSource (per mesh)
    # ==================================================================

    mesh_src_ids = []

    for pm in per_mesh:
        mesh_src, pid_mesh = shared('CArtMeshSource')
        mesh_src_ids.append(pid_mesh)

        # Set _owner on CTextureInputExtension
        _sub(pm['tie_sup'], 'CArtMeshSource', xs__n='_owner', xs__ref=pid_mesh)

        # Quad geometry centered at (cx, cy) with size (tw/2, th/2)
        hw = pm['tw'] / 4
        hh = pm['th'] / 4
        cx, cy = pm['cx'], pm['cy']
        points = [cx-hw, cy-hh, cx+hw, cy-hh, cx+hw, cy+hh, cx-hw, cy+hh]

        ds = _sub(mesh_src, 'ACDrawableSource', xs__n='super')
        pc = _sub(ds, 'ACParameterControllableSource', xs__n='super')
        _sub(pc, 's', xs__n='localName').text = pm['name']
        _sub(pc, 'b', xs__n='isVisible').text = 'true'
        _sub(pc, 'b', xs__n='isLocked').text = 'false'
        _sub(pc, 'CPartGuid', xs__n='parentGuid', xs__ref=pid_part)
        _sub(pc, 'KeyformGridSource', xs__n='keyformGridSource', xs__ref=pm['pid_kfg_mesh'])
        morph = _sub(pc, 'KeyFormMorphTargetSet', xs__n='keyformMorphTargetSet')
        _sub(morph, 'carray_list', xs__n='_morphTargets', count='0')
        mbw = _sub(morph, 'MorphTargetBlendWeightConstraintSet', xs__n='blendWeightConstraintSet')
        _sub(mbw, 'carray_list', xs__n='_constraints', count='0')

        ext_list = _sub(pc, 'carray_list', xs__n='_extensions', count='3')

        # CEditableMeshExtension
        eme = _sub(ext_list, 'CEditableMeshExtension')
        eme_sup = _sub(eme, 'ACExtension', xs__n='super')
        _sub(eme_sup, 'CExtensionGuid', xs__n='guid', xs__ref=pm['pid_ext_mesh'])
        _sub(eme_sup, 'CArtMeshSource', xs__n='_owner', xs__ref=pid_mesh)
        em = _sub(eme, 'GEditableMesh2', xs__n='editableMesh',
                  nextPointUid='4', useDelaunayTriangulation='true')
        _sub(em, 'float-array', xs__n='point', count='8').text = ' '.join(f'{v:.1f}' for v in points)
        _sub(em, 'byte-array', xs__n='pointPriority', count='4').text = '20 20 20 20'
        _sub(em, 'short-array', xs__n='edge', count='10').text = '0 1 1 2 2 3 3 0 0 2'
        _sub(em, 'byte-array', xs__n='edgePriority', count='5').text = '30 30 30 30 30'
        _sub(em, 'int-array', xs__n='pointUid', count='4').text = '0 1 2 3'
        _sub(em, 'GEditableMeshGuid', xs__n='meshGuid', xs__ref=pm['pid_emesh'])
        _sub(em, 'CoordType', xs__n='coordType', xs__ref=pid_coord)
        _sub(eme, 'b', xs__n='isLocked').text = 'false'

        _sub(ext_list, 'CTextureInputExtension', xs__ref=pm['pid_tie'])

        mge = _sub(ext_list, 'CMeshGeneratorExtension')
        mge_sup = _sub(mge, 'ACExtension', xs__n='super')
        _sub(mge_sup, 'CExtensionGuid', xs__n='guid', uuid=_uuid(), note='(no debug info)')
        _sub(mge_sup, 'CArtMeshSource', xs__n='_owner', xs__ref=pid_mesh)
        mgs = _sub(mge, 'MeshGenerateSetting', xs__n='meshGenerateSetting')
        for k, v in [('polygonOuterDensity', '100'), ('polygonInnerDensity', '100'),
                     ('polygonMargin', '20'), ('polygonInnerMargin', '20'),
                     ('polygonMinMargin', '5'), ('polygonMinBoundsPt', '5'),
                     ('thresholdAlpha', '0')]:
            _sub(mgs, 'i', xs__n=k).text = v

        _sub(pc, 'null', xs__n='internalColor_direct_argb')

        _sub(ds, 'CDrawableId', xs__n='id', idstr=f'ArtMesh{pm["mi"]}')
        _sub(ds, 'CDrawableGuid', xs__n='guid', xs__ref=pm['pid_drawable'])
        _sub(ds, 'CDeformerGuid', xs__n='targetDeformerGuid', xs__ref=pid_deformer_root)
        _sub(ds, 'carray_list', xs__n='clipGuidList', count='0')
        _sub(ds, 'b', xs__n='invertClippingMask').text = 'false'

        _sub(mesh_src, 'int-array', xs__n='indices', count='6').text = '0 1 2 0 2 3'

        kf_list = _sub(mesh_src, 'carray_list', xs__n='keyforms', count='1')
        art_form = _sub(kf_list, 'CArtMeshForm')
        adf = _sub(art_form, 'ACDrawableForm', xs__n='super')
        acf = _sub(adf, 'ACForm', xs__n='super')
        _sub(acf, 'CFormGuid', xs__n='guid', xs__ref=pm['pid_form_mesh'])
        _sub(acf, 'b', xs__n='isAnimatedForm').text = 'false'
        _sub(acf, 'b', xs__n='isLocalAnimatedForm').text = 'false'
        _sub(acf, 'CArtMeshSource', xs__n='_source', xs__ref=pid_mesh)
        _sub(acf, 'null', xs__n='name')
        _sub(acf, 's', xs__n='notes').text = ''
        _sub(adf, 'i', xs__n='drawOrder').text = str(500 + pm['mi'])
        _sub(adf, 'f', xs__n='opacity').text = '1.0'
        _sub(adf, 'CFloatColor', xs__n='multiplyColor', red='1.0', green='1.0', blue='1.0', alpha='1.0')
        _sub(adf, 'CFloatColor', xs__n='screenColor', red='0.0', green='0.0', blue='0.0', alpha='1.0')
        _sub(adf, 'CoordType', xs__n='coordType', xs__ref=pid_coord)
        _sub(art_form, 'float-array', xs__n='positions', count='8').text = ' '.join(f'{v:.1f}' for v in points)

        _sub(mesh_src, 'float-array', xs__n='positions', count='8').text = ' '.join(f'{v:.1f}' for v in points)

        uvs = [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]
        _sub(mesh_src, 'float-array', xs__n='uvs', count='8').text = ' '.join(f'{v:.1f}' for v in uvs)
        _sub(mesh_src, 'GTexture2D', xs__n='texture', xs__ref=pm['pid_tex2d'])
        _sub(mesh_src, 'ColorComposition', xs__n='colorComposition', v='NORMAL')
        _sub(mesh_src, 'b', xs__n='culling').text = 'false'
        _sub(mesh_src, 'TextureState', xs__n='textureState', v='MODEL_IMAGE')
        _sub(mesh_src, 's', xs__n='userData').text = ''

    # ==================================================================
    # 5. CModelImageGroup
    # ==================================================================

    img_group, pid_img_grp = shared('CModelImageGroup')
    _sub(img_group, 's', xs__n='memo').text = ''
    _sub(img_group, 's', xs__n='groupName').text = 'stretchy_export'
    li_guids = _sub(img_group, 'carray_list', xs__n='_linkedRawImageGuids', count='1')
    _sub(li_guids, 'CLayeredImageGuid', xs__ref=pid_li_guid)

    mi_list = _sub(img_group, 'carray_list', xs__n='_modelImages', count=str(len(per_mesh)))

    for pm in per_mesh:
        mi = _sub(mi_list, 'CModelImage', modelImageVersion='0')
        _sub(mi, 'CModelImageGuid', xs__n='guid', xs__ref=pm['pid_mi_guid'])
        _sub(mi, 's', xs__n='name').text = pm['name']
        _sub(mi, 'ModelImageFilterSet', xs__n='inputFilter', xs__ref=pm['pid_fset'])

        mife = _sub(mi, 'ModelImageFilterEnv', xs__n='inputFilterEnv')
        fe = _sub(mife, 'FilterEnv', xs__n='super')
        _sub(fe, 'null', xs__n='parentEnv')
        env_map = _sub(fe, 'hash_map', xs__n='envValues', count='2')

        env_e1 = _sub(env_map, 'entry')
        _sub(env_e1, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_guid)
        evs1 = _sub(env_e1, 'EnvValueSet', xs__n='value')
        _sub(evs1, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_guid)
        _sub(evs1, 'CLayeredImageGuid', xs__n='value', xs__ref=pm['pid_li_guid'])
        _sub(evs1, 'l', xs__n='updateTimeMs').text = '0'

        env_e2 = _sub(env_map, 'entry')
        _sub(env_e2, 'FilterValueId', xs__n='key', xs__ref=pid_fvid_mi_layer)
        evs2 = _sub(env_e2, 'EnvValueSet', xs__n='value')
        _sub(evs2, 'FilterValueId', xs__n='id', xs__ref=pid_fvid_mi_layer)
        lsm = _sub(evs2, 'CLayerSelectorMap', xs__n='value')
        itli = _sub(lsm, 'linked_map', xs__n='_imageToLayerInput', count='1')
        itli_e = _sub(itli, 'entry')
        _sub(itli_e, 'CLayeredImageGuid', xs__n='key', xs__ref=pm['pid_li_guid'])
        itli_v = _sub(itli_e, 'array_list', xs__n='value', count='1')
        lid_data = _sub(itli_v, 'CLayerInputData')
        _sub(lid_data, 'CLayer', xs__n='layer', xs__ref=pm['pid_layer'])
        _sub(lid_data, 'CAffine', xs__n='affine',
             m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
        _sub(lid_data, 'null', xs__n='clippingOnTexturePx')
        _sub(evs2, 'l', xs__n='updateTimeMs').text = '0'

        _sub(mi, 'CImageResource', xs__n='_filteredImage', xs__ref=pm['pid_img'])
        _sub(mi, 'null', xs__n='icon16')
        _sub(mi, 'CAffine', xs__n='_materialLocalToCanvasTransform',
             m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
        _sub(mi, 'CModelImageGroup', xs__n='_group', xs__ref=pid_img_grp)
        mi_lrig = _sub(mi, 'carray_list', xs__n='linkedRawImageGuids', count='1')
        _sub(mi_lrig, 'CLayeredImageGuid', xs__ref=pm['pid_li_guid'])

        cim = _sub(mi, 'CCachedImageManager', xs__n='cachedImageManager')
        _sub(cim, 'CachedImageType', xs__n='defaultCacheType', v='SCALE_1')
        _sub(cim, 'CImageResource', xs__n='rawImage', xs__ref=pm['pid_img'])
        ci_list = _sub(cim, 'array_list', xs__n='cachedImages', count='1')
        ci = _sub(ci_list, 'CCachedImage')
        _sub(ci, 'CImageResource', xs__n='_cachedImageResource', xs__ref=pm['pid_img'])
        _sub(ci, 'b', xs__n='isSharedImage').text = 'true'
        _sub(ci, 'CSize', xs__n='rawImageSize', width=str(pm['tw']), height=str(pm['th']))
        _sub(ci, 'i', xs__n='reductionRatio').text = '1'
        _sub(ci, 'i', xs__n='mipmapLevel').text = '1'
        _sub(ci, 'b', xs__n='hasMargin').text = 'false'
        _sub(ci, 'b', xs__n='isCleaned').text = 'false'
        _sub(ci, 'CAffine', xs__n='transformRawImageToCachedImage',
             m00='1.0', m01='0.0', m02='0.0', m10='0.0', m11='1.0', m12='0.0')
        _sub(cim, 'i', xs__n='requiredMipmapLevel').text = '1'
        _sub(mi, 's', xs__n='memo').text = ''

    # ==================================================================
    # 6. BUILD main.xml
    # ==================================================================

    pi_lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    for name, ver in VERSION_PIS:
        pi_lines.append(f'<?version {name}:{ver}?>')
    for imp in IMPORT_PIS:
        pi_lines.append(f'<?import {imp}?>')

    root = _e('root', fileFormatVersion='402030000')

    shared_elem = _sub(root, 'shared')
    for obj in shared_objects:
        shared_elem.append(obj)

    main_elem = _sub(root, 'main')
    model = _sub(main_elem, 'CModelSource', isDefaultKeyformLocked='true')
    _sub(model, 'CModelGuid', xs__n='guid', xs__ref=pid_model)
    _sub(model, 's', xs__n='name').text = 'Multi Mesh Test'
    edition = _sub(model, 'EditorEdition', xs__n='editorEdition')
    _sub(edition, 'i', xs__n='edition').text = '15'

    canvas = _sub(model, 'CImageCanvas', xs__n='canvas')
    _sub(canvas, 'i', xs__n='pixelWidth').text = str(canvas_w)
    _sub(canvas, 'i', xs__n='pixelHeight').text = str(canvas_h)
    _sub(canvas, 'CColor', xs__n='background')

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

    tex_mgr = _sub(model, 'CTextureManager', xs__n='textureManager')
    tex_list = _sub(tex_mgr, 'TextureImageGroup', xs__n='textureList')
    _sub(tex_list, 'carray_list', xs__n='children', count='0')
    ri = _sub(tex_mgr, 'carray_list', xs__n='_rawImages', count='1')
    liw = _sub(ri, 'LayeredImageWrapper')
    _sub(liw, 'CLayeredImage', xs__n='image', xs__ref=pid_li)
    _sub(liw, 'l', xs__n='importedTimeMSec').text = '0'
    _sub(liw, 'l', xs__n='lastModifiedTimeMSec').text = '0'
    _sub(liw, 'b', xs__n='isReplaced').text = 'false'
    mig = _sub(tex_mgr, 'carray_list', xs__n='_modelImageGroups', count='1')
    _sub(mig, 'CModelImageGroup', xs__ref=pid_img_grp)
    _sub(tex_mgr, 'carray_list', xs__n='_textureAtlases', count='0')
    _sub(tex_mgr, 'b', xs__n='isTextureInputModelImageMode').text = 'true'
    _sub(tex_mgr, 'i', xs__n='previewReductionRatio').text = '1'
    _sub(tex_mgr, 'carray_list', xs__n='artPathBrushUsingLayeredImageIds', count='0')

    _sub(model, 'b', xs__n='useLegacyDrawOrder__testImpl').text = 'false'
    draw_set = _sub(model, 'CDrawableSourceSet', xs__n='drawableSourceSet')
    draw_sources = _sub(draw_set, 'carray_list', xs__n='_sources', count=str(len(per_mesh)))
    for pid in mesh_src_ids:
        _sub(draw_sources, 'CArtMeshSource', xs__ref=pid)

    deformer_set = _sub(model, 'CDeformerSourceSet', xs__n='deformerSourceSet')
    _sub(deformer_set, 'carray_list', xs__n='_sources', count='0')

    affecter_set = _sub(model, 'CAffecterSourceSet', xs__n='affecterSourceSet')
    _sub(affecter_set, 'carray_list', xs__n='_sources', count='0')

    part_set = _sub(model, 'CPartSourceSet', xs__n='partSourceSet')
    part_sources = _sub(part_set, 'carray_list', xs__n='_sources', count='1')
    _sub(part_sources, 'CPartSource', xs__ref=pid_part_src)

    _sub(model, 'CPartSource', xs__n='rootPart', xs__ref=pid_part_src)

    pg_set = _sub(model, 'CParameterGroupSet', xs__n='parameterGroupSet')
    _sub(pg_set, 'carray_list', xs__n='_groups', count='0')

    mi_info = _sub(model, 'CModelInfo', xs__n='modelInfo')
    _sub(mi_info, 'f', xs__n='pixelsPerUnit').text = '1.0'
    origin = _sub(mi_info, 'CPoint', xs__n='originInPixels')
    _sub(origin, 'i', xs__n='x').text = '0'
    _sub(origin, 'i', xs__n='y').text = '0'

    _sub(model, 'i', xs__n='targetVersionNo').text = '3000'
    _sub(model, 'i', xs__n='latestVersionOfLastModelerNo').text = '5000000'

    # ==================================================================
    # 7. SERIALIZE + PACK
    # ==================================================================

    xml_str = ET.tostring(root, encoding='unicode')
    full_xml = '\n'.join(pi_lines) + '\n' + xml_str
    xml_bytes = full_xml.encode('utf-8')

    caff_files = []
    for pf in png_files:
        caff_files.append({
            'path': pf['path'],
            'content': pf['content'],
            'tag': '',
            'obfuscated': True,
            'compress': COMPRESS_RAW,
        })
    caff_files.append({
        'path': 'main.xml',
        'content': xml_bytes,
        'tag': 'main_xml',
        'obfuscated': True,
        'compress': COMPRESS_FAST,
    })

    caff_data = pack_caff(caff_files, obfuscate_key=42)

    with open(output_path, 'wb') as f:
        f.write(caff_data)

    print(f"Generated: {output_path} ({len(caff_data):,} bytes)")
    print(f"  main.xml: {len(xml_bytes):,} bytes")
    print(f"  meshes: {len(per_mesh)}")
    for pm in per_mesh:
        print(f"    {pm['name']}: {pm['tw']}x{pm['th']} at ({pm['cx']},{pm['cy']})")
    print(f"  shared objects: {len(shared_objects)}")
    return output_path


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'D:/Projects/Programming/stretchystudio/reference/live2d-sample/test_multi.cmo3'
    generate_multi_mesh_cmo3(out)
