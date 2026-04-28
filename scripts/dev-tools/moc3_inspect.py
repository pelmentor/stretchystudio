"""Decode a moc3 binary and dump section data for diffing.

Usage: python scripts/moc3_inspect.py <path.moc3> [section_filter]
"""
import struct
import sys

f = open(sys.argv[1], 'rb')
data = f.read()

print(f"File: {sys.argv[1]}, size={len(data)}")
print(f"Magic: {data[0:4]!r}, Version: {data[4]}, Endian: {data[5]}")

sot = struct.unpack('<160I', data[64:64+640])
count_info = struct.unpack('<23I', data[sot[0]:sot[0]+23*4])

COUNT_NAMES = ['parts','deformers','warp_deformers','rotation_deformers',
               'art_meshes','parameters','part_keyforms','warp_deformer_keyforms',
               'rotation_deformer_keyforms','art_mesh_keyforms','keyform_positions',
               'keyform_binding_indices','keyform_binding_bands','keyform_bindings',
               'keys','uvs','position_indices','drawable_masks',
               'draw_order_groups','draw_order_group_objects','glues','glue_infos',
               'glue_keyforms']

print("\n=== Counts ===")
for i,c in enumerate(count_info):
    print(f"  [{i:2d}] {COUNT_NAMES[i]:36s} = {c}")

canvas = struct.unpack('<5f', data[sot[1]:sot[1]+5*4])
print(f"\n=== Canvas ===  ppu={canvas[0]} origin=({canvas[1]},{canvas[2]}) wh=({canvas[3]}x{canvas[4]})")

SECTIONS = [
    ('part.runtime_space','RUNTIME',0),
    ('part.ids','STR64',0),
    ('part.keyform_binding_band_indices','I32',0),
    ('part.keyform_begin_indices','I32',0),
    ('part.keyform_counts','I32',0),
    ('part.visibles','BOOL',0),
    ('part.enables','BOOL',0),
    ('part.parent_part_indices','I32',0),
    ('deformer.runtime_space','RUNTIME',1),
    ('deformer.ids','STR64',1),
    ('deformer.keyform_binding_band_indices','I32',1),
    ('deformer.visibles','BOOL',1),
    ('deformer.enables','BOOL',1),
    ('deformer.parent_part_indices','I32',1),
    ('deformer.parent_deformer_indices','I32',1),
    ('deformer.types','I32',1),
    ('deformer.specific_indices','I32',1),
    ('warp_deformer.keyform_binding_band_indices','I32',2),
    ('warp_deformer.keyform_begin_indices','I32',2),
    ('warp_deformer.keyform_counts','I32',2),
    ('warp_deformer.vertex_counts','I32',2),
    ('warp_deformer.rows','I32',2),
    ('warp_deformer.cols','I32',2),
    ('rotation_deformer.keyform_binding_band_indices','I32',3),
    ('rotation_deformer.keyform_begin_indices','I32',3),
    ('rotation_deformer.keyform_counts','I32',3),
    ('rotation_deformer.base_angles','F32',3),
    ('art_mesh.runtime_space_0','RUNTIME',4),
    ('art_mesh.runtime_space_1','RUNTIME',4),
    ('art_mesh.runtime_space_2','RUNTIME',4),
    ('art_mesh.runtime_space_3','RUNTIME',4),
    ('art_mesh.ids','STR64',4),
    ('art_mesh.keyform_binding_band_indices','I32',4),
    ('art_mesh.keyform_begin_indices','I32',4),
    ('art_mesh.keyform_counts','I32',4),
    ('art_mesh.visibles','BOOL',4),
    ('art_mesh.enables','BOOL',4),
    ('art_mesh.parent_part_indices','I32',4),
    ('art_mesh.parent_deformer_indices','I32',4),
    ('art_mesh.texture_indices','I32',4),
    ('art_mesh.drawable_flags','U8',4),
    ('art_mesh.position_index_counts','I32',4),
    ('art_mesh.uv_begin_indices','I32',4),
    ('art_mesh.position_index_begin_indices','I32',4),
    ('art_mesh.vertex_counts','I32',4),
    ('art_mesh.mask_begin_indices','I32',4),
    ('art_mesh.mask_counts','I32',4),
    ('parameter.runtime_space','RUNTIME',5),
    ('parameter.ids','STR64',5),
    ('parameter.max_values','F32',5),
    ('parameter.min_values','F32',5),
    ('parameter.default_values','F32',5),
    ('parameter.repeats','BOOL',5),
    ('parameter.decimal_places','I32',5),
    ('parameter.keyform_binding_begin_indices','I32',5),
    ('parameter.keyform_binding_counts','I32',5),
    ('part_keyform.draw_orders','F32',6),
    ('warp_deformer_keyform.opacities','F32',7),
    ('warp_deformer_keyform.keyform_position_begin_indices','I32',7),
    ('rotation_deformer_keyform.opacities','F32',8),
    ('rotation_deformer_keyform.angles','F32',8),
    ('rotation_deformer_keyform.origin_xs','F32',8),
    ('rotation_deformer_keyform.origin_ys','F32',8),
    ('rotation_deformer_keyform.scales','F32',8),
    ('rotation_deformer_keyform.reflect_xs','BOOL',8),
    ('rotation_deformer_keyform.reflect_ys','BOOL',8),
    ('art_mesh_keyform.opacities','F32',9),
    ('art_mesh_keyform.draw_orders','F32',9),
    ('art_mesh_keyform.keyform_position_begin_indices','I32',9),
    ('keyform_position.xys','F32',10),
    ('keyform_binding_index.indices','I32',11),
    ('keyform_binding_band.begin_indices','I32',12),
    ('keyform_binding_band.counts','I32',12),
    ('keyform_binding.keys_begin_indices','I32',13),
    ('keyform_binding.keys_counts','I32',13),
    ('keys.values','F32',14),
    ('uv.xys','F32',15),
    ('position_index.indices','I16',16),
    ('drawable_mask.art_mesh_indices','I32',17),
    ('draw_order_group.object_begin_indices','I32',18),
    ('draw_order_group.object_counts','I32',18),
    ('draw_order_group.object_total_counts','I32',18),
    ('draw_order_group.min_draw_orders','I32',18),
    ('draw_order_group.max_draw_orders','I32',18),
    ('draw_order_group_object.types','I32',19),
    ('draw_order_group_object.indices','I32',19),
    ('draw_order_group_object.group_indices','I32',19),
    ('glue.runtime_space','RUNTIME',20),
    ('glue.ids','STR64',20),
    ('glue.keyform_binding_band_indices','I32',20),
    ('glue.keyform_begin_indices','I32',20),
    ('glue.keyform_counts','I32',20),
    ('glue.art_mesh_index_as','I32',20),
    ('glue.art_mesh_index_bs','I32',20),
    ('glue.info_begin_indices','I32',20),
    ('glue.info_counts','I32',20),
    ('glue_info.weights','F32',21),
    ('glue_info.position_indices','I16',21),
    ('glue_keyform.intensities','F32',22),
]

ELEM_SIZE = {'I32':4,'F32':4,'I16':2,'U8':1,'BOOL':4,'STR64':64,'RUNTIME':8}
def read_section(off, elem, count):
    sz = ELEM_SIZE[elem]
    end = off + sz * count
    if elem == 'STR64':
        out = []
        for i in range(count):
            s = data[off + i*64:off + (i+1)*64]
            null_idx = s.find(0)
            if null_idx >= 0: s = s[:null_idx]
            out.append(s.decode('utf-8', errors='replace'))
        return out
    if elem == 'RUNTIME':
        return None
    if elem == 'I32':
        return list(struct.unpack(f'<{count}i', data[off:end]))
    if elem == 'F32':
        return list(struct.unpack(f'<{count}f', data[off:end]))
    if elem == 'I16':
        return list(struct.unpack(f'<{count}h', data[off:end]))
    if elem == 'U8':
        return list(struct.unpack(f'<{count}B', data[off:end]))
    if elem == 'BOOL':
        return list(struct.unpack(f'<{count}i', data[off:end]))

sections = {}
for i,(name,elem,ci) in enumerate(SECTIONS):
    sot_idx = 2 + i
    off = sot[sot_idx]
    cnt = count_info[ci]
    sections[name] = read_section(off, elem, cnt)

filt = sys.argv[2] if len(sys.argv) > 2 else None
DEFORMER_TYPE_NAMES = {0: 'WARP', 1: 'ROTATION'}

print("\n=== Parts ===")
for i,name in enumerate(sections['part.ids']):
    print(f"  [{i:3d}] {name:30s} parent={sections['part.parent_part_indices'][i]} band={sections['part.keyform_binding_band_indices'][i]}")

print("\n=== Deformers ===")
for i,name in enumerate(sections['deformer.ids']):
    t = sections['deformer.types'][i]
    print(f"  [{i:3d}] {name:35s} type={DEFORMER_TYPE_NAMES.get(t, t)} pp={sections['deformer.parent_part_indices'][i]:3d} pd={sections['deformer.parent_deformer_indices'][i]:3d} band={sections['deformer.keyform_binding_band_indices'][i]:3d} spec={sections['deformer.specific_indices'][i]:3d}")

print("\n=== Parameters ===")
for i,name in enumerate(sections['parameter.ids']):
    print(f"  [{i:3d}] {name:30s} min={sections['parameter.min_values'][i]} max={sections['parameter.max_values'][i]} def={sections['parameter.default_values'][i]} dp={sections['parameter.decimal_places'][i]} kfb_begin={sections['parameter.keyform_binding_begin_indices'][i]} kfb_count={sections['parameter.keyform_binding_counts'][i]}")

print("\n=== ArtMeshes ===")
for i,name in enumerate(sections['art_mesh.ids']):
    print(f"  [{i:3d}] {name:30s} pp={sections['art_mesh.parent_part_indices'][i]:3d} pd={sections['art_mesh.parent_deformer_indices'][i]:3d} band={sections['art_mesh.keyform_binding_band_indices'][i]:3d} kf_b={sections['art_mesh.keyform_begin_indices'][i]:5d} kf_n={sections['art_mesh.keyform_counts'][i]:2d} mask_b={sections['art_mesh.mask_begin_indices'][i]:3d} mask_n={sections['art_mesh.mask_counts'][i]:2d}")

print("\n=== Warp deformers (specific section) ===")
for i in range(count_info[2]):
    print(f"  [{i:3d}] kf_b={sections['warp_deformer.keyform_begin_indices'][i]:4d} kf_n={sections['warp_deformer.keyform_counts'][i]:3d} verts={sections['warp_deformer.vertex_counts'][i]:3d} rows={sections['warp_deformer.rows'][i]} cols={sections['warp_deformer.cols'][i]} band={sections['warp_deformer.keyform_binding_band_indices'][i]:3d}")

print("\n=== Rotation deformers (specific section) ===")
for i in range(count_info[3]):
    print(f"  [{i:3d}] kf_b={sections['rotation_deformer.keyform_begin_indices'][i]:4d} kf_n={sections['rotation_deformer.keyform_counts'][i]:3d} base_angle={sections['rotation_deformer.base_angles'][i]} band={sections['rotation_deformer.keyform_binding_band_indices'][i]:3d}")

print("\n=== Bindings (kfbinding) ===")
for i in range(count_info[13]):
    kb = sections['keyform_binding.keys_begin_indices'][i]
    kn = sections['keyform_binding.keys_counts'][i]
    keys = sections['keys.values'][kb:kb+kn]
    print(f"  [{i:3d}] keys[{kb}..{kb+kn}]={keys}")

print("\n=== Bands ===")
for i in range(count_info[12]):
    bb = sections['keyform_binding_band.begin_indices'][i]
    bn = sections['keyform_binding_band.counts'][i]
    bindings = sections['keyform_binding_index.indices'][bb:bb+bn]
    print(f"  [{i:3d}] bindings[{bb}..{bb+bn}]={bindings}")

print("\n=== Drawable masks (drawable_mask.art_mesh_indices) ===")
print(f"  {sections['drawable_mask.art_mesh_indices']}")

print("\n=== Draw Order Groups ===")
for i in range(count_info[18]):
    print(f"  [{i:3d}] obj_b={sections['draw_order_group.object_begin_indices'][i]} obj_n={sections['draw_order_group.object_counts'][i]} obj_total={sections['draw_order_group.object_total_counts'][i]} min_do={sections['draw_order_group.min_draw_orders'][i]} max_do={sections['draw_order_group.max_draw_orders'][i]}")

print("\n=== Draw Order Group Objects (first 30) ===")
for i in range(min(30, count_info[19])):
    print(f"  [{i:3d}] type={sections['draw_order_group_object.types'][i]} index={sections['draw_order_group_object.indices'][i]} group_idx={sections['draw_order_group_object.group_indices'][i]}")
