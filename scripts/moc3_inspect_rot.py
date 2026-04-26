"""Dump rotation-deformer keyforms (correctly indexed by section name)."""
import struct, sys

# Reuse the SECTION_LAYOUT from moc3_inspect.py to get a name→sot_idx map.
data = open(sys.argv[1], 'rb').read()
sot = struct.unpack('<160I', data[64:64+640])
count_info = struct.unpack('<23I', data[sot[0]:sot[0]+23*4])

# Build name → sot_idx map by counting sections (matching moc3_inspect.py order).
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

n_kf = count_info[8]  # rotation_deformer_keyforms
def f32(name, count):
    off = sot[NAME_TO_SOT[name]]
    return list(struct.unpack(f'<{count}f', data[off:off+count*4]))

opacities = f32('rotation_deformer_keyform.opacities', n_kf)
angles    = f32('rotation_deformer_keyform.angles', n_kf)
oxs       = f32('rotation_deformer_keyform.origin_xs', n_kf)
oys       = f32('rotation_deformer_keyform.origin_ys', n_kf)
scales    = f32('rotation_deformer_keyform.scales', n_kf)

# Also load rotation_deformer.keyform_begin_indices to map kf→spec_idx.
n_rot = count_info[3]
def i32(name, count):
    off = sot[NAME_TO_SOT[name]]
    return list(struct.unpack(f'<{count}i', data[off:off+count*4]))
rot_begin = i32('rotation_deformer.keyform_begin_indices', n_rot)
rot_count = i32('rotation_deformer.keyform_counts', n_rot)

# Map kf index → spec index.
kf_to_spec = [-1] * n_kf
for s in range(n_rot):
    for i in range(rot_count[s]):
        kf_to_spec[rot_begin[s] + i] = s

# Also load deformer ids + types + specific_indices to label spec→deformer.
n_def = count_info[1]
def_types = i32('deformer.types', n_def)
def_spec  = i32('deformer.specific_indices', n_def)

def_ids = []
ids_off = sot[NAME_TO_SOT['deformer.ids']]
for k in range(n_def):
    s = data[ids_off + k*64:ids_off + (k+1)*64]
    null = s.find(0)
    if null >= 0: s = s[:null]
    def_ids.append(s.decode('utf-8', errors='replace'))

# Build spec_idx (rotation) → deformer name.
rot_spec_to_name = ['?'] * n_rot
for k in range(n_def):
    if def_types[k] == 1:  # rotation
        rot_spec_to_name[def_spec[k]] = def_ids[k]

print(f"=== Rotation deformer keyforms ({n_kf}) ===")
for i in range(n_kf):
    s = kf_to_spec[i]
    name = rot_spec_to_name[s] if s >= 0 else '?'
    print(f"  kf[{i:2d}] (spec={s} {name:35s}) op={opacities[i]:.2f} angle={angles[i]:7.2f} origin=({oxs[i]:9.4f},{oys[i]:9.4f}) scale={scales[i]:.2f}")
