// @ts-check

/**
 * Binary layout constants + SECTION_LAYOUT for the .moc3 writer.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #34).
 *
 * Single source of truth for:
 *   - Header / SOT / count-info dimensions and offsets
 *   - MOC_VERSION enum (V3.00 → V5.00)
 *   - COUNT_IDX (the 23 numbered count-info slots)
 *   - ELEM (per-section element types: I32/F32/I16/U8/BOOL/STR64/RUNTIME)
 *   - SECTION_LAYOUT (~91 entries, order matches py-moc3 _core.py)
 *
 * Reference: py-moc3 _core.py — verified read+write
 *
 * @module io/live2d/moc3/layout
 */

// Source: [ref][py-moc3] — format constants from reference file + py-moc3
export const MAGIC = [0x4D, 0x4F, 0x43, 0x33]; // "MOC3"
export const HEADER_SIZE = 64;
export const SOT_COUNT = 160;
export const SOT_SIZE = SOT_COUNT * 4; // 640 bytes
export const COUNT_INFO_ENTRIES = 23;
export const COUNT_INFO_SIZE = 128; // 23 * 4 = 92, padded to 128
export const CANVAS_INFO_SIZE = 64;
export const DEFAULT_OFFSET = 1984; // body starts here
export const ALIGN = 64;
export const RUNTIME_UNIT_SIZE = 8;
export const STRING_FIELD_SIZE = 64; // MOC3Id is a 64-byte null-padded UTF-8 string

// Source: [py-moc3] — version enum
export const MOC_VERSION = {
  V3_00: 1,
  V3_03: 2,
  V4_00: 3,
  V4_02: 4,
  V5_00: 5,
};

// Source: [py-moc3] — count info indices
export const COUNT_IDX = {
  PARTS: 0,
  DEFORMERS: 1,
  WARP_DEFORMERS: 2,
  ROTATION_DEFORMERS: 3,
  ART_MESHES: 4,
  PARAMETERS: 5,
  PART_KEYFORMS: 6,
  WARP_DEFORMER_KEYFORMS: 7,
  ROTATION_DEFORMER_KEYFORMS: 8,
  ART_MESH_KEYFORMS: 9,
  KEYFORM_POSITIONS: 10,
  KEYFORM_BINDING_INDICES: 11,
  KEYFORM_BINDING_BANDS: 12,
  KEYFORM_BINDINGS: 13,
  KEYS: 14,
  UVS: 15,
  POSITION_INDICES: 16,
  DRAWABLE_MASKS: 17,
  DRAW_ORDER_GROUPS: 18,
  DRAW_ORDER_GROUP_OBJECTS: 19,
  GLUES: 20,
  GLUE_INFOS: 21,
  GLUE_KEYFORMS: 22,
};

// Source: [py-moc3] — element types and their byte sizes
export const ELEM = {
  I32:     { size: 4, write: 'writeI32Array' },
  F32:     { size: 4, write: 'writeF32Array' },
  I16:     { size: 2, write: 'writeI16Array' },
  U8:      { size: 1, write: 'writeU8Array' },
  BOOL:    { size: 4, write: 'writeBoolArray' },  // stored as i32
  STR64:   { size: 64, write: 'writeStringArray' },
  RUNTIME: { size: RUNTIME_UNIT_SIZE, write: 'writeRuntime' },
};

/**
 * Section layout definition — order matches py-moc3's SECTION_LAYOUT exactly.
 * Each entry: [name, elemType, countIdx, alignment]
 *
 * Source: [py-moc3] _core.py lines 319–466
 */
export const SECTION_LAYOUT = [
  // Parts (count_idx=0)
  ['part.runtime_space',                ELEM.RUNTIME, COUNT_IDX.PARTS, ALIGN],
  ['part.ids',                          ELEM.STR64,   COUNT_IDX.PARTS, 0],
  ['part.keyform_binding_band_indices', ELEM.I32,     COUNT_IDX.PARTS, ALIGN],
  ['part.keyform_begin_indices',        ELEM.I32,     COUNT_IDX.PARTS, ALIGN],
  ['part.keyform_counts',               ELEM.I32,     COUNT_IDX.PARTS, ALIGN],
  ['part.visibles',                     ELEM.BOOL,    COUNT_IDX.PARTS, ALIGN],
  ['part.enables',                      ELEM.BOOL,    COUNT_IDX.PARTS, ALIGN],
  ['part.parent_part_indices',          ELEM.I32,     COUNT_IDX.PARTS, ALIGN],

  // Deformers (count_idx=1)
  ['deformer.runtime_space',                   ELEM.RUNTIME, COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.ids',                             ELEM.STR64,   COUNT_IDX.DEFORMERS, 0],
  ['deformer.keyform_binding_band_indices',    ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.visibles',                        ELEM.BOOL,    COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.enables',                         ELEM.BOOL,    COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.parent_part_indices',             ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.parent_deformer_indices',         ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.types',                           ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],
  ['deformer.specific_indices',                ELEM.I32,     COUNT_IDX.DEFORMERS, ALIGN],

  // Warp Deformers (count_idx=2)
  ['warp_deformer.keyform_binding_band_indices', ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.keyform_begin_indices',        ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.keyform_counts',               ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.vertex_counts',                ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.rows',                         ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],
  ['warp_deformer.cols',                         ELEM.I32, COUNT_IDX.WARP_DEFORMERS, ALIGN],

  // Rotation Deformers (count_idx=3)
  ['rotation_deformer.keyform_binding_band_indices', ELEM.I32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],
  ['rotation_deformer.keyform_begin_indices',        ELEM.I32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],
  ['rotation_deformer.keyform_counts',               ELEM.I32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],
  ['rotation_deformer.base_angles',                  ELEM.F32, COUNT_IDX.ROTATION_DEFORMERS, ALIGN],

  // ArtMeshes (count_idx=4)
  ['art_mesh.runtime_space_0',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.runtime_space_1',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.runtime_space_2',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.runtime_space_3',                ELEM.RUNTIME, COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.ids',                            ELEM.STR64,   COUNT_IDX.ART_MESHES, 0],
  ['art_mesh.keyform_binding_band_indices',   ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.keyform_begin_indices',          ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.keyform_counts',                 ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.visibles',                       ELEM.BOOL,    COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.enables',                        ELEM.BOOL,    COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.parent_part_indices',            ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.parent_deformer_indices',        ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.texture_indices',                ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.drawable_flags',                 ELEM.U8,      COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.position_index_counts',          ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.uv_begin_indices',               ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.position_index_begin_indices',   ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.vertex_counts',                  ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.mask_begin_indices',             ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],
  ['art_mesh.mask_counts',                    ELEM.I32,     COUNT_IDX.ART_MESHES, ALIGN],

  // Parameters (count_idx=5)
  ['parameter.runtime_space',                    ELEM.RUNTIME, COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.ids',                              ELEM.STR64,   COUNT_IDX.PARAMETERS, 0],
  ['parameter.max_values',                       ELEM.F32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.min_values',                       ELEM.F32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.default_values',                   ELEM.F32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.repeats',                          ELEM.BOOL,    COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.decimal_places',                   ELEM.I32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.keyform_binding_begin_indices',    ELEM.I32,     COUNT_IDX.PARAMETERS, ALIGN],
  ['parameter.keyform_binding_counts',           ELEM.I32,     COUNT_IDX.PARAMETERS, ALIGN],

  // Part Keyforms (count_idx=6)
  ['part_keyform.draw_orders', ELEM.F32, COUNT_IDX.PART_KEYFORMS, ALIGN],

  // Warp Deformer Keyforms (count_idx=7)
  ['warp_deformer_keyform.opacities',                      ELEM.F32, COUNT_IDX.WARP_DEFORMER_KEYFORMS, ALIGN],
  ['warp_deformer_keyform.keyform_position_begin_indices',  ELEM.I32, COUNT_IDX.WARP_DEFORMER_KEYFORMS, ALIGN],

  // Rotation Deformer Keyforms (count_idx=8)
  ['rotation_deformer_keyform.opacities',   ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.angles',      ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.origin_xs',   ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.origin_ys',   ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.scales',      ELEM.F32,  COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.reflect_xs',  ELEM.BOOL, COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],
  ['rotation_deformer_keyform.reflect_ys',  ELEM.BOOL, COUNT_IDX.ROTATION_DEFORMER_KEYFORMS, ALIGN],

  // ArtMesh Keyforms (count_idx=9)
  ['art_mesh_keyform.opacities',                      ELEM.F32, COUNT_IDX.ART_MESH_KEYFORMS, ALIGN],
  ['art_mesh_keyform.draw_orders',                    ELEM.F32, COUNT_IDX.ART_MESH_KEYFORMS, ALIGN],
  ['art_mesh_keyform.keyform_position_begin_indices',  ELEM.I32, COUNT_IDX.ART_MESH_KEYFORMS, ALIGN],

  // Keyform Positions (count_idx=10) — vertex XY pairs
  ['keyform_position.xys', ELEM.F32, COUNT_IDX.KEYFORM_POSITIONS, ALIGN],

  // Keyform Binding Indices (count_idx=11)
  ['keyform_binding_index.indices', ELEM.I32, COUNT_IDX.KEYFORM_BINDING_INDICES, ALIGN],

  // Keyform Binding Bands (count_idx=12)
  ['keyform_binding_band.begin_indices', ELEM.I32, COUNT_IDX.KEYFORM_BINDING_BANDS, ALIGN],
  ['keyform_binding_band.counts',        ELEM.I32, COUNT_IDX.KEYFORM_BINDING_BANDS, ALIGN],

  // Keyform Bindings (count_idx=13)
  ['keyform_binding.keys_begin_indices', ELEM.I32, COUNT_IDX.KEYFORM_BINDINGS, ALIGN],
  ['keyform_binding.keys_counts',        ELEM.I32, COUNT_IDX.KEYFORM_BINDINGS, ALIGN],

  // Keys (count_idx=14) — parameter values at keyform stops
  ['keys.values', ELEM.F32, COUNT_IDX.KEYS, ALIGN],

  // UVs (count_idx=15) — texture coordinates (XY pairs)
  ['uv.xys', ELEM.F32, COUNT_IDX.UVS, ALIGN],

  // Position Indices (count_idx=16) — triangle indices
  ['position_index.indices', ELEM.I16, COUNT_IDX.POSITION_INDICES, ALIGN],

  // Drawable Masks (count_idx=17)
  ['drawable_mask.art_mesh_indices', ELEM.I32, COUNT_IDX.DRAWABLE_MASKS, ALIGN],

  // Draw Order Groups (count_idx=18)
  ['draw_order_group.object_begin_indices',  ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.object_counts',         ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.object_total_counts',   ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.min_draw_orders',       ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],
  ['draw_order_group.max_draw_orders',       ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUPS, ALIGN],

  // Draw Order Group Objects (count_idx=19)
  ['draw_order_group_object.types',         ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS, ALIGN],
  ['draw_order_group_object.indices',       ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS, ALIGN],
  ['draw_order_group_object.group_indices', ELEM.I32, COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS, ALIGN],

  // Glues (count_idx=20)
  ['glue.runtime_space',               ELEM.RUNTIME, COUNT_IDX.GLUES, ALIGN],
  ['glue.ids',                         ELEM.STR64,   COUNT_IDX.GLUES, 0],
  ['glue.keyform_binding_band_indices', ELEM.I32,    COUNT_IDX.GLUES, ALIGN],
  ['glue.keyform_begin_indices',       ELEM.I32,     COUNT_IDX.GLUES, ALIGN],
  ['glue.keyform_counts',             ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.art_mesh_index_as',          ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.art_mesh_index_bs',          ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.info_begin_indices',         ELEM.I32,      COUNT_IDX.GLUES, ALIGN],
  ['glue.info_counts',                ELEM.I32,      COUNT_IDX.GLUES, ALIGN],

  // Glue Infos (count_idx=21)
  ['glue_info.weights',          ELEM.F32, COUNT_IDX.GLUE_INFOS, ALIGN],
  ['glue_info.position_indices', ELEM.I16, COUNT_IDX.GLUE_INFOS, ALIGN],

  // Glue Keyforms (count_idx=22)
  ['glue_keyform.intensities', ELEM.F32, COUNT_IDX.GLUE_KEYFORMS, ALIGN],
];
