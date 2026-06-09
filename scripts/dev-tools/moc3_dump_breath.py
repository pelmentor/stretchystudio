"""Dump every vertex of a named warp's keyforms, side-by-side with deltas."""
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

n_warp = count_info[2]
n_warp_kf = count_info[7]
warp_begin = i32('warp_deformer.keyform_begin_indices', n_warp)
warp_count = i32('warp_deformer.keyform_counts', n_warp)
warp_verts = i32('warp_deformer.vertex_counts', n_warp)
warp_rows  = i32('warp_deformer.rows', n_warp)
warp_cols  = i32('warp_deformer.cols', n_warp)
warp_kf_pos_begin = i32('warp_deformer_keyform.keyform_position_begin_indices', n_warp_kf)
all_pos = f32('keyform_position.xys', count_info[10])

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
warp_spec_to_name = ['?'] * n_warp
for k in range(n_def):
    if def_types[k] == 0:
        warp_spec_to_name[def_spec[k]] = def_ids[k]

target = sys.argv[2] if len(sys.argv) > 2 else None

# Also dump parameter -> keyform_binding mapping so we know which keys
# correspond to which keyforms.
n_param = count_info[3]
n_kfb   = count_info[8]
param_ids = []
pids_off = sot[NAME_TO_SOT['parameter.ids']]
for k in range(n_param):
    s = data[pids_off + k*64:pids_off + (k+1)*64]
    null = s.find(0)
    if null >= 0: s = s[:null]
    param_ids.append(s.decode('utf-8', errors='replace'))
param_kfb_begin = i32('parameter.keyform_binding_begin_indices', n_param)
param_kfb_count = i32('parameter.keyform_binding_counts', n_param)
kfb_keys_begin = i32('keyform_binding.keys_begin_indices', n_kfb)
kfb_keys_count = i32('keyform_binding.keys_counts', n_kfb)
n_keys = count_info[12]
keys_values = f32('keys.values', n_keys)

# Find param that drives the target warp.
for p, pid in enumerate(param_ids):
    if 'Breath' in pid:
        kfb_idx = param_kfb_begin[p]
        for b in range(param_kfb_count[p]):
            kb = kfb_idx + b
            kb0 = kfb_keys_begin[kb]
            kc  = kfb_keys_count[kb]
            print(f"param '{pid}' kfb[{b}]: {kc} keys = {keys_values[kb0:kb0+kc]}")
print()

for s in range(n_warp):
    name = warp_spec_to_name[s]
    if target and target not in name:
        continue
    nv = warp_verts[s]
    rows = warp_rows[s]
    cols = warp_cols[s]
    print(f"=== Warp[{s}] {name} kf_n={warp_count[s]} verts={nv} rows={rows} cols={cols} ===")
    grids = []
    for ki in range(warp_count[s]):
        kf = warp_begin[s] + ki
        pos_off_floats = warp_kf_pos_begin[kf]
        pos_xy = all_pos[pos_off_floats:pos_off_floats + nv * 2]
        grids.append(pos_xy)
        print(f"--- kf[{ki}] full grid (row, col -> x, y):")
        for r in range(rows):
            for c in range(cols):
                idx = (r * cols + c) * 2
                x, y = pos_xy[idx], pos_xy[idx+1]
                print(f"  [{r},{c}] = ({x:.6f}, {y:.6f})")
    # If 2 keyforms, show deltas
    if len(grids) == 2:
        print(f"--- kf[1] - kf[0] deltas (only where non-zero):")
        any_delta = False
        for r in range(rows):
            for c in range(cols):
                idx = (r * cols + c) * 2
                dx = grids[1][idx]   - grids[0][idx]
                dy = grids[1][idx+1] - grids[0][idx+1]
                if abs(dx) > 1e-9 or abs(dy) > 1e-9:
                    any_delta = True
                    print(f"  [{r},{c}] dx={dx:+.6f} dy={dy:+.6f}")
        if not any_delta:
            print("  ALL ZERO — warp is identity between keyforms!")
