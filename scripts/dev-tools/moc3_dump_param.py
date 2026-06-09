"""Dump parameter metadata (min/max/default/decimal_places) for all params."""
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
]
NAME_TO_SOT = {n: 2 + i for i, n in enumerate(SECTIONS)}

def f32(name, count):
    off = sot[NAME_TO_SOT[name]]
    return list(struct.unpack(f'<{count}f', data[off:off+count*4]))
def i32(name, count):
    off = sot[NAME_TO_SOT[name]]
    return list(struct.unpack(f'<{count}i', data[off:off+count*4]))

n_param = count_info[3]
param_ids = []
pids_off = sot[NAME_TO_SOT['parameter.ids']]
for k in range(n_param):
    s = data[pids_off + k*64:pids_off + (k+1)*64]
    null = s.find(0)
    if null >= 0: s = s[:null]
    param_ids.append(s.decode('utf-8', errors='replace'))
mins = f32('parameter.min_values', n_param)
maxs = f32('parameter.max_values', n_param)
defs = f32('parameter.default_values', n_param)
deps = i32('parameter.decimal_places', n_param)
reps = i32('parameter.repeats', n_param)

target = sys.argv[2] if len(sys.argv) > 2 else None
for i, pid in enumerate(param_ids):
    if target and target not in pid:
        continue
    print(f"{pid:30s}  min={mins[i]:+8.4f}  max={maxs[i]:+8.4f}  default={defs[i]:+8.4f}  decimals={deps[i]}  repeat={reps[i]}")
