"""Dump art_mesh keyform positions and sample vertices for a specific mesh."""
import struct, sys

data = open(sys.argv[1], 'rb').read()
sot = struct.unpack('<160I', data[64:64+640])
count_info = struct.unpack('<23I', data[sot[0]:sot[0]+23*4])

SECTIONS = [
    'part.runtime_space','part.ids','part.keyform_binding_band_indices',
    'part.keyform_begin_indices','part.keyform_counts','part.visibles',
    'part.enables','part.parent_part_indices',
    'deformer.runtime_space','deformer.ids','deformer.keyform_binding_band_indices',
    'deformer.visibles','deformer.enables','deformer.parent_part_indices',
    'deformer.parent_deformer_indices','deformer.types','deformer.specific_indices',
    'warp_deformer.keyform_binding_band_indices','warp_deformer.keyform_begin_indices',
    'warp_deformer.keyform_counts','warp_deformer.vertex_counts',
    'warp_deformer.rows','warp_deformer.cols',
    'rotation_deformer.keyform_binding_band_indices','rotation_deformer.keyform_begin_indices',
    'rotation_deformer.keyform_counts','rotation_deformer.base_angles',
    'art_mesh.runtime_space_0','art_mesh.runtime_space_1','art_mesh.runtime_space_2',
    'art_mesh.runtime_space_3','art_mesh.ids','art_mesh.keyform_binding_band_indices',
    'art_mesh.keyform_begin_indices','art_mesh.keyform_counts','art_mesh.visibles',
    'art_mesh.enables','art_mesh.parent_part_indices','art_mesh.parent_deformer_indices',
    'art_mesh.texture_indices','art_mesh.drawable_flags','art_mesh.position_index_counts',
    'art_mesh.uv_begin_indices','art_mesh.position_index_begin_indices','art_mesh.vertex_counts',
    'art_mesh.mask_begin_indices','art_mesh.mask_counts',
    'parameter.runtime_space','parameter.ids','parameter.max_values','parameter.min_values',
    'parameter.default_values','parameter.repeats','parameter.decimal_places',
    'parameter.keyform_binding_begin_indices','parameter.keyform_binding_counts',
    'part_keyform.draw_orders',
    'warp_deformer_keyform.opacities','warp_deformer_keyform.keyform_position_begin_indices',
    'rotation_deformer_keyform.opacities','rotation_deformer_keyform.angles',
    'rotation_deformer_keyform.origin_xs','rotation_deformer_keyform.origin_ys',
    'rotation_deformer_keyform.scales','rotation_deformer_keyform.reflect_xs',
    'rotation_deformer_keyform.reflect_ys',
    'art_mesh_keyform.opacities','art_mesh_keyform.draw_orders',
    'art_mesh_keyform.keyform_position_begin_indices',
    'keyform_position.xys','keyform_binding_index.indices',
    'keyform_binding_band.begin_indices','keyform_binding_band.counts',
    'keyform_binding.keys_begin_indices','keyform_binding.keys_counts',
    'keys.values','uv.xys','position_index.indices','drawable_mask.art_mesh_indices',
    'draw_order_group.object_begin_indices','draw_order_group.object_counts',
    'draw_order_group.object_total_counts','draw_order_group.min_draw_orders',
    'draw_order_group.max_draw_orders',
    'draw_order_group_object.types','draw_order_group_object.indices',
    'draw_order_group_object.group_indices',
    'glue.runtime_space','glue.ids','glue.keyform_binding_band_indices',
    'glue.keyform_begin_indices','glue.keyform_counts','glue.art_mesh_index_as',
    'glue.art_mesh_index_bs','glue.info_begin_indices','glue.info_counts',
    'glue_info.weights','glue_info.position_indices','glue_keyform.intensities',
]
NAME_TO_SOT = {n: 2 + i for i, n in enumerate(SECTIONS)}

def f32(name, count):
    off = sot[NAME_TO_SOT[name]]
    return list(struct.unpack(f'<{count}f', data[off:off+count*4]))
def i32(name, count):
    off = sot[NAME_TO_SOT[name]]
    return list(struct.unpack(f'<{count}i', data[off:off+count*4]))

n_mesh = count_info[4]
n_mesh_kf = count_info[9]
mesh_kf_begin = i32('art_mesh.keyform_begin_indices', n_mesh)
mesh_kf_count = i32('art_mesh.keyform_counts', n_mesh)
mesh_vert_count = i32('art_mesh.position_index_counts', n_mesh)
mesh_pd = i32('art_mesh.parent_deformer_indices', n_mesh)
mesh_pp = i32('art_mesh.parent_part_indices', n_mesh)
mesh_kf_pos_begin = i32('art_mesh_keyform.keyform_position_begin_indices', n_mesh_kf)
mesh_kf_op = f32('art_mesh_keyform.opacities', n_mesh_kf)
all_pos = f32('keyform_position.xys', count_info[10])

n_def = count_info[1]
def_ids = []
ids_off = sot[NAME_TO_SOT['deformer.ids']]
for k in range(n_def):
    s = data[ids_off + k*64:ids_off + (k+1)*64]
    null = s.find(0)
    if null >= 0: s = s[:null]
    def_ids.append(s.decode('utf-8', errors='replace'))

target = sys.argv[2] if len(sys.argv) > 2 else None
for m in range(n_mesh):
    pdef = mesh_pd[m]
    pdef_name = def_ids[pdef] if 0 <= pdef < n_def else '?'
    if target and target not in pdef_name:
        continue
    nv = mesh_vert_count[m]
    print(f"=== ArtMesh{m} pp={mesh_pp[m]} pd={pdef}({pdef_name}) verts={nv} kf_n={mesh_kf_count[m]} ===")
    for ki in range(mesh_kf_count[m]):
        kf = mesh_kf_begin[m] + ki
        op = mesh_kf_op[kf]
        pos_off = mesh_kf_pos_begin[kf]
        pos_xy = all_pos[pos_off:pos_off + nv * 2]
        head4 = [(round(pos_xy[i*2], 4), round(pos_xy[i*2+1], 4)) for i in range(min(4, nv))]
        # bbox of vertex positions
        if nv > 0:
            xs = [pos_xy[i*2] for i in range(nv)]
            ys = [pos_xy[i*2+1] for i in range(nv)]
            print(f"  kf[{ki}] op={op:.2f} head={head4}  x_range=[{min(xs):.3f},{max(xs):.3f}] y_range=[{min(ys):.3f},{max(ys):.3f}]")
